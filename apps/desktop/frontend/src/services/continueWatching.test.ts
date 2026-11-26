import { describe, expect, it } from 'vitest';
import { continueWatchingRow } from './continueWatching';
import type { WatchProgress } from '../types/models';

const ep = (itemId: string, season: number, episode: number, updatedAt: number, pos = 0.5): WatchProgress => ({
  itemId,
  type: 'series',
  title: itemId,
  poster: '',
  backdrop: '',
  season,
  episode,
  episodeTitle: '',
  positionMs: pos * 3_000_000,
  durationMs: 3_000_000,
  updatedAt,
});

describe('continueWatchingRow', () => {
  it('keeps only the most recently watched episode per series', () => {
    const row = continueWatchingRow([ep('a', 1, 3, 10), ep('a', 2, 1, 30), ep('b', 1, 1, 20), ep('a', 1, 5, 5)]);
    expect(row.map((e) => [e.itemId, e.season, e.episode])).toEqual([
      ['a', 2, 1],
      ['b', 1, 1],
    ]);
  });

  it('hides the title when its latest episode is finished instead of showing an older one', () => {
    const row = continueWatchingRow([ep('a', 1, 2, 20, 0.99), ep('a', 1, 1, 10)]);
    expect(row).toEqual([]);
  });
});
