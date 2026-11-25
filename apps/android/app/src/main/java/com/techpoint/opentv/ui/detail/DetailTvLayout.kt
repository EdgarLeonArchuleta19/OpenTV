package com.techpoint.opentv.ui.detail

import com.techpoint.opentv.ui.components.formatDurationEs
import com.techpoint.opentv.ui.components.genreEs
import com.techpoint.opentv.ui.components.stableFocusRequester
import com.techpoint.opentv.ui.components.TvCenteredRowScope
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.rounded.BookmarkBorder
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ClosedCaption
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.FilterList
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.techpoint.opentv.core.model.Episode
import com.techpoint.opentv.core.model.MediaItem
import com.techpoint.opentv.core.model.PlaybackPrefs
import com.techpoint.opentv.core.model.TitleDetail
import com.techpoint.opentv.core.model.WatchProgress
import com.techpoint.opentv.ui.components.OpenTvImage
import com.techpoint.opentv.ui.settings.SetColors
import com.techpoint.opentv.ui.settings.SetSegButton
import com.techpoint.opentv.ui.settings.tsp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import com.techpoint.opentv.ui.theme.OpenTvColors

// v1 TV detail draws a 1920x1080 canvas; 1 v1 px = 0.5 dp here.
private val TvBg: Color @Composable @ReadOnlyComposable get() = OpenTvColors.BgCanvas
private val TvPillFill: Color @Composable @ReadOnlyComposable get() = OpenTvColors.fg(0.129f) // white @ 13%
private val TvPillShape = RoundedCornerShape(percent = 50)
private val TvSeasonShape = RoundedCornerShape(9.dp)
private val TvThumbShape = RoundedCornerShape(10.dp)
private val TvSidePad = 60.dp

// Focus targets used when the lower area swaps sections.
private const val FOCUS_NONE = 0
private const val FOCUS_RELATED = 1
private const val FOCUS_EPISODES = 2
private const val FOCUS_SEASON_BUTTON = 3
private const val FOCUS_SEASON_MENU = 4

/**
 * OpenTV v1 TV-mode detail ("ficha"): a static screen with the title art on the
 * right blended into the canvas, text + action buttons on the left, and one lower
 * section at a time (episodes, then Recomendaciones when pressing Down).
 * No on-screen back button: the remote's Back pops the route.
 */
