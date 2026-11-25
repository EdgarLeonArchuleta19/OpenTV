package com.techpoint.opentv.core.addons

import com.techpoint.opentv.core.model.Episode
import com.techpoint.opentv.core.model.MediaItem
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

/**
 * Maps the core's TMDB title detail (`detail:<imdbId>`) and season episodes
 * (`episodes:<tmdbTvId>:<season>`) to the app models. Pure and null-safe: every field may be
 * missing or `null` (uses [MetaJson]), and nothing here throws.
 */
object TmdbDetail {
    data class Parsed(
        val tmdbId: String,
        val item: MediaItem,
        val seasons: List<Int>,
        val related: List<MediaItem>,
    )

    private fun JsonObject.textOf(key: String): String {
        val p = this[key] as? JsonPrimitive ?: return ""
        // Numbers (tmdbId 1399) come as JSON numbers; strip a ".0" a lenient encoder may add.
        val d = p.doubleOrNull
        if (!p.isString && d != null && d == Math.floor(d)) return d.toLong().toString()
        return MetaJson.text(this, key)
    }

    /** "117" / 117 -> "117 min"; any other text is kept; 0 or missing -> "". */
    fun runtimeLabel(obj: JsonObject?, key: String = "runtime"): String {
        val p = obj?.get(key) as? JsonPrimitive ?: return ""
        val n = p.doubleOrNull
        if (n != null) return if (n > 0) "${n.toInt()} min" else ""
        return MetaJson.text(obj, key)
    }

    /**
     * Detail response -> parsed title, or null when TMDB had nothing usable (error, unavailable,
     * no `item`): the caller then falls back to Cinemeta. [base] keeps the id, anime flag and
     * whatever the response lacks (logo, artwork).
     */
    fun parseDetail(res: JsonObject?, base: MediaItem): Parsed? {
        if (res == null) return null
        val raw = res["item"] as? JsonObject ?: return null
        val title = MetaJson.text(raw, "title")
        if (title.isEmpty()) return null
        val kind = MetaJson.text(raw, "kind")
        val original = MetaJson.text(raw, "original")
        val genres = MetaJson.strings(raw["genres"])
        val rating = (raw["rating"] as? JsonPrimitive)?.doubleOrNull
        val item = base.copy(
            type = when {
                base.type == "anime" -> base.type
                kind == "tv" -> "series"
                kind == "movie" -> "movie"
                else -> base.type
            },
            title = title,
            originalTitle = if (original.isNotEmpty() && original != title) original else base.originalTitle,
            year = MetaJson.text(raw, "year").take(4).ifBlank { base.year },
            score = if (rating != null && rating > 0) String.format(Locale.US, "%.1f", rating) else base.score,
            duration = runtimeLabel(raw).ifBlank { base.duration },
            genres = genres.ifEmpty { base.genres },
            synopsis = MetaJson.text(raw, "overview").ifBlank { base.synopsis },
            poster = MetaJson.text(raw, "poster").ifBlank { base.poster },
            backdrop = MetaJson.text(raw, "backdrop").ifBlank { base.backdrop.ifBlank { base.poster } },
            cast = MetaJson.strings(res["cast"]).take(8).ifEmpty { base.cast },
            director = MetaJson.strings(res["director"]).joinToString(", ").ifBlank { base.director },
        )
        val seasons = MetaJson.arr(res["seasons"])
            .mapNotNull { (it as? JsonPrimitive)?.let { p -> p.doubleOrNull?.toInt() ?: p.content.toIntOrNull() } }
            .filter { it > 0 }
            .distinct()
            .sorted()
        val related = MetaJson.arr(res["related"])
            .mapNotNull { (it as? JsonObject)?.let { o -> SectionContent.kidsTmdbItem(o, "Similares") } }
            .filter { it.id != base.id }
            .distinctBy { it.id }
            .take(14)
        val tmdbId = res.textOf("tmdbId").ifBlank { raw.textOf("tmdbId") }
        return Parsed(
            tmdbId = tmdbId,
            item = item,
            seasons = if (item.isSeries) seasons else emptyList(),
            related = related,
        )
    }

    /**
     * Season response -> episodes with ids `tt…:season:episode` (the id stream plugins, watch
     * progress and the Cinemeta path use). Specials / malformed entries are dropped.
     */
    fun parseEpisodes(res: JsonObject?, imdbId: String, season: Int, fallbackThumb: String): List<Episode> =
        MetaJson.arr(res?.get("episodes")).mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            val s = MetaJson.int(o, "season") ?: season
            val n = MetaJson.int(o, "number") ?: MetaJson.int(o, "episode") ?: return@mapNotNull null
            if (s <= 0 || n <= 0) return@mapNotNull null
            Episode(
                id = "$imdbId:$s:$n",
                season = s,
                number = n,
                title = MetaJson.text(o, "title").ifBlank { "Episodio $n" },
                overview = MetaJson.text(o, "overview"),
                thumbnail = MetaJson.text(o, "still").ifBlank { fallbackThumb },
                released = MetaJson.text(o, "airDate").take(10),
                runtimeMin = (o["runtime"] as? JsonPrimitive)?.doubleOrNull
                    ?.takeIf { it > 0 }?.let { Math.round(it).toInt() } ?: 0,
            )
        }
            .sortedBy { it.number }
            .distinctBy { it.id }

    /** Adds a lazily loaded season to the loaded episodes: sorted, one entry per id. */
    fun mergeEpisodes(current: List<Episode>, added: List<Episode>): List<Episode> =
        if (added.isEmpty()) current
        else (current + added)
            .distinctBy { it.id }
            .distinctBy { it.season to it.number }
            .sortedWith(compareBy<Episode>({ it.season }, { it.number }))
}
