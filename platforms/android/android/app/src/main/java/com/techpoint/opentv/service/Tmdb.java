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
        if (name.startsWith("search:")) return search(name.substring(7));
        if (name.startsWith("es:")) return spanishTitle(name.substring(3));
        if (name.startsWith("es-season:")) {
            String[] p = name.substring(10).split(":");
            return p.length == 2 ? spanishSeason(p[0], p[1]) : error("Id no válido", false);
        }
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
        // Only what is already out: the weekly trends also bring films that
        // open next month (no date, or a date after today).
        String today = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.ROOT).format(new java.util.Date());
        JSONArray items = new JSONArray();
        for (int i = 0; i < all.length(); i++) {
            JSONObject r = all.optJSONObject(i);
            if (r == null) continue;
            JSONObject s = slim(r, kind);
            String date = s.optString("date");
            if (!s.optString("title").isEmpty() && !date.isEmpty() && date.compareTo(today) <= 0) items.put(s);
        }
        cache.put(name, new Hit(items));
        return Js.o("items", items, "returnValue", true);
    }

    /* The search box: "search:<text>" finds movies and series by their
       Spanish (or original) title, as search() in tmdb.js. One page. */
    private static final int SEARCH_CACHE_MAX = 200;
    private static final Map<String, Hit> searchCache = new ConcurrentHashMap<>();

    private static JSONObject search(String text) {
        String q = text.replaceAll("\\s+", " ").trim();
        if (q.length() > 100) q = q.substring(0, 100);
        if (q.length() < 2) return Js.o("items", new JSONArray(), "returnValue", true);
        if (!credentials()) return error("Sin clave de TMDB", true);
        String key = q.toLowerCase(java.util.Locale.ROOT);
        Hit hit = searchCache.get(key);
        if (hit != null && System.currentTimeMillis() - hit.at < CACHE_MS) return Js.o("items", hit.items, "returnValue", true);
        JSONArray results;
        try {
            results = fetchPage("/search/multi?include_adult=false&query=" + URLEncoder.encode(q, "UTF-8").replace("+", "%20"), 1);
        } catch (Exception e) {
            return error(e.getMessage(), false);
        }
        JSONArray items = new JSONArray();
        for (int i = 0; i < results.length(); i++) {
            JSONObject r = results.optJSONObject(i);
            if (r == null) continue;
            String type = r.optString("media_type");
            if (!"movie".equals(type) && !"tv".equals(type)) continue;
            JSONObject s = slim(r, type);
            if (!s.optString("title").isEmpty()) items.put(s);
        }
        if (searchCache.size() >= SEARCH_CACHE_MAX) searchCache.clear();
        searchCache.put(key, new Hit(items));
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
        return Js.o("tmdbId", r.opt("id"), "kind", kind, "date", date,
            "title", Js.text(Js.or(r.opt("title"), r.opt("name"), "")),
            "original", Js.text(Js.or(r.opt("original_title"), r.opt("original_name"), "")),
            "year", date.substring(0, Math.min(4, date.length())),
            "rating", vote instanceof Number ? Js.jsonNum(Math.round(((Number) vote).doubleValue() * 10) / 10.0) : (Object) 0,
            "poster", Js.truthy(r.opt("poster_path")) ? "https://image.tmdb.org/t/p/w342" + poster : "",
            "backdrop", Js.truthy(r.opt("backdrop_path")) ? "https://image.tmdb.org/t/p/w780" + backdrop : "");
    }

    private static JSONArray fetchPage(String route, int page) throws Exception {
        // No region for a search: it turns the year into Mexico's release date.
        String extra = (route.startsWith("/search/") ? "" : "&region=MX") + "&page=" + page;
        JSONArray results = fetchJson(route, extra).optJSONArray("results");
        return results == null ? new JSONArray() : results;
    }

    /* ---- Spanish texts for the addons' titles (catalogue language), as
       spanishTitle / spanishSeason in tmdb.js:
       "es:<imdb id>"                 -> { item: { tmdbId, kind, title, overview } }
       "es-season:<tmdb id>:<season>" -> { episodes: [{ number, title, overview }] } */
    private static final int ES_CACHE_MAX = 500;
    private static final Map<String, Object[]> esCache = new ConcurrentHashMap<>();

    private static JSONObject esCached(String key) {
        Object[] hit = esCache.get(key);
        if (hit != null && System.currentTimeMillis() - (Long) hit[0] < CACHE_MS * 4) return (JSONObject) hit[1];
        return null;
    }

    private static void esPut(String key, JSONObject out) {
        if (esCache.size() >= ES_CACHE_MAX) esCache.clear();
        esCache.put(key, new Object[] { System.currentTimeMillis(), out });
    }

    static JSONObject spanishTitle(String imdb) {
        if (!imdb.matches("tt\\d{5,10}")) return error("Id no válido", false);
        if (!credentials()) return error("Sin clave de TMDB", true);
        JSONObject hit = esCached("t:" + imdb);
        if (hit != null) return hit;
        try {
            JSONObject json = fetchJson("/find/" + imdb + "?external_source=imdb_id", "");
            JSONArray movies = json.optJSONArray("movie_results"), shows = json.optJSONArray("tv_results");
            boolean movie = movies != null && movies.length() > 0;
            JSONObject r = movie ? movies.optJSONObject(0) : (shows != null && shows.length() > 0 ? shows.optJSONObject(0) : null);
            JSONObject out;
            if (r == null) {
                out = Js.o("item", JSONObject.NULL, "returnValue", true);
            } else {
                out = Js.o("item", Js.o("tmdbId", r.opt("id"), "kind", movie ? "movie" : "tv",
                    "title", Js.text(Js.or(r.opt("title"), r.opt("name"), "")),
                    "overview", Js.text(Js.or(r.opt("overview"), ""))), "returnValue", true);
            }
            esPut("t:" + imdb, out);
            return out;
        } catch (Exception e) {
            return error(e.getMessage(), false);
        }
    }

    static JSONObject spanishSeason(String tmdbId, String season) {
        if (!tmdbId.matches("\\d{1,9}") || !season.matches("\\d{1,4}")) return error("Id no válido", false);
        if (!credentials()) return error("Sin clave de TMDB", true);
        String key = "s:" + tmdbId + ":" + season;
        JSONObject hit = esCached(key);
        if (hit != null) return hit;
        try {
            JSONArray list = fetchJson("/tv/" + tmdbId + "/season/" + season, "").optJSONArray("episodes");
            JSONArray eps = new JSONArray();
            for (int i = 0; list != null && i < list.length(); i++) {
                JSONObject e = list.optJSONObject(i);
                if (e == null) continue;
                String still = Js.text(e.opt("still_path"));
                eps.put(Js.o("number", e.opt("episode_number"), "title", Js.text(Js.or(e.opt("name"), "")),
                    "overview", Js.text(Js.or(e.opt("overview"), "")),
                    "still", Js.truthy(e.opt("still_path")) ? "https://image.tmdb.org/t/p/w780" + still : ""));
            }
            JSONObject out = Js.o("episodes", eps, "returnValue", true);
            esPut(key, out);
            return out;
        } catch (Exception e) {
            return error(e.getMessage(), false);
        }
    }

    /* One TMDB answer in Spanish (Mexico); `extra` is added to the query. */
    private static JSONObject fetchJson(String route, String extra) throws Exception {
        String query = "language=es-MX" + extra + (token.isEmpty() ? "&api_key=" + URLEncoder.encode(apiKey, "UTF-8") : "");
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
                return new JSONObject(new String(body, Crypto.UTF8));
            } catch (Exception e) {
                throw new Exception("Respuesta de TMDB no válida");
            }
        } finally {
            res.close();
        }
    }
}
