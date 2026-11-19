package com.techpoint.opentv;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.techpoint.opentv.service.DownloadsForegroundService;
import com.techpoint.opentv.service.OpenTvService;

public class MainActivity extends BridgeActivity {
    private static final int REQUEST_NOTIFICATIONS = 7301;
    private static final String PREFS = "opentv_android";
    private static final String ASKED_NOTIFICATIONS = "askedNotifications";
    /* Told to the page when the app is opened from a download notification.
       The flag is for a page that registers its listener after the event. */
    private static final String OPEN_DOWNLOADS_JS =
        "window.__opentvOpenDownloads=true;window.dispatchEvent(new CustomEvent('opentv:open-downloads'));";

    private boolean pageLoaded;
    private boolean openDownloadsPending;
    private Runnable downloadStartHook;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // The OpenTV service (M3U, addon sources + media proxy on 127.0.0.1:8910) starts
        // before the page loads; binding and the first DoH lookups stay off
        // the main thread.
        final android.content.Context app = getApplicationContext();
        new Thread(() -> OpenTvService.start(app), "opentv-start").start();
        // Native video player (ExoPlayer) for ui/js/native-player.js.
        registerPlugin(NativePlayerPlugin.class);
        super.onCreate(savedInstanceState);
        final SizedImages images = new SizedImages(getCacheDir());
        // Images asked at their display size (https://opentv-img.local/i?…)
        // are answered here; everything else goes to Capacitor as before.
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (SizedImages.HOST.equals(url.getHost())) { return images.serve(url); }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                pageLoaded = true;
                if (openDownloadsPending) {
                    openDownloadsPending = false;
                    // A moment for the page to finish booting.
                    view.postDelayed(() -> view.evaluateJavascript(OPEN_DOWNLOADS_JS, null), 800);
                }
            }
        });
        // First download: ask for the notification permission (Android 13+).
        final MainActivity self = this;
        downloadStartHook = () -> runOnUiThread(self::askNotificationsOnce);
        OpenTvService.onDownloadStart = downloadStartHook;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent == null || !intent.getBooleanExtra(DownloadsForegroundService.EXTRA_OPEN_DOWNLOADS, false)) return;
        // Handled once (not again after a rotation or a recreate).
        intent.removeExtra(DownloadsForegroundService.EXTRA_OPEN_DOWNLOADS);
        if (pageLoaded && bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().evaluateJavascript(OPEN_DOWNLOADS_JS, null);
        } else {
            openDownloadsPending = true;
        }
    }

    private void askNotificationsOnce() {
        if (Build.VERSION.SDK_INT < 33 || isFinishing()) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (prefs.getBoolean(ASKED_NOTIFICATIONS, false)) return;
        prefs.edit().putBoolean(ASKED_NOTIFICATIONS, true).apply();
        // Denied: the downloads run all the same, without the notification.
        ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQUEST_NOTIFICATIONS);
    }

    @Override
    public void onDestroy() {
        if (OpenTvService.onDownloadStart == downloadStartHook) OpenTvService.onDownloadStart = null;
        // Leaving the app (not a rotation): drop the streamed torrent and its
        // cache; running downloads go on under their foreground service.
        if (isFinishing()) OpenTvService.shutdown();
        super.onDestroy();
    }
}
