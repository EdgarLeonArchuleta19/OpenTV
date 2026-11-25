import type { EpgNowNext, EpgProgram } from '../types/models';

/** One card of the "Programación de hoy" row under the live player. */
export interface ProgrammeCard {
  key: string;
  kind: 'now' | 'next' | 'later';
  /** "AHORA", "DESPUÉS" or the start time ("17:30"). */
  label: string;
  title: string;
  /** "HH:MM – HH:MM" (only the start when the end is unknown). */
  time: string;
  /** 0–100, only meaningful for the "now" card. */
  progress: number;
}

export function fmtHour(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function programmeProgress(p: EpgProgram | undefined, nowMs: number): number {
  if (!p || !p.startMs || !p.endMs || p.endMs <= p.startMs) return 0;
  return Math.max(0, Math.min(100, ((nowMs - p.startMs) / (p.endMs - p.startMs)) * 100));
}

function timeRange(p: EpgProgram): string {
  const start = fmtHour(p.startMs);
  const end = p.endMs > p.startMs ? fmtHour(p.endMs) : '';
  return end ? `${start} – ${end}` : start;
}

function cardsFrom(pool: EpgProgram[], nowMs: number, max: number): ProgrammeCard[] {
  const seen = new Set<string>();
  const sorted = pool
    .filter((p) => p && p.title && p.startMs > 0)
    .sort((a, b) => a.startMs - b.startMs)
    .filter((p) => {
      const k = `${p.startMs}|${p.title}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  const current = sorted.find((p) => p.startMs <= nowMs && p.endMs > nowMs);
  const after = current ? current.startMs : nowMs;
  const upcoming = sorted.filter((p) => p !== current && p.startMs > after && (p.endMs <= 0 || p.endMs > nowMs));

  const cards: ProgrammeCard[] = [];
  if (current) {
    cards.push({
      key: `${current.startMs}|${current.title}`,
      kind: 'now',
      label: 'AHORA',
      title: current.title,
      time: timeRange(current),
      progress: programmeProgress(current, nowMs),
    });
  }
  upcoming.forEach((p, i) => {
    cards.push({
      key: `${p.startMs}|${p.title}`,
      kind: i === 0 ? 'next' : 'later',
      label: i === 0 ? 'DESPUÉS' : fmtHour(p.startMs),
      title: p.title,
      time: timeRange(p),
      progress: 0,
    });
  });
  return cards.slice(0, max);
}

/**
 * Picks the programme cards for the current channel: the airing programme ("AHORA"),
 * the next one ("DESPUÉS") and the following ones labelled by start time.
 * Uses the full schedule when available and falls back to the EPG now/next pair.
 */
export function buildProgrammeCards(
  schedule: EpgProgram[],
  nowNext: EpgNowNext | undefined,
  nowMs: number,
  max = 4,
): ProgrammeCard[] {
  const fromSchedule = schedule.length > 0 ? cardsFrom(schedule, nowMs, max) : [];
  if (fromSchedule.length > 0) return fromSchedule;
  const pair = [nowNext?.now, nowNext?.next].filter((p): p is EpgProgram => Boolean(p));
  return cardsFrom(pair, nowMs, max);
}

/** Short monogram for a channel without logo: "Cine Clásico" -> "CC", "Estrenos" -> "EST". */
export function channelMonogram(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'TV';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  // Initials of up to 3 words, numbers kept whole ("Canal 10" -> "C10", not "C1"); max 4 chars.
  return words
    .slice(0, 3)
    .map((w) => (/^\p{N}+$/u.test(w) ? w : w[0]))
    .join('')
    .slice(0, 4)
    .toUpperCase();
}

// ---------------------------------------------------------------------------
// Placeholder guides & supplementary guide helpers (pure, unit-tested).
// ---------------------------------------------------------------------------

/** Lowercase, no accents, only letters/digits separated by single spaces. */
export function foldGuideText(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const HOUR_WORD_RE = /\s+(?:h|hr|hrs|hora|horas|hour|hours)\s*$/i;
const FEED_SUFFIX_RE = /\s*(?:[-+]\s*\d{1,2}\s*(?:h|hr|hrs|hora|horas|hour|hours)?|\b(?:east|west|este|oeste))\s*$/i;
const GENERIC_TITLES = new Set([
  'tbd',
  'tba',
  'programa',
  'programacion',
  'sin informacion',
  'sin programacion',
  'to be announced',
  'no information',
  'programming',
]);

/** Folded forms of a channel name a placeholder guide uses: "Azteca UNO -1 hora" -> "azteca uno 1 hora", "azteca uno 1", "azteca uno". */
export function channelNameVariants(names: string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of names) {
    const name = (raw || '').trim();
    if (!name) continue;
    for (const v of [name, name.replace(HOUR_WORD_RE, ''), name.replace(FEED_SUFFIX_RE, '')]) {
      const f = foldGuideText(v);
      if (f) out.add(f);
    }
  }
  return out;
}

/**
 * True when a channel's guide carries no real information: (almost) every programme is
 * titled with the channel's own name (or "TBD"/"Programa"). Empty lists are not placeholders
 * (that is the "no guide" case, handled separately).
 */
export function isPlaceholderGuide(names: string[], programmes: Array<EpgProgram | undefined>): boolean {
  const list = programmes.filter((p): p is EpgProgram => Boolean(p));
  if (list.length === 0) return false;
  const variants = channelNameVariants(names);
  const fake = list.filter((p) => {
    const t = foldGuideText(p.title);
    return !t || GENERIC_TITLES.has(t) || variants.has(t);
  }).length;
  return fake >= Math.ceil(list.length * 0.8);
}

const GUIDE_COUNTRIES = new Set(['mx', 'ar', 'es', 'co', 'cl', 'pe', 'ec', 'uy', 'do', 'cr', 'pa', 'sv', 'br']);

/**
 * Country of the supplementary guide for a channel: the iptv-org style tvg-id suffix
 * ("AztecaUno.mx@SD"), then the playlist id ("pluto_ar"), then the guide file ("…/mx.xml.gz"),
 * else "mx".
 */
export function guessGuideCountry(ch: { tvgId?: string; playlistId?: string; epgUrl?: string }): string {
  const fromId = /\.([a-z]{2})(?:@|$)/i.exec((ch.tvgId || '').trim());
  if (fromId) return fromId[1].toLowerCase();
  const pick = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).find((t) => GUIDE_COUNTRIES.has(t));
  const byPlaylist = pick(ch.playlistId || '');
  if (byPlaylist) return byPlaylist;
  const path = (ch.epgUrl || '').replace(/[?#].*$/, '').split('/').slice(-2).join('/');
  return pick(path) || 'mx';
}
