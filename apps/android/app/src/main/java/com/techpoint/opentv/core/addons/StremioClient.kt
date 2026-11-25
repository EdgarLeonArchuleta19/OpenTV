package com.techpoint.opentv.core.addons

import com.techpoint.opentv.core.model.CatalogRow
import com.techpoint.opentv.core.model.Episode
import com.techpoint.opentv.core.model.ExternalSubtitle
import com.techpoint.opentv.core.model.InstalledPlugin
import com.techpoint.opentv.core.model.MediaItem
import com.techpoint.opentv.core.model.PluginCatalogDef
import com.techpoint.opentv.core.model.StreamSource
import com.techpoint.opentv.core.model.TitleDetail
import com.techpoint.opentv.service.RustServiceBridge
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import okhttp3.ConnectionPool
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URLEncoder
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * High-performance HTTP/2 client for Stremio-compatible plugins (Cinemeta, Anime Kitsu,
 * OpenSubtitles, Torrentio, DeepFlix, MediaFusion, etc.) with in-memory TTL cache.
 */
// Catalog rows are cached (as small CatalogRow lists) by CatalogRepository, so this JSON-tree
// cache only holds meta/stream/subtitle responses; parsed trees are large on a 1 GB Fire TV.
private const val MAX_CACHE_ENTRIES = 32

// Per-catalog budget: one slow plugin/CDN must not hold the whole section hostage.
// Measured on a Fire TV Stick (Wi-Fi): Cinemeta catalogs take 5-14 s on a cold start, so the
// budget is generous; rows are painted progressively, and from disk on later starts.
private const val CATALOG_TIMEOUT_MS = 20_000L

data class PluginInspectAddon(val name: String, val url: String, val description: String = "", val logo: String = "")
sealed class PluginInspectResult {
    data class Plugin(val plugin: InstalledPlugin) : PluginInspectResult()
    data class Collection(val name: String, val addons: List<PluginInspectAddon>) : PluginInspectResult()
}

