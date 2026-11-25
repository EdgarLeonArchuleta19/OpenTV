package com.techpoint.opentv

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import com.techpoint.opentv.core.model.AppearancePrefs
import com.techpoint.opentv.ui.theme.OpenTvAccents
import com.techpoint.opentv.ui.theme.OpenTvPalette
import com.techpoint.opentv.ui.theme.OpenTvPalettes
import com.techpoint.opentv.ui.theme.OpenTvUiConfig
import com.techpoint.opentv.ui.theme.appFontScale
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class ThemePaletteTest {

    private fun contrast(a: Color, b: Color): Float {
        val la = a.luminance() + 0.05f
        val lb = b.luminance() + 0.05f
        return maxOf(la, lb) / minOf(la, lb)
    }

    @Test
    fun paletteSelectionDefaultsToDark() {
        assertSame(OpenTvPalettes.Dark, OpenTvPalettes.byId("dark"))
        assertSame(OpenTvPalettes.Light, OpenTvPalettes.byId("light"))
        assertSame(OpenTvPalettes.Dark, OpenTvPalettes.byId(null))
        assertSame(OpenTvPalettes.Dark, OpenTvPalettes.byId("sepia"))
        assertSame(OpenTvPalettes.Dark, OpenTvUiConfig().palette)
        assertSame(OpenTvPalettes.Light, OpenTvUiConfig(lightTheme = true).palette)
    }

    @Test
    fun darkPaletteKeepsTheOriginalLook() {
        val d = OpenTvPalettes.Dark
        assertEquals(Color(0xFF0E0E11), d.bgCanvas)
        assertEquals(Color.White, d.textPrimary)
        // White-alpha tokens are unchanged in dark mode.
        assertEquals(0.53f, d.fg(0.53f).alpha, 0.01f)
        assertEquals(Color(0x17FFFFFF).alpha, d.glassBorder.alpha, 0.01f)
    }

    @Test
    fun lightPaletteTextIsReadable() {
        val l = OpenTvPalettes.Light
        assertEquals(Color(0xFFF6F6F8), l.bgCanvas)
        assertEquals(Color(0xFF111114), l.textPrimary)
        assertTrue(contrast(l.textMuted, l.bgCanvas) >= 4.5f)
        assertTrue(contrast(l.textSecondary.compositeOver(l.bgCanvas), l.bgCanvas) >= 4.5f)
        // Any text-range alpha (>= 0.3 on dark) stays >= 4.5:1 on the light canvas.
        listOf(0.35f, 0.42f, 0.5f, 0.55f, 0.7f).forEach { a ->
            val c = l.fg(a).compositeOver(l.bgCanvas)
            assertTrue("alpha $a", contrast(c, l.bgCanvas) >= 4.5f)
        }
        // Fills/borders keep a light touch.
        assertTrue(l.glassBorder.alpha < 0.15f)
    }

    @Test
    fun lightAlphaMapping() {
        assertEquals(0.5f, OpenTvPalette.lightAlpha(0.5f, isLight = false), 0f)
        assertTrue(OpenTvPalette.lightAlpha(0.3f, isLight = true) >= 0.6f)
        assertEquals(1f, OpenTvPalette.lightAlpha(1f, isLight = true), 0.001f)
        assertEquals(0.069f, OpenTvPalette.lightAlpha(0.06f, isLight = true), 0.001f)
    }

    @Test
    fun monochromeAccentFollowsTheme() {
        val white = OpenTvAccents.byId("white")
        assertEquals(Color.White, OpenTvAccents.forTheme(white, light = false).color)
        val onLight = OpenTvAccents.forTheme(white, light = true)
        assertEquals(Color(0xFF111114), onLight.color)
        assertEquals(Color.White, onLight.onAccent)
        assertEquals("white", onLight.id)
        // Colored accents are identical in both themes.
        OpenTvAccents.All.filter { it.id != "white" }.forEach {
            assertEquals(it, OpenTvAccents.forTheme(it, light = true))
            assertEquals(it, OpenTvAccents.byId(it.id, light = true))
        }
        // Light-theme accent must be dark enough for white ink.
        assertTrue(contrast(onLight.color, onLight.onAccent) >= 4.5f)
    }

    @Test
    fun forcedDarkRestoresDarkAccent() {
        val cfg = OpenTvUiConfig(lightTheme = true, accent = OpenTvAccents.byId("white", light = true))
        val dark = cfg.forcedDark()
        assertFalse(dark.lightTheme)
        assertEquals(Color.White, dark.accent.color)
        assertSame(OpenTvPalettes.Dark, dark.palette)
    }

    @Test
    fun textLargeScalesGloballyOnce() {
        assertEquals(1f, appFontScale(1f, textLarge = false), 0f)
        assertEquals(1.12f, appFontScale(1f, textLarge = true), 0.0001f)
        assertEquals(1.3f * 1.12f, appFontScale(1.3f, textLarge = true), 0.0001f)
        // Per-call multiplier is neutral so text is not scaled twice.
        assertEquals(1f, OpenTvUiConfig(textLarge = true).textScale, 0f)
    }

    @Test
    fun appearanceJsonIsBackwardCompatible() {
        val json = Json { ignoreUnknownKeys = true }
        val old = json.decodeFromString(AppearancePrefs.serializer(), """{"accentId":"red","textLarge":true}""")
        assertEquals("dark", old.theme)
        val light = json.decodeFromString(AppearancePrefs.serializer(), """{"theme":"light"}""")
        assertEquals("light", light.theme)
    }
}
