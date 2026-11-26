import type { Episode, InstalledPlugin, MediaItem, StreamSource } from '../types/models';
import {
  absorbCookies,
  asRecord,
  confirmsYear,
  cookieHeaderFor,
  pickEpisodeRef,
  pickSearchHits,
  pluginFailureMessage,
  baseDomain,
  sanitizeHeaders,
  streamsFromResolve,
  withRequestLanguage,
  type CookieJar,
} from './jsPluginMatch';
import { helperFromConsumes, randomCallId, sha256Hex, tmdbPluginRoute } from './jsPluginSecurity';
import { recordThroughput } from './deviceProfile';
import { desktopApi } from './tauri';

const MAX_PLUGIN_CODE_BYTES = 512 * 1024;
const MAX_STORAGE_ENTRIES = 400;
const MAX_STORAGE_VALUE_LEN = 64 * 1024;
/** Largest plain-data payload a plugin may hand to a helper door. */
const MAX_DOOR_ARGS_CHARS = 1024 * 1024;
const CODE_TTL_MS = 30 * 60_000;
/** Per-call budgets: Kino site plugins spend up to 40–60 s trying servers in `resolve`. */
const TIMEOUTS = { load: 12_000, search: 16_000, episodes: 25_000, resolve: 65_000, door: 50_000 };
const DOOR_RE = /^[A-Za-z0-9]{1,32}$/;
/** Sandbox keys of helper instances; never collides with an installed plugin id. */
const DOOR_KEY_PREFIX = 'door\u0000';

type RawStream = Partial<StreamSource> & Pick<StreamSource, 'id' | 'addonId' | 'addonName'>;

interface PluginContext {
  id: string;
  name: string;
  allowLan: boolean;
  /** Raw repo base the plugin was loaded from. */
  base: string;
  manifest: Record<string, unknown>;
}

interface RuntimeReply {
  value?: unknown;
  error?: string;
  code?: string;
  userMessage?: string;
}

export interface JsPluginFailure {
  pluginId: string;
  pluginName: string;
  message: string;
}

export interface JsFetchResult {
  streams: RawStream[];
  failures: JsPluginFailure[];
}

/** One sandboxed iframe as seen by the runner (abstracted so tests can fake it). */
export interface SandboxFrameHandle {
  /** The frame's `contentWindow`, compared with `MessageEvent.source`. */
  readonly window: unknown;
  post(msg: Record<string, unknown>): void;
  destroy(): void;
}

/** Creates one isolated frame; `onLoad` fires when its document finished loading. */
export type SandboxFrameFactory = (onLoad: () => void) => SandboxFrameHandle;

/** Minimal view of a `MessageEvent` (testable without a DOM). */
export interface SandboxMessage {
  source: unknown;
  origin: string;
  data: unknown;
}

interface Sandbox {
  key: string;
  handle: SandboxFrameHandle;
  ready: Promise<void>;
  markReady: () => void;
  /** Host -> sandbox calls waiting for a reply FROM THIS FRAME only. */
  pending: Map<string, (reply: RuntimeReply) => void>;
}

class PluginCallError extends Error {
  code: string;
  userMessage?: string;
  constructor(message: string, code = 'error', userMessage?: string) {
    super(message);
    this.code = code;
    this.userMessage = userMessage;
  }
}

/** Normalizes a plugin episodes response into a flat episode list. */
function flattenKinoEpisodes(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    const out: Array<Record<string, unknown>> = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      if (Array.isArray(rec.episodes)) {
        const sNum = Number(rec.season ?? rec.number ?? 1) || 1;
        for (const ep of rec.episodes) {
          if (ep && typeof ep === 'object') out.push({ season: sNum, ...(ep as Record<string, unknown>) });
        }
      } else {
        out.push(rec);
      }
    }
    return out;
  }
  const obj = asRecord(value);
  for (const key of ['episodes', 'items', 'results']) {
    const arr = obj[key];
    if (Array.isArray(arr)) return flattenKinoEpisodes(arr);
  }
  if (Array.isArray(obj.seasons)) return flattenKinoEpisodes(obj.seasons);
  return [];
}

function toArray(value: unknown, ...objectKeys: string[]): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object');
  }
  const obj = asRecord(value);
  for (const key of objectKeys) {
    const arr = obj[key];
    if (Array.isArray(arr)) {
      return arr.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object');
    }
  }
  return [];
}

