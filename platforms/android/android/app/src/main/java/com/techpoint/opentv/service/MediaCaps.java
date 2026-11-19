package com.techpoint.opentv.service;

import android.app.UiModeManager;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Point;
import android.hardware.display.DisplayManager;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.os.Build;
import android.util.Log;
import android.view.Display;

import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.common.util.Util;
import androidx.media3.exoplayer.audio.AudioCapabilities;

import org.json.JSONObject;

import java.util.Locale;

/*
 * What this device can play, for choosing between the sources of a title
 * (ping -> media). Worked out once per process: the codec list is slow to
 * build on a TV stick (tens of ms) and does not change.
 *
 *   dts, truehd, eac3, ac3   a decoder, or HDMI passthrough to a receiver
 *                            or TV that decodes it (what ExoPlayer would use)
 *   hevc, hevc10, av1        a hardware video decoder (software HEVC/AV1
 *                            cannot keep up with 1080p on these devices);
 *                            hevc10 = HEVC Main10 (needed by HDR and most
 *                            4K/10-bit releases)
 *   uhd                      the display offers a 3840-wide mode
 *   hdr                      the display reports an HDR format
 */
@OptIn(markerClass = UnstableApi.class)
final class MediaCaps {
    private MediaCaps() {}

    private static final String TAG = "OpenTV";
    // MediaCodecInfo.CodecProfileLevel values (some need newer SDKs to name).
    private static final int HEVC_MAIN10 = 0x2;
    private static final int HEVC_MAIN10_HDR10 = 0x1000;
    private static final int HEVC_MAIN10_HDR10_PLUS = 0x2000;

    private static Context app;
    private static JSONObject cached;

    /* From OpenTvService.start (a background thread): works it out ahead of
       the page's first ping. */
    static void init(Context context) {
        setContext(context);
        get();
    }

    /* First thing on start, so an early ping already sees the displays. */
    static void setContext(Context context) {
        app = context.getApplicationContext();
    }

    /* A copy, so callers may add to it. */
    static synchronized JSONObject get() {
        JSONObject caps = cached;
        if (caps == null) {
            caps = detect();
            if (app != null) cached = caps;   // without a context: displays unknown, ask again
        }
        try {
            return new JSONObject(caps.toString());
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static JSONObject detect() {
        long t0 = System.currentTimeMillis();
        boolean dts = false, truehd = false, eac3 = false, ac3 = false;
        boolean hevc = false, hevc10 = false, av1 = false;
        try {
            MediaCodecInfo[] list = new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos();
            for (MediaCodecInfo info : list) {
                if (info.isEncoder()) continue;
                boolean hardware = isHardware(info);
                for (String type : info.getSupportedTypes()) {
                    String t = type.toLowerCase(Locale.ROOT);
                    switch (t) {
                        case "audio/vnd.dts":
                        case "audio/vnd.dts.hd": dts = true; break;
                        case "audio/true-hd": truehd = true; break;
                        case "audio/eac3":
                        case "audio/eac3-joc": eac3 = true; break;
                        case "audio/ac3": ac3 = true; break;
                        case "video/hevc":
                            if (!hardware) break;
                            hevc = true;
                            if (!hevc10 && hasMain10(info, type)) hevc10 = true;
                            break;
                        case "video/av01": if (hardware) av1 = true; break;
                        default: break;
                    }
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "media: lista de códecs: " + t);
        }
        // Passthrough: the audio goes undecoded over HDMI to a receiver or TV.
        if (app != null) {
            try {
                AudioCapabilities caps = AudioCapabilities.getCapabilities(app);
                if (caps.supportsEncoding(C.ENCODING_DTS) || caps.supportsEncoding(C.ENCODING_DTS_HD)) dts = true;
                if (caps.supportsEncoding(C.ENCODING_DOLBY_TRUEHD)) truehd = true;
                if (caps.supportsEncoding(C.ENCODING_E_AC3) || caps.supportsEncoding(C.ENCODING_E_AC3_JOC)) eac3 = true;
                if (caps.supportsEncoding(C.ENCODING_AC3)) ac3 = true;
            } catch (Throwable t) {
                Log.w(TAG, "media: passthrough: " + t);
            }
        }
        boolean uhd = false, hdr = false;
        Display display = display();
        if (display != null) {
            uhd = uhdDisplay(display);
            hdr = hdrDisplay(display);
        }
        JSONObject out = Js.o("dts", dts, "truehd", truehd, "eac3", eac3, "ac3", ac3,
            "hevc", hevc, "hevc10", hevc10, "av1", av1, "uhd", uhd, "hdr", hdr);
        Log.i(TAG, "media: " + out + " (" + (System.currentTimeMillis() - t0) + " ms)");
        return out;
    }

    private static boolean isHardware(MediaCodecInfo info) {
        if (Build.VERSION.SDK_INT >= 29) return info.isHardwareAccelerated();
        String n = info.getName().toLowerCase(Locale.ROOT);
        return !(n.startsWith("omx.google.") || n.startsWith("c2.android.") || n.startsWith("omx.ffmpeg.")
            || n.contains(".sw.") || n.endsWith(".sw"));
    }

    private static boolean hasMain10(MediaCodecInfo info, String type) {
        try {
            for (MediaCodecInfo.CodecProfileLevel pl : info.getCapabilitiesForType(type).profileLevels) {
                if (pl.profile == HEVC_MAIN10 || pl.profile == HEVC_MAIN10_HDR10 || pl.profile == HEVC_MAIN10_HDR10_PLUS) return true;
            }
        } catch (Throwable ignored) { /* no capabilities: say no */ }
        return false;
    }

    private static Display display() {
        if (app == null) return null;
        try {
            DisplayManager dm = (DisplayManager) app.getSystemService(Context.DISPLAY_SERVICE);
            return dm == null ? null : dm.getDisplay(Display.DEFAULT_DISPLAY);
        } catch (Throwable t) {
            return null;
        }
    }

    private static boolean isTv() {
        try {
            UiModeManager ui = (UiModeManager) app.getSystemService(Context.UI_MODE_SERVICE);
            if (ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) return true;
            return app.getPackageManager().hasSystemFeature("android.software.leanback");
        } catch (Throwable t) {
            return false;
        }
    }

    private static boolean uhdDisplay(Display display) {
        try {
            if (Build.VERSION.SDK_INT >= 23) {
                for (Display.Mode m : display.getSupportedModes()) {
                    if (Math.max(m.getPhysicalWidth(), m.getPhysicalHeight()) >= 3840) return true;
                }
            }
            // TVs often hide their real output mode from the Display API (the
            // UI renders at 1080p on a 4K panel); ExoPlayer reads it from the
            // vendor properties (sys.display-size, Sony, NVIDIA...).
            if (isTv()) {
                Point p = Util.getCurrentDisplayModeSize(app, display);
                if (Math.max(p.x, p.y) >= 3840) return true;
            }
        } catch (Throwable t) {
            Log.w(TAG, "media: modos de pantalla: " + t);
        }
        return false;
    }

    @SuppressWarnings("deprecation")
    private static boolean hdrDisplay(Display display) {
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                for (Display.Mode m : display.getSupportedModes()) {
                    if (m.getSupportedHdrTypes().length > 0) return true;
                }
            }
            if (Build.VERSION.SDK_INT >= 24) {
                Display.HdrCapabilities caps = display.getHdrCapabilities();
                return caps != null && caps.getSupportedHdrTypes().length > 0;
            }
        } catch (Throwable t) {
            Log.w(TAG, "media: HDR: " + t);
        }
        return false;
    }
}
