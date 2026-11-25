package com.techpoint.opentv.ui.detail

import com.techpoint.opentv.ui.components.formatDurationEs
import com.techpoint.opentv.ui.components.genreEs
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.rounded.BookmarkBorder
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Extension
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.SwapHoriz
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.techpoint.opentv.core.addons.TmdbDetail
import com.techpoint.opentv.core.addons.StremioClient
import com.techpoint.opentv.core.jsplugins.JsPluginHost
import com.techpoint.opentv.core.model.Episode
import com.techpoint.opentv.core.model.InstalledPlugin
import com.techpoint.opentv.core.model.MediaItem
import com.techpoint.opentv.core.model.SourcePrefs
import com.techpoint.opentv.core.model.StreamSource
import com.techpoint.opentv.core.model.TitleDetail
import com.techpoint.opentv.core.model.WatchProgress
import com.techpoint.opentv.core.ranking.SourceRanker
import com.techpoint.opentv.service.DeviceMediaCaps
import com.techpoint.opentv.service.RustServiceBridge
import com.techpoint.opentv.ui.components.OpenTvChip
import com.techpoint.opentv.ui.components.OpenTvGlassButton
import com.techpoint.opentv.ui.components.OpenTvImage
import com.techpoint.opentv.ui.components.OpenTvPrimaryButton
import com.techpoint.opentv.ui.components.OpenTvRoundIconButton
import com.techpoint.opentv.ui.components.PosterCard
import com.techpoint.opentv.ui.components.SourcePickerDialog
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import com.techpoint.opentv.ui.theme.OpenTvColors
import kotlinx.coroutines.Job
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import com.techpoint.opentv.core.model.PlaybackPrefs
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * What "Reproducir"/"Reanudar" or a picked source asks the player for. [source] = null lets
 * the player search and pick the best one on its loading screen; [ranked] may carry a
 * complete, fresh list from this screen so the player can skip the search.
 */
data class DetailPlayRequest(
    val item: MediaItem,
    val episode: Episode?,
    val episodes: List<Episode>,
    val source: StreamSource?,
    val ranked: List<StreamSource>,
    /** False while the full metadata (year, episodes) is still loading. */
    val detailReady: Boolean,
    val fromStart: Boolean = false,
)

/** "42:10" / "1:05:30" for the resume button (desktop `fmtResume`). */
internal fun formatResumeTime(ms: Long): String {
    val sec = (ms / 1000L).coerceAtLeast(0L)
    val h = sec / 3600L
    val m = (sec % 3600L) / 60L
    val s = sec % 60L
    return if (h > 0) String.format(java.util.Locale.ROOT, "%d:%02d:%02d", h, m, s)
    else String.format(java.util.Locale.ROOT, "%d:%02d", m, s)
}

/**
 * Detail screen. On TV (`ui.isTv`) it renders the OpenTV v1 TV-mode layout
 * ([DetailTvContent]: static screen, art on the right, no on-screen back button).
 * Phone / tablet keep the v1 desktop-like layout (`docs/screenshots/ficha.jpg`):
 * - Clean `#0E0E11` canvas + top-left circular Back button
 * - On TV / landscape: 2-column hero (Left: Title + `★ 7.2` pill + meta + genre chips + `SINOPSIS` + `Leer más`;
 *   Right: rounded `20.dp` 16:9 backdrop card with centered translucent Play circle)
 * - Action row: `[▶ Reproducir]`, `[🔖 Mi lista]`, `[⇄ Cambiar fuente]`, `[↓ Descargar]` (mobile only)
 * - Seasons & Episodes + `Quizás te guste` poster row with captions underneath!
 */
