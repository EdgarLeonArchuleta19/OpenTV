import type {
  CatalogRow,
  Episode,
  ExternalSubtitle,
  HomeTabId,
  InstalledPlugin,
  MediaItem,
  PluginCatalogDef,
  StreamSource,
  TitleDetail,
} from '../types/models';
import { JS_PLUGIN_HOST_MAP, isBuiltinUrl, stremioBaseFromUrl } from './catalogs';
import { applySpanish, imdbIdOf, localizeEpisodes, spanishInfo } from './localize';
import { desktopApi } from './tauri';
import { coreListItems, dailyHeroOrder, kidsTmdbItem, localDayKey, sectionRowSpecs, type SectionRowSpec } from './sectionContent';
import { CATALOG_FRESH_MS, PersistentJsonCache, isPersistableCatalogUrl, swrState } from './catalogStore';
import { mapTmdbDetail, mapTmdbEpisodes, type TmdbDetailAnswer } from './tmdbDetail';
import { isLatamSpanish, orderSubtitles } from './subtitles';
import { settleInOrder } from './progressive';
import { orderSearchResults } from './searchRank';

interface CacheEntry {
  data: Record<string, unknown>;
  expiresAt: number;
}

const MAX_CACHE_ENTRIES = 200;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<Record<string, unknown> | null>>();

// Last browse-catalog answers persisted across restarts (stale-while-revalidate).
const persisted = new PersistentJsonCache('opentv_catalog_cache_v2', 90);

/** "Borrar caché": drops cached catalog/meta/stream JSON; rows on screen stay until the next load. */
export function clearCatalogCache(): void {
  cache.clear();
  inflight.clear();
  persisted.clear();
  clearCoreListCache();
}

async function getJson(url: string, ttlMs = 10 * 60_000): Promise<Record<string, unknown> | null> {
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && hit.expiresAt > now) {
    // Refresh LRU position
    cache.delete(url);
    cache.set(url, hit);
    return hit.data;
  }

  const pending = inflight.get(url);
  if (pending) return pending;

  // Persisted catalog: fresh -> no network; stale -> answer now and refresh in the background.
  const persist = ttlMs > 0 && isPersistableCatalogUrl(url);
  if (persist) {
    const stored = persisted.get(url);
    const state = stored ? swrState(now - stored.at) : 'expired';
    if (stored && state !== 'expired') {
      cache.set(url, { data: stored.d, expiresAt: state === 'fresh' ? stored.at + CATALOG_FRESH_MS : now + ttlMs });
      if (state === 'stale') void fetchJson(url, ttlMs, true);
      return stored.d;
    }
  }

  return fetchJson(url, ttlMs, persist);
}

function fetchJson(url: string, ttlMs: number, persist: boolean): Promise<Record<string, unknown> | null> {
  const pending = inflight.get(url);
  if (pending) return pending;

  const req = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 14_000);
      const resp = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      clearTimeout(timer);
      if (!resp.ok) return null;
      const data = (await resp.json()) as Record<string, unknown>;
      if (persist && Array.isArray(data.metas) && data.metas.length > 0) persisted.set(url, data);
      if (ttlMs > 0) {
        cache.delete(url);
        cache.set(url, { data, expiresAt: Date.now() + ttlMs });
        if (cache.size > MAX_CACHE_ENTRIES) {
          const t = Date.now();
          for (const [k, v] of cache) {
            if (v.expiresAt < t) cache.delete(k);
          }
          while (cache.size > MAX_CACHE_ENTRIES) {
            const oldest = cache.keys().next().value;
            if (!oldest) break;
            cache.delete(oldest);
          }
        }
      }
      return data;
    } catch {
      return null;
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, req);
  return req;
}

export function normalizeManifestUrl(input: string): string {
  const clean = input.trim().replace(/^stremio:\/\//i, 'https://');
  if (/\/(manifest|kino-plugin)\.json(\?.*)?$/i.test(clean)) return clean;
  return `${clean.replace(/\/$/, '')}/manifest.json`;
}

function resolveKinoRawBase(input: string): string | null {
  const clean = input.trim();
  if (/raw\.githubusercontent\.com.*kino-plugin\.json/i.test(clean)) {
    return clean.replace(/\/kino-plugin\.json(\?.*)?$/i, '').replace(/\/$/, '');
  }
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(clean)) {
    return `https://raw.githubusercontent.com/${clean}/HEAD`;
  }
  const gh = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i.exec(clean);
  if (gh) return `https://raw.githubusercontent.com/${gh[1].replace(/\.git$/i, '')}/HEAD`;
  const hm = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})(?:\/.*)?$/i.exec(clean);
  if (hm) {
    const mapped = JS_PLUGIN_HOST_MAP[hm[1].toLowerCase()];
    if (mapped) return `https://raw.githubusercontent.com/${mapped}/HEAD`;
  }
  return null;
}

