package com.techpoint.opentv

import android.Manifest
import android.app.PictureInPictureParams
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color as AndroidColor
import android.os.Build
import android.os.Bundle
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.zIndex
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.techpoint.opentv.core.data.AppUpdatePolicy
import com.techpoint.opentv.core.data.PersistedAppState
import com.techpoint.opentv.core.data.ProfileBucket
import com.techpoint.opentv.core.model.Episode
import com.techpoint.opentv.core.model.HomeTab
import com.techpoint.opentv.core.model.MediaItem
import com.techpoint.opentv.core.model.StreamSource
import com.techpoint.opentv.core.model.UserProfile
import com.techpoint.opentv.core.model.WatchProgress
import com.techpoint.opentv.core.ranking.SourceRanker
import com.techpoint.opentv.service.DownloadsForegroundService
import com.techpoint.opentv.service.RustServiceBridge
import com.techpoint.opentv.ui.components.OpenTvChip
import com.techpoint.opentv.ui.components.OpenTvGlassButton
import com.techpoint.opentv.ui.components.OpenTvPrimaryButton
import com.techpoint.opentv.ui.detail.DetailScreen
import com.techpoint.opentv.ui.home.HomeCatalogContent
import com.techpoint.opentv.ui.home.HomeFocusMemory
import com.techpoint.opentv.ui.profiles.ProfilePickerScreen
import com.techpoint.opentv.ui.home.TvHomeCatalog
import com.techpoint.opentv.ui.components.BootSplash
import com.techpoint.opentv.ui.components.ForceUpdateOverlay
import com.techpoint.opentv.ui.nav.TvTopBar
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.animation.core.tween
import com.techpoint.opentv.ui.live.LiveTvScreen
import com.techpoint.opentv.ui.nav.OpenTvSmileyAvatar
import com.techpoint.opentv.ui.nav.OpenTvTopBar
import com.techpoint.opentv.ui.nav.TvLeftRail
import com.techpoint.opentv.ui.player.PlayerPreparingScreen
import com.techpoint.opentv.ui.player.VodPlayerScreen
import com.techpoint.opentv.ui.plugins.PluginsScreen
import com.techpoint.opentv.ui.search.SearchScreen
import com.techpoint.opentv.ui.settings.SettingsScreen
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import com.techpoint.opentv.ui.theme.OpenTvAccents
import com.techpoint.opentv.ui.theme.OpenTvColors
import com.techpoint.opentv.ui.theme.OpenTvTheme
import com.techpoint.opentv.ui.theme.OpenTvForceDark
import com.techpoint.opentv.ui.theme.OpenTvUiConfig
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

sealed interface AppRoute {
    data object Home : AppRoute
    data class Detail(val item: MediaItem) : AppRoute
    data class VodPlayer(
        val item: MediaItem,
        val episode: Episode?,
        val allEpisodes: List<Episode>,
        val source: StreamSource?,
        val offlineUrl: String? = null,
        val rankedSources: List<StreamSource> = emptyList(),
        val resumeMs: Long = 0L,
        /** Item came from a card/progress entry: load its detail (and episode) inside the player. */
        val needsDetail: Boolean = false,
        val resumeSeason: Int = 0,
        val resumeEpisode: Int = 0,
    ) : AppRoute
    data object Search : AppRoute
    data object Plugins : AppRoute
    data class Settings(val initialSection: String = "playback") : AppRoute
    data object Profiles : AppRoute
}

class MainActivity : ComponentActivity() {

    private val pipModeState = mutableStateOf(false)
    private val deepLinkRoute = mutableStateOf<AppRoute?>(null)
    private val pendingPluginInstallUrl = mutableStateOf<String?>(null)
    private val externalToast = mutableStateOf<String?>(null)
    private var vodPlayerActive = false

