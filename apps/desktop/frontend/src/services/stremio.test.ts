import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmdbMock = vi.fn();
const serviceMock = vi.fn();
vi.mock('./tauri', () => ({
  desktopApi: {
    tmdb: (list: string) => tmdbMock(list),
    service: (method: string, params: Record<string, unknown>) => serviceMock(method, params),
  },
}));

import { clearCatalogCache, fetchExternalSubtitles, loadCatalogSection, loadSeasonEpisodes, loadTitleDetail } from './stremio';
import { clearLocalizeCache } from './localize';
import { BUILTIN_PLUGINS } from './catalogs';
import type { MediaItem } from '../types/models';

const tmdbItem = (n: number, kind: 'movie' | 'tv' = 'movie') => ({
  tmdbId: n,
  kind,
  imdbId: `tt${String(1000000 + n)}`,
  title: `Título ${n}`,
  year: '2024',
  rating: 7.5,
  poster: `p${n}.jpg`,
  backdrop: `b${n}.jpg`,
  genres: ['Drama'],
});

const cinemetaMeta = (n: number, type = 'movie') => ({
  id: `tt${String(2000000 + n)}`,
  type,
  name: `Cinemeta ${n}`,
  poster: `c${n}.jpg`,
  genres: ['Family'],
});

const fetchMock = vi.fn();

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  tmdbMock.mockReset();
  serviceMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  clearCatalogCache();
  clearLocalizeCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadCatalogSection: TMDB first, Cinemeta/Kitsu as hidden fallback', () => {
  it('fills every Películas row from the TMDB core lists without touching Cinemeta', async () => {
    tmdbMock.mockImplementation(async (list: string) => ({ items: [tmdbItem(1), tmdbItem(2)], list }));
    const rows = await loadCatalogSection('movies', BUILTIN_PLUGINS);
    expect(rows.map((r) => r.title)).toEqual([
      'Tendencias de la semana',
      'Popular · Películas',
      'Acción',
      'Terror y suspenso',
      'Ciencia ficción',
      'Comedia',
      'Drama',
    ]);
    expect(tmdbMock.mock.calls.map((c) => c[0])).toEqual([
      'cat:movie:trending',
      'cat:movie:popular',
      'cat:movie:genre:28',
      'cat:movie:genre:27',
      'cat:movie:genre:878',
      'cat:movie:genre:35',
      'cat:movie:genre:18',
    ]);
    expect(rows[0].items[0]).toMatchObject({ id: 'stremio:tt1000001', type: 'movie', isAnime: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the Cinemeta catalog per row when TMDB errors or is empty', async () => {
    tmdbMock.mockImplementation(async (list: string) =>
      list === 'cat:tv:trending' ? { items: [tmdbItem(5, 'tv')] } : list === 'cat:tv:popular' ? { error: 'HTTP 500' } : { items: [] },
    );
    fetchMock.mockImplementation(async () => jsonResponse({ metas: [cinemetaMeta(1, 'series')] }));
    const rows = await loadCatalogSection('series', []);
    expect(rows).toHaveLength(6);
    expect(rows[0].items[0]).toMatchObject({ id: 'stremio:tt1000005', type: 'series' });
    expect(rows[1].title).toBe('Popular · Series');
    expect(rows[1].items[0].id).toBe('stremio:tt2000001');
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain('https://v3-cinemeta.strem.io/catalog/series/imdbRating.json');
    expect(urls).not.toContain('https://v3-cinemeta.strem.io/catalog/series/top.json');
  });

  it('stops asking the core while TMDB is unavailable (no key)', async () => {
    tmdbMock.mockResolvedValue({ unavailable: true, items: [] });
    fetchMock.mockImplementation(async () => jsonResponse({ metas: [cinemetaMeta(1)] }));
    const rows = await loadCatalogSection('home', []);
    expect(rows).toHaveLength(7);
    tmdbMock.mockClear();
    const movies = await loadCatalogSection('movies', []);
    expect(movies).toHaveLength(7);
    expect(tmdbMock).not.toHaveBeenCalled();
  });

  it('Anime: TMDB anime lists as anime items, Kitsu season list second', async () => {
    tmdbMock.mockImplementation(async (list: string) => {
      if (list === 'anime:season') return { items: [] };
      if (list === 'anime-season') return { items: [{ kitsuId: '50021', title: 'Kusuriya', backdrop: 'k.jpg' }] };
      return { items: [tmdbItem(7, 'tv'), tmdbItem(8, 'movie')] };
    });
    const rows = await loadCatalogSection('anime', []);
    expect(rows.map((r) => r.title)).toEqual(['Tendencias de la temporada', 'En emisión', 'Más populares', 'Mejor valorados', 'Películas de anime']);
    expect(rows[0].items[0]).toMatchObject({ id: 'stremio:kitsu:50021', type: 'anime' });
    expect(rows[1].items[0]).toMatchObject({ id: 'stremio:tt1000007', type: 'anime', isAnime: true });
    expect(rows[1].items[1]).toMatchObject({ id: 'stremio:tt1000008', type: 'movie', isAnime: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Kids keeps its fallback titles when TMDB is not available', async () => {
    tmdbMock.mockResolvedValue({ items: [] });
    fetchMock.mockImplementation(async () => jsonResponse({ metas: [cinemetaMeta(3)] }));
    const rows = await loadCatalogSection('kids', []);
    expect(rows[0].title).toBe('Películas familiares');
  });
});

const series: MediaItem = {
  id: 'stremio:tt0903747',
  type: 'series',
  title: 'Breaking Bad',
  year: '2008',
  score: '',
  duration: '',
  genres: [],
  synopsis: '',
  poster: '',
  backdrop: 'bb.jpg',
  isAnime: false,
};

describe('loadTitleDetail', () => {
  it('uses detail: + episodes: of the preferred season, then loads other seasons on demand', async () => {
    tmdbMock.mockImplementation(async (list: string) => {
      if (list === 'detail:tt0903747') {
        return {
          tmdbId: 1396,
          item: { kind: 'tv', title: 'Breaking Bad', overview: 'Un profesor…', runtime: 47, genres: ['Drama'] },
          director: ['Vince Gilligan'],
          cast: ['Bryan Cranston'],
          seasons: [1, 2],
          related: [tmdbItem(9, 'tv')],
        };
      }
      const m = /^episodes:1396:(\d+)$/.exec(list);
      if (m) return { episodes: [{ season: Number(m[1]), number: 1, title: `Piloto T${m[1]}`, still: '' }] };
      return {};
    });
    const d = await loadTitleDetail(series, 2);
    expect(d.item).toMatchObject({ synopsis: 'Un profesor…', duration: '47 min', director: 'Vince Gilligan' });
    expect(d.seasons).toEqual([1, 2]);
    expect(d.tmdbTvId).toBe('1396');
    expect(d.episodes).toEqual([
      { id: 'tt0903747:2:1', season: 2, number: 1, title: 'Piloto T2', overview: '', thumbnail: 'bb.jpg', released: '' },
    ]);
    expect(d.related.map((r) => r.id)).toEqual(['stremio:tt1000009']);
    expect(fetchMock).not.toHaveBeenCalled();

    const s1 = await loadSeasonEpisodes(d, 1);
    expect(s1.map((e) => e.id)).toEqual(['tt0903747:1:1']);
    expect(await loadSeasonEpisodes(d, 7)).toEqual([]);
  });

  it('falls back to Cinemeta (+ Spanish text) when TMDB has no detail', async () => {
    tmdbMock.mockImplementation(async (list: string) => (list.startsWith('detail:') ? { error: 'not found' } : {}));
    fetchMock.mockImplementation(async () =>
      jsonResponse({
        meta: {
          name: 'Breaking Bad',
          description: 'A teacher…',
          videos: [{ id: 'tt0903747:1:1', season: 1, episode: 1, title: 'Pilot' }],
        },
      }),
    );
    const d = await loadTitleDetail(series);
    expect(d.tmdbTvId).toBeUndefined();
    expect(d.episodes.map((e) => e.id)).toEqual(['tt0903747:1:1']);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://v3-cinemeta.strem.io/meta/series/tt0903747.json');
  });

  it('keeps the Anime Kitsu path for kitsu: ids', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ meta: { name: 'Frieren', videos: [] } }));
    await loadTitleDetail({ ...series, id: 'stremio:kitsu:46474', type: 'anime', isAnime: true });
    expect(tmdbMock.mock.calls.some((c) => String(c[0]).startsWith('detail:'))).toBe(false);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://anime-kitsu.strem.fun/meta/anime/kitsu%3A46474.json');
  });
});

