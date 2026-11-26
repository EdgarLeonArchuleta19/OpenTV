package com.techpoint.opentv.ui.home

import com.techpoint.opentv.ui.components.formatDurationEs
import com.techpoint.opentv.ui.components.formatHeroGenres
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.BringIntoViewSpec
import androidx.compose.foundation.gestures.LocalBringIntoViewSpec
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.rounded.BookmarkAdd
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import com.techpoint.opentv.R
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.ExperimentalComposeUiApi
import com.techpoint.opentv.core.addons.StremioClient
import com.techpoint.opentv.core.data.CatalogRepository
import com.techpoint.opentv.ui.components.FocusMemory
import com.techpoint.opentv.ui.components.LocalFocusMemory
import com.techpoint.opentv.ui.components.rememberFocus
import com.techpoint.opentv.ui.components.TvCenterBringIntoViewSpec
import com.techpoint.opentv.core.model.HomeTab
import com.techpoint.opentv.core.model.InstalledPlugin
import com.techpoint.opentv.core.model.MediaItem
import com.techpoint.opentv.core.model.WatchProgress
import com.techpoint.opentv.core.model.continueWatchingRow
import com.techpoint.opentv.service.RustServiceBridge
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import com.techpoint.opentv.ui.theme.OpenTvColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Remembers the last focused Home card without triggering recomposition, so returning
 * from a detail page puts focus back on the same title (v1 `core/focus.js` memory).
 * [focus] is the live requester of that card, used by the rail's → to go straight back to it.
 */
class HomeFocusMemory {
    var key: String? = null
    val focus = FocusMemory()
}

private val TvBg: Color @Composable @ReadOnlyComposable get() = OpenTvColors.BgCanvas

// v1 TV metrics (1920x1080 canvas halved to dp).
private val ContentStart = 120.dp
private val ContentEnd = 60.dp
private val TopBarSpace = 76.dp
private val PosterW = 131.dp
private val PosterH = 189.dp
private val RowHeaderH = 27.dp
private val HeroH = 325.dp

@OptIn(ExperimentalFoundationApi::class)
private object NoAutoScrollSpec : BringIntoViewSpec {
    override fun calculateScrollDistance(offset: Float, size: Float, containerSize: Float): Float = 0f
}

