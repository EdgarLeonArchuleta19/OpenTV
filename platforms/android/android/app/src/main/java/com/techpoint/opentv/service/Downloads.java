package com.techpoint.opentv.service;

import android.content.Context;
import android.os.Environment;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;
import org.libtorrent4j.AddTorrentParams;
import org.libtorrent4j.FileStorage;
import org.libtorrent4j.Priority;
import org.libtorrent4j.SessionManager;
import org.libtorrent4j.TorrentFlags;
import org.libtorrent4j.TorrentHandle;
import org.libtorrent4j.TorrentInfo;
import org.libtorrent4j.TorrentStatus;
import org.libtorrent4j.Vectors;
import org.libtorrent4j.swig.error_code;
import org.libtorrent4j.swig.torrent_flags_t;
import org.libtorrent4j.swig.torrent_handle;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.URLEncoder;
import java.security.SecureRandom;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/*
 * Downloads on Android, the port of service/downloads.js (same methods and
 * answer shapes): a movie or an episode saved to watch without internet.
 *
 *   start({title, subtitle, targetId, itemId, poster, url, headers, infoHash,
 *          fileIdx, sources, filename, duration})   -> {id}
 *   list()                                       -> {items, dir, free, total}
 *   action(id, 'pause' | 'resume' | 'remove' | 'delete')
 *   open(id)                                     -> {url, name}  (loopback, Range)
 *
 * Files go to the app's own Movies folder on the shared storage
 * (Android/data/<app>/files/Movies: no storage permission, removed with the
 * app), or to its internal files when there is none. Direct links resume
 * with HTTP Range (redirects and the source's headers kept); torrents use
 * the libtorrent session of Torrents.java with the pieces under
 * Movies/.partes and the file moved next to the others when complete. HLS
 * is not available (no FFmpeg on Android). The list survives restarts
 * (files/downloads.json); unfinished ones go on by themselves when the app
 * starts, the ones the viewer paused stay paused.
 *
 * At most two at once, and one torrent: each runs on its own thread with a
 * 64 KB buffer. While any is downloading or queued, DownloadsForegroundService
 * keeps the process alive (app in the background or swiped away) and shows
 * the progress in a notification; it stops by itself when none is left.
 */
final class Downloads {
    private Downloads() {}

