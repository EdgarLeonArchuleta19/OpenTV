import { describe, expect, it } from 'vitest';
import type { EpgProgram } from '../types/models';
import {
  buildProgrammeCards,
  channelMonogram,
  channelNameVariants,
  fmtHour,
  guessGuideCountry,
  isPlaceholderGuide,
  programmeProgress,
} from './liveSchedule';

const H = 3_600_000;
const BASE = Date.UTC(2026, 10, 24, 14, 0, 0);
const prog = (title: string, startH: number, endH: number): EpgProgram => ({
  title,
  description: '',
  startMs: BASE + startH * H,
  endMs: BASE + endH * H,
});

describe('buildProgrammeCards', () => {
  const schedule = [
    prog('Comedia', 3.5, 5),
    prog('Antes', -2, 0),
    prog('Noches de ciudad', 0, 1.75),
    prog('El último tren', 1.75, 3.5),
    prog('Cine de oro', 5, 7),
    prog('Madrugada', 7, 9),
  ];
  const now = BASE + 0.7 * H;

  it('picks now, next and the next two by start time', () => {
    const cards = buildProgrammeCards(schedule, undefined, now);
    expect(cards.map((c) => c.title)).toEqual(['Noches de ciudad', 'El último tren', 'Comedia', 'Cine de oro']);
    expect(cards.map((c) => c.kind)).toEqual(['now', 'next', 'later', 'later']);
    expect(cards[0].label).toBe('AHORA');
    expect(cards[1].label).toBe('DESPUÉS');
    expect(cards[2].label).toBe(fmtHour(schedule[0].startMs));
    expect(cards[0].time).toBe(`${fmtHour(BASE)} – ${fmtHour(BASE + 1.75 * H)}`);
    expect(cards[0].progress).toBeCloseTo(40, 0);
    expect(cards[1].progress).toBe(0);
  });

  it('starts with the next programme when nothing is airing', () => {
    const cards = buildProgrammeCards([prog('Luego', 2, 3), prog('Después', 3, 4)], undefined, BASE);
    expect(cards.map((c) => c.kind)).toEqual(['next', 'later']);
    expect(cards[0].label).toBe('DESPUÉS');
  });

  it('falls back to EPG now/next when the schedule is empty or stale', () => {
    const nowNext = { now: prog('Ahora', 0, 1), next: prog('Sigue', 1, 2) };
    expect(buildProgrammeCards([], nowNext, BASE + 0.5 * H).map((c) => c.title)).toEqual(['Ahora', 'Sigue']);
    expect(buildProgrammeCards([prog('Viejo', -5, -4)], nowNext, BASE + 0.5 * H).map((c) => c.title)).toEqual([
      'Ahora',
      'Sigue',
    ]);
  });

  it('returns nothing without guide data and drops duplicates', () => {
    expect(buildProgrammeCards([], undefined, BASE)).toEqual([]);
    const dup = [prog('A', 0, 1), prog('A', 0, 1), prog('B', 1, 2)];
    expect(buildProgrammeCards(dup, undefined, BASE + 0.1 * H).map((c) => c.title)).toEqual(['A', 'B']);
  });
});

describe('programmeProgress', () => {
  it('clamps between 0 and 100', () => {
    const p = prog('X', 0, 1);
    expect(programmeProgress(p, BASE - H)).toBe(0);
    expect(programmeProgress(p, BASE + 0.25 * H)).toBeCloseTo(25);
    expect(programmeProgress(p, BASE + 2 * H)).toBe(100);
    expect(programmeProgress(undefined, BASE)).toBe(0);
  });
});

describe('channelMonogram', () => {
  it('uses initials or the first letters of a single word', () => {
    expect(channelMonogram('Cine Clásico')).toBe('CC');
    expect(channelMonogram('Estrenos')).toBe('EST');
    expect(channelMonogram('Terror 24/7')).toBe('T247');
    expect(channelMonogram('Canal 10')).toBe('C10');
    expect(channelMonogram('Canal 1')).toBe('C1');
    expect(channelMonogram('AYM Sports 3')).toBe('AS3');
    expect(channelMonogram('Cine de Acción')).toBe('CDA');
    expect(channelMonogram('  ')).toBe('TV');
  });
});

describe('isPlaceholderGuide', () => {
  const hourly = (title: string, n: number) => Array.from({ length: n }, (_, i) => prog(title, i, i + 1));

  it('detects a guide that only repeats the channel name (feed suffix dropped)', () => {
    expect(isPlaceholderGuide(['Azteca UNO -1 hora'], hourly('Azteca UNO -1', 6))).toBe(true);
    expect(isPlaceholderGuide(['Azteca Uno -2 Horas'], hourly('Azteca Uno', 3))).toBe(true);
    expect(isPlaceholderGuide(['Canal Ñoño'], hourly('canal ñono', 2))).toBe(true);
    expect(isPlaceholderGuide(['Cine'], hourly('TBD', 4))).toBe(true);
  });

  it('keeps real guides, even with a stray placeholder', () => {
    expect(isPlaceholderGuide(['Azteca Uno'], [prog('Exatlón México', 0, 2), prog('La granja VIP', 2, 4)])).toBe(false);
    const mixed = [...hourly('Pluto TV Cine', 1), prog('Duro de matar', 1, 3), prog('Rambo', 3, 5)];
    expect(isPlaceholderGuide(['Pluto TV Cine'], mixed)).toBe(false);
  });

  it('does not treat a missing guide as placeholder', () => {
    expect(isPlaceholderGuide(['Azteca Uno'], [])).toBe(false);
    expect(isPlaceholderGuide(['Azteca Uno'], [undefined, undefined])).toBe(false);
  });

  it('builds name variants without the feed delay', () => {
    expect([...channelNameVariants(['Azteca UNO -1 hora'])]).toEqual(['azteca uno 1 hora', 'azteca uno 1', 'azteca uno']);
  });
});

describe('guessGuideCountry', () => {
  it('reads the country from the tvg-id, the playlist id or the guide file', () => {
    expect(guessGuideCountry({ tvgId: 'AztecaUno.mx@SD' })).toBe('mx');
    expect(guessGuideCountry({ tvgId: 'ESPN.us' })).toBe('us');
    expect(guessGuideCountry({ tvgId: '646ccc7a2858cb0008127367', playlistId: 'pluto_ar' })).toBe('ar');
    expect(
      guessGuideCountry({ playlistId: 'custom_1', epgUrl: 'https://github.com/matthuisman/i.mjh.nz/raw/master/PlutoTV/mx.xml.gz' }),
    ).toBe('mx');
    expect(guessGuideCountry({ playlistId: 'news' })).toBe('mx');
  });
});
