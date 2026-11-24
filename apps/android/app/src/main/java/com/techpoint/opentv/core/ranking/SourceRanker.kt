package com.techpoint.opentv.core.ranking

import com.techpoint.opentv.core.model.SourcePrefs
import com.techpoint.opentv.core.model.StreamSource
import com.techpoint.opentv.service.DeviceMediaCaps
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.ln

/**
 * 1:1 Kotlin port of OpenTV's `ui/js/src/player/source-rank.js`:
 * detects audio languages (Latino / Castellano / Español / Inglés / Multi),
 * quality, HDR/Dolby/HEVC/DTS/TrueHD/CAM, size, seeders, server health,
 * Torrentio-style user preferences and parallel torrent race alternatives.
 */
object SourceRanker {

    val LangLabels: Map<String, String> = mapOf(
        "latino" to "Latino",
        "castellano" to "Castellano",
        "es" to "Español",
        "en" to "Inglés",
        "pt" to "Portugués",
        "fr" to "Francés",
        "it" to "Italiano",
        "de" to "Alemán",
        "ru" to "Ruso",
        "ja" to "Japonés",
        "ko" to "Coreano",
        "multi" to "Multi",
    )

    private val FlagLangs = listOf(
        "🇲🇽" to "latino", "🇦🇷" to "latino", "🇨🇴" to "latino",
        "🇨🇱" to "latino", "🇵🇪" to "latino", "🇻🇪" to "latino",
        "🇪🇸" to "castellano", "🇬🇧" to "en", "🇺🇸" to "en",
        "🇵🇹" to "pt", "🇧🇷" to "pt", "🇫🇷" to "fr",
        "🇮🇹" to "it", "🇩🇪" to "de", "🇷🇺" to "ru",
        "🇯🇵" to "ja", "🇰🇷" to "ko",
        "🌎" to "multi", "🌐" to "multi", "🌍" to "multi",
    )

    private val SubsEsRe = Regex("""\b(vose|v\.o\.s\.e|subtitulad[oa]s?|subs?[\s._-]*(esp|spa|español|espanol|latino|lat|es))\b""", RegexOption.IGNORE_CASE)
    private val LatinoRe = Regex("""\b(latino|latina|latam|lat|latinoamerican[oa]|espa[ñn]ol[\s._-]*latino|dual[\s._-]*lat(ino)?)\b""", RegexOption.IGNORE_CASE)
    private val CastellanoRe = Regex("""\b(castellano|castilian|es[-_]es|espa[ñn]ol[\s._-]*(de[\s._-]*)?espa[ñn]a)\b""", RegexOption.IGNORE_CASE)
    private val SpanishRe = Regex("""\b(spanish|espa[ñn]ol|esp|spa)\b""", RegexOption.IGNORE_CASE)
    private val EnglishRe = Regex("""\b(english|eng|ingl[eé]s)\b""", RegexOption.IGNORE_CASE)
    private val MultiRe = Regex("""\b(multi([\s._-]?(audio|lang|language|sub))?|dual([\s._-]?audio)?)\b""", RegexOption.IGNORE_CASE)
    private val CamRe = Regex("""\b((hd)?cam(rip)?|hd-?ts|telesync|tele-?cine|hd-?tc|(dvd|bd)?scr(eener)?|pre-?dvd)\b""", RegexOption.IGNORE_CASE)
    private val Quality4kRe = Regex("""\b(2160p?|4k|uhd)\b""", RegexOption.IGNORE_CASE)
    private val Quality1080Re = Regex("""\b(1080p?|fhd|full[\s._-]?hd)\b""", RegexOption.IGNORE_CASE)
    private val Quality720Re = Regex("""\b(720p?|hdrip)\b""", RegexOption.IGNORE_CASE)
    private val QualitySdRe = Regex("""\b(480p?|360p?|sd|dvdrip|xvid)\b""", RegexOption.IGNORE_CASE)
    private val SeedsRe = Regex("""(?:(?:👤|👥)\s*|seeds?[:\s]+)(\d+)""", RegexOption.IGNORE_CASE)
    private val SizeRe = Regex("""(?:💾\s*|\b)(\d+(?:[.,]\d+)?)\s*(TB|GB|MB)\b""", RegexOption.IGNORE_CASE)
    private val ProviderRe = Regex("""⚙️?\s*([^\n👤💾⚙]+)""")

