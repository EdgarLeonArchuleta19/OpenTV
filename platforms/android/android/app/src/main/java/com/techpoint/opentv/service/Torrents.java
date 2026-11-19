package com.techpoint.opentv.service;

import android.content.Context;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;
import org.libtorrent4j.AddTorrentParams;
import org.libtorrent4j.AlertListener;
import org.libtorrent4j.FileStorage;
import org.libtorrent4j.Priority;
import org.libtorrent4j.SessionHandle;
import org.libtorrent4j.SessionManager;
import org.libtorrent4j.SessionParams;
import org.libtorrent4j.SettingsPack;
import org.libtorrent4j.TorrentFlags;
import org.libtorrent4j.TorrentHandle;
import org.libtorrent4j.TorrentInfo;
import org.libtorrent4j.TorrentStatus;
import org.libtorrent4j.alerts.Alert;
import org.libtorrent4j.alerts.AlertType;
import org.libtorrent4j.alerts.PieceFinishedAlert;
import org.libtorrent4j.swig.alert;
import org.libtorrent4j.swig.error_code;
import org.libtorrent4j.swig.settings_pack;
import org.libtorrent4j.swig.torrent_flags_t;
import org.libtorrent4j.swig.torrent_handle;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.URLEncoder;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.BitSet;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/*
 * Torrent playback on Android, the port of service/torrents.js on top of
 * libtorrent (libtorrent4j): one torrent at a time, downloaded around the
 * position the player reads and served on loopback as a plain HTTP file with
 * Range support, so ExoPlayer plays and seeks it like any other link.
 *
 *   start({infoHash, fileIdx, sources}) -> {url, name, length, mime, infoHash}
 *   stats()                             -> {active, ready, peers, speed, ...}
 *   stop()                              -> torrent removed, cache deleted
 *
 * Streaming: only what is around the readers is wanted, so the cache grows
 * with what is watched and not with the size of the file (a Fire TV Stick
 * has a few GB free, and libtorrent cannot drop pieces it already wrote).
 * Every HTTP reader raises the 8 MB ahead of its read position to top
 * priority and gives the nearest pieces libtorrent deadlines (time-critical,
 * nearest first), then blocks until the piece it needs has passed the hash
 * check; the 256 MB after that are a low-priority read-ahead that rides
 * out a slow swarm. Everything else stays unwanted. A reader that opens far
 * from where the last one stopped is a seek: the old window goes back to
 * unwanted (what was written stays on disk). Short request timeouts move a
 * block stuck on a slow peer to another one. The first and last pieces get
 * a deadline as soon as the metadata arrives (container headers, MP4 index
 * and MKV cues live there).
 *
 * Disk: start() refuses a torrent when not even the read-ahead fits, and
 * answers fits=false when the whole file would not (it still plays; the
 * read-ahead stops when the volume runs low).
 *
 * Memory: libtorrent writes straight to disk (POSIX disk I/O, no mmap so a
 * 32-bit Fire TV never maps a multi-GB file), the disk queue and send buffers
 * are capped and readers copy through a 64 KB buffer. The cache lives in
 * getCacheDir()/torrents and is deleted on stop, after 10 minutes without
 * reads, on app exit and again on the next start.
 *
 * The libtorrent session is shared with torrent downloads (Downloads.java):
 * they hold it with acquireSession()/releaseSession(), and stopping the
 * streamed torrent only removes its own handle. libtorrent cannot hold the
 * same torrent twice, so a download of the torrent about to be streamed
 * waits (Downloads.yieldTorrent) until the stream stops.
 *
 * The native library is built for Android 9 (API 28) and ARM only, so older
 * or x86 devices answer "not available" (ping reports torrents=false).
 */
final class Torrents {
    private Torrents() {}

    private static final String TAG = "OpenTV";
    static final long READY_TIMEOUT_MS = 60000;
    private static final long IDLE_STOP_MS = 10 * 60 * 1000L;      // nobody reading: stop and free the disk
    private static final long SESSION_IDLE_MS = 3 * 60 * 1000L;    // no torrent: shut libtorrent down
    private static final long PIECE_WAIT_MS = 25000;               // longer than ExoPlayer's read timeout
    private static final int READAHEAD_BYTES = 8 * 1024 * 1024;    // top priority ahead of a reader
    private static final int URGENT_BYTES = 8 * 1024 * 1024;       // of which, with a deadline
    /* Low-priority read-ahead after the top window. 256 MB is ~4 min of a
       1080p release (~8 Mbit/s) and ~40 s of a 4K remux (~50 Mbit/s): enough
       to ride out a swarm that slows down for a while, small next to the few
       GB a Fire TV Stick has free. */
    private static final long LOW_READAHEAD_BYTES = 256L * 1024 * 1024;
    /* The read-ahead stops below this much free space (the top window goes on). */
    private static final long LOW_RESERVE_BYTES = 128L * 1024 * 1024;
    /* Room a torrent needs before it starts: both windows and some slack. */
    private static final long MIN_START_FREE = READAHEAD_BYTES + LOW_READAHEAD_BYTES + 64L * 1024 * 1024;
    /* fits=true when the whole file plus this margin is free. */
    private static final long FIT_MARGIN = 256L * 1024 * 1024;
    /* Readers within this much of the end of the file read the container
       index (MP4 moov, MKV cues): they are not seeks. */
    private static final long TAIL_BYTES = 16L * 1024 * 1024;
    private static final int MIN_NATIVE_SDK = 28;

