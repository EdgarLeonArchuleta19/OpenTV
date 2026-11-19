package com.techpoint.opentv.service;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.net.URLDecoder;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/*
 * The OpenTV service inside the Android app: the methods of service/index.js
 * on http://127.0.0.1:8910/<method>?<query>, the same contract the PC bridge
 * (adb reverse) offered, so the page (vodApi.devServiceUrl) is unchanged.
 *
 * Movies and series come from Stremio-compatible addons (the page talks to
 * them directly); this service only resolves the chosen source, hashes it
 * for subtitles and proxies subtitle files. Live TV comes from the viewer's
 * M3U lists.
 *
 * Torrents (torrentStart/Stats/Stop) run on libtorrent, see Torrents.java;
 * ping reports torrents=false on devices that cannot load it.
 *
 * Downloads (downloadStart/List/Action/Open) are in Downloads.java, app
 * updates from GitHub releases (appUpdate) in AppUpdate.java.
 *
 * ping also reports what the device can play (media, MediaCaps.java) and the
 * free space of the cache volume (storage), for choosing sources.
 *
 * Not on Android: netdiag (hidden on TVs) and the FFmpeg relay (ExoPlayer
 * plays MKV/MP4/WebM/TS/HLS itself; ping reports relayAvailable=false).
 */
public final class OpenTvService {
    private OpenTvService() {}

    private static final String TAG = "OpenTV";
    public static final int PORT = 8910;
    private static final String SERVICE_NAME = "com.techpoint.opentv.service";
    private static final String SERVICE_VERSION = "1.0.0";
    private static final long CALL_TIMEOUT_MS = 60000;