    private val healthFailures = ConcurrentHashMap<String, Int>()
    private val healthSuccess = ConcurrentHashMap<String, Int>()

    fun recordHealth(key: String, success: Boolean) {
        if (key.isBlank()) return
        if (success) {
            healthSuccess[key] = (healthSuccess[key] ?: 0) + 1
            healthFailures.remove(key)
        } else {
            healthFailures[key] = (healthFailures[key] ?: 0) + 1
        }
    }

    fun enrich(raw: StreamSource): StreamSource {
        val combined = "${raw.name}\n${raw.title}\n${raw.filename}"
        val text = combined.replace(Regex("[\\[\\]()]"), " ")
        var subsEs = false
        val audioText = SubsEsRe.replace(text) {
            subsEs = true
            " "
        }

        val langs = mutableListOf<String>()
        fun addLang(l: String) {
            if (l !in langs) langs.add(l)
        }
        for ((flag, code) in FlagLangs) {
            if (combined.contains(flag)) addLang(code)
        }
        if (LatinoRe.containsMatchIn(audioText)) addLang("latino")
        if (CastellanoRe.containsMatchIn(audioText)) addLang("castellano")
        if ("latino" !in langs && "castellano" !in langs && SpanishRe.containsMatchIn(audioText)) addLang("es")
        if (EnglishRe.containsMatchIn(audioText)) addLang("en")
        if (Regex("""\b(portugu[eê]s|portuguese|dublado)\b""", RegexOption.IGNORE_CASE).containsMatchIn(audioText)) addLang("pt")
        if (Regex("""\b(french|fran[cç]ais|vff|truefrench)\b""", RegexOption.IGNORE_CASE).containsMatchIn(audioText)) addLang("fr")
        if (Regex("""\b(italian|ita)\b""", RegexOption.IGNORE_CASE).containsMatchIn(audioText)) addLang("it")
        if (Regex("""\b(german|deutsch|ger)\b""", RegexOption.IGNORE_CASE).containsMatchIn(audioText)) addLang("de")
        if (Regex("""\b(russian|rus)\b""", RegexOption.IGNORE_CASE).containsMatchIn(audioText)) addLang("ru")
        if (Regex("""\b(japanese|jap|jpn|japon[eé]s)\b""", RegexOption.IGNORE_CASE).containsMatchIn(audioText)) addLang("ja")

        val multi = MultiRe.containsMatchIn(audioText) || "multi" in langs
        if (multi && "en" !in langs) addLang("en")
        val cleanLangs = langs.filter { it != "multi" }

        val quality = when {
            raw.quality != "unknown" -> raw.quality
            Quality4kRe.containsMatchIn(text) -> "4K"
            Quality1080Re.containsMatchIn(text) -> "1080p"
            Quality720Re.containsMatchIn(text) -> "720p"
            QualitySdRe.containsMatchIn(text) -> "SD"
            else -> "unknown"
        }

        val seeds = if (raw.seeders > 0) raw.seeders else SeedsRe.find(combined)?.groupValues?.get(1)?.toIntOrNull() ?: 0
        val sizeBytes = if (raw.sizeBytes > 0L) raw.sizeBytes else parseSizeBytes(combined)
        val provider = raw.provider.ifBlank { ProviderRe.find(raw.title)?.groupValues?.get(1)?.trim()?.take(40).orEmpty() }

        val isCam = CamRe.containsMatchIn(text) || Regex("""(^|[\s.\-])TS($|[\s.\-])""").containsMatchIn(combined.replace(Regex("""\.ts$""", RegexOption.IGNORE_CASE), ""))
        val isHdr = Regex("""\b(hdr(10)?\+?|dv|dovi|dolby[\s._-]?vision)\b""", RegexOption.IGNORE_CASE).containsMatchIn(text)
        val isHevc = Regex("""\b(x\.?265|h\.?265|hevc)\b""", RegexOption.IGNORE_CASE).containsMatchIn(text)
        val isTenBit = Regex("""\b10[\s._-]?bits?\b""", RegexOption.IGNORE_CASE).containsMatchIn(text)
        val isRemux = Regex("""\bremux\b""", RegexOption.IGNORE_CASE).containsMatchIn(text)
        val isDts = Regex("""\bdts([\s._-]?(hd|ma|x|es))*\b""", RegexOption.IGNORE_CASE).containsMatchIn(text)
        val isTrueHd = Regex("""\btrue[\s._-]?hd\b""", RegexOption.IGNORE_CASE).containsMatchIn(text)
        val isEac3 = Regex("""\b(e-?ac-?3|ddp|dd\+)([\s._-]?[257]\.[01])?\b""", RegexOption.IGNORE_CASE).containsMatchIn(text)
        val isAtmos = Regex("""\batmos\b""", RegexOption.IGNORE_CASE).containsMatchIn(text)
        val isAv1 = Regex("""\bav1\b""", RegexOption.IGNORE_CASE).containsMatchIn(text)
        val is3d = Regex("""\b(3d|h-?sbs|half-?sbs|h-?ou)\b""", RegexOption.IGNORE_CASE).containsMatchIn(text)
        val isMp4 = Regex("""\.(mp4|m4v)\b""", RegexOption.IGNORE_CASE).containsMatchIn("${raw.filename} ${raw.title}")

        return raw.copy(
            quality = quality,
            sizeBytes = sizeBytes,
            seeders = seeds,
            langs = cleanLangs,
            isOriginal = cleanLangs.isEmpty(),
            isMulti = multi,
            hasSubsEs = subsEs,
            isCam = isCam,
            isHevc = isHevc,
            isTenBit = isTenBit,
            isHdr = isHdr,
            isRemux = isRemux,
            isDts = isDts,
            isTrueHd = isTrueHd,
            isEac3 = isEac3,
            isAtmos = isAtmos,
            isAv1 = isAv1,
            is3d = is3d,
            isMp4 = isMp4,
            provider = provider,
        )
    }