@Composable
internal fun DetailTvContent(
    detail: TitleDetail,
    loadingMeta: Boolean,
    selectedSeason: Int,
    seasonEpisodes: List<Episode>,
    watchProgress: List<WatchProgress>,
    hasSourcePlugins: Boolean,
    inMyList: Boolean,
    isFavorite: Boolean,
    playbackPrefs: PlaybackPrefs,
    playLabel: String,
    /** Saved progress of what "Reanudar" plays (0 = none): thin bar under the label. */
    resumeProgress: Float = 0f,
    onSelectSeason: (Int) -> Unit,
    onPlay: () -> Unit,
    onPickSource: () -> Unit,
    onPlayEpisode: (Episode) -> Unit,
    onPickEpisodeSource: (Episode) -> Unit,
    onToggleMyList: () -> Unit,
    onToggleFavorite: () -> Unit,
    onUpdatePlayback: ((PlaybackPrefs) -> PlaybackPrefs) -> Unit,
    onShowToast: (String) -> Unit,
    onOpenPlugins: () -> Unit,
    onOpenRelated: (MediaItem) -> Unit,
) {
    val item = detail.item
    val isSeries = detail.seasons.isNotEmpty()
    val related = remember(detail.related) { detail.related.distinctBy { it.id } }

    val playFocus = remember { FocusRequester() }
    val epFocus = remember { FocusRequester() }
    val relFocus = remember { FocusRequester() }
    val seasonFocus = remember { FocusRequester() }
    val seasonMenuFocus = remember { FocusRequester() }

    var showRelated by remember(item.id) { mutableStateOf(false) }
    var seasonMenuOpen by remember(item.id) { mutableStateOf(false) }
    var langDialogOpen by remember(item.id) { mutableStateOf(false) }
    var pendingFocus by remember { mutableIntStateOf(FOCUS_NONE) }
    var lastEpIndex by remember(item.id) { mutableIntStateOf(0) }
    var lastRelIndex by remember(item.id) { mutableIntStateOf(0) }
    val epListState = rememberLazyListState()
    val relListState = rememberLazyListState()

    // Initial focus on "Reproducir" (or "Ir a Plugins") once the first frame is laid out.
    LaunchedEffect(item.id) {
        withFrameNanos { }
        runCatching { playFocus.requestFocus() }
    }

    LaunchedEffect(selectedSeason) {
        lastEpIndex = 0
        runCatching { epListState.scrollToItem(0) }
    }

    LaunchedEffect(pendingFocus, showRelated, seasonMenuOpen) {
        val target = pendingFocus
        if (target == FOCUS_NONE) return@LaunchedEffect
        withFrameNanos { }
        when (target) {
            FOCUS_RELATED -> runCatching { relFocus.requestFocus() }
            FOCUS_EPISODES -> {
                // The remembered episode may be scrolled out; fall back to the season button.
                if (runCatching { epFocus.requestFocus() }.isFailure) {
                    runCatching { seasonFocus.requestFocus() }
                }
            }
            FOCUS_SEASON_BUTTON -> runCatching { seasonFocus.requestFocus() }
            FOCUS_SEASON_MENU -> runCatching { seasonMenuFocus.requestFocus() }
        }
        pendingFocus = FOCUS_NONE
    }

    BackHandler(enabled = seasonMenuOpen) {
        seasonMenuOpen = false
        pendingFocus = FOCUS_SEASON_BUTTON
    }

    val swapToRelated: () -> Boolean = {
        if (related.isNotEmpty()) {
            showRelated = true
            seasonMenuOpen = false
            pendingFocus = FOCUS_RELATED
            true
        } else false
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(TvBg),
    ) {
        if (LocalOpenTvUi.current.liteMode) {
            // Lite mode: the poster (same small file as the home cards) instead of the backdrop.
            val posterShape = RoundedCornerShape(12.dp)
            OpenTvImage(
                url = item.poster.ifBlank { item.backdrop },
                contentDescription = null,
                targetWidthPx = 280,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = 28.dp, end = TvSidePad)
                    .width(134.dp)
                    .aspectRatio(2f / 3f)
                    .clip(posterShape)
                    .border(1.dp, OpenTvColors.fg(0.102f), posterShape),
            )
        } else Box(
            // Title art, top-right, square corners, blended into the canvas.
            modifier = Modifier
                .align(Alignment.TopEnd)
                .width(630.dp)
                .height(354.5.dp),
        ) {
            OpenTvImage(
                url = item.backdrop.ifBlank { item.poster },
                contentDescription = null,
                targetWidthPx = 1280,
                modifier = Modifier.fillMaxSize(),
            )
            Box(
                Modifier
                    .fillMaxSize()
                    .background(
                        Brush.horizontalGradient(
                            0f to TvBg,
                            0.22f to TvBg.copy(alpha = 0.86f),
                            0.52f to TvBg.copy(alpha = 0.3f),
                            0.78f to TvBg.copy(alpha = 0f),
                        ),
                    ),
            )
            Box(
                Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            0f to TvBg.copy(alpha = 0f),
                            0.45f to TvBg.copy(alpha = 0f),
                            0.76f to TvBg.copy(alpha = 0.65f),
                            1f to TvBg,
                        ),
                    ),
            )
        }

        // Text block: x=60, width 440, bottom-anchored at y=228.
        Box(
            contentAlignment = Alignment.BottomStart,
            modifier = Modifier
                .offset(x = TvSidePad)
                .width(440.dp)
                .height(228.dp),
        ) {
            TvInfoBlock(item = item, seasonsCount = detail.seasons.size)
        }

        // Action bar at y=240, same order as PC (`DetailScreen.tsx`):
        // [▶ Reproducir | ☰ Cambiar fuente] [Idioma y subtítulos] | [♡] [🔖]  (no Descargar on TV).
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier
                .offset(x = TvSidePad, y = 240.dp)
                .height(46.dp),
        ) {
            if (hasSourcePlugins) {
                TvSplitPlayButton(
                    label = playLabel,
                    progress = resumeProgress,
                    onPlay = onPlay,
                    onPickSource = onPickSource,
                    playModifier = Modifier.focusRequester(playFocus),
                )
                TvGlassButton(
                    label = "Idioma y subtítulos",
                    icon = Icons.Rounded.ClosedCaption,
                    onClick = { langDialogOpen = true },
                )
            } else {
                Text(
                    text = "Para reproducir, agrega un plugin de fuentes.",
                    fontSize = 11.5.sp,
                    color = OpenTvColors.TextMuted,
                    maxLines = 1,
                )
                TvActionButton(
                    label = "Ir a Plugins",
                    onClick = onOpenPlugins,
                    modifier = Modifier.focusRequester(playFocus),
                )
            }
            // Thin separator between "watch" and "mine".
            Box(
                Modifier
                    .padding(horizontal = 3.dp)
                    .width(1.dp)
                    .height(22.dp)
                    .background(OpenTvColors.fg(0.18f)),
            )
            TvGlassButton(
                icon = if (isFavorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                contentDescription = if (isFavorite) "Quitar de favoritos" else "Añadir a favoritos",
                active = isFavorite,
                onClick = onToggleFavorite,
            )
            TvGlassButton(
                icon = if (inMyList) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder,
                contentDescription = if (inMyList) "Quitar de Mi lista" else "Añadir a Mi lista",
                active = inMyList,
                onClick = onToggleMyList,
            )
        }

        // Lower area: y=295, 245 tall. One section at a time.
        Box(
            modifier = Modifier
                .offset(y = 295.dp)
                .fillMaxWidth()
                .height(245.dp),
        ) {
            val showEpisodes = isSeries && !(showRelated && related.isNotEmpty())
            if (showEpisodes) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    // Header: section title + season button (or inline season choice).
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                        modifier = Modifier
                            .padding(start = TvSidePad)
                            .height(36.dp)
                            .onPreviewKeyEvent { ev ->
                                // With no episodes loaded, Down goes straight to Recomendaciones.
                                if (ev.type == KeyEventType.KeyDown && ev.key == Key.DirectionDown &&
                                    seasonEpisodes.isEmpty()
                                ) swapToRelated() else false
                            },
                    ) {
                        Text(
                            text = "Episodios",
                            fontSize = 19.sp,
                            fontWeight = FontWeight.Bold,
                            color = OpenTvColors.Content,
                        )
                        if (seasonMenuOpen) {
                            LazyRow(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                contentPadding = PaddingValues(end = TvSidePad),
                            ) {
                                items(detail.seasons, key = { it }) { season ->
                                    TvSeasonButton(
                                        text = "Temporada $season",
                                        selected = season == selectedSeason,
                                        showArrow = false,
                                        onClick = {
                                            onSelectSeason(season)
                                            seasonMenuOpen = false
                                            pendingFocus = FOCUS_SEASON_BUTTON
                                        },
                                        modifier = if (season == selectedSeason) {
                                            Modifier.focusRequester(seasonMenuFocus)
                                        } else Modifier,
                                    )
                                }
                            }
                        } else {
                            TvSeasonButton(
                                text = "Temporada $selectedSeason",
                                selected = false,
                                showArrow = true,
                                onClick = {
                                    if (detail.seasons.size > 1) {
                                        seasonMenuOpen = true
                                        pendingFocus = FOCUS_SEASON_MENU
                                    }
                                },
                                modifier = Modifier.focusRequester(seasonFocus),
                            )
                        }
                    }

                    if (seasonEpisodes.isEmpty() && loadingMeta) {
                        TvLoading()
                    } else {
                        val focusIndex = lastEpIndex.coerceIn(0, (seasonEpisodes.size - 1).coerceAtLeast(0))
                        // Focused card stays centred; ← walks back to the first one.
                        TvCenteredRowScope { LazyRow(
                            state = epListState,
                            horizontalArrangement = Arrangement.spacedBy(14.dp),
                            contentPadding = PaddingValues(horizontal = TvSidePad),
                            modifier = Modifier.onPreviewKeyEvent { ev ->
                                if (ev.type == KeyEventType.KeyDown && ev.key == Key.DirectionDown) {
                                    swapToRelated()
                                } else false
                            },
                        ) {
                            itemsIndexed(seasonEpisodes, key = { _, ep -> ep.id }) { index, ep ->
                                val epProgress = watchProgress.firstOrNull {
                                    it.itemId == item.id && it.season == ep.season && it.episode == ep.number
                                }
                                TvEpisodeCard(
                                    episode = ep,
                                    progress = epProgress?.progress ?: 0f,
                                    onPlay = { onPlayEpisode(ep) },
                                    onPickSource = { onPickEpisodeSource(ep) },
                                    modifier = Modifier
                                        .stableFocusRequester(index == focusIndex, epFocus)
                                        .onFocusChanged { if (it.isFocused) lastEpIndex = index },
                                )
                            }
                        } }
                    }
                }
            } else if (related.isNotEmpty()) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.onPreviewKeyEvent { ev ->
                        // Series: Up from Recomendaciones brings the episodes back.
                        if (isSeries && ev.type == KeyEventType.KeyDown && ev.key == Key.DirectionUp) {
                            showRelated = false
                            pendingFocus = FOCUS_EPISODES
                            true
                        } else false
                    },
                ) {
                    Text(
                        text = "Quizás te guste",
                        fontSize = 19.sp,
                        fontWeight = FontWeight.Bold,
                        color = OpenTvColors.Content,
                        modifier = Modifier
                            .padding(start = TvSidePad)
                            .height(36.dp)
                            .padding(top = 6.dp),
                    )
                    val focusIndex = lastRelIndex.coerceIn(0, (related.size - 1).coerceAtLeast(0))
                    TvCenteredRowScope { LazyRow(
                        state = relListState,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        contentPadding = PaddingValues(horizontal = TvSidePad),
                    ) {
                        itemsIndexed(related, key = { _, rel -> rel.id }) { index, rel ->
                            TvRelatedPoster(
                                item = rel,
                                onClick = { onOpenRelated(rel) },
                                modifier = Modifier
                                    .stableFocusRequester(index == focusIndex, relFocus)
                                    .onFocusChanged { if (it.isFocused) lastRelIndex = index },
                            )
                        }
                    } }
                }
            } else if (loadingMeta) {
                Box(Modifier.padding(top = 12.dp)) { TvLoading() }
            }
        }
        if (langDialogOpen) {
            TvLanguageDialog(
                prefs = playbackPrefs,
                onUpdate = onUpdatePlayback,
                onDismiss = {
                    langDialogOpen = false
                    onShowToast("Preferencias de audio y subtítulos guardadas")
                },
            )
        }
    }
}