function resolveLogoUrl(raw: unknown, base: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https:\/\//i.test(s)) return s;
  if (/^http:\/\//i.test(s)) return s.replace(/^http:\/\//i, 'https://');
  if (s.startsWith('//')) return `https:${s}`;
  return `${base.replace(/\/$/, '')}/${s.replace(/^\//, '')}`;
}

export type PluginInspectResult =
  | { kind: 'plugin'; plugin: InstalledPlugin }
  | { kind: 'collection'; name: string; addons: Array<{ name: string; url: string; description: string; logo?: string }> };

async function fetchStremioAddonCollection(
  baseUrl: string,
  addonCatalogs: Array<Record<string, unknown>>,
): Promise<Array<{ name: string; url: string; description: string; logo?: string }>> {
  const out: Array<{ name: string; url: string; description: string; logo?: string }> = [];
  const seen = new Set<string>();
  for (const cat of addonCatalogs.slice(0, 4)) {
    const type = String(cat.type || 'all');
    const id = String(cat.id || '').trim();
    if (!id) continue;
    const data = await getJson(`${baseUrl}/addon_catalog/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`, 0);
    const addons = Array.isArray(data?.addons) ? (data.addons as Array<Record<string, unknown>>) : [];
    for (const ad of addons) {
      const transportUrl = String(ad.transportUrl || ad.url || '').trim();
      if (!/^https?:\/\//i.test(transportUrl)) continue;
      const manifest = (ad.manifest && typeof ad.manifest === 'object') ? (ad.manifest as Record<string, unknown>) : ad;
      const name = String(manifest.name || ad.name || '').trim();
      if (!name) continue;
      const key = transportUrl.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name,
        url: transportUrl,
        description: String(manifest.description || ad.description || ''),
        logo: typeof manifest.logo === 'string' ? manifest.logo : undefined,
      });
      if (out.length >= 30) return out;
    }
  }
  return out;
}

export async function inspectPlugin(rawInput: string): Promise<PluginInspectResult> {
  const input = rawInput.trim();
  if (!input) throw new Error('Ingresa un enlace o repositorio válido');

  const kinoBase = resolveKinoRawBase(input);
  if (kinoBase) {
    const manifestUrl = `${kinoBase}/kino-plugin.json`;
    const res = await desktopApi.service<{ ok?: boolean; text?: string; error?: string }>('pluginFetch', {
      url: manifestUrl,
      method: 'GET',
      timeoutMs: 12_000,
    });
    let manifest: Record<string, unknown> | null = null;
    if (res.ok && res.text) {
      manifest = JSON.parse(res.text) as Record<string, unknown>;
    } else {
      manifest = await getJson(manifestUrl, 0);
    }
    if (!manifest || !manifest.id || !manifest.name) {
      throw new Error('No se encontró un kino-plugin.json válido');
    }
    const caps = Array.isArray(manifest.capabilities) ? (manifest.capabilities as string[]) : [];
    return {
      kind: 'plugin',
      plugin: {
        id: `kino_${String(manifest.id)}`,
        name: String(manifest.name),
        url: manifestUrl,
        baseUrl: kinoBase,
        kind: 'kino-js',
        description: String(manifest.description || ''),
        logo: resolveLogoUrl(manifest.icon || manifest.logo, kinoBase),
        version: String(manifest.version || ''),
        builtin: false,
        disabled: false,
        allowLan: false,
        hasCatalog: caps.includes('home') || caps.includes('search'),
        hasStream: true,
        hasSubtitles: false,
        hasMeta: caps.includes('episodes'),
        types: ['movie', 'series'],
        catalogs: [],
        rawRepoBase: kinoBase,
      },
    };
  }

  const url = normalizeManifestUrl(input);
  const manifest = await getJson(url, 0);
  if (!manifest) throw new Error('No se pudo leer el manifiesto del plugin');

  const id = String(manifest.id || stremioBaseFromUrl(url));
  const name = String(manifest.name || id);
  const baseUrl = url.replace(/\/manifest\.json(\?.*)?$/i, '').replace(/\/$/, '');
  const resources = Array.isArray(manifest.resources) ? manifest.resources : [];

  let hasCatalog = false;
  let hasStream = false;
  let hasSubtitles = false;
  let hasMeta = false;
  for (const r of resources) {
    const rName = typeof r === 'string' ? r : String((r as Record<string, unknown>).name || '');
    if (rName === 'catalog') hasCatalog = true;
    else if (rName === 'stream') hasStream = true;
    else if (rName === 'subtitles') hasSubtitles = true;
    else if (rName === 'meta') hasMeta = true;
  }

  const rawCatalogs = Array.isArray(manifest.catalogs) ? (manifest.catalogs as Array<Record<string, unknown>>) : [];
  const catalogs: PluginCatalogDef[] = rawCatalogs
    .filter((c) => c && c.type && c.id)
    .map((c) => {
      const extras = Array.isArray(c.extra) ? (c.extra as Array<Record<string, unknown>>) : [];
      const searchEx = extras.find((e) => e.name === 'search');
      const genreEx = extras.find((e) => e.name === 'genre');
      return {
        type: String(c.type),
        id: String(c.id),
        name: String(c.name || c.id),
        supportsSearch: Boolean(searchEx),
        searchRequired: Boolean(searchEx?.isRequired),
        genres: Array.isArray(genreEx?.options) ? (genreEx.options as string[]) : [],
      };
    });

  const addonCatalogs = Array.isArray(manifest.addonCatalogs)
    ? (manifest.addonCatalogs as Array<Record<string, unknown>>)
    : [];
  const isCollectionOnly =
    addonCatalogs.length > 0 && !hasStream && !hasSubtitles && !hasMeta && catalogs.length === 0;
  if (isCollectionOnly) {
    const addons = await fetchStremioAddonCollection(baseUrl, addonCatalogs);
    return { kind: 'collection', name, addons };
  }

  return {
    kind: 'plugin',
    plugin: {
      id,
      name,
      url,
      baseUrl,
      kind: 'stremio',
      description: String(manifest.description || ''),
      logo: resolveLogoUrl(manifest.logo || manifest.icon, baseUrl),
      version: String(manifest.version || ''),
      builtin: isBuiltinUrl(url),
      disabled: false,
      allowLan: false,
      hasCatalog: hasCatalog || catalogs.length > 0,
      hasStream,
      hasSubtitles,
      hasMeta,
      types: Array.isArray(manifest.types) ? (manifest.types as string[]) : [],
      catalogs,
    },
  };
}

