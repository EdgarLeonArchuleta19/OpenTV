package com.techpoint.opentv.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.HelpOutline
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.material3.Icon
import com.techpoint.opentv.R
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.em
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.draw.alpha
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.withFrameNanos
import com.techpoint.opentv.ui.components.stableFocusRequester
import com.techpoint.opentv.core.model.WatchProgress
import androidx.compose.material.icons.rounded.CloudDownload
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Extension
import androidx.compose.material.icons.rounded.FolderOpen
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Save
import androidx.compose.material.icons.rounded.SystemUpdate
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.UploadFile
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.techpoint.opentv.BuildConfig
import com.techpoint.opentv.core.addons.StremioClient
import com.techpoint.opentv.core.data.PersistedAppState
import com.techpoint.opentv.core.data.ProfileBucket
import com.techpoint.opentv.core.model.AppearancePrefs
import com.techpoint.opentv.core.model.DownloadItem
import com.techpoint.opentv.core.model.InstalledPlugin
import com.techpoint.opentv.core.model.M3uPlaylist
import com.techpoint.opentv.core.model.MediaItem
import com.techpoint.opentv.core.model.PlaybackPrefs
import com.techpoint.opentv.core.model.SourcePrefs
import com.techpoint.opentv.core.model.UserProfile
import com.techpoint.opentv.service.RustServiceBridge
import com.techpoint.opentv.ui.components.OpenTvChip
import com.techpoint.opentv.ui.components.OpenTvPrimaryButton
import com.techpoint.opentv.ui.components.OpenTvRoundIconButton
import com.techpoint.opentv.ui.components.PosterCard
import com.techpoint.opentv.ui.components.FocusMemory
import com.techpoint.opentv.ui.components.LocalFocusMemory
import com.techpoint.opentv.ui.components.LocalLeftExit
import com.techpoint.opentv.ui.components.TvPinDialog
import com.techpoint.opentv.ui.components.leftExitGroup
import com.techpoint.opentv.ui.components.rememberFocus
import com.techpoint.opentv.ui.components.resolvedAvatarIndex
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.focus.onFocusChanged
import com.techpoint.opentv.ui.plugins.PluginsPanel
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import com.techpoint.opentv.ui.theme.OpenTvAccents
import com.techpoint.opentv.ui.theme.OpenTvColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.util.Locale

private data class SettingsSection(val id: String, val label: String, val icon: ImageVector)

/** Section id of the embedded Plugins panel (same id as v1 `settingsPanels.sources`). */
const val SETTINGS_SECTION_PLUGINS = "sources"

