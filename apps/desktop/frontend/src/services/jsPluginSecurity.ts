/**
 * Host-side security rules for third-party JS plugins (pure functions, unit tested).
 * Mirrored in Kotlin by `JsPluginSecurity.kt` on Android.
 */

const REPO_RE = /^[A-Za-z0-9_.-]{1,64}\/[A-Za-z0-9_.-]{1,100}$/;
const COMMIT_RE = /^[0-9a-f]{7,40}$/i;
const SHA256_RE = /^(?:sha256[:-])?([0-9a-f]{64})$/i;

/**
 * Helper plugins ("doors", `consumes.<door>.repo`) a plugin may pull in without the
 * user installing them. Anything else fails with a clear message instead of
 * silently running unreviewed code.
 */
export const APPROVED_HELPER_REPOS: ReadonlySet<string> = new Set(['xuper-plugin/kino-plugin-kino-resolver']);

export interface HelperSpec {
  /** Lower-cased `owner/repo`. */
  repo: string;
  /** Raw base the helper is loaded from (pinned commit when declared). */
  base: string;
  /** Expected SHA-256 (hex, lower case) of the helper code, when the caller pins it. */
  sha256?: string;
}

export class HelperRejectedError extends Error {
  code = 'provider_missing';
  userMessage: string;
  constructor(repo: string) {
    super(`Plugin auxiliar no verificado: ${repo}`);
    this.userMessage = `Este plugin necesita un plugin auxiliar no verificado: ${repo}`;
  }
}

/**
 * Validates a caller's `consumes.<door>` entry against the allowlist. Returns null
 * when no repo is declared (no provider), throws [HelperRejectedError] when the
 * repo is not approved.
 */
export function helperFromConsumes(want: Record<string, unknown>): HelperSpec | null {
  const raw = typeof want.repo === 'string' ? want.repo.trim() : '';
  if (!REPO_RE.test(raw)) return null;
  const repo = raw.toLowerCase();
  if (!APPROVED_HELPER_REPOS.has(repo)) throw new HelperRejectedError(raw);
  const commit = typeof want.commit === 'string' && COMMIT_RE.test(want.commit.trim()) ? want.commit.trim() : '';
  const hashSrc = [want.sha256, want.hash].find((v): v is string => typeof v === 'string') || '';
  const hash = SHA256_RE.exec(hashSrc.trim())?.[1]?.toLowerCase();
  return {
    repo,
    base: `https://raw.githubusercontent.com/${raw}/${commit || 'HEAD'}`,
    ...(hash ? { sha256: hash } : {}),
  };
}

/** SHA-256 hex of a UTF-8 string (WebCrypto; available in WebView2 and Node 20+). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Unguessable id for host -> sandbox calls (128 random bits). */
export function randomCallId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `h_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// ---------------------------------------------------------------- TMDB

const TMDB_SUB = '(?:external_ids|images|alternative_titles|translations|credits|videos|release_dates|content_ratings|keywords)';
/** Read-only TMDB metadata routes a plugin may call through `kino.tmdb`. */
const TMDB_ROUTES: RegExp[] = [
  /^\/find\/[A-Za-z0-9_-]{1,40}$/,
  /^\/search\/(?:movie|tv|multi)$/,
  new RegExp(`^/(?:movie|tv)/\\d{1,10}(?:/${TMDB_SUB})?$`),
  /^\/tv\/\d{1,10}\/season\/\d{1,4}(?:\/episode\/\d{1,5})?$/,
  /^\/genre\/(?:movie|tv)\/list$/,
];
const TMDB_PARAMS = new Set([
  'language',
  'query',
  'year',
  'primary_release_year',
  'first_air_date_year',
  'page',
  'external_source',
  'append_to_response',
  'include_image_language',
  'region',
]);
const TMDB_APPEND_RE = new RegExp(`^${TMDB_SUB}(?:,${TMDB_SUB}){0,4}$`);

export class TmdbRouteError extends Error {
  code = 'not_supported';
}

/**
 * Turns a plugin `kino.tmdb(route, params)` call into a core `raw:` route, only
 * for whitelisted read-only metadata paths (no arbitrary paths, accounts, lists,
 * sessions...). Throws [TmdbRouteError] otherwise.
 */
export function tmdbPluginRoute(route: unknown, params: unknown): string {
  let path = String(route ?? '').trim().replace(/^raw:/, '');
  let inline = '';
  const q = path.indexOf('?');
  if (q >= 0) {
    inline = path.slice(q + 1);
    path = path.slice(0, q);
  }
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 120 || !TMDB_ROUTES.some((re) => re.test(path))) {
    throw new TmdbRouteError('Ruta de TMDB no permitida para plugins');
  }
  const merged = new URLSearchParams(inline);
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
      if (v === undefined || v === null || typeof v === 'object') continue;
      merged.set(k, String(v));
    }
  }
  const out = new URLSearchParams();
  for (const [k, v] of merged) {
    if (!TMDB_PARAMS.has(k)) continue;
    const value = v.slice(0, 200);
    if (k === 'append_to_response' && !TMDB_APPEND_RE.test(value)) continue;
    out.set(k, value);
  }
  out.set('include_adult', 'false');
  return `raw:${path}?${out.toString()}`;
}
