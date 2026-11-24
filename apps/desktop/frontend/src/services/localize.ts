import type { Episode, MediaItem } from '../types/models';
import { desktopApi } from './tauri';

/**
 * Spanish metadata (title + synopsis) from TMDB through the Rust core, same source as the
 * Android app (`StremioClient.spanishInfo`): es-MX first, es-ES as fallback, then the
 * original Cinemeta text. Results are cached in memory and in localStorage so the UI never
 * waits twice for the same title.
 */
export interface SpanishInfo {
  tmdbId: string;
  kind: 'movie' | 'tv' | '';
  title: string;
  overview: string;
}

interface TextPair {
  title?: string;
  overview?: string;
}

const STORAGE_KEY = 'opentv_es_meta_v1';
const MAX_ENTRIES = 400;
const TTL_HIT_MS = 7 * 24 * 60 * 60_000;
const TTL_MISS_MS = 24 * 60 * 60_000;

interface StoredEntry {
  i: SpanishInfo | null;
  at: number;
}

const memory = new Map<string, StoredEntry>();
const inflight = new Map<string, Promise<SpanishInfo | null>>();
const seasonCache = new Map<string, Map<number, { title: string; overview: string }>>();
let loadedFromStorage = false;
let tmdbUnavailable = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function clean(s: unknown): string {
  return typeof s === 'string' ? s.trim() : '';
}

/** Picks the first non-blank title/overview among the Spanish candidates, else the original. */
export function pickLocalized(original: TextPair, ...candidates: Array<TextPair | null | undefined>): {
  title: string;
  overview: string;
} {
  let title = '';
  let overview = '';
  for (const c of candidates) {
    if (!c) continue;
    if (!title) title = clean(c.title);
    if (!overview) overview = clean(c.overview);
  }
  return {
    title: title || clean(original.title),
    overview: overview || clean(original.overview),
  };
}

/** TMDB fills untranslated episode names with "Episodio N"; the original name is better then. */
export function isGenericEpisodeTitle(title: string): boolean {
  return /^(episodio|episode|cap[ií]tulo)\s*\d+$/i.test(title.trim());
}

/** IMDb id (`tt123…`) for a catalog item, or '' when TMDB cannot resolve it (Kitsu, local…). */
export function imdbIdOf(item: Pick<MediaItem, 'id'>): string {
  const raw = item.id.replace(/^stremio:/, '').split(':')[0];
  return /^tt\d{5,}$/.test(raw) ? raw : '';
}

function isFresh(e: StoredEntry, now = Date.now()): boolean {
  return now - e.at < (e.i ? TTL_HIT_MS : TTL_MISS_MS);
}

function loadStorage(): void {
  if (loadedFromStorage) return;
  loadedFromStorage = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, StoredEntry>;
    const now = Date.now();
    for (const [k, v] of Object.entries(parsed || {})) {
      if (v && typeof v.at === 'number' && isFresh(v, now)) memory.set(k, v);
    }
  } catch {
    /* corrupted cache: ignore */
  }
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      while (memory.size > MAX_ENTRIES) {
        const oldest = memory.keys().next().value;
        if (!oldest) break;
        memory.delete(oldest);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(memory)));
    } catch {
      /* quota or private mode: memory cache still works */
    }
  }, 800);
}

function remember(id: string, info: SpanishInfo | null): void {
  memory.delete(id);
  memory.set(id, { i: info, at: Date.now() });
  schedulePersist();
}

/** Cached Spanish info, synchronously (undefined = not looked up yet). */
export function peekSpanishInfo(imdbId: string): SpanishInfo | null | undefined {
  if (!imdbId) return null;
  loadStorage();
  const hit = memory.get(imdbId);
  return hit && isFresh(hit) ? hit.i : undefined;
}

