package com.techpoint.opentv.player

import android.content.Context
import android.util.Log
import android.view.SurfaceView
import androidx.compose.runtime.Immutable
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem as Media3Item
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.text.Cue
import androidx.media3.session.MediaSession
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.text.CueGroup
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import com.techpoint.opentv.core.model.StreamSource
import com.techpoint.opentv.core.ranking.SourceRanker
import com.techpoint.opentv.service.RustServiceBridge
import com.techpoint.opentv.ui.player.EpisodeFlow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

@Immutable
data class TrackChoice(
    val groupIndex: Int,
    val trackIndex: Int,
    val label: String,
    val language: String,
    val selected: Boolean,
)

@Immutable
/** A bitmap subtitle cue; x/y/width/height are fractions of the video area (Media3 Cue). */
data class BitmapCue(
    val bitmap: android.graphics.Bitmap,
    val x: Float,
    val y: Float,
    val width: Float,
    val height: Float,
)

data class PlayerUiState(
    val isPlaying: Boolean = false,
    val isBuffering: Boolean = false,
    val positionMs: Long = 0L,
    val durationMs: Long = 0L,
    val bufferedMs: Long = 0L,
    val videoWidth: Int = 0,
    val videoHeight: Int = 0,
    val speed: Float = 1.0f,
    val statusBanner: String = "",
    val errorMessage: String = "",
    val subtitleCues: List<String> = emptyList(),
    // Bitmap subtitles (PGS / VobSub / DVB) with their position as screen fractions.
    val subtitleBitmaps: List<BitmapCue> = emptyList(),
    val audioTracks: List<TrackChoice> = emptyList(),
    val textTracks: List<TrackChoice> = emptyList(),
    val activeSourceLabel: String = "",
    val torrentPeers: Int = 0,
    val torrentSpeedMbps: Double = 0.0,
    val torrentProgressPct: Int = 0,
    val ended: Boolean = false,
    /** The current VOD source reached READY at least once (loading screen can go). */
    val firstFrameReady: Boolean = false,
)

/**
 * Hardware-accelerated Media3 ExoPlayer controller engineered for 1 GB Fire TV Sticks
 * and Android phones:
 * - SurfaceView direct composition (HDR10/Dolby Vision + zero TextureView copy)
 * - Automatic HDMI surround passthrough (AC-3, E-AC-3, Dolby Atmos, TrueHD, DTS)
 * - Auto Frame Rate (AFR) seamless display refresh switching on TVs
 * - Integrated Rust parallel torrent racer + automatic source fallback
 */
