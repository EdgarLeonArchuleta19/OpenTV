package com.techpoint.opentv.ui.live

import com.techpoint.opentv.ui.components.stableFocusRequester
import androidx.compose.foundation.background
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.material.icons.automirrored.rounded.List
import androidx.compose.material.icons.rounded.Fullscreen
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarBorder
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.unit.Dp
import com.techpoint.opentv.ui.components.rememberFocus
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.LiveTv
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.techpoint.opentv.core.model.EpgNowNext
import com.techpoint.opentv.core.model.LiveChannel
import com.techpoint.opentv.player.OpenTvPlayer
import com.techpoint.opentv.ui.components.OpenTvImage
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import com.techpoint.opentv.ui.theme.OpenTvColors
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

internal val LiveDark = Color(0xFF0E0E11)

/** Waits for the node to be attached (a few frames at most) and focuses it. */
internal suspend fun FocusRequester.focusSoon(frames: Int = 4) {
    repeat(frames) {
        withFrameNanos { }
        // Unit (older Compose) or Boolean (newer); an unattached requester throws.
        val result: Any? = runCatching { requestFocus() }.getOrNull()
        if (result != null && result != false) return
    }
}

/**
 * Buffering spinner that observes only `isBuffering`, so position ticks of the
 * player never recompose the surrounding Live screen.
 */
@Composable
internal fun BoxScope.LiveBufferingSpinner(player: OpenTvPlayer, size: Int = 30) {
    val ui = LocalOpenTvUi.current
    val buffering by remember(player) {
        player.state.map { it.isBuffering }.distinctUntilChanged()
    }.collectAsState(initial = player.state.value.isBuffering)
    if (buffering) {
        CircularProgressIndicator(
            color = ui.accent.color,
            strokeWidth = 2.5.dp,
            modifier = Modifier.align(Alignment.Center).size(size.dp),
        )
    }
}

/**
 * TV channel row (PC `h-[60px] rounded-[14px]` row scaled to 10 ft): logo, name and the
 * "now" EPG line; focused = white fill, playing = soft fill + red dot. Single focus target.
 */
