import type { EpgNowNext, EpgProgram, LiveChannel, M3uPlaylist } from '../types/models';
import { desktopApi } from './tauri';
import { guessGuideCountry, isPlaceholderGuide } from './liveSchedule';

const ADULT_RE = /\b(xxx|adult|adulto|adultos|porn|porno|erotic|erotico|18\+|\+18|onlyfans|sex|hentai|nsfw)\b/i;

function parseM3uFallback(text: string): Array<Record<string, unknown>> {
  const lines = text.split(/\r?\n/);
  const head = lines[0] || '';
  const epgMatch = /(?:x-tvg-url|url-tvg)="([^"]+)"/i.exec(head);
  const globalEpg = epgMatch ? epgMatch[1].split(',')[0].trim() : '';
  const out: Array<Record<string, unknown>> = [];
  let cur: Record<string, string> | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const attr = (k: string) => {
        const m = new RegExp(`${k}="([^"]*)"`, 'i').exec(line);
        return m ? m[1] : '';
      };
      const comma = line.lastIndexOf(',');
      cur = {
        name: comma >= 0 ? line.slice(comma + 1).trim() : '',
        logo: attr('tvg-logo'),
        group: attr('group-title') || 'General',
        tvgId: attr('tvg-id'),
        tvgName: attr('tvg-name'),
        epg: globalEpg,
      };
    } else if (!line.startsWith('#') && cur) {
      out.push({ ...cur, url: line });
      cur = null;
    }
  }
  return out;
}

type ChannelList = { channels: LiveChannel[]; epgUrls: string[] };

// In-memory caches so re-entering Live TV is instant instead of re-downloading
// and re-parsing every playlist and EPG. A manual reload passes `force`.
const CHANNELS_TTL_MS = 15 * 60_000;
const EPG_TTL_MS = 5 * 60_000;
const channelCache = new Map<string, { at: number; value: ChannelList }>();
const epgCache = new Map<string, { at: number; value: Record<string, EpgNowNext> }>();

function playlistsKey(playlists: M3uPlaylist[]): string {
  return playlists
    .filter((p) => p.enabled && p.url)
    .map((p) => `${p.id}|${p.url}|${p.allowLan ? 1 : 0}`)
    .join('||');
}

/** Cached channel list for these playlists, if still fresh (sync, for first render). */
/** "Borrar caché": drops in-memory channel lists and EPG now/next. */
export function clearLiveTvCache(): void {
  channelCache.clear();
  epgCache.clear();
  supplementCache.clear();
}

export function peekLiveChannels(playlists: M3uPlaylist[]): ChannelList | undefined {
  const hit = channelCache.get(playlistsKey(playlists));
  return hit && Date.now() - hit.at < CHANNELS_TTL_MS ? hit.value : undefined;
}

/** Cached now/next map for these EPG urls, if still fresh. */
export function peekEpgNowNext(epgUrls: string[]): Record<string, EpgNowNext> | undefined {
  const hit = epgCache.get(epgUrls.join('||'));
  return hit && Date.now() - hit.at < EPG_TTL_MS ? hit.value : undefined;
}

export async function loadLiveChannels(playlists: M3uPlaylist[], force = false): Promise<ChannelList> {
  const key = playlistsKey(playlists);
  if (!force) {
    const cached = peekLiveChannels(playlists);
    if (cached) return cached;
  }
  const value = await fetchLiveChannels(playlists);
  if (value.channels.length > 0) channelCache.set(key, { at: Date.now(), value });
  return value;
}

