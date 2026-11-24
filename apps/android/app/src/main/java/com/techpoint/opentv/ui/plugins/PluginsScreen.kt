package com.techpoint.opentv.ui.plugins

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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.PowerOff
import androidx.compose.material.icons.rounded.PowerSettingsNew
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.techpoint.opentv.core.addons.PluginCatalogs
import com.techpoint.opentv.core.addons.PluginInspectResult
import com.techpoint.opentv.core.addons.StremioClient
import com.techpoint.opentv.service.RustServiceBridge
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import com.techpoint.opentv.core.model.CommunityPlugin
import com.techpoint.opentv.core.model.InstalledPlugin
import com.techpoint.opentv.core.model.M3uPlaylist
import com.techpoint.opentv.core.model.SourcePrefs
import com.techpoint.opentv.ui.components.OpenTvRoundIconButton
import com.techpoint.opentv.ui.settings.SetButton
import com.techpoint.opentv.ui.settings.SetColors
import com.techpoint.opentv.ui.settings.SetPanelTitle
import com.techpoint.opentv.ui.settings.SetSegButton
import com.techpoint.opentv.ui.settings.SetSubTabs
import com.techpoint.opentv.ui.settings.SetTextField
import com.techpoint.opentv.ui.settings.tsp
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import com.techpoint.opentv.ui.theme.OpenTvColors
import kotlinx.coroutines.launch
import java.text.Normalizer

/**
 * Legacy route kept for phones / backwards compatibility: it only wraps [PluginsPanel].
 * On TV the panel lives inside Ajustes ("Plugins" entry, section id "sources").
 */
@Composable
fun PluginsScreen(
    stremio: StremioClient,
    installedPlugins: List<InstalledPlugin>,
    m3uPlaylists: List<M3uPlaylist>,
    sourcePrefs: SourcePrefs,
    pendingInstallUrl: String? = null,
    onConsumePendingInstall: () -> Unit = {},
    onInstallPlugin: (InstalledPlugin) -> Unit,
    onRemovePlugin: (String) -> Unit,
    onSetAllowLan: (String, Boolean) -> Unit,
    onAddM3u: (M3uPlaylist) -> Unit,
    onRemoveM3u: (String) -> Unit,
    onUpdateSourcePrefs: ((SourcePrefs) -> SourcePrefs) -> Unit,
    onShowToast: (String) -> Unit,
    onBack: () -> Unit,
    onSetPluginDisabled: ((String, Boolean) -> Unit)? = null,
    onMovePlugin: ((String, Int) -> Unit)? = null,
) {
    val ui = LocalOpenTvUi.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(OpenTvColors.BgCanvas)
            .then(if (ui.isTv) Modifier else Modifier.statusBarsPadding()),
    ) {
        if (!ui.isTv) {
            Row(Modifier.padding(start = 16.dp, top = 10.dp)) {
                OpenTvRoundIconButton(Icons.AutoMirrored.Rounded.ArrowBack, "Volver", onBack, size = 40.dp)
            }
        }
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
            contentPadding = if (ui.isTv) {
                PaddingValues(start = 40.dp, top = 52.dp, end = 55.dp, bottom = 40.dp)
            } else {
                PaddingValues(start = 16.dp, top = 10.dp, end = 16.dp, bottom = 28.dp)
            },
            pendingInstallUrl = pendingInstallUrl,
            onConsumePendingInstall = onConsumePendingInstall,
            onSetPluginDisabled = onSetPluginDisabled,
            onMovePlugin = onMovePlugin,
        )
    }
}

private class CommunitySub(val id: String, val title: String, val items: List<CommunityPlugin>)

private class CommunityGroup(val id: String, val title: String, val sub: String, val subs: List<CommunitySub>)

private class CommunitySectionDef(
    val id: String,
    val title: String,
    val sub: String,
    val match: (CommunityPlugin) -> Boolean,
    val subs: List<Triple<String, String, (CommunityPlugin) -> Boolean>>,
)

private val VodCategories = setOf("directas", "torrents", "catalogos", "subtitulos")

