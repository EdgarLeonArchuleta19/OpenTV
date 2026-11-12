package com.techpoint.opentv.service;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URLEncoder;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/*
 * TMDB trending lists, port of service/tmdb.js. The key comes from the
 * app's assets/tmdb.bin, which scripts/build-android.cjs encrypts from the
 * git-ignored config/tmdb.json; it never reaches the page or the log.
 *
 * This product uses the TMDB API but is not endorsed or certified by TMDB.
 */
final class Tmdb {
    private Tmdb() {}

    private static final long CACHE_MS = 6 * 60 * 60 * 1000;
    private static final int PAGES = 2;
    private static final String[][] LISTS = {
        {"movie-week", "/trending/movie/week"},
        {"tv-week", "/trending/tv/week"},
        {"movie-top", "/movie/top_rated"},
        {"tv-top", "/tv/top_rated"},
        // Kids and Anime sections: what is popular right now in those genres.
        {"kids-movie", "/discover/movie?with_genres=10751&sort_by=popularity.desc&include_adult=false"},
        {"kids-tv", "/discover/tv?with_genres=10762&sort_by=popularity.desc"},
        {"anime-tv", "/discover/tv?with_genres=16&with_original_language=ja&sort_by=popularity.desc"}
    };

    private static final class Hit {
        final long at = System.currentTimeMillis();
        final JSONArray items;
        Hit(JSONArray items) { this.items = items; }
    }

    private static final Map<String, Hit> cache = new ConcurrentHashMap<>();
    private static volatile Context context;
    private static String token = "", apiKey = "";
    private static boolean loaded;

    static void init(Context ctx) {
        context = ctx.getApplicationContext();
    }

    private static synchronized boolean credentials() {
        if (loaded) return !token.isEmpty() || !apiKey.isEmpty();
        loaded = true;
        if (context == null) return false;
        try (InputStream in = context.getAssets().open("tmdb.bin")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            JSONObject data = new JSONObject(new String(unseal(out.toByteArray()), Crypto.UTF8));
            token = data.optString("readAccessToken", "");
            apiKey = data.optString("apiKey", "");
        } catch (Exception e) {
            /* not packaged: the trending rows stay off */
        }
        return !token.isEmpty() || !apiKey.isEmpty();
    }

    /* assets/tmdb.bin, written by scripts/build-android.cjs:
       [1][12-byte iv][32-byte key ^ SHA-256("opentv:tmdb:mask:v1")][AES-256-GCM
       ciphertext + tag]. Keeps the key out of plain sight in the APK; the
       decrypted value only lives in memory. */
    private static byte[] unseal(byte[] blob) throws Exception {
        if (blob.length < 1 + 12 + 32 + 16 || blob[0] != 1) throw new IllegalStateException("tmdb.bin");
        byte[] mask = java.security.MessageDigest.getInstance("SHA-256")
            .digest("opentv:tmdb:mask:v1".getBytes(Crypto.UTF8));
        byte[] key = new byte[32];
        for (int i = 0; i < 32; i++) key[i] = (byte) (blob[13 + i] ^ mask[i]);
        javax.crypto.Cipher c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
        c.init(javax.crypto.Cipher.DECRYPT_MODE, new javax.crypto.spec.SecretKeySpec(key, "AES"),
            new javax.crypto.spec.GCMParameterSpec(128, blob, 1, 12));
        return c.doFinal(blob, 45, blob.length - 45);
    }

    /* The service answer for tmdb({list}). */
    static JSONObject list(String name) {
        String route = null;
        for (String[] l : LISTS) if (l[0].equals(name)) route = l[1];
        if (route == null) return error("Lista no permitida", false);
        if (!credentials()) return error("Sin clave de TMDB", true);
        Hit hit = cache.get(name);
        if (hit != null && System.currentTimeMillis() - hit.at < CACHE_MS) return Js.o("items", hit.items, "returnValue", true);
        String kind = route.contains("/tv") ? "tv" : "movie";
        JSONArray all = new JSONArray();
        for (int page = 1; page <= PAGES; page++) {
            JSONArray results;
            try {
                results = fetchPage(route, page);
            } catch (Exception e) {
                if (all.length() == 0) return error(e.getMessage(), false);
                break;
            }
            for (int i = 0; i < results.length(); i++) all.put(results.opt(i));
            if (results.length() == 0) break;
        }
        JSONArray items = new JSONArray();
        for (int i = 0; i < all.length(); i++) {
            JSONObject r = all.optJSONObject(i);
            if (r == null) continue;
            JSONObject s = slim(r, kind);
            if (!s.optString("title").isEmpty()) items.put(s);
        }
        cache.put(name, new Hit(items));
        return Js.o("items", items, "returnValue", true);
    }

    private static JSONObject error(String text, boolean unavailable) {
        return Js.o("returnValue", false, "errorText", text, "unavailable", unavailable);
    }

    /* Only what the rows need: titles, year, poster/backdrop, rating. */
    private static JSONObject slim(JSONObject r, String kind) {
        Object vote = r.opt("vote_average");
        String date = Js.text(Js.or(r.opt("release_date"), r.opt("first_air_date"), ""));
        String poster = Js.text(r.opt("poster_path")), backdrop = Js.text(r.opt("backdrop_path"));
        return Js.o("tmdbId", r.opt("id"), "kind", kind,
            "title", Js.text(Js.or(r.opt("title"), r.opt("name"), "")),
            "original", Js.text(Js.or(r.opt("original_title"), r.opt("original_name"), "")),
            "year", date.substring(0, Math.min(4, date.length())),
            "rating", vote instanceof Number ? Js.jsonNum(Math.round(((Number) vote).doubleValue() * 10) / 10.0) : (Object) 0,
            "poster", Js.truthy(r.opt("poster_path")) ? "https://image.tmdb.org/t/p/w342" + poster : "",
            "backdrop", Js.truthy(r.opt("backdrop_path")) ? "https://image.tmdb.org/t/p/w780" + backdrop : "");
    }

    private static JSONArray fetchPage(String route, int page) throws Exception {
        String query = "language=es-MX&region=MX&page=" + page + (token.isEmpty() ? "&api_key=" + URLEncoder.encode(apiKey, "UTF-8") : "");
        Http.Request r = new Http.Request();
        r.secure = true;
        r.connectHost = "api.themoviedb.org";   // system resolver, as tmdb.js
        r.port = 443;
        r.tlsName = "api.themoviedb.org";
        r.path = "/3" + route + (route.contains("?") ? "&" : "?") + query;
        r.connectTimeout = 10000;
        r.readTimeout = 10000;
        r.headers.put("Host", "api.themoviedb.org");
        r.headers.put("accept", "application/json");
        if (!token.isEmpty()) r.headers.put("Authorization", "Bearer " + token);
        Http.Response res;
        try {
            res = Http.execute(r);
        } catch (Exception e) {
            // The class and message only: the request path may carry the key.
            android.util.Log.w("OpenTV", "tmdb: " + e.getClass().getSimpleName() + " " + e.getMessage());
            throw new Exception("Sin conexión con TMDB");
        }
        try {
            if (res.status != 200) throw new Exception("TMDB respondió " + res.status);
            byte[] body;
            try {
                body = res.readAll(16L << 20);
            } catch (Exception e) {
                throw new Exception("Sin conexión con TMDB");
            }
            try {
                JSONArray results = new JSONObject(new String(body, Crypto.UTF8)).optJSONArray("results");
                return results == null ? new JSONArray() : results;
            } catch (Exception e) {
                throw new Exception("Respuesta de TMDB no válida");
            }
        } finally {
            res.close();
        }
    }
}
