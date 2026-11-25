package com.techpoint.opentv.core.addons

import com.techpoint.opentv.core.model.CommunityPlugin
import com.techpoint.opentv.core.model.InstalledPlugin
import com.techpoint.opentv.core.model.M3uPlaylist

/**
 * Built-in plugins, community recommendations, preset M3U lists and kino JS domain maps
 * kept in 1:1 parity with OpenTV Desktop (`vod-api.js`, `plugins.js`, `channels.js`, `js-plugins.js`).
 */
object PluginCatalogs {

    const val CINEMETA_URL = "https://v3-cinemeta.strem.io/manifest.json"
    const val KITSU_URL = "https://anime-kitsu.strem.fun/manifest.json"
    const val OPENSUBTITLES_URL = "https://opensubtitles-v3.strem.io/manifest.json"

    val BuiltinPlugins: List<InstalledPlugin> = listOf(
        InstalledPlugin(
            id = "default_cinemeta",
            name = "Cinemeta",
            url = CINEMETA_URL,
            baseUrl = "https://v3-cinemeta.strem.io",
            kind = "stremio",
            description = "Catálogo oficial de películas y series",
            builtin = true,
            hasCatalog = true,
            hasMeta = true,
            types = listOf("movie", "series"),
        ),
        InstalledPlugin(
            id = "default_kitsu",
            name = "Anime Kitsu",
            url = KITSU_URL,
            baseUrl = "https://anime-kitsu.strem.fun",
            kind = "stremio",
            description = "Catálogo de anime en emisión, populares y mejor valorados",
            builtin = true,
            hasCatalog = true,
            hasMeta = true,
            types = listOf("anime"),
        ),
        InstalledPlugin(
            id = "default_opensubtitles",
            name = "OpenSubtitles v3",
            url = OPENSUBTITLES_URL,
            baseUrl = "https://opensubtitles-v3.strem.io",
            kind = "stremio",
            description = "Subtítulos automáticos en español y otros idiomas",
            logo = "https://www.strem.io/images/addons/opensubtitles-logo.png",
            builtin = true,
            hasSubtitles = true,
            types = listOf("movie", "series"),
        ),
    )

    fun stremioBaseFromUrl(url: String): String {
        val clean = url.trim()
            .replace(Regex("^stremio://", RegexOption.IGNORE_CASE), "https://")
            .substringBefore("?")
            .removeSuffix("/manifest.json")
            .removeSuffix("/")
        return clean.lowercase()
    }

    /**
     * Installed plugin that only serves live channels (Stremio `tv` / `channel` types).
     * It is listed under "TV en vivo" together with the M3U lists; everything else is "Películas y series".
     */
    fun isLiveTvPlugin(p: InstalledPlugin): Boolean {
        val types = p.types.map { it.lowercase() }
        return types.any { it == "tv" || it == "channel" } && types.none { it == "movie" || it == "series" || it == "anime" }
    }

    fun isBuiltinUrl(url: String): Boolean {
        val base = stremioBaseFromUrl(url)
        return BuiltinPlugins.any { stremioBaseFromUrl(it.url) == base }
    }

    /** Returns the known official logo URL for a built-in or community plugin, if any. */
    fun knownLogoFor(url: String): String {
        if (url.isBlank()) return ""
        val base = stremioBaseFromUrl(url)
        BuiltinPlugins.firstOrNull { it.logo.isNotBlank() && stremioBaseFromUrl(it.url) == base }
            ?.let { return it.logo }
        CommunityCatalog.firstOrNull { it.logo.isNotBlank() && stremioBaseFromUrl(it.url) == base }
            ?.let { return it.logo }
        return ""
    }

