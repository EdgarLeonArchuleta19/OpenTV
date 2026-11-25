/**
 * Episode flow inside the player: real intro/credits timestamps (container chapters first, then
 * the core's `skipSegments` RPC: AniSkip / IntroDB / TheIntroDB), the "Omitir intro" window, when
 * the "Siguiente episodio" card appears, the end screen and the next episode across seasons.
 * Everything except the two loaders is pure and unit-tested (`episodeFlow.test.ts`).
 */
import type { Episode, MediaItem } from '../types/models';
import { desktopApi } from './tauri';
import { loadSeasonEpisodes, loadTitleDetail } from './stremio';

export interface SkipSegment {
  start: number;
  /** `null` = until the end of the file. */
  end: number | null;
}

export interface SkipData {
  intro: SkipSegment | null;
  recap: SkipSegment | null;
  credits: SkipSegment | null;
  /** Where the intro came from (`Capítulos`, `AniSkip`, `IntroDB`, `TheIntroDB`) or ''. */
  introSource: string;
  creditsSource: string;
}

export interface MediaChapter {
  start: number;
  end: number;
  title: string;
}

export type ChapterKind = 'intro' | 'recap' | 'credits' | 'preview' | null;

const EMPTY: SkipData = { intro: null, recap: null, credits: null, introSource: '', creditsSource: '' };

/** Longest plausible opening; anything longer is a misnamed chapter. */
const MAX_INTRO_SEC = 300;

