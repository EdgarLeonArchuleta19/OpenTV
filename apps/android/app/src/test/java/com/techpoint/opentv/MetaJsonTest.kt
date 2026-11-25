package com.techpoint.opentv

import com.techpoint.opentv.core.addons.MetaJson
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MetaJsonTest {
    private fun obj(raw: String) = Json.parseToJsonElement(raw).jsonObject

    @Test
    fun `null and wrongly typed fields never throw`() {
        // Cinemeta's Rick and Morty meta (tt2861424) has "director": null: reading it with
        // kotlinx `jsonArray` threw IllegalArgumentException and crashed the detail screen.
        val meta = obj(
            """{"name":"Rick and Morty","director":null,"cast":"Justin Roiland","genres":["Animation",null,"Comedy",{"x":1}],
               "writer":{"a":1},"runtime":["22 min"],"imdbRating":8.1}""",
        )
        assertEquals(emptyList<String>(), MetaJson.strings(meta["director"]))
        assertEquals(emptyList<String>(), MetaJson.strings(meta["cast"]))
        assertEquals(emptyList<String>(), MetaJson.strings(meta["missing"]))
        assertEquals(listOf("Animation", "Comedy"), MetaJson.strings(meta["genres"]))
        assertEquals("", MetaJson.text(meta, "director"))
        assertEquals("", MetaJson.text(meta, "writer"))
        assertEquals("", MetaJson.text(meta, "runtime"))
        assertEquals("8.1", MetaJson.text(meta, "imdbRating"))
        assertTrue(MetaJson.arr(meta["writer"]).isEmpty())
    }

    @Test
    fun `episodes skip specials, sort and never repeat an id`() {
        val videos = Json.parseToJsonElement(
            """[
              {"id":"tt2861424:2:1","season":2,"episode":1,"name":"A Rickle in Time"},
              {"id":"tt2861424:0:1","season":0,"episode":1,"name":"Special"},
              {"id":"tt2861424:1:2","season":1,"episode":2,"name":"Lawnmower Dog","thumbnail":null},
              {"id":"tt2861424:1:1","season":"1","number":1,"title":"Pilot"},
              {"id":"tt2861424:1:1","season":1,"episode":1,"name":"Pilot (dup)"},
              {"season":1,"episode":2,"name":"Lawnmower Dog (no id)"},
              {"id":"x","season":null,"episode":null},
              null, "junk"
            ]""",
        )
        val eps = MetaJson.parseEpisodes(videos, "tt2861424", "fallback.jpg")
        assertEquals(listOf("tt2861424:1:1", "tt2861424:1:2", "tt2861424:2:1"), eps.map { it.id })
        assertEquals(eps.size, eps.map { it.id }.toSet().size)
        assertEquals("Pilot", eps[0].title)
        assertEquals("fallback.jpg", eps[1].thumbnail)
        assertEquals(listOf(1, 1, 2), eps.map { it.season })
    }

    @Test
    fun `episodes without an id get a stable one`() {
        val videos = Json.parseToJsonElement("""[{"season":3,"episode":4,"name":"x"}]""")
        assertEquals("tt1:3:4", MetaJson.parseEpisodes(videos, "tt1", "").single().id)
        assertTrue(MetaJson.parseEpisodes(null, "tt1", "").isEmpty())
    }

    @Test
    fun `meta with null director cast genres and videos parses to empty values`() {
        val meta = obj("""{"id":"tt2861424","name":"Rick and Morty","director":null,"cast":null,"genres":null,"videos":null,"trailers":null}""")
        assertTrue(MetaJson.strings(meta["director"]).isEmpty())
        assertTrue(MetaJson.strings(meta["cast"]).isEmpty())
        assertTrue(MetaJson.strings(meta["genres"]).isEmpty())
        assertTrue(MetaJson.arr(meta["trailers"]).isEmpty())
        assertTrue(MetaJson.parseEpisodes(meta["videos"], "tt2861424", "").isEmpty())
        assertEquals("Rick and Morty", MetaJson.text(meta, "name"))
    }
}