private val TvListCategories = setOf("paises", "noticias", "infantil", "cine", "documentales", "musica")

/** "Películas y series" (VOD plugins) then "TV en vivo" (M3U lists), mirroring "Mis plugins". */
private val CommunitySectionsDef = listOf(
    CommunitySectionDef(
        id = "vod",
        title = "Películas y series",
        sub = "Fuentes, catálogos y subtítulos para películas, series y anime",
        match = { it.kind != "m3u" && it.category in VodCategories },
        subs = listOf(
            Triple("directas", "Fuentes directas", { p: CommunityPlugin -> p.category == "directas" }),
            Triple("torrents", "Torrents", { p: CommunityPlugin -> p.category == "torrents" }),
            Triple("catalogos", "Catálogos y sagas", { p: CommunityPlugin -> p.category == "catalogos" }),
            Triple("subtitulos", "Subtítulos", { p: CommunityPlugin -> p.category == "subtitulos" }),
        ),
    ),
    CommunitySectionDef(
        id = "live",
        title = "TV en vivo",
        sub = "Listas de canales gratis, deportes y TV por país",
        match = { it.kind == "m3u" || it.category !in VodCategories },
        subs = listOf(
            Triple("gratis", "Televisión gratis", { p: CommunityPlugin -> p.category == "gratis" }),
            Triple("deportes", "Deportes en vivo", { p: CommunityPlugin -> p.category == "deportes" }),
            Triple("paises", "TV por país y temática", { p: CommunityPlugin -> p.category in TvListCategories }),
            // Safety net: any other live category still gets a home.
            Triple("otros", "Otras listas", { p: CommunityPlugin -> p.category !in TvListCategories && p.category != "gratis" && p.category != "deportes" }),
        ),
    ),
)

private fun norm(s: String): String =
    Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "")

/**
 * v1 Plugins panel (`screens/plugins.js`, `11-fuentes-stremio.css`) as one lazy grid:
 * title, pill tabs "Mis plugins" / "Comunidad", "Agregar plugin" and card grids.
 * OK on an installed card opens "Configurar"; OK on a community card adds it.
 * Built-in plugins (Cinemeta, Anime Kitsu, OpenSubtitles v3) say "Incluido" and cannot be removed.
 * Nothing here opens a browser, a WebView or another Activity.
 */