    /** Ensures Cinemeta, Anime Kitsu and OpenSubtitles are always installed and enabled. */
    fun seedBuiltins(current: List<InstalledPlugin>): List<InstalledPlugin> {
        val builtinByBase = BuiltinPlugins.associateBy { stremioBaseFromUrl(it.url) }
        val list = current.toMutableList()
        for (i in list.indices) {
            val b = builtinByBase[stremioBaseFromUrl(list[i].url)]
            if (b != null) {
                list[i] = list[i].copy(
                    builtin = true,
                    disabled = false,
                    logo = list[i].logo.ifBlank { b.logo },
                )
            }
        }
        val existingBases = list.map { stremioBaseFromUrl(it.url) }.toMutableSet()
        for (builtin in BuiltinPlugins) {
            val base = stremioBaseFromUrl(builtin.url)
            if (base !in existingBases) {
                if (builtin.id == "default_kitsu") {
                    val cinIdx = list.indexOfFirst { stremioBaseFromUrl(it.url) == stremioBaseFromUrl(CINEMETA_URL) }
                    val insertAt = if (cinIdx >= 0) cinIdx + 1 else list.size
                    list.add(insertAt, builtin)
                } else {
                    list.add(builtin)
                }
                existingBases.add(base)
            }
        }
        return list
    }

    val JsPluginHostMap: Map<String, String> = mapOf(
        "framextv.cc" to "baskettv23/Framextv",
        "framextv.xyz" to "syberia1/frametv",
        "gnulahd.nu" to "JuanDEVYT/GnulaHD_plugin",
        "latinomegahd.net" to "baskettv23/Latinomegahd",
        "pelispanda.org" to "baskettv23/Pelispanda",
        "pelispro.net" to "baskettv23/Pelispro",
        "sololatino.net" to "xuper-plugin/kino-plugin-sololatino",
        "cuevana3.eu" to "xuper-plugin/kino-plugin-cuevanapro",
        "cinehdplus.org" to "xuper-plugin/kino-plugin-cinehdplus",
        "pelispedia.is" to "xuper-plugin/kino-plugin-pelispedia",
        "serieskao.top" to "xuper-plugin/kino-plugin-serieskao",
        "fuegocine.com" to "JuanDEVYT/FuegoCine_plugin",
        "animeav1.com" to "LifReizei/K-Av1",
        "jkanime.net" to "Susejing/kino-plugin-Jkanime",
        "monoschinos.st" to "syberia1/MonosChinos",
        "latanime.org" to "sonny-debug12/latanime-kino",
        "doramasyt.com" to "xuper-plugin/kino-plugin-doramasyt",
        "mundodonghua.com" to "xuper-plugin/kino-plugin-mundodonghua",
        "lacartoons.com" to "xuper-plugin/kino-plugin-lacartoons",
        "area-documental.com" to "xuper-plugin/kino-plugin-areadocumental",
        "tvenvivo.org" to "xuper-plugin/kino-plugin-tvenvivo",
    )

    val PresetM3uLists: List<M3uPlaylist> = listOf(
        M3uPlaylist("pluto_mx", "Pluto TV México y Latam", "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_mx.m3u", "200+ canales gratis en español: cine, series, anime, deportes e infantil"),
        M3uPlaylist("plex_mx", "Plex TV en Español", "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plex_mx.m3u", "270+ canales gratis 24/7 de películas, series, acción y documentales"),
        M3uPlaylist("pluto_ar", "Pluto TV Cono Sur", "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_ar.m3u", "190+ canales gratis de películas, comedias y series en español"),
        M3uPlaylist("es_tdt", "TDTChannels España (Oficial)", "https://www.tdtchannels.com/lists/tv.m3u8", "Canales abiertos verificados con guía de programación"),
        M3uPlaylist("samsung_es", "Samsung TV Plus", "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/samsungtvplus_es.m3u", "180+ canales continuos de cine, series, documentales y música"),
        M3uPlaylist("pluto_es", "Pluto TV España", "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_es.m3u", "150+ canales gratis: cine, series, policiacas e infantil"),
        M3uPlaylist("latam_spa", "TV Abierta Hispana", "https://iptv-org.github.io/iptv/languages/spa.m3u", "Canales en español de México, Argentina, Colombia, Chile, Perú y más"),
        M3uPlaylist("sports_iptv", "Deportes en Vivo", "https://iptv-org.github.io/iptv/categories/sports.m3u", "Canales deportivos, fútbol y transmisiones de competiciones"),
        M3uPlaylist("movies_iptv", "Cine y Series 24/7", "https://iptv-org.github.io/iptv/categories/movies.m3u", "Cine clásico, acción y canales continuos de películas"),
        M3uPlaylist("kids", "Infantil y Caricaturas", "https://iptv-org.github.io/iptv/categories/kids.m3u", "Canales de dibujos animados y programación familiar"),
        M3uPlaylist("news", "Noticias 24 Horas", "https://iptv-org.github.io/iptv/categories/news.m3u", "Noticieros en vivo en español e internacionales"),
        M3uPlaylist("documentary", "Documentales y Naturaleza", "https://iptv-org.github.io/iptv/categories/documentary.m3u", "Naturaleza, historia, ciencia y exploración"),
        M3uPlaylist("mx", "México (Canales Abiertos)", "https://iptv-org.github.io/iptv/countries/mx.m3u", "Canales nacionales y regionales de México"),
    )

