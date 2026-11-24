package com.techpoint.opentv.ui.live

import com.techpoint.opentv.ui.components.stableFocusRequester
import com.techpoint.opentv.ui.components.FocusMemory
import com.techpoint.opentv.ui.components.LocalFocusMemory
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.unit.em
import android.view.SurfaceView
import android.view.ViewGroup
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.List
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Fullscreen
import androidx.compose.material.icons.rounded.FullscreenExit
import androidx.compose.material.icons.rounded.LiveTv
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarBorder
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.techpoint.opentv.core.live.LiveTvRepository
import com.techpoint.opentv.core.model.EpgNowNext
import com.techpoint.opentv.core.model.EpgProgram
import com.techpoint.opentv.core.model.LiveChannel
import com.techpoint.opentv.core.model.M3uPlaylist
import com.techpoint.opentv.player.OpenTvPlayer
import com.techpoint.opentv.ui.components.OpenTvChip
import com.techpoint.opentv.ui.components.OpenTvGlassButton
import com.techpoint.opentv.ui.components.OpenTvImage
import com.techpoint.opentv.ui.components.OpenTvPrimaryButton
import com.techpoint.opentv.ui.components.OpenTvRoundIconButton
import com.techpoint.opentv.ui.search.TvKeyboard
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import com.techpoint.opentv.ui.theme.OpenTvColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Which control of the TV layout should take the focus next. */
private enum class LiveFocus { Row, Search, Category, Keyboard, Menu }

private fun epgFor(epgMap: Map<String, EpgNowNext>, ch: LiveChannel): EpgNowNext? =
    epgMap[ch.tvgId.lowercase()] ?: epgMap[ch.tvgName.lowercase()]