@Composable
fun PluginsPanel(
    stremio: StremioClient,
    installedPlugins: List<InstalledPlugin>,
    m3uPlaylists: List<M3uPlaylist>,
    sourcePrefs: SourcePrefs,
    onInstallPlugin: (InstalledPlugin) -> Unit,
    onRemovePlugin: (String) -> Unit,
    onSetAllowLan: (String, Boolean) -> Unit,
    onAddM3u: (M3uPlaylist) -> Unit,
    onRemoveM3u: (String) -> Unit,
    onUpdateSourcePrefs: ((SourcePrefs) -> SourcePrefs) -> Unit,
    onShowToast: (String) -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    pendingInstallUrl: String? = null,
    onConsumePendingInstall: () -> Unit = {},
    onSetPluginDisabled: ((String, Boolean) -> Unit)? = null,
    onMovePlugin: ((String, Int) -> Unit)? = null,
) {
    val ui = LocalOpenTvUi.current
    val scope = rememberCoroutineScope()

    var tab by remember { mutableStateOf("mine") } // "mine" | "community"
    var catFilter by remember { mutableStateOf("all") }
    var query by remember { mutableStateOf("") }
    var installDialogOpen by remember { mutableStateOf(false) }
    var pendingConfirmUrl by remember { mutableStateOf<String?>(null) }
    var configPluginUrl by remember { mutableStateOf<String?>(null) }
    var configM3uUrl by remember { mutableStateOf<String?>(null) }
    var busyUrl by remember { mutableStateOf("") }

    fun isPrivateHost(url: String): Boolean = runCatching {
        val host = java.net.URI(url).host?.lowercase().orEmpty()
        host == "localhost" || host.startsWith("127.") || host.startsWith("10.") ||
            host.startsWith("192.168.") || Regex("^172\\.(1[6-9]|2\\d|3[0-1])\\.").containsMatchIn(host) ||
            host.startsWith("169.254.") || host == "::1" || host.endsWith(".local")
    }.getOrDefault(false)
    fun looksLikeM3u(url: String): Boolean =
        Regex("\\.m3u8?(\\?|#|$)", RegexOption.IGNORE_CASE).containsMatchIn(url) ||
            (url.contains("get.php?", true) && url.contains("username=", true))
    fun isShortCode(v: String): Boolean =
        Regex("^\\d{4,9}$").matches(v) || Regex("^![A-Za-z0-9_-]{2,48}$").matches(v) || Regex("^[A-Za-z0-9_-]{4,48}$").matches(v)
    fun looksLikeDirectMedia(v: String): Boolean =
        v.startsWith("magnet:?", true) || Regex("\\.(mp4|mkv|webm|avi|mov|m4v|ts|m3u8)(\\?|#|$)", RegexOption.IGNORE_CASE).containsMatchIn(v)

    fun installFromUrl(raw: String, customName: String = "") {
        val input = raw.trim()
        if (input.isBlank()) return
        busyUrl = input
        onShowToast("Agregando ${customName.ifBlank { "plugin" }}…")
        scope.launch {
            try {
                var clean = input
                if (isShortCode(input) && !input.startsWith("http://") && !input.startsWith("https://")) {
                    val r = RustServiceBridge.callRpc("resolveShortCode", buildJsonObject { put("code", input) })
                    clean = r["url"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                    if (clean.isBlank()) throw IllegalStateException(r["errorText"]?.jsonPrimitive?.contentOrNull ?: "No se pudo resolver el código corto")
                }

                if (looksLikeM3u(clean)) {
                    val allowLan = isPrivateHost(clean)
                    val res = RustServiceBridge.callRpc("fetchM3u", buildJsonObject { put("url", clean); put("allowLan", allowLan) })
                    val channels = res["channels"]?.jsonArray
                    if (channels == null || channels.isEmpty()) {
                        throw IllegalStateException(res["errorText"]?.jsonPrimitive?.contentOrNull ?: "La lista M3U no contiene canales válidos")
                    }
                    val name = customName.ifBlank {
                        if (clean.contains("get.php?", true)) "Cuenta Xtream" else clean.substringAfterLast('/').substringBefore('?').ifBlank { "Lista TV" }
                    }
                    onAddM3u(M3uPlaylist(id = "m3u_${clean.hashCode()}", name = name, url = clean, description = "${channels.size} canales en vivo", allowLan = allowLan))
                    onShowToast("Lista agregada · ${channels.size} canales")
                    return@launch
                }

                if (looksLikeDirectMedia(clean)) {
                    val isMagnet = clean.startsWith("magnet:?", true)
                    val name = customName.ifBlank { if (isMagnet) "Magnet directo" else "Video directo" }
                    onInstallPlugin(
                        InstalledPlugin(
                            id = "direct_${clean.hashCode()}",
                            name = name,
                            url = clean,
                            kind = "stremio",
                            description = if (isMagnet) "Fuente magnet directa" else "Fuente de video directa",
                            hasStream = true,
                            types = listOf("movie", "series"),
                        ),
                    )
                    onShowToast("$name agregado")
                    return@launch
                }

                val inspect = stremio.inspectPlugin(clean)
                var handled = false
                inspect.onSuccess { r ->
                    when (r) {
                        is PluginInspectResult.Plugin -> {
                            onInstallPlugin(r.plugin)
                            onShowToast("Se agregó ${r.plugin.name}")
                            handled = true
                        }
                        is PluginInspectResult.Collection -> {
                            var added = 0
                            for (ad in r.addons) {
                                val sub = stremio.inspectPlugin(ad.url)
                                sub.onSuccess { sr -> if (sr is PluginInspectResult.Plugin) { onInstallPlugin(sr.plugin); added++ } }
                            }
                            if (added == 0) throw IllegalStateException("No se pudo instalar ningún plugin de la colección")
                            onShowToast("Colección “${r.name}”: $added plugins agregados")
                            handled = true
                        }
                    }
                }.onFailure { err ->
                    val canTryM3u = clean.startsWith("http://") || clean.startsWith("https://") || Regex("^[a-z0-9.-]+\\.[a-z]{2,}([/:].*)?$", RegexOption.IGNORE_CASE).matches(clean)
                    if (canTryM3u) {
                        val m3uUrl = if (clean.startsWith("http://") || clean.startsWith("https://")) clean else "https://$clean"
                        val m3uRes = runCatching {
                            RustServiceBridge.callRpc("fetchM3u", buildJsonObject { put("url", m3uUrl); put("allowLan", isPrivateHost(m3uUrl)) })
                        }.getOrNull()
                        val ch = m3uRes?.get("channels")?.jsonArray
                        if (ch != null && ch.isNotEmpty()) {
                            val allowLan = isPrivateHost(m3uUrl)
                            val name = customName.ifBlank { m3uUrl.substringAfterLast('/').substringBefore('?').ifBlank { "Lista TV" } }
                            onAddM3u(M3uPlaylist(id = "m3u_${m3uUrl.hashCode()}", name = name, url = m3uUrl, description = "${ch.size} canales en vivo", allowLan = allowLan))
                            onShowToast("Lista agregada · ${ch.size} canales")
                            handled = true
                        }
                    }
                    if (!handled) throw (err as? Exception ?: IllegalStateException(err.message ?: "No se pudo agregar el plugin"))
                }
                if (!handled) { /* already thrown */ }
            } catch (err: Exception) {
                onShowToast(err.message ?: "No se pudo agregar el plugin")
            } finally {
                busyUrl = ""
            }
        }
    }

    LaunchedEffect(pendingInstallUrl) {
        if (!pendingInstallUrl.isNullOrBlank()) {
            // A `stremio://` link from another app must never install silently.
            // Normalize to HTTPS and ask the user first; plain HTTP is refused.
            val normalized = stremio.normalizeManifestUrl(pendingInstallUrl.trim())
            if (normalized.startsWith("https://", ignoreCase = true)) {
                pendingConfirmUrl = normalized
            } else {
                onShowToast("Solo se permiten enlaces HTTPS para instalar plugins")
            }
            onConsumePendingInstall()
        }
    }

    val plugins = remember(installedPlugins) { installedPlugins.distinctBy { it.url } }
    val builtins = remember(plugins) { plugins.filter { it.builtin } }
    val userPlugins = remember(plugins) { plugins.filterNot { it.builtin } }
    val lists = remember(m3uPlaylists) { m3uPlaylists.distinctBy { it.url } }
    val hasSourcePlugin = plugins.any { !it.disabled && (it.hasStream || it.kind == "kino-js") }

    val catalog = remember(ui.isTv) {
        PluginCatalogs.CommunityCatalog
            .filter { !it.pcOnly }
            .filter { !ui.isTv || it.tvEssential }
            .distinctBy { it.id }
            .sortedBy {
                val r = if (ui.isTv) it.recommendedRankTv else it.recommendedRankPhone
                if (r > 0) r else 999
            }
    }
    fun isRecommended(p: CommunityPlugin): Boolean =
        (if (ui.isTv) p.recommendedRankTv else p.recommendedRankPhone) > 0
    // Search + category chip applied first; the sections below only group what survives.
    val filtered = remember(catalog, catFilter, query) {
        val q = norm(query.trim())
        catalog.filter { p ->
            val catOk = when (catFilter) {
                "all" -> true
                "recomendados" -> isRecommended(p)
                else -> p.category == catFilter
            }
            catOk && (q.isEmpty() || norm(p.name).contains(q) || norm(p.description).contains(q))
        }
    }
    // Same shape as "Mis plugins": a few big sections, each with category sub-groups.
    // Every plugin appears once: recommended ones are not repeated in their category.
    val groups = remember(filtered, catFilter, ui.isTv) {
        val seen = HashSet<String>()
        buildList {
            if (catFilter == "all" || catFilter == "recomendados") {
                val rec = filtered.filter { isRecommended(it) && seen.add(it.url) }
                if (rec.isNotEmpty()) {
                    add(
                        CommunityGroup(
                            id = "recomendados",
                            title = if (ui.isTv) "Recomendados para tu TV" else "Recomendados para tu celular",
                            sub = "Los mejores plugins seleccionados para este aparato",
                            subs = listOf(CommunitySub("recomendados", "", rec)),
                        ),
                    )
                }
            }
            for (sec in CommunitySectionsDef) {
                val subs = sec.subs.mapNotNull { (subId, subTitle, match) ->
                    val list = filtered.filter { sec.match(it) && match(it) && seen.add(it.url) }
                    if (list.isEmpty()) null else CommunitySub(subId, subTitle, list)
                }
                if (subs.isNotEmpty()) add(CommunityGroup(sec.id, sec.title, sec.sub, subs))
            }
        }
    }
    val isFiltering = query.isNotBlank() || catFilter != "all"
    // Hide chips that would always show an empty list on this device (e.g. TV-only catalog).
    val chipCategories = remember(catalog) {
        PluginCatalogs.PluginCategories.filter { (id, _) ->
            id == "all" || catalog.any { if (id == "recomendados") isRecommended(it) else it.category == id }
        }
    }

    fun isInstalled(item: CommunityPlugin): Boolean =
        if (item.kind == "m3u") {
            lists.any { it.url.equals(item.url, ignoreCase = true) }
        } else {
            val base = PluginCatalogs.stremioBaseFromUrl(item.url)
            plugins.any { PluginCatalogs.stremioBaseFromUrl(it.url) == base }
        }

    fun addCommunity(item: CommunityPlugin) {
        if (isInstalled(item) || busyUrl == item.url) return
        if (item.kind == "m3u") {
            onAddM3u(M3uPlaylist(item.id, item.name, item.url, item.description))
            onShowToast("Se agregó ${item.name}")
        } else {
            installFromUrl(item.url, item.name)
        }
    }

    @Composable
    fun CommunityCard(item: CommunityPlugin) {
        val installed = isInstalled(item)
        val installing = busyUrl == item.url
        val catLabel = PluginCatalogs.PluginCategories.firstOrNull { it.first == item.category }?.second.orEmpty()
        PlCard(
            name = item.name,
            meta = listOf(
                if (item.kind == "m3u") "TV en vivo" else "Películas y series",
                catLabel,
                when {
                    installed -> "Agregado"
                    installing -> "Agregando…"
                    else -> ""
                },
            ).filter { it.isNotBlank() }.joinToString(" · "),
            description = item.description,
            icon = {
                PluginIcon(
                    id = item.id,
                    name = item.name,
                    url = item.url,
                    logo = item.logo,
                    kind = item.kind,
                    category = item.category,
                    hasStream = item.category == "directas" || item.category == "torrents",
                    hasCatalog = item.category == "catalogos",
                    hasSubtitles = item.category == "subtitulos",
                )
            },
            builtin = false,
            dimmed = false,
            badges = listOf(if (installed) Icons.Rounded.Check else Icons.Rounded.Add),
            onClick = { addCommunity(item) },
        )
    }

    LazyVerticalGrid(
        columns = GridCells.Adaptive(if (ui.isTv) 170.dp else 150.dp),
        horizontalArrangement = Arrangement.spacedBy(9.dp),
        verticalArrangement = Arrangement.spacedBy(9.dp),
        contentPadding = contentPadding,
        modifier = modifier.fillMaxSize(),
    ) {
        fullItem("title") { SetPanelTitle("Plugins") }
        fullItem("bar") {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp, bottom = 6.dp),
            ) {
                SetSubTabs(
                    tabs = listOf("mine" to "Mis plugins", "community" to "Comunidad"),
                    selected = tab,
                    onSelect = { tab = it },
                )
                Spacer(Modifier.weight(1f))
                SetButton(
                    text = "Agregar plugin",
                    onClick = { installDialogOpen = true },
                    primary = true,
                    icon = Icons.Rounded.Add,
                    height = 31.dp,
                    radius = 8.dp,
                    fontSize = 10.5f,
                )
            }
        }

        if (tab == "mine") {
            if (builtins.isNotEmpty()) {
                fullItem("h_builtin") {
                    SectionHead("Incluidos con OpenTV", "Vienen con la app y siempre están activos")
                }
                items(builtins, key = { "b_" + it.url }) { p ->
                    InstalledCard(p, onClick = { configPluginUrl = p.url })
                }
            }
            fullItem("h_user") {
                SectionHead(
                    title = "Tus plugins",
                    sub = "Fuentes, catálogos y listas de TV agregados por ti",
                    warn = if (!hasSourcePlugin) "Sin plugin de fuentes no se puede reproducir. Hay recomendados en Comunidad." else null,
                )
            }
            if (userPlugins.isEmpty() && lists.isEmpty()) {
                fullItem("empty") {
                    EmptyText("Aún no agregaste plugins. Explora la pestaña Comunidad o pulsa Agregar plugin.")
                }
            }
            items(userPlugins, key = { "u_" + it.url }) { p ->
                InstalledCard(p, onClick = { configPluginUrl = p.url })
            }
            items(lists, key = { "m_" + it.url }) { m3u ->
                PlCard(
                    name = m3u.name,
                    meta = "TV en vivo · Lista M3U · " + if (m3u.enabled) "En uso" else "Sin usar",
                    description = m3u.description.ifBlank { "Lista M3U agregada por enlace." },
                    icon = {
                        PluginIcon(
                            id = m3u.id,
                            name = m3u.name,
                            url = m3u.url,
                            kind = "m3u",
                            dimmed = !m3u.enabled,
                        )
                    },
                    builtin = false,
                    dimmed = !m3u.enabled,
                    badges = listOf(Icons.Rounded.Settings),
                    onClick = { configM3uUrl = m3u.url },
                )
            }
        } else {
            fullItem("tools") {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    SetTextField(
                        value = query,
                        onValueChange = { query = it },
                        placeholder = "Buscar plugins",
                        modifier = Modifier.widthIn(max = 360.dp),
                        leading = {
                            Icon(Icons.Rounded.Search, null, tint = SetColors.Text50, modifier = Modifier.size(13.dp))
                        },
                    )
                    com.techpoint.opentv.ui.components.TvCenteredRowScope {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(1.dp)) {
                        items(chipCategories, key = { it.first }) { (id, label) ->
                            SetSegButton(label = label, selected = catFilter == id, onClick = { catFilter = id }, pill = true)
                        }
                    }
                    }
                }
            }
            if (isFiltering) {
                fullItem("count") {
                    val n = filtered.size
                    Text(
                        text = if (n == 0) "" else if (n == 1) "1 plugin" else "$n plugins",
                        color = SetColors.Text42,
                        fontSize = tsp(9f),
                    )
                }
            }
            if (groups.isEmpty()) {
                fullItem("none") { EmptyText("No hay plugins con esa búsqueda.") }
            }
            groups.forEach { g ->
                fullItem("cs_" + g.id) { SectionHead(g.title, g.sub) }
                g.subs.forEach { sub ->
                    if (sub.title.isNotBlank()) {
                        fullItem("cs_" + g.id + "_" + sub.id) { SubHead(sub.title) }
                    }
                    items(sub.items, key = { "c_" + g.id + "_" + it.id }) { item -> CommunityCard(item) }
                }
            }
        }
    }

    if (installDialogOpen) {
        InstallPluginModal(
            onDismiss = { installDialogOpen = false },
            onSubmit = { url ->
                installDialogOpen = false
                installFromUrl(url)
            },
        )
    }

    pendingConfirmUrl?.let { url ->
        PlModal(
            title = "Instalar plugin",
            subtitle = "Un enlace externo quiere agregar este plugin:",
            onDismiss = { pendingConfirmUrl = null },
            footer = {
                SetButton("Cancelar", onClick = { pendingConfirmUrl = null })
                SetButton("Instalar", onClick = {
                    pendingConfirmUrl = null
                    installFromUrl(url)
                }, primary = true)
            },
        ) {
            Text(url, color = Color.White, fontSize = tsp(12f))
        }
    }

    configPluginUrl?.let { url ->
        val idx = plugins.indexOfFirst { it.url == url }
        val plugin = plugins.getOrNull(idx)
        if (plugin == null) {
            LaunchedEffect(url) { configPluginUrl = null }
        } else {
            PluginConfigModal(
                plugin = plugin,
                index = idx,
                total = plugins.size,
                stremio = stremio,
                sourcePrefs = sourcePrefs,
                onInstallPlugin = onInstallPlugin,
                onRemovePlugin = onRemovePlugin,
                onSetAllowLan = onSetAllowLan,
                onUpdateSourcePrefs = onUpdateSourcePrefs,
                onSetPluginDisabled = onSetPluginDisabled,
                onMovePlugin = onMovePlugin,
                onShowToast = onShowToast,
                onDismiss = { configPluginUrl = null },
            )
        }
    }

    configM3uUrl?.let { url ->
        val playlist = lists.firstOrNull { it.url == url }
        if (playlist == null) {
            LaunchedEffect(url) { configM3uUrl = null }
        } else {
            M3uConfigModal(
                playlist = playlist,
                onRemove = {
                    onRemoveM3u(playlist.url)
                    onShowToast("Se eliminó ${playlist.name}")
                    configM3uUrl = null
                },
                onDismiss = { configM3uUrl = null },
            )
        }
    }
}

