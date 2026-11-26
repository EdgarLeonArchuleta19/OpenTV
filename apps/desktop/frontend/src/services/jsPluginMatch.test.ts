import { describe, expect, it } from 'vitest';
import {
  absorbCookies,
  baseDomain,
  confirmsYear,
  cookieHeaderFor,
  pickEpisodeRef,
  pickSearchHits,
  pluginFailureMessage,
  sanitizeHeaders,
  streamsFromResolve,
  withRequestLanguage,
  type CookieJar,
} from './jsPluginMatch';

describe('pickSearchHits', () => {
  it('reads the year from a "Title (2025)" card that has no year field (CineHD Plus)', () => {
    const hits = pickSearchHits(
      [
        { id: 'superman-2025', title: 'Superman (2025)', kind: 'movie' },
        { id: 'superman-1978', title: 'Superman (1978)', kind: 'movie' },
        { id: 'superman-ii', title: 'Superman II (1980)', kind: 'movie' },
      ],
      { title: 'Superman', originalTitle: 'Superman', year: 2025, kind: 'movie' },
    );
    expect(hits.map((h) => h.ref)).toEqual(['superman-2025']);
  });

  it('never takes a same-named remake of a series from another decade', () => {
    const hits = pickSearchHits(
      [
        { ref: 's:la-oficina-mx', title: 'La oficina', kind: 'series', year: '2015' },
        { ref: 's:the-office', title: 'La oficina', kind: 'series', year: '2005' },
      ],
      { title: 'La oficina', originalTitle: 'The Office', year: 2005, kind: 'series' },
    );
    expect(hits.map((h) => h.ref)).toEqual(['s:the-office']);
    expect(pickSearchHits([{ ref: 's:la-oficina-mx', title: 'La oficina', kind: 'series', year: '2015' }], { title: 'La oficina', year: 2005, kind: 'series' })).toEqual([]);
  });

  it('never mixes another film of the saga into the opened one', () => {
    const saga = [
      { ref: 'm:en-llamas', title: 'Los juegos del hambre: En llamas', kind: 'movie', year: '2013' },
      { ref: 'm:original', title: 'Los juegos del hambre', kind: 'movie', year: '2012' },
      { ref: 'm:sinsajo', title: 'Los juegos del hambre: Sinsajo - Parte 1', kind: 'movie', year: '2014' },
    ];
    expect(pickSearchHits(saga, { title: 'Los juegos del hambre', originalTitle: 'The Hunger Games', year: 2012, kind: 'movie' }).map((h) => h.ref)).toEqual(['m:original']);
    // The site lists only the sequel: it is not taken for the 2012 film.
    expect(pickSearchHits(saga.slice(0, 1), { title: 'Los juegos del hambre', year: 2012, kind: 'movie' })).toEqual([]);
    // Opening the sequel never pulls the first film either.
    expect(pickSearchHits(saga, { title: 'Los juegos del hambre: En llamas', year: 2013, kind: 'movie' }).map((h) => h.ref)).toEqual(['m:en-llamas']);
  });

  it('accepts the Spanish-titled first hit of the same year and kind', () => {
    const hits = pickSearchHits(
      [
        { ref: 'm:el-origen', title: 'El origen', kind: 'movie', year: '2010' },
        { ref: 'm:sin-origen', title: 'Sin origen', kind: 'movie', year: '2019' },
      ],
      { title: 'Inception', year: 2010, kind: 'movie' },
    );
    expect(hits.map((h) => h.ref)).toEqual(['m:el-origen']);
  });

  it('never accepts a different film or the wrong kind', () => {
    const hits = pickSearchHits(
      [
        { ref: 's:better-call-saul', title: 'Better Call Saul', kind: 'series', year: '2015' },
        { ref: 'm:guerra-mundial-z', title: 'Guerra mundial Z', kind: 'movie', year: '2013' },
      ],
      { title: 'Breaking Bad', year: 2008, kind: 'series' },
    );
    expect(hits).toEqual([]);
  });

  it('ranks the exact title first and uses originalTitle', () => {
    const hits = pickSearchHits(
      [
        { ref: 'a:movie:1', title: 'Inception: The Cobol Job', kind: 'movie', year: '2010' },
        { ref: 'a:movie:27205', title: 'Inception', kind: 'movie', year: '2010' },
      ],
      { title: 'El origen', originalTitle: 'Inception', year: 2010, kind: 'movie' },
    );
    expect(hits[0].ref).toBe('a:movie:27205');
  });

  it('marks a yearless translated first hit for verification only', () => {
    const hits = pickSearchHits(
      [
        { ref: 'm:el-origen', title: 'El Origen', kind: 'movie' },
        { ref: 'm:sin-origen', title: 'Sin origen', kind: 'movie' },
      ],
      { title: 'Inception', year: 2010, kind: 'movie' },
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ ref: 'm:el-origen', verify: true });
    expect(confirmsYear({ year: '2010' }, { title: 'Inception', year: 2010, kind: 'movie' })).toBe(true);
    expect(confirmsYear({ year: '2011' }, { title: 'Inception', year: 2010, kind: 'movie' })).toBe(false);
    expect(confirmsYear({}, { title: 'Inception', year: 2010, kind: 'movie' })).toBe(false);
  });

  it('rejects movies more than a year apart', () => {
    expect(
      pickSearchHits([{ ref: 'm:dune', title: 'Dune', kind: 'movie', year: '1984' }], {
        title: 'Dune',
        year: 2021,
        kind: 'movie',
      }),
    ).toEqual([]);
  });
});

