import { isLiteMode } from './liteMode';
/**
 * Cheap hardware + network profile used to pick the automatic target quality.
 * Owner rule: a capable PC on a fast connection prefers Full HD (1080p);
 * anything else prefers HD (720p). 4K is only chosen when the viewer asks.
 */

export type AutoQuality = '1080p' | '720p';

export interface PlaybackEnv {
  /** `navigator.deviceMemory` (GB, Chromium caps it at 8); 0 = unknown. */
  memoryGb: number;
  /** Logical cores; 0 = unknown. */
  cores: number;
  /** Smoothed throughput measured by the app itself (Mbit/s); 0 = no sample yet. */
  measuredMbps: number;
  /** Network Information API `downlink` (Mbit/s, saturates at 10); 0 = unknown. */
  apiMbps: number;
  /** Data saver or a 2g/3g effective type. */
  constrained: boolean;
}

const STORAGE_KEY = 'opentv.netMbps';
/** Comfortable headroom for a 1080p HLS ladder (≈ 5 Mbit/s top variant). */
export const FULL_HD_MIN_MBPS = 12;
/** The Network Information API never reports more than this. */
const API_DOWNLINK_CAP = 10;
const MIN_SAMPLE_BYTES = 256 * 1024;

let measuredMbps = 0;
let loaded = false;

function loadMeasured(): number {
  if (!loaded) {
    loaded = true;
    try {
      const raw = Number(localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(raw) && raw > 0) measuredMbps = raw;
    } catch {
      /* private mode / storage blocked */
    }
  }
  return measuredMbps;
}

function addSample(mbps: number): void {
  if (!Number.isFinite(mbps) || mbps <= 0 || mbps > 10_000) return;
  const prev = loadMeasured();
  measuredMbps = prev > 0 ? prev * 0.7 + mbps * 0.3 : mbps;
  try {
    localStorage.setItem(STORAGE_KEY, measuredMbps.toFixed(2));
  } catch {
    /* ignore */
  }
}

/**
 * One download sample (bytes over wall time), e.g. a plugin page or a video
 * segment. Small transfers are dominated by latency and ignored. Smoothed
 * (EWMA) and cached across runs.
 */
export function recordThroughput(bytes: number, ms: number): void {
  if (!(bytes >= MIN_SAMPLE_BYTES) || !(ms > 0)) return;
  addSample((bytes * 8) / (ms * 1000));
}

/** A player bandwidth estimate in bit/s (e.g. hls.js `bandwidthEstimate`). */
export function recordBandwidthEstimate(bitsPerSecond: number): void {
  if (bitsPerSecond > 0) addSample(bitsPerSecond / 1_000_000);
}

interface NavigatorLike {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  connection?: { downlink?: number; effectiveType?: string; saveData?: boolean };
}

export function detectPlaybackEnv(
  nav: NavigatorLike | undefined = typeof navigator !== 'undefined' ? (navigator as NavigatorLike) : undefined,
): PlaybackEnv {
  const conn = nav?.connection;
  return {
    memoryGb: Number(nav?.deviceMemory) || 0,
    cores: Number(nav?.hardwareConcurrency) || 0,
    measuredMbps: loadMeasured(),
    apiMbps: Number(conn?.downlink) || 0,
    constrained:
      isLiteMode() || Boolean(conn?.saveData) || /(^|-)(2g|3g)$/.test(String(conn?.effectiveType || '')),
  };
}

/** Owner rule: good PC + good internet -> 1080p, otherwise 720p. */
export function autoTargetQuality(env: PlaybackEnv): AutoQuality {
  if (env.constrained) return '720p';
  const weakHardware = (env.memoryGb > 0 && env.memoryGb < 4) || (env.cores > 0 && env.cores < 4);
  if (weakHardware) return '720p';
  // A real measurement wins; the API value only counts as "slow" below its cap.
  if (env.measuredMbps > 0) return env.measuredMbps >= FULL_HD_MIN_MBPS ? '1080p' : '720p';
  if (env.apiMbps > 0 && env.apiMbps < API_DOWNLINK_CAP) return '720p';
  return '1080p';
}

/** A PC that is neither low on RAM/cores nor on a constrained network. */
export function isCapablePc(env: PlaybackEnv = detectPlaybackEnv()): boolean {
  if (env.constrained) return false;
  return !((env.memoryGb > 0 && env.memoryGb < 4) || (env.cores > 0 && env.cores < 4));
}

/** Test hook: forget the cached measurement. */
export function resetMeasuredThroughput(): void {
  measuredMbps = 0;
  loaded = true;
}
