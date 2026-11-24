/**
 * Subtitle helpers for the desktop player overlay: robust byte decoding
 * (UTF-8 / UTF-16 / Windows-1252 / gzip) and SRT, WebVTT and ASS/SSA parsing.
 * Pure functions so they can be unit-tested without a DOM.
 */

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

/** Decodes raw subtitle bytes, honouring BOMs and falling back to Windows-1252 for legacy Spanish subs. */
export function decodeSubtitleBytes(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  // BOM-less UTF-16: lots of NUL bytes in odd/even positions.
  if (bytes.length >= 4) {
    const sample = Math.min(bytes.length, 400);
    let evenNul = 0;
    let oddNul = 0;
    for (let i = 0; i < sample; i++) {
      if (bytes[i] === 0) {
        if (i % 2 === 0) evenNul++;
        else oddNul++;
      }
    }
    if (oddNul > sample / 4 && evenNul === 0) return new TextDecoder('utf-16le').decode(bytes);
    if (evenNul > sample / 4 && oddNul === 0) return new TextDecoder('utf-16be').decode(bytes);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Inflates gzip payloads (some subtitle mirrors serve `.srt.gz`) using the browser's DecompressionStream. */
export async function maybeGunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!isGzip(bytes) || typeof DecompressionStream === 'undefined') return bytes;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return bytes;
  }
}

/** Parses `HH:MM:SS,mmm`, `MM:SS.mmm` or ASS `H:MM:SS.cc` timestamps into seconds (NaN when invalid). */
export function parseTimestamp(raw: string): number {
  const clean = raw.trim().replace(',', '.');
  if (!/^\d+(:\d+){0,2}(\.\d+)?$/.test(clean)) return Number.NaN;
  const parts = clean.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return Number.NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function cleanCueText(text: string): string {
  return decodeEntities(
    text
      .replace(/<[^>]+>/g, '')
      .replace(/\{\\[^}]*\}/g, '')
      .replace(/\\N/gi, '\n')
      .replace(/\\h/g, ' '),
  )
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

function parseSrtOrVtt(normalized: string): SubtitleCue[] {
  const blocks = normalized.split(/\n[ \t]*\n/);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue;
    const match = /([0-9:.,]+)\s*-->\s*([0-9:.,]+)/.exec(lines[timeIdx]);
    if (!match) continue;
    const start = parseTimestamp(match[1]);
    const end = parseTimestamp(match[2]);
    const text = cleanCueText(lines.slice(timeIdx + 1).join('\n'));
    if (text && Number.isFinite(start) && Number.isFinite(end) && end > start) {
      cues.push({ start, end, text });
    }
  }
  return cues;
}

function parseAss(normalized: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  // Default v4+ event layout; replaced by the file's own `Format:` line when present.
  let fields = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
  let inEvents = false;
  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.trim();
    if (/^\[.+\]$/.test(line)) {
      inEvents = line.toLowerCase() === '[events]';
      continue;
    }
    if (!inEvents) continue;
    const fmt = /^format\s*:(.*)$/i.exec(line);
    if (fmt) {
      fields = fmt[1].split(',').map((f) => f.trim().toLowerCase());
      continue;
    }
    const dlg = /^dialogue\s*:(.*)$/i.exec(line);
    if (!dlg) continue;
    const parts = dlg[1].split(',');
    if (parts.length < fields.length) continue;
    const textIdx = fields.indexOf('text');
    const head = parts.slice(0, fields.length - 1);
    const textRaw = parts.slice(fields.length - 1).join(',');
    const value = (name: string) => {
      const i = fields.indexOf(name);
      return i >= 0 && i !== textIdx ? (head[i] ?? '') : '';
    };
    // Skip vector drawings (`{\p1}`) which have no readable text.
    if (/\{[^}]*\\p[1-9]/.test(textRaw)) continue;
    const start = parseTimestamp(value('start'));
    const end = parseTimestamp(value('end'));
    const text = cleanCueText(textRaw);
    if (text && Number.isFinite(start) && Number.isFinite(end) && end > start) {
      cues.push({ start, end, text });
    }
  }
  return cues;
}

/** Parses SRT, WebVTT or ASS/SSA text into cues sorted by start time. */
export function parseSubtitles(raw: string): SubtitleCue[] {
  const normalized = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const isAss = /^\s*\[script info\]/i.test(normalized) || /^\s*dialogue\s*:/im.test(normalized);
  const cues = isAss ? parseAss(normalized) : parseSrtOrVtt(normalized);
  return cues.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Returns the text of every cue active at `t` (overlapping cues are stacked). */
export function cueTextAt(cues: SubtitleCue[], t: number): string {
  if (cues.length === 0 || !Number.isFinite(t)) return '';
  // Binary search the last cue starting at or before t, then walk back over overlaps.
  let lo = 0;
  let hi = cues.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const hits: string[] = [];
  for (let i = idx; i >= 0 && i > idx - 12; i--) {
    const c = cues[i];
    if (t >= c.start && t <= c.end) hits.unshift(c.text);
  }
  return Array.from(new Set(hits)).join('\n');
}

/** True when an ISO 639-1/639-2 code (or plugin label) matches the user's preferred language. */
export function subLangMatches(lang: string, want: 'es' | 'pt' | 'en'): boolean {
  const l = (lang || '').toLowerCase();
  if (want === 'es') return l === 'es' || l.startsWith('es-') || l.startsWith('spa') || l === 'lat' || l.startsWith('españ');
  if (want === 'pt') return l === 'pt' || l.startsWith('pt-') || l.startsWith('por') || l === 'pob' || l === 'pb';
  return l === 'en' || l.startsWith('en-') || l.startsWith('eng');
}

/** Picks the subtitle to auto-enable: preferred language first, then English, otherwise none. */
export function pickAutoSubtitle<T extends { lang: string }>(subs: T[], want: 'es' | 'pt' | 'en'): T | undefined {
  return subs.find((s) => subLangMatches(s.lang, want)) || (want !== 'en' ? subs.find((s) => subLangMatches(s.lang, 'en')) : undefined);
}
