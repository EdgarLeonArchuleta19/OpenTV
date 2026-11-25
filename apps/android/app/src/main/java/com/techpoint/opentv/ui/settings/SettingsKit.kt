package com.techpoint.opentv.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.techpoint.opentv.ui.components.leftExitGroup
import com.techpoint.opentv.ui.components.rememberFocus
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import com.techpoint.opentv.ui.theme.LocalOpenTvPalette
import com.techpoint.opentv.ui.theme.OpenTvColors
import com.techpoint.opentv.ui.theme.OpenTvPalette
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardActions

/**
 * Shared building blocks of the v1 TV "Ajustes" look (`04-en-vivo-ajustes-posteres.css`,
 * `11-fuentes-stremio.css`). v1 draws a 1920x1080 canvas, so 1 v1 px = 0.5 dp.
 * Every focusable here has a visible TV focus state (white ring / fill) and exactly one
 * focus target (clickable with a shared interaction source, no extra `focusable`).
 */
internal object SetColors {
    private val p: OpenTvPalette @Composable @ReadOnlyComposable get() = LocalOpenTvPalette.current
    private val light: Boolean @Composable @ReadOnlyComposable get() = LocalOpenTvPalette.current.isLight

    val MenuBg: Color @Composable @ReadOnlyComposable get() = p.ink900
    val MenuBorder: Color @Composable @ReadOnlyComposable get() = p.fg(0.10f)        // white 10%
    val MenuText: Color @Composable @ReadOnlyComposable get() = if (light) Color(0xFF5B5B66) else Color(0xFF9A9A9A)
    val MenuSelected: Color @Composable @ReadOnlyComposable get() = p.fg(0.09f)      // white 9%
    val MenuFocused: Color @Composable @ReadOnlyComposable get() = p.fg(0.16f)       // white 16%
    val GroupFill: Color @Composable @ReadOnlyComposable get() = if (light) Color(0xFFFFFFFF) else Color(0x09FFFFFF) // white 3.5%
    val GroupBorder: Color @Composable @ReadOnlyComposable get() = p.fg(0.08f)       // white 8%
    val RowDivider: Color @Composable @ReadOnlyComposable get() = p.fg(0.07f)        // white 7%
    val TabTrack: Color @Composable @ReadOnlyComposable get() = p.fg(0.06f)          // white 6%
    val SegTrack: Color @Composable @ReadOnlyComposable get() = p.fg(0.07f)          // white 7%
    val SoftFill: Color @Composable @ReadOnlyComposable get() = p.fg(0.07f)          // white 7%
    val FocusFill: Color @Composable @ReadOnlyComposable get() = p.fg(0.16f)         // white 16%
    val Primary: Color @Composable @ReadOnlyComposable get() = if (light) Color(0xFF2A2A30) else Color(0xFFE9E7E2)
    val OnPrimary: Color @Composable @ReadOnlyComposable get() = if (light) Color(0xFFFFFFFF) else Color(0xFF15151A)
    val Ink: Color @Composable @ReadOnlyComposable get() = p.onContent
    /** Main ink ("white" on dark). */
    val Text: Color @Composable @ReadOnlyComposable get() = p.content
    val Text70: Color @Composable @ReadOnlyComposable get() = p.fg(0.70f)
    val Text65: Color @Composable @ReadOnlyComposable get() = p.fg(0.65f)
    val Text55: Color @Composable @ReadOnlyComposable get() = p.fg(0.55f)
    val Text50: Color @Composable @ReadOnlyComposable get() = p.fg(0.50f)
    val Text45: Color @Composable @ReadOnlyComposable get() = p.fg(0.45f)
    val Text42: Color @Composable @ReadOnlyComposable get() = p.fg(0.42f)
    val Text35: Color @Composable @ReadOnlyComposable get() = p.fg(0.35f)
    val Warn: Color @Composable @ReadOnlyComposable get() = if (light) Color(0xFF9A6700) else Color(0xFFF5C26B)
    val Danger: Color @Composable @ReadOnlyComposable get() = if (light) Color(0xFFC62828) else Color(0xFFFF8A8A)
    val Ok: Color @Composable @ReadOnlyComposable get() = if (light) Color(0xFF15803D) else Color(0xFF7EE2A8)
}

/**
 * Extra size for Ajustes on TV (read from 2-3 m away): +25 % on text and on the controls
 * that hold it. Phones keep 1.0. Combined with the user "Tamaño del texto" (+12 %) setting.
 */