class StremioClient(
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectionPool(ConnectionPool(16, 60, TimeUnit.SECONDS))
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .followRedirects(true)
        .build(),
) {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    private data class CacheEntry(val value: JsonObject, val expiresAt: Long)
    // Bounded LRU: parsed catalog JSON trees are large; on a 1 GB Fire TV keep only the most recent.
    private val cache = object : LinkedHashMap<String, CacheEntry>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, CacheEntry>?): Boolean = size > MAX_CACHE_ENTRIES
    }
    private fun cacheGet(url: String, now: Long): JsonObject? = synchronized(cache) {
        val e = cache[url] ?: return null
        if (e.expiresAt > now) e.value else { cache.remove(url); null }
    }
    private fun cachePut(url: String, entry: CacheEntry) = synchronized(cache) { cache[url] = entry }

    // Built once: `newBuilder().build()` per request allocated a new client (and dispatcher) every call.
    private val noRedirectClient: OkHttpClient by lazy {
        http.newBuilder()
            .followRedirects(false)
            .followSslRedirects(false)
            .build()
    }

    // Hosts NetGuard already approved (public, non-LAN). Short TTL so a re-pointed DNS record
    // is re-checked soon; it saves one blocking JNI + DNS round-trip per catalog request.
    private val allowedHosts = ConcurrentHashMap<String, Long>()
    private val allowedHostTtlMs = 2 * 60_000L

    private suspend fun hostAllowed(host: String): Boolean {
        val now = System.currentTimeMillis()
        allowedHosts[host]?.let { if (it > now) return true }
        // Cold start: the catalog request can arrive before the Rust core is bound; wait for it
        // instead of treating "service not started" as a refusal (that left Home empty).
        RustServiceBridge.awaitStarted()
        val guard = RustServiceBridge.callRpcSync(
            "netguardCheck",
            buildJsonObject {
                put("host", host)
                put("allowLan", false)
            },
        )
        val allowed = (guard["allowed"] as? JsonPrimitive)?.contentOrNull == "true" ||
            guard["allowed"]?.toString() == "true"
        if (allowed) allowedHosts[host] = now + allowedHostTtlMs
        return allowed
    }

    // Final URL of permanent catalog redirects (v3-cinemeta → cinemeta-catalogs): skips one
    // TLS round-trip per catalog; the target is still NetGuard-checked on every request.
    private val redirectCache = ConcurrentHashMap<String, String>()

    private suspend fun getJson(url: String, ttlMs: Long = 10 * 60_000L): JsonObject? =
        withContext(Dispatchers.IO) {
            val now = System.currentTimeMillis()
            cacheGet(url, now)?.let { return@withContext it }
            runCatching {
                // Guarded fetch: NetGuard + manual redirects so a public URL can't
                // bounce to loopback/LAN (SSRF). JSON is the only accepted payload.
                var current = redirectCache[url] ?: url
                var redirects = 0
                while (redirects <= 5) {
                    val parsedUrl = java.net.URL(current)
                    val host = parsedUrl.host?.lowercase().orEmpty()
                    if (!hostAllowed(host)) return@withContext null

                    val req = Request.Builder()
                        .url(current)
                        .header("User-Agent", "OpenTV/2.0 (Android)")
                        .header("Accept", "application/json")
                        .build()
                    noRedirectClient.newCall(req).execute().use { resp ->
                        val code = resp.code
                        if (code in 300..399) {
                            val loc = resp.header("Location") ?: return@withContext null
                            val next = parsedUrl.toURI().resolve(loc).toString()
                            if (!next.startsWith("http://") && !next.startsWith("https://")) {
                                return@withContext null
                            }
                            if (code == 301 || code == 308 || code == 302 || code == 307) {
                                if (redirectCache.size < 256) redirectCache[url] = next
                            }
                            current = next
                            redirects++
                            return@use
                        }
                        if (!resp.isSuccessful) return@withContext null
                        val body = resp.body?.string().orEmpty()
                        if (body.isBlank()) return@withContext null
                        val parsed = runCatching { json.parseToJsonElement(body) }.getOrNull() as? JsonObject
                            ?: return@withContext null
                        if (ttlMs > 0L) {
                            cachePut(url, CacheEntry(parsed, now + ttlMs))
                        }
                        return@withContext parsed
                    }
                }
                null
            }.getOrNull()
        }

    fun normalizeManifestUrl(input: String): String {
        val clean = input.trim()
            .replace(Regex("^stremio://", RegexOption.IGNORE_CASE), "https://")
        if (clean.endsWith("/manifest.json", ignoreCase = true)) return clean
        if (clean.endsWith("/kino-plugin.json", ignoreCase = true)) return clean
        return clean.removeSuffix("/") + "/manifest.json"
    }

    private suspend fun fetchStremioAddonCollection(
        baseUrl: String,
        addonCatalogs: List<JsonObject>,
    ): List<PluginInspectAddon> {
        val out = mutableListOf<PluginInspectAddon>()
        val seen = HashSet<String>()
        for (cat in addonCatalogs.take(4)) {
            val type = cat.str("type").ifBlank { "all" }
            val id = cat.str("id").trim()
            if (id.isBlank()) continue
            val data = getJson("$baseUrl/addon_catalog/${URLEncoder.encode(type, "UTF-8")}/${URLEncoder.encode(id, "UTF-8")}.json", ttlMs = 0L) ?: continue
            val addons = MetaJson.arr(data["addons"]).mapNotNull { it as? JsonObject }
            for (ad in addons) {
                val transportUrl = ad.str("transportUrl").ifBlank { ad.str("url") }.trim()
                if (!transportUrl.startsWith("http://") && !transportUrl.startsWith("https://")) continue
                val manifest = ad["manifest"] as? JsonObject ?: ad
                val name = manifest.str("name").ifBlank { ad.str("name") }.trim()
                if (name.isBlank()) continue
                val key = transportUrl.lowercase()
                if (!seen.add(key)) continue
                out.add(
                    PluginInspectAddon(
                        name = name,
                        url = transportUrl,
                        description = manifest.str("description").ifBlank { ad.str("description") },
                        logo = manifest.str("logo").ifBlank { manifest.str("icon") },
                    ),
                )
                if (out.size >= 30) return out
            }
        }
        return out
    }

    /** Inspects either a Stremio-compatible manifest.json or a kino-plugin.json repo/domain. */
    suspend fun inspectPlugin(rawInput: String): Result<PluginInspectResult> {
        val input = rawInput.trim()
        if (input.isBlank()) return Result.failure(IllegalArgumentException("Ingresa un enlace o repositorio válido"))

        // Check if it's a kino JS plugin (raw URL, github repo, or known domain)
        val kinoBase = resolveKinoRawBase(input)
        if (kinoBase != null) {
            val manifestUrl = "$kinoBase/kino-plugin.json"
            val obj = fetchViaRustText(manifestUrl)
                ?: return Result.failure(
                    IllegalStateException(
                        "No se pudo descargar kino-plugin.json" + (lastRustFetchError?.let { " ($it)" } ?: ""),
                    ),
                )
            val id = obj.str("id").ifBlank { return Result.failure(IllegalStateException("Manifiesto incompleto")) }
            val name = obj.str("name").ifBlank { id }
            val caps = MetaJson.strings(obj["capabilities"])
            return Result.success(
                PluginInspectResult.Plugin(
                    InstalledPlugin(
                        id = "kino_$id",
                        name = name,
                        url = manifestUrl,
                        baseUrl = kinoBase,
                        kind = "kino-js",
                        description = obj.str("description"),
                        logo = resolveLogoUrl(obj.str("icon").ifBlank { obj.str("logo") }, kinoBase),
                        version = obj.str("version"),
                        hasCatalog = "home" in caps || "search" in caps,
                        hasStream = "resolve" in caps || "sources" in caps || true,
                        hasMeta = "episodes" in caps,
                        types = listOf("movie", "series"),
                        rawRepoBase = kinoBase,
                    ),
                ),
            )
        }

        // Standard Stremio-compatible manifest.json
        val url = normalizeManifestUrl(input)
        val manifest = getJson(url, ttlMs = 0L)
            ?: return Result.failure(IllegalStateException("No se pudo leer el manifiesto del plugin"))
        val id = manifest.str("id").ifBlank { PluginCatalogs.stremioBaseFromUrl(url) }
        val name = manifest.str("name").ifBlank { id }
        val base = url.removeSuffix("/manifest.json").removeSuffix("/")

        val resources = MetaJson.arr(manifest["resources"])
        var hasCatalog = false
        var hasStream = false
        var hasSubs = false
        var hasMeta = false
        val idPrefixes = mutableListOf<String>()

        MetaJson.arr(manifest["idPrefixes"]).forEach { el ->
            (el as? JsonPrimitive)?.contentOrNull?.let(idPrefixes::add)
        }

        for (r in resources) {
            val rName = when (r) {
                is JsonPrimitive -> r.contentOrNull.orEmpty()
                is JsonObject -> {
                    MetaJson.arr(r["idPrefixes"]).forEach { p -> (p as? JsonPrimitive)?.contentOrNull?.let(idPrefixes::add) }
                    r.str("name")
                }
                else -> ""
            }
            when (rName) {
                "catalog" -> hasCatalog = true
                "stream" -> hasStream = true
                "subtitles" -> hasSubs = true
                "meta" -> hasMeta = true
            }
        }

        val types = MetaJson.strings(manifest["types"])
        val catalogs = MetaJson.arr(manifest["catalogs"]).mapNotNull { el ->
            val co = el as? JsonObject ?: return@mapNotNull null
            val cType = co.str("type")
            val cId = co.str("id")
            if (cType.isBlank() || cId.isBlank()) return@mapNotNull null
            val extras = MetaJson.arr(co["extra"]).mapNotNull { it as? JsonObject }
            val searchExtra = extras.firstOrNull { it.str("name") == "search" }
            val genreExtra = extras.firstOrNull { it.str("name") == "genre" }
            val genres = MetaJson.strings(genreExtra?.get("options"))
            PluginCatalogDef(
                type = cType,
                id = cId,
                name = co.str("name").ifBlank { cId },
                supportsSearch = searchExtra != null,
                searchRequired = (searchExtra?.get("isRequired") as? JsonPrimitive)?.contentOrNull == "true",
                genres = genres,
            )
        }

        val addonCatalogs = MetaJson.arr(manifest["addonCatalogs"]).mapNotNull { it as? JsonObject }
        val collectionOnly = addonCatalogs.isNotEmpty() && !hasStream && !hasSubs && !hasMeta && catalogs.isEmpty()
        if (collectionOnly) {
            val addons = fetchStremioAddonCollection(base, addonCatalogs)
            return Result.success(PluginInspectResult.Collection(name, addons))
        }

        return Result.success(
            PluginInspectResult.Plugin(
                InstalledPlugin(
                    id = id,
                    name = name,
                    url = url,
                    baseUrl = base,
                    kind = "stremio",
                    description = manifest.str("description"),
                    logo = resolveLogoUrl(manifest.str("logo").ifBlank { manifest.str("icon") }, base),
                    version = manifest.str("version"),
                    builtin = PluginCatalogs.isBuiltinUrl(url),
                    hasCatalog = hasCatalog || catalogs.isNotEmpty(),
                    hasStream = hasStream,
                    hasSubtitles = hasSubs,
                    hasMeta = hasMeta,
                    types = types,
                    idPrefixes = idPrefixes.distinct(),
                    catalogs = catalogs,
                ),
            ),
        )
    }

    /** Fetches curated rows for Home, Movies, Series, Kids (all-ages only!), or Anime (Kitsu only!). */
    suspend fun loadCatalogSection(
        section: String,
        plugins: List<InstalledPlugin>,
    ): List<CatalogRow> = loadCatalogSectionProgressive(section, plugins) {}

    /**
     * Same as [loadCatalogSection], but every catalog is fetched in parallel off the main thread
     * and [onProgress] receives the rows ready so far (in section order) as soon as the first
     * row (the hero source) is in, so the UI never waits for the slowest catalog.
     */
    suspend fun loadCatalogSectionProgressive(
        section: String,
        plugins: List<InstalledPlugin>,
        onProgress: (List<CatalogRow>) -> Unit,
    ): List<CatalogRow> = withContext(Dispatchers.Default) {
        val allSpecs = catalogSpecs(section, plugins)
        // Cold start: wait for the Rust core (NetGuard) once, outside the per-catalog budget;
        // otherwise its start-up time on a Fire TV ate the timeout and rows went missing.
        RustServiceBridge.awaitStarted()
        val slots = arrayOfNulls<CatalogRow>(allSpecs.size)
        val done = BooleanArray(allSpecs.size)
        val lock = Any()
        coroutineScope {
            allSpecs.mapIndexed { index, spec ->
                async {
                    val t0 = System.currentTimeMillis()
                    val row = withTimeoutOrNull(CATALOG_TIMEOUT_MS) { fetchCatalogRow(section, spec, index) }
                    if (row == null) {
                        android.util.Log.w("OpenTV-Cat", "$section/${spec.id} sin filas tras ${System.currentTimeMillis() - t0} ms")
                    }
                    val snapshot = synchronized(lock) {
                        slots[index] = row
                        done[index] = true
                        // Emit once the first row is settled, so the hero never jumps between rows.
                        if (done[0]) slots.filterNotNull() else null
                    }
                    if (snapshot != null && snapshot.isNotEmpty()) onProgress(snapshot)
                }
            }.awaitAll()
        }
        slots.filterNotNull()
    }

    /**
     * One section row: its TMDB lists (Rust core) in order, then the hidden Cinemeta/Kitsu
     * catalog [CatalogSpec.url] when every list failed or came back empty.
     */
    private suspend fun fetchCatalogRow(section: String, spec: CatalogSpec, index: Int): CatalogRow? {
        var title = spec.title
        var items: List<MediaItem> = emptyList()
        for (list in spec.lists) {
            items = loadCoreList(list, title)
            if (items.isNotEmpty()) break
        }
        if (items.isEmpty()) {
            if (spec.url.isBlank()) return null
            if (spec.lists.isNotEmpty() && spec.fallbackTitle != null) title = spec.fallbackTitle
            // ttl 0: CatalogRepository keeps the (much smaller) parsed rows instead of the JSON tree.
            val obj = getJson(spec.url, ttlMs = 0L) ?: return null
            val metas = MetaJson.arr(obj["metas"])
            val forceAnime = section == "anime"
            items = metas.asSequence()
                .mapNotNull { parseMetaSummary(it, spec.url, title, forceAnime) }
                .let { seq ->
                    if (section == "kids") {
                        seq.filter { it.genres.isEmpty() || it.genres.any { g -> g.equals("Family", ignoreCase = true) } }
                    } else seq
                }
                .take(28)
                .toList()
        }
        // The first row feeds the hero: rotate its picks once a day.
        if (index == 0 && (section == "kids" || section == "anime")) {
            items = SectionContent.dailyHeroOrder(items, "$section:${SectionContent.localDayKey()}")
        }
        return if (items.isEmpty()) null else CatalogRow(id = spec.id, title = title, items = items)
    }

    // Titles seen in the all-ages Kids lists: the Kids profile search also accepts them.
    private val kidsApprovedIds: MutableSet<String> = ConcurrentHashMap.newKeySet()

    /** Row served by the Rust core (`tmdb` RPC); empty when unavailable (no TMDB key, offline, error). */
    private suspend fun loadCoreList(list: String, rowTitle: String): List<MediaItem> {
        val res = runCatching {
            RustServiceBridge.callRpc("tmdb", buildJsonObject { put("list", list) })
        }.getOrNull() ?: return emptyList()
        val kind = CatalogRows.listKind(list)
        val items = MetaJson.arr(res["items"]).mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            when (kind) {
                CatalogRows.ListKind.ANIME_KITSU -> SectionContent.animeSeasonItem(o, rowTitle)
                CatalogRows.ListKind.ANIME_TMDB -> SectionContent.kidsTmdbItem(o, rowTitle, anime = true)
                else -> SectionContent.kidsTmdbItem(o, rowTitle)
            }
        }.distinctBy { it.id }
        if (kind == CatalogRows.ListKind.KIDS) items.forEach { kidsApprovedIds.add(it.id) }
        return items.take(28)
    }

    /** How many rows [loadCatalogSection] asks for (lets the cache tell a partial result). */
    fun catalogRowCount(section: String, plugins: List<InstalledPlugin>): Int = catalogSpecs(section, plugins).size

    private fun catalogSpecs(section: String, plugins: List<InstalledPlugin>): List<CatalogSpec> {
        val specs = CatalogRows.specs(section)

        // Add extra catalog rows from user-installed third-party Stremio catalog plugins
        val extraSpecs = mutableListOf<CatalogSpec>()
        for (p in plugins) {
            if (p.disabled || p.kind != "stremio" || p.builtin || p.baseUrl.isBlank()) continue
            for (cat in p.catalogs) {
                if (cat.searchRequired) continue
                val matchesSection = when (section) {
                    "anime" -> cat.type == "anime"
                    "movies" -> cat.type == "movie"
                    "series" -> cat.type == "series"
                    "home" -> cat.type == "movie" || cat.type == "series"
                    else -> false
                }
                if (matchesSection) {
                    val rowId = "ext_${p.id}_${cat.type}_${cat.id}"
                    val rowTitle = "${cat.name} · ${p.name}"
                    extraSpecs.add(CatalogSpec(rowId, rowTitle, "${p.baseUrl}/catalog/${cat.type}/${cat.id}.json"))
                }
            }
        }

        return specs + extraSpecs.take(6)
    }

    /** Spanish title/overview from TMDB (via the Rust core) for an IMDb id; null when unavailable. */
    data class SpanishInfo(val tmdbId: String, val kind: String, val title: String, val overview: String)

    private val esCache = object : LinkedHashMap<String, SpanishInfo?>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, SpanishInfo?>?): Boolean = size > 200
    }

    suspend fun spanishInfo(imdbId: String): SpanishInfo? {
        val id = imdbId.removePrefix("stremio:")
        if (!id.startsWith("tt")) return null
        synchronized(esCache) { if (esCache.containsKey(id)) return esCache[id] }
        val res = runCatching {
            RustServiceBridge.callRpc("tmdb", buildJsonObject { put("list", "es:$id") })
        }.getOrNull() ?: return null
        if (res["error"] != null && res["item"] == null) return null // keep retrying later (no cache)
        val obj = res["item"] as? JsonObject
        val info = obj?.let {
            SpanishInfo(
                tmdbId = (it["tmdbId"] as? JsonPrimitive)?.contentOrNull.orEmpty(),
                kind = it.str("kind"),
                title = it.str("title"),
                overview = it.str("overview"),
            )
        }
        synchronized(esCache) { esCache[id] = info }
        return info
    }

    /** Spanish episode titles/overviews for one TMDB season: number → (title, overview). */
    private suspend fun spanishSeason(tmdbId: String, season: Int): Map<Int, Pair<String, String>> {
        if (tmdbId.isBlank()) return emptyMap()
        val res = runCatching {
            RustServiceBridge.callRpc("tmdb", buildJsonObject { put("list", "es-season:$tmdbId:$season") })
        }.getOrNull() ?: return emptyMap()
        return MetaJson.arr(res["episodes"]).mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            val n = (o["number"] as? JsonPrimitive)?.intOrNull ?: return@mapNotNull null
            n to (o.str("title") to o.str("overview"))
        }.toMap()
    }

    /**
     * Full metadata for DetailScreen / the player. `tt…` ids: TMDB through the core
     * (`detail:<imdb>`, Spanish text, cast, seasons, related) with the episodes of one season
     * ([preferSeason], else the first); other seasons load lazily via [loadSeasonEpisodes].
     * Hidden fallback: the Cinemeta meta (all episodes). `kitsu:` ids use the Kitsu plugin.
     *
     * Never throws (besides cancellation): a malformed meta from a plugin must not crash the
     * detail screen — it falls back to the catalog item without episodes.
     */
    suspend fun loadDetail(item: MediaItem, preferSeason: Int = 0): TitleDetail = try {
        val rawId = item.id.removePrefix("stremio:")
        (if (rawId.startsWith("tt")) tmdbDetail(item, rawId.substringBefore(':'), preferSeason) else null)
            ?: loadDetailOrThrow(item)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        android.util.Log.w("StremioClient", "loadDetail failed for ${item.id}", e)
        TitleDetail(item = item)
    }

    // IMDb id -> TMDB tv id (from `detail:`), so a season can be loaded lazily later.
    private val tmdbTvIds = ConcurrentHashMap<String, String>()

    // Loaded seasons ("tt…:3" -> episodes); small, so going back to a title is instant.
    private val seasonCache = object : LinkedHashMap<String, List<Episode>>(32, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<Episode>>?): Boolean = size > 24
    }

    /** TMDB detail through the core; null when unavailable so the caller uses Cinemeta. */
    private suspend fun tmdbDetail(item: MediaItem, imdb: String, preferSeason: Int): TitleDetail? {
        val res = runCatching {
            RustServiceBridge.callRpc("tmdb", buildJsonObject { put("list", "detail:$imdb") })
        }.getOrNull()
        val parsed = TmdbDetail.parseDetail(res, item) ?: return null
        if (parsed.tmdbId.isNotBlank()) {
            if (tmdbTvIds.size > 512) tmdbTvIds.clear()
            tmdbTvIds[imdb] = parsed.tmdbId
        }
        val episodes = when {
            !parsed.item.isSeries -> emptyList()
            parsed.seasons.isEmpty() -> cinemetaEpisodes(imdb, null, parsed.item.backdrop)
            else -> {
                val season = preferSeason.takeIf { it in parsed.seasons } ?: parsed.seasons.first()
                seasonEpisodes(imdb, parsed.tmdbId, season, parsed.item.backdrop)
            }
        }
        val seasons = parsed.seasons.ifEmpty { episodes.map { it.season }.distinct().sorted() }
        val related = parsed.related.ifEmpty {
            cinemetaRelated(parsed.item, if (parsed.item.isSeries) "series" else "movie")
        }
        return TitleDetail(item = parsed.item, episodes = episodes, seasons = seasons, related = related)
    }

    /**
     * Episodes of one season for a `tt…` series (detail screen season switch). TMDB first
     * (Spanish titles, stills), Cinemeta's episode list as fallback. Never throws.
     */
    suspend fun loadSeasonEpisodes(item: MediaItem, season: Int): List<Episode> = try {
        val imdb = item.imdbId
        if (!imdb.startsWith("tt") || season <= 0) emptyList()
        else seasonEpisodes(imdb, tmdbTvIds[imdb].orEmpty(), season, item.backdrop)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        android.util.Log.w("StremioClient", "season $season failed for ${item.id}", e)
        emptyList()
    }

    private suspend fun seasonEpisodes(imdb: String, tmdbId: String, season: Int, thumb: String): List<Episode> {
        val key = "$imdb:$season"
        synchronized(seasonCache) { seasonCache[key] }?.let { return it }
        var eps = if (tmdbId.isNotBlank()) {
            val res = runCatching {
                RustServiceBridge.callRpc("tmdb", buildJsonObject { put("list", "episodes:$tmdbId:$season") })
            }.getOrNull()
            TmdbDetail.parseEpisodes(res, imdb, season, thumb)
        } else emptyList()
        if (eps.isEmpty()) eps = cinemetaEpisodes(imdb, season, thumb)
        if (eps.isNotEmpty()) synchronized(seasonCache) { seasonCache[key] = eps }
        return eps
    }

    /** Episodes from the Cinemeta series meta (one [season], or all when null). */
    private suspend fun cinemetaEpisodes(imdb: String, season: Int?, thumb: String): List<Episode> {
        val meta = getJson("https://v3-cinemeta.strem.io/meta/series/${URLEncoder.encode(imdb, "UTF-8")}.json")
            ?.get("meta") as? JsonObject
        val all = MetaJson.parseEpisodes(meta?.get("videos"), imdb, thumb)
        return if (season == null) all else all.filter { it.season == season }
    }

    /** "Similares" from Cinemeta's top catalog of the title's primary genre. */
    private suspend fun cinemetaRelated(item: MediaItem, reqType: String): List<MediaItem> {
        val primaryGenre = item.genres.firstOrNull { !it.equals("Animation", ignoreCase = true) }
        if (primaryGenre.isNullOrBlank()) return emptyList()
        val gEnc = URLEncoder.encode(primaryGenre, "UTF-8")
        val relObj = getJson("https://v3-cinemeta.strem.io/catalog/$reqType/top/genre=$gEnc.json")
        return MetaJson.arr(relObj?.get("metas"))
            .mapNotNull { parseMetaSummary(it, "", "Similares", false) }
            .filter { it.id != item.id }
            .distinctBy { it.id }
            .take(14)
    }

    /** Hidden fallback detail: Cinemeta meta (Kitsu plugin for anime ids) + Spanish TMDB text. */
    private suspend fun loadDetailOrThrow(item: MediaItem): TitleDetail = coroutineScope {
        val rawId = item.id.removePrefix("stremio:")
        // Spanish metadata (v1 parity): fetched in parallel with the Cinemeta meta.
        val esDeferred = async { if (rawId.startsWith("tt")) spanishInfo(rawId) else null }
        val base = when {
            rawId.startsWith("kitsu:") || (item.isAnime && !rawId.startsWith("tt")) -> "https://anime-kitsu.strem.fun"
            else -> "https://v3-cinemeta.strem.io"
        }
        val reqType = when {
            rawId.startsWith("kitsu:") -> "anime"
            item.type == "series" -> "series"
            else -> "movie"
        }
        val encId = URLEncoder.encode(rawId, "UTF-8")
        val metaObj = getJson("$base/meta/$reqType/$encId.json")?.get("meta") as? JsonObject

        val enrichedItem = if (metaObj != null) {
            val genres = MetaJson.strings(metaObj["genres"])
                .ifEmpty { item.genres }
            val cast = MetaJson.strings(metaObj["cast"])
            val director = MetaJson.strings(metaObj["director"]).joinToString(", ")
            item.copy(
                title = metaObj.str("name").ifBlank { item.title },
                year = metaObj.str("releaseInfo").take(4).ifBlank { metaObj.str("year").ifBlank { item.year } },
                score = metaObj.str("imdbRating").ifBlank { item.score },
                duration = metaObj.str("runtime").ifBlank { item.duration },
                genres = genres,
                synopsis = metaObj.str("description").ifBlank { item.synopsis },
                poster = metaObj.str("poster").ifBlank { item.poster },
                backdrop = metaObj.str("background").ifBlank { item.backdrop.ifBlank { item.poster } },
                logo = metaObj.str("logo").ifBlank { item.logo },
                cast = cast.take(8),
                director = director,
            )
        } else item

        val episodes = MetaJson.parseEpisodes(metaObj?.get("videos"), rawId, enrichedItem.backdrop)

        val es = esDeferred.await()
        val esItem = if (es != null) {
            enrichedItem.copy(
                title = es.title.ifBlank { enrichedItem.title },
                synopsis = es.overview.ifBlank { enrichedItem.synopsis },
            )
        } else enrichedItem
        val esEpisodes = if (es != null && es.kind == "tv" && episodes.isNotEmpty()) {
            val seasonNums = episodes.map { it.season }.distinct().sorted().take(12)
            val bySeason = seasonNums.map { sn -> async { sn to spanishSeason(es.tmdbId, sn) } }.awaitAll().toMap()
            episodes.map { ep ->
                val tr = bySeason[ep.season]?.get(ep.number)
                if (tr == null) ep else ep.copy(
                    title = tr.first.ifBlank { ep.title },
                    overview = tr.second.ifBlank { ep.overview },
                )
            }
        } else episodes

        val seasons = esEpisodes.map { it.season }.distinct().sorted()
        val trailer = MetaJson.arr(metaObj?.get("trailers")).firstOrNull()?.let {
            (it as? JsonObject)?.str("source")
        }.orEmpty()

        // Related titles from primary genre
        val related = if (reqType != "anime") cinemetaRelated(enrichedItem, reqType) else emptyList()

        TitleDetail(
            item = esItem,
            episodes = esEpisodes,
            seasons = seasons,
            trailerYoutubeId = trailer,
            related = related,
        )
    }

    /** Queries all installed Stremio-compatible stream plugins concurrently. */
    suspend fun fetchStreams(
        item: MediaItem,
        episode: Episode?,
        plugins: List<InstalledPlugin>,
    ): List<StreamSource> = coroutineScope {
        val rawId = item.id.removePrefix("stremio:")
        val streamId = if (episode != null) {
            if (episode.id.contains(":")) episode.id else "$rawId:${episode.season}:${episode.number}"
        } else rawId
        // TMDB anime rows carry IMDb ids and a real movie/series type; Kitsu ids are series.
        val reqType = when {
            rawId.startsWith("kitsu:") || (item.isAnime && !rawId.startsWith("tt")) -> "series"
            item.isSeries -> "series"
            else -> "movie"
        }
        val encId = URLEncoder.encode(streamId, "UTF-8")

        val streamPlugins = plugins.filter { !it.disabled && it.kind == "stremio" && it.hasStream && it.baseUrl.isNotBlank() }
        val jobs = streamPlugins.map { plugin ->
            async {
                withTimeoutOrNull(8_000L) {
                    val url = "${plugin.baseUrl}/stream/$reqType/$encId.json"
                    val obj = getJson(url, ttlMs = 3 * 60_000L) ?: return@withTimeoutOrNull emptyList()
                    val arr = MetaJson.arr(obj["streams"])
                    arr.mapIndexedNotNull { idx, el ->
                        parseStream(el, plugin, idx)
                    }
                }.orEmpty()
            }
        }
        jobs.awaitAll().flatten()
    }

    /** Queries OpenSubtitles v3 and any installed subtitle plugins concurrently. */
    suspend fun fetchSubtitles(
        item: MediaItem,
        episode: Episode?,
        plugins: List<InstalledPlugin>,
    ): List<ExternalSubtitle> = coroutineScope {
        val rawId = item.id.removePrefix("stremio:")
        val subId = if (episode != null) {
            if (episode.id.contains(":")) episode.id else "$rawId:${episode.season}:${episode.number}"
        } else rawId
        val reqType = if (item.isSeries) "series" else "movie"
        val encId = URLEncoder.encode(subId, "UTF-8")

        val subPlugins = plugins.filter { !it.disabled && it.kind == "stremio" && it.hasSubtitles && it.baseUrl.isNotBlank() }
        val jobs = subPlugins.map { plugin ->
            async {
                val url = "${plugin.baseUrl}/subtitles/$reqType/$encId.json"
                val obj = getJson(url, ttlMs = 15 * 60_000L) ?: return@async emptyList()
                MetaJson.arr(obj["subtitles"]).mapIndexedNotNull { idx, el ->
                    val o = el as? JsonObject ?: return@mapIndexedNotNull null
                    val sUrl = o.str("url")
                    if (!sUrl.startsWith("http")) return@mapIndexedNotNull null
                    val lang = o.str("lang").lowercase(Locale.ROOT)
                    ExternalSubtitle(
                        id = "${plugin.id}_$idx",
                        url = sUrl,
                        lang = lang,
                        label = langDisplayName(lang),
                        source = plugin.name,
                    )
                }
            }
        }

        // OpenSubtitles v3 (and other subtitle plugins): Latin-American Spanish, Spanish, English.
        SubtitleOrder.order(jobs.awaitAll().flatten())
    }

    /**
     * SubDL through the Rust core (`subdlSearch`): local core URLs. Empty when SubDL is not
     * available (no key) or fails — the player simply does not list it.
     */
    suspend fun fetchSubdl(item: MediaItem, episode: Episode?): List<ExternalSubtitle> {
        val imdb = item.imdbId
        if (!imdb.startsWith("tt")) return emptyList()
        val res = runCatching {
            RustServiceBridge.callRpc(
                "subdlSearch",
                buildJsonObject {
                    put("imdbId", imdb)
                    put("kind", if (item.isSeries) "series" else "movie")
                    if (episode != null) {
                        put("season", episode.season)
                        put("episode", episode.number)
                    }
                },
            )
        }.getOrNull() ?: return emptyList()
        return SubtitleOrder.parseSubdl(res)
    }


    /**
     * Search screen results, in this order:
     * 1. TMDB (`find:<query>` in the Rust core): Spanish titles, real posters, relevance order.
     * 2. Anime Kitsu search (`kitsu:` ids; never in the Kids profile).
     * 3. Cinemeta search only as a fallback when TMDB is unavailable (no key) or found nothing,
     *    and without the poster-less entries.
     */
    suspend fun search(
        query: String,
        plugins: List<InstalledPlugin>,
        kidsOnly: Boolean = false,
    ): List<MediaItem> = coroutineScope {
        val clean = query.trim()
        if (clean.length < 2) return@coroutineScope emptyList()
        val enc = URLEncoder.encode(clean, "UTF-8")

        val animeDeferred = if (kidsOnly) null else async {
            val url = "https://anime-kitsu.strem.fun/catalog/anime/kitsu-anime-trending/search=$enc.json"
            val obj = getJson(url, ttlMs = 5 * 60_000L) ?: return@async emptyList()
            MetaJson.arr(obj["metas"]).mapNotNull { parseMetaSummary(it, url, "Búsqueda", true) }
        }
        val tmdb = tmdbFind(clean)
        val fallback = if (tmdb.isEmpty()) cinemetaSearch(clean) else emptyList()
        val anime = animeDeferred?.await().orEmpty()

        SearchResults.merge(
            tmdb = tmdb,
            anime = anime,
            cinemeta = fallback,
            kidsOnly = kidsOnly,
            kidsApproved = kidsApprovedIds,
            query = clean,
        )
    }

    /** TMDB search through the Rust core; empty when unavailable (no key, offline...). */
    private suspend fun tmdbFind(query: String): List<MediaItem> {
        val res = runCatching {
            RustServiceBridge.callRpc("tmdb", buildJsonObject { put("list", "find:$query") })
        }.getOrNull() ?: return emptyList()
        return MetaJson.arr(res["items"]).mapNotNull { el ->
            (el as? JsonObject)?.let { SectionContent.kidsTmdbItem(it, "Búsqueda") }
        }
    }

    /** Cinemeta movie + series search (plus the TMDB original title when it differs). */
    private suspend fun cinemetaSearch(clean: String): List<MediaItem> = coroutineScope {
        val queries = mutableListOf(clean)
        val tmdbRes = runCatching {
            RustServiceBridge.callRpc("tmdb", buildJsonObject { put("list", "search:$clean") })
        }.getOrNull()
        MetaJson.arr(tmdbRes?.get("items")).take(2).forEach { el ->
            val orig = (el as? JsonObject)?.str("originalTitle").orEmpty()
            if (orig.isNotBlank() && !orig.equals(clean, ignoreCase = true) && orig !in queries) {
                queries.add(orig)
            }
        }
        val urls = queries.take(2).flatMap { q ->
            val enc = URLEncoder.encode(q, "UTF-8")
            listOf(
                "https://v3-cinemeta.strem.io/catalog/movie/top/search=$enc.json",
                "https://v3-cinemeta.strem.io/catalog/series/top/search=$enc.json",
            )
        }
        val results = urls.map { url ->
            async {
                val obj = getJson(url, ttlMs = 5 * 60_000L) ?: return@async emptyList()
                MetaJson.arr(obj["metas"]).mapNotNull { parseMetaSummary(it, url, "Búsqueda", false) }
            }
        }.awaitAll().flatten()

        // Ordered later with the other sources (SearchResults.order).
        results.distinctBy { it.id }
    }

    private fun parseMetaSummary(
        el: JsonElement,
        sourceUrl: String,
        rowTitle: String,
        forceAnime: Boolean,
    ): MediaItem? {
        val obj = el as? JsonObject ?: return null
        val rawId = obj.str("id").ifBlank { return null }
        val title = obj.str("name").ifBlank { return null }
        val rawType = obj.str("type").ifBlank { if (forceAnime) "anime" else "movie" }
        val isAnime = forceAnime || rawType == "anime" || rawId.startsWith("kitsu:")
        val genres = MetaJson.strings(obj["genres"])
        return MediaItem(
            id = if (rawId.startsWith("stremio:")) rawId else "stremio:$rawId",
            type = if (isAnime) "anime" else rawType,
            title = title,
            year = obj.str("releaseInfo").take(4).ifBlank { obj.str("year") },
            score = obj.str("imdbRating"),
            duration = obj.str("runtime"),
            genres = genres,
            synopsis = obj.str("description"),
            poster = obj.str("poster"),
            backdrop = obj.str("background").ifBlank { obj.str("poster") },
            logo = obj.str("logo"),
            addonUrl = sourceUrl,
            catalogRow = rowTitle,
            isAnime = isAnime,
        )
    }

    private fun parseStream(el: JsonElement, plugin: InstalledPlugin, idx: Int): StreamSource? {
        val obj = el as? JsonObject ?: return null
        val url = obj.str("url")
        val hash = obj.str("infoHash")
        if (url.isBlank() && hash.isBlank()) return null

        val bh = obj["behaviorHints"] as? JsonObject
        val filename = bh?.str("filename").orEmpty()
        val reqHeaders = mutableMapOf<String, String>()
        (bh?.get("proxyHeaders") as? JsonObject)?.get("request")?.let { reqObj ->
            (reqObj as? JsonObject)?.forEach { (k, v) ->
                (v as? JsonPrimitive)?.contentOrNull?.let { reqHeaders[k] = it }
            }
        }
        val trackers = MetaJson.arr(obj["sources"])
            .mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
            .filter { it.startsWith("tracker:") }
            .map { it.removePrefix("tracker:") }

        return StreamSource(
            id = "${plugin.id}_${hash.ifBlank { url.hashCode().toString() }}_$idx",
            addonId = plugin.id,
            addonName = plugin.name,
            name = obj.str("name").ifBlank { plugin.name },
            title = obj.str("title").ifBlank { obj.str("description") },
            url = url,
            infoHash = hash,
            fileIdx = (obj["fileIdx"] as? JsonPrimitive)?.intOrNull,
            filename = filename,
            trackers = trackers,
            headers = reqHeaders,
        )
    }

    /** Resolves relative plugin manifest icons against [base] and upgrades http:// to https://. */
    private fun resolveLogoUrl(raw: String, base: String): String {
        val clean = raw.trim()
        if (clean.isBlank()) return ""
        // Skip SVGs (Coil without coil-svg cannot decode them; PluginIcon draws crisp vector emblems)
        if (clean.substringBefore("?").endsWith(".svg", ignoreCase = true)) return ""
        if (clean.startsWith("https://", ignoreCase = true)) return clean
        if (clean.startsWith("http://", ignoreCase = true)) return "https://" + clean.removePrefix("http://")
        if (clean.startsWith("//")) return "https:$clean"
        val cleanBase = base.trim().removeSuffix("/")
        if (cleanBase.isBlank()) return ""
        return if (clean.startsWith("/")) {
            val origin = Regex("""^https?://[^/]+""", RegexOption.IGNORE_CASE).find(cleanBase)?.value ?: cleanBase
            "$origin$clean"
        } else {
            "$cleanBase/$clean"
        }
    }

    private fun resolveKinoRawBase(input: String): String? {
        if (input.contains("raw.githubusercontent.com") && input.contains("kino-plugin.json")) {
            return input.substringBefore("/kino-plugin.json").removeSuffix("/")
        }
        if (Regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$").matches(input)) {
            return "https://raw.githubusercontent.com/$input/HEAD"
        }
        val gh = Regex("""^https?://(?:www\.)?github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)""", RegexOption.IGNORE_CASE).find(input)
        if (gh != null) {
            return "https://raw.githubusercontent.com/${gh.groupValues[1].removeSuffix(".git")}/HEAD"
        }
        val host = Regex("""^(?:https?://)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})""", RegexOption.IGNORE_CASE).find(input)?.groupValues?.get(1)?.lowercase(Locale.ROOT)
        val mapped = host?.let { PluginCatalogs.JsPluginHostMap[it] }
        return mapped?.let { "https://raw.githubusercontent.com/$it/HEAD" }
    }

    private suspend fun fetchViaRustText(url: String): JsonObject? {
        val resp = RustServiceBridge.callRpc(
            "pluginFetch",
            buildJsonObject {
                put("url", url)
                put("method", "GET")
                put("timeoutMs", 12000)
            },
        )
        val text = (resp["text"] as? JsonPrimitive)?.contentOrNull
        val status = (resp["status"] as? JsonPrimitive)?.contentOrNull
        if (text.isNullOrBlank()) {
            lastRustFetchError = (resp["error"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
                ?: "HTTP ${status ?: "?"}"
            android.util.Log.w("OpenTV", "pluginFetch $url failed: $lastRustFetchError ($resp)")
            return null
        }
        lastRustFetchError = null
        return runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()
    }

    /** Reason of the last failed [fetchViaRustText], shown to the user instead of a generic error. */
    @Volatile private var lastRustFetchError: String? = null

    private fun langDisplayName(code: String): String = when {
        code.startsWith("spa") || code == "es" || code.startsWith("es-") -> "Español"
        code.startsWith("eng") || code == "en" -> "Inglés"
        code.startsWith("por") || code == "pt" -> "Portugués"
        code.startsWith("fre") || code == "fr" -> "Francés"
        code.startsWith("ita") || code == "it" -> "Italiano"
        code.startsWith("ger") || code == "de" -> "Alemán"
        code.startsWith("jpn") || code == "ja" -> "Japonés"
        else -> code.uppercase(Locale.ROOT).ifBlank { "Subtítulo" }
    }

    private fun JsonObject.str(key: String): String =
        (this[key] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
}
