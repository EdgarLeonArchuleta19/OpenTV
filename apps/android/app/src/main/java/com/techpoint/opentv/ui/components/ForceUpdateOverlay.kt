package com.techpoint.opentv.ui.components

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudDownload
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.SystemUpdate
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.techpoint.opentv.BuildConfig
import com.techpoint.opentv.service.RustServiceBridge
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import com.techpoint.opentv.ui.theme.OpenTvColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.util.Locale

/**
 * Full-screen, non-dismissible update screen shown on Android phone, Android TV and Fire TV
 * whenever a newer release exists. Consumes the Back button and auto-focuses the update action
 * on TV remotes so the user can upgrade right inside the app with a single OK press.
 */
@Composable
fun ForceUpdateOverlay(
    latestVersion: String,
    releaseNotes: String,
    onRecheck: suspend () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Hard block: Back key cannot dismiss the mandatory update gate.
    BackHandler(enabled = true) { /* blocked until upgraded */ }

    val ui = LocalOpenTvUi.current
    val scope = rememberCoroutineScope()
    val primaryFocus = remember { FocusRequester() }

    var phase by remember { mutableStateOf("available") } // available | downloading | ready | installing | needs-permission | error
    var bytes by remember { mutableLongStateOf(0L) }
    var total by remember { mutableLongStateOf(0L) }
    var progressPct by remember { mutableIntStateOf(0) }
    var errorMsg by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        withFrameNanos { }
        runCatching { primaryFocus.requestFocus() }
    }

    suspend fun triggerInstall() {
        phase = "installing"
        errorMsg = ""
        val inst = RustServiceBridge.callRpc("appUpdate", buildJsonObject { put("action", "install") })
        val st = (inst["state"] as? JsonPrimitive)?.contentOrNull.orEmpty()
        when (st) {
            "needs-permission" -> {
                phase = "needs-permission"
                errorMsg = (inst["errorText"] as? JsonPrimitive)?.contentOrNull
                    ?: "Permite a OpenTV instalar actualizaciones en Configuración y vuelve a pulsar Instalar."
            }
            "installing" -> {
                phase = "ready"
            }
            else -> {
                phase = "error"
                errorMsg = (inst["errorText"] as? JsonPrimitive)?.contentOrNull
                    ?: "No se pudo abrir el instalador del sistema."
            }
        }
    }

    fun startDownloadAndInstall() {
        if (phase == "downloading" || phase == "installing") return
        scope.launch {
            if (phase == "ready" || phase == "needs-permission") {
                triggerInstall()
                return@launch
            }
            phase = "downloading"
            errorMsg = ""
            bytes = 0L
            progressPct = 0

            // Ensure latest metadata is fetched before download
            RustServiceBridge.callRpc("appUpdate", buildJsonObject {
                put("action", "check")
                put("force", true)
            })
            val res = RustServiceBridge.callRpc("appUpdate", buildJsonObject { put("action", "download") })
            val initSt = (res["state"] as? JsonPrimitive)?.contentOrNull.orEmpty()
            if (initSt == "ready") {
                progressPct = 100
                triggerInstall()
                return@launch
            }
            if (initSt != "downloading") {
                phase = "error"
                errorMsg = (res["errorText"] as? JsonPrimitive)?.contentOrNull
                    ?: "No se pudo iniciar la descarga. Verifica tu conexión."
                return@launch
            }

            while (true) {
                delay(350L)
                val st = RustServiceBridge.callRpc("appUpdate", buildJsonObject { put("action", "status") })
                val s = (st["state"] as? JsonPrimitive)?.contentOrNull.orEmpty()
                val b = (st["bytes"] as? JsonPrimitive)?.longOrNull ?: 0L
                val t = (st["total"] as? JsonPrimitive)?.longOrNull ?: 0L
                bytes = b
                total = t
                progressPct = if (t > 0L) ((b * 100L) / t).toInt().coerceIn(0, 100) else 0
                when (s) {
                    "ready" -> {
                        progressPct = 100
                        triggerInstall()
                        return@launch
                    }
                    "error", "idle" -> {
                        phase = "error"
                        errorMsg = (st["error"] as? JsonPrimitive)?.contentOrNull
                            ?.ifBlank { "La descarga se interrumpió. Vuelve a intentarlo." }
                            ?: "La descarga se interrumpió. Vuelve a intentarlo."
                        return@launch
                    }
                }
            }
        }
    }

    // Mint text is too light on the light canvas: a darker green there.
    val mint = if (OpenTvColors.isLight) Color(0xFF15803D) else OpenTvColors.MintGreen
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .fillMaxSize()
            .background(OpenTvColors.BgCanvas.copy(alpha = 0xF8 / 255f))
            .padding(horizontal = if (ui.isTv) 48.dp else 20.dp, vertical = 24.dp),
    ) {
        val cardShape = RoundedCornerShape(20.dp)
        Column(
            modifier = Modifier
                .widthIn(max = 520.dp)
                .fillMaxWidth()
                .clip(cardShape)
                .background(if (OpenTvColors.isLight) OpenTvColors.Sheet else Color(0xFF141418))
                .border(1.dp, OpenTvColors.GlassBorderStrong, cardShape)
                .padding(horizontal = 24.dp, vertical = 24.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(44.dp)
                        .clip(RoundedCornerShape(13.dp))
                        .background(Color(0x1A7EE2A8)),
                ) {
                    Icon(
                        imageVector = Icons.Rounded.SystemUpdate,
                        contentDescription = null,
                        tint = mint,
                        modifier = Modifier.size(24.dp),
                    )
                }
                Column {
                    Text(
                        text = "ACTUALIZACIÓN OBLIGATORIA",
                        color = mint,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.4.sp,
                    )
                    Text(
                        text = "Nueva versión v$latestVersion",
                        color = OpenTvColors.Content,
                        fontSize = if (ui.isTv) 22.sp else 20.sp,
                        fontWeight = FontWeight.ExtraBold,
                    )
                }
            }

            Spacer(Modifier.height(14.dp))

            Text(
                text = "Para mantener compatibilidad, seguridad y la mejor reproducción, OpenTV solo funciona con la versión más reciente. Tu versión actual (v${BuildConfig.VERSION_NAME}) debe actualizarse para continuar.",
                color = OpenTvColors.TextSecondary,
                fontSize = 13.5.sp,
                lineHeight = 19.sp,
            )

            if (releaseNotes.isNotBlank()) {
                Spacer(Modifier.height(12.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(OpenTvColors.Content.copy(alpha = 0x0A / 255f))
                        .border(0.5.dp, OpenTvColors.GlassBorder, RoundedCornerShape(12.dp))
                        .padding(12.dp),
                ) {
                    Text(
                        text = releaseNotes,
                        color = OpenTvColors.TextMuted,
                        fontSize = 12.sp,
                        lineHeight = 17.sp,
                        maxLines = 5,
                        modifier = Modifier.verticalScroll(rememberScrollState()),
                    )
                }
            }

            if (phase == "downloading" || phase == "installing" || phase == "ready") {
                Spacer(Modifier.height(16.dp))
                Row(
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = when (phase) {
                            "installing" -> "Abriendo instalador…"
                            "ready" -> "Descarga lista para instalar"
                            else -> "Descargando actualización…"
                        },
                        color = OpenTvColors.Content,
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        text = if (phase == "downloading" && total > 0L) {
                            "${formatMb(bytes)} / ${formatMb(total)} · $progressPct%"
                        } else {
                            "${if (phase == "downloading") progressPct else 100}%"
                        },
                        color = mint,
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
                Spacer(Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = { (if (phase == "downloading") progressPct else 100) / 100f },
                    color = ui.accent.color,
                    trackColor = OpenTvColors.Content.copy(alpha = 0x26 / 255f),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(6.dp)
                        .clip(RoundedCornerShape(3.dp)),
                )
            }

            if (errorMsg.isNotBlank()) {
                Spacer(Modifier.height(12.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(Color(0x1FEF4444))
                        .border(0.5.dp, Color(0x4DEF4444), RoundedCornerShape(10.dp))
                        .padding(horizontal = 12.dp, vertical = 9.dp),
                ) {
                    Text(text = errorMsg, color = if (OpenTvColors.isLight) Color(0xFFB42318) else Color(0xFFFFB4B4), fontSize = 12.sp, lineHeight = 17.sp)
                }
            }

            Spacer(Modifier.height(18.dp))

            Row(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                val mainLabel = when (phase) {
                    "downloading" -> "Descargando ($progressPct%)…"
                    "installing" -> "Instalando…"
                    "ready" -> "Instalar ahora"
                    "needs-permission" -> "Ya activé el permiso · Instalar"
                    "error" -> "Reintentar descarga"
                    else -> "Actualizar ahora"
                }
                OpenTvPrimaryButton(
                    text = mainLabel,
                    icon = Icons.Rounded.CloudDownload,
                    onClick = ::startDownloadAndInstall,
                    modifier = Modifier
                        .weight(1f)
                        .focusRequester(primaryFocus),
                )
                if (phase != "downloading" && phase != "installing") {
                    OpenTvGlassButton(
                        text = "Verificar",
                        icon = Icons.Rounded.Refresh,
                        onClick = { scope.launch { onRecheck() } },
                    )
                }
            }
        }
    }
}

private fun formatMb(bytes: Long): String =
    String.format(Locale.US, "%.1f MB", bytes.toDouble() / (1024.0 * 1024.0))