/** Manifest `settings[].default` values, so `kino.config.get()` matches Kino. */
function configDefaults(manifest: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const settings = Array.isArray(manifest.settings) ? manifest.settings : [];
  for (const s of settings) {
    const rec = asRecord(s);
    if (typeof rec.key === 'string' && rec.default !== undefined && typeof rec.default !== 'object') {
      out[rec.key] = rec.default;
    }
  }
  return out;
}

/** A JSON-only copy (no functions, prototypes or cycles) of data crossing between plugins. */
function plainData(value: unknown, maxChars: number): unknown {
  if (value === undefined || value === null) return {};
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    throw new PluginCallError('Datos no válidos para el plugin auxiliar', 'error');
  }
  if (typeof text !== 'string') return {};
  if (text.length > maxChars) throw new PluginCallError('Datos demasiado grandes para el plugin auxiliar', 'too_large');
  return JSON.parse(text);
}

/** Production frame: `sandbox="allow-scripts"` (never `allow-same-origin`) + CSP of plugin-sandbox.html. */
const defaultFrameFactory: SandboxFrameFactory = (onLoad) => {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.src = './plugin-sandbox.html';
  iframe.style.cssText =
    'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';
  iframe.addEventListener('load', onLoad);
  document.body.appendChild(iframe);
  return {
    get window() {
      return iframe.contentWindow;
    },
    post(msg) {
      iframe.contentWindow?.postMessage(msg, '*');
    },
    destroy() {
      iframe.remove();
    },
  };
};

/**
 * Isolated iframe runner for third-party JS plugins (`kino-plugin.json` + `plugin.js`).
 *
 * Every plugin key gets ITS OWN iframe with `sandbox="allow-scripts"` WITHOUT
 * `allow-same-origin` (opaque origin, no app access, CSP forbids its own network).
 * The host binds each message to the plugin through `ev.source` -> frame; the key
 * a frame writes into a message is ignored. Pending calls use random ids scoped to
 * the frame they were sent to, and each plugin has its own cookie jar and storage.
 *
 * Wire protocol (`public/js/plugin-runtime.js`): every message carries
 * `opentvPlugin: 1`; the host sends `load`/`call`/`unload` and the sandbox replies
 * with `kind:'reply'`; plugin RPC requests arrive as `kind:'ask'` and are answered
 * with `kind:'answer'`. Every network fetch passes through Rust NetGuard.
 *
 * Plugin doors (`kino.plugins.call('resolver', ...)`): the provider runs in its own
 * frame under its own key, never with `allowLan`, and receives only plain data.
 * It is an installed plugin that `provides` the door, or an APPROVED helper repo the
 * caller names in `consumes.<door>.repo` (see jsPluginSecurity.ts), optionally pinned
 * by commit / SHA-256.
 */
export class IsolatedJsPluginRunner {
  private sandboxes = new Map<string, Sandbox>();
  private listening = false;
  private contexts = new Map<string, PluginContext>();
  /** key -> code currently loaded in its sandbox. */
  private loaded = new Map<string, string>();
  /** key -> callable exports reported by the sandbox at load. */
  private names = new Map<string, string[]>();
  private loading = new Map<string, Promise<void>>();
  private codeCache = new Map<string, { at: number; code: string; manifest: Record<string, unknown> }>();
  private installed: InstalledPlugin[] = [];
  private pluginStorage = new Map<string, string>();
  /** key -> that plugin's own cookie jar (only ever sent to its own frame). */
  private jars = new Map<string, CookieJar>();
  /** base domain -> last `Accept-Language` a plugin sent there (see withRequestLanguage). */
  private langByDomain = new Map<string, string>();

  constructor(private readonly createFrame: SandboxFrameFactory = defaultFrameFactory) {}

  private jarFor(key: string): CookieJar {
    let jar = this.jars.get(key);
    if (!jar) {
      jar = {};
      this.jars.set(key, jar);
    }
    return jar;
  }

  /** Host -> one sandbox. Tagging is mandatory or the runtime drops the message. */
  private post(sb: Sandbox, msg: Record<string, unknown>): void {
    sb.handle.post({ ...msg, opentvPlugin: 1 });
  }

  private ensureListener(): void {
    if (this.listening || typeof window === 'undefined') return;
    this.listening = true;
    window.addEventListener('message', (ev) => this.receive(ev));
  }

