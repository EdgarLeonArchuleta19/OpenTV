import { describe, expect, it } from 'vitest';
import { animeSeasonItem, coreListItems, dailyHeroOrder, kidsTmdbItem, localDayKey, sectionRowSpecs, tmdbListItem } from './sectionContent';

const row = (n: number, withBackdrop: (i: number) => boolean = () => true) =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, backdrop: withBackdrop(i) ? `b${i}` : '' }));

describe('kidsTmdbItem', () => {
  it('maps an all-ages TMDB title to a Cinemeta-playable item', () => {
    const it = kidsTmdbItem({
      imdbId: 'tt2380307',
      kind: 'movie',
      title: 'Coco',
      original: 'Coco',
      year: '2017',
      rating: 8.21,
      overview: 'Miguel sueña con ser músico.',
      poster: 'https://image.tmdb.org/t/p/w342/p.jpg',
      backdrop: 'https://image.tmdb.org/t/p/w1280/b.jpg',
      genres: ['Family', 'Animation'],
    });
    expect(it).toMatchObject({
      id: 'stremio:tt2380307',
      type: 'movie',
      title: 'Coco',
      score: '8.2',
      isAnime: false,
      genres: ['Family', 'Animation'],
    });
    expect(it?.originalTitle).toBeUndefined();
  });

  it('marks TV as series and drops items without an IMDb id', () => {
    expect(kidsTmdbItem({ imdbId: 'tt7678620', kind: 'tv', title: 'Bluey' })?.type).toBe('series');
    expect(kidsTmdbItem({ imdbId: '', kind: 'movie', title: 'X' })).toBeNull();
    expect(kidsTmdbItem({ imdbId: 'tt7678620', kind: 'tv', title: '' })).toBeNull();
  });
});

describe('animeSeasonItem', () => {
  it('keeps Kitsu ids so the Anime Kitsu plugin serves the episodes', () => {
    const it = animeSeasonItem({
      kitsuId: '50021',
      title: 'The Apothecary Diaries Season 3',
      original: 'Kusuriya no Hitorigoto 3',
      year: '2026',
      rating: 8.4,
      poster: 'https://media.kitsu.app/p.jpg',
      backdrop: '',
    });
    expect(it).toMatchObject({ id: 'stremio:kitsu:50021', type: 'anime', isAnime: true, backdrop: '' });
    expect(it?.originalTitle).toBe('Kusuriya no Hitorigoto 3');
    expect(animeSeasonItem({ kitsuId: 'abc', title: 'X' })).toBeNull();
  });
});

describe('dailyHeroOrder', () => {
  it('is stable for the same day and changes across days', () => {
    const items = row(20);
    const a = dailyHeroOrder(items, 'anime:2026-11-23');
    expect(dailyHeroOrder(items, 'anime:2026-11-23')).toEqual(a);
    const days = ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27'].map((d) =>
      dailyHeroOrder(items, `anime:${d}`).slice(0, 6).map((x) => x.id).join(','),
    );
    expect(days.some((d) => d !== a.slice(0, 6).map((x) => x.id).join(','))).toBe(true);
  });

  it('keeps every item once and only promotes items with a backdrop from the pool', () => {
    const items = row(30, (i) => i % 3 === 0);
    const out = dailyHeroOrder(items, 'kids:2026-11-23');
    expect(out).toHaveLength(30);
    expect(new Set(out.map((x) => x.id)).size).toBe(30);
    const head = out.slice(0, 6);
    expect(head.every((x) => x.backdrop)).toBe(true);
    expect(head.every((x) => Number(x.id.slice(1)) < 20)).toBe(true);
  });

  it('leaves rows without artwork untouched', () => {
    const items = row(5, () => false);
    expect(dailyHeroOrder(items, 'anime:2026-11-23')).toBe(items);
  });
});

describe('localDayKey', () => {
  it('uses the local calendar day', () => {
    expect(localDayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('sectionRowSpecs', () => {
  it('keeps the row titles/count of every section and maps each to a TMDB list + fallback catalog', () => {
    expect(sectionRowSpecs('home').map((r) => r.lists[0])).toEqual([
      'cat:movie:trending',
      'cat:tv:trending',
      'cat:movie:popular',
      'cat:tv:popular',
      'cat:movie:genre:28',
      'cat:movie:genre:878',
      'cat:movie:genre:35',
    ]);
    expect(sectionRowSpecs('series').map((r) => [r.title, r.lists[0]])).toEqual([
      ['Tendencias de la semana', 'cat:tv:trending'],
      ['Popular · Series', 'cat:tv:popular'],
      ['Drama', 'cat:tv:genre:18'],
      ['Crimen y misterio', 'cat:tv:genre:80'],
      ['Ciencia ficción y fantasía', 'cat:tv:genre:10765'],
      ['Comedia', 'cat:tv:genre:35'],
    ]);
    expect(sectionRowSpecs('movies')).toHaveLength(7);
    expect(sectionRowSpecs('kids').map((r) => r.lists[0])).toEqual([
      'kids-movies-popular',
      'kids-tv-popular',
      'kids-movies-animated',
      'kids-tv-top',
    ]);
    expect(sectionRowSpecs('anime').map((r) => r.lists)).toEqual([
      ['anime:season', 'anime-season'],
      ['anime:airing'],
      ['anime:popular'],
      ['anime:top'],
      ['anime:movies'],
    ]);
    expect(sectionRowSpecs('live')).toEqual([]);
    for (const section of ['home', 'movies', 'series', 'kids', 'anime'] as const) {
      for (const row of sectionRowSpecs(section)) {
        // "Películas de anime" is TMDB-only (no Kitsu twin).
        if (row.id === 'a_movies') continue;
        expect(row.url).toMatch(/^https:\/\/(v3-cinemeta\.strem\.io|anime-kitsu\.strem\.fun)\/catalog\//);
      }
    }
    // Anime never falls back to Cinemeta; the other sections never to Kitsu.
    expect(sectionRowSpecs('anime').every((r) => !r.url || r.url.includes('anime-kitsu'))).toBe(true);
    expect(sectionRowSpecs('movies').every((r) => r.url.includes('cinemeta'))).toBe(true);
  });
});

describe('tmdbListItem / coreListItems', () => {
  it('types TV anime as anime and anime films as movies, both flagged isAnime', () => {
    expect(tmdbListItem({ imdbId: 'tt2560140', kind: 'tv', title: 'Attack on Titan' }, true)).toMatchObject({
      id: 'stremio:tt2560140',
      type: 'anime',
      isAnime: true,
    });
    expect(tmdbListItem({ imdbId: 'tt5311514', kind: 'movie', title: 'Your Name' }, true)).toMatchObject({
      type: 'movie',
      isAnime: true,
    });
    expect(tmdbListItem({ imdbId: 'tt5311514', kind: 'movie', title: 'Your Name' })?.isAnime).toBe(false);
  });

  it('picks the mapper from the list name', () => {
    expect(coreListItems('anime:top', [{ imdbId: 'tt2560140', kind: 'tv', title: 'AoT' }])[0].type).toBe('anime');
    expect(coreListItems('cat:tv:popular', [{ imdbId: 'tt0903747', kind: 'tv', title: 'BB' }])[0].type).toBe('series');
    expect(coreListItems('anime-season', [{ kitsuId: '1', title: 'X' }])[0].id).toBe('stremio:kitsu:1');
    expect(coreListItems('cat:movie:top', [{ imdbId: '', title: 'X' }])).toEqual([]);
  });
});
