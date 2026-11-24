package com.techpoint.opentv.ui.plugins

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.PowerOff
import androidx.compose.material.icons.rounded.PowerSettingsNew
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import com.techpoint.opentv.core.addons.PluginCatalogs
import com.techpoint.opentv.core.addons.StremioClient
import com.techpoint.opentv.core.model.InstalledPlugin
import com.techpoint.opentv.core.model.M3uPlaylist
import com.techpoint.opentv.core.model.SourcePrefs
import com.techpoint.opentv.ui.settings.RequestFocusOnStart
import com.techpoint.opentv.ui.settings.SetButton
import com.techpoint.opentv.ui.settings.SetColors
import com.techpoint.opentv.ui.settings.SetSegButton
import com.techpoint.opentv.ui.settings.SetTextField
import com.techpoint.opentv.ui.settings.tsp
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import kotlinx.coroutines.launch

/**
 * v1 `.pl-modal`: dim rgba(0,0,0,.82) without blur, 410 dp panel (#141418, radius 12),
 * header, scrollable body and a footer with "Cerrar" (no top-right X).
 */
@Composable
internal fun PlModal(
    title: String,
    subtitle: String,
    onDismiss: () -> Unit,
    leading: (@Composable () -> Unit)? = null,
    footer: @Composable RowScope.() -> Unit,
    body: @Composable ColumnScope.() -> Unit,
) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        // Our own flat dim replaces the window's default dim.
        val view = LocalView.current
        SideEffect { (view.parent as? DialogWindowProvider)?.window?.setDimAmount(0f) }
        val maxH = (LocalConfiguration.current.screenHeightDp * 0.9f).dp
        val shape = RoundedCornerShape(12.dp)
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xD1000000))
                .pointerInput(Unit) { detectTapGestures { onDismiss() } },
        ) {
            Column(
                modifier = Modifier
                    .widthIn(max = 410.dp)
                    .fillMaxWidth(0.94f)
                    .heightIn(max = maxH)
                    .clip(shape)
                    .background(Color(0xFF141418))
                    .border(0.5.dp, Color(0x17FFFFFF), shape)
                    // Taps inside the panel must not close it.
                    .pointerInput(Unit) { detectTapGestures { } },
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.padding(start = 18.dp, end = 18.dp, top = 16.dp, bottom = 10.dp),
                ) {
                    leading?.invoke()
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(title, color = Color.White, fontSize = tsp(17f), fontWeight = FontWeight.Bold, maxLines = 2)
                        if (subtitle.isNotBlank()) {
                            Text(subtitle, color = SetColors.Text50, fontSize = tsp(9.5f), maxLines = 2)
                        }
                    }
                }
                Column(
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    modifier = Modifier
                        .weight(1f, fill = false)
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 18.dp, vertical = 4.dp),
                    content = body,
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(2.dp, Alignment.End),
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 14.dp, end = 14.dp, top = 10.dp, bottom = 12.dp),
                    content = footer,
                )
            }
        }
    }
}

@Composable
private fun ModalSection(
    title: String,
    desc: String = "",
    content: @Composable () -> Unit = {},
) {
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(title, color = Color.White, fontSize = tsp(11f), fontWeight = FontWeight.SemiBold)
        if (desc.isNotBlank()) {
            Text(desc, color = SetColors.Text55, fontSize = tsp(8.5f), lineHeight = tsp(11.5f))
        }
        content()
    }
}

@Composable
private fun ModalMessage(text: String, error: Boolean) {
    if (text.isNotBlank()) {
        Text(text, color = if (error) Color(0xFFFF8A8A) else Color(0xFF7EE2A8), fontSize = tsp(9f))
    }
}

