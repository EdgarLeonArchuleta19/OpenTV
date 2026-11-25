package com.techpoint.opentv.ui.live

import android.view.SurfaceView
import android.view.ViewGroup
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.runtime.CompositionLocalProvider
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
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.techpoint.opentv.core.live.EpgPlaceholder
import com.techpoint.opentv.core.live.LiveTvRepository
import com.techpoint.opentv.core.model.EpgNowNext
import com.techpoint.opentv.core.model.EpgProgram
import com.techpoint.opentv.core.model.LiveChannel
import com.techpoint.opentv.core.model.M3uPlaylist
import com.techpoint.opentv.player.OpenTvPlayer
import com.techpoint.opentv.ui.components.FocusMemory
import com.techpoint.opentv.ui.components.LocalFocusMemory
import com.techpoint.opentv.ui.components.OpenTvChip
import com.techpoint.opentv.ui.components.OpenTvGlassButton
import com.techpoint.opentv.ui.components.OpenTvImage
import com.techpoint.opentv.ui.components.OpenTvPrimaryButton
import com.techpoint.opentv.ui.components.OpenTvRoundIconButton
import com.techpoint.opentv.ui.components.stableFocusRequester
import com.techpoint.opentv.ui.search.TvKeyboard
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import com.techpoint.opentv.ui.theme.OpenTvColors
import com.techpoint.opentv.ui.theme.OpenTvForceDark
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Which control of the TV layout should take the focus next. */
private enum class LiveFocus { Row, Search, Keyboard }

/** Cached `epgSchedule` of a channel (the programme cards), refreshed after [SCHEDULE_TTL_MS]. */
private class CachedSchedule(val atMs: Long, val items: List<EpgProgram>)

private const val SCHEDULE_TTL_MS = 20 * 60_000L
private const val SCHEDULE_CACHE_MAX = 16