    private static boolean started;
    private static LocalServer bridge;
    private static final ExecutorService calls = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "opentv-call");
        t.setDaemon(true);
        return t;
    });

    /* Idempotent; call it off the main thread. */
    public static synchronized void start(Context context) {
        if (started) {
            // Opened again in the same process (e.g. after leaving with Back).
            Downloads.reopen();
            return;
        }
        MediaCaps.setContext(context);
        Tmdb.init(context);
        Torrents.init(context);
        AppUpdate.init(context);
        Downloads.init(context);
        try {
            Proxy.start();
            LocalServer s = new LocalServer("service", OpenTvService::handle);
            s.start(PORT);
            bridge = s;
            started = true;
            Log.i(TAG, "servicio en 127.0.0.1:" + PORT + ", proxy en :" + Proxy.port());
        } catch (IOException e) {
            // Port taken, e.g. by an "adb reverse tcp:8910" left from PC testing.
            Log.e(TAG, "no se pudo abrir 127.0.0.1:" + PORT + ": " + e.getMessage());
        }
        // After the server is up: the codec list takes a moment on a TV stick.
        MediaCaps.init(context);
    }

    /* The app is closing: the streamed torrent stops and its cache goes.
       Downloads that are running or queued go on under
       DownloadsForegroundService (they share the libtorrent session, so it
       stays until they end); with none, they stop and go on next time. */
    public static void shutdown() {
        if (Downloads.busy()) {
            Torrents.stop();
            return;
        }
        try { Downloads.close(); } catch (Throwable t) { Log.w(TAG, "descargas: " + t); }
        Torrents.shutdown();
    }

    /* Set by MainActivity: told when the viewer starts a new download (to
       ask for the notification permission the first time). */
    public static volatile Runnable onDownloadStart;

    static void downloadStarted() {
        Runnable r = onDownloadStart;
        if (r != null) {
            try { r.run(); } catch (Throwable t) { Log.w(TAG, "descargas: " + t); }
        }
    }

    /* ------------------------------------------------------------ the bridge */
    private static void handle(LocalServer.Exchange ex) throws IOException {
        Map<String, String> h = new LinkedHashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Access-Control-Allow-Headers", "*");
        h.put("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        if ("OPTIONS".equals(ex.method)) {
            ex.send(204, h, null);
            return;
        }
        String path = ex.path();
        final String method = path.replaceFirst("^/+", "");
        final JSONObject params = query(ex.target);
        long t0 = System.currentTimeMillis();
        JSONObject out;
        Future<JSONObject> f = calls.submit(() -> call(method, params));
        // torrentStart waits up to a minute for the metadata and then answers
        // with its own message; the page waits 75 s.
        long timeout = "torrentStart".equals(method) ? Torrents.READY_TIMEOUT_MS + 10000 : CALL_TIMEOUT_MS;
        try {
            out = f.get(timeout, TimeUnit.MILLISECONDS);
        } catch (java.util.concurrent.TimeoutException e) {
            f.cancel(true);
            out = Js.o("returnValue", false, "errorText", "El servicio no respondió. Revisa la conexión o vuelve a intentarlo.");
        } catch (Exception e) {
            Throwable c = e.getCause() != null ? e.getCause() : e;
            out = Js.o("returnValue", false, "errorText", String.valueOf(c.getMessage()));
        }
        if (out == null) out = Js.o("returnValue", false, "errorText", "Respuesta vacía");
        boolean failed = Boolean.FALSE.equals(out.opt("returnValue"));
        Log.i(TAG, method + " " + (System.currentTimeMillis() - t0) + "ms" + (failed ? " ERROR " + out.optString("errorText") : ""));
        h.put("Content-Type", "application/json; charset=utf-8");
        ex.send(200, h, out.toString().getBytes(Crypto.UTF8));
    }

    private static final Pattern NUMERIC = Pattern.compile("^-?\\d+(\\.\\d+)?$");

    /* Same conversion as the PC bridge: booleans, short numbers and JSON. */
    static Object parseValue(String v) {
        if ("true".equals(v)) return true;
        if ("false".equals(v)) return false;
        if (NUMERIC.matcher(v).matches() && v.length() < 16) {
            double d = Double.parseDouble(v);
            return Js.jsonNum(d);
        }
        if (v.startsWith("{") || v.startsWith("[")) {
            try { return Js.parse(v); } catch (Exception ignored) { /* text */ }
        }
        return v;
    }

    private static String decode(String s) {
        try {
            return URLDecoder.decode(s, "UTF-8");
        } catch (Exception e) {
            return s.replace('+', ' ');
        }
    }

    private static JSONObject query(String target) {
        JSONObject params = new JSONObject();
        int q = target.indexOf('?');
        if (q < 0) return params;
        for (String pair : target.substring(q + 1).split("&")) {
            if (pair.isEmpty()) continue;
            int eq = pair.indexOf('=');
            String k = decode(eq >= 0 ? pair.substring(0, eq) : pair);
            String v = decode(eq >= 0 ? pair.substring(eq + 1) : "");
            Js.put(params, k, parseValue(v));
        }
        return params;
    }

    /* ------------------------------------------------------------- methods */
    private static JSONObject ok(JSONObject payload) {
        JSONObject out = payload == null ? new JSONObject() : payload;
        Js.put(out, "returnValue", true);
        return out;
    }

    private static JSONObject fail(Exception err) {
        String text = err.getMessage() != null && !err.getMessage().isEmpty() ? err.getMessage() : err.toString();
        Object code = err instanceof PortalException && ((PortalException) err).portalCode != null
            ? ((PortalException) err).portalCode : (Object) 1;
        return Js.o("returnValue", false, "errorText", text, "errorCode", code);
    }

    static JSONObject call(String method, JSONObject p) {
        try {
            switch (method) {
                case "tmdb": return Tmdb.list(Js.text(Js.or(p.opt("list"), "")));
                case "ping": return ping();
                case "keepAlive": return Js.o("returnValue", true, "subscribed", false);
                case "heartbeat": return Js.o("returnValue", true, "alive", true, "proxyPort", Proxy.port(), "timestamp", System.currentTimeMillis());
                case "mediaDuration": return ok(MediaDuration.get(p.opt("durationId")));
                case "resolveExternal": return resolveExternal(p);
                case "videoHash": {
                    String url = Js.text(Js.or(p.opt("url"), ""));
                    if (!HTTP_URL.matcher(url).find()) throw new PortalException("Sin enlace");
                    return ok(VideoHash.hash(url, p.optJSONObject("headers")));
                }
                case "proxySubtitles": return proxySubtitles(p);
                // Torrents: libtorrent + a loopback Range server (Torrents.java).
                case "torrentStart": return ok(Torrents.start(p));
                case "torrentStats": return ok(Torrents.stats());
                case "torrentStop": Torrents.stop(); return ok(null);
                // Downloads: Downloads.java (same shapes as service/downloads.js).
                case "downloadStart": return ok(Downloads.start(p));
                case "downloadList": return ok(Downloads.list());
                case "downloadAction": return ok(Downloads.action(Js.text(p.opt("id")), Js.text(p.opt("action"))));
                case "downloadOpen": return ok(Downloads.open(Js.text(p.opt("id"))));
                case "appUpdate": {
                    JSONObject r = AppUpdate.call(p);
                    return r.has("returnValue") ? r : ok(r);
                }
                case "fetchM3u": {
                    if (!Js.truthy(p.opt("url"))) throw new PortalException("url requerida");
                    return ok(Js.o("channels", M3u.fetchM3u(Js.text(p.opt("url")))));
                }
                case "epg": return ok(Js.o("programmes", Epg.get(Js.text(p.opt("url")), p.opt("ids"))));
                case "resolveLive": {
                    if (!Js.truthy(p.opt("streamUrl"))) throw new PortalException("El canal no tiene enlace");
                    return ok(Js.o("url", p.opt("streamUrl"), "proxyPath", p.opt("streamUrl"), "isHls", true));
                }
                case "abortMedia":
                    try { Proxy.killActiveStreams(); } catch (Exception ignored) { /* best effort */ }
                    return Js.o("returnValue", true);
                default: return Js.o("returnValue", false, "errorText", "Operación no disponible");
            }
        } catch (Exception e) {
            return fail(e);
        }
    }

    /* storage: the cache volume (torrents); media: MediaCaps (cached). */
    private static JSONObject ping() {
        java.io.File cache = Torrents.cacheDir();
        return Js.o("returnValue", true, "service", SERVICE_NAME, "version", AppUpdate.versionName(),
            "versionCode", AppUpdate.versionCode(), "serviceVersion", SERVICE_VERSION,
            "proxyPort", Proxy.port(), "relayAvailable", false, "ffmpegPath", "", "relayPort", 0,
            "torrents", Torrents.supported(), "downloads", true,
            "storage", Js.o("free", cache == null ? -1 : Space.free(cache), "total", cache == null ? -1 : Space.total(cache)),
            "media", MediaCaps.get());
    }

    private static final Pattern HTTP_URL = Pattern.compile("^https?://", Pattern.CASE_INSENSITIVE);
    private static final Pattern HLS_NAME = Pattern.compile("\\.m3u8\\b",Pattern.CASE_INSENSITIVE);
    private static final int MAX_SUBTITLES = 60;

    /* resolveExternal({url, headers, name, notWebReady, duration}): a source
       chosen in the addon mode. ExoPlayer plays HLS, MP4, MKV, WebM and TS
       itself (it sniffs the container), so unlike Node there is no FFmpeg
       relay: the link goes as is, or through the proxy when it needs request
       headers. Same answer shape as the Node method. */
    private static JSONObject resolveExternal(JSONObject p) throws Exception {
        String url = Js.text(Js.or(p.opt("url"), ""));
        if (!HTTP_URL.matcher(url).find()) throw new PortalException("La fuente no tiene un enlace http(s) válido");
        JSONObject headers = p.optJSONObject("headers");
        if (headers == null) headers = new JSONObject();
        boolean hasHeaders = headers.length() > 0;
        String name = Js.text(Js.or(p.opt("name"), "")) + " " + url.split("\\?", 2)[0];
        if (HLS_NAME.matcher(name).find()) {
            String mime = "application/vnd.apple.mpegurl";
            if (!hasHeaders) return ok(Js.o("url", url, "proxyPath", url, "isHls", true, "mime", mime));
            Proxy.start();
            String token = Proxy.add(url, headers, 0, "", null);
            return ok(Js.o("url", url, "proxyPath", Proxy.baseUrl() + "/media/" + token + "/stream.m3u8", "isHls", true, "mime", mime));
        }
        double duration = MediaDuration.seconds(p.opt("duration"));
        JSONObject stream = Js.o("url", url, "headers", headers, "duration", Js.jsonNum(duration));
        JSONObject out = Js.o("url", url, "mime", "video/mp4", "isHls", false, "durationId", MediaDuration.register(stream));
        if (!hasHeaders) {
            Js.put(out, "proxyPath", url);
            return ok(out);
        }
        Proxy.start();
        String token = Proxy.add(url, headers, duration, "", null);
        Js.put(out, "proxyPath", Proxy.baseUrl() + "/media/" + token + "/stream.mp4");
        return ok(out);
    }

    /* proxySubtitles({subtitles:[{lang, url}]}): subtitle files from an addon
       (no CORS upstream), served through the loopback proxy. */
    private static JSONObject proxySubtitles(JSONObject p) throws Exception {
        JSONArray list = p.optJSONArray("subtitles");
        JSONArray out = new JSONArray();
        Proxy.start();
        for (int i = 0; list != null && i < list.length() && out.length() < MAX_SUBTITLES; i++) {
            JSONObject s = list.optJSONObject(i);
            if (s == null) continue;
            String url = Js.text(Js.or(s.opt("url"), ""));
            if (!HTTP_URL.matcher(url).find()) continue;
            out.put(Js.o("lang", Js.text(Js.or(s.opt("lang"), "")), "format", "srt", "url", Proxy.addSubtitle(url)));
        }
        return ok(Js.o("subtitles", out));
    }
}
