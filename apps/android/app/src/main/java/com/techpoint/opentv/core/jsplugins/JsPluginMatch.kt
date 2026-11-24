package com.techpoint.opentv.core.jsplugins

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.text.Normalizer
import java.util.Locale
import kotlin.math.abs

/**
 * Pure helpers of the JS plugin host, 1:1 with the PC `services/jsPluginMatch.ts`:
 * which search hit is the opened title, how a Kino `resolve()` answer becomes
 * stream rows, the cookie jar, and the Spanish failure message.
 */
object JsPluginMatch {

    data class TitleQuery(val title: String, val originalTitle: String = "", val year: Int = 0, val kind: String)
    data class Hit(val ref: String, val score: Double, val title: String, val verify: Boolean)
    data class StreamRow(
        val url: String,
        val label: String,
        val quality: String,
        val mime: String,
        val headers: Map<String, String>,
        /** Audio language as the plugin reports it ("Latino", "es-MX", "Castellano"...), may be empty. */
        val lang: String = "",
    )

    private val HeaderName = Regex("^[A-Za-z0-9-]+$")

    fun str(el: JsonElement?): String = (el as? JsonPrimitive)?.contentOrNull.orEmpty()

    fun sanitizeHeaders(raw: JsonElement?): Map<String, String> {
        val pairs: List<Pair<String, String?>> = when (raw) {
            is JsonObject -> raw.entries.map { (k, v) -> k to (v as? JsonPrimitive)?.takeIf { it.isString }?.content }
            is JsonArray -> raw.mapNotNull { h -> (h as? JsonObject)?.let { str(it["name"]) to (it["value"] as? JsonPrimitive)?.contentOrNull } }
            else -> emptyList()
        }
        val out = LinkedHashMap<String, String>()
        for ((k, v) in pairs) {
            if (out.size >= 16) break
            if (!HeaderName.matches(k) || v == null || v.length > 2048 || v.any { it == '\r' || it == '\n' || it == '\u0000' }) continue
            out[k] = v
        }
        return out
    }

    fun hostOf(url: String): String =
        Regex("""^https?://([^/:?#]+)""", RegexOption.IGNORE_CASE).find(url)?.groupValues?.get(1)?.lowercase(Locale.ROOT).orEmpty()

    fun baseDomain(urlOrHost: String): String {
        val host = if (urlOrHost.startsWith("http", ignoreCase = true)) hostOf(urlOrHost) else urlOrHost.lowercase(Locale.ROOT)
        return host.split('.').takeLast(2).joinToString(".")
    }

    /** Stores `Set-Cookie` values per domain; host-only cookies use the response host. */
    fun absorbCookies(jar: MutableMap<String, MutableMap<String, String>>, setCookies: List<String>, responseUrl: String) {
        val fallback = hostOf(responseUrl)
        for (raw in setCookies) {
            val pair = raw.substringBefore(';')
            val eq = pair.indexOf('=')
            if (eq <= 0) continue
            val name = pair.substring(0, eq).trim()
            val value = pair.substring(eq + 1).trim()
            val domain = (Regex("""(?:^|;)\s*domain=([^;]+)""", RegexOption.IGNORE_CASE).find(raw)?.groupValues?.get(1) ?: fallback)
                .trim().lowercase(Locale.ROOT).trimStart('.')
            if (name.isEmpty() || domain.isEmpty() || value.any { it == '\r' || it == '\n' || it == ';' }) continue
            jar.getOrPut(domain) { LinkedHashMap() }[name] = value
        }
    }

    fun cookieHeaderFor(jar: Map<String, Map<String, String>>, url: String): String {
        val host = hostOf(url)
        if (host.isEmpty()) return ""
        val merged = LinkedHashMap<String, String>()
        for ((dom, map) in jar) if (host == dom || host.endsWith(".$dom")) merged.putAll(map)
        return merged.entries.joinToString("; ") { "${it.key}=${it.value}" }.take(2048)
    }

    /** Replays the `Accept-Language` the plugin used on the stream's domain (fastream binds tokens to it). */
    fun withRequestLanguage(headers: Map<String, String>, url: String, langByDomain: Map<String, String>): Map<String, String> {
        if (headers.keys.any { it.equals("accept-language", ignoreCase = true) }) return headers
        val referer = headers.entries.firstOrNull { it.key.equals("referer", ignoreCase = true) }?.value.orEmpty()
        val lang = langByDomain[baseDomain(url)] ?: referer.takeIf { it.isNotEmpty() }?.let { langByDomain[baseDomain(it)] }
        return if (lang != null) headers + ("Accept-Language" to lang) else headers
    }

