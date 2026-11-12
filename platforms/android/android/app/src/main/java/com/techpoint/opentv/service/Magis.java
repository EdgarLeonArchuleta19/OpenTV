package com.techpoint.opentv.service;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/*
 * Magis portal client, port of service/magis.js (see its PROVENANCE notes).
 *
 * Only an ANONYMOUS device session is created (v3/snToken + v8/active).
 * No user credentials are read, stored or transmitted.
 *
 * Node's callbacks become blocking calls here: every service request runs on
 * its own thread, and the portal queue is a fair lock that keeps one call in
 * flight and 450 ms between call starts, like magis.js enqueue()/drain().
 */
final class Magis {
    private Magis() {}

    private static final String TAG = "OpenTV";

    /* ------------------------------------------------------------ constants */
    static final String[] HOSTS = {
        "ftmrmy.jdfey0cd.com",
        "fuxok.nguvmqhpk.com",
        "eajmnp.hcgv1dt8.com",
        "mptec.dhkrxuzcy.com",
        "hinumz.a878kkoyc.com",
        "krdwvd.swcaw7qx.com",
        "osuhk.m3x8o50te.com",
        "oogoy.f30c96w8.com"
    };
    private static final String PORTAL_CODE = "masnew";
    static final String APP_ID = "com.android.msandroid";
    static final String APK_VERSION = "49902";
    private static final String SPKG_VER = "2024-09-10 06:25:30_33_13_";
    private static final String APK_VER_HEADER = "43404";
    private static final String USER_AGENT = "okhttp/3.12.12";
    private static final String CONTENT_TYPE = "application/json;charset=utf-8";
    private static final String SNTOKEN_SALT = "ntFT65w6itH!lHCPw7D=@qnsFC5adD28";
    static final String FIXED_MAC = "02:00:00:00:00:00";
    private static final String FIXED_RESERVE1 = "583442714b345572434a4d5769637461545a735936413d3d";
    private static final String FIXED_DRM_ID = "0iSGEyv2EqiS/nqI/I3hqdu12irw5Q3/uqrWvRFx9bM=";
    static final String UA_CDN = "Ranger/4.9.4-17294ac0";

    private static final long RATE_MS = 450;
    private static final int REQUEST_TIMEOUT = 20000;
    private static final long TREE_TTL = 10 * 60 * 1000;
    private static final long SEARCH_TTL = 3 * 60 * 1000;
    private static final long SLB_TTL = 5 * 60 * 1000;
    private static final long POST_DEADLINE = 25000;
    private static final long SESSION_DEADLINE = 25000;

    private static final String[][] ROOTS = {
        {"featured", "masnew_featured", "destacado"},
        {"movies", "masnew_movies", "pelicula"},
        {"series", "masnew_series", "serie"},
        {"anime", "masnew_anime", "anime"},
        {"kids", "masnew_kids", "infantil"},
        {"free", "masnew_free", "gratis"}
    };

    private static String[] root(String key) {
        for (String[] r : ROOTS) if (r[0].equals(key)) return r;
        return null;
    }

    private static JSONObject deviceFixed() {
        return Js.o("loginType", "2", "appLanguage", "en", "hardwareInfo", "ranchu",
            "model", "sdk_gphone64_arm64", "product", "sdk_gphone64_arm64", "cpu", "arm64-v8a",
            "B29", "", "reserve1", FIXED_RESERVE1, "deviceToken", "", "drmId", FIXED_DRM_ID, "sdkVer", 33);
    }

    private static JSONObject fingerprintFixed() {
        return Js.o("board", "goldfish_arm64", "brand", "google", "cpuAbi", "arm64-v8a", "device", "emu64a",
            "diskInfo", "8GB", "display", "sdk_gphone64_arm64",
            "fingerprint", "google/sdk_gphone64_arm64/emu64a:14/UE1A.230829.036/11228894:user/release-keys",
            "hardware", "ranchu", "host", "abfarm", "manufacturer", "Google", "ramSize", "4GB",
            "romSize", "8GB", "tags", "release-keys", "verId", "");
    }

    /* -------------------------------------------------------------- session */
    static final class Session {
        volatile String sn = "", userId = "", userToken = "", snToken = "";
        volatile boolean ready;
    }

