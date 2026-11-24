package com.techpoint.opentv.core.model

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable

@Immutable
@Serializable
data class MediaItem(
    val id: String,
    val type: String = "movie", // "movie" | "series" | "anime"
    val title: String,
    val originalTitle: String = "",
    val year: String = "",
    val score: String = "",
    val duration: String = "",
    val genres: List<String> = emptyList(),
    val synopsis: String = "",
    val poster: String = "",
    val backdrop: String = "",
    val logo: String = "",
    val cast: List<String> = emptyList(),
    val director: String = "",
    val addonUrl: String = "",
    val catalogRow: String = "",
    val isAnime: Boolean = false,
) {
    val isSeries: Boolean get() = type == "series" || type == "anime"
    val imdbId: String get() = id.removePrefix("stremio:").substringBefore(":")
}

@Immutable
@Serializable
data class Episode(
    val id: String,
    val season: Int,
    val number: Int,
    val title: String,
    val overview: String = "",
    val thumbnail: String = "",
    val released: String = "",
)

@Immutable
@Serializable
data class TitleDetail(
    val item: MediaItem,
    val episodes: List<Episode> = emptyList(),
    val seasons: List<Int> = emptyList(),
    val trailerYoutubeId: String = "",
    val related: List<MediaItem> = emptyList(),
)

@Immutable
@Serializable
data class StreamSource(
    val id: String,
    val addonId: String,
    val addonName: String,
    val name: String = "",
    val title: String = "",
    val url: String = "",
    val infoHash: String = "",
    val fileIdx: Int? = null,
    val filename: String = "",
    val trackers: List<String> = emptyList(),
    val headers: Map<String, String> = emptyMap(),
    val isJsPlugin: Boolean = false,
    val jsResolveId: String = "",
    // Parsed quality / tags
    val quality: String = "unknown", // "4K" | "1080p" | "720p" | "SD" | "unknown"
    val sizeBytes: Long = 0L,
    val seeders: Int = 0,
    val langs: List<String> = emptyList(),
    val isOriginal: Boolean = true,
    val isMulti: Boolean = false,
    val hasSubsEs: Boolean = false,
    val isCam: Boolean = false,
    val isHevc: Boolean = false,
    val isTenBit: Boolean = false,
    val isHdr: Boolean = false,
    val isRemux: Boolean = false,
    val isDts: Boolean = false,
    val isTrueHd: Boolean = false,
    val isEac3: Boolean = false,
    val isAtmos: Boolean = false,
    val isAv1: Boolean = false,
    val is3d: Boolean = false,
    val isMp4: Boolean = false,
    val provider: String = "",
    val score: Double = 0.0,
) {
    val isTorrent: Boolean get() = infoHash.isNotBlank() && url.isBlank()
    val isDirect: Boolean get() = url.isNotBlank() || isJsPlugin
}

@Immutable
@Serializable
data class ExternalSubtitle(
    val id: String,
    val url: String,
    val lang: String,
    val label: String,
    val source: String = "OpenSubtitles",
)

@Immutable
@Serializable
data class InstalledPlugin(
    val id: String,
    val name: String,
    val url: String,
    val baseUrl: String = "",
    val kind: String = "stremio", // "stremio" | "kino-js"
    val description: String = "",
    val logo: String = "",
    val version: String = "",
    val builtin: Boolean = false,
    val disabled: Boolean = false,
    val allowLan: Boolean = false,
    val hasCatalog: Boolean = false,
    val hasStream: Boolean = false,
    val hasSubtitles: Boolean = false,
    val hasMeta: Boolean = false,
    val types: List<String> = emptyList(),
    val idPrefixes: List<String> = emptyList(),
    val catalogs: List<PluginCatalogDef> = emptyList(),
    val rawRepoBase: String = "",
)

@Immutable
@Serializable
data class PluginCatalogDef(
    val type: String,
    val id: String,
    val name: String,
    val supportsSearch: Boolean = false,
    val searchRequired: Boolean = false,
    val genres: List<String> = emptyList(),
)

@Immutable
@Serializable
data class M3uPlaylist(
    val id: String,
    val name: String,
    val url: String,
    val description: String = "",
    val enabled: Boolean = true,
    val allowLan: Boolean = false,
)

@Immutable
@Serializable
data class LiveChannel(
    val id: String,
    val name: String,
    val url: String,
    val logo: String = "",
    val group: String = "General",
    val tvgId: String = "",
    val tvgName: String = "",
    val epgUrl: String = "",
    val userAgent: String = "",
    val referrer: String = "",
    val playlistId: String = "",
)

