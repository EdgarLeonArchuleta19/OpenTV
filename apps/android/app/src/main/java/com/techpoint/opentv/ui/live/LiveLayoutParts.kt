package com.techpoint.opentv.ui.live

import android.view.SurfaceView
import android.view.ViewGroup
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.techpoint.opentv.core.model.EpgNowNext
import com.techpoint.opentv.core.model.EpgProgram
import com.techpoint.opentv.core.model.LiveChannel
import com.techpoint.opentv.player.OpenTvPlayer
import com.techpoint.opentv.ui.components.OpenTvImage
import com.techpoint.opentv.ui.components.rememberFocus
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import com.techpoint.opentv.ui.theme.OpenTvColors
import kotlinx.coroutines.delay

// "Design C" palette (mockup `CCards`): panel, controls and badges.
internal val LivePanel: Color
    @Composable @ReadOnlyComposable get() = if (OpenTvColors.isLight) OpenTvColors.CardSurface else Color(0xFF141418)
internal val LivePanelBorder: Color
    @Composable @ReadOnlyComposable get() = OpenTvColors.fg(0.07f)
// Always dark, in both themes (PC `ChannelThumb` bg-[#23232b]): most channel logos are white
// on transparent and vanish on a light tile.
internal val LiveBadge: Color = Color(0xFF23232B)
private val LiveCardNow: Color
    @Composable @ReadOnlyComposable get() = OpenTvColors.fg(0.09f)

/** Channel logo (through the core resizer, small) or its monogram on a dark rounded tile. */
@Composable
internal fun LiveChannelBadge(channel: LiveChannel?, size: Dp, dark: Boolean = false) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(size)
            .clip(RoundedCornerShape(size * 0.25f))
            .background(if (dark) (if (OpenTvColors.isLight) Color(0x14FFFFFF) else Color(0x14000000)) else LiveBadge),
    ) {
        if (channel != null && channel.logo.isNotBlank()) {
            OpenTvImage(
                url = channel.logo,
                background = Color.Transparent,
                contentDescription = channel.name,
                targetWidthPx = 96,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize().padding(size * 0.1f),
            )
        } else {
            Text(
                text = remember(channel?.name) { channelMonogram(channel?.name.orEmpty()) },
                color = if (dark) OpenTvColors.OnContent else Color(0xD9FFFFFF),
                fontSize = (size.value * 0.3f).sp,
                fontWeight = FontWeight.ExtraBold,
                maxLines = 1,
            )
        }
    }
}

/**
 * Live video box: 16:9 SurfaceView, buffering spinner and the "EN VIVO" pill. Focusable on
 * TV (OK = pantalla completa, focus ring drawn outside the video); tap on touch screens.
 */