private fun LazyGridScope.fullItem(key: String, content: @Composable () -> Unit) {
    item(key = key, span = { GridItemSpan(maxLineSpan) }, contentType = "full") { content() }
}

@Composable
private fun SectionHead(title: String, sub: String, warn: String? = null) {
    Column(
        verticalArrangement = Arrangement.spacedBy(2.dp),
        modifier = Modifier.padding(top = 10.dp, bottom = 1.dp),
    ) {
        Text(title, color = Color.White, fontSize = tsp(12f), fontWeight = FontWeight.Bold)
        Text(sub, color = SetColors.Text42, fontSize = tsp(8f))
        if (!warn.isNullOrBlank()) {
            Text(warn, color = SetColors.Warn, fontSize = tsp(8.5f), fontWeight = FontWeight.SemiBold)
        }
    }
}

/** Category sub-heading inside a Comunidad section (lighter than [SectionHead]). */
@Composable
private fun SubHead(title: String) {
    Text(
        text = title,
        color = SetColors.Text55,
        fontSize = tsp(9f),
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(top = 4.dp),
    )
}

@Composable
private fun EmptyText(text: String) {
    Text(text, color = SetColors.Text55, fontSize = tsp(10f), modifier = Modifier.padding(vertical = 6.dp))
}

private fun offersOf(p: InstalledPlugin): String {
    val parts = buildList {
        if (p.hasCatalog) add("Catálogo")
        if (p.hasStream || p.kind == "kino-js") add("Fuentes")
        if (p.hasSubtitles) add("Subtítulos")
    }
    return parts.joinToString(", ")
}