/** Keeps focus inside [lead, container - trail] so half a poster past the focused one stays visible. */
@OptIn(ExperimentalFoundationApi::class)
private class RowScrollSpec(private val lead: Float, private val trail: Float) : BringIntoViewSpec {
    override fun calculateScrollDistance(offset: Float, size: Float, containerSize: Float): Float {
        val end = containerSize - trail
        return when {
            offset < lead -> offset - lead
            offset + size > end -> offset + size - end
            else -> 0f
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TvHomeCatalog(
    tab: HomeTab,
    stremio: StremioClient,
    catalogs: CatalogRepository,
    plugins: List<InstalledPlugin>,
    continueWatching: List<WatchProgress>,
    isInMyList: (String) -> Boolean,
    onScrolledChanged: (Boolean) -> Unit,
    onPlayItem: (MediaItem) -> Unit,
    onResumeEntry: (WatchProgress) -> Unit,
    onOpenDetail: (MediaItem) -> Unit,
    onToggleMyList: (MediaItem) -> Unit,
    focusMemory: HomeFocusMemory,
    requestInitialFocus: Boolean,
    onInitialFocusConsumed: () -> Unit,
    onContentReady: () -> Unit,
    modifier: Modifier = Modifier,
    topBarFocus: FocusRequester? = null,
) {
    val ui = LocalOpenTvUi.current
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()

    // Rows come from the app-wide repository: instant on tab switches / back from Detail,
    // painted from the disk snapshot on a cold start, refreshed in the background.
    val sectionFlow = remember(tab) { catalogs.section(tab.id) }
    val section by sectionFlow.collectAsState()
    val rows = section.rows
    val loading = section.pending
    var heroIndex by remember(tab) { mutableIntStateOf(0) }
    var heroFocused by remember { mutableStateOf(false) }

    val listState = rememberLazyListState()
    val isScrolled by remember {
        derivedStateOf { listState.firstVisibleItemIndex > 0 || listState.firstVisibleItemScrollOffset > 140 }
    }
    LaunchedEffect(isScrolled) { onScrolledChanged(isScrolled) }

    LaunchedEffect(tab, plugins) { catalogs.ensureLoaded(tab.id, plugins) }
    val hasContent = rows.isNotEmpty() || section.isEmptyAndIdle
    LaunchedEffect(hasContent) {
        if (!hasContent) return@LaunchedEffect
        onContentReady()
        // Warm the other big sections once the first screen is up (sequential, background).
        if (tab == HomeTab.HOME) catalogs.prefetch(listOf("movies", "series"), plugins)
    }

    val heroItems = remember(rows) {
        rows.firstOrNull()?.items?.filter { it.backdrop.isNotBlank() }?.take(6).orEmpty()
    }

    // v1: rotate every 9 s; paused while focus sits on the hero or the page is scrolled.
    LaunchedEffect(heroItems, heroFocused, isScrolled) {
        if (heroItems.size <= 1 || heroFocused || isScrolled) return@LaunchedEffect
        while (true) {
            delay(9_000L)
            heroIndex = (heroIndex + 1) % heroItems.size
        }
    }

    val filteredContinue = remember(continueWatching, tab) {
        continueWatching.continueWatchingRow().filter { entry ->
            when (tab) {
                HomeTab.MOVIES -> entry.type == "movie"
                HomeTab.SERIES -> entry.type == "series"
                HomeTab.ANIME -> entry.type == "anime"
                HomeTab.HOME -> true
                else -> false
            }
        }
    }

    if (loading && rows.isEmpty()) {
        TvHomeSkeleton(modifier)
        return
    }

    val heroPlayFocus = remember { FocusRequester() }
    val restoreKey = remember(tab) { focusMemory.key }
    LaunchedEffect(requestInitialFocus, heroItems.isNotEmpty()) {
        if (requestInitialFocus && restoreKey == null && heroItems.isNotEmpty()) {
            delay(80L)
            runCatching { heroPlayFocus.requestFocus() }
            onInitialFocusConsumed()
        }
    }

    // Center the focused row (v1 `core/focus.js` 456-470); the hero snaps the page back to the top.
    // With a hero the list has no top padding (the hero runs under the top bar, like PC).
    val listTopPad = if (heroItems.isNotEmpty()) 0.dp else TopBarSpace
    val rowCenterOffsetPx = with(density) {
        // Target row top = (540 - (header + poster)) / 2 = 162dp from the screen top.
        -((162.dp - listTopPad).roundToPx())
    }
    fun focusRowAt(index: Int) {
        scope.launch {
            if (index == 0) listState.animateScrollToItem(0)
            else listState.animateScrollToItem(index, rowCenterOffsetPx)
        }
    }

    // Focused card stays centred (clamped at both ends), so ← always walks back to the first
    // poster instead of the focus sliding under the rail and escaping to it.
    val rowSpec: BringIntoViewSpec = TvCenterBringIntoViewSpec

    CompositionLocalProvider(
        LocalBringIntoViewSpec provides NoAutoScrollSpec,
        LocalFocusMemory provides focusMemory.focus,
    ) {
        LazyColumn(
            state = listState,
            contentPadding = PaddingValues(top = listTopPad, bottom = 140.dp),
            modifier = modifier.fillMaxSize(),
        ) {
            var idx = 0
            if (heroItems.isNotEmpty()) {
                val heroIdx = idx++
                item(key = "hero_${tab.id}", contentType = "hero") {
                    val heroItem = heroItems.getOrNull(heroIndex.coerceIn(0, heroItems.lastIndex))
                    val heroEs by produceState<StremioClient.SpanishInfo?>(null, heroItem?.id) {
                        // produceState keeps its value across key changes: clear it first so the
                        // previous hero's Spanish title/synopsis never shows on the next item.
                        value = null
                        value = heroItem?.let { stremio.spanishInfo(it.id) }
                    }
                    TvHero(
                        items = heroItems,
                        spanish = heroEs,
                        selectedIndex = heroIndex.coerceIn(0, heroItems.lastIndex),
                        isInMyList = isInMyList,
                        onPlay = onPlayItem,
                        onDetails = onOpenDetail,
                        onToggleList = onToggleMyList,
                        playFocus = heroPlayFocus,
                        upFocus = topBarFocus,
                        modifier = Modifier.onFocusChanged {
                            heroFocused = it.hasFocus
                            if (it.hasFocus) focusRowAt(heroIdx)
                        },
                    )
                }
            } else {
                idx++
                item(key = "top_spacer") { Spacer(Modifier.height(24.dp)) }
            }

            if (filteredContinue.isNotEmpty()) {
                val rowIdx = idx++
                item(key = "continue_${tab.id}", contentType = "continue_row") {
                    TvRow(
                        title = "Seguir viendo",
                        onRowFocused = { focusRowAt(rowIdx) },
                        rowSpec = rowSpec,
                        rowHeight = 104.5.dp,
                    ) {
                        items(filteredContinue, key = { "cw_${it.itemId}_${it.season}_${it.episode}" }) { entry ->
                            val k = "cw_${entry.itemId}_${entry.season}_${entry.episode}"
                            TvContinueCard(
                                entry = entry,
                                onClick = { onResumeEntry(entry) },
                                onFocused = { focusMemory.key = k },
                                restoreFocus = k == restoreKey,
                            )
                        }
                    }
                }
            }

            rows.forEach { row ->
                val rowIdx = idx++
                item(key = row.id, contentType = "poster_row") {
                    TvRow(
                        title = row.title,
                        onRowFocused = { focusRowAt(rowIdx) },
                        rowSpec = rowSpec,
                        rowHeight = PosterH,
                    ) {
                        items(row.items, key = { "${row.id}_${it.id}" }) { item ->
                            val k = "${row.id}_${item.id}"
                            TvPosterCard(
                                item = item,
                                onClick = { onOpenDetail(item) },
                                onFocused = { focusMemory.key = k },
                                restoreFocus = k == restoreKey,
                            )
                        }
                    }
                }
            }

            if (rows.isEmpty() && !loading) {
                item(key = "empty") {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier.fillMaxWidth().padding(start = ContentStart, end = ContentEnd, top = 120.dp),
                    ) {
                        Text(
                            text = "No se pudo cargar el catálogo. Revisa tu conexión a internet.",
                            color = OpenTvColors.TextSecondary,
                            fontSize = 15.sp,
                        )
                    }
                }
            }
        }
    }
}

/**
 * Static placeholders shaped like the hero + two poster rows (no shimmer animation: it would
 * redraw every frame on a 1 GB stick). Not focusable: the rail keeps the focus meanwhile.
 */
@Composable
private fun TvHomeSkeleton(modifier: Modifier = Modifier) {
    val block = OpenTvColors.fg(0.051f)
    val shape = RoundedCornerShape(8.dp)
    Column(modifier.fillMaxSize().padding(top = TopBarSpace)) {
        Column(
            verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.Bottom),
            modifier = Modifier.padding(start = ContentStart, top = 20.dp).width(430.dp).height(280.dp),
        ) {
            Box(Modifier.width(70.dp).height(11.dp).clip(shape).background(block))
            Box(Modifier.width(320.dp).height(38.dp).clip(shape).background(block))
            Box(Modifier.width(220.dp).height(14.dp).clip(shape).background(block))
            Box(Modifier.fillMaxWidth().height(30.dp).clip(shape).background(block))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.width(128.dp).height(38.dp).clip(RoundedCornerShape(6.dp)).background(block))
                Box(Modifier.width(150.dp).height(38.dp).clip(RoundedCornerShape(6.dp)).background(block))
            }
        }
        Spacer(Modifier.height(45.dp))
        repeat(2) {
            Box(Modifier.padding(start = ContentStart).width(180.dp).height(16.dp).clip(shape).background(block))
            Spacer(Modifier.height(11.dp))
            Row(
                horizontalArrangement = Arrangement.spacedBy(13.dp),
                modifier = Modifier.padding(start = ContentStart),
            ) {
                repeat(7) { Box(Modifier.size(PosterW, PosterH).clip(shape).background(block)) }
            }
            Spacer(Modifier.height(31.dp))
        }
    }
}

