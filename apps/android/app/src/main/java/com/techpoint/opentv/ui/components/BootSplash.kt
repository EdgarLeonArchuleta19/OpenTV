package com.techpoint.opentv.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.Shader
import androidx.compose.ui.graphics.RadialGradientShader
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlin.math.max

/**
 * 1:1 port of the OpenTV v1 boot splash (`ui/index.html` + `12-carga.css`):
 * radial #1b1b21 → #0e0e11, "OpenTV" wordmark, subtitle and three pulsing dots.
 */
@Composable
fun BootSplash(modifier: Modifier = Modifier) {
    val bg = remember {
        object : ShaderBrush() {
            override fun createShader(size: Size): Shader = RadialGradientShader(
                center = Offset(size.width * 0.5f, size.height * 0.45f),
                radius = max(size.width, size.height) * 0.6f,
                colors = listOf(Color(0xFF1B1B21), Color(0xFF0E0E11)),
                colorStops = listOf(0f, 0.7f),
            )
        }
    }
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF0E0E11))
            .background(bg),
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                text = "OpenTV",
                color = Color.White,
                fontSize = 30.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-0.01).em,
            )
            Text(
                text = "Preparando tu catálogo…",
                color = Color(0x80FFFFFF),
                fontSize = 14.sp,
            )
            Spacer(Modifier.height(2.dp))
            BootDots()
        }
    }
}

@Composable
private fun BootDots() {
    val transition = rememberInfiniteTransition(label = "bootDots")
    Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
        repeat(3) { i ->
            val p by transition.animateFloat(
                initialValue = 0f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(
                    animation = tween(600, easing = LinearEasing),
                    repeatMode = RepeatMode.Reverse,
                    initialStartOffset = StartOffset(i * 160),
                ),
                label = "dot$i",
            )
            Box(
                modifier = Modifier
                    .size(7.dp)
                    .graphicsLayer {
                        alpha = 0.25f + 0.75f * p
                        val s = 0.7f + 0.3f * p
                        scaleX = s
                        scaleY = s
                    }
                    .clip(CircleShape)
                    .background(Color.White),
            )
        }
    }
}