/**
 * v1 TV "Ajustes": full screen, left menu (221 dp, #0b0b0b) and the panel on the right.
 * No header nor on-screen back button on TV (the remote's Back is handled by MainActivity).
 * Resting the D-pad focus on a menu entry for 220 ms switches the panel; → enters the panel.
 *
 * The Plugins panel lives inside Ajustes ("Plugins" entry, id [SETTINGS_SECTION_PLUGINS]).
 * When [stremio] is null the entry falls back to [onOpenPlugins] (legacy separate screen).
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun SettingsScreen(
    initialSection: String,
    appState: PersistedAppState,
    activeProfile: UserProfile,
    bucket: ProfileBucket,
    onSelectProfile: (String) -> Unit,
    onOpenPlugins: () -> Unit,
    onOpenDetail: (MediaItem) -> Unit,
    onPlayOfflineDownload: (DownloadItem, String) -> Unit,
    onExportBackup: () -> Unit,
    onImportBackup: () -> Unit,
    onClearHistory: () -> Unit,
    onUpdateAppearance: ((AppearancePrefs) -> AppearancePrefs) -> Unit,
    onUpdatePlayback: ((PlaybackPrefs) -> PlaybackPrefs) -> Unit,
    onSaveParental: (String, Boolean) -> Unit,
    onShowToast: (String) -> Unit,
    onBack: () -> Unit,
    // Embedded Plugins panel.
    stremio: StremioClient? = null,
    installedPlugins: List<InstalledPlugin> = appState.plugins,
    m3uPlaylists: List<M3uPlaylist> = appState.m3uPlaylists,
    sourcePrefs: SourcePrefs = appState.sourcePrefs,
    pendingInstallUrl: String? = null,
    onConsumePendingInstall: () -> Unit = {},
    onInstallPlugin: (InstalledPlugin) -> Unit = {},
    onRemovePlugin: (String) -> Unit = {},
    onSetAllowLan: (String, Boolean) -> Unit = { _, _ -> },
    onAddM3u: (M3uPlaylist) -> Unit = {},
    onRemoveM3u: (String) -> Unit = {},
    onUpdateSourcePrefs: ((SourcePrefs) -> SourcePrefs) -> Unit = {},
    onSetPluginDisabled: ((String, Boolean) -> Unit)? = null,
    onMovePlugin: ((String, Int) -> Unit)? = null,
    onOpenProfilePicker: (() -> Unit)? = null,
    onPlayLocalVideo: (uri: String, title: String) -> Unit = { _, _ -> },
    onClearCache: (() -> Unit)? = null,
    onRemoveFromMyList: (MediaItem) -> Unit = {},
    onRemoveFavorite: (MediaItem) -> Unit = {},
) {
    val ui = LocalOpenTvUi.current
    val scope = rememberCoroutineScope()
    val pluginsInline = stremio != null
    // PC `listTab`: Mi lista | Favoritos | Historial (Mi cuenta's shortcuts pick one).
    var listTab by remember { mutableStateOf("mylist") }

    val sections = remember(ui.isTv) {
        buildList {
            add(SettingsSection("profile", "Mi cuenta", Icons.Rounded.Person))
            add(SettingsSection("history", "Mi lista", Icons.Rounded.Bookmark))
            add(SettingsSection("playback", "Ajustes", Icons.Rounded.Tune))
            add(SettingsSection(SETTINGS_SECTION_PLUGINS, "Plugins", Icons.Rounded.Extension))
            if (!ui.isTv) {
                add(SettingsSection("downloads", "Descargas", Icons.Rounded.Download))
                add(SettingsSection("parent", "Bloqueo", Icons.Rounded.Lock))
            }
            add(SettingsSection("feedback", "Ayuda", Icons.AutoMirrored.Rounded.HelpOutline))
            add(SettingsSection("about", "Acerca de", Icons.Rounded.Info))
        }
    }

    var current by remember(initialSection, sections) {
        val wanted = if (ui.isTv && initialSection == "parent") "profile" else initialSection
        mutableStateOf(if (sections.any { it.id == wanted }) wanted else "playback")
    }
    var downloads by remember { mutableStateOf<List<DownloadItem>>(emptyList()) }
    var updateInfo by remember { mutableStateOf("Comprueba si hay una versión más reciente disponible.") }
    var updateChecking by remember { mutableStateOf(false) }
    var updateVersion by remember { mutableStateOf("") }
    var updateAvailable by remember { mutableStateOf(false) }
    var updateReady by remember { mutableStateOf(false) }
    var updateProgress by remember { mutableIntStateOf(-1) }

    // A plugin link opened from outside lands on the Plugins panel.
    LaunchedEffect(pendingInstallUrl, pluginsInline) {
        if (pluginsInline && !pendingInstallUrl.isNullOrBlank()) current = SETTINGS_SECTION_PLUGINS
    }

    LaunchedEffect(current) {
        if (current == "downloads") {
            while (current == "downloads") {
                val res = RustServiceBridge.callRpc("downloadList")
                downloads = (res["items"] as? JsonArray).orEmpty().mapNotNull { el ->
                    val o = el as? JsonObject ?: return@mapNotNull null
                    DownloadItem(
                        id = (o["id"] as? JsonPrimitive)?.contentOrNull.orEmpty(),
                        title = (o["title"] as? JsonPrimitive)?.contentOrNull.orEmpty(),
                        subtitle = (o["subtitle"] as? JsonPrimitive)?.contentOrNull.orEmpty(),
                        status = (o["status"] as? JsonPrimitive)?.contentOrNull ?: "queued",
                        bytes = (o["bytes"] as? JsonPrimitive)?.longOrNull ?: 0L,
                        total = (o["total"] as? JsonPrimitive)?.longOrNull ?: 0L,
                        speed = (o["speed"] as? JsonPrimitive)?.longOrNull ?: 0L,
                    )
                }
                delay(1500L)
            }
        }
    }

    fun checkAppUpdate() {
        if (updateChecking) return
        scope.launch {
            updateChecking = true
            updateAvailable = false
            updateReady = false
            try {
                val res = RustServiceBridge.callRpc("appUpdate", buildJsonObject { put("action", "check") })
                val state = (res["state"] as? JsonPrimitive)?.contentOrNull.orEmpty()
                val ver = (
                    (res["latest"] as? JsonPrimitive)?.contentOrNull
                        ?: (res["available"] as? JsonPrimitive)?.contentOrNull.orEmpty()
                    ).removePrefix("v")
                updateVersion = ver.takeIf { it != "true" && it != "false" }.orEmpty()
                when {
                    state == "ready" -> {
                        updateReady = true
                        updateInfo = "Hay una nueva versión disponible: v$updateVersion."
                    }
                    state == "available" || ((res["available"] as? JsonPrimitive)?.contentOrNull == "true") -> {
                        updateAvailable = true
                        updateInfo = "Hay una nueva versión disponible: v$updateVersion."
                        onShowToast("Nueva versión disponible: v$updateVersion")
                    }
                    else -> {
                        updateInfo = "Ya tienes la versión más reciente de OpenTV."
                        onShowToast("Ya tienes la versión más reciente")
                    }
                }
            } finally {
                updateChecking = false
            }
        }
    }

    fun downloadAndInstallUpdate() {
        scope.launch {
            if (updateReady) {
                RustServiceBridge.callRpc("appUpdate", buildJsonObject { put("action", "install") })
                return@launch
            }
            updateProgress = 0
            RustServiceBridge.callRpc("appUpdate", buildJsonObject { put("action", "download") })
            while (true) {
                delay(800L)
                val st = RustServiceBridge.callRpc("appUpdate", buildJsonObject { put("action", "status") })
                val s = (st["state"] as? JsonPrimitive)?.contentOrNull.orEmpty()
                val pct = (st["progress"] as? JsonPrimitive)?.intOrNull ?: -1
                if (pct >= 0) updateProgress = pct
                if (s == "ready") {
                    updateProgress = -1
                    updateReady = true
                    updateAvailable = false
                    updateInfo = "Descarga completa. Abriendo el instalador…"
                    RustServiceBridge.callRpc("appUpdate", buildJsonObject { put("action", "install") })
                    break
                } else if (s == "error" || s == "idle") {
                    updateProgress = -1
                    updateInfo = (st["errorText"] as? JsonPrimitive)?.contentOrNull ?: "No se pudo descargar la actualización"
                    break
                }
            }
        }
    }

    fun openOfflineDownload(dl: DownloadItem) {
        scope.launch {
            val res = RustServiceBridge.callRpc("downloadOpen", buildJsonObject { put("id", dl.id) })
            val url = (res["url"] as? JsonPrimitive)?.contentOrNull.orEmpty()
            if (url.isNotBlank()) {
                onPlayOfflineDownload(dl, url)
            } else {
                onShowToast("No se pudo abrir el archivo descargado")
            }
        }
    }

    fun selectSection(id: String) {
        if (id == SETTINGS_SECTION_PLUGINS && !pluginsInline) onOpenPlugins() else current = id
    }

    // A shortcut inside a panel (Mi cuenta → Mi lista…) swaps the panel under the focused
    // control; on TV the focus then goes to the new section's menu entry.
    var focusMenuAfterSwitch by remember { mutableStateOf(false) }
    fun openFromPanel(id: String) {
        selectSection(id)
        if (ui.isTv) focusMenuAfterSwitch = true
    }

    @Composable
    fun Panel(pad: PaddingValues) {
        if (current == SETTINGS_SECTION_PLUGINS && stremio != null) {
            PluginsPanel(
                stremio = stremio,
                installedPlugins = installedPlugins,
                m3uPlaylists = m3uPlaylists,
                sourcePrefs = sourcePrefs,
                onInstallPlugin = onInstallPlugin,
                onRemovePlugin = onRemovePlugin,
                onSetAllowLan = onSetAllowLan,
                onAddM3u = onAddM3u,
                onRemoveM3u = onRemoveM3u,
                onUpdateSourcePrefs = onUpdateSourcePrefs,
                onShowToast = onShowToast,
                contentPadding = pad,
                pendingInstallUrl = pendingInstallUrl,
                onConsumePendingInstall = onConsumePendingInstall,
                onSetPluginDisabled = onSetPluginDisabled,
                onMovePlugin = onMovePlugin,
            )
        } else {
            SettingsDetailPanel(
                section = current,
                pad = pad,
                appState = appState,
                activeProfile = activeProfile,
                bucket = bucket,
                downloads = downloads,
                updateInfo = updateInfo,
                updateChecking = updateChecking,
                updateVersion = updateVersion,
                listTab = listTab,
                onListTab = { listTab = it },
                onRemoveFromMyList = onRemoveFromMyList,
                onRemoveFavorite = onRemoveFavorite,
                updateAvailable = updateAvailable,
                updateReady = updateReady,
                updateProgress = updateProgress,
                onSelectProfile = onSelectProfile,
                onOpenProfilePicker = onOpenProfilePicker,
                onOpenPlugins = onOpenPlugins,
                onOpenDetail = onOpenDetail,
                onOpenOfflineDownload = ::openOfflineDownload,
                onExportBackup = onExportBackup,
                onImportBackup = onImportBackup,
                onClearHistory = onClearHistory,
                onUpdateAppearance = onUpdateAppearance,
                onUpdatePlayback = onUpdatePlayback,
                onSaveParental = onSaveParental,
                onCheckUpdate = ::checkAppUpdate,
                onInstallUpdate = ::downloadAndInstallUpdate,
                onDownloadAction = { id, act ->
                    scope.launch {
                        RustServiceBridge.callRpc("downloadAction", buildJsonObject { put("id", id); put("action", act) })
                    }
                },
                onShowToast = onShowToast,
                onPlayLocalVideo = onPlayLocalVideo,
                stremio = stremio,
                onUpdateSourcePrefs = onUpdateSourcePrefs,
                onOpenSection = ::openFromPanel,
                onClearCache = onClearCache,
            )
        }
    }

    if (ui.isTv) {
        val menuBorder = SetColors.MenuBorder
        val menuRequesters = remember(sections) { sections.associate { it.id to FocusRequester() } }
        // Last focused control of the panel: → from the menu goes straight back to it.
        val panelMemory = remember { FocusMemory() }
        var panelFocused by remember { mutableStateOf(false) }
        val menuTarget: () -> FocusRequester = { menuRequesters[current] ?: FocusRequester.Default }
        // Entering Ajustes focuses the selected entry once the menu is laid out.
        RequestFocusOnStart(requester = menuRequesters[current] ?: FocusRequester.Default)
        LaunchedEffect(current, focusMenuAfterSwitch) {
            if (!focusMenuAfterSwitch) return@LaunchedEffect
            repeat(2) { withFrameNanos { } }
            runCatching { menuRequesters[current]?.requestFocus() }
            focusMenuAfterSwitch = false
        }
        // BACK inside a panel first returns to its menu entry; BACK on the menu closes Ajustes.
        BackHandler(enabled = panelFocused) { runCatching { menuTarget().requestFocus() } }

        Row(
            modifier = Modifier
                .fillMaxSize()
                .background(OpenTvColors.BgCanvas),
        ) {
            Column(
                verticalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier
                    .width(221.dp)
                    .fillMaxHeight()
                    .background(SetColors.MenuBg)
                    .drawBehind {
                        val w = 1.dp.toPx()
                        drawRect(menuBorder, topLeft = Offset(size.width - w, 0f), size = Size(w, size.height))
                    }
                    // Coming back from the panel (←) lands on the selected entry.
                    .focusProperties { enter = { menuRequesters[current] ?: FocusRequester.Default } }
                    .focusGroup()
                    .padding(start = 19.dp, top = 55.dp),
            ) {
                sections.forEach { sec ->
                    key(sec.id) {
                        SetMenuItem(
                            label = sec.label,
                            icon = sec.icon,
                            selected = sec.id == current,
                            onSelect = { selectSection(sec.id) },
                            focusRequester = menuRequesters.getValue(sec.id),
                            // The fallback route would leave Ajustes on a mere focus: OK only.
                            selectOnFocus = sec.id != SETTINGS_SECTION_PLUGINS || pluginsInline,
                            rightTarget = { panelMemory.target() },
                            modifier = Modifier.padding(horizontal = 12.dp),
                        )
                    }
                }
            }
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .onFocusChanged { panelFocused = it.hasFocus }
                    .focusGroup(),
            ) {
                CompositionLocalProvider(
                    LocalFocusMemory provides panelMemory,
                    LocalLeftExit provides menuTarget,
                ) {
                    // New panel = new lazy state, so its scroll starts at the top.
                    key(current) {
                        Panel(PaddingValues(start = 40.dp, top = 52.dp, end = 55.dp, bottom = 40.dp))
                    }
                }
            }
        }
    } else {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(OpenTvColors.BgCanvas)
                .statusBarsPadding()
                .padding(top = 10.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
            ) {
                OpenTvRoundIconButton(Icons.AutoMirrored.Rounded.ArrowBack, "Volver", onBack, size = 40.dp)
                Text("Ajustes", style = MaterialTheme.typography.headlineMedium)
            }
            Spacer(Modifier.height(12.dp))
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(horizontal = 16.dp),
            ) {
                items(sections, key = { it.id }) { sec ->
                    OpenTvChip(
                        label = sec.label,
                        selected = sec.id == current,
                        onClick = { selectSection(sec.id) },
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
            Box(Modifier.weight(1f).fillMaxWidth()) {
                key(current) {
                    Panel(PaddingValues(start = 16.dp, top = 12.dp, end = 16.dp, bottom = 28.dp))
                }
            }
        }
    }
}

@Composable
private fun SettingsDetailPanel(
    section: String,
    pad: PaddingValues,
    appState: PersistedAppState,
    activeProfile: UserProfile,
    bucket: ProfileBucket,
    downloads: List<DownloadItem>,
    updateInfo: String,
    updateChecking: Boolean,
    updateVersion: String,
    listTab: String,
    onListTab: (String) -> Unit,
    onRemoveFromMyList: (MediaItem) -> Unit,
    onRemoveFavorite: (MediaItem) -> Unit,
    updateAvailable: Boolean,
    updateReady: Boolean,
    updateProgress: Int,
    onSelectProfile: (String) -> Unit,
    onOpenProfilePicker: (() -> Unit)?,
    onOpenPlugins: () -> Unit,
    onOpenDetail: (MediaItem) -> Unit,
    onOpenOfflineDownload: (DownloadItem) -> Unit,
    onExportBackup: () -> Unit,
    onImportBackup: () -> Unit,
    onClearHistory: () -> Unit,
    onUpdateAppearance: ((AppearancePrefs) -> AppearancePrefs) -> Unit,
    onUpdatePlayback: ((PlaybackPrefs) -> PlaybackPrefs) -> Unit,
    onSaveParental: (String, Boolean) -> Unit,
    onCheckUpdate: () -> Unit,
    onInstallUpdate: () -> Unit,
    onDownloadAction: (String, String) -> Unit,
    onShowToast: (String) -> Unit,
    onPlayLocalVideo: (String, String) -> Unit = { _, _ -> },
    stremio: StremioClient? = null,
    onUpdateSourcePrefs: ((SourcePrefs) -> SourcePrefs) -> Unit = {},
    onOpenSection: (String) -> Unit = {},
    onClearCache: (() -> Unit)? = null,
) {
    val ui = LocalOpenTvUi.current
    val gap = Arrangement.spacedBy(20.dp)
    var showLocalTv by remember { mutableStateOf(false) }
    if (showLocalTv) {
        LocalFilesTvDialog(
            onDismiss = { showLocalTv = false },
            onPlay = { uri, title ->
                showLocalTv = false
                onPlayLocalVideo(uri, title)
            },
        )
    }

    when (section) {
        // PC "Mi cuenta" (`SettingsScreen.tsx` account): avatar + name, 3 stat cards,
        // "Accesos rápidos", parental lock (TV) and the local backup card.
        "profile" -> LazyColumn(verticalArrangement = gap, contentPadding = pad, modifier = Modifier.fillMaxSize()) {
            item(key = "header") {
                AccountHeader(
                    profile = activeProfile,
                    position = appState.profiles.indexOfFirst { it.id == activeProfile.id }.coerceAtLeast(0),
                    onOpenProfiles = onOpenProfilePicker,
                )
            }
            item(key = "stats") {
                val nList = bucket.myList.size
                val nFav = bucket.favorites.size
                val nSeen = bucket.watchProgress.size
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                    AccountStat(nList, if (nList == 1) "Título en Mi lista" else "Títulos en Mi lista", Modifier.weight(1f))
                    AccountStat(nFav, if (nFav == 1) "Favorito" else "Favoritos", Modifier.weight(1f))
                    AccountStat(nSeen, if (nSeen == 1) "Visto recientemente" else "Vistos recientemente", Modifier.weight(1f))
                }
            }
            item(key = "quick") {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    SetSectionLabel("Accesos rápidos")
                    val cards: @Composable (Modifier) -> Unit = { m ->
                        QuickActionCard(
                            icon = Icons.Rounded.Bookmark,
                            title = "Mi lista",
                            sub = "Películas y series que guardaste",
                            onClick = { onListTab("mylist"); onOpenSection("history") },
                            modifier = m,
                        )
                        QuickActionCard(
                            icon = Icons.Rounded.History,
                            title = "Historial",
                            sub = "Sigue donde lo dejaste",
                            onClick = { onListTab("history"); onOpenSection("history") },
                            modifier = m,
                        )
                        QuickActionCard(
                            icon = Icons.Rounded.Tune,
                            title = "Ajustes",
                            sub = "Apariencia y reproducción",
                            onClick = { onOpenSection("playback") },
                            modifier = m,
                        )
                    }
                    if (ui.isTv) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            modifier = Modifier.fillMaxWidth().leftExitGroup(),
                        ) { cards(Modifier.weight(1f)) }
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { cards(Modifier.fillMaxWidth()) }
                    }
                }
            }
            if (ui.isTv) {
                item(key = "parental") { ParentalGroup(appState, onSaveParental, onShowToast) }
            }
            item(key = "backup") {
                SetGroup(null) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.padding(horizontal = 15.dp, vertical = 14.dp),
                    ) {
                        Text("Copia de seguridad local", color = SetColors.Text, fontSize = tsp(13f), fontWeight = FontWeight.SemiBold)
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.padding(top = 4.dp).leftExitGroup(),
                        ) {
                            SetButton("Exportar respaldo", onExportBackup, icon = Icons.Rounded.Download, height = 31.dp, fontSize = 10.5f)
                            SetButton("Importar respaldo", onImportBackup, icon = Icons.Rounded.UploadFile, height = 31.dp, fontSize = 10.5f)
                        }
                    }
                }
            }
        }

        // PC "Mi lista" (`SettingsScreen.tsx` mylist): 3 tabs (Mi lista | Favoritos | Historial),
        // "Borrar historial", poster grid. TV removes a title with a long OK press.
        "history" -> {
            val shownTab = listTab
            val historyItems = remember(bucket.watchProgress) { bucket.watchProgress.map { it.asListItem() } }
            val items = when (shownTab) {
                "favs" -> bucket.favorites
                "history" -> historyItems
                else -> bucket.myList
            }
            val removable = shownTab != "history"
            val gridFocus = remember { FocusRequester() }
            val tabsFocus = remember { FocusRequester() }
            // After a removal, focus moves to the card that took its place (or the tabs).
            var refocusIdx by remember { mutableIntStateOf(-1) }
            LaunchedEffect(items.size, refocusIdx) {
                if (refocusIdx < 0) return@LaunchedEffect
                withFrameNanos { }
                if (items.isEmpty() || runCatching { gridFocus.requestFocus() }.isFailure) {
                    runCatching { tabsFocus.requestFocus() }
                }
                refocusIdx = -1
            }
            LazyVerticalGrid(
                columns = if (ui.isTv) GridCells.Fixed(5) else GridCells.Adaptive(minSize = 112.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                contentPadding = pad,
                modifier = Modifier.fillMaxSize(),
            ) {
                item(key = "tabs", span = { GridItemSpan(maxLineSpan) }) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp),
                    ) {
                        Box(Modifier.focusRequester(tabsFocus)) {
                            SetSubTabs(
                                tabs = buildList {
                                    add("mylist" to "Mi lista (${bucket.myList.size})")
                                    add("favs" to "Favoritos (${bucket.favorites.size})")
                                    add("history" to "Historial (${bucket.watchProgress.size})")
                                },
                                selected = shownTab,
                                onSelect = onListTab,
                            )
                        }
                        Spacer(Modifier.weight(1f))
                        if (shownTab == "history" && bucket.watchProgress.isNotEmpty()) {
                            Box(Modifier.leftExitGroup()) {
                                SetButton(
                                    text = "Borrar historial",
                                    onClick = {
                                        onClearHistory()
                                        onShowToast("Historial borrado")
                                        refocusIdx = 0
                                    },
                                    icon = Icons.Rounded.Delete,
                                    danger = true,
                                )
                            }
                        }
                    }
                }
                if (items.isEmpty()) {
                    item(key = "empty_$shownTab", span = { GridItemSpan(maxLineSpan) }) {
                        ListEmptyState(
                            when (shownTab) {
                                "favs" -> "Todavía no marcas ningún favorito."
                                "history" -> "Aún no has visto películas ni series."
                                else -> "Aún no guardas títulos en Mi lista."
                            },
                        )
                    }
                } else {
                    if (removable) {
                        item(key = "hint_$shownTab", span = { GridItemSpan(maxLineSpan) }) {
                            Text(
                                text = if (ui.isTv) "Mantén pulsado OK (o pulsa ☰) sobre un título para quitarlo." else "Mantén pulsado un título para quitarlo.",
                                color = SetColors.Text45,
                                fontSize = tsp(9.5f),
                            )
                        }
                    }
                    items(items.size, key = { "${shownTab}_${items[it].id}_$it" }) { idx ->
                        val item = items[idx]
                        PosterCard(
                            item = item,
                            showCaptionBelow = true,
                            showMetaBelow = shownTab == "history",
                            onClick = { onOpenDetail(item) },
                            onLongClick = if (removable) {
                                {
                                    if (shownTab == "mylist") {
                                        onRemoveFromMyList(item)
                                        onShowToast("Se quitó de Mi lista")
                                    } else {
                                        onRemoveFavorite(item)
                                        onShowToast("Se quitó de favoritos")
                                    }
                                    refocusIdx = idx
                                }
                            } else null,
                            modifier = Modifier
                                .fillMaxWidth()
                                .stableFocusRequester(
                                    idx == refocusIdx.coerceAtMost(items.lastIndex),
                                    gridFocus,
                                ),
                        )
                    }
                }
            }
        }

        "parent" -> LazyColumn(verticalArrangement = gap, contentPadding = pad, modifier = Modifier.fillMaxSize()) {
            item(key = "title") { SetPanelTitle("Bloqueo") }
            item(key = "parental") { ParentalGroup(appState, onSaveParental, onShowToast) }
        }

        "playback" -> {
            var tab by remember { mutableStateOf("look") }
            LazyColumn(verticalArrangement = gap, contentPadding = pad, modifier = Modifier.fillMaxSize()) {
                item(key = "title") { SetPanelTitle("Ajustes") }
                item(key = "tabs") {
                    SetSubTabs(
                        tabs = listOf("look" to "Apariencia", "play" to "Reproducción"),
                        selected = tab,
                        onSelect = { tab = it },
                    )
                }
                if (tab == "look") {
                    item(key = "look_style") {
                        SetGroup("Estilo") {
                            SetRow(
                                name = "Tema",
                                divider = false,
                            ) {
                                SetSeg(
                                    options = listOf("Oscuro", "Claro"),
                                    selected = if (appState.appearance.theme == "light") 1 else 0,
                                    onSelect = { i -> onUpdateAppearance { it.copy(theme = if (i == 1) "light" else "dark") } },
                                )
                            }
                            SetRow(
                                name = "Color de acento",
                            ) {
                                AccentPicker(
                                    selectedId = appState.appearance.accentId,
                                    onSelect = { id -> onUpdateAppearance { it.copy(accentId = id) } },
                                )
                            }
                            SetRow(
                                name = "Tamaño del texto",
                            ) {
                                SetSeg(
                                    options = listOf("Normal", "Aumentado"),
                                    selected = if (appState.appearance.textLarge) 1 else 0,
                                    onSelect = { i -> onUpdateAppearance { it.copy(textLarge = i == 1) } },
                                )
                            }
                            if (ui.isTv) {
                                SetRow(
                                    name = "Margen de pantalla",
                                ) {
                                    SetSeg(
                                        options = listOf("Ninguno", "Pequeño", "Grande"),
                                        selected = appState.appearance.tvMarginIndex,
                                        onSelect = { i -> onUpdateAppearance { it.copy(tvMarginIndex = i) } },
                                    )
                                }
                            }
                        }
                    }
                    item(key = "look_perf") {
                        SetGroup("Rendimiento") {
                            SetRow(
                                name = "Modo ligero",
                                divider = false,
                            ) {
                                SetSeg(
                                    options = listOf("Apagado", "Encendido"),
                                    selected = if (appState.appearance.liteMode) 1 else 0,
                                    onSelect = { i -> onUpdateAppearance { it.copy(liteMode = i == 1) } },
                                )
                            }
                        }
                    }
                } else {
                    item(key = "play_quality") {
                        SetGroup("Vídeo") {
                            val ids = listOf("auto", "4K", "1080p", "720p", "SD")
                            SetRow(
                                name = "Calidad preferida",
                                divider = false,
                            ) {
                                SetSeg(
                                    options = listOf("Auto", "4K", "1080p", "720p", "SD"),
                                    selected = ids.indexOf(appState.sourcePrefs.quality).coerceAtLeast(0),
                                    onSelect = { i -> onUpdateSourcePrefs { it.copy(quality = ids[i]) } },
                                )
                            }
                            SetRow(
                                name = "Siguiente episodio automático",
                            ) {
                                SetSeg(
                                    options = listOf("No", "Sí"),
                                    selected = if (appState.playback.autoNextEpisode) 1 else 0,
                                    onSelect = { i -> onUpdatePlayback { it.copy(autoNextEpisode = i == 1) } },
                                )
                            }
                            SetRow(
                                name = "Omitir intro automáticamente",
                            ) {
                                SetSeg(
                                    options = listOf("Apagado", "Encendido"),
                                    selected = if (appState.playback.autoSkipIntro) 1 else 0,
                                    onSelect = { i -> onUpdatePlayback { it.copy(autoSkipIntro = i == 1) } },
                                )
                            }
                        }
                    }
                    item(key = "play_subs") {
                        val sub = appState.playback.subtitleStyle
                        SetGroup("Subtítulos") {
                            val langs = listOf("es", "pt", "en")
                            SetRow("Idioma", divider = false) {
                                SetSeg(
                                    options = listOf("Español", "Portugués", "Inglés"),
                                    selected = langs.indexOf(sub.preferredLang).coerceAtLeast(0),
                                    onSelect = { i ->
                                        onUpdatePlayback { p -> p.copy(subtitleStyle = p.subtitleStyle.copy(preferredLang = langs[i])) }
                                    },
                                )
                            }
                            val sizes = listOf(16f, 20f, 25f, 30f)
                            SetRow("Tamaño") {
                                SetSeg(
                                    options = listOf("Pequeño", "Normal", "Grande", "Extra"),
                                    selected = sizes.indexOf(sub.sizeSp),
                                    onSelect = { i -> onUpdatePlayback { p -> p.copy(subtitleStyle = p.subtitleStyle.copy(sizeSp = sizes[i])) } },
                                )
                            }
                            val colors = listOf(0xFFFFFFFF, 0xFFFFD34D)
                            SetRow("Color") {
                                SetSeg(
                                    options = listOf("Blanco", "Amarillo"),
                                    selected = colors.indexOf(sub.textColorHex),
                                    onSelect = { i -> onUpdatePlayback { p -> p.copy(subtitleStyle = p.subtitleStyle.copy(textColorHex = colors[i])) } },
                                )
                            }
                            val alphas = listOf(0.0f, 0.55f, 0.82f)
                            SetRow("Fondo") {
                                SetSeg(
                                    options = listOf("Sin fondo", "Suave", "Oscuro"),
                                    // Nearest option: older defaults (0.65) are not one of the three values.
                                    selected = alphas.indices.minByOrNull { kotlin.math.abs(alphas[it] - sub.bgAlpha) } ?: 1,
                                    onSelect = { i -> onUpdatePlayback { p -> p.copy(subtitleStyle = p.subtitleStyle.copy(bgAlpha = alphas[i])) } },
                                )
                            }
                        }
                    }
                    item(key = "play_audio") {
                        SetGroup("Audio") {
                            val langs = listOf("es", "pt", "en")
                            SetRow(
                                name = "Idioma preferido",
                                divider = false,
                            ) {
                                SetSeg(
                                    options = listOf("Español", "Portugués", "Inglés"),
                                    selected = langs.indexOf(appState.playback.preferredAudioLang).coerceAtLeast(0),
                                    onSelect = { i -> onUpdatePlayback { it.copy(preferredAudioLang = langs[i]) } },
                                )
                            }
                            SetRow(
                                name = "Audio envolvente HDMI (Dolby / DTS)",
                            ) {
                                SetSeg(
                                    options = listOf("Apagado", "Encendido"),
                                    selected = if (appState.playback.passthroughAudio) 1 else 0,
                                    onSelect = { i -> onUpdatePlayback { it.copy(passthroughAudio = i == 1) } },
                                )
                            }
                        }
                    }
                    item(key = "play_live") {
                        SetGroup("TV en vivo") {
                            val active = appState.m3uPlaylists.count { it.enabled }
                            SetRow(
                                name = "Listas de canales (M3U)",
                                hint = if (active == 0) "Sin listas activas" else "$active ${if (active == 1) "lista activa" else "listas activas"}",
                                divider = false,
                            ) {
                                SetButton("Administrar", { onOpenSection(SETTINGS_SECTION_PLUGINS) }, icon = Icons.Rounded.Extension)
                            }
                        }
                    }
                    if (ui.isTv) {
                        item(key = "play_local") {
                            SetGroup("Archivos locales") {
                                SetRow(
                                    name = "Archivos locales / USB",
                                    divider = false,
                                ) {
                                    SetButton("Abrir", { showLocalTv = true }, icon = Icons.Rounded.FolderOpen)
                                }
                            }
                        }
                    }
                }
            }
        }

        "sources" -> LazyColumn(verticalArrangement = gap, contentPadding = pad, modifier = Modifier.fillMaxSize()) {
            // Only reached when the embedded panel is not wired (no StremioClient).
            item(key = "title") { SetPanelTitle("Plugins") }
            item(key = "open") {
                SetGroup(null) {
                    SetRow("Plugins de fuentes compatibles con Stremio y listas de TV", divider = false) {
                        SetButton("Abrir plugins", onOpenPlugins, primary = true, icon = Icons.Rounded.Extension)
                    }
                }
            }
        }

        "downloads" -> {
            var dlTab by remember { mutableStateOf("downloads") }
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                contentPadding = pad,
                modifier = Modifier.fillMaxSize(),
            ) {
                item(key = "title") {
                    SetPanelTitle(if (dlTab == "local") "Archivos locales" else "Descargas", Modifier.padding(bottom = 4.dp))
                }
                item(key = "tabs") {
                    SetSubTabs(
                        tabs = listOf("downloads" to "Descargas", "local" to "Archivos locales"),
                        selected = dlTab,
                        onSelect = { dlTab = it },
                        modifier = Modifier.padding(bottom = 6.dp),
                    )
                }
                if (dlTab == "local") {
                    item(key = "local") { LocalFilesMobileContent(onPlay = onPlayLocalVideo, onShowToast = onShowToast) }
                } else {
                    if (downloads.isEmpty()) {
                        item(key = "empty") {
                            Text("No tienes descargas guardadas en este dispositivo.", color = SetColors.Text55, fontSize = tsp(11f))
                        }
                    }
                    items(downloads, key = { it.id }) { dl ->
                        DownloadRow(dl, onOpenOfflineDownload, onDownloadAction)
                    }
                }
            }
        }

        "feedback" -> {
            val diagScope = rememberCoroutineScope()
            var runningDiag by remember { mutableStateOf(false) }
            var diagRows by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }

            fun runDiagnostics() {
                if (runningDiag) return
                runningDiag = true
                diagScope.launch {
                    try {
                        val out = mutableListOf<Pair<String, String>>()
                        val t0 = System.currentTimeMillis()
                        val ping = RustServiceBridge.callRpc("ping")
                        val pingMs = (System.currentTimeMillis() - t0).coerceAtLeast(1L)
                        val port = (ping["proxyPort"] as? JsonPrimitive)?.intOrNull ?: 0
                        out += "Núcleo Rust (opentv-core)" to if (port > 0) "Activo (127.0.0.1:$port · ${pingMs} ms)" else "Inactivo"
                        out += "Motor de video" to "Media3 ExoPlayer 1.6.1 + FFmpeg Audio"
                        val freeBytes = ((ping["storage"] as? JsonObject)?.get("free") as? JsonPrimitive)?.longOrNull ?: 0L
                        if (freeBytes > 0L) {
                            val freeGb = String.format(Locale("es"), "%.2f GB libres", freeBytes / 1_073_741_824.0)
                            out += "Almacenamiento" to freeGb
                        }
                        val activePlugins = appState.plugins.filter { !it.disabled && !it.builtin }
                        for (p in activePlugins) {
                            val pStart = System.currentTimeMillis()
                            val ok = if (stremio != null) {
                                kotlinx.coroutines.withTimeoutOrNull(5_000L) {
                                    stremio.inspectPlugin(p.url).isSuccess
                                } == true
                            } else true
                            val ms = (System.currentTimeMillis() - pStart).coerceAtLeast(1L)
                            out += "Plugin: ${p.name}" to if (ok) "OK · ${ms} ms" else "Sin respuesta"
                        }
                        diagRows = out
                    } finally {
                        runningDiag = false
                    }
                }
            }

            LazyColumn(verticalArrangement = gap, contentPadding = pad, modifier = Modifier.fillMaxSize()) {
                item(key = "title") { SetPanelTitle("Ayuda") }
                item(key = "diag") {
                    SetGroup("Diagnóstico del sistema") {
                        SetRow(
                            name = "Comprobar núcleo, almacenamiento y velocidad de plugins",
                            divider = false,
                        ) {
                            SetButton(
                                text = if (runningDiag) "Analizando…" else "Ejecutar diagnóstico",
                                onClick = { runDiagnostics() },
                                primary = true,
                                enabled = !runningDiag,
                            )
                        }
                        diagRows.forEach { (label, value) ->
                            SetRow(name = label) {
                                Text(value, color = SetColors.Text70, fontSize = tsp(10f))
                            }
                        }
                    }
                }
                if (onClearCache != null) {
                    item(key = "cache") {
                        SetGroup("Almacenamiento") {
                            SetRow(
                                name = "Borrar caché",
                                divider = false,
                            ) {
                                SetButton(
                                    "Borrar",
                                    { onClearCache(); onShowToast("Caché borrada") },
                                    icon = Icons.Rounded.Delete,
                                )
                            }
                        }
                    }
                }
            }
        }

        // PC "Acerca de": app header, Actualizaciones, privacy note and credits.
        "about" -> LazyColumn(contentPadding = pad, modifier = Modifier.fillMaxSize()) {
            item(key = "title") { SetPanelTitle("Acerca de", Modifier.padding(bottom = 16.dp)) }
            item(key = "app") {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(18.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .bottomDivider()
                        .padding(bottom = 18.dp),
                ) {
                    val tile = RoundedCornerShape(16.dp)
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .size(58.dp)
                            .clip(tile)
                            .background(OpenTvColors.CardSurface)
                            .border(1.dp, OpenTvColors.fg(0.102f), tile),
                    ) {
                        Image(
                            painter = painterResource(id = R.drawable.ic_opentv_logo),
                            colorFilter = androidx.compose.ui.graphics.ColorFilter.tint(OpenTvColors.Content),
                            contentDescription = "OpenTV",
                            modifier = Modifier.size(31.dp),
                        )
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("OpenTV", color = SetColors.Text, fontSize = tsp(25f), fontWeight = FontWeight.Bold, lineHeight = tsp(27f))
                        Text(
                            "Versión ${BuildConfig.VERSION_NAME} · ${if (ui.isTv) "Android TV y Fire TV" else "Android"} (Kotlin + Rust)",
                            color = SetColors.Text50,
                            fontSize = tsp(11f),
                        )
                        Text("Películas, series y TV en vivo en un solo lugar.", color = OpenTvColors.fg(0.722f), fontSize = tsp(10.5f))
                    }
                }
            }
            item(key = "update") {
                Column(
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .bottomDivider()
                        .padding(vertical = 16.dp),
                ) {
                    Text("Actualizaciones", color = SetColors.Text, fontSize = tsp(13.5f), fontWeight = FontWeight.SemiBold)
                    Text(updateInfo, color = OpenTvColors.fg(0.6f), fontSize = tsp(10.5f))
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(top = 8.dp).leftExitGroup(),
                    ) {
                        SetButton(
                            text = if (updateChecking) "Buscando…" else "Buscar actualizaciones",
                            onClick = onCheckUpdate,
                            primary = true,
                            icon = Icons.Rounded.Refresh,
                            enabled = !updateChecking,
                            height = 31.dp,
                            fontSize = 10.5f,
                        )
                        if (updateAvailable || updateReady || updateProgress >= 0) {
                            UpdateGreenButton(
                                text = when {
                                    updateReady -> "Instalar v$updateVersion ahora"
                                    updateProgress >= 0 -> "Descargando ($updateProgress %)…"
                                    else -> "Actualizar a v$updateVersion"
                                },
                                enabled = updateProgress < 0,
                                onClick = onInstallUpdate,
                            )
                        }
                    }
                    if (updateProgress >= 0) {
                        LinearProgressIndicator(
                            progress = { (updateProgress / 100f).coerceIn(0.04f, 1f) },
                            color = ui.accent.color,
                            trackColor = OpenTvColors.fg(0.102f),
                            modifier = Modifier
                                .padding(top = 10.dp)
                                .widthIn(max = 360.dp)
                                .fillMaxWidth()
                                .height(4.dp)
                                .clip(RoundedCornerShape(2.dp)),
                        )
                    }
                }
            }
            item(key = "privacy") {
                Column(
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .bottomDivider()
                        .padding(vertical = 16.dp),
                ) {
                    Text("Sin cuentas ni contraseñas", color = SetColors.Text, fontSize = tsp(13.5f), fontWeight = FontWeight.SemiBold)
                    Text(
                        "Tu lista, el historial y tus preferencias se guardan solo en este aparato; no se envían a ningún servidor.",
                        color = OpenTvColors.fg(0.6f),
                        fontSize = tsp(10.5f),
                        lineHeight = tsp(14f),
                    )
                }
            }
            item(key = "credits") {
                Column(verticalArrangement = Arrangement.spacedBy(3.dp), modifier = Modifier.padding(top = 16.dp)) {
                    Text("Hecho por TECHPOINT Software™", color = SetColors.Text, fontSize = tsp(12f), fontWeight = FontWeight.SemiBold)
                    val small = tsp(9.75f)
                    Text("© 2026 TECHPOINT Software™ · Todos los derechos reservados", color = SetColors.Text50, fontSize = small)
                    Text(
                        "Impulsado por Kotlin, Jetpack Compose, Media3 ExoPlayer, Rust (opentv-core) y librqbit (código abierto).",
                        color = SetColors.Text50,
                        fontSize = small,
                    )
                    Text(
                        "Tendencias con datos de TMDB. Este producto usa la API de TMDB pero no está avalado ni certificado por TMDB.",
                        color = SetColors.Text50,
                        fontSize = small,
                    )
                }
            }
        }
    }
}

/** Accent pills with a color dot (v1 `.set-seg.is-wrap`). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AccentPicker(selectedId: String, onSelect: (String) -> Unit) {
    val ui = LocalOpenTvUi.current
    FlowRow(
        horizontalArrangement = Arrangement.End,
        verticalArrangement = Arrangement.spacedBy(1.dp),
    ) {
        OpenTvAccents.All.forEach { base ->
            val acc = OpenTvAccents.forTheme(base, ui.lightTheme)
            val selected = acc.id == selectedId
            SetSegButton(
                label = acc.label,
                selected = selected,
                onClick = { onSelect(acc.id) },
                pill = true,
                leading = {
                    Box(
                        modifier = Modifier
                            .size(9.dp)
                            .clip(CircleShape)
                            .background(acc.color)
                            .border(1.dp, if (selected) ui.accent.onAccent else OpenTvColors.fg(0.4f), CircleShape),
                    )
                },
            )
        }
    }
}

/** Parental PIN and Kids lock (inside "Mi cuenta" on TV; own "Bloqueo" entry on phones). */
@Composable
private fun ParentalGroup(
    appState: PersistedAppState,
    onSaveParental: (String, Boolean) -> Unit,
    onShowToast: (String) -> Unit,
) {
    var pinInput by remember(appState.parentalPin) { mutableStateOf(appState.parentalPin) }
    SetGroup("Bloqueo y Modo Kids") {
        SetRow(
            name = "Pedir PIN para salir del perfil Kids",
            divider = false,
        ) {
            SetSeg(
                options = listOf("No", "Sí"),
                selected = if (appState.parentalLocked) 1 else 0,
                onSelect = { i ->
                    val on = i == 1
                    if (on && pinInput.length < 4) {
                        onShowToast("Guarda primero un PIN de 4 dígitos")
                    } else {
                        onSaveParental(pinInput, on)
                        onShowToast(if (on) "Bloqueo parental activado" else "Bloqueo parental desactivado")
                    }
                },
            )
        }
        if (LocalOpenTvUi.current.isTv) {
            // TV: keypad dialog instead of a text field (no system keyboard on the remote).
            var padOpen by remember { mutableStateOf(false) }
            SetRow(
                name = "PIN parental (4 dígitos)",
                hint = if (appState.parentalPin.length == 4) "PIN guardado" else "Sin PIN",
            ) {
                SetButton(
                    text = if (appState.parentalPin.length == 4) "Cambiar PIN" else "Crear PIN",
                    primary = true,
                    icon = Icons.Rounded.Lock,
                    onClick = { padOpen = true },
                )
            }
            if (padOpen) {
                TvPinDialog(
                    title = "Nuevo PIN parental",
                    subtitle = "Elige 4 dígitos con el control remoto.",
                    onDismiss = { padOpen = false },
                    onComplete = { pin ->
                        padOpen = false
                        pinInput = pin
                        onSaveParental(pin, true)
                        onShowToast("PIN guardado y bloqueo activado")
                        true
                    },
                )
            }
            return@SetGroup
        }
        SetRow(name = "PIN parental (4 dígitos)") {
            SetTextField(
                value = pinInput,
                onValueChange = { pinInput = it.filter(Char::isDigit).take(4) },
                placeholder = "0000",
                keyboardType = KeyboardType.NumberPassword,
                password = true,
                modifier = Modifier.width(96.dp),
            )
            Spacer(Modifier.width(4.dp))
            SetButton(
                text = "Guardar PIN",
                primary = true,
                onClick = {
                    if (pinInput.length == 4) {
                        onSaveParental(pinInput, true)
                        onShowToast("PIN guardado y bloqueo activado")
                    } else {
                        onShowToast("El PIN debe tener exactamente 4 dígitos")
                    }
                },
            )
        }
    }
}