function normalize(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_.\-–—:()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Classifies a container chapter by its name (English, Spanish, Portuguese and anime fansub names). */
export function classifyChapter(title: string): ChapterKind {
  const t = normalize(title);
  if (!t) return null;
  if (/^(op|opening|intro|introduction|introduccion|introducao|apertura|abertura|entrada|cabecera|title sequence|main titles?|theme song|opening (theme|song|credits|titles))( ?\d+)?$/.test(t)) {
    return 'intro';
  }
  if (/^(ncop|op \d+|opening \d+)$/.test(t) || /\b(opening|intro)\b/.test(t) && !/\b(after|post|pre|cold)\b/.test(t)) return 'intro';
  if (/\b(recap|previously|resumen|anteriormente|lo que paso|previamente)\b/.test(t)) return 'recap';
  if (/\b(preview|next episode|next time|avance|adelanto|proximo episodio|yokoku)\b/.test(t)) return 'preview';
  if (
    /^(ed|nced|ending|outro|credits|end credits|closing|closing credits|creditos|creditos finales|cierre|encerramento|end)( ?\d+)?$/.test(t) ||
    /\b(ending|credits|creditos|outro|end credits|closing)\b/.test(t)
  ) {
    return 'credits';
  }
  return null;
}

/** Intro / recap / credits from the file's own chapters (exact for this release). */
export function segmentsFromChapters(chapters: MediaChapter[] | undefined, duration: number): SkipData {
  const out: SkipData = { ...EMPTY };
  if (!chapters || chapters.length < 2) return out;
  const sorted = [...chapters].filter((c) => c.end > c.start).sort((a, b) => a.start - b.start);
  for (const c of sorted) {
    const kind = classifyChapter(c.title);
    if (kind === 'intro' && !out.intro && c.end - c.start <= MAX_INTRO_SEC && (duration <= 0 || c.start < duration * 0.5)) {
      out.intro = { start: c.start, end: c.end };
      out.introSource = 'Capítulos';
    } else if (kind === 'recap' && !out.recap && (duration <= 0 || c.start < duration * 0.5)) {
      out.recap = { start: c.start, end: c.end };
    } else if (kind === 'credits' && !out.credits && (duration <= 0 || c.start >= duration * 0.5)) {
      out.credits = { start: c.start, end: c.end };
      out.creditsSource = 'Capítulos';
    }
  }
  return out;
}

/** Per field, the first source that has it wins (chapters before online databases). */
export function mergeSkipData(...sources: Array<SkipData | null | undefined>): SkipData {
  const out: SkipData = { ...EMPTY };
  for (const s of sources) {
    if (!s) continue;
    if (!out.intro && s.intro) {
      out.intro = s.intro;
      out.introSource = s.introSource;
    }
    if (!out.recap && s.recap) out.recap = s.recap;
    if (!out.credits && s.credits) {
      out.credits = s.credits;
      out.creditsSource = s.creditsSource;
    }
  }
  return out;
}

/** Seconds before the end where the "Siguiente episodio" card appears without real data. */
export function fallbackCreditsWindow(duration: number): number {
  if (duration < 600) return Math.max(15, Math.min(45, duration * 0.1));
  return Math.max(45, Math.min(120, duration * 0.03));
}

/** When the end credits start (real data if plausible, else the fallback window); null when too short. */
export function creditsStartSec(duration: number, data: SkipData | null | undefined): number | null {
  if (!Number.isFinite(duration) || duration < 120) return null;
  const real = data?.credits?.start;
  if (typeof real === 'number' && real >= duration * 0.5 && real < duration - 3) return real;
  return duration - fallbackCreditsWindow(duration);
}

export interface SkipPrompt {
  kind: 'intro' | 'recap';
  label: string;
  /** Where the button jumps. */
  target: number;
  /** True when the target comes from real timestamps (auto-skip is only allowed then). */
  exact: boolean;
}

/**
 * The "Omitir intro" / "Omitir resumen" button at time `t`, or null. With real timestamps it is
 * visible only inside the segment. Without real data there is no button (owner rule: no guessing).
 */
export function skipPromptAt(t: number, duration: number, data: SkipData | null | undefined, skipped: boolean): SkipPrompt | null {
  if (skipped || t < 0) return null;
  const inside = (s: SkipSegment | null | undefined): s is SkipSegment & { end: number } =>
    Boolean(s && s.end !== null && t >= s.start - 0.5 && t < (s.end as number) - 2);
  if (inside(data?.recap)) return { kind: 'recap', label: 'Omitir resumen', target: data!.recap!.end as number, exact: true };
  if (data?.intro && data.intro.end !== null) {
    return inside(data.intro) ? { kind: 'intro', label: 'Omitir intro', target: data.intro.end as number, exact: true } : null;
  }
  void duration;
  return null;
}

export type EndPhase = 'playing' | 'credits' | 'ended';

/** Where playback is relative to the end of the episode. */
export function endPhaseAt(t: number, duration: number, creditsStart: number | null, endedEvent: boolean): EndPhase {
  if (endedEvent || (duration > 0 && t >= duration - 0.6)) return 'ended';
  if (creditsStart !== null && t >= creditsStart) return 'credits';
  return 'playing';
}

export type EndAction = 'next' | 'exit' | 'replay';

/** End-screen buttons in focus order; the first is the primary (focused) one. */
export function endScreenActions(hasNext: boolean): EndAction[] {
  return hasNext ? ['next', 'exit', 'replay'] : ['exit', 'replay'];
}

/** Auto-next countdown length once the card appears (never longer than what is left). */
export function autoNextCountdown(remaining: number): number {
  return Math.max(3, Math.min(10, Math.ceil(remaining)));
}

/** Next episode by (season, number), skipping specials (season 0); works on merged season lists. */
export function nextEpisodeAfter(all: Episode[], current: Episode | null): Episode | null {
  if (!current) return null;
  let best: Episode | null = null;
  for (const e of all) {
    if (e.season <= 0 && current.season > 0) continue;
    const after = e.season > current.season || (e.season === current.season && e.number > current.number);
    if (!after) continue;
    if (!best || e.season < best.season || (e.season === best.season && e.number < best.number)) best = e;
  }
  return best;
}

/** Adds `extra` episodes not already in `base` (by season/number). */
export function mergeEpisodes(base: Episode[], extra: Episode[]): Episode[] {
  if (extra.length === 0) return base;
  const seen = new Set(base.map((e) => `${e.season}:${e.number}`));
  const add = extra.filter((e) => !seen.has(`${e.season}:${e.number}`));
  if (add.length === 0) return base;
  return [...base, ...add].sort((a, b) => a.season - b.season || a.number - b.number);
}

/** Display line "T1·E4 · Título". */
export function episodeLabel(e: Episode): string {
  return `T${e.season}·E${e.number}${e.title ? ` · ${e.title}` : ''}`;
}

const skipCache = new Map<string, Promise<SkipData | null>>();

function segmentOf(v: unknown): SkipSegment | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { start?: unknown; end?: unknown };
  if (typeof o.start !== 'number' || !Number.isFinite(o.start)) return null;
  const end = typeof o.end === 'number' && Number.isFinite(o.end) ? o.end : null;
  return { start: o.start, end };
}