    private val notifPermLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* optional */ }

    private val exportBackupLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/json"),
    ) { uri ->
        if (uri == null) return@registerForActivityResult
        val app = application as OpenTvApp
        val ok = runCatching {
            contentResolver.openOutputStream(uri)?.use { out ->
                out.write(app.store.exportBackupJson().toByteArray(Charsets.UTF_8))
            }
            true
        }.getOrDefault(false)
        externalToast.value = if (ok) "Copia de seguridad guardada" else "No se pudo exportar la copia"
    }

    private val importBackupLauncher = registerForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri == null) return@registerForActivityResult
        val app = application as OpenTvApp
        val ok = runCatching {
            val raw = contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }.orEmpty()
            app.store.importBackupJson(raw)
        }.getOrDefault(false)
        externalToast.value = if (ok) "Copia restaurada correctamente" else "Archivo de copia no válido"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)

        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(AndroidColor.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(AndroidColor.TRANSPARENT),
        )

        val app = application as OpenTvApp
        if (app.isTv) {
            hideSystemBars(true)
        }

        RustServiceBridge.onDownloadStart = {
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                runOnUiThread { notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) }
            }
        }

        handleIncomingIntent(intent)

        setContent {
            val persisted by app.store.state.collectAsState()
            val uiConfig = remember(app.isTv, app.isLowSpec, persisted.appearance) {
                OpenTvUiConfig(
                    isTv = app.isTv,
                    isLowSpec = app.isLowSpec || persisted.appearance.liteMode,
                    liteMode = persisted.appearance.liteMode,
                    accent = OpenTvAccents.byId(persisted.appearance.accentId, persisted.appearance.theme == "light"),
                    textLarge = persisted.appearance.textLarge,
                    tvMarginIndex = persisted.appearance.tvMarginIndex,
                    lightTheme = persisted.appearance.theme == "light",
                )
            }
            // Phone status / navigation bar icons follow the theme (dark icons on light).
            LaunchedEffect(uiConfig.lightTheme) {
                val style = if (uiConfig.lightTheme) {
                    SystemBarStyle.light(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT)
                } else {
                    SystemBarStyle.dark(AndroidColor.TRANSPARENT)
                }
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
            }

            OpenTvTheme(config = uiConfig) {
                val cfg = LocalConfiguration.current
                val overscanH = (cfg.screenWidthDp * uiConfig.tvOverscanFraction).dp
                val overscanV = (cfg.screenHeightDp * uiConfig.tvOverscanFraction).dp

                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(OpenTvColors.BgCanvas),
                ) {
                    OpenTvRootScreen(
                        overscanH = overscanH,
                        overscanV = overscanV,
                        app = app,
                        persisted = persisted,
                        isInPipMode = pipModeState.value,
                        externalRoute = deepLinkRoute.value,
                        pendingInstallUrl = pendingPluginInstallUrl.value,
                        externalToast = externalToast.value,
                        onConsumeExternalRoute = { deepLinkRoute.value = null },
                        onConsumePendingInstall = { pendingPluginInstallUrl.value = null },
                        onConsumeExternalToast = { externalToast.value = null },
                        onPlayerActiveChanged = { active ->
                            vodPlayerActive = active
                            hideSystemBars(active || app.isTv)
                        },
                        onEnterPip = { tryEnterPip() },
                        onExportBackup = { runCatching { exportBackupLauncher.launch("opentv-backup.json") } },
                        onImportBackup = { runCatching { importBackupLauncher.launch(arrayOf("application/json", "*/*")) } },
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIncomingIntent(intent)
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (vodPlayerActive && !(application as OpenTvApp).isTv) {
            tryEnterPip()
        }
    }

    override fun onStop() {
        super.onStop()
        // Home button / app switch: never keep audio playing in the background (PiP excepted).
        if (!pipModeState.value) (application as OpenTvApp).player.pause()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        pipModeState.value = isInPictureInPictureMode
    }

    private fun tryEnterPip() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        if (!packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) return
        runCatching {
            val params = PictureInPictureParams.Builder()
                .setAspectRatio(Rational(16, 9))
                .build()
            enterPictureInPictureMode(params)
        }
    }

    private fun hideSystemBars(hide: Boolean) {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (hide) {
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun handleIncomingIntent(intent: Intent?) {
        if (intent == null) return
        if (intent.getBooleanExtra(DownloadsForegroundService.EXTRA_OPEN_DOWNLOADS, false)) {
            deepLinkRoute.value = AppRoute.Settings("downloads")
            return
        }
        val uri = intent.data ?: return
        if (uri.scheme.equals("stremio", ignoreCase = true)) {
            pendingPluginInstallUrl.value = uri.toString()
            deepLinkRoute.value = AppRoute.Settings("sources")
        }
    }
}

@Composable
private fun OpenTvRootScreen(
    overscanH: androidx.compose.ui.unit.Dp,
    overscanV: androidx.compose.ui.unit.Dp,
    app: OpenTvApp,
    persisted: PersistedAppState,
    isInPipMode: Boolean,
    externalRoute: AppRoute?,
    pendingInstallUrl: String?,
    externalToast: String?,
    onConsumeExternalRoute: () -> Unit,
    onConsumePendingInstall: () -> Unit,
    onConsumeExternalToast: () -> Unit,
    onPlayerActiveChanged: (Boolean) -> Unit,
    onEnterPip: () -> Unit,
    onExportBackup: () -> Unit,
    onImportBackup: () -> Unit,
) {
    val ui = LocalOpenTvUi.current
    val scope = rememberCoroutineScope()

    // v1: with several profiles, "¿Quién está viendo?" comes first on every cold start.
    val backStack = remember {
        if (persisted.profiles.size > 1) mutableStateListOf<AppRoute>(AppRoute.Home, AppRoute.Profiles)
        else mutableStateListOf<AppRoute>(AppRoute.Home)
    }
    val currentRoute = backStack.lastOrNull() ?: AppRoute.Home

    val activeProfile = remember(persisted.profiles, persisted.activeProfileId) {
        persisted.profiles.firstOrNull { it.id == persisted.activeProfileId } ?: persisted.profiles.first()
    }
    val bucket = remember(persisted.profileData, activeProfile.id) {
        persisted.profileData[activeProfile.id] ?: ProfileBucket()
    }

    val visibleTabs = remember(activeProfile.kids) {
        if (activeProfile.kids) listOf(HomeTab.KIDS)
        else listOf(HomeTab.LIVE, HomeTab.HOME, HomeTab.MOVIES, HomeTab.SERIES, HomeTab.KIDS, HomeTab.ANIME)
    }

    var selectedTab by remember(activeProfile.kids) {
        mutableStateOf(if (activeProfile.kids) HomeTab.KIDS else HomeTab.HOME)
    }
    var homeScrolled by remember { mutableStateOf(false) }
    var tvBrowseLabel by remember { mutableStateOf<String?>(null) }
    var liveFullscreen by remember { mutableStateOf(false) }
    var toastMsg by remember { mutableStateOf<String?>(null) }
    var pendingPinProfile by remember { mutableStateOf<UserProfile?>(null) }

    // TV Home state: saveable per section (scroll restore after Detail), focus memory and rail focus.
    val homeSaveable = rememberSaveableStateHolder()
    // Buscar keeps its query and results while a ficha opened from it is on top (Back returns to
    // the same results); the state is dropped once Buscar leaves the stack.
    val searchSaveable = rememberSaveableStateHolder()
    val homeFocusMemory = remember { HomeFocusMemory() }
    val railFocus = remember { FocusRequester() }
    val homeContentFocus = remember { FocusRequester() }
    val topBarSearchFocus = remember { FocusRequester() }
    var exitConfirm by remember { mutableStateOf(false) }
    var homeHasFocus by remember { mutableStateOf(false) }
    var railFocused by remember { mutableStateOf(false) }
    var initialHomeFocusPending by remember { mutableStateOf(true) }

    // v1 boot splash: min 1.1 s, max 8 s, fades out once Home content is ready.
    var homeReady by remember { mutableStateOf(false) }
    var bootVisible by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        delay(1_100L)
        val start = System.currentTimeMillis()
        while (!homeReady && System.currentTimeMillis() - start < 6_900L) delay(100L)
        bootVisible = false
    }

    fun switchTab(tab: HomeTab) {
        if (tab == selectedTab) return
        homeSaveable.removeState("home_${selectedTab.id}")
        homeFocusMemory.key = null
        homeFocusMemory.focus.clear()
        selectedTab = tab
        tvBrowseLabel = null
        homeScrolled = false
    }

    fun showToast(msg: String) {
        toastMsg = msg
    }

    LaunchedEffect(externalToast) {
        if (externalToast != null) {
            showToast(externalToast)
            onConsumeExternalToast()
        }
    }

    LaunchedEffect(toastMsg) {
        if (toastMsg != null) {
            delay(2800L)
            toastMsg = null
        }
    }

    LaunchedEffect(externalRoute) {
        if (externalRoute != null) {
            backStack.add(externalRoute)
            onConsumeExternalRoute()
        }
    }

    // The rail is disposed when Home is covered, so its focus flag can't be trusted afterwards.
    // Back on Home (TV) from Ajustes/Buscar/Detalle: if no card took the focus back, park it on
    // the active rail entry instead of leaving the screen with no focus at all.
    LaunchedEffect(currentRoute) {
        // Home's focus flag is stale once Home leaves the composition.
        if (currentRoute != AppRoute.Home) homeHasFocus = false
        if (ui.isTv && currentRoute == AppRoute.Home && !initialHomeFocusPending) {
            delay(400L)
            if (!homeHasFocus && !exitConfirm) runCatching { railFocus.requestFocus() }
        }
    }
    LaunchedEffect(currentRoute) { if (currentRoute != AppRoute.Home) railFocused = false }

    // Start the first catalog section right away, while the splash / "¿Quién está viendo?"
    // is on screen (Home itself is not composed until a profile is picked).
    LaunchedEffect(activeProfile.kids) {
        app.catalogs.ensureLoaded(if (activeProfile.kids) HomeTab.KIDS.id else HomeTab.HOME.id, persisted.plugins)
    }

    LaunchedEffect(
        persisted.playback.preferredAudioLang,
        persisted.playback.subtitleStyle.preferredLang,
        persisted.playback.subtitlesEnabled,
    ) {
        app.player.setLanguagePreferences(
            audio = persisted.playback.preferredAudioLang,
            text = persisted.playback.subtitleStyle.preferredLang.takeIf { persisted.playback.subtitlesEnabled },
        )
    }

    LaunchedEffect(currentRoute, liveFullscreen) {
        onPlayerActiveChanged(currentRoute is AppRoute.VodPlayer || liveFullscreen)
    }

    fun push(route: AppRoute) {
        // v1: Plugins lives inside Ajustes, never as a separate screen.
        backStack.add(if (route == AppRoute.Plugins) AppRoute.Settings("sources") else route)
    }

    fun pop() {
        if (backStack.size > 1) backStack.removeAt(backStack.lastIndex)
    }

    val searchInStack = AppRoute.Search in backStack
    LaunchedEffect(searchInStack) {
        if (!searchInStack) searchSaveable.removeState("search")
    }

    /** Switches profile, enforcing 4-digit parental PIN when leaving Kids mode if locked. */
    fun requestSwitchProfile(target: UserProfile, onDone: () -> Unit = {}) {
        val needsPin = activeProfile.kids && !target.kids && persisted.parentalLocked && persisted.parentalPin.length == 4
        if (needsPin) {
            pendingPinProfile = target
        } else {
            app.store.selectProfile(target.id)
            onDone()
        }
    }

    /**
     * Opens the player right away; detail, episode and source search happen inside it
     * (owner rule: no loading outside the player). [useProgress] = resume saved progress.
     */
    fun openPlayer(
        item: MediaItem,
        episode: Episode? = null,
        episodes: List<Episode> = emptyList(),
        source: StreamSource? = null,
        ranked: List<StreamSource> = emptyList(),
        needsDetail: Boolean = false,
        useProgress: Boolean = true,
    ) {
        if (!app.store.hasSourcePlugins()) {
            showToast("Agrega un plugin de fuentes en Ajustes → Plugins para reproducir")
            if (currentRoute !is AppRoute.Detail) push(AppRoute.Detail(item))
            return
        }
        if (currentRoute is AppRoute.VodPlayer) return
        val entry = if (!useProgress) null else bucket.watchProgress.firstOrNull {
            it.itemId == item.id && !it.isFinished &&
                (episode == null || (it.season == episode.season && it.episode == episode.number))
        }
        push(
            AppRoute.VodPlayer(
                item = item,
                episode = episode,
                allEpisodes = episodes,
                source = source,
                rankedSources = ranked,
                resumeMs = entry?.positionMs ?: 0L,
                needsDetail = needsDetail,
                resumeSeason = entry?.season ?: 0,
                resumeEpisode = entry?.episode ?: 0,
            ),
        )
    }

    /** "Seguir viendo": opens the title's Detail (the Detail button reads "Reanudar"). */
    fun openResumeDetail(entry: WatchProgress) {
        push(
            AppRoute.Detail(
                MediaItem(
                    id = entry.itemId,
                    type = entry.type,
                    title = entry.title,
                    poster = entry.poster,
                    backdrop = entry.backdrop,
                ),
            ),
        )
    }

    BackHandler(enabled = backStack.size > 1) { pop() }
    // TV Home: content → rail → Inicio → exit (disabled handler lets the system close the app).
    // TV Home: content → rail (active section) → Inicio → exit confirmation.
    BackHandler(enabled = ui.isTv && backStack.size == 1 && !liveFullscreen && !exitConfirm) {
        when {
            !railFocused -> runCatching { railFocus.requestFocus() }
            selectedTab != HomeTab.HOME && !activeProfile.kids -> {
                switchTab(HomeTab.HOME)
                scope.launch {
                    delay(32L)
                    runCatching { railFocus.requestFocus() }
                }
            }
            else -> exitConfirm = true
        }
    }

    Box(Modifier.fillMaxSize()) {
      Box(
          Modifier
              .fillMaxSize()
              .then(
                  if (currentRoute is AppRoute.VodPlayer || currentRoute == AppRoute.Home) Modifier
                  else Modifier.padding(horizontal = overscanH, vertical = overscanV),
              ),
      ) {
        when (val route = currentRoute) {
            AppRoute.Home -> {
                Box(
                    Modifier
                        .fillMaxSize()
                        .onFocusChanged { homeHasFocus = it.hasFocus }
                        .padding(horizontal = if (liveFullscreen) 0.dp else overscanH, vertical = if (liveFullscreen) 0.dp else overscanV),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            // Requesting focus on this group focuses its first focusable child.
                            .focusRequester(homeContentFocus)
                            .padding(
                                start = when {
                                    !ui.isTv || liveFullscreen -> 0.dp
                                    selectedTab == HomeTab.LIVE && !activeProfile.kids -> 120.dp
                                    else -> 0.dp
                                },
                            ),
                    ) {
                        if (selectedTab == HomeTab.LIVE && !activeProfile.kids) {
                            LaunchedEffect(Unit) { homeReady = true }
                            LiveTvScreen(
                                liveRepo = app.liveRepo,
                                player = app.player,
                                playlists = persisted.m3uPlaylists,
                                favoriteUrls = bucket.favoriteChannelUrls,
                                recentChannels = bucket.recentChannels,
                                onToggleFavorite = { url ->
                                    val added = app.store.toggleFavoriteChannel(url)
                                    showToast(if (added) "Canal agregado a favoritos" else "Canal quitado de favoritos")
                                },
                                onRecordRecent = { app.store.recordRecentChannel(it) },
                                onOpenPlugins = { push(AppRoute.Settings("sources")) },
                                onFullscreenChanged = { liveFullscreen = it },
                                canTakeFocus = { !railFocused },
                            )
                        } else if (ui.isTv) {
                            homeSaveable.SaveableStateProvider("home_${selectedTab.id}") {
                                TvHomeCatalog(
                                    tab = selectedTab,
                                    stremio = app.stremio,
                                    catalogs = app.catalogs,
                                    plugins = persisted.plugins,
                                    continueWatching = bucket.watchProgress,
                                    isInMyList = { id -> bucket.myList.any { it.id == id } },
                                    onScrolledChanged = { homeScrolled = it },
                                    // Hero "Reproducir" never resumed: it keeps starting the title.
                                    onPlayItem = { openPlayer(it, needsDetail = true, useProgress = false) },
                                    onResumeEntry = { entry -> openResumeDetail(entry) },
                                    onOpenDetail = { push(AppRoute.Detail(it)) },
                                    onToggleMyList = { item ->
                                        val added = app.store.toggleMyList(item)
                                        showToast(if (added) "Agregado a Mi lista" else "Quitado de Mi lista")
                                    },
                                    focusMemory = homeFocusMemory,
                                    requestInitialFocus = initialHomeFocusPending,
                                    onInitialFocusConsumed = { initialHomeFocusPending = false },
                                    onContentReady = { homeReady = true },
                                    topBarFocus = topBarSearchFocus,
                                )
                            }
                        } else {
                            LaunchedEffect(Unit) { homeReady = true }
                            HomeCatalogContent(
                                tab = selectedTab,
                                catalogs = app.catalogs,
                                plugins = persisted.plugins,
                                continueWatching = bucket.watchProgress,
                                isInMyList = { id -> bucket.myList.any { it.id == id } },
                                onScrolledChanged = { homeScrolled = it },
                                onPlayItem = { openPlayer(it, needsDetail = true, useProgress = false) },
                                onResumeEntry = { entry -> openResumeDetail(entry) },
                                onOpenDetail = { push(AppRoute.Detail(it)) },
                                onToggleMyList = { item ->
                                    val added = app.store.toggleMyList(item)
                                    showToast(if (added) "Agregado a Mi lista" else "Quitado de Mi lista")
                                },
                            )
                        }
                    }

                    if (ui.isTv && !liveFullscreen) {
                        // Park the first focus on the selected rail item (Inicio) so the
                        // system's default focus never lands on — and auto-selects — "TV en vivo".
                        LaunchedEffect(Unit) {
                            if (initialHomeFocusPending) {
                                delay(32L)
                                runCatching { railFocus.requestFocus() }
                            }
                        }
                        TvTopBar(
                            sectionLabel = tvBrowseLabel ?: selectedTab.label,
                            labelHighlighted = railFocused,
                            scrolled = homeScrolled,
                            activeProfile = activeProfile,
                            onSearch = { push(AppRoute.Search) },
                            onMyList = { push(AppRoute.Settings("history")) },
                            onProfile = { push(AppRoute.Settings("profile")) },
                            // Above the rail: its near-opaque gradient used to hide the logo.
                            modifier = Modifier.align(Alignment.TopCenter).zIndex(1f),
                            searchFocus = topBarSearchFocus,
                        )
                        TvLeftRail(
                            tabs = visibleTabs,
                            selectedTab = selectedTab,
                            onSelectTab = { switchTab(it) },
                            onHoverLabelChange = { tvBrowseLabel = it },
                            selectedFocusRequester = railFocus,
                            onRailFocusChanged = { railFocused = it },
                            rightFocus = {
                                // Live picks its target geometrically (its rows come and go with the keyboard).
                                if (selectedTab == HomeTab.LIVE) null
                                else homeFocusMemory.focus.target(homeContentFocus)
                            },
                            modifier = Modifier.align(Alignment.CenterStart),
                        )
                    } else if (!liveFullscreen) {
                        OpenTvTopBar(
                            tabs = visibleTabs,
                            selectedTab = selectedTab,
                            tvBrowseLabel = tvBrowseLabel,
                            scrolled = homeScrolled,
                            activeProfile = activeProfile,
                            onSelectTab = { switchTab(it) },
                            onSearch = { push(AppRoute.Search) },
                            onMyList = { push(AppRoute.Settings("history")) },
                            onSettings = { push(AppRoute.Settings("playback")) },
                            onProfile = { push(AppRoute.Profiles) },
                            modifier = Modifier.align(Alignment.TopCenter),
                        )
                    }
                }
            }

            is AppRoute.Detail -> {
                DetailScreen(
                    initialItem = route.item,
                    stremio = app.stremio,
                    jsPlugins = app.jsPlugins,
                    plugins = persisted.plugins,
                    hasSourcePlugins = app.store.hasSourcePlugins(),
                    sourcePrefs = persisted.sourcePrefs,
                    mediaCaps = app.mediaCaps,
                    inMyList = bucket.myList.any { it.id == route.item.id },
                    watchProgress = bucket.watchProgress,
                    onBack = { pop() },
                    onToggleMyList = { item ->
                        val added = app.store.toggleMyList(item)
                        showToast(if (added) "Agregado a Mi lista" else "Quitado de Mi lista")
                    },
                    isFavorite = bucket.favorites.any { it.id == route.item.id },
                    onToggleFavorite = { item ->
                        val added = app.store.toggleFavorite(item)
                        showToast(if (added) "Se añadió a favoritos" else "Se quitó de favoritos")
                    },
                    playbackPrefs = persisted.playback,
                    onUpdatePlayback = { app.store.updatePlayback(it) },
                    onOpenPlugins = { push(AppRoute.Settings("sources")) },
                    onOpenRelated = { push(AppRoute.Detail(it)) },
                    onPlayStream = { req ->
                        openPlayer(
                            item = req.item,
                            episode = req.episode,
                            episodes = req.episodes,
                            source = req.source,
                            ranked = req.ranked,
                            needsDetail = !req.detailReady,
                            useProgress = !req.fromStart,
                        )
                    },
                    onShowToast = ::showToast,
                )
            }

            // The player stays dark in every theme.
            is AppRoute.VodPlayer -> OpenTvForceDark { if (route.needsDetail) {
                // Card / hero play: full metadata (year, original title for JS plugins) and the
                // episode to play are resolved here, already on the player's loading screen.
                LaunchedEffect(route) {
                    val detail = app.stremio.loadDetail(route.item, preferSeason = route.resumeSeason)
                    val ep = if (detail.item.isSeries) {
                        detail.episodes.firstOrNull { it.season == route.resumeSeason && it.number == route.resumeEpisode }
                            ?: detail.episodes.firstOrNull()
                    } else null
                    val idx = backStack.indexOf(route)
                    if (idx >= 0) {
                        backStack[idx] = route.copy(
                            item = detail.item,
                            episode = ep,
                            allEpisodes = detail.episodes,
                            resumeMs = if (ep != null && (ep.season != route.resumeSeason || ep.number != route.resumeEpisode)) 0L else route.resumeMs,
                            needsDetail = false,
                        )
                    }
                }
                PlayerPreparingScreen(route.item)
            } else {
                val nextEp = remember(route.episode, route.allEpisodes) {
                    val cur = route.episode ?: return@remember null
                    val idx = route.allEpisodes.indexOfFirst { it.season == cur.season && it.number == cur.number }
                    if (idx >= 0 && idx + 1 < route.allEpisodes.size) route.allEpisodes[idx + 1] else null
                }
                val preloadedNext = remember(route.item.id) {
                    mutableStateOf<Pair<String, List<StreamSource>>?>(null)
                }
                var preloadingEpId by remember(route.item.id) { mutableStateOf("") }
                VodPlayerScreen(
                    player = app.player,
                    stremio = app.stremio,
                    jsPlugins = app.jsPlugins,
                    plugins = persisted.plugins,
                    playbackPrefs = persisted.playback,
                    sourcePrefs = persisted.sourcePrefs,
                    mediaCaps = app.mediaCaps,
                    isLowMemory = ui.isLowSpec,
                    item = route.item,
                    episode = route.episode,
                    allEpisodes = route.allEpisodes,
                    nextEpisode = nextEp,
                    initialSource = route.source,
                    offlineUrl = route.offlineUrl,
                    rankedSources = route.rankedSources,
                    initialResumeMs = route.resumeMs,
                    isInPipMode = isInPipMode,
                    onEnterPip = onEnterPip,
                    onSaveProgress = { if (!it.itemId.startsWith("local:")) app.store.saveWatchProgress(it) },
                    onSubtitleSize = { sz ->
                        app.store.updatePlayback { p -> p.copy(subtitleStyle = p.subtitleStyle.copy(sizeSp = sz)) }
                    },
                    onPreloadEpisode = { targetEp ->
                        if (preloadingEpId != targetEp.id) {
                            preloadingEpId = targetEp.id
                            scope.launch {
                                val raw = kotlinx.coroutines.withTimeoutOrNull(70_000L) {
                                    app.stremio.fetchStreams(route.item, targetEp, persisted.plugins) +
                                        app.jsPlugins.fetchStreamsForTitle(route.item, targetEp.season, targetEp.number, persisted.plugins)
                                }.orEmpty()
                                val ranked = SourceRanker.rank(raw, persisted.sourcePrefs, app.mediaCaps, isEpisode = true, isLowMemory = ui.isLowSpec)
                                if (ranked.isNotEmpty()) {
                                    preloadedNext.value = targetEp.id to ranked
                                }
                            }
                        }
                    },
                    onPlayEpisode = { targetEp ->
                        val cached = preloadedNext.value?.takeIf { it.first == targetEp.id }?.second
                        if (!cached.isNullOrEmpty()) {
                            backStack[backStack.lastIndex] = route.copy(
                                episode = targetEp,
                                source = cached.first(),
                                offlineUrl = null,
                                rankedSources = cached,
                                resumeMs = 0L,
                            )
                        } else {
                            // The player searches the episode's sources on its loading screen.
                            backStack[backStack.lastIndex] = route.copy(
                                episode = targetEp,
                                source = null,
                                offlineUrl = null,
                                rankedSources = emptyList(),
                                resumeMs = 0L,
                            )
                        }
                    },
                    onBack = { pop() },
                )
            } }

            AppRoute.Search -> searchSaveable.SaveableStateProvider("search") {
                SearchScreen(
                    stremio = app.stremio,
                    plugins = persisted.plugins,
                    recentSearches = bucket.recentSearches,
                    kidsOnly = activeProfile.kids,
                    onAddRecent = { app.store.addRecentSearch(it) },
                    onClearRecent = { app.store.clearRecentSearches() },
                    onOpenDetail = { push(AppRoute.Detail(it)) },
                    onBack = { pop() },
                )
            }

            AppRoute.Plugins -> {
                PluginsScreen(
                    stremio = app.stremio,
                    installedPlugins = persisted.plugins,
                    m3uPlaylists = persisted.m3uPlaylists,
                    sourcePrefs = persisted.sourcePrefs,
                    pendingInstallUrl = pendingInstallUrl,
                    onConsumePendingInstall = onConsumePendingInstall,
                    onInstallPlugin = { app.store.upsertPlugin(it) },
                    onRemovePlugin = { app.store.removePlugin(it) },
                    onSetAllowLan = { url, allow -> app.store.setPluginAllowLan(url, allow) },
                    onAddM3u = { app.store.addM3uPlaylist(it) },
                    onRemoveM3u = { app.store.removeM3uPlaylist(it) },
                    onUpdateSourcePrefs = { app.store.updateSourcePrefs(it) },
                    onShowToast = ::showToast,
                    onBack = { pop() },
                    onSetPluginDisabled = { u, d -> app.store.setPluginDisabled(u, d) },
                    onMovePlugin = { u, delta -> app.store.movePlugin(u, delta) },
                )
            }

            is AppRoute.Settings -> {
                SettingsScreen(
                    initialSection = route.initialSection,
                    appState = persisted,
                    activeProfile = activeProfile,
                    bucket = bucket,
                    onSelectProfile = { targetId ->
                        persisted.profiles.firstOrNull { it.id == targetId }?.let { requestSwitchProfile(it) }
                    },
                    onOpenPlugins = { push(AppRoute.Plugins) },
                    onOpenDetail = { push(AppRoute.Detail(it)) },
                    onPlayOfflineDownload = { dl, localUrl ->
                        push(
                            AppRoute.VodPlayer(
                                item = MediaItem(id = dl.id, title = dl.title, poster = dl.poster),
                                episode = null,
                                allEpisodes = emptyList(),
                                source = null,
                                offlineUrl = localUrl,
                            ),
                        )
                    },
                    onExportBackup = onExportBackup,
                    onImportBackup = onImportBackup,
                    onClearHistory = { app.store.clearHistory() },
                    onUpdateAppearance = { app.store.updateAppearance(it) },
                    onUpdatePlayback = { app.store.updatePlayback(it) },
                    onSaveParental = { pin, locked -> app.store.setParentalPin(pin, locked) },
                    onShowToast = ::showToast,
                    onBack = { pop() },
                    stremio = app.stremio,
                    installedPlugins = persisted.plugins,
                    m3uPlaylists = persisted.m3uPlaylists,
                    sourcePrefs = persisted.sourcePrefs,
                    pendingInstallUrl = pendingInstallUrl,
                    onConsumePendingInstall = onConsumePendingInstall,
                    onInstallPlugin = { app.store.upsertPlugin(it) },
                    onRemovePlugin = { app.store.removePlugin(it) },
                    onSetAllowLan = { u, a -> app.store.setPluginAllowLan(u, a) },
                    onAddM3u = { app.store.addM3uPlaylist(it) },
                    onRemoveM3u = { app.store.removeM3uPlaylist(it) },
                    onUpdateSourcePrefs = { app.store.updateSourcePrefs(it) },
                    onSetPluginDisabled = { u, d -> app.store.setPluginDisabled(u, d) },
                    onMovePlugin = { u, delta -> app.store.movePlugin(u, delta) },
                    onOpenProfilePicker = { push(AppRoute.Profiles) },
                    onRemoveFromMyList = { app.store.toggleMyList(it) },
                    onRemoveFavorite = { app.store.toggleFavorite(it) },
                    onClearCache = {
                        val loader = coil3.SingletonImageLoader.get(app)
                        loader.memoryCache?.clear()
                        scope.launch(kotlinx.coroutines.Dispatchers.IO) { runCatching { loader.diskCache?.clear() } }
                        app.catalogs.clearDiskCache()
                    },
                    onPlayLocalVideo = { uri, title ->
                        push(
                            AppRoute.VodPlayer(
                                item = MediaItem(id = "local:$uri", title = title),
                                episode = null,
                                allEpisodes = emptyList(),
                                source = null,
                                offlineUrl = uri,
                            ),
                        )
                    },
                )
            }

            AppRoute.Profiles -> {
                LaunchedEffect(Unit) { homeReady = true } // let the boot splash fade over the picker
                ProfilePickerScreen(
                    profiles = persisted.profiles,
                    activeId = activeProfile.id,
                    onPick = { p ->
                        requestSwitchProfile(p) { pop() }
                    },
                    onAddProfile = { name, kids, avatar ->
                        app.store.addProfile(name, kids, avatar)
                        showToast("Perfil \"$name\" creado")
                    },
                    onBack = { pop() },
                    onUpdateProfile = { id, name, kids, avatar ->
                        app.store.updateProfile(id, name = name, kids = kids, avatarIndex = avatar)
                        showToast("Perfil actualizado")
                    },
                    onDeleteProfile = { id ->
                        app.store.removeProfile(id)
                        showToast("Perfil eliminado")
                    },
                )
            }
        }

      }

        if (exitConfirm) {
            val activity = androidx.compose.ui.platform.LocalContext.current as? android.app.Activity
            ExitConfirmDialog(
                onExit = {
                    exitConfirm = false
                    activity?.finish()
                },
                onDismiss = {
                    exitConfirm = false
                    scope.launch {
                        delay(32L)
                        runCatching { railFocus.requestFocus() }
                    }
                },
            )
        }

        // Parental PIN Gate Dialog when leaving Kids mode
        pendingPinProfile?.let { target ->
            if (ui.isTv) {
                // Remote-friendly keypad (no system keyboard on Fire TV remotes).
                com.techpoint.opentv.ui.components.TvPinDialog(
                    title = "PIN parental requerido",
                    subtitle = "Ingresa tu PIN de 4 dígitos para salir del perfil Kids.",
                    onDismiss = { pendingPinProfile = null },
                    onComplete = { pin ->
                        if (pin != persisted.parentalPin) return@TvPinDialog false
                        pendingPinProfile = null
                        app.store.selectProfile(target.id)
                        if (currentRoute == AppRoute.Profiles) pop()
                        true
                    },
                )
                return@let
            }
            ParentalPinDialog(
                expectedPin = persisted.parentalPin,
                onUnlocked = {
                    pendingPinProfile = null
                    app.store.selectProfile(target.id)
                    if (currentRoute == AppRoute.Profiles) pop()
                },
                onDismiss = { pendingPinProfile = null },
            )
        }

        AnimatedVisibility(
            visible = bootVisible,
            enter = fadeIn(),
            exit = fadeOut(animationSpec = tween(500)),
        ) {
            BootSplash()
        }

        // Mandatory version gate: checks GitHub Releases automatically on launch & every 4 hours.
        // Once a newer release is seen it is persisted in AppStore so old versions cannot be used.
        suspend fun runMandatoryUpdateCheck(force: Boolean = false) {
            val res = RustServiceBridge.callRpc(
                "appUpdate",
                buildJsonObject {
                    put("action", "check")
                    put("force", force)
                },
            )
            val latest = (res["latest"] as? JsonPrimitive)?.contentOrNull.orEmpty()
            val notes = (res["notes"] as? JsonPrimitive)?.contentOrNull.orEmpty()
            val mandatory = (res["mandatory"] as? JsonPrimitive)?.booleanOrNull == true ||
                (res["available"] as? JsonPrimitive)?.booleanOrNull == true
            if (mandatory && AppUpdatePolicy.isOutdated(BuildConfig.VERSION_NAME, latest)) {
                app.store.setRequiredLatestVersion(latest, notes)
            }
        }

        LaunchedEffect(Unit) {
            delay(1_800L)
            while (true) {
                runMandatoryUpdateCheck(force = false)
                delay(4 * 60 * 60 * 1_000L)
            }
        }

        val mandatoryVersion = persisted.requiredLatestVersion
            .takeIf { AppUpdatePolicy.isOutdated(BuildConfig.VERSION_NAME, it) }
        LaunchedEffect(mandatoryVersion) {
            if (mandatoryVersion != null) {
                app.player.pause()
            }
        }
        if (mandatoryVersion != null) {
            ForceUpdateOverlay(
                latestVersion = mandatoryVersion,
                releaseNotes = persisted.requiredLatestNotes,
                onRecheck = { runMandatoryUpdateCheck(force = true) },
            )
        }

        // OpenTV floating toast banner
        AnimatedVisibility(
            visible = toastMsg != null,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 28.dp, start = 20.dp, end = 20.dp),
        ) {
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color(0xEB14141A))
                    .border(1.dp, OpenTvColors.GlassBorderStrong, RoundedCornerShape(12.dp))
                    .padding(horizontal = 18.dp, vertical = 10.dp),
            ) {
                Text(
                    text = toastMsg.orEmpty(),
                    color = Color.White,
                    fontSize = 13.5.sp,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

/** TV exit confirmation (BACK on Inicio with the rail focused). Focus starts on "Cancelar". */
@Composable
private fun ExitConfirmDialog(onExit: () -> Unit, onDismiss: () -> Unit) {
    val ui = LocalOpenTvUi.current
    val cancelFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        delay(48L)
        runCatching { cancelFocus.requestFocus() }
    }
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            color = if (OpenTvColors.isLight) OpenTvColors.Sheet else Color(0xFF16161B),
            shape = RoundedCornerShape(20.dp),
            border = BorderStroke(1.dp, OpenTvColors.GlassBorderStrong),
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
                modifier = Modifier.padding(horizontal = 30.dp, vertical = 26.dp),
            ) {
                Text(
                    "¿Salir de OpenTV?",
                    color = OpenTvColors.Content,
                    fontSize = (22f * ui.textScale).sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    "Puedes volver cuando quieras; tu progreso queda guardado.",
                    color = OpenTvColors.TextSecondary,
                    fontSize = (14f * ui.textScale).sp,
                )
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OpenTvGlassButton("Cancelar", onClick = onDismiss, modifier = Modifier.focusRequester(cancelFocus))
                    // Both glass: with the white accent a primary button looks focused all the time.
                    OpenTvGlassButton("Salir", onClick = onExit)
                }
            }
        }
    }
}

