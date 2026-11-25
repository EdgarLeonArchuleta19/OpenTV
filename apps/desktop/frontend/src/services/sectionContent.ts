import type { HomeTabId, MediaItem } from '../types/models';

/**
 * Content selection for every browse section (pure helpers, no I/O).
 *
 * - TMDB (through the Rust core, `tmdb.rs`) is the source of every row: Inicio, Películas,
 *   Series (`cat:*`), Kids (`kids-*`, all-ages ratings) and Anime (`anime:*`).
 * - Cinemeta / Kitsu catalogs are only hidden fallbacks: a row whose core lists come back
 *   empty (no TMDB key, offline, error) loads its `url` instead.
 * - The first row of Kids and Anime drives the hero: its order rotates once a day.
 */

export const KIDS_LISTS = {
  moviesPopular: 'kids-movies-popular',
  moviesAnimated: 'kids-movies-animated',
  tvPopular: 'kids-tv-popular',
  tvTop: 'kids-tv-top',
} as const;

/** Kitsu's current season (Kitsu ids): second choice for the first Anime row. */
export const ANIME_SEASON_LIST = 'anime-season';

/** TMDB anime lists served by the core (Japanese animation, `tt…` ids). */
export const ANIME_LISTS = {
  season: 'anime:season',
  airing: 'anime:airing',
  popular: 'anime:popular',
  top: 'anime:top',
  movies: 'anime:movies',
} as const;

/** TMDB genre ids used by the `cat:<kind>:genre:<id>` rows. */
export const TMDB_GENRES = {
  movie: { action: 28, adventure: 12, animation: 16, comedy: 35, crime: 80, drama: 18, family: 10751, horror: 27, scifi: 878, thriller: 53, romance: 10749 },
  tv: { actionAdventure: 10759, comedy: 35, crime: 80, drama: 18, mystery: 9648, scifiFantasy: 10765, kids: 10762 },
} as const;

const CINEMETA = 'https://v3-cinemeta.strem.io';
const KITSU = 'https://anime-kitsu.strem.fun';

export interface SectionRowSpec {
  id: string;
  title: string;
  /** Core lists tried in order; the first non-empty one fills the row. */
  lists: string[];
  /** Hidden fallback catalog (Cinemeta / Kitsu) used when every list is empty. */
  url: string;
  /** Row title when the fallback catalog is used (defaults to `title`). */
  fallbackTitle?: string;
}