async function fetchSpanishInfo(imdbId: string): Promise<SpanishInfo | null> {
  const res = await desktopApi.tmdb<{
    item?: { tmdbId?: number | string; kind?: string; title?: string; overview?: string } | null;
    error?: string;
    unavailable?: boolean;
  }>(`es:${imdbId}`);
  if (res?.unavailable) {
    tmdbUnavailable = true;
    return null;
  }
  if (res?.error && !res.item) throw new Error(res.error);
  const it = res?.item;
  if (!it) return null;
  const tmdbId = String(it.tmdbId ?? '');
  const kind: SpanishInfo['kind'] = it.kind === 'tv' ? 'tv' : it.kind === 'movie' ? 'movie' : '';
  const mx: TextPair = { title: it.title, overview: it.overview };
  let es: TextPair | null = null;
  // es-MX without synopsis: try Spain's translation before falling back to the original.
  if (!clean(it.overview) && tmdbId && kind) {
    try {
      const raw = await desktopApi.tmdb<{ item?: Record<string, unknown> }>(
        `raw:/${kind}/${encodeURIComponent(tmdbId)}?language=es-ES`,
      );
      const r = raw?.item;
      if (r) es = { title: clean(r.title) || clean(r.name), overview: clean(r.overview) };
    } catch {
      /* optional */
    }
  }
  const picked = pickLocalized({}, mx, es);
  return { tmdbId, kind, title: picked.title, overview: picked.overview };
}

/** Spanish title/synopsis for an IMDb id; null when TMDB has nothing or is not configured. */
export async function spanishInfo(imdbId: string): Promise<SpanishInfo | null> {
  if (!imdbId || tmdbUnavailable) return null;
  const cached = peekSpanishInfo(imdbId);
  if (cached !== undefined) return cached;
  const pending = inflight.get(imdbId);
  if (pending) return pending;
  const req = (async () => {
    try {
      const info = await fetchSpanishInfo(imdbId);
      if (!tmdbUnavailable) remember(imdbId, info);
      return info;
    } catch {
      return null; // network error: not cached, retried next time
    } finally {
      inflight.delete(imdbId);
    }
  })();
  inflight.set(imdbId, req);
  return req;
}

/** Applies Spanish title/synopsis to an item (keeps the original text as fallback). */
export function applySpanish(item: MediaItem, info: SpanishInfo | null | undefined): MediaItem {
  if (!info) return item;
  const picked = pickLocalized({ title: item.title, overview: item.synopsis }, info);
  if (picked.title === item.title && picked.overview === item.synopsis) return item;
  return { ...item, title: picked.title, synopsis: picked.overview };
}

/** Synchronous version using only what is already cached (for first paint). */
export function peekLocalized(item: MediaItem): MediaItem {
  return applySpanish(item, peekSpanishInfo(imdbIdOf(item)));
}

export async function localizeItem(item: MediaItem): Promise<MediaItem> {
  const id = imdbIdOf(item);
  if (!id) return item;
  return applySpanish(item, await spanishInfo(id));
}

/** Spanish episode titles/overviews for one TMDB season (number → texts). */
export async function spanishSeason(
  tmdbId: string,
  season: number,
): Promise<Map<number, { title: string; overview: string }>> {
  const key = `${tmdbId}:${season}`;
  const hit = seasonCache.get(key);
  if (hit) return hit;
  const out = new Map<number, { title: string; overview: string }>();
  if (!/^\d+$/.test(tmdbId) || !Number.isInteger(season) || season < 0) return out;
  try {
    const res = await desktopApi.tmdb<{ episodes?: Array<{ number?: number; title?: string; overview?: string }> }>(
      `es-season:${tmdbId}:${season}`,
    );
    for (const e of res?.episodes || []) {
      if (typeof e.number === 'number') out.set(e.number, { title: clean(e.title), overview: clean(e.overview) });
    }
    if (out.size > 0) seasonCache.set(key, out);
  } catch {
    /* optional */
  }
  return out;
}

/** Translates episodes of a TV title (up to 12 seasons, fetched in parallel). */
export async function localizeEpisodes(info: SpanishInfo | null, episodes: Episode[]): Promise<Episode[]> {
  if (!info || info.kind !== 'tv' || !info.tmdbId || episodes.length === 0) return episodes;
  const seasons = Array.from(new Set(episodes.map((e) => e.season))).sort((a, b) => a - b).slice(0, 12);
  const maps = new Map(await Promise.all(seasons.map(async (s) => [s, await spanishSeason(info.tmdbId, s)] as const)));
  return episodes.map((ep) => {
    const tr = maps.get(ep.season)?.get(ep.number);
    if (!tr) return ep;
    const title = tr.title && !isGenericEpisodeTitle(tr.title) ? tr.title : ep.title;
    const overview = tr.overview || ep.overview;
    return title === ep.title && overview === ep.overview ? ep : { ...ep, title, overview };
  });
}

/** "Borrar caché": drops the cached Spanish metadata (memory + localStorage). */
export function clearLocalizeCache(): void {
  memory.clear();
  inflight.clear();
  seasonCache.clear();
  tmdbUnavailable = false;
  loadedFromStorage = true;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
