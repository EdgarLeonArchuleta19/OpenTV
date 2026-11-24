package com.techpoint.opentv.ui.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.FolderOpen
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Usb
import androidx.compose.material3.Icon
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.techpoint.opentv.core.local.LocalMediaScanner
import com.techpoint.opentv.core.local.LocalVideoEntry
import kotlinx.coroutines.launch
import java.util.Locale

/** Shared scanning state for local device / USB videos (zero work until the panel is opened). */
internal class LocalFilesState {
    var items by mutableStateOf<List<LocalVideoEntry>>(emptyList())
    var scanning by mutableStateOf(false)
    var scannedOnce by mutableStateOf(false)
    var permissionDenied by mutableStateOf(false)
    var scanTick by mutableIntStateOf(0)
}

@Composable
internal fun rememberLocalFilesScanner(): LocalFilesState {
    val context = LocalContext.current
    val state = remember { LocalFilesState() }
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        state.permissionDenied = !granted
        state.scanTick++
    }
    LaunchedEffect(state.scanTick) {
        if (state.scanTick == 0 && !LocalMediaScanner.hasReadVideoPermission(context)) {
            runCatching { permLauncher.launch(LocalMediaScanner.requiredVideoPermission()) }
                .onFailure { state.scanTick++ }
            return@LaunchedEffect
        }
        state.scanning = true
        state.items = runCatching { LocalMediaScanner.scanDeviceVideos(context) }.getOrDefault(emptyList())
        state.scanning = false
        state.scannedOnce = true
    }
    return state
}

private fun formatSize(bytes: Long): String = when {
    bytes >= 1_073_741_824L -> String.format(Locale("es"), "%.2f GB", bytes / 1_073_741_824.0)
    bytes >= 1_048_576L -> String.format(Locale("es"), "%.0f MB", bytes / 1_048_576.0)
    else -> String.format(Locale("es"), "%.0f KB", bytes / 1024.0)
}

private fun formatDur(ms: Long): String {
    if (ms <= 0L) return ""
    val totalMin = ms / 60_000L
    val h = totalMin / 60
    val m = totalMin % 60
    return if (h > 0) "${h} h ${m} min" else "${m} min"
}

/** Phone / tablet: "Archivos locales" tab inside Ajustes → Descargas. */
@Composable
internal fun LocalFilesMobileContent(
    onPlay: (uri: String, title: String) -> Unit,
    onShowToast: (String) -> Unit,
) {
    val context = LocalContext.current
    val state = rememberLocalFilesScanner()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val name = LocalMediaScanner.resolveDisplayName(context, uri)
        onPlay(uri.toString(), LocalMediaScanner.cleanTitleFromFileName(name))
    }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SetGroup(null) {
            SetRow(
                name = "Abrir un video del dispositivo",
                hint = "MKV, MP4, AVI, MOV, WEBM, TS… sin necesidad de plugins",
                divider = false,
            ) {
                SetButton(
                    text = "Abrir",
                    onClick = {
                        runCatching { picker.launch(arrayOf("video/*")) }
                            .onFailure { onShowToast("Tu dispositivo no tiene selector de archivos") }
                    },
                    primary = true,
                    icon = Icons.Rounded.FolderOpen,
                )
            }
            SetRow(
                name = "Videos encontrados",
                hint = when {
                    state.scanning -> "Buscando videos…"
                    state.permissionDenied -> "Permite el acceso a videos para listarlos aquí"
                    else -> "${state.items.size} video(s) en el dispositivo y memorias USB"
                },
            ) {
                SetButton("Actualizar", { state.scanTick++ }, icon = Icons.Rounded.Refresh, enabled = !state.scanning)
            }
        }
        if (state.scannedOnce && state.items.isEmpty() && !state.scanning) {
            Text(
                "No se encontraron videos. Usa «Abrir» para elegir uno manualmente.",
                color = SetColors.Text55,
                fontSize = tsp(11f),
            )
        }
        state.items.forEach { entry ->
            LocalVideoRow(entry = entry, onClick = { onPlay(entry.uri, entry.title) })
        }
    }
}

