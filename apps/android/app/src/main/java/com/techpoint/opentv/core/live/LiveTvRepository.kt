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
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

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
                (res["channels"] as? JsonArray).orEmpty().mapIndexedNotNull { idx, el ->
                    val o = el as? JsonObject ?: return@mapIndexedNotNull null
                    val url = o.str("url")
                    val name = o.str("name")
                    val group = o.str("group").ifBlank { "General" }
                    if (url.isBlank() || name.isBlank()) return@mapIndexedNotNull null
                    if (adultGroupRe.containsMatchIn(group) || adultGroupRe.containsMatchIn(name)) {
                        return@mapIndexedNotNull null
                    }
                    // The core reports the guide per channel (`epg`, from url-tvg / x-tvg-url).
                    val epgUrl = o.str("epg").ifBlank { o.str("epgUrl") }
                    if (epgUrl.isNotBlank()) synchronized(epgUrls) { epgUrls.add(epgUrl) }
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
                        allowLan = pl.allowLan,
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

        val out = mutableMapOf<String, EpgNowNext>()
        val nowMs = System.currentTimeMillis()
        for (epgUrl in epgUrls.take(4)) {
            val res = RustServiceBridge.callRpc(
                "epg",
                buildJsonObject {
                    put("url", epgUrl)
                    put("ids", buildJsonArray { ids.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } })
                    put("allowLan", channels.any { it.epgUrl == epgUrl && it.allowLan })
                },
            )
            val programmes = res["programmes"] as? JsonObject ?: continue
            for ((key, value) in programmes) {
                val list = value.jsonArrayOrNull()?.mapNotNull { (it as? JsonObject)?.toProgram() }.orEmpty()
                if (list.isEmpty()) continue
                val now = list.firstOrNull { it.startMs <= nowMs && it.endMs > nowMs }
                val next = list.firstOrNull { it.startMs > (now?.startMs ?: nowMs) }
                if (now != null || next != null) {
                    out[key.lowercase(Locale.ROOT)] = EpgNowNext(now = now, next = next)
                }
            }
        }
        return out
    }

    /**
     * 12-hour schedule of a channel (`epgSchedule`); a missing or placeholder-only guide is
     * replaced by the supplementary one (`epgSupplement`).
     */
    suspend fun loadChannelSchedule12h(channel: LiveChannel): List<EpgProgram> {
        val own = try {
            loadOwnSchedule(channel)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            emptyList()
        }
        if (own.isNotEmpty() && !EpgPlaceholder.isPlaceholder(EpgPlaceholder.namesOf(channel), own)) return own
        val extra = loadEpgSupplement(channel)
        return extra.ifEmpty { own }
    }

    private class CachedSupplement(val atMs: Long, val items: List<EpgProgram>)

    private val supplementCache = ConcurrentHashMap<String, CachedSupplement>()

    /** Programmes of [channel] in the supplementary guide (empty when no confident match). */
    suspend fun loadEpgSupplement(channel: LiveChannel): List<EpgProgram> {
        val country = EpgPlaceholder.guessCountry(channel.tvgId, channel.playlistId, channel.epgUrl)
        val key = "$country|${channel.name}"
        val nowMs = System.currentTimeMillis()
        supplementCache[key]?.takeIf { nowMs - it.atMs < SUPPLEMENT_TTL_MS }?.let { hit ->
            return hit.items.filter { it.endMs > nowMs }
        }
        val items = try {
            val res = RustServiceBridge.callRpc(
                "epgSupplement",
                buildJsonObject {
                    put("name", channel.name)
                    put("country", country)
                },
            )
            res["programmes"].jsonArrayOrNull()?.mapNotNull { (it as? JsonObject)?.toProgram() }.orEmpty()
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            emptyList()
        }
        if (supplementCache.size >= SUPPLEMENT_CACHE_MAX) supplementCache.clear()
        supplementCache[key] = CachedSupplement(nowMs, items)
        return items
    }

    /**
     * Now/next from the supplementary guide for the channels whose own guide is placeholder-only
     * ("Azteca UNO -1" every hour). Returns only the entries to patch into the now/next map.
     */
    suspend fun loadSupplementNowNext(
        channels: List<LiveChannel>,
        epgMap: Map<String, EpgNowNext>,
    ): Map<String, EpgNowNext> {
        val seen = HashSet<String>()
        val targets = channels.filter { ch ->
            val key = EpgPlaceholder.keyOf(ch)
            val own = epgMap[key] ?: return@filter false
            if (key in seen) return@filter false
            if (!EpgPlaceholder.isPlaceholder(EpgPlaceholder.namesOf(ch), listOf(own.now, own.next))) return@filter false
            seen.add(key)
        }.take(SUPPLEMENT_NOW_NEXT_MAX)
        val out = HashMap<String, EpgNowNext>()
        // Sequential: the core downloads the country's guide once and answers the rest from memory.
        for (ch in targets) {
            nowNextOf(loadEpgSupplement(ch))?.let { out[EpgPlaceholder.keyOf(ch)] = it }
        }
        return out
    }

    /** Now/next of a schedule at the current time, or null when it has neither. */
    fun nowNextOf(list: List<EpgProgram>): EpgNowNext? {
        val nowMs = System.currentTimeMillis()
        val now = list.firstOrNull { it.startMs <= nowMs && it.endMs > nowMs }
        val next = list.firstOrNull { it.startMs > (now?.startMs ?: nowMs) }
        return if (now != null || next != null) EpgNowNext(now = now, next = next) else null
    }

    private suspend fun loadOwnSchedule(channel: LiveChannel): List<EpgProgram> {
        val epgUrl = channel.epgUrl
        val id = channel.tvgId.ifBlank { channel.tvgName.ifBlank { channel.name } }
        if (epgUrl.isBlank() || id.isBlank()) return emptyList()

        val res = RustServiceBridge.callRpc(
            "epgSchedule",
            buildJsonObject {
                put("url", epgUrl)
                put("id", id)
                put("allowLan", channel.allowLan)
            },
        )
        return res["programmes"].jsonArrayOrNull()?.mapNotNull { (it as? JsonObject)?.toProgram() }.orEmpty()
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
        return (res["url"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() } ?: channel.url
    }

    private fun JsonObject.toProgram(): EpgProgram? {
        val title = str("t").ifBlank { str("title") }
        if (title.isBlank()) return null
        return EpgProgram(
            title = title,
            description = str("d").ifBlank { str("desc").ifBlank { str("description") } },
            startMs = (this["s"] as? JsonPrimitive)?.longOrNull ?: (this["start"] as? JsonPrimitive)?.longOrNull ?: 0L,
            endMs = (this["e"] as? JsonPrimitive)?.longOrNull ?: (this["stop"] as? JsonPrimitive)?.longOrNull
                ?: (this["end"] as? JsonPrimitive)?.longOrNull ?: 0L,
        )
    }

    private fun kotlinx.serialization.json.JsonElement?.jsonArrayOrNull(): kotlinx.serialization.json.JsonArray? =
        this as? kotlinx.serialization.json.JsonArray

    private fun JsonObject.str(key: String): String =
        (this[key] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()

    private companion object {
        const val SUPPLEMENT_TTL_MS = 30 * 60_000L
        const val SUPPLEMENT_CACHE_MAX = 64
        const val SUPPLEMENT_NOW_NEXT_MAX = 24
    }
}