@Composable
internal fun InstallPluginModal(
    onDismiss: () -> Unit,
    onSubmit: (String) -> Unit,
) {
    val ui = LocalOpenTvUi.current
    var text by remember { mutableStateOf("") }
    var msg by remember { mutableStateOf("") }
    var xtreamOpen by remember { mutableStateOf(false) }
    var xtreamServer by remember { mutableStateOf("") }
    var xtreamUser by remember { mutableStateOf("") }
    var xtreamPass by remember { mutableStateOf("") }
    val fieldFocus = remember { FocusRequester() }
    RequestFocusOnStart(fieldFocus)

    PlModal(
        title = "Agregar plugin",
        subtitle = "Pega un enlace compatible con Stremio, lista M3U, código corto, o usa una cuenta Xtream.",
        onDismiss = onDismiss,
        footer = {
            SetButton(
                text = "Agregar",
                primary = true,
                icon = Icons.Rounded.Add,
                onClick = {
                    if (text.isBlank()) msg = "Pega un enlace primero." else onSubmit(text)
                },
            )
            SetButton("Cancelar", onDismiss)
        },
    ) {
        SetTextField(
            value = text,
            onValueChange = { text = it; msg = "" },
            placeholder = "https://…/manifest.json, usuario/repo, lista.m3u o código corto",
            focusRequester = fieldFocus,
            modifier = Modifier.fillMaxWidth(),
            onDone = { if (text.isBlank()) msg = "Pega un enlace primero." else onSubmit(text) },
        )
        ModalMessage(msg, error = true)
        SetButton(
            text = if (xtreamOpen) "Ocultar Xtream" else "Cuenta Xtream",
            onClick = { xtreamOpen = !xtreamOpen },
        )
        if (xtreamOpen) {
            SetTextField(value = xtreamServer, onValueChange = { xtreamServer = it }, placeholder = "Servidor (http://servidor:8080)", modifier = Modifier.fillMaxWidth())
            SetTextField(value = xtreamUser, onValueChange = { xtreamUser = it }, placeholder = "Usuario", modifier = Modifier.fillMaxWidth())
            SetTextField(value = xtreamPass, onValueChange = { xtreamPass = it }, placeholder = "Contraseña", modifier = Modifier.fillMaxWidth())
            SetButton(
                text = "Agregar cuenta Xtream",
                primary = true,
                onClick = {
                    val srv = xtreamServer.trim().removeSuffix("/")
                    val usr = xtreamUser.trim()
                    val pwd = xtreamPass
                    if (srv.isBlank() || usr.isBlank() || pwd.isBlank()) { msg = "Completa servidor, usuario y contraseña."; return@SetButton }
                    if (!srv.startsWith("http://") && !srv.startsWith("https://")) { msg = "El servidor debe empezar con http:// o https://"; return@SetButton }
                    val url = "$srv/get.php?username=${java.net.URLEncoder.encode(usr, "UTF-8")}&password=${java.net.URLEncoder.encode(pwd, "UTF-8")}&type=m3u_plus&output=ts"
                    onSubmit(url)
                },
            )
        }
        if (ui.isTv) {
            Text(
                "Consejo para la tele: si el enlace es largo, busca el plugin en la pestaña Comunidad; ahí se agrega con OK.",
                color = SetColors.Text55,
                fontSize = tsp(8.5f),
            )
        }
    }
}

