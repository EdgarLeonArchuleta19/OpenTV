package com.techpoint.opentv.service;

import java.util.ArrayList;
import java.util.List;

/*
 * Port of service/ts-indexer.js: indexes an MPEG-TS file for the proxy's
 * virtual HLS playlist. It never changes media bytes: it finds HEVC
 * random-access NALs and emits packet-aligned byte ranges. Runs on its own
 * thread; readers wait on the monitor.
 */
final class TsIndexer {
    interface RangeReader {
        byte[] read(long start, long end) throws Exception;
    }

    static final class Segment {
        final long start, end;
        final double duration;
        Segment(long start, long end, double duration) { this.start = start; this.end = end; this.duration = duration; }
    }

    private static final int PACKET = 188;
    private final long length;
    private final RangeReader reader;
    private long offset = 0, pat = 0;
    private int pmt = -1, video = -1;
    private double pts = 0;
    private long curStart = -1;
    private double curPts = 0;
    final List<Segment> segments = new ArrayList<>();
    volatile boolean complete;
    private boolean running;

    TsIndexer(long length, RangeReader reader) {
        this.length = length;
        this.reader = reader;
    }

    synchronized void start() {
        if (running) return;
        running = true;
        Thread t = new Thread(this::run, "opentv-tsindex");
        t.setDaemon(true);
        t.start();
    }

    /* Blocks until at least one segment exists or indexing finished. */
    synchronized List<Segment> snapshot(boolean waitFirst) throws InterruptedException {
        while (waitFirst && segments.isEmpty() && !complete) wait();
        return new ArrayList<>(segments);
    }

    private synchronized void notifyReaders() {
        notifyAll();
    }

    private void run() {
        while (true) {
            if (offset >= length) {
                synchronized (this) {
                    complete = true;
                    if (curStart >= 0) segments.add(new Segment(curStart, length - 1, 10));
                    notifyAll();
                }
                return;
            }
            long size = (2L * 1024 * 1024 / PACKET) * PACKET;
            long start = offset, end = Math.min(length - 1, start + size - 1);
            byte[] body;
            try {
                body = reader.read(start, end);
            } catch (Exception e) {
                complete = true;
                notifyReaders();
                return;
            }
            parse(body, start);
            offset = end + 1;
        }
    }

    private static int u(byte[] b, int i) {
        return i < b.length && i >= 0 ? b[i] & 0xff : 0;
    }

    private static double ptsAt(byte[] b, int p) {
        return ((u(b, p) & 14) * 536870912.0) + (u(b, p + 1) * 4194304.0) + ((u(b, p + 2) & 254) * 16384.0) + (u(b, p + 3) * 128.0) + ((u(b, p + 4) & 254) / 2.0);
    }

    private int payload(byte[] b, int p) {
        int afc = (u(b, p + 3) >> 4) & 3, at = p + 4;
        if (afc == 2 || afc == 0) return -1;
        if (afc == 3) at += 1 + u(b, at);
        return at < p + PACKET ? at : -1;
    }

    private int tableStart(byte[] b, int at, boolean pusi) {
        return pusi ? at + 1 + u(b, at) : at;
    }

    private void parsePat(byte[] b, int at, boolean pusi) {
        at = tableStart(b, at, pusi);
        if (at < 0 || u(b, at) != 0) return;
        int end = at + 3 + (((u(b, at + 1) & 15) << 8) | u(b, at + 2)) - 4;
        for (int p = at + 8; p + 3 < end; p += 4) {
            if (u(b, p) != 0 || u(b, p + 1) != 0) { pmt = ((u(b, p + 2) & 31) << 8) | u(b, p + 3); return; }
        }
    }

    private void parsePmt(byte[] b, int at, boolean pusi) {
        at = tableStart(b, at, pusi);
        if (at < 0 || u(b, at) != 2) return;
        int end = at + 3 + (((u(b, at + 1) & 15) << 8) | u(b, at + 2)) - 4;
        int p = at + 12 + (((u(b, at + 10) & 15) << 8) | u(b, at + 11));
        while (p + 4 < end) {
            int typ = u(b, p), pid = ((u(b, p + 1) & 31) << 8) | u(b, p + 2), n = ((u(b, p + 3) & 15) << 8) | u(b, p + 4);
            if (typ == 0x24) { video = pid; return; }
            p += 5 + n;
        }
    }

    private static boolean isAccess(byte[] b, int at, int end) {
        for (int i = at; i + 5 < end; i++) {
            boolean z = u(b, i) == 0 && u(b, i + 1) == 0 && (u(b, i + 2) == 1 || (u(b, i + 2) == 0 && u(b, i + 3) == 1));
            if (z) {
                int n = i + (u(b, i + 2) == 1 ? 3 : 4), type = (u(b, n) >> 1) & 63;
                if (type == 19 || type == 20 || type == 21) return true;
            }
        }
        return false;
    }

    private void access(long pos) {
        if (pts == 0) return;
        long start = pat != 0 ? pat : pos;
        if (curStart < 0) { curStart = start; curPts = pts; return; }
        double dur = (pts - curPts) / 90000;
        if (dur < 5 || start <= curStart) return;
        synchronized (this) {
            segments.add(new Segment(curStart, start - 1, dur));
            notifyAll();
        }
        curStart = start;
        curPts = pts;
    }

    private void parse(byte[] b, long base) {
        for (int p = 0; p + PACKET <= b.length; p += PACKET) {
            if (u(b, p) != 0x47) continue;
            boolean pusi = (u(b, p + 1) & 64) != 0;
            int pid = ((u(b, p + 1) & 31) << 8) | u(b, p + 2), at = payload(b, p);
            if (at < 0) continue;
            if (pid == 0) { pat = base + p; parsePat(b, at, pusi); continue; }
            if (pid == pmt) { parsePmt(b, at, pusi); continue; }
            if (pid != video) continue;
            if (pusi && at + 13 < p + PACKET && u(b, at) == 0 && u(b, at + 1) == 0 && u(b, at + 2) == 1) {
                if ((u(b, at + 7) & 128) != 0) pts = ptsAt(b, at + 9);
            }
            if (isAccess(b, at, p + PACKET)) access(base + p);
        }
    }
}
