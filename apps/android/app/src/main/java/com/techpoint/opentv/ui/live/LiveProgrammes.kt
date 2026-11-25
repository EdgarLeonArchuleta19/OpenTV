package com.techpoint.opentv.ui.live

import com.techpoint.opentv.core.model.EpgNowNext
import com.techpoint.opentv.core.model.EpgProgram
import com.techpoint.opentv.core.model.LiveChannel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Position of a programme card in the "Programación de hoy" row. */
internal enum class ProgrammeSlot { Now, Next, Later }

internal data class ProgrammeCard(val slot: ProgrammeSlot, val program: EpgProgram)

/**
 * Picks the programme cards of the current channel at [nowMs]: the programme on air
 * ("AHORA"), then the following ones ("DESPUÉS", then labelled by start time), [max] in all.
 * [schedule] is the channel's `epgSchedule` (any order, may be empty); [nowNext] (the light
 * `epg` now/next) fills in when the schedule is not loaded yet or misses the current slot.
 * Pure: no clock, no Android, so it is unit-tested.
 */
internal fun pickProgrammeCards(
    schedule: List<EpgProgram>,
    nowNext: EpgNowNext?,
    nowMs: Long,
    max: Int = 4,
): List<ProgrammeCard> {
    if (max <= 0) return emptyList()
    val timed = (schedule + listOfNotNull(nowNext?.now, nowNext?.next))
        .filter { it.title.isNotBlank() && it.startMs > 0L && it.endMs > it.startMs }
        .sortedBy { it.startMs }
        .distinctBy { it.startMs }

    val now = timed.firstOrNull { it.startMs <= nowMs && it.endMs > nowMs }
        // Untimed "now" from a minimal guide: still worth showing as AHORA.
        ?: nowNext?.now?.takeIf { it.title.isNotBlank() && (it.startMs <= 0L || it.endMs <= it.startMs) }
    val after = now?.startMs?.takeIf { it > 0L } ?: Long.MIN_VALUE
    val upcoming = timed.filter { it !== now && it.startMs >= nowMs && it.startMs > after }

    val out = ArrayList<ProgrammeCard>(max)
    if (now != null) out.add(ProgrammeCard(ProgrammeSlot.Now, now))
    for (p in upcoming) {
        if (out.size >= max) break
        val slot = if (out.none { it.slot == ProgrammeSlot.Next }) ProgrammeSlot.Next else ProgrammeSlot.Later
        out.add(ProgrammeCard(slot, p))
    }
    if (out.isEmpty()) {
        // Only an untimed "next" is known.
        nowNext?.next?.takeIf { it.title.isNotBlank() && it.startMs <= 0L }?.let { out.add(ProgrammeCard(ProgrammeSlot.Next, it)) }
    }
    return out
}

private fun hhmm(ms: Long, tz: TimeZone): String =
    SimpleDateFormat("HH:mm", Locale.ROOT).apply { timeZone = tz }.format(Date(ms))

/** Card label: "AHORA", "DESPUÉS" or the start time ("17:30"). */
internal fun programmeLabel(card: ProgrammeCard, tz: TimeZone = TimeZone.getDefault()): String = when (card.slot) {
    ProgrammeSlot.Now -> "AHORA"
    ProgrammeSlot.Next -> "DESPUÉS"
    ProgrammeSlot.Later -> if (card.program.startMs > 0L) hhmm(card.program.startMs, tz) else "MÁS TARDE"
}

/** "14:00 – 15:45", or "" when the programme has no times. */
internal fun programmeRange(p: EpgProgram, tz: TimeZone = TimeZone.getDefault()): String =
    if (p.startMs > 0L && p.endMs > p.startMs) "${hhmm(p.startMs, tz)} – ${hhmm(p.endMs, tz)}" else ""

/**
 * Short logo stand-in for a channel without a logo: initials of the first words
 * ("Cine Clásico" → "CC") or the first three letters of a single word ("Estrenos" → "EST").
 */
internal fun channelMonogram(name: String): String {
    val words = name.split(' ', '-', '_', '.', '/', '|')
        .map { w -> w.filter { it.isLetterOrDigit() } }
        .filter { it.isNotEmpty() }
    if (words.isEmpty()) return "TV"
    // Initials of up to 3 words, numbers kept whole ("Canal 10" -> "C10", not "C1"); max 4 chars.
    val mono = if (words.size == 1) {
        words[0].take(3)
    } else {
        words.take(3).joinToString("") { w -> if (w.all { it.isDigit() }) w else w.take(1) }.take(4)
    }
    return mono.uppercase(Locale.ROOT)
}

/** EPG now/next of [ch] in the map loaded by `LiveTvRepository.loadEpgNowNext`. */
internal fun epgFor(epgMap: Map<String, EpgNowNext>, ch: LiveChannel): EpgNowNext? =
    epgMap[ch.tvgId.lowercase()] ?: epgMap[ch.tvgName.lowercase()] ?: epgMap["url:" + ch.url.lowercase()]

/** Special groups of the channel select, ahead of the playlist groups. */
internal const val GROUP_ALL = "Todos"
internal const val GROUP_FAVORITES = "Favoritos"
internal const val GROUP_RECENTS = "Recientes"
internal const val PLAYLIST_ALL = ""

/** Channels of [group] (special groups included), optionally narrowed by a search query. */
internal fun filterChannels(
    channels: List<LiveChannel>,
    group: String,
    favoriteUrls: Collection<String>,
    recentChannels: List<LiveChannel>,
    query: String,
    epgMap: Map<String, EpgNowNext>,
): List<LiveChannel> {
    val byGroup = when (group) {
        GROUP_ALL -> channels
        GROUP_FAVORITES -> channels.filter { it.url in favoriteUrls }
        // Recents come from storage: keep only those still in the loaded lists (the playlist
        // filter applies), but fall back to the stored copy when the lists are still loading.
        GROUP_RECENTS -> if (channels.isEmpty()) recentChannels else {
            val byUrl = channels.associateBy { it.url }
            recentChannels.mapNotNull { byUrl[it.url] }
        }
        else -> channels.filter { it.group == group }
    }
    val q = query.trim()
    if (q.isEmpty()) return byGroup
    return byGroup.filter {
        it.name.contains(q, ignoreCase = true) ||
            it.group.contains(q, ignoreCase = true) ||
            epgFor(epgMap, it)?.now?.title?.contains(q, ignoreCase = true) == true
    }
}

/** Channel tuned when TV en vivo opens: the most recent one still in the lists, else the first. */
internal fun pickStartChannel(channels: List<LiveChannel>, recentChannels: List<LiveChannel>): LiveChannel {
    val byUrl = channels.associateBy { it.url }
    return recentChannels.firstNotNullOfOrNull { byUrl[it.url] } ?: channels.first()
}