    val CommunityCatalog: List<CommunityPlugin> = listOf(
        CommunityPlugin(
            id = "cuevana_pro",
            name = "Cuevana Pro",
            url = "https://raw.githubusercontent.com/xuper-plugin/kino-plugin-cuevanapro/HEAD/kino-plugin.json",
            description = "Catálogo amplio de películas y series en español latino y subtitulado",
            category = "directas",
            kind = "kino-js",
            logo = "https://raw.githubusercontent.com/xuper-plugin/kino-plugin-cuevanapro/HEAD/icon.png",
            tvEssential = true,
            recommendedRankTv = 1,
            recommendedRankPhone = 1,
        ),
        CommunityPlugin(
            id = "pelispedia",
            name = "Pelispedia",
            url = "https://raw.githubusercontent.com/xuper-plugin/kino-plugin-pelispedia/HEAD/kino-plugin.json",
            description = "Películas y series en español latino, castellano y subtitulado sin torrents",
            category = "directas",
            kind = "kino-js",
            logo = "https://raw.githubusercontent.com/xuper-plugin/kino-plugin-pelispedia/HEAD/icon.png",
            tvEssential = true,
            recommendedRankTv = 2,
        ),
        CommunityPlugin(
            id = "framextv_plus",
            name = "FrameXTV +",
            url = "https://raw.githubusercontent.com/syberia1/frametv/HEAD/kino-plugin.json",
            description = "Catálogo completo de FrameXTV en español latino, subtitulado y castellano",
            category = "directas",
            kind = "kino-js",
            logo = "https://raw.githubusercontent.com/syberia1/frametv/HEAD/icon.png",
            tvEssential = true,
            recommendedRankPhone = 2,
        ),
        CommunityPlugin(
            id = "cinehd_plus",
            name = "CineHD Plus",
            url = "https://raw.githubusercontent.com/xuper-plugin/kino-plugin-cinehdplus/HEAD/kino-plugin.json",
            description = "Estrenos y series en HD en español latino y castellano",
            category = "directas",
            kind = "kino-js",
            logo = "https://raw.githubusercontent.com/xuper-plugin/kino-plugin-cinehdplus/HEAD/icon.png",
        ),
        CommunityPlugin(
            id = "torrentio",
            name = "Torrentio",
            url = "https://torrentio.strem.fun/manifest.json",
            description = "El catálogo torrent más amplio con audio latino, castellano, 4K HDR y Dolby",
            category = "torrents",
            kind = "stremio",
            logo = "https://torrentio.strem.fun/images/logo_v1.png",
            tvEssential = true,
            recommendedRankTv = 3,
            recommendedRankPhone = 3,
        ),
        CommunityPlugin(
            id = "deepflix",
            name = "DeepFlix",
            url = "https://mg.homelabx.qzz.io/manifest.json",
            description = "Películas y series en español latino por enlace directo, sin torrents",
            category = "directas",
            kind = "stremio",
            tvEssential = true,
        ),
        CommunityPlugin(
            id = "cncverse",
            name = "CNCVerse",
            url = "https://cncverse.dpdns.org/manifest.json",
            description = "Catálogos y fuentes de películas y series por enlace directo HTTP",
            category = "directas",
            kind = "stremio",
            logo = "https://raw.githubusercontent.com/NivinCNC/CNCVerse-Bridge/refs/heads/main/logo.png",
            tvEssential = true,
        ),
        CommunityPlugin(
            id = "torrentsdb",
            name = "TorrentsDB",
            url = "https://torrentsdb.com/manifest.json",
            description = "Fuentes torrent sin debrid, con proveedores y estrenos en varios idiomas",
            category = "torrents",
            kind = "stremio",
            tvEssential = true,
        ),
        CommunityPlugin(
            id = "peerflix_es",
            name = "Peerflix ES",
            url = "https://addon.peerflix.mov/language=es,en/manifest.json",
            description = "Películas y series con audio en español latino y castellano primero",
            category = "torrents",
            kind = "stremio",
            logo = "https://peerflix.mov/static/logo.png",
            tvEssential = true,
        ),
        CommunityPlugin(
            id = "torrentclaw",
            name = "TorrentClaw",
            url = "https://torrentclaw.com/api/stremio/manifest.json",
            description = "Más de 30 fuentes de películas y series con audio en español e inglés",
            category = "torrents",
            kind = "stremio",
            logo = "https://torrentclaw.com/icon-512.png",
        ),
        CommunityPlugin(
            id = "streaming_catalogs",
            name = "Streaming Catalogs",
            url = "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/manifest.json",
            description = "Tendencias de Netflix, Max, Disney+, Prime Video y Apple TV+",
            category = "catalogos",
            kind = "stremio",
            logo = "https://play-lh.googleusercontent.com/TBRwjS_qfJCSj1m7zZB93FnpJM5fSpMA_wUlFDLxWAb45T9RmwBvQd5cWR5viJJOhkI",
        ),
        CommunityPlugin(
            id = "imdb_catalogs",
            name = "IMDb Catalogs",
            url = "https://1fe84bc728af-imdb-catalogs.baby-beamup.club/manifest.json",
            description = "Listas populares y mejor valoradas de películas y series de IMDb",
            category = "catalogos",
            kind = "stremio",
            logo = "https://londonfeministfilmfestival.files.wordpress.com/2017/05/imdb-logo.png",
        ),
        CommunityPlugin(
            id = "subtitles_website",
            name = "Subtitles Website",
            url = "https://subtitles.website/stremio/manifest.json",
            description = "Más de 630.000 subtítulos en español y otros idiomas",
            category = "subtitulos",
            kind = "stremio",
            tvEssential = true,
        ),
    ) + PresetM3uLists.map { list ->
        val tvEss = list.id in setOf("pluto_mx", "plex_mx", "pluto_ar", "es_tdt", "latam_spa", "sports_iptv")
        val cat = when (list.id) {
            "pluto_mx", "plex_mx", "pluto_ar", "samsung_es", "pluto_es" -> "gratis"
            "sports_iptv" -> "deportes"
            "movies_iptv" -> "cine"
            "kids" -> "infantil"
            "news" -> "noticias"
            "documentary" -> "documentales"
            else -> "paises"
        }
        CommunityPlugin(
            id = "m3u_${list.id}",
            name = list.name,
            url = list.url,
            description = list.description,
            category = cat,
            kind = "m3u",
            tvEssential = tvEss,
        )
    }

    val PluginCategories: List<Pair<String, String>> = listOf(
        "all" to "Todas",
        "recomendados" to "Recomendados",
        "directas" to "Fuentes directas",
        "torrents" to "Torrents",
        "catalogos" to "Catálogos",
        "subtitulos" to "Subtítulos",
        "gratis" to "Televisión gratis",
        "deportes" to "Deportes en vivo",
        "paises" to "TV por país",
        "noticias" to "Noticias",
        "infantil" to "Infantil",
        "cine" to "Cine TV",
        "documentales" to "Documentales",
    )
}