@Composable
fun LiveTvScreen(
    liveRepo: LiveTvRepository,
    player: OpenTvPlayer,
    playlists: List<M3uPlaylist>,
    favoriteUrls: List<String>,
    recentChannels: List<LiveChannel>,
    onToggleFavorite: (String) -> Unit,
    onRecordRecent: (LiveChannel) -> Unit,
    onOpenPlugins: () -> Unit,
    onFullscreenChanged: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    // False while the user browses the TV rail: never yank focus out of it.
    canTakeFocus: () -> Boolean = { true },
) {
    val ui = LocalOpenTvUi.current
    val scope = rememberCoroutineScope()
    // Player state is NOT collected here: only tiny composables (spinner, pause pill)
    // observe the fields they need, so position ticks never recompose this screen.

    var channels by remember { mutableStateOf<List<LiveChannel>>(emptyList()) }
    var epgUrls by remember { mutableStateOf<List<String>>(emptyList()) }
    var epgMap by remember { mutableStateOf<Map<String, EpgNowNext>>(emptyMap()) }
    var loading by remember { mutableStateOf(true) }
    var selectedCategory by remember { mutableStateOf("Todos") }
    var activeChannel by remember { mutableStateOf<LiveChannel?>(null) }
    var previousChannel by remember { mutableStateOf<LiveChannel?>(null) }
    var fullscreen by remember { mutableStateOf(false) }
    var drawerOpen by remember { mutableStateOf(false) }
    var guideOpen by remember { mutableStateOf(false) }
    var scheduleChannel by remember { mutableStateOf<LiveChannel?>(null) }
    var scheduleItems by remember { mutableStateOf<List<EpgProgram>>(emptyList()) }
    var scheduleLoading by remember { mutableStateOf(false) }

    // TV-only state
    var channelSearch by remember { mutableStateOf("") }
    var searchKbOpen by remember { mutableStateOf(false) }
    var catMenuOpen by remember { mutableStateOf(false) }
    var bannerVisible by remember { mutableStateOf(false) }
    var bannerTick by remember { mutableIntStateOf(0) }
    var focusTarget by remember { mutableStateOf(LiveFocus.Row) }
    var focusTick by remember { mutableIntStateOf(0) }

    // Hoisted so the list keeps its scroll while the TV layout is swapped for fullscreen.
    val listState = rememberLazyListState()
    val fullscreenFocus = remember { FocusRequester() }
    val drawerFocus = remember { FocusRequester() }
    val rowFocus = remember { FocusRequester() }
    val searchBoxFocus = remember { FocusRequester() }
    val categoryFocus = remember { FocusRequester() }
    val keyboardFocus = remember { FocusRequester() }
    val menuFocus = remember { FocusRequester() }

    fun requestTvFocus(target: LiveFocus) {
        focusTarget = target
        focusTick++
    }

    fun showBanner() {
        bannerVisible = true
        bannerTick++
    }

    fun tuneChannel(ch: LiveChannel, muted: Boolean = false) {
        val current = activeChannel
        if (current != null && current.url != ch.url) previousChannel = current
        activeChannel = ch
        onRecordRecent(ch)
        scope.launch {
            val resolved = liveRepo.resolveLiveUrl(ch)
            player.playLive(resolved, ch.name, muted = muted)
        }
    }

    fun reloadLists() {
        scope.launch {
            loading = true
            val (loaded, urls) = liveRepo.loadChannels(playlists)
            channels = loaded
            epgUrls = urls
            loading = false
            if (activeChannel == null && loaded.isNotEmpty()) {
                tuneChannel(loaded.first(), muted = false)
            }
            if (urls.isNotEmpty() && loaded.isNotEmpty()) {
                epgMap = liveRepo.loadEpgNowNext(urls, loaded)
            }
        }
    }

    LaunchedEffect(playlists) { reloadLists() }
    LaunchedEffect(fullscreen) {
        onFullscreenChanged(fullscreen)
        if (fullscreen) {
            // Coming back from fullscreen restores the focus on the current channel row.
            focusTarget = LiveFocus.Row
            if (ui.isTv) showBanner()
            fullscreenFocus.focusSoon()
        }
    }
    LaunchedEffect(drawerOpen) {
        if (!fullscreen) return@LaunchedEffect
        if (drawerOpen) drawerFocus.focusSoon() else fullscreenFocus.focusSoon()
    }
    LaunchedEffect(bannerTick) {
        if (bannerVisible) {
            delay(5_000L)
            bannerVisible = false
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            onFullscreenChanged(false)
            player.attachSurface(null)
            player.stop()
        }
    }

    val categories = remember(channels, favoriteUrls, recentChannels) {
        val base = mutableListOf("Todos")
        if (favoriteUrls.isNotEmpty()) base.add("Favoritos")
        if (recentChannels.isNotEmpty()) base.add("Recientes")
        val groups = channels.map { it.group }.distinct().sorted().take(40)
        (base + groups).distinct()
    }

    val visibleChannels = remember(channels, selectedCategory, favoriteUrls, recentChannels, channelSearch, epgMap) {
        val byCat = when (selectedCategory) {
            "Todos" -> channels
            "Favoritos" -> channels.filter { it.url in favoriteUrls }
            "Recientes" -> recentChannels
            else -> channels.filter { it.group == selectedCategory }
        }
        val q = channelSearch.trim()
        if (q.isEmpty()) byCat else byCat.filter {
            it.name.contains(q, ignoreCase = true) ||
                it.group.contains(q, ignoreCase = true) ||
                epgFor(epgMap, it)?.now?.title?.contains(q, ignoreCase = true) == true
        }
    }

    fun zapRelative(delta: Int) {
        val list = visibleChannels.ifEmpty { channels }
        if (list.isEmpty()) return
        val curIdx = list.indexOfFirst { it.url == activeChannel?.url }.coerceAtLeast(0)
        val next = list[(curIdx + delta + list.size) % list.size]
        tuneChannel(next, muted = false)
    }

    fun openSchedule(ch: LiveChannel) {
        scheduleChannel = ch
        scheduleItems = emptyList()
        scheduleLoading = true
        scope.launch {
            scheduleItems = liveRepo.loadChannelSchedule12h(ch)
            scheduleLoading = false
        }
    }

    if (fullscreen) {
        BackHandler {
            if (drawerOpen) drawerOpen = false else fullscreen = false
        }

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black)
                .focusRequester(fullscreenFocus)
                .focusable()
                .onKeyEvent { ev ->
                    if (ev.type != KeyEventType.KeyDown) return@onKeyEvent false
                    if (ui.isTv) {
                        when (ev.key) {
                            Key.DirectionUp -> if (!drawerOpen) { zapRelative(-1); showBanner(); true } else false
                            Key.DirectionDown -> if (!drawerOpen) { zapRelative(1); showBanner(); true } else false
                            Key.DirectionCenter, Key.Enter, Key.NumPadEnter -> {
                                if (!drawerOpen) {
                                    // v1: OK shows the banner; with it on screen, pauses/resumes.
                                    if (bannerVisible) player.togglePlayPause()
                                    showBanner()
                                    true
                                } else false
                            }
                            Key.DirectionRight -> if (!drawerOpen) { drawerOpen = true; true } else false
                            Key.DirectionLeft, Key.Zero, Key.NumPad0 -> {
                                if (!drawerOpen) {
                                    previousChannel?.let { tuneChannel(it); showBanner() }
                                    true
                                } else false
                            }
                            Key.Menu -> {
                                activeChannel?.let { openSchedule(it) }
                                true
                            }
                            else -> false
                        }
                    } else {
                        when (ev.key) {
                            Key.DirectionUp -> { if (!drawerOpen) { zapRelative(-1); true } else false }
                            Key.DirectionDown -> { if (!drawerOpen) { zapRelative(1); true } else false }
                            Key.DirectionRight, Key.DirectionCenter, Key.Enter -> {
                                if (!drawerOpen) { drawerOpen = true; true } else false
                            }
                            else -> false
                        }
                    }
                },
        ) {
            AndroidView(
                factory = { ctx ->
                    SurfaceView(ctx).apply {
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
            LiveBufferingSpinner(player, size = 40)

            val ch = activeChannel
            if (ui.isTv) {
                // v1 TV channel banner (no on-screen buttons on TV).
                if (ch != null && bannerVisible && !drawerOpen) {
                    val number = remember(channels, ch.url) { channels.indexOfFirst { it.url == ch.url } + 1 }
                    LiveTvBanner(channel = ch, number = number, epg = epgFor(epgMap, ch))
                }
            } else if (ch != null && !drawerOpen) {
                // Bottom capsule action bar (exact `.player-infobar .pi-actions`)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 26.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(Color(0xB8101014))
                        .border(1.dp, OpenTvColors.GlassBorderStrong, RoundedCornerShape(999.dp))
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                ) {
                    Text(ch.name, style = MaterialTheme.typography.titleMedium, maxLines = 1)
                    val isFav = ch.url in favoriteUrls
                    OpenTvRoundIconButton(
                        icon = if (isFav) Icons.Rounded.Star else Icons.Rounded.StarBorder,
                        contentDescription = "Favorito",
                        selected = isFav,
                        size = 40.dp,
                        onClick = { onToggleFavorite(ch.url) },
                    )
                    OpenTvRoundIconButton(
                        icon = Icons.Rounded.CalendarMonth,
                        contentDescription = "Programación",
                        size = 40.dp,
                        onClick = { openSchedule(ch) },
                    )
                    OpenTvRoundIconButton(
                        icon = Icons.AutoMirrored.Rounded.List,
                        contentDescription = "Canales",
                        size = 40.dp,
                        onClick = { drawerOpen = true },
                    )
                    OpenTvRoundIconButton(
                        icon = Icons.Rounded.FullscreenExit,
                        contentDescription = "Salir",
                        size = 40.dp,
                        onClick = { fullscreen = false },
                    )
                }
            }

            // Slide-in right channel drawer (`player-channels` from `08-en-vivo-reproductor.css`)
            if (drawerOpen) {
                val focusUrl = activeChannel?.url?.takeIf { u -> visibleChannels.any { it.url == u } }
                    ?: visibleChannels.firstOrNull()?.url
                val startIdx = remember { visibleChannels.indexOfFirst { it.url == focusUrl }.coerceAtLeast(0) }
                val drawerListState = rememberLazyListState(initialFirstVisibleItemIndex = startIdx)
                Surface(
                    color = Color(0xF00B0B0E),
                    border = BorderStroke(1.dp, OpenTvColors.GlassBorderStrong),
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .fillMaxWidth(if (ui.isTv) 0.42f else 0.84f)
                        .fillMaxHeight(),
                ) {
                    Column(Modifier.fillMaxSize().padding(14.dp)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Canales (${visibleChannels.size})", style = MaterialTheme.typography.titleLarge)
                            if (!ui.isTv) {
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OpenTvRoundIconButton(Icons.Rounded.Refresh, "Actualizar", { reloadLists() }, size = 36.dp)
                                    OpenTvRoundIconButton(Icons.Rounded.Close, "Cerrar", { drawerOpen = false }, size = 36.dp)
                                }
                            }
                        }
                        Spacer(Modifier.height(10.dp))
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            items(categories, key = { it }) { cat ->
                                if (ui.isTv) {
                                    LiveTvCategoryPill(cat, cat == selectedCategory) { selectedCategory = cat }
                                } else {
                                    OpenTvChip(cat, cat == selectedCategory, { selectedCategory = cat })
                                }
                            }
                        }
                        Spacer(Modifier.height(10.dp))
                        LazyColumn(
                            state = drawerListState,
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            items(visibleChannels, key = { it.id }) { chItem ->
                                ChannelRowCard(
                                    channel = chItem,
                                    epg = epgFor(epgMap, chItem),
                                    active = chItem.url == activeChannel?.url,
                                    onClick = {
                                        tuneChannel(chItem, muted = false)
                                        drawerOpen = false
                                        if (ui.isTv) showBanner()
                                    },
                                    modifier = Modifier.stableFocusRequester(chItem.url == focusUrl, drawerFocus),
                                )
                            }
                        }
                    }
                }
            }

            if (scheduleChannel != null) {
                Schedule12hDialog(
                    channel = scheduleChannel!!,
                    items = scheduleItems,
                    loading = scheduleLoading,
                    onDismiss = { scheduleChannel = null },
                )
            }
        }
        return
    }

    // Standard desktop-faithful Live TV screen (split preview + dock + guide)
    val topPad = if (ui.isTv) 80.dp else 108.dp
    val hPad = if (ui.isTv) 28.dp else 14.dp

    if (playlists.isEmpty()) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = modifier.fillMaxSize().padding(top = topPad, start = 24.dp, end = 24.dp),
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Icon(Icons.Rounded.LiveTv, null, tint = OpenTvColors.TextMuted, modifier = Modifier.size(48.dp))
                Text("Sin listas de TV en vivo", style = MaterialTheme.typography.headlineMedium)
                Text(
                    "Agrega listas M3U desde Plugins → Comunidad (Pluto TV, Plex, TDTChannels…) o pega tu propio enlace.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                OpenTvPrimaryButton("Ir a Plugins", onClick = onOpenPlugins)
            }
        }
        return
    }

    if (ui.isTv) {
        // v1 TV layout (`10-teles.css` live-3a): channel column on the left, video on the right.
        val focusUrl = activeChannel?.url?.takeIf { u -> visibleChannels.any { it.url == u } }
            ?: visibleChannels.firstOrNull()?.url
        val hasChannels = visibleChannels.isNotEmpty()

        suspend fun focusChannelRow() {
            val list = visibleChannels
            if (list.isEmpty()) return
            val idx = list.indexOfFirst { it.url == focusUrl }.coerceAtLeast(0)
            if (listState.layoutInfo.visibleItemsInfo.none { it.index == idx }) {
                listState.scrollToItem(idx)
            }
            rowFocus.focusSoon()
        }

        // Runs on first entry, on every return from fullscreen (this branch re-enters
        // composition) and whenever a control asks for the focus explicitly.
        LaunchedEffect(focusTick) {
            when (focusTarget) {
                LiveFocus.Row -> if (!searchKbOpen && !catMenuOpen && canTakeFocus()) focusChannelRow()
                LiveFocus.Search -> searchBoxFocus.focusSoon()
                LiveFocus.Category -> categoryFocus.focusSoon()
                LiveFocus.Keyboard -> keyboardFocus.focusSoon()
                LiveFocus.Menu -> menuFocus.focusSoon()
            }
        }
        // Initial focus once the channels arrive.
        LaunchedEffect(hasChannels) {
            if (hasChannels && focusTarget == LiveFocus.Row && !searchKbOpen && !catMenuOpen && canTakeFocus()) focusChannelRow()
        }

        if (searchKbOpen) {
            BackHandler {
                searchKbOpen = false
                requestTvFocus(LiveFocus.Search)
            }
        }
        if (catMenuOpen) {
            BackHandler {
                catMenuOpen = false
                requestTvFocus(LiveFocus.Category)
            }
        }

        // 10-foot "Design 3A" (PC LiveTvScreen): channel column | 16:9 stage + info bar.
        // Fills the safe area under the top bar; nothing animates, lists are lazy.
        val scale = ui.textScale
        val listMemory = remember { FocusMemory() }
        val controlsFocus = remember { FocusRequester() }
        Row(
            modifier = modifier
                .fillMaxSize()
                .padding(top = 78.dp, end = 40.dp, bottom = 22.dp),
        ) {
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier
                    .width(276.dp)
                    .fillMaxHeight(),
            ) {
                if (searchKbOpen) {
                    // v1 `.tvk-panel` over the column (core/tv-keyboard.js).
                    TvKeyboard(
                        value = channelSearch,
                        onValueChange = { channelSearch = it },
                        placeholder = "Buscar canal",
                        doneLabel = "Listo",
                        onDone = {
                            searchKbOpen = false
                            requestTvFocus(if (visibleChannels.isNotEmpty()) LiveFocus.Row else LiveFocus.Search)
                        },
                        firstKeyFocusRequester = keyboardFocus,
                        keyHeight = 31.dp,
                        keyFontSize = (13f * scale).sp,
                        displayHeight = 36.dp,
                        displayFontSize = (13f * scale).sp,
                        gap = 5.dp,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        text = "${visibleChannels.size} canales",
                        color = OpenTvColors.TextMuted,
                        fontSize = (12f * scale).sp,
                    )
                } else {
                    LiveTvSearchBox(
                        text = channelSearch,
                        onClick = {
                            searchKbOpen = true
                            catMenuOpen = false
                            requestTvFocus(LiveFocus.Keyboard)
                        },
                        modifier = Modifier.focusRequester(searchBoxFocus),
                    )
                    LiveTvCategoryButton(
                        label = selectedCategory,
                        expanded = catMenuOpen,
                        onClick = {
                            if (catMenuOpen) {
                                catMenuOpen = false
                            } else {
                                catMenuOpen = true
                                requestTvFocus(LiveFocus.Menu)
                            }
                        },
                        modifier = Modifier.focusRequester(categoryFocus),
                    )
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth(),
                    ) {
                        when {
                            catMenuOpen -> LiveTvCategoryMenu(
                                categories = categories,
                                selected = selectedCategory,
                                selectedRequester = menuFocus,
                                onSelect = { cat ->
                                    selectedCategory = cat
                                    catMenuOpen = false
                                    requestTvFocus(LiveFocus.Row)
                                },
                                modifier = Modifier.fillMaxSize(),
                            )
                            loading && channels.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(color = ui.accent.color, strokeWidth = 3.dp)
                            }
                            visibleChannels.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                Text("Sin canales en esta categoría.", color = OpenTvColors.TextMuted, fontSize = (13f * scale).sp)
                            }
                            else -> CompositionLocalProvider(LocalFocusMemory provides listMemory) {
                                LazyColumn(
                                    state = listState,
                                    verticalArrangement = Arrangement.spacedBy(4.dp),
                                    modifier = Modifier.fillMaxSize(),
                                ) {
                                    items(visibleChannels, key = { it.id }, contentType = { "ch" }) { ch ->
                                        LiveTvChannelRow(
                                            channel = ch,
                                            epg = epgFor(epgMap, ch),
                                            active = ch.url == activeChannel?.url,
                                            onClick = {
                                                if (ch.url == activeChannel?.url) fullscreen = true
                                                else tuneChannel(ch, muted = false)
                                            },
                                            // → always reaches the player controls (Pausa).
                                            rightFocus = controlsFocus,
                                            modifier = Modifier.stableFocusRequester(ch.url == focusUrl, rowFocus),
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.width(24.dp))

            BoxWithConstraints(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight(),
            ) {
                // Video as large as fits above the info bar, and the bar right under it.
                val barSpace = 14.dp + 64.dp
                val videoW = minOf(maxWidth, (maxHeight - barSpace) * (16f / 9f))
              Column(Modifier.width(videoW)) {
                run {
                    Box(
                        modifier = Modifier
                            .size(width = videoW, height = videoW * (9f / 16f))
                            .clip(RoundedCornerShape(16.dp))
                            .background(Color.Black)
                            .border(1.dp, Color(0x12FFFFFF), RoundedCornerShape(16.dp)),
                    ) {
                        AndroidView(
                            factory = { ctx ->
                                SurfaceView(ctx).apply {
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
                        LiveBufferingSpinner(player, size = 36)
                        Box(
                            modifier = Modifier
                                .align(Alignment.TopStart)
                                .padding(12.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(Color(0xFFE5383B))
                                .padding(horizontal = 9.dp, vertical = 3.dp),
                        ) {
                            Text(
                                "EN VIVO",
                                color = Color.White,
                                fontSize = (10.5f * scale).sp,
                                fontWeight = FontWeight.ExtraBold,
                                letterSpacing = 0.08.em,
                            )
                        }
                    }
                }
                Spacer(Modifier.height(14.dp))
                val ch = activeChannel
                val number = remember(channels, ch?.url) { ch?.let { c -> channels.indexOfFirst { it.url == c.url } + 1 } ?: 0 }
                LiveTvInfoBar(
                    channel = ch,
                    number = number,
                    epg = ch?.let { epgFor(epgMap, it) },
                    player = player,
                    isFavorite = ch != null && ch.url in favoriteUrls,
                    playFocus = controlsFocus,
                    leftExit = { listMemory.target() },
                    onPrev = { zapRelative(-1) },
                    onNext = { zapRelative(1) },
                    onToggleFavorite = { activeChannel?.let { onToggleFavorite(it.url) } },
                    onGuide = { guideOpen = true },
                    onFullscreen = { if (activeChannel != null) fullscreen = true },
                )
              }
            }
        }    } else {
        // Mobile portrait/compact layout: Preview + dock on top, categories & channels below
        Column(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = modifier
                .fillMaxSize()
                .padding(top = topPad, start = hPad, end = hPad, bottom = 12.dp),
        ) {
            LivePreviewCard(
                channel = activeChannel,
                epg = activeChannel?.let { epgFor(epgMap, it) },
                player = player,
                onFullscreen = { fullscreen = true },
            )
            LiveCapsuleDock(
                channel = activeChannel,
                isFav = activeChannel?.url in favoriteUrls,
                onToggleFav = { activeChannel?.let { onToggleFavorite(it.url) } },
                onGuide = { guideOpen = true },
                onSchedule = { activeChannel?.let { openSchedule(it) } },
                onReload = { reloadLists() },
                onFullscreen = { fullscreen = true },
            )
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(categories, key = { it }) { cat ->
                    OpenTvChip(cat, cat == selectedCategory, { selectedCategory = cat })
                }
            }
            if (loading && channels.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = ui.accent.color, strokeWidth = 3.dp)
                }
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(bottom = 24.dp),
                    modifier = Modifier.weight(1f),
                ) {
                    items(visibleChannels, key = { it.id }) { ch ->
                        ChannelRowCard(
                            channel = ch,
                            epg = epgFor(epgMap, ch),
                            active = ch.url == activeChannel?.url,
                            onClick = { tuneChannel(ch, muted = false) },
                        )
                    }
                }
            }
        }
    }

    if (scheduleChannel != null) {
        Schedule12hDialog(
            channel = scheduleChannel!!,
            items = scheduleItems,
            loading = scheduleLoading,
            onDismiss = { scheduleChannel = null },
        )
    }

    if (guideOpen) {
        ChannelGuideModal(
            channels = channels,
            categories = categories,
            favoriteUrls = favoriteUrls,
            recentChannels = recentChannels,
            activeChannelUrl = activeChannel?.url,
            epgMap = epgMap,
            onSelectChannel = { ch ->
                guideOpen = false
                tuneChannel(ch, muted = false)
                if (ui.isTv) requestTvFocus(LiveFocus.Row)
            },
            onDismiss = { guideOpen = false },
        )
    }
}

@Composable
private fun LivePreviewCard(
    channel: LiveChannel?,
    epg: EpgNowNext?,
    player: OpenTvPlayer,
    onFullscreen: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(16f / 9f)
            .clip(RoundedCornerShape(18.dp))
            .background(Color.Black)
            .border(1.dp, OpenTvColors.GlassBorderStrong, RoundedCornerShape(18.dp))
            .clickable(onClick = onFullscreen),
    ) {
        AndroidView(
            factory = { ctx ->
                SurfaceView(ctx).apply {
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
        LiveBufferingSpinner(player)
        if (channel != null) {
            Column(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .fillMaxWidth()
                    .background(Color(0xB80E0E11))
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(OpenTvColors.LiveRed)
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    ) {
                        Text("EN VIVO", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    }
                    Text(channel.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                epg?.now?.let { now ->
                    Text(
                        text = "Ahora: ${now.title}",
                        style = MaterialTheme.typography.labelMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

/** Exact replica of `.live-dock-bar` (`08-en-vivo-reproductor.css`). */
@Composable
private fun LiveCapsuleDock(
    channel: LiveChannel?,
    isFav: Boolean,
    onToggleFav: () -> Unit,
    onGuide: () -> Unit,
    onSchedule: () -> Unit,
    onReload: () -> Unit,
    onFullscreen: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(Color(0x0EFFFFFF))
            .border(1.dp, OpenTvColors.GlassBorder, RoundedCornerShape(18.dp))
            .padding(8.dp),
    ) {
        OpenTvRoundIconButton(
            icon = if (isFav) Icons.Rounded.Star else Icons.Rounded.StarBorder,
            contentDescription = "Favorito",
            selected = isFav,
            tintOverride = if (isFav) OpenTvColors.StarGold else null,
            size = 40.dp,
            onClick = onToggleFav,
        )
        OpenTvGlassButton(
            text = "Guía",
            icon = Icons.AutoMirrored.Rounded.List,
            onClick = onGuide,
        )
        OpenTvRoundIconButton(
            icon = Icons.Rounded.CalendarMonth,
            contentDescription = "Programación 12h",
            size = 40.dp,
            onClick = onSchedule,
        )
        OpenTvRoundIconButton(
            icon = Icons.Rounded.Refresh,
            contentDescription = "Recargar",
            size = 40.dp,
            onClick = onReload,
        )
        Spacer(Modifier.weight(1f))
        if (channel != null) {
            OpenTvPrimaryButton(
                text = "Pantalla completa",
                icon = Icons.Rounded.Fullscreen,
                onClick = onFullscreen,
            )
        }
    }
}

@Composable
private fun ChannelRowCard(
    channel: LiveChannel,
    epg: EpgNowNext?,
    active: Boolean,
    onClick: () -> Unit,
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
            .background(
                when {
                    focused -> OpenTvColors.GlassFillFocus
                    active -> Color(0x1CFFFFFF)
                    else -> OpenTvColors.GlassFill
                },
            )
            .border(
                width = if (focused) 2.5.dp else 1.dp,
                color = if (focused) ui.accent.color else if (active) Color(0x44FFFFFF) else OpenTvColors.GlassBorder,
                shape = shape,
            )
            // `clickable` is already a focus target; reading focus from the same source.
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 9.dp),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(46.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(OpenTvColors.Ink800),
        ) {
            if (channel.logo.isNotBlank()) {
                OpenTvImage(
                    url = channel.logo,
                    contentDescription = channel.name,
                    targetWidthPx = 120,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize().padding(4.dp),
                )
            } else {
                Icon(Icons.Rounded.LiveTv, null, tint = OpenTvColors.TextMuted, modifier = Modifier.size(22.dp))
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = channel.name,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            val nowText = epg?.now?.title ?: if (active) "Viendo ahora" else "En vivo"
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(
                    modifier = Modifier
                        .size(6.dp)
                        .clip(androidx.compose.foundation.shape.CircleShape)
                        .background(OpenTvColors.LiveRed),
                )
                Text(
                    text = nowText,
                    style = MaterialTheme.typography.labelMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            epg?.next?.let { next ->
                Text(
                    text = "Después: ${next.title}",
                    fontSize = 11.sp,
                    color = OpenTvColors.TextSubtle,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun Schedule12hDialog(
    channel: LiveChannel,
    items: List<EpgProgram>,
    loading: Boolean,
    onDismiss: () -> Unit,
) {
    val ui = LocalOpenTvUi.current
    val fmt = remember { SimpleDateFormat("HH:mm", Locale.getDefault()) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            color = OpenTvColors.Ink900,
            shape = RoundedCornerShape(18.dp),
            border = BorderStroke(1.dp, OpenTvColors.GlassBorderStrong),
            modifier = Modifier
                .fillMaxWidth(if (ui.isTv) 0.65f else 0.92f)
                .fillMaxHeight(0.76f),
        ) {
            Column(Modifier.fillMaxSize().padding(18.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("Programación (12 h)", style = MaterialTheme.typography.headlineMedium)
                        Text(channel.name, style = MaterialTheme.typography.bodyMedium)
                    }
                    // TV closes with Back; no on-screen back/close buttons there.
                    if (!ui.isTv) {
                        OpenTvRoundIconButton(Icons.Rounded.Close, "Cerrar", onDismiss, size = 38.dp)
                    }
                }
                Spacer(Modifier.height(14.dp))
                when {
                    loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = ui.accent.color)
                    }
                    items.isEmpty() -> Box(
                        contentAlignment = Alignment.Center,
                        // Keep the dialog focusable on TV even with nothing to list.
                        modifier = Modifier.fillMaxSize().then(if (ui.isTv) Modifier.focusable() else Modifier),
                    ) {
                        Text("Esta lista no incluye guía EPG para este canal.", style = MaterialTheme.typography.bodyLarge)
                    }
                    else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(items) { prog ->
                            val range = if (prog.startMs > 0L && prog.endMs > 0L) {
                                "${fmt.format(Date(prog.startMs))} – ${fmt.format(Date(prog.endMs))}"
                            } else ""
                            ScheduleRow(range = range, title = prog.title, description = prog.description)
                        }
                    }
                }
            }
        }
    }
}

/**
 * Exact 1:1 replica of OpenTV v1 "Guía de canales" modal (`docs/screenshots/guia.jpg`):
 * - Title "Guía de canales" + count, "Buscar canal" input, round close button (phone)
 * - Left category rail (solid pill on selected, "CATEGORÍAS" header)
 * - Right channel grid with red `● En vivo / Viendo ahora` indicator.
 * On TV: full screen with 60dp margins, 3 fixed columns, the TV keyboard for the
 * search box and no on-screen close button (Back closes).
 */
@Composable
private fun ChannelGuideModal(
    channels: List<LiveChannel>,
    categories: List<String>,
    favoriteUrls: List<String>,
    recentChannels: List<LiveChannel>,
    activeChannelUrl: String?,
    epgMap: Map<String, EpgNowNext>,
    onSelectChannel: (LiveChannel) -> Unit,
    onDismiss: () -> Unit,
) {
    val ui = LocalOpenTvUi.current
    var selectedCat by remember { mutableStateOf("Todos") }
    var search by remember { mutableStateOf("") }
    var kbOpen by remember { mutableStateOf(false) }
    val catFocus = remember { FocusRequester() }
    val kbFocus = remember { FocusRequester() }
    val searchFocus = remember { FocusRequester() }

    val list = remember(channels, selectedCat, search, favoriteUrls, recentChannels, epgMap) {
        val base = when (selectedCat) {
            "Todos" -> channels
            "Favoritos" -> channels.filter { it.url in favoriteUrls }
            "Recientes" -> recentChannels
            else -> channels.filter { it.group == selectedCat }
        }
        val q = search.trim()
        if (q.isEmpty()) base else base.filter {
            it.name.contains(q, ignoreCase = true) ||
                it.group.contains(q, ignoreCase = true) ||
                epgFor(epgMap, it)?.now?.title?.contains(q, ignoreCase = true) == true
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        if (ui.isTv) {
            LaunchedEffect(Unit) { catFocus.focusSoon() }
            LaunchedEffect(kbOpen) { if (kbOpen) kbFocus.focusSoon() }
            if (kbOpen) {
                BackHandler {
                    kbOpen = false
                }
            }
        }
        Surface(
            color = Color(0xF5111114),
            shape = RoundedCornerShape(20.dp),
            border = BorderStroke(1.dp, OpenTvColors.GlassBorderStrong),
            modifier = if (ui.isTv) {
                Modifier.fillMaxSize().padding(60.dp)
            } else {
                Modifier.fillMaxWidth(0.96f).fillMaxHeight(0.86f)
            },
        ) {
            Column(Modifier.fillMaxSize().padding(18.dp)) {
                // Header: Title + Search (+ Close on phone) (`guia.jpg`)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("Guía de canales", style = MaterialTheme.typography.headlineMedium)
                        Text("$selectedCat · ${list.size} canales", style = MaterialTheme.typography.labelMedium)
                    }
                    if (ui.isTv) {
                        GuideTvSearchBox(
                            text = search,
                            onClick = { kbOpen = !kbOpen },
                            modifier = Modifier.width(240.dp).focusRequester(searchFocus),
                        )
                    } else {
                        Box(
                            contentAlignment = Alignment.CenterStart,
                            modifier = Modifier
                                .width(160.dp)
                                .height(40.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(OpenTvColors.GlassFill)
                                .border(1.dp, OpenTvColors.GlassBorderStrong, RoundedCornerShape(12.dp))
                                .padding(horizontal = 12.dp),
                        ) {
                            if (search.isEmpty()) Text("Buscar canal…", color = OpenTvColors.TextMuted, fontSize = 13.sp)
                            androidx.compose.foundation.text.BasicTextField(
                                value = search,
                                onValueChange = { search = it },
                                singleLine = true,
                                textStyle = androidx.compose.ui.text.TextStyle(color = Color.White, fontSize = 13.5.sp),
                                cursorBrush = androidx.compose.ui.graphics.SolidColor(ui.accent.color),
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        OpenTvRoundIconButton(Icons.Rounded.Close, "Cerrar", onDismiss, size = 38.dp)
                    }
                }

                Spacer(Modifier.height(14.dp))

                Row(
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                ) {
                    if (ui.isTv && kbOpen) {
                        TvKeyboard(
                            value = search,
                            onValueChange = { search = it },
                            placeholder = "Buscar canal",
                            doneLabel = "Listo",
                            onDone = { kbOpen = false },
                            firstKeyFocusRequester = kbFocus,
                            keyHeight = 28.dp,
                            keyFontSize = 12.sp,
                            displayHeight = 32.dp,
                            displayFontSize = 12.sp,
                            gap = 4.dp,
                            modifier = Modifier.width(220.dp),
                        )
                    } else {
                        // Left category rail
                        LazyColumn(
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                            modifier = Modifier
                                .width(if (ui.isTv) 180.dp else 124.dp)
                                .fillMaxHeight(),
                        ) {
                            val special = categories.filter { it in setOf("Todos", "Favoritos", "Recientes") }
                            val rest = categories.filter { it !in setOf("Todos", "Favoritos", "Recientes") }

                            items(special, key = { "s:$it" }) { cat ->
                                GuideCategoryItem(
                                    label = cat,
                                    selected = cat == selectedCat,
                                    onClick = { selectedCat = cat },
                                    modifier = Modifier.stableFocusRequester(cat == selectedCat, catFocus),
                                )
                            }

                            if (rest.isNotEmpty()) {
                                item(key = "header") {
                                    Text(
                                        text = "CATEGORÍAS",
                                        fontSize = 10.5.sp,
                                        fontWeight = FontWeight.Bold,
                                        letterSpacing = 1.2.sp,
                                        color = OpenTvColors.TextSubtle,
                                        modifier = Modifier.padding(start = 12.dp, top = 12.dp, bottom = 4.dp),
                                    )
                                }
                                items(rest, key = { "c:$it" }) { cat ->
                                    GuideCategoryItem(
                                        label = cat,
                                        selected = cat == selectedCat,
                                        onClick = { selectedCat = cat },
                                        modifier = Modifier.stableFocusRequester(cat == selectedCat, catFocus),
                                    )
                                }
                            }
                        }
                    }

                    // Right channel grid (`guia.jpg`)
                    LazyVerticalGrid(
                        columns = if (ui.isTv) GridCells.Fixed(3) else GridCells.Adaptive(minSize = 180.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier.weight(1f).fillMaxHeight(),
                    ) {
                        gridItems(list, key = { it.id }) { ch ->
                            ChannelRowCard(
                                channel = ch,
                                epg = epgFor(epgMap, ch),
                                active = ch.url == activeChannelUrl,
                                onClick = { onSelectChannel(ch) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun GuideCategoryItem(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    Box(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(
                when {
                    focused -> Color.White
                    selected -> ui.accent.color
                    else -> Color.Transparent
                },
            )
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 9.dp),
    ) {
        Text(
            text = label,
            color = when {
                focused -> LiveDark
                selected -> ui.accent.onAccent
                else -> OpenTvColors.TextSecondary
            },
            fontWeight = if (selected || focused) FontWeight.Bold else FontWeight.Medium,
            fontSize = 13.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun GuideTvSearchBox(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(12.dp)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .height(40.dp)
            .clip(shape)
            .background(if (focused) Color(0x24FFFFFF) else OpenTvColors.GlassFill)
            .border(if (focused) 2.dp else 1.dp, if (focused) Color.White else OpenTvColors.GlassBorderStrong, shape)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 12.dp),
    ) {
        Icon(Icons.Rounded.Search, null, tint = OpenTvColors.TextMuted, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(8.dp))
        Text(
            text = text.ifEmpty { "Buscar canal…" },
            color = if (text.isEmpty()) OpenTvColors.TextMuted else Color.White,
            fontSize = 13.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
