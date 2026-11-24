package com.techpoint.opentv.core.jsplugins

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.techpoint.opentv.core.model.InstalledPlugin
import com.techpoint.opentv.core.model.MediaItem
import com.techpoint.opentv.core.model.StreamSource
import com.techpoint.opentv.core.ranking.PlaybackProfile
import com.techpoint.opentv.service.RustServiceBridge
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.io.ByteArrayInputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * On-demand isolated sandboxes for community JS plugins (`kino-plugin.json` + `plugin.js`).
 *
 * Runs the SAME runtime as the PC (`assets/js/plugin-runtime.js`, shared wire
 * protocol `load` / `call` / `ask` / `answer`). Every plugin key gets ITS OWN hidden
 * WebView (separate JS realm and its own `__opentvHost` bridge object bound to that
 * key on the Kotlin side), so a plugin can neither read nor impersonate another one:
 * the key a message claims is ignored, pending ids are random and per WebView, and
 * cookie jars / storage are per plugin. Every network request of a sandbox WebView
 * is answered with 403 in `shouldInterceptRequest` (only the bootstrap files are
 * served from the APK). All plugin HTTP goes through Rust `pluginFetch` + NetGuard.
 *
 * `kino.plugins.call('resolver', ...)` runs the provider in its own WebView WITHOUT
 * allowLan and with plain JSON data only: an installed plugin that `provides` the
 * door, or an APPROVED helper repo the caller declares in `consumes.<door>.repo`
 * (see [JsPluginSecurity]), pinned by commit / SHA-256 when the caller declares it.
 *
 * Memory (1 GB Fire TV): ZERO WebViews until a JS plugin is queried; WebViews are
 * created lazily, each is destroyed after 60 s idle on low-RAM TVs (180 s otherwise),
 * at most [maxViews] live at once (idle LRU ones are evicted) and at most
 * `maxViews - 1` plugins are queried in parallel, leaving room for one helper.
 */