@Composable
private fun TvLoading() {
    val ui = LocalOpenTvUi.current
    Box(Modifier.padding(start = TvSidePad)) {
        CircularProgressIndicator(
            color = ui.accent.color,
            strokeWidth = 2.dp,
            modifier = Modifier.size(22.dp),
        )
    }
}

@Composable
private fun TvInfoBlock(item: MediaItem, seasonsCount: Int) {
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        val titleSize = when {
            item.title.length > 40 -> 21.sp
            item.title.length > 22 -> 25.sp
            else -> 32.sp
        }
        Text(
            text = item.title,
            style = TextStyle(
                fontSize = titleSize,
                lineHeight = titleSize * 1.12f,
                fontWeight = FontWeight.Bold,
                color = OpenTvColors.Content,
                shadow = Shadow(color = if (OpenTvColors.isLight) Color.Transparent else Color(0x8C000000), offset = Offset(0f, 2f), blurRadius = 18f),
            ),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )

        val meta = buildList {
            if (item.score.isNotBlank() && item.score != "—") add("★ ${item.score}")
            if (item.year.isNotBlank() && item.year != "—") add(item.year)
            val dur = formatDurationEs(item.duration)
            if (dur.isNotBlank()) add(dur)
            if (seasonsCount > 0) add("$seasonsCount ${if (seasonsCount == 1) "temporada" else "temporadas"}")
        }
        if (meta.isNotEmpty()) {
            Text(
                text = meta.joinToString(" · "),
                fontSize = 13.5.sp,
                fontWeight = FontWeight.Medium,
                color = OpenTvColors.fg(0.702f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        if (item.synopsis.isNotBlank()) {
            Text(
                text = item.synopsis,
                fontSize = 13.sp,
                lineHeight = 18.8.sp,
                color = OpenTvColors.fg(0.82f), // white @ 82%
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }

        val displayGenres = remember(item.genres) { item.genres.map(::genreEs).filter { it.isNotBlank() }.distinct().take(4) }
        if (displayGenres.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                displayGenres.forEach { g ->
                    Box(
                        modifier = Modifier
                            .clip(TvPillShape)
                            .background(OpenTvColors.fg(0.102f))
                            .padding(horizontal = 9.dp, vertical = 3.dp),
                    ) {
                        Text(g, fontSize = 10.5.sp, color = OpenTvColors.fg(0.8f), maxLines = 1)
                    }
                }
            }
        }
    }
}

/** v1 TV action button: 37dp pill (or icon-only circle), white 13%; focused = accent fill, dark/contrast content, 1.05x. */
@Composable
private fun TvActionButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    icon: ImageVector? = null,
    contentDescription: String? = null,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val fg = if (focused) ui.accent.onAccent else OpenTvColors.Content
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
        modifier = modifier
            .height(37.dp)
            .then(if (label == null) Modifier.width(37.dp) else Modifier)
            .graphicsLayer {
                val s = if (focused) 1.05f else 1f
                scaleX = s
                scaleY = s
            }
            .clip(TvPillShape)
            .background(if (focused) ui.accent.color else TvPillFill)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .then(if (label != null) Modifier.padding(start = 13.dp, end = 16.dp) else Modifier),
    ) {
        if (icon != null) {
            Icon(
                imageVector = icon,
                contentDescription = if (label == null) contentDescription else null,
                tint = fg,
                modifier = Modifier.size(if (label != null) 19.dp else 17.dp),
            )
        }
        if (label != null) {
            if (icon != null) Spacer(Modifier.width(6.dp))
            Text(
                text = label,
                fontSize = 13.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = fg,
                maxLines = 1,
            )
        }
    }
}

