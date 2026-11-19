package com.techpoint.opentv.service;

import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/*
 * Port of service/video-hash.js: the OpenSubtitles hash of a video (size +
 * the first and last 64 KiB as 64-bit little-endian words, mod 2^64), so the
 * subtitles addon answers subtitles made for this exact file (in sync), as
 * Stremio does. Read with two Range requests (both must answer 206).
 */
final class VideoHash {
    private VideoHash() {}

    private static final int CHUNK = 65536;
    private static final int MAX_REDIRECTS = 5;
    private static final int MAX_CACHE = 50;
    private static final Pattern TOTAL = Pattern.compile("/(\\d+)\\s*$");

    private static final Map<String, JSONObject> cache = Collections.synchronizedMap(new LinkedHashMap<String, JSONObject>() {
        @Override protected boolean removeEldestEntry(Map.Entry<String, JSONObject> eldest) { return size() > MAX_CACHE; }
    });

    private static final class Part {
        final byte[] bytes;
        final long total;
        Part(byte[] bytes, long total) { this.bytes = bytes; this.total = total; }
    }

    /* videoHash(url, headers) -> { hash, size } */
    static JSONObject hash(String url, JSONObject headers) throws Exception {
        JSONObject hit = cache.get(url);
        if (hit != null) return new JSONObject(hit.toString());
        Part head = request(url, headers, "bytes=0-" + (CHUNK - 1));
        long size = head.total;
        if (size < CHUNK * 2L) throw new PortalException("archivo demasiado pequeño");
        Part tail = request(url, headers, "bytes=" + (size - CHUNK) + "-" + (size - 1));
        if (head.bytes.length < CHUNK || tail.bytes.length < CHUNK) throw new PortalException("lectura incompleta");
        JSONObject out = Js.o("hash", compute(head.bytes, tail.bytes, size), "size", size);
        cache.put(url, out);
        return new JSONObject(out.toString());
    }

    /* 16 lowercase hex chars; long arithmetic wraps mod 2^64 by itself. */
    static String compute(byte[] head, byte[] tail, long size) {
        long sum = size;
        sum += words(head);
        sum += words(tail);
        String hex = Long.toHexString(sum);
        StringBuilder sb = new StringBuilder(16);
        for (int i = hex.length(); i < 16; i++) sb.append('0');
        return sb.append(hex).toString();
    }

    private static long words(byte[] b) {
        long sum = 0;
        for (int i = 0; i + 8 <= b.length; i += 8) {
            long w = 0;
            for (int j = 7; j >= 0; j--) w = (w << 8) | (b[i + j] & 0xffL);
            sum += w;
        }
        return sum;
    }

    private static Part request(String url, JSONObject headers, String range) throws Exception {
        for (int redirects = 0; ; redirects++) {
            Http.Url u = Http.Url.parse(url);
            boolean secure = "https:".equals(u.protocol);
            if (u.hostname.isEmpty() || !(secure || "http:".equals(u.protocol))) throw new PortalException("Sin enlace");
            int defaultPort = secure ? 443 : 80;
            Http.Request r = new Http.Request();
            r.secure = secure;
            r.connectHost = Dnsx.prepare(u.hostname);
            if (r.connectHost.isEmpty()) r.connectHost = u.hostname;
            r.port = u.port.isEmpty() ? defaultPort : Integer.parseInt(u.port);
            r.tlsName = u.hostname;
            r.path = u.path;
            r.connectTimeout = 15000;
            r.readTimeout = 15000;
            if (headers != null) {
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    r.headers.put(k, Js.text(headers.opt(k)));
                }
            }
            r.headers.put("Range", range);
            r.headers.put("Host", u.host());
            Http.Response res;
            try {
                res = Http.execute(r);
            } catch (java.net.SocketTimeoutException e) {
                throw new PortalException("tiempo agotado");
            }
            try {
                if (res.status >= 300 && res.status < 400 && res.header("location") != null && redirects < MAX_REDIRECTS) {
                    url = Http.Url.resolve(url, res.header("location"));
                    continue;
                }
                if (res.status != 206) throw new PortalException("sin Range (" + res.status + ")");
                Matcher m = TOTAL.matcher(String.valueOf(res.header("content-range")));
                long total = m.find() ? Long.parseLong(m.group(1)) : 0;
                return new Part(readUpTo(res.body, CHUNK), total);
            } catch (java.net.SocketTimeoutException e) {
                throw new PortalException("tiempo agotado");
            } finally {
                // Never reuse: the server may send more than the range asked.
                res.abort();
            }
        }
    }

    private static byte[] readUpTo(InputStream in, int max) throws IOException {
        byte[] buf = new byte[max];
        int got = 0, n;
        while (got < max && (n = in.read(buf, got, max - got)) != -1) got += n;
        if (got == max) return buf;
        byte[] cut = new byte[got];
        System.arraycopy(buf, 0, cut, 0, got);
        return cut;
    }
}
