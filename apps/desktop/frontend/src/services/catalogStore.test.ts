import { describe, expect, it } from 'vitest';
import { PersistentJsonCache, isPersistableCatalogUrl, slimCatalogPayload, swrState } from './catalogStore';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('catalogStore', () => {
  it('classifies freshness for stale-while-revalidate', () => {
    expect(swrState(1000, 5000, 10_000)).toBe('fresh');
    expect(swrState(6000, 5000, 10_000)).toBe('stale');
    expect(swrState(11_000, 5000, 10_000)).toBe('expired');
    expect(swrState(-5, 5000, 10_000)).toBe('expired');
  });

  it('persists browse catalogs but never searches, streams or meta', () => {
    expect(isPersistableCatalogUrl('https://v3-cinemeta.strem.io/catalog/movie/top.json')).toBe(true);
    expect(isPersistableCatalogUrl('https://v3-cinemeta.strem.io/catalog/movie/top/genre=Family.json')).toBe(true);
    expect(isPersistableCatalogUrl('https://anime-kitsu.strem.fun/catalog/anime/kitsu-anime-trending.json')).toBe(true);
    expect(isPersistableCatalogUrl('https://v3-cinemeta.strem.io/catalog/movie/top/search=batman.json')).toBe(false);
    expect(isPersistableCatalogUrl('https://x.example/stream/movie/tt1.json')).toBe(false);
    expect(isPersistableCatalogUrl('https://v3-cinemeta.strem.io/meta/movie/tt1.json')).toBe(false);
  });

  it('drops heavy unused meta fields only', () => {
    const slim = slimCatalogPayload({
      metas: [{ id: 'tt1', name: 'A', genres: ['Family'], trailerStreams: [1], popularities: { a: 1 }, links: [{ x: 1 }] }],
    });
    expect(slim.metas).toEqual([{ id: 'tt1', name: 'A', genres: ['Family'], links: [{ x: 1 }] }]);
  });

  it('round-trips through storage, caps entries and clears', () => {
    const storage = memoryStorage();
    let now = 1000;
    const a = new PersistentJsonCache('k', 2, () => storage, () => now, 0);
    a.set('u1', { metas: [{ id: '1' }] });
    now = 2000;
    a.set('u2', { metas: [{ id: '2' }] });
    a.set('u3', { metas: [{ id: '3' }] });
    a.flush();

    const b = new PersistentJsonCache('k', 2, () => storage, () => now, 0);
    expect(b.get('u1')).toBeUndefined(); // evicted (oldest)
    expect(b.get('u3')).toEqual({ d: { metas: [{ id: '3' }] }, at: 2000 });
    b.clear();
    expect(storage.data.has('k')).toBe(false);
    expect(new PersistentJsonCache('k', 2, () => storage).get('u3')).toBeUndefined();
  });

  it('survives corrupted storage', () => {
    const storage = memoryStorage();
    storage.setItem('k', '{not json');
    expect(new PersistentJsonCache('k', 5, () => storage).get('u')).toBeUndefined();
  });
});
