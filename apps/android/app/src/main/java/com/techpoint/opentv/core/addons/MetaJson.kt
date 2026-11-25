package com.techpoint.opentv.core.addons

import com.techpoint.opentv.core.model.Episode
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

/**
 * Lenient readers for plugin / Cinemeta JSON. Real metas carry `null` (or the wrong type) in
 * fields that are usually arrays or strings — e.g. Cinemeta's Rick and Morty meta has
 * `"director": null` — and kotlinx's `jsonArray` / `jsonPrimitive` accessors throw on those,
 * which crashed the app on the detail screen. These helpers never throw.
 */
object MetaJson {
    /** The elements of [el] when it is an array; empty for null, JsonNull, objects or strings. */
    fun arr(el: JsonElement?): List<JsonElement> = (el as? JsonArray).orEmpty()

    /** Non-blank strings of an array (numbers kept as text); anything else is skipped. */
    fun strings(el: JsonElement?): List<String> =
        arr(el).mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf(String::isNotEmpty) }

    /** Trimmed text of a primitive field; empty for missing, null, arrays and objects. */
    fun text(obj: JsonObject?, key: String): String =
        (obj?.get(key) as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()

    /** Integer of a primitive field ("3" or 3); null otherwise. */
    fun int(obj: JsonObject?, key: String): Int? = (obj?.get(key) as? JsonPrimitive)?.let {
        it.intOrNull ?: it.contentOrNull?.trim()?.toIntOrNull()
    }

    /**
     * Stremio meta `videos` -> episodes: specials (season 0) dropped, sorted by season/number and
     * deduplicated by id and by season+number (lazy rows key episodes by id, and a repeated key
     * crashes Compose).
     */
    fun parseEpisodes(videos: JsonElement?, rawId: String, fallbackThumb: String): List<Episode> =
        arr(videos).mapNotNull { el ->
            val v = el as? JsonObject ?: return@mapNotNull null
            val season = int(v, "season") ?: 1
            val number = int(v, "episode") ?: int(v, "number") ?: return@mapNotNull null
            if (season <= 0 || number < 0) return@mapNotNull null
            Episode(
                id = text(v, "id").ifBlank { "$rawId:$season:$number" },
                season = season,
                number = number,
                title = text(v, "title").ifBlank { text(v, "name").ifBlank { "Episodio $number" } },
                overview = text(v, "overview").ifBlank { text(v, "description") },
                thumbnail = text(v, "thumbnail").ifBlank { fallbackThumb },
                released = text(v, "released").take(10),
            )
        }
            .sortedWith(compareBy<Episode>({ it.season }, { it.number }))
            .distinctBy { it.id }
            .distinctBy { it.season to it.number }
}
