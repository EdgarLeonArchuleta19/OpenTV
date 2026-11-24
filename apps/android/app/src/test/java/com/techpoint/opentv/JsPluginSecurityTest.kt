package com.techpoint.opentv

import com.techpoint.opentv.core.jsplugins.JsPluginSecurity
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class JsPluginSecurityTest {
    private fun obj(raw: String) = Json.parseToJsonElement(raw).jsonObject

    @Test
    fun `approved helper loads from HEAD unless pinned`() {
        val spec = JsPluginSecurity.helperFromConsumes(obj("""{"repo":"xuper-plugin/kino-plugin-kino-resolver"}"""))!!
        assertEquals("xuper-plugin/kino-plugin-kino-resolver", spec.repo)
        assertEquals("https://raw.githubusercontent.com/xuper-plugin/kino-plugin-kino-resolver/HEAD", spec.base)
        assertNull(spec.sha256)

        val hash = "B".repeat(64)
        val pinned = JsPluginSecurity.helperFromConsumes(
            obj("""{"repo":"xuper-plugin/kino-plugin-kino-resolver","commit":"0123abcd","sha256":"sha256:$hash"}"""),
        )!!
        assertEquals("https://raw.githubusercontent.com/xuper-plugin/kino-plugin-kino-resolver/0123abcd", pinned.base)
        assertEquals(hash.lowercase(), pinned.sha256)
    }

    @Test
    fun `non approved helper is rejected with a Spanish message`() {
        try {
            JsPluginSecurity.helperFromConsumes(obj("""{"repo":"evil/helper"}"""))
            fail("should have thrown")
        } catch (e: JsPluginSecurity.HelperRejectedException) {
            assertEquals("Este plugin necesita un plugin auxiliar no verificado: evil/helper", e.userMessage)
        }
        assertNull(JsPluginSecurity.helperFromConsumes(obj("""{}""")))
        assertNull(JsPluginSecurity.helperFromConsumes(obj("""{"repo":"../../x"}""")))
    }

    @Test
    fun `call ids are random 128-bit hex and sha256 is standard`() {
        val ids = (1..200).map { JsPluginSecurity.randomCallId() }.toSet()
        assertEquals(200, ids.size)
        assertTrue(ids.all { Regex("^h_[0-9a-f]{32}$").matches(it) })
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", JsPluginSecurity.sha256Hex("abc"))
    }
}
