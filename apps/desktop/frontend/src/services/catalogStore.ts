/**
 * Persistent (localStorage) layer behind the catalog JSON cache: the last catalog answers
 * survive a restart so Inicio/Películas/Series/Kids/Anime paint instantly on startup
 * (stale-while-revalidate). Only browse catalogs are kept, never searches, streams or meta.
 */

export interface PersistedJson {
  d: Record<string, unknown>;
  at: number;
}

export type SwrState = 'fresh' | 'stale' | 'expired';

/** Fresh for 6 h (no network at all); 6 h–3 d: shown at once and refreshed in the background. */
export const CATALOG_FRESH_MS = 6 * 60 * 60_000;
export const CATALOG_MAX_STALE_MS = 3 * 24 * 60 * 60_000;

export function swrState(ageMs: number, freshMs = CATALOG_FRESH_MS, maxStaleMs = CATALOG_MAX_STALE_MS): SwrState {
  if (ageMs < 0 || ageMs > maxStaleMs) return 'expired';
  return ageMs < freshMs ? 'fresh' : 'stale';
}

/** Browse catalogs (`…/catalog/<type>/<id>[/extra].json`) except text searches. */
export function isPersistableCatalogUrl(url: string): boolean {
  return /\/catalog\/[^/]+\/[^/]+(\/[^/]+)?\.json(\?|$)/i.test(url) && !/[/&?]search=/i.test(url);
}

// Large per-title fields that catalog rows never read (Cinemeta ships them in every meta).
const HEAVY_META_KEYS = ['trailerStreams', 'trailers', 'popularities', 'videos', 'behaviorHints'];

/** Drops unused heavy fields from catalog metas so the persisted copy stays small. */
export function slimCatalogPayload(data: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(data.metas)) return data;
  const metas = (data.metas as Array<Record<string, unknown>>).map((m) => {
    if (!m || typeof m !== 'object') return m;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(m)) {
      if (!HEAVY_META_KEYS.includes(k)) out[k] = v;
    }
    return out;
  });
  return { ...data, metas };
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export class PersistentJsonCache {
  private map = new Map<string, PersistedJson>();
  private loaded = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly key: string,
    private readonly maxEntries: number,
    private readonly storage: () => StorageLike | null = defaultStorage,
    private readonly now: () => number = () => Date.now(),
    private readonly writeDelayMs = 1500,
  ) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = this.storage()?.getItem(this.key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, PersistedJson>;
      for (const [url, entry] of Object.entries(parsed || {})) {
        if (entry && typeof entry.at === 'number' && entry.d && typeof entry.d === 'object') {
          this.map.set(url, entry);
        }
      }
    } catch {
      /* corrupted cache: start empty */
    }
  }

  get(url: string): PersistedJson | undefined {
    this.load();
    return this.map.get(url);
  }

  set(url: string, data: Record<string, unknown>): void {
    this.load();
    this.map.delete(url);
    this.map.set(url, { d: slimCatalogPayload(data), at: this.now() });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
    this.schedule();
  }

  clear(): void {
    this.map.clear();
    this.loaded = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      this.storage()?.removeItem(this.key);
    } catch {
      /* ignore */
    }
  }

  /** Writes immediately (tests / before unload). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const store = this.storage();
    if (!store) return;
    // On quota errors drop the oldest half and retry once; the memory cache keeps working anyway.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        store.setItem(this.key, JSON.stringify(Object.fromEntries(this.map)));
        return;
      } catch {
        const drop = Math.ceil(this.map.size / 2);
        for (let i = 0; i < drop; i++) {
          const oldest = this.map.keys().next().value;
          if (oldest === undefined) break;
          this.map.delete(oldest);
        }
      }
    }
  }

  private schedule(): void {
    if (this.timer) return;
    // Batched and deferred so JSON.stringify never runs in the middle of a tab switch.
    this.timer = setTimeout(() => this.flush(), this.writeDelayMs);
  }
}
