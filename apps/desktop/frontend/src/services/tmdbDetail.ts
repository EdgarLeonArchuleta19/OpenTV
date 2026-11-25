import type { Episode, MediaItem } from '../types/models';
import { tmdbListItem } from './sectionContent';

/**
 * Pure mappers for the core's TMDB title answers (no I/O):
 * - `detail:<imdbId>` -> `{ tmdbId, item: Item + { runtime }, director, cast, seasons, related }`
 * - `episodes:<tmdbTvId>:<season>` -> `{ episodes: [{ season, number, title, overview, still, airDate, runtime }] }`
 * Episode ids stay `tt…:season:episode` so stream lookup and watch progress keep working.
 */

export interface TmdbDetailAnswer {
  tmdbId?: number | string;
  item?: Record<string, unknown> | null;
  director?: unknown;
  cast?: unknown;
  seasons?: unknown;
  related?: unknown;
  error?: string;
  unavailable?: boolean;
}

export interface MappedTmdbDetail {
  tmdbId: string;
  isTv: boolean;
  item: MediaItem;
  /** Regular seasons (specials, season 0, only when nothing else exists). */
  seasons: number[];
  related: MediaItem[];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str).filter(Boolean) : [];
}

/** Minutes -> "142 min" (the format `formatDuration` expects); '' when unknown. */
export function runtimeLabel(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(str(v));
  return Number.isFinite(n) && n > 0 ? `${Math.round(n)} min` : '';
}

/**
 * Merges a `detail:` answer into the catalog item. Null when the answer is unusable
 * (error, unavailable, no item), so the caller falls back to Cinemeta.
 */
export function mapTmdbDetail(base: MediaItem, res: TmdbDetailAnswer | null | undefined): MappedTmdbDetail | null {
  if (!res || res.unavailable || !res.item || typeof res.item !== 'object') return null;
  const raw = res.item;
  const tmdbId = str(res.tmdbId ?? raw.tmdbId);
  const seasonsRaw = Array.isArray(res.seasons)
    ? Array.from(new Set(res.seasons.map(Number).filter((n) => Number.isInteger(n) && n >= 0))).sort((a, b) => a - b)
    : [];
  const regular = seasonsRaw.filter((n) => n > 0);
  const seasons = regular.length > 0 ? regular : seasonsRaw;
  const isTv = raw.kind === 'tv' || (raw.kind !== 'movie' && base.type !== 'movie');
  const anime = base.isAnime;

  const title = str(raw.title) || base.title;
  const original = str(raw.original);
  const rating = Number(raw.rating);
  const genres = strList(raw.genres);
  const cast = strList(res.cast).slice(0, 8);
  const director = strList(res.director).join(', ');

  const item: MediaItem = {
    ...base,
    type: anime ? (isTv ? 'anime' : 'movie') : isTv ? 'series' : 'movie',
    title,
    originalTitle: original && original !== title ? original : base.originalTitle,
    year: str(raw.year).slice(0, 4) || base.year,
    score: Number.isFinite(rating) && rating > 0 ? rating.toFixed(1) : base.score,
    duration: runtimeLabel(raw.runtime) || base.duration,
    genres: genres.length > 0 ? genres : base.genres,
    synopsis: str(raw.overview) || base.synopsis,
    poster: str(raw.poster) || base.poster,
    backdrop: str(raw.backdrop) || base.backdrop || base.poster,
    cast: cast.length > 0 ? cast : base.cast,
    director: director || base.director,
  };

  const related = (Array.isArray(res.related) ? (res.related as Array<Record<string, unknown>>) : [])
    .filter((r) => r && typeof r === 'object')
    .map((r) => tmdbListItem(r, anime))
    .filter((x): x is MediaItem => x !== null && x.id !== base.id)
    .slice(0, 16);

  return { tmdbId, isTv, item, seasons, related };
}

/** Maps an `episodes:` answer to playable episodes (`tt…:season:episode` ids). */
export function mapTmdbEpisodes(
  imdbId: string,
  season: number,
  raw: unknown,
  fallbackThumb: string,
): Episode[] {
  const list = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
  const seen = new Set<number>();
  const out: Episode[] = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const s = Number(e.season ?? season);
    const num = Number(e.number ?? e.episode);
    if (!Number.isInteger(s) || s !== season || !Number.isInteger(num) || num <= 0 || seen.has(num)) continue;
    seen.add(num);
    const runtime = Number(e.runtime);
    out.push({
      id: `${imdbId}:${season}:${num}`,
      season,
      number: num,
      title: str(e.title) || `Episodio ${num}`,
      overview: str(e.overview),
      thumbnail: str(e.still) || fallbackThumb,
      released: str(e.airDate).slice(0, 10),
      ...(Number.isFinite(runtime) && runtime > 0 ? { runtimeMin: Math.round(runtime) } : {}),
    });
  }
  return out.sort((a, b) => a.number - b.number);
}

/** Adds a season's episodes to the list (replacing that season), sorted by season/number. */
export function mergeSeasonEpisodes(current: Episode[], season: number, episodes: Episode[]): Episode[] {
  if (episodes.length === 0) return current;
  return [...current.filter((e) => e.season !== season), ...episodes].sort((a, b) =>
    a.season !== b.season ? a.season - b.season : a.number - b.number,
  );
}
