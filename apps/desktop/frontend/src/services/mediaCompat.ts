import type { StreamSource } from '../types/models';

export interface ProbedAudioTrack {
  index: number;
  codec: string;
  lang: string;
  title: string;
  channels: string;
  label: string;
}

export interface ProbedSubtitleTrack {
  index: number;
  codec: string;
  lang: string;
  title: string;
  label: string;
  textBased: boolean;
}

export interface MediaProbeResponse {
  returnValue?: boolean;
  available?: boolean;
  durationSec?: number;
  container?: string;
  videoCodec?: string;
  videoPixFmt?: string;
  tenBit?: boolean;
  audioTracks?: ProbedAudioTrack[];
  subtitleTracks?: ProbedSubtitleTrack[];
  recommendation?: 'native' | 'videoCopy' | 'transcode';
  hwEncoder?: string;
}

/**
 * Fast heuristic that detects formats WebView2 `<video>` is known to reject or play silently
 * (AVI/FLV/WMV/M2TS, 10-bit HEVC, or MKV with DTS/TrueHD/E-AC3) so playback can jump straight
 * into the Rust FFmpeg remux/transcode pipeline without waiting for a failed decode attempt.
 */
export function proactiveCompatHint(
  source: StreamSource | null,
  url: string,
): 'copy' | 'transcode' | null {
  const path = `${url} ${source?.filename || ''}`.toLowerCase();
  if (/\.(m3u8)(\?|$)/i.test(url) || url.includes('/hls/')) return null;
  if (/\.(avi|flv|wmv|m2ts|mts|vob|mpg|mpeg|divx|rmvb)\b/.test(path)) {
    return 'transcode';
  }
  if (source?.isTenBit) {
    return 'transcode';
  }
  if (source && (source.isDts || source.isTrueHd || source.isEac3 || source.isAtmos)) {
    return source.isHevc ? 'transcode' : 'copy';
  }
  if (source?.isHevc && /\.mkv\b/.test(path)) {
    return 'transcode';
  }
  return null;
}

/**
 * Picks the best embedded audio track index matching the user's preferred language (`es` | `pt` | `en`).
 */
export function pickPreferredAudioIndex(
  tracks: ProbedAudioTrack[],
  preferred: 'es' | 'pt' | 'en',
): number {
  if (tracks.length <= 1) return 0;
  const score = (t: ProbedAudioTrack): number => {
    const hay = `${t.lang} ${t.title} ${t.label}`.toLowerCase();
    if (preferred === 'es') {
      if (/\b(latino|es-la|es-mx|lat|mexico|méxico)\b/.test(hay)) return 100;
      if (/\b(spa|es|español|espanol|castellano|es-es)\b/.test(hay)) return 85;
      return 0;
    }
    if (preferred === 'pt') {
      if (/\b(pt-br|brasil|brazil|por|pt|portugu)/.test(hay)) return 90;
      return 0;
    }
    if (/\b(eng|en|english|ingl)/.test(hay)) return 90;
    return 0;
  };
  let bestIdx = 0;
  let bestScore = -1;
  tracks.forEach((t, idx) => {
    const s = score(t);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = idx;
    }
  });
  return bestScore > 0 ? bestIdx : 0;
}

export function buildCompatStreamUrl(
  baseUrl: string,
  startSec: number,
  audioIdx: number,
  mode: 'copy' | 'transcode',
): string {
  const cleanBase = baseUrl.split('?')[0];
  const s = Math.max(0, Math.floor(startSec * 10) / 10);
  return `${cleanBase}?start=${s}&audio=${audioIdx}&mode=${mode}`;
}

/** True for HLS playlists: `.m3u8` URLs, proxied `/hls/` children, or URLs the Rust resolver sniffed as HLS. */
export function isHlsUrl(url: string, knownHls?: ReadonlySet<string>): boolean {
  if (!url) return false;
  if (knownHls?.has(url)) return true;
  return /\.m3u8(\?|#|$)/i.test(url) || url.includes('/hls/');
}

/**
 * Spanish message shown when every automatic fallback failed, instead of a black screen.
 * `mediaErrorCode` follows `MediaError.code` (2 network, 3 decode, 4 unsupported).
 */
export function playbackFailureMessage(mediaErrorCode: number | null, compatAvailable: boolean): string {
  if (mediaErrorCode === 3 || mediaErrorCode === 4) {
    return compatAvailable
      ? 'Este video usa un formato que no se pudo convertir para reproducirlo. Prueba otra fuente desde Fuentes.'
      : 'Este video usa un formato que el reproductor no admite y el motor de compatibilidad (FFmpeg) no está disponible. Prueba otra fuente desde Fuentes.';
  }
  if (mediaErrorCode === 2) {
    return 'Se perdió la conexión con esta fuente. Prueba otra desde Fuentes.';
  }
  return 'No se pudo reproducir esta fuente. Prueba eligiendo otra desde Fuentes.';
}

/** HTTP statuses that mean the source server refused us (expired link, rate limit, removed file). */
export function isRefusalStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 404 || status === 410 || status === 429 || status >= 500;
}

/** Hostname of a stream URL ('' for torrents / invalid URLs). */
export function streamHost(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Next source to try after a failure. Skips sources already tried and prefers a different
 * server than the ones that failed (free file hosts rate-limit every link at once), falling
 * back to the next untried one. Returns -1 when the budget is spent or nothing is left.
 */
export function pickNextSourceIndex(
  ranked: ReadonlyArray<{ id: string; url?: string }>,
  triedIds: ReadonlySet<string>,
  failedHosts: ReadonlySet<string>,
  maxAttempts = 8,
): number {
  if (triedIds.size >= maxAttempts) return -1;
  let firstUntried = -1;
  for (let i = 0; i < ranked.length; i++) {
    const s = ranked[i];
    if (triedIds.has(s.id)) continue;
    if (firstUntried < 0) firstUntried = i;
    const host = streamHost(s.url);
    if (!host || !failedHosts.has(host)) return i;
  }
  return firstUntried;
}

/** Spanish message when every tried source was refused by its server (not a format problem). */
export const SOURCES_REFUSED_MESSAGE =
  'Los servidores de estas fuentes rechazaron la conexión (enlace caducado o límite de descargas). Prueba otra fuente desde Fuentes o vuelve a intentarlo más tarde.';
