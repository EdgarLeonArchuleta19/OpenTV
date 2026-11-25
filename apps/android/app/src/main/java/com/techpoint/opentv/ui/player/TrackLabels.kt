package com.techpoint.opentv.ui.player

import java.util.Locale

/** A track name split for the audio/subtitles panel: plain language + optional detail line. */
data class TrackLabel(val primary: String, val secondary: String = "")

/**
 * Plain Spanish names for audio/subtitle tracks ("Español (Latinoamérica)", "Inglés"…).
 * Pure Kotlin so it stays unit-testable on the JVM.
 */
object TrackLabels {
    // ISO 639-1 / 639-2 (B and T) codes -> Spanish name; the English name is used to hide
    // redundant labels such as "Spanish" under "Español".
    private data class Lang(val es: String, val en: String)

    private val LANGS: Map<String, Lang> = buildMap {
        fun add(es: String, en: String, vararg codes: String) = codes.forEach { put(it, Lang(es, en)) }
        add("Español", "Spanish", "es", "spa")
        add("Inglés", "English", "en", "eng")
        add("Portugués", "Portuguese", "pt", "por")
        add("Francés", "French", "fr", "fre", "fra")
        add("Italiano", "Italian", "it", "ita")
        add("Alemán", "German", "de", "ger", "deu")
        add("Japonés", "Japanese", "ja", "jpn")
        add("Coreano", "Korean", "ko", "kor")
        add("Chino", "Chinese", "zh", "chi", "zho")
        add("Ruso", "Russian", "ru", "rus")
        add("Árabe", "Arabic", "ar", "ara")
        add("Hindi", "Hindi", "hi", "hin")
        add("Neerlandés", "Dutch", "nl", "dut", "nld")
        add("Polaco", "Polish", "pl", "pol")
        add("Turco", "Turkish", "tr", "tur")
        add("Sueco", "Swedish", "sv", "swe")
        add("Catalán", "Catalan", "ca", "cat")
    }

    private val LATAM_REGIONS = setOf(
        "419", "mx", "la", "lat", "us", "ar", "co", "cl", "pe", "ve", "ec", "gt", "cu", "bo", "do", "hn", "py", "sv", "ni", "cr", "pa", "uy", "pr",
    )

    /** Spanish name for a language code, or null when the code is empty / undetermined. */
    fun languageName(code: String): String? {
        val norm = code.trim().lowercase(Locale.ROOT).replace('_', '-')
        if (norm.isBlank()) return null
        val base = norm.substringBefore('-')
        val region = norm.substringAfter('-', "")
        if (base in setOf("und", "mul", "zxx", "mis", "unk")) return null
        val lang = LANGS[base]
        if (lang != null) {
            return when {
                base == "es" || base == "spa" -> when {
                    region in LATAM_REGIONS -> "Español (Latinoamérica)"
                    region == "es" -> "Español (España)"
                    else -> lang.es
                }
                (base == "pt" || base == "por") && region == "br" -> "Portugués (Brasil)"
                (base == "pt" || base == "por") && region == "pt" -> "Portugués (Portugal)"
                else -> lang.es
            }
        }
        if (base.length !in 2..3 || !base.all { it in 'a'..'z' }) return null
        val display = runCatching { Locale(base).getDisplayLanguage(Locale("es")) }.getOrNull().orEmpty()
        if (display.isBlank() || display.equals(base, ignoreCase = true)) return null
        return display.replaceFirstChar { it.titlecase(Locale("es")) }
    }

    /**
     * Label for an embedded (or attached) track. The engine label usually looks like
     * "Español · Dolby Digital · 5.1" or a free text from the file ("Latino 5.1", "SDH").
     */
    fun forTrack(label: String, language: String, isAudio: Boolean, position: Int): TrackLabel {
        val name = languageName(language)
        val raw = label.trim()
        if (name == null) {
            return TrackLabel(raw.ifBlank { if (isAudio) "Pista ${position + 1}" else "Subtítulo ${position + 1}" })
        }
        val base = LANGS[language.trim().lowercase(Locale.ROOT).substringBefore('-').substringBefore('_')]
        val detail = when {
            raw.isBlank() -> ""
            raw.startsWith(name, ignoreCase = true) -> raw.substring(name.length)
            base != null && raw.startsWith(base.es, ignoreCase = true) -> raw.substring(base.es.length)
            else -> raw
        }.trim().trimStart('·', '-', '|', ',', ' ').trim()
        val redundant = detail.isBlank() ||
            detail.equals(name, ignoreCase = true) ||
            detail.equals(language.trim(), ignoreCase = true) ||
            (base != null && (detail.equals(base.en, ignoreCase = true) || detail.equals(base.es, ignoreCase = true)))
        return TrackLabel(name, if (redundant) "" else detail)
    }
}
