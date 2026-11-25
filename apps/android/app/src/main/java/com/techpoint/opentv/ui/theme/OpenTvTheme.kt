package com.techpoint.opentv.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
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
 * Theme-aware color tokens. The dark palette is the exact OpenTV Desktop look
 * (`tailwind.config.cjs`, `01-base.css`, `13-acento.css`, ...); the light palette is a
 * neutral counterpart. Instances are immutable and provided once through
 * [LocalOpenTvPalette] (a static local: switching theme recomposes the tree once, reading
 * a token costs nothing extra).
 */
@Immutable
data class OpenTvPalette(
    val isLight: Boolean,
    val bgCanvas: Color,
    val ink950: Color,
    val ink900: Color,
    val ink850: Color,
    val ink800: Color,
    val cardSurface: Color,
    val ink700: Color,
    val ink600: Color,
    /** Main foreground ("white" in dark, near-black in light): text, icons, TV focus rings. */
    val content: Color,
    /** Ink drawn on top of a [content]-colored fill (focused TV pills, primary buttons). */
    val onContent: Color,
    /** Modal / sheet / dialog surface. */
    val sheet: Color,
    /** Scrim behind dialogs. */
    val scrim: Color,
) {
    /**
     * [content] at a v1-style opacity. White-alpha values were tuned on the dark canvas;
     * in light mode text-range alphas (>= 0.3) are lifted so muted text keeps >= 4.5:1
     * on #F6F6F8, and fill/border alphas are kept as they are.
     */
    fun fg(alpha: Float): Color = content.copy(alpha = lightAlpha(alpha, isLight))

    val glassFill: Color get() = fg(0.06f)
    val glassFillHover: Color get() = fg(0.11f)
    val glassFillFocus: Color get() = fg(0.14f)
    val glassBorder: Color get() = fg(0.09f)
    val glassBorderStrong: Color get() = fg(0.16f)
    val subtleDivider: Color get() = fg(0.07f)
    val textPrimary: Color get() = content
    val textSecondary: Color get() = fg(0.72f)
    val textMuted: Color get() = if (isLight) Color(0xFF5B5B66) else fg(0.53f)
    val textSubtle: Color get() = fg(0.32f)

    companion object {
        /** Maps a dark-theme white alpha to the alpha used on the light canvas. */
        fun lightAlpha(alpha: Float, isLight: Boolean): Float {
            if (!isLight) return alpha
            if (alpha < 0.3f) return (alpha * 1.15f).coerceAtMost(1f)
            return (0.62f + (alpha - 0.3f) / 0.7f * 0.38f).coerceIn(0f, 1f)
        }
    }
}

object OpenTvPalettes {
    val Dark = OpenTvPalette(
        isLight = false,
        bgCanvas = Color(0xFF0E0E11),
        ink950 = Color(0xFF000000),
        ink900 = Color(0xFF0B0B0B),
        ink850 = Color(0xFF111111),
        ink800 = Color(0xFF161616),
        cardSurface = Color(0xFF18181D),
        ink700 = Color(0xFF1F1F1F),
        ink600 = Color(0xFF2A2A2A),
        content = Color(0xFFFFFFFF),
        onContent = Color(0xFF0E0E11),
        sheet = Color(0xFF15151A),
        scrim = Color(0xB3000000),
    )

    val Light = OpenTvPalette(
        isLight = true,
        bgCanvas = Color(0xFFF6F6F8),
        ink950 = Color(0xFFFFFFFF),
        ink900 = Color(0xFFFFFFFF),
        ink850 = Color(0xFFF1F1F4),
        ink800 = Color(0xFFEEEEF1),
        cardSurface = Color(0xFFFFFFFF),
        ink700 = Color(0xFFE6E6EA),
        ink600 = Color(0xFFDADADF),
        content = Color(0xFF111114),
        onContent = Color(0xFFFFFFFF),
        sheet = Color(0xFFFFFFFF),
        scrim = Color(0x66000000),
    )

    const val DARK_ID = "dark"
    const val LIGHT_ID = "light"

    /** Resolves the persisted theme id; anything unknown falls back to dark (the default). */
    fun byId(id: String?): OpenTvPalette = if (id == LIGHT_ID) Light else Dark
}

val LocalOpenTvPalette = staticCompositionLocalOf { OpenTvPalettes.Dark }

/**
 * Token accessors. Theme-dependent tokens read [LocalOpenTvPalette] (composable getters);
 * status colors (gold, green, red) are the same in both themes.
 */
object OpenTvColors {
    val palette: OpenTvPalette @Composable @ReadOnlyComposable get() = LocalOpenTvPalette.current
    val isLight: Boolean @Composable @ReadOnlyComposable get() = LocalOpenTvPalette.current.isLight