internal const val SET_TV_BOOST = 1.25f

@Composable
internal fun setBoost(): Float = if (LocalOpenTvUi.current.isTv) SET_TV_BOOST else 1f

/** Ajustes text size, boosted on TV. "Texto aumentado" (+12 %) is applied globally by the theme (font scale). */
@Composable
internal fun tsp(value: Float): TextUnit = (value * setBoost()).sp

/** Draws a ring around the element with a small gap (like v1 `box-shadow: 0 0 0 3px`). */
@Composable
internal fun Modifier.outerRing(focused: Boolean, shape: Shape, color: Color = OpenTvColors.FocusRing, gap: Dp = 2.5.dp): Modifier =
    this
        .border(1.5.dp, if (focused) color else Color.Transparent, shape)
        .padding(gap)

/** Requests focus on [requester] after the first frames (focus targets must be attached). */
@Composable
internal fun RequestFocusOnStart(requester: FocusRequester, key: Any? = Unit, enabled: Boolean = true) {
    LaunchedEffect(key, enabled) {
        if (!enabled) return@LaunchedEffect
        repeat(2) { androidx.compose.runtime.withFrameNanos { } }
        runCatching { requester.requestFocus() }
    }
}

@Composable
internal fun SetPanelTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        color = SetColors.Text,
        fontSize = tsp(27f),
        fontWeight = FontWeight(650),
        letterSpacing = (-0.3).sp,
        maxLines = 1,
        modifier = modifier,
    )
}

/** v1 `.sd-tabs`: pill track white 6 %, tabs 11 sp, selected white with dark text. */
@Composable
internal fun SetSubTabs(
    tabs: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(SetColors.TabTrack)
            .padding(1.dp)
            .leftExitGroup(),
    ) {
        tabs.forEach { (id, label) ->
            SetSegButton(
                label = label,
                selected = id == selected,
                onClick = { onSelect(id) },
                fontSize = 11f,
                hPad = 15.dp,
                vPad = 6.5.dp,
                radius = 7.dp,
            )
        }
    }
}

/** v1 `.set-group`: radius 10, fill white 3.5 %, uppercase 8.5 sp title. */
@Composable
internal fun SetGroup(
    title: String?,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(10.dp)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .background(SetColors.GroupFill)
            .border(0.5.dp, SetColors.GroupBorder, shape),
    ) {
        if (!title.isNullOrBlank()) {
            Text(
                text = title.uppercase(),
                color = SetColors.Text45,
                fontSize = tsp(8.5f),
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.08.em,
                modifier = Modifier.padding(start = 15.dp, end = 15.dp, top = 10.dp, bottom = 3.dp),
            )
        }
        content()
    }
}

/** v1 `.set-row`: name on the left, control on the right, >= 46 dp, divider between rows. */
@Composable
internal fun SetRow(
    name: String,
    hint: String? = null,
    divider: Boolean = true,
    content: @Composable RowScope.() -> Unit = {},
) {
    val rowDivider = SetColors.RowDivider
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 46.dp * setBoost())
            .drawBehind {
                if (divider) {
                    drawRect(rowDivider, topLeft = Offset.Zero, size = Size(size.width, 0.5.dp.toPx()))
                }
            }
            .padding(horizontal = 15.dp, vertical = 8.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(name, color = SetColors.Text, fontSize = tsp(12.5f), fontWeight = FontWeight(550))
            if (!hint.isNullOrBlank()) {
                Text(hint, color = SetColors.Text50, fontSize = tsp(8.5f), lineHeight = tsp(11f))
            }
        }
        Spacer(Modifier.width(14.dp))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.End,
            // ← from the first control of this row returns to the side menu (TV Ajustes).
            modifier = Modifier.weight(1.5f, fill = false).leftExitGroup(),
            content = content,
        )
    }
}

/** One option of a segmented selector (v1 `.set-seg-btn`). */
@Composable
internal fun SetSegButton(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    pill: Boolean = false,
    fontSize: Float = 10f,
    hPad: Dp = 11.dp,
    vPad: Dp = 5.5.dp,
    radius: Dp = 6.dp,
    leading: (@Composable () -> Unit)? = null,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val inner = if (pill) RoundedCornerShape(999.dp) else RoundedCornerShape(radius)
    val outer = if (pill) RoundedCornerShape(999.dp) else RoundedCornerShape(radius + 2.5.dp)
    Box(
        modifier = modifier.outerRing(focused, outer),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier
                .clip(inner)
                .background(
                    when {
                        selected -> ui.accent.color
                        focused -> SetColors.FocusFill
                        pill -> SetColors.SoftFill
                        else -> Color.Transparent
                    },
                )
                .rememberFocus()
                .clickable(interactionSource = interaction, indication = null, onClick = onClick)
                .padding(horizontal = hPad, vertical = vPad),
        ) {
            leading?.invoke()
            Text(
                text = label,
                color = when {
                    selected -> ui.accent.onAccent
                    focused -> SetColors.Text
                    else -> SetColors.Text70
                },
                fontSize = tsp(fontSize),
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
        }
    }
}

