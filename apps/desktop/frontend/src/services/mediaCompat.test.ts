import { describe, expect, it } from 'vitest';
import type { StreamSource } from '../types/models';
import {
  buildCompatStreamUrl,
  isHlsUrl,
  isRefusalStatus,
  pickNextSourceIndex,
  pickSameLanguageSourceIndex,
  pickPreferredAudioIndex,
  playbackFailureMessage,
  proactiveCompatHint,
} from './mediaCompat';

const baseSource: StreamSource = {
  id: 's1',
  addonId: 'torrentio',
  addonName: 'Torrentio',
  name: '1080p',
  title: 'Movie',
  url: 'http://127.0.0.1:8910/t/tok/movie.mkv',
  infoHash: 'abc',
  filename: 'movie.mkv',
  trackers: [],
  headers: {},
  isJsPlugin: false,
  quality: '1080p',
  sizeBytes: 0,
  seeders: 50,
  langs: ['latino'],
  isOriginal: false,
  isMulti: false,
  hasSubsEs: false,
  isCam: false,
  isHevc: false,
  isTenBit: false,
  isHdr: false,
  isRemux: false,
  isDts: false,
  isTrueHd: false,
  isEac3: false,
  isAtmos: false,
  isAv1: false,
  is3d: false,
  isMp4: false,
  provider: 'Torrentio',
  score: 0,
};

describe('mediaCompat hybrid PC engine helpers', () => {
  it('chooses copy remux for H.264 MKV with DTS/TrueHD/E-AC3 and transcode for 10-bit HEVC or AVI', () => {
    expect(proactiveCompatHint({ ...baseSource, isDts: true }, baseSource.url)).toBe('copy');
    expect(proactiveCompatHint({ ...baseSource, isTrueHd: true }, baseSource.url)).toBe('copy');
    expect(proactiveCompatHint({ ...baseSource, isEac3: true, isHevc: true }, baseSource.url)).toBe('transcode');
    expect(proactiveCompatHint({ ...baseSource, isTenBit: true }, baseSource.url)).toBe('transcode');
    expect(proactiveCompatHint({ ...baseSource, filename: 'old.avi' }, 'http://127.0.0.1:8910/t/x/old.avi')).toBe('transcode');
    expect(proactiveCompatHint({ ...baseSource, isMp4: true, filename: 'movie.mp4' }, 'https://cdn.example/movie.mp4')).toBeNull();
    expect(proactiveCompatHint(baseSource, 'https://cdn.example/live/master.m3u8')).toBeNull();
  });

  it('picks preferred audio track matching user language (Latino > Castellano for es)', () => {
    const tracks = [
      { index: 0, codec: 'dts', lang: 'eng', title: 'Original English', channels: '5.1', label: 'Inglés (DTS 5.1)' },
      { index: 1, codec: 'eac3', lang: 'spa', title: 'Castellano', channels: '5.1', label: 'Español · Castellano (EAC3 5.1)' },
      { index: 2, codec: 'eac3', lang: 'spa', title: 'Español Latino', channels: '5.1', label: 'Español Latino (EAC3 5.1)' },
    ];
    expect(pickPreferredAudioIndex(tracks, 'es')).toBe(2);
    expect(pickPreferredAudioIndex(tracks, 'en')).toBe(0);
  });

  it('builds clean compat seek/audio stream URLs', () => {
    expect(buildCompatStreamUrl('http://127.0.0.1:8910/compat/abc.mp4?start=0', 124.78, 2, 'copy')).toBe(
      'http://127.0.0.1:8910/compat/abc.mp4?start=124.7&audio=2&mode=copy',
    );
  });

  it('detects HLS by extension, proxy path or resolver sniffing', () => {
    expect(isHlsUrl('https://cdn.example/live/index.m3u8?token=1')).toBe(true);
    expect(isHlsUrl('http://127.0.0.1:8910/hls/abc/Zm9v')).toBe(true);
    expect(isHlsUrl('https://cdn.example/play?id=7')).toBe(false);
    expect(isHlsUrl('https://cdn.example/play?id=7', new Set(['https://cdn.example/play?id=7']))).toBe(true);
    expect(isHlsUrl('https://cdn.example/movie.mp4')).toBe(false);
  });

  it('explains final playback failures in Spanish', () => {
    expect(playbackFailureMessage(4, false)).toContain('FFmpeg');
    expect(playbackFailureMessage(3, true)).toContain('formato');
    expect(playbackFailureMessage(2, true)).toContain('conexión');
    expect(playbackFailureMessage(null, true)).toContain('Fuentes');
  });
});

describe('source fallback', () => {
  it('treats rate limits and forbidden links as refusals', () => {
    expect(isRefusalStatus(403)).toBe(true);
    expect(isRefusalStatus(429)).toBe(true);
    expect(isRefusalStatus(206)).toBe(false);
    expect(isRefusalStatus(200)).toBe(false);
  });

  it('prefers a different server after one refused', () => {
    const ranked = [
      { id: 'a', url: 'https://cdn.box.com/1.mp4' },
      { id: 'b', url: 'https://cdn.box.com/2.mp4' },
      { id: 'c', url: 'https://pixeldrain.dev/api/file/x' },
    ];
    expect(pickNextSourceIndex(ranked, new Set(['a']), new Set(['cdn.box.com']))).toBe(2);
    expect(pickNextSourceIndex(ranked, new Set(['a', 'c']), new Set(['cdn.box.com']))).toBe(1);
    expect(pickNextSourceIndex(ranked, new Set(['a', 'b', 'c']), new Set())).toBe(-1);
    expect(pickNextSourceIndex(ranked, new Set(['a']), new Set(), 1)).toBe(-1);
  });
});

describe('pickSameLanguageSourceIndex', () => {
  const ranked = [
    { id: 'a', url: 'https://mg.example.com/1.mkv', langs: ['es'] },
    { id: 'b', url: 'https://other.example.com/2.mkv', langs: ['en'] },
    { id: 'c', url: 'https://third.example.com/3.mkv', langs: ['ES', 'en'] },
  ];

  it('prefers another source in the same language', () => {
    expect(pickSameLanguageSourceIndex(ranked, ranked[0], new Set(['a']), new Set())).toBe(2);
  });

  it('skips failed servers and falls back to the next untried source', () => {
    expect(pickSameLanguageSourceIndex(ranked, ranked[0], new Set(['a']), new Set(['third.example.com']))).toBe(1);
    expect(pickSameLanguageSourceIndex(ranked, { langs: [] }, new Set(['a']), new Set())).toBe(1);
    expect(pickSameLanguageSourceIndex(ranked, ranked[0], new Set(['a', 'b', 'c']), new Set())).toBe(-1);
  });
});
