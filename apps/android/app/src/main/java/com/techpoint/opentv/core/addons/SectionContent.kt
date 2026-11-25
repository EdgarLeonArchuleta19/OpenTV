package com.techpoint.opentv.core.addons

import com.techpoint.opentv.core.model.MediaItem
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Calendar
import java.util.Locale

/**
 * Content selection for the Kids and Anime sections (pure helpers, port of the desktop
 * `sectionContent.ts`).
 *
 * - Kids: all-ages titles from TMDB through the Rust core (Mexico "AA"/"A", US "G"/"PG" only
 *   as fallback; TV needs the Kids genre). The list names are served by `tmdb.rs`.
 * - Anime: TMDB lists (`anime:*`, IMDb ids); the current season on Kitsu (`kitsu:` ids, served
 *   by the hidden Anime Kitsu plugin) and its catalogs are only fallbacks (see [CatalogRows]).
 * - The first row of both sections drives the hero: its order rotates once a day.
 */
object SectionContent {
    const val KIDS_MOVIES_POPULAR = "kids-movies-popular"
    const val KIDS_MOVIES_ANIMATED = "kids-movies-animated"
    const val KIDS_TV_POPULAR = "kids-tv-popular"
    const val KIDS_TV_TOP = "kids-tv-top"
    const val ANIME_SEASON = "anime-season"

    private val IMDB_ID = Regex("^tt\\d{5,}$")
    private val DIGITS = Regex("^\\d+$")

    private fun JsonObject.text(key: String): String =
        (this[key] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()

    private fun JsonObject.score(key: String): String {
        val v = (this[key] as? JsonPrimitive)?.doubleOrNull ?: return ""
        return if (v > 0) String.format(Locale.US, "%.1f", v) else ""
    }

    /**
     * One item of a TMDB list served by the core (`kids-*`, `cat:*`, `anime:*`, `find:`) ->
     * catalog item with a Cinemeta-compatible `stremio:tt…` id; null without an IMDb id.
     * [anime] marks the Anime section rows (badge only: ids, streams and detail stay IMDb/TMDB).
     */
    fun kidsTmdbItem(raw: JsonObject, rowTitle: String = "", anime: Boolean = false): MediaItem? {
        val imdb = raw.text("imdbId")
        val title = raw.text("title")
        if (!IMDB_ID.matches(imdb) || title.isEmpty()) return null
        val original = raw.text("original")
        return MediaItem(
            id = "stremio:$imdb",
            type = if (raw.text("kind") == "tv") "series" else "movie",
            title = title,
            originalTitle = if (original != title) original else "",
            year = raw.text("year").take(4),
            score = raw.score("rating"),
            genres = (raw["genres"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty(),
            synopsis = raw.text("overview"),
            poster = raw.text("poster"),
            backdrop = raw.text("backdrop"),
            catalogRow = rowTitle,
            isAnime = anime,
        )
    }

    /** One item of the Kitsu season list (`anime-season`) -> catalog item. */
    fun animeSeasonItem(raw: JsonObject, rowTitle: String = ""): MediaItem? {
        val kitsuId = raw.text("kitsuId")
        val title = raw.text("title")
        if (!DIGITS.matches(kitsuId) || title.isEmpty()) return null
        val original = raw.text("original")
        return MediaItem(
            id = "stremio:kitsu:$kitsuId",
            type = "anime",
            title = title,
            originalTitle = if (original != title) original else "",
            year = raw.text("year").take(4),
            score = raw.score("rating"),
            synopsis = raw.text("overview"),
            poster = raw.text("poster"),
            // No cover on Kitsu: left empty so the hero (TV needs a backdrop) skips it.
            backdrop = raw.text("backdrop"),
            catalogRow = rowTitle,
            isAnime = true,
        )
    }

    /** Local calendar day ("2026-11-23"): the hero order changes once per day. */
    fun localDayKey(cal: Calendar = Calendar.getInstance()): String = String.format(
        Locale.US,
        "%04d-%02d-%02d",
        cal.get(Calendar.YEAR),
        cal.get(Calendar.MONTH) + 1,
        cal.get(Calendar.DAY_OF_MONTH),
    )

    /** FNV-1a 32-bit hash (unsigned, kept in a Long): stable seed from a string. */
    private fun hashSeed(s: String): Long {
        var h = 0x811c9dc5L
        for (ch in s) {
            h = h xor ch.code.toLong()
            h = (h * 0x01000193L) and 0xFFFFFFFFL
        }
        return h
    }

    /** Same LCG as the desktop port (Numerical Recipes constants, mod 2^32). */
    private fun nextRand(state: Long): Long = (state * 1664525L + 1013904223L) and 0xFFFFFFFFL

    /**
     * Daily hero rotation: picks [pick] items with a backdrop among the first [pool] items of the
     * row (seeded by [seedKey], e.g. "anime:2026-11-23") and moves them to the front; the rest
     * keeps its order. Same key -> same order, so the hero is stable during the day.
     */
    fun dailyHeroOrder(items: List<MediaItem>, seedKey: String, pool: Int = 20, pick: Int = 6): List<MediaItem> {
        val candidates = items.take(pool).filter { it.backdrop.isNotBlank() }
        if (candidates.size <= 1) return items
        var state = hashSeed(seedKey)
        val shuffled = candidates.toMutableList()
        for (i in shuffled.size - 1 downTo 1) {
            state = nextRand(state)
            val j = (state % (i + 1)).toInt()
            val tmp = shuffled[i]
            shuffled[i] = shuffled[j]
            shuffled[j] = tmp
        }
        val chosen = shuffled.take(pick)
        val chosenIds = chosen.mapTo(HashSet()) { it.id }
        return chosen + items.filter { it.id !in chosenIds }
    }
}
