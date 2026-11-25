package com.techpoint.opentv.core.live

import com.techpoint.opentv.core.model.EpgProgram
import com.techpoint.opentv.core.model.LiveChannel
import java.text.Normalizer
import java.util.Locale
import kotlin.math.ceil

/**
 * Placeholder guides & supplementary guide helpers (pure, unit-tested; same rules as the
 * desktop `liveSchedule.ts`).
 */
object EpgPlaceholder {

    private val diacritics = Regex("\\p{Mn}+")
    private val nonAlnum = Regex("[^a-z0-9]+")
    private val hourWord = Regex("""\s+(?:h|hr|hrs|hora|horas|hour|hours)\s*$""", RegexOption.IGNORE_CASE)
    private val feedSuffix = Regex(
        """\s*(?:[-+]\s*\d{1,2}\s*(?:h|hr|hrs|hora|horas|hour|hours)?|\b(?:east|west|este|oeste))\s*$""",
        RegexOption.IGNORE_CASE,
    )
    private val genericTitles = setOf(
        "tbd", "tba", "programa", "programacion", "sin informacion", "sin programacion",
        "to be announced", "no information", "programming",
    )
    private val guideCountries = setOf("mx", "ar", "es", "co", "cl", "pe", "ec", "uy", "do", "cr", "pa", "sv", "br")
    private val tvgIdCountry = Regex("""\.([a-zA-Z]{2})(?:@|$)""")

    /** Lowercase, no accents, only letters/digits separated by single spaces. */
    fun fold(s: String): String =
        Normalizer.normalize(s, Normalizer.Form.NFD)
            .replace(diacritics, "")
            .lowercase(Locale.ROOT)
            .replace(nonAlnum, " ")
            .trim()

    /** Folded forms a placeholder guide uses: "Azteca UNO -1 hora" -> "azteca uno 1 hora", "azteca uno 1", "azteca uno". */
    fun nameVariants(names: List<String>): Set<String> {
        val out = LinkedHashSet<String>()
        for (raw in names) {
            val name = raw.trim()
            if (name.isEmpty()) continue
            for (v in listOf(name, name.replace(hourWord, ""), name.replace(feedSuffix, ""))) {
                val f = fold(v)
                if (f.isNotEmpty()) out.add(f)
            }
        }
        return out
    }

    /**
     * True when (almost) every programme is titled with the channel's own name (or "TBD").
     * An empty list is not a placeholder: that is the "no guide" case.
     */
    fun isPlaceholder(names: List<String>, programmes: List<EpgProgram?>): Boolean {
        val list = programmes.filterNotNull()
        if (list.isEmpty()) return false
        val variants = nameVariants(names)
        val fake = list.count { p ->
            val t = fold(p.title)
            t.isEmpty() || t in genericTitles || t in variants
        }
        return fake >= ceil(list.size * 0.8).toInt()
    }

    fun namesOf(ch: LiveChannel): List<String> = listOf(ch.name, ch.tvgName).filter { it.isNotBlank() }

    /**
     * Country of the supplementary guide: tvg-id suffix ("AztecaUno.mx@SD"), then the playlist
     * id ("pluto_ar"), then the guide file ("…/mx.xml.gz"), else "mx".
     */
    fun guessCountry(tvgId: String, playlistId: String, epgUrl: String): String {
        tvgIdCountry.find(tvgId.trim())?.let { return it.groupValues[1].lowercase(Locale.ROOT) }
        fun pick(text: String) = text.lowercase(Locale.ROOT).split(Regex("[^a-z0-9]+")).firstOrNull { it in guideCountries }
        pick(playlistId)?.let { return it }
        val path = epgUrl.substringBefore('?').substringBefore('#').split('/').takeLast(2).joinToString("/")
        return pick(path) ?: "mx"
    }

    /** Key of a channel in the now/next map (tvg-id, tvg-name, or its url when it has neither). */
    fun keyOf(ch: LiveChannel): String =
        ch.tvgId.ifBlank { ch.tvgName.ifBlank { "url:${ch.url}" } }.lowercase(Locale.ROOT)
}
