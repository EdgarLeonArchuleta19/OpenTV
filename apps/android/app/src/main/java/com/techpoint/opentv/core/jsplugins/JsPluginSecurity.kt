package com.techpoint.opentv.core.jsplugins

import kotlinx.serialization.json.JsonObject
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Host-side security rules for third-party JS plugins (pure, JUnit tested).
 * Mirrors `apps/desktop/frontend/src/services/jsPluginSecurity.ts`.
 */
object JsPluginSecurity {
    /**
     * Helper plugins ("doors", `consumes.<door>.repo`) a plugin may pull in without the
     * user installing them. Anything else fails with a clear message.
     */
    val APPROVED_HELPER_REPOS: Set<String> = setOf("xuper-plugin/kino-plugin-kino-resolver")

    private val REPO_RE = Regex("^[A-Za-z0-9_.-]{1,64}/[A-Za-z0-9_.-]{1,100}$")
    private val COMMIT_RE = Regex("^[0-9a-fA-F]{7,40}$")
    private val SHA256_RE = Regex("^(?:sha256[:-])?([0-9a-fA-F]{64})$", RegexOption.IGNORE_CASE)
    private val random = SecureRandom()

    /** [repo] lower-cased; [base] pinned to [commit] when declared; [sha256] lower-case hex or null. */
    data class HelperSpec(val repo: String, val base: String, val sha256: String?)

    class HelperRejectedException(repo: String) : Exception("Plugin auxiliar no verificado: $repo") {
        val userMessage = "Este plugin necesita un plugin auxiliar no verificado: $repo"
    }

    /**
     * Validates a caller's `consumes.<door>` entry. Returns null when no valid repo is
     * declared; throws [HelperRejectedException] when the repo is not approved.
     */
    fun helperFromConsumes(want: JsonObject?): HelperSpec? {
        val raw = JsPluginMatch.str(want?.get("repo")).trim()
        if (!REPO_RE.matches(raw)) return null
        val repo = raw.lowercase()
        if (repo !in APPROVED_HELPER_REPOS) throw HelperRejectedException(raw)
        val commit = JsPluginMatch.str(want?.get("commit")).trim().takeIf { COMMIT_RE.matches(it) }
        val hashSrc = JsPluginMatch.str(want?.get("sha256")).ifEmpty { JsPluginMatch.str(want?.get("hash")) }.trim()
        val hash = SHA256_RE.matchEntire(hashSrc)?.groupValues?.get(1)?.lowercase()
        return HelperSpec(repo, "https://raw.githubusercontent.com/$raw/${commit ?: "HEAD"}", hash)
    }

    fun sha256Hex(text: String): String =
        MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    /** Unguessable id for host -> sandbox calls (128 random bits). */
    fun randomCallId(): String {
        val bytes = ByteArray(16)
        random.nextBytes(bytes)
        return "h_" + bytes.joinToString("") { "%02x".format(it) }
    }
}
