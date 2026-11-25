package com.techpoint.opentv.core.data

import android.content.Context
import android.util.AtomicFile
import com.techpoint.opentv.BuildConfig
import com.techpoint.opentv.core.addons.PluginCatalogs
import com.techpoint.opentv.core.model.AppearancePrefs
import com.techpoint.opentv.core.model.InstalledPlugin
import com.techpoint.opentv.core.model.LiveChannel
import com.techpoint.opentv.core.model.M3uPlaylist
import com.techpoint.opentv.core.model.MediaItem
import com.techpoint.opentv.core.model.PlaybackPrefs
import com.techpoint.opentv.core.model.SourcePrefs
import com.techpoint.opentv.core.model.UserProfile
import com.techpoint.opentv.core.model.WatchProgress
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.util.UUID

// `a` color of each of the 24 PC avatars (Avatars.tsx order); no UI dependency in the store.
private val AVATAR_FIRST_COLORS = longArrayOf(
    0xFF3A7BFF, 0xFFFF5F6D, 0xFF11998E, 0xFFF7B733, 0xFFFF6FD8, 0xFF00C6FF,
    0xFF232526, 0xFFFF9A44, 0xFF7F53AC, 0xFFE52D27, 0xFF141E30, 0xFFA8E063,
    0xFF8E5A2B, 0xFF3E3E46, 0xFFB06AB3, 0xFF1E3C72, 0xFF56AB2F, 0xFFF12711,
    0xFFEC008C, 0xFF0F2027, 0xFF8E0E00, 0xFFF7971E, 0xFFE53935, 0xFF7B4397,
)

@Serializable
data class ProfileBucket(
    val myList: List<MediaItem> = emptyList(),
    // Same key as PC backups (`bucket.favorites`).
    val favorites: List<MediaItem> = emptyList(),
    val watchProgress: List<WatchProgress> = emptyList(),
    val recentSearches: List<String> = emptyList(),
    val favoriteChannelUrls: List<String> = emptyList(),
    val recentChannels: List<LiveChannel> = emptyList(),
    val chosenSources: Map<String, String> = emptyMap(),
)

@Serializable
data class PersistedAppState(
    val version: Int = 2,
    val profiles: List<UserProfile> = listOf(
        UserProfile(id = "main", name = "Principal", avatarColor = 0xFF3B82F6, initial = "P", kids = false),
        UserProfile(id = "kids", name = "Kids", avatarColor = 0xFF22C55E, initial = "K", kids = true),
    ),
    val activeProfileId: String = "main",
    val profileData: Map<String, ProfileBucket> = emptyMap(),
    val plugins: List<InstalledPlugin> = emptyList(),
    val m3uPlaylists: List<M3uPlaylist> = emptyList(),
    val sourcePrefs: SourcePrefs = SourcePrefs(),
    val appearance: AppearancePrefs = AppearancePrefs(),
    val playback: PlaybackPrefs = PlaybackPrefs(),
    val parentalPin: String = "",
    val parentalLocked: Boolean = false,
    val requiredLatestVersion: String = "",
    val requiredLatestNotes: String = "",
)

/**
 * Fast, crash-safe local state persistence using Android `AtomicFile` + `kotlinx.serialization`.
 * Zero SQLite overhead on 1 GB Fire TV Sticks (< 2 ms read/write) and JSON-compatible with PC backups.
 */