    fun normTitle(s: String): String =
        Normalizer.normalize(s, Normalizer.Form.NFD)
            .replace(Regex("\\p{Mn}+"), "")
            .lowercase(Locale.ROOT)
            .replace("&", " and ")
            .replace(Regex("[^a-z0-9]+"), " ")
            .trim()

    fun titleSimilarity(a: String, b: String): Double {
        val na = normTitle(a)
        val nb = normTitle(b)
        if (na.isEmpty() || nb.isEmpty()) return 0.0
        if (na == nb) return 1.0
        val ta = na.split(' ').toSet()
        val tb = nb.split(' ').toSet()
        val inter = ta.count { it in tb }
        val jaccard = inter.toDouble() / (ta.size + tb.size - inter)
        val contains = if (" $na ".contains(" $nb ") || " $nb ".contains(" $na ")) 0.25 else 0.0
        return minOf(0.99, jaccard + contains)
    }

    private fun hitKind(hit: JsonObject): String = when (str(hit["kind"]).ifEmpty { str(hit["type"]) }.lowercase(Locale.ROOT)) {
        "movie", "film", "pelicula" -> "movie"
        "series", "tv", "show", "anime", "serie" -> "series"
        else -> ""
    }

    private fun yearOf(el: JsonElement?): Int = str(el).take(4).toIntOrNull() ?: 0

    /** Same rules as the PC: close title, or the site's first same-year hit; yearless first hit needs `details()`. */
    fun pickSearchHits(hits: List<JsonObject>, q: TitleQuery, max: Int = 2): List<Hit> {
        val names = listOf(q.title, q.originalTitle).filter { it.isNotBlank() }
        val out = mutableListOf<Hit>()
        hits.forEachIndexed { index, hit ->
            val ref = listOf("ref", "id", "imdb_id", "imdbId").map { str(hit[it]).trim() }.firstOrNull { it.isNotEmpty() } ?: return@forEachIndexed
            val kind = hitKind(hit)
            if (kind.isNotEmpty() && kind != q.kind) return@forEachIndexed
            val title = str(hit["title"]).ifEmpty { str(hit["name"]) }
            val sim = names.maxOfOrNull { titleSimilarity(it, title) } ?: 0.0
            val year = yearOf(hit["year"]).takeIf { it > 0 } ?: yearOf(hit["releaseYear"])
            val yearKnown = year > 0 && q.year > 0
            val yearDiff = if (yearKnown) abs(year - q.year) else 0
            if (yearKnown && q.kind == "movie" && yearDiff > 1) return@forEachIndexed
            val sameYear = yearKnown && yearDiff == 0
            val accepted = sim >= 0.6 || (index == 0 && sameYear) || (index < 3 && sameYear && sim >= 0.34)
            val verify = !accepted && year == 0 && q.year > 0 && index == 0
            if (!accepted && !verify) return@forEachIndexed
            val score = if (verify) 0.2 else sim + (if (sameYear) 0.3 else if (yearKnown && yearDiff <= 1) 0.1 else 0.0) - index * 0.02
            out.add(Hit(ref, score, title, verify))
        }
        return out.sortedByDescending { it.score }.take(max)
    }

    fun confirmsYear(meta: JsonElement?, q: TitleQuery): Boolean {
        val year = yearOf((meta as? JsonObject)?.get("year"))
        if (year == 0 || q.year == 0) return false
        return abs(year - q.year) <= if (q.kind == "series") 1 else 0
    }

    /** Flattens an episodes answer (list, `{episodes}`, `{seasons:[{episodes}]}`). */
    fun flattenEpisodes(value: JsonElement?): List<JsonObject> {
        when (value) {
            is JsonArray -> {
                val out = mutableListOf<JsonObject>()
                for (item in value) {
                    val rec = item as? JsonObject ?: continue
                    val eps = rec["episodes"] as? JsonArray
                    if (eps != null) {
                        val season = str(rec["season"]).ifEmpty { str(rec["number"]) }.toIntOrNull() ?: 1
                        eps.forEach { ep -> (ep as? JsonObject)?.let { out.add(JsonObject(mapOf("season" to JsonPrimitive(season)) + it)) } }
                    } else {
                        out.add(rec)
                    }
                }
                return out
            }
            is JsonObject -> {
                for (key in listOf("episodes", "items", "results", "seasons")) {
                    (value[key] as? JsonArray)?.let { return flattenEpisodes(it) }
                }
            }
            else -> Unit
        }
        return emptyList()
    }

