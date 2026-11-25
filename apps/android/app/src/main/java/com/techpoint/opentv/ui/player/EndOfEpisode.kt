package com.techpoint.opentv.ui.player

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Replay
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.techpoint.opentv.core.model.Episode
import com.techpoint.opentv.ui.components.OpenTvImage
import com.techpoint.opentv.ui.theme.LocalOpenTvUi

// The player is always dark (independent of the app theme).
private val CardBg = Color(0xEB111116)
private val CardBorder = Color(0x33FFFFFF)
private val Muted = Color(0xB3FFFFFF)

/** Focusable button with an explicit dark style: primary = accent, secondary = glass. */
@Composable
private fun EndButton(
    text: String,
    icon: ImageVector,
    primary: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    height: Dp = 48.dp,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(12.dp)
    val bg = when {
        primary -> ui.accent.color
        focused -> Color.White
        else -> Color(0x24FFFFFF)
    }
    val fg = when {
        primary -> ui.accent.onAccent
        focused -> Color(0xFF0E0E11)
        else -> Color.White
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
        modifier = modifier
            .height(height)
            .graphicsLayer {
                if (focused && ui.isTv) {
                    scaleX = 1.06f
                    scaleY = 1.06f
                }
            }
            .clip(shape)
            .background(bg)
            .then(if (focused) Modifier.border(3.dp, Color.White, shape) else Modifier)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 22.dp),
    ) {
        Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Text(text, color = fg, fontWeight = FontWeight.Bold, fontSize = 15.sp, maxLines = 1)
    }
}

/**
 * Full-screen end screen over the last frame. The first action is primary and receives focus
 * ([firstFocus]); D-pad left/right moves between buttons, OK presses, Back = Salir (player).
 */
@Composable
fun EndOfEpisodeOverlay(
    title: String,
    current: Episode?,
    next: Episode?,
    actions: List<EpisodeFlow.EndAction>,
    firstFocus: FocusRequester,
    onAction: (EpisodeFlow.EndAction) -> Unit,
) {
    val ui = LocalOpenTvUi.current
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0x59000000), Color(0xB3000000), Color(0xF2000000)))),
    ) {
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(28.dp),
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(horizontal = if (ui.isTv) 56.dp else 24.dp, vertical = if (ui.isTv) 48.dp else 28.dp),
        ) {
            if (next != null && next.thumbnail.isNotBlank() && ui.isTv) {
                OpenTvImage(
                    url = next.thumbnail,
                    contentDescription = null,
                    targetWidthPx = 480,
                    modifier = Modifier
                        .width(300.dp)
                        .aspectRatio(16f / 9f)
                        .clip(RoundedCornerShape(14.dp))
                        .border(1.dp, CardBorder, RoundedCornerShape(14.dp)),
                )
            }
            Column {
                Text(
                    text = if (next != null) "Siguiente episodio" else "Has llegado al final",
                    color = Muted,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = if (next != null) EpisodeFlow.episodeLabel(next) else title,
                    color = Color.White,
                    fontSize = if (ui.isTv) 28.sp else 22.sp,
                    fontWeight = FontWeight.ExtraBold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 6.dp),
                )
                if (next == null && current != null) {
                    Text(
                        text = "Último episodio disponible · ${EpisodeFlow.episodeLabel(current)}",
                        color = Muted,
                        fontSize = 14.sp,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.padding(top = 20.dp),
                ) {
                    actions.forEachIndexed { i, a ->
                        EndButton(
                            text = when (a) {
                                EpisodeFlow.EndAction.NEXT -> "Siguiente episodio"
                                EpisodeFlow.EndAction.EXIT -> "Salir"
                                EpisodeFlow.EndAction.REPLAY -> "Volver a ver"
                            },
                            icon = when (a) {
                                EpisodeFlow.EndAction.NEXT -> Icons.Rounded.SkipNext
                                EpisodeFlow.EndAction.EXIT -> Icons.AutoMirrored.Rounded.ArrowBack
                                EpisodeFlow.EndAction.REPLAY -> Icons.Rounded.Replay
                            },
                            primary = i == 0,
                            onClick = { onAction(a) },
                            modifier = if (i == 0) Modifier.focusRequester(firstFocus) else Modifier,
                        )
                    }
                }
            }
        }
    }
}
