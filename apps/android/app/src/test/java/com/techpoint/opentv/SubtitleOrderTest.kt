package com.techpoint.opentv

import com.techpoint.opentv.core.addons.SubtitleOrder
import com.techpoint.opentv.core.model.ExternalSubtitle
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SubtitleOrderTest {
    private fun sub(id: String, lang: String, source: String, label: String = "") =
        ExternalSubtitle(id = id, url = "https://x/$id.srt", lang = lang, label = label, source = source)

    @Test
    fun `sources go OpenSubtitles, SubDL, then SubtitleCat`() {
        val ordered = SubtitleOrder.order(
            listOf(
                sub("cat", "es", SubtitleOrder.SOURCE_SUBTITLECAT),
                sub("dl", "es", SubtitleOrder.SOURCE_SUBDL),
                sub("os", "spa", "OpenSubtitles v3"),
                sub("local", "es", SubtitleOrder.SOURCE_LOCAL),
                sub("other", "es", "Otro plugin de subtítulos"),
            ),
        )
        assertEquals(listOf("local", "os", "other", "dl", "cat"), ordered.map { it.id })
    }

    @Test
    fun `Latin-American Spanish, then Spanish, then English inside each source`() {
        val os = "OpenSubtitles v3"
        val ordered = SubtitleOrder.order(
            listOf(
                sub("fr", "fre", os),
                sub("en", "eng", os),
                sub("es", "spa", os),
                sub("la", "spn", os),
                sub("dl-en", "en", SubtitleOrder.SOURCE_SUBDL),
                sub("dl-es", "es", SubtitleOrder.SOURCE_SUBDL),
                sub("dl-mx", "es-419", SubtitleOrder.SOURCE_SUBDL),
                sub("dl-lat", "es", SubtitleOrder.SOURCE_SUBDL, label = "Español (Latino)"),
            ),
        )
        assertEquals(listOf("la", "es", "en", "fr", "dl-mx", "dl-lat", "dl-es", "dl-en"), ordered.map { it.id })
    }

    @Test
    fun `language detection`() {
        assertTrue(SubtitleOrder.isLatamSpanish("es-MX"))
        assertTrue(SubtitleOrder.isLatamSpanish("es_419"))
        assertTrue(SubtitleOrder.isLatamSpanish("spn"))
        assertFalse(SubtitleOrder.isLatamSpanish("es-ES"))
        assertFalse(SubtitleOrder.isLatamSpanish("spa"))
        assertTrue(SubtitleOrder.isSpanish("spa"))
        assertTrue(SubtitleOrder.isEnglish("eng"))
        assertEquals(3, SubtitleOrder.langRank("por"))
    }

    @Test
    fun `merge dedupes by URL and caps each source`() {
        val many = (1..12).map { sub("os$it", "eng", "OpenSubtitles v3") }
        val merged = SubtitleOrder.merge(many, listOf(sub("os1", "eng", "OpenSubtitles v3"), sub("cat", "es", SubtitleOrder.SOURCE_SUBTITLECAT)))
        assertEquals(SubtitleOrder.PER_SOURCE + 1, merged.size)
        assertEquals("cat", merged.last().id)
        assertEquals(many, SubtitleOrder.merge(many, emptyList()))
    }

    @Test
    fun `SubDL response is skipped when unavailable and parsed null-safely`() {
        fun obj(raw: String) = Json.parseToJsonElement(raw).jsonObject
        assertTrue(SubtitleOrder.parseSubdl(null).isEmpty())
        assertTrue(SubtitleOrder.parseSubdl(obj("""{"available":false,"subtitles":[{"url":"http://127.0.0.1/a"}]}""")).isEmpty())
        assertTrue(SubtitleOrder.parseSubdl(obj("""{"error":"boom"}""")).isEmpty())
        val subs = SubtitleOrder.parseSubdl(
            obj(
                """{"available":true,"subtitles":[
                {"id":"77","lang":"ES-419","label":"Español (Latinoamérica)","url":"http://127.0.0.1:5000/subdl/77.srt?t=x"},
                {"id":null,"lang":null,"label":null,"url":null},
                {"id":"78","lang":"en","label":null,"url":"http://127.0.0.1:5000/subdl/78.srt"},
                null
                ]}""",
            ),
        )
        assertEquals(listOf("subdl_77", "subdl_78"), subs.map { it.id })
        assertEquals("es-419", subs[0].lang)
        assertEquals("EN", subs[1].label)
        assertTrue(subs.all { it.source == SubtitleOrder.SOURCE_SUBDL })
    }
}
