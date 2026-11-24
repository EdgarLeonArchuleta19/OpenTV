package com.techpoint.opentv.ui.player

import com.techpoint.opentv.ui.components.stableFocusRequester
import android.app.Activity
import android.content.Context
import android.media.AudioManager
import android.view.SurfaceView
import android.view.ViewGroup
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.Image
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.List
import androidx.compose.material.icons.automirrored.rounded.VolumeUp
import androidx.compose.material.icons.rounded.Audiotrack
import androidx.compose.material.icons.rounded.Brightness6
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Forward10
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.LockOpen
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PictureInPictureAlt
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Replay10
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.Speed
import androidx.compose.material.icons.rounded.Subtitles
import androidx.compose.material.icons.rounded.SwapHoriz
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import android.util.Log
import com.techpoint.opentv.core.addons.StremioClient
import com.techpoint.opentv.core.jsplugins.JsPluginHost
import com.techpoint.opentv.core.model.SourcePrefs
import com.techpoint.opentv.core.ranking.SourceRanker
import com.techpoint.opentv.service.DeviceMediaCaps
import com.techpoint.opentv.ui.components.OpenTvImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import com.techpoint.opentv.core.model.Episode
import com.techpoint.opentv.core.model.ExternalSubtitle
import com.techpoint.opentv.core.model.InstalledPlugin
import com.techpoint.opentv.core.model.MediaItem
import com.techpoint.opentv.core.model.PlaybackPrefs
import com.techpoint.opentv.core.model.StreamSource
import com.techpoint.opentv.core.model.WatchProgress
import com.techpoint.opentv.core.local.LocalMediaScanner
import com.techpoint.opentv.player.OpenTvPlayer
import com.techpoint.opentv.service.RustServiceBridge
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import com.techpoint.opentv.ui.components.OpenTvChip
import com.techpoint.opentv.ui.components.OpenTvGlassButton
import com.techpoint.opentv.ui.components.OpenTvPrimaryButton
import com.techpoint.opentv.ui.components.OpenTvRoundIconButton
import com.techpoint.opentv.ui.components.SourcePickerDialog
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import com.techpoint.opentv.ui.theme.OpenTvColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

