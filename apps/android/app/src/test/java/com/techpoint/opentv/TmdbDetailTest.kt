package com.techpoint.opentv

import com.techpoint.opentv.core.addons.TmdbDetail
import com.techpoint.opentv.core.model.Episode
import com.techpoint.opentv.core.model.MediaItem
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TmdbDetailTest {
    private fun obj(raw: String) = Json.parseToJsonElement(raw).jsonObject

    private val base = MediaItem(
        id = "stremio:tt0903747",
        type = "series",
        title = "Breaking Bad",
        logo = "https://logo.png",
        backdrop = "https://old-backdrop.jpg",
    )

    @Test
    fun `detail maps Spanish text, cast, director, runtime, seasons and related`() {
        val p = TmdbDetail.parseDetail(
            obj(
                """{"tmdbId":1396,"item":{"tmdbId":1396,"kind":"tv","imdbId":"tt0903747","title":"Breaking Bad: Reacciones","original":"Breaking Bad",
                "year":"2008","rating":8.92,"overview":"Un profesor de química...","poster":"https://p.jpg","backdrop":"https://b.jpg",
                "genres":["Drama","Crime"],"runtime":47},
                "director":["Vince Gilligan"],"cast":["Bryan Cranston","Aaron Paul"],"seasons":[0,1,2,3,4,5],
                "related":[{"imdbId":"tt1475582","kind":"tv","title":"Sherlock"},{"imdbId":"tt0903747","kind":"tv","title":"Breaking Bad"},{"imdbId":"","title":"Sin id"}]}""",
            ),
            base,
        )!!
        assertEquals("1396", p.tmdbId)
        assertEquals("stremio:tt0903747", p.item.id)
        assertEquals("Breaking Bad: Reacciones", p.item.title)
        assertEquals("Breaking Bad", p.item.originalTitle)
        assertEquals("8.9", p.item.score)
        assertEquals("47 min", p.item.duration)
        assertEquals("Un profesor de química...", p.item.synopsis)
        assertEquals("https://b.jpg", p.item.backdrop)
        assertEquals("https://logo.png", p.item.logo)
        assertEquals(listOf("Bryan Cranston", "Aaron Paul"), p.item.cast)
        assertEquals("Vince Gilligan", p.item.director)
        assertEquals(listOf(1, 2, 3, 4, 5), p.seasons)
        assertEquals(listOf("stremio:tt1475582"), p.related.map { it.id })
    }

    @Test
    fun `detail survives JSON nulls everywhere`() {
        val p = TmdbDetail.parseDetail(
            obj(
                """{"tmdbId":null,"item":{"kind":"tv","title":"Rick y Morty","original":null,"year":null,"rating":null,"overview":null,
                "poster":null,"backdrop":null,"genres":null,"runtime":null},
                "director":null,"cast":[null,"Justin Roiland",3],"seasons":null,"related":null}""",
            ),
            base,
        )
        assertNotNull(p)
        p!!
        assertEquals("Rick y Morty", p.item.title)
        assertEquals("", p.tmdbId)
        assertEquals("https://old-backdrop.jpg", p.item.backdrop)
        assertEquals("", p.item.director)
        assertEquals(listOf("Justin Roiland", "3"), p.item.cast)
        assertEquals(emptyList<Int>(), p.seasons)
        assertEquals(emptyList<MediaItem>(), p.related)
    }

    @Test
    fun `unusable detail falls back (null)`() {
        assertNull(TmdbDetail.parseDetail(null, base))
        assertNull(TmdbDetail.parseDetail(obj("""{"error":"unavailable"}"""), base))
        assertNull(TmdbDetail.parseDetail(obj("""{"unavailable":true,"item":null}"""), base))
        assertNull(TmdbDetail.parseDetail(obj("""{"item":{"title":null}}"""), base))
    }

    @Test
    fun `movies have no seasons and keep a text runtime`() {
        val movie = MediaItem(id = "stremio:tt2380307", type = "movie", title = "Coco")
        val p = TmdbDetail.parseDetail(
            obj("""{"tmdbId":"354912","item":{"kind":"movie","title":"Coco","runtime":"1 h 45 min"},"seasons":[1]}"""),
            movie,
        )!!
        assertEquals("movie", p.item.type)
        assertEquals("1 h 45 min", p.item.duration)
        assertTrue(p.seasons.isEmpty())
        assertEquals("", TmdbDetail.runtimeLabel(obj("""{"runtime":0}""")))
    }

    @Test
    fun `episodes get stream-compatible ids, Spanish titles and stills`() {
        val eps = TmdbDetail.parseEpisodes(
            obj(
                """{"episodes":[
                {"season":2,"number":2,"title":"Grilled","overview":"...","still":"https://s2.jpg","airDate":"2009-03-15","runtime":47},
                {"season":2,"number":1,"title":"Treinta y ocho","overview":null,"still":null,"airDate":null,"runtime":null},
                {"season":2,"number":null,"title":"Roto"},
                {"season":0,"number":1,"title":"Especial"},
                null,
                {"season":2,"number":1,"title":"Duplicado"}
                ]}""",
            ),
            imdbId = "tt0903747",
            season = 2,
            fallbackThumb = "https://fallback.jpg",
        )
        assertEquals(listOf("tt0903747:2:1", "tt0903747:2:2"), eps.map { it.id })
        assertEquals("Treinta y ocho", eps[0].title)
        assertEquals("", eps[0].overview)
        assertEquals("https://fallback.jpg", eps[0].thumbnail)
        assertEquals("https://s2.jpg", eps[1].thumbnail)
        assertEquals("2009-03-15", eps[1].released)
        assertEquals(0, eps[0].runtimeMin)
        assertEquals(47, eps[1].runtimeMin)
    }

    @Test
    fun `episodes without season or title use the requested season and a default name`() {
        val eps = TmdbDetail.parseEpisodes(obj("""{"episodes":[{"number":"3","title":""}]}"""), "tt1", 4, "")
        assertEquals(1, eps.size)
        assertEquals("tt1:4:3", eps[0].id)
        assertEquals("Episodio 3", eps[0].title)
        assertTrue(TmdbDetail.parseEpisodes(obj("""{"error":"x","episodes":null}"""), "tt1", 1, "").isEmpty())
        assertTrue(TmdbDetail.parseEpisodes(null, "tt1", 1, "").isEmpty())
    }

    @Test
    fun `lazily loaded seasons merge sorted without duplicates`() {
        fun ep(s: Int, n: Int) = Episode(id = "tt1:$s:$n", season = s, number = n, title = "E$n")
        val merged = TmdbDetail.mergeEpisodes(listOf(ep(2, 1), ep(2, 2)), listOf(ep(1, 2), ep(1, 1), ep(2, 1)))
        assertEquals(listOf("tt1:1:1", "tt1:1:2", "tt1:2:1", "tt1:2:2"), merged.map { it.id })
    }

    @Test
    fun `episodes carry the TMDB runtime in minutes only when known`() {
        val eps = TmdbDetail.parseEpisodes(
            obj(
                """{"episodes":[
                {"season":1,"number":1,"title":"Piloto","runtime":23.6},
                {"season":1,"number":2,"title":"Día de la diversidad","runtime":22},
                {"season":1,"number":3,"title":"Salud","runtime":0},
                {"season":1,"number":4,"title":"La alianza"}
                ]}""",
            ),
            imdbId = "tt0386676",
            season = 1,
            fallbackThumb = "",
        )
        assertEquals(listOf(24, 22, 0, 0), eps.map { it.runtimeMin })
    }

    @Test
    fun `episodes saved before runtimeMin existed still decode`() {
        val json = Json { ignoreUnknownKeys = true }
        val old = json.decodeFromString(Episode.serializer(), """{"id":"tt1:1:1","season":1,"number":1,"title":"Piloto"}""")
        assertEquals(0, old.runtimeMin)
        val withRuntime = Episode(id = "tt1:1:1", season = 1, number = 1, title = "Piloto", runtimeMin = 24)
        assertEquals(withRuntime, json.decodeFromString(Episode.serializer(), json.encodeToString(Episode.serializer(), withRuntime)))
    }
}