  /** The sandbox whose frame sent this message, or undefined for any other window. */
  private sandboxFor(source: unknown): Sandbox | undefined {
    if (!source) return undefined;
    for (const sb of this.sandboxes.values()) if (sb.handle.window === source) return sb;
    return undefined;
  }

  /** Sandbox -> host. The plugin identity comes from the sending frame, never from `msg.key`. */
  receive(ev: SandboxMessage): void {
    // Sandboxed iframe without `allow-same-origin` MUST have opaque origin 'null'.
    if (ev.origin !== 'null') return;
    const sb = this.sandboxFor(ev.source);
    if (!sb) return;
    const data = ev.data;
    if (!data || typeof data !== 'object' || (data as Record<string, unknown>).opentvPlugin !== 1) return;
    const msg = data as Record<string, unknown>;

    if (msg.kind === 'ready') {
      sb.markReady();
      return;
    }
    if (msg.kind === 'ask' && typeof msg.id === 'number') {
      void this.handleAsk(sb, msg.id, String(msg.op || ''), asRecord(msg.args));
      return;
    }
    if (msg.kind === 'reply' && typeof msg.id === 'string') {
      const cb = sb.pending.get(msg.id);
      if (cb) {
        sb.pending.delete(msg.id);
        cb({
          value: msg.value,
          error: typeof msg.error === 'string' ? msg.error : undefined,
          code: typeof msg.code === 'string' ? msg.code : undefined,
          userMessage: typeof msg.userMessage === 'string' ? msg.userMessage : undefined,
        });
      }
    }
  }

  /** The plugin's own frame, created on first use. */
  private ensureSandbox(key: string): Sandbox {
    const existing = this.sandboxes.get(key);
    if (existing) return existing;
    this.ensureListener();
    let markReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const handle = this.createFrame(() => setTimeout(markReady, 150));
    const sb: Sandbox = { key, handle, ready, markReady, pending: new Map() };
    this.sandboxes.set(key, sb);
    return sb;
  }

  private dropSandbox(key: string): void {
    const sb = this.sandboxes.get(key);
    if (!sb) return;
    this.sandboxes.delete(key);
    for (const cb of sb.pending.values()) cb({ error: 'Plugin descargado', code: 'unavailable' });
    sb.pending.clear();
    sb.handle.destroy();
  }

  private replyAsk(sb: Sandbox, id: number, value: unknown, error?: string, code?: string, userMessage?: string): void {
    this.post(sb, { kind: 'answer', id, value: value ?? null, error, code, userMessage, jar: this.jarFor(sb.key) });
  }