@Composable
private fun DownloadRow(
    dl: DownloadItem,
    onOpen: (DownloadItem) -> Unit,
    onAction: (String, String) -> Unit,
) {
    val ui = LocalOpenTvUi.current
    val speedStr = if (dl.speed > 0L) String.format(Locale("es"), " · %.1f MB/s", dl.speed / 1_048_576.0) else ""
    val pctStr = if (dl.total > 0L) " · ${(dl.progress * 100).toInt()}%" else ""
    val statusLabel = when (dl.status) {
        "done" -> "Lista para ver sin conexión"
        "downloading" -> "Descargando$pctStr$speedStr"
        "paused" -> "Pausada$pctStr"
        "error" -> "Error al descargar"
        else -> "En cola"
    }
    SetGroup(null) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text(dl.title, color = SetColors.Text, fontSize = tsp(12.5f), fontWeight = FontWeight(550), maxLines = 1)
                Text(
                    listOf(dl.subtitle, statusLabel).filter { it.isNotBlank() }.joinToString(" · "),
                    color = SetColors.Text55,
                    fontSize = tsp(9.5f),
                    maxLines = 1,
                )
            }
            when (dl.status) {
                "done" -> OpenTvPrimaryButton("Ver", Icons.Rounded.PlayArrow, onClick = { onOpen(dl) })
                "downloading" -> OpenTvRoundIconButton(Icons.Rounded.Pause, "Pausar", { onAction(dl.id, "pause") }, size = 38.dp)
                "paused", "error" -> OpenTvRoundIconButton(Icons.Rounded.PlayArrow, "Reanudar", { onAction(dl.id, "resume") }, size = 38.dp)
            }
            OpenTvRoundIconButton(Icons.Rounded.Delete, "Eliminar", { onAction(dl.id, "remove") }, size = 38.dp)
        }
        if (dl.status == "downloading" || dl.status == "paused") {
            LinearProgressIndicator(
                progress = { dl.progress },
                color = ui.accent.color,
                trackColor = OpenTvColors.fg(0.2f),
                modifier = Modifier
                    .padding(start = 12.dp, end = 12.dp, bottom = 12.dp)
                    .fillMaxWidth()
                    .height(4.dp)
                    .clip(RoundedCornerShape(2.dp)),
            )
        }
    }
}

