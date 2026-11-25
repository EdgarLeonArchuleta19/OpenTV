package com.techpoint.opentv.core.addons

import com.techpoint.opentv.core.model.MediaItem
import java.text.Normalizer
import java.util.Locale

/** Pure merge + ordering of the search sources (see `StremioClient.search`). */
object SearchResults {
    const val MAX_RESULTS = 50

    /**
     * [tmdb] results first; [cinemeta] only when TMDB returned nothing (and only the entries
     * with a poster); then [anime] (dropped for the Kids profile). Ids are unique (the result
     * grids key cards by id). The Kids profile keeps only titles seen in the all-ages Kids
     * lists ([kidsApproved]) or tagged Family. The result is ordered by [order] for [query].
     */
    fun merge(
        tmdb: List<MediaItem>,
        anime: List<MediaItem>,
        cinemeta: List<MediaItem>,
        kidsOnly: Boolean,
        kidsApproved: Set<String> = emptySet(),
        query: String = "",
    ): List<MediaItem> {
        val main = tmdb.ifEmpty { cinemeta.filter { it.poster.isNotBlank() } }
        val all = if (kidsOnly) {
            main.filter { item ->
                item.id in kidsApproved || item.genres.any { it.equals("Family", ignoreCase = true) }
            }
        } else {
            main + anime
        }
        return order(all.distinctBy { it.id }, query).take(MAX_RESULTS)
    }

    /**
     * Text match first, newest first inside each tier:
     * 1 = title or original title equals the query, 2 = starts with it, 3 = contains it,
     * 4 = anything else. Inside a tier: year descending, items without a year last; ties keep
     * the incoming (TMDB relevance) order.
     */
    fun order(items: List<MediaItem>, query: String): List<MediaItem> {
        val q = normalize(query)
        return items.sortedWith(
            compareBy<MediaItem> { tier(it, q) }
                .thenByDescending { year(it) ?: Int.MIN_VALUE },
        )
    }

    /** 1..4 as described in [order] (4 for a blank query). */
    fun tier(item: MediaItem, normalizedQuery: String): Int {
        if (normalizedQuery.isEmpty()) return 4
        val titles = listOf(item.title, item.originalTitle).map(::normalize).filter { it.isNotEmpty() }
        return when {
            titles.any { it == normalizedQuery } -> 1
            titles.any { it.startsWith(normalizedQuery) } -> 2
            titles.any { it.contains(normalizedQuery) } -> 3
            else -> 4
        }
    }

    private fun year(item: MediaItem): Int? =
        item.year.trim().take(4).toIntOrNull()?.takeIf { it in 1800..3000 }

    private val DIACRITICS = Regex("\\p{Mn}+")
    private val NON_ALNUM = Regex("[^\\p{L}\\p{N}]+")

    /** Lowercase, no accents, punctuation as spaces, collapsed whitespace. */
    fun normalize(text: String): String =
        Normalizer.normalize(text.lowercase(Locale.ROOT), Normalizer.Form.NFD)
            .replace(DIACRITICS, "")
            .replace(NON_ALNUM, " ")
            .trim()
}