/**
 * Joined split button [▶ Reproducir | ☰ Cambiar fuente]. Modern TV focus: the focused half
 * fills with the accent, the whole group scales 1.05 (graphicsLayer: no layout shift, no ring);
 * unfocused halves are a light translucent surface so the primary still reads as primary.
 */
@Composable
private fun TvSplitPlayButton(
    label: String,
    progress: Float = 0f,
    onPlay: () -> Unit,
    onPickSource: () -> Unit,
    playModifier: Modifier = Modifier,
) {
    val ui = LocalOpenTvUi.current
    val playInteraction = remember { MutableInteractionSource() }
    val playFocused by playInteraction.collectIsFocusedAsState()
    val pickInteraction = remember { MutableInteractionSource() }
    val pickFocused by pickInteraction.collectIsFocusedAsState()
    val leftShape = RoundedCornerShape(topStart = 12.dp, bottomStart = 12.dp)
    val rightShape = RoundedCornerShape(topEnd = 12.dp, bottomEnd = 12.dp)
    val idleFill = OpenTvColors.fg(0.18f)
    val playFg = if (playFocused) ui.accent.onAccent else OpenTvColors.Content
    val pickFg = if (pickFocused) ui.accent.onAccent else OpenTvColors.Content
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.graphicsLayer {
            val sc = if (playFocused || pickFocused) 1.05f else 1f
            scaleX = sc
            scaleY = sc
        },
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = playModifier
                .height(42.dp)
                .clip(leftShape)
                .background(if (playFocused) ui.accent.color else idleFill)
                .clickable(interactionSource = playInteraction, indication = null, onClick = onPlay)
                .then(
                    if (progress > 0f) {
                        Modifier.drawWithContent {
                            drawContent()
                            // Resume progress: 3 dp track along the bottom edge of the play half.
                            val h = 3.dp.toPx()
                            val inset = 14.dp.toPx()
                            val w = size.width - inset * 2
                            val y = size.height - h - 5.dp.toPx()
                            drawRect(playFg.copy(alpha = 0.25f), topLeft = Offset(inset, y), size = Size(w, h))
                            drawRect(playFg, topLeft = Offset(inset, y), size = Size(w * progress.coerceIn(0f, 1f), h))
                        }
                    } else Modifier,
                )
                .padding(start = 18.dp, end = 16.dp),
        ) {
            Icon(Icons.Rounded.PlayArrow, contentDescription = null, tint = playFg, modifier = Modifier.size(21.dp))
            Spacer(Modifier.width(7.dp))
            Text(label, fontSize = 14.5.sp, fontWeight = FontWeight.Bold, color = playFg, maxLines = 1)
        }
        // 1 dp hairline between the halves.
        Box(Modifier.width(1.dp).height(42.dp).background(OpenTvColors.fg(0.122f)))
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(width = 42.dp, height = 42.dp)
                .clip(rightShape)
                .background(if (pickFocused) ui.accent.color else idleFill)
                .clickable(interactionSource = pickInteraction, indication = null, onClick = onPickSource),
        ) {
            Icon(Icons.Rounded.FilterList, contentDescription = "Cambiar fuente", tint = pickFg, modifier = Modifier.size(19.dp))
        }
    }
}