    fun rank(
        sources: List<StreamSource>,
        prefs: SourcePrefs,
        caps: DeviceMediaCaps,
        isEpisode: Boolean = false,
        isLowMemory: Boolean = false,
        env: PlaybackEnv = PlaybackProfile.current,
    ): List<StreamSource> {
        val target = effectiveTarget(prefs, env)
        val enriched = sources.map(::enrich)
        val filtered = enriched.filter { s ->
            if (s.is3d) return@filter false
            if (s.quality in prefs.exclude) return@filter false
            if ("CAM" in prefs.exclude && s.isCam) return@filter false
            if (s.isTorrent && prefs.minSeeds > 0 && s.seeders < prefs.minSeeds) return@filter false
            val maxGb = if (isEpisode) prefs.maxEpisodeGb else prefs.maxMovieGb
            if (maxGb > 0.0 && s.sizeBytes > 0L && s.sizeBytes > (maxGb * 1_073_741_824.0).toLong()) {
                return@filter false
            }
            true
        }
        val pool = filtered.ifEmpty { enriched }
        val scored = pool
            .map { it.copy(score = scoreSource(it, prefs, caps, isLowMemory, target)) }
            .sortedByDescending { it.score }
        return if (isLowMemory) promoteDirectOnLowMemory(scored, prefs, caps) else scored
    }

    /**
     * Language tier of a source for the viewer: 0 = first preferred language, 1 = second...,
     * then generic Spanish, Spanish subtitles, original audio and anything else.
     */
    fun langTier(s: StreamSource, prefs: SourcePrefs): Int {
        prefs.langs.forEachIndexed { idx, lang -> if (hasLang(s, lang)) return idx }
        val n = prefs.langs.size
        return when {
            ("latino" in prefs.langs || "castellano" in prefs.langs) && "es" in s.langs -> n
            s.hasSubsEs -> n + 1
            s.isOriginal -> n + 2
            else -> n + 3
        }
    }

    private fun isUnplayable(s: StreamSource, caps: DeviceMediaCaps): Boolean =
        (s.isHevc && !caps.hevc) || (s.isAv1 && !caps.av1)

