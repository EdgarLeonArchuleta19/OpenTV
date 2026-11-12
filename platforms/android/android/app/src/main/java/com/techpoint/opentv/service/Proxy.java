package com.techpoint.opentv.service;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.SocketTimeoutException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/*
 * Loopback media proxy, port of service/proxy.js (same routes, so the page
 * and hls.js work unchanged):
 *   /media/<token>/stream.(mp4|ts|m3u8)   the title, with the portal headers
 *   /hls/<token>/<base64url>              children of a rewritten playlist
 *   /sub/<token>.srt                       subtitle files (no CORS on the CDN)
 *   /media/abort                           drop every upstream stream
 *
 * The CDN only serves a title with Content-Auth / Content-License headers
 * that a <video> element cannot set; this server replays the request with
 * them. Tokens live in memory only.
 */
final class Proxy {
    private Proxy() {}

    private static final String TAG = "OpenTV";
    private static final int MAX_TOKENS = 6;
    private static final int MAX_SUBTITLES = 12;
    private static final int HLS_SEGMENT_SECONDS = 10;

    static final class Entry {
        volatile String url;
        List<String> backupUrls = new ArrayList<>();
        int backupIndex;
        Map<String, String> headers = new LinkedHashMap<>();
        double duration;
        long contentLength;
        volatile String resolvedIp = "";
        TsIndexer indexer;
    }

    private static final class Record {
        final LocalServer.Exchange ex;
        volatile Http.Call call;
        volatile Http.Response up;
        volatile boolean killed;
        Record(LocalServer.Exchange ex) { this.ex = ex; }
    }

    private static final Map<String, Entry> tokens = lru(MAX_TOKENS);
    private static final Map<String, Entry> subtitleTokens = lru(MAX_SUBTITLES);
    private static final List<Record> activeUpstreams = Collections.synchronizedList(new ArrayList<Record>());
    private static String activeToken;
    private static LocalServer server;

    private static Map<String, Entry> lru(final int max) {
        return Collections.synchronizedMap(new LinkedHashMap<String, Entry>() {
            @Override protected boolean removeEldestEntry(java.util.Map.Entry<String, Proxy.Entry> eldest) { return size() > max; }
        });
    }

    static synchronized void start() throws IOException {
        if (server != null) return;
        LocalServer s = new LocalServer("proxy", Proxy::handle);
        s.start(0);
        server = s;
    }

    static int port() {
        return server == null ? 0 : server.port();
    }

    static String baseUrl() {
        return port() != 0 ? "http://127.0.0.1:" + port() : "";
    }

    static void killActiveStreams() {
        List<Record> copy;
        synchronized (activeUpstreams) {
            copy = new ArrayList<>(activeUpstreams);
            activeUpstreams.clear();
        }
        for (Record r : copy) destroy(r);
    }

    private static void destroy(Record r) {
        r.killed = true;
        Http.Call c = r.call;
        if (c != null) c.cancel();
        Http.Response up = r.up;
        if (up != null) up.abort();
        r.ex.abort();
    }

    private static boolean isCacheFlyIp(String ip) {
        return ip != null && (ip.startsWith("66.225.") || ip.startsWith("205.234.") || ip.startsWith("167.99."));
    }

    private static final Pattern CACHEFLY_HOSTS = Pattern.compile("swzablvpm|kyalbhxgw|m3x8o50te|qnrgmzpcw|faolmbghu", Pattern.CASE_INSENSITIVE);

    private static String resolveHostIp(Entry entry) {
        if (entry == null) return "";
        if (!entry.resolvedIp.isEmpty() && Dnsx.isIpv4(entry.resolvedIp)) return entry.resolvedIp;
        String host = Http.Url.parse(entry.url).hostname;
        if (host.isEmpty() || Dnsx.isIpv4(host)) {
            entry.resolvedIp = host;
            return host;
        }
        Dnsx.Result hit = Dnsx.cached(host);
        if (hit != null && !hit.ips.isEmpty()) {
            entry.resolvedIp = Dnsx.dial(host, hit.ips);
            return entry.resolvedIp;
        }
        try {
            Dnsx.Result res = Dnsx.resolve(host);
            entry.resolvedIp = res.ips.isEmpty() ? host : Dnsx.dial(host, res.ips);
        } catch (IOException e) {
            entry.resolvedIp = host;
        }
        return entry.resolvedIp;
    }