@Composable
fun DetailScreen(
    initialItem: MediaItem,
    stremio: StremioClient,
    jsPlugins: JsPluginHost,
    plugins: List<InstalledPlugin>,
    hasSourcePlugins: Boolean,
    sourcePrefs: SourcePrefs,
    mediaCaps: DeviceMediaCaps,
    inMyList: Boolean,
    watchProgress: List<WatchProgress>,
    onBack: () -> Unit,
    onToggleMyList: (MediaItem) -> Unit,
    isFavorite: Boolean = false,
    onToggleFavorite: (MediaItem) -> Unit = {},
    playbackPrefs: PlaybackPrefs = PlaybackPrefs(),
    onUpdatePlayback: ((PlaybackPrefs) -> PlaybackPrefs) -> Unit = {},
    onOpenPlugins: () -> Unit,
    onOpenRelated: (MediaItem) -> Unit,
    onPlayStream: (DetailPlayRequest) -> Unit,
    onShowToast: (String) -> Unit,
) {
    val ui = LocalOpenTvUi.current
    val scope = rememberCoroutineScope()
    val cfg = LocalConfiguration.current
    val isWide = ui.isTv || cfg.screenWidthDp >= 720

    var detail by remember(initialItem.id) { mutableStateOf(TitleDetail(initialItem)) }
    var loadingMeta by remember(initialItem.id) { mutableStateOf(true) }
    var selectedSeason by remember(initialItem.id) { mutableIntStateOf(1) }
    var loadingSeason by remember(initialItem.id) { mutableStateOf(false) }
    var expandSynopsis by remember(initialItem.id) { mutableStateOf(false) }

    var sources by remember(initialItem.id) { mutableStateOf<List<StreamSource>>(emptyList()) }
    var loadingSources by remember(initialItem.id) { mutableStateOf(false) }
    var activeFetchJob by remember(initialItem.id) { mutableStateOf<Job?>(null) }
    // Only complete lists (Stremio + every JS plugin) are cached: a partial one would hide direct streams.
    val sourcesCache = remember(initialItem.id) { mutableMapOf<String, Pair<Long, List<StreamSource>>>() }
    var pickerOpen by remember { mutableStateOf(false) }
    var pickerEpisode by remember { mutableStateOf<Episode?>(null) }

    LaunchedEffect(initialItem.id) {
        loadingMeta = true
        val savedEp = watchProgress.firstOrNull { it.itemId == initialItem.id && it.season > 0 }
        // TMDB detail comes with the episodes of this season only; the rest load on demand.
        val loaded = stremio.loadDetail(initialItem, preferSeason = savedEp?.season ?: 0)
        detail = loaded
        if (loaded.seasons.isNotEmpty()) {
            selectedSeason = savedEp?.season?.takeIf { it in loaded.seasons } ?: loaded.seasons.first()
        }
        loadingMeta = false
    }

    // Lazy seasons: load the selected season when missing, then the next one in the background
    // (so auto-play can continue into it from the player).
    LaunchedEffect(initialItem.id, selectedSeason, loadingMeta) {
        if (loadingMeta || !detail.item.isSeries) return@LaunchedEffect
        for (season in listOf(selectedSeason, selectedSeason + 1)) {
            if (season !in detail.seasons || detail.episodes.any { it.season == season }) continue
            loadingSeason = season == selectedSeason
            try {
                val eps = stremio.loadSeasonEpisodes(detail.item, season)
                if (eps.isNotEmpty()) detail = detail.copy(episodes = TmdbDetail.mergeEpisodes(detail.episodes, eps))
            } finally {
                loadingSeason = false
            }
        }
    }

    fun cachedSources(ep: Episode?): List<StreamSource>? {
        val cached = sourcesCache["${detail.item.id}_${ep?.id ?: "movie"}"] ?: return null
        return cached.second.takeIf { System.currentTimeMillis() - cached.first < 3 * 60_000L && it.isNotEmpty() }
    }

    suspend fun loadRankedSources(
        ep: Episode?,
        progressive: Boolean = false,
    ): List<StreamSource> {
        val cacheKey = "${detail.item.id}_${ep?.id ?: "movie"}"
        cachedSources(ep)?.let {
            sources = it
            loadingSources = false
            return it
        }

        fun rankNow(list: List<StreamSource>) = SourceRanker.rank(
            sources = list,
            prefs = sourcePrefs,
            caps = mediaCaps,
            isEpisode = ep != null,
            isLowMemory = ui.isLowSpec,
        )

        loadingSources = true
        sources = emptyList()
        var stremioSoFar = emptyList<StreamSource>()
        val jsSoFar = mutableListOf<StreamSource>()
        val stremioJob = scope.async { stremio.fetchStreams(detail.item, ep, plugins) }
        val jsJob = scope.async {
            // Site plugins try several servers inside `resolve` (up to ~60 s); the picker shows
            // each plugin's streams as soon as it answers.
            withTimeoutOrNull(70_000L) {
                jsPlugins.fetchStreamsForTitle(detail.item, ep?.season ?: 0, ep?.number ?: 0, plugins) { _, found, _ ->
                    if (progressive && found.isNotEmpty()) {
                        jsSoFar += found
                        sources = rankNow(stremioSoFar + jsSoFar)
                    }
                }
            }.orEmpty()
        }

        val stremioList = stremioJob.await()
        stremioSoFar = stremioList
        if (progressive && (stremioList.isNotEmpty() || jsSoFar.isNotEmpty())) {
            sources = rankNow(stremioList + jsSoFar)
        }
        val ranked = rankNow(stremioList + jsJob.await())
        sources = ranked
        if (ranked.isNotEmpty()) {
            sourcesCache[cacheKey] = System.currentTimeMillis() to ranked
        }
        loadingSources = false
        return ranked
    }

    fun playRequest(ep: Episode?, src: StreamSource?, all: List<StreamSource>) = DetailPlayRequest(
        item = detail.item,
        episode = ep,
        episodes = detail.episodes,
        source = src,
        ranked = all,
        detailReady = !loadingMeta,
    )

    fun playChosen(ep: Episode?, src: StreamSource, all: List<StreamSource>) {
        onPlayStream(playRequest(ep, src, all))
    }

    fun triggerPlay(ep: Episode?, forcePicker: Boolean) {
        if (!hasSourcePlugins) {
            onShowToast("Agrega un plugin de fuentes en Ajustes → Plugins para reproducir")
            return
        }
        pickerEpisode = ep
        if (forcePicker || !sourcePrefs.autoPlay) {
            activeFetchJob?.cancel()
            pickerOpen = true
            activeFetchJob = scope.launch { loadRankedSources(ep, progressive = true) }
            return
        }
        // Owner rule: the player opens right away and searches/picks on its own loading screen.
        onPlayStream(playRequest(ep, null, cachedSources(ep).orEmpty()))
    }

    fun triggerDownload(ep: Episode?) {
        if (!hasSourcePlugins) {
            onShowToast("Agrega un plugin de fuentes en Plugins para descargar")
            return
        }
        scope.launch {
            onShowToast("Preparando descarga…")
            val ranked = loadRankedSources(ep)
            val best = ranked.firstOrNull()
            if (best == null) {
                onShowToast("Sin fuentes disponibles para descargar")
                return@launch
            }
            val sub = if (ep != null) "T${ep.season} · E${ep.number} ${ep.title}" else detail.item.year
            val res = RustServiceBridge.callRpc(
                "downloadStart",
                buildJsonObject {
                    put("id", "${detail.item.id}_${ep?.id ?: "movie"}")
                    put("title", detail.item.title)
                    put("subtitle", sub)
                    put("poster", detail.item.poster)
                    if (best.isTorrent) {
                        put("hash", best.infoHash)
                        best.fileIdx?.let { put("fileIdx", it) }
                    } else {
                        put("url", best.url)
                    }
                },
            )
            if (res["returnValue"]?.toString() == "false") {
                onShowToast("No se pudo iniciar la descarga")
            } else {
                onShowToast("Descarga iniciada en segundo plano")
            }
        }
    }

    val item = detail.item
    val defaultEpisode = remember(detail, selectedSeason, watchProgress) {
        if (!item.isSeries) null
        else {
            val saved = watchProgress.firstOrNull { it.itemId == item.id && !it.isFinished }
            detail.episodes.firstOrNull { it.season == saved?.season && it.number == saved.episode }
                ?: detail.episodes.firstOrNull { it.season == selectedSeason }
                ?: detail.episodes.firstOrNull()
        }
    }
    val seasonEpisodes = remember(detail.episodes, selectedSeason) {
        detail.episodes.filter { it.season == selectedSeason }
    }
    val hPad = if (ui.isTv) 44.dp else 18.dp

    // Saved, unfinished progress for the title (or the episode "Reproducir" would play).
    val resumeEntry = remember(item.id, watchProgress, defaultEpisode) {
        watchProgress.firstOrNull {
            it.itemId == item.id && !it.isFinished && it.positionMs > 0L &&
                (defaultEpisode == null || (it.season == defaultEpisode.season && it.episode == defaultEpisode.number))
        }
    }

    // Desktop parity: "Reanudar · T1·E3" (series) / "Reanudar · 42:10" (movie) with saved progress.
    val playLabel = when {
        resumeEntry != null && defaultEpisode != null -> "Reanudar · T${defaultEpisode.season}·E${defaultEpisode.number}"
        resumeEntry != null -> "Reanudar · ${formatResumeTime(resumeEntry.positionMs)}"
        else -> "Reproducir"
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(OpenTvColors.BgCanvas),
    ) {
        if (ui.isTv) {
            DetailTvContent(
                detail = detail,
                loadingMeta = loadingMeta || loadingSeason,
                selectedSeason = selectedSeason,
                seasonEpisodes = seasonEpisodes,
                watchProgress = watchProgress,
                hasSourcePlugins = hasSourcePlugins,
                inMyList = inMyList,
                isFavorite = isFavorite,
                playbackPrefs = playbackPrefs,
                playLabel = playLabel,
                resumeProgress = resumeEntry?.progress ?: 0f,
                onSelectSeason = { selectedSeason = it },
                onPlay = { triggerPlay(defaultEpisode, forcePicker = false) },
                onPickSource = { triggerPlay(defaultEpisode, forcePicker = true) },
                onPlayEpisode = { ep -> triggerPlay(ep, forcePicker = false) },
                onPickEpisodeSource = { ep -> triggerPlay(ep, forcePicker = true) },
                onToggleMyList = { onToggleMyList(item) },
                onToggleFavorite = { onToggleFavorite(item) },
                onUpdatePlayback = onUpdatePlayback,
                onShowToast = onShowToast,
                onOpenPlugins = onOpenPlugins,
                onOpenRelated = onOpenRelated,
            )
        } else LazyColumn(
            contentPadding = PaddingValues(bottom = 48.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            // Top bar with circular Back button (`ficha.jpg`)
            item(key = "detail_top") {
                Column(
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .statusBarsPadding()
                        .padding(start = hPad, end = hPad, top = 14.dp),
                ) {
                    OpenTvRoundIconButton(
                        icon = Icons.AutoMirrored.Rounded.ArrowBack,
                        contentDescription = "Volver",
                        size = 40.dp,
                        onClick = onBack,
                    )

                    if (isWide) {
                        // Exact `ficha.jpg` 2-column desktop/TV hero
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(28.dp),
                            verticalAlignment = Alignment.Top,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            DetailInfoColumn(
                                item = item,
                                seasonsCount = detail.seasons.size,
                                expandSynopsis = expandSynopsis,
                                onToggleSynopsis = { expandSynopsis = !expandSynopsis },
                                modifier = Modifier.weight(0.52f),
                            )
                            DetailPreviewCard(
                                url = if (ui.liteMode) "" else item.backdrop.ifBlank { item.poster },
                                title = item.title,
                                canPlay = hasSourcePlugins,
                                onPlay = { triggerPlay(defaultEpisode, forcePicker = false) },
                                modifier = Modifier.weight(0.48f),
                            )
                        }
                    } else {
                        // Mobile portrait: rounded 16:9 backdrop card on top, info neatly below
                        DetailPreviewCard(
                            url = if (ui.liteMode) "" else item.backdrop.ifBlank { item.poster },
                            title = item.title,
                            canPlay = hasSourcePlugins,
                            onPlay = { triggerPlay(defaultEpisode, forcePicker = false) },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        DetailInfoColumn(
                            item = item,
                            seasonsCount = detail.seasons.size,
                            expandSynopsis = expandSynopsis,
                            onToggleSynopsis = { expandSynopsis = !expandSynopsis },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }

                    // Action Row matching `ficha.jpg`
                    if (!hasSourcePlugins) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(14.dp))
                                .background(OpenTvColors.CardSurface)
                                .border(1.dp, OpenTvColors.GlassBorderStrong, RoundedCornerShape(14.dp))
                                .padding(14.dp),
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text("Agrega un plugin de fuentes para reproducir", style = MaterialTheme.typography.titleMedium)
                                Text(
                                    "Instala uno desde Ajustes → Plugins (Comunidad o enlace compatible con Stremio).",
                                    style = MaterialTheme.typography.labelMedium,
                                )
                            }
                            OpenTvPrimaryButton(
                                text = "Plugins",
                                icon = Icons.Rounded.Extension,
                                onClick = onOpenPlugins,
                            )
                        }
                    } else {
                        LazyRow(
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            item {
                                OpenTvPrimaryButton(
                                    text = if (resumeEntry == null && defaultEpisode != null) {
                                        "Reproducir T${defaultEpisode.season}·E${defaultEpisode.number}"
                                    } else playLabel,
                                    icon = Icons.Rounded.PlayArrow,
                                    onClick = { triggerPlay(defaultEpisode, forcePicker = false) },
                                )
                            }
                            item {
                                OpenTvRoundIconButton(
                                    icon = if (isFavorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                                    contentDescription = if (isFavorite) "Quitar de favoritos" else "Añadir a favoritos",
                                    selected = isFavorite,
                                    onClick = { onToggleFavorite(item) },
                                )
                            }
                            item {
                                OpenTvRoundIconButton(
                                    icon = if (inMyList) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder,
                                    contentDescription = if (inMyList) "En Mi lista" else "Mi lista",
                                    selected = inMyList,
                                    onClick = { onToggleMyList(item) },
                                )
                            }
                            item {
                                OpenTvGlassButton(
                                    text = "Cambiar fuente",
                                    icon = Icons.Rounded.SwapHoriz,
                                    onClick = { triggerPlay(defaultEpisode, forcePicker = true) },
                                )
                            }
                            if (!ui.isTv) {
                                item {
                                    OpenTvRoundIconButton(
                                        icon = Icons.Rounded.Download,
                                        contentDescription = "Descargar",
                                        onClick = { triggerDownload(defaultEpisode) },
                                    )
                                }
                            }
                        }
                    }
                }
            }

            if (loadingMeta || loadingSeason) {
                item(key = "meta_loading") {
                    Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = ui.accent.color, strokeWidth = 2.5.dp, modifier = Modifier.size(26.dp))
                    }
                }
            }

            // Seasons & Episodes
            if (detail.seasons.isNotEmpty()) {
                item(key = "seasons_bar") {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(
                            text = "Episodios",
                            style = MaterialTheme.typography.titleLarge,
                            modifier = Modifier.padding(horizontal = hPad),
                        )
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = hPad),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            items(detail.seasons, key = { it }) { season ->
                                OpenTvChip(
                                    label = "Temporada $season",
                                    selected = season == selectedSeason,
                                    onClick = { selectedSeason = season },
                                )
                            }
                        }
                    }
                }

                items(seasonEpisodes, key = { it.id }) { ep ->
                    val epProgress = watchProgress.firstOrNull {
                        it.itemId == item.id && it.season == ep.season && it.episode == ep.number
                    }
                    EpisodeRowCard(
                        episode = ep,
                        progress = epProgress?.progress ?: 0f,
                        onPlay = { triggerPlay(ep, forcePicker = false) },
                        onPickSource = { triggerPlay(ep, forcePicker = true) },
                        modifier = Modifier.padding(horizontal = hPad),
                    )
                }
            }

            // Exact v1 label: "Quizás te guste" with title neatly under each poster (`ficha.jpg`)
            if (detail.related.isNotEmpty()) {
                item(key = "related_row") {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(
                            text = "Quizás te guste",
                            style = MaterialTheme.typography.titleLarge,
                            modifier = Modifier.padding(horizontal = hPad),
                        )
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = hPad),
                            horizontalArrangement = Arrangement.spacedBy(14.dp),
                        ) {
                            items(detail.related, key = { it.id }) { rel ->
                                PosterCard(
                                    item = rel,
                                    showCaptionBelow = true,
                                    onClick = { onOpenRelated(rel) },
                                    width = if (ui.isTv) 132.dp else 118.dp,
                                )
                            }
                        }
                    }
                }
            }
        }

        if (pickerOpen) {
            val subTitle = pickerEpisode?.let { "${item.title} · T${it.season}E${it.number}" } ?: item.title
            SourcePickerDialog(
                title = subTitle,
                sources = sources,
                loading = loadingSources,
                onSelect = { src ->
                    pickerOpen = false
                    playChosen(pickerEpisode, src, sources)
                },
                onDismiss = {
                    activeFetchJob?.cancel()
                    loadingSources = false
                    pickerOpen = false
                },
            )
        }
    }
}