/** TV / Fire TV: compact D-pad friendly modal opened from Ajustes → Reproducción. */
@Composable
internal fun LocalFilesTvDialog(
    onDismiss: () -> Unit,
    onPlay: (uri: String, title: String) -> Unit,
) {
    val state = rememberLocalFilesScanner()
    val firstFocus = remember { FocusRequester() }
    val scope = rememberCoroutineScope()

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .width(620.dp)
                .fillMaxHeight(0.86f)
                .clip(RoundedCornerShape(16.dp))
                .background(Color(0xFF141418))
                .border(1.dp, SetColors.GroupBorder, RoundedCornerShape(16.dp))
                .padding(22.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Archivos locales / USB", color = Color.White, fontSize = tsp(18f), fontWeight = FontWeight(650))
                    Text(
                        when {
                            state.scanning -> "Buscando videos en el aparato y memorias USB…"
                            state.permissionDenied -> "Sin permiso de videos: solo se listan memorias USB"
                            else -> "${state.items.size} video(s) encontrados"
                        },
                        color = SetColors.Text55,
                        fontSize = tsp(10f),
                    )
                }
                SetButton(
                    "Actualizar",
                    { scope.launch { state.scanTick++ } },
                    icon = Icons.Rounded.Refresh,
                    enabled = !state.scanning,
                    modifier = if (state.items.isEmpty()) Modifier.focusRequester(firstFocus) else Modifier,
                )
            }
            if (state.scannedOnce && state.items.isEmpty() && !state.scanning) {
                Text(
                    "No se encontraron videos. Conecta una memoria USB (OTG) o copia videos al aparato.",
                    color = SetColors.Text55,
                    fontSize = tsp(11f),
                )
            }
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(6.dp),
                contentPadding = PaddingValues(vertical = 4.dp),
                modifier = Modifier.weight(1f).fillMaxWidth(),
            ) {
                items(state.items, key = { it.uri }) { entry ->
                    val isFirst = entry == state.items.firstOrNull()
                    LocalVideoRow(
                        entry = entry,
                        onClick = { onPlay(entry.uri, entry.title) },
                        modifier = if (isFirst) Modifier.focusRequester(firstFocus) else Modifier,
                    )
                }
            }
        }
    }
    LaunchedEffect(state.scannedOnce) {
        if (state.scannedOnce) {
            repeat(2) { androidx.compose.runtime.withFrameNanos { } }
            runCatching { firstFocus.requestFocus() }
        }
    }
}

@Composable
private fun LocalVideoRow(
    entry: LocalVideoEntry,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(10.dp)
    Box(modifier.outerRing(focused, RoundedCornerShape(12.5.dp))) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier
                .fillMaxWidth()
                .clip(shape)
                .background(if (focused) SetColors.FocusFill else SetColors.GroupFill)
                .border(0.5.dp, SetColors.GroupBorder, shape)
                .clickable(interactionSource = interaction, indication = null, onClick = onClick)
                .padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            Icon(
                imageVector = if (entry.isUsb) Icons.Rounded.Usb else Icons.Rounded.PlayArrow,
                contentDescription = null,
                tint = if (focused) Color.White else SetColors.Text65,
                modifier = Modifier.size(18.dp),
            )
            Column(Modifier.weight(1f)) {
                Text(entry.title, color = Color.White, fontSize = tsp(12f), fontWeight = FontWeight(550), maxLines = 1)
                Text(
                    listOf(entry.ext, entry.folder, formatSize(entry.sizeBytes), formatDur(entry.durationMs))
                        .filter { it.isNotBlank() }
                        .joinToString(" · "),
                    color = SetColors.Text50,
                    fontSize = tsp(9.5f),
                    maxLines = 1,
                )
            }
        }
    }
}