function parseMetaSummary(raw: Record<string, unknown>, forceAnime: boolean): MediaItem | null {
  const rawId = String(raw.id || '').trim();
  const title = String(raw.name || '').trim();
  if (!rawId || !title) return null;
  const rawType = String(raw.type || (forceAnime ? 'anime' : 'movie'));
  const isAnime = forceAnime || rawType === 'anime' || rawId.startsWith('kitsu:');
  const genres = Array.isArray(raw.genres) ? (raw.genres as string[]).map(String) : [];
  return {
    id: rawId.startsWith('stremio:') ? rawId : `stremio:${rawId}`,
    type: isAnime ? 'anime' : rawType === 'series' ? 'series' : 'movie',
    title,
    year: String(raw.releaseInfo || raw.year || '').slice(0, 4),
    score: String(raw.imdbRating || ''),
    duration: String(raw.runtime || ''),
    genres,
    synopsis: String(raw.description || ''),
    poster: String(raw.poster || ''),
    backdrop: String(raw.background || raw.poster || ''),
    logo: String(raw.logo || ''),
    isAnime,
  };
}

/**
 * Loads a section's rows in parallel. `onProgress` receives the rows in display order as
 * soon as the top ones are ready (the first row never waits for the slowest catalog).
 */
export async function loadCatalogSection(
  section: HomeTabId,
  plugins: InstalledPlugin[],
  onProgress?: (rows: CatalogRow[], done: boolean) => void,
): Promise<CatalogRow[]> {
  // Every built-in row: TMDB lists through the core first, Cinemeta/Kitsu catalog (`url`) as
  // the hidden fallback (no TMDB key, offline, empty answer).
  const specs: SectionRowSpec[] = sectionRowSpecs(section);

  // Include user-installed catalog plugins (respecting Anime-only rule)
  for (const p of plugins) {
    if (p.disabled || p.kind !== 'stremio' || p.builtin || !p.baseUrl) continue;
    for (const cat of p.catalogs) {
      if (cat.searchRequired) continue;
      const match =
        (section === 'anime' && cat.type === 'anime') ||
        (section === 'movies' && cat.type === 'movie') ||
        (section === 'series' && cat.type === 'series') ||
        (section === 'home' && (cat.type === 'movie' || cat.type === 'series'));
      if (match && specs.length < 13) {
        specs.push({
          id: `ext_${p.id}_${cat.type}_${cat.id}`,
          title: `${cat.name} · ${p.name}`,
          url: `${p.baseUrl}/catalog/${cat.type}/${cat.id}.json`,
          lists: [],
        });
      }
    }
  }

  return settleInOrder(
    specs.map(async (s, index): Promise<CatalogRow | null> => {
      let title = s.title;
      let items: MediaItem[] = [];
      for (const list of s.lists) {
        items = await loadCoreList(list);
        if (items.length > 0) break;
      }
      if (items.length === 0) {
        if (s.lists.length > 0 && s.fallbackTitle) title = s.fallbackTitle;
        // A TMDB-only row (no Cinemeta/Kitsu twin) is simply left out when TMDB is unavailable.
        const data = s.url ? await getJson(s.url) : null;
        const metas = Array.isArray(data?.metas) ? (data.metas as Array<Record<string, unknown>>) : [];
        const forceAnime = section === 'anime';
        items = metas
          .map((m) => parseMetaSummary(m, forceAnime))
          .filter((x): x is MediaItem => x !== null);
        if (section === 'kids') {
          items = items.filter((it) => it.genres.length === 0 || it.genres.some((g) => g.toLowerCase() === 'family'));
        }
      }
      // The first row feeds the hero: rotate its picks once a day.
      if (index === 0 && (section === 'kids' || section === 'anime')) {
        items = dailyHeroOrder(items, `${section}:${localDayKey()}`);
      }
      items = items.slice(0, 30);
      if (items.length === 0) return null;
      return { id: s.id, title, items };
    }),
    onProgress,
  );
}

// Titles seen in the all-ages Kids lists: the Kids profile search also accepts them.
const kidsApprovedIds = new Set<string>();

