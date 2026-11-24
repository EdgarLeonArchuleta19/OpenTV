package com.techpoint.opentv.core.data

import android.util.AtomicFile
import com.techpoint.opentv.core.addons.StremioClient
import com.techpoint.opentv.core.model.CatalogRow
import com.techpoint.opentv.core.model.InstalledPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * App-wide cache of Home/Movies/Series/Kids/Anime catalog rows.
 *
 * - Lives in [com.techpoint.opentv.OpenTvApp], so switching tabs or opening a title never
 *   re-fetches a section (the old screen-level state was dropped on every tab switch).
 * - Loads run on its own scope: leaving a tab mid-load does not cancel the work.
 * - Last good rows are persisted per section, so a cold start paints instantly from disk
 *   (stale-while-revalidate) instead of showing a spinner while 7 catalogs download.
 */
class CatalogRepository(
    private val stremio: StremioClient,
    cacheDir: File,
) {
    data class SectionState(
        val rows: List<CatalogRow> = emptyList(),
        val loading: Boolean = false,
        /** Epoch ms of the last successful network load (0 = never this session). */
        val loadedAt: Long = 0L,
        val pluginsKey: String = "",
        /** True while the rows on screen come from the disk snapshot of a previous session. */
        val fromDisk: Boolean = false,
        /** False until the first load of this section was started. */
        val attempted: Boolean = false,
    ) {
        /** Still waiting for the first result (show skeletons, not the "empty" message). */
        val pending: Boolean get() = loading || !attempted
        /** Every catalog failed and nothing could be shown. */
        val isEmptyAndIdle: Boolean get() = rows.isEmpty() && !pending
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val dir = File(cacheDir, "catalog_rows").apply { mkdirs() }
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false }
    private val rowsSerializer = ListSerializer(CatalogRow.serializer())
    private val states = ConcurrentHashMap<String, MutableStateFlow<SectionState>>()
    private val jobs = ConcurrentHashMap<String, Job>()

    fun section(id: String): StateFlow<SectionState> = flowFor(id)

    /** Current snapshot without subscribing (used to avoid a skeleton flash on recomposition). */
    fun peek(id: String): SectionState = flowFor(id).value

    /**
     * Starts a load when the section was never loaded, is older than [TTL_MS], or the set of
     * catalog plugins changed. Cheap to call on every composition of a section.
     */
    fun ensureLoaded(id: String, plugins: List<InstalledPlugin>, force: Boolean = false) {
        val key = pluginsKey(plugins)
        val flow = flowFor(id)
        val st = flow.value
        val fresh = st.loadedAt > 0L && System.currentTimeMillis() - st.loadedAt < TTL_MS && st.pluginsKey == key
        if (!force && fresh) return
        val running = jobs[id]
        if (!force && running?.isActive == true && st.pluginsKey == key) return
        running?.cancel()
        flow.update { it.copy(loading = true, attempted = true, pluginsKey = key) }
        jobs[id] = scope.launch {
            val hadDiskRows = flow.value.fromDisk && flow.value.rows.isNotEmpty()
            val result = runCatching {
                stremio.loadCatalogSectionProgressive(id, plugins) { partial ->
                    // With stale rows on screen, wait for the full set (no reshuffle while browsing);
                    // otherwise paint rows as they arrive.
                    if (!hadDiskRows) flow.update { s -> s.copy(rows = partial, fromDisk = false) }
                }
            }.getOrDefault(emptyList())
            if (result.isNotEmpty()) {
                // Some catalogs failed/timed out: keep what came but retry on the next visit
                // after ~1 min instead of waiting the full TTL.
                val complete = result.size >= stremio.catalogRowCount(id, plugins)
                val stamp = System.currentTimeMillis() - if (complete) 0L else TTL_MS - 60_000L
                flow.update {
                    it.copy(rows = result, loading = false, loadedAt = stamp, fromDisk = false)
                }
                writeDisk(id, result)
            } else {
                // Keep whatever is on screen (disk snapshot); loadedAt stays 0 so the next visit retries.
                flow.update { it.copy(loading = false) }
            }
        }
    }

    /** Warms other sections in the background, one at a time, after the first screen is up. */
    fun prefetch(ids: List<String>, plugins: List<InstalledPlugin>, startDelayMs: Long = 2_500L) {
        scope.launch {
            delay(startDelayMs)
            // Never compete for the (slow) Wi-Fi with the section on screen.
            jobs.values.toList().forEach { runCatching { it.join() } }
            for (id in ids) {
                ensureLoaded(id, plugins)
                jobs[id]?.join()
            }
        }
    }

    /** "Borrar caché": drops the disk snapshots; rows on screen stay until the next refresh. */
    fun clearDiskCache() {
        scope.launch { runCatching { dir.listFiles()?.forEach { it.delete() } } }
        states.values.forEach { flow -> flow.update { it.copy(loadedAt = 0L) } }
    }

    private fun flowFor(id: String): MutableStateFlow<SectionState> =
        states.getOrPut(id) {
            MutableStateFlow(SectionState()).also { flow ->
                scope.launch {
                    val disk = readDisk(id)
                    if (!disk.isNullOrEmpty()) {
                        flow.update { s -> if (s.rows.isEmpty()) s.copy(rows = disk, fromDisk = true) else s }
                    }
                }
            }
        }

    private fun fileFor(id: String) = AtomicFile(File(dir, "${id.filter { it.isLetterOrDigit() }}.json"))

    private fun readDisk(id: String): List<CatalogRow>? = runCatching {
        val f = fileFor(id)
        if (!f.baseFile.exists()) return null
        json.decodeFromString(rowsSerializer, f.readFully().decodeToString())
    }.getOrNull()

    private fun writeDisk(id: String, rows: List<CatalogRow>) {
        runCatching {
            val f = fileFor(id)
            val out = f.startWrite()
            try {
                out.write(json.encodeToString(rowsSerializer, rows).toByteArray(Charsets.UTF_8))
                f.finishWrite(out)
            } catch (e: Throwable) {
                f.failWrite(out)
                throw e
            }
        }
    }

    private companion object {
        const val TTL_MS = 20 * 60_000L

        /** Only the plugins that add catalog rows change a section's content. */
        fun pluginsKey(plugins: List<InstalledPlugin>): String =
            plugins.asSequence()
                .filter { !it.disabled && it.kind == "stremio" && !it.builtin && it.catalogs.isNotEmpty() }
                .joinToString("|") { it.id + ":" + it.catalogs.size }
    }
}