@Composable
private fun DetailInfoColumn(
    item: MediaItem,
    seasonsCount: Int,
    expandSynopsis: Boolean,
    onToggleSynopsis: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = modifier) {
        // Title + inline dark ★ pill (`Heart of the Beast  [★ 7.2]`)
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                text = item.title,
                fontSize = if (item.title.length > 26) 28.sp else 34.sp,
                lineHeight = if (item.title.length > 26) 31.sp else 37.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = (-0.6).sp,
                color = OpenTvColors.Content,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (item.score.isNotBlank() && item.score != "—") {
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(OpenTvColors.GlassFillFocus)
                        .border(1.dp, OpenTvColors.GlassBorder, RoundedCornerShape(999.dp))
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                ) {
                    Text(
                        text = "★ ${item.score}",
                        color = OpenTvColors.Content,
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                    )
                }
            }
        }

        // Metadata line: 2026 · 1 h 45 min · HD
        val meta = buildList {
            if (item.year.isNotBlank() && item.year != "—") add(item.year)
            val dur = formatDurationEs(item.duration)
            if (dur.isNotBlank()) add(dur)
            if (seasonsCount > 0) add("$seasonsCount ${if (seasonsCount == 1) "temporada" else "temporadas"}")
            add("HD")
        }
        Text(
            text = meta.joinToString(" · "),
            color = OpenTvColors.TextMuted,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
        )

        // Genre chips (`Acción` `Aventura` `Drama`)
        val displayGenres = remember(item.genres) { item.genres.map(::genreEs).filter { it.isNotBlank() }.distinct().take(5) }
        if (displayGenres.isNotEmpty()) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(displayGenres) { g ->
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(OpenTvColors.GlassFill)
                            .border(1.dp, OpenTvColors.GlassBorder, RoundedCornerShape(999.dp))
                            .padding(horizontal = 12.dp, vertical = 5.dp),
                    ) {
                        Text(g, fontSize = 12.5.sp, color = OpenTvColors.TextSecondary)
                    }
                }
            }
        }

        // SINOPSIS uppercase header + text + "Leer más" (`ficha.jpg`)
        if (item.synopsis.isNotBlank()) {
            Spacer(Modifier.height(2.dp))
            Text(
                text = "SINOPSIS",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.4.sp,
                color = OpenTvColors.TextMuted,
            )
            Text(
                text = item.synopsis,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = if (expandSynopsis) 12 else 3,
                overflow = TextOverflow.Ellipsis,
            )
            if (item.synopsis.length > 130) {
                Text(
                    text = if (expandSynopsis) "Leer menos" else "Leer más",
                    color = OpenTvColors.Content,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    textDecoration = TextDecoration.Underline,
                    modifier = Modifier.clickable(onClick = onToggleSynopsis),
                )
            }
        }

        if (item.director.isNotBlank() || item.cast.isNotEmpty()) {
            val credit = buildString {
                if (item.director.isNotBlank()) append("Dirección: ${item.director}")
                if (item.cast.isNotEmpty()) {
                    if (isNotEmpty()) append("  ·  ")
                    append("Reparto: ${item.cast.take(4).joinToString(", ")}")
                }
            }
            Text(credit, style = MaterialTheme.typography.labelMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** Exact right-side 16:9 rounded `20.dp` preview frame with centered play circle (`ficha.jpg`). */
@Composable
private fun DetailPreviewCard(
    url: String,
    title: String,
    canPlay: Boolean,
    onPlay: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(20.dp)
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .aspectRatio(16f / 9f)
            .clip(shape)
            .border(1.dp, OpenTvColors.GlassBorderStrong, shape)
            .background(OpenTvColors.CardSurface)
            .clickable(enabled = canPlay, onClick = onPlay),
    ) {
        OpenTvImage(
            url = url,
            contentDescription = title,
            targetWidthPx = 960,
            modifier = Modifier.fillMaxSize(),
        )
        if (canPlay) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(56.dp)
                    .clip(CircleShape)
                    .background(Color(0x8C0E0E11))
                    .border(1.5.dp, Color(0x99FFFFFF), CircleShape),
            ) {
                // Over artwork: stays white in every theme.
                Icon(
                    imageVector = Icons.Rounded.PlayArrow,
                    contentDescription = "Reproducir",
                    tint = Color.White,
                    modifier = Modifier.size(30.dp),
                )
            }
        }
    }
}

