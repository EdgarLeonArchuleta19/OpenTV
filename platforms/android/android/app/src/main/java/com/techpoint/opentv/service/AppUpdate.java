package com.techpoint.opentv.service;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/*
 * In-app updates of the Android APK from the project's GitHub releases:
 *
 *   appUpdate({action:'check'})    -> {current, latest, available, notes, size, url}
 *   appUpdate({action:'download'}) -> {state:'downloading'} (works in the background)
 *   appUpdate({action:'status'})   -> {state: idle|downloading|ready|error, bytes, total, error}
 *   appUpdate({action:'install'})  -> {state:'installing'} or {state:'needs-permission'}
 *
 * The APK goes to cache/update/OpenTV-<version>.apk (resumed with Range,
 * checked against the release's size) and is handed to the system installer
 * through the app's FileProvider. Android only installs it over the current
 * app when both are signed with the same key (the release key).
 */
final class AppUpdate {
    private AppUpdate() {}

    private static final String TAG = "OpenTV";
    private static final String API = "https://api.github.com/repos/EdgarLeonArchuleta19/OpenTV/releases/latest";
    private static final long CHECK_TTL_MS = 6 * 60 * 60 * 1000L;
    private static final int MAX_REDIRECTS = 6;
    private static final Pattern TOTAL = Pattern.compile("/(\\d+)\\s*$");

    private static Context app;
    private static JSONObject lastCheck;
    private static long lastCheckAt;
    // Download state (lock: AppUpdate.class).
    private static String state = "idle";
    private static volatile long bytes;
    private static long total;
    private static String error = "";
    private static File apk;
    private static Thread worker;

    static void init(Context context) {
        app = context.getApplicationContext();
    }

    static String versionName() {
        PackageInfo p = info();
        return p == null || p.versionName == null ? "" : p.versionName;
    }

    @SuppressWarnings("deprecation")
    static long versionCode() {
        PackageInfo p = info();
        if (p == null) return 0;
        return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
    }

    private static PackageInfo info() {
        try {
            return app.getPackageManager().getPackageInfo(app.getPackageName(), 0);
        } catch (Throwable t) {
            return null;
        }
    }

    static JSONObject call(JSONObject p) throws Exception {
        if (app == null) throw new PortalException("El servicio aún no está listo");
        String action = Js.text(Js.or(p.opt("action"), "check"));
        switch (action) {
            case "check": return check(Js.truthy(p.opt("force")));
            case "download": return download();
            case "status": return status();
            case "install": return install();
            default: throw new PortalException("Acción desconocida");
        }
    }

    /* ---------------------------------------------------------------- check */

    private static synchronized JSONObject check(boolean force) throws PortalException {
        long now = System.currentTimeMillis();
        if (!force && lastCheck != null && now - lastCheckAt < CHECK_TTL_MS) return copy(lastCheck);
        JSONObject release;
        try {
            byte[] body = get(API, "application/vnd.github+json", 2 * 1024 * 1024);
            release = new JSONObject(new String(body, Crypto.UTF8));
        } catch (Exception e) {
            Log.w(TAG, "actualización: " + e);
            throw new PortalException("No se pudo buscar actualizaciones");
        }
        String latest = release.optString("tag_name").replaceFirst("^[vV]", "").trim();
        JSONObject asset = pickAsset(release.optJSONArray("assets"));
        String notes = release.optString("body");
        if (notes.length() > 600) notes = notes.substring(0, 600);
        String current = versionName();
        boolean available = asset != null && !latest.isEmpty() && compare(latest, current) > 0;
        JSONObject out = Js.o("current", current, "latest", latest, "available", available, "notes", notes,
            "size", asset == null ? 0 : asset.optLong("size"),
            "url", asset == null ? "" : asset.optString("browser_download_url"));
        lastCheck = out;
        lastCheckAt = now;
        return copy(out);
    }