@Composable
internal fun LivePlayerStage(
    player: OpenTvPlayer,
    onFullscreen: () -> Unit,
    modifier: Modifier = Modifier,
    interaction: MutableInteractionSource = remember { MutableInteractionSource() },
) {
    val ui = LocalOpenTvUi.current
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(16.dp)
    Box(
        modifier = modifier
            .border(if (focused) 3.dp else 1.dp, if (focused) OpenTvColors.Content else OpenTvColors.fg(0.06f), shape)
            // Constant inset: the focus ring never resizes the video surface.
            .padding(3.dp)
            .clip(shape)
            .background(Color.Black)
            .clickable(interactionSource = interaction, indication = null, onClick = onFullscreen),
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
        Text(
            "EN VIVO",
            color = Color.White,
            fontSize = (10.5f * ui.textScale).sp,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = 0.06.em,
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(12.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(Color(0xFFE50914))
                .padding(horizontal = 8.dp, vertical = 3.dp),
        )
        if (focused) {
            Text(
                "OK · Pantalla completa",
                color = Color.White,
                fontSize = (11f * ui.textScale).sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(10.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(Color(0xB30E0E11))
                    .padding(horizontal = 10.dp, vertical = 4.dp),
            )
        }
    }
}

/**
 * "Programación de hoy" of the playing channel: header (badge, "N · nombre", actions) and
 * four programme cards — AHORA (wider, accent border, progress), DESPUÉS and two by start
 * time. [scroll] lays the cards out as a horizontal scroll row (phones). Recomposes on its
 * own every 30 s for the progress, never the screen around it.
 */
@Composable
internal fun LiveProgrammeSection(
    channel: LiveChannel?,
    number: Int,
    schedule: List<EpgProgram>,
    scheduleLoading: Boolean,
    nowNext: EpgNowNext?,
    scroll: Boolean,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val ui = LocalOpenTvUi.current
    val scale = ui.textScale
    val nowMs by produceState(System.currentTimeMillis()) {
        while (true) {
            delay(30_000L)
            value = System.currentTimeMillis()
        }
    }
    val cards = remember(schedule, nowNext, nowMs) { pickProgrammeCards(schedule, nowNext, nowMs) }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            LiveChannelBadge(channel, 34.dp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    text = when {
                        channel == null -> "Elige un canal"
                        number > 0 -> "$number · ${channel.name}"
                        else -> channel.name
                    },
                    color = OpenTvColors.Content,
                    fontSize = (15.5f * scale).sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "Programación de hoy",
                    color = OpenTvColors.TextMuted,
                    fontSize = (11.5f * scale).sp,
                    maxLines = 1,
                )
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                content = actions,
            )
        }
        when {
            cards.isEmpty() -> Text(
                text = if (scheduleLoading) "Cargando programación…" else "Sin programación para este canal",
                color = OpenTvColors.TextSubtle,
                fontSize = (12.5f * scale).sp,
                modifier = Modifier.padding(start = 2.dp, top = 4.dp),
            )
            scroll -> LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                items(cards, key = { "${it.slot}_${it.program.startMs}_${it.program.title}" }) { card ->
                    LiveProgrammeCard(
                        card = card,
                        nowMs = nowMs,
                        modifier = Modifier
                            .width(if (card.slot == ProgrammeSlot.Now) 210.dp else 150.dp)
                            .height(112.dp),
                    )
                }
            }
            else -> Row(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxWidth().weight(1f, fill = true),
            ) {
                cards.forEach { card ->
                    LiveProgrammeCard(
                        card = card,
                        nowMs = nowMs,
                        modifier = Modifier
                            .weight(if (card.slot == ProgrammeSlot.Now) 1.5f else 1f)
                            .fillMaxHeight(),
                    )
                }
                // Fewer than four programmes: keep the card widths of the full row.
                repeat(4 - cards.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun LiveProgrammeCard(card: ProgrammeCard, nowMs: Long, modifier: Modifier = Modifier) {
    val ui = LocalOpenTvUi.current
    val scale = ui.textScale
    val isNow = card.slot == ProgrammeSlot.Now
    val shape = RoundedCornerShape(12.dp)
    val p = card.program
    val hasProgress = isNow && p.endMs > p.startMs && p.startMs > 0L
    Box(
        modifier = modifier
            .clip(shape)
            .background(if (isNow) LiveCardNow else LivePanel)
            .border(if (isNow) 1.5.dp else 1.dp, if (isNow) ui.accent.color else LivePanelBorder, shape)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = programmeLabel(card),
                color = if (isNow) ui.accent.color else OpenTvColors.TextMuted,
                fontSize = (10.5f * scale).sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = 0.05.em,
                maxLines = 1,
            )
            // The title only gets the room left by the time range (and the progress bar), so a
            // two-line title never pushes the times out of the card ("Texto aumentado").
            Text(
                text = p.title,
                color = OpenTvColors.Content,
                fontSize = (13.5f * scale).sp,
                lineHeight = (16.5f * scale).sp,
                fontWeight = FontWeight.Bold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            val range = programmeRange(p)
            if (range.isNotEmpty()) {
                Text(range, color = OpenTvColors.fg(0.58f), fontSize = (11.5f * scale).sp, maxLines = 1)
            }
            if (hasProgress) Spacer(Modifier.height(7.dp))
        }
        if (hasProgress) {
            Box(
                Modifier
                    .align(Alignment.BottomStart)
                    .fillMaxWidth()
                    .height(3.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(OpenTvColors.fg(0.18f)),
            ) {
                Box(
                    Modifier
                        .fillMaxWidth(p.progressAt(nowMs).coerceIn(0.02f, 1f))
                        .fillMaxHeight()
                        .background(ui.accent.color),
                )
            }
        }
    }
}

/**
 * Channel row of the right panel: number, logo/monogram, name (+ the programme on air) and
 * "VIENDO" on the playing channel (accent text and border). TV focus = white fill.
 */
@Composable
internal fun LiveChannelListRow(
    channel: LiveChannel,
    number: Int,
    nowTitle: String?,
    playing: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val ui = LocalOpenTvUi.current
    val scale = ui.textScale
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(11.dp)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .fillMaxWidth()
            .height(if (ui.isTv) 48.dp else 58.dp)
            .clip(shape)
            .background(
                when {
                    focused -> OpenTvColors.Content
                    playing -> LiveCardNow
                    else -> Color.Transparent
                },
            )
            .border(1.5.dp, if (playing && !focused) ui.accent.color else Color.Transparent, shape)
            .rememberFocus()
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(start = 4.dp, end = 10.dp),
    ) {
        Text(
            text = if (number > 0) number.toString() else "",
            color = if (focused) OpenTvColors.OnContent.copy(alpha = 0.6f) else OpenTvColors.TextMuted,
            fontSize = (11.5f * scale).sp,
            textAlign = TextAlign.End,
            maxLines = 1,
            modifier = Modifier.width(26.dp),
        )
        Spacer(Modifier.width(9.dp))
        LiveChannelBadge(channel, if (ui.isTv) 34.dp else 40.dp, dark = focused)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = channel.name,
                color = if (focused) OpenTvColors.OnContent else OpenTvColors.Content,
                fontSize = (13.5f * scale).sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (!nowTitle.isNullOrBlank()) {
                Text(
                    text = nowTitle,
                    color = if (focused) OpenTvColors.OnContent.copy(alpha = 0.6f) else OpenTvColors.TextMuted,
                    fontSize = (11f * scale).sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (playing) {
            Spacer(Modifier.width(6.dp))
            Text(
                "VIENDO",
                color = if (focused) OpenTvColors.OnContent else ui.accent.color,
                fontSize = (9.5f * scale).sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = 0.05.em,
                maxLines = 1,
            )
        }
    }
}
