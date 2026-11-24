package com.techpoint.opentv.player

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
}