// In-memory cache for the core's TMDB/Kitsu rows: tab switches and the idle prefetch reuse
// them instead of a ~300 ms IPC + network round trip each time. The last answers are also
// persisted (stale-while-revalidate) so every section paints at once on startup.
const CORE_LIST_TTL_MS = 30 * 60_000;
// No TMDB key: skip the core for a while instead of asking it again for every row.
const CORE_UNAVAILABLE_RETRY_MS = 5 * 60_000;
const coreListCache = new Map<string, { at: number; items: MediaItem[] }>();
const coreListInflight = new Map<string, Promise<MediaItem[]>>();
const persistedCoreLists = new PersistentJsonCache('opentv_core_list_cache_v2', 60);
// v1 rows predate the "already released" filter: drop them so they are never shown again.
try {
  localStorage.removeItem('opentv_core_list_cache_v1');
  localStorage.removeItem('opentv_catalog_cache_v1');
} catch {
  /* storage unavailable */
}
let coreUnavailableUntil = 0;

/** Drops the cached core rows, title details and episodes ("Borrar caché"). */
export function clearCoreListCache(): void {
  coreListCache.clear();
  persistedCoreLists.clear();
  coreUnavailableUntil = 0;
  detailCache.clear();
  seasonCache.clear();
}

function rememberCoreList(list: string, items: MediaItem[]): void {
  if (list.startsWith('kids-')) for (const it of items) kidsApprovedIds.add(it.id);
}

/** Row served by the Rust core (`cat:*`, `kids-*`, `anime:*`, `anime-season`); [] when unavailable. */
async function loadCoreList(list: string): Promise<MediaItem[]> {
  const now = Date.now();
  const hit = coreListCache.get(list);
  if (hit && now - hit.at < CORE_LIST_TTL_MS) return hit.items;
  const pending = coreListInflight.get(list);
  if (pending) return pending;

  const stored = persistedCoreLists.get(list);
  const state = stored ? swrState(now - stored.at) : 'expired';
  if (stored && state !== 'expired' && Array.isArray(stored.d.items)) {
    const items = stored.d.items as MediaItem[];
    rememberCoreList(list, items);
    coreListCache.set(list, { at: state === 'fresh' ? now : now - CORE_LIST_TTL_MS + 60_000, items });
    if (state === 'stale') void refreshCoreList(list);
    return items;
  }
  return refreshCoreList(list);
}

function refreshCoreList(list: string): Promise<MediaItem[]> {
  const pending = coreListInflight.get(list);
  if (pending) return pending;
  const p = fetchCoreList(list).then((items) => {
    if (items.length > 0) {
      coreListCache.set(list, { at: Date.now(), items });
      persistedCoreLists.set(list, { items });
    }
    coreListInflight.delete(list);
    return items;
  });
  coreListInflight.set(list, p);
  return p;
}

async function fetchCoreList(list: string): Promise<MediaItem[]> {
  // Kitsu's season list does not need TMDB.
  if (list !== 'anime-season' && Date.now() < coreUnavailableUntil) return [];
  try {
    const res = await desktopApi.tmdb<{ items?: Array<Record<string, unknown>>; unavailable?: boolean }>(list);
    if (res?.unavailable) {
      coreUnavailableUntil = Date.now() + CORE_UNAVAILABLE_RETRY_MS;
      return [];
    }
    const raw = Array.isArray(res?.items) ? res.items : [];
    const items = coreListItems(list, raw);
    rememberCoreList(list, items);
    return items;
  } catch {
    return [];
  }
}

// TMDB title details (`detail:`) and seasons (`episodes:`), kept for the session.
const detailCache = new Map<string, Promise<TmdbDetailAnswer | null>>();
const seasonCache = new Map<string, Promise<Episode[]>>();

function fetchTmdbDetail(imdbId: string): Promise<TmdbDetailAnswer | null> {
  const hit = detailCache.get(imdbId);
  if (hit) return hit;
  const p = desktopApi
    .tmdb<TmdbDetailAnswer>(`detail:${imdbId}`)
    .then((res) => {
      if (res?.unavailable) coreUnavailableUntil = Date.now() + CORE_UNAVAILABLE_RETRY_MS;
      if (!res || res.unavailable || !res.item) detailCache.delete(imdbId);
      return res ?? null;
    })
    .catch(() => {
      detailCache.delete(imdbId);
      return null;
    });
  detailCache.set(imdbId, p);
  return p;
}

/** Episodes of one TMDB season (`tt…:season:episode` ids); [] on error. Cached per season. */
function fetchTmdbSeason(tmdbTvId: string, imdbId: string, season: number, fallbackThumb: string): Promise<Episode[]> {
  const key = `${tmdbTvId}:${season}`;
  const hit = seasonCache.get(key);
  if (hit) return hit;
  const p = desktopApi
    .tmdb<{ episodes?: unknown }>(`episodes:${tmdbTvId}:${season}`)
    .then((res) => mapTmdbEpisodes(imdbId, season, res?.episodes, fallbackThumb))
    .catch(() => [] as Episode[])
    .then((eps) => {
      if (eps.length === 0) seasonCache.delete(key);
      return eps;
    });
  seasonCache.set(key, p);
  return p;
}