async function fetchLiveChannels(playlists: M3uPlaylist[]): Promise<ChannelList> {
  const enabled = playlists.filter((p) => p.enabled && p.url);
  if (enabled.length === 0) return { channels: [], epgUrls: [] };

  const epgUrls = new Set<string>();
  const batches = await Promise.all(
    enabled.map(async (pl) => {
      const res = await desktopApi.service<{
        channels?: Array<Record<string, unknown>>;
      }>('fetchM3u', { url: pl.url, allowLan: Boolean(pl.allowLan) });

      let rawChannels = res?.channels || [];
      if (rawChannels.length === 0 && !res) {
        try {
          const r = await fetch(pl.url);
          if (r.ok) rawChannels = parseM3uFallback(await r.text());
        } catch {
          // ignore network / CORS failure outside Tauri
        }
      }

      return rawChannels
        .map((c, idx): LiveChannel | null => {
          const url = String(c.streamUrl || c.url || '').trim();
          const name = String(c.name || '').trim();
          const group = String(c.group || 'General').trim() || 'General';
          if (!url || !name) return null;
          if (ADULT_RE.test(group) || ADULT_RE.test(name)) return null;
          const epgUrl = String(c.epg || c.epgUrl || '').trim();
          if (epgUrl) epgUrls.add(epgUrl);
          return {
            id: `${pl.id}_${idx}`,
            name,
            url,
            logo: String(c.logo || ''),
            group,
            tvgId: String(c.tvgId || ''),
            tvgName: String(c.tvgName || ''),
            epgUrl,
            userAgent: String(c.userAgent || ''),
            referrer: String(c.referrer || ''),
            playlistId: pl.id,
            allowLan: Boolean(pl.allowLan),
          };
        })
        .filter((x): x is LiveChannel => x !== null);
    }),
  );

  const seen = new Set<string>();
  const channels = batches.flat().filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });

  return { channels, epgUrls: Array.from(epgUrls) };
}

function parseProgram(raw: Record<string, unknown> | undefined): EpgProgram | undefined {
  if (!raw) return undefined;
  const title = String(raw.t || raw.title || '').trim();
  if (!title) return undefined;
  return {
    title,
    description: String(raw.d || raw.desc || raw.description || ''),
    startMs: Number(raw.s || raw.start || 0),
    endMs: Number(raw.e || raw.stop || raw.end || 0),
  };
}

export async function loadEpgNowNext(
  epgUrls: string[],
  channels: LiveChannel[],
  force = false,
): Promise<Record<string, EpgNowNext>> {
  if (epgUrls.length === 0 || channels.length === 0) return {};
  if (!force) {
    const cached = peekEpgNowNext(epgUrls);
    if (cached) return cached;
  }
  const value = await fetchEpgNowNext(epgUrls, channels);
  if (Object.keys(value).length > 0) epgCache.set(epgUrls.join('||'), { at: Date.now(), value });
  return value;
}

async function fetchEpgNowNext(epgUrls: string[], channels: LiveChannel[]): Promise<Record<string, EpgNowNext>> {

  const out: Record<string, EpgNowNext> = {};
  const now = Date.now();

  await Promise.all(
    epgUrls.slice(0, 4).map(async (epgUrl) => {
      const ids = Array.from(
        new Set(
          channels
            .filter((c) => !c.epgUrl || c.epgUrl === epgUrl)
            .map((c) => c.tvgId || c.tvgName)
            .filter(Boolean),
        ),
      ).slice(0, 240);
      if (ids.length === 0) return;

      const res = await desktopApi.service<{
        programmes?: Record<string, Array<Record<string, unknown>>>;
      }>('epg', {
        url: epgUrl,
        ids,
        allowLan: channels.some((c) => c.epgUrl === epgUrl && c.allowLan),
      });

      for (const [key, list] of Object.entries(res?.programmes || {})) {
        if (!Array.isArray(list) || list.length === 0) continue;
        const parsed = list.map((p) => parseProgram(p)).filter((x): x is EpgProgram => x !== undefined);
        const current = parsed.find((p) => p.startMs <= now && p.endMs > now);
        const upcoming = parsed.find((p) => p.startMs > (current ? current.startMs : now));
        if (current || upcoming) {
          out[key.toLowerCase()] = { now: current, next: upcoming };
        }
      }
    }),
  );

  return out;
}

async function loadOwnSchedule(channel: LiveChannel): Promise<EpgProgram[]> {
  if (!channel.epgUrl) return [];
  const id = channel.tvgId || channel.tvgName || channel.name;
  if (!id) return [];
  const res = await desktopApi.service<{
    programmes?: Array<Record<string, unknown>>;
  }>('epgSchedule', { url: channel.epgUrl, id, allowLan: Boolean(channel.allowLan) });
  return (res?.programmes || [])
    .map((x) => parseProgram(x))
    .filter((x): x is EpgProgram => x !== undefined);
}

