import { describe, expect, it } from 'vitest';
import { describeSearch, SourceSearch, type SourceFetchers } from './sourceSearch';
import type { MediaItem, SourcePrefs } from '../types/models';

const PREFS: SourcePrefs = {
  langs: ['latino', 'castellano'],
  quality: 'auto',
  exclude: [],
  minSeeds: 0,
  maxMovieGb: 0,
  maxEpisodeGb: 0,
  autoPlay: true,
  subsFrom: 'file',
};

const ITEM: MediaItem = {
  id: 'tt0000001',
  type: 'movie',
  title: 'Película',
  year: '2025',
  score: '',
  duration: '',
  genres: [],
  synopsis: '',
  poster: '',
  backdrop: '',
  isAnime: false,
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('SourceSearch', () => {
  it('publishes Stremio and each JS plugin progressively and waits for direct sources', async () => {
    let clock = 1_000;
    const stremio = deferred<Array<{ id: string; addonId: string; addonName: string; title: string; infoHash: string }>>();
    const jsDone = deferred<{ streams: []; failures: [] }>();
    let onPluginDone: Parameters<SourceFetchers['js']>[3]['onPluginDone'] = () => {};
    const fetchers: SourceFetchers = {
      stremio: () => stremio.promise,
      js: (_i, _e, _p, opts) => {
        onPluginDone = opts.onPluginDone;
        return jsDone.promise;
      },
      jsNames: () => ['Pelispedia', 'Cuevana Pro'],
      now: () => clock,
    };
    const search = new SourceSearch(ITEM, null, [], fetchers);

    let p = describeSearch(search.state, PREFS, false, clock, true);
    expect(p.ready).toBe(false);
    expect(p.status).toBe('Buscando la mejor fuente…');

    // Torrents arrive first: the player keeps waiting for the slow sites.
    clock = 3_000;
    stremio.resolve([{ id: 't1', addonId: 'torrentio', addonName: 'Torrentio', title: '1080p Latino 👤 80', infoHash: 'h1' }]);
    await tick();
    p = describeSearch(search.state, PREFS, false, clock + 2_500, true);
    expect(p.ready).toBe(false);
    expect(p.status).toBe('Consultando Pelispedia…');
    expect(p.detail).toBe('0 directas · 1 torrents · esperando a Pelispedia, Cuevana Pro');

    // Pelispedia answers with a Latino HLS: picked at once, ahead of the torrent.
    clock = 9_000;
    onPluginDone({ id: 'pelis', name: 'Pelispedia' }, [
      { id: 'j1', addonId: 'pelis', addonName: 'Pelispedia', title: 'Latino · fastream', url: 'https://cdn.example/a.m3u8', isJsPlugin: true },
    ]);
    expect(search.state.pendingJs).toEqual(['Cuevana Pro']);
    p = describeSearch(search.state, PREFS, false, clock, true);
    expect(p.ready).toBe(true);
    expect(p.ranked[0].id).toBe('j1');
    expect(p.detail).toBe('1 directas · 1 torrents · esperando a Cuevana Pro');

    // Late plugin results keep extending the same search (picker + fallbacks).
    const seen: number[] = [];
    const off = search.subscribe((st) => seen.push(st.raw.length));
    onPluginDone({ id: 'cuevana', name: 'Cuevana Pro' }, [
      { id: 'j2', addonId: 'cuevana', addonName: 'Cuevana Pro', title: 'Castellano', url: 'https://cdn2.example/b.m3u8', isJsPlugin: true },
    ]);
    jsDone.resolve({ streams: [], failures: [] });
    await tick();
    off();
    expect(seen).toContain(3);
    expect(search.done).toBe(true);
  });

  it('picks the torrent after the grace window when no direct source shows up', async () => {
    let clock = 1;
    const fetchers: SourceFetchers = {
      stremio: async () => [{ id: 't1', addonId: 'torrentio', addonName: 'Torrentio', title: '1080p Latino 👤 80', infoHash: 'h1' }],
      js: () => new Promise(() => {}),
      jsNames: () => ['FrameXTV +'],
      now: () => clock,
    };
    const search = new SourceSearch(ITEM, null, [], fetchers);
    await tick();
    expect(describeSearch(search.state, PREFS, false, 9_000, true).ready).toBe(false);
    clock = 10_000;
    const p = describeSearch(search.state, PREFS, false, 10_001, true);
    expect(p.ready).toBe(true);
    expect(p.ranked[0].id).toBe('t1');
  });

  it('reports failures and finishes when every plugin answered with nothing', async () => {
    const fetchers: SourceFetchers = {
      stremio: async () => [],
      js: async (_i, _e, _p, opts) => {
        const failure = { pluginId: 'pelis', pluginName: 'Pelispedia', message: 'Pelispedia: sin coincidencias' };
        opts.onPluginDone({ id: 'pelis', name: 'Pelispedia' }, [], failure);
        return { streams: [], failures: [failure] };
      },
      jsNames: () => ['Pelispedia'],
      now: () => 0,
    };
    const search = new SourceSearch(ITEM, null, [], fetchers);
    await tick();
    await tick();
    expect(search.done).toBe(true);
    expect(search.state.failures).toHaveLength(1);
    const p = describeSearch(search.state, PREFS, false, 0, true);
    expect(p.ready).toBe(true);
    expect(p.ranked).toHaveLength(0);
  });
});
