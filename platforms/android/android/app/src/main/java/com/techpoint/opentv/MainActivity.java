package com.techpoint.opentv;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.techpoint.opentv.service.OpenTvService;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // The OpenTV service (portal + media proxy on 127.0.0.1:8910) starts
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
        });
    }
}
