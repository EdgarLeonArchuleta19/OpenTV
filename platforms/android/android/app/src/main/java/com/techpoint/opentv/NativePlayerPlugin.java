package com.techpoint.opentv;

import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.Timeline;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.VideoSize;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/*
 * Native video player (AndroidX Media3 / ExoPlayer) for the shared web
 * interface. One player and one SurfaceView, placed BEHIND the transparent
 * WebView, so the page keeps drawing every control (seek bar, subtitles,
 * hints) on top of a hardware-decoded picture.
 *
 * The page side is ui/js/native-player.js: it makes the player's <video>
 * elements talk to this plugin and tells it where the video sits on the
 * page (setRect, in device pixels of the WebView).
 *
 * Every event carries the generation "g" of the load that produced it, so
 * the page drops events of a title or channel it already left.
 */
@CapacitorPlugin(name = "NativePlayer")
@OptIn(markerClass = UnstableApi.class)
public class NativePlayerPlugin extends Plugin {
    private static final String TAG = "OpenTV.Player";
    private static final int TICK_MS = 250;
    private static final int APP_BACKGROUND = 0xFF0E0E11;

    private final Handler main = new Handler(Looper.getMainLooper());
    private ExoPlayer player;
    private FrameLayout layer;     // full size, behind the WebView
    private FrameLayout box;       // the video's rectangle on the page
    private SurfaceView surface;
    private int webBackground = APP_BACKGROUND;

