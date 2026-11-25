package com.techpoint.opentv.ui.player

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Audiotrack
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Subtitles
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.techpoint.opentv.core.addons.SubtitleOrder
import com.techpoint.opentv.core.model.ExternalSubtitle
import com.techpoint.opentv.player.TrackChoice
import com.techpoint.opentv.ui.components.OpenTvRoundIconButton
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import com.techpoint.opentv.ui.theme.OpenTvColors
import kotlinx.coroutines.delay

/** Subtitle sizes offered in the player (same steps as the Detail language dialog). */
private val SUBTITLE_SIZES = listOf(16f to "Pequeño", 20f to "Normal", 25f to "Grande")
private val SPEEDS = listOf(0.75f, 1.0f, 1.25f, 1.5f)
private const val MAX_EXTERNAL_SUBS = 32

/** One row of the panel; a null [onClick] is a non-focusable caption. */
private class PanelEntry(
    val key: String,
    val primary: String,
    val secondary: String = "",
    val selected: Boolean = false,
    val trailing: String = "",
    val onClick: (() -> Unit)?,
)

private class PanelColumn(val title: String, val icon: ImageVector, val weight: Float, val entries: List<PanelEntry>)

/**
 * Audio / subtitles panel: up to three plain columns (Audio · Subtítulos · Opciones),
 * no nested levels. D-pad: ↑/↓ stay inside a column, ←/→ jump to the current choice of
 * the next column, Back closes (handled by the screen's BackHandler). Focus never leaves
 * the panel, so it cannot land on the player controls behind it.
 */