/** Maps the core's `skipSegments` answer. */
export function parseSkipResponse(res: unknown): SkipData | null {
  if (!res || typeof res !== 'object') return null;
  const r = res as Record<string, unknown>;
  if (r.returnValue === false) return null;
  return {
    intro: segmentOf(r.intro),
    recap: segmentOf(r.recap),
    credits: segmentOf(r.credits),
    introSource: typeof r.introSource === 'string' ? r.introSource : '',
    creditsSource: typeof r.creditsSource === 'string' ? r.creditsSource : '',
  };
}

/** Online intro/credits timestamps for one episode (cached per episode; null when unavailable). */
export function fetchSkipData(item: MediaItem, episode: Episode, durationSec: number): Promise<SkipData | null> {
  const key = `${item.id}|${episode.id}|${episode.season}|${episode.number}`;
  const hit = skipCache.get(key);
  if (hit) return hit;
  const p = desktopApi
    .service('skipSegments', {
      itemId: item.id,
      episodeId: episode.id,
      season: episode.season,
      episode: episode.number,
      durationSec: Math.round(durationSec),
      anime: Boolean(item.isAnime || item.type === 'anime'),
    })
    .then(parseSkipResponse)
    .catch(() => null)
    .then((d) => {
      if (!d) skipCache.delete(key);
      return d;
    });
  skipCache.set(key, p);
  if (skipCache.size > 200) skipCache.delete(skipCache.keys().next().value as string);
  return p;
}

/**
 * Episodes of the current and the following season when the player's list ends at the current
 * episode (the detail screen loads seasons lazily). [] when there is no later season.
 */
export async function loadFollowingEpisodes(item: MediaItem, current: Episode): Promise<Episode[]> {
  try {
    const detail = await loadTitleDetail(item, current.season);
    if (!detail.tmdbTvId) return detail.episodes;
    const later = detail.seasons.filter((s) => s > current.season).sort((a, b) => a - b)[0];
    const [same, next] = await Promise.all([
      loadSeasonEpisodes(detail, current.season),
      later !== undefined ? loadSeasonEpisodes(detail, later) : Promise.resolve([] as Episode[]),
    ]);
    return [...same, ...next];
  } catch {
    return [];
  }
}

/**
 * Wrong-content guard: true when a file's real duration is too far from the episode's TMDB
 * runtime to be that episode (another version or another show under the same title, e.g. a
 * remake matched by its translated name). Tolerance: max(4 min, 18 % of the runtime).
 * Unknown values (<= 0, NaN, Infinity) never count as a mismatch.
 */
export function runtimeMismatch(durationSec: number, runtimeMin: number | undefined | null): boolean {
  const rt = Number(runtimeMin);
  if (!Number.isFinite(durationSec) || durationSec <= 0 || !Number.isFinite(rt) || rt <= 0) return false;
  const expected = rt * 60;
  return Math.abs(durationSec - expected) > Math.max(240, expected * 0.18);
}
