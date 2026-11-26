import type { WatchProgress } from '../types/models';

/** Same threshold the player uses to treat an entry as watched. */
export function isFinished(e: WatchProgress): boolean {
  return e.durationMs > 60_000 && e.positionMs / e.durationMs >= 0.95;
}

/**
 * "Seguir viendo" row: one card per title, the episode watched most recently.
 * Older episodes stay in history (Detail resume) but never show as extra cards,
 * and a finished last episode hides the title instead of surfacing an older one.
 */
export function continueWatchingRow(entries: WatchProgress[]): WatchProgress[] {
  const seen = new Set<string>();
  const out: WatchProgress[] = [];
  for (const e of [...entries].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) {
    if (seen.has(e.itemId)) continue;
    seen.add(e.itemId);
    if (!isFinished(e)) out.push(e);
  }
  return out;
}