@Composable
internal fun PlayerTracksPanel(
    audioTracks: List<TrackChoice>,
    textTracks: List<TrackChoice>,
    externalSubs: List<ExternalSubtitle>,
    activeExternalId: String?,
    subtitleSizeSp: Float,
    speed: Float,
    searchingMoreSubs: Boolean,
    canPickLocalFile: Boolean,
    onSelectAudio: (TrackChoice) -> Unit,
    onSelectText: (TrackChoice?) -> Unit,
    onSelectExternal: (ExternalSubtitle) -> Unit,
    onSearchMore: () -> Unit,
    onPickLocalFile: () -> Unit,
    onSubtitleSize: (Float) -> Unit,
    onSpeed: (Float) -> Unit,
    onDismiss: () -> Unit,
) {
    val ui = LocalOpenTvUi.current

    val activeExternal = externalSubs.firstOrNull { it.id == activeExternalId }
    val columns = buildList {
        if (audioTracks.size > 1) {
            add(
                PanelColumn(
                    title = "Audio",
                    icon = Icons.Rounded.Audiotrack,
                    weight = 1f,
                    entries = audioTracks.mapIndexed { i, t ->
                        val l = TrackLabels.forTrack(t.label, t.language, isAudio = true, position = i)
                        PanelEntry("a:${t.groupIndex}:${t.trackIndex}", l.primary, l.secondary, t.selected) { onSelectAudio(t) }
                    },
                ),
            )
        }
        val subs = buildList {
            add(
                PanelEntry(
                    key = "s:off",
                    primary = "Desactivados",
                    selected = activeExternalId == null && textTracks.none { it.selected },
                ) { onSelectText(null) },
            )
            // The attached external file also shows up as an embedded track: list it once.
            textTracks
                .filterNot { activeExternal != null && it.label == activeExternal.label }
                .forEachIndexed { i, t ->
                    val l = TrackLabels.forTrack(t.label, t.language, isAudio = false, position = i)
                    add(
                        PanelEntry(
                            key = "s:${t.groupIndex}:${t.trackIndex}",
                            primary = l.primary,
                            secondary = l.secondary,
                            selected = activeExternalId == null && t.selected,
                        ) { onSelectText(t) },
                    )
                }
            val shown = externalSubs.take(MAX_EXTERNAL_SUBS)
            // Latin-American Spanish is named as such even when the code is plain "es" (SubDL
            // tells it apart in the label) or OpenSubtitles' "spn".
            fun subName(sub: ExternalSubtitle): String =
                if (SubtitleOrder.isLatamSpanish(sub.lang, sub.label)) "Español (Latinoamérica)"
                else TrackLabels.languageName(sub.lang) ?: sub.label.ifBlank { "Subtítulo" }
            val sameName = shown.groupingBy(::subName).eachCount()
            val seen = HashMap<String, Int>()
            shown.forEach { sub ->
                val name = subName(sub)
                val n = (seen[name] ?: 0) + 1
                seen[name] = n
                val detail = listOf(sub.source, if ((sameName[name] ?: 0) > 1) "#$n" else "")
                    .filter { it.isNotBlank() }
                    .joinToString(" · ")
                add(PanelEntry("x:${sub.id}", name, detail, sub.id == activeExternalId) { onSelectExternal(sub) })
            }
            add(
                PanelEntry(
                    key = "s:search",
                    primary = if (searchingMoreSubs) "Buscando subtítulos…" else "Buscar más subtítulos",
                ) { onSearchMore() },
            )
            if (canPickLocalFile) {
                add(PanelEntry("s:file", "Abrir archivo de subtítulos", ".srt o .vtt") { onPickLocalFile() })
            }
        }
        add(PanelColumn("Subtítulos", Icons.Rounded.Subtitles, 1.3f, subs))

        val nearestSize = SUBTITLE_SIZES.minByOrNull { kotlin.math.abs(it.first - subtitleSizeSp) }?.first
        val options = buildList {
            add(PanelEntry("o:size", "Tamaño de subtítulos", onClick = null))
            SUBTITLE_SIZES.forEach { (sp, name) ->
                add(PanelEntry("o:size:$sp", name, selected = sp == nearestSize) { onSubtitleSize(sp) })
            }
            add(PanelEntry("o:speedcap", "Velocidad", onClick = null))
            add(
                PanelEntry(
                    key = "o:speed",
                    primary = if (speed == 1f) "Normal" else "${speed}x",
                    trailing = "Cambiar",
                ) {
                    val next = SPEEDS.getOrElse(SPEEDS.indexOfFirst { it == speed } + 1) { SPEEDS.first() }
                    onSpeed(next)
                },
            )
        }
        add(PanelColumn("Opciones", Icons.Rounded.Tune, 0.85f, options))
    }

    // Focus bookkeeping without recomposition: one requester per focusable key + last focused key.
    val requesters = remember { HashMap<String, FocusRequester>() }
    fun req(key: String) = requesters.getOrPut(key) { FocusRequester() }
    val focusedKey = remember { arrayOfNulls<String>(1) }
    fun focus(entry: PanelEntry?) {
        if (entry != null) runCatching { req(entry.key).requestFocus() }
    }
    fun currentOrFirst(col: PanelColumn): PanelEntry? =
        col.entries.firstOrNull { it.selected && it.onClick != null } ?: col.entries.firstOrNull { it.onClick != null }

    // Open on the current choice of the first column (audio, or subtitles when there is one track).
    LaunchedEffect(Unit) {
        repeat(5) {
            delay(32L)
            val target = columns.firstOrNull()?.let(::currentOrFirst) ?: return@LaunchedEffect
            if (runCatching { req(target.key).requestFocus() }.isSuccess) return@LaunchedEffect
        }
    }

    // A chosen entry can disappear (tracks refresh after attaching a file): re-anchor focus
    // inside the panel instead of letting it fall back to the player behind.
    val allKeys = columns.flatMap { c -> c.entries.mapNotNull { e -> e.key.takeIf { e.onClick != null } } }
    LaunchedEffect(allKeys) {
        val key = focusedKey[0] ?: return@LaunchedEffect
        if (key !in allKeys) {
            delay(32L)
            focus(columns.firstOrNull()?.let(::currentOrFirst))
        }
    }

    BoxWithConstraints(
        contentAlignment = Alignment.BottomCenter,
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0x99000000))
            .pointerInput(Unit) { detectTapGestures { onDismiss() } },
    ) {
        val wide = maxWidth >= 600.dp
        // Navigation columns: side by side when wide, a single list when stacked (portrait phone).
        val navColumns: List<List<PanelEntry>> =
            if (wide) columns.map { c -> c.entries.filter { it.onClick != null } }
            else listOf(columns.flatMap { c -> c.entries.filter { it.onClick != null } })

        Surface(
            color = OpenTvColors.Ink900,
            border = BorderStroke(1.dp, OpenTvColors.GlassBorderStrong),
            shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp),
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(if (ui.isTv) 0.64f else 0.84f)
                .pointerInput(Unit) { detectTapGestures { } }
                .onPreviewKeyEvent { ev ->
                    if (ev.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                    val dir = when (ev.key) {
                        Key.DirectionUp -> -1
                        Key.DirectionDown -> 1
                        Key.DirectionLeft -> -2
                        Key.DirectionRight -> 2
                        else -> return@onPreviewKeyEvent false
                    }
                    val key = focusedKey[0]
                    val colIdx = navColumns.indexOfFirst { col -> col.any { it.key == key } }
                    if (colIdx < 0) {
                        // Focus is on the header close button (phones) or nowhere: go to the first choice.
                        focus(columns.firstOrNull()?.let(::currentOrFirst))
                        return@onPreviewKeyEvent true
                    }
                    val col = navColumns[colIdx]
                    val row = col.indexOfFirst { it.key == key }
                    when (dir) {
                        -1, 1 -> focus(col.getOrNull(row + dir)) // stays put at the column ends
                        else -> {
                            val nextCol = colIdx + dir / 2
                            if (wide && nextCol in columns.indices) focus(currentOrFirst(columns[nextCol]))
                        }
                    }
                    true // always consumed: focus never escapes to the player behind
                },
        ) {
            Column(Modifier.fillMaxSize().padding(horizontal = if (ui.isTv) 40.dp else 18.dp, vertical = 16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Text("Audio y subtítulos", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                    if (ui.isTv) {
                        Text("Atrás para cerrar", style = MaterialTheme.typography.labelMedium, color = OpenTvColors.TextMuted)
                    } else {
                        OpenTvRoundIconButton(Icons.Rounded.Close, "Cerrar", onDismiss, size = 36.dp)
                    }
                }
                Spacer(Modifier.height(12.dp))

                val rowContent: @Composable (PanelEntry) -> Unit = { entry ->
                    PanelRow(
                        entry = entry,
                        focusRequester = if (entry.onClick != null) req(entry.key) else null,
                        onFocused = { focusedKey[0] = entry.key },
                    )
                }
                if (wide) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(if (ui.isTv) 28.dp else 16.dp),
                        modifier = Modifier.fillMaxWidth().weight(1f),
                    ) {
                        columns.forEach { col ->
                            Column(
                                verticalArrangement = Arrangement.spacedBy(4.dp),
                                modifier = Modifier.weight(col.weight).fillMaxHeight().verticalScroll(rememberScrollState()),
                            ) {
                                ColumnHeader(col.title, col.icon)
                                col.entries.forEach { rowContent(it) }
                            }
                        }
                    }
                } else {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                        modifier = Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()),
                    ) {
                        columns.forEachIndexed { i, col ->
                            if (i > 0) Spacer(Modifier.height(10.dp))
                            ColumnHeader(col.title, col.icon)
                            col.entries.forEach { rowContent(it) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ColumnHeader(title: String, icon: ImageVector) {
    val ui = LocalOpenTvUi.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.padding(start = 4.dp, bottom = 4.dp),
    ) {
        Icon(icon, null, tint = ui.accent.color, modifier = Modifier.size(18.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun PanelRow(entry: PanelEntry, focusRequester: FocusRequester?, onFocused: () -> Unit) {
    val ui = LocalOpenTvUi.current
    val onClick = entry.onClick
    if (onClick == null || focusRequester == null) {
        // Caption inside the Opciones column.
        Text(
            text = entry.primary,
            style = MaterialTheme.typography.labelMedium,
            color = OpenTvColors.TextMuted,
            modifier = Modifier.padding(start = 12.dp, top = 8.dp, bottom = 2.dp),
        )
        return
    }
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(10.dp)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = if (ui.isTv) 44.dp else 48.dp)
            .focusRequester(focusRequester)
            .onFocusChanged { if (it.isFocused) onFocused() }
            .clip(shape)
            .background(
                when {
                    focused -> OpenTvColors.GlassFillFocus
                    entry.selected -> OpenTvColors.GlassFill
                    else -> Color.Transparent
                },
            )
            .then(if (focused) Modifier.border(2.dp, ui.accent.color, shape) else Modifier)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp),
    ) {
        Box(Modifier.width(24.dp), contentAlignment = Alignment.CenterStart) {
            if (entry.selected) {
                Icon(Icons.Rounded.Check, "Seleccionado", tint = ui.accent.color, modifier = Modifier.size(20.dp))
            }
        }
        Spacer(Modifier.width(6.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = entry.primary,
                style = MaterialTheme.typography.titleMedium,
                color = if (entry.selected) ui.accent.color else Color.White,
                fontWeight = if (entry.selected) FontWeight.Bold else FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (entry.secondary.isNotBlank()) {
                Text(
                    text = entry.secondary,
                    style = MaterialTheme.typography.labelMedium,
                    color = OpenTvColors.TextSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (entry.trailing.isNotBlank()) {
            Spacer(Modifier.width(8.dp))
            Text(entry.trailing, style = MaterialTheme.typography.labelMedium, color = ui.accent.color, fontWeight = FontWeight.Bold)
        }
    }
}
