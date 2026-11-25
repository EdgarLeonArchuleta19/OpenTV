package com.techpoint.opentv.core.addons

/**
 * One section row. [lists] are Rust-core lists (`tmdb` RPC) tried in order; when all of them
 * fail or come back empty the hidden Cinemeta/Kitsu catalog [url] is used (empty = no fallback),
 * shown under [fallbackTitle] when given.
 */
data class CatalogSpec(
    val id: String,
    val title: String,
    val url: String,
    val lists: List<String> = emptyList(),
    val fallbackTitle: String? = null,
)

/**
 * Built-in rows of Inicio / Películas / Series / Kids / Anime (pure, unit-tested).
 *
 * Owner rule: TMDB (through the Rust core) feeds every row; Cinemeta and Kitsu are only hidden
 * fallbacks for a row whose TMDB list is unavailable (no key, offline, error, empty).
 */
object CatalogRows {
    const val CINEMETA = "https://v3-cinemeta.strem.io"
    const val KITSU = "https://anime-kitsu.strem.fun"

    // TMDB genre ids (movie / tv lists differ).
    const val MOVIE_ACTION = 28
    const val MOVIE_COMEDY = 35
    const val MOVIE_DRAMA = 18
    const val MOVIE_HORROR = 27
    const val MOVIE_SCIFI = 878
    const val TV_COMEDY = 35
    const val TV_CRIME = 80
    const val TV_DRAMA = 18
    const val TV_SCIFI_FANTASY = 10765

    /** Cinemeta genre name -> TMDB genre id, per kind ("movie" / "series"). */
    fun tmdbGenreId(kind: String, cinemetaGenre: String): Int? {
        val g = cinemetaGenre.lowercase()
        return if (kind == "movie") {
            when (g) {
                "action" -> 28
                "adventure" -> 12
                "comedy" -> 35
                "crime" -> 80
                "drama" -> 18
                "family" -> 10751
                "horror" -> 27
                "sci-fi" -> 878
                "thriller" -> 53
                "romance" -> 10749
                else -> null
            }
        } else {
            when (g) {
                "action", "adventure" -> 10759
                "comedy" -> 35
                "crime" -> 80
                "drama" -> 18
                "mystery" -> 9648
                "sci-fi", "fantasy" -> 10765
                "family", "kids" -> 10762
                else -> null
            }
        }
    }

    private fun movieGenre(id: Int) = "cat:movie:genre:$id"
    private fun tvGenre(id: Int) = "cat:tv:genre:$id"

    private fun cin(path: String) = "$CINEMETA/catalog/$path.json"