class OpenTvPlayer(
    private val context: Context,
    private val isLowMemory: Boolean,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val _state = MutableStateFlow(PlayerUiState())
    val state: StateFlow<PlayerUiState> = _state.asStateFlow()

    private var exo: ExoPlayer? = null
    private var attachedSurface: SurfaceView? = null
    private var playerListener: Player.Listener? = null
    private var tickJob: Job? = null
    private var mediaSession: MediaSession? = null
    private var torrentPollJob: Job? = null
    private var fallbackQueue: List<StreamSource> = emptyList()
    private val triedSourceIds = HashSet<String>()
    // Servers that refused us (403/429/404, dead host): the next fallback prefers another one,
    // since free file hosts rate-limit every link at once.
    private val failedHosts = HashSet<String>()
    private var lastFailureRefused = false
    // Wrong-content guard: TMDB runtime of the episode being played (0 = off) and the sources
    // already checked against it, kept per episode so a manual re-pick of the same source sticks.
    private var expectedRuntimeMin: Int = 0
    private var runtimeKey: String = ""
    private val runtimeCheckedIds = HashSet<String>()
    private var startResumeMs: Long = 0L
    private var startSeason: Int = 0
    private var startEpisode: Int = 0
    private var startRanked: List<StreamSource> = emptyList()
    private var loadJob: Job? = null
    private var startupWatchdog: Job? = null
    private var currentSource: StreamSource? = null
    private var currentHeaders: Map<String, String> = emptyMap()
    private var activeMediaToken: String = ""
    private var currentIsLive: Boolean = false
    private var liveRawUrl: String = ""
    private var liveTriedProxy: Boolean = false
    private var liveRetryCount: Int = 0
    private var liveRetryJob: Job? = null
    private var activeExternalSubUrl: String? = null
    private var lastPlaybackUrl: String = ""

    // "Ajustes → Reproducción" language preferences (ISO 639-1), applied to every new player.
    private var preferredAudioLang = "es"
    private var preferredTextLang: String? = "es"

    /**
     * Preferred audio/subtitle languages for multi-track files (user overrides still win).
     * [text] = null: no subtitle track is picked automatically (only forced ones).
     */
    fun setLanguagePreferences(audio: String, text: String?) {
        if (audio == preferredAudioLang && text == preferredTextLang) return
        preferredAudioLang = audio
        preferredTextLang = text
        exo?.let { applyLanguagePreferences(it) }
    }

    private fun applyLanguagePreferences(p: ExoPlayer) {
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .setPreferredAudioLanguage(preferredAudioLang)
            .setPreferredTextLanguage(preferredTextLang)
            .build()
    }

    private fun ensurePlayer(): ExoPlayer {
        exo?.let { return it }

        val httpFactory = DefaultHttpDataSource.Factory()
            .setUserAgent("OpenTV/2.0 (Android) ExoPlayer")
            .setConnectTimeoutMs(10_000)
            .setReadTimeoutMs(20_000)
            .setAllowCrossProtocolRedirects(true)

        val dataSourceFactory = DefaultDataSource.Factory(context, httpFactory)

        // Adaptive LoadControl: lean RAM budget on 1 GB Fire TV, generous buffer on phones
        val loadControl = if (isLowMemory) {
            DefaultLoadControl.Builder()
                .setBufferDurationsMs(12_000, 24_000, 1_500, 3_000)
                .setTargetBufferBytes(16 * 1024 * 1024)
                .setPrioritizeTimeOverSizeThresholds(false)
                .build()
        } else {
            DefaultLoadControl.Builder()
                .setBufferDurationsMs(20_000, 50_000, 1_200, 2_500)
                .setTargetBufferBytes(48 * 1024 * 1024)
                .build()
        }

        // Maximum container/codec compatibility (VLC-grade):
        // - EXTENSION_RENDERER_MODE_ON tries hardware MediaCodec & HDMI passthrough first (zero CPU waste
        //   on 1 GB Fire TV) and falls back automatically to bundled FFmpeg software decoders for
        //   AC-3, E-AC-3, DTS, DTS-HD, TrueHD, MLP, FLAC, ALAC, Vorbis, Opus, MP2, WMA & PCM.
        val renderersFactory = DefaultRenderersFactory(context)
            .setEnableDecoderFallback(true)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)

        val extractorsFactory = DefaultExtractorsFactory()
            .setConstantBitrateSeekingEnabled(true)
            .setConstantBitrateSeekingAlwaysEnabled(true)
            .setTsExtractorFlags(
                DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES or
                    DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS,
            )
            .setTsExtractorTimestampSearchBytes(600 * 188)

        val audioAttrs = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
            .build()

        val player = ExoPlayer.Builder(context, renderersFactory)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSourceFactory, extractorsFactory))
            .setLoadControl(loadControl)
            .setAudioAttributes(audioAttrs, true)
            .setHandleAudioBecomingNoisy(true)
            .setVideoChangeFrameRateStrategy(C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_ONLY_IF_SEAMLESS)
            .build()

        val l = object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_READY && switchIfWrongContent(player)) return
                val buffering = playbackState == Player.STATE_BUFFERING
                val ended = playbackState == Player.STATE_ENDED
                if (playbackState == Player.STATE_READY) {
                    if (currentIsLive) liveRetryCount = 0
                    startupWatchdog?.cancel()
                    if (!_state.value.firstFrameReady) {
                        currentSource?.let {
                            SourceRanker.recordHealth(it, true)
                            Log.i(TAG, "playing: ${it.addonName} · ${it.title.take(80)} (direct=${it.isDirect})")
                        }
                    }
                }
                _state.update {
                    it.copy(
                        firstFrameReady = it.firstFrameReady || playbackState == Player.STATE_READY,
                        isBuffering = buffering,
                        isPlaying = player.isPlaying,
                        durationMs = player.duration.coerceAtLeast(0L),
                        ended = ended,
                        statusBanner = if (playbackState == Player.STATE_READY) "" else it.statusBanner,
                    )
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                _state.update { it.copy(isPlaying = isPlaying) }
            }

            override fun onVideoSizeChanged(videoSize: VideoSize) {
                _state.update { it.copy(videoWidth = videoSize.width, videoHeight = videoSize.height) }
            }

            override fun onTracksChanged(tracks: Tracks) {
                refreshTrackLists(tracks)
            }

            override fun onCues(cueGroup: CueGroup) {
                val lines = cueGroup.cues.mapNotNull { it.text?.toString()?.trim() }.filter { it.isNotEmpty() }
                val bitmaps = cueGroup.cues.mapNotNull { c ->
                    val bmp = c.bitmap ?: return@mapNotNull null
                    val w = if (c.size != Cue.DIMEN_UNSET) c.size else 0.5f
                    val h = if (c.bitmapHeight != Cue.DIMEN_UNSET) c.bitmapHeight
                    else w * bmp.height / bmp.width.coerceAtLeast(1)
                    val x = if (c.position != Cue.DIMEN_UNSET) c.position else 0.5f - w / 2f
                    val y = if (c.line != Cue.DIMEN_UNSET && c.lineType == Cue.LINE_TYPE_FRACTION) c.line else 0.9f - h
                    BitmapCue(bmp, x, y, w, h)
                }
                _state.update { it.copy(subtitleCues = lines, subtitleBitmaps = bitmaps) }
            }

            override fun onPlayerError(error: PlaybackException) {
                startupWatchdog?.cancel()
                currentSource?.let {
                    SourceRanker.recordHealth(it, false)
                    Log.w(TAG, "source failed: ${it.addonName} (${error.errorCodeName})")
                    val httpRefusal = error.errorCode == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS ||
                        error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
                        error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT
                    lastFailureRefused = httpRefusal
                    if (httpRefusal) hostOf(it.url)?.let { h -> failedHosts.add(h) }
                }
                // Live TV automatic proxy fallback (handles Pluto TV / CORS / header-sensitive HLS streams)
                if (currentIsLive && !liveTriedProxy && liveRawUrl.startsWith("http")) {
                    liveTriedProxy = true
                    _state.update { it.copy(isBuffering = true, errorMessage = "", statusBanner = "Reconectando por proxy…") }
                    scope.launch {
                        val proxied = resolvePlayableUrl(liveRawUrl, emptyMap(), forceProxy = true)
                        loadUrl(proxied, resumeMs = 0L, isLive = true)
                    }
                    return
                }
                // Live TV silent exponential backoff reconnect (2s -> 4s -> 8s, max 3 retries)
                if (currentIsLive && liveRetryCount < 3 && liveRawUrl.startsWith("http")) {
                    liveRetryCount += 1
                    val attempt = liveRetryCount
                    val backoffMs = when (attempt) {
                        1 -> 2_000L
                        2 -> 4_000L
                        else -> 8_000L
                    }
                    _state.update {
                        it.copy(
                            isBuffering = true,
                            errorMessage = "",
                            statusBanner = "Reconectando señal ($attempt/3)…",
                        )
                    }
                    liveRetryJob?.cancel()
                    liveRetryJob = scope.launch {
                        delay(backoffMs)
                        val url = if (liveRawUrl.startsWith("http://127.0.0.1:")) liveRawUrl
                        else resolvePlayableUrl(liveRawUrl, emptyMap(), forceProxy = true)
                        loadUrl(url, resumeMs = 0L, isLive = true)
                    }
                    return
                }
                // VOD automatic direct/source fallback before showing an error!
                if (!tryNextFallback()) {
                    _state.update {
                        it.copy(
                            isBuffering = false,
                            isPlaying = false,
                            errorMessage = failureMessage(error.errorCode),
                            statusBanner = "",
                        )
                    }
                }
            }
        }
        playerListener = l
        player.addListener(l)

        attachedSurface?.let { player.setVideoSurfaceView(it) }
        applyLanguagePreferences(player)
        exo = player
        // MediaSession: Alexa voice transport ("Alexa, pausa") and remote media keys while
        // OpenTV is in the background go through the system session.
        mediaSession = runCatching {
            MediaSession.Builder(context, player).setId("opentv").build()
        }.getOrNull()
        startTickLoop()
        return player
    }

    fun attachSurface(surfaceView: SurfaceView?) {
        attachedSurface = surfaceView
        exo?.setVideoSurfaceView(surfaceView)
    }

    /**
     * Plays a chosen VOD StreamSource with parallel torrent race & automatic fallback list:
     * the next direct streams first and, when a direct stream was chosen, the best torrent
     * as the last resort.
     */
    fun playSource(
        source: StreamSource,
        rankedSources: List<StreamSource>,
        resumeMs: Long = 0L,
        season: Int = 0,
        episode: Int = 0,
        runtimeMin: Int = 0,
    ) {
        currentIsLive = false
        val key = "$season:$episode:$runtimeMin"
        if (key != runtimeKey) {
            runtimeKey = key
            runtimeCheckedIds.clear()
        }
        expectedRuntimeMin = if (episode > 0) runtimeMin else 0
        currentSource = source
        startResumeMs = resumeMs
        startSeason = season
        startEpisode = episode
        startRanked = rankedSources
        triedSourceIds.clear()
        triedSourceIds.add(source.id)
        failedHosts.clear()
        lastFailureRefused = false
        fallbackQueue = buildFallbacks(source, rankedSources)
        activeExternalSubUrl = null

        _state.update {
            it.copy(
                errorMessage = "",
                ended = false,
                isBuffering = true,
                firstFrameReady = false,
                // Neutral text: the loading screen never names the plugin/server or the quality.
                statusBanner = "Cargando…",
                activeSourceLabel = sourceLabel(source),
            )
        }
        startSource(source, resumeMs)
    }

    /** New sources found after playback started (slow JS plugins): usable as fallbacks. */
    fun extendFallbacks(rankedSources: List<StreamSource>) {
        val current = currentSource ?: return
        if (currentIsLive) return
        startRanked = rankedSources
        val queued = fallbackQueue.mapTo(HashSet()) { it.id }
        val extra = buildFallbacks(current, rankedSources).filter { it.id !in queued && it.id !in triedSourceIds }
        if (extra.isEmpty()) return
        // Directs stay ahead of the torrent last resort.
        fallbackQueue = (fallbackQueue + extra).sortedBy { if (it.isTorrent) 1 else 0 }
    }

    private fun buildFallbacks(chosen: StreamSource, ranked: List<StreamSource>): List<StreamSource> {
        val directs = ranked.filter { it.id != chosen.id && !it.isTorrent && it.id !in triedSourceIds }.take(MAX_DIRECT_FALLBACKS)
        val torrent = if (!chosen.isTorrent) ranked.firstOrNull { it.isTorrent && it.id !in triedSourceIds } else null
        return directs + listOfNotNull(torrent)
    }

    private fun sourceLabel(source: StreamSource): String =
        if (source.quality == "unknown") source.addonName else "${source.addonName} · ${source.quality}"

    private fun startSource(source: StreamSource, resumeMs: Long) {
        loadJob?.cancel()
        startupWatchdog?.cancel()
        loadJob = scope.launch {
            torrentPollJob?.cancel()
            if (source.isTorrent) {
                startTorrentRace(source, startRanked, resumeMs, startSeason, startEpisode)
            } else {
                RustServiceBridge.stopTorrent()
                // Cheap 2-byte check: an expired / rate-limited link (403, 429...) is skipped at once
                // instead of waiting for the 30 s startup watchdog.
                if (isRefused(source)) {
                    if (!isActive || currentSource?.id != source.id) return@launch
                    Log.w(TAG, "source refused by server: ${source.addonName} - ${hostOf(source.url)}")
                    lastFailureRefused = true
                    hostOf(source.url)?.let { failedHosts.add(it) }
                    SourceRanker.recordHealth(source, false)
                    if (!tryNextFallback()) {
                        _state.update { it.copy(isBuffering = false, isPlaying = false, errorMessage = REFUSED_MESSAGE, statusBanner = "") }
                    }
                    return@launch
                }
                val resolvedUrl = resolvePlayableUrl(source.url, source.headers)
                if (!isActive || currentSource?.id != source.id) return@launch
                _state.update { it.copy(statusBanner = "Cargando video…") }
                loadUrl(resolvedUrl, resumeMs, isLive = false)
                armStartupWatchdog(source)
            }
        }
    }

    /** A direct stream that never gets READY (dead HLS host, endless redirects) counts as failed. */
    private fun armStartupWatchdog(source: StreamSource) {
        startupWatchdog?.cancel()
        startupWatchdog = scope.launch {
            delay(DIRECT_STARTUP_TIMEOUT_MS)
            if (currentSource?.id != source.id || _state.value.firstFrameReady || currentIsLive) return@launch
            Log.w(TAG, "source timed out: ${source.addonName}")
            SourceRanker.recordHealth(source, false)
            exo?.stop()
            lastFailureRefused = true
            hostOf(source.url)?.let { failedHosts.add(it) }
            if (!tryNextFallback()) {
                _state.update {
                    it.copy(
                        isBuffering = false,
                        isPlaying = false,
                        errorMessage = REFUSED_MESSAGE,
                        statusBanner = "",
                    )
                }
            }
        }
    }

    /** Plays a Live TV channel URL directly or via Rust proxy with automatic proxy retry on error. */
    fun playLive(url: String, label: String, muted: Boolean = false) {
        currentIsLive = true
        liveRawUrl = url
        liveTriedProxy = url.startsWith("http://127.0.0.1:")
        liveRetryCount = 0
        liveRetryJob?.cancel()
        loadJob?.cancel()
        startupWatchdog?.cancel()
        currentSource = null
        fallbackQueue = emptyList()
        torrentPollJob?.cancel()
        RustServiceBridge.stopTorrent()

        _state.update {
            it.copy(
                errorMessage = "",
                firstFrameReady = false,
                ended = false,
                isBuffering = true,
                statusBanner = "Sintonizando $label…",
                activeSourceLabel = label,
            )
        }
        val p = ensurePlayer()
        p.volume = if (muted) 0f else 1f
        loadUrl(url, resumeMs = 0L, isLive = true)
    }

    /** Plays a locally downloaded offline file (127.0.0.1) or local device/USB video (`content://` / `file://`). */
    fun playOffline(localUrl: String, label: String, resumeMs: Long = 0L) {
        loadJob?.cancel()
        startupWatchdog?.cancel()
        currentIsLive = false
        currentSource = null
        fallbackQueue = emptyList()
        torrentPollJob?.cancel()
        RustServiceBridge.stopTorrent()
        val isDeviceFile = localUrl.startsWith("content://") || localUrl.startsWith("file://")

        _state.update {
            it.copy(
                errorMessage = "",
                firstFrameReady = false,
                ended = false,
                isBuffering = true,
                statusBanner = if (isDeviceFile) "Abriendo video local…" else "Abriendo descarga local…",
                activeSourceLabel = if (isDeviceFile) "Local · $label" else "Sin conexión · $label",
            )
        }
        loadUrl(localUrl, resumeMs = resumeMs, isLive = false)
    }

    fun setMuted(muted: Boolean) {
        exo?.volume = if (muted) 0f else 1f
    }

    fun togglePlayPause() {
        val p = exo ?: return
        if (p.isPlaying) p.pause() else p.play()
    }

    fun pause() {
        exo?.pause()
    }

    fun resume() {
        exo?.play()
    }

    fun seekTo(ms: Long) {
        val p = exo ?: return
        val dur = p.duration.coerceAtLeast(0L)
        val target = if (dur > 0L) ms.coerceIn(0L, dur) else ms.coerceAtLeast(0L)
        p.seekTo(target)
        _state.update { it.copy(positionMs = target) }
    }

    fun seekBy(deltaMs: Long) {
        val p = exo ?: return
        seekTo(p.currentPosition + deltaMs)
    }

    fun setPlaybackSpeed(speed: Float) {
        val clamped = speed.coerceIn(0.5f, 2.0f)
        exo?.playbackParameters = PlaybackParameters(clamped)
        _state.update { it.copy(speed = clamped) }
    }

    fun selectAudioTrack(choice: TrackChoice) {
        val p = exo ?: return
        val groups = p.currentTracks.groups
        val group = groups.getOrNull(choice.groupIndex) ?: return
        p.trackSelectionParameters = p.trackSelectionParameters
            .buildUpon()
            .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, listOf(choice.trackIndex)))
            .build()
    }

    fun selectTextTrack(choice: TrackChoice?) {
        val p = exo ?: return
        val builder = p.trackSelectionParameters.buildUpon()
        if (choice == null) {
            builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
            _state.update { it.copy(subtitleCues = emptyList()) }
        } else {
            val group = p.currentTracks.groups.getOrNull(choice.groupIndex) ?: return
            builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
            builder.setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, listOf(choice.trackIndex)))
        }
        p.trackSelectionParameters = builder.build()
    }

    /**
     * Attaches an external OpenSubtitles SRT/VTT subtitle URL via Rust `proxySubtitles`
     * (handles gzip, redirects & Latin-1 -> UTF-8 conversion for Spanish accents)
     * without losing playback position.
     */
    fun attachExternalSubtitle(subUrl: String, lang: String, label: String) {
        if (lastPlaybackUrl.isBlank()) return
        activeExternalSubUrl = subUrl
        scope.launch {
            val isRemoteHttp = subUrl.startsWith("http://") || subUrl.startsWith("https://")
            val proxiedSub = if (isRemoteHttp && RustServiceBridge.port() > 0 && !subUrl.startsWith("http://127.0.0.1:")) {
                val res = RustServiceBridge.callRpc(
                    "proxySubtitles",
                    buildJsonObject {
                        put(
                            "subtitles",
                            buildJsonArray {
                                add(
                                    buildJsonObject {
                                        put("lang", lang)
                                        put("url", subUrl)
                                    },
                                )
                            },
                        )
                    },
                )
                val firstObj = res["subtitles"]?.let { el ->
                    runCatching { (el as kotlinx.serialization.json.JsonArray).firstOrNull() as? kotlinx.serialization.json.JsonObject }.getOrNull()
                }
                (firstObj?.get("url") as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() } ?: subUrl
            } else subUrl

            val p = exo ?: return@launch
            val pos = p.currentPosition.coerceAtLeast(0L)
            val mime = if (subUrl.contains(".vtt", ignoreCase = true) || proxiedSub.contains(".vtt", ignoreCase = true)) {
                MimeTypes.TEXT_VTT
            } else MimeTypes.APPLICATION_SUBRIP

            val subCfg = Media3Item.SubtitleConfiguration.Builder(android.net.Uri.parse(proxiedSub))
                .setMimeType(mime)
                .setLanguage(lang)
                .setLabel(label)
                .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
                .build()

            val item = Media3Item.Builder()
                .setUri(lastPlaybackUrl)
                .setSubtitleConfigurations(listOf(subCfg))
                .build()
            p.setMediaItem(item, pos)
            p.prepare()
            p.play()
        }
    }

    fun stop() {
        loadJob?.cancel()
        startupWatchdog?.cancel()
        fallbackQueue = emptyList()
        currentSource = null
        liveRetryJob?.cancel()
        torrentPollJob?.cancel()
        RustServiceBridge.stopTorrent()
        exo?.stop()
        exo?.clearMediaItems()
        _state.update { PlayerUiState() }
    }

    fun release() {
        // Release order matters: detach session/listeners before releasing ExoPlayer
        // to avoid callbacks touching a dead player on 1 GB devices.
        liveRetryJob?.cancel()
        liveRetryJob = null
        torrentPollJob?.cancel()
        torrentPollJob = null
        tickJob?.cancel()
        tickJob = null
        RustServiceBridge.stopTorrent()
        attachedSurface?.let { surface ->
            runCatching { exo?.clearVideoSurfaceView(surface) }
        }
        attachedSurface = null
        exo?.let { p ->
            playerListener?.let { l -> runCatching { p.removeListener(l) } }
            runCatching { p.stop() }
            runCatching { p.clearMediaItems() }
            runCatching { p.release() }
        }
        playerListener = null
        exo = null
        mediaSession?.let { session ->
            runCatching { session.release() }
        }
        mediaSession = null
    }

    private suspend fun startTorrentRace(
        source: StreamSource,
        rankedSources: List<StreamSource>,
        resumeMs: Long,
        season: Int,
        episode: Int,
    ) {
        // Rule: Fire TV 1 GB races at most 2 sources simultaneously.
        val maxAlts = if (isLowMemory) 1 else 2
        val alts = SourceRanker.torrentRaceAlternatives(source, rankedSources, maxAlts)

        val res = RustServiceBridge.callRpc(
            "torrentStart",
            buildJsonObject {
                put("hash", source.infoHash)
                source.fileIdx?.let { put("fileIdx", it) }
                if (source.filename.isNotBlank()) put("filename", source.filename)
                if (season > 0) put("season", season)
                if (episode > 0) put("episode", episode)
                if (source.trackers.isNotEmpty()) {
                    put("trackers", buildJsonArray { source.trackers.forEach { add(JsonPrimitive(it)) } })
                }
                if (alts.isNotEmpty()) {
                    put(
                        "alternatives",
                        buildJsonArray {
                            alts.forEach { alt ->
                                add(
                                    buildJsonObject {
                                        put("hash", alt.infoHash)
                                        alt.fileIdx?.let { put("fileIdx", it) }
                                        if (alt.filename.isNotBlank()) put("filename", alt.filename)
                                        if (alt.trackers.isNotEmpty()) {
                                            put("trackers", buildJsonArray { alt.trackers.forEach { add(JsonPrimitive(it)) } })
                                        }
                                    },
                                )
                            }
                        },
                    )
                }
            },
        )

        val streamUrl = (res["url"] as? JsonPrimitive)?.contentOrNull.orEmpty()
        if (currentSource?.id != source.id) return
        if (streamUrl.isBlank()) {
            val err = (res["errorText"] as? JsonPrimitive)?.contentOrNull ?: "No se encontraron semillas disponibles"
            if (!tryNextFallback()) {
                _state.update { it.copy(isBuffering = false, errorMessage = err, statusBanner = "") }
            }
            return
        }

        loadUrl(streamUrl, resumeMs, isLive = false)
        startTorrentStatsPolling()
    }

    private fun startTorrentStatsPolling() {
        torrentPollJob?.cancel()
        torrentPollJob = scope.launch {
            while (isActive) {
                val stats = RustServiceBridge.callRpc("torrentStats")
                val peers = (stats["peers"] as? JsonPrimitive)?.intOrNull ?: 0
                val bps = (stats["downloadSpeed"] as? JsonPrimitive)?.longOrNull ?: 0L
                val pct = (stats["available"] as? JsonPrimitive)?.intOrNull ?: 0
                val mbps = (bps * 8.0) / 1_000_000.0
                _state.update {
                    it.copy(
                        torrentPeers = peers,
                        torrentSpeedMbps = mbps,
                        torrentProgressPct = pct,
                        statusBanner = if (it.isBuffering) "Torrent · $peers pares · ${String.format("%.1f", bps / 1_048_576.0)} MB/s" else "",
                    )
                }
                delay(1200)
            }
        }
    }

    private suspend fun resolvePlayableUrl(
        url: String,
        headers: Map<String, String>,
        forceProxy: Boolean = false,
    ): String {
        val res = RustServiceBridge.callRpc(
            "resolveExternal",
            buildJsonObject {
                put("url", url)
                if (forceProxy) put("forceProxy", true)
                if (headers.isNotEmpty()) {
                    put("headers", buildJsonObject { headers.forEach { (k, v) -> put(k, v) } })
                }
            },
        )
        // `proxyPath` is the URL the local proxy can actually serve (headers,
        // redirects and HLS rewrites already applied). The original `url` is
        // only a fallback when the resolver did not produce a proxied path.
        val proxyPath = (res["proxyPath"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
        val token = (res["token"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
            ?: proxyPath?.let { Regex("/media/([^/]+)/").find(it)?.groupValues?.getOrNull(1) }
        if (!token.isNullOrBlank()) {
            val prev = activeMediaToken
            activeMediaToken = token
            if (prev.isNotBlank() && prev != token) {
                RustServiceBridge.callRpc("abortMedia", buildJsonObject { put("exceptToken", token) })
            }
        }
        return proxyPath ?: (res["url"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() } ?: url
    }

    private fun loadUrl(url: String, resumeMs: Long, isLive: Boolean) {
        val p = ensurePlayer()
        lastPlaybackUrl = url
        val item = Media3Item.fromUri(url)
        if (!isLive && resumeMs > 5_000L) {
            p.setMediaItem(item, resumeMs)
        } else {
            p.setMediaItem(item)
        }
        p.prepare()
        p.playWhenReady = true
    }

    /** True when the source server answers a 2-byte range request with a refusal or not at all. */
    private suspend fun isRefused(source: StreamSource): Boolean {
        if (!source.url.startsWith("http")) return false
        val res = RustServiceBridge.callRpc(
            "pluginFetch",
            buildJsonObject {
                put("url", source.url)
                put("method", "GET")
                put("maxBytes", 2)
                put("timeoutMs", 7000)
                put(
                    "headers",
                    buildJsonObject {
                        source.headers.forEach { (k, v) -> put(k, v) }
                        put("Range", "bytes=0-1")
                    },
                )
            },
        )
        val status = (res["status"] as? JsonPrimitive)?.intOrNull ?: 0
        val code = (res["code"] as? JsonPrimitive)?.contentOrNull.orEmpty()
        // A LAN/blocked host is NetGuard's call, not the server's: let the normal path report it.
        if (code == "host_not_allowed") return false
        return isRefusalStatus(status) || code == "timeout" || code == "network"
    }

    private fun failureMessage(errorCode: Int): String = when {
        lastFailureRefused -> REFUSED_MESSAGE
        errorCode in PlaybackException.ERROR_CODE_DECODER_INIT_FAILED..PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED ||
            errorCode == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED ->
            "Este video usa un formato que este aparato no puede reproducir. Elige otra fuente."
        else -> "No se pudo reproducir esta fuente. Elige otra."
    }

    /**
     * Wrong-content guard, run once per direct source when it first gets READY: a duration far
     * from the episode's TMDB runtime means another version/show (e.g. a remake matched by its
     * Spanish title), so the next fallback (same language first) takes over with a neutral
     * status. Torrents (extended cuts are common), live TV and offline files are never checked;
     * with nothing else to try the current source keeps playing. True when it switched.
     */
    private fun switchIfWrongContent(player: ExoPlayer): Boolean {
        val src = currentSource ?: return false
        if (currentIsLive || src.isTorrent || expectedRuntimeMin <= 0 || src.id in runtimeCheckedIds) return false
        val durMs = player.duration
        if (durMs == C.TIME_UNSET || durMs <= 0L) return false
        runtimeCheckedIds.add(src.id)
        val durSec = durMs / 1000.0
        if (!EpisodeFlow.runtimeMismatch(durSec, expectedRuntimeMin)) return false
        val next = pickSameLanguage(fallbackQueue, src, failedHosts)
        if (next == null) {
            Log.w(TAG, "runtime mismatch (${durSec.toInt()} s vs $expectedRuntimeMin min) but no other source: keeping ${src.addonName}")
            return false
        }
        Log.w(TAG, "runtime mismatch: ${src.addonName} ${durSec.toInt()} s vs $expectedRuntimeMin min (TMDB), trying ${next.addonName}")
        startupWatchdog?.cancel()
        player.stop()
        fallbackQueue = fallbackQueue.filter { it.id != next.id }
        currentSource = next
        triedSourceIds.add(next.id)
        _state.update {
            it.copy(
                isBuffering = true,
                isPlaying = false,
                errorMessage = "",
                firstFrameReady = false,
                durationMs = 0L,
                positionMs = 0L,
                statusBanner = "Buscando otra fuente…",
                activeSourceLabel = sourceLabel(next),
            )
        }
        startSource(next, startResumeMs)
        return true
    }

    private fun tryNextFallback(): Boolean {
        if (currentIsLive) return false
        // Prefer a server that has not refused us yet; otherwise the next in line.
        val next = fallbackQueue.firstOrNull { f -> hostOf(f.url).let { it == null || it !in failedHosts } }
            ?: fallbackQueue.firstOrNull() ?: return false
        fallbackQueue = fallbackQueue.filter { it.id != next.id }
        currentSource = next
        triedSourceIds.add(next.id)
        Log.i(TAG, "fallback: ${next.addonName} · ${next.title.take(80)}")
        val pos = _state.value.positionMs
        _state.update {
            it.copy(
                isBuffering = true,
                errorMessage = "",
                firstFrameReady = it.firstFrameReady && pos > 0L,
                statusBanner = "Probando otra fuente…",
                activeSourceLabel = sourceLabel(next),
            )
        }
        startSource(next, if (pos > 5_000L) pos else startResumeMs)
        return true
    }

    private fun refreshTrackLists(tracks: Tracks) {
        val audio = mutableListOf<TrackChoice>()
        val text = mutableListOf<TrackChoice>()
        tracks.groups.forEachIndexed { gIdx, group ->
            val type = group.type
            if (type != C.TRACK_TYPE_AUDIO && type != C.TRACK_TYPE_TEXT) return@forEachIndexed
            for (tIdx in 0 until group.length) {
                if (!group.isTrackSupported(tIdx)) continue
                val fmt = group.getTrackFormat(tIdx)
                val lang = fmt.language.orEmpty()
                val label = fmt.label?.takeIf { it.isNotBlank() }
                    ?: formatTrackLabel(lang, fmt.sampleMimeType, fmt.channelCount, type == C.TRACK_TYPE_AUDIO)
                val choice = TrackChoice(
                    groupIndex = gIdx,
                    trackIndex = tIdx,
                    label = label,
                    language = lang,
                    selected = group.isTrackSelected(tIdx),
                )
                if (type == C.TRACK_TYPE_AUDIO) audio.add(choice) else text.add(choice)
            }
        }
        _state.update { it.copy(audioTracks = audio, textTracks = text) }
    }

    private fun formatTrackLabel(lang: String, mime: String?, channels: Int, isAudio: Boolean): String {
        val langName = when (lang.lowercase()) {
            "es", "spa", "es-419", "es-mx" -> "Español"
            "en", "eng" -> "Inglés"
            "pt", "por" -> "Portugués"
            "ja", "jpn" -> "Japonés"
            "fr", "fra" -> "Francés"
            else -> lang.uppercase().ifBlank { if (isAudio) "Pista de audio" else "Subtítulo" }
        }
        if (!isAudio) return langName
        val codec = when (mime) {
            MimeTypes.AUDIO_E_AC3_JOC -> "Dolby Atmos"
            MimeTypes.AUDIO_E_AC3 -> "Dolby Digital+"
            MimeTypes.AUDIO_AC3 -> "Dolby Digital"
            MimeTypes.AUDIO_TRUEHD -> "TrueHD"
            MimeTypes.AUDIO_DTS, MimeTypes.AUDIO_DTS_HD -> "DTS"
            else -> ""
        }
        val ch = when {
            channels >= 6 -> "5.1"
            channels == 2 -> "2.0"
            else -> ""
        }
        return listOf(langName, codec, ch).filter { it.isNotBlank() }.joinToString(" · ")
    }

    private fun startTickLoop() {
        tickJob?.cancel()
        tickJob = scope.launch {
            while (isActive) {
                val p = exo
                if (p != null && (p.isPlaying || p.playbackState == Player.STATE_BUFFERING)) {
                    _state.update {
                        it.copy(
                            positionMs = p.currentPosition.coerceAtLeast(0L),
                            durationMs = p.duration.coerceAtLeast(0L),
                            bufferedMs = p.bufferedPosition.coerceAtLeast(0L),
                        )
                    }
                }
                delay(500)
            }
        }
    }

    internal companion object {
        const val TAG = "OpenTV-Play"
        /** Fire TV: a healthy HLS host answers in a few seconds; 30 s means it is dead or stuck. */
        const val DIRECT_STARTUP_TIMEOUT_MS = 30_000L
        const val MAX_DIRECT_FALLBACKS = 8
        const val REFUSED_MESSAGE =
            "Los servidores de estas fuentes rechazaron la conexión (enlace caducado o límite de descargas). " +
                "Elige otra fuente o vuelve a intentarlo más tarde."

        /** HTTP statuses meaning the source server refused us (expired link, rate limit, removed file). */
        fun isRefusalStatus(status: Int): Boolean =
            status == 401 || status == 403 || status == 404 || status == 410 || status == 429 || status >= 500

        /**
         * Next fallback after a wrong-content source: an untried one sharing a language with
         * [current] on a server that has not failed, else any on a healthy server, else the next.
         */
        fun pickSameLanguage(queue: List<StreamSource>, current: StreamSource, failedHosts: Set<String>): StreamSource? {
            val healthy = queue.filter { f -> hostOf(f.url).let { it == null || it !in failedHosts } }
            val wanted = current.langs.mapTo(HashSet()) { it.lowercase() }
            return healthy.firstOrNull { f -> wanted.isNotEmpty() && f.langs.any { it.lowercase() in wanted } }
                ?: healthy.firstOrNull()
                ?: queue.firstOrNull()
        }

        fun hostOf(url: String): String? =
            runCatching { java.net.URI(url).host?.lowercase() }.getOrNull()?.takeIf { it.isNotBlank() }
    }
}