describe('pickEpisodeRef', () => {
  it('matches season and episode and never falls back', () => {
    const eps = [
      { season: 1, number: 1, ref: 'e:a' },
      { season: 2, number: 3, ref: 'e:b' },
    ];
    expect(pickEpisodeRef(eps, 2, 3)).toBe('e:b');
    expect(pickEpisodeRef(eps, 5, 1)).toBe('');
  });
});

describe('streamsFromResolve', () => {
  it('flattens one stream with alternatives and keeps headers', () => {
    const rows = streamsFromResolve({
      url: 'https://a.example/master.m3u8',
      label: 'Latino · fastream.to',
      mime: 'application/vnd.apple.mpegurl',
      headers: { 'User-Agent': 'UA', Referer: 'https://pelispedia.is/' },
      alternatives: [
        { url: 'https://b.example/v.mp4', label: 'Relay', mime: 'video/mp4' },
        { ref: 'c:m:x@1', label: 'Lazy' },
      ],
    });
    expect(rows.map((r) => r.url)).toEqual(['https://a.example/master.m3u8', 'https://b.example/v.mp4']);
    expect(rows[0].headers.Referer).toBe('https://pelispedia.is/');
    expect(rows[1].headers['User-Agent']).toBe('UA');
  });

  it('accepts {streams:[...]} with Kino header lists and referer', () => {
    const rows = streamsFromResolve({
      streams: [{ url: 'https://h.example/x.m3u8', referer: 'https://wish.example/', headers: [{ name: 'Origin', value: 'https://wish.example' }] }],
    });
    expect(rows[0].headers).toEqual({ Origin: 'https://wish.example', Referer: 'https://wish.example/' });
  });

  it('drops non-http urls', () => {
    expect(streamsFromResolve([{ url: 'javascript:alert(1)' }, { url: 'file:///c:/x' }])).toEqual([]);
  });
});

describe('cookies and headers', () => {
  it('keeps host-only cookies under the response host and sends them back', () => {
    const jar: CookieJar = {};
    absorbCookies(jar, ['sid=abc; Path=/; HttpOnly', 'cf=1; Domain=.example.com'], 'https://www.site.to/x');
    expect(jar['www.site.to'].sid).toBe('abc');
    expect(cookieHeaderFor(jar, 'https://www.site.to/next')).toBe('sid=abc');
    expect(cookieHeaderFor(jar, 'https://api.example.com/')).toBe('cf=1');
    expect(cookieHeaderFor(jar, 'https://other.net/')).toBe('');
  });

  it('rejects header injection', () => {
    expect(sanitizeHeaders({ Good: 'ok', 'Bad Name': 'x', Evil: 'a\r\nX: y' })).toEqual({ Good: 'ok' });
  });
});

describe('withRequestLanguage', () => {
  it('replays the Accept-Language used on the embed domain', () => {
    const langs = new Map([['fastream.to', 'es-ES,es;q=0.9']]);
    expect(baseDomain('https://s40.fastream.to/hls2/x.m3u8')).toBe('fastream.to');
    expect(withRequestLanguage({ 'User-Agent': 'UA' }, 'https://s40.fastream.to/master.m3u8', langs)).toEqual({
      'User-Agent': 'UA',
      'Accept-Language': 'es-ES,es;q=0.9',
    });
    expect(
      withRequestLanguage({ Referer: 'https://fastream.to/embed-1.html' }, 'https://cdn.other.net/a.m3u8', langs)['Accept-Language'],
    ).toBe('es-ES,es;q=0.9');
    expect(withRequestLanguage({ 'accept-language': 'en' }, 'https://s40.fastream.to/a', langs)).toEqual({ 'accept-language': 'en' });
    expect(withRequestLanguage({}, 'https://x.example/a', langs)).toEqual({});
  });
});

describe('pluginFailureMessage', () => {
  it('prefers the plugin userMessage and maps codes to Spanish', () => {
    expect(pluginFailureMessage('Pelispedia', { message: 'x', code: 'not_found', userMessage: 'Ningún servidor abrió.' })).toBe(
      'Pelispedia: Ningún servidor abrió',
    );
    expect(pluginFailureMessage('FrameXTV +', { message: 'Timeout del plugin JS', code: 'timeout' })).toBe(
      'FrameXTV +: tardó demasiado en responder',
    );
    expect(pluginFailureMessage('Cuevana Pro', { message: 'Sin coincidencias', code: 'not_found' })).toBe(
      'Cuevana Pro: no encontró este título',
    );
  });
});
