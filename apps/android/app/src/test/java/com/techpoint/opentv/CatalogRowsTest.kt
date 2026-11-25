package com.techpoint.opentv

import com.techpoint.opentv.core.addons.CatalogRows
import com.techpoint.opentv.core.addons.SectionContent
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogRowsTest {
    private val sections = listOf("home", "movies", "series", "kids", "anime")

    @Test
    fun `every built-in row asks TMDB first`() {
        for (section in sections) {
            val specs = CatalogRows.specs(section)
            assertTrue(section, specs.isNotEmpty())
            specs.forEach { assertTrue("${section}/${it.id}", it.lists.isNotEmpty()) }
            assertEquals(section, specs.size, specs.map { it.id }.distinct().size)
        }
    }

    @Test
    fun `fallback catalogs stay Cinemeta or Kitsu`() {
        for (section in listOf("home", "movies", "series", "kids")) {
            CatalogRows.specs(section).forEach { assertTrue(it.url, it.url.startsWith(CatalogRows.CINEMETA)) }
        }
        CatalogRows.specs("anime").filter { it.url.isNotEmpty() }.forEach {
            assertTrue(it.url, it.url.startsWith(CatalogRows.KITSU))
        }
    }

    @Test
    fun `Cinemeta genre rows map to the matching TMDB genre ids`() {
        val genreUrl = Regex("""/catalog/(movie|series)/top/genre=([^.]+)\.json$""")
        var checked = 0
        for (section in listOf("home", "movies", "series")) {
            for (spec in CatalogRows.specs(section)) {
                val m = genreUrl.find(spec.url) ?: continue
                val kind = m.groupValues[1]
                val id = CatalogRows.tmdbGenreId(kind, m.groupValues[2])!!
                val expected = if (kind == "movie") "cat:movie:genre:$id" else "cat:tv:genre:$id"
                assertEquals(spec.id, listOf(expected), spec.lists)
                checked++
            }
        }
        assertTrue(checked >= 10)
        assertEquals(10765, CatalogRows.tmdbGenreId("series", "Sci-Fi"))
        assertEquals(878, CatalogRows.tmdbGenreId("movie", "Sci-Fi"))
        assertEquals(27, CatalogRows.tmdbGenreId("movie", "Horror"))
    }

    @Test
    fun `trending and popular rows use the matching kind`() {
        val home = CatalogRows.specs("home").associateBy { it.id }
        assertEquals(listOf("cat:movie:trending"), home["home_trend_movies"]!!.lists)
        assertEquals(listOf("cat:tv:trending"), home["home_trend_series"]!!.lists)
        assertEquals(listOf("cat:movie:popular"), home["home_pop_movies"]!!.lists)
        assertEquals(listOf("cat:tv:popular"), home["home_pop_series"]!!.lists)
        assertTrue(CatalogRows.specs("series").all { l -> l.lists.all { it.startsWith("cat:tv:") } })
        assertTrue(CatalogRows.specs("movies").all { l -> l.lists.all { it.startsWith("cat:movie:") } })
    }

    @Test
    fun `anime rows try TMDB then the Kitsu season list`() {
        val anime = CatalogRows.specs("anime")
        assertEquals(listOf("anime:season", SectionContent.ANIME_SEASON), anime.first().lists)
        assertEquals(
            listOf("anime:season", "anime:airing", "anime:popular", "anime:top", "anime:movies"),
            anime.map { it.lists.first() },
        )
        assertEquals(CatalogRows.ListKind.ANIME_TMDB, CatalogRows.listKind("anime:airing"))
        assertEquals(CatalogRows.ListKind.ANIME_KITSU, CatalogRows.listKind(SectionContent.ANIME_SEASON))
        assertEquals(CatalogRows.ListKind.KIDS, CatalogRows.listKind(SectionContent.KIDS_TV_TOP))
        assertEquals(CatalogRows.ListKind.CATALOG, CatalogRows.listKind("cat:movie:genre:28"))
    }

    @Test
    fun `kids rows keep their all-ages lists and fallback titles`() {
        val kids = CatalogRows.specs("kids")
        assertEquals(
            listOf(
                SectionContent.KIDS_MOVIES_POPULAR,
                SectionContent.KIDS_TV_POPULAR,
                SectionContent.KIDS_MOVIES_ANIMATED,
                SectionContent.KIDS_TV_TOP,
            ),
            kids.map { it.lists.single() },
        )
        assertTrue(kids.all { it.fallbackTitle != null && it.url.contains("genre=Family") })
    }

    @Test
    fun `TMDB anime items keep IMDb ids and their real type`() {
        val o = Json.parseToJsonElement(
            """{"tmdbId":1429,"kind":"tv","imdbId":"tt2560140","title":"Ataque a los titanes","original":"進撃の巨人","year":null,"rating":null,"genres":null,"poster":null}""",
        ).jsonObject
        val item = SectionContent.kidsTmdbItem(o, "En emisión", anime = true)!!
        assertEquals("stremio:tt2560140", item.id)
        assertEquals("series", item.type)
        assertTrue(item.isAnime)
        assertTrue(item.isSeries)
        assertEquals("", item.year)
        assertEquals("", item.score)
        assertEquals(emptyList<String>(), item.genres)
        assertFalse(SectionContent.kidsTmdbItem(o)!!.isAnime)
    }
}
