import { describe, expect, it, vi } from 'vitest';

vi.mock('./tauri', () => ({ desktopApi: { service: vi.fn() }, resizedImageUrl: (u: string) => u }));
vi.mock('./stremio', () => ({ loadSeasonEpisodes: vi.fn(), loadTitleDetail: vi.fn() }));

import type { Episode } from '../types/models';
import {
  autoNextCountdown,
  classifyChapter,
  creditsStartSec,
  endPhaseAt,
  endScreenActions,
  episodeLabel,
  mergeEpisodes,
  mergeSkipData,
  nextEpisodeAfter,
  parseSkipResponse,
  runtimeMismatch,
  segmentsFromChapters,
  skipPromptAt,
  type SkipData,
} from './episodeFlow';

const ep = (season: number, number: number, title = ''): Episode => ({
  id: `tt1:${season}:${number}`,
  season,
  number,
  title,
  overview: '',
  thumbnail: '',
  released: '',
});

const none: SkipData = { intro: null, recap: null, credits: null, introSource: '', creditsSource: '' };

describe('classifyChapter', () => {
  it('recognises intro, credits, recap and preview names', () => {
    for (const t of ['Intro', 'Opening', 'OP', 'OP1', 'Opening Credits', 'Apertura', 'Introducción', 'NCOP']) {
      expect(classifyChapter(t), t).toBe('intro');
    }
    for (const t of ['Ending', 'ED', 'Credits', 'Créditos', 'End Credits', 'Outro', 'Créditos finales']) {
      expect(classifyChapter(t), t).toBe('credits');
    }
    expect(classifyChapter('Previously on')).toBe('recap');
    expect(classifyChapter('Resumen')).toBe('recap');
    expect(classifyChapter('Preview')).toBe('preview');
    expect(classifyChapter('Avance')).toBe('preview');
  });

  it('ignores generic chapter names', () => {
    for (const t of ['Part A', 'Chapter 3', 'Capítulo 2', 'Prologue', '', 'Avant']) expect(classifyChapter(t), t).toBeNull();
  });
});

describe('segmentsFromChapters', () => {
  it('takes the opening and the ending of an anime episode', () => {
    const d = segmentsFromChapters(
      [
        { start: 0, end: 90, title: 'Opening' },
        { start: 90, end: 1290, title: 'Part A' },
        { start: 1290, end: 1380, title: 'Ending' },
        { start: 1380, end: 1420, title: 'Preview' },
      ],
      1420,
    );
    expect(d.intro).toEqual({ start: 0, end: 90 });
    expect(d.credits).toEqual({ start: 1290, end: 1380 });
    expect(d.introSource).toBe('Capítulos');
  });

  it('rejects implausible chapters', () => {
    const d = segmentsFromChapters(
      [
        { start: 0, end: 900, title: 'Intro' },
        { start: 900, end: 1000, title: 'Credits' },
        { start: 1000, end: 2800, title: 'Main' },
      ],
      2800,
    );
    expect(d.intro).toBeNull();
    expect(d.credits).toBeNull();
    expect(segmentsFromChapters([{ start: 0, end: 90, title: 'Intro' }], 1400)).toEqual(none);
  });
});

describe('mergeSkipData / parseSkipResponse', () => {
  it('maps the core answer and prefers chapters per field', () => {
    const remote = parseSkipResponse({
      returnValue: true,
      intro: { start: 314.5, end: 331 },
      recap: null,
      credits: { start: 2843, end: null },
      introSource: 'IntroDB',
      creditsSource: 'TheIntroDB',
    })!;
    expect(remote.credits).toEqual({ start: 2843, end: null });
    const chapters: SkipData = { ...none, intro: { start: 300, end: 330 }, introSource: 'Capítulos' };
    const m = mergeSkipData(chapters, remote);
    expect(m.intro).toEqual({ start: 300, end: 330 });
    expect(m.introSource).toBe('Capítulos');
    expect(m.creditsSource).toBe('TheIntroDB');
    expect(parseSkipResponse({ returnValue: false })).toBeNull();
  });
});

describe('creditsStartSec', () => {
  it('uses plausible real credits', () => {
    expect(creditsStartSec(1420, { ...none, credits: { start: 1290, end: 1380 } })).toBe(1290);
  });

  it('falls back to the last ~45 s or 3 % of the duration', () => {
    expect(creditsStartSec(1440, none)).toBe(1440 - 45);
    expect(creditsStartSec(3600, none)).toBe(3600 - 108);
    expect(creditsStartSec(2800, { ...none, credits: { start: 100, end: null } })).toBe(2800 - 84);
    expect(creditsStartSec(60, none)).toBeNull();
  });
});

