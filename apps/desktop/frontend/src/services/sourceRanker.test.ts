import { describe, expect, it } from 'vitest';
import { seedBuiltinPlugins } from './catalogs';
import { autoPickReady, directWaitMs, enrichSource, rankSources, torrentRaceAlternatives } from './sourceRanker';
import type { PlaybackEnv } from './deviceProfile';
import type { SourcePrefs } from '../types/models';

const DEFAULT_PREFS: SourcePrefs = {
  langs: ['latino', 'castellano'],
  quality: 'auto',
  exclude: [],
  minSeeds: 0,
  maxMovieGb: 0,
  maxEpisodeGb: 0,
  autoPlay: true,
  subsFrom: 'file',
};

const FAST_PC: PlaybackEnv = { memoryGb: 8, cores: 8, measuredMbps: 50, apiMbps: 0, constrained: false };

describe('sourceRanker', () => {
  it('distinguishes latino, castellano, subtitles, seeders and size', () => {
    const lat = enrichSource({
      id: '1',
      addonId: 't',
      addonName: 'Torrentio',
      name: '1080p',
      title: 'Movie 2025 🇲🇽 Dual Latino 👤 80 💾 2.5 GB',
      infoHash: 'aaa',
    });
    const cast = enrichSource({
      id: '2',
      addonId: 't',
      addonName: 'Torrentio',
      name: '1080p',
      title: 'Movie 2025 🇪🇸 Castellano 👤 90 💾 2.5 GB',
      infoHash: 'bbb',
    });
    const subsOnly = enrichSource({
      id: '3',
      addonId: 't',
      addonName: 'Torrentio',
      name: '1080p',
      title: 'Movie 2025 English VOSE Subtitulada Español',
      infoHash: 'ccc',
    });

    expect(lat.langs).toContain('latino');
    expect(cast.langs).toContain('castellano');
    expect(subsOnly.langs).not.toContain('latino');
    expect(subsOnly.hasSubsEs).toBe(true);
    expect(lat.seeders).toBe(80);
    expect(lat.sizeBytes).toBeGreaterThan(2_000_000_000);
  });

  it('prefers viewer language over 4K English and penalizes CAM', () => {
    const ranked = rankSources(
      [
        { id: 'en4k', addonId: 't', addonName: 'T', title: 'Movie 2160p 4K HDR English 👤 200 💾 14 GB', infoHash: '222' },
        { id: 'cam', addonId: 't', addonName: 'T', title: 'Movie HDCAM Latino 👤 500 💾 1.2 GB', infoHash: '333' },
        { id: 'lat', addonId: 't', addonName: 'T', title: 'Movie 1080p Latino 👤 50 💾 2.1 GB', infoHash: '111' },
      ],
      DEFAULT_PREFS,
    );
    expect(ranked[0].id).toBe('lat');
    expect(ranked[ranked.length - 1].id).toBe('cam');
  });

  it('selects compatible torrent race alternatives without CAM', () => {
    const ranked = rankSources(
      [
        { id: '1', addonId: 't', addonName: 'T', title: '1080p Latino 👤 80', infoHash: 'h1' },
        { id: '2', addonId: 't', addonName: 'T', title: '1080p Latino 👤 45', infoHash: 'h2' },
        { id: '3', addonId: 't', addonName: 'T', title: '1080p HDCAM Latino 👤 200', infoHash: 'h3' },
        { id: '4', addonId: 't', addonName: 'T', title: '1080p English 👤 150', infoHash: 'h4' },
      ],
      DEFAULT_PREFS,
    );
    const alts = torrentRaceAlternatives(ranked[0], ranked, 2);
    expect(alts.map((a) => a.infoHash)).toEqual(['h2']);
  });

  it('always seeds Cinemeta, Anime Kitsu and OpenSubtitles v3', () => {
    const seeded = seedBuiltinPlugins([]);
    expect(seeded).toHaveLength(3);
    expect(seeded.every((p) => p.builtin && !p.disabled)).toBe(true);
    expect(seeded.map((p) => p.id)).toEqual(['default_cinemeta', 'default_kitsu', 'default_opensubtitles']);
  });

  it('a direct source in the preferred language beats seeded torrents of the same language', () => {
    const ranked = rankSources(
      [
        { id: 'tor', addonId: 't', addonName: 'Torrentio', title: 'Movie 1080p Latino 👤 900 💾 2.1 GB', infoHash: 'a1' },
        { id: 'tor4k', addonId: 't', addonName: 'Torrentio', title: 'Movie 2160p Latino 👤 300 💾 9 GB', infoHash: 'a2' },
        // JS plugin HLS: no quality tag ("auto") -> treated as the target quality.
        { id: 'js', addonId: 'pelis', addonName: 'Pelispedia', title: 'Latino · fastream', url: 'https://cdn.example/master.m3u8', isJsPlugin: true },
      ],
      DEFAULT_PREFS,
      false,
      FAST_PC,
    );
    expect(ranked[0].id).toBe('js');
    expect(ranked.map((s) => s.id).slice(1)).toEqual(['tor', 'tor4k']);
  });

  it('keeps language first: a torrent in a better language stays above a direct one', () => {
    const ranked = rankSources(
      [
        { id: 'js-en', addonId: 'pelis', addonName: 'Pelispedia', title: 'English · server', url: 'https://cdn.example/a.m3u8', isJsPlugin: true },
        { id: 'tor-cast', addonId: 't', addonName: 'Torrentio', title: 'Movie 1080p Castellano 👤 40', infoHash: 'b1' },
        { id: 'tor-en', addonId: 't', addonName: 'Torrentio', title: 'Movie 1080p English 👤 900', infoHash: 'b2' },
      ],
      DEFAULT_PREFS,
      false,
      FAST_PC,
    );
    expect(ranked.map((s) => s.id)).toEqual(['tor-cast', 'js-en', 'tor-en']);
  });

  it('never promotes CAM or HEVC/10-bit direct sources over torrents (auto)', () => {
    const ranked = rankSources(
      [
        { id: 'tor', addonId: 't', addonName: 'T', title: 'Movie 1080p Latino 👤 120', infoHash: 'c1' },
        { id: 'cam', addonId: 'j', addonName: 'J', title: 'Latino HDCAM', url: 'https://x.example/cam.m3u8', isJsPlugin: true },
        { id: 'hevc', addonId: 'j', addonName: 'J', title: 'Latino 1080p x265 10bit', url: 'https://x.example/h.mkv', isJsPlugin: true },
      ],
      DEFAULT_PREFS,
      false,
      FAST_PC,
    );
    expect(ranked[0].id).toBe('tor');
    expect(ranked[ranked.length - 1].id).toBe('cam');
  });

  it('auto-pick waits for direct sources within bounds', () => {
    const prefs = DEFAULT_PREFS;
    const torrents = rankSources([{ id: 't', addonId: 't', addonName: 'T', title: '1080p Latino 👤 50', infoHash: 'd1' }], prefs);
    const directLat = rankSources(
      [{ id: 'j', addonId: 'j', addonName: 'J', title: 'Latino', url: 'https://x.example/a.m3u8', isJsPlugin: true }],
      prefs,
    );
    const directCast = rankSources(
      [{ id: 'j2', addonId: 'j', addonName: 'J', title: 'Castellano', url: 'https://x.example/b.m3u8', isJsPlugin: true }],
      prefs,
    );
    const base = { prefs, capable: true, allDone: false };
    // Nothing yet: keep waiting up to 70 s.
    expect(autoPickReady({ ...base, ranked: [], msSinceFirstResult: 0, msTotal: 30_000 })).toBe(false);
    expect(autoPickReady({ ...base, ranked: [], msSinceFirstResult: 0, msTotal: 70_000 })).toBe(true);
    // Only torrents: grace window for slow JS plugins.
    expect(autoPickReady({ ...base, ranked: torrents, msSinceFirstResult: 2_500, msTotal: 4_000 })).toBe(false);
    expect(autoPickReady({ ...base, ranked: torrents, msSinceFirstResult: directWaitMs(true), msTotal: 12_000 })).toBe(true);
    // Direct in the first preferred language: stop at once.
    expect(autoPickReady({ ...base, ranked: directLat, msSinceFirstResult: 0, msTotal: 1_000 })).toBe(true);
    // Direct in the second language: still worth waiting for a better one.
    expect(autoPickReady({ ...base, ranked: directCast, msSinceFirstResult: 1_000, msTotal: 3_000 })).toBe(false);
    // Everything answered.
    expect(autoPickReady({ ...base, allDone: true, ranked: [], msSinceFirstResult: 0, msTotal: 100 })).toBe(true);
    expect(directWaitMs(false)).toBeGreaterThan(directWaitMs(true));
  });
});
