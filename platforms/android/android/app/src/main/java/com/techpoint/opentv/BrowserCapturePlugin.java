package com.techpoint.opentv;

import android.annotation.SuppressLint;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import com.techpoint.opentv.service.NetGuard;

import java.io.ByteArrayInputStream;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/*
 * Offscreen WebView capture for JS plugins (kino.browser.capture / load).
 * Intercepts matching media requests (.m3u8 / .mp4 / .mpd) or returns the
 * rendered HTML + cookies, and always destroys the temporary WebView right
 * away so memory stays flat on 1 GB Fire TV devices.
 */
@CapacitorPlugin(name = "BrowserCapture")
public class BrowserCapturePlugin extends Plugin {
    /* Only one offscreen WebView may live at a time so 1 GB Fire TV devices
       never allocate two concurrent browser instances. */
    private Runnable activeCancel = null;

    /* What ends a capture (one result, once). Its own interface:
       java.util.function.Consumer does not exist before Android 7. */
    private interface Done { void finish(JSObject result); }

    @SuppressLint("SetJavaScriptEnabled")
    @PluginMethod
    public void capture(final PluginCall call) {
        final String targetUrl = call.getString("url", "").trim();
        if (!(targetUrl.startsWith("http://") || targetUrl.startsWith("https://"))) {
            call.resolve(errObj("URL no válida"));
            return;
        }
        Uri parsed = Uri.parse(targetUrl);
        String host = parsed.getHost() != null ? parsed.getHost().toLowerCase(Locale.ROOT) : "";
        // Never this device; the home network only when the viewer allowed
        // that plugin (NetGuard, the same rules as its requests). Plugin
        // calls run off the UI thread, so the name may be resolved here.
        final boolean allowLan = Boolean.TRUE.equals(call.getBoolean("allowLan", false));
        String refused = NetGuard.refusal(host, allowLan);
        if (refused != null) {
            call.resolve(errObj(refused));
            return;
        }
        final Map<String, Boolean> hostVerdicts = new java.util.concurrent.ConcurrentHashMap<>();
        hostVerdicts.put(host, Boolean.TRUE);

        final int timeoutMs = Math.min(25000, Math.max(2000, call.getInt("timeoutMs", 15000)));
        final boolean returnHtml = Boolean.TRUE.equals(call.getBoolean("returnHtml", false));
        final int waitMs = Math.min(5000, Math.max(0, call.getInt("waitMs", 350)));
        final String script = call.getString("script", "");
        final String matchSource = call.getString("matchSource", "");
        final String matchFlags = call.getString("matchFlags", "i");
        final JSObject reqHeadersObj = call.getObject("headers", new JSObject());

        Pattern tmpPat = Pattern.compile("\\.(m3u8|mp4|mpd)(\\?|$)", Pattern.CASE_INSENSITIVE);
        if (matchSource != null && !matchSource.isEmpty()) {
            try {
                int flags = matchFlags != null && matchFlags.contains("i") ? Pattern.CASE_INSENSITIVE : 0;
                tmpPat = Pattern.compile(matchSource, flags);
            } catch (Exception ignored) { /* keep default */ }
        }
        final Pattern matchPattern = tmpPat;

        final Map<String, String> extraHeaders = new HashMap<>();
        if (reqHeadersObj != null) {
            Iterator<String> it = reqHeadersObj.keys();
            while (it.hasNext()) {
                String k = it.next();
                String v = reqHeadersObj.optString(k, null);
                if (v != null && !v.contains("\n") && !v.contains("\r")) {
                    extraHeaders.put(k, v);
                }
            }
        }

        final Handler main = new Handler(Looper.getMainLooper());
        main.post(() -> {
            if (activeCancel != null) {
                try { activeCancel.run(); } catch (Exception ignored) {}
                activeCancel = null;
            }
            if (getContext() == null) {
                call.resolve(errObj("Contexto no disponible"));
                return;
            }
            final WebView wv = new WebView(getContext());
            final AtomicBoolean done = new AtomicBoolean(false);
            final Runnable[] timeoutHolder = new Runnable[1];

            final Done finish = (result) -> {
                if (!done.compareAndSet(false, true)) return;
                if (timeoutHolder[0] != null) main.removeCallbacks(timeoutHolder[0]);
                final String lastUrl = result != null ? result.getString("url", targetUrl) : targetUrl;
                main.post(() -> {
                    activeCancel = null;
                    // The page's cookies were handed to the plugin (they go in
                    // its own jar): out of the app's WebView store.
                    forgetCookies(targetUrl);
                    if (lastUrl != null && !lastUrl.equals(targetUrl)) forgetCookies(lastUrl);
                    try {
                        wv.stopLoading();
                        wv.setWebViewClient(new WebViewClient());
                        wv.loadUrl("about:blank");
                        wv.destroy();
                    } catch (Exception ignored) { /* destroyed */ }
                });
                call.resolve(result);
            };
            activeCancel = () -> finish.finish(errObj("Captura reemplazada"));

            WebSettings s = wv.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setMediaPlaybackRequiresUserGesture(false);
            s.setLoadsImagesAutomatically(false);
            s.setBlockNetworkImage(true);
            String customUa = extraHeaders.remove("User-Agent");
            if (customUa == null) customUa = extraHeaders.remove("user-agent");
            if (customUa != null && !customUa.isEmpty()) {
                s.setUserAgentString(customUa);
            }
            CookieManager cm = CookieManager.getInstance();
            cm.setAcceptCookie(true);
            cm.setAcceptThirdPartyCookies(wv, true);

            wv.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    // Every request of the page (redirects, scripts, media)
                    // under the same rules; runs off the UI thread.
                    if (request != null && request.getUrl() != null) {
                        String scheme = request.getUrl().getScheme() == null ? "" : request.getUrl().getScheme().toLowerCase(Locale.ROOT);
                        String reqHost = request.getUrl().getHost() == null ? "" : request.getUrl().getHost().toLowerCase(Locale.ROOT);
                        if (scheme.equals("http") || scheme.equals("https")) {
                            Boolean ok = hostVerdicts.get(reqHost);
                            if (ok == null) {
                                ok = NetGuard.refusal(reqHost, allowLan) == null;
                                hostVerdicts.put(reqHost, ok);
                            }
                            if (!ok) return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden",
                                new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
                        }
                    }
                    if (!done.get() && !returnHtml && request != null && request.getUrl() != null) {
                        String u = request.getUrl().toString();
                        if (matchPattern.matcher(u).find()) {
                            JSObject out = new JSObject();
                            out.put("ok", true);
                            out.put("url", u);
                            JSObject hObj = new JSObject();
                            Map<String, String> rh = request.getRequestHeaders();
                            if (rh != null) {
                                for (Map.Entry<String, String> e : rh.entrySet()) {
                                    hObj.put(e.getKey(), e.getValue());
                                }
                            }
                            out.put("headers", hObj);
                            String ck = cm.getCookie(u);
                            out.put("cookies", ck != null ? ck : "");
                            finish.finish(out);
                        }
                    }
                    return super.shouldInterceptRequest(view, request);
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    if (done.get()) return;
                    if (script != null && !script.isEmpty()) {
                        view.evaluateJavascript(script, null);
                    }
                    if (returnHtml) {
                        main.postDelayed(() -> {
                            if (done.get()) return;
                            view.evaluateJavascript(
                                "(function(){return document.documentElement?document.documentElement.outerHTML:'';})()",
                                (rawJson) -> {
                                    if (done.get()) return;
                                    String html = "";
                                    if (rawJson != null && !rawJson.equals("null")) {
                                        try { html = new JSONObject("{\"v\":" + rawJson + "}").optString("v", ""); }
                                        catch (JSONException ignored) { html = rawJson; }
                                    }
                                    String finalUrl = view.getUrl() != null ? view.getUrl() : targetUrl;
                                    JSObject out = new JSObject();
                                    out.put("ok", true);
                                    out.put("url", finalUrl);
                                    out.put("html", html);
                                    out.put("headers", new JSObject());
                                    String ck = cm.getCookie(finalUrl);
                                    out.put("cookies", ck != null ? ck : "");
                                    finish.finish(out);
                                }
                            );
                        }, waitMs);
                    }
                }
            });