private fun pluginDescription(p: InstalledPlugin): String {
    if (p.description.isNotBlank()) return p.description
    val parts = buildList {
        if (p.hasCatalog) add("filas de títulos")
        if (p.hasStream || p.kind == "kino-js") add("fuentes para reproducir")
        if (p.hasSubtitles) add("subtítulos")
    }
    if (parts.isEmpty()) return "Plugin compatible con Stremio."
    val text = if (parts.size > 1) parts.dropLast(1).joinToString(", ") + " y " + parts.last() else parts.first()
    return "Da $text a películas y series."
}

private fun pluginMeta(p: InstalledPlugin): String =
    if (p.builtin) {
        "Películas y series · Incluido · Siempre activo"
    } else {
        listOf("Películas y series", offersOf(p), if (p.disabled) "Sin usar" else "En uso")
            .filter { it.isNotBlank() }
            .joinToString(" · ")
    }

@Composable
private fun InstalledCard(plugin: InstalledPlugin, onClick: () -> Unit) {
    PlCard(
        name = plugin.name,
        meta = pluginMeta(plugin),
        description = pluginDescription(plugin),
        icon = {
            PluginIcon(
                id = plugin.id,
                name = plugin.name,
                url = plugin.url,
                logo = plugin.logo,
                kind = plugin.kind,
                hasStream = plugin.hasStream || plugin.kind == "kino-js",
                hasCatalog = plugin.hasCatalog,
                hasSubtitles = plugin.hasSubtitles,
                dimmed = plugin.disabled,
            )
        },
        builtin = plugin.builtin,
        dimmed = plugin.disabled,
        badges = if (plugin.builtin) {
            listOf(Icons.Rounded.Lock)
        } else {
            listOf(Icons.Rounded.Settings)
        },
        power = if (plugin.builtin) null else !plugin.disabled,
        onClick = onClick,
    )
}

