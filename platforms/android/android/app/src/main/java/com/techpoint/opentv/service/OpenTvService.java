package com.techpoint.opentv.service;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.net.URLDecoder;
import java.util.LinkedHashMap;
import java.util.List;
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
 * Not on Android: netdiag (hidden on TVs) and the FFmpeg relay. resolve and
 * resolveSmooth both answer with the proxied stream; ping reports
 * relayAvailable=false.
 */
public final class OpenTvService {
    private OpenTvService() {}

    private static final String TAG = "OpenTV";
    public static final int PORT = 8910;
    private static final String SERVICE_NAME = "com.webosflux.xuptertv.fidelity.service";
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
        if (started) return;
        Tmdb.init(context);
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
        try {
            out = f.get(CALL_TIMEOUT_MS, TimeUnit.MILLISECONDS);
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
                case "ping": return Js.o("returnValue", true, "service", SERVICE_NAME, "version", SERVICE_VERSION,
                    "portalHosts", "magis", "proxyPort", Proxy.port(), "relayAvailable", false, "ffmpegPath", "", "relayPort", 0);
                case "keepAlive": return Js.o("returnValue", true, "subscribed", false);
                case "heartbeat": return Js.o("returnValue", true, "alive", true, "proxyPort", Proxy.port(), "timestamp", System.currentTimeMillis());
                case "home": return ok(Magis.home(Js.text(Js.or(p.opt("root"), "movies"))));
                case "search": return ok(Magis.search(Js.or(p.opt("value"), ""), p.opt("pageNum"), p.opt("pageSize")));
                case "detail": return ok(Magis.detail(p.opt("contentId")));
                case "mediaDuration": return ok(MediaDuration.get(p.opt("durationId")));
                // No FFmpeg relay on Android: smooth mode gets the proxied stream.
                case "resolve":
                case "resolveSmooth": return resolveStream(p);
                case "mediaInfo": return ok(attachSubtitles(Magis.mediaInfo(p.opt("contentId"), p.opt("seriesContentId"))));
                case "liveChannels": {
                    Object[] r = Magis.getLiveChannels(p.opt("columnId"), p.opt("pageNum"), p.opt("pageSize"));
                    return ok(Js.o("channels", r[0], "pageNum", Math.max(1, Js.intOr(p.opt("pageNum"), 1)), "hasMore", r[1]));
                }
                case "liveCategories": return ok(Js.o("categories", Magis.getLiveCategories()));
                case "fetchM3u": {
                    if (!Js.truthy(p.opt("url"))) throw new PortalException("url requerida");
                    return ok(Js.o("channels", Magis.fetchM3u(Js.text(p.opt("url")))));
                }
                case "resolveLive": return resolveLive(p);
                case "abortMedia":
                    try { Proxy.killActiveStreams(); } catch (Exception ignored) { /* best effort */ }
                    return Js.o("returnValue", true);
                case "prewarm": {
                    Magis.Session s = Magis.ensureSession();
                    return Js.o("returnValue", true, "sn", s.sn, "userId", s.userId);
                }
                default: return Js.o("returnValue", false, "errorText", "Operación no disponible");
            }
        } catch (Exception e) {
            return fail(e);
        }
    }

    /* Subtitle files live on a CDN without CORS headers: hand the page
       loopback URLs instead. */
    private static JSONObject attachSubtitles(JSONObject payload) {
        JSONArray subs = payload.optJSONArray("subtitles");
        if (subs == null || subs.length() == 0) return payload;
        JSONArray out = new JSONArray();
        for (int i = 0; i < subs.length(); i++) {
            JSONObject sub = subs.optJSONObject(i);
            if (sub == null) continue;
            out.put(Js.o("lang", sub.opt("lang"), "format", sub.opt("format"), "url", Proxy.addSubtitle(sub.optString("url"))));
        }
        Js.put(payload, "subtitles", out);
        return payload;
    }

    private static String firstIp(String host) {
        try {
            List<String> ips = Dnsx.resolve(host).ips;
            return ips.isEmpty() ? "" : ips.get(0);
        } catch (IOException e) {
            return "";
        }
    }

    private static JSONObject resolveStream(JSONObject p) throws Exception {
        JSONObject stream = Magis.resolve(p.opt("contentId"), p.opt("seriesContentId"), p.opt("trackIndex"), p.opt("preferHeight"));
        if (!Pattern.compile("^https?://", Pattern.CASE_INSENSITIVE).matcher(stream.optString("url")).find()) {
            throw new PortalException("El portal no devolvió un enlace de vídeo válido");
        }
        double duration = MediaDuration.seconds(stream.opt("duration"));
        if (duration == 0) duration = MediaDuration.seconds(p.opt("duration"));
        Js.put(stream, "duration", Js.jsonNum(duration));
        Js.put(stream, "durationId", MediaDuration.register(stream));
        String resolvedIp = firstIp(Http.Url.parse(stream.optString("url")).hostname);
        Proxy.start();
        String token = Proxy.add(stream.optString("url"), stream.optJSONObject("headers"), duration, resolvedIp, null);
        String extension = "video/mp4".equals(stream.optString("mime")) ? "mp4" : "ts";
        Js.put(stream, "proxyPath", Proxy.baseUrl() + "/media/" + token + "/stream." + extension);
        Js.put(stream, "isHls", false);
        attachSubtitles(stream);
        return ok(stream);
    }

    private static JSONObject resolveLive(JSONObject p) throws Exception {
        if (Js.truthy(p.opt("streamUrl"))) {
            return ok(Js.o("url", p.opt("streamUrl"), "proxyPath", p.opt("streamUrl"), "isHls", true));
        }
        if (!Js.truthy(p.opt("channelCode"))) throw new PortalException("channelCode requerido");
        JSONObject stream = Magis.resolveLive(p.opt("channelCode"));
        String resolvedIp = firstIp(Http.Url.parse(stream.optString("url")).hostname);
        Proxy.start();
        String token = Proxy.add(stream.optString("url"), stream.optJSONObject("headers"), 0, resolvedIp, stream.optJSONArray("backupUrls"));
        Js.put(stream, "proxyPath", Proxy.baseUrl() + "/media/" + token + "/stream.m3u8");
        Js.put(stream, "isHls", true);
        return ok(stream);
    }
}
