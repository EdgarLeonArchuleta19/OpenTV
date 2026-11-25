import { describe, expect, it } from 'vitest';
import { mapTmdbDetail, mapTmdbEpisodes, mergeSeasonEpisodes, runtimeLabel } from './tmdbDetail';
import type { Episode, MediaItem } from '../types/models';

const base: MediaItem = {
  id: 'stremio:tt0903747',
  type: 'series',
  title: 'Breaking Bad',
  year: '2008',
  score: '9.5',
  duration: '',
  genres: ['Drama'],
  synopsis: 'A chemistry teacher…',
  poster: 'p.jpg',
  backdrop: 'b.jpg',
  logo: 'logo.png',
  isAnime: false,
};

const detailAnswer = {
  tmdbId: 1396,
  item: {
    tmdbId: 1396,
    kind: 'tv',
    imdbId: 'tt0903747',
    title: 'Breaking Bad: Reacciones',
    original: 'Breaking Bad',
    year: '2008',
    rating: 8.93,
    overview: 'Un profesor de química con cáncer terminal…',
    poster: 'https://image.tmdb.org/t/p/w342/p.jpg',
    backdrop: 'https://image.tmdb.org/t/p/w1280/b.jpg',
    genres: ['Drama', 'Crime'],
    runtime: 47,
  },
  director: ['Vince Gilligan'],
  cast: ['Bryan Cranston', 'Aaron Paul', 'Anna Gunn', 'RJ Mitte', 'Dean Norris', 'Betsy Brandt', 'Bob Odenkirk', 'Jonathan Banks', 'Giancarlo Esposito'],
  seasons: [0, 1, 2, 3, 4, 5],
  related: [
    { imdbId: 'tt3032476', kind: 'tv', title: 'Better Call Saul', year: '2015', rating: 8.7 },
    { imdbId: 'tt0903747', kind: 'tv', title: 'Breaking Bad' },
    { imdbId: '', kind: 'tv', title: 'Sin IMDb' },
  ],
};

describe('mapTmdbDetail', () => {
  it('uses the Spanish TMDB text, cast, director, runtime and related titles', () => {
    const m = mapTmdbDetail(base, detailAnswer);
    expect(m).not.toBeNull();
    expect(m!.tmdbId).toBe('1396');
    expect(m!.isTv).toBe(true);
    expect(m!.seasons).toEqual([1, 2, 3, 4, 5]);
    expect(m!.item).toMatchObject({
      id: 'stremio:tt0903747',
      type: 'series',
      title: 'Breaking Bad: Reacciones',
      originalTitle: 'Breaking Bad',
      score: '8.9',
      duration: '47 min',
      synopsis: 'Un profesor de química con cáncer terminal…',
      director: 'Vince Gilligan',
      genres: ['Drama', 'Crime'],
      logo: 'logo.png',
    });
    expect(m!.item.cast).toHaveLength(8);
    // Self and entries without an IMDb id are dropped.
    expect(m!.related.map((r) => r.id)).toEqual(['stremio:tt3032476']);
  });

  it('keeps the catalog text when TMDB leaves fields blank', () => {
    const m = mapTmdbDetail({ ...base, type: 'movie' }, { tmdbId: 1, item: { kind: 'movie', title: '', overview: '' } });
    expect(m!.isTv).toBe(false);
    expect(m!.item).toMatchObject({ title: 'Breaking Bad', synopsis: 'A chemistry teacher…', type: 'movie' });
  });

  it('keeps anime typed as anime (episodic) and flags related titles as anime', () => {
    const m = mapTmdbDetail({ ...base, type: 'anime', isAnime: true }, detailAnswer);
    expect(m!.item.type).toBe('anime');
    expect(m!.related[0]).toMatchObject({ type: 'anime', isAnime: true });
  });

  it('returns null for unusable answers so the caller falls back to Cinemeta', () => {
    expect(mapTmdbDetail(base, null)).toBeNull();
    expect(mapTmdbDetail(base, { unavailable: true })).toBeNull();
    expect(mapTmdbDetail(base, { error: 'HTTP 500' })).toBeNull();
  });

  it('only keeps season 0 when there is nothing else', () => {
    expect(mapTmdbDetail(base, { ...detailAnswer, seasons: [0] })!.seasons).toEqual([0]);
  });
});

describe('mapTmdbEpisodes', () => {
  it('builds tt…:season:episode ids with Spanish titles and stills', () => {
    const eps = mapTmdbEpisodes(
      'tt0903747',
      2,
      [
        { season: 2, number: 2, title: 'Agarrado', overview: 'O2', still: 's2.jpg', airDate: '2009-03-15T00:00', runtime: 47 },
        { season: 2, number: 1, title: '', overview: '', still: '', airDate: '2009-03-08' },
        { season: 3, number: 1, title: 'Otra temporada' },
        { season: 2, number: 0, title: 'Inválido' },
      ],
      'backdrop.jpg',
    );
    expect(eps).toEqual<Episode[]>([
      { id: 'tt0903747:2:1', season: 2, number: 1, title: 'Episodio 1', overview: '', thumbnail: 'backdrop.jpg', released: '2009-03-08' },
      { id: 'tt0903747:2:2', season: 2, number: 2, title: 'Agarrado', overview: 'O2', thumbnail: 's2.jpg', released: '2009-03-15', runtimeMin: 47 },
    ]);
    expect(mapTmdbEpisodes('tt1', 1, undefined, '')).toEqual([]);
  });

  it('carries the TMDB runtime in minutes only when known', () => {
    const eps = mapTmdbEpisodes(
      'tt0386676',
      1,
      [
        { season: 1, number: 1, title: 'Piloto', runtime: 23.6 },
        { season: 1, number: 2, title: 'Día de la diversidad', runtime: '22' },
        { season: 1, number: 3, title: 'Salud', runtime: 0 },
        { season: 1, number: 4, title: 'La alianza', runtime: null },
      ],
      '',
    );
    expect(eps.map((e) => e.runtimeMin)).toEqual([24, 22, undefined, undefined]);
  });
});

describe('mergeSeasonEpisodes / runtimeLabel', () => {
  const ep = (season: number, number: number): Episode => ({
    id: `tt1:${season}:${number}`,
    season,
    number,
    title: '',
    overview: '',
    thumbnail: '',
    released: '',
  });

  it('replaces one season and keeps the list sorted', () => {
    const merged = mergeSeasonEpisodes([ep(2, 1), ep(1, 2)], 1, [ep(1, 1), ep(1, 2)]);
    expect(merged.map((e) => e.id)).toEqual(['tt1:1:1', 'tt1:1:2', 'tt1:2:1']);
    const same = [ep(1, 1)];
    expect(mergeSeasonEpisodes(same, 2, [])).toBe(same);
  });

  it('formats minutes', () => {
    expect(runtimeLabel(142)).toBe('142 min');
    expect(runtimeLabel('0')).toBe('');
    expect(runtimeLabel(null)).toBe('');
  });
});