@Composable
fun VodPlayerScreen(
    player: OpenTvPlayer,
    stremio: StremioClient,
    jsPlugins: JsPluginHost,
    plugins: List<InstalledPlugin>,
    playbackPrefs: PlaybackPrefs,
    sourcePrefs: SourcePrefs,
    mediaCaps: DeviceMediaCaps,
    isLowMemory: Boolean,
    item: MediaItem,
    episode: Episode?,
    allEpisodes: List<Episode>,
    nextEpisode: Episode?,
    initialSource: StreamSource?,
    offlineUrl: String?,
    rankedSources: List<StreamSource>,
    initialResumeMs: Long,
    isInPipMode: Boolean,
    onEnterPip: () -> Unit,
    onSaveProgress: (WatchProgress) -> Unit,
    onPlayEpisode: (Episode) -> Unit,
    onPreloadEpisode: (Episode) -> Unit = {},
    onBack: () -> Unit,
) {
    val ui = LocalOpenTvUi.current
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    // Position ticks every 500 ms: the screen observes a copy without it so only the HUD
    // (which reads [positionMs] itself) recomposes twice a second on the 1 GB Fire TV.
    val state by remember(player) {
        player.state.map { it.copy(positionMs = 0L, bufferedMs = 0L) }.distinctUntilChanged()
    }.collectAsState(initial = player.state.value.copy(positionMs = 0L, bufferedMs = 0L))
    val positionMs by remember(player) {
        player.state.map { it.positionMs }.distinctUntilChanged()
    }.collectAsState(initial = player.state.value.positionMs)
    val nearEndFlag by remember(player, nextEpisode) {
        player.state.map { s ->
            nextEpisode != null && s.durationMs > 120_000L && (s.durationMs - s.positionMs) in 1_000L..25_000L
        }.distinctUntilChanged()
    }.collectAsState(initial = false)
    val preloadNextFlag by remember(player, nextEpisode) {
        player.state.map { s ->
            nextEpisode != null && s.durationMs > 120_000L && (s.durationMs - s.positionMs) in 1_000L..35_000L
        }.distinctUntilChanged()
    }.collectAsState(initial = false)
    val inIntroWindow by remember(player, episode) {
        player.state.map { s ->
            episode != null && s.durationMs > 600_000L && s.positionMs in 15_000L..240_000L
        }.distinctUntilChanged()
    }.collectAsState(initial = false)

    var controlsVisible by remember { mutableStateOf(true) }
    var controlsLocked by remember { mutableStateOf(false) }
    var lastInteractionAt by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var showTracksSheet by remember { mutableStateOf(false) }
    var showSourcesSheet by remember { mutableStateOf(false) }
    var showEpisodesSheet by remember { mutableStateOf(false) }
    var epDrawerSeason by remember(episode?.season) { mutableIntStateOf(episode?.season ?: 1) }
    var externalSubs by remember { mutableStateOf<List<ExternalSubtitle>>(emptyList()) }
    var searchingMoreSubs by remember { mutableStateOf(false) }
    var introSkipped by remember(episode?.id) { mutableStateOf(false) }
    val showIntroSkip = inIntroWindow && !introSkipped && !nearEndFlag

    val localSubLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val name = LocalMediaScanner.resolveDisplayName(ctx, uri)
        val id = "local_sub_${System.currentTimeMillis()}"
        val entry = ExternalSubtitle(id = id, url = uri.toString(), lang = "es", label = name, source = "Archivo local")
        externalSubs = listOf(entry) + externalSubs
        player.attachExternalSubtitle(uri.toString(), "es", name)
        showTracksSheet = false
    }

    fun searchMoreSubtitles() {
        if (searchingMoreSubs) return
        searchingMoreSubs = true
        scope.launch {
            try {
                val rawId = item.id.removePrefix("stremio:")
                val imdbId = rawId.substringBefore(':').takeIf { it.startsWith("tt") }.orEmpty()
                val res = RustServiceBridge.callRpc(
                    "subtitleCat",
                    buildJsonObject {
                        put("imdbId", imdbId)
                        put("kind", if (item.type == "movie") "movie" else "series")
                        put("title", item.title)
                        put("year", item.year)
                        put("season", episode?.season ?: 0)
                        put("episode", episode?.number ?: 0)
                    },
                )
                val found = res["subtitles"]?.jsonArray.orEmpty().mapIndexedNotNull { idx, el ->
                    val o = el as? JsonObject ?: return@mapIndexedNotNull null
                    val u = o["url"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() } ?: return@mapIndexedNotNull null
                    val lang = o["lang"]?.jsonPrimitive?.contentOrNull ?: "es"
                    val label = when {
                        lang.startsWith("es", ignoreCase = true) -> "Español"
                        lang.startsWith("en", ignoreCase = true) -> "Inglés"
                        else -> lang.uppercase()
                    }
                    ExternalSubtitle(
                        id = "scat_${idx}_$u",
                        url = u,
                        lang = lang,
                        label = "$label #${idx + 1}",
                        source = "SubtitleCat",
                    )
                }
                if (found.isNotEmpty()) {
                    val existingUrls = externalSubs.map { it.url }.toSet()
                    externalSubs = externalSubs + found.filter { it.url !in existingUrls }
                }
            } finally {
                searchingMoreSubs = false
            }
        }
    }

    LaunchedEffect(preloadNextFlag, nextEpisode?.id) {
        if (preloadNextFlag && nextEpisode != null) {
            onPreloadEpisode(nextEpisode)
        }
    }

    // Mobile vertical swipe gesture HUD (brightness left / volume right)
    var gestureHudLabel by remember { mutableStateOf<String?>(null) }
    var gestureIsBrightness by remember { mutableStateOf(false) }
    var currentBrightness by remember { mutableFloatStateOf(-1f) }

    // Auto-next countdown (5 seconds when episode ends)
    var nextCountdownSec by remember(episode?.id) { mutableIntStateOf(0) }
    var nextCancelled by remember(episode?.id) { mutableStateOf(false) }

    val rootFocus = remember { FocusRequester() }
    val tracksFocus = remember { FocusRequester() }
    val episodesFocus = remember { FocusRequester() }
    val errorFocus = remember { FocusRequester() }
    // Sources found by the in-player search (or handed over by Detail / the picker).
    var sessionRanked by remember(episode?.id, initialSource?.id) { mutableStateOf(rankedSources) }
    // In-player source search: status line, progress line and the "nothing found" error.
    var searchStatus by remember(episode?.id, initialSource?.id) { mutableStateOf<String?>(null) }
    var searchDetail by remember(episode?.id, initialSource?.id) { mutableStateOf("") }
    var searchError by remember(episode?.id, initialSource?.id) { mutableStateOf("") }
    val errorText = searchError.ifBlank { state.errorMessage }
    val hasError = errorText.isNotBlank()
    // Black loading screen until the first frame of the chosen source (BACK cancels it).
    val loadingScreen = !hasError && (searchStatus != null || !state.firstFrameReady)
    // While any overlay is open the root must let D-pad keys through so focus can move inside it.
    val overlayOpen = showTracksSheet || showSourcesSheet || showEpisodesSheet || hasError
    // DisposableEffect(Unit) outlives auto-next route swaps: always read the latest item/episode.
    val currentItem by rememberUpdatedState(item)
    val currentEpisode by rememberUpdatedState(episode)

    fun touchControls() {
        controlsVisible = true
        lastInteractionAt = System.currentTimeMillis()
    }

    fun startChosen(src: StreamSource, ranked: List<StreamSource>, resumeMs: Long) {
        searchError = ""
        player.playSource(
            source = src,
            rankedSources = ranked,
            resumeMs = resumeMs,
            season = episode?.season ?: 0,
            episode = episode?.number ?: 0,
        )
    }

    // Start playback (offline download, chosen stream or in-player source search) + subtitles
    LaunchedEffect(initialSource?.id, offlineUrl, episode?.id) {
        if (!offlineUrl.isNullOrBlank()) {
            player.playOffline(offlineUrl, item.title, resumeMs = initialResumeMs)
            return@LaunchedEffect
        }
        launch { externalSubs = stremio.fetchSubtitles(item, episode, plugins) }
        if (initialSource != null) {
            startChosen(initialSource, rankedSources, initialResumeMs)
            return@LaunchedEffect
        }
        // Detail already holds a complete, fresh list: pick right away.
        if (rankedSources.isNotEmpty()) {
            val best = rankedSources.first()
            Log.i(PLAY_TAG, "auto-pick (cached list): ${best.addonName} · ${best.title.take(80)} direct=${best.isDirect}")
            startChosen(best, rankedSources, initialResumeMs)
            return@LaunchedEffect
        }
        searchPlayerSources(
            item = item,
            episode = episode,
            stremio = stremio,
            jsPlugins = jsPlugins,
            plugins = plugins,
            sourcePrefs = sourcePrefs,
            mediaCaps = mediaCaps,
            isLowMemory = isLowMemory,
            onStatus = { status, detail ->
                searchStatus = status
                searchDetail = detail
            },
            onRanked = { ranked, picked ->
                sessionRanked = ranked
                if (picked != null) {
                    searchStatus = null
                    startChosen(picked, ranked, initialResumeMs)
                } else {
                    player.extendFallbacks(ranked)
                }
            },
            onNothing = { why ->
                searchStatus = null
                searchError = why
            },
        )
    }

    // Periodically persist watch progress
    LaunchedEffect(item.id, episode?.id) {
        while (true) {
            delay(8_000L)
            val s = player.state.value
            if (s.durationMs > 30_000L && s.positionMs > 5_000L) {
                onSaveProgress(
                    WatchProgress(
                        itemId = currentItem.id,
                        type = currentItem.type,
                        title = currentItem.title,
                        poster = currentItem.poster,
                        backdrop = currentItem.backdrop,
                        season = currentEpisode?.season ?: 0,
                        episode = currentEpisode?.number ?: 0,
                        episodeTitle = currentEpisode?.title.orEmpty(),
                        positionMs = s.positionMs,
                        durationMs = s.durationMs,
                    ),
                )
            }
        }
    }

    // Auto-next 5s countdown on episode end
    LaunchedEffect(state.ended, nextEpisode?.id, nextCancelled, playbackPrefs.autoNextEpisode) {
        if (state.ended && nextEpisode != null && playbackPrefs.autoNextEpisode && !nextCancelled) {
            for (sec in 5 downTo 1) {
                nextCountdownSec = sec
                delay(1_000L)
                if (nextCancelled) break
            }
            if (!nextCancelled) {
                nextCountdownSec = 0
                onPlayEpisode(nextEpisode)
            }
        } else {
            nextCountdownSec = 0
        }
    }

    // Clear mobile gesture HUD after 1s
    LaunchedEffect(gestureHudLabel) {
        if (gestureHudLabel != null) {
            delay(1_000L)
            gestureHudLabel = null
        }
    }

    // Auto-hide HUD after 4.5s
    LaunchedEffect(controlsVisible, lastInteractionAt, state.isPlaying, showTracksSheet, showSourcesSheet, showEpisodesSheet) {
        if (!controlsVisible || !state.isPlaying || showTracksSheet || showSourcesSheet || showEpisodesSheet) return@LaunchedEffect
        delay(4500L)
        if (System.currentTimeMillis() - lastInteractionAt >= 4300L) {
            controlsVisible = false
        }
    }

    LaunchedEffect(showTracksSheet, showEpisodesSheet, showSourcesSheet, hasError) {
        delay(60L) // let the overlay compose before requesting focus
        runCatching {
            when {
                showTracksSheet -> tracksFocus.requestFocus()
                showEpisodesSheet -> episodesFocus.requestFocus()
                showSourcesSheet -> Unit // dialog window owns focus
                hasError -> errorFocus.requestFocus()
                else -> rootFocus.requestFocus()
            }
        }
    }

    DisposableEffect(Unit) {
        runCatching { rootFocus.requestFocus() }
        onDispose {
            // Restore system brightness override if changed by gesture
            (ctx as? Activity)?.window?.let { w ->
                if (currentBrightness >= 0f) {
                    val lp = w.attributes
                    lp.screenBrightness = -1f
                    w.attributes = lp
                }
            }
            val s = player.state.value
            if (s.durationMs > 30_000L && s.positionMs > 5_000L) {
                onSaveProgress(
                    WatchProgress(
                        itemId = currentItem.id,
                        type = currentItem.type,
                        title = currentItem.title,
                        poster = currentItem.poster,
                        backdrop = currentItem.backdrop,
                        season = currentEpisode?.season ?: 0,
                        episode = currentEpisode?.number ?: 0,
                        episodeTitle = currentEpisode?.title.orEmpty(),
                        positionMs = s.positionMs,
                        durationMs = s.durationMs,
                    ),
                )
            }
            player.attachSurface(null)
            player.stop()
        }
    }

    // v1 TV: first Back hides the HUD and asks again; a second Back within 2.5 s leaves.
    var lastBackAt by remember { mutableLongStateOf(0L) }
    var exitHintVisible by remember { mutableStateOf(false) }
    LaunchedEffect(lastBackAt) {
        if (lastBackAt > 0L) {
            exitHintVisible = true
            delay(2_500L)
            exitHintVisible = false
        }
    }
    BackHandler {
        val now = System.currentTimeMillis()
        when {
            controlsLocked -> controlsLocked = false
            showTracksSheet -> showTracksSheet = false
            showSourcesSheet -> showSourcesSheet = false
            showEpisodesSheet -> showEpisodesSheet = false
            loadingScreen -> onBack()
            ui.isTv && now - lastBackAt > 2_500L && !hasError -> {
                controlsVisible = false
                lastBackAt = now
            }
            else -> onBack()
        }
    }

    val titleHeader = remember(item.title, episode) {
        if (episode != null) "${item.title} · T${episode.season} E${episode.number} · ${episode.title}"
        else item.title
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .focusRequester(rootFocus)
            .focusable()
            .onKeyEvent { ev ->
                if (ev.type != KeyEventType.KeyDown || overlayOpen) return@onKeyEvent false
                if (loadingScreen) return@onKeyEvent ev.key != Key.Back
                when (ev.key) {
                    Key.MediaPlay -> { touchControls(); player.resume(); true }
                    Key.MediaPause -> { touchControls(); player.pause(); true }
                    Key.DirectionCenter, Key.Enter, Key.Spacebar, Key.MediaPlayPause -> {
                        if (ui.isTv && showIntroSkip && !controlsVisible && ev.key != Key.MediaPlayPause) {
                            introSkipped = true
                            player.seekBy(85_000L)
                        } else if (ui.isTv && nearEndFlag && !nextCancelled && nextEpisode != null && ev.key != Key.MediaPlayPause) {
                            onPlayEpisode(nextEpisode)
                        } else {
                            touchControls()
                            player.togglePlayPause()
                        }
                        true
                    }
                    Key.DirectionRight, Key.MediaFastForward -> {
                        touchControls()
                        player.seekBy(15_000L)
                        true
                    }
                    Key.DirectionLeft, Key.MediaRewind -> {
                        touchControls()
                        player.seekBy(-15_000L)
                        true
                    }
                    Key.DirectionDown -> {
                        if (!controlsVisible) touchControls() else showTracksSheet = true
                        true
                    }
                    Key.DirectionUp -> {
                        if (!controlsVisible) touchControls()
                        else if (allEpisodes.isNotEmpty()) showEpisodesSheet = true
                        true
                    }
                    else -> false
                }
            }
            .pointerInput(controlsLocked) {
                detectTapGestures(
                    onTap = {
                        if (controlsLocked) {
                            touchControls()
                        } else if (controlsVisible) {
                            controlsVisible = false
                        } else {
                            touchControls()
                        }
                    },
                    onDoubleTap = { offset ->
                        if (controlsLocked) return@detectTapGestures
                        touchControls()
                        if (offset.x < size.width * 0.4f) player.seekBy(-10_000L)
                        else if (offset.x > size.width * 0.6f) player.seekBy(10_000L)
                        else player.togglePlayPause()
                    },
                )
            }
            .pointerInput(ui.isTv, controlsLocked) {
                if (ui.isTv || controlsLocked) return@pointerInput
                var startX = 0f
                detectVerticalDragGestures(
                    onDragStart = { pos -> startX = pos.x },
                    onVerticalDrag = { _, dragAmount ->
                        val deltaFrac = -dragAmount / (size.height.coerceAtLeast(1) * 0.7f)
                        if (startX < size.width * 0.5f) {
                            // Left half: screen brightness
                            val act = ctx as? Activity ?: return@detectVerticalDragGestures
                            val lp = act.window.attributes
                            val base = if (currentBrightness >= 0f) currentBrightness
                            else if (lp.screenBrightness >= 0f) lp.screenBrightness else 0.5f
                            val next = (base + deltaFrac).coerceIn(0.05f, 1.0f)
                            currentBrightness = next
                            lp.screenBrightness = next
                            act.window.attributes = lp
                            gestureIsBrightness = true
                            gestureHudLabel = "${(next * 100).roundToInt()}%"
                        } else {
                            // Right half: system media volume
                            val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
                                ?: return@detectVerticalDragGestures
                            val maxVol = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
                            val curVol = am.getStreamVolume(AudioManager.STREAM_MUSIC)
                            val step = when {
                                deltaFrac > 0.04f -> 1
                                deltaFrac < -0.04f -> -1
                                else -> 0
                            }
                            if (step != 0) {
                                val nextVol = (curVol + step).coerceIn(0, maxVol)
                                am.setStreamVolume(AudioManager.STREAM_MUSIC, nextVol, 0)
                                gestureIsBrightness = false
                                gestureHudLabel = "${((nextVol * 100f) / maxVol).roundToInt()}%"
                            }
                        }
                    },
                )
            },
    ) {
        // Hardware-composited SurfaceView (HDR10/Dolby Vision + zero GPU copy)
        AndroidView(
            factory = { c ->
                SurfaceView(c).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    keepScreenOn = true
                    player.attachSurface(this)
                }
            },
            modifier = Modifier.fillMaxSize(),
        )

        // Custom styled OpenTV subtitle overlay
        if (state.subtitleCues.isNotEmpty() && !isInPipMode) {
            val style = playbackPrefs.subtitleStyle
            Box(
                contentAlignment = Alignment.BottomCenter,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 32.dp, vertical = if (controlsVisible) 118.dp else 36.dp),
            ) {
                Text(
                    text = state.subtitleCues.joinToString("\n"),
                    color = Color(style.textColorHex),
                    fontSize = style.sizeSp.sp,
                    lineHeight = (style.sizeSp * 1.3f).sp,
                    fontWeight = FontWeight.SemiBold,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(Color.Black.copy(alpha = style.bgAlpha))
                        .padding(horizontal = 12.dp, vertical = 5.dp),
                )
            }
        }

        // Bitmap subtitles (PGS / VobSub): drawn at the cue's fractional position.
        if (state.subtitleBitmaps.isNotEmpty() && !isInPipMode) {
            BoxWithConstraints(Modifier.fillMaxSize()) {
                state.subtitleBitmaps.forEach { cue ->
                    val img = remember(cue.bitmap) { cue.bitmap.asImageBitmap() }
                    Image(
                        bitmap = img,
                        contentDescription = null,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier
                            .offset(x = maxWidth * cue.x.coerceIn(0f, 1f), y = maxHeight * cue.y.coerceIn(0f, 1f))
                            .size(width = maxWidth * cue.width.coerceIn(0.05f, 1f), height = maxHeight * cue.height.coerceIn(0.02f, 1f)),
                    )
                }
            }
        }

        // Mobile gesture brightness/volume indicator pill
        if (gestureHudLabel != null && !isInPipMode) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 64.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(Color(0xCC0E0E11))
                    .border(1.dp, OpenTvColors.GlassBorderStrong, RoundedCornerShape(999.dp))
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            ) {
                Icon(
                    imageVector = if (gestureIsBrightness) Icons.Rounded.Brightness6 else Icons.AutoMirrored.Rounded.VolumeUp,
                    contentDescription = null,
                    tint = ui.accent.color,
                    modifier = Modifier.size(18.dp),
                )
                Text(gestureHudLabel.orEmpty(), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
            }
        }

        // Buffering / Torrent status pill
        if (loadingScreen && !isInPipMode) {
            PlayerLoadingScreen(
                item = item,
                episode = episode,
                status = searchStatus ?: state.statusBanner.ifBlank { "Cargando video…" },
                detail = if (searchStatus != null) searchDetail else state.activeSourceLabel,
            )
        } else if (state.isBuffering && !isInPipMode) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.align(Alignment.Center),
            ) {
                CircularProgressIndicator(color = ui.accent.color, strokeWidth = 3.dp)
                if (state.statusBanner.isNotBlank()) {
                    Text(
                        text = state.statusBanner,
                        color = Color.White,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(Color(0xC00E0E11))
                            .padding(horizontal = 14.dp, vertical = 6.dp),
                    )
                }
            }
        }

        // Error overlay with quick "Elegir otra fuente" CTA
        if (hasError && !isInPipMode) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier
                    .align(Alignment.Center)
                    .clip(RoundedCornerShape(16.dp))
                    .background(Color(0xE60E0E11))
                    .border(1.dp, OpenTvColors.GlassBorderStrong, RoundedCornerShape(16.dp))
                    .padding(22.dp),
            ) {
                Text(errorText, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (sessionRanked.isNotEmpty()) {
                        OpenTvPrimaryButton(
                            text = "Elegir otra fuente",
                            icon = Icons.Rounded.SwapHoriz,
                            onClick = { showSourcesSheet = true },
                            modifier = Modifier.focusRequester(errorFocus),
                        )
                        OpenTvGlassButton(text = "Volver", onClick = onBack)
                    } else {
                        OpenTvGlassButton(text = "Volver", onClick = onBack, modifier = Modifier.focusRequester(errorFocus))
                    }
                }
            }
        }

        // "Omitir intro" (+85 s) pill for series/anime episodes
        if (showIntroSkip && !isInPipMode) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 24.dp, bottom = if (controlsVisible) 128.dp else 32.dp),
            ) {
                OpenTvPrimaryButton(
                    text = if (ui.isTv && !controlsVisible) "Omitir intro (OK)" else "Omitir intro",
                    icon = Icons.Rounded.SkipNext,
                    onClick = {
                        introSkipped = true
                        player.seekBy(85_000L)
                    },
                )
            }
        }

        // Auto-Next Episode prompt + 5s countdown
        val nearEnd = nearEndFlag
        if ((nearEnd || (state.ended && nextEpisode != null)) && !isInPipMode && !nextCancelled) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 24.dp, bottom = if (controlsVisible) 128.dp else 32.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Color(0xEB111116))
                    .border(1.dp, OpenTvColors.GlassBorderStrong, RoundedCornerShape(14.dp))
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                Column {
                    Text(
                        text = if (nextCountdownSec > 0) "Siguiente en ${nextCountdownSec}s" else "Siguiente episodio",
                        style = MaterialTheme.typography.labelMedium,
                        color = ui.accent.color,
                    )
                    Text(
                        "T${nextEpisode!!.season}·E${nextEpisode.number} ${nextEpisode.title}",
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                    )
                }
                OpenTvPrimaryButton(
                    text = "Reproducir",
                    icon = Icons.Rounded.SkipNext,
                    onClick = { nextEpisode?.let(onPlayEpisode) },
                )
                OpenTvRoundIconButton(
                    icon = Icons.Rounded.Close,
                    contentDescription = "Cancelar",
                    size = 38.dp,
                    onClick = { nextCancelled = true },
                )
            }
        }

        // Locked touchscreen unlock pill
        if (controlsLocked && controlsVisible && !isInPipMode) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 32.dp),
            ) {
                OpenTvPrimaryButton(
                    text = "Desbloquear controles",
                    icon = Icons.Rounded.LockOpen,
                    onClick = { controlsLocked = false; touchControls() },
                )
            }
        }

        // Netflix-style OpenTV Desktop HUD overlay
        AnimatedVisibility(
            visible = controlsVisible && !controlsLocked && !isInPipMode && !loadingScreen,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.fillMaxSize(),
        ) {
          if (ui.isTv) {
            Box(Modifier.fillMaxSize()) {
                val infoParts = buildList {
                    if (state.videoHeight > 0) add("${state.videoHeight}p")
                    if (state.activeSourceLabel.isNotBlank()) add(state.activeSourceLabel)
                    if (state.torrentPeers > 0) add("${state.torrentPeers} pares")
                }
                TvPlayerHud(
                    title = titleHeader,
                    subtitle = infoParts.joinToString(" · "),
                    positionMs = positionMs,
                    durationMs = state.durationMs,
                    isPlaying = state.isPlaying,
                    hasEpisodes = allEpisodes.isNotEmpty(),
                    modifier = Modifier.align(Alignment.BottomCenter),
                )
            }
          } else {
            Box(Modifier.fillMaxSize()) {
                // Top gradient bar
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .fillMaxWidth()
                        .background(Brush.verticalGradient(listOf(Color(0xCC000000), Color.Transparent)))
                        .statusBarsPadding()
                        .padding(horizontal = 20.dp, vertical = 14.dp),
                ) {
                    if (!ui.isTv) {
                        OpenTvRoundIconButton(
                            icon = Icons.AutoMirrored.Rounded.ArrowBack,
                            contentDescription = "Volver",
                            size = 40.dp,
                            onClick = onBack,
                        )
                        Spacer(Modifier.width(12.dp))
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = titleHeader,
                            style = MaterialTheme.typography.titleLarge,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        val infoParts = buildList {
                            if (state.videoHeight > 0) add("${state.videoHeight}p")
                            if (state.activeSourceLabel.isNotBlank()) add(state.activeSourceLabel)
                            if (state.torrentPeers > 0) add("${state.torrentPeers} pares")
                        }
                        if (infoParts.isNotEmpty()) {
                            Text(text = infoParts.joinToString(" · "), style = MaterialTheme.typography.labelMedium)
                        }
                    }
                    if (!ui.isTv) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OpenTvRoundIconButton(
                                icon = Icons.Rounded.Lock,
                                contentDescription = "Bloquear controles",
                                size = 40.dp,
                                onClick = { controlsLocked = true },
                            )
                            OpenTvRoundIconButton(
                                icon = Icons.Rounded.PictureInPictureAlt,
                                contentDescription = "Ventana flotante",
                                size = 40.dp,
                                onClick = onEnterPip,
                            )
                        }
                    }
                }

                // Bottom seekbar & controls
                Column(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xE6000000))))
                        .padding(horizontal = 22.dp, vertical = 16.dp),
                ) {
                    val duration = state.durationMs.coerceAtLeast(1L)
                    val sliderVal = (positionMs.toFloat() / duration.toFloat()).coerceIn(0f, 1f)

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(formatTime(positionMs), fontSize = 12.sp, color = Color.White)
                        Slider(
                            value = sliderVal,
                            onValueChange = { frac ->
                                touchControls()
                                player.seekTo((frac * duration).toLong())
                            },
                            colors = SliderDefaults.colors(
                                thumbColor = ui.accent.color,
                                activeTrackColor = ui.accent.color,
                                inactiveTrackColor = Color(0x4DFFFFFF),
                            ),
                            modifier = Modifier.weight(1f),
                        )
                        Text(formatTime(state.durationMs), fontSize = 12.sp, color = OpenTvColors.TextSecondary)
                    }

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            OpenTvRoundIconButton(
                                icon = Icons.Rounded.Replay10,
                                contentDescription = "-10s",
                                size = 40.dp,
                                onClick = { touchControls(); player.seekBy(-10_000L) },
                            )
                            OpenTvRoundIconButton(
                                icon = if (state.isPlaying) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                                contentDescription = if (state.isPlaying) "Pausar" else "Reproducir",
                                size = 46.dp,
                                selected = true,
                                onClick = { touchControls(); player.togglePlayPause() },
                            )
                            OpenTvRoundIconButton(
                                icon = Icons.Rounded.Forward10,
                                contentDescription = "+10s",
                                size = 40.dp,
                                onClick = { touchControls(); player.seekBy(10_000L) },
                            )
                        }

                        if (ui.isTv) {
                            Text(
                                text = "←/→ Saltar  ·  ↓ Audio y Subs" +
                                    (if (allEpisodes.isNotEmpty()) "  ·  ↑ Episodios" else "") +
                                    "  ·  Atrás Salir",
                                style = MaterialTheme.typography.labelMedium,
                            )
                        }

                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (allEpisodes.isNotEmpty()) {
                                OpenTvGlassButton(
                                    text = "Episodios",
                                    icon = Icons.AutoMirrored.Rounded.List,
                                    onClick = { touchControls(); showEpisodesSheet = true },
                                )
                            }
                            OpenTvGlassButton(
                                text = "Audio / Subs",
                                icon = Icons.Rounded.Subtitles,
                                onClick = { touchControls(); showTracksSheet = true },
                            )
                            if (sessionRanked.isNotEmpty()) {
                                OpenTvGlassButton(
                                    text = "Fuentes",
                                    icon = Icons.Rounded.SwapHoriz,
                                    onClick = { touchControls(); showSourcesSheet = true },
                                )
                            }
                        }
                    }
                }
            }
          }
        }

        // "Press Back again" hint (TV)
        if (exitHintVisible && !isInPipMode) {
            Text(
                text = "Pulsa Atrás otra vez para salir",
                color = Color.White,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 36.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(Color(0xE60E0E11))
                    .border(1.dp, OpenTvColors.GlassBorderStrong, RoundedCornerShape(999.dp))
                    .padding(horizontal = 18.dp, vertical = 9.dp),
            )
        }

        // In-player Episodes Quick-Switch Drawer
        if (showEpisodesSheet && allEpisodes.isNotEmpty()) {
            val seasons = remember(allEpisodes) { allEpisodes.map { it.season }.distinct().sorted() }
            val seasonEps = remember(allEpisodes, epDrawerSeason) {
                allEpisodes.filter { it.season == epDrawerSeason }
            }
            val focusIdx = remember(seasonEps, episode) {
                seasonEps.indexOfFirst { episode?.season == it.season && episode.number == it.number }.coerceAtLeast(0)
            }
            val epListState = rememberLazyListState(initialFirstVisibleItemIndex = focusIdx)
            Box(
                contentAlignment = Alignment.CenterEnd,
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color(0x99000000))
                    .pointerInput(Unit) { detectTapGestures { showEpisodesSheet = false } },
            ) {
                Surface(
                    color = OpenTvColors.Ink900,
                    border = BorderStroke(1.dp, OpenTvColors.GlassBorderStrong),
                    shape = RoundedCornerShape(topStart = 20.dp, bottomStart = 20.dp),
                    modifier = Modifier
                        .fillMaxWidth(if (ui.isTv) 0.44f else 0.86f)
                        .fillMaxHeight()
                        .pointerInput(Unit) { detectTapGestures { } },
                ) {
                    Column(Modifier.fillMaxSize().padding(18.dp)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Episodios", style = MaterialTheme.typography.titleLarge)
                            OpenTvRoundIconButton(Icons.Rounded.Close, "Cerrar", { showEpisodesSheet = false }, size = 36.dp)
                        }
                        if (seasons.size > 1) {
                            Spacer(Modifier.height(10.dp))
                            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                items(seasons, key = { it }) { s ->
                                    OpenTvChip("T$s", s == epDrawerSeason, { epDrawerSeason = s })
                                }
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        LazyColumn(state = epListState, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            itemsIndexed(seasonEps, key = { _, e -> e.id }) { idx, ep ->
                                val isCur = episode?.season == ep.season && episode.number == ep.number
                                val epInteraction = remember { MutableInteractionSource() }
                                val epFocused by epInteraction.collectIsFocusedAsState()
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .stableFocusRequester(idx == focusIdx, episodesFocus)
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(if (isCur) Color(0x28FFFFFF) else OpenTvColors.GlassFill)
                                        .border(
                                            width = if (epFocused) 2.5.dp else if (isCur) 1.5.dp else 1.dp,
                                            color = if (epFocused || isCur) ui.accent.color else OpenTvColors.GlassBorder,
                                            shape = RoundedCornerShape(12.dp),
                                        )
                                        .clickable(interactionSource = epInteraction, indication = null) {
                                            showEpisodesSheet = false
                                            if (!isCur) onPlayEpisode(ep)
                                        }
                                        .padding(12.dp),
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        Text(
                                            text = "${ep.number}. ${ep.title}",
                                            style = MaterialTheme.typography.titleMedium,
                                            color = if (isCur) ui.accent.color else Color.White,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                        if (ep.overview.isNotBlank()) {
                                            Text(ep.overview, style = MaterialTheme.typography.labelMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                        }
                                    }
                                    if (isCur) {
                                        Spacer(Modifier.width(8.dp))
                                        Text("Viendo", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = ui.accent.color)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Audio / Subtitles / Speed modal sheet
        if (showTracksSheet) {
            Box(
                contentAlignment = Alignment.CenterEnd,
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color(0x99000000))
                    .pointerInput(Unit) { detectTapGestures { showTracksSheet = false } },
            ) {
                Surface(
                    color = OpenTvColors.Ink900,
                    border = BorderStroke(1.dp, OpenTvColors.GlassBorderStrong),
                    shape = RoundedCornerShape(topStart = 20.dp, bottomStart = 20.dp),
                    modifier = Modifier
                        .fillMaxWidth(if (ui.isTv) 0.42f else 0.85f)
                        .fillMaxHeight()
                        .pointerInput(Unit) { detectTapGestures { } },
                ) {
                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.fillMaxSize().padding(18.dp),
                    ) {
                        item { Text("Audio, Subtítulos y Velocidad", style = MaterialTheme.typography.titleLarge) }
                        item {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Icon(Icons.Rounded.Speed, null, tint = ui.accent.color, modifier = Modifier.size(18.dp))
                                Text("Velocidad", style = MaterialTheme.typography.titleMedium)
                            }
                            Spacer(Modifier.height(6.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                listOf(0.75f, 1.0f, 1.25f, 1.5f).forEach { spd ->
                                    OpenTvChip(
                                        label = "${spd}x",
                                        selected = state.speed == spd,
                                        onClick = { player.setPlaybackSpeed(spd) },
                                    )
                                }
                            }
                        }
                        if (state.audioTracks.isNotEmpty()) {
                            item {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Icon(Icons.Rounded.Audiotrack, null, tint = ui.accent.color, modifier = Modifier.size(18.dp))
                                    Text("Pistas de audio", style = MaterialTheme.typography.titleMedium)
                                }
                            }
                            val focusAudioIdx = state.audioTracks.indexOfFirst { it.selected }.coerceAtLeast(0)
                            itemsIndexed(state.audioTracks) { idx, track ->
                                OpenTvChip(
                                    label = track.label,
                                    selected = track.selected,
                                    onClick = { player.selectAudioTrack(track); showTracksSheet = false },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .stableFocusRequester(idx == focusAudioIdx, tracksFocus),
                                )
                            }
                        }
                        item {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Icon(Icons.Rounded.Subtitles, null, tint = ui.accent.color, modifier = Modifier.size(18.dp))
                                Text("Subtítulos integrados", style = MaterialTheme.typography.titleMedium)
                            }
                        }
                        item {
                            OpenTvChip(
                                label = "Desactivados",
                                selected = state.textTracks.none { it.selected },
                                onClick = { player.selectTextTrack(null); showTracksSheet = false },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .stableFocusRequester(state.audioTracks.isEmpty(), tracksFocus),
                            )
                        }
                        items(state.textTracks) { track ->
                            OpenTvChip(
                                label = track.label,
                                selected = track.selected,
                                onClick = { player.selectTextTrack(track); showTracksSheet = false },
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        item {
                            Text("Subtítulos en línea y archivos", style = MaterialTheme.typography.titleMedium)
                        }
                        item {
                            OpenTvChip(
                                label = if (searchingMoreSubs) "Buscando más subtítulos…" else "Buscar más subtítulos",
                                selected = false,
                                onClick = { searchMoreSubtitles() },
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        if (!ui.isTv) {
                            item {
                                OpenTvChip(
                                    label = "Cargar archivo .srt / .vtt local",
                                    selected = false,
                                    onClick = {
                                        runCatching { localSubLauncher.launch(arrayOf("*/*")) }
                                    },
                                    modifier = Modifier.fillMaxWidth(),
                                )
                            }
                        }
                        items(externalSubs.take(18), key = { it.id }) { sub ->
                            OpenTvChip(
                                label = "${sub.label} · ${sub.source}",
                                selected = false,
                                onClick = {
                                    player.attachExternalSubtitle(sub.url, sub.lang, sub.label)
                                    showTracksSheet = false
                                },
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }
            }
        }

        if (showSourcesSheet) {
            SourcePickerDialog(
                title = titleHeader,
                sources = sessionRanked,
                loading = searchStatus != null,
                onSelect = { src ->
                    showSourcesSheet = false
                    val pos = player.state.value.positionMs
                    startChosen(src, sessionRanked, if (pos > 5_000L) pos else initialResumeMs)
                },
                onDismiss = { showSourcesSheet = false },
            )
        }
    }
}

private fun formatTime(ms: Long): String {
    val totalSec = (ms / 1000L).coerceAtLeast(0L)
    val h = totalSec / 3600L
    val m = (totalSec % 3600L) / 60L
    val s = totalSec % 60L
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%02d:%02d".format(m, s)
}

private const val PLAY_TAG = "OpenTV-Play"

/**
 * In-player source search (owner rule: loading happens inside the player).
 * Stremio plugins and kino JS plugins run in parallel and are ranked as they arrive.
 * Auto-pick waits for direct streams (see [SourceRanker.autoPickReady]): on the 1 GB Fire TV
 * a direct HLS in the viewer's language beats any torrent, and slow sites get a grace window
 * once torrents are in. Sources arriving after the pick are reported through [onRanked]
 * with `picked = null` (picker list + player fallbacks).
 */
private suspend fun searchPlayerSources(
    item: MediaItem,
    episode: Episode?,
    stremio: StremioClient,
    jsPlugins: JsPluginHost,
    plugins: List<InstalledPlugin>,
    sourcePrefs: SourcePrefs,
    mediaCaps: DeviceMediaCaps,
    isLowMemory: Boolean,
    onStatus: (status: String, detail: String) -> Unit,
    onRanked: (ranked: List<StreamSource>, picked: StreamSource?) -> Unit,
    onNothing: (String) -> Unit,
) = coroutineScope {
    val startedAt = System.currentTimeMillis()
    val jsActive = jsPlugins.activePlugins(plugins)
    val pendingJs = java.util.Collections.synchronizedSet(LinkedHashSet(jsActive.map { it.name }))
    var stremioList: List<StreamSource>? = null
    val jsList = java.util.Collections.synchronizedList(mutableListOf<StreamSource>())
    var jsDone = jsActive.isEmpty()
    var firstResultAt = 0L

    onStatus("Buscando la mejor fuente…", "")
    val stremioJob = launch {
        stremioList = runCatching { stremio.fetchStreams(item, episode, plugins) }.getOrDefault(emptyList())
    }
    val jsJob = launch {
        withTimeoutOrNull(70_000L) {
            jsPlugins.fetchStreamsForTitle(item, episode?.season ?: 0, episode?.number ?: 0, plugins) { plugin, found, _ ->
                jsList.addAll(found)
                pendingJs.remove(plugin.name)
            }
        }
        pendingJs.clear()
        jsDone = true
    }

    suspend fun rankAll(): List<StreamSource> {
        val all = stremioList.orEmpty() + synchronized(jsList) { jsList.toList() }
        return withContext(Dispatchers.Default) {
            SourceRanker.rank(all, sourcePrefs, mediaCaps, isEpisode = episode != null, isLowMemory = isLowMemory)
        }
    }

    var ranked = emptyList<StreamSource>()
    var rankedCount = -1
    var picked: StreamSource? = null
    while (true) {
        delay(250L)
        val stremioDone = stremioJob.isCompleted
        val count = stremioList.orEmpty().size + jsList.size
        if (count != rankedCount) {
            ranked = rankAll()
            rankedCount = count
        }
        val now = System.currentTimeMillis()
        if (count > 0 && firstResultAt == 0L) firstResultAt = now
        val allDone = stremioDone && jsDone
        val ready = SourceRanker.autoPickReady(
            ranked = ranked,
            allDone = allDone,
            prefs = sourcePrefs,
            msSinceFirstResult = if (firstResultAt > 0L && stremioDone) now - firstResultAt else 0L,
            msTotal = now - startedAt,
            isLowMemory = isLowMemory,
        )
        if (ready) {
            picked = ranked.firstOrNull()
            break
        }
        val directs = ranked.count { it.isDirect }
        val torrents = ranked.size - directs
        val waiting = synchronized(pendingJs) { pendingJs.toList() }
        val parts = buildList {
            if (ranked.isNotEmpty()) add("$directs directas · $torrents torrents")
            if (waiting.isNotEmpty()) add("esperando a ${waiting.joinToString(", ")}")
        }
        val status = if (waiting.isNotEmpty() && stremioDone) "Consultando ${waiting.first()}…" else "Buscando la mejor fuente…"
        onStatus(status, parts.joinToString(" · "))
    }

    val waitedMs = System.currentTimeMillis() - startedAt
    if (picked == null) {
        jsJob.cancel()
        val why = jsPlugins.lastFailures.take(2).joinToString(" · ")
        Log.w(PLAY_TAG, "no sources after $waitedMs ms ($why)")
        onNothing(why.ifEmpty { "No se encontraron fuentes para este título" })
        return@coroutineScope
    }
    Log.i(
        PLAY_TAG,
        "auto-pick after $waitedMs ms: ${picked.addonName} · ${picked.title.take(80)} direct=${picked.isDirect} " +
            "(${ranked.count { it.isDirect }} directas, ${ranked.count { it.isTorrent }} torrents, " +
            "pendientes=${synchronized(pendingJs) { pendingJs.toList() }})",
    )
    onStatus(if (picked.isTorrent) "Conectando torrent…" else "Conectando con ${picked.addonName}…", "")
    onRanked(ranked, picked)

    // Slow sites keep answering in the background: their streams join the picker and fallbacks.
    if (!jsJob.isCompleted) {
        jsJob.join()
        val count = stremioList.orEmpty().size + jsList.size
        if (count != rankedCount) {
            val late = rankAll()
            Log.i(PLAY_TAG, "late sources: ${late.count { it.isDirect }} directas")
            onRanked(late, null)
        }
    }
}

/** Black loading screen inside the player: dimmed backdrop, title and the current step. */
@Composable
private fun PlayerLoadingScreen(
    item: MediaItem,
    episode: Episode?,
    status: String,
    detail: String,
) {
    val ui = LocalOpenTvUi.current
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        val art = item.backdrop.ifBlank { item.poster }
        if (art.isNotBlank()) {
            OpenTvImage(
                url = art,
                contentDescription = null,
                targetWidthPx = if (ui.isLowSpec) 640 else 960,
                modifier = Modifier.fillMaxSize(),
            )
            Box(
                Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            0f to Color(0x99000000),
                            0.55f to Color(0xCC000000),
                            1f to Color(0xF2000000),
                        ),
                    ),
            )
        }
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.align(Alignment.Center).padding(horizontal = 48.dp),
        ) {
            Text(
                text = item.title,
                color = Color.White,
                fontSize = 26.sp,
                fontWeight = FontWeight.ExtraBold,
                textAlign = TextAlign.Center,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (episode != null) {
                Text(
                    text = "T${episode.season}·E${episode.number}" + if (episode.title.isNotBlank()) " · ${episode.title}" else "",
                    color = Color(0xB3FFFFFF),
                    fontSize = 14.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.height(14.dp))
            CircularProgressIndicator(color = ui.accent.color, strokeWidth = 3.dp, modifier = Modifier.size(34.dp))
            Spacer(Modifier.height(6.dp))
            Text(status, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
            if (detail.isNotBlank()) {
                Text(
                    text = detail,
                    color = Color(0x8CFFFFFF),
                    fontSize = 12.sp,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (ui.isTv) {
            Text(
                text = "Pulsa Atrás para cancelar",
                color = Color(0x66FFFFFF),
                fontSize = 11.sp,
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 28.dp),
            )
        }
    }
}

/** Player loading screen shown while the title's detail/episode is still being resolved. */
@Composable
fun PlayerPreparingScreen(item: MediaItem) {
    PlayerLoadingScreen(item = item, episode = null, status = "Buscando la mejor fuente…", detail = "")
}