    private int gen = 0;
    private int seekSeq = 0;
    private boolean seeking = false;
    private boolean live = false;
    private int pendingAudio = -1;
    private int videoW = 0, videoH = 0;
    private float pixelRatio = 1f;
    private int rectX = 0, rectY = 0, rectW = 0, rectH = 0;
    private String fit = "contain";
    private boolean wantVisible = false;
    private boolean loaded = false;
    private boolean resumeOnForeground = false;
    private int retries = 0;
    private String altUrl = null;   // HLS version of a TS title (fallback)
    private boolean unseekable = false;   // that TS file turned out not seekable
    private long startMs = 0;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            emitTime();
            if (player != null && player.isPlaying()) main.postDelayed(this, TICK_MS);
        }
    };
    private final Runnable hideLater = () -> showLayer(false);

    // ---------------------------------------------------------------- setup

    private void ensurePlayer() {
        if (player != null) return;
        android.content.Context ctx = getContext();
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
            .setUserAgent("OpenTV/1 (Android) ExoPlayer")
            .setConnectTimeoutMs(10000)
            .setReadTimeoutMs(20000)
            .setAllowCrossProtocolRedirects(true);
        DefaultMediaSourceFactory sources = new DefaultMediaSourceFactory(new DefaultDataSource.Factory(ctx, http));
        // A 1 GB Fire TV: a moderate buffer (seconds, and a byte cap).
        DefaultLoadControl load = new DefaultLoadControl.Builder()
            .setBufferDurationsMs(20000, 40000, 1500, 3000)
            .setTargetBufferBytes(48 * 1024 * 1024)
            .setPrioritizeTimeOverSizeThresholds(false)
            .build();
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(ctx).setEnableDecoderFallback(true);
        player = new ExoPlayer.Builder(ctx, renderers)
            .setMediaSourceFactory(sources)
            .setLoadControl(load)
            .build();
        player.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true);
        // The page draws the subtitles (SRT overlay): no native text track.
        player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
            .setPreferredAudioLanguages("es", "spa")
            .build());
        player.addListener(listener);

        WebView web = getBridge().getWebView();
        ViewGroup parent = (ViewGroup) web.getParent();
        String configured = getBridge().getConfig().getBackgroundColor();
        if (configured != null) {
            try { webBackground = Color.parseColor(configured); } catch (IllegalArgumentException ignored) { /* default */ }
        }
        layer = new FrameLayout(getActivity());
        layer.setBackgroundColor(webBackground);
        layer.setVisibility(View.GONE);
        box = new FrameLayout(getActivity());
        box.setBackgroundColor(Color.BLACK);
        surface = new SurfaceView(getActivity());
        box.addView(surface, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER));
        layer.addView(box, new FrameLayout.LayoutParams(0, 0));
        parent.addView(layer, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        player.setVideoSurfaceView(surface);
    }

    private void showLayer(boolean show) {
        if (layer == null) return;
        main.removeCallbacks(hideLater);
        WebView web = getBridge().getWebView();
        if (show) {
            if (layer.getVisibility() != View.VISIBLE) {
                web.setBackgroundColor(Color.TRANSPARENT);
                layer.setVisibility(View.VISIBLE);
            }
        } else if (layer.getVisibility() != View.GONE) {
            layer.setVisibility(View.GONE);
            web.setBackgroundColor(webBackground);
        }
    }

    private void updateVisibility() {
        boolean show = wantVisible && loaded && rectW > 0 && rectH > 0;
        if (show) showLayer(true);
        else if (layer != null && layer.getVisibility() == View.VISIBLE) {
            // A stop followed at once by the next title or channel keeps the
            // surface (no black flash, no surface re-creation).
            main.removeCallbacks(hideLater);
            main.postDelayed(hideLater, 150);
        }
    }

    private void layoutBox() {
        if (box == null) return;
        WebView web = getBridge().getWebView();
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) box.getLayoutParams();
        int x = rectX + web.getLeft(), y = rectY + web.getTop();
        if (lp.width != rectW || lp.height != rectH || lp.leftMargin != x || lp.topMargin != y) {
            lp.width = rectW; lp.height = rectH; lp.leftMargin = x; lp.topMargin = y;
            box.setLayoutParams(lp);
        }
        layoutSurface();
    }

    private void layoutSurface() {
        if (surface == null) return;
        int w = ViewGroup.LayoutParams.MATCH_PARENT, h = ViewGroup.LayoutParams.MATCH_PARENT;
        if (videoW > 0 && videoH > 0 && rectW > 0 && rectH > 0 && !"fill".equals(fit)) {
            float aspect = videoW * pixelRatio / videoH;
            float boxAspect = (float) rectW / rectH;
            boolean wider = aspect > boxAspect;
            if ("cover".equals(fit) ? !wider : wider) { w = rectW; h = Math.round(rectW / aspect); }
            else { h = rectH; w = Math.round(rectH * aspect); }
        }
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) surface.getLayoutParams();
        if (lp.width != w || lp.height != h) {
            lp.width = w; lp.height = h; lp.gravity = Gravity.CENTER;
            surface.setLayoutParams(lp);
        }
    }

    // --------------------------------------------------------------- events

    private void emit(JSObject o) {
        o.put("g", gen);
        notifyListeners("ev", o);
    }

    private void emitState() {
        if (player == null) return;
        JSObject o = new JSObject();
        o.put("t", "state");
        o.put("st", player.getPlaybackState());
        o.put("pwr", player.getPlayWhenReady());
        o.put("pl", player.isPlaying());
        emit(o);
    }

    private void emitExternal(boolean playWhenReady) {
        JSObject o = new JSObject();
        o.put("t", "ext");
        o.put("pwr", playWhenReady);
        emit(o);
    }

    private void emitTime() {
        if (player == null || !loaded) return;
        JSObject o = new JSObject();
        o.put("t", "time");
        // A live window slides: positions are given on the stream's own
        // timeline (they only grow, like a web player's currentTime).
        long offset = liveOffsetMs();
        o.put("s", seekSeq);
        o.put("p", (player.getCurrentPosition() + offset) / 1000.0);
        long dur = player.getDuration();
        o.put("d", dur == C.TIME_UNSET ? -1 : dur / 1000.0);
        o.put("o", offset / 1000.0);
        o.put("b", (player.getBufferedPosition() + offset) / 1000.0);
        o.put("dyn", isDynamic());
        emit(o);
    }

    private long liveOffsetMs() {
        if (player == null || !live) return 0;
        Timeline tl = player.getCurrentTimeline();
        if (tl.isEmpty()) return 0;
        Timeline.Window w = tl.getWindow(player.getCurrentMediaItemIndex(), new Timeline.Window());
        return w.isDynamic ? Math.max(0, w.getPositionInFirstPeriodMs()) : 0;
    }

    private boolean isDynamic() {
        if (player == null) return false;
        Timeline tl = player.getCurrentTimeline();
        if (tl.isEmpty()) return false;
        return tl.getWindow(player.getCurrentMediaItemIndex(), new Timeline.Window()).isDynamic;
    }

    private void emitTracks(Tracks tracks) {
        JSArray audio = new JSArray();
        JSArray video = new JSArray();
        for (Tracks.Group g : tracks.getGroups()) {
            if (g.getType() == C.TRACK_TYPE_AUDIO) {
                Format f = g.getTrackFormat(0);
                JSObject a = new JSObject();
                a.put("lang", f.language == null ? "" : f.language);
                a.put("label", f.label == null ? "" : f.label);
                a.put("ch", f.channelCount);
                a.put("sel", g.isSelected());
                a.put("ok", g.isSupported());
                audio.put(a);
            } else if (g.getType() == C.TRACK_TYPE_VIDEO) {
                for (int i = 0; i < g.length; i++) {
                    Format f = g.getTrackFormat(i);
                    if (!g.isTrackSupported(i)) continue;
                    JSObject v = new JSObject();
                    v.put("w", f.width);
                    v.put("h", f.height);
                    v.put("br", f.bitrate);
                    v.put("sel", g.isTrackSelected(i));
                    video.put(v);
                }
            }
        }
        JSObject o = new JSObject();
        o.put("t", "tracks");
        o.put("audio", audio);
        o.put("video", video);
        emit(o);
    }

    private static int htmlErrorCode(PlaybackException e) {
        int c = e.errorCode;
        // MediaError codes: 2 network, 3 decode, 4 source not supported.
        if (c >= 2000 && c < 3000) return 2;
        if (c >= 3000 && c < 4000) return 4;               // parsing
        if (c == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED ||
            c == PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES) return 4;
        if (c >= 4000 && c < 5000) return 3;               // decoding
        return 4;
    }

    private final Player.Listener listener = new Player.Listener() {
        @Override
        public void onPlaybackStateChanged(int state) {
            // An MPEG-TS file whose length ExoPlayer cannot work out cannot
            // seek. It keeps playing as it is from the start; a resume (or,
            // later, a seek) moves to the service's indexed HLS version.
            if (state == Player.STATE_READY && altUrl != null && player != null) {
                if (player.isCurrentMediaItemSeekable()) altUrl = null;
                else {
                    unseekable = true;
                    if (startMs > 3000) { switchToAlt(startMs); return; }
                }
            }
            emitTime();
            emitState();
            if (state == Player.STATE_READY && seeking) {
                seeking = false;
                JSObject o = new JSObject();
                o.put("t", "seeked");
                o.put("s", seekSeq);
                emit(o);
            }
        }

        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            emitState();
            main.removeCallbacks(tick);
            if (isPlaying) { retries = 0; main.postDelayed(tick, TICK_MS); }
            else emitTime();
            if (surface != null) surface.setKeepScreenOn(isPlaying);
        }

        @Override
        public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
            emitState();
            // Not asked by the page (audio focus, headphones out...): tell it.
            if (reason != Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST) emitExternal(playWhenReady);
        }

        @Override
        public void onPlayerError(@NonNull PlaybackException error) {
            Log.w(TAG, "playback error " + error.getErrorCodeName(), error);
            // A live channel paused for long fell out of its window: rejoin it.
            if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW && player != null) {
                player.seekToDefaultPosition();
                player.prepare();
                return;
            }
            // A network hiccup (or the previous channel's stream still being
            // torn down after a fast zap): try again twice before giving up.
            if (error.errorCode >= 2000 && error.errorCode < 3000 && retries < 2 && player != null) {
                retries++;
                final int g = gen;
                main.postDelayed(() -> { if (player != null && loaded && gen == g) player.prepare(); }, 700L * retries);
                return;
            }
            JSObject o = new JSObject();
            o.put("t", "error");
            o.put("code", htmlErrorCode(error));
            o.put("name", error.getErrorCodeName());
            o.put("msg", String.valueOf(error.getMessage()));
            emit(o);
        }

        @Override
        public void onVideoSizeChanged(@NonNull VideoSize size) {
            if (size.width <= 0 || size.height <= 0) return;
            videoW = size.width;
            videoH = size.height;
            pixelRatio = size.pixelWidthHeightRatio > 0 ? size.pixelWidthHeightRatio : 1f;
            layoutSurface();
            JSObject o = new JSObject();
            o.put("t", "size");
            o.put("w", Math.round(videoW * pixelRatio));
            o.put("h", videoH);
            emit(o);
        }

        @Override
        public void onRenderedFirstFrame() {
            JSObject o = new JSObject();
            o.put("t", "frame");
            emit(o);
        }

        @Override
        public void onTracksChanged(@NonNull Tracks tracks) {
            applyAudio(tracks);
            emitTracks(tracks);
        }

        @Override
        public void onTimelineChanged(@NonNull Timeline timeline, int reason) {
            emitTime();
        }
    };

    private void switchToAlt(long positionMs) {
        String alt = altUrl;
        altUrl = null;
        if (alt == null || player == null) return;
        Log.i(TAG, "TS without a duration: using the HLS route at " + positionMs + " ms");
        player.setMediaItem(new MediaItem.Builder().setUri(alt).setMimeType(MimeTypes.APPLICATION_M3U8)
            .setLiveConfiguration(new MediaItem.LiveConfiguration.Builder()
                .setMinPlaybackSpeed(1f).setMaxPlaybackSpeed(1f).build())
            .build(), Math.max(0, positionMs));
        player.prepare();
    }

    private void applyAudio(Tracks tracks) {
        if (player == null || pendingAudio < 0) return;
        int n = 0;
        for (Tracks.Group g : tracks.getGroups()) {
            if (g.getType() != C.TRACK_TYPE_AUDIO) continue;
            if (n++ != pendingAudio) continue;
            if (g.isSelected()) return;
            player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                .setOverrideForType(new TrackSelectionOverride(g.getMediaTrackGroup(), 0))
                .build());
            return;
        }
    }

    // ------------------------------------------------------------- methods

    @PluginMethod
    public void load(PluginCall call) {
        final String url = call.getString("url", "");
        final double start = call.getDouble("start", 0.0);
        final boolean autoplay = Boolean.TRUE.equals(call.getBoolean("autoplay", false));
        final boolean hls = Boolean.TRUE.equals(call.getBoolean("hls", false));
        final boolean isLive = Boolean.TRUE.equals(call.getBoolean("live", false));
        final int g = call.getInt("g", 0);
        final String alt = call.getString("alt", "");
        call.resolve();
        main.post(() -> {
            ensurePlayer();
            gen = g;
            retries = 0;
            seekSeq = 0;
            seeking = false;
            live = isLive;
            pendingAudio = -1;
            videoW = videoH = 0;
            pixelRatio = 1f;
            layoutSurface();
            MediaItem.Builder item = new MediaItem.Builder().setUri(url);
            if (hls) item.setMimeType(MimeTypes.APPLICATION_M3U8);
            if (!isLive) {
                // A title's playlist grows while the service indexes it: it is
                // not a live channel, so no live-edge start or speed tweaks.
                item.setLiveConfiguration(new MediaItem.LiveConfiguration.Builder()
                    .setMinPlaybackSpeed(1f).setMaxPlaybackSpeed(1f).build());
            }
            player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                .clearOverridesOfType(C.TRACK_TYPE_AUDIO)
                .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
                .build());
            altUrl = alt == null || alt.isEmpty() ? null : alt;
            unseekable = false;
            startMs = Math.max(0, Math.round(start * 1000));
            if (isLive) player.setMediaItem(item.build());
            else player.setMediaItem(item.build(), startMs);
            player.setPlayWhenReady(autoplay);
            player.prepare();
            loaded = true;
            updateVisibility();
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        call.resolve();
        main.post(() -> {
            if (player == null) return;
            if (player.getPlaybackState() == Player.STATE_ENDED) player.seekTo(0);
            if (player.getPlaybackState() == Player.STATE_IDLE && loaded) player.prepare();
            player.setPlayWhenReady(true);
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        call.resolve();
        main.post(() -> { if (player != null) player.setPlayWhenReady(false); });
    }

    @PluginMethod
    public void seek(PluginCall call) {
        final double t = call.getDouble("t", 0.0);
        final int s = call.getInt("s", 0);
        call.resolve();
        main.post(() -> {
            if (player == null || !loaded) return;
            seekSeq = s;
            long ms = Math.max(0, Math.round(t * 1000) - liveOffsetMs());
            if (altUrl != null && unseekable) {
                seeking = true;
                switchToAlt(ms);
                emitTime();
                return;
            }
            Timeline tl = player.getCurrentTimeline();
            if (!tl.isEmpty()) {
                Timeline.Window w = tl.getWindow(player.getCurrentMediaItemIndex(), new Timeline.Window());
                long d = w.getDurationMs();
                // Only the indexed part of a growing playlist can be reached.
                if (w.isDynamic && d != C.TIME_UNSET && d > 0) ms = Math.min(ms, Math.max(0, d - 1500));
            }
            seeking = true;
            player.seekTo(ms);
            emitTime();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        call.resolve();
        main.post(() -> {
            if (player == null) return;
            loaded = false;
            seeking = false;
            main.removeCallbacks(tick);
            player.stop();
            player.clearMediaItems();
            updateVisibility();
        });
    }

    @PluginMethod
    public void setRate(PluginCall call) {
        final float r = call.getFloat("r", 1f);
        call.resolve();
        main.post(() -> { if (player != null && r > 0) player.setPlaybackSpeed(r); });
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        final float v = call.getFloat("v", 1f);
        final boolean muted = Boolean.TRUE.equals(call.getBoolean("m", false));
        call.resolve();
        main.post(() -> { if (player != null) player.setVolume(muted ? 0f : Math.max(0f, Math.min(1f, v))); });
    }

    @PluginMethod
    public void setRect(PluginCall call) {
        final int x = call.getInt("x", 0), y = call.getInt("y", 0);
        final int w = call.getInt("w", 0), h = call.getInt("h", 0);
        final String f = call.getString("fit", "contain");
        final boolean show = Boolean.TRUE.equals(call.getBoolean("show", false));
        call.resolve();
        main.post(() -> {
            ensurePlayer();
            rectX = x; rectY = y; rectW = w; rectH = h;
            fit = f == null ? "contain" : f;
            wantVisible = show;
            layoutBox();
            updateVisibility();
        });
    }

    @PluginMethod
    public void selectAudio(PluginCall call) {
        final int i = call.getInt("i", -1);
        call.resolve();
        main.post(() -> {
            if (player == null) return;
            pendingAudio = i;
            applyAudio(player.getCurrentTracks());
        });
    }

    /* height 0 = automatic; otherwise the variant with that height. */
    @PluginMethod
    public void selectQuality(PluginCall call) {
        final int h = call.getInt("h", 0);
        call.resolve();
        main.post(() -> {
            if (player == null) return;
            TrackSelectionParameters.Builder b = player.getTrackSelectionParameters().buildUpon()
                .clearOverridesOfType(C.TRACK_TYPE_VIDEO);
            if (h > 0) {
                for (Tracks.Group g : player.getCurrentTracks().getGroups()) {
                    if (g.getType() != C.TRACK_TYPE_VIDEO) continue;
                    for (int i = 0; i < g.length; i++) {
                        if (g.getTrackFormat(i).height == h && g.isTrackSupported(i)) {
                            b.setOverrideForType(new TrackSelectionOverride(g.getMediaTrackGroup(), i));
                            break;
                        }
                    }
                }
            }
            player.setTrackSelectionParameters(b.build());
        });
    }

    // ------------------------------------------------------------ lifecycle

    @Override
    protected void handleOnPause() {
        main.post(() -> {
            if (player == null) return;
            resumeOnForeground = live && player.getPlayWhenReady();
            if (player.getPlayWhenReady()) {
                player.setPlayWhenReady(false);
                emitExternal(false);
            }
        });
    }

    @Override
    protected void handleOnResume() {
        main.post(() -> {
            if (player != null && resumeOnForeground && loaded) {
                player.setPlayWhenReady(true);
                emitExternal(true);
            }
            resumeOnForeground = false;
        });
    }

    @Override
    protected void handleOnDestroy() {
        main.removeCallbacksAndMessages(null);
        if (player != null) {
            player.removeListener(listener);
            player.release();
            player = null;
        }
        if (layer != null && layer.getParent() instanceof ViewGroup) ((ViewGroup) layer.getParent()).removeView(layer);
        layer = null;
        box = null;
        surface = null;
    }
}