            timeoutHolder[0] = () -> finish.finish(errObj("Tiempo agotado esperando el vídeo"));
            main.postDelayed(timeoutHolder[0], timeoutMs);
            if (extraHeaders.isEmpty()) {
                wv.loadUrl(targetUrl);
            } else {
                wv.loadUrl(targetUrl, extraHeaders);
            }
        });
    }

    @PluginMethod
    public void openExternalPlayer(final PluginCall call) {
        final String url = call.getString("url", "").trim();
        final String title = call.getString("title", "OpenTV");
        if (!(url.startsWith("http://") || url.startsWith("https://"))) {
            call.resolve(errObj("URL no válida"));
            return;
        }
        try {
            android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW);
            intent.setDataAndType(Uri.parse(url), "video/*");
            intent.putExtra("title", title);
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            android.content.Intent chooser = android.content.Intent.createChooser(intent, "Abrir o enviar vídeo…");
            chooser.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            JSObject out = new JSObject();
            out.put("ok", true);
            out.put("app", "reproductor externo");
            call.resolve(out);
        } catch (Exception e) {
            call.resolve(errObj("No hay reproductor externo disponible"));
        }
    }

    private static JSObject errObj(String msg) {
        JSObject o = new JSObject();
        o.put("ok", false);
        o.put("error", msg);
        return o;
    }

    /* Expires the cookies the hidden page left for this address in the
       shared WebView store (the app's WebView uses the same one). */
    private static void forgetCookies(String url) {
        try {
            CookieManager cm = CookieManager.getInstance();
            String all = cm.getCookie(url);
            if (all == null || all.isEmpty()) return;
            String host = Uri.parse(url).getHost();
            for (String part : all.split(";")) {
                String name = part.trim();
                int eq = name.indexOf('=');
                if (eq > 0) name = name.substring(0, eq).trim();
                if (name.isEmpty()) continue;
                cm.setCookie(url, name + "=; Max-Age=0; Path=/");
                if (host != null) cm.setCookie(url, name + "=; Max-Age=0; Path=/; Domain=" + host);
            }
            cm.flush();
        } catch (Exception ignored) { /* nothing to forget */ }
    }
}