describe('skipPromptAt', () => {
  const real: SkipData = { ...none, intro: { start: 314.5, end: 331 }, recap: { start: 0, end: 60 } };

  it('shows the real intro only inside its segment and jumps to its end', () => {
    expect(skipPromptAt(320, 2900, real, false)).toEqual({ kind: 'intro', label: 'Omitir intro', target: 331, exact: true });
    expect(skipPromptAt(100, 2900, real, false)).toBeNull();
    expect(skipPromptAt(340, 2900, real, false)).toBeNull();
    expect(skipPromptAt(320, 2900, real, true)).toBeNull();
  });

  it('offers to skip a recap', () => {
    expect(skipPromptAt(10, 2900, real, false)?.label).toBe('Omitir resumen');
  });

  it('uses the +85 s heuristic only in the first ~6 minutes', () => {
    // No real data: no button at all.
    expect(skipPromptAt(20, 2900, none, false)).toBeNull();
    expect(skipPromptAt(400, 2900, none, false)).toBeNull();
    expect(skipPromptAt(20, 500, none, false)).toBeNull();
  });
});

describe('end of episode', () => {
  it('moves from playing to credits to ended', () => {
    expect(endPhaseAt(100, 1440, 1395, false)).toBe('playing');
    expect(endPhaseAt(1400, 1440, 1395, false)).toBe('credits');
    expect(endPhaseAt(1439.6, 1440, 1395, false)).toBe('ended');
    expect(endPhaseAt(500, 1440, 1395, true)).toBe('ended');
    expect(endPhaseAt(50, 90, null, false)).toBe('playing');
  });

  it('end screen offers next only when there is one', () => {
    expect(endScreenActions(true)).toEqual(['next', 'exit', 'replay']);
    expect(endScreenActions(false)).toEqual(['exit', 'replay']);
  });

  it('countdown is short and never longer than what is left', () => {
    expect(autoNextCountdown(90)).toBe(10);
    expect(autoNextCountdown(6.2)).toBe(7);
    expect(autoNextCountdown(0.5)).toBe(3);
  });
});

describe('next episode', () => {
  it('crosses into the next season and skips specials', () => {
    const all = [ep(0, 1), ep(1, 1), ep(1, 2), ep(2, 1), ep(2, 2)];
    expect(nextEpisodeAfter(all, ep(1, 1))?.number).toBe(2);
    expect(nextEpisodeAfter(all, ep(1, 2))).toMatchObject({ season: 2, number: 1 });
    expect(nextEpisodeAfter(all, ep(2, 2))).toBeNull();
    expect(nextEpisodeAfter(all, null)).toBeNull();
  });

  it('merges a lazily loaded season once', () => {
    const base = [ep(1, 1), ep(1, 2)];
    const merged = mergeEpisodes(base, [ep(1, 2), ep(2, 1)]);
    expect(merged.map((e) => `${e.season}:${e.number}`)).toEqual(['1:1', '1:2', '2:1']);
    expect(mergeEpisodes(base, [ep(1, 1)])).toBe(base);
    expect(episodeLabel(ep(1, 4, 'Cancer Man'))).toBe('T1·E4 · Cancer Man');
  });
});

describe('runtimeMismatch (wrong-content guard)', () => {
  it('flags a file far from the TMDB runtime (The Office US S1E1 vs the Mexican remake)', () => {
    expect(runtimeMismatch(1717, 24)).toBe(true); // 28:37 vs 24 min
    expect(runtimeMismatch(1665, 22)).toBe(true); // 27:45 vs 22 min
  });

  it('accepts files close to the runtime', () => {
    expect(runtimeMismatch(1265, 21)).toBe(false); // 21:05 vs 21 min
    expect(runtimeMismatch(26 * 60, 24)).toBe(false);
    expect(runtimeMismatch(58 * 60, 50)).toBe(false); // 8 min off, inside 18 % of 50 min (9 min)
  });

  it('never flags when either value is unknown', () => {
    expect(runtimeMismatch(1717, 0)).toBe(false);
    expect(runtimeMismatch(1717, undefined)).toBe(false);
    expect(runtimeMismatch(0, 24)).toBe(false);
    expect(runtimeMismatch(Number.POSITIVE_INFINITY, 24)).toBe(false);
    expect(runtimeMismatch(Number.NaN, 24)).toBe(false);
  });
});
