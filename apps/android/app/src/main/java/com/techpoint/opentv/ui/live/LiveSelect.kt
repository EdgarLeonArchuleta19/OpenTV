package com.techpoint.opentv.ui.live

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import com.techpoint.opentv.ui.components.stableFocusRequester
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import com.techpoint.opentv.ui.theme.OpenTvColors

internal data class LiveSelectOption(val value: String, val label: String, val count: Int? = null)

/**
 * Live TV dropdown (same pattern as the source picker's `PickerSelect`): a focusable button
 * that opens a small lazy list anchored below it. The list opens with the focus on the current
 * value; Back closes it and the focus returns to the button. After a pick the focus goes to
 * [onPicked]'s target when [returnFocusOnPick] is false (the channel list), else to the button.
 */
@Composable
internal fun LiveSelect(
    options: List<LiveSelectOption>,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    buttonFocus: FocusRequester = remember { FocusRequester() },
    returnFocusOnPick: Boolean = true,
    leadingLabel: String? = null,
) {
    val ui = LocalOpenTvUi.current
    val scale = ui.textScale
    var open by remember { mutableStateOf(false) }
    // 0 = nothing to restore, 1 = restore the button focus after the list closes.
    var restore by remember { mutableIntStateOf(0) }
    var buttonWidthPx by remember { mutableIntStateOf(0) }
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val current = options.firstOrNull { it.value == value } ?: options.firstOrNull()
    val shape = RoundedCornerShape(10.dp)
    val density = LocalDensity.current

    LaunchedEffect(open) {
        if (!open && restore == 1) {
            restore = 0
            buttonFocus.focusSoon()
        }
    }

    Box(modifier) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier
                .fillMaxWidth()
                .height(if (ui.isTv) 38.dp else 44.dp)
                .onSizeChanged { buttonWidthPx = it.width }
                .clip(shape)
                .background(
                    when {
                        focused -> OpenTvColors.Content
                        open -> (if (OpenTvColors.isLight) Color(0xFFE2E2E7) else Color(0xFF26262E))
                        else -> (if (OpenTvColors.isLight) Color(0xFFEEEEF1) else Color(0xFF1C1C22))
                    },
                )
                .focusRequester(buttonFocus)
                .clickable(interactionSource = interaction, indication = null) { open = true }
                .padding(start = 12.dp, end = 10.dp),
        ) {
            val fg = if (focused) OpenTvColors.OnContent else OpenTvColors.Content
            val sub = if (focused) OpenTvColors.OnContent.copy(alpha = 0.6f) else OpenTvColors.TextMuted
            if (leadingLabel != null) {
                Text(leadingLabel, color = sub, fontSize = (12f * scale).sp, maxLines = 1)
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.weight(1f),
            ) {
                Text(
                    text = current?.label.orEmpty(),
                    color = fg,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = (13.5f * scale).sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                current?.count?.let {
                    Text("· $it", color = sub, fontSize = (13f * scale).sp, maxLines = 1)
                }
            }
            Icon(Icons.Rounded.KeyboardArrowDown, null, tint = fg, modifier = Modifier.size(18.dp))
        }
        if (open) {
            Popup(
                alignment = Alignment.TopStart,
                offset = IntOffset(0, with(density) { (if (ui.isTv) 44.dp else 50.dp).roundToPx() }),
                onDismissRequest = {
                    restore = 1
                    open = false
                },
                properties = PopupProperties(focusable = true),
            ) {
                LiveSelectList(
                    options = options,
                    value = value,
                    widthDp = with(density) { buttonWidthPx.toDp() },
                    onPick = { v ->
                        restore = if (returnFocusOnPick) 1 else 0
                        open = false
                        onChange(v)
                    },
                )
            }
        }
    }
}

@Composable
private fun LiveSelectList(
    options: List<LiveSelectOption>,
    value: String,
    widthDp: androidx.compose.ui.unit.Dp,
    onPick: (String) -> Unit,
) {
    val ui = LocalOpenTvUi.current
    val scale = ui.textScale
    val selectedIdx = remember(options, value) { options.indexOfFirst { it.value == value }.coerceAtLeast(0) }
    // Opening scrolled to the current value keeps it composed, so it can take the focus.
    val state = rememberLazyListState(initialFirstVisibleItemIndex = (selectedIdx - 2).coerceAtLeast(0))
    val selectedFocus = remember { FocusRequester() }
    val shape = RoundedCornerShape(12.dp)
    LaunchedEffect(Unit) { selectedFocus.focusSoon() }
    LazyColumn(
        state = state,
        modifier = Modifier
            .width(widthDp.coerceAtLeast(200.dp))
            .heightIn(max = if (ui.isTv) 280.dp else 340.dp)
            .clip(shape)
            .background(if (OpenTvColors.isLight) OpenTvColors.Sheet else Color(0xFF1B1B20))
            .border(1.dp, OpenTvColors.GlassBorderStrong, shape)
            .padding(4.dp),
    ) {
        itemsIndexed(options, key = { _, o -> o.value }) { idx, o ->
            val selected = idx == selectedIdx
            val interaction = remember { MutableInteractionSource() }
            val focused by interaction.collectIsFocusedAsState()
            val fg = if (focused) OpenTvColors.OnContent else if (selected) OpenTvColors.Content else OpenTvColors.TextSecondary
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(if (ui.isTv) 36.dp else 44.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (focused) OpenTvColors.Content else Color.Transparent)
                    .stableFocusRequester(selected, selectedFocus)
                    .clickable(interactionSource = interaction, indication = null) { onPick(o.value) }
                    .padding(horizontal = 10.dp),
            ) {
                Icon(
                    Icons.Rounded.Check,
                    contentDescription = null,
                    tint = if (selected) (if (focused) OpenTvColors.OnContent else ui.accent.color) else Color.Transparent,
                    modifier = Modifier.size(16.dp),
                )
                Text(
                    o.label,
                    color = fg,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                    fontSize = (13.5f * scale).sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                o.count?.let {
                    Text("$it", color = if (focused) OpenTvColors.OnContent.copy(alpha = 0.6f) else OpenTvColors.TextSubtle, fontSize = (12f * scale).sp)
                }
            }
        }
    }
}