    val BgCanvas: Color @Composable @ReadOnlyComposable get() = palette.bgCanvas
    val Ink950: Color @Composable @ReadOnlyComposable get() = palette.ink950
    val Ink900: Color @Composable @ReadOnlyComposable get() = palette.ink900
    val Ink850: Color @Composable @ReadOnlyComposable get() = palette.ink850
    val Ink800: Color @Composable @ReadOnlyComposable get() = palette.ink800
    val CardSurface: Color @Composable @ReadOnlyComposable get() = palette.cardSurface
    val Ink700: Color @Composable @ReadOnlyComposable get() = palette.ink700
    val Ink600: Color @Composable @ReadOnlyComposable get() = palette.ink600
    val Sheet: Color @Composable @ReadOnlyComposable get() = palette.sheet
    val Scrim: Color @Composable @ReadOnlyComposable get() = palette.scrim

    /** "White" ink of the dark theme: near-black in light mode. */
    val Content: Color @Composable @ReadOnlyComposable get() = palette.content
    val OnContent: Color @Composable @ReadOnlyComposable get() = palette.onContent
    /** TV focus ring (white in dark, dark in light). */
    val FocusRing: Color @Composable @ReadOnlyComposable get() = palette.content

    val GlassFill: Color @Composable @ReadOnlyComposable get() = palette.glassFill
    val GlassFillHover: Color @Composable @ReadOnlyComposable get() = palette.glassFillHover
    val GlassFillFocus: Color @Composable @ReadOnlyComposable get() = palette.glassFillFocus
    val GlassBorder: Color @Composable @ReadOnlyComposable get() = palette.glassBorder
    val GlassBorderStrong: Color @Composable @ReadOnlyComposable get() = palette.glassBorderStrong
    val SubtleDivider: Color @Composable @ReadOnlyComposable get() = palette.subtleDivider

    val TextPrimary: Color @Composable @ReadOnlyComposable get() = palette.textPrimary
    val TextSecondary: Color @Composable @ReadOnlyComposable get() = palette.textSecondary
    val TextMuted: Color @Composable @ReadOnlyComposable get() = palette.textMuted
    val TextSubtle: Color @Composable @ReadOnlyComposable get() = palette.textSubtle

    /** [OpenTvPalette.content] at a dark-theme white alpha (see [OpenTvPalette.fg]). */
    @Composable
    @ReadOnlyComposable
    fun fg(alpha: Float): Color = palette.fg(alpha)

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

    /** The monochrome "white" accent on the light theme: near-black with white ink. */
    val MonoOnLight = OpenTvAccent("white", "Negro", Color(0xFF111114), Color(0xFFFFFFFF))

    fun byId(id: String): OpenTvAccent = All.firstOrNull { it.id == id } ?: All.first()

    /** Accent as drawn on the given theme (only the monochrome accent changes). */
    fun forTheme(accent: OpenTvAccent, light: Boolean): OpenTvAccent =
        if (light && accent.id == "white") MonoOnLight else byId(accent.id)

    fun byId(id: String, light: Boolean): OpenTvAccent = forTheme(byId(id), light)
}

@Immutable
data class OpenTvUiConfig(
    val isTv: Boolean = false,
    val isLowSpec: Boolean = false,
    /** "Modo ligero" chosen by the user: no backdrops or episode thumbnails, smaller art. */
    val liteMode: Boolean = false,
    /** Accent already resolved for [lightTheme] (see [OpenTvAccents.forTheme]). */
    val accent: OpenTvAccent = OpenTvAccents.All.first(),
    val textLarge: Boolean = false,
    val tvMarginIndex: Int = 0, // 0 = Ninguno, 1 = Pequeño (2.5%), 2 = Grande (5%)
    val lightTheme: Boolean = false,
) {
    /**
     * Per-call text multiplier. "Texto aumentado" is applied globally through the
     * LocalDensity font scale in [OpenTvTheme] (see [TEXT_LARGE_SCALE]), so this stays 1
     * to avoid scaling twice. Kept for call sites that still multiply by it.
     */
    val textScale: Float get() = 1.0f

    val palette: OpenTvPalette get() = if (lightTheme) OpenTvPalettes.Light else OpenTvPalettes.Dark

    val tvOverscanFraction: Float get() = when {
        !isTv -> 0f
        tvMarginIndex == 1 -> 0.025f
        tvMarginIndex == 2 -> 0.05f
        else -> 0f
    }

    /** Same config on the dark theme (the player always stays dark). */
    fun forcedDark(): OpenTvUiConfig =
        if (!lightTheme) this else copy(lightTheme = false, accent = OpenTvAccents.byId(accent.id))
}

/** Global "Texto aumentado" multiplier applied on top of the system font scale. */
const val TEXT_LARGE_SCALE = 1.12f

/** Font scale for the whole app: system scale, times +12 % when "Texto aumentado" is on. */
fun appFontScale(systemFontScale: Float, textLarge: Boolean): Float =
    if (textLarge) systemFontScale * TEXT_LARGE_SCALE else systemFontScale

val LocalOpenTvUi = staticCompositionLocalOf { OpenTvUiConfig() }