    /* The .apk asset: the one built for this device's ABI, else a universal one. */
    private static JSONObject pickAsset(JSONArray assets) {
        if (assets == null) return null;
        String abi = Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "";
        String[] abis = { "armeabi-v7a", "arm64-v8a", "x86_64", "x86" };
        JSONObject universal = null, mine = null;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject a = assets.optJSONObject(i);
            if (a == null) continue;
            String name = a.optString("name").toLowerCase(Locale.ROOT);
            if (!name.endsWith(".apk") || a.optString("browser_download_url").isEmpty()) continue;
            if (!abi.isEmpty() && name.contains(abi)) { if (mine == null) mine = a; continue; }
            boolean other = false;
            for (String x : abis) if (name.contains(x)) other = true;
            if (!other && universal == null) universal = a;
        }
        return mine != null ? mine : universal;
    }

    /* 1.2.10 > 1.2.9; missing parts count as 0. */
    static int compare(String a, String b) {
        String[] x = a.split("[^0-9]+"), y = b.split("[^0-9]+");
        int n = Math.max(x.length, y.length);
        for (int i = 0; i < n; i++) {
            long p = i < x.length && !x[i].isEmpty() ? Long.parseLong(x[i]) : 0;
            long q = i < y.length && !y[i].isEmpty() ? Long.parseLong(y[i]) : 0;
            if (p != q) return p > q ? 1 : -1;
        }
        return 0;
    }

    private static JSONObject copy(JSONObject o) {
        try {
            return new JSONObject(o.toString());
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    /* ------------------------------------------------------------- download */

    private static JSONObject download() throws PortalException {
        JSONObject c = check(false);
        if (!c.optBoolean("available")) throw new PortalException("Ya tienes la versión más reciente");
        synchronized (AppUpdate.class) {
            if ("downloading".equals(state)) return Js.o("state", state);
            File dir = new File(app.getCacheDir(), "update");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new PortalException("No se pudo preparar la descarga");
            final File target = new File(dir, "OpenTV-" + safe(c.optString("latest")) + ".apk");
            // Older downloads of other versions go.
            File[] old = dir.listFiles();
            for (int i = 0; old != null && i < old.length; i++) {
                String n = old[i].getName();
                if (!n.equals(target.getName()) && !n.equals(target.getName() + ".part")) old[i].delete();
            }
            final String url = c.optString("url");
            final long size = c.optLong("size");
            apk = target;
            total = size;
            error = "";
            if (target.isFile() && (size <= 0 || target.length() == size)) {
                state = "ready";
                bytes = target.length();
                return Js.o("state", state);
            }
            state = "downloading";
            bytes = 0;
            worker = new Thread(() -> run(url, target, size), "opentv-update");
            worker.setDaemon(true);
            worker.start();
            return Js.o("state", state);
        }
    }

    private static String safe(String v) {
        String s = v.replaceAll("[^0-9A-Za-z._-]", "");
        return s.isEmpty() ? "nueva" : s;
    }

    private static void run(String url, File target, long size) {
        File part = new File(target.getPath() + ".part");
        String err = null;
        try {
            long have = part.isFile() ? part.length() : 0;
            if (size > 0 && have > size) { part.delete(); have = 0; }
            for (int redirects = 0; ; redirects++) {
                Http.Request r = request(url, "application/octet-stream");
                if (have > 0) r.headers.put("Range", "bytes=" + have + "-");
                r.readTimeout = 30000;
                Http.Response up = Http.execute(r);
                try {
                    if (up.status >= 300 && up.status < 400 && up.header("location") != null && redirects < MAX_REDIRECTS) {
                        url = Http.Url.resolve(url, up.header("location"));
                        continue;
                    }
                    if (up.status == 416 && have > 0) break;   // already complete
                    if (up.status != 200 && up.status != 206) throw new IOException("respuesta " + up.status);
                    if (up.status == 200) have = 0;
                    Matcher m = TOTAL.matcher(String.valueOf(up.header("content-range")));
                    Long length = Js.parseInt(up.header("content-length"));
                    long t = m.find() ? Long.parseLong(m.group(1)) : (length == null ? 0 : have + length);
                    synchronized (AppUpdate.class) {
                        if (t > 0) total = t;
                    }
                    bytes = have;
                    byte[] buf = new byte[64 * 1024];
                    try (OutputStream out = new FileOutputStream(part, have > 0)) {
                        int n;
                        while ((n = up.body.read(buf)) != -1) {
                            out.write(buf, 0, n);
                            bytes += n;
                        }
                    }
                } finally {
                    up.abort();
                }
                break;
            }
            if (size > 0 && part.length() != size) {
                part.delete();
                throw new IOException("tamaño " + part.length() + " en vez de " + size);
            }
            target.delete();
            if (!part.renameTo(target)) throw new IOException("no se pudo guardar el APK");
        } catch (Exception e) {
            Log.w(TAG, "actualización: descarga: " + e);
            err = "No se pudo descargar la actualización. Vuelve a intentarlo.";
        }
        synchronized (AppUpdate.class) {
            worker = null;
            if (err != null) {
                state = "error";
                error = err;
            } else {
                state = "ready";
                bytes = target.length();
                total = bytes;
            }
        }
    }

    private static synchronized JSONObject status() {
        if ("ready".equals(state) && (apk == null || !apk.isFile())) state = "idle";
        return Js.o("state", state, "bytes", bytes, "total", total, "error", error);
    }

    /* -------------------------------------------------------------- install */

    private static JSONObject install() throws PortalException {
        File file;
        synchronized (AppUpdate.class) {
            file = apk;
            if (!"ready".equals(state) || file == null || !file.isFile()) throw new PortalException("La actualización aún no está descargada");
        }
        String pkg = app.getPackageName();
        if (Build.VERSION.SDK_INT >= 26 && !app.getPackageManager().canRequestPackageInstalls()) {
            // The viewer allows OpenTV to install apps, then asks again.
            Intent allow = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + pkg))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                app.startActivity(allow);
                return Js.o("state", "needs-permission");
            } catch (ActivityNotFoundException e) {
                // Fire TV and some TVs have no such screen: the switch lives in
                // their own settings (Mi Fire TV > Opciones para desarrolladores).
                return Js.o("returnValue", false, "state", "needs-permission",
                    "errorText", "Activa \"Apps de origen desconocido\" para OpenTV en Configuración");
            }
        }
        Intent intent;
        if (Build.VERSION.SDK_INT >= 24) {
            Uri uri = FileProvider.getUriForFile(app, pkg + ".fileprovider", file);
            intent = new Intent(Intent.ACTION_INSTALL_PACKAGE)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } else {
            // Before Android 7 the installer only reads file:// links.
            file.setReadable(true, false);
            file.getParentFile().setExecutable(true, false);
            app.getCacheDir().setExecutable(true, false);
            intent = new Intent(Intent.ACTION_VIEW).setDataAndType(Uri.fromFile(file), "application/vnd.android.package-archive");
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true);
        try {
            app.startActivity(intent);
        } catch (ActivityNotFoundException e) {
            try {
                app.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(intent.getData(), intent.getType())
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (ActivityNotFoundException e2) {
                throw new PortalException("Este aparato no permite instalar la actualización desde la app");
            }
        }
        return Js.o("state", "installing");
    }

    /* ----------------------------------------------------------------- http */

    private static Http.Request request(String url, String accept) throws Exception {
        Http.Url u = Http.Url.parse(url);
        boolean secure = "https:".equals(u.protocol);
        if (u.hostname.isEmpty() || !(secure || "http:".equals(u.protocol))) throw new IOException("enlace no válido");
        Http.Request r = new Http.Request();
        r.secure = secure;
        r.connectHost = Dnsx.prepare(u.hostname);
        if (r.connectHost.isEmpty()) r.connectHost = u.hostname;
        r.port = u.port.isEmpty() ? (secure ? 443 : 80) : Integer.parseInt(u.port);
        r.tlsName = u.hostname;
        r.path = u.path;
        r.connectTimeout = 15000;
        r.readTimeout = 20000;
        r.headers.put("User-Agent", "OpenTV");
        r.headers.put("Accept", accept);
        r.headers.put("Host", u.host());
        return r;
    }

    private static byte[] get(String url, String accept, int max) throws Exception {
        for (int redirects = 0; ; redirects++) {
            Http.Response res = Http.execute(request(url, accept));
            try {
                if (res.status >= 300 && res.status < 400 && res.header("location") != null && redirects < MAX_REDIRECTS) {
                    url = Http.Url.resolve(url, res.header("location"));
                    continue;
                }
                if (res.status != 200) throw new IOException("respuesta " + res.status);
                return res.readAll(max);
            } finally {
                res.abort();
            }
        }
    }
}