@Composable
private fun ParentalPinDialog(
    expectedPin: String,
    onUnlocked: () -> Unit,
    onDismiss: () -> Unit,
) {
    val ui = LocalOpenTvUi.current
    var entered by remember { mutableStateOf("") }
    var wrong by remember { mutableStateOf(false) }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            color = OpenTvColors.Ink900,
            shape = RoundedCornerShape(18.dp),
            border = BorderStroke(1.dp, OpenTvColors.GlassBorderStrong),
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
                modifier = Modifier.padding(22.dp),
            ) {
                Text("PIN parental requerido", style = MaterialTheme.typography.titleLarge)
                Text("Ingresa tu PIN de 4 dígitos para salir del perfil Kids.", style = MaterialTheme.typography.bodyMedium)
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .width(160.dp)
                        .height(46.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(OpenTvColors.GlassFill)
                        .border(1.5.dp, if (wrong) OpenTvColors.ErrorRed else OpenTvColors.GlassBorderStrong, RoundedCornerShape(12.dp))
                        .padding(horizontal = 14.dp),
                ) {
                    if (entered.isEmpty()) Text("••••", color = OpenTvColors.TextMuted, fontSize = 18.sp, letterSpacing = 6.sp)
                    BasicTextField(
                        value = entered,
                        onValueChange = { v ->
                            wrong = false
                            entered = v.filter(Char::isDigit).take(4)
                            if (entered.length == 4) {
                                if (entered == expectedPin) onUnlocked()
                                else {
                                    wrong = true
                                    entered = ""
                                }
                            }
                        },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        textStyle = TextStyle(color = OpenTvColors.Content, fontSize = 18.sp, letterSpacing = 6.sp),
                        cursorBrush = SolidColor(ui.accent.color),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (wrong) {
                    Text("PIN incorrecto", color = OpenTvColors.ErrorRed, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OpenTvGlassButton("Cancelar", onClick = onDismiss)
                    OpenTvPrimaryButton("Confirmar", onClick = {
                        if (entered == expectedPin) onUnlocked() else wrong = true
                    })
                }
            }
        }
    }
}
