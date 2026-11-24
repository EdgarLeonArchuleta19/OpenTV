import type { Episode, InstalledPlugin, MediaItem, SourcePrefs, StreamSource } from '../types/models';
import { fetchStremioStreams } from './stremio';
import { activeJsPlugins, jsPluginRunner, type JsFetchResult, type JsPluginFailure } from './jsPlugins';
import { autoPickReady, isDirectSource, rankSources } from './sourceRanker';
import { isCapablePc } from './deviceProfile';

type RawSource = Partial<StreamSource> & Pick<StreamSource, 'id' | 'addonId' | 'addonName'>;

export interface SourceSearchState {
  raw: RawSource[];
  stremioDone: boolean;
  jsDone: boolean;
  /** Names of JS plugins still running, in install order. */
  pendingJs: string[];
  failures: JsPluginFailure[];
  startedAt: number;
  /** When the first source arrived (0 = none yet). */
  firstResultAt: number;
  /** When the Stremio plugins answered (0 = still running). */
  stremioDoneAt: number;
}

export interface SourceFetchers {
  stremio: (item: MediaItem, ep: Episode | null, plugins: InstalledPlugin[]) => Promise<RawSource[]>;
  js: (
    item: MediaItem,
    ep: Episode | null,
    plugins: InstalledPlugin[],
    opts: {
      onPluginDone: (plugin: { id: string; name: string }, streams: RawSource[], failure?: JsPluginFailure) => void;
    },
  ) => Promise<JsFetchResult>;
  jsNames: (plugins: InstalledPlugin[]) => string[];
  now: () => number;
}

const defaultFetchers: SourceFetchers = {
  stremio: fetchStremioStreams,
  js: (item, ep, plugins, opts) => jsPluginRunner.fetchStreamsDetailed(item, ep, plugins, opts),
  jsNames: (plugins) => activeJsPlugins(plugins).map((p) => p.name),
  now: () => Date.now(),
};

const STREMIO_TIMEOUT_MS = 8_000;
const JS_TIMEOUT_MS = 70_000;
const CACHE_TTL_MS = 3 * 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

/**
 * One progressive source search for a title/episode: Stremio plugins and kino JS plugins run
 * in parallel and every answer is published to subscribers as soon as it lands. The same
 * search is shared by the Detail picker and the player, so sources that arrive after playback
 * started still reach the player's picker and fallback list.
 */
export class SourceSearch {
  private listeners = new Set<(s: SourceSearchState) => void>();
  state: SourceSearchState;
  finishedAt = 0;

  constructor(
    item: MediaItem,
    episode: Episode | null,
    plugins: InstalledPlugin[],
    private fetchers: SourceFetchers = defaultFetchers,
  ) {
    const now = fetchers.now();
    const names = fetchers.jsNames(plugins);
    this.state = {
      raw: [],
      stremioDone: false,
      jsDone: names.length === 0,
      pendingJs: names,
      failures: [],
      startedAt: now,
      firstResultAt: 0,
      stremioDoneAt: 0,
    };

    void withTimeout(fetchers.stremio(item, episode, plugins), STREMIO_TIMEOUT_MS, [] as RawSource[]).then((list) => {
      this.update((s) => ({
        ...s,
        raw: [...s.raw, ...list],
        stremioDone: true,
        stremioDoneAt: this.fetchers.now(),
      }));
    });

    if (names.length > 0) {
      const jsRun = fetchers.js(item, episode, plugins, {
        onPluginDone: (plugin, streams, failure) => {
          if (this.state.jsDone) return;
          this.update((s) => ({
            ...s,
            raw: streams.length > 0 ? [...s.raw, ...streams] : s.raw,
            pendingJs: s.pendingJs.filter((n) => n !== plugin.name),
            failures: failure ? [...s.failures, failure] : s.failures,
          }));
        },
      });
      void withTimeout(jsRun, JS_TIMEOUT_MS, null).then(() => {
        this.update((s) => ({ ...s, jsDone: true, pendingJs: [] }));
      });
    }
  }