/** History entry shown as a poster (PC `historyAsItems`: year = "T1 · E2" for episodes). */
private fun WatchProgress.asListItem(): MediaItem = MediaItem(
    id = itemId,
    type = type,
    title = title,
    year = if (season > 0) "T$season · E$episode" else "",
    poster = poster,
    backdrop = backdrop,
    isAnime = type == "anime",
)

/** 0.5 dp white 8 % line under a block (PC `border-b border-white/[0.08]`). */
@Composable
private fun Modifier.bottomDivider(): Modifier {
    val line = OpenTvColors.fg(0.08f)
    return drawBehind {
    val h = 0.5.dp.toPx()
    drawRect(line, topLeft = Offset(0f, size.height - h), size = Size(size.width, h))
    }
}

/** PC Mi cuenta header: rounded avatar, profile name, "Guardado solo en este equipo", profile buttons. */
@Composable
private fun AccountHeader(profile: UserProfile, position: Int, onOpenProfiles: (() -> Unit)?) {
    val isTv = LocalOpenTvUi.current.isTv
    val tile = RoundedCornerShape(16.dp)
    val buttons: @Composable () -> Unit = {
        if (onOpenProfiles != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.leftExitGroup()) {
                SetButton("Cambiar de perfil", onOpenProfiles, height = 31.dp, fontSize = 10.5f)
                SetButton("Administrar perfiles", onOpenProfiles, height = 31.dp, fontSize = 10.5f)
            }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Box(Modifier.clip(tile).border(2.dp, OpenTvColors.fg(0.2f), tile)) {
                com.techpoint.opentv.ui.components.ProfileAvatar(
                    index = profile.resolvedAvatarIndex(position),
                    size = if (isTv) 64.dp else 56.dp,
                )
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    text = profile.name,
                    color = SetColors.Text,
                    fontSize = tsp(26f),
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-0.3).sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = (if (profile.kids) "Perfil infantil · " else "") + "Guardado solo en este equipo",
                    color = SetColors.Text50,
                    fontSize = tsp(11f),
                )
            }
            if (isTv) buttons()
        }
        if (!isTv) buttons()
    }
}

