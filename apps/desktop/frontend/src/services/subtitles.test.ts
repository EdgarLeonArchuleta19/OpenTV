import { describe, expect, it } from 'vitest';
import {
  cueTextAt,
  decodeSubtitleBytes,
  isLatamSpanish,
  maybeGunzip,
  orderSubtitles,
  parseSubtitles,
  parseTimestamp,
  pickAutoSubtitle,
  subLangMatches,
  subtitleLangRank,
} from './subtitles';

const SRT = '1\r\n00:00:01,000 --> 00:00:03,500\r\n<i>¿Dónde está?</i>\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\nLínea uno\r\nLínea dos\r\n';

describe('subtitles', () => {
  it('parses SRT with CRLF, tags and multi-line cues', () => {
    const cues = parseSubtitles(SRT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 1, end: 3.5, text: '¿Dónde está?' });
    expect(cues[1].text).toBe('Línea uno\nLínea dos');
  });

  it('splits blocks separated by whitespace-only lines', () => {
    const cues = parseSubtitles('1\n00:00:01,000 --> 00:00:02,000\nA\n  \n2\n00:00:03,000 --> 00:00:04,000\nB\n');
    expect(cues.map((c) => c.text)).toEqual(['A', 'B']);
  });

  it('parses WebVTT with header, short timestamps, settings and entities', () => {
    const vtt = 'WEBVTT\n\nNOTE comentario\n\n00:01.000 --> 00:02.500 align:start\nTom &amp; Jerry\n\nid-2\n01:00:00.000 --> 01:00:01.000\n<c.yellow>Fin</c>\n';
    const cues = parseSubtitles(vtt);
    expect(cues).toEqual([
      { start: 1, end: 2.5, text: 'Tom & Jerry' },
      { start: 3600, end: 3601, text: 'Fin' },
    ]);
  });

  it('parses ASS/SSA dialogue lines with override tags and commas in text', () => {
    const ass = [
      '[Script Info]',
      'Title: prueba',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\an8}Hola, mundo\\NSegunda',
      'Dialogue: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,{\\p1}m 0 0 l 10 10{\\p0}',
    ].join('\n');
    const cues = parseSubtitles(ass);
    expect(cues).toEqual([{ start: 1.5, end: 3, text: 'Hola, mundo\nSegunda' }]);
  });

  it('rejects malformed timestamps', () => {
    expect(Number.isNaN(parseTimestamp('aa:bb'))).toBe(true);
    expect(parseTimestamp('00:00:02,250')).toBe(2.25);
  });

  it('decodes UTF-8, UTF-8 BOM, UTF-16LE and Windows-1252 bytes', () => {
    expect(decodeSubtitleBytes(new TextEncoder().encode('Canción'))).toBe('Canción');
    expect(decodeSubtitleBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('A');
    const utf16 = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0xf1, 0x00]);
    expect(decodeSubtitleBytes(utf16)).toBe('Añ');
    // "Canción ¿sí?" encoded as Windows-1252 (invalid UTF-8).
    const cp1252 = new Uint8Array([0x43, 0x61, 0x6e, 0x63, 0x69, 0xf3, 0x6e, 0x20, 0xbf, 0x73, 0xed, 0x3f]);
    expect(decodeSubtitleBytes(cp1252)).toBe('Canción ¿sí?');
  });

  it('inflates gzip payloads', async () => {
    const stream = new Blob([SRT]).stream().pipeThrough(new CompressionStream('gzip'));
    const gz = new Uint8Array(await new Response(stream).arrayBuffer());
    expect(gz[0]).toBe(0x1f);
    const out = await maybeGunzip(gz);
    expect(parseSubtitles(decodeSubtitleBytes(out))).toHaveLength(2);
  });

  it('finds the active cue (including overlaps) by time', () => {
    const cues = parseSubtitles(
      '1\n00:00:01,000 --> 00:00:10,000\nLargo\n\n2\n00:00:02,000 --> 00:00:03,000\nCorto\n',
    );
    expect(cueTextAt(cues, 0.5)).toBe('');
    expect(cueTextAt(cues, 2.5)).toBe('Largo\nCorto');
    expect(cueTextAt(cues, 5)).toBe('Largo');
    expect(cueTextAt(cues, 11)).toBe('');
  });

  it('matches OpenSubtitles language codes and picks the preferred one', () => {
    expect(subLangMatches('spa', 'es')).toBe(true);
    expect(subLangMatches('pob', 'pt')).toBe(true);
    expect(subLangMatches('por', 'pt')).toBe(true);
    expect(subLangMatches('ger', 'es')).toBe(false);
    const subs = [{ lang: 'ger' }, { lang: 'eng' }, { lang: 'spa' }];
    expect(pickAutoSubtitle(subs, 'es')?.lang).toBe('spa');
    expect(pickAutoSubtitle([{ lang: 'ger' }, { lang: 'eng' }], 'es')?.lang).toBe('eng');
    expect(pickAutoSubtitle([{ lang: 'ger' }], 'es')).toBeUndefined();
  });
});

describe('subtitle order', () => {
  const sub = (id: string, lang: string, source: string, origin?: 'embedded' | 'opensubtitles' | 'subdl' | 'subtitlecat') => ({
    id,
    lang,
    label: '',
    source,
    origin,
  });

  it('detects Latin-American Spanish by code or label', () => {
    expect(isLatamSpanish('es-419')).toBe(true);
    expect(isLatamSpanish('es-MX')).toBe(true);
    expect(isLatamSpanish('spl')).toBe(true);
    expect(isLatamSpanish('spa', 'Español (Latinoamérica)')).toBe(true);
    expect(isLatamSpanish('es-ES')).toBe(false);
    expect(isLatamSpanish('spa')).toBe(false);
    expect([subtitleLangRank('lat'), subtitleLangRank('spa'), subtitleLangRank('eng'), subtitleLangRank('fre')]).toEqual([0, 1, 2, 3]);
  });

  it('embedded, then OpenSubtitles, SubDL, SubtitleCat; LatAm > Spanish > English inside each', () => {
    const ordered = orderSubtitles([
      sub('scat_0', 'es', 'Búsqueda manual'),
      sub('subdl_1', 'en', 'SubDL', 'subdl'),
      sub('subdl_2', 'es-419', 'SubDL', 'subdl'),
      sub('default_opensubtitles_0', 'eng', 'OpenSubtitles', 'opensubtitles'),
      sub('default_opensubtitles_1', 'spa', 'OpenSubtitles', 'opensubtitles'),
      sub('default_opensubtitles_2', 'spl', 'OpenSubtitles', 'opensubtitles'),
      sub('emb_t_3', 'eng', 'Incrustado en el archivo'),
      sub('emb_t_2', 'spa', 'Incrustado en el archivo'),
    ]);
    expect(ordered.map((s) => s.id)).toEqual([
      'emb_t_2',
      'emb_t_3',
      'default_opensubtitles_2',
      'default_opensubtitles_1',
      'default_opensubtitles_0',
      'subdl_2',
      'subdl_1',
      'scat_0',
    ]);
  });

  it('auto-picks Latin-American Spanish from an ordered list', () => {
    const ordered = orderSubtitles([sub('a', 'spa', 'OpenSubtitles'), sub('b', 'spl', 'OpenSubtitles')]);
    expect(pickAutoSubtitle(ordered, 'es')?.id).toBe('b');
  });
});