/**
 * PC glass button (white 6 % fill, 9 % border): label pill when [label] is set, 42 dp circle otherwise.
 * [active] = PC "on" state (white 15 % fill, 30 % border, filled icon). Focus = accent fill + 1.05 scale.
 */
@Composable
private fun TvGlassButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    icon: ImageVector? = null,
    contentDescription: String? = null,
    active: Boolean = false,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = if (label == null) CircleShape else RoundedCornerShape(12.dp)
    val fg = when {
        focused -> ui.accent.onAccent
        active || label != null -> OpenTvColors.Content
        else -> OpenTvColors.fg(0.851f)
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
        modifier = modifier
            .height(42.dp)
            .then(if (label == null) Modifier.width(42.dp) else Modifier)
            // Discreet TV focus: accent fill + 1.05 scale (no outer ring, no layout shift).
            .graphicsLayer {
                val sc = if (focused) 1.05f else 1f
                scaleX = sc
                scaleY = sc
            }
            .clip(shape)
            .background(
                when {
                    focused -> ui.accent.color
                    active -> OpenTvColors.fg(0.149f)
                    else -> OpenTvColors.fg(0.059f)
                },
            )
            .border(
                1.dp,
                when {
                    focused -> ui.accent.color
                    active -> OpenTvColors.fg(0.302f)
                    else -> OpenTvColors.fg(0.09f)
                },
                shape,
            )
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .then(if (label != null) Modifier.padding(horizontal = 16.dp) else Modifier),
    ) {
        if (icon != null) {
            Icon(
                imageVector = icon,
                contentDescription = if (label == null) contentDescription else null,
                tint = fg,
                modifier = Modifier.size(if (label != null) 17.dp else 20.dp),
            )
        }
        if (label != null) {
            if (icon != null) Spacer(Modifier.width(8.dp))
            Text(label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = fg, maxLines = 1)
        }
    }
}