private val OpenTvShapes = Shapes(
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(14.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(20.dp),
)

private fun openTvTypography(p: OpenTvPalette): Typography {
    val display = FontFamily.SansSerif
    return Typography(
        displayLarge = TextStyle(
            fontFamily = display,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 42.sp,
            lineHeight = 44.sp,
            letterSpacing = (-0.8).sp,
            color = p.textPrimary,
        ),
        headlineLarge = TextStyle(
            fontFamily = display,
            fontWeight = FontWeight.Bold,
            fontSize = 28.sp,
            lineHeight = 32.sp,
            letterSpacing = (-0.5).sp,
            color = p.textPrimary,
        ),
        headlineMedium = TextStyle(
            fontFamily = display,
            fontWeight = FontWeight.Bold,
            fontSize = 22.sp,
            lineHeight = 26.sp,
            letterSpacing = (-0.3).sp,
            color = p.textPrimary,
        ),
        titleLarge = TextStyle(
            fontFamily = display,
            fontWeight = FontWeight.SemiBold,
            fontSize = 18.sp,
            lineHeight = 22.sp,
            letterSpacing = (-0.2).sp,
            color = p.textPrimary,
        ),
        titleMedium = TextStyle(
            fontFamily = display,
            fontWeight = FontWeight.SemiBold,
            fontSize = 15.sp,
            lineHeight = 20.sp,
            color = p.textPrimary,
        ),
        bodyLarge = TextStyle(
            fontFamily = display,
            fontWeight = FontWeight.Normal,
            fontSize = 15.sp,
            lineHeight = 22.sp,
            color = p.textSecondary,
        ),
        bodyMedium = TextStyle(
            fontFamily = display,
            fontWeight = FontWeight.Normal,
            fontSize = 13.5.sp,
            lineHeight = 19.sp,
            color = p.textSecondary,
        ),
        labelLarge = TextStyle(
            fontFamily = display,
            fontWeight = FontWeight.SemiBold,
            fontSize = 14.sp,
            lineHeight = 18.sp,
            color = p.textPrimary,
        ),
        labelMedium = TextStyle(
            fontFamily = display,
            fontWeight = FontWeight.Medium,
            fontSize = 12.sp,
            lineHeight = 16.sp,
            color = p.textMuted,
        ),
    )
}

private val TypographyDark = openTvTypography(OpenTvPalettes.Dark)
private val TypographyLight = openTvTypography(OpenTvPalettes.Light)

private fun colorSchemeFor(p: OpenTvPalette, accent: OpenTvAccent): ColorScheme {
    val base = if (p.isLight) lightColorScheme() else darkColorScheme()
    return base.copy(
        primary = accent.color,
        onPrimary = accent.onAccent,
        secondary = p.ink700,
        onSecondary = p.textPrimary,
        background = p.bgCanvas,
        onBackground = p.textPrimary,
        surface = p.ink900,
        onSurface = p.textPrimary,
        surfaceVariant = p.cardSurface,
        onSurfaceVariant = p.textSecondary,
        outline = p.glassBorder,
        error = OpenTvColors.ErrorRed,
        onError = Color.White,
    )
}

/**
 * App theme root. Provides the palette, the UI config and the global text scale
 * ("Texto aumentado" = system font scale x 1.12 through LocalDensity, so every `sp` in
 * the app, Ajustes included, grows exactly once).
 */
@Composable
fun OpenTvTheme(
    config: OpenTvUiConfig = OpenTvUiConfig(),
    content: @Composable () -> Unit,
) {
    val palette = config.palette
    val scheme = remember(palette, config.accent) { colorSchemeFor(palette, config.accent) }
    val base = LocalDensity.current
    val density = remember(base.density, base.fontScale, config.textLarge) {
        Density(base.density, appFontScale(base.fontScale, config.textLarge))
    }
    CompositionLocalProvider(
        LocalOpenTvUi provides config,
        LocalOpenTvPalette provides palette,
        LocalDensity provides density,
    ) {
        MaterialTheme(
            colorScheme = scheme,
            typography = if (palette.isLight) TypographyLight else TypographyDark,
            shapes = OpenTvShapes,
            content = content,
        )
    }
}

/**
 * Forces the dark theme for [content] (the player and other video surfaces stay dark in
 * every theme). Text scale is already applied by the outer [OpenTvTheme], so only the
 * palette, accent and Material scheme are swapped here.
 */
@Composable
fun OpenTvForceDark(content: @Composable () -> Unit) {
    val cfg = LocalOpenTvUi.current
    if (!cfg.lightTheme) {
        content()
        return
    }
    val dark = remember(cfg) { cfg.forcedDark() }
    val scheme = remember(dark.accent) { colorSchemeFor(OpenTvPalettes.Dark, dark.accent) }
    CompositionLocalProvider(
        LocalOpenTvUi provides dark,
        LocalOpenTvPalette provides OpenTvPalettes.Dark,
    ) {
        MaterialTheme(colorScheme = scheme, typography = TypographyDark, shapes = OpenTvShapes, content = content)
    }
}