/** v1 `.set-seg`: single choice. [wrap] = pills that wrap onto several lines. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun SetSeg(
    options: List<String>,
    selected: Int,
    onSelect: (Int) -> Unit,
    wrap: Boolean = false,
) {
    if (wrap) {
        FlowRow(
            horizontalArrangement = Arrangement.End,
            verticalArrangement = Arrangement.spacedBy(1.dp),
        ) {
            options.forEachIndexed { idx, label ->
                SetSegButton(label = label, selected = idx == selected, onClick = { onSelect(idx) }, pill = true)
            }
        }
    } else {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .clip(RoundedCornerShape(9.dp))
                .background(SetColors.SegTrack)
                .padding(0.5.dp),
        ) {
            options.forEachIndexed { idx, label ->
                SetSegButton(label = label, selected = idx == selected, onClick = { onSelect(idx) })
            }
        }
    }
}

/** v1 modal / panel button: 29 dp, radius 7, 10 sp; primary #e9e7e2 with dark text. */
@Composable
internal fun SetButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    primary: Boolean = false,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    height: Dp = 29.dp,
    radius: Dp = 7.dp,
    fontSize: Float = 10f,
    danger: Boolean = false,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val inner = RoundedCornerShape(radius)
    val isWhiteAccent = ui.accent.id == "white"
    val bg = when {
        primary && !isWhiteAccent -> ui.accent.color
        primary && focused -> SetColors.Text
        primary -> SetColors.Primary
        focused -> SetColors.FocusFill
        else -> SetColors.SoftFill
    }
    val fg = when {
        primary && !isWhiteAccent -> ui.accent.onAccent
        primary -> SetColors.OnPrimary
        danger -> SetColors.Danger
        else -> SetColors.Text
    }
    Box(modifier = modifier.outerRing(focused, RoundedCornerShape(radius + 2.5.dp))) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier
                .height(height * setBoost())
                .clip(inner)
                .background(bg)
                .rememberFocus()
                .clickable(enabled = enabled, interactionSource = interaction, indication = null, onClick = onClick)
                .padding(horizontal = 12.dp)
                .alpha(if (enabled) 1f else 0.5f),
        ) {
            if (icon != null) {
                Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(13.dp * setBoost()))
            }
            Text(
                text = text,
                color = fg,
                fontSize = tsp(fontSize),
                fontWeight = if (primary) FontWeight.Bold else FontWeight.SemiBold,
                maxLines = 1,
            )
        }
    }
}

