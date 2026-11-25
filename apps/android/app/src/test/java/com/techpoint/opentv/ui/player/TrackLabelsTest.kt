package com.techpoint.opentv.ui.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TrackLabelsTest {
    @Test
    fun languageNamesInSpanish() {
        assertEquals("Español", TrackLabels.languageName("spa"))
        assertEquals("Español (Latinoamérica)", TrackLabels.languageName("es-419"))
        assertEquals("Español (Latinoamérica)", TrackLabels.languageName("es_MX"))
        assertEquals("Español (España)", TrackLabels.languageName("es-ES"))
        assertEquals("Inglés", TrackLabels.languageName("eng"))
        assertEquals("Portugués (Brasil)", TrackLabels.languageName("pt-BR"))
        assertEquals("Japonés", TrackLabels.languageName("jpn"))
        assertNull(TrackLabels.languageName(""))
        assertNull(TrackLabels.languageName("und"))
    }

    @Test
    fun engineLabelsSplitIntoLanguageAndDetail() {
        assertEquals(
            TrackLabel("Español", "Dolby Digital · 5.1"),
            TrackLabels.forTrack("Español · Dolby Digital · 5.1", "spa", isAudio = true, position = 0),
        )
        assertEquals(TrackLabel("Inglés"), TrackLabels.forTrack("English", "en", isAudio = false, position = 0))
        assertEquals(TrackLabel("Español", "Latino 5.1"), TrackLabels.forTrack("Latino 5.1", "spa", isAudio = true, position = 1))
        assertEquals(TrackLabel("Pista 2"), TrackLabels.forTrack("", "", isAudio = true, position = 1))
        assertEquals(TrackLabel("Forzados"), TrackLabels.forTrack("Forzados", "", isAudio = false, position = 0))
    }
}
