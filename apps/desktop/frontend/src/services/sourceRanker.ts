import type { SourcePrefs, StreamSource } from '../types/models';
import { autoTargetQuality, detectPlaybackEnv, type PlaybackEnv } from './deviceProfile';

export const LANG_LABELS: Record<string, string> = {
  latino: 'Latino',
  castellano: 'Castellano',
  es: 'Español',
  en: 'Inglés',
  pt: 'Portugués',
  fr: 'Francés',
  it: 'Italiano',
  de: 'Alemán',
  ru: 'Ruso',
  ja: 'Japonés',
  ko: 'Coreano',
  multi: 'Multi',
};

const FLAG_LANGS: Array<[string, string]> = [
  ['🇲🇽', 'latino'], ['🇦🇷', 'latino'], ['🇨🇴', 'latino'], ['🇨🇱', 'latino'], ['🇵🇪', 'latino'], ['🇻🇪', 'latino'],
  ['🇪🇸', 'castellano'], ['🇬🇧', 'en'], ['🇺🇸', 'en'], ['🇵🇹', 'pt'], ['🇧🇷', 'pt'],
  ['🇫🇷', 'fr'], ['🇮🇹', 'it'], ['🇩🇪', 'de'], ['🇷🇺', 'ru'], ['🇯🇵', 'ja'], ['🇰🇷', 'ko'],
  ['🌎', 'multi'], ['🌐', 'multi'], ['🌍', 'multi'],
];

const SUBS_ES_RE = /\b(vose|v\.o\.s\.e|subtitulad[oa]s?|subs?[\s._-]*(esp|spa|español|espanol|latino|lat|es))\b/gi;
const LATINO_RE = /\b(latino|latina|latam|lat|latinoamerican[oa]|espa[ñn]ol[\s._-]*latino|dual[\s._-]*lat(ino)?)\b/i;
const CASTELLANO_RE = /\b(castellano|castilian|es[-_]es|espa[ñn]ol[\s._-]*(de[\s._-]*)?espa[ñn]a)\b/i;
const SPANISH_RE = /\b(spanish|espa[ñn]ol|esp|spa)\b/i;
const ENGLISH_RE = /\b(english|eng|ingl[eé]s)\b/i;
const MULTI_RE = /\b(multi([\s._-]?(audio|lang|language|sub))?|dual([\s._-]?audio)?)\b/i;
const CAM_RE = /\b((hd)?cam(rip)?|hd-?ts|telesync|tele-?cine|hd-?tc|(dvd|bd)?scr(eener)?|pre-?dvd)\b/i;
const SEEDS_RE = /(?:(?:👤|👥)\s*|seeds?[:\s]+)(\d+)/i;
const SIZE_RE = /(?:💾\s*|\b)(\d+(?:[.,]\d+)?)\s*(TB|GB|MB)\b/i;

const healthFailures = new Map<string, number>();
const healthSuccess = new Map<string, number>();

export function recordSourceHealth(key: string, ok: boolean): void {
  if (!key) return;
  if (ok) {
    healthSuccess.set(key, (healthSuccess.get(key) ?? 0) + 1);
    healthFailures.delete(key);
  } else {
    healthFailures.set(key, (healthFailures.get(key) ?? 0) + 1);
  }
}

function parseSizeBytes(text: string): number {
  const m = SIZE_RE.exec(text);
  if (!m) return 0;
  const num = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0) return 0;
  const unit = m[2].toUpperCase();
  if (unit === 'TB') return Math.round(num * 1_099_511_627_776);
  if (unit === 'GB') return Math.round(num * 1_073_741_824);
  if (unit === 'MB') return Math.round(num * 1_048_576);
  return 0;
}