describe('fetchExternalSubtitles', () => {
  const ep = { id: 'tt0903747:1:2', season: 1, number: 2, title: '', overview: '', thumbnail: '', released: '' };

  it('orders OpenSubtitles before SubDL, Latin-American Spanish first in each', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({
        subtitles: [
          { url: 'https://os/en.srt', lang: 'eng' },
          { url: 'https://os/es.srt', lang: 'spa' },
          { url: 'https://os/lat.srt', lang: 'spl' },
        ],
      }),
    );
    serviceMock.mockImplementation(async (method: string) =>
      method === 'subdlSearch'
        ? {
            available: true,
            subtitles: [
              { id: 'a', lang: 'en', label: 'English', url: 'http://127.0.0.1:1/subdl/a.srt' },
              { id: 'b', lang: 'es-419', label: 'Español (Latinoamérica)', url: 'http://127.0.0.1:1/subdl/b.srt' },
            ],
          }
        : {},
    );
    const partial = vi.fn();
    const subs = await fetchExternalSubtitles(series, ep, BUILTIN_PLUGINS, partial);
    expect(subs.map((s) => s.url)).toEqual([
      'https://os/lat.srt',
      'https://os/es.srt',
      'https://os/en.srt',
      'http://127.0.0.1:1/subdl/b.srt',
      'http://127.0.0.1:1/subdl/a.srt',
    ]);
    expect(subs[0]).toMatchObject({ source: 'OpenSubtitles', origin: 'opensubtitles', label: 'Español latino' });
    expect(subs[3]).toMatchObject({ source: 'SubDL', origin: 'subdl' });
    expect(partial).toHaveBeenCalledTimes(1);
    expect(serviceMock).toHaveBeenCalledWith('subdlSearch', { imdbId: 'tt0903747', kind: 'series', season: 1, episode: 2 });
  });

  it('skips SubDL silently when it is not configured or fails', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ subtitles: [{ url: 'https://os/es.srt', lang: 'spa' }] }));
    serviceMock.mockResolvedValueOnce({ available: false, subtitles: [] });
    expect((await fetchExternalSubtitles(series, null, BUILTIN_PLUGINS)).map((s) => s.origin)).toEqual(['opensubtitles']);
    clearCatalogCache();
    serviceMock.mockRejectedValueOnce(new Error('boom'));
    expect(await fetchExternalSubtitles(series, null, BUILTIN_PLUGINS)).toHaveLength(1);
  });
});