  get done(): boolean {
    return this.state.stremioDone && this.state.jsDone;
  }

  private update(fn: (s: SourceSearchState) => SourceSearchState): void {
    const next = fn(this.state);
    if (next.firstResultAt === 0 && next.raw.length > 0) next.firstResultAt = this.fetchers.now();
    this.state = next;
    if (this.done && !this.finishedAt) this.finishedAt = this.fetchers.now();
    for (const fn2 of this.listeners) fn2(this.state);
  }

  /** Calls `fn` now and on every change. Returns the unsubscribe function. */
  subscribe(fn: (s: SourceSearchState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

const registry = new Map<string, SourceSearch>();

export function sourceSearchKey(item: MediaItem, episode: Episode | null): string {
  return `${item.id}_${episode?.id || 'movie'}`;
}

function usable(search: SourceSearch | undefined, now: number): search is SourceSearch {
  if (!search) return false;
  if (!search.done) return true;
  return search.state.raw.length > 0 && now - search.finishedAt < CACHE_TTL_MS;
}

/** The running (or recently finished, non-empty) search for this title, if any. */
export function peekSourceSearch(item: MediaItem, episode: Episode | null): SourceSearch | null {
  const found = registry.get(sourceSearchKey(item, episode));
  return usable(found, Date.now()) ? found : null;
}

/** Reuses a running/recent search for this title or starts a new one. */
export function getSourceSearch(
  item: MediaItem,
  episode: Episode | null,
  plugins: InstalledPlugin[],
  fetchers: SourceFetchers = defaultFetchers,
): SourceSearch {
  const key = sourceSearchKey(item, episode);
  const found = registry.get(key);
  if (usable(found, fetchers.now())) return found;
  const search = new SourceSearch(item, episode, plugins, fetchers);
  registry.set(key, search);
  if (registry.size > 24) {
    const oldest = registry.keys().next().value;
    if (oldest !== undefined && oldest !== key) registry.delete(oldest);
  }
  return search;
}

export interface SearchProgress {
  ranked: StreamSource[];
  directs: number;
  torrents: number;
  /** Ready to auto-pick `ranked[0]` (see `autoPickReady`). */
  ready: boolean;
  /** Main status line ("Buscando la mejor fuente…" / "Consultando Pelispedia…"). */
  status: string;
  /** Secondary line ("0 directas · 499 torrents · esperando a Pelispedia, Cuevana Pro"). */
  detail: string;
}

/** Ranks the current state and describes it for the player loading screen. */
export function describeSearch(
  state: SourceSearchState,
  prefs: SourcePrefs,
  isEpisode: boolean,
  now: number,
  capable: boolean = isCapablePc(),
  /** Already ranked `state.raw` (skips re-ranking on timer ticks). */
  preRanked?: StreamSource[],
): SearchProgress {
  const ranked = preRanked ?? rankSources(state.raw, prefs, isEpisode);
  const directs = ranked.filter(isDirectSource).length;
  const torrents = ranked.length - directs;
  const allDone = state.stremioDone && state.jsDone;
  // The grace window for slow sites starts once Stremio answered and something is in.
  const graceFrom = state.firstResultAt > 0 && state.stremioDone ? Math.max(state.firstResultAt, state.stremioDoneAt) : 0;
  const ready = autoPickReady({
    ranked,
    allDone,
    prefs,
    msSinceFirstResult: graceFrom > 0 ? now - graceFrom : 0,
    msTotal: now - state.startedAt,
    capable,
  });
  const waiting = state.pendingJs;
  const parts: string[] = [];
  if (ranked.length > 0 || state.stremioDone) parts.push(`${directs} directas · ${torrents} torrents`);
  if (waiting.length > 0) parts.push(`esperando a ${waiting.join(', ')}`);
  const status = waiting.length > 0 && state.stremioDone ? `Consultando ${waiting[0]}…` : 'Buscando la mejor fuente…';
  return { ranked, directs, torrents, ready, status, detail: parts.join(' · ') };
}
