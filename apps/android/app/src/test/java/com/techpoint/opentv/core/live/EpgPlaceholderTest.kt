package com.techpoint.opentv.core.live

import com.techpoint.opentv.core.model.EpgProgram
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EpgPlaceholderTest {
    private val h = 3_600_000L
    private val day = 1_767_225_600_000L

    private fun prog(title: String, startH: Int, endH: Int) =
        EpgProgram(title = title, startMs = day + startH * h, endMs = day + endH * h)

    private fun hourly(title: String, n: Int) = (0 until n).map { prog(title, it, it + 1) }

    @Test
    fun detectsGuidesThatOnlyRepeatTheChannelName() {
        assertTrue(EpgPlaceholder.isPlaceholder(listOf("Azteca UNO -1 hora"), hourly("Azteca UNO -1", 6)))
        assertTrue(EpgPlaceholder.isPlaceholder(listOf("Azteca Uno -2 Horas"), hourly("Azteca Uno", 3)))
        assertTrue(EpgPlaceholder.isPlaceholder(listOf("Canal Ñoño"), hourly("canal ñono", 2)))
        assertTrue(EpgPlaceholder.isPlaceholder(listOf("Cine"), hourly("TBD", 4)))
    }

    @Test
    fun keepsRealGuides() {
        assertFalse(EpgPlaceholder.isPlaceholder(listOf("Azteca Uno"), listOf(prog("Exatlón México", 0, 2), prog("La granja VIP", 2, 4))))
        val mixed = hourly("Pluto TV Cine", 1) + listOf(prog("Duro de matar", 1, 3), prog("Rambo", 3, 5))
        assertFalse(EpgPlaceholder.isPlaceholder(listOf("Pluto TV Cine"), mixed))
    }

    @Test
    fun missingGuideIsNotPlaceholder() {
        assertFalse(EpgPlaceholder.isPlaceholder(listOf("Azteca Uno"), emptyList()))
        assertFalse(EpgPlaceholder.isPlaceholder(listOf("Azteca Uno"), listOf(null, null)))
    }

    @Test
    fun nameVariantsDropTheFeedDelay() {
        assertEquals(
            listOf("azteca uno 1 hora", "azteca uno 1", "azteca uno"),
            EpgPlaceholder.nameVariants(listOf("Azteca UNO -1 hora")).toList(),
        )
    }

    @Test
    fun guessesTheGuideCountry() {
        assertEquals("mx", EpgPlaceholder.guessCountry("AztecaUno.mx@SD", "", ""))
        assertEquals("us", EpgPlaceholder.guessCountry("ESPN.us", "", ""))
        assertEquals("ar", EpgPlaceholder.guessCountry("646ccc7a2858cb0008127367", "pluto_ar", ""))
        assertEquals(
            "mx",
            EpgPlaceholder.guessCountry("", "custom_1", "https://github.com/matthuisman/i.mjh.nz/raw/master/PlutoTV/mx.xml.gz"),
        )
        assertEquals("mx", EpgPlaceholder.guessCountry("", "news", ""))
    }
}