    /**
     * Fire TV Stick 1 GB rule: a direct HTTP/HLS stream starts instantly and needs no peers,
     * piece cache or disk, so it goes before every torrent in the same (or a worse) language.
     * Language still comes first: a torrent in a better language keeps its place, and
     * torrents keep their relative order. CAM / undecodable directs are never promoted.
     */
    internal fun promoteDirectOnLowMemory(
        scored: List<StreamSource>,
        prefs: SourcePrefs,
        caps: DeviceMediaCaps,
    ): List<StreamSource> {
        val directs = scored.filter { it.isDirect && !it.isCam && !isUnplayable(it, caps) }
        if (directs.isEmpty()) return scored
        val directIds = directs.mapTo(HashSet()) { it.id }
        val others = scored.filter { it.id !in directIds }
        val pending = directs.toMutableList()
        val out = ArrayList<StreamSource>(scored.size)
        for (other in others) {
            val tier = langTier(other, prefs)
            val it = pending.iterator()
            while (it.hasNext()) {
                val d = it.next()
                if (langTier(d, prefs) <= tier) {
                    out.add(d)
                    it.remove()
                }
            }
            out.add(other)
        }
        out.addAll(pending)
        return out
    }

    /** Grace window for slow kino JS plugins once Stremio/torrent results are already in. */
    fun directWaitMs(isLowMemory: Boolean): Long = if (isLowMemory) 22_000L else 10_000L

    /**
     * Auto-play decision while sources are still arriving (player loading screen).
     * - Everything answered → pick now.
     * - The current best is a direct stream in the viewer's first language → nothing will beat it.
     * - Torrents (or other results) are in but JS plugins are slow → wait [directWaitMs], then pick.
     * - Nothing yet → keep waiting until [maxWaitMs].
     */
    fun autoPickReady(
        ranked: List<StreamSource>,
        allDone: Boolean,
        prefs: SourcePrefs,
        msSinceFirstResult: Long,
        msTotal: Long,
        isLowMemory: Boolean,
        maxWaitMs: Long = 70_000L,
    ): Boolean {
        if (allDone) return true
        if (msTotal >= maxWaitMs) return true
        val top = ranked.firstOrNull() ?: return false
        if (top.isDirect && !top.isCam && langTier(top, prefs) == 0) return true
        return msSinceFirstResult >= directWaitMs(isLowMemory)
    }

    /** Quality points per target: the target wins, the next lower one follows, 4K is never an accident. */
    private val QualityPoints: Map<String, Map<String, Double>> = mapOf(
        "4K" to mapOf("4K" to 330.0, "1080p" to 300.0, "720p" to 230.0, "SD" to 90.0),
        "1080p" to mapOf("4K" to 190.0, "1080p" to 320.0, "720p" to 265.0, "SD" to 90.0),
        "720p" to mapOf("4K" to 110.0, "1080p" to 250.0, "720p" to 320.0, "SD" to 120.0),
        "SD" to mapOf("4K" to 60.0, "1080p" to 160.0, "720p" to 250.0, "SD" to 320.0),
    )

    /** The viewer's quality, or the device/network rule ([PlaybackProfile.autoTarget]) when "auto". */
    fun effectiveTarget(prefs: SourcePrefs, env: PlaybackEnv = PlaybackProfile.current): String =
        when (prefs.quality) {
            "4K", "1080p", "720p", "SD" -> prefs.quality
            else -> PlaybackProfile.autoTarget(env)
        }

