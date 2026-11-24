import { beforeEach, describe, expect, it, vi } from 'vitest';

const tmdbMock = vi.fn();
vi.mock('./tauri', () => ({
  desktopApi: { tmdb: (list: string) => tmdbMock(list) },
}));

import {
  applySpanish,
  clearLocalizeCache,
  imdbIdOf,
  isGenericEpisodeTitle,
  localizeEpisodes,
  pickLocalized,
  spanishInfo,
} from './localize';
import type { Episode, MediaItem } from '../types/models';

const inception: MediaItem = {
  id: 'stremio:tt1375666',
  type: 'movie',
  title: 'Inception',
  year: '2010',
  score: '8.8',
  duration: '148 min',
  genres: ['Action'],
  synopsis: 'A thief who steals corporate secrets…',
  poster: '',
  backdrop: '',
  isAnime: false,
};

describe('Spanish metadata fallback (es-MX → es-ES → original)', () => {
  beforeEach(() => {
    tmdbMock.mockReset();
    clearLocalizeCache();
  });

  it('picks the first non-blank candidate per field', () => {
    expect(pickLocalized({ title: 'Orig', overview: 'EN' }, { title: 'MX', overview: '' }, { title: 'ES', overview: 'Sinopsis ES' }))
      .toEqual({ title: 'MX', overview: 'Sinopsis ES' });
    expect(pickLocalized({ title: 'Orig', overview: 'EN' }, null, { title: '  ', overview: '' }))
      .toEqual({ title: 'Orig', overview: 'EN' });
  });

  it('extracts IMDb ids only', () => {
    expect(imdbIdOf({ id: 'stremio:tt1375666' })).toBe('tt1375666');
    expect(imdbIdOf({ id: 'tt0944947:1:2' })).toBe('tt0944947');
    expect(imdbIdOf({ id: 'stremio:kitsu:1' })).toBe('');
  });

  it('detects generic TMDB episode names', () => {
    expect(isGenericEpisodeTitle('Episodio 3')).toBe(true);
    expect(isGenericEpisodeTitle('Capítulo 10')).toBe(true);
    expect(isGenericEpisodeTitle('Se acerca el invierno')).toBe(false);
  });

  it('uses es-MX and caches the result', async () => {
    tmdbMock.mockResolvedValue({ item: { tmdbId: 27205, kind: 'movie', title: 'El origen', overview: 'Dom Cobb es un ladrón…' } });
    const a = await spanishInfo('tt1375666');
    const b = await spanishInfo('tt1375666');
    expect(a).toEqual({ tmdbId: '27205', kind: 'movie', title: 'El origen', overview: 'Dom Cobb es un ladrón…' });
    expect(b).toEqual(a);
    expect(tmdbMock).toHaveBeenCalledTimes(1);
    expect(applySpanish(inception, a)).toMatchObject({ title: 'El origen', synopsis: 'Dom Cobb es un ladrón…' });
  });

  it('falls back to es-ES when es-MX has no synopsis', async () => {
    tmdbMock.mockImplementation(async (list: string) => {
      if (list.startsWith('es:')) return { item: { tmdbId: 1, kind: 'movie', title: 'Inception', overview: '' } };
      if (list === 'raw:/movie/1?language=es-ES') return { item: { title: 'Origen', overview: 'Sinopsis de España' } };
      return {};
    });
    const info = await spanishInfo('tt1375666');
    expect(info).toMatchObject({ title: 'Inception', overview: 'Sinopsis de España' });
  });

  it('keeps the original text when TMDB is not configured', async () => {
    tmdbMock.mockResolvedValue({ error: 'Sin clave de TMDB', unavailable: true });
    const info = await spanishInfo('tt1375666');
    expect(info).toBeNull();
    expect(applySpanish(inception, info)).toBe(inception);
  });

  it('translates episodes but keeps real names over generic ones', async () => {
    tmdbMock.mockResolvedValue({
      episodes: [
        { number: 1, title: 'Se acerca el invierno', overview: 'Sinopsis 1' },
        { number: 2, title: 'Episodio 2', overview: '' },
      ],
    });
    const eps: Episode[] = [
      { id: 'tt0944947:1:1', season: 1, number: 1, title: 'Winter Is Coming', overview: 'EN 1', thumbnail: '', released: '' },
      { id: 'tt0944947:1:2', season: 1, number: 2, title: 'The Kingsroad', overview: 'EN 2', thumbnail: '', released: '' },
    ];
    const out = await localizeEpisodes({ tmdbId: '1399', kind: 'tv', title: '', overview: '' }, eps);
    expect(out[0]).toMatchObject({ title: 'Se acerca el invierno', overview: 'Sinopsis 1' });
    expect(out[1]).toMatchObject({ title: 'The Kingsroad', overview: 'EN 2' });
  });
});
