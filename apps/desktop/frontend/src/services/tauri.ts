import type { UpdateStatus } from '../types/models';
import { isLiteMode, liteImageWidth } from './liteMode';

interface TauriInternals {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  transformCallback?: (cb: (event: { payload: unknown }) => void) => number;
}

interface TauriInit {
  port?: number;
  version?: string;
  token?: string;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals;
    __OPENTV_TAURI_INIT__?: TauriInit;
  }
}

function internals(): TauriInternals | null {
  return window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function'
    ? window.__TAURI_INTERNALS__
    : null;
}

export function isTauriEnv(): boolean {
  return internals() !== null;
}

export function getProxyPort(): number {
  return Number(window.__OPENTV_TAURI_INIT__?.port) || 0;
}

export function getAppVersion(): string {
  return window.__OPENTV_TAURI_INIT__?.version || '2.0.1';
}

export function getServiceToken(): string {
  return window.__OPENTV_TAURI_INIT__?.token || '';
}

// CDNs that already serve sized artwork over HTTP/2: the WebView loads them directly
// (like v1) instead of queueing behind the local resizer's 6 HTTP/1.1 connections.
const DIRECT_IMAGE_HOSTS = /^https:\/\/(image\.tmdb\.org|images\.metahub\.space|episodes\.metahub\.space|live\.metahub\.space|media\.kitsu\.(app|io))\//i;
const TMDB_SIZES = [185, 300, 500, 780, 1280];

/** Direct CDN address for `url` near `widthPx`, or '' when the host is not a known sized CDN. */
export function directImageUrl(url: string, widthPx: number): string {
  if (!DIRECT_IMAGE_HOSTS.test(url)) return '';
  const m = /^(https:\/\/image\.tmdb\.org\/t\/p\/)(w\d+|original)(\/.+)$/i.exec(url);
  if (!m) return url;
  // Never ask for more than the catalog gave (a w342 poster has no w1280 twin worth loading).
  const current = m[2].toLowerCase() === 'original' ? Infinity : Number(m[2].slice(1));
  const wanted = TMDB_SIZES.find((s) => s >= widthPx) ?? 1280;
  if (wanted >= current) return url;
  return m[1] + 'w' + wanted + m[3];
}

const prefetched = new Set<string>();

/** Warms the browser cache for an image the user is likely to open next (hover on a card). */
export function prefetchImage(url: string | undefined, widthPx: number): void {
  if (isLiteMode()) return;
  const src = resizedImageUrl(url, widthPx);
  if (!src || prefetched.has(src)) return;
  if (prefetched.size > 300) prefetched.clear();
  prefetched.add(src);
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
}

export function resizedImageUrl(url: string | undefined, requestedPx: number): string {
  if (!url) return '';
  const widthPx = liteImageWidth(requestedPx);
  const direct = directImageUrl(url, widthPx);
  // Cinemeta art comes in fixed sizes: lite mode takes the next smaller one.
  if (direct) return isLiteMode() ? direct.replace('/poster/medium/', '/poster/small/').replace('/background/large/', '/background/medium/') : direct;
  const port = getProxyPort();
  if (!port || !/^https?:\/\//i.test(url) || url.startsWith('http://127.0.0.1:')) {
    return url;
  }
  const token = getServiceToken();
  const tokenParam = token ? `&__token=${encodeURIComponent(token)}` : '';
  return `http://127.0.0.1:${port}/img?u=${encodeURIComponent(url)}&w=${Math.round(widthPx)}${tokenParam}`;
}

async function invoke<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const api = internals();
  if (!api) {
    throw new Error('Entorno Tauri no disponible');
  }
  return api.invoke<T>(cmd, args);
}

