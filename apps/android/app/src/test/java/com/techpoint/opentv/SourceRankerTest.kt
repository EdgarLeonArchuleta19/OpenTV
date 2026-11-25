package com.techpoint.opentv

import com.techpoint.opentv.core.addons.PluginCatalogs
import com.techpoint.opentv.core.data.AppUpdatePolicy
import com.techpoint.opentv.core.model.InstalledPlugin
import com.techpoint.opentv.core.model.SourcePrefs
import com.techpoint.opentv.core.model.StreamSource
import com.techpoint.opentv.core.ranking.SourceRanker
import com.techpoint.opentv.service.DeviceMediaCaps
import com.techpoint.opentv.ui.components.formatDurationEs
import com.techpoint.opentv.ui.components.formatHeroGenres
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SourceRankerTest {

    @Test
    fun `distinguishes latino castellano and subtitles`() {
        val lat = SourceRanker.enrich(
            StreamSource(id = "1", addonId = "t", addonName = "Torrentio", name = "1080p", title = "Movie 2025 🇲🇽 Dual Latino 👤 80 💾 2.5 GB", infoHash = "aaa"),
        )
        val cast = SourceRanker.enrich(
            StreamSource(id = "2", addonId = "t", addonName = "Torrentio", name = "1080p", title = "Movie 2025 🇪🇸 Castellano 👤 90 💾 2.5 GB", infoHash = "bbb"),
        )
        val subsOnly = SourceRanker.enrich(
            StreamSource(id = "3", addonId = "t", addonName = "Torrentio", name = "1080p", title = "Movie 2025 English VOSE Subtitulada Español", infoHash = "ccc"),
        )

        assertTrue("latino" in lat.langs)
        assertTrue("castellano" in cast.langs)
        assertFalse("latino" in subsOnly.langs)
        assertTrue(subsOnly.hasSubsEs)
        assertEquals(80, lat.seeders)
        assertTrue(lat.sizeBytes > 2_000_000_000L)
    }

    @Test
    fun `prefers viewer language over higher resolution english and penalizes CAM`() {
        val prefs = SourcePrefs(langs = listOf("latino", "castellano"), quality = "auto")
        val caps = DeviceMediaCaps(hevc = true, hevc10 = true, uhd = true, hdr = true, eac3 = true)

        val lat1080 = StreamSource(id = "lat", addonId = "t", addonName = "Torrentio", title = "Movie 1080p Latino 👤 50 💾 2.1 GB", infoHash = "111")
        val en4k = StreamSource(id = "en4k", addonId = "t", addonName = "Torrentio", title = "Movie 2160p 4K HDR English 👤 200 💾 14 GB", infoHash = "222")
        val latCam = StreamSource(id = "cam", addonId = "t", addonName = "Torrentio", title = "Movie HDCAM Latino 👤 500 💾 1.2 GB", infoHash = "333")

        val ranked = SourceRanker.rank(listOf(en4k, latCam, lat1080), prefs, caps, isLowMemory = false)
        assertEquals("lat", ranked.first().id)
        // CAM torrents are not listed at all.
        assertFalse(ranked.any { it.id == "cam" })
    }

    @Test
    fun `penalizes unsupported HEVC and DTS on low-spec TV`() {
        val prefs = SourcePrefs(langs = listOf("latino"))
        val fireTvBasic = DeviceMediaCaps(hevc = false, dts = false, truehd = false)

        val h264 = StreamSource(id = "h264", addonId = "t", addonName = "Torrentio", title = "Movie 1080p x264 Latino 👤 40", infoHash = "a1")
        val hevcDts = StreamSource(id = "hevc", addonId = "t", addonName = "Torrentio", title = "Movie 1080p x265 HEVC DTS-HD Latino 👤 80", infoHash = "a2")

        val ranked = SourceRanker.rank(listOf(hevcDts, h264), prefs, fireTvBasic, isLowMemory = true)
        assertEquals("h264", ranked.first().id)
    }

    @Test
    fun `torrent race alternatives match language and skip CAM`() {
        val prefs = SourcePrefs(langs = listOf("latino"))
        val caps = DeviceMediaCaps(hevc = true)
        val raw = listOf(
            StreamSource(id = "1", addonId = "t", addonName = "T", title = "1080p Latino 👤 80", infoHash = "h1"),
            StreamSource(id = "2", addonId = "t", addonName = "T", title = "1080p Latino 👤 45", infoHash = "h2"),
            StreamSource(id = "3", addonId = "t", addonName = "T", title = "1080p HDCAM Latino 👤 200", infoHash = "h3"),
            StreamSource(id = "4", addonId = "t", addonName = "T", title = "1080p English 👤 150", infoHash = "h4"),
        )
        val ranked = SourceRanker.rank(raw, prefs, caps)
        val alts = SourceRanker.torrentRaceAlternatives(ranked.first(), ranked, maxAlts = 2)
        assertEquals(1, alts.size)
        assertEquals("h2", alts.first().infoHash)
    }

    @Test
    fun `builtin plugins Cinemeta Kitsu OpenSubtitles are always seeded`() {
        val seeded = PluginCatalogs.seedBuiltins(emptyList())
        assertEquals(3, seeded.size)
        assertTrue(seeded.all { it.builtin && !it.disabled })
        assertEquals("default_cinemeta", seeded[0].id)
        assertEquals("default_kitsu", seeded[1].id)
        assertEquals("default_opensubtitles", seeded[2].id)
        assertTrue(seeded[2].logo.startsWith("https://"))

        // Existing persisted built-in without logo gets backfilled automatically.
        val legacy = listOf(
            InstalledPlugin(id = "old_os", name = "OpenSubtitles v3", url = PluginCatalogs.OPENSUBTITLES_URL, logo = ""),
        )
        val migrated = PluginCatalogs.seedBuiltins(legacy)
        val os = migrated.first { PluginCatalogs.stremioBaseFromUrl(it.url) == PluginCatalogs.stremioBaseFromUrl(PluginCatalogs.OPENSUBTITLES_URL) }
        assertTrue(os.builtin && !os.disabled)
        assertTrue(os.logo.startsWith("https://"))
    }

    @Test
    fun `formats durations and hero genres consistently with PC`() {
        assertEquals("2 h 53 min", formatDurationEs("173 min"))
        assertEquals("2 h", formatDurationEs("120 min"))
        assertEquals("45 min", formatDurationEs("45 min"))
        assertEquals("", formatDurationEs("—"))
        assertEquals("1 h 50 min", formatDurationEs("1 h 50 min"))

        assertEquals(
            "Acción • Ciencia ficción • Drama",
            formatHeroGenres(listOf("Action", "Action & Adventure", "Sci-Fi", "Drama", "Comedy"), max = 3),
        )
    }

    @Test
    fun `resolves official community logos without unsupported svg`() {
        assertTrue(PluginCatalogs.knownLogoFor("https://torrentio.strem.fun/manifest.json").startsWith("https://"))
        assertTrue(PluginCatalogs.knownLogoFor("https://raw.githubusercontent.com/xuper-plugin/kino-plugin-cinehdplus/HEAD/kino-plugin.json").endsWith("icon.png"))
        assertTrue(PluginCatalogs.CommunityCatalog.none { it.logo.endsWith(".svg", ignoreCase = true) })
    }

    @Test
    fun `enforces mandatory SemVer updates including alpha to stable transitions`() {
        assertTrue(AppUpdatePolicy.isOutdated("2.0.0-alpha.1", "2.0.0"))
        assertTrue(AppUpdatePolicy.isOutdated("2.0.0-alpha.2", "2.0.0-alpha.10"))
        assertTrue(AppUpdatePolicy.isOutdated("2.0.0", "2.0.1"))
        assertFalse(AppUpdatePolicy.isOutdated("2.0.0", "2.0.0"))
        assertFalse(AppUpdatePolicy.isOutdated("2.0.0", "2.0.0-alpha.1"))
        assertFalse(AppUpdatePolicy.isOutdated("2.0.0-alpha.1", "1.2.1"))
        assertFalse(AppUpdatePolicy.isOutdated("2.0.0", ""))
    }

    // --- Fire TV 1 GB: direct HLS from kino JS plugins vs torrents ---

    private val fireTvCaps = DeviceMediaCaps(hevc = true)
    private val latinoFirst = SourcePrefs(langs = listOf("latino", "castellano"), quality = "auto")

    private fun jsDirect(id: String, title: String) = StreamSource(
        id = id, addonId = "pelispedia", addonName = "Pelispedia", name = "Pelispedia",
        title = title, url = "https://cdn.example/$id/master.m3u8", isJsPlugin = true,
    )

    @Test
    fun `low RAM prefers a direct stream over a well seeded torrent in the same language`() {
        val torrent = StreamSource(id = "tor", addonId = "t", addonName = "Torrentio", title = "Movie 720p Latino 👤 900 💾 1.4 GB", infoHash = "h1")
        val direct = jsDirect("dir", "Latino · fastream")
        val ranked = SourceRanker.rank(listOf(torrent, direct), latinoFirst, fireTvCaps, isLowMemory = true)
        assertEquals("dir", ranked.first().id)
        assertTrue(ranked.first().isDirect)
    }

    @Test
    fun `low RAM keeps language first over direct streams`() {
        val torLat = StreamSource(id = "torLat", addonId = "t", addonName = "Torrentio", title = "Movie 1080p Latino 👤 40", infoHash = "h1")
        val torCast = StreamSource(id = "torCast", addonId = "t", addonName = "Torrentio", title = "Movie 1080p Castellano 👤 300", infoHash = "h2")
        val dirEn = jsDirect("dirEn", "English · streamwish")
        val dirCast = jsDirect("dirCast", "Castellano · streamwish")
        val ranked = SourceRanker.rank(listOf(dirEn, torCast, dirCast, torLat), latinoFirst, fireTvCaps, isLowMemory = true)
        // Latino torrent first, then the Castellano direct ahead of the Castellano torrent; English last.
        assertEquals(listOf("torLat", "dirCast", "torCast", "dirEn"), ranked.map { it.id })
    }

    @Test
    fun `low RAM never promotes CAM direct streams`() {
        val torrent = StreamSource(id = "tor", addonId = "t", addonName = "Torrentio", title = "Movie 720p Latino 👤 120", infoHash = "h1")
        val camDirect = jsDirect("cam", "Latino HDCAM")
        val ranked = SourceRanker.rank(listOf(camDirect, torrent), latinoFirst, fireTvCaps, isLowMemory = true)
        assertEquals("tor", ranked.first().id)
    }

    @Test
    fun `direct HLS without quality tag counts as the target quality`() {
        val direct = SourceRanker.rank(listOf(jsDirect("d", "Latino")), latinoFirst, fireTvCaps, isLowMemory = false).single()
        val sd = SourceRanker.rank(listOf(jsDirect("s", "Latino 480p")), latinoFirst, fireTvCaps, isLowMemory = false).single()
        assertTrue(direct.score > sd.score)
    }

    @Test
    fun `auto pick waits for direct streams once torrents are in`() {
        val torrent = SourceRanker.rank(
            listOf(StreamSource(id = "tor", addonId = "t", addonName = "Torrentio", title = "720p Latino 👤 90", infoHash = "h1")),
            latinoFirst, fireTvCaps, isLowMemory = true,
        )
        // Torrent only, JS plugins still working: keep waiting inside the grace window.
        assertFalse(SourceRanker.autoPickReady(torrent, false, latinoFirst, 5_000L, 7_000L, isLowMemory = true))
        // Grace window over: play the torrent.
        assertTrue(SourceRanker.autoPickReady(torrent, false, latinoFirst, 22_000L, 24_000L, isLowMemory = true))
        // Nothing yet: wait (up to the overall cap).
        assertFalse(SourceRanker.autoPickReady(emptyList(), false, latinoFirst, 0L, 40_000L, isLowMemory = true))
        assertTrue(SourceRanker.autoPickReady(emptyList(), false, latinoFirst, 0L, 70_000L, isLowMemory = true))
        // A direct stream in the first language arrived: no reason to wait for the rest.
        val withDirect = SourceRanker.rank(torrent + jsDirect("dir", "Latino · fastream"), latinoFirst, fireTvCaps, isLowMemory = true)
        assertTrue(SourceRanker.autoPickReady(withDirect, false, latinoFirst, 3_000L, 5_000L, isLowMemory = true))
        // Everything answered.
        assertTrue(SourceRanker.autoPickReady(torrent, true, latinoFirst, 1_000L, 1_000L, isLowMemory = true))
    }
    private fun tor(id: String, title: String, hash: String, filename: String = "") =
        StreamSource(id = id, addonId = "t", addonName = "Torrentio", title = title, infoHash = hash, filename = filename)

    @Test
    fun `drops torrents with fewer than 5 known seeders but keeps unknown and direct`() {
        val ranked = SourceRanker.rank(
            listOf(
                tor("good", "Movie 1080p Latino 👤 40", "e1"),
                tor("four", "Movie 1080p Latino 👤 4", "e2"),
                tor("fourEn", "Movie 1080p English 👤 4", "e6"),
                tor("zero", "Movie 2160p Latino 👤 0", "e3"),
                tor("five", "Movie 720p Latino 👤 5", "e4"),
                tor("unknown", "Movie 1080p Latino", "e5"),
                jsDirect("direct", "Latino"),
            ),
            latinoFirst, fireTvCaps, isLowMemory = true,
        ).map { it.id }
        // Latino is scarce: a Latino torrent with a few seeders stays; zero never does.
        assertTrue(ranked.containsAll(listOf("good", "four", "five", "unknown", "direct")))
        assertFalse("fourEn" in ranked)
        assertFalse("zero" in ranked)
    }

    @Test
    fun `detects CAM TS TC and screener releases as whole tokens only`() {
        val bad = listOf(
            "Movie.2025.HDCAM.x264", "Movie 2025 TS Latino", "Movie.2025.TC.XviD", "Movie 2025 TeleSync",
            "Movie.2025.DVDSCR", "Movie [HD-TS]", "Movie 2025 CAM", "Movie.2025.SCREENER", "Movie 2025 hdts",
        )
        bad.forEach { assertTrue(it, SourceRanker.isBadRelease(tor("x", it, "x"))) }
        val good = listOf(
            "Cam (2018) 1080p WEB-DL", "Kids.2025.1080p", "Movie 2025 YTS 1080p", "Avatar 2160p UHD",
            "Lights Out 720p", "Scream 1996 BluRay",
        )
        good.forEach { assertFalse(it, SourceRanker.isBadRelease(tor("x", it, "x"))) }
        // A ".ts" file extension is not a release tag.
        assertFalse(SourceRanker.isBadRelease(tor("x", "Movie 1080p", "x", filename = "Movie.2025.1080p.ts")))
    }

    @Test
    fun `never drops direct sources even if they look like CAM or ts streams`() {
        val hls = StreamSource(
            id = "hls", addonId = "j", addonName = "J", title = "Latino TS",
            url = "https://cdn.example/seg.ts", isJsPlugin = true,
        )
        val ranked = SourceRanker.rank(listOf(hls, tor("tor", "Movie 1080p Latino 👤 30", "f1")), latinoFirst, fireTvCaps)
        assertTrue(ranked.any { it.id == "hls" })
    }

    @Test
    fun `lists the same infoHash once keeping the best seeded copy`() {
        val split = SourceRanker.splitTorrentQuality(
            listOf(
                SourceRanker.enrich(tor("a", "1080p Latino 👤 20", "ABC")),
                SourceRanker.enrich(tor("b", "1080p Latino 👤 90", "abc")),
            ),
        )
        assertEquals(listOf("b"), split.kept.map { it.id })
        assertTrue(split.dropped.isEmpty())
    }

    @Test
    fun `falls back to the best dropped torrents instead of an empty list`() {
        val ranked = SourceRanker.rank(
            listOf(tor("cam", "Movie HDCAM Latino 👤 300", "g1"), tor("dead", "Movie 1080p Latino 👤 1", "g2")),
            latinoFirst, fireTvCaps,
        )
        assertTrue(ranked.isNotEmpty())
        assertTrue(ranked.size <= 5)
    }

    @Test
    fun `describes sources in plain Spanish for the picker`() {
        val lat = SourceRanker.enrich(tor("1", "Movie 1080p Dual Latino English 👤 40", "h"))
        val subs = SourceRanker.enrich(tor("2", "Movie 720p English VOSE", "i"))
        val orig = SourceRanker.enrich(StreamSource(id = "3", addonId = "j", addonName = "J", title = "Server 1", url = "https://x.example/a.m3u8"))
        assertEquals("Latino + Inglés", SourceRanker.plainLanguageLabel(lat))
        assertEquals("Subtitulado", SourceRanker.plainLanguageLabel(subs))
        assertEquals("Idioma original", SourceRanker.plainLanguageLabel(orig))
        assertEquals("Auto", SourceRanker.qualityLabel(orig))
        val opts = SourceRanker.pickerFilterOptions(listOf(lat, subs, orig))
        assertEquals(listOf("Todas", "1080p", "720p", "Auto"), opts.quality.map { it.label })
        assertEquals(listOf("Todos", "Latino", "Inglés", "Subtitulado"), opts.lang.map { it.label })
        assertEquals(listOf("Todas", "Directas", "Torrents"), opts.type.map { it.label })
    }
}