@Composable
private fun EpisodeRowCard(
    episode: Episode,
    progress: Float,
    onPlay: () -> Unit,
    onPickSource: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(14.dp)

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (focused) OpenTvColors.GlassFillFocus else OpenTvColors.fg(0.039f))
            .border(
                width = if (focused) 2.5.dp else 1.dp,
                color = if (focused) ui.accent.color else OpenTvColors.GlassBorder,
                shape = shape,
            )
            .clickable(interactionSource = interaction, indication = null, onClick = onPlay)
            .padding(10.dp),
    ) {
        // Lite mode: the row is designed without the picture (label, title, synopsis).
        if (!ui.liteMode) Box(
            modifier = Modifier
                .width(if (ui.isTv) 160.dp else 128.dp)
                .aspectRatio(16f / 9f)
                .clip(RoundedCornerShape(10.dp))
                .background(OpenTvColors.Ink800),
        ) {
            OpenTvImage(
                url = episode.thumbnail,
                contentDescription = episode.title,
                targetWidthPx = 320,
                modifier = Modifier.fillMaxSize(),
            )
            if (progress > 0.02f) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .fillMaxWidth()
                        .height(3.5.dp)
                        .background(Color(0x55FFFFFF)), // over artwork
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(progress.coerceIn(0f, 1f))
                            .fillMaxHeight()
                            .background(ui.accent.color),
                    )
                }
            }
        }
        if (!ui.liteMode) Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            if (ui.liteMode) {
                Text(
                    text = "EPISODIO ${episode.number}",
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.6.sp,
                    color = ui.accent.color,
                )
            }
            Text(
                text = if (ui.liteMode) episode.title else "${episode.number}. ${episode.title}",
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (episode.overview.isNotBlank()) {
                Text(
                    text = episode.overview,
                    style = MaterialTheme.typography.labelMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Spacer(Modifier.width(8.dp))
        OpenTvRoundIconButton(
            icon = Icons.Rounded.SwapHoriz,
            contentDescription = "Elegir fuente",
            size = 38.dp,
            onClick = onPickSource,
        )
    }
}