  /** Answers one sandbox `ask`. The frame's bound key scopes `allowLan`, storage and cookies. */
  private async handleAsk(sb: Sandbox, id: number, op: string, args: Record<string, unknown>): Promise<void> {
    const key = sb.key;
    const ctx = this.contexts.get(key);
    const allowLan = ctx?.allowLan ?? false;
    try {
      if (op === 'fetch') {
        const jar = this.jarFor(key);
        const o = asRecord(args.opts);
        const url = String(args.url || '');
        const headers = sanitizeHeaders(o.headers);
        if (!Object.keys(headers).some((k) => k.toLowerCase() === 'cookie')) {
          const cookie = cookieHeaderFor(jar, url);
          if (cookie) headers.Cookie = cookie;
        }
        const lang = Object.entries(headers).find(([k]) => k.toLowerCase() === 'accept-language')?.[1];
        if (lang) {
          if (this.langByDomain.size > 200) this.langByDomain.clear();
          this.langByDomain.set(baseDomain(url), lang);
        }
        const params: Record<string, unknown> = {
          url,
          method: typeof o.method === 'string' ? o.method : 'GET',
          headers,
          timeoutMs: Number(o.timeoutMs) || 12_000,
          allowLan,
        };
        if (typeof o.redirect === 'string') params.redirect = o.redirect;
        if (typeof o.maxBytes === 'number' && o.maxBytes > 0) params.maxBytes = Math.floor(o.maxBytes);
        if (typeof o.body === 'string') params.body = o.body;
        if (typeof o.bodyBase64 === 'string') params.bodyBase64 = o.bodyBase64;
        if (o.bodyJson !== undefined) {
          params.body = JSON.stringify(o.bodyJson);
          if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
            params.headers = { ...headers, 'Content-Type': 'application/json' };
          }
        }
        if (o.bodyForm && typeof o.bodyForm === 'object') {
          const form = new URLSearchParams();
          for (const [k, v] of Object.entries(asRecord(o.bodyForm))) form.append(k, String(v));
          params.body = form.toString();
          params.headers = { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' };
        }
        const started = performance.now();
        const res = await desktopApi.service<Record<string, unknown>>('pluginFetch', params);
        // Free network sample for the auto-quality rule (large bodies only).
        if (typeof res?.base64 === 'string') recordThroughput((res.base64.length * 3) / 4, performance.now() - started);
        absorbCookies(jar, res?.setCookies, String(res?.url || url));
        this.replyAsk(sb, id, res);
        return;
      }
      if (op === 'pluginCall') {
        const value = await this.callDoor(key, String(args.door || ''), String(args.fn || ''), args.args);
        this.replyAsk(sb, id, value);
        return;
      }
      if (op === 'tmdb') {
        // Only whitelisted read-only metadata routes (never arbitrary `raw:` paths).
        const res = asRecord(await desktopApi.tmdb(tmdbPluginRoute(args.route, args.params)));
        if (typeof res.error === 'string') throw new PluginCallError(res.error, res.unavailable ? 'unavailable' : 'error');
        this.replyAsk(sb, id, res.item ?? null);
        return;
      }
      if (op === 'browser') {
        // Whitelist: never forward plugin-supplied `script`/`injectJs` or extra
        // headers to the offscreen WebView.
        const b = asRecord(args);
        const payload: Record<string, unknown> = {
          url: String(b.url || '').slice(0, 4096),
          allowLan,
        };
        if (typeof b.returnHtml === 'boolean') payload.returnHtml = b.returnHtml;
        if (typeof b.waitMs === 'number') payload.waitMs = Math.min(5_000, Math.max(0, b.waitMs));
        if (typeof b.timeoutMs === 'number') payload.timeoutMs = Math.min(25_000, Math.max(2_000, b.timeoutMs));
        if (typeof b.matchSource === 'string') payload.matchSource = b.matchSource.slice(0, 128);
        if (typeof b.matchFlags === 'string') {
          payload.matchFlags = /^(?:gi|ig|g|i)$/.test(b.matchFlags) ? b.matchFlags : 'i';
        }
        const ua = Object.entries(sanitizeHeaders(b.headers)).find(([k]) => k.toLowerCase() === 'user-agent');
        if (ua) payload.headers = { 'User-Agent': ua[1] };
        this.replyAsk(sb, id, await desktopApi.browserCapture(payload));
        return;
      }
      if (op === 'storageSet') {
        const storageKey = `${key}::${String(args.k || '').slice(0, 128)}`;
        const value = String(args.v ?? '');
        if (value.length <= MAX_STORAGE_VALUE_LEN) {
          if (!this.pluginStorage.has(storageKey) && this.pluginStorage.size >= MAX_STORAGE_ENTRIES) {
            const oldest = this.pluginStorage.keys().next().value;
            if (oldest) this.pluginStorage.delete(oldest);
          }
          this.pluginStorage.set(storageKey, value);
          this.replyAsk(sb, id, true);
        } else {
          this.replyAsk(sb, id, false);
        }
        return;
      }
      if (op === 'storageRemove') {
        this.pluginStorage.delete(`${key}::${String(args.k || '').slice(0, 128)}`);
        this.replyAsk(sb, id, true);
        return;
      }
      if (op === 'cookiesClear') {
        const domain = String(args.domain || '').toLowerCase().replace(/^\.+/, '');
        if (!domain) this.jars.set(key, {});
        else delete this.jarFor(key)[domain];
        this.replyAsk(sb, id, true);
        return;
      }
      this.replyAsk(sb, id, null, `Operación no soportada: ${op}`, 'unsupported');
    } catch (e) {
      const rec = asRecord(e);
      const code = typeof rec.code === 'string' ? rec.code : 'rpc';
      const userMessage = typeof rec.userMessage === 'string' ? rec.userMessage : undefined;
      this.replyAsk(sb, id, null, e instanceof Error ? e.message : String(e), code, userMessage);
    }
  }