/** One labelled segmented row of [TvLanguageDialog]. */
@Composable
private fun TvLangRow(
    name: String,
    options: List<String>,
    selected: Int,
    onSelect: (Int) -> Unit,
    focusRequester: FocusRequester? = null,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            text = name,
            fontSize = tsp(12.5f),
            fontWeight = FontWeight.Medium,
            color = SetColors.Text70,
            modifier = Modifier.weight(1f),
        )
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .clip(RoundedCornerShape(10.dp))
                .background(SetColors.SegTrack)
                .padding(1.dp),
        ) {
            options.forEachIndexed { idx, label ->
                SetSegButton(
                    label = label,
                    selected = idx == selected,
                    onClick = { onSelect(idx) },
                    modifier = if (focusRequester != null && idx == selected.coerceAtLeast(0)) {
                        Modifier.focusRequester(focusRequester)
                    } else Modifier,
                )
            }
        }
    }
}

/**
 * PC "Audio y subtítulos" dialog: preferred audio, subtitles on/off, subtitle language and size.
 * Saves straight into the playback preferences (same values as Ajustes → Reproducción).
 * Back or "Listo" closes it; focus starts on the selected audio language.
 */
@Composable
private fun TvLanguageDialog(
    prefs: PlaybackPrefs,
    onUpdate: ((PlaybackPrefs) -> PlaybackPrefs) -> Unit,
    onDismiss: () -> Unit,
) {
    val firstFocus = remember { FocusRequester() }
    val langs = listOf("es", "pt", "en")
    val langLabels = listOf("Español", "Portugués", "Inglés")
    val sizes = listOf(16f, 20f, 25f)
    LaunchedEffect(Unit) {
        repeat(2) { withFrameNanos { } }
        runCatching { firstFocus.requestFocus() }
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            verticalArrangement = Arrangement.spacedBy(14.dp),
            modifier = Modifier
                .width(540.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(if (OpenTvColors.isLight) OpenTvColors.Sheet else Color(0xFF141418))
                .border(1.dp, OpenTvColors.fg(0.102f), RoundedCornerShape(18.dp))
                .padding(horizontal = 26.dp, vertical = 22.dp),
        ) {
            Text("Audio y subtítulos", fontSize = tsp(20f), fontWeight = FontWeight.Bold, color = OpenTvColors.Content)
            TvLangRow(
                name = "Audio preferido",
                options = langLabels,
                selected = langs.indexOf(prefs.preferredAudioLang).coerceAtLeast(0),
                onSelect = { i -> onUpdate { it.copy(preferredAudioLang = langs[i]) } },
                focusRequester = firstFocus,
            )
            TvLangRow(
                name = "Subtítulos",
                options = listOf("No", "Sí"),
                selected = if (prefs.subtitlesEnabled) 1 else 0,
                onSelect = { i -> onUpdate { it.copy(subtitlesEnabled = i == 1) } },
            )
            TvLangRow(
                name = "Idioma de subtítulos",
                options = langLabels,
                selected = langs.indexOf(prefs.subtitleStyle.preferredLang).coerceAtLeast(0),
                onSelect = { i -> onUpdate { p -> p.copy(subtitleStyle = p.subtitleStyle.copy(preferredLang = langs[i])) } },
            )
            TvLangRow(
                name = "Tamaño",
                options = listOf("Pequeño", "Normal", "Grande"),
                selected = sizes.indexOf(prefs.subtitleStyle.sizeSp),
                onSelect = { i -> onUpdate { p -> p.copy(subtitleStyle = p.subtitleStyle.copy(sizeSp = sizes[i])) } },
            )
            Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.End) {
                TvActionButton(label = "Listo", onClick = onDismiss)
            }
        }
    }
}

