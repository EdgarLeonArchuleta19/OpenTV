import { describe, expect, it } from 'vitest';
import {
  HelperRejectedError,
  helperFromConsumes,
  randomCallId,
  sha256Hex,
  tmdbPluginRoute,
} from './jsPluginSecurity';

describe('helperFromConsumes', () => {
  it('accepts the approved Kino Resolver repo (unpinned -> HEAD)', () => {
    expect(helperFromConsumes({ repo: 'xuper-plugin/kino-plugin-kino-resolver' })).toEqual({
      repo: 'xuper-plugin/kino-plugin-kino-resolver',
      base: 'https://raw.githubusercontent.com/xuper-plugin/kino-plugin-kino-resolver/HEAD',
    });
  });

  it('pins a declared commit and SHA-256', () => {
    const hash = 'a'.repeat(64);
    const spec = helperFromConsumes({
      repo: 'xuper-plugin/kino-plugin-kino-resolver',
      commit: '0123abcd',
      sha256: `sha256:${hash.toUpperCase()}`,
    });
    expect(spec?.base).toBe('https://raw.githubusercontent.com/xuper-plugin/kino-plugin-kino-resolver/0123abcd');
    expect(spec?.sha256).toBe(hash);
  });

  it('rejects any non-approved helper with a Spanish message', () => {
    try {
      helperFromConsumes({ repo: 'evil/helper' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HelperRejectedError);
      expect((e as HelperRejectedError).userMessage).toBe('Este plugin necesita un plugin auxiliar no verificado: evil/helper');
      expect((e as HelperRejectedError).code).toBe('provider_missing');
    }
  });

  it('returns null when nothing (or garbage) is declared', () => {
    expect(helperFromConsumes({})).toBeNull();
    expect(helperFromConsumes({ repo: '../../etc' })).toBeNull();
  });
});

describe('randomCallId / sha256Hex', () => {
  it('produces 128-bit unguessable ids', () => {
    const ids = new Set(Array.from({ length: 200 }, randomCallId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^h_[0-9a-f]{32}$/);
  });

  it('hashes UTF-8 text', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('tmdbPluginRoute', () => {
  it('allows read-only metadata routes and filters params', () => {
    expect(tmdbPluginRoute('/movie/550', { language: 'es-MX', api_key: 'stolen', session_id: 'x' })).toBe(
      'raw:/movie/550?language=es-MX&include_adult=false',
    );
    expect(tmdbPluginRoute('find/tt0137523', { external_source: 'imdb_id' })).toBe(
      'raw:/find/tt0137523?external_source=imdb_id&include_adult=false',
    );
    expect(tmdbPluginRoute('/search/tv?query=dark&page=2', {})).toBe(
      'raw:/search/tv?query=dark&page=2&include_adult=false',
    );
    expect(tmdbPluginRoute('/tv/1399/season/1', null)).toBe('raw:/tv/1399/season/1?include_adult=false');
    expect(tmdbPluginRoute('/tv/1399', { append_to_response: 'external_ids,images' })).toContain(
      'append_to_response=external_ids%2Cimages',
    );
    expect(tmdbPluginRoute('/tv/1399', { append_to_response: 'account_states' })).toBe(
      'raw:/tv/1399?include_adult=false',
    );
  });

  it('rejects arbitrary, account and list paths', () => {
    for (const route of [
      'raw:/account/1/favorite/movies',
      '/account',
      '/list/1',
      '/authentication/token/new',
      '/movie/550/account_states',
      '/movie/550/../../account',
      'movie-week',
      '/discover/movie',
      '',
    ]) {
      expect(() => tmdbPluginRoute(route, {})).toThrow(/no permitida/);
    }
  });
});
