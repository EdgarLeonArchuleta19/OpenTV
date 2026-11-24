package com.techpoint.opentv.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.window.Dialog
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.techpoint.opentv.ui.theme.LocalOpenTvUi

/**
 * 4-digit PIN entry for the remote (Fire TV remotes have no number keys and the system IME
 * is clumsy): four dots and a 3x4 keypad walked with the D-pad and OK. No text field.
 */
@Composable
fun TvPinPad(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    firstKeyFocus: FocusRequester? = null,
    error: Boolean = false,
    keySize: Dp = 46.dp,
) {
    val scale = LocalOpenTvUi.current.textScale
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = modifier,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier) {
            repeat(4) { i ->
                val filled = i < value.length
                Box(
                    Modifier
                        .size(14.dp)
                        .clip(CircleShape)
                        .background(if (filled) Color.White else Color.Transparent)
                        .border(1.5.dp, if (error) Color(0xFFFF7377) else Color(0x80FFFFFF), CircleShape),
                )
            }
        }
        val rows = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("⌫", "0", "C"))
        rows.forEachIndexed { r, row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEachIndexed { c, k ->
                    PinKey(
                        label = k,
                        size = keySize,
                        fontScale = scale,
                        modifier = if (r == 0 && c == 0 && firstKeyFocus != null) Modifier.focusRequester(firstKeyFocus) else Modifier,
                        onClick = {
                            when (k) {
                                "⌫" -> onValueChange(value.dropLast(1))
                                "C" -> onValueChange("")
                                else -> if (value.length < 4) onValueChange(value + k)
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun PinKey(label: String, size: Dp, fontScale: Float, modifier: Modifier, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(10.dp)
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .size(width = size * 1.3f, height = size)
            .clip(shape)
            .background(if (focused) Color.White else Color(0x14FFFFFF))
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
    ) {
        Text(
            label,
            color = if (focused) Color(0xFF0E0E11) else Color.White,
            fontSize = (17f * fontScale).sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

/**
 * Dialog around [TvPinPad]. [onComplete] gets the 4 digits and returns whether they were
 * accepted; when not, the dots turn red and the entry restarts ("PIN incorrecto").
 */
@Composable
fun TvPinDialog(
    title: String,
    subtitle: String,
    onDismiss: () -> Unit,
    onComplete: (String) -> Boolean,
) {
    val scale = LocalOpenTvUi.current.textScale
    var value by remember { mutableStateOf("") }
    var wrong by remember { mutableStateOf(false) }
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        withFrameNanos { }
        withFrameNanos { }
        runCatching { first.requestFocus() }
    }
    Dialog(onDismissRequest = onDismiss) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .clip(RoundedCornerShape(22.dp))
                .background(Color(0xFF141418))
                .border(1.dp, Color(0x1AFFFFFF), RoundedCornerShape(22.dp))
                .padding(horizontal = 30.dp, vertical = 24.dp),
        ) {
            Text(title, color = Color.White, fontSize = (20f * scale).sp, fontWeight = FontWeight.Bold)
            Text(subtitle, color = Color(0x8CFFFFFF), fontSize = (13f * scale).sp)
            TvPinPad(
                value = value,
                error = wrong,
                firstKeyFocus = first,
                onValueChange = { v ->
                    wrong = false
                    value = v
                    if (v.length == 4) {
                        if (!onComplete(v)) {
                            wrong = true
                            value = ""
                        }
                    }
                },
            )
            if (wrong) {
                Text("PIN incorrecto", color = Color(0xFFFF7377), fontSize = (13f * scale).sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}