export function enrichSource(raw: Partial<StreamSource> & Pick<StreamSource, 'id' | 'addonId' | 'addonName'>): StreamSource {
  const name = raw.name || '';
  const title = raw.title || '';
  const filename = raw.filename || '';
  const combined = `${name}\n${title}\n${filename}`;
  const text = combined.replace(/[[\]()]/g, ' ');

  let hasSubsEs = false;
  const audioText = text.replace(SUBS_ES_RE, () => {
    hasSubsEs = true;
    return ' ';
  });

  const langs: string[] = [];
  const addLang = (l: string) => {
    if (!langs.includes(l)) langs.push(l);
  };
  for (const [flag, code] of FLAG_LANGS) {
    if (combined.includes(flag)) addLang(code);
  }
  if (LATINO_RE.test(audioText)) addLang('latino');
  if (CASTELLANO_RE.test(audioText)) addLang('castellano');
  if (!langs.includes('latino') && !langs.includes('castellano') && SPANISH_RE.test(audioText)) addLang('es');
  if (ENGLISH_RE.test(audioText)) addLang('en');
  if (/\b(portugu[eê]s|portuguese|dublado)\b/i.test(audioText)) addLang('pt');
  if (/\b(french|fran[cç]ais|vff|truefrench)\b/i.test(audioText)) addLang('fr');
  if (/\b(italian|ita)\b/i.test(audioText)) addLang('it');
  if (/\b(german|deutsch|ger)\b/i.test(audioText)) addLang('de');
  if (/\b(japanese|jap|jpn|japon[eé]s)\b/i.test(audioText)) addLang('ja');

  const isMulti = MULTI_RE.test(audioText) || langs.includes('multi');
  if (isMulti && !langs.includes('en')) addLang('en');
  const cleanLangs = langs.filter((l) => l !== 'multi');

  let quality: StreamSource['quality'] = raw.quality && raw.quality !== 'unknown' ? raw.quality : 'unknown';
  if (quality === 'unknown') {
    if (/\b(2160p?|4k|uhd)\b/i.test(text)) quality = '4K';
    else if (/\b(1080p?|fhd|full[\s._-]?hd)\b/i.test(text)) quality = '1080p';
    else if (/\b(720p?|hdrip)\b/i.test(text)) quality = '720p';
    else if (/\b(480p?|360p?|sd|dvdrip|xvid)\b/i.test(text)) quality = 'SD';
  }

  const seedsMatch = SEEDS_RE.exec(combined);
  const seeders = raw.seeders && raw.seeders > 0 ? raw.seeders : seedsMatch ? Number(seedsMatch[1]) : 0;
  const sizeBytes = raw.sizeBytes && raw.sizeBytes > 0 ? raw.sizeBytes : parseSizeBytes(combined);
  const provMatch = /⚙️?\s*([^\n👤💾⚙]+)/.exec(title);

  return {
    id: raw.id,
    addonId: raw.addonId,
    addonName: raw.addonName,
    name,
    title,
    url: raw.url || '',
    infoHash: raw.infoHash || '',
    fileIdx: raw.fileIdx,
    filename,
    trackers: raw.trackers || [],
    headers: raw.headers || {},
    isJsPlugin: !!raw.isJsPlugin,
    quality,
    sizeBytes,
    seeders,
    langs: cleanLangs,
    isOriginal: cleanLangs.length === 0,
    isMulti,
    hasSubsEs,
    isCam: CAM_RE.test(text) || /(^|[\s.-])TS($|[\s.-])/.test(combined.replace(/\.ts$/i, '')),
    isHevc: /\b(x\.?265|h\.?265|hevc)\b/i.test(text),
    isTenBit: /\b10[\s._-]?bits?\b/i.test(text),
    isHdr: /\b(hdr(10)?\+?|dv|dovi|dolby[\s._-]?vision)\b/i.test(text),
    isRemux: /\bremux\b/i.test(text),
    isDts: /\bdts([\s._-]?(hd|ma|x|es))*\b/i.test(text),
    isTrueHd: /\btrue[\s._-]?hd\b/i.test(text),
    isEac3: /\b(e-?ac-?3|ddp|dd\+)([\s._-]?[257]\.[01])?\b/i.test(text),
    isAtmos: /\batmos\b/i.test(text),
    isAv1: /\bav1\b/i.test(text),
    is3d: /\b(3d|h-?sbs|half-?sbs|h-?ou)\b/i.test(text),
    isMp4: /\.(mp4|m4v)\b/i.test(`${filename} ${title}`),
    provider: raw.provider || (provMatch ? provMatch[1].trim().slice(0, 40) : ''),
    score: 0,
  };
}

export function sourceHasLang(src: StreamSource, lang: string): boolean {
  if (lang === 'en') return src.langs.includes('en') || src.isOriginal;
  return src.langs.includes(lang);
}

export function languageSummary(src: StreamSource): string {
  const parts: string[] = [];
  for (const l of src.langs) {
    if (LANG_LABELS[l]) parts.push(LANG_LABELS[l]);
  }
  if (src.isMulti && parts.length < 2) parts.push('Multi');
  if (src.hasSubsEs) parts.push('Subs ES');
  return parts.join(' · ');
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  const gb = bytes / 1_073_741_824;
  if (gb >= 1) return `${gb.toFixed(2).replace('.', ',')} GB`;
  return `${Math.max(1, Math.round(bytes / 1_048_576))} MB`;
}

