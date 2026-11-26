/**
 * Pure helpers shared by the JS plugin host: which plugin search hit is the
 * title the user opened, how a Kino `resolve()` answer becomes stream rows,
 * the host cookie jar, and the Spanish message shown when a plugin fails.
 * Kept free of Tauri/DOM imports so Vitest can cover them directly.
 */

export type CookieJar = Record<string, Record<string, string>>;

export interface TitleQuery {
  title: string;
  originalTitle?: string;
  year?: number;
  kind: 'movie' | 'series';
}

export function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function sanitizeHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  let count = 0;
  // Kino resolvers may send headers as [{ name, value }].
  const entries: Array<[string, unknown]> = Array.isArray(raw)
    ? raw
        .map((h) => asRecord(h))
        .filter((h) => typeof h.name === 'string')
        .map((h) => [String(h.name), h.value] as [string, unknown])
    : Object.entries(raw as Record<string, unknown>);
  for (const [k, v] of entries) {
    if (count >= 16) break;
    if (!/^[A-Za-z0-9-]+$/.test(k) || typeof v !== 'string' || /[\r\n\0]/.test(v) || v.length > 2048) continue;
    out[k] = v;
    count++;
  }
  return out;
}

function hostOf(url: string): string {
  const m = /^https?:\/\/([^/:?#]+)/i.exec(url);
  return m ? m[1].toLowerCase() : '';
}

/** Stores `Set-Cookie` values per domain; host-only cookies use the response host. */
export function absorbCookies(jar: CookieJar, setCookies: unknown, responseUrl = ''): void {
  const list = Array.isArray(setCookies)
    ? setCookies
    : typeof setCookies === 'string'
      ? setCookies.split('\n')
      : [];
  const fallbackDomain = hostOf(responseUrl);
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const pair = raw.split(';')[0] || '';
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const domainMatch = /(?:^|;)\s*domain=([^;]+)/i.exec(raw);
    const domain = (domainMatch ? domainMatch[1] : fallbackDomain).trim().toLowerCase().replace(/^\.+/, '');
    if (!name || !domain || /[\r\n\0;]/.test(value)) continue;
    (jar[domain] ||= {})[name] = value;
  }
}

/** `Cookie` header value for a request URL (domain + parent-domain match). */
export function cookieHeaderFor(jar: CookieJar, url: string): string {
  const host = hostOf(url);
  if (!host) return '';
  const merged: Record<string, string> = {};
  for (const [dom, map] of Object.entries(jar)) {
    if (host === dom || host.endsWith(`.${dom}`)) Object.assign(merged, map);
  }
  return Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
    .slice(0, 2048);
}

export function normTitle(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Token Jaccard similarity (0..1) with a bonus when one title contains the other. */
export function titleSimilarity(a: string, b: string): number {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const jaccard = inter / (ta.size + tb.size - inter);
  const contains = (` ${na} `.includes(` ${nb} `) || ` ${nb} `.includes(` ${na} `)) ? 0.25 : 0;
  return Math.min(0.99, jaccard + contains);
}

function hitKind(hit: Record<string, unknown>): 'movie' | 'series' | '' {
  const k = String(hit.kind || hit.type || '').toLowerCase();
  if (k === 'movie' || k === 'film' || k === 'pelicula') return 'movie';
  if (k === 'series' || k === 'tv' || k === 'show' || k === 'anime' || k === 'serie') return 'series';
  return '';
}

/** Sites like CineHD Plus title their cards "Superman (2025)" with no separate year. */
const TITLE_YEAR_RE = /\s*[([]((?:19|20)\d{2})[)\]]\s*$/;

function hitTitle(hit: Record<string, unknown>): string {
  return String(hit.title || hit.name || '').replace(TITLE_YEAR_RE, '').trim();
}

function hitYear(hit: Record<string, unknown>): number {
  const own = parseInt(String(hit.year ?? hit.releaseYear ?? '').slice(0, 4), 10) || 0;
  if (own) return own;
  const m = TITLE_YEAR_RE.exec(String(hit.title || hit.name || ''));
  return m ? parseInt(m[1], 10) : 0;
}

export interface RankedHit {
  ref: string;
  score: number;
  title: string;
  /** The hit has no year and a different title: confirm with `details()` first. */
  verify: boolean;
}

/**
 * Picks the plugin search hits that really are the opened title.
 * Spanish sites list "El origen" for "Inception", so a hit with a different
 * title is still accepted when it is the site's first answer, of the same
 * kind and of the same year. Anything else needs a close title match, so the
 * app never plays a different film.
 */
export function pickSearchHits(hitsRaw: Array<Record<string, unknown>>, q: TitleQuery, max = 2): RankedHit[] {
  const names = [q.title, q.originalTitle || ''].filter(Boolean);
  const normNames = names.map(normTitle).filter(Boolean);
  const ranked: RankedHit[] = [];
  let exactFound = false;
  hitsRaw.forEach((hit, index) => {
    const ref = String(hit.ref || hit.id || hit.imdb_id || hit.imdbId || '').trim();
    if (!ref) return;
    const kind = hitKind(hit);
    if (kind && kind !== q.kind) return;
    const title = hitTitle(hit);
    const sim =Math.max(0, ...names.map((n) => titleSimilarity(n, title)));
    const year = hitYear(hit);
    const yearKnown = Boolean(year && q.year);
    const yearDiff = yearKnown ? Math.abs(year - (q.year || 0)) : 0;
    // Movies must match ±1. Series years drift a little (first air date vs. season), but a
    // same-named show years apart is a remake ("La oficina" 2015 MX vs "The Office" 2005 US).
    if (yearKnown && yearDiff > (q.kind === 'movie' ? 1 : 2)) return;
    const sameYear = yearKnown && yearDiff === 0;
    // "Los juegos del hambre: En llamas" contains "Los juegos del hambre": when one title extends
    // the other it is usually another film of the saga, so it only counts with the exact same year.
    const nh = normTitle(title);
    const extendsQuery = sim < 1 && normNames.some((n) => isLongerTitleOf(nh, n) || isLongerTitleOf(n, nh));
    if (extendsQuery && !sameYear) return;
    if (sim === 1) exactFound = true;
    const accepted = sim >= 0.6 || (index === 0 && sameYear) || (index < 3 && sameYear && sim >= 0.34);
    // Cards without a year (e.g. Cuevana) and a translated title: the site's
    // first answer is kept, but only after its detail page confirms the year.
    const verify = !accepted && !year && Boolean(q.year) && index === 0;
    if (!accepted && !verify) return;
    const score = verify ? 0.2 : sim + (sameYear ? 0.3 : yearKnown && yearDiff <= 1 ? 0.1 : 0) - index * 0.02;
    ranked.push({ ref, score, title, verify });
  });
  // Streams of every kept hit are merged, so once the site lists the exact title, other
  // similar titles (another film of the saga) are dropped.
  const kept = exactFound ? ranked.filter((h) => !h.verify && names.some((n) => titleSimilarity(n, h.title) === 1)) : ranked;
  return kept.sort((a, b) => b.score - a.score).slice(0, max);
}

/** `hit` is `query` plus extra words ("x y z" extends "x y"). */
function isLongerTitleOf(hit: string, query: string): boolean {
  return hit.length > query.length && ` ${hit} `.includes(` ${query} `);
}

/** Whether a `details()`/`episodes().series` answer confirms the opened title's year. */
export function confirmsYear(meta: unknown, q: TitleQuery): boolean {
  const year = parseInt(String(asRecord(meta).year ?? '').slice(0, 4), 10) || 0;
  if (!year || !q.year) return false;
  return Math.abs(year - q.year) <= (q.kind === 'series' ? 1 : 0);
}

/** Finds the episode ref; never falls back to another episode. */
export function pickEpisodeRef(eps: Array<Record<string, unknown>>, season: number, episode: number): string {
  for (const epObj of eps) {
    const sN = Number(epObj.season ?? epObj.s ?? 1) || 1;
    const eN = Number(epObj.number ?? epObj.episode ?? epObj.e ?? 0) || 0;
    if (sN === season && eN === episode) return String(epObj.ref || epObj.id || '').trim();
  }
  return '';
}

export interface PluginStreamRow {
  url: string;
  label: string;
  quality: string;
  mime: string;
  headers: Record<string, string>;
}

function rowOf(s: Record<string, unknown>, fallbackHeaders: Record<string, string>): PluginStreamRow | null {
  const url = String(s.url || '').trim();
  if (!/^https?:\/\//i.test(url) || url.length > 4096) return null;
  const headers = { ...fallbackHeaders, ...sanitizeHeaders(s.headers) };
  if (typeof s.referer === 'string' && !headers.Referer) headers.Referer = s.referer;
  return {
    url,
    label: String(s.label || s.title || s.name || s.server || '').slice(0, 120),
    quality: String(s.quality || '').slice(0, 20),
    mime: String(s.mime || s.type || '').slice(0, 60),
    headers,
  };
}

/**
 * Flattens a Kino `resolve()` answer: a list, `{ streams | sources }`, or one
 * stream object with `alternatives` (rows with a `url`; lazy `ref`-only
 * alternatives are left for the plugin's own server menu).
 */
export function streamsFromResolve(value: unknown): PluginStreamRow[] {
  const out: PluginStreamRow[] = [];
  const seen = new Set<string>();
  const push = (row: PluginStreamRow | null) => {
    if (row && !seen.has(row.url)) {
      seen.add(row.url);
      out.push(row);
    }
  };
  const visit = (v: unknown, inherited: Record<string, string>) => {
    if (Array.isArray(v)) {
      v.forEach((x) => visit(x, inherited));
      return;
    }
    const obj = asRecord(v);
    if (!Object.keys(obj).length) return;
    const row = rowOf(obj, inherited);
    push(row);
    const next = row ? row.headers : inherited;
    for (const key of ['streams', 'sources', 'alternatives']) {
      if (Array.isArray(obj[key])) visit(obj[key], next);
    }
  };
  visit(value, {});
  return out.slice(0, 24);
}

/** Last two labels of a host (`s40.fastream.to` -> `fastream.to`). */
export function baseDomain(urlOrHost: string): string {
  const host = /^https?:\/\//i.test(urlOrHost) ? hostOf(urlOrHost) : urlOrHost.toLowerCase();
  return host.split('.').slice(-2).join('.');
}

/**
 * Some hosters (fastream) bind the stream token to the exact headers the
 * embed page was fetched with, not only User-Agent: the resolver fetched it
 * with its own `Accept-Language`, so playback must send the same one.
 * `langByDomain` holds the last `Accept-Language` plugins sent per base domain.
 */
export function withRequestLanguage(
  headers: Record<string, string>,
  url: string,
  langByDomain: Map<string, string>,
): Record<string, string> {
  if (Object.keys(headers).some((k) => k.toLowerCase() === 'accept-language')) return headers;
  const referer = Object.entries(headers).find(([k]) => k.toLowerCase() === 'referer')?.[1] || '';
  const lang = langByDomain.get(baseDomain(url)) || (referer ? langByDomain.get(baseDomain(referer)) : undefined);
  return lang ? { ...headers, 'Accept-Language': lang } : headers;
}

/** Short Spanish explanation of a plugin failure for the toast. */
export function pluginFailureMessage(pluginName: string, err: unknown): string {
  const e = asRecord(err);
  const userMessage = typeof e.userMessage === 'string' ? e.userMessage.trim() : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const raw = err instanceof Error ? err.message : String(e.message || err || '');
  let reason: string;
  if (userMessage) reason = userMessage;
  else if (code === 'timeout' || /timeout|tiempo agotado/i.test(raw)) reason = 'tardó demasiado en responder';
  else if (code === 'not_found') reason = 'no encontró este título';
  else if (code === 'host_not_allowed') reason = 'intentó conectarse a una dirección no permitida';
  else if (code === 'provider_missing') reason = 'necesita otro plugin que no está disponible';
  else if (/compilar|SyntaxError/i.test(raw)) reason = 'este equipo no pudo ejecutar su código';
  else if (code === 'unavailable') reason = 'su sitio no está disponible ahora';
  else reason = 'no devolvió fuentes';
  return `${pluginName}: ${reason.replace(/\.$/, '')}`.slice(0, 220);
}
