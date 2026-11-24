import { describe, expect, it } from 'vitest';
import { directImageUrl } from './tauri';

describe('directImageUrl', () => {
  it('loads TMDB art straight from its CDN at the nearest smaller size', () => {
    expect(directImageUrl('https://image.tmdb.org/t/p/w1280/b.jpg', 400)).toBe('https://image.tmdb.org/t/p/w500/b.jpg');
    expect(directImageUrl('https://image.tmdb.org/t/p/original/b.jpg', 1600)).toBe('https://image.tmdb.org/t/p/w1280/b.jpg');
  });

  it('never asks TMDB for a bigger size than the catalog gave', () => {
    expect(directImageUrl('https://image.tmdb.org/t/p/w342/p.jpg', 1280)).toBe('https://image.tmdb.org/t/p/w342/p.jpg');
  });

  it('keeps Cinemeta art as is and sends unknown hosts to the local resizer', () => {
    const meta = 'https://images.metahub.space/background/medium/tt0111161/img';
    expect(directImageUrl(meta, 1280)).toBe(meta);
    expect(directImageUrl('https://example.com/a.jpg', 300)).toBe('');
    expect(directImageUrl('http://image.tmdb.org/t/p/w500/a.jpg', 300)).toBe('');
  });
});