    fun specs(section: String): List<CatalogSpec> = when (section) {
        "home" -> listOf(
            CatalogSpec("home_trend_movies", "Tendencias de la semana · Películas", cin("movie/top"), listOf("cat:movie:trending")),
            CatalogSpec("home_trend_series", "Tendencias de la semana · Series", cin("series/top"), listOf("cat:tv:trending")),
            CatalogSpec("home_pop_movies", "Popular · Películas", cin("movie/imdbRating"), listOf("cat:movie:popular")),
            CatalogSpec("home_pop_series", "Popular · Series", cin("series/imdbRating"), listOf("cat:tv:popular")),
            CatalogSpec("action_movies", "Acción y aventura", cin("movie/top/genre=Action"), listOf(movieGenre(MOVIE_ACTION))),
            CatalogSpec("scifi_movies", "Ciencia ficción", cin("movie/top/genre=Sci-Fi"), listOf(movieGenre(MOVIE_SCIFI))),
            CatalogSpec("comedy_movies", "Comedia", cin("movie/top/genre=Comedy"), listOf(movieGenre(MOVIE_COMEDY))),
        )
        "movies" -> listOf(
            CatalogSpec("m_trend", "Tendencias de la semana", cin("movie/top"), listOf("cat:movie:trending")),
            CatalogSpec("m_rating", "Popular · Películas", cin("movie/imdbRating"), listOf("cat:movie:popular")),
            CatalogSpec("m_action", "Acción", cin("movie/top/genre=Action"), listOf(movieGenre(MOVIE_ACTION))),
            CatalogSpec("m_horror", "Terror y suspenso", cin("movie/top/genre=Horror"), listOf(movieGenre(MOVIE_HORROR))),
            CatalogSpec("m_scifi", "Ciencia ficción", cin("movie/top/genre=Sci-Fi"), listOf(movieGenre(MOVIE_SCIFI))),
            CatalogSpec("m_comedy", "Comedia", cin("movie/top/genre=Comedy"), listOf(movieGenre(MOVIE_COMEDY))),
            CatalogSpec("m_drama", "Drama", cin("movie/top/genre=Drama"), listOf(movieGenre(MOVIE_DRAMA))),
        )
        "series" -> listOf(
            CatalogSpec("s_trend", "Tendencias de la semana", cin("series/top"), listOf("cat:tv:trending")),
            CatalogSpec("s_rating", "Popular · Series", cin("series/imdbRating"), listOf("cat:tv:popular")),
            CatalogSpec("s_drama", "Drama", cin("series/top/genre=Drama"), listOf(tvGenre(TV_DRAMA))),
            CatalogSpec("s_crime", "Crimen y misterio", cin("series/top/genre=Crime"), listOf(tvGenre(TV_CRIME))),
            CatalogSpec("s_scifi", "Ciencia ficción y fantasía", cin("series/top/genre=Sci-Fi"), listOf(tvGenre(TV_SCIFI_FANTASY))),
            CatalogSpec("s_comedy", "Comedia", cin("series/top/genre=Comedy"), listOf(tvGenre(TV_COMEDY))),
        )
        // Rule: Kids = all-ages ratings (MX "AA"/"A", US "G"/"PG" fallback; TV needs the Kids
        // genre) from TMDB; without a TMDB key, Cinemeta's Family genre (never general Animation).
        "kids" -> listOf(
            CatalogSpec("k_movies", "Películas para todos", cin("movie/top/genre=Family"), listOf(SectionContent.KIDS_MOVIES_POPULAR), "Películas familiares"),
            CatalogSpec("k_series", "Series infantiles", cin("series/top/genre=Family"), listOf(SectionContent.KIDS_TV_POPULAR), "Series para toda la familia"),
            CatalogSpec("k_animated", "Animadas para niños", cin("movie/imdbRating/genre=Family"), listOf(SectionContent.KIDS_MOVIES_ANIMATED), "Favoritas de la familia"),
            CatalogSpec("k_series_top", "Las favoritas de los niños", cin("series/imdbRating/genre=Family"), listOf(SectionContent.KIDS_TV_TOP), "Series favoritas de la familia"),
        )
        // Rule: Anime rows only hold anime. TMDB lists first (IMDb ids, Spanish text); then the
        // Kitsu season list / Kitsu plugin catalogs (`kitsu:` ids) as hidden fallbacks.
        "anime" -> listOf(
            CatalogSpec("a_season", "Tendencias de la temporada", "$KITSU/catalog/anime/kitsu-anime-trending.json", listOf("anime:season", SectionContent.ANIME_SEASON), "Tendencias del anime"),
            CatalogSpec("a_airing", "En emisión", "$KITSU/catalog/anime/kitsu-anime-airing.json", listOf("anime:airing")),
            CatalogSpec("a_popular", "Más populares", "$KITSU/catalog/anime/kitsu-anime-popular.json", listOf("anime:popular")),
            CatalogSpec("a_rated", "Mejor valorados", "$KITSU/catalog/anime/kitsu-anime-rating.json", listOf("anime:top")),
            CatalogSpec("a_movies", "Películas de anime", "", listOf("anime:movies")),
        )
        else -> emptyList()
    }

    /** How a core list's items are mapped. */
    enum class ListKind { KIDS, CATALOG, ANIME_TMDB, ANIME_KITSU }

    fun listKind(list: String): ListKind = when {
        list == SectionContent.ANIME_SEASON -> ListKind.ANIME_KITSU
        list.startsWith("anime:") -> ListKind.ANIME_TMDB
        list.startsWith("kids-") -> ListKind.KIDS
        else -> ListKind.CATALOG
    }
}
