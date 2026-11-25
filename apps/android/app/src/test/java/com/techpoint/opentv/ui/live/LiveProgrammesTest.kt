package com.techpoint.opentv.ui.live

import com.techpoint.opentv.core.model.EpgNowNext
import com.techpoint.opentv.core.model.EpgProgram
import com.techpoint.opentv.core.model.LiveChannel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.TimeZone

class LiveProgrammesTest {
    private val utc = TimeZone.getTimeZone("UTC")
    private val h = 3_600_000L
    private val m = 60_000L

    // 2026-01-01 00:00 UTC
    private val day = 1_767_225_600_000L

    private fun prog(title: String, startH: Double, endH: Double) =
        EpgProgram(title = title, startMs = day + (startH * h).toLong(), endMs = day + (endH * h).toLong())

    private val schedule = listOf(
        prog("El último tren", 15.75, 17.5),
        prog("Noticias", 12.0, 14.0),
        prog("Noches de ciudad", 14.0, 15.75),
        prog("Ciclo de cine de oro", 19.0, 21.0),
        prog("Comedia de enredos", 17.5, 19.0),
        prog("Madrugada", 21.0, 23.0),
    )

    @Test
    fun picksNowNextAndTwoLaterInOrder() {
        val cards = pickProgrammeCards(schedule, null, day + 14 * h + 30 * m)
        assertEquals(listOf("Noches de ciudad", "El último tren", "Comedia de enredos", "Ciclo de cine de oro"), cards.map { it.program.title })
        assertEquals(listOf(ProgrammeSlot.Now, ProgrammeSlot.Next, ProgrammeSlot.Later, ProgrammeSlot.Later), cards.map { it.slot })
        assertEquals(listOf("AHORA", "DESPUÉS", "17:30", "19:00"), cards.map { programmeLabel(it, utc) })
        assertEquals("14:00 – 15:45", programmeRange(cards[0].program, utc))
    }

    @Test
    fun boundaryBelongsToTheStartingProgramme() {
        val cards = pickProgrammeCards(schedule, null, day + 15 * h + 45 * m)
        assertEquals("El último tren", cards.first().program.title)
        assertEquals(ProgrammeSlot.Now, cards.first().slot)
    }

    @Test
    fun gapBeforeTheNextProgrammeHasNoNowCard() {
        val gappy = listOf(prog("A", 10.0, 11.0), prog("B", 12.0, 13.0), prog("C", 13.0, 14.0))
        val cards = pickProgrammeCards(gappy, null, day + 11 * h + 30 * m)
        assertEquals(listOf("B", "C"), cards.map { it.program.title })
        assertEquals(listOf(ProgrammeSlot.Next, ProgrammeSlot.Later), cards.map { it.slot })
    }

    @Test
    fun nearTheEndOfTheGuideReturnsFewerCards() {
        val cards = pickProgrammeCards(schedule, null, day + 22 * h)
        assertEquals(listOf("Madrugada"), cards.map { it.program.title })
    }

    @Test
    fun nowNextFillsInWhileTheScheduleIsMissing() {
        val nn = EpgNowNext(now = prog("Ahora mismo", 14.0, 15.0), next = prog("Luego", 15.0, 16.0))
        val cards = pickProgrammeCards(emptyList(), nn, day + 14 * h + 10 * m)
        assertEquals(listOf("Ahora mismo", "Luego"), cards.map { it.program.title })
        assertEquals(listOf(ProgrammeSlot.Now, ProgrammeSlot.Next), cards.map { it.slot })
    }

    @Test
    fun duplicatesFromNowNextAndScheduleAreMerged() {
        val nn = EpgNowNext(now = schedule[2], next = schedule[0])
        val cards = pickProgrammeCards(schedule, nn, day + 14 * h + 30 * m)
        assertEquals(4, cards.size)
        assertEquals(cards.map { it.program.startMs }.distinct().size, 4)
    }

    @Test
    fun emptyGuideGivesNoCards() {
        assertTrue(pickProgrammeCards(emptyList(), null, day).isEmpty())
        assertTrue(pickProgrammeCards(emptyList(), EpgNowNext(), day).isEmpty())
        // Untimed or blank entries are ignored, except an untimed "now".
        val untimed = EpgNowNext(now = EpgProgram("Programa en vivo"))
        assertEquals(listOf(ProgrammeSlot.Now), pickProgrammeCards(emptyList(), untimed, day).map { it.slot })
    }

    @Test
    fun monograms() {
        assertEquals("CC", channelMonogram("Cine Clásico"))
        assertEquals("EST", channelMonogram("Estrenos"))
        assertEquals("CDA", channelMonogram("Cine de Acción"))
        assertEquals("TV", channelMonogram("  "))
        assertEquals("FOX", channelMonogram("fox"))
        assertEquals("C10", channelMonogram("Canal 10"))
        assertEquals("C1", channelMonogram("Canal 1"))
        assertEquals("AS3", channelMonogram("AYM Sports 3"))
        assertEquals("T247", channelMonogram("Terror 24/7"))
    }

    @Test
    fun filterByGroupFavoritesRecentsAndSearch() {
        val a = LiveChannel(id = "1", name = "Cine Clásico", url = "u1", group = "Películas", tvgId = "cc")
        val b = LiveChannel(id = "2", name = "Noticias 24", url = "u2", group = "Noticias")
        val c = LiveChannel(id = "3", name = "Terror 24/7", url = "u3", group = "Películas")
        val all = listOf(a, b, c)
        val gone = LiveChannel(id = "9", name = "Otra lista", url = "u9")
        assertEquals(listOf(a, c), filterChannels(all, "Películas", emptyList(), emptyList(), "", emptyMap()))
        assertEquals(listOf(b), filterChannels(all, GROUP_FAVORITES, listOf("u2"), emptyList(), "", emptyMap()))
        // Recents keep their order and drop channels that are not in the loaded lists.
        assertEquals(listOf(c, a), filterChannels(all, GROUP_RECENTS, emptyList(), listOf(c, gone, a), "", emptyMap()))
        assertEquals(listOf(b, c), filterChannels(all, GROUP_ALL, emptyList(), emptyList(), "24", emptyMap()))
        // Search also matches the programme on air.
        val epg = mapOf("cc" to EpgNowNext(now = EpgProgram("Casablanca")))
        assertEquals(listOf(a), filterChannels(all, GROUP_ALL, emptyList(), emptyList(), "casa", epg))
    }

    @Test
    fun startChannelIsTheLastWatchedStillListed() {
        val a = LiveChannel(id = "a", name = "A", url = "http://x/a")
        val b = LiveChannel(id = "b", name = "B", url = "http://x/b")
        val gone = LiveChannel(id = "g", name = "G", url = "http://x/gone")
        assertEquals(b, pickStartChannel(listOf(a, b), listOf(gone, b, a)))
        assertEquals(a, pickStartChannel(listOf(a, b), emptyList()))
        assertEquals(a, pickStartChannel(listOf(a, b), listOf(gone)))
    }
}