/**
 * Last focused card of one row. Replaces `focusRestorer()`, which in Compose 1.7 pins the
 * focused lazy item and crashes ("Release should only be called once") when the row is
 * disposed on a tab switch. A card registers itself on focus and unregisters on dispose.
 */
class RowFocusMemory {
    var last: FocusRequester? = null
}

val LocalRowFocusMemory = staticCompositionLocalOf<RowFocusMemory?> { null }

@OptIn(ExperimentalFoundationApi::class, ExperimentalComposeUiApi::class)
@Composable
private fun TvRow(
    title: String,
    onRowFocused: () -> Unit,
    rowSpec: BringIntoViewSpec,
    rowHeight: Dp,
    content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 31.dp)
            .onFocusChanged { if (it.hasFocus) onRowFocused() },
    ) {
        Text(
            text = title,
            color = OpenTvColors.Content,
            fontSize = 19.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = (-0.01).em,
            maxLines = 1,
            modifier = Modifier.height(RowHeaderH).padding(start = ContentStart),
        )
        val memory = remember { RowFocusMemory() }
        CompositionLocalProvider(LocalBringIntoViewSpec provides rowSpec, LocalRowFocusMemory provides memory) {
            LazyRow(
                contentPadding = PaddingValues(start = ContentStart, end = ContentEnd),
                horizontalArrangement = Arrangement.spacedBy(13.dp),
                // ↑/↓ back into a row lands on the card that was focused there, not the nearest one.
                modifier = Modifier
                    .fillMaxWidth()
                    .height(rowHeight)
                    .focusProperties { enter = { memory.last ?: FocusRequester.Default } },
                content = content,
            )
        }
    }
}