/** Quality points per target: the target wins, the neighbour below comes next, 4K is never an accident. */
const QUALITY_POINTS: Record<SourcePrefs['quality'] & string, Record<StreamSource['quality'], number>> = {
  '4K': { '4K': 330, '1080p': 300, '720p': 230, SD: 90, unknown: 130 },
  '1080p': { '4K': 190, '1080p': 320, '720p': 265, SD: 90, unknown: 130 },
  '720p': { '4K': 110, '1080p': 250, '720p': 320, SD: 120, unknown: 140 },
  SD: { '4K': 60, '1080p': 160, '720p': 250, SD: 320, unknown: 140 },
  auto: { '4K': 190, '1080p': 320, '720p': 265, SD: 90, unknown: 130 },
};

/** The quality the ranker aims for: the viewer's choice, or the device/network rule when "auto". */
export function effectiveTargetQuality(prefs: SourcePrefs, env?: PlaybackEnv): Exclude<SourcePrefs['quality'], 'auto'> {
  return prefs.quality === 'auto' ? autoTargetQuality(env ?? detectPlaybackEnv()) : prefs.quality;
}

export function rankSources(
  sources: Array<Partial<StreamSource> & Pick<StreamSource, 'id' | 'addonId' | 'addonName'>>,
  prefs: SourcePrefs,
  isEpisode = false,
  env?: PlaybackEnv,
): StreamSource[] {
  const target = effectiveTargetQuality(prefs, env);
  const isAuto = prefs.quality === 'auto';
  const points = QUALITY_POINTS[target];
  const enriched = sources.map(enrichSource);
  const filtered = enriched.filter((s) => {
    if (s.is3d) return false;
    if (prefs.exclude.includes(s.quality)) return false;
    if (prefs.exclude.includes('CAM') && s.isCam) return false;
    const isTorrent = Boolean(s.infoHash && !s.url);
    if (isTorrent && prefs.minSeeds > 0 && s.seeders < prefs.minSeeds) return false;
    const maxGb = isEpisode ? prefs.maxEpisodeGb : prefs.maxMovieGb;
    if (maxGb > 0 && s.sizeBytes > 0 && s.sizeBytes > maxGb * 1_073_741_824) return false;
    return true;
  });

  const pool = filtered.length > 0 ? filtered : enriched;
  const scored = pool
    .map((s) => {
      let score = 0;

      // 1. Viewer preferred audio languages
      let matched = false;
      for (let i = 0; i < prefs.langs.length; i++) {
        if (sourceHasLang(s, prefs.langs[i])) {
          score += 1000 - i * 140;
          matched = true;
          break;
        }
      }
      if (!matched) {
        if ((prefs.langs.includes('latino') || prefs.langs.includes('castellano')) && s.langs.includes('es')) {
          score += 780;
        } else if (s.hasSubsEs) {
          score += 220;
        } else if (s.isOriginal) {
          score += 120;
        }
      }

      // 2. CAM penalty
      if (s.isCam) score -= 1100;

      // 3. Quality vs target (auto: 1080p on a capable PC with fast internet, else 720p).
      // A direct stream without a quality tag is usually an adaptive HLS ladder: it plays at the target.
      const isDirect = Boolean(s.url || s.isJsPlugin);
      score += s.quality === 'unknown' && isDirect ? points[target] - 40 : points[s.quality];
      // Auto never leans on formats WebView2 cannot decode natively (they need
      // the FFmpeg transcode path): HEVC, 10-bit, HDR.
      if (isAuto && (s.isHevc || s.isTenBit)) score -= 150;
      if (isAuto && s.isHdr) score -= 60;

      // 4. Direct vs Torrent seeders
      if (isDirect) {
        score += 110;
      } else if (s.seeders <= 0) {
        score -= 350;
      } else {
        score += Math.min(220, Math.log(s.seeders + 1) * 44);
      }

      // 5. WebView2 playback friendliness (MP4 / AAC / E-AC-3 great; DTS/TrueHD penalized)
      if (s.isMp4) score += 25;
      if (s.isDts) score -= 180;
      if (s.isTrueHd) score -= 180;

      // 6. Runtime health
      const hKey = s.addonId || s.provider;
      score -= (healthFailures.get(hKey) ?? 0) * 120;
      score += Math.min(60, (healthSuccess.get(hKey) ?? 0) * 15);

      return { ...s, score };
    })
    .sort((a, b) => b.score - a.score);
  return promoteDirectSources(scored, prefs);
}

