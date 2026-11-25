package com.techpoint.opentv.core.addons

import com.techpoint.opentv.core.model.ExternalSubtitle
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import java.util.Locale

/**
 * Order of the external subtitles in the player (embedded tracks are always listed before them):
 * local file, OpenSubtitles v3 (and other subtitle plugins), SubDL, then SubtitleCat last.
 * Inside each source: Latin-American Spanish, other Spanish, English, then the rest.
 */
object SubtitleOrder {
    const val SOURCE_LOCAL = "Archivo local"
    const val SOURCE_SUBDL = "SubDL"
    const val SOURCE_SUBTITLECAT = "SubtitleCat"

    /** Max entries kept per source, so a long first source never pushes the later ones out. */
    const val PER_SOURCE = 8

    private val LATAM_REGIONS = setOf(
        "419", "mx", "la", "lat", "latam", "us", "ar", "co", "cl", "pe", "ve", "ec", "gt", "cu", "bo",
        "do", "hn", "py", "sv", "ni", "cr", "pa", "uy", "pr",
    )

    fun sourceRank(source: String): Int {
        val s = source.lowercase(Locale.ROOT)
        return when {
            source == SOURCE_LOCAL -> 0
            "opensubtitles" in s -> 1
            s == SOURCE_SUBDL.lowercase(Locale.ROOT) -> 3
            s == SOURCE_SUBTITLECAT.lowercase(Locale.ROOT) -> 4
            else -> 2 // other installed subtitle plugins
        }
    }

    /** True for Latin-American Spanish codes/labels: es-419, es-MX, spn/ea (OpenSubtitles), "latino". */
    fun isLatamSpanish(lang: String, label: String = ""): Boolean {
        val l = lang.trim().lowercase(Locale.ROOT).replace('_', '-')
        val lab = label.lowercase(Locale.ROOT)
        if (l == "spn" || l == "ea" || l == "es-la" || l == "lat") return true
        if ("latin" in lab || "latam" in lab || "latinoam" in lab) return true
        val base = l.substringBefore('-')
        val region = l.substringAfter('-', "")
        return (base == "es" || base == "spa") && region in LATAM_REGIONS
    }

    fun isSpanish(lang: String, label: String = ""): Boolean {
        val l = lang.trim().lowercase(Locale.ROOT)
        val base = l.substringBefore('-').substringBefore('_')
        return isLatamSpanish(lang, label) || base == "es" || base == "spa" || l == "spanish" ||
            label.lowercase(Locale.ROOT).let { it.startsWith("español") || it.startsWith("spanish") }
    }

    fun isEnglish(lang: String, label: String = ""): Boolean {
        val base = lang.trim().lowercase(Locale.ROOT).substringBefore('-').substringBefore('_')
        return base == "en" || base == "eng" || base == "english" ||
            label.lowercase(Locale.ROOT).let { it.startsWith("inglés") || it.startsWith("english") }
    }

    fun langRank(lang: String, label: String = ""): Int = when {
        isLatamSpanish(lang, label) -> 0
        isSpanish(lang, label) -> 1
        isEnglish(lang, label) -> 2
        else -> 3
    }

    /** Sorted (stable) by source then language, deduplicated by URL, [PER_SOURCE] per source. */
    fun order(subs: List<ExternalSubtitle>): List<ExternalSubtitle> =
        subs.distinctBy { it.url }
            .sortedWith(compareBy<ExternalSubtitle>({ sourceRank(it.source) }, { langRank(it.lang, it.label) }))
            .groupBy { sourceRank(it.source) to it.source }
            .values
            .flatMap { it.take(PER_SOURCE) }

    /** Adds a source's results to what the player already lists. */
    fun merge(current: List<ExternalSubtitle>, added: List<ExternalSubtitle>): List<ExternalSubtitle> =
        if (added.isEmpty()) current else order(current + added)

    /**
     * `subdlSearch` response -> subtitles; empty on `available:false`, an error or bad entries.
     * Only http(s) URLs are kept (the core serves them on 127.0.0.1).
     */
    fun parseSubdl(res: JsonObject?): List<ExternalSubtitle> {
        if (res == null) return emptyList()
        if ((res["available"] as? JsonPrimitive)?.booleanOrNull == false) return emptyList()
        return MetaJson.arr(res["subtitles"]).mapIndexedNotNull { idx, el ->
            val o = el as? JsonObject ?: return@mapIndexedNotNull null
            val url = MetaJson.text(o, "url")
            if (!url.startsWith("http://") && !url.startsWith("https://")) return@mapIndexedNotNull null
            val lang = MetaJson.text(o, "lang").lowercase(Locale.ROOT)
            ExternalSubtitle(
                id = "subdl_" + MetaJson.text(o, "id").ifBlank { idx.toString() },
                url = url,
                lang = lang,
                label = MetaJson.text(o, "label").ifBlank { lang.uppercase(Locale.ROOT).ifBlank { "Subtítulo" } },
                source = SOURCE_SUBDL,
            )
        }
    }
}