    static String add(String target, JSONObject headers, double duration, String resolvedIp, JSONArray backupUrls) {
        String token = Crypto.randomHex(12);
        final Entry entry = new Entry();
        entry.url = target;
        for (int i = 0; backupUrls != null && i < backupUrls.length(); i++) entry.backupUrls.add(backupUrls.optString(i));
        if (headers != null) {
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                entry.headers.put(k, Js.text(headers.opt(k)));
            }
        }
        entry.duration = duration;
        entry.resolvedIp = resolvedIp == null ? "" : resolvedIp;
        tokens.put(token, entry);

        final String host = Http.Url.parse(target).hostname;
        if (!host.isEmpty() && !Dnsx.isIpv4(host) && entry.resolvedIp.isEmpty()) {
            Dnsx.Result hit = Dnsx.cached(host);
            if (hit != null && !hit.ips.isEmpty()) entry.resolvedIp = Dnsx.dial(host, hit.ips);
            new Thread(() -> {
                try {
                    Dnsx.Result res = Dnsx.resolve(host);
                    if (!res.ips.isEmpty()) entry.resolvedIp = Dnsx.dial(host, res.ips);
                } catch (IOException ignored) { /* keep what we had */ }
            }, "opentv-dns-warm").start();
        }
        return token;
    }

    /* A loopback URL the page can XHR for a subtitle file. */
    static String addSubtitle(String target) {
        String token = Crypto.randomHex(12);
        Entry e = new Entry();
        e.url = target;
        subtitleTokens.put(token, e);
        return baseUrl() + "/sub/" + token + ".srt";
    }

    private static Map<String, String> plain() {
        Map<String, String> h = new LinkedHashMap<>();
        h.put("Content-Type", "text/plain");
        h.put("Access-Control-Allow-Origin", "*");
        return h;
    }

    private static void text(LocalServer.Exchange ex, int status, String body) throws IOException {
        ex.send(status, plain(), body.getBytes(Crypto.UTF8));
    }

    private static void sendSubtitle(LocalServer.Exchange ex, Entry entry) throws IOException {
        String ip = resolveHostIp(entry);
        Http.Url u = Http.Url.parse(entry.url);
        boolean secure = "https:".equals(u.protocol);
        Http.Request r = new Http.Request();
        r.secure = secure;
        r.connectHost = ip.isEmpty() ? u.hostname : ip;
        r.port = u.port.isEmpty() ? (secure ? 443 : 80) : Integer.parseInt(u.port);
        r.tlsName = u.hostname;
        r.path = u.path;
        r.connectTimeout = 20000;
        r.readTimeout = 20000;
        r.headers.put("User-Agent", Magis.UA_CDN);
        r.headers.put("Accept", "*/*");
        r.headers.put("Host", u.host());
        byte[] body;
        int status;
        try {
            Http.Response res = Http.execute(r);
            try {
                status = res.status;
                body = res.readAll(32L << 20);
            } finally {
                res.close();
            }
        } catch (IOException e) {
            text(ex, 502, "subtitle upstream error");
            return;
        }
        Map<String, String> h = new LinkedHashMap<>();
        h.put("Content-Type", "text/plain; charset=utf-8");
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Cache-Control", "private, max-age=300");
        ex.send(status >= 200 && status < 300 ? 200 : 502, h, body);
    }

    private static Http.Request mediaRequest(Entry entry, String method, Map<String, String> extra, String resolvedIp) {
        Http.Url u = Http.Url.parse(entry.url);
        String host = u.hostname;
        String connectHost = resolvedIp != null && !resolvedIp.isEmpty() ? resolvedIp : entry.resolvedIp;
        if (connectHost.isEmpty() && !host.isEmpty()) {
            Dnsx.Result hit = Dnsx.cached(host);
            if (hit != null && !hit.ips.isEmpty()) {
                connectHost = Dnsx.dial(host, hit.ips);
                entry.resolvedIp = connectHost;
            }
        }
        if (connectHost.isEmpty()) connectHost = host;
        boolean secure = "https:".equals(u.protocol);
        // Carriers that inspect plain port-80 Host headers (Chile) block the
        // streams; the CacheFly CDNs also answer on HTTPS, which hides them.
        boolean isCacheFly = isCacheFlyIp(connectHost) || CACHEFLY_HOSTS.matcher(host).find();
        if (isCacheFly) secure = true;
        Http.Request r = new Http.Request();
        r.method = method;
        r.secure = secure;
        r.connectHost = connectHost;
        int defaultPort = secure ? 443 : 80;
        r.port = secure && "80".equals(u.port) ? 443 : (u.port.isEmpty() ? defaultPort : Integer.parseInt(u.port));
        // Their certificate is *.cachefly.net, not the CDN's own name.
        r.tlsName = isCacheFly ? "cachefly.net" : host;
        r.path = u.path;
        r.headers.putAll(entry.headers);
        if (extra != null) r.headers.putAll(extra);
        r.headers.put("Host", u.host());
        return r;
    }

    private static long sourceLength(Entry entry) throws IOException {
        synchronized (entry) {
            if (entry.contentLength > 0) return entry.contentLength;
            Map<String, String> range = new LinkedHashMap<>();
            range.put("Range", "bytes=0-0");
            Http.Request r = mediaRequest(entry, "GET", range, resolveHostIp(entry));
            r.readTimeout = 15000;
            Http.Response up = Http.execute(r);
            long length;
            try {
                Matcher m = Pattern.compile("/(\\d+)$").matcher(String.valueOf(up.header("content-range")));
                Long cl = Js.parseInt(up.header("content-length"));
                length = m.find() ? Long.parseLong(m.group(1)) : (cl == null ? 0 : cl);
                up.readAll(1 << 20);
            } finally {
                up.close();
            }
            if (length <= 0) throw new IOException("el CDN no informó el tamaño");
            entry.contentLength = length;
            return length;
        }
    }

    private static byte[] readRange(Entry entry, long start, long end) throws Exception {
        Map<String, String> range = new LinkedHashMap<>();
        range.put("Range", "bytes=" + start + "-" + end);
        Http.Request r = mediaRequest(entry, "GET", range, resolveHostIp(entry));
        r.readTimeout = 25000;
        Http.Response up = Http.execute(r);
        try {
            byte[] body = up.readAll(64L << 20);
            if (up.status < 200 || up.status >= 300) throw new IOException("rango rechazado");
            return body;
        } finally {
            up.close();
        }
    }

    private static void sendVirtualHls(LocalServer.Exchange ex, final Entry entry) throws IOException {
        long length;
        try {
            length = sourceLength(entry);
        } catch (IOException e) {
            text(ex, 502, "no se pudo crear el manifiesto HLS");
            return;
        }
        TsIndexer indexer;
        synchronized (entry) {
            if (entry.indexer == null) {
                entry.indexer = new TsIndexer(length, (s, e) -> readRange(entry, s, e));
                entry.indexer.start();
            }
            indexer = entry.indexer;
        }
        List<TsIndexer.Segment> segments;
        try {
            segments = indexer.snapshot(true);
        } catch (InterruptedException e) {
            throw new IOException("interrumpido");
        }
        StringBuilder sb = new StringBuilder();
        sb.append("#EXTM3U\n#EXT-X-VERSION:4\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-TARGETDURATION:").append(HLS_SEGMENT_SECONDS)
            .append("\n#EXT-X-MEDIA-SEQUENCE:0");
        for (TsIndexer.Segment s : segments) {
            sb.append("\n#EXTINF:").append(String.format(Locale.US, "%.3f", s.duration)).append(',');
            sb.append("\n#EXT-X-BYTERANGE:").append(s.end - s.start + 1).append('@').append(s.start);
            sb.append("\nstream.ts");
        }
        if (indexer.complete) sb.append("\n#EXT-X-ENDLIST");
        sb.append('\n');
        Map<String, String> h = new LinkedHashMap<>();
        h.put("Content-Type", "application/vnd.apple.mpegurl");
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Cache-Control", "no-store");
        ex.send(200, h, sb.toString().getBytes(Crypto.UTF8));
    }

    /* HLS players resolve a playlist's relative segment, key and nested
       playlist URLs against the loopback manifest URL, and those requests
       need the portal headers too: rewrite every URI to a local route. */
    private static String hlsChildUrl(String token, String manifestUrl, String reference) {
        if (reference == null || reference.isEmpty() || reference.startsWith("data:")) return reference;
        return baseUrl() + "/hls/" + token + "/" + Crypto.base64Url(Http.Url.resolve(manifestUrl, reference));
    }

    private static final Pattern URI_ATTR = Pattern.compile("URI=(\"|')([^\"']+)\\1");

    static String rewriteHlsManifest(String body, String token, String manifestUrl) {
        String[] lines = (body == null ? "" : body).replaceFirst("^﻿", "").split("\\r?\\n", -1);
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            if (line.isEmpty()) continue;
            if (line.charAt(0) != '#') {
                lines[i] = hlsChildUrl(token, manifestUrl, line);
            } else if (line.contains("URI=")) {
                Matcher m = URI_ATTR.matcher(line);
                StringBuffer sb = new StringBuffer();
                while (m.find()) {
                    String rep = "URI=" + m.group(1) + hlsChildUrl(token, manifestUrl, m.group(2)) + m.group(1);
                    m.appendReplacement(sb, Matcher.quoteReplacement(rep));
                }
                m.appendTail(sb);
                lines[i] = sb.toString();
            }
        }
        return android.text.TextUtils.join("\n", lines);
    }

    private static void forward(LocalServer.Exchange ex, Entry entry, String token) throws IOException {
        // A different title: drop every previous video stream at once.
        synchronized (Proxy.class) {
            if (!token.equals(activeToken)) {
                killActiveStreams();
                activeToken = token;
            }
        }
        Map<String, String> range = new LinkedHashMap<>();
        if (ex.header("range") != null) range.put("Range", ex.header("range"));
        if (ex.header("if-range") != null) range.put("If-Range", ex.header("if-range"));

        String ip = resolveHostIp(entry);
        boolean head = "HEAD".equals(ex.method);
        Http.Request req = mediaRequest(entry, head ? "HEAD" : "GET", range, ip);
        req.readTimeout = 25000;   // headers must arrive within 25 s
        Record record = new Record(ex);
        activeUpstreams.add(record);
        Http.Response up = null;
        try {
            Http.Call call = new Http.Call();
            record.call = call;
            try {
                up = call.execute(req);
            } catch (SocketTimeoutException e) {
                if (!ex.committed && !record.killed) text(ex, 504, "gateway timeout");
                return;
            } catch (IOException uErr) {
                if (record.killed) return;
                String h = Http.Url.parse(entry.url).hostname;
                Dnsx.Result hit = Dnsx.cached(h);
                if (hit != null && hit.ips.size() > 1) entry.resolvedIp = Dnsx.dial(h, hit.ips);
                if (!ex.committed && entry.backupIndex < entry.backupUrls.size()) {
                    String nextUrl = entry.backupUrls.get(entry.backupIndex++);
                    Log.i(TAG, "proxy: upstream falló (" + uErr.getMessage() + "), reintentando con CDN alternativa");
                    entry.url = nextUrl;
                    entry.resolvedIp = "";
                    activeUpstreams.remove(record);
                    forward(ex, entry, token);
                    return;
                }
                if (!ex.committed) text(ex, 502, "upstream error");
                return;
            }
            record.up = up;
            if (record.killed) { up.abort(); return; }

            String rawMime = String.valueOf(up.header("content-type")).toLowerCase(Locale.ROOT);
            if (up.header("content-type") == null) rawMime = "";
            String contentType = "video/mp2t";
            if (rawMime.contains("mp4")) contentType = "video/mp4";
            else if (rawMime.contains("mpegurl") || (entry.url != null && entry.url.contains(".m3u8"))) contentType = "application/vnd.apple.mpegurl";
            boolean isM3u8 = "application/vnd.apple.mpegurl".equals(contentType);

            Map<String, String> out = new LinkedHashMap<>();
            out.put("Content-Type", contentType);
            out.put("Accept-Ranges", up.header("accept-ranges") != null ? up.header("accept-ranges") : "bytes");
            out.put("Access-Control-Allow-Origin", "*");
            // Loopback-only: a short private cache allows normal read-ahead.
            out.put("Cache-Control", isM3u8 ? "no-cache, no-store" : "private, max-age=120");
            if (up.header("content-length") != null) out.put("Content-Length", up.header("content-length"));
            if (up.header("content-range") != null) out.put("Content-Range", up.header("content-range"));
            int status = up.status == 0 ? 200 : up.status;

            if (head) {
                ex.begin(status, out).flush();
                return;
            }
            if (isM3u8) {
                byte[] raw = up.readAll(16L << 20);
                String body = rewriteHlsManifest(new String(raw, Crypto.UTF8), token, entry.url);
                out.remove("Content-Range");
                ex.send(status, out, body.getBytes(Crypto.UTF8));
                return;
            }
            // Video bytes: no idle limit from Node, but a dead CDN socket
            // must not hold this thread forever.
            up.setReadTimeout(60000);
            OutputStream o = ex.begin(status, out);
            InputStream in = up.body;
            byte[] buf = new byte[65536];
            int n;
            while (!record.killed && (n = in.read(buf)) != -1) {
                o.write(buf, 0, n);
            }
            o.flush();
        } catch (IOException e) {
            // Client gone or upstream broke mid-body: close both sides.
            if (up != null) up.abort();
            ex.abort();
        } finally {
            activeUpstreams.remove(record);
            if (up != null) up.close();
        }
    }

    private static final Pattern SUB = Pattern.compile("^/sub/([a-f0-9]{24})\\.srt$");
    private static final Pattern HLS = Pattern.compile("^/hls/([a-f0-9]{24})/([A-Za-z0-9_-]+)$");
    private static final Pattern MEDIA = Pattern.compile("^/media/([a-f0-9]{24})(?:/([^?#]*))?(?:[?#].*)?$");

    private static void handle(LocalServer.Exchange ex) throws IOException {
        if ("OPTIONS".equals(ex.method)) {
            Map<String, String> h = new LinkedHashMap<>();
            h.put("Access-Control-Allow-Origin", "*");
            h.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
            h.put("Access-Control-Allow-Headers", "Range");
            ex.send(204, h, null);
            return;
        }
        String url = ex.target;
        if ("/media/abort".equals(url)) {
            killActiveStreams();
            synchronized (Proxy.class) { activeToken = null; }
            text(ex, 200, "aborted");
            return;
        }
        Matcher sub = SUB.matcher(url);
        if (sub.matches()) {
            Entry e = subtitleTokens.get(sub.group(1));
            if (e == null) { text(ex, 410, "expired"); return; }
            sendSubtitle(ex, e);
            return;
        }
        Matcher hls = HLS.matcher(url.split("\\?", -1)[0]);
        if (hls.matches()) {
            Entry parent = tokens.get(hls.group(1));
            if (parent == null) { text(ex, 410, "expired"); return; }
            String childUrl = Crypto.fromBase64Url(hls.group(2));
            if (!Pattern.compile("^https?://", Pattern.CASE_INSENSITIVE).matcher(childUrl).find()) {
                text(ex, 400, "invalid hls child");
                return;
            }
            Entry child = new Entry();
            child.url = childUrl;
            child.headers = parent.headers;
            child.backupUrls = parent.backupUrls;
            child.backupIndex = parent.backupIndex;
            forward(ex, child, hls.group(1));
            return;
        }
        Matcher m = MEDIA.matcher(url);
        if (!m.matches()) { text(ex, 404, "not found"); return; }
        String token = m.group(1);
        String subpath = m.group(2) == null ? "" : m.group(2);
        Entry entry = tokens.get(token);
        if (entry == null) { text(ex, 410, "expired"); return; }
        if (!entry.url.contains(".m3u8") && subpath.contains(".m3u8")) {
            sendVirtualHls(ex, entry);
            return;
        }
        forward(ex, entry, token);
    }
}