/** True for HTTP/HLS sources (JS plugins or Stremio URLs); torrents are `infoHash` without `url`. */
export function isDirectSource(s: Pick<StreamSource, 'url' | 'isJsPlugin'>): boolean {
  return Boolean(s.url || s.isJsPlugin);
}

/**
 * Language tier of a source for the viewer: 0 = first preferred language, 1 = second...,
 * then generic Spanish, Spanish subtitles, original audio and anything else.
 */
export function langTier(s: StreamSource, prefs: SourcePrefs): number {
  for (let i = 0; i < prefs.langs.length; i++) {
    if (sourceHasLang(s, prefs.langs[i])) return i;
  }
  const n = prefs.langs.length;
  if ((prefs.langs.includes('latino') || prefs.langs.includes('castellano')) && s.langs.includes('es')) return n;
  if (s.hasSubsEs) return n + 1;
  if (s.isOriginal) return n + 2;
  return n + 3;
}

/** Direct sources that may jump ahead of torrents: never CAM, never formats auto avoids (HEVC / 10-bit). */
function promotableDirect(s: StreamSource, prefs: SourcePrefs): boolean {
  if (!isDirectSource(s) || s.isCam) return false;
  if (prefs.quality === 'auto' && (s.isHevc || s.isTenBit)) return false;
  return true;
}

/**
 * A direct HTTP/HLS stream starts at once (no peers, no piece cache), so it goes before
 * every non-promoted source in the same or a worse language. Language still comes first:
 * a torrent in a better language keeps its place, and everything else keeps its order.
 */
export function promoteDirectSources(scored: StreamSource[], prefs: SourcePrefs): StreamSource[] {
  const pending = scored.filter((s) => promotableDirect(s, prefs));
  if (pending.length === 0) return scored;
  const promotedIds = new Set(pending.map((s) => s.id));
  const out: StreamSource[] = [];
  for (const other of scored) {
    if (promotedIds.has(other.id)) continue;
    const tier = langTier(other, prefs);
    for (let i = 0; i < pending.length; ) {
      if (langTier(pending[i], prefs) <= tier) {
        out.push(pending[i]);
        pending.splice(i, 1);
      } else {
        i++;
      }
    }
    out.push(other);
  }
  out.push(...pending);
  return out;
}

/** Grace window for slow JS plugins once the first results are in. */
export function directWaitMs(capable: boolean): number {
  return capable ? 10_000 : 16_000;
}

export const AUTO_PICK_MAX_WAIT_MS = 70_000;

/**
 * Auto-play decision while sources are still arriving (player loading screen):
 * - everything answered -> pick now;
 * - the best one is a direct stream in the viewer's first language -> nothing will beat it;
 * - results are in but JS plugins are slow -> wait `directWaitMs`, then pick;
 * - nothing yet -> keep waiting until `maxWaitMs`.
 */
export function autoPickReady(args: {
  ranked: StreamSource[];
  allDone: boolean;
  prefs: SourcePrefs;
  msSinceFirstResult: number;
  msTotal: number;
  capable: boolean;
  maxWaitMs?: number;
}): boolean {
  if (args.allDone) return true;
  if (args.msTotal >= (args.maxWaitMs ?? AUTO_PICK_MAX_WAIT_MS)) return true;
  const top = args.ranked[0];
  if (!top) return false;
  if (isDirectSource(top) && !top.isCam && langTier(top, args.prefs) === 0) return true;
  return args.msSinceFirstResult >= directWaitMs(args.capable);
}

export function torrentRaceAlternatives(chosen: StreamSource, ranked: StreamSource[], maxAlts = 2): StreamSource[] {
  if (!chosen.infoHash || chosen.url || maxAlts <= 0) return [];
  const chosenHash = chosen.infoHash.toLowerCase();
  return ranked
    .filter((s) => Boolean(s.infoHash && !s.url))
    .filter((s) => s.infoHash.toLowerCase() !== chosenHash)
    .filter((s) => !s.isCam || chosen.isCam)
    .filter((s) => s.seeders > 0)
    .filter((s) => chosen.langs.length === 0 || s.langs.some((l) => chosen.langs.includes(l)) || (chosen.isOriginal && s.isOriginal))
    .slice(0, maxAlts);
}
