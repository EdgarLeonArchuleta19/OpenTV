package com.techpoint.opentv.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Exact visual design tokens ported 1:1 from OpenTV Desktop (`tailwind.config.cjs`,
 * `01-base.css`, `07-inicio-hero-perfiles.css`, `10-teles.css`, `13-acento.css`,
 * and `core/appearance.js`).
 */
object OpenTvColors {
    val BgCanvas = Color(0xFF0E0E11)
    val Ink950 = Color(0xFF000000)
    val Ink900 = Color(0xFF0B0B0B)
    val Ink850 = Color(0xFF111111)
    val Ink800 = Color(0xFF161616)
    val CardSurface = Color(0xFF18181D)
    val Ink700 = Color(0xFF1F1F1F)
    val Ink600 = Color(0xFF2A2A2A)

    val GlassFill = Color(0x0FFFFFFF)        // white @ 6%
    val GlassFillHover = Color(0x1CFFFFFF)   // white @ 11%
    val GlassFillFocus = Color(0x24FFFFFF)   // white @ 14%
    val GlassBorder = Color(0x17FFFFFF)      // white @ 9%
    val GlassBorderStrong = Color(0x29FFFFFF)// white @ 16%
    val SubtleDivider = Color(0x12FFFFFF)    // white @ 7%

    val TextPrimary = Color(0xFFFFFFFF)
    val TextSecondary = Color(0xB8FFFFFF)    // white @ 72%
    val TextMuted = Color(0x88FFFFFF)        // white @ 53%
    val TextSubtle = Color(0x52FFFFFF)       // white @ 32%

    val StarGold = Color(0xFFFFD34D)
    val SuccessGreen = Color(0xFF22C55E)
    val MintGreen = Color(0xFF7EE2A8)
    val ErrorRed = Color(0xFFEF4444)
    val LiveRed = Color(0xFFFF4D4F)
}

@Immutable
data class OpenTvAccent(
    val id: String,
    val label: String,
    val color: Color,
    val onAccent: Color,
)

object OpenTvAccents {
    val All: List<OpenTvAccent> = listOf(
        OpenTvAccent("white", "Blanco", Color(0xFFFFFFFF), Color(0xFF0E0E11)),
        OpenTvAccent("red", "Rojo", Color(0xFFE50914), Color(0xFFFFFFFF)),
        OpenTvAccent("blue", "Azul", Color(0xFF3B82F6), Color(0xFFFFFFFF)),
        OpenTvAccent("purple", "Morado", Color(0xFF8B5CF6), Color(0xFFFFFFFF)),
        OpenTvAccent("green", "Verde", Color(0xFF22C55E), Color(0xFF0E0E11)),
        OpenTvAccent("amber", "Ámbar", Color(0xFFF59E0B), Color(0xFF0E0E11)),
    )

    fun byId(id: String): OpenTvAccent = All.firstOrNull { it.id == id } ?: All.first()
}

@Immutable
data class OpenTvUiConfig(
    val isTv: Boolean = false,
    val isLowSpec: Boolean = false,
    val accent: OpenTvAccent = OpenTvAccents.All.first(),
    val textLarge: Boolean = false,
    val tvMarginIndex: Int = 0, // 0 = Ninguno, 1 = Pequeño (2.5%), 2 = Grande (5%)
) {
    val textScale: Float get() = if (textLarge) 1.12f else 1.0f
    val tvOverscanFraction: Float get() = when {
        !isTv -> 0f
        tvMarginIndex == 1 -> 0.025f
        tvMarginIndex == 2 -> 0.05f
        else -> 0f
    }
}

val LocalOpenTvUi = staticCompositionLocalOf { OpenTvUiConfig() }

private val OpenTvShapes = Shapes(
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(14.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(20.dp),
)

private fun openTvTypography(scale: Float): Typography {
    val display = FontFamily.SansSerif
    return Typography(
        displayLarge = TextStyle(
            fontFamily = display,
            fontWeight = FontWeight.ExtraBold,
            fontSize = (42f * scale).sp,
            lineHeight = (44f * scale).sp,
            letterSpacing = (-0.8).sp,
            color = OpenTvColors.TextPrimary,
        ),
        headlineLarge = TextStyle(
            fontFamily = display,
            fontWeight = FontWeight.Bold,
            fontSize = (28f * scale).sp,
            lineHeight = (32f * scale).sp,
            letterSpacing = (-0.5).sp,
            color = OpenTvColors.TextPrimary,
        ),
        headlineMedium = TextStyle(
            fontFamily = display,
            fontWeight = FontWeight.Bold,
            fontSize = (22f * scale).sp,
            lineHeight = (26f * scale).sp,
            letterSpacing = (-0.3).sp,
            color = OpenTvColors.TextPrimary,
        ),
        titleLarge = TextStyle(
            fontFamily = display,
            fontWeight = FontWeight.SemiBold,
            fontSize = (18f * scale).sp,
            lineHeight = (22f * scale).sp,
            letterSpacing = (-0.2).sp,
            color = OpenTvColors.TextPrimary,
        ),
        titleMedium = TextStyle(
            fontFamily = display,
            fontWeight = FontWeight.SemiBold,
            fontSize = (15f * scale).sp,
            lineHeight = (20f * scale).sp,
            color = OpenTvColors.TextPrimary,
        ),
        bodyLarge = TextStyle(
            fontFamily = display,
            fontWeight = FontWeight.Normal,
            fontSize = (15f * scale).sp,
            lineHeight = (22f * scale).sp,
            color = OpenTvColors.TextSecondary,
        ),
        bodyMedium = TextStyle(
            fontFamily = display,
            fontWeight = FontWeight.Normal,
            fontSize = (13.5f * scale).sp,
            lineHeight = (19f * scale).sp,
            color = OpenTvColors.TextSecondary,
        ),
        labelLarge = TextStyle(
            fontFamily = display,
            fontWeight = FontWeight.SemiBold,
            fontSize = (14f * scale).sp,
            lineHeight = (18f * scale).sp,
            color = OpenTvColors.TextPrimary,
        ),
        labelMedium = TextStyle(
            fontFamily = display,
            fontWeight = FontWeight.Medium,
            fontSize = (12f * scale).sp,
            lineHeight = (16f * scale).sp,
            color = OpenTvColors.TextMuted,
        ),
    )
}

@Composable
fun OpenTvTheme(
    config: OpenTvUiConfig = OpenTvUiConfig(),
    content: @Composable () -> Unit,
) {
    val scheme = darkColorScheme(
        primary = config.accent.color,
        onPrimary = config.accent.onAccent,
        secondary = OpenTvColors.Ink700,
        onSecondary = OpenTvColors.TextPrimary,
        background = OpenTvColors.BgCanvas,
        onBackground = OpenTvColors.TextPrimary,
        surface = OpenTvColors.Ink900,
        onSurface = OpenTvColors.TextPrimary,
        surfaceVariant = OpenTvColors.CardSurface,
        onSurfaceVariant = OpenTvColors.TextSecondary,
        outline = OpenTvColors.GlassBorder,
        error = OpenTvColors.ErrorRed,
        onError = OpenTvColors.TextPrimary,
    )

    CompositionLocalProvider(LocalOpenTvUi provides config) {
        MaterialTheme(
            colorScheme = scheme,
            typography = openTvTypography(config.textScale),
            shapes = OpenTvShapes,
            content = content,
        )
    }
}