    /* Public trackers added to every torrent (same list as the PC service);
       DHT is on too. */
    private static final String[] DEFAULT_TRACKERS = {
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://open.demonii.com:1337/announce",
        "udp://open.stealth.si:80/announce",
        "udp://tracker.torrent.eu.org:451/announce",
        "udp://exodus.desync.com:6969/announce",
        "udp://explodie.org:6969/announce"
    };

    static final Pattern HASH = Pattern.compile("^[0-9a-f]{40}$");
    static final Pattern VIDEO_EXT = Pattern.compile("\\.(mp4|m4v|mkv|webm|avi|mov|ts|m2ts|wmv|flv|mpg|mpeg)$", Pattern.CASE_INSENSITIVE);
    private static final Pattern TOKEN_PATH = Pattern.compile("^/t/([0-9a-f]{16})/");
    static final Pattern RANGE = Pattern.compile("^bytes=(\\d*)-(\\d*)$");
    static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("mp4", "video/mp4"); MIME.put("m4v", "video/mp4"); MIME.put("mov", "video/mp4");
        MIME.put("webm", "video/webm"); MIME.put("mkv", "video/x-matroska"); MIME.put("avi", "video/x-msvideo");
        MIME.put("ts", "video/mp2t"); MIME.put("m2ts", "video/mp2t"); MIME.put("wmv", "video/x-ms-wmv");
        MIME.put("flv", "video/x-flv"); MIME.put("mpg", "video/mpeg"); MIME.put("mpeg", "video/mpeg");
    }

    private static File root;                 // <cache>/torrents
    private static SessionManager session;
    private static int sessionUsers;          // downloads holding the session
    private static LocalServer server;
    private static volatile Job current;
    private static Boolean libLoaded;
    private static ScheduledFuture<?> idleCheck;
    private static ScheduledFuture<?> sessionShutdown;
    private static final SecureRandom random = new SecureRandom();
    private static final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "opentv-torrent-timer");
        t.setDaemon(true);
        return t;
    });

    /* One torrent being played. */
    private static final class Job {
        final String key;
        final String hash;
        final String token;
        final File dir;
        final long started = System.currentTimeMillis();
        volatile long lastRead = started;
        volatile TorrentHandle handle;
        volatile boolean ready;
        volatile boolean cancelled;
        volatile String error;
        final CountDownLatch done = new CountDownLatch(1);
        // Set once before ready=true, read-only afterwards.
        String fileName = "";
        long fileLength;
        long fileOffset;
        String filePath;
        int pieceLength;
        int firstPiece;
        int lastPiece;
        int[] edges = new int[0];
        volatile boolean fits = true;
        // Pieces known to be downloaded and verified (from piece_finished alerts).
        final Object pieceLock = new Object();
        final BitSet have = new BitSet();
        // Priority state, lock: raised. Pieces at top priority, pieces in the
        // low-priority read-ahead, the open readers and the position where
        // the last one closed (its windows stay until another reader opens).
        final BitSet raised = new BitSet();
        final BitSet low = new BitSet();
        final List<Reader> readers = new ArrayList<>();
        int lingering = -1;
        // Free space of the cache volume, re-read at most every few seconds.
        long free = -1;
        long freeAt;

        Job(String key, String hash, String token, File dir) {
            this.key = key;
            this.hash = hash;
            this.token = token;
            this.dir = dir;
        }

        boolean has(int piece) {
            synchronized (pieceLock) { return have.get(piece); }
        }

        void markHave(int piece) {
            synchronized (pieceLock) {
                have.set(piece);
                pieceLock.notifyAll();
            }
        }
    }

    /* One HTTP connection reading the file: the piece it is at. */
    private static final class Reader {
        int piece = -1;
    }

    /* --------------------------------------------------------------- setup */

    /* From OpenTvService.start (off the main thread): a previous run that was
       killed may have left pieces behind. */
    static synchronized void init(Context context) {
        if (root != null) return;
        root = new File(context.getCacheDir(), "torrents");
        deleteTree(root);
    }

    /* Whether this device can load the native engine at all (no loading here:
       ping must stay cheap). */
    static boolean supported() {
        if (Build.VERSION.SDK_INT < MIN_NATIVE_SDK) return false;
        for (String abi : Build.SUPPORTED_ABIS) {
            if ("arm64-v8a".equals(abi) || "armeabi-v7a".equals(abi)) return true;
        }
        return false;
    }

    private static void loadLib() throws PortalException {
        if (libLoaded == null) {
            boolean ok = false;
            if (supported()) {
                try {
                    System.loadLibrary("torrent4j");
                    ok = true;
                } catch (Throwable t) {
                    Log.e(TAG, "torrent: no se pudo cargar libtorrent4j: " + t);
                }
            }
            libLoaded = ok;
        }
        if (!libLoaded) throw new PortalException("Los torrents no están disponibles en este aparato");
    }

    private static void ensureServer() throws IOException {
        if (server != null) return;
        LocalServer s = new LocalServer("torrent", Torrents::serve);
        s.start(0);
        server = s;
    }

    private static void ensureSession() {
        if (sessionShutdown != null) {
            sessionShutdown.cancel(false);
            sessionShutdown = null;
        }
        if (session != null) return;
        SettingsPack s = new SettingsPack();
        // Peers need a listen socket (TCP + uTP/DHT on UDP), on a random port.
        // No UPnP/NAT-PMP (never opens router ports) and no LAN discovery.
        s.listenInterfaces("0.0.0.0:0,[::]:0");
        s.setBoolean(settings_pack.bool_types.enable_upnp.swigValue(), false);
        s.setBoolean(settings_pack.bool_types.enable_natpmp.swigValue(), false);
        s.setEnableLsd(false);
        s.setEnableDht(true);
        // Low-memory limits for 1 GB TVs.
        s.connectionsLimit(60);
        s.maxPeerlistSize(1000);
        s.alertQueueSize(1000);
        s.sendBufferWatermark(256 * 1024);
        s.maxQueuedDiskBytes(2 * 1024 * 1024);
        s.setInteger(settings_pack.int_types.unchoke_slots_limit.swigValue(), 4);
        s.setInteger(settings_pack.int_types.aio_threads.swigValue(), 2);
        s.setInteger(settings_pack.int_types.hashing_threads.swigValue(), 1);
        s.setInteger(settings_pack.int_types.file_pool_size.swigValue(), 4);
        s.stopTrackerTimeout(2);
        // A block stuck on a slow peer stalls the player: re-request it from
        // another peer after a few seconds (defaults 60 s / 20 s). Measured on
        // a public swarm: +40-80 % in-order throughput for a sequential reader.
        s.setInteger(settings_pack.int_types.request_timeout.swigValue(), 5);
        s.setInteger(settings_pack.int_types.piece_timeout.swigValue(), 5);
        SessionParams params = new SessionParams(s);
        params.setPosixDiskIO();
        SessionManager sm = new SessionManager(false);
        sm.addListener(new AlertListener() {
            @Override
            public int[] types() {
                return new int[] { AlertType.PIECE_FINISHED.swig() };
            }

            @Override
            public void alert(Alert<?> alert) {
                if (!(alert instanceof PieceFinishedAlert)) return;
                PieceFinishedAlert a = (PieceFinishedAlert) alert;
                Job j = current;
                if (j == null || j.handle == null) return;
                try {
                    if (a.handle().equals(j.handle)) j.markHave(a.pieceIndex());
                } catch (Throwable ignored) { /* torrent removed meanwhile */ }
            }
        });
        sm.start(params);
        // SessionManager turns on nearly every alert category; a per-block or
        // per-peer alert stream costs CPU on a TV stick. Keep the ones it and
        // this class use (status, errors, storage, finished pieces).
        SettingsPack mask = new SettingsPack();
        mask.setInteger(settings_pack.int_types.alert_mask.swigValue(), alert.error_notification
            .or_(alert.status_notification)
            .or_(alert.storage_notification)
            .or_(alert.piece_progress_notification)
            .to_int());
        sm.applySettings(mask);
        session = sm;
        Log.i(TAG, "torrent: sesión de libtorrent iniciada");
    }

    /* --------------------------------------------------------------- start */

    static JSONObject start(JSONObject p) throws Exception {
        String hash = Js.text(Js.or(p.opt("infoHash"), "")).toLowerCase(Locale.ROOT);
        if (!HASH.matcher(hash).matches()) throw new PortalException("El torrent no es válido");
        Integer fileIdx = fileIndex(p.opt("fileIdx"));
        String key = hash + ":" + (fileIdx == null ? "" : fileIdx);
        Job job;
        boolean fresh = false;
        Job playing = current;
        // A download of this same torrent gives way (libtorrent holds a
        // torrent once); it goes on when the stream stops. Outside the lock:
        // Downloads calls into this class with its own lock held.
        if (playing == null || !playing.key.equals(key) || playing.cancelled) Downloads.yieldTorrent(hash);
        synchronized (Torrents.class) {
            loadLib();
            if (root == null) throw new PortalException("El servicio de torrents no está listo");
            ensureServer();
            if (current != null && current.key.equals(key) && !current.cancelled) {
                job = current;
            } else {
                // Room for the read-ahead at least (the previous torrent's
                // cache, deleted a moment after it stops, counts as free).
                long free = Space.free(root);
                if (free >= 0 && current != null) free += treeSize(current.dir);
                if (free >= 0 && free < MIN_START_FREE) {
                    throw new PortalException("No hay espacio suficiente para ver este torrent: quedan "
                        + Space.human(free) + " libres y hacen falta unos " + Space.human(MIN_START_FREE)
                        + ". Borra descargas o datos de otras apps.");
                }
                stopLocked();
                ensureSession();
                String tok = token();
                job = new Job(key, hash, tok, new File(root, tok));
                current = job;
                fresh = true;
                try {
                    add(job, trackers(p.opt("sources")));
                } catch (Exception e) {
                    stopLocked();
                    throw e;
                }
                scheduleIdleCheck();
            }
        }
        if (fresh) {
            awaitMetadata(job, fileIdx);
        } else if (!job.done.await(READY_TIMEOUT_MS + 5000, TimeUnit.MILLISECONDS)) {
            throw new PortalException("No se encontraron fuentes para este torrent. Prueba con otra fuente.");
        }
        if (job.error != null) throw new PortalException(job.error);
        return describe(job);
    }

    private static void add(Job job, List<String> trackers) throws Exception {
        StringBuilder magnet = new StringBuilder("magnet:?xt=urn:btih:").append(job.hash);
        for (String tr : trackers) magnet.append("&tr=").append(URLEncoder.encode(tr, "UTF-8"));
        if (!job.dir.mkdirs() && !job.dir.isDirectory()) throw new PortalException("No se pudo preparar la caché del torrent");
        AddTorrentParams atp = AddTorrentParams.parseMagnetUri(magnet.toString());
        atp.setSavePath(job.dir.getAbsolutePath());
        // Not queued by libtorrent, and every file starts unwanted: only the
        // chosen video is downloaded once the metadata arrives.
        torrent_flags_t flags = atp.getFlags()
            .and_(TorrentFlags.AUTO_MANAGED.inv())
            .and_(TorrentFlags.PAUSED.inv())
            .or_(TorrentFlags.DEFAULT_DONT_DOWNLOAD);
        atp.setFlags(flags);
        error_code ec = new error_code();
        torrent_handle th = session.swig().add_torrent(atp.swig(), ec);
        if (ec.failed()) throw new PortalException("No se pudo abrir el torrent: " + ec.message());
        job.handle = new TorrentHandle(th);
        Log.i(TAG, "torrent: buscando " + job.hash + " con " + trackers.size() + " trackers");
    }

    /* Waits for the metadata, then picks and prioritises the file. */
    private static void awaitMetadata(Job job, Integer fileIdx) {
        String err = null;
        try {
            long deadline = System.currentTimeMillis() + READY_TIMEOUT_MS;
            TorrentInfo ti = null;
            while (ti == null) {
                if (job.cancelled) { err = "Se canceló la carga del torrent"; break; }
                TorrentHandle h = job.handle;
                if (h != null && h.isValid()) {
                    TorrentStatus st = h.status();
                    if (st.hasMetadata()) ti = h.torrentFile();
                    if (ti != null) break;
                }
                if (System.currentTimeMillis() > deadline) {
                    err = "No se encontraron fuentes para este torrent. Prueba con otra fuente.";
                    break;
                }
                Thread.sleep(250);
            }
            if (err == null) err = select(job, ti, fileIdx);
        } catch (InterruptedException e) {
            err = "Se canceló la carga del torrent";
        } catch (Throwable t) {
            Log.w(TAG, "torrent: " + t);
            err = "No se pudo abrir el torrent";
        }
        if (err != null) {
            job.error = err;
            synchronized (Torrents.class) {
                if (current == job) stopLocked();
            }
        }
        job.done.countDown();
    }

    /* The file the addon pointed at (fileIdx), or the biggest video file.
       Returns an error text, or null when the job is ready. */
    private static String select(Job job, TorrentInfo ti, Integer fileIdx) {
        FileStorage fs = ti.files();
        int n = fs.numFiles();
        int idx = -1;
        if (fileIdx != null && fileIdx >= 0 && fileIdx < n && !fs.padFileAt(fileIdx)) {
            idx = fileIdx;
        } else {
            long best = -1;
            for (int i = 0; i < n; i++) {
                if (fs.padFileAt(i) || !VIDEO_EXT.matcher(fs.fileName(i)).find()) continue;
                if (fs.fileSize(i) > best) { best = fs.fileSize(i); idx = i; }
            }
        }
        if (idx < 0) return "El torrent no tiene ningún vídeo";
        TorrentHandle h = job.handle;
        Priority[] prio = Priority.array(Priority.IGNORE, n);
        prio[idx] = Priority.DEFAULT;
        h.prioritizeFiles(prio);
        job.fileName = fs.fileName(idx);
        job.fileLength = fs.fileSize(idx);
        job.fileOffset = fs.fileOffset(idx);
        job.filePath = fs.filePath(idx, job.dir.getAbsolutePath());
        job.pieceLength = ti.pieceLength();
        int first = pieceAt(job, 0);
        job.firstPiece = first;
        job.lastPiece = pieceAt(job, Math.max(0, job.fileLength - 1));
        // Nothing wanted but the windows (below) and the container headers
        // first, then the index at the end (MP4 moov, MKV cues): the last
        // ~1 MB (at least 2 pieces, at most 8).
        Priority[] pieces = Priority.array(Priority.IGNORE, ti.numPieces());
        int tail = Math.max(2, Math.min(8, (1024 * 1024) / Math.max(1, job.pieceLength)));
        int[] all = new int[2 + tail];
        all[0] = first;
        all[1] = first + 1;
        for (int i = 0; i < tail; i++) all[2 + i] = job.lastPiece - i;
        int n2 = 0;
        int[] edges = new int[all.length];
        for (int e : all) {
            if (e < first || e > job.lastPiece || pieces[e] == Priority.TOP_PRIORITY) continue;
            pieces[e] = Priority.TOP_PRIORITY;
            edges[n2++] = e;
        }
        job.edges = Arrays.copyOf(edges, n2);
        h.prioritizePieces(pieces);
        // Within each priority level, pick pieces in file order.
        h.setFlags(TorrentFlags.SEQUENTIAL_DOWNLOAD);
        for (int i = 0; i < job.edges.length; i++) h.setPieceDeadline(job.edges[i], i * 250);
        long free = Space.free(job.dir);
        job.fits = free < 0 || free - FIT_MARGIN >= job.fileLength;
        // Until the player connects, the start of the file is where it reads.
        synchronized (job.raised) {
            for (int e : job.edges) job.raised.set(e);
            job.lingering = first;
            recompute(job, null, false);
        }
        job.ready = true;
        Log.i(TAG, "torrent: listo " + job.fileName + " (" + job.fileLength + " bytes, piezas de " + job.pieceLength
            + (job.fits ? "" : ", no cabe entero: libres " + free) + ")");
        return null;
    }

    private static JSONObject describe(Job job) {
        String name;
        try {
            name = URLEncoder.encode(job.fileName, "UTF-8").replace("+", "%20");
        } catch (Exception e) {
            name = "video";
        }
        String ext = extOf(job.fileName);
        return Js.o(
            "url", "http://127.0.0.1:" + server.port() + "/t/" + job.token + "/" + name,
            "name", job.fileName,
            "length", job.fileLength,
            "mime", MIME.containsKey(ext) ? MIME.get(ext) : "",
            "infoHash", job.hash,
            "fits", job.fits,
            "free", Space.free(root));
    }

    /* --------------------------------------------------------- stats, stop */

    static JSONObject stats() {
        Job j = current;
        if (j == null) return Js.o("active", false);
        long peers = 0, speed = 0, upload = 0, downloaded = 0;
        try {
            TorrentHandle h = j.handle;
            if (h != null && h.isValid()) {
                TorrentStatus st = h.status();
                peers = st.numPeers();
                speed = st.downloadPayloadRate();
                upload = st.uploadPayloadRate();
                downloaded = st.totalPayloadDownload();
            }
        } catch (Throwable ignored) { /* removed meanwhile */ }
        return Js.o(
            "active", true,
            "ready", j.ready,
            "name", j.ready ? j.fileName : "",
            "length", j.ready ? j.fileLength : 0,
            "peers", peers,
            "speed", speed,
            "upload", upload,
            "downloaded", downloaded,
            "fits", j.fits,
            "seconds", (System.currentTimeMillis() - j.started) / 1000);
    }

    static synchronized void stop() {
        stopLocked();
    }

    /* App closing: drop the torrent and the whole cache now. */
    static void shutdown() {
        final SessionManager s;
        synchronized (Torrents.class) {
            stopLocked();
            s = session;
            session = null;
            sessionUsers = 0;
            if (sessionShutdown != null) { sessionShutdown.cancel(false); sessionShutdown = null; }
        }
        timer.execute(() -> {
            if (s != null) {
                try { s.stop(); } catch (Throwable ignored) { /* closing */ }
            }
            if (root != null) deleteTree(root);
        });
    }

    private static void stopLocked() {
        Job j = current;
        current = null;
        if (idleCheck != null) { idleCheck.cancel(false); idleCheck = null; }
        if (j == null) return;
        j.cancelled = true;
        synchronized (j.pieceLock) { j.pieceLock.notifyAll(); }
        if (j.error == null && j.done.getCount() > 0) j.error = "Se canceló la carga del torrent";
        TorrentHandle h = j.handle;
        if (h != null && session != null) {
            try { session.remove(h, SessionHandle.DELETE_FILES); } catch (Throwable ignored) { /* already gone */ }
        }
        // libtorrent closes its files asynchronously: delete a moment later.
        final File dir = j.dir;
        timer.schedule(() -> deleteTree(dir), 3, TimeUnit.SECONDS);
        Log.i(TAG, "torrent: detenido " + j.hash);
        scheduleSessionShutdown();
        // A download that gave way to this stream may go on (off this lock).
        timer.execute(Downloads::wake);
    }

    /* ------------------------------------------------ shared with downloads */

    /* The session for a torrent download; release it when done. */
    static synchronized SessionManager acquireSession() throws PortalException {
        loadLib();
        ensureSession();
        sessionUsers++;
        return session;
    }

    static synchronized void releaseSession() {
        if (sessionUsers > 0) sessionUsers--;
        if (sessionUsers == 0 && current == null) scheduleSessionShutdown();
    }

    /* The info-hash being streamed, or null. */
    static String streamingHash() {
        Job j = current;
        return j == null || j.cancelled ? null : j.hash;
    }

    static synchronized String settledStreamingHash() {
        return streamingHash();
    }

    /* The volume of the torrent cache (ping -> storage). */
    static File cacheDir() {
        return root == null ? null : root.getParentFile();
    }

    private static long treeSize(File f) {
        if (f == null || !f.exists()) return 0;
        if (f.isFile()) return f.length();
        long sum = 0;
        File[] children = f.listFiles();
        for (int i = 0; children != null && i < children.length; i++) sum += treeSize(children[i]);
        return sum;
    }

    private static void scheduleIdleCheck() {
        if (idleCheck != null) idleCheck.cancel(false);
        idleCheck = timer.scheduleWithFixedDelay(() -> {
            synchronized (Torrents.class) {
                Job j = current;
                if (j != null && j.ready && System.currentTimeMillis() - j.lastRead > IDLE_STOP_MS) {
                    Log.i(TAG, "torrent: 10 min sin lecturas");
                    stopLocked();
                }
            }
        }, 60, 60, TimeUnit.SECONDS);
    }

    /* The session (DHT, listen sockets) stays a few minutes for a quick
       second torrent, then goes away with whatever is left in the cache. */
    private static void scheduleSessionShutdown() {
        if (sessionShutdown != null) sessionShutdown.cancel(false);
        sessionShutdown = timer.schedule(() -> {
            SessionManager s;
            synchronized (Torrents.class) {
                if (current != null || sessionUsers > 0 || session == null) return;
                s = session;
                session = null;
                sessionShutdown = null;
            }
            try { s.stop(); } catch (Throwable ignored) { /* closing */ }
            Log.i(TAG, "torrent: sesión de libtorrent cerrada");
            File[] left = root == null ? null : root.listFiles();
            for (int i = 0; left != null && i < left.length; i++) {
                Job j = current;
                if (j == null || !left[i].equals(j.dir)) deleteTree(left[i]);
            }
        }, SESSION_IDLE_MS, TimeUnit.MILLISECONDS);
    }

    /* ---------------------------------------------------------- HTTP server */

    /* GET /t/<token>/<name>: the selected file with Range support. */
    private static void serve(LocalServer.Exchange ex) throws IOException {
        String path = ex.path();
        Map<String, String> h = new LinkedHashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        // The page sends /media/abort to the last local server it used.
        if (path.startsWith("/media/abort")) {
            ex.send(204, h, null);
            return;
        }
        Matcher m = TOKEN_PATH.matcher(path);
        Job j = current;
        if (!m.find() || j == null || !j.ready || j.cancelled || !j.token.equals(m.group(1))) {
            h.put("Content-Type", "text/plain");
            ex.send(404, h, "Not found".getBytes(Crypto.UTF8));
            return;
        }
        long total = j.fileLength;
        long start = 0, end = total - 1;
        int status = 200;
        String rangeHeader = ex.header("range");
        Matcher r = RANGE.matcher(rangeHeader == null ? "" : rangeHeader.trim());
        if (r.matches()) {
            try {
                if (r.group(1).isEmpty() && !r.group(2).isEmpty()) {
                    start = Math.max(0, total - Long.parseLong(r.group(2)));
                } else {
                    start = r.group(1).isEmpty() ? 0 : Long.parseLong(r.group(1));
                    if (!r.group(2).isEmpty()) end = Math.min(total - 1, Long.parseLong(r.group(2)));
                }
            } catch (NumberFormatException e) {
                start = total;
            }
            if (start > end || start >= total) {
                h.put("Content-Range", "bytes */" + total);
                ex.send(416, h, null);
                return;
            }
            status = 206;
            h.put("Content-Range", "bytes " + start + "-" + end + "/" + total);
        }
        String ext = extOf(j.fileName);
        h.put("Accept-Ranges", "bytes");
        h.put("Content-Type", MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream");
        h.put("Cache-Control", "no-store");
        h.put("Content-Length", String.valueOf(end - start + 1));
        OutputStream out = ex.begin(status, h);
        if ("HEAD".equals(ex.method)) {
            out.flush();
            return;
        }
        j.lastRead = System.currentTimeMillis();
        stream(j, start, end, out);
    }

    /* Copies [start, end] of the file as its pieces arrive. Throws (and the
       connection closes) when the torrent stops or a piece never comes. */
    private static void stream(Job j, long start, long end, OutputStream out) throws IOException {
        byte[] buf = new byte[64 * 1024];
        RandomAccessFile file = null;
        long pos = start;
        int piece = -1;
        Reader me = new Reader();
        try {
            while (pos <= end) {
                int p = pieceAt(j, pos);
                if (p != piece) {
                    piece = p;
                    moveReader(j, me, p);
                    waitPiece(j, p);
                }
                long pieceEnd = (long) (piece + 1) * j.pieceLength - j.fileOffset;   // exclusive, file-relative
                long chunkEnd = Math.min(end + 1, pieceEnd);
                while (pos < chunkEnd) {
                    if (j.cancelled) throw new IOException("torrent detenido");
                    if (file == null) file = new RandomAccessFile(j.filePath, "r");
                    file.seek(pos);
                    int n = file.read(buf, 0, (int) Math.min(buf.length, chunkEnd - pos));
                    if (n <= 0) throw new IOException("lectura incompleta en " + pos);
                    out.write(buf, 0, n);
                    pos += n;
                    j.lastRead = System.currentTimeMillis();
                }
            }
            out.flush();
        } finally {
            closeReader(j, me);
            if (file != null) {
                try { file.close(); } catch (IOException ignored) { /* closed */ }
            }
        }
    }

    /* Pieces at top priority ahead of a reader. */
    private static int windowPieces(Job j) {
        return Math.max(4, Math.min(256, READAHEAD_BYTES / Math.max(1, j.pieceLength)));
    }

    /* Of those, the nearest ones also get a deadline (time-critical). */
    private static int urgentPieces(Job j) {
        return Math.max(2, Math.min(48, URGENT_BYTES / Math.max(1, j.pieceLength)));
    }

    /* Of the low-priority read-ahead, how many pieces: none when the volume
       runs low (the top window alone still plays). */
    private static int lowPieces(Job j) {
        long now = System.currentTimeMillis();
        if (now - j.freeAt > 5000) {
            j.free = Space.free(j.dir);
            j.freeAt = now;
        }
        if (j.free >= 0 && j.free < LOW_RESERVE_BYTES) return 0;
        return (int) Math.min(Integer.MAX_VALUE, LOW_READAHEAD_BYTES / Math.max(1, j.pieceLength));
    }

    /* Near the end of the file: a read of the container index, not a seek. */
    private static boolean inTail(Job j, int piece) {
        return (long) (j.lastPiece - piece) * j.pieceLength < TAIL_BYTES;
    }

    /* A reader moved to a new piece. A new reader that opens far from where
       the last one stopped is a seek: the old windows go so the new position
       gets all the bandwidth. */
    private static void moveReader(Job j, Reader r, int piece) {
        if (j.cancelled) return;
        synchronized (j.raised) {
            boolean seek = false;
            if (r.piece < 0) {
                j.readers.add(r);
                if (j.lingering >= 0 && !inTail(j, piece)) {
                    seek = Math.abs(piece - j.lingering) > windowPieces(j);
                    j.lingering = -1;   // this reader takes over
                }
            }
            r.piece = piece;
            recompute(j, r, seek);
        }
    }

    /* A reader closed. With no other reader open its windows stay (a
       paused player, a reconnect); a reader of the index never replaces the
       position where playback stopped. */
    private static void closeReader(Job j, Reader r) {
        if (j.cancelled) return;
        synchronized (j.raised) {
            if (!j.readers.remove(r) || r.piece < 0) return;
            if (!j.readers.isEmpty()) j.lingering = -1;
            else if (j.lingering < 0 || !inTail(j, r.piece)) j.lingering = r.piece;
            recompute(j, null, false);
        }
    }

    /* Top window then read-ahead after one position, within the file. */
    private static void window(Job j, int from, int ahead, int lowN, BitSet top, BitSet low) {
        int a = Math.max(from, j.firstPiece);
        int topEnd = (int) Math.min((long) j.lastPiece + 1, (long) a + ahead);
        if (a < topEnd) top.set(a, topEnd);
        int lowEnd = (int) Math.min((long) j.lastPiece + 1, (long) topEnd + lowN);
        if (topEnd < lowEnd) low.set(topEnd, lowEnd);
    }

    /* Applies the windows of every reader (and of the last closed one):
       top priority ahead of each, then the read-ahead at low priority, and
       everything else unwanted. Only changed pieces go to libtorrent. The
       reader that moved gets deadlines, nearest first (about 1 ms per KB),
       for the closest pieces. Lock: j.raised. */
    private static void recompute(Job j, Reader moved, boolean seek) {
        TorrentHandle h = j.handle;
        if (h == null || j.cancelled) return;
        int ahead = windowPieces(j);
        int lowN = lowPieces(j);
        BitSet top = new BitSet();
        BitSet low = new BitSet();
        for (int e : j.edges) top.set(e);
        for (int i = 0; i < j.readers.size(); i++) {
            int p = j.readers.get(i).piece;
            if (p >= 0) window(j, p, ahead, lowN, top, low);
        }
        if (j.lingering >= 0) window(j, j.lingering, ahead, lowN, top, low);
        low.andNot(top);
        try {
            if (seek) h.clearPieceDeadlines();
            BitSet drop = (BitSet) j.raised.clone();
            drop.or(j.low);
            drop.andNot(top);
            drop.andNot(low);
            for (int q = drop.nextSetBit(0); q >= 0; q = drop.nextSetBit(q + 1)) {
                if (!j.has(q)) h.piecePriority(q, Priority.IGNORE);
            }
            for (int q = top.nextSetBit(0); q >= 0; q = top.nextSetBit(q + 1)) {
                if (!j.raised.get(q) && !j.has(q)) h.piecePriority(q, Priority.TOP_PRIORITY);
            }
            for (int q = low.nextSetBit(0); q >= 0; q = low.nextSetBit(q + 1)) {
                if (!j.low.get(q) && !j.has(q)) h.piecePriority(q, Priority.LOW);
            }
            j.raised.clear();
            j.raised.or(top);
            j.low.clear();
            j.low.or(low);
            if (moved != null && moved.piece >= 0) {
                int urgent = urgentPieces(j);
                int step = Math.max(50, j.pieceLength / 1024);
                for (int i = 0; i < urgent && moved.piece + i <= j.lastPiece; i++) {
                    if (!j.has(moved.piece + i)) h.setPieceDeadline(moved.piece + i, i * step);
                }
            }
        } catch (Throwable ignored) { /* torrent removed meanwhile */ }
    }

    private static void waitPiece(Job j, int piece) throws IOException {
        long until = System.currentTimeMillis() + PIECE_WAIT_MS;
        while (true) {
            synchronized (j.pieceLock) {
                if (j.have.get(piece)) return;
                if (j.cancelled) throw new IOException("torrent detenido");
                try {
                    j.pieceLock.wait(300);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IOException("interrumpido");
                }
                if (j.have.get(piece)) return;
            }
            // Alerts can be dropped when the queue is full: ask libtorrent too.
            try {
                TorrentHandle h = j.handle;
                if (h != null && !j.cancelled && h.havePiece(piece)) {
                    j.markHave(piece);
                    return;
                }
            } catch (Throwable ignored) { /* removed meanwhile */ }
            j.lastRead = System.currentTimeMillis();
            if (System.currentTimeMillis() > until) throw new IOException("la pieza " + piece + " no llegó");
        }
    }

    /* ------------------------------------------------------------- helpers */

    private static int pieceAt(Job j, long filePos) {
        return (int) ((j.fileOffset + filePos) / j.pieceLength);
    }

    static Integer fileIndex(Object v) {
        if (Js.isNull(v)) return null;
        if (v instanceof Number) return ((Number) v).intValue();
        String s = Js.text(v).trim();
        if (s.isEmpty()) return null;
        try {
            return Integer.parseInt(s);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    static List<String> trackers(Object sources) {
        List<String> list = new ArrayList<>(Arrays.asList(DEFAULT_TRACKERS));
        JSONArray a = Js.arr(sources);
        for (int i = 0; a != null && i < a.length(); i++) {
            String s = Js.text(a.opt(i));
            if (s.regionMatches(true, 0, "tracker:", 0, 8)) {
                String tr = s.substring(8).trim();
                if (!tr.isEmpty() && !list.contains(tr)) list.add(tr);
            }
        }
        return list;
    }

    static String extOf(String name) {
        int dot = name == null ? -1 : name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    private static String token() {
        byte[] b = new byte[8];
        random.nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format(Locale.ROOT, "%02x", x));
        return sb.toString();
    }

    static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] children = f.listFiles();
        for (int i = 0; children != null && i < children.length; i++) deleteTree(children[i]);
        if (!f.delete() && f.exists()) Log.w(TAG, "torrent: no se pudo borrar " + f);
    }
}
