import type { MediaItem } from '../types/models';

function norm(x: string): string {
  return x
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** 0 = same title, 1 = starts with the query, 2 = contains it, 3 = anything else. */
function matchTier(item: Pick<MediaItem, 'title' | 'originalTitle'>, q: string): number {
  let best = 3;
  for (const raw of [item.title, item.originalTitle || '']) {
    const t = norm(raw);
    if (!t) continue;
    if (t === q) return 0;
    if (t.startsWith(`${q} `) || t.startsWith(q)) best = Math.min(best, 1);
    else if (` ${t} `.includes(` ${q} `) || t.includes(q)) best = Math.min(best, 2);
  }
  return best;
}

function yearOf(item: Pick<MediaItem, 'year'>): number {
  return parseInt(String(item.year || '').slice(0, 4), 10) || 0;
}

/**
 * Search order: how well the title matches the text first, then newest first inside each
 * group (titles without a year go last in their group). Duplicates are dropped.
 */
export function orderSearchResults<T extends Pick<MediaItem, 'id' | 'title' | 'originalTitle' | 'year'>>(
  items: T[],
  query: string,
): T[] {
  const q = norm(query);
  const seen = new Set<string>();
  const unique = items.filter((it) => !seen.has(it.id) && Boolean(seen.add(it.id)));
  return unique
    .map((it, index) => ({ it, index, tier: matchTier(it, q), year: yearOf(it) }))
    .sort((a, b) => a.tier - b.tier || b.year - a.year || a.index - b.index)
    .map((x) => x.it);
}