@Immutable
@Serializable
data class EpgProgram(
    val title: String,
    val description: String = "",
    val startMs: Long = 0L,
    val endMs: Long = 0L,
) {
    fun progressAt(nowMs: Long): Float {
        if (endMs <= startMs) return 0f
        return ((nowMs - startMs).toFloat() / (endMs - startMs).toFloat()).coerceIn(0f, 1f)
    }
}

@Immutable
@Serializable
data class EpgNowNext(
    val now: EpgProgram? = null,
    val next: EpgProgram? = null,
)

@Immutable
@Serializable
data class UserProfile(
    val id: String,
    val name: String,
    val avatarColor: Long = 0xFF3B82F6,
    val initial: String = "O",
    val kids: Boolean = false,
    // Index into the 24 shared avatars (same key and values as OpenTV PC backups); -1 = legacy.
    val avatarIndex: Int = -1,
)

@Immutable
@Serializable
data class WatchProgress(
    val itemId: String,
    val type: String,
    val title: String,
    val poster: String = "",
    val backdrop: String = "",
    val season: Int = 0,
    val episode: Int = 0,
    val episodeTitle: String = "",
    val positionMs: Long = 0L,
    val durationMs: Long = 0L,
    val updatedAt: Long = 0L,
) {
    val progress: Float get() = if (durationMs > 0L) (positionMs.toFloat() / durationMs.toFloat()).coerceIn(0f, 1f) else 0f
    val isFinished: Boolean get() = durationMs > 60_000L && progress >= 0.92f
}

@Immutable
@Serializable
data class SourcePrefs(
    val langs: List<String> = listOf("latino", "castellano"),
    val quality: String = "auto", // "auto" | "4K" | "1080p" | "720p" | "SD"
    val exclude: List<String> = emptyList(),
    val minSeeds: Int = 0,
    val maxMovieGb: Double = 0.0,
    val maxEpisodeGb: Double = 0.0,
    val autoPlay: Boolean = true,
    val subsFrom: String = "file", // "file" | "addons" | "fileOnly" | "addonsOnly"
)

@Immutable
@Serializable
data class AppearancePrefs(
    val accentId: String = "white",
    val textLarge: Boolean = false,
    val tvMarginIndex: Int = 0, // 0, 1, 2
    val liteMode: Boolean = false,
)

@Immutable
@Serializable
data class SubtitleStylePrefs(
    val sizeSp: Float = 20f,
    val textColorHex: Long = 0xFFFFFFFF,
    val bgAlpha: Float = 0.65f,
    val delayMs: Long = 0L,
    val preferredLang: String = "es",
)

@Immutable
@Serializable
data class PlaybackPrefs(
    val preferredAudioLang: String = "es",
    // Auto-select embedded subtitles in the preferred language (PC `subtitlesEnabled`).
    val subtitlesEnabled: Boolean = true,
    val autoNextEpisode: Boolean = true,
    val autoFrameRate: Boolean = true,
    val passthroughAudio: Boolean = true,
    val subtitleStyle: SubtitleStylePrefs = SubtitleStylePrefs(),
)

@Immutable
@Serializable
data class DownloadItem(
    val id: String,
    val title: String,
    val subtitle: String = "",
    val poster: String = "",
    val status: String = "queued", // "queued" | "downloading" | "paused" | "done" | "error"
    val bytes: Long = 0L,
    val total: Long = 0L,
    val speed: Long = 0L,
    val localUrl: String = "",
    val error: String = "",
) {
    val progress: Float get() = if (total > 0L) (bytes.toFloat() / total.toFloat()).coerceIn(0f, 1f) else 0f
}

@Immutable
@Serializable
data class CommunityPlugin(
    val id: String,
    val name: String,
    val url: String,
    val description: String,
    val category: String, // "directas" | "torrents" | "catalogos" | "subtitulos" | "gratis" | "deportes" | "paises" | ...
    val kind: String = "stremio", // "stremio" | "kino-js" | "m3u"
    val logo: String = "",
    val tvEssential: Boolean = false,
    val recommendedRankTv: Int = 0,
    val recommendedRankPhone: Int = 0,
    val pcOnly: Boolean = false,
)

@Immutable
@Serializable
data class CatalogRow(
    val id: String,
    val title: String,
    val items: List<MediaItem>,
)

enum class HomeTab(val id: String, val label: String) {
    LIVE("live", "TV en vivo"),
    HOME("home", "Inicio"),
    MOVIES("movies", "Películas"),
    SERIES("series", "Series"),
    KIDS("kids", "Kids"),
    ANIME("anime", "Anime"),
}
