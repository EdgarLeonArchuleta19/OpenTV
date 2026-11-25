package com.techpoint.opentv.ui.player

import com.techpoint.opentv.core.model.Episode
import com.techpoint.opentv.ui.player.EpisodeFlow.EndAction
import com.techpoint.opentv.ui.player.EpisodeFlow.Phase
import com.techpoint.opentv.ui.player.EpisodeFlow.Segment
import com.techpoint.opentv.ui.player.EpisodeFlow.SkipData
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EpisodeFlowTest {
    private fun ep(season: Int, number: Int, title: String = "") = Episode(id = "tt1:$season:$number", season = season, number = number, title = title)

    @Test
    fun parsesCoreAnswer() {
        val res = Json.parseToJsonElement(
            """{"returnValue":true,"intro":{"start":314.5,"end":331.0},"recap":null,"credits":{"start":2843.0,"end":null},"introSource":"IntroDB","creditsSource":"TheIntroDB"}""",
        ).jsonObject
        val d = EpisodeFlow.parse(res)!!
        assertEquals(Segment(314.5, 331.0), d.intro)
        assertEquals(Segment(2843.0, null), d.credits)
        assertNull(d.recap)
        assertEquals("IntroDB", d.introSource)
        assertNull(EpisodeFlow.parse(Json.parseToJsonElement("""{"returnValue":false}""").jsonObject))
    }

    @Test
    fun creditsStartUsesRealDataOrFallback() {
        assertEquals(1290.0, EpisodeFlow.creditsStartSec(1420.0, SkipData(credits = Segment(1290.0, 1380.0)))!!, 0.001)
        assertEquals(1440.0 - 45.0, EpisodeFlow.creditsStartSec(1440.0, null)!!, 0.001)
        assertEquals(3600.0 - 108.0, EpisodeFlow.creditsStartSec(3600.0, SkipData())!!, 0.001)
        // Implausible credits (first half of the file) fall back to the heuristic.
        assertEquals(2800.0 - 84.0, EpisodeFlow.creditsStartSec(2800.0, SkipData(credits = Segment(100.0, null)))!!, 0.001)
        assertNull(EpisodeFlow.creditsStartSec(60.0, null))
    }

    @Test
    fun phases() {
        assertEquals(Phase.PLAYING, EpisodeFlow.phaseAt(100.0, 1440.0, 1395.0, false))
        assertEquals(Phase.CREDITS, EpisodeFlow.phaseAt(1400.0, 1440.0, 1395.0, false))
        assertEquals(Phase.ENDED, EpisodeFlow.phaseAt(1439.6, 1440.0, 1395.0, false))
        assertEquals(Phase.ENDED, EpisodeFlow.phaseAt(500.0, 1440.0, 1395.0, true))
    }

    @Test
    fun endScreenActions() {
        assertEquals(listOf(EndAction.NEXT, EndAction.EXIT, EndAction.REPLAY), EpisodeFlow.endActions(true))
        assertEquals(listOf(EndAction.EXIT, EndAction.REPLAY), EpisodeFlow.endActions(false))
        assertEquals(10, EpisodeFlow.autoNextCountdown(90.0))
        assertEquals(3, EpisodeFlow.autoNextCountdown(0.4))
    }

    @Test
    fun skipPrompt() {
        val real = SkipData(intro = Segment(314.5, 331.0), recap = Segment(0.0, 60.0))
        assertEquals("Omitir intro", EpisodeFlow.skipPromptAt(320.0, 2900.0, real, emptySet())?.label)
        assertEquals(331.0, EpisodeFlow.skipPromptAt(320.0, 2900.0, real, emptySet())?.target)
        assertNull(EpisodeFlow.skipPromptAt(100.0, 2900.0, real, emptySet()))
        assertNull(EpisodeFlow.skipPromptAt(320.0, 2900.0, real, setOf("intro")))
        assertEquals("Omitir resumen", EpisodeFlow.skipPromptAt(10.0, 2900.0, real, emptySet())?.label)
        // No real data: no button at all.
        assertNull(EpisodeFlow.skipPromptAt(20.0, 2900.0, null, emptySet()))
        assertNull(EpisodeFlow.skipPromptAt(400.0, 2900.0, null, emptySet()))
        assertNull(EpisodeFlow.skipPromptAt(20.0, 500.0, null, emptySet()))
    }

    @Test
    fun nextEpisodeCrossesSeasons() {
        val all = listOf(ep(0, 1), ep(1, 1), ep(1, 2), ep(2, 1), ep(2, 2))
        assertEquals(2, EpisodeFlow.nextEpisodeAfter(all, ep(1, 1))?.number)
        assertEquals(ep(2, 1), EpisodeFlow.nextEpisodeAfter(all, ep(1, 2)))
        assertNull(EpisodeFlow.nextEpisodeAfter(all, ep(2, 2)))
        assertEquals("T1·E4 · Cancer Man", EpisodeFlow.episodeLabel(ep(1, 4, "Cancer Man")))
    }

    @Test
    fun runtimeMismatchFlagsAnotherVersion() {
        // The Office US S1E1/E2 vs the Mexican remake "La Oficina" (28:37 / 27:45).
        assertEquals(true, EpisodeFlow.runtimeMismatch(1717.0, 24))
        assertEquals(true, EpisodeFlow.runtimeMismatch(1665.0, 22))
        // The real US episodes (21:05) and normal deviations.
        assertEquals(false, EpisodeFlow.runtimeMismatch(1265.0, 21))
        assertEquals(false, EpisodeFlow.runtimeMismatch(26 * 60.0, 24))
        assertEquals(false, EpisodeFlow.runtimeMismatch(58 * 60.0, 50))
        // Unknown runtime or duration never counts.
        assertEquals(false, EpisodeFlow.runtimeMismatch(1717.0, 0))
        assertEquals(false, EpisodeFlow.runtimeMismatch(0.0, 24))
        assertEquals(false, EpisodeFlow.runtimeMismatch(Double.NaN, 24))
        assertEquals(false, EpisodeFlow.runtimeMismatch(Double.POSITIVE_INFINITY, 24))
    }

    @org.junit.Test
    fun realCreditsOnlyFromData() {
        val d = 1500.0
        org.junit.Assert.assertFalse(EpisodeFlow.hasRealCredits(d, null))
        org.junit.Assert.assertTrue(EpisodeFlow.hasRealCredits(d, EpisodeFlow.SkipData(credits = EpisodeFlow.Segment(1400.0, null))))
        // A "credits" segment in the first half is not trusted.
        org.junit.Assert.assertFalse(EpisodeFlow.hasRealCredits(d, EpisodeFlow.SkipData(credits = EpisodeFlow.Segment(100.0, null))))
    }
}
