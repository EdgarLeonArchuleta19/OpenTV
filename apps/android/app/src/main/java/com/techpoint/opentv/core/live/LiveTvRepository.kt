package com.techpoint.opentv.core.live

import com.techpoint.opentv.core.model.EpgNowNext
import com.techpoint.opentv.core.model.EpgProgram
import com.techpoint.opentv.core.model.LiveChannel
import com.techpoint.opentv.core.model.M3uPlaylist
import com.techpoint.opentv.service.RustServiceBridge
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.util.Locale

/**
 * Loads user M3U playlists, filters adult groups, loads EPG "Ahora / Después",
 * 12h channel schedules (`epgSchedule`), and resolves live streams via Rust `opentv-core`.
 */
class LiveTvRepository {

    private val adultGroupRe = Regex(
        // "18+" / "+18" sit outside \b: '+' is not a word char, so \b would never match around it.
        """\b(?:xxx|adult|adulto|adultos|porn|porno|erotic|erotico|onlyfans|sex|hentai|nsfw)\b|18\+|\+18""",
        RegexOption.IGNORE_CASE,
    )

    suspend fun loadChannels(playlists: List<M3uPlaylist>): Pair<List<LiveChannel>, List<String>> = coroutineScope {
        val enabled = playlists.filter { it.enabled && it.url.isNotBlank() }
        if (enabled.isEmpty()) return@coroutineScope emptyList<LiveChannel>() to emptyList()

        val epgUrls = mutableSetOf<String>()
        val jobs = enabled.map { pl ->
            async {
                val res = RustServiceBridge.callRpc(
                    "fetchM3u",
                    buildJsonObject {
                        put("url", pl.url)
                        put("allowLan", pl.allowLan)
                    },
                )
                val epgUrl = res["epgUrl"]?.jsonPrimitive?.contentOrNull.orEmpty()
                if (epgUrl.isNotBlank()) synchronized(epgUrls) { epgUrls.add(epgUrl) }

                res["channels"]?.jsonArray.orEmpty().mapIndexedNotNull { idx, el ->
                    val o = el as? JsonObject ?: return@mapIndexedNotNull null
                    val url = o.str("url")
                    val name = o.str("name")
                    val group = o.str("group").ifBlank { "General" }
                    if (url.isBlank() || name.isBlank()) return@mapIndexedNotNull null
                    if (adultGroupRe.containsMatchIn(group) || adultGroupRe.containsMatchIn(name)) {
                        return@mapIndexedNotNull null
                    }
                    LiveChannel(
                        id = "${pl.id}_$idx",
                        name = name,
                        url = url,
                        logo = o.str("logo"),
                        group = group,
                        tvgId = o.str("tvgId"),
                        tvgName = o.str("tvgName"),
                        epgUrl = epgUrl,
                        userAgent = o.str("userAgent"),
                        referrer = o.str("referrer"),
                        playlistId = pl.id,
                    )
                }
            }
        }

        val channels = jobs.awaitAll().flatten().distinctBy { it.url }
        channels to epgUrls.toList()
    }

    /** Loads EPG "Ahora / Después" for the visible slice of channels (memory-friendly for TV). */
    suspend fun loadEpgNowNext(
        epgUrls: List<String>,
        channels: List<LiveChannel>,
    ): Map<String, EpgNowNext> {
        if (epgUrls.isEmpty() || channels.isEmpty()) return emptyMap()
        val ids = channels.mapNotNull { it.tvgId.ifBlank { it.tvgName.ifBlank { null } } }.distinct().take(120)
        if (ids.isEmpty()) return emptyMap()

        val res = RustServiceBridge.callRpc(
            "epg",
            buildJsonObject {
                put("urls", buildJsonArray { epgUrls.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } })
                put("ids", buildJsonArray { ids.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } })
            },
        )
        val programsObj = res["programs"] as? JsonObject ?: return emptyMap()
        val out = mutableMapOf<String, EpgNowNext>()
        for ((key, value) in programsObj) {
            val o = value as? JsonObject ?: continue
            val now = (o["now"] as? JsonObject)?.toProgram()
            val next = (o["next"] as? JsonObject)?.toProgram()
            if (now != null || next != null) {
                out[key.lowercase(Locale.ROOT)] = EpgNowNext(now = now, next = next)
            }
        }
        return out
    }

    /** Loads 12-hour schedule for a single channel (`epgSchedule`). */
    suspend fun loadChannelSchedule12h(channel: LiveChannel): List<EpgProgram> {
        val epgUrl = channel.epgUrl
        val id = channel.tvgId.ifBlank { channel.tvgName.ifBlank { channel.name } }
        if (epgUrl.isBlank() || id.isBlank()) return emptyList()

        val res = RustServiceBridge.callRpc(
            "epgSchedule",
            buildJsonObject {
                put("urls", buildJsonArray { add(kotlinx.serialization.json.JsonPrimitive(epgUrl)) })
                put("id", id)
                put("hours", 12)
            },
        )
        return res["items"]?.jsonArray.orEmpty().mapNotNull { (it as? JsonObject)?.toProgram() }
    }

    /** Resolves a live channel URL (proxies via Rust when custom headers or CORS fallback needed). */
    suspend fun resolveLiveUrl(channel: LiveChannel, forceProxy: Boolean = false): String {
        val needsProxy = forceProxy || channel.userAgent.isNotBlank() || channel.referrer.isNotBlank()
        if (!needsProxy) return channel.url

        val headers = buildJsonObject {
            if (channel.userAgent.isNotBlank()) put("User-Agent", channel.userAgent)
            if (channel.referrer.isNotBlank()) put("Referer", channel.referrer)
        }
        val res = RustServiceBridge.callRpc(
            "resolveExternal",
            buildJsonObject {
                put("url", channel.url)
                put("headers", headers)
                put("forceProxy", true)
            },
        )
        return res["url"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() } ?: channel.url
    }

    private fun JsonObject.toProgram(): EpgProgram? {
        val title = str("title")
        if (title.isBlank()) return null
        return EpgProgram(
            title = title,
            description = str("desc").ifBlank { str("description") },
            startMs = this["start"]?.jsonPrimitive?.longOrNull ?: 0L,
            endMs = this["stop"]?.jsonPrimitive?.longOrNull ?: this["end"]?.jsonPrimitive?.longOrNull ?: 0L,
        )
    }

    private fun JsonObject.str(key: String): String =
        this[key]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
}