export const desktopApi = {
  service<T = Record<string, unknown>>(method: string, parameters: Record<string, unknown> = {}): Promise<T> {
    if (!isTauriEnv()) return Promise.resolve({ returnValue: false } as T);
    return invoke<T>('desktop_service', { method, parameters });
  },

  tmdb<T = Record<string, unknown>>(list: string): Promise<T> {
    if (!isTauriEnv()) return Promise.resolve({ items: [] } as T);
    return invoke<T>('desktop_tmdb', { list });
  },

  fullscreen(flag?: boolean | 'query'): Promise<boolean> {
    if (!isTauriEnv()) return Promise.resolve(false);
    return invoke<boolean>('desktop_fullscreen', { flag: flag === undefined ? null : flag });
  },

  pin(flag?: boolean | 'query'): Promise<boolean> {
    if (!isTauriEnv()) return Promise.resolve(false);
    return invoke<boolean>('desktop_pin', { flag: flag === undefined ? null : flag });
  },

  /**
   * Applies the theme to the native window (background behind the WebView, DWM border) and the
   * WebView zoom used by "Texto aumentado". Outside Tauri the zoom falls back to CSS `zoom`.
   */
  appearance(theme: 'dark' | 'light', zoom: number): Promise<boolean> {
    if (!isTauriEnv()) {
      document.documentElement.style.zoom = zoom === 1 ? '' : String(zoom);
      return Promise.resolve(false);
    }
    return invoke<boolean>('desktop_appearance', { theme, zoom }).catch(() => false);
  },

  windowControl(action: 'min' | 'max' | 'close'): Promise<boolean> {
    if (!isTauriEnv()) return Promise.resolve(false);
    return invoke<boolean>('desktop_win_control', { action });
  },

  startDragging(): Promise<void> {
    if (!isTauriEnv()) return Promise.resolve();
    return invoke<void>('plugin:window|start_dragging').catch(() => {});
  },

  systemVolume(command: 'get' | 'set' | 'mute', value?: number | boolean): Promise<{ level?: number; muted?: boolean; error?: string }> {
    if (!isTauriEnv()) return Promise.resolve({});
    return invoke('desktop_system_volume', { command, value: value === undefined ? null : value });
  },

  backupRead<T = unknown>(): Promise<T | null> {
    if (!isTauriEnv()) return Promise.resolve(null);
    return invoke<T | null>('desktop_backup', { command: 'read', data: null });
  },

  backupWrite(data: unknown): Promise<boolean> {
    if (!isTauriEnv()) return Promise.resolve(false);
    return invoke<boolean>('desktop_backup', { command: 'write', data });
  },

  openDownloads(): Promise<boolean> {
    if (!isTauriEnv()) return Promise.resolve(false);
    return invoke<boolean>('desktop_open_downloads');
  },

  openLogs(): Promise<boolean> {
    if (!isTauriEnv()) return Promise.resolve(false);
    return invoke<boolean>('desktop_open_logs');
  },

  openAddonConfig(url: string): Promise<boolean> {
    if (!isTauriEnv()) return Promise.resolve(false);
    return invoke<boolean>('desktop_open_addon_config', { url });
  },

  browserCapture(opts: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!isTauriEnv()) return Promise.resolve({ ok: false, error: 'Solo en app de escritorio' });
    return invoke('desktop_browser_capture', { opts });
  },

  update(command: 'status' | 'check' | 'download' | 'install' | 'releases'): Promise<UpdateStatus> {
    if (!isTauriEnv()) return Promise.resolve({ state: 'idle', version: getAppVersion() });
    return invoke<UpdateStatus>('desktop_update', { command });
  },

  info(): Promise<{ version: string; platform: string; runtime: string; port: number } | null> {
    if (!isTauriEnv()) return Promise.resolve(null);
    return invoke('desktop_info');
  },

  pickLocalVideo(): Promise<string | null> {
    if (!isTauriEnv()) return Promise.resolve(null);
    return invoke<string | null>('desktop_pick_local_video');
  },

  pickLocalFolder(): Promise<string | null> {
    if (!isTauriEnv()) return Promise.resolve(null);
    return invoke<string | null>('desktop_pick_local_folder');
  },

  /** Clears the Rust `/img` resized-image cache and the WebView2 HTTP disk cache. */
  clearCache(): Promise<{ ok?: boolean; files?: number; bytes?: number; webviewCache?: boolean }> {
    if (!isTauriEnv()) return Promise.resolve({ ok: false });
    return invoke('desktop_clear_cache');
  },

  listen<T = unknown>(eventName: string, handler: (payload: T) => void): () => void {
    const api = internals();
    if (!api || typeof api.transformCallback !== 'function') return () => {};
    let disposed = false;
    const cbId = api.transformCallback((ev) => {
      if (!disposed) handler((ev && ev.payload !== undefined ? ev.payload : ev) as T);
    });
    api.invoke('plugin:event|listen', { event: eventName, target: { kind: 'Any' }, handler: cbId }).catch(() => {});
    return () => {
      if (disposed) return;
      disposed = true;
      api.invoke('plugin:event|unlisten', { event: eventName, handler: cbId }).catch(() => {});
    };
  },
};