/**
 * "Configurar <plugin>" (v1 `openPluginSettings`): Orden (when the store supports it),
 * Opciones del plugin (paste a new link; the configure page is opened on a phone or PC,
 * never here), Red de tu casa (JS plugins), Preferencias de fuentes and the footer.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun PluginConfigModal(
    plugin: InstalledPlugin,
    index: Int,
    total: Int,
    stremio: StremioClient,
    sourcePrefs: SourcePrefs,
    onInstallPlugin: (InstalledPlugin) -> Unit,
    onRemovePlugin: (String) -> Unit,
    onSetAllowLan: (String, Boolean) -> Unit,
    onUpdateSourcePrefs: ((SourcePrefs) -> SourcePrefs) -> Unit,
    onSetPluginDisabled: ((String, Boolean) -> Unit)?,
    onMovePlugin: ((String, Int) -> Unit)?,
    onShowToast: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val firstFocus = remember { FocusRequester() }
    var confirmDelete by remember { mutableStateOf(false) }
    var link by remember { mutableStateOf("") }
    var msg by remember { mutableStateOf("") }
    var msgError by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }

    val builtin = plugin.builtin
    val showUp = onMovePlugin != null && total > 1 && index > 0
    val showDown = onMovePlugin != null && total > 1 && index < total - 1
    val showOwn = !builtin
    val showLan = plugin.kind == "kino-js"
    val showPrefs = plugin.hasStream || plugin.kind == "kino-js"
    val firstKey = when {
        confirmDelete -> "confirm"
        showUp -> "up"
        showDown -> "down"
        showOwn -> "link"
        showLan -> "lan"
        else -> "close"
    }
    fun focusIf(k: String): Modifier = if (firstKey == k) Modifier.focusRequester(firstFocus) else Modifier
    RequestFocusOnStart(firstFocus, key = confirmDelete)

    val configureUrl = plugin.baseUrl.ifBlank { PluginCatalogs.stremioBaseFromUrl(plugin.url) }
        .removeSuffix("/") + "/configure"

    fun useLink() {
        val u = link.trim()
        if (u.isBlank()) {
            msg = "Pega un enlace primero."; msgError = true
            return
        }
        saving = true
        msg = "Guardando…"; msgError = false
        scope.launch {
            stremio.inspectPlugin(u)
                .onSuccess { res ->
                    when (res) {
                        is com.techpoint.opentv.core.addons.PluginInspectResult.Plugin -> {
                            val np = res.plugin
                            if (PluginCatalogs.stremioBaseFromUrl(np.url) != PluginCatalogs.stremioBaseFromUrl(plugin.url)) {
                                onRemovePlugin(plugin.url)
                            }
                            onInstallPlugin(np.copy(allowLan = plugin.allowLan, disabled = plugin.disabled))
                            onShowToast("Se guardó la configuración de ${plugin.name}")
                            onDismiss()
                        }
                        is com.techpoint.opentv.core.addons.PluginInspectResult.Collection -> {
                            msg = "Este enlace es una colección; agrégala desde Agregar plugin."; msgError = true
                        }
                    }
                }
                .onFailure { err ->
                    msg = "No se pudo usar: ${err.message ?: "enlace no válido"}"; msgError = true
                }
            saving = false
        }
    }

    val subtitle = if (builtin) {
        "Películas y series · Incluido · Siempre activo"
    } else {
        "Películas y series · " + if (plugin.disabled) "Sin usar" else "En uso"
    }

    PlModal(
        title = "Configurar ${plugin.name}",
        subtitle = subtitle,
        onDismiss = onDismiss,
        leading = {
            PluginIcon(
                id = plugin.id,
                name = plugin.name,
                url = plugin.url,
                logo = plugin.logo,
                kind = plugin.kind,
                hasStream = plugin.hasStream || plugin.kind == "kino-js",
                hasCatalog = plugin.hasCatalog,
                hasSubtitles = plugin.hasSubtitles,
                size = 36.dp,
                cornerRadius = 9.5.dp,
            )
        },
        footer = {
            if (confirmDelete) {
                SetButton(
                    text = "Eliminar",
                    primary = true,
                    icon = Icons.Rounded.Delete,
                    modifier = focusIf("confirm"),
                    onClick = {
                        onRemovePlugin(plugin.url)
                        onShowToast("Se eliminó ${plugin.name}")
                        onDismiss()
                    },
                )
                SetButton("Cancelar", onClick = { confirmDelete = false })
            } else {
                if (!builtin) {
                    SetButton("Eliminar", onClick = { confirmDelete = true }, icon = Icons.Rounded.Delete, danger = true)
                }
                if (!builtin && onSetPluginDisabled != null) {
                    SetButton(
                        text = if (plugin.disabled) "Poner en uso" else "Dejar sin usar",
                        // Icon shows the state the button switches to.
                        icon = if (plugin.disabled) Icons.Rounded.PowerSettingsNew else Icons.Rounded.PowerOff,
                        onClick = {
                            val nowDisabled = !plugin.disabled
                            onSetPluginDisabled(plugin.url, nowDisabled)
                            onShowToast(plugin.name + if (nowDisabled) " sin usar" else " en uso")
                            onDismiss()
                        },
                    )
                }
                SetButton("Cerrar", onDismiss, modifier = focusIf("close"))
            }
        },
    ) {
        if (confirmDelete) {
            ModalSection(
                title = "¿Eliminar ${plugin.name}?",
                desc = "Deja de dar sus títulos, fuentes o subtítulos. Puedes volver a agregarlo cuando quieras.",
            )
        }

        if (!confirmDelete && (showUp || showDown)) {
            ModalSection(
                title = "Orden",
                desc = "Sus filas y sus fuentes salen antes que las de los plugins que están más abajo. Ahora: ${index + 1} de $total.",
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    if (showUp) {
                        SetButton("Subir", icon = Icons.Rounded.ArrowUpward, modifier = focusIf("up"), onClick = {
                            onMovePlugin?.invoke(plugin.url, -1)
                            onShowToast("${plugin.name} subió al lugar $index")
                        })
                    }
                    if (showDown) {
                        SetButton("Bajar", icon = Icons.Rounded.ArrowDownward, modifier = focusIf("down"), onClick = {
                            onMovePlugin?.invoke(plugin.url, 1)
                            onShowToast("${plugin.name} bajó al lugar ${index + 2}")
                        })
                    }
                }
            }
        }

        if (!confirmDelete && showOwn) {
            ModalSection(
                title = "Opciones del plugin",
                desc = "Si este plugin tiene opciones propias, ábrelas en tu celular o PC en $configureUrl " +
                    "y pega aquí el enlace nuevo que te dé.",
            ) {
                SetTextField(
                    value = link,
                    onValueChange = { link = it; msg = "" },
                    placeholder = "Enlace nuevo (…/manifest.json)",
                    modifier = Modifier.fillMaxWidth(),
                )
                Row {
                    SetButton(
                        text = if (saving) "Guardando…" else "Usar este enlace",
                        primary = true,
                        enabled = !saving,
                        modifier = focusIf("link"),
                        onClick = ::useLink,
                    )
                }
                ModalMessage(msg, msgError)
            }
        }

        if (!confirmDelete && showLan) {
            ModalSection(
                title = "Red de tu casa",
                desc = "Permite que este plugin lea servidores de tu red (un NAS, Jellyfin, Plex en casa). Déjalo bloqueado si no lo necesitas.",
            ) {
                Row {
                    SetButton(
                        text = if (plugin.allowLan) "Permitida" else "Bloqueada",
                        primary = plugin.allowLan,
                        modifier = focusIf("lan"),
                        onClick = {
                            val allow = !plugin.allowLan
                            onSetAllowLan(plugin.url, allow)
                            onShowToast(if (allow) "Red de tu casa permitida" else "Red de tu casa bloqueada")
                        },
                    )
                }
            }
        }

        if (!confirmDelete && showPrefs) {
            ModalSection(
                title = "Preferencias de fuentes",
                desc = "Cómo elige OpenTV la fuente al reproducir. Valen para todos tus plugins de fuentes.",
            ) {
                PrefLine("Idioma") {
                    listOf("latino" to "Latino", "castellano" to "Castellano", "en" to "Inglés", "pt" to "Portugués").forEach { (code, label) ->
                        val on = code in sourcePrefs.langs
                        SetSegButton(label = label, selected = on, pill = true, onClick = {
                            onUpdateSourcePrefs { p ->
                                val next = if (on) p.langs - code else p.langs + code
                                p.copy(langs = next.ifEmpty { listOf("latino") })
                            }
                        })
                    }
                }
                PrefLine("Calidad") {
                    listOf("auto" to "Automática", "4K" to "4K", "1080p" to "1080p", "720p" to "720p").forEach { (id, label) ->
                        SetSegButton(label = label, selected = sourcePrefs.quality == id, pill = true, onClick = {
                            onUpdateSourcePrefs { it.copy(quality = id) }
                        })
                    }
                }
                PrefLine("Ocultar") {
                    listOf("CAM" to "CAM", "4K" to "4K", "SD" to "SD").forEach { (id, label) ->
                        val on = id in sourcePrefs.exclude
                        SetSegButton(label = label, selected = on, pill = true, onClick = {
                            onUpdateSourcePrefs { p -> p.copy(exclude = if (on) p.exclude - id else p.exclude + id) }
                        })
                    }
                }
                PrefLine("Reproducir la mejor fuente sin preguntar") {
                    listOf(false to "No", true to "Sí").forEach { (v, label) ->
                        SetSegButton(label = label, selected = sourcePrefs.autoPlay == v, pill = true, onClick = {
                            onUpdateSourcePrefs { it.copy(autoPlay = v) }
                        })
                    }
                }
            }
        }

        if (!confirmDelete) {
            Text(plugin.url, color = SetColors.Text35, fontSize = tsp(8f), maxLines = 2)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PrefLine(label: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.padding(top = 2.dp)) {
        Text(label, color = SetColors.Text70, fontSize = tsp(9.5f), fontWeight = FontWeight.Medium)
        FlowRow(verticalArrangement = Arrangement.spacedBy(1.dp)) { content() }
    }
}

@Composable
internal fun M3uConfigModal(
    playlist: M3uPlaylist,
    onRemove: () -> Unit,
    onDismiss: () -> Unit,
) {
    val firstFocus = remember { FocusRequester() }
    var confirmDelete by remember { mutableStateOf(false) }
    RequestFocusOnStart(firstFocus, key = confirmDelete)

    PlModal(
        title = "Configurar ${playlist.name}",
        subtitle = "TV en vivo · Lista M3U · " + if (playlist.enabled) "En uso" else "Sin usar",
        onDismiss = onDismiss,
        leading = {
            PluginIcon(
                id = playlist.id,
                name = playlist.name,
                url = playlist.url,
                kind = "m3u",
                size = 36.dp,
                cornerRadius = 9.5.dp,
            )
        },
        footer = {
            if (confirmDelete) {
                SetButton("Eliminar", onRemove, primary = true, icon = Icons.Rounded.Delete, modifier = Modifier.focusRequester(firstFocus))
                SetButton("Cancelar", onClick = { confirmDelete = false })
            } else {
                SetButton("Eliminar", onClick = { confirmDelete = true }, icon = Icons.Rounded.Delete, danger = true)
                SetButton("Cerrar", onDismiss, modifier = Modifier.focusRequester(firstFocus))
            }
        },
    ) {
        if (confirmDelete) {
            ModalSection(
                title = "¿Eliminar ${playlist.name}?",
                desc = "Sus canales dejan de salir en TV en vivo. Puedes volver a agregarla cuando quieras.",
            )
        } else {
            ModalSection(
                title = "Lista de TV",
                desc = playlist.description.ifBlank { "Sus canales salen en TV en vivo." },
            )
            Text(playlist.url, color = SetColors.Text35, fontSize = tsp(8f), maxLines = 3)
        }
    }
}
