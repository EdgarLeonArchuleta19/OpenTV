import { describe, expect, it } from 'vitest';
import { BUILTIN_PLUGINS, isLiveTvPlugin } from './catalogs';

describe('isLiveTvPlugin', () => {
  it('puts channel-only plugins under live TV', () => {
    expect(isLiveTvPlugin({ types: ['tv'] })).toBe(true);
    expect(isLiveTvPlugin({ types: ['channel', 'TV'] })).toBe(true);
  });

  it('keeps movie/series plugins (and untyped ones) under Películas y series', () => {
    expect(isLiveTvPlugin({ types: ['movie', 'series'] })).toBe(false);
    expect(isLiveTvPlugin({ types: ['movie', 'tv'] })).toBe(false);
    expect(isLiveTvPlugin({ types: [] })).toBe(false);
  });

  it('never classifies the bundled plugins as live TV', () => {
    expect(BUILTIN_PLUGINS.some(isLiveTvPlugin)).toBe(false);
  });
});