/**
 * Episodes of `season` for a title whose detail came from TMDB (`detail.tmdbTvId`); the
 * detail screen calls it when the season selector changes and to prefetch the next season.
 */
export async function loadSeasonEpisodes(detail: TitleDetail, season: number): Promise<Episode[]> {
  const imdb = imdbIdOf(detail.item);
  if (!detail.tmdbTvId || !imdb || !detail.seasons.includes(season)) return [];
  return fetchTmdbSeason(detail.tmdbTvId, imdb, season, detail.item.backdrop);
}

/**
 * Title detail. `tt…` ids: TMDB through the core first (Spanish text, cast, director, runtime,
 * related; episodes per season, the preferred one first), Cinemeta + `localize.ts` as fallback.
 * `kitsu:` ids keep the Anime Kitsu path.
 */
export async function loadTitleDetail(item: MediaItem, preferredSeason?: number): Promise<TitleDetail> {
  const imdb = imdbIdOf(item);
  if (imdb && !item.id.replace(/^stremio:/, '').startsWith('kitsu:')) {
    const fromTmdb = await loadTmdbTitleDetail(item, imdb, preferredSeason);
    if (fromTmdb) return fromTmdb;
  }
  return loadFallbackTitleDetail(item);
}

async function loadTmdbTitleDetail(item: MediaItem, imdb: string, preferredSeason?: number): Promise<TitleDetail | null> {
  if (Date.now() < coreUnavailableUntil) return null;
  const mapped = mapTmdbDetail(item, await fetchTmdbDetail(imdb));
  if (!mapped) return null;
  if (!mapped.isTv) return { item: mapped.item, episodes: [], seasons: [], related: mapped.related };

  const seasons = mapped.seasons;
  const first = preferredSeason && seasons.includes(preferredSeason) ? preferredSeason : seasons[0];
  const episodes =
    mapped.tmdbId && first !== undefined ? await fetchTmdbSeason(mapped.tmdbId, imdb, first, mapped.item.backdrop) : [];
  if (episodes.length > 0) {
    return { item: mapped.item, episodes, seasons, related: mapped.related, tmdbTvId: mapped.tmdbId };
  }
  // TMDB text but no episode list: keep the Spanish detail, take the episodes from Cinemeta.
  const fallback = await loadFallbackTitleDetail(mapped.item);
  return { ...fallback, item: mapped.item, related: mapped.related.length > 0 ? mapped.related : fallback.related };
}

/** Hidden fallback: Cinemeta (or Anime Kitsu for `kitsu:` ids) + Spanish text from `localize.ts`. */
async function loadFallbackTitleDetail(item: MediaItem): Promise<TitleDetail> {
  const rawId = item.id.replace(/^stremio:/, '');
  const isKitsu = rawId.startsWith('kitsu:') || (item.isAnime && !imdbIdOf(item));
  const base = isKitsu ? 'https://anime-kitsu.strem.fun' : 'https://v3-cinemeta.strem.io';
  const reqType = isKitsu ? 'anime' : item.type === 'movie' ? 'movie' : 'series';

  // Spanish title/synopsis (TMDB es-MX → es-ES) fetched in parallel with the Cinemeta meta.
  const esPromise = spanishInfo(imdbIdOf(item));
  const data = await getJson(`${base}/meta/${reqType}/${encodeURIComponent(rawId)}.json`);
  const meta = (data?.meta as Record<string, unknown> | undefined) || null;

  const enrichedBase: MediaItem = meta
    ? {
        ...item,
        title: String(meta.name || item.title),
        year: String(meta.releaseInfo || meta.year || item.year).slice(0, 4),
        score: String(meta.imdbRating || item.score),
        duration: String(meta.runtime || item.duration),
        genres: Array.isArray(meta.genres) && meta.genres.length > 0 ? (meta.genres as string[]) : item.genres,
        synopsis: String(meta.description || item.synopsis),
        poster: String(meta.poster || item.poster),
        backdrop: String(meta.background || item.backdrop || item.poster),
        logo: String(meta.logo || item.logo || ''),
        cast: Array.isArray(meta.cast) ? (meta.cast as string[]).slice(0, 8) : item.cast,
        director: Array.isArray(meta.director) ? (meta.director as string[]).join(', ') : item.director,
      }
    : item;
  const es = await esPromise;
  // Cinemeta's English text is only the fallback: never let it override the localized one.
  const enriched = applySpanish(enrichedBase, es);

  const videos = Array.isArray(meta?.videos) ? (meta.videos as Array<Record<string, unknown>>) : [];
  const rawEpisodes: Episode[] = videos
    .map((v): Episode | null => {
      const season = Number(v.season ?? 1);
      const num = Number(v.episode ?? v.number ?? 0);
      if (!Number.isFinite(season) || season <= 0 || !Number.isFinite(num) || num <= 0) return null;
      return {
        id: String(v.id || `${rawId}:${season}:${num}`),
        season,
        number: num,
        title: String(v.title || v.name || `Episodio ${num}`),
        overview: String(v.overview || v.description || ''),
        thumbnail: String(v.thumbnail || enriched.backdrop),
        released: String(v.released || '').slice(0, 10),
      };
    })
    .filter((e): e is Episode => e !== null)
    .sort((a, b) => (a.season !== b.season ? a.season - b.season : a.number - b.number));
  const episodes = await localizeEpisodes(es, rawEpisodes);

  const seasons = Array.from(new Set(episodes.map((e) => e.season))).sort((a, b) => a - b);

  // Related titles ("Quizás te guste")
  const primaryGenre = enriched.genres.find((g) => g.toLowerCase() !== 'animation');
  let related: MediaItem[] = [];
  if (primaryGenre && reqType !== 'anime') {
    const rel = await getJson(
      `https://v3-cinemeta.strem.io/catalog/${reqType}/top/genre=${encodeURIComponent(primaryGenre)}.json`,
    );
    const rMetas = Array.isArray(rel?.metas) ? (rel.metas as Array<Record<string, unknown>>) : [];
    related = rMetas
      .map((m) => parseMetaSummary(m, false))
      .filter((x): x is MediaItem => x !== null && x.id !== enriched.id)
      .slice(0, 16);
  }

  return { item: enriched, episodes, seasons, related };
}