/** Built-in rows of a section: TMDB lists first, Cinemeta/Kitsu catalog as fallback. */
export function sectionRowSpecs(section: HomeTabId): SectionRowSpec[] {
  const g = TMDB_GENRES;
  const cin = CINEMETA;
  const kit = KITSU;
  switch (section) {
    case 'home':
      return [
        { id: 'trend_movies', title: 'Tendencias de la semana · Películas', lists: ['cat:movie:trending'], url: `${cin}/catalog/movie/top.json` },
        { id: 'trend_series', title: 'Tendencias de la semana · Series', lists: ['cat:tv:trending'], url: `${cin}/catalog/series/top.json` },
        { id: 'popular_movies', title: 'Popular · Películas', lists: ['cat:movie:popular'], url: `${cin}/catalog/movie/imdbRating.json` },
        { id: 'popular_series', title: 'Popular · Series', lists: ['cat:tv:popular'], url: `${cin}/catalog/series/imdbRating.json` },
        { id: 'action_movies', title: 'Acción y aventura', lists: [`cat:movie:genre:${g.movie.action}`], url: `${cin}/catalog/movie/top/genre=Action.json` },
        { id: 'scifi_movies', title: 'Ciencia ficción', lists: [`cat:movie:genre:${g.movie.scifi}`], url: `${cin}/catalog/movie/top/genre=Sci-Fi.json` },
        { id: 'comedy_movies', title: 'Comedia', lists: [`cat:movie:genre:${g.movie.comedy}`], url: `${cin}/catalog/movie/top/genre=Comedy.json` },
      ];
    case 'movies':
      return [
        { id: 'm_top', title: 'Tendencias de la semana', lists: ['cat:movie:trending'], url: `${cin}/catalog/movie/top.json` },
        { id: 'm_rating', title: 'Popular · Películas', lists: ['cat:movie:popular'], url: `${cin}/catalog/movie/imdbRating.json` },
        { id: 'm_action', title: 'Acción', lists: [`cat:movie:genre:${g.movie.action}`], url: `${cin}/catalog/movie/top/genre=Action.json` },
        { id: 'm_horror', title: 'Terror y suspenso', lists: [`cat:movie:genre:${g.movie.horror}`], url: `${cin}/catalog/movie/top/genre=Horror.json` },
        { id: 'm_scifi', title: 'Ciencia ficción', lists: [`cat:movie:genre:${g.movie.scifi}`], url: `${cin}/catalog/movie/top/genre=Sci-Fi.json` },
        { id: 'm_comedy', title: 'Comedia', lists: [`cat:movie:genre:${g.movie.comedy}`], url: `${cin}/catalog/movie/top/genre=Comedy.json` },
        { id: 'm_drama', title: 'Drama', lists: [`cat:movie:genre:${g.movie.drama}`], url: `${cin}/catalog/movie/top/genre=Drama.json` },
      ];
    case 'series':
      return [
        { id: 's_top', title: 'Tendencias de la semana', lists: ['cat:tv:trending'], url: `${cin}/catalog/series/top.json` },
        { id: 's_rating', title: 'Popular · Series', lists: ['cat:tv:popular'], url: `${cin}/catalog/series/imdbRating.json` },
        { id: 's_drama', title: 'Drama', lists: [`cat:tv:genre:${g.tv.drama}`], url: `${cin}/catalog/series/top/genre=Drama.json` },
        { id: 's_crime', title: 'Crimen y misterio', lists: [`cat:tv:genre:${g.tv.crime}`], url: `${cin}/catalog/series/top/genre=Crime.json` },
        { id: 's_scifi', title: 'Ciencia ficción y fantasía', lists: [`cat:tv:genre:${g.tv.scifiFantasy}`], url: `${cin}/catalog/series/top/genre=Sci-Fi.json` },
        { id: 's_comedy', title: 'Comedia', lists: [`cat:tv:genre:${g.tv.comedy}`], url: `${cin}/catalog/series/top/genre=Comedy.json` },
      ];
    case 'kids':
      // Rule: Kids = all-ages ratings (MX "AA"/"A", US "G"/"PG" fallback; TV needs the Kids
      // genre) from TMDB; without a TMDB key, Cinemeta's Family genre (never general Animation).
      return [
        { id: 'k_movies', title: 'Películas para todos', lists: [KIDS_LISTS.moviesPopular], fallbackTitle: 'Películas familiares', url: `${cin}/catalog/movie/top/genre=Family.json` },
        { id: 'k_series', title: 'Series infantiles', lists: [KIDS_LISTS.tvPopular], fallbackTitle: 'Series para toda la familia', url: `${cin}/catalog/series/top/genre=Family.json` },
        { id: 'k_animated', title: 'Animadas para niños', lists: [KIDS_LISTS.moviesAnimated], fallbackTitle: 'Favoritas de la familia', url: `${cin}/catalog/movie/imdbRating/genre=Family.json` },
        { id: 'k_series_top', title: 'Las favoritas de los niños', lists: [KIDS_LISTS.tvTop], fallbackTitle: 'Series favoritas de la familia', url: `${cin}/catalog/series/imdbRating/genre=Family.json` },
      ];
    case 'anime':
      // Rule: Anime comes exclusively from anime lists (TMDB Japanese animation, then Kitsu).
      // First row: this season on TMDB, then this season on Kitsu, then Kitsu's trending catalog.
      return [
        { id: 'a_season', title: 'Tendencias de la temporada', lists: [ANIME_LISTS.season, ANIME_SEASON_LIST], fallbackTitle: 'Tendencias del anime', url: `${kit}/catalog/anime/kitsu-anime-trending.json` },
        { id: 'a_airing', title: 'En emisión', lists: [ANIME_LISTS.airing], url: `${kit}/catalog/anime/kitsu-anime-airing.json` },
        { id: 'a_popular', title: 'Más populares', lists: [ANIME_LISTS.popular], url: `${kit}/catalog/anime/kitsu-anime-popular.json` },
        { id: 'a_rated', title: 'Mejor valorados', lists: [ANIME_LISTS.top], url: `${kit}/catalog/anime/kitsu-anime-rating.json` },
        { id: 'a_movies', title: 'Películas de anime', lists: [ANIME_LISTS.movies], url: '' },
      ];
    default:
      return [];
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

function score(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n.toFixed(1) : '';
}

/** One item of a Kids TMDB list (`kids-*`) -> catalog item; null without an IMDb id. */
export function kidsTmdbItem(raw: Record<string, unknown>): MediaItem | null {
  const imdb = str(raw.imdbId);
  const title = str(raw.title);
  if (!/^tt\d{5,}$/.test(imdb) || !title) return null;
  const original = str(raw.original);
  return {
    id: `stremio:${imdb}`,
    type: raw.kind === 'tv' ? 'series' : 'movie',
    title,
    originalTitle: original && original !== title ? original : undefined,
    year: str(raw.year).slice(0, 4),
    score: score(raw.rating),
    duration: '',
    genres: Array.isArray(raw.genres) ? raw.genres.map(String) : [],
    synopsis: str(raw.overview),
    poster: str(raw.poster),
    backdrop: str(raw.backdrop),
    isAnime: false,
  };
}

/**
 * One item of any TMDB core list (`cat:*`, `kids-*`, `anime:*`, `find:`, related titles).
 * Anime keeps `tt…` ids (streams and episodes resolve by IMDb id) but is flagged as anime:
 * TV anime is typed `anime` (episodic, listed under Anime), anime films stay `movie`.
 */
export function tmdbListItem(raw: Record<string, unknown>, anime = false): MediaItem | null {
  const it = kidsTmdbItem(raw);
  if (!it || !anime) return it;
  return { ...it, type: it.type === 'series' ? 'anime' : 'movie', isAnime: true };
}

/** Maps one core list answer with the mapper that fits the list name. */
export function coreListItems(list: string, raw: Array<Record<string, unknown>>): MediaItem[] {
  const anime = list.startsWith('anime:');
  const map = list === ANIME_SEASON_LIST ? animeSeasonItem : (r: Record<string, unknown>) => tmdbListItem(r, anime);
  return raw.map(map).filter((x): x is MediaItem => x !== null);
}

/** One item of the Kitsu season list (`anime-season`) -> catalog item. */
export function animeSeasonItem(raw: Record<string, unknown>): MediaItem | null {
  const kitsuId = str(raw.kitsuId);
  const title = str(raw.title);
  if (!/^\d+$/.test(kitsuId) || !title) return null;
  const original = str(raw.original);
  return {
    id: `stremio:kitsu:${kitsuId}`,
    type: 'anime',
    title,
    originalTitle: original && original !== title ? original : undefined,
    year: str(raw.year).slice(0, 4),
    score: score(raw.rating),
    duration: '',
    genres: [],
    synopsis: str(raw.overview),
    poster: str(raw.poster),
    // No cover on Kitsu: leave it empty so the hero prefers titles with real artwork.
    backdrop: str(raw.backdrop),
    isAnime: true,
  };
}

/** Local calendar day ("2026-11-23"): the hero order changes once per day. */
export function localDayKey(date: Date = new Date()): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

/** FNV-1a 32-bit hash: stable seed from a string. */
function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic LCG (Numerical Recipes constants), same sequence as the Kotlin port. */
function nextRand(state: number): number {
  return (Math.imul(state, 1664525) + 1013904223) >>> 0;
}

/**
 * Daily hero rotation: picks `pick` items with a backdrop among the first `pool` items of the
 * row (seeded by `seedKey`, e.g. "anime:2026-11-23") and moves them to the front; the rest
 * keeps its order. Same key -> same order, so the hero is stable during the day.
 */
export function dailyHeroOrder<T extends { backdrop: string }>(
  items: T[],
  seedKey: string,
  pool = 20,
  pick = 6,
): T[] {
  const candidates = items.slice(0, pool).filter((it) => it.backdrop);
  if (candidates.length <= 1) return items;
  let state = hashSeed(seedKey);
  const shuffled = candidates.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    state = nextRand(state);
    const j = state % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const chosen = shuffled.slice(0, pick);
  const chosenSet = new Set(chosen);
  return [...chosen, ...items.filter((it) => !chosenSet.has(it))];
}
