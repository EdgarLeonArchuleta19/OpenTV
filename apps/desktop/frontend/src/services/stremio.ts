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
import { ANIME_SEASON_LIST, KIDS_LISTS, animeSeasonItem, dailyHeroOrder, kidsTmdbItem, localDayKey } from './sectionContent';
import { CATALOG_FRESH_MS, PersistentJsonCache, isPersistableCatalogUrl, swrState } from './catalogStore';
import { settleInOrder } from './progressive';

interface CacheEntry {
  data: Record<string, unknown>;
  expiresAt: number;
}

const MAX_CACHE_ENTRIES = 200;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<Record<string, unknown> | null>>();

// Last browse-catalog answers persisted across restarts (stale-while-revalidate).
const persisted = new PersistentJsonCache('opentv_catalog_cache_v1', 90);

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
  const cin = 'https://v3-cinemeta.strem.io';
  const kit = 'https://anime-kitsu.strem.fun';

  // `list`: row served by the Rust core (TMDB/Kitsu); `url` is then the fallback catalog
  // (e.g. no TMDB key), shown under `fallbackTitle`.
  const specs: Array<{ id: string; title: string; url: string; list?: string; fallbackTitle?: string }> =
    section === 'home'
      ? [
          { id: 'trend_movies', title: 'Tendencias de la semana · Películas', url: `${cin}/catalog/movie/top.json` },
          { id: 'trend_series', title: 'Tendencias de la semana · Series', url: `${cin}/catalog/series/top.json` },
          { id: 'popular_movies', title: 'Popular · Películas', url: `${cin}/catalog/movie/imdbRating.json` },
          { id: 'popular_series', title: 'Popular · Series', url: `${cin}/catalog/series/imdbRating.json` },
          { id: 'action_movies', title: 'Acción y aventura', url: `${cin}/catalog/movie/top/genre=Action.json` },
          { id: 'scifi_movies', title: 'Ciencia ficción', url: `${cin}/catalog/movie/top/genre=Sci-Fi.json` },
          { id: 'comedy_movies', title: 'Comedia', url: `${cin}/catalog/movie/top/genre=Comedy.json` },
        ]
      : section === 'movies'
      ? [
          { id: 'm_top', title: 'Tendencias de la semana', url: `${cin}/catalog/movie/top.json` },
          { id: 'm_rating', title: 'Popular · Películas', url: `${cin}/catalog/movie/imdbRating.json` },
          { id: 'm_action', title: 'Acción', url: `${cin}/catalog/movie/top/genre=Action.json` },
          { id: 'm_horror', title: 'Terror y suspenso', url: `${cin}/catalog/movie/top/genre=Horror.json` },
          { id: 'm_scifi', title: 'Ciencia ficción', url: `${cin}/catalog/movie/top/genre=Sci-Fi.json` },
          { id: 'm_comedy', title: 'Comedia', url: `${cin}/catalog/movie/top/genre=Comedy.json` },
          { id: 'm_drama', title: 'Drama', url: `${cin}/catalog/movie/top/genre=Drama.json` },
        ]
      : section === 'series'
      ? [
          { id: 's_top', title: 'Tendencias de la semana', url: `${cin}/catalog/series/top.json` },
          { id: 's_rating', title: 'Popular · Series', url: `${cin}/catalog/series/imdbRating.json` },
          { id: 's_drama', title: 'Drama', url: `${cin}/catalog/series/top/genre=Drama.json` },
          { id: 's_crime', title: 'Crimen y misterio', url: `${cin}/catalog/series/top/genre=Crime.json` },
          { id: 's_scifi', title: 'Ciencia ficción y fantasía', url: `${cin}/catalog/series/top/genre=Sci-Fi.json` },
          { id: 's_comedy', title: 'Comedia', url: `${cin}/catalog/series/top/genre=Comedy.json` },
        ]
      : section === 'kids'
      ? [
          // Rule: Kids = all-ages ratings (MX "AA"/"A", US "G"/"PG" fallback; TV needs the Kids
          // genre) from TMDB; without a TMDB key, Cinemeta's Family genre (never general Animation).
          { id: 'k_movies', title: 'Películas para todos', list: KIDS_LISTS.moviesPopular, fallbackTitle: 'Películas familiares', url: `${cin}/catalog/movie/top/genre=Family.json` },
          { id: 'k_series', title: 'Series infantiles', list: KIDS_LISTS.tvPopular, fallbackTitle: 'Series para toda la familia', url: `${cin}/catalog/series/top/genre=Family.json` },
          { id: 'k_animated', title: 'Animadas para niños', list: KIDS_LISTS.moviesAnimated, fallbackTitle: 'Favoritas de la familia', url: `${cin}/catalog/movie/imdbRating/genre=Family.json` },
          { id: 'k_series_top', title: 'Las favoritas de los niños', list: KIDS_LISTS.tvTop, fallbackTitle: 'Series favoritas de la familia', url: `${cin}/catalog/series/imdbRating/genre=Family.json` },
        ]
      : section === 'anime'
      ? [
          // Rule: Anime comes exclusively from Kitsu / anime-typed catalogs. The plugin's
          // "trending" catalog is an all-time ranking (same as "popular"), so the first row is
          // this season's most-followed anime from the Kitsu API (fallback: that catalog).
          { id: 'a_season', title: 'Tendencias de la temporada', list: ANIME_SEASON_LIST, fallbackTitle: 'Tendencias del anime', url: `${kit}/catalog/anime/kitsu-anime-trending.json` },
          { id: 'a_airing', title: 'En emisión', url: `${kit}/catalog/anime/kitsu-anime-airing.json` },
          { id: 'a_popular', title: 'Más populares', url: `${kit}/catalog/anime/kitsu-anime-popular.json` },
          { id: 'a_rated', title: 'Mejor valorados', url: `${kit}/catalog/anime/kitsu-anime-rating.json` },
        ]
      : [];

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
        });
      }
    }
  }

  return settleInOrder(
    specs.map(async (s, index): Promise<CatalogRow | null> => {
      let title = s.title;
      let items: MediaItem[] = s.list ? await loadCoreList(s.list) : [];
      if (items.length === 0) {
        if (s.list && s.fallbackTitle) title = s.fallbackTitle;
        const data = await getJson(s.url);
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

/** Kids/Anime row served by the Rust core; [] when unavailable (no TMDB key, offline…). */
// In-memory cache for the Rust TMDB/Kitsu rows (Kids, Anime season): tab switches and the
// idle prefetch reuse them instead of a ~300 ms IPC + network round trip each time.
const CORE_LIST_TTL_MS = 30 * 60_000;
const coreListCache = new Map<string, { at: number; items: MediaItem[] }>();
const coreListInflight = new Map<string, Promise<MediaItem[]>>();

/** Drops the cached Kids/Anime rows ("Borrar caché"). */
export function clearCoreListCache(): void {
  coreListCache.clear();
}

async function loadCoreList(list: string): Promise<MediaItem[]> {
  const hit = coreListCache.get(list);
  if (hit && Date.now() - hit.at < CORE_LIST_TTL_MS) return hit.items;
  const pending = coreListInflight.get(list);
  if (pending) return pending;
  const p = fetchCoreList(list).then((items) => {
    if (items.length > 0) coreListCache.set(list, { at: Date.now(), items });
    coreListInflight.delete(list);
    return items;
  });
  coreListInflight.set(list, p);
  return p;
}

async function fetchCoreList(list: string): Promise<MediaItem[]> {
  try {
    const res = await desktopApi.tmdb<{ items?: Array<Record<string, unknown>> }>(list);
    const raw = Array.isArray(res?.items) ? res.items : [];
    const anime = list === ANIME_SEASON_LIST;
    const items = raw
      .map((r) => (anime ? animeSeasonItem(r) : kidsTmdbItem(r)))
      .filter((x): x is MediaItem => x !== null);
    if (!anime) for (const it of items) kidsApprovedIds.add(it.id);
    return items;
  } catch {
    return [];
  }
}

export async function loadTitleDetail(item: MediaItem): Promise<TitleDetail> {
  const rawId = item.id.replace(/^stremio:/, '');
  const isKitsu = rawId.startsWith('kitsu:') || item.isAnime;
  const base = isKitsu ? 'https://anime-kitsu.strem.fun' : 'https://v3-cinemeta.strem.io';
  const reqType = isKitsu ? 'anime' : item.type === 'series' ? 'series' : 'movie';

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

export async function fetchExternalSubtitles(
  item: MediaItem,
  episode: Episode | null,
  plugins: InstalledPlugin[],
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
  const batches = await Promise.all(
    subPlugins.map(async (plugin) => {
      const data = await getJson(`${plugin.baseUrl}/subtitles/${reqType}/${encId}.json`, 15 * 60_000);
      const arr = Array.isArray(data?.subtitles) ? (data.subtitles as Array<Record<string, unknown>>) : [];
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
            source: plugin.name,
          };
        })
        .filter((x): x is ExternalSubtitle => x !== null);
    }),
  );

  const seen = new Set<string>();
  return batches
    .flat()
    .filter((s) => {
      if (seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    })
    .sort((a, b) => subPriority(b.lang) - subPriority(a.lang))
    .slice(0, 24);
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

  // The typed text is searched right away; the TMDB lookup (Spanish -> original title) runs in
  // parallel and only adds a second query, instead of delaying every search.
  const basePromise = fetchBatch(urlsFor(clean));
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
  const extra = await fetchBatch(urlsFor(alt));
  return rank([...base, ...extra]);
}

function rankSearchResults(all: MediaItem[], clean: string, kidsOnly: boolean): MediaItem[] {
  const qLower = clean.toLowerCase();
  const seen = new Set<string>();
  return all
    .filter((it) => {
      if (seen.has(it.id)) return false;
      seen.add(it.id);
      if (kidsOnly && !it.genres.some((g) => g.toLowerCase() === 'family') && !kidsApprovedIds.has(it.id)) return false;
      return true;
    })
    .sort((a, b) => {
      const scoreItem = (x: MediaItem) => {
        const t = x.title.toLowerCase();
        let sc = 0;
        if (t === qLower) sc += 100;
        else if (t.startsWith(qLower)) sc += 60;
        else if (t.includes(qLower)) sc += 30;
        if (x.poster) sc += 15;
        if (Number(x.score) >= 7) sc += 10;
        return sc;
      };
      return scoreItem(b) - scoreItem(a);
    })
    .slice(0, 60);
}

function subPriority(lang: string): number {
  if (lang.startsWith('spa') || lang === 'es' || lang.startsWith('es-')) return 100;
  if (lang.startsWith('eng') || lang === 'en') return 50;
  return 10;
}

function langName(code: string): string {
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