    private fun scoreSource(
        s: StreamSource,
        prefs: SourcePrefs,
        caps: DeviceMediaCaps,
        isLowMemory: Boolean,
        targetQuality: String,
    ): Double {
        var score = 0.0

        // 1. Language priority (viewer's language always dominates)
        var langMatched = false
        prefs.langs.forEachIndexed { idx, prefLang ->
            if (hasLang(s, prefLang)) {
                score += (1000.0 - idx * 140.0)
                langMatched = true
                return@forEachIndexed
            }
        }
        if (!langMatched) {
            if (("latino" in prefs.langs || "castellano" in prefs.langs) && "es" in s.langs) {
                score += 780.0
            } else if (s.hasSubsEs) {
                score += 220.0
            } else if (s.isOriginal) {
                score += 120.0
            }
        }

        // 2. CAM penalty (only chosen when nothing better exists)
        if (s.isCam) score -= 1100.0

        // 3. Quality vs target (auto: 1080p on a capable device + fast network, else 720p)
        val isAuto = prefs.quality !in QualityPoints
        score += QualityPoints[targetQuality]?.get(s.quality)
            // Direct HLS without a quality tag is an adaptive ladder: it plays at the target.
            ?: if (s.isDirect) (QualityPoints[targetQuality]?.get(targetQuality) ?: 320.0) - 40.0
            else if (targetQuality == "720p") 140.0 else 130.0
        // 4K on a screen/decoder that cannot show it is wasted bandwidth and RAM.
        if (s.quality == "4K" && (!caps.uhd || isLowMemory) && isAuto) score -= 120.0
        // Auto never leans on 10-bit/HDR the decoder cannot handle.
        if (isAuto && s.isTenBit && !caps.hevc10) score -= 150.0

        // 4. Direct HTTP/HLS bonus on low-RAM TVs (instant start, zero peer wait)
        if (s.isDirect) {
            score += if (isLowMemory) 170.0 else 95.0
        } else if (s.isTorrent) {
            if (s.seeders <= 0) {
                score -= 350.0
            } else {
                score += (ln(s.seeders.toDouble() + 1.0) * 42.0).coerceAtMost(210.0)
            }
        }

        // 5. Device codec & hardware compatibility (penalize unplayable codecs on Fire TV)
        if (s.isHevc && !caps.hevc) score -= 500.0
        if ((s.isTenBit || s.isHdr) && !caps.hevc10 && s.isHevc) score -= 240.0
        if (s.isAv1 && !caps.av1) score -= 450.0
        if (s.isDts && !caps.dts) score -= 220.0
        if (s.isTrueHd && !caps.truehd) score -= 220.0
        if (s.isHdr && caps.hdr) score += 35.0
        if (s.isAtmos && caps.atmos) score += 30.0
        if (s.isMp4) score += 20.0

        // 6. Reasonable file size (avoid massive 60 GB remuxes on 1 GB Fire TV)
        if (s.sizeBytes > 0L) {
            val gb = s.sizeBytes / 1_073_741_824.0
            if (isLowMemory && gb > 12.0) score -= (gb - 12.0) * 20.0
            if (s.isRemux && isLowMemory) score -= 180.0
        }

        // 7. Observed runtime server health
        val healthKey = s.addonId.ifBlank { s.provider }
        val fails = healthFailures[healthKey] ?: 0
        val oks = healthSuccess[healthKey] ?: 0
        score -= fails * 120.0
        score += (oks * 15.0).coerceAtMost(60.0)

        return score
    }

    /** Selects up to `maxAlts` compatible torrent alternatives for parallel racing in `opentv-core`. */
    fun torrentRaceAlternatives(
        chosen: StreamSource,
        ranked: List<StreamSource>,
        maxAlts: Int,
    ): List<StreamSource> {
        if (!chosen.isTorrent || maxAlts <= 0) return emptyList()
        val chosenHash = chosen.infoHash.lowercase(Locale.ROOT)
        return ranked.asSequence()
            .filter { it.isTorrent }
            .filter { it.infoHash.lowercase(Locale.ROOT) != chosenHash }
            .filter { !it.isCam || chosen.isCam }
            .filter { it.seeders > 0 }
            .filter { alt ->
                chosen.langs.isEmpty() || alt.langs.any { it in chosen.langs } || (chosen.isOriginal && alt.isOriginal)
            }
            .take(maxAlts)
            .toList()
    }

    fun hasLang(src: StreamSource, lang: String): Boolean {
        if (lang == "en") return "en" in src.langs || src.isOriginal
        return lang in src.langs
    }

    fun languageSummary(src: StreamSource): String {
        val parts = mutableListOf<String>()
        src.langs.forEach { LangLabels[it]?.let(parts::add) }
        if (src.isMulti && parts.size < 2) parts.add("Multi")
        if (src.hasSubsEs) parts.add("Subs ES")
        return parts.joinToString(" · ")
    }

    fun formatSize(bytes: Long): String {
        if (bytes <= 0L) return ""
        val gb = bytes / 1_073_741_824.0
        return if (gb >= 1.0) String.format(Locale("es"), "%.2f GB", gb)
        else String.format(Locale("es"), "%d MB", (bytes / 1_048_576L).coerceAtLeast(1L))
    }

    private fun parseSizeBytes(text: String): Long {
        val m = SizeRe.find(text) ?: return 0L
        val num = m.groupValues[1].replace(',', '.').toDoubleOrNull() ?: return 0L
        return when (m.groupValues[2].uppercase(Locale.ROOT)) {
            "TB" -> (num * 1_099_511_627_776.0).toLong()
            "GB" -> (num * 1_073_741_824.0).toLong()
            "MB" -> (num * 1_048_576.0).toLong()
            else -> 0L
        }
    }
}
