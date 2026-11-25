package com.techpoint.opentv

import com.techpoint.opentv.core.model.SourcePrefs
import com.techpoint.opentv.core.model.StreamSource
import com.techpoint.opentv.core.ranking.PlaybackEnv
import com.techpoint.opentv.core.ranking.PlaybackProfile
import com.techpoint.opentv.core.ranking.SourceRanker
import com.techpoint.opentv.service.DeviceMediaCaps
import org.junit.Assert.assertEquals
import org.junit.Test

class PlaybackProfileTest {
    private val fireTvStick1Gb = PlaybackEnv(totalRamMb = 900, lowRamDevice = true, is64Bit = false, linkMbps = 50.0)
    private val shield = PlaybackEnv(totalRamMb = 3_000, lowRamDevice = false, is64Bit = true, measuredMbps = 60.0)
    private val capableSlowNet = PlaybackEnv(totalRamMb = 4_000, is64Bit = true, measuredMbps = 5.0)

    @Test
    fun `auto target follows device and network`() {
        assertEquals("720p", PlaybackProfile.autoTarget(fireTvStick1Gb))
        assertEquals("1080p", PlaybackProfile.autoTarget(shield))
        assertEquals("720p", PlaybackProfile.autoTarget(capableSlowNet))
        assertEquals("720p", PlaybackProfile.autoTarget(shield.copy(constrained = true)))
        assertEquals("720p", PlaybackProfile.autoTarget(PlaybackEnv(totalRamMb = 2_048, is64Bit = false)))
        assertEquals("1080p", PlaybackProfile.autoTarget(PlaybackEnv(totalRamMb = 4_096, is64Bit = true, linkMbps = 0.0)))
        assertEquals("720p", PlaybackProfile.autoTarget(PlaybackEnv(totalRamMb = 4_096, is64Bit = true, linkMbps = 6.0)))
    }

    @Test
    fun `tv always targets 720p automatically but an explicit choice wins`() {
        val tvShield = shield.copy(isTv = true)
        assertEquals("720p", PlaybackProfile.autoTarget(tvShield))
        assertEquals("720p", PlaybackProfile.autoTarget(fireTvStick1Gb.copy(isTv = true)))
        assertEquals("720p", SourceRanker.effectiveTarget(SourcePrefs(quality = "auto"), tvShield))
        assertEquals("1080p", SourceRanker.effectiveTarget(SourcePrefs(quality = "1080p"), tvShield))
        // Phones keep the device / network rule.
        assertEquals("1080p", PlaybackProfile.autoTarget(shield))
    }

    @Test
    fun `ranker uses the auto target and never auto picks 4K`() {
        val prefs = SourcePrefs(langs = listOf("latino"), quality = "auto")
        val caps4k = DeviceMediaCaps(hevc = true, hevc10 = true, uhd = true, hdr = true)
        val sources = listOf(
            StreamSource(id = "uhd", addonId = "a", addonName = "A", title = "Movie 2160p 4K HDR Latino", url = "https://x/1"),
            StreamSource(id = "fhd", addonId = "a", addonName = "A", title = "Movie 1080p Latino", url = "https://x/2"),
            StreamSource(id = "hd", addonId = "a", addonName = "A", title = "Movie 720p Latino", url = "https://x/3"),
        )
        assertEquals("fhd", SourceRanker.rank(sources, prefs, caps4k, env = shield).first().id)
        assertEquals("hd", SourceRanker.rank(sources, prefs, DeviceMediaCaps(), isLowMemory = true, env = fireTvStick1Gb).first().id)
        assertEquals("hd", SourceRanker.rank(sources, prefs, caps4k, env = capableSlowNet).first().id)
        // Manual override still wins.
        assertEquals("uhd", SourceRanker.rank(sources, prefs.copy(quality = "4K"), caps4k, env = fireTvStick1Gb).first().id)
        assertEquals("1080p", SourceRanker.effectiveTarget(prefs.copy(quality = "1080p"), fireTvStick1Gb))
    }
}