    static final Session session = new Session();
    private static final ReentrantLock pace = new ReentrantLock(true);
    private static long lastCallAt = 0;
    private static final Object sessionLock = new Object();
    private static Future<?> activation;
    private static long activationStart;
    private static final ExecutorService worker = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "opentv-session");
        t.setDaemon(true);
        return t;
    });

    private static JSONObject deviceDict() {
        JSONObject d = deviceFixed();
        Js.put(d, "apkVersion", APK_VERSION);
        Js.put(d, "sysVersion", SPKG_VER);
        Js.put(d, "appId", APP_ID);
        Js.put(d, "sn", session.sn);
        return d;
    }

    private static void copyInto(JSONObject to, JSONObject from) {
        if (from == null) return;
        Iterator<String> keys = from.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            Js.put(to, k, from.opt(k));
        }
    }

    /* POST one encrypted body; on a network error the next portal host is
       tried. The portal hostname is resolved over DoH; SNI and Host keep the
       name. */
    static Object post(String path, JSONObject body) throws Exception {
        long deadline = System.currentTimeMillis() + POST_DEADLINE;
        String payload;
        try {
            payload = Crypto.encryptBody(body.toString());
        } catch (Exception e) {
            throw new PortalException(path + ": error cifrando cuerpo: " + e.getMessage());
        }
        byte[] bytes = payload.getBytes(Crypto.UTF8);
        Exception last = null;
        for (String host : HOSTS) {
            long left = deadline - System.currentTimeMillis();
            if (left <= 0) break;
            Http.Request r = new Http.Request();
            try {
                r.connectHost = Dnsx.prepare(host);
            } catch (IOException e) {
                last = e;
                continue;
            }
            r.method = "POST";
            r.secure = true;
            r.port = 443;
            r.tlsName = host;
            r.path = "/api/portalCore/" + path;
            r.headers.put("apk", APP_ID);
            r.headers.put("apkVer", APK_VER_HEADER);
            r.headers.put("spkgVer", SPKG_VER);
            r.headers.put("User-Agent", USER_AGENT);
            r.headers.put("Content-Type", CONTENT_TYPE);
            r.headers.put("Content-Length", String.valueOf(bytes.length));
            r.headers.put("Host", host);
            r.body = bytes;
            r.connectTimeout = (int) Math.min(REQUEST_TIMEOUT, left);
            r.readTimeout = (int) Math.min(REQUEST_TIMEOUT, left);
            String raw;
            int status;
            try {
                Http.Response res = Http.execute(r);
                try {
                    status = res.status;
                    raw = new String(res.readAll(64L << 20), Crypto.UTF8);
                } finally {
                    res.close();
                }
            } catch (IOException e) {
                last = e;
                continue;
            }
            return answerOf(path, raw, status);
        }
        if (last == null || System.currentTimeMillis() >= deadline) {
            throw new PortalException(path + ": el portal no respondió dentro de 25 segundos");
        }
        throw last;
    }

    private static Object answerOf(String path, String raw, int status) throws PortalException {
        Object parsed;
        try {
            parsed = Js.parse(raw);
        } catch (Exception e) {
            throw new PortalException(path + ": respuesta no JSON (" + status + ")");
        }
        JSONObject answer = Js.obj(parsed);
        if (answer == null) {
            if (parsed instanceof JSONArray) return parsed;
            throw new PortalException(path + ": respuesta no JSON (" + status + ")");
        }
        Object rc = answer.opt("returnCode");
        String code = Js.isNull(rc) ? "" : Js.text(rc);
        if (!code.isEmpty() && !"0".equals(code)) {
            throw new PortalException(path + " -> " + code + " " + Js.text(answer.opt("errorMessage")), code);
        }
        Object data = answer.opt("data");
        if (data instanceof String && !((String) data).isEmpty()) {
            String plain;
            try {
                plain = Crypto.decryptBlob((String) data);
            } catch (Exception e) {
                throw new PortalException(path + ": no se pudo descifrar la respuesta (" + e.getMessage() + ")");
            }
            try {
                return Js.parse(plain);
            } catch (Exception e) {
                throw new PortalException(path + ": respuesta descifrada no JSON");
            }
        }
        return Js.isNull(data) ? answer : data;
    }

    private static final Pattern SESSION_ERROR = Pattern.compile("未登录|sesi[oó]n|login", Pattern.CASE_INSENSITIVE);

    static Object call(String path, JSONObject bean) throws Exception {
        return call(path, bean, true, false);
    }

    private static Object call(String path, JSONObject bean, boolean baseFields, boolean retried) throws Exception {
        Object data = null;
        Exception err = null;
        pace.lock();
        try {
            long wait = lastCallAt + RATE_MS - System.currentTimeMillis();
            if (wait > 0) Thread.sleep(wait);
            lastCallAt = System.currentTimeMillis();
            JSONObject body = new JSONObject();
            if (baseFields) {
                Js.put(body, "portalCode", PORTAL_CODE);
                Js.put(body, "userId", session.userId);
                Js.put(body, "userToken", session.userToken);
            }
            copyInto(body, deviceDict());
            copyInto(body, bean);
            try {
                data = post(path, body);
            } catch (Exception e) {
                err = e;
            }
        } finally {
            pace.unlock();
        }
        // aaa100028 (not logged in / expired token): renew the session once.
        if (baseFields && err != null && !retried) {
            String pc = err instanceof PortalException ? ((PortalException) err).portalCode : null;
            String msg = err.getMessage() == null ? "" : err.getMessage();
            if ("aaa100028".equals(pc) || SESSION_ERROR.matcher(msg).find()) {
                Log.i(TAG, "magis: sesión no iniciada (" + (pc != null ? pc : msg) + "). Renovando sesión limpia...");
                synchronized (sessionLock) { resetSession(); }
                try {
                    ensureSession();
                } catch (Exception es) {
                    throw err;
                }
                return call(path, bean, true, true);
            }
        }
        if (err != null) throw err;
        return data;
    }

    private static void resetSession() {
        session.ready = false;
        session.userId = "";
        session.userToken = "";
        session.snToken = "";
    }

    /* Concurrent callers share one activation, like magis.js sessionWaiters. */
    static Session ensureSession() throws Exception {
        Future<?> f;
        long started;
        synchronized (sessionLock) {
            if (session.ready && !session.userId.isEmpty() && !session.userToken.isEmpty()) return session;
            if (activation == null) {
                session.ready = false;
                activationStart = System.currentTimeMillis();
                final long[] token = {activationStart};
                activation = worker.submit(() -> {
                    activate(token[0]);
                    return null;
                });
            }
            f = activation;
            started = activationStart;
        }
        try {
            long left = started + SESSION_DEADLINE - System.currentTimeMillis();
            f.get(Math.max(1, left), TimeUnit.MILLISECONDS);
            return session;
        } catch (java.util.concurrent.TimeoutException e) {
            synchronized (sessionLock) {
                if (activation == f) { activation = null; resetSession(); }
            }
            throw new PortalException("La activación del dispositivo no respondió dentro de 25 segundos");
        } catch (java.util.concurrent.ExecutionException e) {
            Throwable c = e.getCause();
            throw c instanceof Exception ? (Exception) c : new PortalException(String.valueOf(c));
        } finally {
            synchronized (sessionLock) {
                if (activation == f && f.isDone()) activation = null;
            }
        }
    }

    private static boolean current(long token) {
        synchronized (sessionLock) { return activation != null && activationStart == token; }
    }

    private static String mac() {
        return Crypto.randomHex(6).replaceAll("(..)(?=.)", "$1:");
    }

    private static void activate(long token) throws Exception {
        try {
            JSONObject fp = fingerprintFixed();
            Js.put(fp, "androidId", Crypto.randomHex(8));
            Js.put(fp, "cpuId", Crypto.randomHex(8));
            Js.put(fp, "serialNumber", Crypto.randomHex(8));
            Js.put(fp, "etheMac", mac());
            Js.put(fp, "gatewayMac", mac());
            Js.put(fp, "wifiMac", mac());
            Object mint = call("v3/snToken", fp, false, false);
            String snToken = Js.trim(Js.get(mint, "snToken"));
            if (snToken.isEmpty()) throw new PortalException("el portal no devolvió snToken");
            String sn = Js.trim(Js.get(mint, "sn"));
            if (sn.isEmpty()) sn = Crypto.md5Hex(snToken + SNTOKEN_SALT);
            if (!current(token)) return;
            session.snToken = snToken;
            session.sn = sn.toLowerCase(Locale.ROOT);

            Object active = call("v8/active", Js.o(
                "snToken", snToken, "authVersion", "", "authCode", "", "preCode", "", "macAddr", FIXED_MAC,
                "reserve1", "", "openNum", 4, "channel", "default", "matadata", "", "signdata", ""), false, false);
            if (!current(token)) return;
            session.userId = Js.trim(Js.get(active, "userId"));
            session.userToken = Js.trim(Js.get(active, "userToken"));
            if (session.userId.isEmpty() || session.userToken.isEmpty()) throw new PortalException("el portal no activó el dispositivo");
            session.ready = true;
        } catch (Exception e) {
            synchronized (sessionLock) { if (activationStart == token) resetSession(); }
            throw e;
        }
    }

    /* ---------------------------------------------------------- normalizers */
    private static String imageOf(JSONObject asset, String type) {
        JSONArray list = Js.getArr(asset, "posterList");
        for (int i = 0; i < Js.len(list); i++) {
            JSONObject p = list.optJSONObject(i);
            if (p != null && type.equals(p.opt("fileType")) && !Js.trim(p.opt("fileUrl")).isEmpty()) {
                return Js.trim(p.opt("fileUrl"));
            }
        }
        return "";
    }

    private static JSONArray genresOf(JSONObject asset) {
        JSONArray out = new JSONArray();
        String raw = Js.text(Js.get(asset, "tags"));
        if (raw.isEmpty()) return out;
        for (String part : raw.split(",", -1)) {
            String g = Js.trim(part);
            if (!g.isEmpty()) out.put(g);
        }
        return out;
    }

    private static String orStr(String a, String b) {
        return a.isEmpty() ? b : a;
    }

    static JSONObject itemFromAsset(JSONObject asset, String category, String kind) {
        if (asset == null || Js.trim(asset.opt("contentId")).isEmpty()) return null;
        String type = orStr(Js.trim(asset.opt("programType")), "movie");
        Object vc = asset.opt("volumnCount");
        Long vcInt = Js.parseInt(vc);
        boolean isSeries = "teleplay".equals(type) || "series".equals(type) || (Js.truthy(vc) && vcInt != null && vcInt > 1);
        Object score = asset.opt("score");
        String release = Js.trim(Js.or(asset.opt("releaseTime"), asset.opt("releaseDate")));
        JSONObject item = new JSONObject();
        Js.put(item, "id", Js.trim(asset.opt("contentId")));
        Js.put(item, "title", Js.text(Js.or(asset.opt("name"), asset.opt("title"))));
        Js.put(item, "category", category == null ? "" : category);
        Js.put(item, "kind", kind != null && !kind.isEmpty() ? kind : (isSeries ? "serie" : "película"));
        Js.put(item, "score", Js.isNull(score) || "".equals(score) ? "—" : Js.text(score));
        Js.put(item, "year", release.isEmpty() ? "—" : release.substring(0, Math.min(4, release.length())));
        Js.put(item, "duration", Js.text(asset.opt("duration")));
        Js.put(item, "genres", genresOf(asset));
        Js.put(item, "director", Js.text(asset.opt("director")));
        Js.put(item, "actors", Js.text(Js.or(asset.opt("actorDisplay"), asset.opt("actors"))));
        Js.put(item, "synopsis", Js.text(Js.or(asset.opt("description"), asset.opt("synopsis"))));
        Js.put(item, "poster", orStr(imageOf(asset, "icon"), imageOf(asset, "poster")));
        Js.put(item, "landscape", orStr(imageOf(asset, "poster"), imageOf(asset, "stage")));
        Js.put(item, "backdrop", orStr(imageOf(asset, "stage"), imageOf(asset, "poster")));
        Js.put(item, "type", isSeries ? "teleplay" : type);
        Js.put(item, "alias", Js.text(asset.opt("alias")));
        Js.put(item, "country", Js.trim(Js.or(asset.opt("originalCountry"), asset.opt("country"))));
        Js.put(item, "releaseDate", release);
        Js.put(item, "tagline", Js.trim(Js.or(asset.opt("viewPoint"), asset.opt("tagline"))));
        Js.put(item, "volumeCount", Js.isNull(vc) ? Js.intOr(asset.opt("volumeCount"), 0) : Js.intOr(vc, 0));
        Js.put(item, "updateCount", Js.isNull(asset.opt("updateCount")) ? 0 : Js.intOr(asset.opt("updateCount"), 0));
        Js.put(item, "moreAudio", asset.has("moreAudio") ? asset.opt("moreAudio") : (Object) 0);
        Js.put(item, "moreSubtitle", asset.has("moreSubtitle") ? asset.opt("moreSubtitle") : (Object) 0);
        Js.put(item, "row", "");
        Js.put(item, "streamUrl", "");
        Js.put(item, "portal", true);
        return item;
    }

    /* ---------------------------------------------------------------- cache */
    private static final class Stamped {
        final long at;
        final Object value;
        final long total;
        Stamped(Object value, long total) { this.at = System.currentTimeMillis(); this.value = value; this.total = total; }
    }

    private static final Map<String, Stamped> treeCache = new ConcurrentHashMap<>();
    private static final Map<String, JSONObject> itemCache = new ConcurrentHashMap<>();
    private static final Map<String, Stamped> searchCache = new ConcurrentHashMap<>();
    private static volatile Stamped slbCache;

    private static void remember(JSONObject item) {
        if (item != null && !item.optString("id").isEmpty()) itemCache.put(item.optString("id"), item);
    }

    private static final Pattern FREE_KIDS = Pattern.compile("free\\.kids", Pattern.CASE_INSENSITIVE);

    private static JSONArray itemsFromTree(Object tree, String rootKey) {
        JSONArray rows = Js.getArr(tree, "recommendList");
        JSONArray out = new JSONArray();
        String[] r = root(rootKey);
        String category = r == null ? "" : r[2];
        for (int i = 0; i < Js.len(rows); i++) {
            JSONObject row = rows.optJSONObject(i);
            JSONArray assets = Js.getArr(row, "assetList");
            for (int a = 0; a < Js.len(assets); a++) {
                JSONObject item = itemFromAsset(assets.optJSONObject(a), category, null);
                if (item == null) continue;
                Js.put(item, "row", Js.text(row.opt("name")));
                if ("free".equals(rootKey) && FREE_KIDS.matcher(item.optString("row")).find() && !item.optString("category").contains("infantil")) {
                    Js.put(item, "category", item.optString("category") + ",infantil");
                }
                out.put(item);
                remember(item);
            }
        }
        return out;
    }

    /* ----------------------------------------------------------- public API */
    static JSONObject home(String rootKey) throws Exception {
        if (root(rootKey) == null) rootKey = "movies";
        Stamped cached = treeCache.get(rootKey);
        if (cached != null && System.currentTimeMillis() - cached.at < TREE_TTL) {
            return Js.o("root", rootKey, "items", cached.value, "cached", true);
        }
        ensureSession();
        Object tree = call("getNextColumns", Js.o("columnCode", root(rootKey)[1], "pageNum", 1, "pageSize", 60, "version", ""));
        JSONArray items = itemsFromTree(tree, rootKey);
        treeCache.put(rootKey, new Stamped(items, 0));
        return Js.o("root", rootKey, "items", items, "cached", false);
    }

    /* The portal pages its results and reports the real total. */
    static JSONObject search(Object value, Object pageNumRaw, Object pageSizeRaw) throws Exception {
        long pageNum = Math.max(1, Js.intOr(pageNumRaw, 1));
        long pageSize = Math.max(1, Math.min(100, Js.intOr(pageSizeRaw, 20)));
        String q = Js.trim(value);
        if (q.isEmpty()) return Js.o("items", new JSONArray(), "total", 0);
        String key = q.toLowerCase(Locale.ROOT) + "|" + pageNum + "|" + pageSize;
        Stamped cached = searchCache.get(key);
        if (cached != null && System.currentTimeMillis() - cached.at < SEARCH_TTL) {
            return Js.o("items", cached.value, "total", cached.total, "pageNum", pageNum, "pageSize", pageSize, "cached", true);
        }
        ensureSession();
        Object answer = call("v3/searchByName", Js.o("value", q, "type", "0", "columnId", "", "filter", "", "pageNum", pageNum, "pageSize", pageSize));
        JSONArray groups = Js.getArr(answer, "searchItemList");
        JSONArray out = new JSONArray();
        Set<String> seen = new HashSet<>();
        for (int g = 0; g < Js.len(groups); g++) {
            JSONArray list = Js.getArr(groups.opt(g), "itemList");
            for (int i = 0; i < Js.len(list); i++) {
                JSONObject item = itemFromAsset(list.optJSONObject(i), "", null);
                if (item == null || seen.contains(item.optString("id"))) continue;
                seen.add(item.optString("id"));
                out.put(item);
                remember(item);
            }
        }
        long total = Js.intOr(Js.get(answer, "totalSize"), out.length());
        searchCache.put(key, new Stamped(out, total));
        return Js.o("items", out, "total", total, "pageNum", pageNum, "pageSize", pageSize, "cached", false);
    }

    static JSONObject detail(Object contentId) throws Exception {
        String id = Js.trim(contentId);
        if (id.isEmpty()) throw new PortalException("falta contentId");
        ensureSession();
        Object answer;
        JSONObject cached;
        try {
            answer = call("v4/getItemData", Js.o("contentId", id, "type", "0", "sortType", "0", "language", "en", "macAddr", FIXED_MAC));
        } catch (PortalException e) {
            cached = itemCache.get(id);
            // Movies answer portal100006 ("episode does not exist"): the
            // catalog record already carries director/cast/synopsis/tags.
            if ("portal100006".equals(e.portalCode) && cached != null) {
                return Js.o("item", cached, "episodes", new JSONArray(), "seasons", new JSONArray());
            }
            throw e;
        }
        cached = itemCache.get(id);
        JSONObject data = Js.getObj(answer, "assetData");
        if (data == null) {
            if (cached != null) return Js.o("item", cached, "episodes", new JSONArray(), "seasons", new JSONArray());
            throw new PortalException("el portal no devolvió datos del título");
        }
        JSONObject item = itemFromAsset(data, cached != null ? cached.optString("category") : "", null);
        if (item == null) throw new PortalException("el portal no devolvió datos del título");
        if (cached != null) {
            // keep the row/alias context learned from the tree
            Js.put(item, "row", cached.opt("row"));
            Js.put(item, "category", cached.opt("category"));
        }
        remember(item);

        JSONArray episodes = new JSONArray();
        JSONArray list = Js.getArr(data, "simpleProgramList");
        for (int i = 0; i < Js.len(list); i++) {
            JSONObject e = list.optJSONObject(i);
            if (e == null) continue;
            Object number = e.opt("seriesNumber");
            JSONObject ep = new JSONObject();
            Js.put(ep, "id", Js.trim(e.opt("contentId")));
            Js.put(ep, "title", Js.text(e.opt("name")));
            Js.put(ep, "name", Js.text(e.opt("name")));
            Js.put(ep, "number", Js.isNull(number) ? (Object) (i + 1) : number);
            Js.put(ep, "duration", Js.text(e.opt("duration")));
            Js.put(ep, "quality", Js.text(e.opt("quality")));
            // Optional artwork/synopsis used by the episode browser.
            Js.put(ep, "picture", Js.text(Js.or(e.opt("picture"), e.opt("pic"), e.opt("image"), e.opt("cover"), e.opt("posterUrl"), e.opt("poster"))));
            Js.put(ep, "description", Js.text(Js.or(e.opt("description"), e.opt("desc"), e.opt("synopsis"), e.opt("shortDescription"), e.opt("introduce"))));
            episodes.put(ep);
        }
        JSONArray seasons = new JSONArray();
        JSONArray sl = Js.getArr(data, "sameSeasonSeriesList");
        for (int s = 0; s < Js.len(sl); s++) {
            JSONObject season = sl.optJSONObject(s);
            if (season != null && !Js.trim(season.opt("contentId")).isEmpty()) {
                seasons.put(Js.o("id", Js.trim(season.opt("contentId")), "number", season.opt("seasonNumber")));
            }
        }
        return Js.o("item", item, "episodes", episodes, "seasons", seasons);
    }

    /* ----------------------------------------------------------------- play */
    private static JSONObject slbBean() {
        return Js.o("hasPay", "0", "userIdentity", "1", "type", "merge", "appVer", APK_VERSION, "lang", "es",
            "encMediaSupported", 1, "liveCodeList", new JSONArray().put("masnew_live"), "appParams", "",
            "reserve1", FIXED_RESERVE1, "pipFlag", "0");
    }

    private static boolean isCfl(String url) {
        for (String q : url.substring(url.lastIndexOf('?') + 1).split("&", -1)) {
            if ("sign_type=cfl".equals(Js.trim(q))) return true;
        }
        return false;
    }

    private static String withScheme(Object addr) {
        String clean = Js.trim(addr).replaceAll("/+$", "");
        clean = clean.replaceFirst("(?i)^http://", "https://");
        return clean.startsWith("https://") ? clean : "https://" + clean;
    }

    private static final class VodCdn {
        final List<String> bases = new ArrayList<>();
        String auth;
    }

    private static List<VodCdn> vodCdns(Object slb) {
        List<VodCdn> out = new ArrayList<>();
        JSONArray list = Js.getArr(slb, "cdn_list");
        for (int pass = 0; pass < 2 && out.isEmpty(); pass++) {
            // Pass 1: the CacheFly ("cfl") free VOD CDN. Pass 2 (fallback): any free VOD CDN.
            for (int i = 0; i < Js.len(list); i++) {
                JSONObject cdn = list.optJSONObject(i);
                if (cdn == null || !"vod".equals(Js.trim(cdn.opt("tag")))) continue;
                JSONArray urls = cdn.optJSONArray("url_list");
                for (int u = 0; u < Js.len(urls); u++) {
                    JSONObject entry = urls.optJSONObject(u);
                    String url = Js.trim(Js.get(entry, "url"));
                    boolean match = pass == 0
                        ? (isCfl(url) || "cfl".equals(Js.trim(Js.get(entry, "sign_type")))) && "free".equals(Js.trim(Js.get(entry, "tag")))
                        : !url.isEmpty() && ("free".equals(Js.trim(Js.get(entry, "tag"))) || url.contains("tag=free"));
                    if (match) {
                        VodCdn v = new VodCdn();
                        v.bases.add(withScheme(cdn.opt("main_addr")));
                        String spare = Js.trim(cdn.opt("spared_addr"));
                        if (!spare.isEmpty() && !v.bases.contains(withScheme(spare))) v.bases.add(withScheme(spare));
                        v.auth = url;
                        out.add(v);
                        break;
                    }
                }
            }
        }
        return out;
    }

    /* Tries each attempt in order and stops at the first one that answers.
       Portal builds differ: some need v15 / the live column id, older ones
       only answer v14 / columnId 0. */
    private static Object firstCall(String[] paths, JSONObject[] beans) throws Exception {
        Exception last = null;
        for (int i = 0; i < paths.length; i++) {
            try {
                return call(paths[i], beans[i]);
            } catch (Exception e) {
                last = e;
            }
        }
        throw last != null ? last : new PortalException("el portal no respondió");
    }

    private static Object getSlb() throws Exception {
        Stamped c = slbCache;
        if (c != null && System.currentTimeMillis() < c.at + SLB_TTL) return c.value;
        Object slb = firstCall(new String[] {"v15/getSlbInfo", "v14/getSlbInfo"}, new JSONObject[] {slbBean(), slbBean()});
        if (vodCdns(slb).isEmpty()) throw new PortalException("el portal no expuso CDN de vod libre");
        slbCache = new Stamped(slb, 0);
        return slb;
    }

    private static double fieldNumber(Object value) {
        Matcher m = Pattern.compile("(\\d+(?:\\.\\d+)?)").matcher(Js.text(value));
        return m.find() ? Double.parseDouble(m.group(1)) : 0;
    }

    private static final Pattern DIMENSIONS = Pattern.compile("\\d{3,4}\\s*[x×]\\s*(\\d{3,4})");
    private static final Pattern LINES = Pattern.compile("(\\d{3,4})\\s*[pi]\\b");

    static double trackHeight(JSONObject track) {
        double direct = fieldNumber(Js.or(track.opt("videoHeight"), track.opt("height"), track.opt("pixelHeight")));
        if (direct != 0) return direct;
        String label = Js.text(Js.or(track.opt("resolution"), track.opt("videoResolution"), track.opt("quality"))).toLowerCase(Locale.ROOT);
        Matcher d = DIMENSIONS.matcher(label);
        if (d.find()) return Long.parseLong(d.group(1));
        // Portal labels look like "720p"; \b720\b never matched them.
        Matcher l = LINES.matcher(label);
        if (l.find()) return Long.parseLong(l.group(1));
        if (Pattern.compile("\\b(4k|uhd|2160)\\b").matcher(label).find()) return 2160;
        if (Pattern.compile("\\b1440\\b").matcher(label).find()) return 1440;
        if (Pattern.compile("\\b1080\\b|\\bfhd\\b").matcher(label).find()) return 1080;
        if (Pattern.compile("\\b720\\b|\\bhd\\b").matcher(label).find()) return 720;
        if (Pattern.compile("\\b480\\b|\\bsd\\b").matcher(label).find()) return 480;
        return 0;
    }

    private static double trackBitrateKbps(JSONObject track) {
        Object raw = Js.or(track.opt("videoBitrate"), track.opt("videoBitRate"), track.opt("bitrate"), track.opt("bitRate"), track.opt("rate"), "");
        double value = fieldNumber(raw);
        String label = Js.text(raw).toLowerCase(Locale.ROOT);
        if (Pattern.compile("mbps|m\\b").matcher(label).find()) return value * 1000;
        // Portal values without a suffix are normally bits per second.
        return value > 10000 ? value / 1000 : value;
    }

    private static double trackFrameRate(JSONObject track) {
        return fieldNumber(Js.or(track.opt("frameRate"), track.opt("fps"), track.opt("videoFps")));
    }

    static JSONObject trackSummary(JSONObject track) {
        return Js.o(
            "codec", Js.trim(track.opt("encodeFormat")).toUpperCase(Locale.ROOT),
            "format", Js.trim(track.opt("videoFormat")).toLowerCase(Locale.ROOT),
            "quality", Js.trim(track.opt("quality")),
            "height", Js.jsonNum(trackHeight(track)),
            "bitrateKbps", Js.jsonNum(trackBitrateKbps(track)),
            "frameRate", Js.jsonNum(trackFrameRate(track)));
    }

    /* Prefer ordinary H.264/MP4 renditions; see the notes in magis.js. */
    private static double mediaScore(JSONObject track) {
        String rawEnc = Js.trim(track.opt("encodeFormat")).toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        String fmt = Js.trim(track.opt("videoFormat")).toLowerCase(Locale.ROOT);
        boolean isH264 = rawEnc.contains("h264") || rawEnc.contains("avc");
        boolean isHevc = rawEnc.contains("h265") || rawEnc.contains("hevc");
        double height = trackHeight(track), bitrate = trackBitrateKbps(track), fps = trackFrameRate(track);
        double score = 0;
        if (isH264) score += 0;
        else if (isHevc) score += 80;
        else score += 160;
        if (Pattern.compile("av1|vp9|10bit|hdr").matcher(rawEnc).find()) score += 500;
        if (!"mp4".equals(fmt)) score += 2000;
        if (height > 1080) score += 500 + height;
        if (fps > 30) score += 300 + fps;
        if (bitrate > 9000) score += 250;
        else if (bitrate > 6500) score += 80;
        return score;
    }

    private static List<JSONObject> collectTracks(JSONObject episode) {
        final List<JSONObject> tracks = new ArrayList<>();
        JSONArray totals = Js.getArr(episode, "totalMovieList");
        for (int t = 0; t < Js.len(totals); t++) {
            JSONArray movies = Js.getArr(totals.opt(t), "movieList");
            for (int m = 0; m < Js.len(movies); m++) {
                JSONObject mv = movies.optJSONObject(m);
                if (mv != null && !Js.trim(mv.opt("contentId")).isEmpty()) tracks.add(mv);
            }
        }
        final Map<JSONObject, Double> scores = new java.util.IdentityHashMap<>();
        for (JSONObject t : tracks) scores.put(t, mediaScore(t));
        // Stable, like Array.prototype.sort in current V8.
        Collections.sort(tracks, (a, b) -> Double.compare(scores.get(a), scores.get(b)));
        return tracks;
    }

    private static JSONArray subtitleList(JSONObject episode) {
        JSONArray out = new JSONArray();
        JSONArray subs = Js.getArr(episode, "subtitleList");
        for (int s = 0; s < Js.len(subs) && out.length() < 30; s++) {
            JSONObject sub = subs.optJSONObject(s);
            JSONArray files = Js.getArr(sub, "file");
            JSONObject file = files == null ? null : files.optJSONObject(0);
            if (file == null || Js.trim(file.opt("url")).isEmpty()) continue;
            String format = Js.trim(file.opt("fileType"));
            out.put(Js.o("lang", Js.trim(sub.opt("language")), "url", Js.trim(file.opt("url")), "format", format.isEmpty() ? "srt" : format));
        }
        return out;
    }

    private static final class Play {
        Object play;
        JSONObject episode;
        List<JSONObject> tracks;
    }

    /* Shared startPlayVOD step for resolve and mediaInfo. */
    private static Play loadPlay(Object contentId, Object seriesId) throws Exception {
        String id = Js.trim(contentId);
        if (id.isEmpty()) throw new PortalException("falta contentId");
        ensureSession();
        Object play = call("v10/startPlayVOD", Js.o("contentId", id, "seriesContentId", Js.trim(seriesId),
            "startTime", 0, "type", "1", "columnId", 0, "authType", ""));
        JSONArray eps = Js.getArr(play, "episodeList");
        JSONObject episode = eps == null ? null : eps.optJSONObject(0);
        if (episode == null) throw new PortalException("el portal no devolvió pistas de vídeo");
        List<JSONObject> tracks = collectTracks(episode);
        if (tracks.isEmpty()) throw new PortalException("el portal no devolvió pistas de vídeo");
        Play p = new Play();
        p.play = play;
        p.episode = episode;
        p.tracks = tracks;
        return p;
    }

    private static double durationOf(JSONObject track, Play info) {
        return MediaDuration.seconds(Js.or(track.opt("duration"), info.episode.opt("duration"), Js.get(info.play, "duration")));
    }

    /* Languages and subtitle files for the in-player dialog; no playable
       URL, license or headers. */
    static JSONObject mediaInfo(Object contentId, Object seriesId) throws Exception {
        Play info = loadPlay(contentId, seriesId);
        JSONObject track = info.tracks.get(0);
        JSONArray summaries = new JSONArray();
        for (JSONObject t : info.tracks) summaries.put(trackSummary(t));
        return Js.o("name", Js.text(Js.get(info.play, "name")), "audio", Js.trim(track.opt("audioInfo")),
            "subtitles", subtitleList(info.episode), "tracks", summaries, "selected", trackSummary(track),
            "duration", Js.jsonNum(durationOf(track, info)));
    }

    static JSONObject resolve(Object contentId, Object seriesId, Object trackIndexRaw, Object preferHeightRaw) throws Exception {
        Play info = loadPlay(contentId, seriesId);
        List<JSONObject> tracks = info.tracks;
        Long ti = Js.parseInt(trackIndexRaw);
        int index = ti != null && ti >= 0 && ti < tracks.size() ? (int) (long) ti : 0;
        boolean noManualTrack = !(ti != null && ti > 0);
        long preferHeight = Js.intOr(preferHeightRaw, 0);
        // Automatic: the sharpest version up to 1080 lines.
        if (preferHeight == 0 && noManualTrack && tracks.size() > 1) {
            int top = -1;
            double topHeight = 0;
            for (int q = 0; q < tracks.size(); q++) {
                double th = trackHeight(tracks.get(q));
                if (th != 0 && th <= 1080 && th > topHeight) { top = q; topHeight = th; }
            }
            if (top >= 0) index = top;
        }
        // Viewer's quality: exact match, else the closest lower one.
        if (preferHeight > 0 && noManualTrack) {
            int best = -1;
            double bestHeight = 0;
            for (int q = 0; q < tracks.size(); q++) {
                double h = trackHeight(tracks.get(q));
                if (h == preferHeight) { best = q; break; }
                if (h != 0 && h < preferHeight && h > bestHeight) { best = q; bestHeight = h; }
            }
            if (best >= 0) index = best;
        }
        JSONObject track = tracks.get(index);
        JSONArray availableTracks = new JSONArray();
        for (JSONObject t : tracks) availableTracks.put(trackSummary(t));
        JSONArray licenses = track.optJSONArray("licenseList");
        String license = Js.trim(licenses == null ? "" : Js.get(licenses.opt(0), "license"));
        if (license.isEmpty()) throw new PortalException("el portal no devolvió licencia de reproducción");

        List<VodCdn> cdns = vodCdns(getSlb());
        if (cdns.isEmpty()) throw new PortalException("el portal no expuso CDN de vod libre");
        VodCdn cdn = cdns.get(0);
        String ext = "ts".equals(Js.trim(track.opt("videoFormat")).toLowerCase(Locale.ROOT)) ? "ts" : "mp4";
        String url = cdn.bases.get(0) + "/vod/" + Js.trim(track.opt("contentId")) + "_media." + ext;
        JSONObject headers = Js.o("Content-Auth", cdn.auth, "Content-License", license, "User-Agent", UA_CDN,
            "App", APP_ID, "App-Version", APK_VERSION);
        return Js.o("url", url, "mime", "ts".equals(ext) ? "video/mp2t" : "video/mp4",
            "codec", Js.trim(track.opt("encodeFormat")).toUpperCase(Locale.ROOT),
            "quality", Js.trim(track.opt("quality")),
            "duration", Js.jsonNum(durationOf(track, info)),
            "selectedTrack", trackSummary(track),
            "availableTracks", availableTracks,
            "trackIndex", index,
            "audio", Js.trim(track.opt("audioInfo")),
            "headers", headers,
            "subtitles", subtitleList(info.episode),
            "name", Js.text(Js.get(info.play, "name")));
    }

    /* ----------------------------------------------------------------- live */
    private static String bareHost(Object mainAddr) {
        String s = mainAddr instanceof String ? (String) mainAddr : "";
        if (s.startsWith("https://")) s = s.substring(8);
        if (s.startsWith("http://")) s = s.substring(7);
        int slash = s.indexOf('/');
        return slash >= 0 ? s.substring(0, slash) : s;
    }

    private static final Map<String, JSONObject> liveChannelCache = new ConcurrentHashMap<>();
    private static volatile JSONArray liveCategoriesCache;

    /* One portal page at a time: the page paints page one first and asks for
       the rest in the background. magis.js posts this one directly, outside
       the paced queue. */
    static Object[] getLiveChannels(Object columnId, Object pageNumRaw, Object pageSizeRaw) throws Exception {
        long pageNum = Math.max(1, Js.intOr(pageNumRaw, 1));
        long pageSize = Math.max(1, Math.min(50, Js.intOr(pageSizeRaw, 20)));
        ensureSession();
        Object res = post("v6/getLiveData", Js.o("userToken", session.userToken, "userId", session.userId,
            "portalCode", PORTAL_CODE, "columnId", Js.truthy(columnId) ? columnId : (Object) 76182, "dataVersion", "",
            "pageSize", pageSize, "pageNum", pageNum, "expireTimeStr", ""));
        JSONArray list = Js.getArr(res, "channelList");
        JSONArray out = new JSONArray();
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < Js.len(list); i++) {
            JSONObject c = list.optJSONObject(i);
            if (c == null || !Js.truthy(c.opt("channelCode")) || seen.contains(Js.text(c.opt("channelCode")))) continue;
            seen.add(Js.text(c.opt("channelCode")));
            String poster = Js.text(c.opt("posterUrl"));
            JSONArray posters = c.optJSONArray("posterList");
            if (poster.isEmpty() && Js.len(posters) > 0) poster = Js.text(Js.get(posters.opt(0), "fileUrl"));
            JSONObject ch = new JSONObject();
            Js.put(ch, "channelCode", c.opt("channelCode"));
            Js.put(ch, "index", Js.or(c.opt("channelNumber"), out.length() + 1));
            Js.put(ch, "name", Js.text(Js.or(c.opt("name"), c.opt("alias"), "Canal " + (out.length() + 1))));
            Js.put(ch, "logo", poster);
            Js.put(ch, "uhd", "3".equals(c.opt("quality")));
            Js.put(ch, "fav", Js.or(c.opt("isFav"), false));
            Js.put(ch, "now", "En vivo");
            Js.put(ch, "next", "");
            Js.put(ch, "time", "");
            Js.put(ch, "liveAddressList", Js.or(c.opt("liveAddressList"), new JSONArray()));
            out.put(ch);
            liveChannelCache.put(Js.text(c.opt("channelCode")), ch);
        }
        return new Object[] {out, Js.len(list) >= pageSize};
    }

    static JSONArray getLiveCategories() throws Exception {
        JSONArray cached = liveCategoriesCache;
        if (cached != null && cached.length() > 0) return cached;
        ensureSession();
        Object res = call("getNextColumns", Js.o("columnCode", "masnew_live", "pageNum", 1, "pageSize", 50, "version", ""));
        JSONArray list = Js.getArr(res, "recommendList");
        JSONArray out = new JSONArray();
        for (int i = 0; i < Js.len(list); i++) {
            JSONObject c = list.optJSONObject(i);
            if (c == null || !Js.truthy(c.opt("columnId"))) continue;
            out.put(Js.o("id", c.opt("columnId"),
                "name", Js.text(Js.or(c.opt("name"), c.opt("title"), c.opt("alias"), "Categoría " + (i + 1))),
                "code", Js.or(c.opt("code"), "")));
        }
        liveCategoriesCache = out;
        return out;
    }

    private static final Pattern TVG_LOGO = Pattern.compile("tvg-logo=\"([^\"]+)\"", Pattern.CASE_INSENSITIVE);
    private static final Pattern GROUP_TITLE = Pattern.compile("group-title=\"([^\"]+)\"", Pattern.CASE_INSENSITIVE);

    static JSONArray parseM3u(String content) {
        String[] lines = (content == null ? "" : content).split("\\r?\\n", -1);
        JSONArray channels = new JSONArray();
        JSONObject cur = null;
        for (String raw : lines) {
            String line = Js.trim(raw);
            if (line.startsWith("#EXTINF:")) {
                int comma = line.indexOf(',');
                String meta = comma > 0 ? line.substring(Math.min(8, comma), comma) : line.substring(8);
                String title = comma > 0 ? Js.trim(line.substring(comma + 1)) : "Canal";
                Matcher logo = TVG_LOGO.matcher(meta);
                Matcher group = GROUP_TITLE.matcher(meta);
                cur = Js.o("name", title, "logo", logo.find() ? logo.group(1) : "", "group", group.find() ? group.group(1) : "Addon",
                    "isAddon", true, "now", "En vivo", "fav", false);
            } else if (!line.isEmpty() && !line.startsWith("#") && cur != null) {
                Js.put(cur, "url", line);
                Js.put(cur, "streamUrl", line);
                Js.put(cur, "channelCode", "m3u_" + (channels.length() + 1));
                Js.put(cur, "index", channels.length() + 1);
                channels.put(cur);
                cur = null;
            }
        }
        return channels;
    }

    private static final long M3U_MAX_BYTES = 20L * 1024 * 1024;
    private static final int M3U_MAX_REDIRECTS = 5;

    static JSONArray fetchM3u(String urlStr) throws Exception {
        for (int redirects = 0; ; redirects++) {
            if (urlStr == null || urlStr.isEmpty()) throw new PortalException("URL de addon requerida");
            if (!Pattern.compile("^https?://", Pattern.CASE_INSENSITIVE).matcher(urlStr).find()) throw new PortalException("El addon debe ser una dirección http(s)");
            if (redirects > M3U_MAX_REDIRECTS) throw new PortalException("Demasiadas redirecciones al descargar addon");
            Http.Url u = Http.Url.parse(urlStr);
            boolean secure = urlStr.startsWith("https://");
            int port = u.port.isEmpty() ? (secure ? 443 : 80) : Integer.parseInt(u.port);
            Http.Request r = new Http.Request();
            r.secure = secure;
            r.connectHost = Dnsx.prepare(u.hostname);
            r.port = port;
            r.tlsName = u.hostname;
            r.path = u.path;
            r.connectTimeout = 20000;
            r.readTimeout = 20000;
            r.headers.put("User-Agent", "Mozilla/5.0 (SmartHub; SMART-TV; U; Linux/SmartTV) AppleWebKit/538.1+ (KHTML, like Gecko) Safari/538.1+");
            r.headers.put("Host", u.hostname + (port != (secure ? 443 : 80) ? ":" + port : ""));
            Http.Response res;
            try {
                res = Http.execute(r);
            } catch (java.net.SocketTimeoutException e) {
                throw new PortalException("Tiempo de espera agotado al descargar addon");
            }
            try {
                if (res.status >= 300 && res.status < 400 && res.header("location") != null) {
                    urlStr = Http.Url.resolve(urlStr, res.header("location"));
                    continue;
                }
                if (res.status != 200) throw new PortalException("HTTP " + res.status + " al descargar addon");
                byte[] body;
                try {
                    body = res.readAll(M3U_MAX_BYTES);
                } catch (java.net.SocketTimeoutException e) {
                    throw new PortalException("Tiempo de espera agotado al descargar addon");
                } catch (IOException e) {
                    if ("respuesta demasiado grande".equals(e.getMessage())) throw new PortalException("El addon es demasiado grande");
                    throw e;
                }
                return parseM3u(new String(body, Crypto.UTF8));
            } finally {
                res.abort();
            }
        }
    }

    /* Live authorizations are short-lived but valid long enough for channel
       surfing: reuse one for two minutes. */
    private static final Map<String, Stamped> liveResolveCache = new ConcurrentHashMap<>();
    private static final long LIVE_RESOLVE_CACHE_MS = 120000;

    private static final class LiveCdn {
        final String cflHost, authBase;
        LiveCdn(String h, String a) { cflHost = h; authBase = a; }
    }

    private static List<LiveCdn> liveCdnsOf(Object slb) {
        JSONArray cdns = Js.getArr(slb, "cdn_list");
        List<LiveCdn> list = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        // Pass 1: cfl / CacheFly CDNs first. Pass 2: any live CDN with a token.
        for (int pass = 0; pass < 2; pass++) {
            for (int c = 0; c < Js.len(cdns); c++) {
                JSONObject cdn = cdns.optJSONObject(c);
                if (cdn == null || !"live".equals(cdn.opt("tag"))) continue;
                JSONArray urls = cdn.optJSONArray("url_list");
                for (int u = 0; u < Js.len(urls); u++) {
                    JSONObject entry = urls.optJSONObject(u);
                    Object rawUrl = Js.get(entry, "url");
                    String urlStr = Js.truthy(rawUrl) ? Js.text(rawUrl) : "";
                    boolean match = pass == 0
                        ? "cfl".equals(Js.get(entry, "sign_type")) || urlStr.contains("sign_type=cfl")
                        : !urlStr.isEmpty() && urlStr.contains("token=");
                    if (!match) continue;
                    addLive(list, seen, cdn.opt("main_addr"), urlStr);
                    if (Js.truthy(cdn.opt("spared_addr"))) addLive(list, seen, cdn.opt("spared_addr"), urlStr);
                }
            }
        }
        return list;
    }

    private static void addLive(List<LiveCdn> list, Set<String> seen, Object host, String auth) {
        String bh = bareHost(host);
        if (!bh.isEmpty() && seen.add(bh)) list.add(new LiveCdn(bh, auth));
    }

    private static final Pattern LIVE_TOKEN = Pattern.compile("token=([0-9a-fA-F]{32})");

    static JSONObject resolveLive(Object channelCode) throws Exception {
        String key = Js.text(channelCode);
        Stamped cached = liveResolveCache.get(key);
        if (cached != null && System.currentTimeMillis() - cached.at < LIVE_RESOLVE_CACHE_MS) {
            return new JSONObject(cached.value.toString());
        }
        ensureSession();
        Object play = firstCall(new String[] {"v4/startPlayLive", "v4/startPlayLive", "v4/startPlayLive"}, new JSONObject[] {
            Js.o("channelCode", channelCode, "type", "1"),
            Js.o("channelCode", channelCode, "columnId", "76182", "type", "1"),
            Js.o("channelCode", channelCode, "columnId", 0, "type", "1")});
        JSONArray addrList = Js.getArr(play, "liveAddressList");
        JSONObject addr = null;
        for (int a = 0; a < Js.len(addrList); a++) {
            JSONObject x = addrList.optJSONObject(a);
            if (x != null && Js.truthy(x.opt("playCode")) && Js.truthy(x.opt("license"))) { addr = x; break; }
        }
        if (addr == null && addrList != null) addr = addrList.optJSONObject(0);
        if (addr == null || !Js.truthy(addr.opt("license"))) throw new PortalException("el portal no devolvió licencia para el canal");
        String playCode = Js.text(Js.or(addr.opt("playCode"), channelCode));
        Object license = addr.opt("license");

        JSONObject bean = slbBean();
        List<LiveCdn> liveCdns = null;
        for (String path : new String[] {"v15/getSlbInfo", "v14/getSlbInfo"}) {
            try {
                List<LiveCdn> got = liveCdnsOf(call(path, bean));
                if (!got.isEmpty()) { liveCdns = got; break; }
            } catch (Exception ignored) {
                /* next SLB version */
            }
        }
        if (liveCdns == null) throw new PortalException("el portal no expuso CDN de vivo");

        LiveCdn chosen = liveCdns.get(0);
        String liveUrl = "http://" + chosen.cflHost + "/live/" + playCode + ".m3u8";
        Matcher tm = LIVE_TOKEN.matcher(chosen.authBase);
        String token = tm.find() ? tm.group(1) : "";
        long moment = System.currentTimeMillis();
        String sign2 = Crypto.signO3(token, moment);
        String authHeader = chosen.authBase + "&sign2_method=sign_o3&instance=0&start_moment=" + moment + "&sign2=" + sign2;
        JSONArray backupUrls = new JSONArray();
        for (int b = 1; b < liveCdns.size(); b++) backupUrls.put("http://" + liveCdns.get(b).cflHost + "/live/" + playCode + ".m3u8");
        JSONObject cachedChannel = liveChannelCache.get(key);
        JSONObject stream = Js.o("url", liveUrl, "backupUrls", backupUrls, "mime", "application/x-mpegurl",
            "headers", Js.o("Content-Auth", authHeader, "Content-License", license, "User-Agent", UA_CDN,
                "App", APP_ID, "App-Version", APK_VERSION, "X-Buffer", "0"),
            "name", Js.text(Js.or(addr.opt("name"), cachedChannel == null ? null : cachedChannel.opt("name"), channelCode)));
        liveResolveCache.put(key, new Stamped(stream.toString(), 0));
        return stream;
    }
}
