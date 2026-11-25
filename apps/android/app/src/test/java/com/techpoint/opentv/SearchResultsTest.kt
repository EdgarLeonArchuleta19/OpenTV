package com.techpoint.opentv

import com.techpoint.opentv.core.addons.SearchResults
import com.techpoint.opentv.core.model.MediaItem
import org.junit.Assert.assertEquals
import org.junit.Test

class SearchResultsTest {
    private fun item(id: String, poster: String = "p.jpg", genres: List<String> = emptyList(), anime: Boolean = false) =
        MediaItem(id = id, title = id, poster = poster, genres = genres, isAnime = anime, type = if (anime) "anime" else "movie")

    private val tmdb = listOf(item("stremio:tt1"), item("stremio:tt2", genres = listOf("Family")))
    private val anime = listOf(item("stremio:kitsu:10", anime = true), item("stremio:kitsu:11", anime = true))
    private val cinemeta = listOf(item("stremio:tt3"), item("stremio:tt4", poster = ""), item("stremio:tt1"))

    @Test
    fun `tmdb first, then anime, cinemeta ignored when tmdb has results`() {
        val out = SearchResults.merge(tmdb, anime, cinemeta, kidsOnly = false)
        assertEquals(listOf("stremio:tt1", "stremio:tt2", "stremio:kitsu:10", "stremio:kitsu:11"), out.map { it.id })
    }

    @Test
    fun `cinemeta fallback drops poster-less items and dedupes`() {
        val out = SearchResults.merge(emptyList(), anime + anime.first(), cinemeta, kidsOnly = false)
        assertEquals(listOf("stremio:tt3", "stremio:tt1", "stremio:kitsu:10", "stremio:kitsu:11"), out.map { it.id })
    }

    @Test
    fun `kids profile keeps only approved or family titles and never anime`() {
        val out = SearchResults.merge(tmdb, anime, cinemeta, kidsOnly = true, kidsApproved = setOf("stremio:tt1"))
        assertEquals(listOf("stremio:tt1", "stremio:tt2"), out.map { it.id })
        val none = SearchResults.merge(tmdb, anime, cinemeta, kidsOnly = true)
        assertEquals(listOf("stremio:tt2"), none.map { it.id })
    }

    @Test
    fun `results are capped`() {
        val many = List(80) { item("stremio:tt$it") }
        assertEquals(SearchResults.MAX_RESULTS, SearchResults.merge(many, anime, emptyList(), kidsOnly = false).size)
    }

    @Test
    fun `text tier first, newest first inside each tier, anime included`() {
        fun t(id: String, title: String, year: String, original: String = "", anime: Boolean = false) =
            MediaItem(id = id, title = title, originalTitle = original, year = year, poster = "p", isAnime = anime)
        val tmdbHits = listOf(
            t("a", "Flash", "1990"),
            t("b", "The Flash", "2014"),
            t("c", "El Flash", "2023", original = "The Flash"),
            t("d", "Flashpoint", "2008"),
            t("e", "Superman", "2025"),
            t("f", "The Flash Returns", ""),
            t("g", "The Flash: Origen", "2020"),
        )
        val animeHits = listOf(t("k", "THE FLASH!", "2019", anime = true), t("l", "Dr. Stone", "2019", anime = true))
        val out = SearchResults.merge(tmdbHits, animeHits, emptyList(), kidsOnly = false, query = "  the  flash ")
        assertEquals(
            // tier 1 (equal, accents/punctuation ignored): c 2023, k 2019, b 2014
            // tier 2 (starts with): g 2020, f (no year)
            // tier 3 (contains): no more; tier 4: e 2025, l 2019, d 2008, a 1990
            listOf("c", "k", "b", "g", "f", "e", "l", "d", "a"),
            out.map { it.id },
        )
    }

    @Test
    fun `contains tier and accent-insensitive match`() {
        val items = listOf(
            MediaItem(id = "1", title = "Corazón de León", year = "2010"),
            MediaItem(id = "2", title = "El corazon", year = "2001"),
            MediaItem(id = "3", title = "Corazon", year = "1999"),
        )
        assertEquals(listOf("3", "1", "2"), SearchResults.order(items, "corazón").map { it.id })
    }
}