/**
 * v1 `.pl-card`: radius 10, fill #141418 (built-in #131317), 0.5 dp border white 6 %;
 * focused: 1.5 dp ring white 75 % and fill #18181d. One focus target per card; the
 * round badges top-right are indicators (OK opens Configurar / adds the plugin).
 */
@Composable
private fun PlCard(
    name: String,
    meta: String,
    description: String,
    icon: @Composable () -> Unit,
    builtin: Boolean,
    dimmed: Boolean,
    badges: List<ImageVector>,
    onClick: () -> Unit,
    power: Boolean? = null,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(10.dp)
    val accentBg = if (ui.accent.id == "white") Color(0xFFE9E7E2) else ui.accent.color
    val accentFg = if (ui.accent.id == "white") Color(0xFF15151A) else ui.accent.onAccent
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(
                when {
                    focused -> Color(0xFF18181D)
                    builtin -> Color(0xFF131317)
                    else -> Color(0xFF141418)
                },
            )
            .border(
                width = if (focused) 1.5.dp else 0.5.dp,
                color = if (focused) Color(0xBFFFFFFF) else Color(0x0FFFFFFF),
                shape = shape,
            )
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(start = 11.dp, top = 11.dp, end = 11.dp, bottom = 12.dp),
    ) {
        Row(verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxWidth()) {
            icon()
            Spacer(Modifier.weight(1f))
            Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                if (power != null) PowerBadge(on = power, accentBg = accentBg, accentFg = accentFg)
                badges.forEach { badgeIcon ->
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .size(23.dp)
                            .clip(CircleShape)
                            .background(Color(0x12FFFFFF)),
                    ) {
                        Icon(
                            badgeIcon,
                            contentDescription = null,
                            tint = SetColors.Text70,
                            modifier = Modifier.size(12.dp),
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(9.dp))
        Column(Modifier.alpha(if (dimmed) 0.55f else 1f)) {
            Text(
                text = name,
                color = Color(0xFFECEAE6),
                fontSize = tsp(12f),
                fontWeight = FontWeight(680),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = meta,
                color = SetColors.Text42,
                fontSize = tsp(8f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(5.dp))
            Text(
                text = description,
                color = SetColors.Text55,
                fontSize = tsp(8.5f),
                lineHeight = tsp(11.5f),
                minLines = 2,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * On/off state of a user plugin: on = power icon on a solid accent circle,
 * off = crossed-out power icon on a dim circle.
 */
@Composable
private fun PowerBadge(on: Boolean, accentBg: Color, accentFg: Color) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(23.dp)
            .clip(CircleShape)
            .background(if (on) accentBg else Color(0x0AFFFFFF))
            .then(if (on) Modifier else Modifier.border(0.5.dp, Color(0x1FFFFFFF), CircleShape)),
    ) {
        Icon(
            if (on) Icons.Rounded.PowerSettingsNew else Icons.Rounded.PowerOff,
            contentDescription = if (on) "Desactivar plugin" else "Activar plugin",
            tint = if (on) accentFg else SetColors.Text42,
            modifier = Modifier.size(12.dp),
        )
    }
}
