package com.techpoint.opentv.ui.player

import com.techpoint.opentv.core.model.Episode
import com.techpoint.opentv.service.RustServiceBridge
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import java.util.concurrent.ConcurrentHashMap

/**
 * Episode flow inside the player (parity with the PC `episodeFlow.ts`): real intro/credits
 * timestamps from the core's `skipSegments` RPC (AniSkip / IntroDB / TheIntroDB), the
 * "Omitir intro" window, when the "Siguiente episodio" card appears, the end screen and the
 * next episode across seasons. Everything but [fetch] is pure and unit-tested.
 */
object EpisodeFlow {
    /** Times in seconds; [end] null = until the end of the file. */
    data class Segment(val start: Double, val end: Double?)

    data class SkipData(
        val intro: Segment? = null,
        val recap: Segment? = null,
        val credits: Segment? = null,
        val introSource: String = "",
        val creditsSource: String = "",
    )

    enum class Phase { PLAYING, CREDITS, ENDED }

    enum class EndAction { NEXT, EXIT, REPLAY }

    /**
     * Skip button. [target] is the absolute second to jump to with real timestamps, or null for
     * the heuristic (+85 s from the current position).
     */
    data class SkipPrompt(val kind: String, val label: String, val target: Double?)

    private const val MAX_INTRO_SEC = 300.0
    const val HEURISTIC_INTRO_WINDOW_SEC = 360.0
    const val HEURISTIC_INTRO_JUMP_MS = 85_000L

    /** Seconds before the end where the card appears without real credits data. */
    fun fallbackCreditsWindow(duration: Double): Double =
        if (duration < 600.0) (duration * 0.1).coerceIn(15.0, 45.0)
        else (duration * 0.03).coerceIn(45.0, 120.0)

    /** When the credits start (plausible real data, else the fallback window); null when too short. */
    fun creditsStartSec(duration: Double, data: SkipData?): Double? {
        if (!duration.isFinite() || duration < 120.0) return null
        val real = data?.credits?.start
        if (real != null && real >= duration * 0.5 && real < duration - 3.0) return real
        return duration - fallbackCreditsWindow(duration)
    }

    /** The credits start comes from real data (skip databases), not the end-of-file guess. */
    fun hasRealCredits(duration: Double, data: SkipData?): Boolean {
        val real = data?.credits?.start ?: return false
        return duration.isFinite() && real >= duration * 0.5 && real < duration - 3.0
    }

    fun phaseAt(t: Double, duration: Double, creditsStart: Double?, ended: Boolean): Phase = when {
        ended || (duration > 0.0 && t >= duration - 0.6) -> Phase.ENDED
        creditsStart != null && t >= creditsStart -> Phase.CREDITS
        else -> Phase.PLAYING
    }

    /** End-screen buttons in focus order; the first one is primary and focused. */
    fun endActions(hasNext: Boolean): List<EndAction> =
        if (hasNext) listOf(EndAction.NEXT, EndAction.EXIT, EndAction.REPLAY) else listOf(EndAction.EXIT, EndAction.REPLAY)

    /** Auto-next countdown once the card appears, never longer than what is left. */
    fun autoNextCountdown(remainingSec: Double): Int = kotlin.math.ceil(remainingSec).toInt().coerceIn(3, 10)

    /**
     * "Omitir resumen" / "Omitir intro" at [t]: only inside a real segment. Without real data
     * there is no button (owner rule: no guessing).
     */
    fun skipPromptAt(t: Double, duration: Double, data: SkipData?, skipped: Set<String>): SkipPrompt? {
        if (t < 0.0) return null
        fun inside(s: Segment?): Boolean = s?.end != null && t >= s.start - 0.5 && t < s.end - 2.0
        if ("recap" !in skipped && inside(data?.recap)) return SkipPrompt("recap", "Omitir resumen", data!!.recap!!.end)
        if ("intro" in skipped) return null
        val intro = data?.intro
        if (intro?.end != null) return if (inside(intro)) SkipPrompt("intro", "Omitir intro", intro.end) else null
        return null
    }

    /** Next episode by (season, number), skipping specials; works on merged season lists. */
    fun nextEpisodeAfter(all: List<Episode>, current: Episode?): Episode? {
        if (current == null) return null
        return all
            .filter { it.season > 0 || current.season <= 0 }
            .filter { it.season > current.season || (it.season == current.season && it.number > current.number) }
            .minWithOrNull(compareBy<Episode>({ it.season }, { it.number }))
    }

    /**
     * Wrong-content guard: true when a file's real duration is too far from the episode's TMDB
     * runtime to be that episode (another version or another show under the same title, e.g. a
     * remake matched by its translated name). Tolerance: max(4 min, 18 % of the runtime).
     * Unknown values (<= 0, NaN, Infinity) never count as a mismatch.
     */
    fun runtimeMismatch(durationSec: Double, runtimeMin: Int): Boolean {
        if (!durationSec.isFinite() || durationSec <= 0.0 || runtimeMin <= 0) return false
        val expected = runtimeMin * 60.0
        return kotlin.math.abs(durationSec - expected) > maxOf(240.0, expected * 0.18)
    }

    fun episodeLabel(e: Episode): String =
        "T${e.season}·E${e.number}" + if (e.title.isNotBlank()) " · ${e.title}" else ""

    private fun segment(el: Any?): Segment? {
        val o = el as? JsonObject ?: return null
        val start = (o["start"] as? JsonPrimitive)?.doubleOrNull ?: return null
        val end = (o["end"] as? JsonPrimitive)?.doubleOrNull
        return Segment(start, end)
    }

    /** Maps the core's `skipSegments` answer; null when the call failed. */
    fun parse(res: JsonObject?): SkipData? {
        if (res == null) return null
        if ((res["returnValue"] as? JsonPrimitive)?.booleanOrNull == false) return null
        return SkipData(
            intro = segment(res["intro"]),
            recap = segment(res["recap"]),
            credits = segment(res["credits"]),
            introSource = (res["introSource"] as? JsonPrimitive)?.contentOrNull.orEmpty(),
            creditsSource = (res["creditsSource"] as? JsonPrimitive)?.contentOrNull.orEmpty(),
        )
    }

    private val cache = ConcurrentHashMap<String, SkipData>()

    /** Online timestamps for one episode through the core (cached per episode); null if unavailable. */
    suspend fun fetch(itemId: String, episode: Episode, durationSec: Double, anime: Boolean): SkipData? {
        val key = "$itemId|${episode.id}|${episode.season}|${episode.number}"
        cache[key]?.let { return it }
        val res = runCatching {
            RustServiceBridge.callRpc(
                "skipSegments",
                buildJsonObject {
                    put("itemId", itemId)
                    put("episodeId", episode.id)
                    put("season", episode.season)
                    put("episode", episode.number)
                    put("durationSec", kotlin.math.round(durationSec))
                    put("anime", anime)
                },
            )
        }.getOrNull()
        val data = parse(res) ?: return null
        if (cache.size > 200) cache.clear()
        cache[key] = data
        return data
    }
}