  /** Runs `proto_<door>_<fn>` of the plugin that provides `door` for the caller `key`. */
  private async callDoor(callerKey: string, door: string, fn: string, args: unknown): Promise<unknown> {
    if (!DOOR_RE.test(door) || !DOOR_RE.test(fn)) {
      throw new PluginCallError('Puerta no válida', 'provider_missing');
    }
    const caller = this.contexts.get(callerKey);
    if (!caller) throw new PluginCallError('Plugin desconocido', 'provider_missing');
    // Helpers only ever see plain data from the caller.
    const input = plainData(args, MAX_DOOR_ARGS_CHARS);

    // 1. An installed plugin whose manifest provides the door. It runs in a separate
    //    helper frame WITHOUT allowLan, so callers cannot borrow its LAN permission.
    let providerKey = '';
    for (const p of this.installed) {
      if (p.disabled || p.kind !== 'kino-js' || !p.rawRepoBase || p.id === callerKey) continue;
      try {
        const { manifest } = await this.getPluginSource(p.rawRepoBase, false);
        if (asRecord(asRecord(manifest.provides)[door]).calls) {
          providerKey = `${DOOR_KEY_PREFIX}installed:${p.id}`;
          await this.ensureLoaded(providerKey, p.name, p.rawRepoBase, false);
          break;
        }
      } catch {
        providerKey = '';
        /* try the next one */
      }
    }

    // 2. An APPROVED helper repo the caller declares in `consumes.<door>.repo`.
    if (!providerKey) {
      const helper = helperFromConsumes(asRecord(asRecord(caller.manifest.consumes)[door]));
      if (!helper) throw new PluginCallError(`Sin proveedor para ${door}`, 'provider_missing');
      const { manifest, code } = await this.getPluginSource(helper.base, false);
      if (helper.sha256 && (await sha256Hex(code)) !== helper.sha256) {
        this.codeCache.delete(helper.base);
        throw new PluginCallError(
          `El plugin auxiliar ${helper.repo} no coincide con la versión fijada`,
          'provider_missing',
          `El plugin auxiliar ${helper.repo} cambió y no coincide con la versión verificada`,
        );
      }
      if (!asRecord(asRecord(manifest.provides)[door]).calls) {
        throw new PluginCallError(`Sin proveedor para ${door}`, 'provider_missing');
      }
      providerKey = `${DOOR_KEY_PREFIX}${helper.repo}@${helper.sha256 || helper.base}`;
      await this.ensureLoaded(providerKey, String(manifest.name || helper.repo), helper.base, false);
    }

    const allowed = asRecord(asRecord(asRecord(this.contexts.get(providerKey)?.manifest.provides)[door]).calls);
    if (!Object.prototype.hasOwnProperty.call(allowed, fn)) {
      throw new PluginCallError(`La puerta ${door} no tiene ${fn}`, 'not_supported');
    }
    const out = await this.callPlugin(providerKey, `proto_${door}_${fn}`, [input], TIMEOUTS.door);
    return out === undefined ? null : plainData(out, MAX_PLUGIN_CODE_BYTES * 8);
  }

