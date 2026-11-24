package com.techpoint.opentv

import com.techpoint.opentv.core.jsplugins.JsPluginMatch
import com.techpoint.opentv.core.jsplugins.JsPluginMatch.TitleQuery
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class JsPluginMatchTest {
    private fun objs(raw: String): List<JsonObject> = Json.parseToJsonElement(raw).jsonArray.map { it.jsonObject }

    @Test
    fun `accepts the Spanish first hit of the same year and rejects other films`() {
        val hits = JsPluginMatch.pickSearchHits(
            objs("""[{"ref":"m:el-origen","title":"El origen","kind":"movie","year":"2010"},{"ref":"m:sin-origen","title":"Sin origen","kind":"movie","year":"2019"}]"""),
            TitleQuery("Inception", year = 2010, kind = "movie"),
        )
        assertEquals(listOf("m:el-origen"), hits.map { it.ref })

        val none = JsPluginMatch.pickSearchHits(
            objs("""[{"ref":"s:better-call-saul","title":"Better Call Saul","kind":"series","year":"2015"},{"ref":"m:z","title":"Guerra mundial Z","kind":"movie","year":2013}]"""),
            TitleQuery("Breaking Bad", year = 2008, kind = "series"),
        )
        assertTrue(none.isEmpty())
    }

    @Test
    fun `yearless translated first hit needs confirmation`() {
        val q = TitleQuery("Inception", year = 2010, kind = "movie")
        val hits = JsPluginMatch.pickSearchHits(objs("""[{"ref":"m:el-origen","title":"El Origen","kind":"movie"}]"""), q)
        assertTrue(hits.single().verify)
        assertTrue(JsPluginMatch.confirmsYear(Json.parseToJsonElement("""{"year":"2010"}"""), q))
        assertFalse(JsPluginMatch.confirmsYear(Json.parseToJsonElement("""{"year":"2012"}"""), q))
    }

    @Test
    fun `flattens resolve answers with alternatives and header lists`() {
        val rows = JsPluginMatch.streamsFromResolve(
            Json.parseToJsonElement(
                """{"url":"https://a.example/master.m3u8","label":"Latino · fastream.to","headers":{"User-Agent":"UA","Referer":"https://pelispedia.is/"},
                   "alternatives":[{"url":"https://b.example/v.mp4","label":"Relay"},{"ref":"c:m:x@1","label":"Lazy"}]}""",
            ),
        )
        assertEquals(listOf("https://a.example/master.m3u8", "https://b.example/v.mp4"), rows.map { it.url })
        assertEquals("UA", rows[1].headers["User-Agent"])

        val kino = JsPluginMatch.streamsFromResolve(
            Json.parseToJsonElement("""{"streams":[{"url":"https://h.example/x.m3u8","referer":"https://w.example/","headers":[{"name":"Origin","value":"https://w.example"}]}]}"""),
        )
        assertEquals(mapOf("Origin" to "https://w.example", "Referer" to "https://w.example/"), kino.single().headers)
        assertTrue(JsPluginMatch.streamsFromResolve(Json.parseToJsonElement("""[{"url":"javascript:alert(1)"}]""")).isEmpty())
    }

    @Test
    fun `episodes match exactly and never fall back`() {
        val eps = JsPluginMatch.flattenEpisodes(
            Json.parseToJsonElement("""{"series":{},"episodes":[{"season":1,"number":1,"ref":"e:a"},{"season":2,"number":3,"ref":"e:b"}]}"""),
        )
        assertEquals("e:b", JsPluginMatch.pickEpisodeRef(eps, 2, 3))
        assertEquals("", JsPluginMatch.pickEpisodeRef(eps, 4, 1))
    }

    @Test
    fun `cookies language and failure messages`() {
        val jar = mutableMapOf<String, MutableMap<String, String>>()
        JsPluginMatch.absorbCookies(jar, listOf("sid=abc; Path=/", "cf=1; Domain=.example.com"), "https://www.site.to/x")
        assertEquals("sid=abc", JsPluginMatch.cookieHeaderFor(jar, "https://www.site.to/y"))
        assertEquals("cf=1", JsPluginMatch.cookieHeaderFor(jar, "https://api.example.com/"))

        val langs = mapOf("fastream.to" to "es-ES,es;q=0.9")
        assertEquals("es-ES,es;q=0.9", JsPluginMatch.withRequestLanguage(emptyMap(), "https://s40.fastream.to/m.m3u8", langs)["Accept-Language"])

        assertEquals("Cuevana Pro: no encontró este título", JsPluginMatch.failureMessage("Cuevana Pro", "not_found", "x", ""))
        assertEquals("Pelispedia: Ningún servidor abrió", JsPluginMatch.failureMessage("Pelispedia", "not_found", "x", "Ningún servidor abrió."))
        assertTrue(JsPluginMatch.failureMessage("X", "error", "Este aparato no pudo compilar el plugin JS: Unexpected token", "").contains("WebView"))
    }

    @Test
    fun `keeps the plugin language field and maps it for the ranker`() {
        val rows = JsPluginMatch.streamsFromResolve(
            Json.parseToJsonElement("""[{"url":"https://a.example/x.m3u8","label":"StreamWish","lang":"es-MX"}]"""),
        )
        assertEquals("es-MX", rows.single().lang)
        assertEquals("Latino", JsPluginMatch.langWord("es-MX"))
        assertEquals("Castellano", JsPluginMatch.langWord("es-ES"))
        assertEquals("English", JsPluginMatch.langWord("en"))
        assertEquals("", JsPluginMatch.langWord(" "))
    }
}