class JsPluginHost(
    private val appContext: Context,
    private val isLowMemory: Boolean,
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    private val maxViews = if (isLowMemory) 4 else 6
    private val idleMs = if (isLowMemory) 60_000L else 180_000L
    private val views = ConcurrentHashMap<String, PluginView>()
    private val viewsMutex = Mutex()
    private val querySlots = Semaphore(maxViews - 1)

    private val contexts = ConcurrentHashMap<String, PluginContext>()
    private val loadedCode = ConcurrentHashMap<String, Int>()
    private val names = ConcurrentHashMap<String, List<String>>()
    private val loadMutexes = ConcurrentHashMap<String, Mutex>()
    private val codeCache = ConcurrentHashMap<String, Triple<Long, String, JsonObject>>()
    private val storage = ConcurrentHashMap<String, String>()
    /** key -> that plugin's own cookie jar (domain -> name -> value), only sent to its own WebView. */
    private val cookieJars = ConcurrentHashMap<String, ConcurrentHashMap<String, MutableMap<String, String>>>()
    private val langByDomain = ConcurrentHashMap<String, String>()
    @Volatile
    private var installed: List<InstalledPlugin> = emptyList()

    /** Spanish reasons of the last query's failing plugins ("Pelispedia: no encontró este título"). */
    @Volatile
    var lastFailures: List<String> = emptyList()
        private set

    private data class PluginContext(val name: String, val allowLan: Boolean, val manifest: JsonObject)

    private class CallError(message: String, val code: String, val userMessage: String = "") : Exception(message)

    /** One plugin's private WebView. Only touched on the main thread except the thread-safe fields. */
    private inner class PluginView(val key: String) {
        /** A random origin per WebView, so plugins never share any same-origin state. */
        val origin = "https://p" + JsPluginSecurity.randomCallId().removePrefix("h_") + ".sandbox.opentv.invalid"
        @Volatile var webView: WebView? = null
        val ready = CompletableDeferred<Boolean>()
        /** Host -> sandbox calls waiting for a reply FROM THIS WebView only. */
        val pending = ConcurrentHashMap<String, CompletableDeferred<JsonObject>>()
        @Volatile var lastUsed = SystemClock.elapsedRealtime()
        @Volatile var destroyed = false
    }

    /** Enabled kino JS plugins that [fetchStreamsForTitle] will query. */
    fun activePlugins(plugins: List<InstalledPlugin>): List<InstalledPlugin> =
        plugins.filter { !it.disabled && it.kind == "kino-js" && it.rawRepoBase.isNotBlank() }

    /**
     * Queries installed kino JS plugins (in parallel) for direct stream sources for a movie/episode.
     * [onPluginDone] fires as each plugin answers (empty list on failure) so callers can rank
     * progressively instead of waiting for the slowest site.
     */
    suspend fun fetchStreamsForTitle(
        item: MediaItem,
        season: Int,
        episode: Int,
        plugins: List<InstalledPlugin>,
        onPluginDone: ((plugin: InstalledPlugin, sources: List<StreamSource>, failure: String?) -> Unit)? = null,
    ): List<StreamSource> {
        installed = plugins
        val jsPlugins = activePlugins(plugins)
        if (jsPlugins.isEmpty()) {
            lastFailures = emptyList()
            return emptyList()
        }
        val failures = java.util.Collections.synchronizedList(mutableListOf<String>())
        val out = coroutineScope {
            jsPlugins.map { plugin ->
                async {
                    var failure: String? = null
                    val found = try {
                        querySlots.withPermit { withView(plugin.id) { querySinglePlugin(plugin, item, season, episode) } }
                    } catch (e: CallError) {
                        failure = JsPluginMatch.failureMessage(plugin.name, e.code, e.message.orEmpty(), e.userMessage)
                        emptyList()
                    } catch (e: kotlinx.coroutines.CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        failure = JsPluginMatch.failureMessage(plugin.name, "error", e.message.orEmpty(), "")
                        emptyList()
                    }
                    failure?.let(failures::add)
                    if (failure != null) Log.w(TAG, "${plugin.name}: $failure")
                    else Log.i(TAG, "${plugin.name}: ${found.size} fuentes directas")
                    onPluginDone?.invoke(plugin, found, failure)
                    found
                }
            }.awaitAll().flatten()
        }
        lastFailures = failures.toList()
        return out
    }

    private suspend fun querySinglePlugin(
        plugin: InstalledPlugin,
        item: MediaItem,
        season: Int,
        episode: Int,
    ): List<StreamSource> {
        val exported = ensureLoaded(plugin.id, plugin.name, plugin.rawRepoBase, plugin.allowLan)
        if ("resolve" !in exported) throw CallError("El plugin no tiene resolve", "not_supported")

        val kind = if (item.isSeries) "series" else "movie"
        val year = item.year.take(4).toIntOrNull() ?: 0
        val original = item.originalTitle.takeIf { it.isNotBlank() && it != item.title }.orEmpty()
        val query = JsPluginMatch.TitleQuery(item.title, original, year, kind)
        val searchArg = buildJsonObject {
            put("q", item.title)
            put("query", item.title)
            put("type", kind)
            put("kind", kind)
            put("year", year)
            put("imdbId", item.imdbId)
            put("originalTitle", original)
            put("altTitles", buildJsonArray { if (original.isNotEmpty()) add(JsonPrimitive(original)) })
            put("season", season)
            put("episode", episode)
            put("tmdbId", 0)
            put("cursor", JsonNull)
        }

        val rows = mutableListOf<JsPluginMatch.StreamRow>()
        var lastError: CallError? = null
        if ("search" in exported) {
            val hitsRaw = callPlugin(plugin.id, "search", searchArg, SEARCH_MS)
            val list = (hitsRaw as? JsonArray ?: (hitsRaw as? JsonObject)?.let { it["items"] as? JsonArray ?: it["results"] as? JsonArray })
                ?.mapNotNull { it as? JsonObject }.orEmpty()
            val hits = JsPluginMatch.pickSearchHits(list, query)
            if (hits.isEmpty()) throw CallError("Sin coincidencias", "not_found")
            for (hit in hits) {
                try {
                    var ref = hit.ref
                    if (hit.verify && !item.isSeries) {
                        val meta = if ("details" in exported) runCatching { callPlugin(plugin.id, "details", JsonPrimitive(hit.ref), SEARCH_MS) }.getOrNull() else null
                        if (!JsPluginMatch.confirmsYear(meta, query)) {
                            lastError = CallError("Sin coincidencias", "not_found")
                            continue
                        }
                    }
                    if (item.isSeries && season > 0) {
                        if ("episodes" !in exported) break
                        val epRes = callPlugin(plugin.id, "episodes", JsonPrimitive(hit.ref), EPISODES_MS)
                        if (hit.verify && !JsPluginMatch.confirmsYear((epRes as? JsonObject)?.get("series"), query)) {
                            lastError = CallError("Sin coincidencias", "not_found")
                            continue
                        }
                        ref = JsPluginMatch.pickEpisodeRef(JsPluginMatch.flattenEpisodes(epRes), season, episode.coerceAtLeast(1))
                        if (ref.isEmpty()) {
                            lastError = CallError("Episodio no encontrado", "not_found")
                            continue
                        }
                    }
                    rows += JsPluginMatch.streamsFromResolve(callPlugin(plugin.id, "resolve", JsonPrimitive(ref), RESOLVE_MS))
                    if (rows.isNotEmpty()) break
                } catch (e: CallError) {
                    lastError = e
                }
            }
        } else {
            rows += JsPluginMatch.streamsFromResolve(callPlugin(plugin.id, "resolve", JsonPrimitive(item.title), RESOLVE_MS))
        }
        if (rows.isEmpty()) throw lastError ?: CallError("Sin fuentes", "not_found")

        return rows.mapIndexed { idx, s ->
            StreamSource(
                id = "${plugin.id}_js_$idx",
                addonId = plugin.id,
                addonName = plugin.name,
                name = plugin.name,
                // The ranker reads language/quality from these words ("Latino · fastream", "1080p").
                title = listOf(
                    s.label,
                    JsPluginMatch.langWord(s.lang).takeIf { w -> w.isNotEmpty() && !s.label.contains(w, ignoreCase = true) }.orEmpty(),
                    s.quality.takeIf { it != "auto" }.orEmpty(),
                ).filter { it.isNotEmpty() }.joinToString(" · "),
                url = s.url,
                filename = if (s.mime.contains("mp4", ignoreCase = true)) "stream.mp4" else "",
                headers = JsPluginMatch.withRequestLanguage(s.headers, s.url, langByDomain),
                isJsPlugin = true,
            )
        }
    }

    // ------------------------------------------------------------------ loading

    private suspend fun pluginFetch(params: JsonObject): JsonObject = RustServiceBridge.callRpc("pluginFetch", params)

    private suspend fun getSource(base: String, allowLan: Boolean): Pair<String, JsonObject> {
        codeCache[base]?.let { (at, code, manifest) ->
            if (SystemClock.elapsedRealtime() - at < CODE_TTL_MS) return code to manifest
        }
        suspend fun text(url: String): String {
            val res = pluginFetch(buildJsonObject {
                put("url", url)
                put("method", "GET")
                put("timeoutMs", 10_000)
                put("allowLan", allowLan)
            })
            val ok = (res["ok"] as? JsonPrimitive)?.contentOrNull == "true"
            val body = JsPluginMatch.str(res["text"])
            if (!ok || body.isEmpty()) throw CallError("No se pudo descargar $url", "unavailable")
            return body
        }
        val manifest = runCatching { json.parseToJsonElement(text("$base/kino-plugin.json")).jsonObject }.getOrDefault(JsonObject(emptyMap()))
        val entry = JsPluginMatch.str(manifest["entry"]).takeIf { Regex("^[A-Za-z0-9_./-]{1,80}\\.js$").matches(it) && ".." !in it } ?: "plugin.js"
        val code = text("$base/$entry")
        if (code.length > MAX_PLUGIN_CODE_CHARS) throw CallError("El plugin es demasiado grande", "too_large")
        codeCache[base] = Triple(SystemClock.elapsedRealtime(), code, manifest)
        return code to manifest
    }

    private fun configDefaults(manifest: JsonObject): JsonObject = buildJsonObject {
        (manifest["settings"] as? JsonArray)?.forEach { s ->
            val o = s as? JsonObject ?: return@forEach
            val key = JsPluginMatch.str(o["key"])
            val def = o["default"] as? JsonPrimitive
            if (key.isNotEmpty() && def != null) put(key, def)
        }
    }

    private fun storageFor(key: String): JsonObject = buildJsonObject {
        val prefix = "$key::"
        storage.forEach { (k, v) -> if (k.startsWith(prefix)) put(k.removePrefix(prefix), v) }
    }

    private fun jarOf(key: String): ConcurrentHashMap<String, MutableMap<String, String>> =
        cookieJars.getOrPut(key) { ConcurrentHashMap() }

    /** Loads a plugin into its own WebView once; a code change starts a fresh WebView. Call inside [withView]. */
    private suspend fun ensureLoaded(key: String, name: String, base: String, allowLan: Boolean): List<String> {
        val (code, manifest) = getSource(base, allowLan)
        contexts[key] = PluginContext(name, allowLan, manifest)
        loadMutexes.getOrPut(key) { Mutex() }.withLock {
            var view = viewFor(key)
            if (loadedCode[key] != code.hashCode()) {
                if (loadedCode.containsKey(key)) {
                    destroyView(view)
                    view = viewFor(key)
                }
                if (!awaitReady(view)) throw CallError("No se pudo iniciar el entorno aislado", "unavailable")
                val reply = request(
                    view,
                    buildJsonObject {
                        put("kind", "load")
                        put("key", key)
                        put("code", code)
                        put("setup", buildJsonObject {
                            put("storage", storageFor(key))
                            put("config", configDefaults(manifest))
                            put("appVersion", "2.0.0")
                        })
                        put("jar", jarJson(key))
                    },
                    LOAD_MS,
                )
                loadedCode[key] = code.hashCode()
                names[key] = ((reply as? JsonObject)?.get("names") as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()
            }
        }
        return names[key].orEmpty()
    }

    private suspend fun callPlugin(key: String, fn: String, arg: JsonElement, timeoutMs: Long): JsonElement? {
        val view = views[key]?.takeIf { !it.destroyed } ?: throw CallError("Plugin no cargado", "unavailable")
        return request(
            view,
            buildJsonObject {
                put("kind", "call")
                put("key", key)
                put("fn", fn)
                put("args", JsonArray(listOf(arg)))
            },
            timeoutMs,
        )
    }

    /** Host -> one sandbox request; resolves only with a `kind:'reply'` from THAT WebView. */
    private suspend fun request(view: PluginView, msg: JsonObject, timeoutMs: Long): JsonElement? {
        val id = JsPluginSecurity.randomCallId()
        val deferred = CompletableDeferred<JsonObject>()
        view.pending[id] = deferred
        post(view, JsonObject(msg + ("id" to JsonPrimitive(id))))
        val reply = try {
            withTimeoutOrNull(timeoutMs) { deferred.await() }
        } finally {
            view.pending.remove(id)
        }
        if (reply == null) throw CallError("Timeout del plugin JS", "timeout")
        val error = JsPluginMatch.str(reply["error"])
        if (error.isNotEmpty()) {
            throw CallError(error, JsPluginMatch.str(reply["code"]).ifEmpty { "error" }, JsPluginMatch.str(reply["userMessage"]))
        }
        return reply["value"]
    }

    /** Sends one tagged message into a plugin's own WebView (`window.postMessage` via the bridge). */
    private fun post(view: PluginView, msg: JsonObject) {
        val tagged = JsonObject(msg + ("opentvPlugin" to JsonPrimitive(1)))
        // U+2028/2029 are line terminators inside string literals on old WebViews.
        val literal = JsonPrimitive(tagged.toString()).toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
        mainHandler.post {
            if (!view.destroyed) view.webView?.evaluateJavascript("window.__opentvDeliver && window.__opentvDeliver($literal);", null)
        }
    }

    private fun jarJson(key: String): JsonObject = buildJsonObject {
        jarOf(key).forEach { (dom, map) -> put(dom, buildJsonObject { map.forEach { (k, v) -> put(k, v) } }) }
    }

    private fun answer(view: PluginView, id: Long, value: JsonElement?, error: String? = null, code: String? = null, userMessage: String? = null) {
        post(view, buildJsonObject {
            put("kind", "answer")
            put("id", id)
            put("value", value ?: JsonNull)
            if (error != null) put("error", error)
            if (code != null) put("code", code)
            if (!userMessage.isNullOrEmpty()) put("userMessage", userMessage)
            put("jar", jarJson(view.key))
        })
    }

    // ------------------------------------------------------------------ sandbox -> host

    /** The plugin identity is the WebView the message came from; `msg.key` is never read. */
    private fun onSandboxMessage(view: PluginView, raw: String) {
        if (view.destroyed) return
        val msg = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return
        if (JsPluginMatch.str(msg["opentvPlugin"]) != "1") return
        when (JsPluginMatch.str(msg["kind"])) {
            "ready" -> view.ready.complete(true)
            "reply" -> view.pending.remove(JsPluginMatch.str(msg["id"]))?.complete(msg)
            "ask" -> {
                val id = JsPluginMatch.str(msg["id"]).toLongOrNull() ?: return
                scope.launch {
                    handleAsk(view, id, JsPluginMatch.str(msg["op"]), msg["args"] as? JsonObject ?: JsonObject(emptyMap()))
                }
            }
        }
    }

    private suspend fun handleAsk(view: PluginView, id: Long, op: String, args: JsonObject) {
        val key = view.key
        // `allowLan` is never taken from plugin JS: it comes from the host's own registration.
        val allowLan = contexts[key]?.allowLan ?: false
        try {
            when (op) {
                "fetch" -> {
                    val jar = jarOf(key)
                    val o = args["opts"] as? JsonObject ?: JsonObject(emptyMap())
                    val url = JsPluginMatch.str(args["url"])
                    val headers = LinkedHashMap(JsPluginMatch.sanitizeHeaders(o["headers"]))
                    if (headers.keys.none { it.equals("cookie", ignoreCase = true) }) {
                        JsPluginMatch.cookieHeaderFor(jar, url).takeIf { it.isNotEmpty() }?.let { headers["Cookie"] = it }
                    }
                    headers.entries.firstOrNull { it.key.equals("accept-language", ignoreCase = true) }?.let {
                        if (langByDomain.size > 200) langByDomain.clear()
                        langByDomain[JsPluginMatch.baseDomain(url)] = it.value
                    }
                    var body: String? = (o["body"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                    (o["bodyJson"])?.takeIf { it !is JsonNull }?.let {
                        body = it.toString()
                        if (headers.keys.none { k -> k.equals("content-type", ignoreCase = true) }) headers["Content-Type"] = "application/json"
                    }
                    (o["bodyForm"] as? JsonObject)?.let { form ->
                        body = form.entries.joinToString("&") { (k, v) ->
                            java.net.URLEncoder.encode(k, "UTF-8") + "=" + java.net.URLEncoder.encode(JsPluginMatch.str(v).ifEmpty { v.toString() }, "UTF-8")
                        }
                        headers["Content-Type"] = "application/x-www-form-urlencoded"
                    }
                    val params = buildJsonObject {
                        put("url", url)
                        put("method", JsPluginMatch.str(o["method"]).ifEmpty { "GET" })
                        put("headers", buildJsonObject { headers.forEach { (k, v) -> put(k, v) } })
                        put("timeoutMs", JsPluginMatch.str(o["timeoutMs"]).toDoubleOrNull()?.toLong() ?: 12_000L)
                        put("allowLan", allowLan)
                        JsPluginMatch.str(o["redirect"]).takeIf { it.isNotEmpty() }?.let { put("redirect", it) }
                        JsPluginMatch.str(o["maxBytes"]).toDoubleOrNull()?.toLong()?.takeIf { it > 0 }?.let { put("maxBytes", it) }
                        body?.let { put("body", it) }
                        (o["bodyBase64"] as? JsonPrimitive)?.takeIf { it.isString }?.let { put("bodyBase64", it.content) }
                    }
                    val started = SystemClock.elapsedRealtime()
                    val res = pluginFetch(params)
                    val b64 = JsPluginMatch.str(res["base64"])
                    PlaybackProfile.recordThroughput(b64.length * 3L / 4L, SystemClock.elapsedRealtime() - started)
                    val setCookies = (res["setCookies"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()
                    if (setCookies.isNotEmpty()) {
                        val tmp = HashMap<String, MutableMap<String, String>>()
                        JsPluginMatch.absorbCookies(tmp, setCookies, JsPluginMatch.str(res["url"]).ifEmpty { url })
                        tmp.forEach { (d, m) -> jar.getOrPut(d) { ConcurrentHashMap() }.putAll(m) }
                    }
                    answer(view, id, res)
                }
                "pluginCall" -> answer(view, id, callDoor(key, JsPluginMatch.str(args["door"]), JsPluginMatch.str(args["fn"]), args["args"]))
                "storageSet" -> {
                    val k = "$key::${JsPluginMatch.str(args["k"]).take(128)}"
                    val v = JsPluginMatch.str(args["v"])
                    if (v.length <= MAX_STORAGE_VALUE) {
                        if (storage.size >= MAX_STORAGE_ENTRIES && !storage.containsKey(k)) storage.keys.firstOrNull()?.let { old -> storage.remove(old) }
                        storage[k] = v
                        answer(view, id, JsonPrimitive(true))
                    } else {
                        answer(view, id, JsonPrimitive(false))
                    }
                }
                "storageRemove" -> {
                    storage.remove("$key::${JsPluginMatch.str(args["k"]).take(128)}")
                    answer(view, id, JsonPrimitive(true))
                }
                "cookiesClear" -> {
                    val domain = JsPluginMatch.str(args["domain"]).lowercase().trimStart('.')
                    if (domain.isEmpty()) jarOf(key).clear() else jarOf(key).remove(domain)
                    answer(view, id, JsonPrimitive(true))
                }
                // No hidden browser on TV: plugins fall back to plain fetch extraction.
                "browser" -> answer(view, id, buildJsonObject {
                    put("ok", false)
                    put("error", "Navegador oculto no disponible en este aparato")
                })
                // TMDB is not exposed to plugins on Android ("tmdb" falls here).
                else -> answer(view, id, null, "Operación no soportada: $op", "unsupported")
            }
        } catch (e: CallError) {
            answer(view, id, null, e.message ?: "Error", e.code, e.userMessage)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            answer(view, id, null, e.message ?: e.toString(), "rpc")
        }
    }

    /**
     * Runs `proto_<door>_<fn>` of the plugin that provides `door` for the caller, in the
     * provider's OWN WebView, never with allowLan, passing only plain JSON data.
     */
    private suspend fun callDoor(callerKey: String, door: String, fn: String, args: JsonElement?): JsonElement? {
        val idRe = Regex("^[A-Za-z0-9]{1,32}$")
        if (!idRe.matches(door) || !idRe.matches(fn)) throw CallError("Puerta no válida", "provider_missing")
        val caller = contexts[callerKey] ?: throw CallError("Plugin desconocido", "provider_missing")
        val input = args?.takeIf { it !is JsonNull } ?: JsonObject(emptyMap())
        if (input.toString().length > MAX_DOOR_ARGS_CHARS) throw CallError("Datos demasiado grandes para el plugin auxiliar", "too_large")
        fun provides(manifest: JsonObject): JsonObject? =
            ((manifest["provides"] as? JsonObject)?.get(door) as? JsonObject)?.get("calls") as? JsonObject

        // 1. An installed plugin whose manifest provides the door (separate helper instance, no LAN).
        var providerKey = ""
        var providerBase = ""
        var providerName = ""
        for (p in installed) {
            if (p.disabled || p.kind != "kino-js" || p.rawRepoBase.isBlank() || p.id == callerKey) continue
            val ok = runCatching { provides(getSource(p.rawRepoBase, false).second) != null }.getOrDefault(false)
            if (ok) {
                providerKey = "${DOOR_KEY_PREFIX}installed:${p.id}"
                providerBase = p.rawRepoBase
                providerName = p.name
                break
            }
        }
        // 2. An APPROVED helper repo the caller declares in `consumes.<door>.repo`.
        if (providerKey.isEmpty()) {
            val helper = try {
                JsPluginSecurity.helperFromConsumes((caller.manifest["consumes"] as? JsonObject)?.get(door) as? JsonObject)
            } catch (e: JsPluginSecurity.HelperRejectedException) {
                throw CallError(e.message.orEmpty(), "provider_missing", e.userMessage)
            } ?: throw CallError("Sin proveedor para $door", "provider_missing")
            val (code, manifest) = getSource(helper.base, false)
            if (helper.sha256 != null && JsPluginSecurity.sha256Hex(code) != helper.sha256) {
                codeCache.remove(helper.base)
                throw CallError(
                    "El plugin auxiliar ${helper.repo} no coincide con la versión fijada",
                    "provider_missing",
                    "El plugin auxiliar ${helper.repo} cambió y no coincide con la versión verificada",
                )
            }
            if (provides(manifest) == null) throw CallError("Sin proveedor para $door", "provider_missing")
            providerKey = "$DOOR_KEY_PREFIX${helper.repo}@${helper.sha256 ?: helper.base}"
            providerBase = helper.base
            providerName = JsPluginMatch.str(manifest["name"]).ifEmpty { helper.repo }
        }
        return withView(providerKey) {
            ensureLoaded(providerKey, providerName, providerBase, false)
            val calls = contexts[providerKey]?.manifest?.let(::provides)
            if (calls == null || fn !in calls) throw CallError("La puerta $door no tiene $fn", "not_supported")
            callPlugin(providerKey, "proto_${door}_$fn", input, DOOR_MS)
        }
    }

    // ------------------------------------------------------------------ WebViews

    private val busy = ConcurrentHashMap<String, AtomicInteger>()
    private val idleJobs = ConcurrentHashMap<String, Job>()

    private fun isIdle(key: String) = (busy[key]?.get() ?: 0) == 0

    /** Marks [key]'s WebView in use for [block] so it is not evicted; schedules its idle cleanup after. */
    private suspend fun <T> withView(key: String, block: suspend () -> T): T {
        val counter = busy.getOrPut(key) { AtomicInteger(0) }
        counter.incrementAndGet()
        idleJobs.remove(key)?.cancel()
        try {
            return block()
        } finally {
            counter.decrementAndGet()
            scheduleIdleCleanup(key)
        }
    }

    /** The live WebView of [key], created lazily (evicting idle LRU ones beyond [maxViews]). */
    private suspend fun viewFor(key: String): PluginView = viewsMutex.withLock {
        views[key]?.takeIf { !it.destroyed }?.let {
            it.lastUsed = SystemClock.elapsedRealtime()
            return@withLock it
        }
        while (views.size >= maxViews) {
            val victim = views.values.filter { it.key != key && isIdle(it.key) }.minByOrNull { it.lastUsed } ?: break
            destroyView(victim)
        }
        val view = PluginView(key)
        views[key] = view
        withContext(Dispatchers.Main) { view.webView = createWebView(view) }
        view
    }

    private suspend fun awaitReady(view: PluginView): Boolean =
        withTimeoutOrNull(8_000L) { view.ready.await() } ?: false

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(view: PluginView): WebView {
        val wv = WebView(appContext)
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = false
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_NO_CACHE
        }
        // Bound to THIS plugin's view: whatever the page sends is attributed to view.key.
        wv.addJavascriptInterface(HostBridge(view), "__opentvHost")
        val origin = view.origin
        wv.webViewClient = object : WebViewClient() {
            // A plugin must not navigate the sandbox page away.
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean = true

            // Only the bootstrap page and its two scripts come from the APK; EVERY
            // other request (plugin XHR/fetch/img/iframe) gets a 403.
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse {
                val url = request?.url?.toString().orEmpty()
                return when (url) {
                    "$origin/sandbox.html" -> textResponse("text/html", SANDBOX_HTML)
                    "$origin/js/android-bridge.js" -> textResponse("text/javascript", BRIDGE_JS)
                    "$origin/js/plugin-runtime.js" -> runCatching {
                        WebResourceResponse("text/javascript", "utf-8", appContext.assets.open("js/plugin-runtime.js"))
                    }.getOrElse { blocked() }
                    else -> blocked()
                }
            }
        }
        wv.loadUrl("$origin/sandbox.html")
        return wv
    }

    private fun textResponse(mime: String, body: String) =
        WebResourceResponse(mime, "utf-8", 200, "OK", mapOf("Content-Security-Policy" to CSP), ByteArrayInputStream(body.toByteArray()))

    private fun blocked() =
        WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))

    private fun scheduleIdleCleanup(key: String) {
        idleJobs.remove(key)?.cancel()
        idleJobs[key] = scope.launch {
            delay(idleMs)
            viewsMutex.withLock {
                if (isIdle(key)) views[key]?.let(::destroyView)
            }
        }
    }

    /** Forgets [view] (its realm and loaded code) and destroys its WebView on the main thread. */
    private fun destroyView(view: PluginView) {
        view.destroyed = true
        views.remove(view.key, view)
        loadedCode.remove(view.key)
        names.remove(view.key)
        val gone = buildJsonObject {
            put("error", "Plugin descargado")
            put("code", "unavailable")
        }
        view.pending.values.forEach { it.complete(gone) }
        view.pending.clear()
        mainHandler.post {
            runCatching {
                view.webView?.stopLoading()
                view.webView?.removeJavascriptInterface("__opentvHost")
                view.webView?.destroy()
            }
            view.webView = null
        }
    }

    /** Destroys every plugin WebView (low memory / app shutdown). */
    fun destroy() {
        idleJobs.values.forEach { it.cancel() }
        idleJobs.clear()
        views.values.toList().forEach(::destroyView)
    }

    private inner class HostBridge(private val view: PluginView) {
        /** Sandbox -> host messages (`ready`, `ask`, `reply`), forwarded by android-bridge.js. */
        @JavascriptInterface
        fun post(message: String) {
            if (message.length <= MAX_MESSAGE_CHARS) onSandboxMessage(view, message)
        }
    }

    private companion object {
        const val TAG = "OpenTV-JsPlugins"
        /** Sandbox keys of helper instances; never collides with an installed plugin id. */
        const val DOOR_KEY_PREFIX = "door\u0000"
        const val CSP = "default-src 'none'; script-src 'self' 'unsafe-eval'; base-uri 'none'; form-action 'none'"
        const val LOAD_MS = 15_000L
        const val SEARCH_MS = 18_000L
        const val EPISODES_MS = 25_000L
        const val RESOLVE_MS = 65_000L
        const val DOOR_MS = 50_000L
        const val CODE_TTL_MS = 30 * 60_000L
        const val MAX_PLUGIN_CODE_CHARS = 512 * 1024
        const val MAX_STORAGE_ENTRIES = 300
        const val MAX_STORAGE_VALUE = 64 * 1024
        const val MAX_MESSAGE_CHARS = 4 * 1024 * 1024
        const val MAX_DOOR_ARGS_CHARS = 1024 * 1024

        val SANDBOX_HTML = """
            <!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
            <meta http-equiv="Content-Security-Policy" content="$CSP">
            <title>OpenTV plugins</title></head><body>
            <script src="js/android-bridge.js"></script>
            <script src="js/plugin-runtime.js"></script>
            </body></html>
        """.trimIndent()

        /**
         * The runtime talks to `window.parent`, which is this same top-level window
         * here: forward its outgoing messages to Kotlin and let Kotlin post in. The
         * `__opentvHost` object is bound to this WebView's plugin only.
         */
        val BRIDGE_JS = """
            (function () {
              var h = window.__opentvHost;
              window.addEventListener('message', function (ev) {
                var d = ev.data;
                if (!d || d.opentvPlugin !== 1) { return; }
                if (d.kind === 'ready' || d.kind === 'ask' || d.kind === 'reply') {
                  try { h.post(JSON.stringify(d)); } catch (e) {}
                }
              });
              window.__opentvDeliver = function (raw) {
                try { window.postMessage(JSON.parse(raw), '*'); } catch (e) {}
              };
            })();
        """.trimIndent()
    }
}
