import type { MediaItem } from '../types/models';

/**
 * Content selection for the Kids and Anime sections (pure helpers, no I/O).
 *
 * - Kids: all-ages titles from TMDB through the Rust core (Mexico "AA"/"A", US "G"/"PG" only
 *   as fallback; TV needs the Kids genre). Lists named here are served by `tmdb.rs`.
 * - Anime: the current season on Kitsu (`kitsu:` ids, so the Anime Kitsu plugin still serves
 *   meta and episodes) plus the plugin's airing/popular/top-rated catalogs.
 * - The first row of both sections drives the hero: its order rotates once a day.
 */

export const KIDS_LISTS = {
  moviesPopular: 'kids-movies-popular',
  moviesAnimated: 'kids-movies-animated',
  tvPopular: 'kids-tv-popular',
  tvTop: 'kids-tv-top',
} as const;

export const ANIME_SEASON_LIST = 'anime-season';

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
