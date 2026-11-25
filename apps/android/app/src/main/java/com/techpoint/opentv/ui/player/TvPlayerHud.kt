package com.techpoint.opentv.ui.player

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Forward10
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Replay10
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.techpoint.opentv.ui.theme.LocalOpenTvUi

/**
 * OpenTV v1 TV player HUD (`10-teles.css` 141-219). Nothing here is focusable:
 * ←/→ seek, OK play/pause, ↓ opens audio/subtitles, ↑ episodes.
 */
@Composable
fun TvPlayerHud(
    title: String,
    subtitle: String,
    positionMs: Long,
    durationMs: Long,
    isPlaying: Boolean,
    hasEpisodes: Boolean,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(300.dp)
            .background(
                Brush.verticalGradient(
                    0f to Color.Transparent,
                    0.34f to Color(0x59000000),
                    0.66f to Color(0xC7000000),
                    1f to Color(0xF0000000),
                ),
            ),
    ) {
        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .fillMaxWidth()
                .padding(start = 60.dp, end = 60.dp, bottom = 26.dp),
        ) {
            Text(
                text = title,
                color = Color.White,
                fontSize = 27.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle.isNotBlank()) {
                Text(subtitle, color = Color(0xA6FFFFFF), fontSize = 13.sp, maxLines = 1)
            }
            Spacer(Modifier.height(14.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(formatHudTime(positionMs), color = Color.White, fontSize = 15.sp, style = TabularStyle)
                Spacer(Modifier.width(14.dp))
                SeekBar(
                    fraction = if (durationMs > 0) (positionMs.toFloat() / durationMs).coerceIn(0f, 1f) else 0f,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(14.dp))
                Text(formatHudTime(durationMs), color = Color(0xB3FFFFFF), fontSize = 15.sp, style = TabularStyle)
            }
            Spacer(Modifier.height(16.dp))
            Box(Modifier.fillMaxWidth()) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(18.dp),
                    modifier = Modifier.align(Alignment.Center),
                ) {
                    HudCircle(size = 42, filled = false) {
                        Icon(Icons.Rounded.Replay10, null, tint = Color.White, modifier = Modifier.size(22.dp))
                    }
                    HudCircle(size = 56, filled = true) {
                        Icon(
                            if (isPlaying) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                            null,
                            tint = Color(0xFF0E0E11),
                            modifier = Modifier.size(30.dp),
                        )
                    }
                    HudCircle(size = 42, filled = false) {
                        Icon(Icons.Rounded.Forward10, null, tint = Color.White, modifier = Modifier.size(22.dp))
                    }
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.align(Alignment.CenterEnd),
                ) {
                    if (hasEpisodes) HintPill("↑ Episodios")
                    HintPill("↓ Audio y subtítulos")
                }
            }
        }
    }
}

private val TabularStyle = androidx.compose.ui.text.TextStyle(fontFeatureSettings = "tnum")

@Composable
private fun SeekBar(fraction: Float, modifier: Modifier = Modifier) {
    val accent = LocalOpenTvUi.current.accent.color
    BoxWithConstraints(modifier = modifier.height(15.dp), contentAlignment = Alignment.CenterStart) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(5.dp)
                .clip(RoundedCornerShape(3.dp))
                .background(Color(0x3DFFFFFF)),
        ) {
            Box(Modifier.fillMaxWidth(fraction).fillMaxHeight().background(accent))
        }
        Box(
            Modifier
                .offset(x = maxWidth * fraction - 7.5.dp)
                .size(15.dp)
                .clip(CircleShape)
                .background(accent),
        )
    }
}

@Composable
private fun HudCircle(size: Int, filled: Boolean, content: @Composable () -> Unit) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(if (filled) Color.White else Color(0x1FFFFFFF)),
    ) { content() }
}

@Composable
private fun HintPill(text: String) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .height(32.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Color(0x26FFFFFF))
            .padding(horizontal = 14.dp),
    ) {
        Text(text, color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

private fun formatHudTime(ms: Long): String {
    val totalSec = (ms / 1000L).coerceAtLeast(0L)
    val h = totalSec / 3600L
    val m = (totalSec % 3600L) / 60L
    val s = totalSec % 60L
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%02d:%02d".format(m, s)
}

