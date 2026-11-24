package com.techpoint.opentv.ui.components

/**
 * Display-only Spanish genre names (v1 `home/hero.js` GENRE_ES). Never use the result for
 * filtering: section rules (e.g. Kids = `Family`) match the original catalog strings.
 */
private val GENRE_ES = mapOf(
    "action" to "Acción", "adventure" to "Aventura", "animation" to "Animación", "cartoon" to "Animación",
    "comedy" to "Comedia", "crime" to "Crimen", "documentary" to "Documental", "drama" to "Drama",
    "family" to "Familia", "fantasy" to "Fantasía", "history" to "Historia", "horror" to "Terror",
    "music" to "Música", "musical" to "Musical", "mystery" to "Misterio", "romance" to "Romance",
    "sci-fi" to "Ciencia ficción", "science fiction" to "Ciencia ficción", "sport" to "Deporte",
    "thriller" to "Suspenso", "war" to "Bélica", "western" to "Western", "biography" to "Biografía",
    "reality-tv" to "Reality", "anime" to "Anime", "short" to "Corto", "tv movie" to "Película de TV",
    "game show" to "Concurso", "news" to "Noticias", "kids" to "Infantil", "reality" to "Reality",
    "talk-show" to "Entrevistas", "soap" to "Telenovela", "suspense" to "Suspenso",
    "sci-fi & fantasy" to "Ciencia ficción", "action & adventure" to "Acción", "war & politics" to "Bélica",
    "film-noir" to "Cine negro",
)

fun genreEs(genre: String): String {
    val g = genre.trim()
    return GENRE_ES[g.lowercase()] ?: g
}

/**
 * Formats deduplicated Spanish genres with v1/PC hero bullet separator (`Acción • Aventura • Drama`).
 */
fun formatHeroGenres(genres: List<String>, max: Int = 3): String =
    genres.asSequence()
        .map(::genreEs)
        .filter { it.isNotBlank() }
        .distinct()
        .take(max)
        .joinToString(" • ")

/**
 * Normalizes runtime strings like `"173 min"` or `"120"` into Spanish `"2 h 53 min"` / `"2 h"`
 * matching PC & OpenTV v1 (`formatDurationEs`).
 */
fun formatDurationEs(raw: String): String {
    val s = raw.trim()
    if (s.isBlank() || s == "—") return ""
    // Already formatted with hours (e.g. "2 h 15 min" or "1h 40m")
    if (Regex("""\d+\s*h\b""", RegexOption.IGNORE_CASE).containsMatchIn(s)) return s
    val mins = Regex("""^(\d+)\s*(?:min(?:s|utos?)?|m)?$""", RegexOption.IGNORE_CASE)
        .find(s)?.groupValues?.get(1)?.toIntOrNull() ?: return s
    if (mins <= 0) return ""
    val h = mins / 60
    val m = mins % 60
    return when {
        h > 0 && m > 0 -> "$h h $m min"
        h > 0 -> "$h h"
        else -> "$m min"
    }
}