@Composable
private fun rememberResizedModel(url: String, widthPx: Int): Any? {
    val ctx = LocalContext.current
    val w = com.techpoint.opentv.ui.components.liteWidth(widthPx, LocalOpenTvUi.current.liteMode)
    return remember(url, w) {
        if (url.isBlank()) null
        else ImageRequest.Builder(ctx).data(RustServiceBridge.resizedImageUrl(url, w) ?: url).build()
    }
}

/** v1 TV poster: 131x189dp, radius 8, instant 1.08 focus scale, 2dp inset frame and title overlay. */
@Composable
fun TvPosterCard(
    item: MediaItem,
    onClick: () -> Unit,
    onFocused: () -> Unit = {},
    restoreFocus: Boolean = false,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(8.dp)
    val fr = remember { FocusRequester() }
    if (restoreFocus) {
        LaunchedEffect(Unit) { delay(60L); runCatching { fr.requestFocus() } }
    }
    val rowMemory = LocalRowFocusMemory.current
    LaunchedEffect(focused) {
        if (focused) {
            rowMemory?.last = fr
            onFocused()
        }
    }
    if (rowMemory != null) {
        DisposableEffect(rowMemory, fr) { onDispose { if (rowMemory.last === fr) rowMemory.last = null } }
    }

    Box(
        modifier = Modifier
            .size(PosterW, PosterH)
            .zIndex(if (focused) 1f else 0f)
            .graphicsLayer {
                val s = if (focused) 1.08f else 1f
                scaleX = s
                scaleY = s
            }
            .focusRequester(fr)
            .clip(shape)
            .background(OpenTvColors.CardSurface)
            .rememberFocus()
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
    ) {
        val img = item.poster.ifBlank { item.backdrop }
        val model = rememberResizedModel(img, 280)
        if (model != null) {
            AsyncImage(
                model = model,
                contentDescription = item.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
                modifier = Modifier.fillMaxSize().padding(10.dp),
            ) {
                Image(
                    painter = painterResource(id = R.drawable.ic_opentv_logo),
                    colorFilter = androidx.compose.ui.graphics.ColorFilter.tint(OpenTvColors.Content),
                    contentDescription = null,
                    modifier = Modifier.size(28.dp).alpha(0.32f),
                )
                Text(
                    text = item.title,
                    color = OpenTvColors.TextSecondary,
                    fontSize = 11.sp,
                    textAlign = TextAlign.Center,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (focused) {
            Box(
                contentAlignment = Alignment.BottomStart,
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .fillMaxWidth()
                    .background(
                        Brush.verticalGradient(
                            0f to Color.Transparent,
                            0.45f to Color(0x8C000000),
                            1f to Color(0xE6000000),
                        ),
                    )
                    .padding(start = 8.dp, end = 8.dp, top = 35.dp, bottom = 7.dp),
            ) {
                Text(
                    text = item.title,
                    color = Color.White, // over artwork + dark scrim
                    fontSize = 10.5.sp,
                    lineHeight = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 4,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Box(
            Modifier
                .fillMaxSize()
                .border(
                    width = if (focused) 2.dp else 1.dp,
                    color = if (focused) ui.accent.color else OpenTvColors.fg(0.059f),
                    shape = shape,
                ),
        )
    }
}

@Composable
private fun TvContinueCard(
    entry: WatchProgress,
    onClick: () -> Unit,
    onFocused: () -> Unit,
    restoreFocus: Boolean,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(8.dp)
    val fr = remember { FocusRequester() }
    if (restoreFocus) {
        LaunchedEffect(Unit) { delay(60L); runCatching { fr.requestFocus() } }
    }
    val rowMemory = LocalRowFocusMemory.current
    LaunchedEffect(focused) {
        if (focused) {
            rowMemory?.last = fr
            onFocused()
        }
    }
    if (rowMemory != null) {
        DisposableEffect(rowMemory, fr) { onDispose { if (rowMemory.last === fr) rowMemory.last = null } }
    }

    Box(
        modifier = Modifier
            .size(186.dp, 104.5.dp)
            .zIndex(if (focused) 1f else 0f)
            .graphicsLayer {
                val s = if (focused) 1.08f else 1f
                scaleX = s
                scaleY = s
            }
            .focusRequester(fr)
            .clip(shape)
            .background(OpenTvColors.CardSurface)
            .rememberFocus()
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
    ) {
        val model = rememberResizedModel(entry.backdrop.ifBlank { entry.poster }, 400)
        if (model != null) {
            AsyncImage(model = model, contentDescription = entry.title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
        Box(
            Modifier
                .fillMaxSize()
                .background(Brush.verticalGradient(0.4f to Color.Transparent, 1f to Color(0xE6000000))),
        )
        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(start = 8.dp, end = 8.dp, bottom = 9.dp),
        ) {
            Text(entry.title, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (entry.season > 0 && entry.episode > 0) {
                Text("T${entry.season} · E${entry.episode}", color = Color(0xB3FFFFFF), fontSize = 9.5.sp, maxLines = 1)
            }
        }
        Box(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .fillMaxWidth()
                .height(3.dp)
                .background(Color(0x3DFFFFFF)), // over artwork
        ) {
            Box(Modifier.fillMaxWidth(entry.progress.coerceIn(0.03f, 1f)).fillMaxHeight().background(ui.accent.color))
        }
        Box(
            Modifier
                .fillMaxSize()
                .border(if (focused) 2.dp else 1.dp, if (focused) ui.accent.color else OpenTvColors.fg(0.059f), shape),
        )
    }
}

/** v1 TV hero (`home/rows.js` 191-312, `10-teles.css` 100-136): lives inside the page under the top bar. */
@Composable
private fun TvHero(
    items: List<MediaItem>,
    spanish: StremioClient.SpanishInfo?,
    selectedIndex: Int,
    isInMyList: (String) -> Boolean,
    onPlay: (MediaItem) -> Unit,
    onDetails: (MediaItem) -> Unit,
    onToggleList: (MediaItem) -> Unit,
    playFocus: FocusRequester,
    upFocus: FocusRequester? = null,
    modifier: Modifier = Modifier,
) {
    val baseItem = items.getOrNull(selectedIndex) ?: return
    // Spanish title/synopsis from TMDB when available (v1 parity); Cinemeta English otherwise.
    val item = if (spanish != null) baseItem.copy(
        title = spanish.title.ifBlank { baseItem.title },
        synopsis = spanish.overview.ifBlank { baseItem.synopsis },
    ) else baseItem
    // ↑ from the hero buttons goes to the top bar (the LazyColumn would swallow it otherwise).
    val upMod = Modifier.focusProperties { if (upFocus != null) up = upFocus }
    val inList = isInMyList(item.id)

    // Full-bleed to the top edge: the backdrop also fills the area behind the top bar
    // (PC `HomeScreen` hero). Same single image request, static gradients only.
    Box(modifier = modifier.fillMaxWidth().height(HeroH + TopBarSpace)) {
        // Backdrop: 750dp wide, anchored right, focal point 22% from the top.
        Box(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .width(750.dp)
                .height(330.dp + TopBarSpace),
        ) {
            // Lite mode: no hero artwork.
            val model = rememberResizedModel(if (LocalOpenTvUi.current.liteMode) "" else item.backdrop, 1280)
            if (model != null) {
                AsyncImage(
                    model = model,
                    contentDescription = item.title,
                    contentScale = ContentScale.Crop,
                    alignment = BiasAlignment(0f, -0.56f),
                    modifier = Modifier.fillMaxSize(),
                )
            }
            Box(
                Modifier.fillMaxSize().background(
                    Brush.horizontalGradient(
                        0f to TvBg,
                        0.22f to TvBg.copy(alpha = 0.86f),
                        0.52f to TvBg.copy(alpha = 0.35f),
                        0.72f to Color.Transparent,
                    ),
                ),
            )
            Box(
                Modifier.fillMaxSize().background(
                    Brush.verticalGradient(
                        // Light top scrim for the top bar (which adds its own gradient).
                        0f to TvBg.copy(alpha = 0.45f),
                        0.2f to Color.Transparent,
                        0.62f to Color.Transparent,
                        0.84f to TvBg.copy(alpha = 0.7f),
                        1f to TvBg,
                    ),
                ),
            )
        }

        Column(
            verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.Bottom),
            modifier = Modifier
                .padding(start = ContentStart, top = TopBarSpace + 20.dp)
                .width(530.dp)
                .height(280.dp),
        ) {
            Text(
                text = when {
                    item.isAnime -> "ANIME"
                    item.isSeries -> "SERIE"
                    else -> "PELÍCULA"
                },
                color = OpenTvColors.fg(0.702f),
                fontSize = 11.5.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.22.em,
            )
            val titleSize = when {
                item.title.length > 34 -> 27.sp
                item.title.length > 20 -> 33.sp
                else -> 42.sp
            }
            Text(
                text = item.title,
                color = OpenTvColors.Content,
                fontSize = titleSize,
                lineHeight = titleSize * 1.02f,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = (-0.02).em,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            val meta = buildList {
                if (item.score.isNotBlank() && item.score != "—") add("★ ${item.score}")
                if (item.year.isNotBlank() && item.year != "—") add(item.year)
                val dur = formatDurationEs(item.duration)
                if (dur.isNotBlank()) add(dur)
                add(if (item.isAnime) "Anime" else if (item.isSeries) "Serie" else "Película")
            }.joinToString(" · ")
            Text(meta, color = OpenTvColors.fg(0.902f), fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            val heroGenres = formatHeroGenres(item.genres, max = 3)
            if (heroGenres.isNotBlank()) {
                Text(
                    heroGenres,
                    color = OpenTvColors.fg(0.651f),
                    fontSize = 11.5.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (item.synopsis.isNotBlank()) {
                Text(
                    item.synopsis,
                    color = OpenTvColors.fg(0.82f),
                    fontSize = 13.sp,
                    lineHeight = (13 * 1.45).sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = 430.dp),
                )
            }
            Spacer(Modifier.height(1.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                TvHeroButton("Reproducir", Icons.Rounded.PlayArrow, primary = true, onClick = { onPlay(item) }, modifier = upMod.focusRequester(playFocus))
                TvHeroButton("Más información", Icons.Rounded.Info, primary = false, onClick = { onDetails(item) }, modifier = upMod)
                TvHeroRoundButton(
                    icon = if (inList) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkAdd,
                    description = if (inList) "En Mi lista" else "Agregar a Mi lista",
                    onClick = { onToggleList(item) },
                    modifier = upMod,
                )
            }
        }

        if (items.size > 1) {
            val accentColor = LocalOpenTvUi.current.accent.color
            Row(
                horizontalArrangement = Arrangement.spacedBy(5.dp),
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(end = ContentEnd, top = TopBarSpace + 300.dp),
            ) {
                items.forEachIndexed { i, _ ->
                    val active = i == selectedIndex
                    Box(
                        Modifier
                            .width(if (active) 27.dp else 13.dp)
                            .height(3.dp)
                            .clip(RoundedCornerShape(2.dp))
                            .background(if (active) accentColor else OpenTvColors.fg(0.302f)),
                    )
                }
            }
        }
    }
}

/** Draws v1's focus ring: 2dp dark gap + 2dp white ring outside the button bounds. */
private fun Modifier.tvFocusRing(focused: Boolean, radius: Dp, color: Color): Modifier = drawWithContent {
    drawContent()
    if (focused) {
        val gap = 4.dp.toPx()
        val w = 2.dp.toPx()
        drawRoundRect(
            color = color,
            topLeft = Offset(-gap + w / 2, -gap + w / 2),
            size = Size(size.width + 2 * gap - w, size.height + 2 * gap - w),
            cornerRadius = CornerRadius((radius + 4.dp).toPx()),
            style = Stroke(width = w),
        )
    }
}

@Composable
private fun TvHeroButton(
    text: String,
    icon: ImageVector,
    primary: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(6.dp)
    val bg = if (primary) ui.accent.color else Color(0x806D6D73)
    val fg = if (primary) ui.accent.onAccent else OpenTvColors.Content
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        modifier = modifier
            .graphicsLayer {
                val s = if (focused) 1.06f else 1f
                scaleX = s
                scaleY = s
            }
            .tvFocusRing(focused, 6.dp, OpenTvColors.FocusRing)
            .height(38.dp)
            .clip(shape)
            .background(bg)
            .rememberFocus()
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 19.dp),
    ) {
        Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(16.dp))
        Text(text, color = fg, fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

@Composable
private fun TvHeroRoundButton(icon: ImageVector, description: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .graphicsLayer {
                val s = if (focused) 1.06f else 1f
                scaleX = s
                scaleY = s
            }
            .tvFocusRing(focused, 19.dp, OpenTvColors.FocusRing)
            .size(38.dp)
            .clip(CircleShape)
            .background(if (OpenTvColors.isLight) OpenTvColors.fg(0.06f) else Color(0x80141418))
            .border(1.dp, OpenTvColors.fg(0.549f), CircleShape)
            .rememberFocus()
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
    ) {
        Icon(icon, contentDescription = description, tint = OpenTvColors.Content, modifier = Modifier.size(17.dp))
    }
}

@Suppress("unused")
private fun LazyListState.isAtTop(): Boolean = firstVisibleItemIndex == 0 && firstVisibleItemScrollOffset == 0