export async function fetchStremioStreams(
  item: MediaItem,
  episode: Episode | null,
  plugins: InstalledPlugin[],
): Promise<Array<Partial<StreamSource> & Pick<StreamSource, 'id' | 'addonId' | 'addonName'>>> {
  const rawId = item.id.replace(/^stremio:/, '');
  const streamId = episode
    ? episode.id.includes(':')
      ? episode.id
      : `${rawId}:${episode.season}:${episode.number}`
    : rawId;
  const reqType = rawId.startsWith('kitsu:') || item.type !== 'movie' ? 'series' : 'movie';
  const encId = encodeURIComponent(streamId);

  const isDirectSource = (url: string) => /^magnet:\?/i.test(url) || /^https?:\/\/.+\.(mp4|mkv|webm|avi|mov|m4v|ts|m3u8)(\?|#|$)/i.test(url);
  const streamPlugins = plugins.filter(
    (p) => !p.disabled && p.kind === 'stremio' && p.hasStream && (p.baseUrl || isDirectSource(p.url)),
  );
  const batches = await Promise.all(
    streamPlugins.map(async (plugin) => {
      if (!plugin.baseUrl && isDirectSource(plugin.url)) {
        const url = plugin.url;
        const isMagnet = /^magnet:\?/i.test(url);
        const infoHash = (isMagnet ? /btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i.exec(url)?.[1] : '') || '';
        return [{
          id: `${plugin.id}_direct`,
          addonId: plugin.id,
          addonName: plugin.name,
          name: plugin.name,
          title: isMagnet ? 'Magnet directo' : 'Enlace directo',
          url: isMagnet ? '' : url,
          infoHash,
          filename: '',
          trackers: [] as string[],
          headers: {} as Record<string, string>,
        }];
      }
      const data = await getJson(`${plugin.baseUrl}/stream/${reqType}/${encId}.json`, 3 * 60_000);
      const arr = Array.isArray(data?.streams) ? (data.streams as Array<Record<string, unknown>>) : [];
      return arr
        .map((s, idx) => {
          const url = String(s.url || '');
          const infoHash = String(s.infoHash || '');
          if (!url && !infoHash) return null;
          const bh = (s.behaviorHints as Record<string, unknown> | undefined) || {};
          const ph = (bh.proxyHeaders as Record<string, unknown> | undefined) || {};
          const reqHdrs = (ph.request as Record<string, string> | undefined) || {};
          const trackers = Array.isArray(s.sources)
            ? (s.sources as string[]).filter((x) => typeof x === 'string' && x.startsWith('tracker:')).map((x) => x.slice(8))
            : [];
          return {
            id: `${plugin.id}_${infoHash || idx}_${idx}`,
            addonId: plugin.id,
            addonName: plugin.name,
            name: String(s.name || plugin.name),
            title: String(s.title || s.description || ''),
            url,
            infoHash,
            fileIdx: typeof s.fileIdx === 'number' ? s.fileIdx : undefined,
            filename: String(bh.filename || ''),
            trackers,
            headers: reqHdrs,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
    }),
  );

  return batches.flat();
}

/**
 * External subtitles in display order: OpenSubtitles (and other subtitle plugins), then SubDL.
 * `onPartial` gets the plugin subtitles first so a slow SubDL answer never delays them.
 */
export async function fetchExternalSubtitles(
  item: MediaItem,
  episode: Episode | null,
  plugins: InstalledPlugin[],
  onPartial?: (subs: ExternalSubtitle[]) => void,
): Promise<ExternalSubtitle[]> {
  const rawId = item.id.replace(/^stremio:/, '');
  const subId = episode
    ? episode.id.includes(':')
      ? episode.id
      : `${rawId}:${episode.season}:${episode.number}`
    : rawId;
  const reqType = item.type === 'movie' ? 'movie' : 'series';
  const encId = encodeURIComponent(subId);

  const subPlugins = plugins.filter((p) => !p.disabled && p.kind === 'stremio' && p.hasSubtitles && p.baseUrl);
  const pluginBatches = Promise.all(
    subPlugins.map(async (plugin) => {
      const data = await getJson(`${plugin.baseUrl}/subtitles/${reqType}/${encId}.json`, 15 * 60_000);
      const arr = Array.isArray(data?.subtitles) ? (data.subtitles as Array<Record<string, unknown>>) : [];
      const isOpenSubs = plugin.builtin && /opensubtitles/i.test(plugin.baseUrl);
      return arr
        .map((s, idx): ExternalSubtitle | null => {
          const url = String(s.url || '');
          if (!url.startsWith('http')) return null;
          const lang = String(s.lang || '').toLowerCase();
          return {
            id: `${plugin.id}_${idx}`,
            url,
            lang,
            label: langName(lang),
            // The bundled plugin is shown as the subtitle service, never as a plugin.
            source: isOpenSubs ? 'OpenSubtitles' : plugin.name,
            origin: isOpenSubs ? 'opensubtitles' : 'plugin',
          };
        })
        .filter((x): x is ExternalSubtitle => x !== null);
    }),
  );
  const subdl = fetchSubdlSubtitles(item, episode);

  const seen = new Set<string>();
  const unique = (list: ExternalSubtitle[]) =>
    list.filter((s) => {
      if (seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });
  // Each source keeps its best entries so a long OpenSubtitles list never hides SubDL.
  const fromPlugins = orderSubtitles(unique((await pluginBatches).flat())).slice(0, 24);
  if (onPartial && fromPlugins.length > 0) onPartial(fromPlugins);
  const fromSubdl = orderSubtitles(unique(await subdl)).slice(0, 12);
  return orderSubtitles([...fromPlugins, ...fromSubdl]);
}

/** SubDL through the core (`subdlSearch`); [] when it is not configured or fails. */
async function fetchSubdlSubtitles(item: MediaItem, episode: Episode | null): Promise<ExternalSubtitle[]> {
  const imdbId = imdbIdOf(item);
  if (!imdbId) return [];
  try {
    const params: Record<string, unknown> = { imdbId, kind: item.type === 'movie' ? 'movie' : 'series' };
    if (episode && item.type !== 'movie') {
      params.season = episode.season;
      params.episode = episode.number;
    }
    const res = await desktopApi.service<{
      available?: boolean;
      subtitles?: Array<{ id?: string; lang?: string; label?: string; url?: string }>;
    }>('subdlSearch', params);
    if (!res || res.available === false || !Array.isArray(res.subtitles)) return [];
    return res.subtitles
      .map((s, idx): ExternalSubtitle | null => {
        const url = String(s?.url || '');
        if (!/^https?:\/\//i.test(url)) return null;
        const lang = String(s.lang || '').toLowerCase();
        const label = String(s.label || '').trim();
        return {
          id: `subdl_${s.id || idx}`,
          url,
          lang,
          label: label && /[a-záéíóúñ]/i.test(label) && !/^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(label) ? label : langName(lang),
          source: 'SubDL',
          origin: 'subdl',
        };
      })
      .filter((x): x is ExternalSubtitle => x !== null);
  } catch {
    return [];
  }
}

export async function searchAllCatalogs(
  query: string,
  kidsOnly: boolean,
  onPartial?: (items: MediaItem[]) => void,
): Promise<MediaItem[]> {
  const clean = query.trim();
  if (clean.length < 2) return [];

  const urlsFor = (q: string): Array<{ url: string; anime: boolean }> => {
    const enc = encodeURIComponent(q);
    const out = [
      { url: `https://v3-cinemeta.strem.io/catalog/movie/top/search=${enc}.json`, anime: false },
      { url: `https://v3-cinemeta.strem.io/catalog/series/top/search=${enc}.json`, anime: false },
    ];
    if (!kidsOnly) {
      out.push({ url: `https://anime-kitsu.strem.fun/catalog/anime/kitsu-anime-trending/search=${enc}.json`, anime: true });
    }
    return out;
  };
  const fetchBatch = (list: Array<{ url: string; anime: boolean }>) =>
    Promise.all(
      list.map(async ({ url, anime }) => {
        const data = await getJson(url, 5 * 60_000);
        const metas = Array.isArray(data?.metas) ? (data.metas as Array<Record<string, unknown>>) : [];
        return metas.map((m) => parseMetaSummary(m, anime)).filter((x): x is MediaItem => x !== null);
      }),
    ).then((b) => b.flat());

  // TMDB first (via the core): real titles in Spanish with working posters, resolved to IMDb
  // ids. Cinemeta's own search fills "the flash" with fan shows and dead artwork, so it is
  // only the fallback when TMDB is unavailable or finds nothing.
  const animeHits = kidsOnly
    ? Promise.resolve<MediaItem[]>([])
    : fetchBatch(urlsFor(clean).filter((u) => u.anime)).then((list) => list.filter((it) => titleMatchesQuery(it, clean)));
  const found = await desktopApi
    .tmdb<{ items?: Array<Record<string, unknown>> }>(`find:${clean}`)
    .then((r) => (r?.items || []).map((x) => kidsTmdbItem(x)).filter((x): x is MediaItem => x !== null))
    .catch(() => [] as MediaItem[]);
  if (found.length > 0) {
    if (onPartial) onPartial(rankSearchResults(found, clean, kidsOnly));
    return rankSearchResults([...found, ...(await animeHits)], clean, kidsOnly);
  }

  // Fallback: Cinemeta + Kitsu, without the entries that have no artwork.
  const basePromise = fetchBatch(urlsFor(clean)).then((list) => list.filter((it) => Boolean(it.poster)));
  const tmdbPromise = desktopApi
    .tmdb<{ items?: Array<{ originalTitle?: string }> }>(`search:${clean}`)
    .then((tmdb) => {
      const hit = (tmdb?.items || []).slice(0, 2).find(
        (h) => h.originalTitle && h.originalTitle.toLowerCase() !== clean.toLowerCase(),
      );
      return hit?.originalTitle || '';
    })
    .catch(() => ''); /* TMDB optional */

  const base = await basePromise;
  const rank = (all: MediaItem[]) => rankSearchResults(all, clean, kidsOnly);
  const original = await Promise.race([
    tmdbPromise,
    // Show the direct hits first when TMDB is slower than Cinemeta.
    new Promise<null>((r) => setTimeout(() => r(null), 0)),
  ]);
  if (original === null && onPartial) onPartial(rank(base));
  const alt = original === null ? await tmdbPromise : original;
  if (!alt) return rank(base);
  const extra = (await fetchBatch(urlsFor(alt))).filter((it) => Boolean(it.poster));
  return rank([...base, ...extra]);
}

/** Kitsu's search matches loosely ("the flash" -> unrelated anime): keep titles that share the query. */
function titleMatchesQuery(it: MediaItem, query: string): boolean {
  const norm = (x: string) =>
    x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const q = norm(query);
  return [it.title, it.originalTitle || ''].some((t) => {
    const n = norm(t);
    return Boolean(n) && (n.includes(q) || q.includes(n));
  });
}

function rankSearchResults(all: MediaItem[], clean: string, kidsOnly: boolean): MediaItem[] {
  const allowed = kidsOnly
    ? all.filter((it) => it.genres.some((g) => g.toLowerCase() === 'family') || kidsApprovedIds.has(it.id))
    : all;
  // Text match first, then newest first (owner rule).
  return orderSearchResults(allowed, clean).slice(0, 60);
}

function langName(code: string): string {
  if (code === 'spn') return 'Español (España)';
  if (isLatamSpanish(code)) return 'Español latino';
  if (code.startsWith('spa') || code === 'es' || code.startsWith('es-')) return 'Español';
  if (code.startsWith('eng') || code === 'en') return 'Inglés';
  if (code.startsWith('por') || code === 'pt') return 'Portugués';
  if (code.startsWith('fre') || code === 'fr') return 'Francés';
  if (code.startsWith('ita') || code === 'it') return 'Italiano';
  if (code.startsWith('ger') || code === 'de') return 'Alemán';
  if (code.startsWith('jpn') || code === 'ja') return 'Japonés';
  const extra: Record<string, string> = {
    pob: 'Portugués (Brasil)', 'pt-br': 'Portugués (Brasil)', dan: 'Danés', da: 'Danés', tur: 'Turco', tr: 'Turco',
    ara: 'Árabe', ar: 'Árabe', rus: 'Ruso', ru: 'Ruso', chi: 'Chino', zho: 'Chino', zh: 'Chino', kor: 'Coreano',
    ko: 'Coreano', dut: 'Neerlandés', nld: 'Neerlandés', nl: 'Neerlandés', pol: 'Polaco', pl: 'Polaco', swe: 'Sueco',
    sv: 'Sueco', nor: 'Noruego', no: 'Noruego', fin: 'Finés', fi: 'Finés', gre: 'Griego', ell: 'Griego', el: 'Griego',
    heb: 'Hebreo', he: 'Hebreo', hun: 'Húngaro', hu: 'Húngaro', cze: 'Checo', ces: 'Checo', cs: 'Checo',
    rum: 'Rumano', ron: 'Rumano', ro: 'Rumano', hrv: 'Croata', hr: 'Croata', srp: 'Serbio', sr: 'Serbio',
    bul: 'Búlgaro', bg: 'Búlgaro', ukr: 'Ucraniano', uk: 'Ucraniano', vie: 'Vietnamita', vi: 'Vietnamita',
    tha: 'Tailandés', th: 'Tailandés', ind: 'Indonesio', id: 'Indonesio', may: 'Malayo', msa: 'Malayo',
    hin: 'Hindi', hi: 'Hindi', cat: 'Catalán', ca: 'Catalán', slv: 'Esloveno', slo: 'Eslovaco', slk: 'Eslovaco',
    per: 'Persa', fas: 'Persa', est: 'Estonio', lav: 'Letón', lit: 'Lituano', ice: 'Islandés', isl: 'Islandés',
  };
  const key = code.toLowerCase();
  if (extra[key]) return extra[key];
  return code ? code.toUpperCase() : 'Subtítulo';
}
