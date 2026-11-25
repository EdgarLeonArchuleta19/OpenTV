package com.techpoint.opentv.player

import com.techpoint.opentv.core.model.StreamSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SourceRefusalTest {
    @Test
    fun refusalStatuses() {
        assertTrue(OpenTvPlayer.isRefusalStatus(403))
        assertTrue(OpenTvPlayer.isRefusalStatus(429))
        assertTrue(OpenTvPlayer.isRefusalStatus(503))
        assertFalse(OpenTvPlayer.isRefusalStatus(206))
        assertFalse(OpenTvPlayer.isRefusalStatus(200))
    }

    @Test
    fun hostExtraction() {
        assertEquals("pixeldrain.dev", OpenTvPlayer.hostOf("https://PixelDrain.dev/api/file/x?download"))
        assertNull(OpenTvPlayer.hostOf("magnet:?xt=urn:btih:abc"))
    }

    @Test
    fun wrongContentFallbackPrefersSameLanguage() {
        fun src(id: String, host: String, vararg langs: String) =
            StreamSource(id = id, addonId = "p", addonName = "P", url = "https://$host/$id.mkv", langs = langs.toList())
        val current = src("a", "mg.example.com", "es")
        val queue = listOf(src("b", "other.example.com", "en"), src("c", "third.example.com", "ES", "en"))
        assertEquals("c", OpenTvPlayer.pickSameLanguage(queue, current, emptySet())?.id)
        assertEquals("b", OpenTvPlayer.pickSameLanguage(queue, current, setOf("third.example.com"))?.id)
        assertEquals("b", OpenTvPlayer.pickSameLanguage(queue, src("x", "x.com"), emptySet())?.id)
        assertNull(OpenTvPlayer.pickSameLanguage(emptyList(), current, emptySet()))
    }
}