  /** Sends one tagged request to a plugin's sandbox and waits for ITS `kind:'reply'`. */
  private request<T = unknown>(sb: Sandbox, msg: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const id = randomCallId();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        sb.pending.delete(id);
        reject(new PluginCallError('Timeout del plugin JS', 'timeout'));
      }, timeoutMs);
      sb.pending.set(id, (reply) => {
        clearTimeout(timer);
        if (reply.error) reject(new PluginCallError(reply.error, reply.code || 'error', reply.userMessage));
        else resolve(reply.value as T);
      });
      this.post(sb, { ...msg, id });
    });
  }

  /** Downloads (and caches) a plugin's manifest + code through Rust `pluginFetch`. */
  private async getPluginSource(
    base: string,
    allowLan: boolean,
  ): Promise<{ code: string; manifest: Record<string, unknown> }> {
    const hit = this.codeCache.get(base);
    if (hit && Date.now() - hit.at < CODE_TTL_MS) return hit;
    const fetchText = async (url: string) => {
      const res = await desktopApi.service<{ ok?: boolean; text?: string; status?: number }>('pluginFetch', {
        url,
        method: 'GET',
        timeoutMs: 10_000,
        allowLan,
      });
      if (!res?.ok || !res.text) {
        throw new PluginCallError(`No se pudo descargar ${url} (${res?.status || 0})`, 'unavailable');
      }
      return res.text;
    };
    const manifestText = await fetchText(`${base}/kino-plugin.json`).catch(() => '{}');
    let manifest: Record<string, unknown> = {};
    try {
      manifest = asRecord(JSON.parse(manifestText));
    } catch {
      manifest = {};
    }
    const entry =
      typeof manifest.entry === 'string' && /^[A-Za-z0-9_./-]{1,80}\.js$/.test(manifest.entry) && !manifest.entry.includes('..')
        ? manifest.entry
        : 'plugin.js';
    const code = await fetchText(`${base}/${entry}`);
    if (code.length > MAX_PLUGIN_CODE_BYTES) throw new PluginCallError('El plugin es demasiado grande', 'too_large');
    const out = { at: Date.now(), code, manifest };
    this.codeCache.set(base, out);
    return out;
  }

  private storageFor(key: string): Record<string, string> {
    const prefix = `${key}::`;
    const out: Record<string, string> = {};
    for (const [k, v] of this.pluginStorage) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
    return out;
  }

  /** Loads a plugin into its own sandbox once; reloads only when its code changed. */
  private async ensureLoaded(key: string, name: string, base: string, allowLan: boolean): Promise<string[]> {
    const { code, manifest } = await this.getPluginSource(base, allowLan);
    this.contexts.set(key, { id: key, name, allowLan, base, manifest });
    const inflight = this.loading.get(key);
    if (inflight) await inflight;
    if (this.loaded.get(key) !== code) {
      const job = (async () => {
        if (this.loaded.has(key)) {
          // New code: start from a fresh realm instead of re-running inside the old one.
          this.dropSandbox(key);
          this.loaded.delete(key);
        }
        const sb = this.ensureSandbox(key);
        await sb.ready;
        const res = await this.request<{ names?: string[] }>(
          sb,
          {
            kind: 'load',
            key,
            code,
            setup: { storage: this.storageFor(key), config: configDefaults(manifest), appVersion: '2.0.1' },
            jar: this.jarFor(key),
          },
          TIMEOUTS.load,
        );
        this.loaded.set(key, code);
        this.names.set(key, Array.isArray(res?.names) ? res.names.filter((n): n is string => typeof n === 'string') : []);
      })();
      this.loading.set(key, job);
      try {
        await job;
      } finally {
        this.loading.delete(key);
      }
    }
    return this.names.get(key) || [];
  }

  private callPlugin(key: string, fn: string, args: unknown[], timeoutMs: number): Promise<unknown> {
    const sb = this.sandboxes.get(key);
    if (!sb) return Promise.reject(new PluginCallError('Plugin no cargado', 'unavailable'));
    return this.request(sb, { kind: 'call', key, fn, args }, timeoutMs);
  }

  /** Searches one plugin for the title and resolves the matching movie/episode. */
  private async streamsFromPlugin(
    plugin: InstalledPlugin,
    item: MediaItem,
    episode: Episode | null,
  ): Promise<RawStream[]> {
    const base = plugin.rawRepoBase || '';
    const names = await this.ensureLoaded(plugin.id, plugin.name, base, plugin.allowLan);
    if (!names.includes('resolve')) throw new PluginCallError('El plugin no tiene resolve', 'not_supported');

    const isSeries = item.type !== 'movie';
    const kind = isSeries ? 'series' : 'movie';
    const year = parseInt(String(item.year || '').slice(0, 4), 10) || undefined;
    const imdbId = item.id.replace(/^stremio:/, '').split(':')[0];
    const originalTitle = item.originalTitle && item.originalTitle !== item.title ? item.originalTitle : '';
    // Same shape as Kino's search query.
    const searchArg = {
      q: item.title,
      query: item.title,
      type: kind,
      kind,
      year: year || 0,
      imdbId,
      originalTitle,
      altTitles: originalTitle ? [originalTitle] : [],
      season: episode?.season || 0,
      episode: episode?.number || 0,
      tmdbId: 0,
      cursor: null,
    };

    const rows: ReturnType<typeof streamsFromResolve> = [];
    let lastError: unknown = null;
    if (names.includes('search')) {
      const hitsRaw = await this.callPlugin(plugin.id, 'search', [searchArg], TIMEOUTS.search);
      const query = { title: item.title, originalTitle, year, kind } as const;
      const hits = pickSearchHits(toArray(hitsRaw, 'items', 'results'), query);
      if (!hits.length) throw new PluginCallError('Sin coincidencias', 'not_found');
      for (const hit of hits) {
        try {
          let ref = hit.ref;
          if (hit.verify && !isSeries) {
            const meta = names.includes('details')
              ? await this.callPlugin(plugin.id, 'details', [hit.ref], TIMEOUTS.search).catch(() => null)
              : null;
            if (!confirmsYear(meta, query)) {
              lastError = new PluginCallError('Sin coincidencias', 'not_found');
              continue;
            }
          }
          if (isSeries && episode) {
            if (!names.includes('episodes')) break;
            const epRes = await this.callPlugin(plugin.id, 'episodes', [hit.ref], TIMEOUTS.episodes);
            if (hit.verify && !confirmsYear(asRecord(epRes).series, query)) {
              lastError = new PluginCallError('Sin coincidencias', 'not_found');
              continue;
            }
            ref = pickEpisodeRef(flattenKinoEpisodes(epRes), episode.season || 1, episode.number || 1);
            if (!ref) {
              lastError = new PluginCallError('Episodio no encontrado', 'not_found');
              continue;
            }
          }
          rows.push(...streamsFromResolve(await this.callPlugin(plugin.id, 'resolve', [ref], TIMEOUTS.resolve)));
          if (rows.length) break;
        } catch (e) {
          lastError = e;
        }
      }
    } else {
      rows.push(...streamsFromResolve(await this.callPlugin(plugin.id, 'resolve', [item.title], TIMEOUTS.resolve)));
    }
    if (!rows.length) throw lastError || new PluginCallError('Sin fuentes', 'not_found');

    return rows.map((s, idx) => ({
      id: `${plugin.id}_js_${idx}`,
      addonId: plugin.id,
      addonName: plugin.name,
      name: plugin.name,
      // The ranker reads language/quality from these words ("Latino · fastream", "1080p").
      title: [s.label, s.quality && s.quality !== 'auto' ? s.quality : ''].filter(Boolean).join(' · '),
      url: s.url,
      infoHash: '',
      filename: /mp4/i.test(s.mime) ? 'stream.mp4' : '',
      trackers: [],
      headers: withRequestLanguage(s.headers, s.url, this.langByDomain),
      isJsPlugin: true,
    }));
  }

  /**
   * Queries every enabled JS plugin in parallel. `onPartial` receives each
   * plugin's streams as soon as they arrive (progressive source picker).
   */
  async fetchStreamsDetailed(
    item: MediaItem,
    episode: Episode | null,
    plugins: InstalledPlugin[],
    opts?: {
      onPartial?: (streams: RawStream[]) => void;
      /** Fires once per plugin when it finished (with streams or a failure). */
      onPluginDone?: (plugin: { id: string; name: string }, streams: RawStream[], failure?: JsPluginFailure) => void;
    },
  ): Promise<JsFetchResult> {
    this.installed = plugins;
    const jsPlugins = activeJsPlugins(plugins);
    if (jsPlugins.length === 0) return { streams: [], failures: [] };

    const streams: RawStream[] = [];
    const failures: JsPluginFailure[] = [];
    await Promise.all(
      jsPlugins.map(async (plugin) => {
        try {
          const found = await this.streamsFromPlugin(plugin, item, episode);
          streams.push(...found);
          opts?.onPartial?.(found);
          opts?.onPluginDone?.({ id: plugin.id, name: plugin.name }, found);
        } catch (e) {
          const failure = { pluginId: plugin.id, pluginName: plugin.name, message: pluginFailureMessage(plugin.name, e) };
          failures.push(failure);
          if (e instanceof PluginCallError && /compilar/i.test(e.message)) this.loaded.delete(plugin.id);
          opts?.onPluginDone?.({ id: plugin.id, name: plugin.name }, [], failure);
        }
      }),
    );
    return { streams, failures };
  }

  async fetchStreams(item: MediaItem, episode: Episode | null, plugins: InstalledPlugin[]): Promise<RawStream[]> {
    return (await this.fetchStreamsDetailed(item, episode, plugins)).streams;
  }

  /** Drops a plugin and its frame (uninstall / disable). */
  unload(key: string): void {
    this.dropSandbox(key);
    this.loaded.delete(key);
    this.names.delete(key);
    this.contexts.delete(key);
    this.jars.delete(key);
  }
}

/** Enabled kino JS plugins that will be queried for streams. */
export function activeJsPlugins(plugins: InstalledPlugin[]): InstalledPlugin[] {
  return plugins.filter((p) => !p.disabled && p.kind === 'kino-js' && p.rawRepoBase);
}

export const jsPluginRunner = new IsolatedJsPluginRunner();