    private static final String TAG = "OpenTV";
    private static final int MAX_ACTIVE = 2;
    private static final int MAX_ITEMS = 200;
    private static final int MAX_REDIRECTS = 6;
    private static final long SPACE_MARGIN = 100L * 1024 * 1024;    // left free on the volume
    private static final long META_TIMEOUT_MS = 120000;
    private static final Pattern HLS_URL = Pattern.compile("\\.m3u8\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern HTTP_URL = Pattern.compile("^https?://", Pattern.CASE_INSENSITIVE);
    private static final Pattern EXT = Pattern.compile("\\.(mp4|m4v|mkv|webm|avi|mov|ts|m2ts)(?:$|[?#])", Pattern.CASE_INSENSITIVE);
    private static final Pattern TOTAL = Pattern.compile("/(\\d+)\\s*$");
    private static final Pattern ID_PATH = Pattern.compile("^/d/([0-9a-f]{16})/");

    private static File dir;          // where finished files go
    private static File parts;        // torrent pieces while downloading
    private static File stateFile;
    private static String dirLabel = "";
    private static List<Item> items;  // newest first
    private static final Map<String, Run> running = new HashMap<>();
    private static boolean closed;
    private static String yieldedHash;   // given way to a stream that is starting
    private static long yieldedUntil;
    private static LocalServer server;
    private static Context appContext;   // the application context (no leak)
    private static ScheduledFuture<?> saveTask;
    private static final SecureRandom random = new SecureRandom();
    private static final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "opentv-download-timer");
        t.setDaemon(true);
        return t;
    });

    /* One download. bytes, total and speed change on the worker thread. */
    private static final class Item {
        String id, title, subtitle, targetId, itemId, poster, kind, url, infoHash, file, status, error = "";
        JSONObject headers = new JSONObject();
        Object fileIdx;
        JSONArray sources = new JSONArray();
        double duration;
        volatile long bytes, total, speed;
        long created, finished;
        boolean resumeOnStart;

        JSONObject toJson(boolean saved) {
            JSONObject o = Js.o("id", id, "title", title, "subtitle", subtitle, "targetId", targetId,
                "itemId", itemId, "poster", poster, "kind", kind, "status", status, "bytes", bytes,
                "total", total, "error", error, "created", created);
            if (saved) {
                Js.put(o, "url", url);
                Js.put(o, "headers", headers);
                Js.put(o, "infoHash", infoHash);
                Js.put(o, "fileIdx", fileIdx == null ? JSONObject.NULL : fileIdx);
                Js.put(o, "sources", sources);
                Js.put(o, "duration", Js.jsonNum(duration));
                Js.put(o, "file", file);
                if (finished > 0) Js.put(o, "finished", finished);
                if (resumeOnStart) Js.put(o, "resumeOnStart", true);
            } else {
                Js.put(o, "speed", speed);
                Js.put(o, "fileName", new File(file).getName());
            }
            return o;
        }

        static Item fromJson(JSONObject o) {
            Item it = new Item();
            it.id = o.optString("id");
            it.title = o.optString("title");
            it.subtitle = o.optString("subtitle");
            it.targetId = o.optString("targetId");
            it.itemId = o.optString("itemId");
            it.poster = o.optString("poster");
            it.kind = o.optString("kind", "direct");
            it.url = o.optString("url");
            it.infoHash = o.optString("infoHash");
            it.file = o.optString("file");
            it.status = o.optString("status", "queued");
            it.error = o.optString("error");
            JSONObject h = o.optJSONObject("headers");
            if (h != null) it.headers = h;
            it.fileIdx = Js.isNull(o.opt("fileIdx")) ? null : o.opt("fileIdx");
            JSONArray s = o.optJSONArray("sources");
            if (s != null) it.sources = s;
            it.duration = o.optDouble("duration", 0);
            it.bytes = o.optLong("bytes");
            it.total = o.optLong("total");
            it.created = o.optLong("created");
            it.finished = o.optLong("finished");
            it.resumeOnStart = o.optBoolean("resumeOnStart");
            return it;
        }
    }

    /* ------------------------------------------------------------- setup */

    /* From OpenTvService.start (off the main thread). */
    static void init(Context context) {
        File movies = null;
        try {
            movies = context.getExternalFilesDir(Environment.DIRECTORY_MOVIES);
        } catch (Throwable ignored) { /* no shared storage */ }
        String label;
        if (movies != null && (movies.isDirectory() || movies.mkdirs())) {
            String path = movies.getAbsolutePath();
            int at = path.indexOf("/Android/data/");
            label = at >= 0 ? "Almacenamiento interno/" + path.substring(at + 1) : path;
        } else {
            movies = new File(context.getFilesDir(), "Movies");
            label = "Memoria interna de OpenTV";
        }
        synchronized (Downloads.class) {
            appContext = context.getApplicationContext();
            dir = movies;
            parts = new File(movies, ".partes");
            stateFile = new File(context.getFilesDir(), "downloads.json");
            dirLabel = label;
            load();
            pump();
        }
    }

    private static void load() {
        if (items != null) return;
        items = new ArrayList<>();
        try {
            if (!stateFile.isFile()) return;
            JSONArray saved = new JSONArray(new String(readFile(stateFile), Crypto.UTF8));
            for (int i = 0; i < saved.length(); i++) {
                JSONObject o = saved.optJSONObject(i);
                if (o == null || o.optString("id").isEmpty() || o.optString("file").isEmpty()) continue;
                Item it = Item.fromJson(o);
                // Cut by closing the app: it goes on by itself (a pause made
                // by the viewer stays a pause).
                if ("downloading".equals(it.status) || "queued".equals(it.status) || it.resumeOnStart) it.status = "queued";
                it.resumeOnStart = false;
                if ("done".equals(it.status) && !new File(it.file).isFile()) it.status = "missing";
                items.add(it);
            }
        } catch (Exception e) {
            Log.w(TAG, "descargas: no se pudo leer la lista: " + e);
        }
    }

    private static byte[] readFile(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private static synchronized void saveSoon() {
        if (saveTask != null || stateFile == null) return;
        saveTask = timer.schedule(() -> {
            synchronized (Downloads.class) { saveTask = null; }
            saveNow();
        }, 1500, TimeUnit.MILLISECONDS);
    }

    private static void saveNow() {
        String text;
        synchronized (Downloads.class) {
            if (items == null || stateFile == null) return;
            JSONArray out = new JSONArray();
            for (Item it : items) out.put(it.toJson(true));
            text = out.toString();
        }
        File tmp = new File(stateFile.getPath() + ".tmp");
        try (OutputStream o = new FileOutputStream(tmp)) {
            o.write(text.getBytes(Crypto.UTF8));
        } catch (IOException e) {
            Log.w(TAG, "descargas: no se pudo guardar la lista: " + e);
            return;
        }
        if (!tmp.renameTo(stateFile)) {
            stateFile.delete();
            if (!tmp.renameTo(stateFile)) Log.w(TAG, "descargas: no se pudo guardar la lista");
        }
    }

    private static Item find(String id) {
        if (items == null) return null;
        for (Item it : items) if (it.id.equals(id)) return it;
        return null;
    }

    private static void ready() throws PortalException {
        if (dir == null || items == null) throw new PortalException("Las descargas aún no están listas");
    }

    /* "Película (2010)" -> a name every file system accepts. */
    static String safeName(String text) {
        String name = String.valueOf(text == null ? "" : text)
            .replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f]", " ").replaceAll("\\s+", " ").trim()
            .replaceAll("[. ]+$", "");
        if (name.length() > 120) name = name.substring(0, 120).trim();
        return name.isEmpty() ? "Video" : name;
    }

    private static String uniqueFile(String base, String ext) {
        Map<String, Boolean> taken = new HashMap<>();
        for (Item it : items) taken.put(it.file.toLowerCase(Locale.ROOT), true);
        for (int n = 1; n < 1000; n++) {
            File f = new File(dir, base + (n > 1 ? " (" + n + ")" : "") + ext);
            String p = f.getAbsolutePath();
            if (!taken.containsKey(p.toLowerCase(Locale.ROOT)) && !f.exists() && !new File(p + ".part").exists()) return p;
        }
        return new File(dir, base + " " + System.currentTimeMillis() + ext).getAbsolutePath();
    }

    private static String extFrom(String text, String fallback) {
        Matcher m = EXT.matcher(text == null ? "" : text);
        return m.find() ? "." + m.group(1).toLowerCase(Locale.ROOT) : fallback;
    }

    private static String newId() {
        byte[] b = new byte[8];
        random.nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format(Locale.ROOT, "%02x", x));
        return sb.toString();
    }

    /* --------------------------------------------------------------- API */

    static synchronized JSONObject start(JSONObject p) throws Exception {
        ready();
        String infoHash = Js.text(Js.or(p.opt("infoHash"), ""));
        String url = Js.text(Js.or(p.opt("url"), ""));
        String kind = !infoHash.isEmpty() ? "torrent" : (HLS_URL.matcher(url).find() ? "hls" : "direct");
        if ("torrent".equals(kind) && !Torrents.HASH.matcher(infoHash.toLowerCase(Locale.ROOT)).matches()) {
            throw new PortalException("El torrent no es válido");
        }
        if ("hls".equals(kind)) throw new PortalException("Las descargas de HLS no están disponibles en Android");
        if ("direct".equals(kind) && !HTTP_URL.matcher(url).find()) throw new PortalException("La fuente no tiene un enlace http(s) válido");
        if ("torrent".equals(kind) && !Torrents.supported()) throw new PortalException("Los torrents no están disponibles en este aparato");
        String targetId = Js.text(Js.or(p.opt("targetId"), ""));
        // The same file already in the list: keep that one.
        for (Item o : items) {
            if (!targetId.isEmpty() && targetId.equals(o.targetId) && !"error".equals(o.status) && !"missing".equals(o.status)) {
                if ("paused".equals(o.status)) { o.status = "queued"; pump(); }
                return Js.o("id", o.id, "existing", true);
            }
        }
        long free = Space.free(dir);
        if (free >= 0 && free < SPACE_MARGIN) {
            throw new PortalException("No queda espacio para descargar: hay " + Space.human(free) + " libres.");
        }
        if (!dir.isDirectory() && !dir.mkdirs()) throw new PortalException("No se pudo crear la carpeta de descargas");
        String title = Js.text(p.opt("title"));
        String subtitle = Js.text(p.opt("subtitle"));
        Item it = new Item();
        it.id = newId();
        it.title = cut(title, 200);
        it.subtitle = cut(subtitle, 200);
        it.targetId = targetId;
        it.itemId = Js.text(p.opt("itemId"));
        String poster = Js.text(p.opt("poster"));
        it.poster = HTTP_URL.matcher(poster).find() ? poster : "";
        it.kind = kind;
        it.url = url;
        JSONObject headers = p.optJSONObject("headers");
        if (headers != null) it.headers = headers;
        it.infoHash = "torrent".equals(kind) ? infoHash.toLowerCase(Locale.ROOT) : "";
        it.fileIdx = Js.isNull(p.opt("fileIdx")) ? null : p.opt("fileIdx");
        JSONArray sources = p.optJSONArray("sources");
        if (sources != null) {
            JSONArray s = new JSONArray();
            for (int i = 0; i < sources.length() && i < 50; i++) s.put(sources.opt(i));
            it.sources = s;
        }
        it.duration = MediaDuration.seconds(p.opt("duration"));
        it.file = uniqueFile(safeName(title + (subtitle.isEmpty() ? "" : " - " + subtitle)),
            extFrom(Js.text(Js.or(p.opt("filename"), url)), ".mkv"));
        it.status = "queued";
        it.created = System.currentTimeMillis();
        items.add(0, it);
        while (items.size() > MAX_ITEMS) halt(items.remove(items.size() - 1));
        saveSoon();
        pump();
        OpenTvService.downloadStarted();
        return Js.o("id", it.id);
    }

    private static String cut(String s, int max) {
        return s.length() > max ? s.substring(0, max) : s;
    }

    static synchronized JSONObject list() {
        JSONArray out = new JSONArray();
        if (items != null) for (Item it : items) out.put(it.toJson(false));
        return Js.o("items", out, "dir", dirLabel, "free", dir == null ? -1 : Space.free(dir),
            "total", dir == null ? -1 : Space.total(dir));
    }

    static synchronized JSONObject action(String id, String what) throws Exception {
        ready();
        Item it = find(id);
        if (it == null) throw new PortalException("Esa descarga ya no existe");
        switch (what) {
            case "pause":
                halt(it);
                if ("downloading".equals(it.status) || "queued".equals(it.status)) { it.status = "paused"; it.speed = 0; }
                break;
            case "resume":
                if ("paused".equals(it.status) || "error".equals(it.status)) { it.status = "queued"; it.error = ""; }
                break;
            case "remove":
            case "delete": {
                halt(it);
                items.remove(it);
                // Unfinished pieces always go; the finished file only when asked.
                final Item gone = it;
                final boolean file = "delete".equals(what) || !"done".equals(it.status);
                // A moment later: the worker may still be closing its files.
                timer.schedule(() -> {
                    new File(gone.file + ".part").delete();
                    if (!gone.infoHash.isEmpty()) Torrents.deleteTree(new File(parts, gone.infoHash + "-" + gone.id));
                    if (file) new File(gone.file).delete();
                }, 2, TimeUnit.SECONDS);
                break;
            }
            default:
                throw new PortalException("Acción desconocida");
        }
        saveSoon();
        pump();
        return it.toJson(false);
    }

    static JSONObject open(String id) throws Exception {
        Item it;
        synchronized (Downloads.class) {
            ready();
            it = find(id);
            if (it == null || !"done".equals(it.status)) throw new PortalException("La descarga no está completa");
            if (!new File(it.file).isFile()) {
                it.status = "missing";
                saveSoon();
                throw new PortalException("El archivo ya no está en " + dirLabel);
            }
            if (server == null) {
                LocalServer s = new LocalServer("downloads", Downloads::serve);
                s.start(0);
                server = s;
            }
        }
        String name = new File(it.file).getName();
        String enc = URLEncoder.encode(name, "UTF-8").replace("+", "%20");
        return Js.o("url", "http://127.0.0.1:" + server.port() + "/d/" + it.id + "/" + enc, "name", name);
    }

    /* App closing: stop everything, keep what was downloaded. Unfinished
       ones go on with the app next time. */
    static void close() {
        synchronized (Downloads.class) {
            if (items == null) return;
            closed = true;
            for (Item it : new ArrayList<>(items)) {
                if (running.containsKey(it.id)) {
                    it.status = "paused";
                    it.resumeOnStart = true;
                    halt(it);
                } else if ("queued".equals(it.status)) {
                    it.resumeOnStart = true;
                }
            }
            if (saveTask != null) { saveTask.cancel(false); saveTask = null; }
        }
        saveNow();
    }

    /* Torrents.start: a download of the torrent about to be streamed waits
       (libtorrent holds a torrent once). It goes on when the stream stops. */
    static void yieldTorrent(String hash) {
        synchronized (Downloads.class) {
            if (items == null) return;
            // Until the stream is registered, pump() must not take it back.
            yieldedHash = hash;
            yieldedUntil = System.currentTimeMillis() + Torrents.READY_TIMEOUT_MS + 15000;
            for (Item it : items) {
                if (hash.equals(it.infoHash) && running.containsKey(it.id)) {
                    Log.i(TAG, "descargas: " + it.title + " espera a que termine la reproducción del torrent");
                    halt(it);
                    it.status = "queued";
                    it.speed = 0;
                }
            }
        }
    }

    /* The streamed torrent stopped. */
    static void wake() {
        // Taken under the torrents lock, so a stream that is replacing
        // another one is already registered (never both locks at once).
        String streaming = Torrents.settledStreamingHash();
        synchronized (Downloads.class) {
            if (yieldedHash != null && !yieldedHash.equals(streaming)) yieldedHash = null;
            if (items != null && !closed) pump();
        }
    }

    /* ------------------------------------------------------------ workers */

    private static void halt(Item it) {
        Run run = running.remove(it.id);
        it.speed = 0;
        if (run != null) run.stop();
    }

    /* Starts queued downloads while fewer than MAX_ACTIVE run, one torrent
       at a time, never the torrent being streamed. Lock: Downloads.class. */
    private static void pump() {
        if (items == null || closed) return;
        int active = running.size();
        boolean torrentRunning = false;
        for (Run r : running.values()) if (r instanceof TorrentRun) torrentRunning = true;
        String streaming = Torrents.streamingHash();
        for (int i = items.size() - 1; i >= 0 && active < MAX_ACTIVE; i--) {
            Item it = items.get(i);
            if (!"queued".equals(it.status) || running.containsKey(it.id)) continue;
            Run run;
            if ("torrent".equals(it.kind)) {
                if (torrentRunning || it.infoHash.equals(streaming)) continue;
                if (it.infoHash.equals(yieldedHash) && System.currentTimeMillis() < yieldedUntil) continue;
                torrentRunning = true;
                run = new TorrentRun(it);
            } else if ("direct".equals(it.kind)) {
                run = new DirectRun(it);
            } else {
                it.status = "error";
                it.error = "Las descargas de HLS no están disponibles en Android";
                continue;
            }
            it.status = "downloading";
            it.error = "";
            running.put(it.id, run);
            active++;
            Thread t = new Thread(run, "opentv-download");
            t.setDaemon(true);
            t.start();
        }
        saveSoon();
        if (busyLocked()) DownloadsForegroundService.ensureRunning(appContext);
    }

    private static boolean busyLocked() {
        if (items == null || closed) return false;
        for (Item it : items) if ("downloading".equals(it.status) || "queued".equals(it.status)) return true;
        return false;
    }

    /* Something is downloading or waiting for its turn. */
    static synchronized boolean busy() {
        return busyLocked();
    }

    /* The app opens again in the same process after close(): unfinished
       downloads go on, as on a fresh start. */
    static synchronized void reopen() {
        if (items == null || !closed) return;
        closed = false;
        for (Item it : items) {
            if (it.resumeOnStart) { it.status = "queued"; it.resumeOnStart = false; }
        }
        pump();
    }

    /* Write the list now (the service is stopping). */
    static void flush() {
        synchronized (Downloads.class) {
            if (saveTask != null) { saveTask.cancel(false); saveTask = null; }
        }
        timer.execute(Downloads::saveNow);
    }

    /* What the notification shows: the active (downloading or queued)
       downloads; the fields of the single one when there is only one. */
    static final class Snapshot {
        int count;
        String id, title, subtitle, status;
        long bytes, total, speed;

        /* Changes only when the notification text or bar would. */
        String key() {
            long pct = total > 0 ? bytes * 100 / total : -1 - bytes / (1024 * 1024);
            return count + "|" + id + "|" + status + "|" + pct + "|" + speed / (100 * 1024);
        }
    }

    static synchronized Snapshot snapshot() {
        Snapshot s = new Snapshot();
        if (items == null || closed) return s;
        long knownBytes = 0, knownTotal = 0, unknownBytes = 0;
        for (Item it : items) {
            if (!"downloading".equals(it.status) && !"queued".equals(it.status)) continue;
            s.count++;
            s.speed += it.speed;
            long b = it.bytes, t = it.total;
            if (t > 0) { knownBytes += Math.min(b, t); knownTotal += t; } else unknownBytes += b;
            if (s.count == 1) {
                s.id = it.id;
                s.title = it.title;
                s.subtitle = it.subtitle;
                s.status = it.status;
            }
        }
        if (s.count == 1 && knownTotal == 0) { s.bytes = unknownBytes; s.total = 0; }
        else { s.bytes = knownBytes; s.total = knownTotal; }
        if (s.count != 1) { s.id = null; s.status = null; }
        return s;
    }

    /* Thrown by a worker that has to wait (its torrent is being streamed). */
    private static final class Requeue extends Exception {
        Requeue() { super("requeue"); }
    }

    private static void finished(Run run, Throwable err, boolean requeue) {
        Item it = run.it;
        synchronized (Downloads.class) {
            if (running.get(it.id) != run) return;   // halted: the action set the status
            running.remove(it.id);
            it.speed = 0;
            if ("downloading".equals(it.status)) {
                if (requeue) {
                    it.status = "queued";
                } else if (err != null) {
                    it.status = "error";
                    it.error = cut(reason(err), 300);
                    Log.w(TAG, "descargas: " + it.title + ": " + err);
                    announce(it, it.error);
                } else {
                    it.status = "done";
                    it.finished = System.currentTimeMillis();
                    Log.i(TAG, "descargas: lista " + it.file);
                    announce(it, null);
                }
            }
            saveSoon();
            if (requeue) timer.schedule(Downloads::wake, 5, TimeUnit.SECONDS);
            else pump();
        }
    }

    /* "Descarga lista" / "No se pudo descargar": off the lock. */
    private static void announce(Item it, String error) {
        final Context c = appContext;
        final String id = it.id, title = it.title, subtitle = it.subtitle;
        timer.execute(() -> {
            try {
                DownloadsForegroundService.notifyFinished(c, id, title, subtitle, error);
            } catch (Throwable t) {
                Log.w(TAG, "descargas: aviso: " + t);
            }
        });
    }

    /* A message for the viewer. */
    private static String reason(Throwable e) {
        String m = e.getMessage() == null ? "" : e.getMessage();
        if (m.contains("ENOSPC") || m.toLowerCase(Locale.ROOT).contains("no space")) return "No queda espacio en el aparato";
        if (e instanceof java.net.SocketTimeoutException) return "El servidor dejó de responder";
        if (e instanceof java.net.UnknownHostException) return "Sin conexión a internet";
        if (e instanceof PortalException) return m;
        return m.isEmpty() ? e.toString() : m;
    }

    private static abstract class Run implements Runnable {
        final Item it;
        volatile boolean stopped;
        private final ArrayDeque<long[]> samples = new ArrayDeque<>();

        Run(Item it) { this.it = it; }

        abstract void work() throws Exception;

        void stop() { stopped = true; }

        @Override
        public final void run() {
            Throwable err = null;
            boolean requeue = false;
            try {
                work();
            } catch (Requeue r) {
                requeue = true;
            } catch (Throwable t) {
                err = t;
            }
            finished(this, stopped ? null : err, requeue);
        }

        /* Bytes per second over the last few seconds. */
        void meter(long bytes) {
            long now = System.currentTimeMillis();
            samples.addLast(new long[] { now, bytes });
            while (samples.size() > 2 && now - samples.peekFirst()[0] > 4000) samples.removeFirst();
            long[] first = samples.peekFirst();
            it.speed = now > first[0] ? Math.max(0, (bytes - first[1]) * 1000 / (now - first[0])) : 0;
        }

        void checkSpace(long need) throws PortalException {
            long free = Space.free(dir);
            if (free >= 0 && need > 0 && free - SPACE_MARGIN < need) {
                throw new PortalException("No hay espacio suficiente: faltan " + Space.human(need)
                    + " y quedan " + Space.human(Math.max(0, free)) + " libres");
            }
        }
    }

    /* ------------------------------------------------------- direct links */

    private static final class DirectRun extends Run {
        private volatile Http.Call call;
        private volatile Http.Response res;

        DirectRun(Item it) { super(it); }

        @Override
        void stop() {
            super.stop();
            Http.Call c = call;
            if (c != null) c.cancel();
            Http.Response r = res;
            if (r != null) r.abort();
        }

        @Override
        void work() throws Exception {
            File part = new File(it.file + ".part");
            long have = part.isFile() ? part.length() : 0;
            String url = it.url;
            for (int redirects = 0; ; redirects++) {
                if (stopped) return;
                Http.Request r = request(url, have);
                Http.Call c = new Http.Call();
                call = c;
                Http.Response up = c.execute(r);
                res = up;
                try {
                    int st = up.status;
                    if (st >= 300 && st < 400 && up.header("location") != null && redirects < MAX_REDIRECTS) {
                        url = Http.Url.resolve(url, up.header("location"));
                        continue;
                    }
                    if (st == 416 && have > 0) {   // already complete
                        complete(part, have);
                        return;
                    }
                    if (st != 200 && st != 206) {
                        throw new PortalException("El servidor respondió " + st
                            + (st == 403 || st == 410 ? ": el enlace caducó, vuelve a descargar desde la ficha" : ""));
                    }
                    if (st == 200) have = 0;   // no resume: from the start
                    Matcher m = TOTAL.matcher(String.valueOf(up.header("content-range")));
                    Long length = Js.parseInt(up.header("content-length"));
                    long total = m.find() ? Long.parseLong(m.group(1)) : (length == null || length <= 0 ? 0 : have + length);
                    checkSpace(total - have);
                    it.total = total;
                    it.bytes = have;
                    up.setReadTimeout(30000);
                    byte[] buf = new byte[64 * 1024];
                    long lastMeter = 0;
                    try (OutputStream out = new FileOutputStream(part, have > 0)) {
                        int n;
                        while (!stopped && (n = up.body.read(buf)) != -1) {
                            out.write(buf, 0, n);
                            it.bytes += n;
                            long now = System.currentTimeMillis();
                            if (now - lastMeter > 500) {
                                lastMeter = now;
                                meter(it.bytes);
                                saveSoon();
                            }
                        }
                    }
                    if (stopped) return;
                    if (it.total > 0 && it.bytes < it.total) throw new PortalException("La descarga se cortó; reanúdala");
                    complete(part, it.bytes);
                    return;
                } finally {
                    // Never reuse: a paused download leaves the body unread.
                    up.abort();
                    res = null;
                }
            }
        }

        private Http.Request request(String url, long have) throws Exception {
            Http.Url u = Http.Url.parse(url);
            boolean secure = "https:".equals(u.protocol);
            if (u.hostname.isEmpty() || !(secure || "http:".equals(u.protocol))) throw new PortalException("La fuente no tiene un enlace http(s) válido");
            Http.Request r = new Http.Request();
            r.secure = secure;
            r.connectHost = Dnsx.prepare(u.hostname);
            if (r.connectHost.isEmpty()) r.connectHost = u.hostname;
            r.port = u.port.isEmpty() ? (secure ? 443 : 80) : Integer.parseInt(u.port);
            r.tlsName = u.hostname;
            r.path = u.path;
            r.connectTimeout = 15000;
            r.readTimeout = 30000;
            boolean ua = false;
            Iterator<String> keys = it.headers.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                if ("host".equalsIgnoreCase(k) || "range".equalsIgnoreCase(k)) continue;
                if ("user-agent".equalsIgnoreCase(k)) ua = true;
                r.headers.put(k, Js.text(it.headers.opt(k)));
            }
            if (!ua) r.headers.put("User-Agent", "Mozilla/5.0 OpenTV");
            if (have > 0) r.headers.put("Range", "bytes=" + have + "-");
            r.headers.put("Host", u.host());
            return r;
        }

        private void complete(File part, long bytes) throws IOException {
            if (!part.renameTo(new File(it.file))) throw new IOException("No se pudo guardar el archivo en " + dirLabel);
            if (it.total <= 0) it.total = bytes;
            it.bytes = it.total;
        }
    }

    /* ----------------------------------------------------------- torrents */

    private static final class TorrentRun extends Run {
        private final Object lock = new Object();
        private SessionManager session;
        private TorrentHandle handle;
        private Thread thread;

        TorrentRun(Item it) { super(it); }

        @Override
        void stop() {
            super.stop();
            // At once, so a stream of this torrent can be added right after.
            removeHandle();
            Thread t = thread;
            if (t != null) t.interrupt();
        }

        private void removeHandle() {
            synchronized (lock) {
                if (handle != null && session != null) {
                    try { session.remove(handle); } catch (Throwable ignored) { /* already gone */ }
                }
                handle = null;
            }
        }

        @Override
        void work() throws Exception {
            thread = Thread.currentThread();
            if (it.infoHash.equals(Torrents.streamingHash())) throw new Requeue();
            SessionManager sm = Torrents.acquireSession();
            try {
                body(sm);
            } catch (InterruptedException e) {
                if (!stopped) throw e;
            } finally {
                removeHandle();
                Torrents.releaseSession();
            }
        }

        private void body(SessionManager sm) throws Exception {
            File tdir = new File(parts, it.infoHash + "-" + it.id);
            if (!tdir.isDirectory() && !tdir.mkdirs()) throw new PortalException("No se pudo crear la carpeta de descargas");
            File meta = new File(tdir, "meta.torrent");
            List<String> trackers = Torrents.trackers(it.sources);
            AddTorrentParams atp = null;
            if (meta.isFile()) {
                // Metadata saved on a previous run: no need to wait for peers
                // to send it; libtorrent re-checks the pieces already on disk.
                try {
                    TorrentInfo ti = TorrentInfo.bdecode(readFile(meta));
                    atp = new AddTorrentParams();
                    atp.setTorrentInfo(ti);
                    atp.setTrackers(trackers);
                } catch (Throwable t) {
                    atp = null;
                }
            }
            if (atp == null) {
                StringBuilder magnet = new StringBuilder("magnet:?xt=urn:btih:").append(it.infoHash);
                for (String tr : trackers) magnet.append("&tr=").append(URLEncoder.encode(tr, "UTF-8"));
                atp = AddTorrentParams.parseMagnetUri(magnet.toString());
            }
            atp.setSavePath(tdir.getAbsolutePath());
            atp.setMaxConnections(40);
            torrent_flags_t flags = atp.getFlags()
                .and_(TorrentFlags.AUTO_MANAGED.inv())
                .and_(TorrentFlags.PAUSED.inv())
                .and_(TorrentFlags.SEQUENTIAL_DOWNLOAD.inv())
                .or_(TorrentFlags.DEFAULT_DONT_DOWNLOAD);
            atp.setFlags(flags);
            synchronized (lock) {
                if (stopped) return;
                error_code ec = new error_code();
                torrent_handle th = sm.swig().add_torrent(atp.swig(), ec);
                if (ec.failed()) {
                    // The same torrent just started streaming: wait for it.
                    if (it.infoHash.equals(Torrents.streamingHash())) throw new Requeue();
                    throw new PortalException("No se pudo abrir el torrent: " + ec.message());
                }
                session = sm;
                handle = new TorrentHandle(th);
            }
            Log.i(TAG, "descargas: torrent " + it.infoHash + " (" + it.title + ")");

            // The metadata (name, files, pieces).
            TorrentInfo ti = null;
            long deadline = System.currentTimeMillis() + META_TIMEOUT_MS;
            while (ti == null) {
                if (stopped) return;
                TorrentHandle h = handle;
                if (h == null) return;
                if (h.status().hasMetadata()) ti = h.torrentFile();
                if (ti != null) break;
                if (System.currentTimeMillis() > deadline) {
                    throw new PortalException("No se encontraron personas compartiendo este torrent. Prueba más tarde u otra fuente.");
                }
                Thread.sleep(1000);
            }
            if (!meta.isFile()) saveMeta(ti, meta);

            FileStorage fs = ti.files();
            int n = fs.numFiles();
            int idx = -1;
            Integer want = Torrents.fileIndex(it.fileIdx);
            if (want != null && want >= 0 && want < n && !fs.padFileAt(want)) {
                idx = want;
            } else {
                long best = -1;
                for (int i = 0; i < n; i++) {
                    if (fs.padFileAt(i) || !Torrents.VIDEO_EXT.matcher(fs.fileName(i)).find()) continue;
                    if (fs.fileSize(i) > best) { best = fs.fileSize(i); idx = i; }
                }
            }
            if (idx < 0) throw new PortalException("El torrent no tiene ningún vídeo");
            // The torrent's own extension (the addon may not say it).
            String ext = Torrents.extOf(fs.fileName(idx));
            if (Torrents.VIDEO_EXT.matcher(fs.fileName(idx)).find() && !it.file.toLowerCase(Locale.ROOT).endsWith("." + ext)) {
                synchronized (Downloads.class) {
                    int dot = it.file.lastIndexOf('.');
                    String base = new File(dot > it.file.lastIndexOf('/') ? it.file.substring(0, dot) : it.file).getName();
                    it.file = uniqueFile(base, "." + ext);
                }
            }
            Priority[] prio = Priority.array(Priority.IGNORE, n);
            prio[idx] = Priority.DEFAULT;
            TorrentHandle h = handle;
            if (h == null) return;
            h.prioritizeFiles(prio);
            it.total = fs.fileSize(idx);
            String source = fs.filePath(idx, tdir.getAbsolutePath());

            boolean spaceChecked = false;
            long lastSpace = 0;
            while (true) {
                if (stopped) return;
                h = handle;
                if (h == null) return;
                TorrentStatus st = h.status();
                TorrentStatus.State state = st.state();
                boolean checking = state == TorrentStatus.State.CHECKING_FILES || state == TorrentStatus.State.CHECKING_RESUME_DATA;
                if (st.errorCode() != null && st.errorCode().isError()) {
                    throw new IOException(st.errorCode().getMessage());
                }
                long done = Math.min(it.total, st.totalWantedDone());
                it.bytes = done;
                meter(done);
                long now = System.currentTimeMillis();
                if (!checking && (!spaceChecked || now - lastSpace > 15000)) {
                    // Once the pieces on disk are known: the rest must fit;
                    // later, stop before the volume fills up.
                    if (!spaceChecked) checkSpace(it.total - done);
                    else checkSpace(Math.min(it.total - done, 32L * 1024 * 1024));
                    spaceChecked = true;
                    lastSpace = now;
                }
                if (!checking && st.totalWanted() > 0 && st.totalWantedDone() >= st.totalWanted()) break;
                saveSoon();
                Thread.sleep(1000);
            }

            // Complete: close the torrent, then move the file next to the others.
            removeHandle();
            File from = new File(source);
            File to = new File(it.file);
            boolean moved = false;
            for (int attempt = 0; attempt < 10 && !moved; attempt++) {
                Thread.sleep(500);   // libtorrent closes its files asynchronously
                moved = from.renameTo(to);
            }
            if (!moved) copy(from, to);
            Torrents.deleteTree(tdir);
            it.bytes = it.total;
        }

        /* The .torrent, so a resumed download does not wait for the metadata. */
        private void saveMeta(TorrentInfo ti, File meta) {
            try {
                AddTorrentParams p = new AddTorrentParams();
                p.setTorrentInfo(ti);
                byte[] data = Vectors.byte_vector2bytes(org.libtorrent4j.swig.libtorrent.write_torrent_file_buf_ex(p.swig()));
                try (OutputStream o = new FileOutputStream(meta)) { o.write(data); }
            } catch (Throwable t) {
                Log.w(TAG, "descargas: no se pudo guardar el .torrent: " + t);
                meta.delete();
            }
        }

        private void copy(File from, File to) throws IOException {
            byte[] buf = new byte[64 * 1024];
            try (InputStream in = new FileInputStream(from); OutputStream out = new FileOutputStream(to)) {
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            from.delete();
        }
    }

    /* ----------------------------------------------------------- playback */

    /* GET /d/<id>/<name>: a finished download with Range support. */
    private static void serve(LocalServer.Exchange ex) throws IOException {
        Map<String, String> h = new LinkedHashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        String path = ex.path();
        if (path.startsWith("/media/abort")) {
            ex.send(204, h, null);
            return;
        }
        Matcher m = ID_PATH.matcher(path);
        Item it = null;
        if (m.find()) {
            synchronized (Downloads.class) { it = find(m.group(1)); }
        }
        File f = it == null ? null : new File(it.file);
        if (it == null || !"done".equals(it.status) || !f.isFile()) {
            h.put("Content-Type", "text/plain");
            ex.send(404, h, "Not found".getBytes(Crypto.UTF8));
            return;
        }
        long total = f.length();
        long start = 0, end = total - 1;
        int status = 200;
        String rangeHeader = ex.header("range");
        Matcher r = Torrents.RANGE.matcher(rangeHeader == null ? "" : rangeHeader.trim());
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
        String ext = Torrents.extOf(f.getName());
        h.put("Accept-Ranges", "bytes");
        h.put("Content-Type", Torrents.MIME.containsKey(ext) ? Torrents.MIME.get(ext) : "application/octet-stream");
        h.put("Cache-Control", "no-store");
        h.put("Content-Length", String.valueOf(end - start + 1));
        OutputStream out = ex.begin(status, h);
        if ("HEAD".equals(ex.method)) {
            out.flush();
            return;
        }
        byte[] buf = new byte[64 * 1024];
        try (RandomAccessFile file = new RandomAccessFile(f, "r")) {
            file.seek(start);
            long left = end - start + 1;
            while (left > 0) {
                int n = file.read(buf, 0, (int) Math.min(buf.length, left));
                if (n <= 0) throw new IOException("lectura incompleta");
                out.write(buf, 0, n);
                left -= n;
            }
            out.flush();
        }
    }
}