/** PC `acc-stats` card: big number + label. */
@Composable
private fun AccountStat(value: Int, label: String, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(14.dp)
    Column(
        verticalArrangement = Arrangement.spacedBy(5.dp),
        modifier = modifier
            .clip(shape)
            .background(OpenTvColors.fg(0.039f))
            .border(0.5.dp, OpenTvColors.fg(0.071f), shape)
            .padding(horizontal = 15.dp, vertical = 14.dp),
    ) {
        Text(value.toString(), color = SetColors.Text, fontSize = tsp(30f), fontWeight = FontWeight.SemiBold, lineHeight = tsp(31f))
        Text(label, color = SetColors.Text55, fontSize = tsp(10.5f), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Small uppercase section caption (PC "ACCESOS RÁPIDOS"). */
@Composable
private fun SetSectionLabel(text: String) {
    Text(
        text = text.uppercase(),
        color = SetColors.Text45,
        fontSize = tsp(9f),
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.14.em,
    )
}

/** PC `acc-actions` card: icon tile, title + subtitle and a chevron. */
@Composable
private fun QuickActionCard(
    icon: ImageVector,
    title: String,
    sub: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(14.dp)
    Box(modifier.outerRing(focused, RoundedCornerShape(16.5.dp))) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(11.dp),
            modifier = Modifier
                .fillMaxWidth()
                .clip(shape)
                .background(if (focused) SetColors.FocusFill else OpenTvColors.fg(0.051f))
                .border(0.5.dp, OpenTvColors.fg(0.078f), shape)
                .rememberFocus()
                .clickable(interactionSource = interaction, indication = null, onClick = onClick)
                .padding(horizontal = 13.dp, vertical = 13.dp),
        ) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(36.dp)
                    .clip(RoundedCornerShape(11.dp))
                    .background(OpenTvColors.fg(0.102f)),
            ) {
                Icon(icon, contentDescription = null, tint = SetColors.Text, modifier = Modifier.size(18.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(title, color = SetColors.Text, fontSize = tsp(12.5f), fontWeight = FontWeight.SemiBold, maxLines = 1)
                Text(sub, color = SetColors.Text50, fontSize = tsp(9.5f), lineHeight = tsp(12f), maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Icon(
                Icons.AutoMirrored.Rounded.KeyboardArrowRight,
                contentDescription = null,
                tint = OpenTvColors.fg(0.4f),
                modifier = Modifier.size(16.dp),
            )
        }
    }
}

/** PC empty list: dashed frame, faded OpenTV mark and a short message. */
@Composable
private fun ListEmptyState(text: String) {
    val dashColor = OpenTvColors.fg(0.141f)
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically),
        modifier = Modifier
            .fillMaxWidth()
            .height(200.dp)
            .drawBehind {
                val w = 1.dp.toPx()
                drawRoundRect(
                    color = dashColor,
                    topLeft = Offset(w / 2, w / 2),
                    size = Size(size.width - w, size.height - w),
                    cornerRadius = CornerRadius(16.dp.toPx()),
                    style = Stroke(width = w, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 5.dp.toPx()))),
                )
            },
    ) {
        Image(
            painter = painterResource(id = R.drawable.ic_opentv_logo),
            colorFilter = androidx.compose.ui.graphics.ColorFilter.tint(OpenTvColors.Content),
            contentDescription = null,
            modifier = Modifier.size(30.dp).alpha(0.25f),
        )
        Text(text, color = SetColors.Text55, fontSize = tsp(11.5f))
    }
}

/** PC mint "Actualizar a vX" button (`#7ee2a8` on 15 %). */
@Composable
private fun UpdateGreenButton(text: String, enabled: Boolean, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val mint = SetColors.Ok
    val shape = RoundedCornerShape(7.dp)
    Box(Modifier.outerRing(focused, RoundedCornerShape(9.5.dp))) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .height(31.dp * setBoost())
                .clip(shape)
                .background(mint.copy(alpha = if (focused) 0.28f else 0.15f))
                .border(1.dp, mint.copy(alpha = 0.4f), shape)
                .rememberFocus()
                .clickable(enabled = enabled, interactionSource = interaction, indication = null, onClick = onClick)
                .padding(horizontal = 12.dp)
                .alpha(if (enabled) 1f else 0.6f),
        ) {
            Text(text, color = mint, fontSize = tsp(10.5f), fontWeight = FontWeight.Bold, maxLines = 1)
        }
    }
}
