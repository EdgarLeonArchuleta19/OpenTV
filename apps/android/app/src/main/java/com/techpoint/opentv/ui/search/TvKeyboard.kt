package com.techpoint.opentv.ui.search

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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Backspace
import androidx.compose.material.icons.rounded.Search
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.techpoint.opentv.ui.theme.OpenTvColors

/** Same rows as OpenTV v1 `core/tv-keyboard.js` (TVK_ROWS). */
private val TVK_ROWS: List<List<String>> = listOf(
    listOf("a", "b", "c", "d", "e", "f", "g"),
    listOf("h", "i", "j", "k", "l", "m", "n"),
    listOf("ñ", "o", "p", "q", "r", "s", "t"),
    listOf("u", "v", "w", "x", "y", "z", "'"),
    listOf("1", "2", "3", "4", "5", "6", "7"),
    listOf("8", "9", "0", ".", "-", ":", "&"),
)

private const val TVK_MAX = 60

/**
 * On-screen TV keyboard (v1 `makeTvKeyboard`): a display bar with what is typed
 * (plus an optional white action button) and a 7-column key grid that the remote
 * walks with plain spatial focus. Nothing animates except the focused key scale.
 */
@Composable
fun TvKeyboard(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    doneLabel: String? = null,
    onDone: (() -> Unit)? = null,
    firstKeyFocusRequester: FocusRequester? = null,
    keyHeight: Dp = 31.dp,
    keyFontSize: TextUnit = 13.sp,
    displayHeight: Dp = 38.dp,
    displayFontSize: TextUnit = 13.sp,
    gap: Dp = 6.dp,
) {
    fun set(v: String) = onValueChange(v.take(TVK_MAX))

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(gap)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(gap),
            modifier = Modifier.fillMaxWidth().padding(bottom = gap),
        ) {
            Box(
                contentAlignment = Alignment.CenterStart,
                modifier = Modifier
                    .weight(1f)
                    .height(displayHeight)
                    .clip(RoundedCornerShape(8.dp))
                    .background(OpenTvColors.fg(0.08f))
                    .padding(horizontal = 10.dp),
            ) {
                Text(
                    text = value.ifEmpty { placeholder },
                    color = if (value.isEmpty()) OpenTvColors.TextMuted else OpenTvColors.Content,
                    fontSize = displayFontSize,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (doneLabel != null) {
                TvkGoButton(label = doneLabel, height = displayHeight, fontSize = displayFontSize, onClick = { onDone?.invoke() })
            }
        }
        TVK_ROWS.forEachIndexed { r, row ->
            Row(horizontalArrangement = Arrangement.spacedBy(gap), modifier = Modifier.fillMaxWidth()) {
                row.forEachIndexed { c, ch ->
                    TvkKey(
                        label = ch,
                        height = keyHeight,
                        fontSize = keyFontSize,
                        weight = 1f,
                        focusRequester = if (r == 0 && c == 0) firstKeyFocusRequester else null,
                        onClick = { set(value + ch) },
                    )
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(gap), modifier = Modifier.fillMaxWidth()) {
            TvkKey(
                label = "Espacio",
                height = keyHeight,
                fontSize = keyFontSize * 0.85f,
                weight = 3f,
                onClick = { if (value.isNotEmpty() && !value.endsWith(" ")) set("$value ") },
            )
            TvkKey(
                label = "Borrar",
                height = keyHeight,
                fontSize = keyFontSize * 0.85f,
                weight = 2f,
                showBackspace = true,
                onClick = { if (value.isNotEmpty()) set(value.dropLast(1)) },
            )
            TvkKey(
                label = "Limpiar",
                height = keyHeight,
                fontSize = keyFontSize * 0.85f,
                weight = 2f,
                onClick = { if (value.isNotEmpty()) set("") },
            )
        }
    }
}

@Composable
private fun RowScope.TvkKey(
    label: String,
    height: Dp,
    fontSize: TextUnit,
    weight: Float,
    onClick: () -> Unit,
    focusRequester: FocusRequester? = null,
    showBackspace: Boolean = false,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val fg = if (focused) OpenTvColors.OnContent else OpenTvColors.Content
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
        modifier = Modifier
            .weight(weight)
            .height(height)
            .zIndex(if (focused) 1f else 0f)
            .graphicsLayer {
                val s = if (focused) 1.08f else 1f
                scaleX = s
                scaleY = s
            }
            .clip(RoundedCornerShape(6.dp))
            .background(if (focused) OpenTvColors.Content else OpenTvColors.fg(0.07f))
            .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
    ) {
        if (showBackspace) {
            Icon(Icons.AutoMirrored.Rounded.Backspace, null, tint = fg, modifier = Modifier.size(fontSize.value.dp))
            Spacer(Modifier.width(4.dp))
        }
        Text(text = label, color = fg, fontSize = fontSize, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

@Composable
private fun TvkGoButton(label: String, height: Dp, fontSize: TextUnit, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        modifier = Modifier
            .height(height)
            .zIndex(if (focused) 1f else 0f)
            .graphicsLayer {
                val s = if (focused) 1.06f else 1f
                scaleX = s
                scaleY = s
            }
            .clip(RoundedCornerShape(9.dp))
            // Focus ring: a translucent outline around the white pill (fixed padding: no layout jump).
            .background(if (focused) OpenTvColors.fg(0.45f) else Color.Transparent)
            .padding(2.dp)
            .clip(RoundedCornerShape(7.dp))
            // Filled only while focused, so it never looks focused next to the real focused key.
            .background(if (focused) OpenTvColors.Content else OpenTvColors.fg(0.10f))
            .border(1.dp, if (focused) Color.Transparent else OpenTvColors.fg(0.28f), RoundedCornerShape(7.dp))
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 10.dp),
    ) {
        val ink = if (focused) OpenTvColors.OnContent else OpenTvColors.Content
        Icon(Icons.Rounded.Search, null, tint = ink, modifier = Modifier.size((fontSize.value + 2f).dp))
        Text(
            text = label,
            color = ink,
            fontSize = fontSize,
            fontWeight = if (focused) FontWeight.ExtraBold else FontWeight.Bold,
            maxLines = 1,
        )
    }
}