@Composable
internal fun LiveTvChannelRow(
    channel: LiveChannel,
    epg: EpgNowNext?,
    active: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    rightFocus: FocusRequester? = null,
) {
    val scale = LocalOpenTvUi.current.textScale
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val now = epg?.now?.title?.takeIf { it.isNotBlank() }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .fillMaxWidth()
            .height(54.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(
                when {
                    focused -> Color.White
                    active -> Color(0x21FFFFFF)
                    else -> Color.Transparent
                },
            )
            .focusProperties { if (rightFocus != null) right = rightFocus }
            .rememberFocus()
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(start = 7.dp, end = 10.dp),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(width = 52.dp, height = 40.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(if (focused) Color(0x14000000) else Color(0xFF0E0E11)),
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
                Icon(Icons.Rounded.LiveTv, null, tint = if (focused) LiveDark else OpenTvColors.TextMuted, modifier = Modifier.size(18.dp))
            }
        }
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = channel.name,
                color = if (focused) LiveDark else Color.White,
                fontSize = (14.5f * scale).sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (now != null) {
                Text(
                    text = now,
                    color = if (focused) Color(0x990E0E11) else OpenTvColors.TextMuted,
                    fontSize = (11.5f * scale).sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (active) {
            Spacer(Modifier.width(6.dp))
            Box(
                Modifier
                    .size(7.dp)
                    .clip(CircleShape)
                    .background(OpenTvColors.LiveRed),
            )
        }
    }
}

/** PC search box (46 px, radius 14): non-editable display on TV; OK opens the TV keyboard. */
@Composable
internal fun LiveTvSearchBox(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val scale = LocalOpenTvUi.current.textScale
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(12.dp)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .fillMaxWidth()
            .height(40.dp)
            .clip(shape)
            .background(if (focused) Color.White else Color(0x0FFFFFFF))
            .border(1.dp, if (focused) Color.White else Color(0x1FFFFFFF), shape)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 12.dp),
    ) {
        Icon(Icons.Rounded.Search, null, tint = if (focused) LiveDark else OpenTvColors.TextMuted, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(9.dp))
        Text(
            text = text.ifEmpty { "Buscar canal" },
            color = when {
                focused -> LiveDark
                text.isEmpty() -> OpenTvColors.TextMuted
                else -> Color.White
            },
            fontSize = (13.5f * scale).sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** PC category dropdown button (46 px, radius 14); focused = white fill. */
@Composable
internal fun LiveTvCategoryButton(
    label: String,
    expanded: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val scale = LocalOpenTvUi.current.textScale
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val fg = if (focused) LiveDark else Color.White
    val shape = RoundedCornerShape(12.dp)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .fillMaxWidth()
            .height(40.dp)
            .clip(shape)
            .background(
                when {
                    focused -> Color.White
                    expanded -> Color(0x1FFFFFFF)
                    else -> Color(0x12FFFFFF)
                },
            )
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(start = 14.dp, end = 10.dp),
    ) {
        Text(
            text = label,
            color = fg,
            fontSize = (13.5f * scale).sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Icon(
            imageVector = Icons.Rounded.ExpandMore,
            contentDescription = null,
            tint = fg,
            modifier = Modifier
                .size(18.dp)
                .graphicsLayer { rotationZ = if (expanded) 180f else 0f },
        )
    }
}

/**
 * PC `live-bar3a` under the video: logo, name, "Canal N · grupo", Ahora/Después with the
 * programme progress, and round controls (anterior, pausa, siguiente, favorito, guía,
 * pantalla completa). ← from the first control returns to the last focused channel row.
 */
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable
internal fun LiveTvInfoBar(
    channel: LiveChannel?,
    number: Int,
    epg: EpgNowNext?,
    player: OpenTvPlayer,
    isFavorite: Boolean,
    playFocus: FocusRequester,
    leftExit: () -> FocusRequester,
    onPrev: () -> Unit,
    onNext: () -> Unit,
    onToggleFavorite: () -> Unit,
    onGuide: () -> Unit,
    onFullscreen: () -> Unit,
) {
    val ui = LocalOpenTvUi.current
    val scale = ui.textScale
    // Two lines: channel info uses the full width (names were cut to "ADN No…" when the
    // six round controls shared the row), controls sit underneath.
    Column(Modifier.fillMaxWidth()) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(width = 64.dp, height = 46.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Color(0x12FFFFFF)),
        ) {
            if (channel != null && channel.logo.isNotBlank()) {
                OpenTvImage(
                    url = channel.logo,
                    contentDescription = channel.name,
                    targetWidthPx = 160,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize().padding(5.dp),
                )
            } else {
                Icon(Icons.Rounded.LiveTv, null, tint = OpenTvColors.TextMuted, modifier = Modifier.size(20.dp))
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = channel?.name ?: "Elige un canal",
                color = Color.White,
                fontSize = (19f * scale).sp,
                fontWeight = FontWeight.ExtraBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (channel != null) {
                Text(
                    text = if (number > 0) "Canal $number · ${channel.group}" else channel.group,
                    color = Color(0xA6FFFFFF),
                    fontSize = (12f * scale).sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            val nowP = epg?.now
            val line = listOfNotNull(
                nowP?.title?.takeIf { it.isNotBlank() }?.let { "Ahora: $it" },
                epg?.next?.title?.takeIf { it.isNotBlank() }?.let { "Después: $it" },
            ).joinToString("  ·  ")
            if (line.isNotEmpty()) {
                Text(
                    text = line,
                    color = Color(0xD9FFFFFF),
                    fontSize = (12f * scale).sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (nowP != null && nowP.endMs > nowP.startMs) {
                val p = remember(nowP) { nowP.progressAt(System.currentTimeMillis()) }
                Box(
                    Modifier
                        .padding(top = 5.dp)
                        .width(180.dp)
                        .height(3.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(Color(0x33FFFFFF)),
                ) {
                    Box(Modifier.fillMaxWidth(p.coerceIn(0.02f, 1f)).fillMaxHeight().background(OpenTvColors.LiveRed))
                }
            }
        }
    }
        Spacer(Modifier.height(12.dp))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier
                .padding(start = 76.dp)
                .focusProperties {
                    exit = { dir -> if (dir == FocusDirection.Left) leftExit() else FocusRequester.Default }
                }
                .focusGroup(),
        ) {
            LiveRoundButton(Icons.Rounded.SkipPrevious, "Canal anterior", onPrev)
            LivePlayPauseButton(player, playFocus)
            LiveRoundButton(Icons.Rounded.SkipNext, "Canal siguiente", onNext)
            LiveRoundButton(
                if (isFavorite) Icons.Rounded.Star else Icons.Rounded.StarBorder,
                "Favorito",
                onToggleFavorite,
                tint = if (isFavorite) OpenTvColors.StarGold else null,
            )
            LiveRoundButton(Icons.AutoMirrored.Rounded.List, "Guía", onGuide)
            LiveRoundButton(Icons.Rounded.Fullscreen, "Pantalla completa", onFullscreen)
        }
    }
}

@Composable
private fun LiveRoundButton(
    icon: ImageVector,
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color? = null,
    size: Dp = 46.dp,
    filled: Boolean = false,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .size(size)
            .zIndex(if (focused) 1f else 0f)
            .graphicsLayer {
                val s = if (focused) 1.1f else 1f
                scaleX = s
                scaleY = s
            }
            // Ring outside the circle so focus is visible even when the accent is white.
            .border(2.dp, if (focused) Color.White else Color.Transparent, CircleShape)
            .padding(3.dp)
            .clip(CircleShape)
            .background(
                when {
                    focused -> Color.White
                    filled -> ui.accent.color
                    else -> Color(0x1AFFFFFF)
                },
            )
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = description,
            tint = when {
                focused -> LiveDark
                filled -> ui.accent.onAccent
                else -> tint ?: Color.White
            },
            modifier = Modifier.size(size * 0.4f),
        )
    }
}

/** Accent play/pause; observes only `isPlaying` so position ticks never recompose the bar. */
@Composable
private fun LivePlayPauseButton(player: OpenTvPlayer, focus: FocusRequester) {
    val playing by remember(player) {
        player.state.map { it.isPlaying }.distinctUntilChanged()
    }.collectAsState(initial = player.state.value.isPlaying)
    LiveRoundButton(
        icon = if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
        description = if (playing) "Pausa" else "Reanudar",
        onClick = { player.togglePlayPause() },
        modifier = Modifier.focusRequester(focus),
        size = 56.dp,
        filled = true,
    )
}
/** v1 `.live-cat-menu`: the category list drawn over the channel list. */
@Composable
internal fun LiveTvCategoryMenu(
    categories: List<String>,
    selected: String,
    selectedRequester: FocusRequester,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val startIdx = remember(categories, selected) { categories.indexOf(selected).coerceAtLeast(0) }
    val state = rememberLazyListState(initialFirstVisibleItemIndex = startIdx)
    LazyColumn(
        state = state,
        verticalArrangement = Arrangement.spacedBy(2.dp),
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(Color(0xFA16161A))
            .border(1.dp, OpenTvColors.GlassBorderStrong, RoundedCornerShape(10.dp))
            .padding(5.dp),
    ) {
        items(categories, key = { it }) { cat ->
            val interaction = remember { MutableInteractionSource() }
            val focused by interaction.collectIsFocusedAsState()
            val isSel = cat == selected
            val fg = if (focused) LiveDark else Color.White
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(38.dp)
                    .clip(RoundedCornerShape(9.dp))
                    .background(if (focused) Color.White else Color.Transparent)
                    .stableFocusRequester(isSel, selectedRequester)
                    .clickable(interactionSource = interaction, indication = null, onClick = { onSelect(cat) })
                    .padding(start = 10.dp, end = 8.dp),
            ) {
                Text(
                    text = cat,
                    color = fg,
                    fontSize = (13.5f * LocalOpenTvUi.current.textScale).sp,
                    fontWeight = if (isSel) FontWeight.Bold else FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (isSel) {
                    Icon(Icons.Rounded.Check, null, tint = fg, modifier = Modifier.size(16.dp))
                }
            }
        }
    }
}

/** v1 `.live-dock-btn` (TV): 30dp pill; focused = white fill and scale 1.08. */
@Composable
internal fun LiveTvPill(
    text: String,
    icon: ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    iconTint: Color? = null,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val fg = if (focused) LiveDark else Color.White
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = modifier
            .height(30.dp)
            .zIndex(if (focused) 1f else 0f)
            .graphicsLayer {
                val s = if (focused) 1.08f else 1f
                scaleX = s
                scaleY = s
            }
            .clip(RoundedCornerShape(999.dp))
            .background(if (focused) Color.White else Color(0x1AFFFFFF))
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 13.dp),
    ) {
        Icon(icon, null, tint = if (focused) LiveDark else (iconTint ?: Color.White), modifier = Modifier.size(15.dp))
        Text(text, color = fg, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

/** Pause pill that observes only `isPlaying`. */
@Composable
internal fun LiveTvPausePill(player: OpenTvPlayer) {
    val playing by remember(player) {
        player.state.map { it.isPlaying }.distinctUntilChanged()
    }.collectAsState(initial = player.state.value.isPlaying)
    LiveTvPill(
        text = if (playing) "Pausa" else "Reanudar",
        icon = if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
        onClick = { player.togglePlayPause() },
    )
}

/** Category pill for the fullscreen drawer on TV (single focus target). */
@Composable
internal fun LiveTvCategoryPill(label: String, selected: Boolean, onClick: () -> Unit) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .height(30.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(
                when {
                    focused -> Color.White
                    selected -> ui.accent.color
                    else -> Color(0x14FFFFFF)
                },
            )
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 12.dp),
    ) {
        Text(
            text = label,
            color = when {
                focused -> LiveDark
                selected -> ui.accent.onAccent
                else -> Color.White
            },
            fontSize = 12.sp,
            fontWeight = if (selected || focused) FontWeight.Bold else FontWeight.Medium,
            maxLines = 1,
        )
    }
}

/**
 * v1 fullscreen live banner (`.player-infobar` on TV): logo, number, name,
 * "now" line with a red dot and the remote key hints.
 */
@Composable
internal fun BoxScope.LiveTvBanner(
    channel: LiveChannel,
    number: Int,
    epg: EpgNowNext?,
) {
    Column(
        modifier = Modifier
            .align(Alignment.BottomCenter)
            .padding(start = 60.dp, end = 60.dp, bottom = 28.dp)
            .fillMaxWidth()
            .height(118.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Color(0xDB0E0E11))
            .padding(horizontal = 18.dp, vertical = 12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(width = 84.dp, height = 50.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color(0x12FFFFFF)),
            ) {
                if (channel.logo.isNotBlank()) {
                    OpenTvImage(
                        url = channel.logo,
                        contentDescription = channel.name,
                        targetWidthPx = 200,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxSize().padding(4.dp),
                    )
                } else {
                    Icon(Icons.Rounded.LiveTv, null, tint = OpenTvColors.TextMuted, modifier = Modifier.size(24.dp))
                }
            }
            Spacer(Modifier.width(16.dp))
            if (number > 0) {
                Text(
                    text = number.toString(),
                    color = Color(0x8CFFFFFF),
                    fontSize = 24.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                )
                Spacer(Modifier.width(14.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(
                    text = channel.name,
                    color = Color.White,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(OpenTvColors.LiveRed),
                    )
                    Spacer(Modifier.width(7.dp))
                    Text(
                        text = epg?.now?.title?.takeIf { it.isNotBlank() }?.let { "Ahora: $it" } ?: "En vivo",
                        color = OpenTvColors.TextSecondary,
                        fontSize = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        Spacer(Modifier.weight(1f))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LIVE_KEY_HINTS.forEach { (key, label) -> KeyHint(key, label) }
        }
    }
}

// Mirrors the actual fullscreen key handling in LiveTvScreen.
private val LIVE_KEY_HINTS = listOf(
    "▲" to "Canal anterior",
    "▼" to "Canal siguiente",
    "▶" to "Lista de canales",
    "◀" to "Último canal",
    "OK" to "Pausa",
    "Menú" to "Programación",
)

@Composable
private fun KeyHint(key: String, label: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .height(28.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(Color(0x1AFFFFFF))
            .padding(start = 4.dp, end = 10.dp),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .defaultMinSize(minWidth = 20.dp)
                .height(20.dp)
                .clip(RoundedCornerShape(999.dp))
                .background(Color.White)
                .padding(horizontal = 5.dp),
        ) {
            Text(key, color = LiveDark, fontSize = 10.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        }
        Spacer(Modifier.width(6.dp))
        Text(label, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Medium, maxLines = 1)
    }
}

/** EPG schedule row: focusable on TV so the remote can scroll the list (single focus target). */
@Composable
internal fun ScheduleRow(
    range: String,
    title: String,
    description: String,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(12.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (focused) OpenTvColors.GlassFillFocus else OpenTvColors.GlassFill)
            .then(if (focused) Modifier.border(2.dp, Color.White, shape) else Modifier)
            .then(if (ui.isTv) Modifier.focusable(interactionSource = interaction) else Modifier)
            .padding(12.dp),
    ) {
        if (range.isNotBlank()) {
            Text(range, fontSize = 12.sp, color = ui.accent.color, fontWeight = FontWeight.Bold)
        }
        Text(title, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        if (description.isNotBlank()) {
            Text(description, color = OpenTvColors.TextMuted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}