/**
 * TV en vivo, "design C" (same on PC, Android TV / Fire TV and tablets in landscape):
 * player on the left with the playing channel's programme cards under it, and the channel
 * panel on the right (group select, playlist select, search, channel rows). Phones stack the
 * same pieces: player, actions, programme cards (horizontal scroll), then the channel list.
 */
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
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
    // Player state is NOT collected here: only tiny composables (spinner, pause button)
    // observe the fields they need, so position ticks never recompose this screen.

    var channels by remember { mutableStateOf<List<LiveChannel>>(emptyList()) }
    var epgUrls by remember { mutableStateOf<List<String>>(emptyList()) }
    var epgMap by remember { mutableStateOf<Map<String, EpgNowNext>>(emptyMap()) }
    var loading by remember { mutableStateOf(true) }
    var selectedCategory by remember { mutableStateOf(GROUP_ALL) }
    var selectedPlaylist by remember { mutableStateOf(PLAYLIST_ALL) }
    var activeChannel by remember { mutableStateOf<LiveChannel?>(null) }
    var previousChannel by remember { mutableStateOf<LiveChannel?>(null) }
    var fullscreen by remember { mutableStateOf(false) }
    var drawerOpen by remember { mutableStateOf(false) }
    var guideOpen by remember { mutableStateOf(false) }
    var scheduleChannel by remember { mutableStateOf<LiveChannel?>(null) }
    var scheduleItems by remember { mutableStateOf<List<EpgProgram>>(emptyList()) }
    var scheduleLoading by remember { mutableStateOf(false) }

    // Programme cards of the playing channel.
    val scheduleCache = remember { LinkedHashMap<String, CachedSchedule>() }
    var programmes by remember { mutableStateOf<List<EpgProgram>>(emptyList()) }
    var programmesLoading by remember { mutableStateOf(false) }

    // TV-only state
    var channelSearch by remember { mutableStateOf("") }
    var searchKbOpen by remember { mutableStateOf(false) }
    var bannerVisible by remember { mutableStateOf(false) }
    var bannerTick by remember { mutableIntStateOf(0) }
    var focusTarget by remember { mutableStateOf(LiveFocus.Row) }
    var focusTick by remember { mutableIntStateOf(0) }
    // Set while fullscreen is open: coming back, the channel row takes the focus even if the
    // (re-created) rail briefly reports focus.
    var backFromFullscreen by remember { mutableStateOf(false) }

    // Hoisted so the list keeps its scroll while the TV layout is swapped for fullscreen.
    val listState = rememberLazyListState()
    val fullscreenFocus = remember { FocusRequester() }
    val drawerFocus = remember { FocusRequester() }
    val rowFocus = remember { FocusRequester() }
    val searchBoxFocus = remember { FocusRequester() }
    val keyboardFocus = remember { FocusRequester() }
    val groupFocus = remember { FocusRequester() }
    val playerFocus = remember { FocusRequester() }

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
            scheduleCache.clear()
            if (activeChannel == null && loaded.isNotEmpty()) {
                // Coming back to TV en vivo resumes the last channel watched, not channel 1.
                tuneChannel(pickStartChannel(loaded, recentChannels), muted = false)
            }
            if (urls.isNotEmpty() && loaded.isNotEmpty()) {
                epgMap = liveRepo.loadEpgNowNext(urls, loaded)
                // Placeholder-only guides ("Azteca UNO -1" every hour) get the supplementary guide.
                val patch = liveRepo.loadSupplementNowNext(loaded, epgMap)
                if (patch.isNotEmpty()) epgMap = epgMap + patch
            }
        }
    }

    LaunchedEffect(playlists) { reloadLists() }
    LaunchedEffect(fullscreen) {
        onFullscreenChanged(fullscreen)
        if (fullscreen) {
            // Coming back from fullscreen restores the focus on the current channel row.
            focusTarget = LiveFocus.Row
            backFromFullscreen = true
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
    // Schedule of the playing channel for the programme cards (not needed in fullscreen).
    // The short delay skips the channels passed while zapping.
    LaunchedEffect(activeChannel?.url, fullscreen) {
        val ch = activeChannel ?: return@LaunchedEffect
        if (fullscreen) return@LaunchedEffect
        val cached = scheduleCache[ch.url]
        if (cached != null && System.currentTimeMillis() - cached.atMs < SCHEDULE_TTL_MS) {
            programmes = cached.items
            programmesLoading = false
            return@LaunchedEffect
        }
        programmes = emptyList()
        programmesLoading = true
        delay(300L)
        val items = try {
            liveRepo.loadChannelSchedule12h(ch)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            emptyList()
        }
        if (scheduleCache.size >= SCHEDULE_CACHE_MAX) scheduleCache.remove(scheduleCache.keys.first())
        scheduleCache[ch.url] = CachedSchedule(System.currentTimeMillis(), items)
        programmes = items
        programmesLoading = false
        // Without its own (real) now/next, the channel row shows the schedule's (supplementary) one.
        val pair = liveRepo.nowNextOf(items)
        if (pair != null) {
            val key = EpgPlaceholder.keyOf(ch)
            val names = EpgPlaceholder.namesOf(ch)
            val own = epgMap[key]
            val ownIsReal = own != null && !EpgPlaceholder.isPlaceholder(names, listOf(own.now, own.next))
            val pairIsFake = own != null && EpgPlaceholder.isPlaceholder(names, listOf(pair.now, pair.next))
            if (!ownIsReal && !pairIsFake) epgMap = epgMap + (key to pair)
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            onFullscreenChanged(false)
            player.attachSurface(null)
            player.stop()
        }
    }

    val enabledPlaylists = remember(playlists) { playlists.filter { it.enabled && it.url.isNotBlank() } }
    LaunchedEffect(enabledPlaylists) {
        if (selectedPlaylist != PLAYLIST_ALL && enabledPlaylists.none { it.id == selectedPlaylist }) {
            selectedPlaylist = PLAYLIST_ALL
        }
    }
    val scopedChannels = remember(channels, selectedPlaylist) {
        if (selectedPlaylist == PLAYLIST_ALL) channels else channels.filter { it.playlistId == selectedPlaylist }
    }
    // Channel number = position in the loaded lists (same as the fullscreen banner).
    val channelNumbers = remember(channels) {
        HashMap<String, Int>(channels.size * 2).also { m -> channels.forEachIndexed { i, c -> m.putIfAbsent(c.url, i + 1) } }
    }

    val categories = remember(scopedChannels, favoriteUrls, recentChannels) {
        val base = mutableListOf(GROUP_ALL)
        if (favoriteUrls.isNotEmpty()) base.add(GROUP_FAVORITES)
        if (recentChannels.isNotEmpty()) base.add(GROUP_RECENTS)
        val groups = scopedChannels.map { it.group }.distinct().sorted().take(40)
        (base + groups).distinct()
    }
    LaunchedEffect(categories) {
        if (selectedCategory !in categories) selectedCategory = GROUP_ALL
    }
    val groupOptions = remember(categories, scopedChannels, favoriteUrls, recentChannels) {
        val counts = scopedChannels.groupingBy { it.group }.eachCount()
        categories.map { cat ->
            val n = when (cat) {
                GROUP_ALL -> scopedChannels.size
                GROUP_FAVORITES -> scopedChannels.count { it.url in favoriteUrls }
                GROUP_RECENTS -> filterChannels(scopedChannels, GROUP_RECENTS, favoriteUrls, recentChannels, "", emptyMap()).size
                else -> counts[cat] ?: 0
            }
            LiveSelectOption(cat, cat, n)
        }
    }
    val playlistOptions = remember(enabledPlaylists, channels) {
        val counts = channels.groupingBy { it.playlistId }.eachCount()
        listOf(LiveSelectOption(PLAYLIST_ALL, "Todas las listas", channels.size)) +
            enabledPlaylists.map { LiveSelectOption(it.id, it.name.ifBlank { "Lista" }, counts[it.id] ?: 0) }
    }

    val visibleChannels = remember(scopedChannels, selectedCategory, favoriteUrls, recentChannels, channelSearch, epgMap) {
        filterChannels(scopedChannels, selectedCategory, favoriteUrls, recentChannels, channelSearch, epgMap)
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

        // Fullscreen video and its overlays stay dark in every theme.
        OpenTvForceDark { Box(
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
                    LiveTvBanner(channel = ch, number = channelNumbers[ch.url] ?: 0, epg = epgFor(epgMap, ch))
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
        } }
        return
    }

    val topPad = if (ui.isTv) 78.dp else 108.dp

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

    val scale = ui.textScale
    val active = activeChannel
    val activeNumber = active?.let { channelNumbers[it.url] } ?: 0
    val activeEpg = active?.let { epgFor(epgMap, it) }
    val isFavorite = active != null && active.url in favoriteUrls
    val focusUrl = activeChannel?.url?.takeIf { u -> visibleChannels.any { it.url == u } }
        ?: visibleChannels.firstOrNull()?.url

    suspend fun focusChannelRow() {
        val list = visibleChannels
        if (list.isEmpty()) {
            groupFocus.focusSoon()
            return
        }
        val idx = list.indexOfFirst { it.url == focusUrl }.coerceAtLeast(0)
        if (listState.layoutInfo.visibleItemsInfo.none { it.index == idx }) {
            listState.scrollToItem(idx)
        }
        // Back from fullscreen the whole layout (video surface, lazy list) is rebuilt: give the
        // row a few more frames to attach than a plain control needs.
        rowFocus.focusSoon(frames = 30)
    }

    // Group / playlist selects and the search, shared by every layout.
    @Composable
    fun ChannelFilters(compact: Boolean) {
        val selectModifier = if (compact) Modifier else Modifier.fillMaxWidth()
        if (compact && enabledPlaylists.size > 1) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LiveSelect(
                    options = groupOptions,
                    value = selectedCategory,
                    onChange = { selectedCategory = it },
                    modifier = Modifier.weight(1f),
                )
                LiveSelect(
                    options = playlistOptions,
                    value = selectedPlaylist,
                    onChange = { selectedPlaylist = it },
                    modifier = Modifier.weight(1f),
                )
            }
        } else {
            LiveSelect(
                options = groupOptions,
                value = selectedCategory,
                onChange = {
                    selectedCategory = it
                    if (ui.isTv) requestTvFocus(LiveFocus.Row)
                },
                buttonFocus = groupFocus,
                returnFocusOnPick = !ui.isTv,
                modifier = selectModifier,
            )
            if (enabledPlaylists.size > 1) {
                LiveSelect(
                    options = playlistOptions,
                    value = selectedPlaylist,
                    onChange = {
                        selectedPlaylist = it
                        if (ui.isTv) requestTvFocus(LiveFocus.Row)
                    },
                    returnFocusOnPick = !ui.isTv,
                    modifier = selectModifier,
                )
            }
        }
        if (ui.isTv) {
            LiveTvSearchBox(
                text = channelSearch,
                onClick = {
                    searchKbOpen = true
                    requestTvFocus(LiveFocus.Keyboard)
                },
                modifier = Modifier.focusRequester(searchBoxFocus),
            )
        } else {
            LiveSearchField(channelSearch, { channelSearch = it })
        }
    }

    @Composable
    fun ChannelRow(ch: LiveChannel, rowModifier: Modifier = Modifier) {
        LiveChannelListRow(
            channel = ch,
            number = channelNumbers[ch.url] ?: 0,
            nowTitle = epgFor(epgMap, ch)?.now?.title,
            playing = ch.url == activeChannel?.url,
            onClick = {
                // OK on the playing channel opens fullscreen; any other channel plays here.
                if (ch.url == activeChannel?.url) fullscreen = true
                else tuneChannel(ch, muted = false)
            },
            modifier = rowModifier,
        )
    }

    // Programme header actions (TV and tablets; phones keep the capsule dock).
    @Composable
    fun ProgrammeActions() {
        val size = if (ui.isTv) 34.dp else 40.dp
        LivePlayPauseButton(player, size = size, filled = false)
        LiveRoundButton(
            if (isFavorite) Icons.Rounded.Star else Icons.Rounded.StarBorder,
            "Favorito",
            { activeChannel?.let { onToggleFavorite(it.url) } },
            tint = if (isFavorite) OpenTvColors.StarGold else null,
            size = size,
        )
        LiveRoundButton(Icons.Rounded.CalendarMonth, "Programación", { activeChannel?.let { openSchedule(it) } }, size = size)
        LiveRoundButton(Icons.AutoMirrored.Rounded.List, "Guía", { guideOpen = true }, size = size)
        if (!ui.isTv) LiveRoundButton(Icons.Rounded.Refresh, "Recargar", { reloadLists() }, size = size)
        LiveRoundButton(Icons.Rounded.Fullscreen, "Pantalla completa", { if (activeChannel != null) fullscreen = true }, size = size)
    }

    BoxWithConstraints(modifier.fillMaxSize()) {
        val twoColumn = ui.isTv || (maxWidth > maxHeight && maxWidth >= 720.dp)
        if (twoColumn) {
            if (ui.isTv) {
                // Runs on first entry, on every return from fullscreen (this branch re-enters
                // composition) and whenever a control asks for the focus explicitly.
                LaunchedEffect(focusTick) {
                    val forced = backFromFullscreen
                    backFromFullscreen = false
                    when (focusTarget) {
                        LiveFocus.Row -> if (!searchKbOpen && (forced || canTakeFocus())) focusChannelRow()
                        LiveFocus.Search -> searchBoxFocus.focusSoon()
                        LiveFocus.Keyboard -> keyboardFocus.focusSoon()
                    }
                }
                // Initial focus once the channels arrive.
                val hasChannels = visibleChannels.isNotEmpty()
                LaunchedEffect(hasChannels) {
                    if (hasChannels && focusTarget == LiveFocus.Row && !searchKbOpen && canTakeFocus()) focusChannelRow()
                }
                if (searchKbOpen) {
                    BackHandler {
                        searchKbOpen = false
                        requestTvFocus(LiveFocus.Search)
                    }
                }
            }

            val listMemory = remember { FocusMemory() }
            val padStart = if (ui.isTv) 0.dp else 20.dp
            val padEnd = if (ui.isTv) 40.dp else 20.dp
            val padBottom = if (ui.isTv) 22.dp else 16.dp
            val gap = 20.dp
            // The video is as large as fits above the programme cards (header + one card row),
            // never squeezing the channel panel under its minimum; the panel takes the rest.
            val minPanel = if (ui.isTv) 264.dp else 320.dp
            val reserve = (if (ui.isTv) 166.dp else 180.dp) * scale
            val videoW = minOf(
                maxWidth - padStart - padEnd - gap - minPanel,
                (maxHeight - topPad - padBottom - reserve) * (16f / 9f),
            ).coerceAtLeast(0.dp)
            Row(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(top = topPad, start = padStart, end = padEnd, bottom = padBottom),
            ) {
                // Left: player + programme of the playing channel.
                Box(Modifier.width(videoW).fillMaxHeight()) {
                    Column(Modifier.fillMaxSize()) {
                        LivePlayerStage(
                            player = player,
                            onFullscreen = { if (activeChannel != null) fullscreen = true },
                            modifier = Modifier
                                .size(width = videoW, height = videoW * (9f / 16f))
                                .focusRequester(playerFocus)
                                // → goes back to the channel list (its row may be scrolled away).
                                .onKeyEvent { ev ->
                                    if (ui.isTv && ev.type == KeyEventType.KeyDown && ev.key == Key.DirectionRight) {
                                        scope.launch { focusChannelRow() }
                                        true
                                    } else false
                                },
                        )
                        Spacer(Modifier.height(12.dp))
                        LiveProgrammeSection(
                            channel = active,
                            number = activeNumber,
                            schedule = programmes,
                            scheduleLoading = programmesLoading,
                            nowNext = activeEpg,
                            scroll = false,
                            modifier = Modifier.fillMaxWidth().weight(1f),
                        ) {
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                                modifier = Modifier
                                    .focusProperties {
                                        exit = { dir ->
                                            if (dir == FocusDirection.Right) {
                                                scope.launch { focusChannelRow() }
                                                FocusRequester.Cancel
                                            } else FocusRequester.Default
                                        }
                                    }
                                    .focusGroup(),
                            ) { ProgrammeActions() }
                        }
                    }
                }

                Spacer(Modifier.width(gap))

                // Right: channel panel.
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .clip(RoundedCornerShape(16.dp))
                        .background(LivePanel)
                        .border(1.dp, LivePanelBorder, RoundedCornerShape(16.dp)),
                ) {
                    if (ui.isTv && searchKbOpen) {
                        // v1 `.tvk-panel` in place of the list (core/tv-keyboard.js).
                        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
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
                                keyHeight = 30.dp,
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
                        }
                    } else {
                        Column(
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.padding(10.dp),
                        ) { ChannelFilters(compact = false) }
                        Box(Modifier.fillMaxWidth().height(1.dp).background(LivePanelBorder))
                        Box(Modifier.weight(1f).fillMaxWidth()) {
                            when {
                                loading && channels.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                    CircularProgressIndicator(color = ui.accent.color, strokeWidth = 3.dp)
                                }
                                visibleChannels.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                    Text("Sin canales en esta categoría.", color = OpenTvColors.TextMuted, fontSize = (13f * scale).sp)
                                }
                                else -> CompositionLocalProvider(LocalFocusMemory provides listMemory) {
                                    LazyColumn(
                                        state = listState,
                                        verticalArrangement = Arrangement.spacedBy(3.dp),
                                        contentPadding = PaddingValues(6.dp),
                                        modifier = Modifier
                                            .fillMaxSize()
                                            .onKeyEvent { ev ->
                                                if (!ui.isTv || ev.type != KeyEventType.KeyDown) return@onKeyEvent false
                                                when (ev.key) {
                                                    // ← goes to the player (then the menu); → stays in the list.
                                                    Key.DirectionLeft -> {
                                                        runCatching { playerFocus.requestFocus() }
                                                        true
                                                    }
                                                    Key.DirectionRight -> true
                                                    else -> false
                                                }
                                            },
                                    ) {
                                        items(visibleChannels, key = { it.id }, contentType = { "ch" }) { ch ->
                                            ChannelRow(ch, Modifier.stableFocusRequester(ch.url == focusUrl, rowFocus))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else {
            // Phone: player and actions on top, then programme cards and the channel list.
            Column(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier
                    .fillMaxSize()
                    .padding(top = topPad, start = 14.dp, end = 14.dp, bottom = 12.dp),
            ) {
                LivePreviewCard(
                    channel = active,
                    epg = activeEpg,
                    player = player,
                    onFullscreen = { fullscreen = true },
                )
                LiveCapsuleDock(
                    channel = active,
                    isFav = isFavorite,
                    onToggleFav = { activeChannel?.let { onToggleFavorite(it.url) } },
                    onGuide = { guideOpen = true },
                    onSchedule = { activeChannel?.let { openSchedule(it) } },
                    onReload = { reloadLists() },
                    onFullscreen = { fullscreen = true },
                )
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    contentPadding = PaddingValues(bottom = 24.dp),
                    modifier = Modifier.weight(1f),
                ) {
                    item(key = "programme", contentType = "programme") {
                        LiveProgrammeSection(
                            channel = active,
                            number = activeNumber,
                            schedule = programmes,
                            scheduleLoading = programmesLoading,
                            nowNext = activeEpg,
                            scroll = true,
                            modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp),
                        )
                    }
                    item(key = "filters", contentType = "filters") {
                        Column(
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.padding(bottom = 6.dp),
                        ) { ChannelFilters(compact = true) }
                    }
                    when {
                        loading && channels.isEmpty() -> item(key = "loading") {
                            Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(color = ui.accent.color, strokeWidth = 3.dp)
                            }
                        }
                        visibleChannels.isEmpty() -> item(key = "empty") {
                            Text(
                                "Sin canales en esta categoría.",
                                color = OpenTvColors.TextMuted,
                                fontSize = 13.sp,
                                modifier = Modifier.padding(vertical = 20.dp),
                            )
                        }
                        else -> items(visibleChannels, key = { it.id }, contentType = { "ch" }) { ch -> ChannelRow(ch) }
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

/** Touch search box of the channel panel ("Buscar canal"). */
@Composable
private fun LiveSearchField(value: String, onValueChange: (String) -> Unit) {
    val ui = LocalOpenTvUi.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .height(42.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (OpenTvColors.isLight) Color(0xFFEEEEF1) else Color(0xFF1C1C22))
            .padding(horizontal = 12.dp),
    ) {
        Icon(Icons.Rounded.Search, null, tint = OpenTvColors.TextMuted, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(8.dp))
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            if (value.isEmpty()) Text("Buscar canal", color = OpenTvColors.TextMuted, fontSize = 13.5.sp)
            androidx.compose.foundation.text.BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                textStyle = TextStyle(color = OpenTvColors.Content, fontSize = 13.5.sp),
                cursorBrush = SolidColor(ui.accent.color),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (value.isNotEmpty()) {
            Icon(
                Icons.Rounded.Close,
                contentDescription = "Borrar búsqueda",
                tint = OpenTvColors.TextMuted,
                modifier = Modifier.size(18.dp).clickable { onValueChange("") },
            )
        }
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
            .background(OpenTvColors.fg(0.055f))
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
                    active -> OpenTvColors.fg(0.11f)
                    else -> OpenTvColors.GlassFill
                },
            )
            .border(
                width = if (focused) 2.5.dp else 1.dp,
                color = if (focused) ui.accent.color else if (active) OpenTvColors.fg(0.267f) else OpenTvColors.GlassBorder,
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
                .background(LiveBadge),
        ) {
            if (channel.logo.isNotBlank()) {
                OpenTvImage(
                    url = channel.logo,
                    background = Color.Transparent,
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
            color = if (OpenTvColors.isLight) OpenTvColors.Sheet else Color(0xF5111114),
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
                                textStyle = androidx.compose.ui.text.TextStyle(color = OpenTvColors.Content, fontSize = 13.5.sp),
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
                    focused -> OpenTvColors.Content
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
                focused -> OpenTvColors.OnContent
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
            .background(if (focused) OpenTvColors.fg(0.14f) else OpenTvColors.GlassFill)
            .border(if (focused) 2.dp else 1.dp, if (focused) OpenTvColors.Content else OpenTvColors.GlassBorderStrong, shape)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 12.dp),
    ) {
        Icon(Icons.Rounded.Search, null, tint = OpenTvColors.TextMuted, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(8.dp))
        Text(
            text = text.ifEmpty { "Buscar canal…" },
            color = if (text.isEmpty()) OpenTvColors.TextMuted else OpenTvColors.Content,
            fontSize = 13.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