class AppStore(context: Context) {
    private val file = AtomicFile(File(context.filesDir, "opentv_state_v2.json"))
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        prettyPrint = false
    }

    private val _state = MutableStateFlow(loadInitial())
    val state: StateFlow<PersistedAppState> = _state.asStateFlow()

    val current: PersistedAppState get() = _state.value

    val activeProfile: UserProfile
        get() = current.profiles.firstOrNull { it.id == current.activeProfileId } ?: current.profiles.first()

    val activeBucket: ProfileBucket
        get() = current.profileData[activeProfile.id] ?: ProfileBucket()

    private fun loadInitial(): PersistedAppState {
        val raw = runCatching {
            if (file.baseFile.exists()) file.readFully().decodeToString() else null
        }.getOrNull()

        val parsed = if (!raw.isNullOrBlank()) {
            runCatching { json.decodeFromString<PersistedAppState>(raw) }.getOrNull()
        } else null

        val base = parsed ?: PersistedAppState(
            m3uPlaylists = listOf(PluginCatalogs.PresetM3uLists.first { it.id == "pluto_mx" }),
        )
        val seededPlugins = PluginCatalogs.seedBuiltins(base.plugins)
        // Legacy profiles (no avatar index): same fallback as PC (1st → 0, 2nd → 2, else position).
        val safeProfiles = base.profiles.ifEmpty { PersistedAppState().profiles }.mapIndexed { i, p ->
            if (p.avatarIndex >= 0) p
            else p.copy(
                avatarIndex = when {
                    p.id == "main" || i == 0 -> 0
                    p.id == "kids" || i == 1 -> 2
                    else -> i
                },
            )
        }
        val safeActive = if (safeProfiles.any { it.id == base.activeProfileId }) base.activeProfileId else safeProfiles.first().id
        val stillOutdated = AppUpdatePolicy.isOutdated(BuildConfig.VERSION_NAME, base.requiredLatestVersion)
        return base.copy(
            profiles = safeProfiles,
            activeProfileId = safeActive,
            plugins = seededPlugins,
            requiredLatestVersion = if (stillOutdated) base.requiredLatestVersion else "",
            requiredLatestNotes = if (stillOutdated) base.requiredLatestNotes else "",
        )
    }

    private fun mutate(block: (PersistedAppState) -> PersistedAppState) {
        var nextState: PersistedAppState? = null
        _state.update { cur ->
            val updated = block(cur).let { s ->
                s.copy(plugins = PluginCatalogs.seedBuiltins(s.plugins))
            }
            nextState = updated
            updated
        }
        nextState?.let { saveAsync(it) }
    }

    private fun mutateBucket(block: (ProfileBucket) -> ProfileBucket) {
        mutate { s ->
            val pid = s.activeProfileId
            val cur = s.profileData[pid] ?: ProfileBucket()
            val updatedMap = s.profileData.toMutableMap()
            updatedMap[pid] = block(cur)
            s.copy(profileData = updatedMap)
        }
    }

    private fun saveAsync(snapshot: PersistedAppState) {
        scope.launch {
            runCatching {
                val bytes = json.encodeToString(snapshot).toByteArray(Charsets.UTF_8)
                val out = file.startWrite()
                try {
                    out.write(bytes)
                    file.finishWrite(out)
                } catch (e: Throwable) {
                    file.failWrite(out)
                    throw e
                }
            }
        }
    }

    fun selectProfile(profileId: String) = mutate { s ->
        if (s.profiles.any { it.id == profileId }) s.copy(activeProfileId = profileId) else s
    }

    fun addProfile(name: String, kids: Boolean, avatarIndex: Int) = mutate { s ->
        val clean = name.trim().take(24)
        if (clean.isEmpty()) return@mutate s
        val id = "p_${UUID.randomUUID().toString().take(8)}"
        val profile = UserProfile(
            id = id,
            name = clean,
            avatarColor = avatarColorFor(avatarIndex),
            initial = clean.first().uppercase(),
            kids = kids,
            avatarIndex = avatarIndex.coerceAtLeast(0),
        )
        s.copy(profiles = s.profiles + profile)
    }

    /** PC `updateProfile`: name / kids / avatar of an existing profile ("main" is never Kids). */
    fun updateProfile(profileId: String, name: String? = null, kids: Boolean? = null, avatarIndex: Int? = null) = mutate { s ->
        s.copy(
            profiles = s.profiles.map { p ->
                if (p.id != profileId) return@map p
                val clean = name?.trim()?.take(24)?.takeIf { it.isNotEmpty() } ?: p.name
                p.copy(
                    name = clean,
                    initial = clean.first().uppercase(),
                    kids = if (p.id == "main") false else kids ?: p.kids,
                    avatarIndex = avatarIndex?.coerceAtLeast(0) ?: p.avatarIndex,
                    avatarColor = avatarIndex?.let(::avatarColorFor) ?: p.avatarColor,
                )
            },
        )
    }

    /** First gradient color of the PC avatar, kept in `avatarColor` for older readers. */
    private fun avatarColorFor(index: Int): Long = AVATAR_FIRST_COLORS[Math.floorMod(index, AVATAR_FIRST_COLORS.size)]

    fun renameProfile(profileId: String, name: String) = mutate { s ->
        val clean = name.trim().take(24)
        if (clean.isEmpty()) return@mutate s
        s.copy(
            profiles = s.profiles.map {
                if (it.id == profileId) it.copy(name = clean, initial = clean.first().uppercase()) else it
            },
        )
    }

    fun removeProfile(profileId: String) = mutate { s ->
        if (profileId == "main" || s.profiles.size <= 1) return@mutate s
        val left = s.profiles.filterNot { it.id == profileId }
        val active = if (s.activeProfileId == profileId) left.first().id else s.activeProfileId
        s.copy(profiles = left, activeProfileId = active, profileData = s.profileData - profileId)
    }

    fun toggleMyList(item: MediaItem): Boolean {
        var added = false
        mutateBucket { b ->
            val exists = b.myList.any { it.id == item.id }
            added = !exists
            val list = if (exists) b.myList.filterNot { it.id == item.id } else listOf(item) + b.myList
            b.copy(myList = list.take(200))
        }
        return added
    }

    fun isInMyList(itemId: String): Boolean = activeBucket.myList.any { it.id == itemId }

    /** PC `toggleFavorite`: newest first, capped at 200. Returns true when added. */
    fun toggleFavorite(item: MediaItem): Boolean {
        var added = false
        mutateBucket { b ->
            val exists = b.favorites.any { it.id == item.id }
            added = !exists
            val list = if (exists) b.favorites.filterNot { it.id == item.id } else listOf(item) + b.favorites
            b.copy(favorites = list.take(200))
        }
        return added
    }

    fun isFavorite(itemId: String): Boolean = activeBucket.favorites.any { it.id == itemId }

    fun saveWatchProgress(entry: WatchProgress) = mutateBucket { b ->
        val filtered = b.watchProgress.filterNot {
            it.itemId == entry.itemId && (entry.season == 0 || (it.season == entry.season && it.episode == entry.episode))
        }
        val list = listOf(entry.copy(updatedAt = System.currentTimeMillis())) + filtered
        b.copy(watchProgress = list.take(80))
    }

    fun removeWatchProgress(itemId: String) = mutateBucket { b ->
        b.copy(watchProgress = b.watchProgress.filterNot { it.itemId == itemId })
    }

    fun clearHistory() = mutateBucket { b -> b.copy(watchProgress = emptyList()) }

    fun addRecentSearch(query: String) = mutateBucket { b ->
        val clean = query.trim()
        if (clean.length < 2) return@mutateBucket b
        val updated = (listOf(clean) + b.recentSearches.filterNot { it.equals(clean, ignoreCase = true) }).take(8)
        b.copy(recentSearches = updated)
    }

    fun clearRecentSearches() = mutateBucket { it.copy(recentSearches = emptyList()) }

    fun toggleFavoriteChannel(url: String): Boolean {
        var fav = false
        mutateBucket { b ->
            val exists = url in b.favoriteChannelUrls
            fav = !exists
            val list = if (exists) b.favoriteChannelUrls - url else listOf(url) + b.favoriteChannelUrls
            b.copy(favoriteChannelUrls = list.take(200))
        }
        return fav
    }

    fun recordRecentChannel(channel: LiveChannel) = mutateBucket { b ->
        val list = (listOf(channel) + b.recentChannels.filterNot { it.url == channel.url }).take(20)
        b.copy(recentChannels = list)
    }

    /**
     * Installs a plugin, or replaces an existing one with the same base URL in place
     * (keeping its position in the user's order). New plugins are appended at the end.
     */
    fun upsertPlugin(plugin: InstalledPlugin) = mutate { s ->
        val base = PluginCatalogs.stremioBaseFromUrl(plugin.url)
        val idx = s.plugins.indexOfFirst { PluginCatalogs.stremioBaseFromUrl(it.url) == base }
        if (idx < 0) {
            s.copy(plugins = s.plugins + plugin)
        } else {
            val list = s.plugins.toMutableList()
            list[idx] = plugin
            // Drop any further duplicates sharing the same base URL.
            val deduped = list.filterIndexed { i, p ->
                i == idx || PluginCatalogs.stremioBaseFromUrl(p.url) != base
            }
            s.copy(plugins = deduped)
        }
    }

    /**
     * Enables/disables a plugin without changing its position.
     * Built-in plugins (Cinemeta, Anime Kitsu, OpenSubtitles v3) are always active: the call is
     * ignored for them (and `seedBuiltins` forces `disabled = false` on every mutation anyway).
     */
    fun setPluginDisabled(url: String, disabled: Boolean) = mutate { s ->
        if (PluginCatalogs.isBuiltinUrl(url)) return@mutate s
        val base = PluginCatalogs.stremioBaseFromUrl(url)
        s.copy(
            plugins = s.plugins.map {
                if (PluginCatalogs.stremioBaseFromUrl(it.url) == base) it.copy(disabled = disabled) else it
            },
        )
    }

    /**
     * Moves a plugin [delta] positions within the full installed list (-1 = up, +1 = down),
     * clamped to the list bounds. Built-ins can be reordered too, since the UI computes
     * index/total over the full list and the order drives how stream/catalog results merge.
     */
    fun movePlugin(url: String, delta: Int) = mutate { s ->
        if (delta == 0) return@mutate s
        val base = PluginCatalogs.stremioBaseFromUrl(url)
        val from = s.plugins.indexOfFirst { PluginCatalogs.stremioBaseFromUrl(it.url) == base }
        if (from < 0) return@mutate s
        // Bundled plugins are hidden: moves step over them, among the user's plugins only.
        val visible = s.plugins.indices.filter { !s.plugins[it].builtin || it == from }
        val pos = visible.indexOf(from)
        val to = visible.getOrNull((pos + delta).coerceIn(0, visible.size - 1)) ?: return@mutate s
        if (to == from) return@mutate s
        val list = s.plugins.toMutableList()
        val item = list.removeAt(from)
        list.add(to, item)
        s.copy(plugins = list)
    }

    /** Installed plugins that are currently in use, in the user's order. */
    fun activePlugins(): List<InstalledPlugin> = current.plugins.filterNot { it.disabled }

    fun removePlugin(url: String) = mutate { s ->
        if (PluginCatalogs.isBuiltinUrl(url)) return@mutate s
        val base = PluginCatalogs.stremioBaseFromUrl(url)
        s.copy(plugins = s.plugins.filterNot { PluginCatalogs.stremioBaseFromUrl(it.url) == base })
    }

    fun setPluginAllowLan(url: String, allowLan: Boolean) = mutate { s ->
        val base = PluginCatalogs.stremioBaseFromUrl(url)
        s.copy(
            plugins = s.plugins.map {
                if (PluginCatalogs.stremioBaseFromUrl(it.url) == base) it.copy(allowLan = allowLan) else it
            },
        )
    }

    fun addM3uPlaylist(playlist: M3uPlaylist) = mutate { s ->
        if (s.m3uPlaylists.any { it.url.equals(playlist.url, ignoreCase = true) }) return@mutate s
        s.copy(m3uPlaylists = s.m3uPlaylists + playlist)
    }

    fun removeM3uPlaylist(url: String) = mutate { s ->
        s.copy(m3uPlaylists = s.m3uPlaylists.filterNot { it.url.equals(url, ignoreCase = true) })
    }

    fun updateSourcePrefs(block: (SourcePrefs) -> SourcePrefs) = mutate { it.copy(sourcePrefs = block(it.sourcePrefs)) }

    fun updateAppearance(block: (AppearancePrefs) -> AppearancePrefs) = mutate { it.copy(appearance = block(it.appearance)) }

    fun updatePlayback(block: (PlaybackPrefs) -> PlaybackPrefs) = mutate { it.copy(playback = block(it.playback)) }

    fun setParentalPin(pin: String, locked: Boolean) = mutate {
        it.copy(parentalPin = pin, parentalLocked = locked)
    }

    fun setRequiredLatestVersion(version: String, notes: String = "") = mutate { s ->
        if (AppUpdatePolicy.isOutdated(BuildConfig.VERSION_NAME, version)) {
            s.copy(requiredLatestVersion = version.trim(), requiredLatestNotes = notes.trim())
        } else {
            s.copy(requiredLatestVersion = "", requiredLatestNotes = "")
        }
    }

    fun hasSourcePlugins(): Boolean = activePlugins().any { it.hasStream || it.kind == "kino-js" }

    fun exportBackupJson(): String = json.encodeToString(current)

    fun importBackupJson(raw: String): Boolean {
        return runCatching {
            if (raw.length > 4_000_000) return@runCatching false
            val imported = json.decodeFromString<PersistedAppState>(raw)
            val safeProfiles = imported.profiles
                .filter { it.id.isNotBlank() && it.name.isNotBlank() }
                .take(12)
                .ifEmpty { PersistedAppState().profiles }
            val safeActive = if (safeProfiles.any { it.id == imported.activeProfileId }) {
                imported.activeProfileId
            } else {
                safeProfiles.first().id
            }
            val validProfileIds = safeProfiles.map { it.id }.toSet()
            val safeBuckets = imported.profileData
                .filterKeys { it in validProfileIds }
                .mapValues { (_, bucket) ->
                    bucket.copy(
                        myList = bucket.myList.take(500),
                        favorites = bucket.favorites.take(500),
                        watchProgress = bucket.watchProgress.take(500),
                        recentSearches = bucket.recentSearches.filter { it.isNotBlank() }.take(50),
                        favoriteChannelUrls = bucket.favoriteChannelUrls.filter { it.isNotBlank() }.take(500),
                        recentChannels = bucket.recentChannels.take(100),
                        chosenSources = bucket.chosenSources.entries.take(500).associate { it.key to it.value },
                    )
                }
            val safePlugins = PluginCatalogs.seedBuiltins(imported.plugins.take(100))
            val safeM3u = imported.m3uPlaylists
                .filter { it.url.startsWith("http://") || it.url.startsWith("https://") }
                .take(50)
            val sanitized = imported.copy(
                version = 2,
                profiles = safeProfiles,
                activeProfileId = safeActive,
                profileData = safeBuckets,
                plugins = safePlugins,
                m3uPlaylists = safeM3u,
            )
            mutate { sanitized }
            true
        }.getOrDefault(false)
    }
}