/** v1 TV season button: 34dp tall, radius 9, white 13%; focused = white with dark text. */
@Composable
private fun TvSeasonButton(
    text: String,
    selected: Boolean,
    showArrow: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val fg = if (focused) OpenTvColors.OnContent else OpenTvColors.Content
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .height(34.dp)
            .clip(TvSeasonShape)
            .background(if (focused) OpenTvColors.Content else TvPillFill)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(start = 15.dp, end = 13.dp),
    ) {
        if (selected) {
            Icon(Icons.Rounded.Check, contentDescription = null, tint = fg, modifier = Modifier.size(15.dp))
            Spacer(Modifier.width(5.dp))
        }
        Text(text, fontSize = 13.5.sp, fontWeight = FontWeight.Bold, color = fg, maxLines = 1)
        if (showArrow) {
            Spacer(Modifier.width(7.dp))
            Icon(
                Icons.Rounded.KeyboardArrowDown,
                contentDescription = null,
                tint = if (focused) OpenTvColors.OnContent else OpenTvColors.fg(0.8f),
                modifier = Modifier.size(15.dp),
            )
        }
    }
}

/** Episode card: 16:9 thumbnail with white 2dp frame on focus (no scaling); long press picks a source. */
@Composable
private fun TvEpisodeCard(
    episode: Episode,
    progress: Float,
    onPlay: () -> Unit,
    onPickSource: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val ui = LocalOpenTvUi.current
    if (ui.liteMode) {
        TvLiteEpisodeCard(episode, progress, onPlay, onPickSource, modifier)
        return
    }
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    Column(
        modifier = modifier
            .width(200.dp)
            .combinedClickable(
                interactionSource = interaction,
                indication = null,
                onLongClick = onPickSource,
                onClick = onPlay,
            ),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                .clip(TvThumbShape)
                .background(OpenTvColors.Ink800),
        ) {
            OpenTvImage(
                url = episode.thumbnail,
                contentDescription = null,
                targetWidthPx = 400,
                modifier = Modifier.fillMaxSize(),
            )
            if (focused) {
                // Frame drawn above the image.
                Box(Modifier.fillMaxSize().border(2.dp, OpenTvColors.Content, TvThumbShape))
            }
            if (progress > 0.02f) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .fillMaxWidth()
                        .height(3.dp)
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
        Spacer(Modifier.height(6.dp))
        Text(
            text = "${episode.number}. ${episode.title}",
            fontSize = 11.5.sp,
            fontWeight = FontWeight.SemiBold,
            color = if (focused) OpenTvColors.Content else OpenTvColors.fg(0.851f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (episode.overview.isNotBlank()) {
            Text(
                text = episode.overview,
                fontSize = 9.sp,
                lineHeight = 12.sp,
                color = OpenTvColors.TextMuted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** Lite mode episode card: same row and size, designed without a picture (label, title, synopsis). */
@Composable
private fun TvLiteEpisodeCard(
    episode: Episode,
    progress: Float,
    onPlay: () -> Unit,
    onPickSource: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    Box(
        modifier = modifier
            .width(200.dp)
            .height(150.dp)
            .clip(TvThumbShape)
            .background(if (focused) OpenTvColors.fg(0.122f) else OpenTvColors.fg(0.051f))
            .border(if (focused) 2.dp else 1.dp, if (focused) OpenTvColors.Content else OpenTvColors.fg(0.09f), TvThumbShape)
            .combinedClickable(
                interactionSource = interaction,
                indication = null,
                onLongClick = onPickSource,
                onClick = onPlay,
            ),
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Text(
                text = "EPISODIO ${episode.number}",
                fontSize = 9.5.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.6.sp,
                color = ui.accent.color,
                modifier = Modifier
                    .clip(RoundedCornerShape(5.dp))
                    .background(OpenTvColors.fg(0.071f))
                    .padding(horizontal = 6.dp, vertical = 2.dp),
            )
            Text(
                text = episode.title,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (focused) OpenTvColors.Content else OpenTvColors.fg(0.902f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (episode.overview.isNotBlank()) {
                Text(
                    text = episode.overview,
                    fontSize = 9.5.sp,
                    lineHeight = 12.5.sp,
                    color = OpenTvColors.TextMuted,
                    maxLines = 4,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (progress > 0.02f) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .fillMaxWidth()
                    .height(3.dp)
                    .background(OpenTvColors.fg(0.2f)),
            ) {
                Box(Modifier.fillMaxWidth(progress.coerceIn(0f, 1f)).fillMaxHeight().background(ui.accent.color))
            }
        }
    }
}

/** Related poster: 2:3 art with a white 2dp frame on focus, never scaled (the row would clip it). */
@Composable
private fun TvRelatedPoster(
    item: MediaItem,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(10.dp)
    Column(
        modifier = modifier
            .width(104.dp)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(2f / 3f)
                .clip(shape)
                .background(OpenTvColors.CardSurface),
        ) {
            OpenTvImage(
                url = item.poster,
                contentDescription = item.title,
                targetWidthPx = 240,
                modifier = Modifier.fillMaxSize(),
            )
            if (focused) {
                Box(Modifier.fillMaxSize().border(2.dp, OpenTvColors.Content, shape))
            }
        }
        Spacer(Modifier.height(5.dp))
        Text(
            text = item.title,
            fontSize = 10.5.sp,
            color = if (focused) OpenTvColors.Content else OpenTvColors.fg(0.702f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
