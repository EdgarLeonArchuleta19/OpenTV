import { beforeEach, describe, expect, it } from 'vitest';
import {
  autoTargetQuality,
  detectPlaybackEnv,
  recordBandwidthEstimate,
  recordThroughput,
  resetMeasuredThroughput,
  type PlaybackEnv,
} from './deviceProfile';
import { effectiveTargetQuality, rankSources } from './sourceRanker';
import type { SourcePrefs } from '../types/models';

const PREFS: SourcePrefs = {
  langs: ['latino', 'castellano'],
  quality: 'auto',
  exclude: [],
  minSeeds: 0,
  maxMovieGb: 0,
  maxEpisodeGb: 0,
  autoPlay: true,
  subsFrom: 'file',
};

const GOOD_PC: PlaybackEnv = { memoryGb: 8, cores: 12, measuredMbps: 80, apiMbps: 10, constrained: false };
const WEAK_PC: PlaybackEnv = { memoryGb: 2, cores: 2, measuredMbps: 80, apiMbps: 10, constrained: false };
const SLOW_NET: PlaybackEnv = { memoryGb: 8, cores: 8, measuredMbps: 4, apiMbps: 10, constrained: false };

describe('autoTargetQuality', () => {
  beforeEach(() => resetMeasuredThroughput());

  it('good PC + good internet -> 1080p, otherwise 720p', () => {
    expect(autoTargetQuality(GOOD_PC)).toBe('1080p');
    expect(autoTargetQuality(WEAK_PC)).toBe('720p');
    expect(autoTargetQuality(SLOW_NET)).toBe('720p');
    expect(autoTargetQuality({ ...GOOD_PC, constrained: true })).toBe('720p');
  });

  it('uses the Network Information API only below its 10 Mbit/s cap', () => {
    expect(autoTargetQuality({ ...GOOD_PC, measuredMbps: 0, apiMbps: 10 })).toBe('1080p');
    expect(autoTargetQuality({ ...GOOD_PC, measuredMbps: 0, apiMbps: 3.5 })).toBe('720p');
    expect(autoTargetQuality({ ...GOOD_PC, measuredMbps: 0, apiMbps: 0 })).toBe('1080p');
  });

  it('reads navigator and smooths measured samples', () => {
    const nav = { deviceMemory: 8, hardwareConcurrency: 8, connection: { downlink: 10, effectiveType: '4g' } };
    expect(detectPlaybackEnv(nav).measuredMbps).toBe(0);
    recordThroughput(1024, 5); // too small: ignored
    expect(detectPlaybackEnv(nav).measuredMbps).toBe(0);
    recordThroughput(2_000_000, 1000); // 16 Mbit/s
    expect(detectPlaybackEnv(nav).measuredMbps).toBeCloseTo(16, 1);
    recordBandwidthEstimate(4_000_000); // 4 Mbit/s pulls the average down
    const env = detectPlaybackEnv(nav);
    expect(env.measuredMbps).toBeCloseTo(12.4, 1);
    expect(detectPlaybackEnv({ connection: { effectiveType: '3g' } }).constrained).toBe(true);
  });
});

describe('rankSources quality target', () => {
  const sources = [
    { id: 'uhd', addonId: 'a', addonName: 'A', title: 'Movie 2160p 4K HEVC 10bit HDR Latino', url: 'https://x/1' },
    { id: 'fhd', addonId: 'a', addonName: 'A', title: 'Movie 1080p Latino', url: 'https://x/2' },
    { id: 'hd', addonId: 'a', addonName: 'A', title: 'Movie 720p Latino', url: 'https://x/3' },
  ];

  it('auto picks Full HD on a capable PC and HD on a weak one, never 4K', () => {
    expect(rankSources(sources, PREFS, false, GOOD_PC)[0].id).toBe('fhd');
    expect(rankSources(sources, PREFS, false, WEAK_PC)[0].id).toBe('hd');
    expect(rankSources(sources, PREFS, false, SLOW_NET)[0].id).toBe('hd');
    expect(rankSources(sources, PREFS, false, GOOD_PC).map((s) => s.id).indexOf('uhd')).toBe(2);
  });

  it('keeps the manual override', () => {
    expect(rankSources(sources, { ...PREFS, quality: '4K' }, false, WEAK_PC)[0].id).toBe('uhd');
    expect(rankSources(sources, { ...PREFS, quality: '720p' }, false, GOOD_PC)[0].id).toBe('hd');
    expect(effectiveTargetQuality({ ...PREFS, quality: '1080p' }, WEAK_PC)).toBe('1080p');
    expect(effectiveTargetQuality(PREFS, WEAK_PC)).toBe('720p');
  });

  it('language still beats quality', () => {
    const ranked = rankSources(
      [
        { id: 'en', addonId: 'a', addonName: 'A', title: 'Movie 1080p English', url: 'https://x/1' },
        { id: 'lat', addonId: 'a', addonName: 'A', title: 'Movie 720p Latino', url: 'https://x/2' },
      ],
      PREFS,
      false,
      GOOD_PC,
    );
    expect(ranked[0].id).toBe('lat');
  });
});
