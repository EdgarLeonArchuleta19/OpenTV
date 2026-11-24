package com.techpoint.opentv

import com.techpoint.opentv.core.addons.SectionContent
import com.techpoint.opentv.core.model.MediaItem
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

class SectionContentTest {
    private fun obj(raw: String) = Json.parseToJsonElement(raw).jsonObject

    private fun row(n: Int, withBackdrop: (Int) -> Boolean = { true }) =
        List(n) { i -> MediaItem(id = "t$i", title = "T$i", backdrop = if (withBackdrop(i)) "b$i" else "") }

    @Test
    fun `kids TMDB items become Cinemeta-playable titles`() {
        val coco = SectionContent.kidsTmdbItem(
            obj("""{"imdbId":"tt2380307","kind":"movie","title":"Coco","original":"Coco","year":"2017","rating":8.21,"genres":["Family","Animation"],"backdrop":"https://image.tmdb.org/t/p/w1280/b.jpg"}"""),
        )!!
        assertEquals("stremio:tt2380307", coco.id)
        assertEquals("movie", coco.type)
        assertEquals("8.2", coco.score)
        assertEquals(listOf("Family", "Animation"), coco.genres)
        assertEquals("", coco.originalTitle)
        assertEquals("series", SectionContent.kidsTmdbItem(obj("""{"imdbId":"tt7678620","kind":"tv","title":"Bluey"}"""))!!.type)
        assertNull(SectionContent.kidsTmdbItem(obj("""{"imdbId":"","kind":"movie","title":"X"}""")))
    }

    @Test
    fun `anime season items keep Kitsu ids`() {
        val it = SectionContent.animeSeasonItem(
            obj("""{"kitsuId":"50021","title":"The Apothecary Diaries Season 3","original":"Kusuriya no Hitorigoto 3","year":"2026","rating":8.4,"poster":"https://media.kitsu.app/p.jpg","backdrop":""}"""),
        )!!
        assertEquals("stremio:kitsu:50021", it.id)
        assertEquals("anime", it.type)
        assertTrue(it.isAnime)
        assertEquals("", it.backdrop)
        assertEquals("Kusuriya no Hitorigoto 3", it.originalTitle)
        assertNull(SectionContent.animeSeasonItem(obj("""{"kitsuId":"abc","title":"X"}""")))
    }

    @Test
    fun `daily hero order is stable per day and changes across days`() {
        val items = row(20)
        val a = SectionContent.dailyHeroOrder(items, "anime:2026-11-23")
        assertEquals(a, SectionContent.dailyHeroOrder(items, "anime:2026-11-23"))
        val heads = listOf("2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27").map { d ->
            SectionContent.dailyHeroOrder(items, "anime:$d").take(6).map { it.id }
        }
        assertTrue(heads.any { it != a.take(6).map { x -> x.id } })
        assertNotEquals(items.take(6), a.take(6))
    }

    @Test
    fun `daily hero order keeps every item and promotes only artwork from the pool`() {
        val items = row(30) { it % 3 == 0 }
        val out = SectionContent.dailyHeroOrder(items, "kids:2026-11-23")
        assertEquals(30, out.size)
        assertEquals(30, out.map { it.id }.toSet().size)
        val head = out.take(6)
        assertTrue(head.all { it.backdrop.isNotBlank() })
        assertTrue(head.all { it.id.drop(1).toInt() < 20 })
        val bare = row(5) { false }
        assertSame(bare, SectionContent.dailyHeroOrder(bare, "anime:2026-11-23"))
    }

    @Test
    fun `day key uses the local calendar`() {
        val cal = Calendar.getInstance().apply { set(2026, Calendar.JANUARY, 5, 23, 59) }
        assertEquals("2026-01-05", SectionContent.localDayKey(cal))
    }
}