/** 12 h schedule of a channel; a missing or placeholder guide is replaced by the supplementary one. */
export async function loadChannelSchedule12h(channel: LiveChannel): Promise<EpgProgram[]> {
  const own = await loadOwnSchedule(channel).catch(() => [] as EpgProgram[]);
  if (own.length > 0 && !isPlaceholderGuide(channelNames(channel), own)) return own;
  const extra = await loadEpgSupplement(channel);
  return extra.length > 0 ? extra : own;
}

// Supplementary guide (core `epgSupplement`, public epgshare01 guides), cached per channel.
const SUPPLEMENT_TTL_MS = 30 * 60_000;
const SUPPLEMENT_NOW_NEXT_MAX = 24;
const supplementCache = new Map<string, { at: number; value: Promise<EpgProgram[]> }>();

function channelNames(channel: LiveChannel): string[] {
  return [channel.name, channel.tvgName].filter(Boolean);
}

/** Key of a channel in the now/next map (tvg-id, tvg-name, or its url when it has neither). */
export function epgKeyOf(channel: LiveChannel): string {
  return (channel.tvgId || channel.tvgName || `url:${channel.url}`).toLowerCase();
}

/** Programmes of `channel` in the supplementary guide (empty when no confident match). */
export function loadEpgSupplement(channel: LiveChannel): Promise<EpgProgram[]> {
  const country = guessGuideCountry(channel);
  const key = `${country}|${channel.name}`;
  const hit = supplementCache.get(key);
  if (hit && Date.now() - hit.at < SUPPLEMENT_TTL_MS) {
    return hit.value.then((list) => list.filter((p) => p.endMs > Date.now()));
  }
  const value = desktopApi
    .service<{ programmes?: Array<Record<string, unknown>> }>('epgSupplement', { name: channel.name, country })
    .then((res) =>
      (res?.programmes || []).map((x) => parseProgram(x)).filter((x): x is EpgProgram => x !== undefined),
    )
    .catch(() => [] as EpgProgram[]);
  supplementCache.set(key, { at: Date.now(), value });
  return value;
}

function nowNextOf(list: EpgProgram[], now: number): EpgNowNext | undefined {
  const current = list.find((p) => p.startMs <= now && p.endMs > now);
  const upcoming = list.find((p) => p.startMs > (current ? current.startMs : now));
  return current || upcoming ? { now: current, next: upcoming } : undefined;
}

/** Now/next built from a schedule (for a channel whose own guide was replaced). */
export function nowNextFromSchedule(list: EpgProgram[]): EpgNowNext | undefined {
  return nowNextOf(list, Date.now());
}

/**
 * Now/next from the supplementary guide for the channels whose own guide is placeholder-only
 * ("Azteca UNO -1" every hour). Returns only the entries to patch into the now/next map.
 */
export async function loadSupplementNowNext(
  channels: LiveChannel[],
  epgMap: Record<string, EpgNowNext>,
): Promise<Record<string, EpgNowNext>> {
  const seen = new Set<string>();
  const targets = channels.filter((c) => {
    const key = epgKeyOf(c);
    const own = epgMap[key];
    if (!own || seen.has(key)) return false;
    if (!isPlaceholderGuide(channelNames(c), [own.now, own.next])) return false;
    seen.add(key);
    return true;
  }).slice(0, SUPPLEMENT_NOW_NEXT_MAX);

  const out: Record<string, EpgNowNext> = {};
  // A few at a time: the core downloads each country's guide once and answers the rest from memory.
  for (let i = 0; i < targets.length; i += 4) {
    await Promise.all(
      targets.slice(i, i + 4).map(async (c) => {
        const pair = nowNextOf(await loadEpgSupplement(c), Date.now());
        if (pair) out[epgKeyOf(c)] = pair;
      }),
    );
  }
  return out;
}

export async function resolveLiveStream(channel: LiveChannel, forceProxy = false): Promise<string> {
  const needsProxy = forceProxy || Boolean(channel.userAgent || channel.referrer);
  if (!needsProxy) return channel.url;
  const headers: Record<string, string> = {};
  if (channel.userAgent) headers['User-Agent'] = channel.userAgent;
  if (channel.referrer) headers['Referer'] = channel.referrer;

  const res = await desktopApi.service<{ url?: string; proxyPath?: string }>('resolveExternal', {
    url: channel.url,
    headers,
    forceProxy: true,
    allowLan: false,
  });
  return res?.proxyPath || res?.url || channel.url;
}