    fun pickEpisodeRef(eps: List<JsonObject>, season: Int, episode: Int): String {
        for (ep in eps) {
            val s = str(ep["season"]).ifEmpty { str(ep["s"]) }.toIntOrNull() ?: 1
            val e = listOf("number", "episode", "e").map { str(ep[it]) }.firstOrNull { it.isNotEmpty() }?.toIntOrNull() ?: 0
            if (s == season && e == episode) return str(ep["ref"]).ifEmpty { str(ep["id"]) }.trim()
        }
        return ""
    }

    /** One stream object with `alternatives`, `{streams|sources}` or a list -> rows with a real URL. */
    fun streamsFromResolve(value: JsonElement?): List<StreamRow> {
        val out = mutableListOf<StreamRow>()
        val seen = HashSet<String>()
        fun visit(v: JsonElement?, inherited: Map<String, String>) {
            when (v) {
                is JsonArray -> v.forEach { visit(it, inherited) }
                is JsonObject -> {
                    val url = str(v["url"]).trim()
                    var next = inherited
                    if (Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(url) && url.length <= 4096) {
                        val headers = LinkedHashMap(inherited).apply { putAll(sanitizeHeaders(v["headers"])) }
                        val referer = str(v["referer"])
                        if (referer.isNotEmpty() && "Referer" !in headers) headers["Referer"] = referer
                        if (seen.add(url)) {
                            out.add(
                                StreamRow(
                                    url = url,
                                    label = listOf("label", "title", "name", "server").map { str(v[it]) }.firstOrNull { it.isNotEmpty() }.orEmpty().take(120),
                                    quality = str(v["quality"]).take(20),
                                    mime = str(v["mime"]).ifEmpty { str(v["type"]) }.take(60),
                                    headers = headers,
                                    lang = listOf("lang", "language", "audio", "idioma").map { str(v[it]) }.firstOrNull { it.isNotEmpty() }.orEmpty().take(40),
                                ),
                            )
                        }
                        next = headers
                    }
                    for (key in listOf("streams", "sources", "alternatives")) (v[key] as? JsonArray)?.let { visit(it, next) }
                }
                else -> Unit
            }
        }
        visit(value, emptyMap())
        return out.take(24)
    }

    /**
     * Maps a plugin's language field to the word the ranker detects ("es-MX" → "Latino",
     * "es-ES" → "Castellano", "en" → "English"). Unknown values pass through unchanged.
     */
    fun langWord(raw: String): String {
        val v = raw.trim().lowercase()
        if (v.isEmpty()) return ""
        return when {
            v.startsWith("es-es") || v.contains("castellano") || v == "cast" -> "Castellano"
            v.startsWith("es-") || v.contains("latino") || v == "lat" || v == "la" -> "Latino"
            v == "es" || v == "spa" || v.contains("español") || v.contains("espanol") || v.contains("spanish") -> "Español"
            v == "en" || v.startsWith("en-") || v == "eng" || v.contains("english") || v.contains("ingl") -> "English"
            v.contains("sub") -> "Subtitulado"
            else -> raw.trim()
        }
    }

    fun failureMessage(pluginName: String, code: String, message: String, userMessage: String): String {
        val reason = when {
            userMessage.isNotBlank() -> userMessage.trim()
            code == "timeout" || Regex("timeout|tiempo agotado", RegexOption.IGNORE_CASE).containsMatchIn(message) -> "tardó demasiado en responder"
            code == "not_found" -> "no encontró este título"
            code == "host_not_allowed" -> "intentó conectarse a una dirección no permitida"
            code == "provider_missing" -> "necesita otro plugin que no está disponible"
            Regex("compilar|SyntaxError", RegexOption.IGNORE_CASE).containsMatchIn(message) -> "este aparato no pudo ejecutar su código (actualiza Android System WebView)"
            code == "unavailable" -> "su sitio no está disponible ahora"
            else -> "no devolvió fuentes"
        }
        return "$pluginName: ${reason.removeSuffix(".")}".take(220)
    }
}