/** Single line text field with a visible TV focus ring. */
@Composable
internal fun SetTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    keyboardType: KeyboardType = KeyboardType.Uri,
    password: Boolean = false,
    focusRequester: FocusRequester? = null,
    leading: (@Composable () -> Unit)? = null,
    onDone: (() -> Unit)? = null,
) {
    val isTv = LocalOpenTvUi.current.isTv
    val interaction = remember { MutableInteractionSource() }
    val innerFocused by interaction.collectIsFocusedAsState()
    val outerInteraction = remember { MutableInteractionSource() }
    val outerFocused by outerInteraction.collectIsFocusedAsState()
    val focused = innerFocused || outerFocused
    val inner = RoundedCornerShape(7.dp)
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    // TV: D-pad focus lands on the outer box, which never starts an input session (the
    // Fire TV keyboard pops on any input session, even with showKeyboardOnFocus = false).
    // OK on the box enables the real text field, focuses it and opens the keyboard.
    var editing by remember { mutableStateOf(false) }
    val fieldFocus = remember { FocusRequester() }
    var fieldHadFocus by remember { mutableStateOf(false) }
    LaunchedEffect(editing) {
        if (editing) {
            runCatching { fieldFocus.requestFocus() }
            keyboard?.show()
        }
    }
    Box(
        modifier = modifier
            .outerRing(focused, RoundedCornerShape(9.5.dp))
            .then(
                if (isTv) {
                    Modifier
                        .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
                        .clickable(interactionSource = outerInteraction, indication = null) { editing = true }
                        .rememberFocus()
                } else {
                    Modifier
                },
            ),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
            modifier = Modifier
                .fillMaxWidth()
                .height(29.dp * setBoost())
                .clip(inner)
                .background(if (focused) SetColors.MenuBorder else SetColors.TabTrack)
                .border(0.5.dp, OpenTvColors.fg(0.12f), inner)
                .padding(horizontal = 10.dp),
        ) {
            leading?.invoke()
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty()) {
                    Text(
                        placeholder,
                        color = OpenTvColors.fg(0.4f),
                        fontSize = tsp(10f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    singleLine = true,
                    interactionSource = interaction,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = keyboardType,
                        imeAction = if (onDone != null) ImeAction.Done else ImeAction.Next,
                        // On TV, passing through a field must not pop the full-screen keyboard;
                        // it opens on OK (center) instead.
                        showKeyboardOnFocus = false,
                    ),
                    keyboardActions = KeyboardActions(
                        onDone = { onDone?.invoke() },
                        onNext = { focusManager.moveFocus(FocusDirection.Down) },
                    ),
                    visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
                    textStyle = TextStyle(color = SetColors.Text, fontSize = tsp(10.5f)),
                    cursorBrush = SolidColor(SetColors.Text),
                    modifier = Modifier
                        .fillMaxWidth()
                        .then(
                            if (isTv) {
                                Modifier
                                    .focusRequester(fieldFocus)
                                    .focusProperties { canFocus = editing }
                                    .onFocusChanged {
                                        // Leaving the field (↑/↓, Back) re-arms the OK gate.
                                        if (it.isFocused) fieldHadFocus = true
                                        else if (fieldHadFocus) { fieldHadFocus = false; editing = false }
                                    }
                            } else if (focusRequester != null) {
                                Modifier.focusRequester(focusRequester)
                            } else {
                                Modifier
                            },
                        )
                        // A text field swallows D-pad keys on TV; let ↑/↓ leave it and Enter submit,
                        // so the remote can always reach the buttons below.
                        .onPreviewKeyEvent { ev ->
                            if (ev.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                            when (ev.key) {
                                Key.DirectionCenter -> { keyboard?.show(); true }
                                Key.DirectionDown -> focusManager.moveFocus(FocusDirection.Down)
                                Key.DirectionUp -> focusManager.moveFocus(FocusDirection.Up)
                                Key.Enter, Key.NumPadEnter -> if (onDone != null) { onDone(); true } else focusManager.moveFocus(FocusDirection.Down)
                                else -> false
                            }
                        }
                        .then(if (isTv) Modifier else Modifier.rememberFocus()),
                )
            }
        }
    }
}

/** Left menu entry (v1 `.settings-item`): 39 dp, radius 7, inset bar when selected. */
@Composable
internal fun SetMenuItem(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    onSelect: () -> Unit,
    focusRequester: FocusRequester,
    selectOnFocus: Boolean,
    modifier: Modifier = Modifier,
    // → from the entry: the last focused control of the panel (read at key-press time).
    rightTarget: (() -> FocusRequester)? = null,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(7.dp)

    // TVs: resting on an entry for 220 ms shows its panel (like v1, no OK needed).
    if (selectOnFocus) {
        LaunchedEffect(focused) {
            if (focused && !selected) {
                kotlinx.coroutines.delay(220L)
                onSelect()
            }
        }
    }

    val fg = if (selected || focused) SetColors.Text else SetColors.MenuText
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .fillMaxWidth()
            .height(39.dp * setBoost())
            .focusRequester(focusRequester)
            .focusProperties { rightTarget?.let { right = it() } }
            .clip(shape)
            .background(
                when {
                    focused -> SetColors.MenuFocused
                    selected -> SetColors.MenuSelected
                    else -> Color.Transparent
                },
            )
            .drawBehind {
                if (selected) {
                    drawRect(ui.accent.color, topLeft = Offset.Zero, size = Size(1.5.dp.toPx(), size.height))
                }
            }
            .then(if (focused) Modifier.border(1.dp, OpenTvColors.FocusRing, shape) else Modifier)
            .clickable(interactionSource = interaction, indication = null, onClick = onSelect)
            .padding(start = 15.dp, end = 10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(15.dp * setBoost()))
        Spacer(Modifier.width(11.dp))
        Text(
            text = label,
            color = fg,
            fontSize = tsp(15f),
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
