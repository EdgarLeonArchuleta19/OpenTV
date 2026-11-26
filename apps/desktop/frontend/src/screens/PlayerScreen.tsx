import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  ArrowLeft,
  AudioLines,
  Captions,
  FileUp,
  ListVideo,
  Maximize2,
  Minimize2,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Search,
  Shuffle,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type {
  Episode,
  ExternalSubtitle,
  InstalledPlugin,
  MediaItem,
  PlaybackPrefs,
  SourcePrefs,
  StreamSource,
  SubtitleStylePrefs,
} from '../types/models';
import { fetchExternalSubtitles } from '../services/stremio';
import { rankSources, recordSourceHealth, runtimeMinutesOf, torrentRaceAlternatives } from '../services/sourceRanker';
import { describeSearch, getSourceSearch, peekSourceSearch } from '../services/sourceSearch';
import {
  buildCompatStreamUrl,
  pickPreferredAudioIndex,
  proactiveCompatHint,
  type MediaProbeResponse,
  type ProbedAudioTrack,
  type ProbedSubtitleTrack,
  isHlsUrl,
  isRefusalStatus,
  pickNextSourceIndex,
  pickSameLanguageSourceIndex,
  playbackFailureMessage,
  SOURCES_REFUSED_MESSAGE,
  streamHost,
} from '../services/mediaCompat';
import { desktopApi, resizedImageUrl } from '../services/tauri';
import { isCapablePc, recordBandwidthEstimate } from '../services/deviceProfile';
import {
  cueTextAt,
  decodeSubtitleBytes,
  maybeGunzip,
  orderSubtitles,
  parseSubtitles,
  pickAutoSubtitle,
  type SubtitleCue,
} from '../services/subtitles';
import { SourcePickerModal } from '../components/CommonComponents';
import { pushNotice, type PlayerNotice } from '../services/playerNotice';
import {
  autoNextCountdown,
  creditsStartSec,
  endPhaseAt,
  endScreenActions,
  episodeLabel,
  fetchSkipData,
  loadFollowingEpisodes,
  type MediaChapter,
  mergeEpisodes,
  mergeSkipData,
  nextEpisodeAfter,
  runtimeMismatch,
  segmentsFromChapters,
  type SkipData,
  skipPromptAt,
} from '../services/episodeFlow';

export interface PlayerSession {
  item: MediaItem;
  episode: Episode | null;
  allEpisodes: Episode[];
  /** `null` (and no `offlineUrl`) = search sources and auto-pick inside the player. */
  chosen: StreamSource | null;
  ranked: StreamSource[];
  offlineUrl?: string;
  initialSubtitles?: ExternalSubtitle[];
  startPositionMs?: number;
}

interface PlayerScreenProps {
  session: PlayerSession;
  plugins: InstalledPlugin[];
  sourcePrefs: SourcePrefs;
  playbackPrefs: PlaybackPrefs;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onSaveProgress: (posMs: number, durMs: number) => void;
  onUpdateSubtitleStyle: (fn: (cur: SubtitleStylePrefs) => SubtitleStylePrefs) => void;
  onSwitchSession: (next: PlayerSession) => void;
  onExit: () => void;
  /** App-level info to show inside the player (pin, file drop, local subtitles). */
  externalNotice?: { id: number; text: string } | null;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const SPEEDS = [0.75, 1, 1.25, 1.5];

/**
 * Exact 1:1 replica of OpenTV v1 Netflix-style VOD Player (`07-inicio-hero-perfiles.css:191-301`
 * + `08-en-vivo-reproductor.css:321-370` + `06-ventana-arranque.css:151-219`):
 * - Top-left circular `( < )` + bold Title + resolution/peers pill
 * - Bottom thin seek bar expanding on hover with floating hover timestamp bubble (`vod-seek-hover`)
 * - 3-group bottom bar: Volume (left) | -10s · White Play/Pause · +10s (center) | Speed, Subs, Episodes, Sources, PiP, Fullscreen (right)
 * - Right slide-in Episodes panel with season pills & numbered episode cards (`● Viendo` badge).
 */
export const PlayerScreen: React.FC<PlayerScreenProps> = ({
  session,
  plugins,
  sourcePrefs,
  playbackPrefs,
  isFullscreen,
  onToggleFullscreen,
  onSaveProgress,
  onUpdateSubtitleStyle,
  onSwitchSession,
  onExit,
  externalNotice,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triedProxyRef = useRef<boolean>(false);
  const triedCompatRef = useRef<'none' | 'copy' | 'transcode'>('none');
  const sourceIndexRef = useRef<number>(0);
  // Fallback bookkeeping: sources already tried, servers that refused us, and whether the
  // last failure was a refusal (so the final message doesn't blame the video format).
  const triedSourceIdsRef = useRef<Set<string>>(new Set());
  const failedHostsRef = useRef<Set<string>>(new Set());
  const lastFailureRefusedRef = useRef<boolean>(false);
  // Wrong-content guard: sources whose duration was already checked against the TMDB runtime,
  // and whether the current swap came from it (neutral "Buscando otra fuente…" status).
  const runtimeCheckedIdsRef = useRef<Set<string>>(new Set());
  const searchingOtherRef = useRef<boolean>(false);
  const compatOffsetRef = useRef<number>(0);
  const compatBaseUrlRef = useRef<string>('');
  const compatModeRef = useRef<'copy' | 'transcode'>('copy');
  const compatAudioRef = useRef<number>(0);
  const rawStreamUrlRef = useRef<string>('');
  // Playlists the Rust resolver identified as HLS even without a `.m3u8` extension.
  const knownHlsRef = useRef<Set<string>>(new Set());
  // Last `MediaError.code` seen and whether FFmpeg compat refused to start, for a clear final error.
  const mediaErrorCodeRef = useRef<number | null>(null);
  const compatUnavailableRef = useRef<boolean>(false);
  // Kept in a ref so the save effect never churns when the parent re-renders.
  const onSaveProgressRef = useRef(onSaveProgress);
  onSaveProgressRef.current = onSaveProgress;

  const [activeSource, setActiveSource] = useState<StreamSource | null>(session.chosen);
  const [rankedSources, setRankedSources] = useState<StreamSource[]>(session.ranked);
  const [resolvedUrl, setResolvedUrl] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<string>(
    session.offlineUrl
      ? 'Abriendo descarga local…'
      : session.chosen
        ? 'Cargando…'
        : 'Buscando la mejor fuente…',
  );
  /** True while the in-player search has not picked a source yet. */
  const awaitingPickRef = useRef<boolean>(!session.chosen && !session.offlineUrl);
  /** Plugins still answering (the source picker shows its loading state meanwhile). */
  const [searchPending, setSearchPending] = useState<boolean>(false);
  /** First frame shown: until then the player shows the loading screen (Esc cancels). */
  const [started, setStarted] = useState<boolean>(false);
  const startedRef = useRef<boolean>(false);
  startedRef.current = started;
  const unmountedRef = useRef<boolean>(false);
  const sourcePrefsRef = useRef(sourcePrefs);
  sourcePrefsRef.current = sourcePrefs;
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [_torrentBadge, setTorrentBadge] = useState<string>('');
  const [_compatBadge, setCompatBadge] = useState<string>('');
  const [compatActive, setCompatActive] = useState<boolean>(false);
  const [probedDuration, setProbedDuration] = useState<number>(0);
  const [audioTracks, setAudioTracks] = useState<ProbedAudioTrack[]>([]);
  const [activeAudioIdx, setActiveAudioIdx] = useState<number>(0);
  const activeAudioIdxRef = useRef<number>(0);
  activeAudioIdxRef.current = activeAudioIdx;
  const [embeddedSubs, setEmbeddedSubs] = useState<ExternalSubtitle[]>([]);
  const [audioOpen, setAudioOpen] = useState<boolean>(false);

  const [playing, setPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [bufferedEnd, setBufferedEnd] = useState<number>(0);
  const [hoverSeek, setHoverSeek] = useState<{ pct: number; sec: number } | null>(null);

  const [volume, setVolume] = useState<number>(1);
  const [muted, setMuted] = useState<boolean>(false);
  const systemVolRef = useRef(false);
  const [speed, setSpeed] = useState<number>(1);
  const [hudVisible, setHudVisible] = useState<boolean>(true);
  // In-player notice (replaces the app's global toast while the player is open).
  const [notice, setNotice] = useState<PlayerNotice | null>(null);
  const notify = useCallback((msg: string) => {
    setNotice((prev) => pushNotice(prev, msg, Date.now()));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice((cur) => (cur && cur.id === notice.id && cur.until <= Date.now() + 50 ? null : cur)), Math.max(0, notice.until - Date.now()));
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (externalNotice?.text) notify(externalNotice.text);
  }, [externalNotice, notify]);

  const [subsOpen, setSubsOpen] = useState<boolean>(false);
  const [episodesOpen, setEpisodesOpen] = useState<boolean>(false);
  const [epSeasonFilter, setEpSeasonFilter] = useState<number>(session.episode?.season || 1);
  const [sourcesOpen, setSourcesOpen] = useState<boolean>(false);

  const [extSubs, setExtSubs] = useState<ExternalSubtitle[]>([]);
  const [activeSubId, setActiveSubId] = useState<string>('off');
  const activeSubIdRef = useRef<string>('off');
  const playbackPrefsRef = useRef(playbackPrefs);
  playbackPrefsRef.current = playbackPrefs;
  const [subCues, setSubCues] = useState<SubtitleCue[]>([]);
  // Parsed cues per subtitle id, so re-selecting (or a local file with no URL) never re-downloads.
  const subCueCacheRef = useRef<Map<string, SubtitleCue[]>>(new Map());
  const [loadingSub, setLoadingSub] = useState<boolean>(false);

  const [nextCountdown, setNextCountdown] = useState<number | null>(null);
  /** Seconds the current auto-next countdown started from (fills the button). */
  const nextCountdownStartRef = useRef(1);
  /** "Seguir viendo" on the next-episode card: no card, no auto-next for this episode. */
  const [nextDismissed, setNextDismissed] = useState<boolean>(false);
  // Next episode whose source search was already started in the last 35 s (no torrent is started until played).
  const preloadingNextRef = useRef<string>('');
  /** Segments already skipped (or auto-skipped) in this episode: 'intro' / 'recap'. */
  const [skippedKinds, setSkippedKinds] = useState<string[]>([]);
  // Real intro/credits data: container chapters (probe) and the core's online lookup.
  const [chapters, setChapters] = useState<MediaChapter[]>([]);
  const [remoteSkip, setRemoteSkip] = useState<SkipData | null>(null);
  const skipLookupRef = useRef<string>('');
  // Episodes of the current/next season loaded here when the session's list ends (lazy seasons).
  const [extraEpisodes, setExtraEpisodes] = useState<Episode[]>([]);
  /** `ended` event of the <video>; cleared on play/seek. */
  const [endedEvent, setEndedEvent] = useState<boolean>(false);
  const endButtonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const [subQuery, setSubQuery] = useState<string>('');
  const [subSearching, setSubSearching] = useState<boolean>(false);
  const subFileInputRef = useRef<HTMLInputElement>(null);

  const { item, episode, offlineUrl } = session;
  const allEpisodes = useMemo(() => mergeEpisodes(session.allEpisodes, extraEpisodes), [extraEpisodes, session.allEpisodes]);

  const seasons = useMemo(
    () => Array.from(new Set(allEpisodes.map((e) => e.season))).sort((a, b) => a - b),
    [allEpisodes],
  );

  // By (season, number), so it also crosses into a lazily loaded next season.
  const nextEpisode = useMemo(() => nextEpisodeAfter(allEpisodes, episode), [allEpisodes, episode]);

  const titleHeading = episode ? `${item.title} · T${episode.season} E${episode.number}` : item.title;
  const loadingArt = useMemo(() => resizedImageUrl(item.backdrop || item.poster, 1280), [item.backdrop, item.poster]);

  // Windows media overlay (WebView2 feeds it from the page's media session): show the
  // title, "OpenTV" and the poster instead of an empty card. Its top line (the page
  // origin) cannot be changed from the page.
  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!ms || typeof MediaMetadata === 'undefined') return;
    const poster = /^https:\/\//i.test(item.poster || '') ? item.poster : '';
    try {
      ms.metadata = new MediaMetadata({
        title: episode ? `${episode.title || `Episodio ${episode.number}`}` : item.title,
        artist: episode ? `${item.title} · T${episode.season} E${episode.number} · OpenTV` : 'OpenTV',
        artwork: poster ? [{ src: poster, sizes: '500x750', type: 'image/jpeg' }] : [],
      });
    } catch {
      /* metadata is cosmetic */
    }
    return () => {
      try {
        ms.metadata = null;
      } catch {
        /* ignore */
      }
    };
  }, [item.title, item.poster, episode]);

  useEffect(() => {
    setActiveSource(session.chosen);
    setRankedSources(session.ranked);
    setEpSeasonFilter(session.episode?.season || 1);
    sourceIndexRef.current = session.chosen
      ? Math.max(0, session.ranked.findIndex((s) => s.id === session.chosen?.id))
      : 0;
    triedSourceIdsRef.current = new Set(session.chosen ? [session.chosen.id] : []);
    failedHostsRef.current = new Set();
    lastFailureRefusedRef.current = false;
    setNextDismissed(false);
    setNextCountdown(null);
    setSkippedKinds([]);
    setChapters([]);
    setRemoteSkip(null);
    setEndedEvent(false);
    skipLookupRef.current = '';
    preloadingNextRef.current = '';
  }, [session]);

  // The player's episode list ends here (seasons load lazily in the detail): fetch the rest of
  // this season and the next one so "Siguiente episodio" also crosses a season boundary.
  useEffect(() => {
    setExtraEpisodes([]);
    const cur = session.episode;
    if (!cur || session.item.id.startsWith('local:')) return;
    if (nextEpisodeAfter(session.allEpisodes, cur)) return;
    let alive = true;
    void loadFollowingEpisodes(session.item, cur).then((eps) => {
      if (alive && eps.length > 0) setExtraEpisodes(eps);
    });
    return () => {
      alive = false;
    };
  }, [session]);

  // In-player source search: Stremio + JS plugins arrive progressively, the auto-pick waits a
  // bounded time for direct streams, and anything arriving later joins the picker/fallbacks.
  useEffect(() => {
    if (session.offlineUrl || session.item.id.startsWith('local:')) return;
    const autoPick = !session.chosen;
    // Re-armed on every run: the reset effect above puts `activeSource` back to `session.chosen`.
    awaitingPickRef.current = autoPick;
    const search = autoPick
      ? getSourceSearch(session.item, session.episode, pluginsRef.current)
      : peekSourceSearch(session.item, session.episode);
    if (!search) return;
    let alive = true;
    const isEpisode = Boolean(session.episode);
    const runtimeMin = runtimeMinutesOf(session.item, session.episode);
    const capable = isCapablePc();
    let rankedFor = -1;
    let ranked: StreamSource[] = [];
    let timer: ReturnType<typeof setInterval> | null = null;

    const evaluate = () => {
      if (!alive) return;
      const st = search.state;
      setSearchPending(!(st.stremioDone && st.jsDone));
      const count = st.raw.length;
      if (count !== rankedFor) {
        ranked = rankSources(st.raw, sourcePrefsRef.current, isEpisode, undefined, runtimeMin);
        rankedFor = count;
        // After the pick (or for a manual pick), late sources only extend the picker and fallbacks.
        if (!awaitingPickRef.current && ranked.length > 0) setRankedSources(ranked);
      }
      if (!awaitingPickRef.current) return;
      const prog = describeSearch(st, sourcePrefsRef.current, isEpisode, Date.now(), capable, ranked);
      if (!prog.ready) {
        setStatusMsg(prog.status);
        return;
      }
      awaitingPickRef.current = false;
      if (timer) clearInterval(timer);
      timer = null;
      const best = prog.ranked[0];
      if (!best) {
        const why = st.failures.slice(0, 2).map((f) => f.message).join(' · ');
        setErrorMsg(why || 'No se encontraron fuentes para este título');
        setLoading(false);
        return;
      }
      setRankedSources(prog.ranked);
      sourceIndexRef.current = 0;
      triedSourceIdsRef.current = new Set([best.id]);
      setStatusMsg('Cargando…');
      setActiveSource(best);
    };

    const unsubscribe = search.subscribe(evaluate);
    // Time-based readiness (grace window) needs a tick even when nothing new arrives.
    if (autoPick && awaitingPickRef.current) timer = setInterval(evaluate, 400);
    return () => {
      alive = false;
      unsubscribe();
      if (timer) clearInterval(timer);
    };
  }, [session]);

  // Sync player volume with OS system volume (desktop/Tauri).
  useEffect(() => {
    let alive = true;
    void desktopApi.systemVolume('get').then((r: any) => {
      if (!alive) return;
      const v = typeof r?.volume === 'number' ? r.volume : typeof r?.level === 'number' ? r.level : null;
      if (v !== null) {
        systemVolRef.current = true;
        setVolume(Math.max(0, Math.min(1, v)));
      }
      if (typeof r?.muted === 'boolean') setMuted(r.muted);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const applyVolume = useCallback((next: number, nextMuted?: boolean) => {
    const clamped = Math.max(0, Math.min(1, Number(next.toFixed(2))));
    setVolume(clamped);
    if (typeof nextMuted === 'boolean') setMuted(nextMuted);
    else if (clamped > 0) setMuted(false);
    if (systemVolRef.current) {
      void desktopApi.systemVolume('set', clamped).catch(() => {});
      if (typeof nextMuted === 'boolean') void desktopApi.systemVolume('mute', nextMuted).catch(() => {});
    } else {
      const v = videoRef.current;
      if (v) { v.volume = clamped; if (typeof nextMuted === 'boolean') v.muted = nextMuted; }
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      if (systemVolRef.current) void desktopApi.systemVolume('mute', next).catch(() => {});
      else if (videoRef.current) videoRef.current.muted = next;
      return next;
    });
  }, []);

  const wakeHud = useCallback(() => {
    setHudVisible(true);
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    hudTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setHudVisible(false);
    }, 3200);
  }, []);

  const selectSubtitle = useCallback(
    async (sub: ExternalSubtitle | null) => {
      if (!sub) {
        activeSubIdRef.current = 'off';
        setActiveSubId('off');
        setSubCues([]);
        return;
      }
      activeSubIdRef.current = sub.id;
      setActiveSubId(sub.id);
      const cached = subCueCacheRef.current.get(sub.id);
      if (cached) {
        setSubCues(cached);
        return;
      }
      setLoadingSub(true);
      try {
        const download = async (url: string): Promise<SubtitleCue[]> => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 25_000);
          try {
            const resp = await fetch(url, { signal: ctrl.signal });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const bytes = await maybeGunzip(new Uint8Array(await resp.arrayBuffer()));
            return parseSubtitles(decodeSubtitleBytes(bytes));
          } finally {
            clearTimeout(timer);
          }
        };
        const candidates = [sub.url, sub.directUrl].filter(
          (u, i, arr): u is string => Boolean(u) && arr.indexOf(u) === i,
        );
        if (candidates.length === 0) throw new Error('sin URL');
        let cues: SubtitleCue[] = [];
        let lastErr: unknown = null;
        for (const url of candidates) {
          try {
            cues = await download(url);
            lastErr = null;
            if (cues.length > 0) break;
          } catch (err) {
            lastErr = err;
          }
        }
        if (lastErr && cues.length === 0) throw lastErr;
        // Only apply if this subtitle is still the active selection.
        if (activeSubIdRef.current !== sub.id) return;
        if (cues.length > 0) subCueCacheRef.current.set(sub.id, cues);
        setSubCues(cues);
        if (cues.length === 0) notify('No se pudieron leer las líneas del subtítulo');
      } catch {
        if (activeSubIdRef.current !== sub.id) return;
        notify('No se pudo descargar el subtítulo');
        activeSubIdRef.current = 'off';
        setActiveSubId('off');
        setSubCues([]);
      } finally {
        if (activeSubIdRef.current === sub.id || activeSubIdRef.current === 'off') {
          setLoadingSub(false);
        }
      }
    },
    [notify],
  );

  // Reset subtitles only when the actual media item/episode changes.
  useEffect(() => {
    const seeded = session.initialSubtitles || [];
    activeSubIdRef.current = 'off';
    subCueCacheRef.current.clear();
    setExtSubs(seeded);
    setActiveSubId('off');
    setSubCues([]);

    if (seeded.length > 0 && playbackPrefsRef.current.subtitlesEnabled) {
      // Sibling files next to a local video are the user's own: fall back to the first one.
      const autoLocal = pickAutoSubtitle(seeded, playbackPrefsRef.current.preferredSubLang) || seeded[0];
      if (autoLocal) void selectSubtitle(autoLocal);
    }
  }, [item.id, episode?.id, session.initialSubtitles, selectSubtitle]);

  // Only re-query subtitle plugins when the set of enabled subtitle plugins really changes
  // (the plugin array identity changes on every store save, e.g. each progress tick).
  const pluginsRef = useRef(plugins);
  pluginsRef.current = plugins;
  const subPluginsKey = useMemo(
    () =>
      plugins
        .filter((p) => !p.disabled && p.hasSubtitles)
        .map((p) => p.baseUrl || p.url)
        .join('|'),
    [plugins],
  );

  // Fetch external subtitles without clobbering a subtitle the user already activated.
  // Plugin subtitles (OpenSubtitles) arrive first, SubDL (through the core) right after.
  useEffect(() => {
    if (item.id.startsWith('local:')) return;
    let alive = true;
    const added = new Set<string>();
    const apply = async (all: ExternalSubtitle[]) => {
      const subs = all.filter((s) => !added.has(s.id));
      if (!alive || subs.length === 0) return;
      subs.forEach((s) => added.add(s.id));
      // SubDL files are already served by the local core: only remote URLs go through the proxy.
      const remote = subs.filter((s) => s.origin !== 'subdl');
      const proxied =
        remote.length > 0
          ? await desktopApi
              .service<{ subtitles?: Array<{ lang: string; url: string | null } | null> }>('proxySubtitles', {
                subtitles: remote.map((s) => ({ lang: s.lang, url: s.url })),
                allowLan: false,
              })
              .catch(() => null)
          : null;
      if (!alive) return;
      const proxiedUrl = new Map(remote.map((s, idx) => [s.id, proxied?.subtitles?.[idx]?.url || s.url]));
      const mapped: ExternalSubtitle[] = subs.map((s) => ({
        ...s,
        url: proxiedUrl.get(s.id) || s.url,
        directUrl: s.url,
      }));
      setExtSubs((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...mapped.filter((x) => !seen.has(x.id))];
      });

      // Auto-select only when the user has no active subtitle selection.
      if (activeSubIdRef.current === 'off' && playbackPrefsRef.current.subtitlesEnabled) {
        const seeded = session.initialSubtitles || [];
        if (seeded.length === 0) {
          const autoSub = pickAutoSubtitle(orderSubtitles(mapped), playbackPrefsRef.current.preferredSubLang);
          if (autoSub && alive) void selectSubtitle(autoSub);
        }
      }
    };
    // Sequential: the final list only adds what the partial one did not have.
    let chain = Promise.resolve();
    void fetchExternalSubtitles(item, episode, pluginsRef.current, (partial) => {
      chain = chain.then(() => apply(partial));
    })
      .then((subs) => {
        chain = chain.then(() => apply(subs));
        return chain;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, episode?.id, subPluginsKey, session.initialSubtitles, selectSubtitle]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      void desktopApi.service('compatStop', {});
      void desktopApi.service('abortMedia', {});
      void desktopApi.service('torrentStop', {});
    };
  }, []);

  // One FFmpeg probe per media URL: the pre-play check, the background track probe and the
  // duration probe used to spawn up to three ffmpeg processes against the same remote file.
  const probeCacheRef = useRef<Map<string, Promise<MediaProbeResponse | null>>>(new Map());
  // FFmpeg inputs on the home network need the same per-plugin LAN permission as playback.
  const allowLanRef = useRef(false);
  allowLanRef.current = Boolean(
    activeSource?.isJsPlugin && plugins.find((p) => p.id === activeSource.addonId)?.allowLan,
  );
  const probeMedia = useCallback((url: string, headers: Record<string, string>) => {
    let p = probeCacheRef.current.get(url);
    if (!p) {
      p = desktopApi.service<MediaProbeResponse>('mediaProbe', { url, headers, allowLan: allowLanRef.current }).catch(() => null);
      probeCacheRef.current.set(url, p);
      // Container chapters ("Opening", "Ending"...) give exact intro/credits for this file.
      void p.then((r) => {
        if (unmountedRef.current || url !== rawStreamUrlRef.current) return;
        setChapters(Array.isArray(r?.chapters) ? r.chapters.slice(0, 256) : []);
      });
      // A failed probe may be retried later (e.g. after a proxy fallback).
      void p.then((r) => {
        if (!r) probeCacheRef.current.delete(url);
      });
    }
    return p;
  }, []);

  const activateCompatMode = useCallback(
    async (
      rawUrl: string,
      mode: 'copy' | 'transcode',
      startSec: number,
      audioIdx: number,
      hevc = false,
      subTracks?: ProbedSubtitleTrack[],
    ): Promise<boolean> => {
      const res = await desktopApi.service<{
        returnValue?: boolean;
        token?: string;
        streamUrl?: string;
        subtitleBaseUrl?: string;
        hwEncoder?: string;
      }>('compatStart', {
        url: rawUrl,
        headers: activeSource?.headers || {},
        hevc,
        audio: audioIdx,
        mode,
        allowLan: allowLanRef.current,
      });
      // Cancelled while FFmpeg was starting: never leave it running behind the Detail screen.
      if (unmountedRef.current) {
        void desktopApi.service('compatStop', {});
        return false;
      }
      if (!res?.returnValue || !res.streamUrl) {
        compatUnavailableRef.current = true;
        return false;
      }
      const base = res.streamUrl.split('?')[0];
      compatBaseUrlRef.current = base;
      compatModeRef.current = mode;
      compatAudioRef.current = audioIdx;
      compatOffsetRef.current = Math.max(0, startSec);
      triedCompatRef.current = mode;
      setCompatActive(true);
      setActiveAudioIdx(audioIdx);
      setCompatBadge(
        mode === 'copy'
          ? 'Remux HD'
          : res.hwEncoder && res.hwEncoder !== 'libx264'
            ? `GPU ${res.hwEncoder.replace('h264_', '').toUpperCase()}`
            : 'Modo compatible',
      );
      if (res.subtitleBaseUrl && subTracks && subTracks.length > 0) {
        const textSubs: ExternalSubtitle[] = subTracks
          .filter((st) => st.textBased)
          .map((st) => ({
            id: `emb_${res.token}_${st.index}`,
            url: `${res.subtitleBaseUrl}/${st.index}.vtt`,
            lang: st.lang || 'und',
            label: st.label,
            source: 'Incrustado en el archivo',
          }));
        setEmbeddedSubs(textSubs);
      }
      setResolvedUrl(buildCompatStreamUrl(base, startSec, audioIdx, mode));
      return true;
    },
    [activeSource?.headers],
  );

  // Resolve and start stream
  useEffect(() => {
    let alive = true;
    triedProxyRef.current = false;
    triedCompatRef.current = 'none';
    compatOffsetRef.current = 0;
    compatBaseUrlRef.current = '';
    rawStreamUrlRef.current = '';
    setErrorMsg('');
    setTorrentBadge('');
    setCompatBadge('');
    setCompatActive(false);
    setProbedDuration(0);
    // The <video> duration belongs to the previous source until the new one reports its own.
    setDuration(0);
    setAudioTracks([]);
    setActiveAudioIdx(0);
    setEmbeddedSubs([]);
    setLoading(true);
    setResolvedUrl('');

    const run = async () => {
      let mediaUrl = '';
      if (offlineUrl) {
        setStatusMsg('Abriendo descarga local…');
        mediaUrl = offlineUrl;
      } else {
        const src = activeSource;
        if (!src) {
          // The in-player search is still choosing; its effect sets the source.
          if (awaitingPickRef.current) return;
          setErrorMsg('No se seleccionó ninguna fuente');
          setLoading(false);
          return;
        }

        if (src.infoHash && !src.url) {
          setStatusMsg(searchingOtherRef.current ? 'Buscando otra fuente…' : 'Cargando…');
          const alts = torrentRaceAlternatives(src, rankedSources, 3).map((a) => ({
            infoHash: a.infoHash,
            fileIdx: a.fileIdx,
            sources: a.trackers,
            filename: a.filename,
          }));
          const res = await desktopApi.service<{ url?: string; errorText?: string }>('torrentStart', {
            infoHash: src.infoHash,
            fileIdx: src.fileIdx,
            sources: src.trackers,
            filename: src.filename,
            season: episode?.season || 0,
            episode: episode?.number || 0,
            alternatives: alts,
          });
          // Cancelled (Esc / Volver) while the torrent was starting: stop it, play nothing.
          if (unmountedRef.current) {
            void desktopApi.service('torrentStop', {});
            return;
          }
          if (!alive) return;
          if (res?.url) {
            recordSourceHealth(src, true);
            mediaUrl = res.url;
          } else {
            recordSourceHealth(src, false);
            setErrorMsg(res?.errorText || 'No se pudo iniciar el torrent');
            setLoading(false);
            return;
          }
        } else {
          setStatusMsg(searchingOtherRef.current ? 'Buscando otra fuente…' : 'Cargando…');
          const hasHeaders = Object.keys(src.headers || {}).length > 0;
          const allowLan = Boolean(src.isJsPlugin && plugins.find((p) => p.id === src.addonId)?.allowLan);
          // Cheap 2-byte check: free file hosts often answer 403/429 (expired link or rate
          // limit), so a refusal skips straight to the next source instead of trying FFmpeg.
          // It runs in parallel with the resolve (both hit the same host) to save a round trip.
          const resolvePromise = desktopApi.service<{ url?: string; proxyPath?: string; token?: string; isHls?: boolean }>(
            'resolveExternal',
            {
              url: src.url,
              headers: src.headers || {},
              forceProxy: hasHeaders,
              allowLan,
            },
          ).catch(() => null);
          if (!allowLan) {
            const check = await desktopApi.service<{ status?: number; code?: string }>('pluginFetch', {
              url: src.url,
              method: 'GET',
              headers: { ...(src.headers || {}), Range: 'bytes=0-1' },
              maxBytes: 2,
              timeoutMs: 7000,
            });
            if (!alive) return;
            const status = Number(check?.status || 0);
            const refused = check ? isRefusalStatus(status) || check.code === 'timeout' || check.code === 'network' : false;
            if (refused) {
              const host = streamHost(src.url);
              if (host) failedHostsRef.current.add(host);
              lastFailureRefusedRef.current = true;
              recordSourceHealth(src, false);
              tryFallbackSourceRef.current();
              return;
            }
          }
          const res = await resolvePromise;
          if (unmountedRef.current) {
            void desktopApi.service('abortMedia', {});
            return;
          }
          if (!alive) return;
          if (res?.token) void desktopApi.service('abortMedia', { exceptToken: res.token });
          mediaUrl = res?.proxyPath || res?.url || src.url;
          // Extension-less playlists (sniffed by Content-Type in Rust) must still go through hls.js.
          if (res?.isHls) knownHlsRef.current.add(mediaUrl);
        }
      }

      if (!alive || !mediaUrl) return;
      rawStreamUrlRef.current = mediaUrl;
      const isHls = isHlsUrl(mediaUrl, knownHlsRef.current);
      const startSec = session.startPositionMs && session.startPositionMs > 5000 ? session.startPositionMs / 1000 : 0;
      const hint = proactiveCompatHint(activeSource, mediaUrl);

      if (!isHls && hint) {
        setStatusMsg('Preparando el video…');
        const probe = await probeMedia(mediaUrl, activeSource?.headers || {});
        if (!alive) return;
        if (probe?.available) {
          if (probe.durationSec && probe.durationSec > 0) setProbedDuration(probe.durationSec);
          const tracks = probe.audioTracks || [];
          setAudioTracks(tracks);
          const bestAudio = pickPreferredAudioIndex(tracks, playbackPrefs.preferredAudio);
          const probed: 'copy' | 'transcode' | null =
            probe.recommendation === 'videoCopy'
              ? 'copy'
              : probe.recommendation === 'transcode'
                ? 'transcode'
                : null;
          // A probe that identified the codecs and says "native" wins over the filename heuristic.
          const mode = probed ?? (probe.videoCodec ? null : hint);
          if (mode) {
            const started = await activateCompatMode(
              mediaUrl,
              mode,
              startSec,
              bestAudio,
              probe.videoCodec === 'hevc',
              probe.subtitleTracks,
            );
            if (started || !alive) return;
          }
        }
      }

      // Fast native path + background probe for multi-audio / embedded subtitles / silent-audio protection
      setStatusMsg('Cargando video…');
      setResolvedUrl(mediaUrl);
      if (!isHls) {
        void probeMedia(mediaUrl, activeSource?.headers || {})
          .then(async (probe) => {
            if (!alive || !probe?.available) return;
            if (probe.durationSec && probe.durationSec > 0) setProbedDuration(probe.durationSec);
            const tracks = probe.audioTracks || [];
            setAudioTracks(tracks);
            const bestAudio = pickPreferredAudioIndex(tracks, playbackPrefs.preferredAudio);
            setActiveAudioIdx(bestAudio);
            if (probe.subtitleTracks?.some((st) => st.textBased)) {
              const sess = await desktopApi.service<{ token?: string; subtitleBaseUrl?: string }>('compatStart', {
                url: mediaUrl,
                headers: activeSource?.headers || {},
                hevc: probe.videoCodec === 'hevc',
                audio: bestAudio,
                mode: probe.recommendation === 'videoCopy' ? 'copy' : 'transcode',
                allowLan: allowLanRef.current,
              });
              if (!alive) return;
              if (sess?.subtitleBaseUrl) {
                compatBaseUrlRef.current = (sess as { streamUrl?: string }).streamUrl?.split('?')[0] || compatBaseUrlRef.current;
                setEmbeddedSubs(
                  probe.subtitleTracks
                    .filter((st) => st.textBased)
                    .map((st) => ({
                      id: `emb_${sess.token}_${st.index}`,
                      url: `${sess.subtitleBaseUrl}/${st.index}.vtt`,
                      lang: st.lang || 'und',
                      label: st.label,
                      source: 'Incrustado en el archivo',
                    })),
                );
              }
            }
            // If file actually has an incompatible audio/video codec (e.g. MKV AC3/DTS) and we aren't in compat yet, switch seamlessly!
            if (
              triedCompatRef.current === 'none' &&
              (probe.recommendation === 'videoCopy' || probe.recommendation === 'transcode')
            ) {
              const cur = videoRef.current?.currentTime || startSec;
              const mode = probe.recommendation === 'videoCopy' ? 'copy' : 'transcode';
              await activateCompatMode(mediaUrl, mode, cur, bestAudio, probe.videoCodec === 'hevc', probe.subtitleTracks);
            }
          });
      }
    };

    void run();
    return () => {
      alive = false;
    };
  }, [activeSource, offlineUrl, episode?.season, episode?.number]);

  // Torrent stats badge polling
  useEffect(() => {
    if (offlineUrl || !activeSource?.infoHash || activeSource.url) return;
    const timer = setInterval(async () => {
      const st = await desktopApi.service<{
        active?: boolean;
        ready?: boolean;
        racing?: number;
        peers?: number;
        speed?: number;
      }>('torrentStats', {});
      if (!st?.active) return;
      if (!st.ready) {
        setStatusMsg('Cargando video…');
      } else {
        setTorrentBadge('');
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [activeSource, offlineUrl]);

  const tryFallbackSource = useCallback(() => {
    const failure = lastFailureRefusedRef.current
      ? SOURCES_REFUSED_MESSAGE
      : playbackFailureMessage(mediaErrorCodeRef.current, !compatUnavailableRef.current);
    if (offlineUrl) {
      setErrorMsg(
        mediaErrorCodeRef.current === 3 || mediaErrorCodeRef.current === 4 ? failure : 'No se pudo reproducir el archivo',
      );
      setLoading(false);
      return;
    }
    const nextIdx = pickNextSourceIndex(rankedSources, triedSourceIdsRef.current, failedHostsRef.current);
    if (nextIdx >= 0) {
      sourceIndexRef.current = nextIdx;
      const fallback = rankedSources[nextIdx];
      triedSourceIdsRef.current.add(fallback.id);
      const q = fallback.quality === 'unknown' ? 'Auto' : fallback.quality;
      notify(
        lastFailureRefusedRef.current
          ? `El servidor rechazó la fuente · probando otra (${q})…`
          : `Probando siguiente fuente (${q})…`,
      );
      mediaErrorCodeRef.current = null;
      triedProxyRef.current = false;
      triedCompatRef.current = 'none';
      setActiveSource(fallback);
    } else {
      setErrorMsg(failure);
      setLoading(false);
    }
  }, [offlineUrl, notify, rankedSources]);
  const tryFallbackSourceRef = useRef(tryFallbackSource);
  tryFallbackSourceRef.current = tryFallbackSource;

  // Attach resolvedUrl to <video> / Hls.js
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !resolvedUrl) return;
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHls = isHlsUrl(resolvedUrl, knownHlsRef.current);
    const isCompat = resolvedUrl.includes('/compat/');
    const startSec =
      !isCompat && session.startPositionMs && session.startPositionMs > 5000 ? session.startPositionMs / 1000 : 0;
    // One recovery chain per attached URL: hls.js and the <video> element can both report the same failure.
    let handling = false;
    let hlsMediaRecoveries = 0;
    const playbackPos = () => {
      const t = video.currentTime || 0;
      const pos = isCompat ? compatOffsetRef.current + t : t;
      return pos > 0 ? pos : startSec;
    };
    const audioIdx = () => (isCompat ? compatAudioRef.current : activeAudioIdxRef.current);
    const hevcSource = Boolean(activeSource?.isHevc);

    const handleFatalNetwork = async (decodeFailure = false) => {
      if (handling) return;
      handling = true;
      const rawUrl = rawStreamUrlRef.current || resolvedUrl;
      // 1) Try automatic FFmpeg compatibility fallback before giving up on a source (copy -> full transcode).
      // HLS only goes to FFmpeg when hls.js could not decode it (e.g. HEVC/AC3 segments), never on network errors.
      const compatAllowed = Boolean(rawUrl) && (!isHls || decodeFailure);
      if (compatAllowed && triedCompatRef.current === 'none' && !isHls && !hevcSource) {
        setStatusMsg('Preparando el video…');
        const ok = await activateCompatMode(rawUrl, 'copy', playbackPos(), audioIdx());
        if (ok) return;
      } else if (compatAllowed && triedCompatRef.current !== 'transcode') {
        setStatusMsg('Convirtiendo el video para reproducirlo…');
        const ok = await activateCompatMode(rawUrl, 'transcode', playbackPos(), audioIdx(), hevcSource);
        if (ok) return;
      }
      if (!triedProxyRef.current && activeSource?.url && !offlineUrl && !isCompat) {
        triedProxyRef.current = true;
        setStatusMsg('Intentando otra conexión…');
        const allowLan = Boolean(activeSource.isJsPlugin && plugins.find((p) => p.id === activeSource.addonId)?.allowLan);
        const prox = await desktopApi.service<{ url?: string; proxyPath?: string }>('resolveExternal', {
          url: activeSource.url,
          headers: activeSource.headers || {},
          forceProxy: true,
          allowLan,
        });
        const proxUrl = prox?.proxyPath || prox?.url;
        if (proxUrl && proxUrl !== resolvedUrl) {
          rawStreamUrlRef.current = proxUrl;
          setResolvedUrl(proxUrl);
          return;
        }
      }
      if (activeSource) recordSourceHealth(activeSource, false);
      lastFailureRefusedRef.current = false;
      tryFallbackSource();
    };

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, startFragPrefetch: true, backBufferLength: 30, maxBufferLength: 45 });
      hlsRef.current = hls;
      hls.loadSource(resolvedUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (startSec > 0) video.currentTime = startSec;
        video.play().catch(() => {});
      });
      // Feed the measured bandwidth into the auto-quality profile (throttled).
      let fragCount = 0;
      hls.on(Hls.Events.FRAG_LOADED, () => {
        fragCount += 1;
        if (fragCount % 8 === 0) recordBandwidthEstimate(hls.bandwidthEstimate);
      });
      hls.on(Hls.Events.ERROR, (_ev, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            void handleFatalNetwork();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && hlsMediaRecoveries < 2) {
            // Standard hls.js recovery ladder: recover, then swap audio codec and recover once more.
            if (hlsMediaRecoveries === 1) hls.swapAudioCodec();
            hlsMediaRecoveries += 1;
            hls.recoverMediaError();
          } else {
            mediaErrorCodeRef.current = 3;
            void handleFatalNetwork(true);
          }
        }
      });
    } else {
      video.src = resolvedUrl;
      video.load();
      if (startSec > 0) {
        const onMeta = () => {
          video.currentTime = startSec;
          video.removeEventListener('loadedmetadata', onMeta);
        };
        video.addEventListener('loadedmetadata', onMeta);
      }
      video.play().catch(() => {});
    }

    const onError = () => {
      // hls.js reports its own fatal errors; the element error would only duplicate them.
      if (hlsRef.current) return;
      if (!video.src) return;
      const code = video.error?.code ?? null;
      mediaErrorCodeRef.current = code;
      void handleFatalNetwork(code === 3 || code === 4);
    };
    video.addEventListener('error', onError);
    return () => {
      video.removeEventListener('error', onError);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [resolvedUrl]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // In Tauri desktop we control OS volume; keep element at full scale to avoid double attenuation.
    v.volume = systemVolRef.current ? 1 : volume;
    v.muted = muted;
    v.playbackRate = speed;
  }, [volume, muted, speed]);

  // Save watch progress every 10s & on unmount
  useEffect(() => {
    const save = () => {
      const v = videoRef.current;
      const effTime = compatActive ? compatOffsetRef.current + (v?.currentTime || 0) : v?.currentTime || 0;
      const effDur = probedDuration > 0 ? probedDuration : (Number.isFinite(v?.duration) && (v?.duration || 0) > 30 ? v!.duration : 0);
      if (effDur > 30 && effTime > 5) {
        onSaveProgressRef.current(Math.floor(effTime * 1000), Math.floor(effDur * 1000));
      }
    };
    const timer = setInterval(save, 10_000);
    return () => {
      clearInterval(timer);
      save();
    };
  }, [compatActive, probedDuration]);

  const playNextEpisode = useCallback(() => {
    if (!nextEpisode) return;
    setNextCountdown(null);
    setEndedEvent(false);
    // The next player instance reuses the search preloaded in the last 35 s (if any).
    onSwitchSession({ item, episode: nextEpisode, allEpisodes, chosen: null, ranked: [] });
  }, [allEpisodes, item, nextEpisode, onSwitchSession]);

  const effectiveDuration = useMemo(() => {
    if (probedDuration > 0) return probedDuration;
    if (Number.isFinite(duration) && duration > 0) return duration;
    return 0;
  }, [duration, probedDuration]);

  // Wrong-content guard: a direct link whose real duration is far from the episode's TMDB
  // runtime is another version/show (e.g. a remake matched by its Spanish title). Checked once
  // per source; never for torrents (extended cuts), movies, local files or offline downloads.
  useEffect(() => {
    const src = activeSource;
    const runtimeMin = episode?.runtimeMin || 0;
    if (!src || !episode || runtimeMin <= 0 || offlineUrl || item.id.startsWith('local:')) return;
    if (!src.url) return; // torrent (no direct link)
    if (!resolvedUrl || runtimeCheckedIdsRef.current.has(src.id)) return;
    // In compat mode the <video> element only sees an FFmpeg segment: trust the probe only.
    const dur = probedDuration > 0 ? probedDuration : compatActive ? 0 : duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    runtimeCheckedIdsRef.current.add(src.id);
    if (!runtimeMismatch(dur, runtimeMin)) return;
    triedSourceIdsRef.current.add(src.id);
    const nextIdx = pickSameLanguageSourceIndex(rankedSources, src, triedSourceIdsRef.current, failedHostsRef.current);
    if (nextIdx < 0) {
      console.info(
        `[player] ${src.addonName || src.provider}: duración ${Math.round(dur)} s vs ${runtimeMin} min (TMDB); sin otra fuente, se mantiene`,
      );
      return;
    }
    const next = rankedSources[nextIdx];
    console.info(
      `[player] ${src.addonName || src.provider}: duración ${Math.round(dur)} s vs ${runtimeMin} min (TMDB), parece otra versión; probando ${next.addonName || next.provider}`,
    );
    triedSourceIdsRef.current.add(next.id);
    sourceIndexRef.current = nextIdx;
    searchingOtherRef.current = true;
    mediaErrorCodeRef.current = null;
    videoRef.current?.pause();
    setStatusMsg('Buscando otra fuente…');
    setLoading(true);
    setActiveSource(next);
  }, [activeSource, compatActive, duration, episode, item.id, offlineUrl, probedDuration, rankedSources, resolvedUrl]);

  // Start the next episode's source search once during the last 35 s (no torrent is started).
  useEffect(() => {
    if (!nextEpisode || effectiveDuration <= 120 || currentTime <= 0) return;
    if (effectiveDuration - currentTime > 35) return;
    if (preloadingNextRef.current === nextEpisode.id) return;
    preloadingNextRef.current = nextEpisode.id;
    getSourceSearch(item, nextEpisode, plugins);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime >= effectiveDuration - 35, nextEpisode?.id, effectiveDuration > 120]);

  // Online intro/credits timestamps once the duration is known (AniSkip / IntroDB / TheIntroDB via the core).
  const durationKnown = effectiveDuration > 0;
  useEffect(() => {
    if (!episode || !durationKnown || item.id.startsWith('local:')) return;
    const key = `${item.id}|${episode.id}`;
    if (skipLookupRef.current === key) return;
    skipLookupRef.current = key;
    let alive = true;
    let settled = false;
    void fetchSkipData(item, episode, effectiveDuration).then((d) => {
      settled = true;
      if (alive && d) setRemoteSkip(d);
    });
    return () => {
      alive = false;
      // A source swap resets the duration while the lookup is in flight: allow it to run again
      // (the per-episode cache answers instantly) instead of dropping the result for good.
      if (!settled && skipLookupRef.current === key) skipLookupRef.current = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationKnown, episode, item]);

  const skipData = useMemo(
    () => mergeSkipData(segmentsFromChapters(chapters, effectiveDuration), remoteSkip),
    [chapters, effectiveDuration, remoteSkip],
  );
  const creditsStart = episode ? creditsStartSec(effectiveDuration, skipData) : null;
  // The credits time came from real data (chapters / skip databases), not the end-of-file guess.
  const realCredits = creditsStart !== null && skipData?.credits != null && creditsStart === skipData.credits.start;
  const endPhase =
    episode && (started || Boolean(offlineUrl)) ? endPhaseAt(currentTime, effectiveDuration, creditsStart, endedEvent) : 'playing';
  const showNextCard = Boolean(nextEpisode) && endPhase === 'credits' && !nextDismissed && !errorMsg;
  const showEndScreen = endPhase === 'ended' && !errorMsg;
  const endActions = useMemo(() => endScreenActions(Boolean(nextEpisode)), [nextEpisode]);
  const rawSkipPrompt = episode ? skipPromptAt(currentTime, effectiveDuration, skipData, false) : null;
  const skipPrompt =
    rawSkipPrompt && !skippedKinds.includes(rawSkipPrompt.kind) && endPhase === 'playing' ? rawSkipPrompt : null;
  const nextStill = useMemo(
    () => (nextEpisode?.thumbnail ? resizedImageUrl(nextEpisode.thumbnail, 480) : ''),
    [nextEpisode?.thumbnail],
  );

  // Manual subtitle search (SubtitleCat via Rust) — runs only when the user presses "Buscar".
  const searchMoreSubtitles = useCallback(async () => {
    if (subSearching) return;
    const custom = subQuery.trim();
    setSubSearching(true);
    try {
      const rawId = item.id.replace(/^stremio:/, '');
      const res = await desktopApi.service<{ subtitles?: Array<{ lang: string; url: string }> }>('subtitleCat', {
        imdbId: !custom && /^tt\d+/.test(rawId) ? rawId.split(':')[0] : '',
        kind: item.type === 'movie' ? 'movie' : 'series',
        title: custom || item.title,
        year: item.year || '',
        season: episode?.season || 0,
        episode: episode?.number || 0,
      });
      const found = Array.isArray(res?.subtitles) ? res.subtitles.slice(0, 20) : [];
      if (found.length === 0) {
        notify('No se encontraron más subtítulos');
        return;
      }
      const proxied = await desktopApi.service<{ subtitles?: Array<{ lang: string; url: string | null } | null> }>('proxySubtitles', {
        subtitles: found,
        allowLan: false,
      });
      const mapped: ExternalSubtitle[] = found.map((s, idx) => ({
        id: `scat_${idx}_${s.url}`,
        url: proxied?.subtitles?.[idx]?.url || s.url,
        directUrl: s.url,
        lang: s.lang || 'es',
        label: (s.lang || '').toLowerCase().startsWith('es') ? 'Español' : (s.lang || '').toLowerCase().startsWith('en') ? 'Inglés' : s.lang || 'Subtítulo',
        source: 'Búsqueda manual',
        origin: 'subtitlecat',
      }));
      setExtSubs((prev) => {
        const seen = new Set(prev.map((x) => x.url));
        return [...prev, ...mapped.filter((x) => !seen.has(x.url))];
      });
      notify(`${mapped.length} subtítulo(s) encontrados`);
    } finally {
      setSubSearching(false);
    }
  }, [episode, item, notify, subQuery, subSearching]);

  const loadLocalSubtitleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      if (file.size > 4 * 1024 * 1024) {
        notify('El archivo de subtítulos es demasiado grande');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const cues = parseSubtitles(decodeSubtitleBytes(reader.result as ArrayBuffer));
        if (cues.length === 0) {
          notify('No se pudieron leer las líneas del subtítulo');
          return;
        }
        const id = `file_${Date.now()}`;
        subCueCacheRef.current.set(id, cues);
        setExtSubs((prev) => [...prev, { id, url: '', lang: 'es', label: file.name, source: 'Archivo de tu equipo' }]);
        activeSubIdRef.current = id;
        setActiveSubId(id);
        setSubCues(cues);
        notify('Subtítulo cargado');
      };
      reader.readAsArrayBuffer(file);
    },
    [notify],
  );

  // Auto-next: a short countdown starts when the "Siguiente episodio" button appears at REAL
  // credits; seeking back (or Esc) cancels it. Without real credits data the button shows with no
  // countdown, so the actual ending is never cut — auto-next then happens at the real end.
  useEffect(() => {
    if (!showNextCard || !playbackPrefs.autoNextEpisode || !realCredits) {
      if (nextCountdown !== null) setNextCountdown(null);
      return;
    }
    if (nextCountdown === null) {
      const secs = autoNextCountdown(effectiveDuration - currentTime);
      nextCountdownStartRef.current = secs;
      setNextCountdown(secs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNextCard, playbackPrefs.autoNextEpisode, realCredits]);

  // Reaching the end with auto-next on (and not dismissed) goes straight to the next episode;
  // otherwise the end screen stays over the last frame (never a silent exit).
  const reachedEnd = endPhase === 'ended';
  useEffect(() => {
    if (!reachedEnd || !nextEpisode || !playbackPrefs.autoNextEpisode || nextDismissed) return;
    playNextEpisode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reachedEnd]);

  // The end screen focuses its primary button.
  useEffect(() => {
    if (!showEndScreen) return;
    const t = setTimeout(() => endButtonsRef.current[0]?.focus(), 30);
    return () => clearTimeout(t);
  }, [showEndScreen]);

  // Probe duration for sources where HTML5 reports unknown/Infinity (common in torrents/MKV).
  useEffect(() => {
    if (!resolvedUrl || probedDuration > 0 || offlineUrl) return;
    let alive = true;
    const probe = async () => {
      try {
        // HLS reports its own duration; compat URLs are FFmpeg output (duration comes from the source probe).
        if (isHlsUrl(resolvedUrl, knownHlsRef.current) || resolvedUrl.includes('/compat/')) return;
        const res = await probeMedia(resolvedUrl, activeSource?.headers || {});
        if (!alive) return;
        if (res && typeof res.durationSec === 'number' && res.durationSec > 0) setProbedDuration(res.durationSec);
      } catch {}
    };
    void probe();
    return () => { alive = false; };
  }, [activeSource?.headers, offlineUrl, probeMedia, probedDuration, resolvedUrl]);

  // Native-playback watchdog (WebView2 rarely raises an error for these, it just plays badly):
  // - Black screen: the container opened but the video codec (e.g. HEVC without the Windows extension)
  //   is not decodable, so `videoWidth` stays 0 while audio plays -> full FFmpeg transcode.
  // - Silent audio: H.264 video from MKV plays but AC3/DTS audio decodes 0 bytes -> FFmpeg remux.
  useEffect(() => {
    if (!playing || compatActive || !resolvedUrl) return;
    if (isHlsUrl(resolvedUrl, knownHlsRef.current)) return;
    if (triedCompatRef.current !== 'none') return;
    const t = setTimeout(() => {
      const v = videoRef.current as (HTMLVideoElement & { webkitAudioDecodedByteCount?: number }) | null;
      if (!v || v.paused || v.currentTime < 2) return;
      const rawUrl = rawStreamUrlRef.current || resolvedUrl;
      if (v.videoWidth === 0 && v.readyState >= 2) {
        setLoading(true);
        setStatusMsg('Convirtiendo el video para reproducirlo…');
        void activateCompatMode(rawUrl, 'transcode', v.currentTime, activeAudioIdx, Boolean(activeSource?.isHevc)).then(
          (ok) => {
            if (!ok) {
              setLoading(false);
              notify('Este video no se puede mostrar en este equipo. Prueba otra fuente.');
            }
          },
        );
        return;
      }
      if (v.muted || muted || volume <= 0) return;
      if (typeof v.webkitAudioDecodedByteCount === 'number' && v.webkitAudioDecodedByteCount === 0) {
        void activateCompatMode(rawUrl, 'copy', v.currentTime, activeAudioIdx);
      }
    }, 3200);
    return () => clearTimeout(t);
  }, [activateCompatMode, activeAudioIdx, activeSource?.isHevc, compatActive, muted, notify, playing, resolvedUrl, volume]);

  useEffect(() => {
    if (nextCountdown === null) return;
    if (nextCountdown <= 0) {
      void playNextEpisode();
      return;
    }
    // Paused = the countdown waits too.
    if (!playing) return;
    const t = setTimeout(() => setNextCountdown((c) => (c !== null ? c - 1 : null)), 1000);
    return () => clearTimeout(t);
  }, [nextCountdown, playNextEpisode, playing]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
    wakeHud();
  }, [wakeHud]);

  const seekTo = useCallback(
    (targetSec: number) => {
      const maxDur = effectiveDuration > 0 ? effectiveDuration : Number.MAX_SAFE_INTEGER;
      const clamped = Math.max(0, Math.min(maxDur, targetSec));
      if (compatActive && compatBaseUrlRef.current) {
        compatOffsetRef.current = clamped;
        setCurrentTime(clamped);
        setLoading(true);
        setStatusMsg('Cargando el momento elegido…');
        setResolvedUrl(
          buildCompatStreamUrl(compatBaseUrlRef.current, clamped, compatAudioRef.current, compatModeRef.current),
        );
      } else {
        const v = videoRef.current;
        if (v && Number.isFinite(v.duration)) {
          v.currentTime = clamped;
          setCurrentTime(clamped);
        }
      }
      wakeHud();
    },
    [compatActive, effectiveDuration, wakeHud],
  );

  const seekBy = useCallback(
    (delta: number) => {
      seekTo(currentTime + delta);
    },
    [currentTime, seekTo],
  );

  const skipSegment = useCallback(
    (kind: string, target: number) => {
      setSkippedKinds((k) => (k.includes(kind) ? k : [...k, kind]));
      seekTo(target);
    },
    [seekTo],
  );

  // Exact intro timestamps + "Omitir intro automáticamente" (off by default): skip once per episode.
  useEffect(() => {
    if (!playbackPrefs.autoSkipIntro || !skipPrompt || !skipPrompt.exact || skipPrompt.kind !== 'intro') return;
    skipSegment('intro', skipPrompt.target);
    notify('Intro omitida');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipPrompt?.kind, skipPrompt?.exact, playbackPrefs.autoSkipIntro]);

  const dismissNextCard = useCallback(() => {
    setNextDismissed(true);
    setNextCountdown(null);
  }, []);

  const replayEpisode = useCallback(() => {
    setEndedEvent(false);
    setNextDismissed(false);
    setSkippedKinds([]);
    seekTo(0);
    videoRef.current?.play().catch(() => {});
  }, [seekTo]);

  const runEndAction = useCallback(
    (a: 'next' | 'exit' | 'replay') => {
      if (a === 'next') playNextEpisode();
      else if (a === 'replay') replayEpisode();
      else onExit();
    },
    [onExit, playNextEpisode, replayEpisode],
  );

  const selectAudioTrack = useCallback(
    async (idx: number) => {
      setAudioOpen(false);
      if (idx === activeAudioIdx && compatActive) return;
      const rawUrl = rawStreamUrlRef.current || resolvedUrl;
      if (!rawUrl) return;
      setLoading(true);
      setStatusMsg('Cambiando pista de audio…');
      if (compatActive && compatBaseUrlRef.current) {
        compatAudioRef.current = idx;
        compatOffsetRef.current = currentTime;
        setActiveAudioIdx(idx);
        setResolvedUrl(buildCompatStreamUrl(compatBaseUrlRef.current, currentTime, idx, compatModeRef.current));
      } else {
        const ok = await activateCompatMode(rawUrl, 'copy', currentTime, idx);
        if (!ok) {
          notify('No se pudo cambiar la pista de audio en este archivo');
          setLoading(false);
        }
      }
    },
    [activateCompatMode, activeAudioIdx, compatActive, currentTime, notify, resolvedUrl],
  );

  const togglePiP = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled) await v.requestPictureInPicture();
    } catch {
      notify('Ventana flotante no disponible');
    }
  }, [notify]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // End screen: arrows move between its buttons, Enter/Space press the focused one, Esc = Salir.
      if (showEndScreen && !sourcesOpen) {
        const btns = endButtonsRef.current.filter((b): b is HTMLButtonElement => Boolean(b));
        const idx = btns.findIndex((b) => b === document.activeElement);
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Tab') {
          e.preventDefault();
          const dir = e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1;
          btns[(Math.max(0, idx) + dir + btns.length) % btns.length]?.focus();
        } else if (e.key === 'Enter' && idx < 0) {
          e.preventDefault();
          btns[0]?.click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onExit();
        } else if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          onToggleFullscreen();
        }
        return;
      }
      // Next-episode card: Enter plays it, Esc dismisses it and keeps watching.
      if (showNextCard && !sourcesOpen && !subsOpen && !audioOpen && !episodesOpen) {
        if (e.key === 'Enter') {
          e.preventDefault();
          playNextEpisode();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          dismissNextCard();
          return;
        }
      }
      if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekBy(10);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekBy(-10);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        applyVolume(Math.min(1, volume + 0.05), false);
        wakeHud();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.max(0, volume - 0.05);
        applyVolume(next, next === 0);
        wakeHud();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
        wakeHud();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        onToggleFullscreen();
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        void togglePiP();
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        setSubsOpen((o) => !o);
        setEpisodesOpen(false);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (sourcesOpen) setSourcesOpen(false);
        // Before the first frame Esc cancels everything and goes back.
        else if (!startedRef.current) onExit();
        else if (audioOpen) setAudioOpen(false);
        else if (subsOpen) setSubsOpen(false);
        else if (episodesOpen) setEpisodesOpen(false);
        else if (isFullscreen) onToggleFullscreen();
        else onExit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyVolume, audioOpen, dismissNextCard, episodesOpen, isFullscreen, onExit, onToggleFullscreen, playNextEpisode, seekBy, showEndScreen, showNextCard, sourcesOpen, subsOpen, toggleMute, togglePiP, togglePlay, volume, wakeHud]);

  const activeCueText = useMemo(() => {
    if (activeSubId === 'off' || subCues.length === 0) return '';
    return cueTextAt(subCues, currentTime - playbackPrefs.subtitleStyle.delayMs / 1000);
  }, [activeSubId, currentTime, playbackPrefs.subtitleStyle.delayMs, subCues]);

  // Embedded first, then OpenSubtitles, SubDL and SubtitleCat (Latin-American Spanish first in each).
  const allSubs = useMemo(() => orderSubtitles([...embeddedSubs, ...extSubs]), [embeddedSubs, extSubs]);

  const progressPct = effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0;
  const bufferedPct = effectiveDuration > 0 ? Math.min(100, (bufferedEnd / effectiveDuration) * 100) : 0;
  const showHud = hudVisible || !playing || subsOpen || audioOpen || episodesOpen || loading || Boolean(errorMsg);

  const videoObjectClass =
    playbackPrefs.screenFormat === 'cover'
      ? 'h-full w-full bg-black object-cover'
      : playbackPrefs.screenFormat === '16-9'
      ? 'aspect-video max-h-full max-w-full bg-black object-fill'
      : playbackPrefs.screenFormat === '4-3'
      ? 'aspect-[4/3] max-h-full max-w-full bg-black object-fill'
      : 'h-full w-full bg-black object-contain';

  return (
    <div
      onMouseMove={wakeHud}
      onWheel={() => {
        wakeHud();
      }}
      className={`relative flex h-full w-full items-center justify-center overflow-hidden bg-black select-none ${
        showHud ? '' : 'cursor-none'
      }`}
    >
      <video
        ref={videoRef}
        onClick={togglePlay}
        onDoubleClick={onToggleFullscreen}
        onPlay={() => {
          setPlaying(true);
          setEndedEvent(false);
          wakeHud();
        }}
        onSeeking={() => setEndedEvent(false)}
        onEnded={() => {
          // Compat (FFmpeg) streams end per segment too: only the real end of the episode counts.
          const v = videoRef.current;
          const pos = (compatActive ? compatOffsetRef.current : 0) + (v?.currentTime || 0);
          if (effectiveDuration <= 0 || pos >= effectiveDuration - 5) setEndedEvent(true);
        }}
        onPlaying={() => {
          searchingOtherRef.current = false;
          setStarted(true);
          setLoading(false);
        }}
        onPause={() => {
          setPlaying(false);
          setHudVisible(true);
        }}
        onWaiting={() => setLoading(true)}
        onCanPlay={() => {
          if (startedRef.current) setLoading(false);
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          const off = compatActive ? compatOffsetRef.current : 0;
          setCurrentTime(off + v.currentTime);
          if (v.buffered.length > 0) setBufferedEnd(off + v.buffered.end(v.buffered.length - 1));
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        className={videoObjectClass}
      />

      {/* Styled Subtitle Overlay */}
      {activeCueText && (
        <div
          className={`pointer-events-none absolute inset-x-0 z-30 flex justify-center px-12 transition-all duration-200 ${
            showHud ? 'bottom-32' : 'bottom-12'
          }`}
        >
          <div
            style={{
              fontSize: `${playbackPrefs.subtitleStyle.sizePx}px`,
              color: playbackPrefs.subtitleStyle.color,
              backgroundColor: `rgba(0, 0, 0, ${playbackPrefs.subtitleStyle.bgAlpha})`,
            }}
            className="max-w-4xl rounded-lg px-4 py-1.5 text-center leading-snug font-semibold whitespace-pre-line shadow-lg"
          >
            {activeCueText}
          </div>
        </div>
      )}

      {/* In-player notice: small pill, top-center, auto-hides (no global toast while playing) */}
      {notice && (
        <div className="pointer-events-none absolute inset-x-0 top-7 z-[45] flex justify-center px-40">
          <div
            key={notice.id}
            role="status"
            aria-live="polite"
            className="ot-fade-up max-w-[560px] truncate rounded-full border border-white/12 bg-[#141418]/88 px-4 py-2 text-[13px] font-semibold text-white/90 shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
          >
            {notice.text}
          </div>
        </div>
      )}

      {/* Loading screen until the first frame: black, dimmed backdrop, title and the current step */}
      {!started && !offlineUrl && (
        <div className="pointer-events-none absolute inset-0 z-10 bg-black">
          {loadingArt && (
            <img src={loadingArt} alt="" className="h-full w-full object-cover opacity-35" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/75 to-black/95" />
          {!errorMsg && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-12 text-center">
              <div className="line-clamp-2 max-w-3xl font-display text-[28px] font-extrabold text-white">{item.title}</div>
              {episode && (
                <div className="max-w-2xl truncate text-[14px] text-white/70">
                  {`T${episode.season}·E${episode.number}`}
                  {episode.title ? ` · ${episode.title}` : ''}
                </div>
              )}
              <div
                style={{ borderTopColor: 'var(--ot-accent)' }}
                className="mt-5 h-10 w-10 animate-spin rounded-full border-[3px] border-white/20"
              />
              <div className="mt-2 text-[15px] font-semibold text-white">{statusMsg}</div>
            </div>
          )}
          {!errorMsg && (
            <div className="absolute inset-x-0 bottom-7 text-center text-[11.5px] text-white/40">Pulsa Esc para cancelar</div>
          )}
        </div>
      )}

      {/* Center Loading / Error */}
      {((loading && (started || Boolean(offlineUrl))) || errorMsg) && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/50">
          {errorMsg ? (
            <div className="pointer-events-auto max-w-md space-y-4 rounded-[22px] border border-white/10 bg-[#141418]/96 p-6 text-center shadow-2xl">
              <div className="text-[16px] font-bold text-white">Error de reproducción</div>
              <p className="text-[13.5px] text-white/70">{errorMsg}</p>
              <div className="flex flex-wrap justify-center gap-2.5">
                {rankedSources.length > 0 && !offlineUrl && (
                  <button
                    type="button"
                    onClick={() => setSourcesOpen(true)}
                    style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
                    className="rounded-xl px-4 py-2 text-[13.5px] font-bold cursor-pointer"
                  >
                    Elegir otra fuente
                  </button>
                )}

                <button
                  type="button"
                  onClick={onExit}
                  className="rounded-xl px-4 py-2 text-[13.5px] font-semibold text-white/70 hover:text-white cursor-pointer"
                >
                  Volver
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div
                style={{ borderTopColor: 'var(--ot-accent)' }}
                className="h-11 w-11 animate-spin rounded-full border-[3px] border-white/20"
              />
              <span className="rounded-full bg-black/70 px-4 py-1.5 text-[13px] font-medium text-white/85 backdrop-blur-md">
                {statusMsg}
              </span>
            </div>
          )}
        </div>
      )}

      {/* "Omitir intro" / "Omitir resumen": only with real timestamps */}
      {skipPrompt && !showEndScreen && (
        <button
          type="button"
          onClick={() => skipSegment(skipPrompt.kind, skipPrompt.target)}
          className={`ot-fade-up absolute right-10 z-30 flex h-11 items-center gap-2 rounded-xl border border-white/25 bg-[#0e0e11]/80 px-5 text-[14px] font-bold text-white shadow-2xl transition-[bottom] hover:bg-white hover:text-[#0e0e11] cursor-pointer ${
            showHud ? 'bottom-36' : 'bottom-12'
          }`}
        >
          <SkipForward className="h-4 w-4" />
          <span>{skipPrompt.label}</span>
        </button>
      )}

      {/* "Siguiente episodio" at the credits: one pill like "Omitir intro" (Enter = play it,
          Esc = keep watching); with auto-next its fill shows the countdown. */}
      {showNextCard && nextEpisode && !showEndScreen && (
        <button
          type="button"
          onClick={() => playNextEpisode()}
          className={`ot-fade-up absolute right-10 z-30 flex h-11 items-center gap-2 overflow-hidden rounded-xl border border-white/25 bg-[#0e0e11]/80 px-5 text-[14px] font-bold text-white shadow-2xl transition-[bottom] hover:bg-white hover:text-[#0e0e11] cursor-pointer ${
            showHud ? 'bottom-36' : 'bottom-12'
          }`}
        >
          {nextCountdown !== null && (
            <span
              aria-hidden="true"
              style={{ width: `${Math.round((1 - nextCountdown / Math.max(1, nextCountdownStartRef.current)) * 100)}%` }}
              className="absolute inset-y-0 left-0 bg-white/20 transition-[width] duration-1000 ease-linear"
            />
          )}
          <SkipForward className="relative h-4 w-4 fill-current" />
          <span className="relative">Siguiente episodio</span>
        </button>
      )}

      {/* End screen over the last frame: next episode / exit / watch again (never a silent exit) */}
      {showEndScreen && (
        <div className="ot-fade-up absolute inset-0 z-40 flex items-end bg-gradient-to-t from-black/95 via-black/70 to-black/35 px-14 pb-16">
          <div className="flex w-full max-w-5xl items-end gap-8">
            {nextEpisode && nextStill && (
              <img src={nextStill} alt="" className="hidden aspect-video w-[340px] shrink-0 rounded-2xl border border-white/12 object-cover shadow-2xl md:block" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-bold tracking-[0.16em] text-white/55 uppercase">
                {nextEpisode ? 'Siguiente episodio' : 'Has llegado al final'}
              </div>
              <div className="mt-2 line-clamp-2 font-display text-[30px] leading-tight font-extrabold text-white">
                {nextEpisode ? episodeLabel(nextEpisode) : item.title}
              </div>
              {!nextEpisode && episode && (
                <div className="mt-1 text-[14px] text-white/65">{`Último episodio disponible · ${episodeLabel(episode)}`}</div>
              )}
              <div className="mt-6 flex flex-wrap items-center gap-3">
                {endActions.map((a, i) => (
                  <button
                    key={a}
                    ref={(el) => {
                      endButtonsRef.current[i] = el;
                    }}
                    type="button"
                    onClick={() => runEndAction(a)}
                    style={i === 0 ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' } : undefined}
                    className={`flex h-12 items-center gap-2 rounded-xl px-6 text-[15px] font-bold outline-none focus-visible:ring-4 focus-visible:ring-white/70 cursor-pointer ${
                      i === 0 ? 'focus:ring-4 focus:ring-white/70' : 'border border-white/20 bg-white/[0.08] text-white hover:bg-white/15 focus:bg-white focus:text-[#0e0e11]'
                    }`}
                  >
                    {a === 'next' && <SkipForward className="h-5 w-5 fill-current" />}
                    {a === 'replay' && <RotateCcw className="h-5 w-5" />}
                    {a === 'exit' && <ArrowLeft className="h-5 w-5" />}
                    <span>{a === 'next' ? 'Siguiente episodio' : a === 'replay' ? 'Volver a ver' : 'Salir'}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top HUD (`vod-topbar`: round back + bold title) */}
      <div
        className={`absolute inset-x-0 top-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/75 via-black/35 to-transparent px-8 pt-6 pb-14 transition-opacity duration-200 ${
          showHud ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="flex min-w-0 items-center gap-4">
          <button
            type="button"
            onClick={onExit}
            aria-label="Volver"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/22 bg-[#141418]/65 text-white backdrop-blur-md transition hover:scale-105 hover:bg-white/18 cursor-pointer"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <div className="truncate font-display text-[23px] font-bold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
              {titleHeading}
            </div>
            <div className="flex items-center gap-2 text-[12.5px] text-white/65">
              {episode?.title && <span className="truncate">{episode.title}</span>}
              {offlineUrl && <span className="text-[#7ee2a8]">Sin conexión</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Netflix-style HUD (`07-inicio-hero-perfiles.css` + `08-en-vivo-reproductor.css`) */}
      <div
        className={`absolute inset-x-0 bottom-0 z-20 space-y-4 bg-gradient-to-t from-black/92 via-black/62 to-transparent px-10 pt-16 pb-6 transition-opacity duration-200 ${
          showHud && (started || Boolean(offlineUrl)) ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {/* Thin Seek Bar with Hover Preview Timestamp Bubble (`vod-seek-hover`) */}
        <div className="flex items-center gap-4">
          <span className="w-14 text-right text-[13.5px] font-semibold tabular-nums text-white/90">
            {formatTime(currentTime)}
          </span>

          <div
            onMouseMove={(e) => {
              if (!effectiveDuration) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              setHoverSeek({ pct: pct * 100, sec: pct * effectiveDuration });
            }}
            onMouseLeave={() => setHoverSeek(null)}
            className="group/seek relative flex h-7 flex-1 items-center"
          >
            {hoverSeek && (
              <div
                style={{ left: `${hoverSeek.pct}%` }}
                className="pointer-events-none absolute -top-11 -translate-x-1/2 rounded-[10px] border border-white/15 bg-[#0e0e11]/94 px-3 py-1 text-[13.5px] font-bold tabular-nums text-white shadow-xl"
              >
                {formatTime(hoverSeek.sec)}
              </div>
            )}

            <div className="pointer-events-none absolute inset-x-0 h-[5px] overflow-hidden rounded-full bg-white/22 transition-[height] group-hover/seek:h-[8px]">
              <div style={{ width: `${bufferedPct}%` }} className="absolute inset-y-0 left-0 bg-white/32" />
              {hoverSeek && (
                <div style={{ width: `${hoverSeek.pct}%` }} className="absolute inset-y-0 left-0 bg-white/22" />
              )}
              <div
                style={{ width: `${progressPct}%`, backgroundColor: 'var(--ot-accent)' }}
                className="absolute inset-y-0 left-0"
              />
            </div>

            <input
              type="range"
              min={0}
              max={effectiveDuration || 1}
              step={0.5}
              value={currentTime}
              onChange={(e) => {
                seekTo(Number(e.target.value));
              }}
              className="ot-range relative z-10 w-full cursor-pointer opacity-0 hover:opacity-100"
            />
          </div>

          <span className="w-14 text-[13.5px] font-semibold tabular-nums text-white/60">
            {formatTime(effectiveDuration)}
          </span>
        </div>

        {/* 3-Group Control Row: Left (Volume) | Center (-10 · Play · +10) | Right (Tools) */}
        <div className="grid grid-cols-3 items-center">
          {/* Left: Volume */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={toggleMute}
              title={muted ? 'Activar sonido (M)' : 'Silenciar (M)'}
              className="flex h-11 w-11 items-center justify-center rounded-full text-white transition hover:bg-white/14 cursor-pointer"
            >
              {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const val = Number(e.target.value);
                applyVolume(val, val === 0);
              }}
              className="ot-range w-28 cursor-pointer"
            />
            <span className="text-[13px] font-medium tabular-nums text-white/70">
              {muted || volume === 0 ? 'Sin sonido' : `${Math.round(volume * 100)}%`}
            </span>
          </div>

          {/* Center: -10s · White Play/Pause · +10s */}
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => seekBy(-10)}
              title="Retroceder 10 s (←)"
              className="flex h-11 w-11 items-center justify-center rounded-full text-white/90 transition hover:scale-105 hover:bg-white/14 cursor-pointer"
            >
              <RotateCcw className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={togglePlay}
              style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
              className="flex h-14 w-14 items-center justify-center rounded-full shadow-xl transition hover:scale-105 hover:brightness-90 cursor-pointer"
            >
              {playing ? <Pause className="h-6 w-6 fill-current" /> : <Play className="ml-0.5 h-6 w-6 fill-current" />}
            </button>

            <button
              type="button"
              onClick={() => seekBy(10)}
              title="Adelantar 10 s (→)"
              className="flex h-11 w-11 items-center justify-center rounded-full text-white/90 transition hover:scale-105 hover:bg-white/14 cursor-pointer"
            >
              <RotateCw className="h-5 w-5" />
            </button>
          </div>

          {/* Right: Speed, Subtitles, Episodes, Sources, PiP, Fullscreen */}
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
                setSpeed(next);
                notify(`Velocidad ${next}x`);
              }}
              title="Velocidad"
              className="flex h-10 min-w-[44px] items-center justify-center rounded-full px-2.5 text-[13.5px] font-bold text-white transition hover:bg-white/14 cursor-pointer"
            >
              {speed}x
            </button>

            {audioTracks.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setAudioOpen((v) => !v);
                  setSubsOpen(false);
                  setEpisodesOpen(false);
                }}
                title="Pistas de audio"
                className={`flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-white/14 cursor-pointer ${
                  audioOpen ? 'bg-white/18 text-white' : 'text-white/90'
                }`}
              >
                <AudioLines className="h-5 w-5" />
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setSubsOpen((v) => !v);
                setAudioOpen(false);
                setEpisodesOpen(false);
              }}
              title="Subtítulos (C)"
              className={`flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-white/14 cursor-pointer ${
                activeSubId !== 'off' ? 'bg-white/18 text-white' : 'text-white/90'
              }`}
            >
              <Captions className="h-5 w-5" />
            </button>

            {allEpisodes.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setEpisodesOpen((v) => !v);
                  setSubsOpen(false);
                }}
                title="Episodios"
                className="flex h-11 w-11 items-center justify-center rounded-full text-white/90 transition hover:bg-white/14 cursor-pointer"
              >
                <ListVideo className="h-5 w-5" />
              </button>
            )}

            {rankedSources.length > 0 && !offlineUrl && (
              <button
                type="button"
                onClick={() => setSourcesOpen(true)}
                title="Cambiar fuente"
                className="flex h-11 w-11 items-center justify-center rounded-full text-white/90 transition hover:bg-white/14 cursor-pointer"
              >
                <Shuffle className="h-5 w-5" />
              </button>
            )}


            <button
              type="button"
              onClick={() => void togglePiP()}
              title="Ventana flotante (P)"
              className="flex h-11 w-11 items-center justify-center rounded-full text-white/90 transition hover:bg-white/14 cursor-pointer"
            >
              <PictureInPicture2 className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={onToggleFullscreen}
              title="Pantalla completa (F)"
              className="flex h-11 w-11 items-center justify-center rounded-full text-white/90 transition hover:bg-white/14 cursor-pointer"
            >
              {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Audio Tracks Drawer (Multi-audio MKV / MP4) */}
      {audioOpen && audioTracks.length > 0 && (
        <div className="ot-fade-up absolute top-0 right-0 bottom-0 z-40 flex w-[360px] flex-col border-l border-white/10 bg-[#101014]/95 shadow-[-30px_0_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
          <div className="flex items-center justify-between border-b border-white/[0.08] px-6 py-5">
            <h3 className="font-display text-[19px] font-bold text-white">Pistas de audio</h3>
            <button
              type="button"
              onClick={() => setAudioOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.08] text-white hover:bg-white/18 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="ot-scroll flex-1 space-y-1 overflow-y-auto p-4">
            {audioTracks.map((tr) => (
              <button
                key={tr.index}
                type="button"
                onClick={() => {
                  if (tr.index !== activeAudioIdx) notify(`Audio: ${tr.label}`);
                  void selectAudioTrack(tr.index);
                }}
                className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition cursor-pointer ${
                  activeAudioIdx === tr.index ? 'bg-white/15 text-white' : 'text-white/75 hover:bg-white/[0.07]'
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold">{tr.label}</div>
                  <div className="truncate text-[12px] text-white/45">
                    Pista {tr.index + 1} · {tr.codec.toUpperCase()}
                    {tr.channels ? ` · ${tr.channels}` : ''}
                  </div>
                </div>
                {activeAudioIdx === tr.index && <span className="ml-2 text-[#7ee2a8]">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Subtitles Drawer */}
      {subsOpen && (
        <div className="ot-fade-up absolute top-0 right-0 bottom-0 z-40 flex w-[360px] flex-col border-l border-white/10 bg-[#101014]/95 shadow-[-30px_0_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
          <div className="flex items-center justify-between border-b border-white/[0.08] px-6 py-5">
            <h3 className="font-display text-[19px] font-bold text-white">Subtítulos</h3>
            <button
              type="button"
              onClick={() => setSubsOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.08] text-white hover:bg-white/18 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center justify-between border-b border-white/[0.08] px-6 py-3.5 text-[13px]">
            <span className="text-white/65">Sincronía</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onUpdateSubtitleStyle((s) => ({ ...s, delayMs: s.delayMs - 500 }))}
                className="rounded-lg bg-white/10 px-2.5 py-1 font-bold text-white hover:bg-white/20 cursor-pointer"
              >
                -0.5 s
              </button>
              <span className="w-12 text-center font-semibold tabular-nums text-white">
                {(playbackPrefs.subtitleStyle.delayMs / 1000).toFixed(1)}s
              </span>
              <button
                type="button"
                onClick={() => onUpdateSubtitleStyle((s) => ({ ...s, delayMs: s.delayMs + 500 }))}
                className="rounded-lg bg-white/10 px-2.5 py-1 font-bold text-white hover:bg-white/20 cursor-pointer"
              >
                +0.5 s
              </button>
            </div>
          </div>

          <div className="space-y-2.5 border-b border-white/[0.08] px-5 py-3.5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void searchMoreSubtitles();
              }}
              className="flex items-center gap-2"
            >
              <input
                value={subQuery}
                onChange={(e) => setSubQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder={item.title}
                className="h-9 min-w-0 flex-1 rounded-lg border border-white/12 bg-white/[0.06] px-3 text-[13px] text-white placeholder:text-white/35 outline-none focus:border-white/35"
              />
              <button
                type="submit"
                disabled={subSearching}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-white/12 px-3 text-[12.5px] font-bold text-white hover:bg-white/20 cursor-pointer disabled:opacity-50"
              >
                <Search className={`h-3.5 w-3.5 ${subSearching ? 'animate-pulse' : ''}`} />
                <span>{subSearching ? 'Buscando…' : 'Buscar'}</span>
              </button>
            </form>
            <button
              type="button"
              onClick={() => subFileInputRef.current?.click()}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-white/12 bg-white/[0.05] text-[12.5px] font-semibold text-white/85 hover:bg-white/12 cursor-pointer"
            >
              <FileUp className="h-3.5 w-3.5" />
              <span>Cargar archivo .srt / .vtt / .ass</span>
            </button>
            <input
              ref={subFileInputRef}
              type="file"
              accept=".srt,.vtt,.ass,.ssa,.sub,.txt"
              onChange={loadLocalSubtitleFile}
              className="hidden"
            />
          </div>

          <div className="ot-scroll flex-1 space-y-1 overflow-y-auto p-4">
            <button
              type="button"
              onClick={() => {
                if (activeSubId !== 'off') notify('Subtítulos desactivados');
                void selectSubtitle(null);
              }}
              className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-[14px] font-semibold cursor-pointer ${
                activeSubId === 'off' ? 'bg-white/15 text-white' : 'text-white/75 hover:bg-white/[0.07]'
              }`}
            >
              <span>Desactivados</span>
              {activeSubId === 'off' && <span className="text-[#7ee2a8]">✓</span>}
            </button>

            {loadingSub && <div className="px-4 py-2 text-[13px] text-white/55">Cargando subtítulo…</div>}

            {allSubs.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  if (activeSubId !== s.id) notify(`Subtítulos: ${s.label}`);
                  void selectSubtitle(s);
                }}
                className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition cursor-pointer ${
                  activeSubId === s.id ? 'bg-white/15 text-white' : 'text-white/75 hover:bg-white/[0.07]'
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold">
                    {s.label} #{idx + 1}
                  </div>
                  <div className="truncate text-[12px] text-white/45">{s.source}</div>
                </div>
                {activeSubId === s.id && <span className="text-[#7ee2a8]">✓</span>}
              </button>
            ))}

            {allSubs.length === 0 && (
              <div className="px-4 py-8 text-center text-[13.5px] text-white/50">
                No hay subtítulos todavía. Usa «Buscar» o carga un archivo de tu equipo.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Exact Right Slide-In Episodes Panel (`06-ventana-arranque.css:151-219`) */}
      {episodesOpen && allEpisodes.length > 0 && (
        <div className="ot-fade-up absolute top-0 right-0 bottom-0 z-40 flex w-[430px] flex-col border-l border-white/10 bg-[#101014]/95 px-6 pt-7 pb-5 shadow-[-30px_0_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="line-clamp-2 font-display text-[22px] leading-tight font-bold text-white">{item.title}</h3>
              <p className="mt-1 text-[13.5px] text-white/55">Temporada {epSeasonFilter}</p>
            </div>
            <button
              type="button"
              onClick={() => setEpisodesOpen(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.08] text-white hover:bg-white/18 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {seasons.length > 1 && (
            <div className="ot-no-scrollbar mb-4 flex gap-2 overflow-x-auto pb-1">
              {seasons.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setEpSeasonFilter(s)}
                  style={
                    s === epSeasonFilter ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' } : undefined
                  }
                  className={`h-9 shrink-0 rounded-full px-4 text-[13px] font-semibold transition cursor-pointer ${
                    s === epSeasonFilter ? '' : 'border border-white/10 bg-white/[0.06] text-white/80 hover:bg-white/12'
                  }`}
                >
                  Temporada {s}
                </button>
              ))}
            </div>
          )}

          <div className="ot-scroll flex-1 space-y-2 overflow-y-auto pr-1">
            {allEpisodes
              .filter((e) => e.season === epSeasonFilter)
              .map((ep) => {
                const current = Boolean(episode && ep.season === episode.season && ep.number === episode.number);
                return (
                  <button
                    key={ep.id}
                    type="button"
                    onClick={() => {
                      setEpisodesOpen(false);
                      if (current) return;
                      onSwitchSession({ item, episode: ep, allEpisodes, chosen: null, ranked: [] });
                    }}
                    className={`flex w-full items-center gap-3.5 rounded-[14px] border px-3.5 py-3 text-left transition cursor-pointer ${
                      current
                        ? 'border-white/28 bg-white/[0.13]'
                        : 'border-transparent bg-white/[0.04] hover:bg-white/[0.09]'
                    }`}
                  >
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-[17px] font-bold ${
                        current ? 'bg-white text-[#0e0e11]' : 'bg-white/[0.08] text-white'
                      }`}
                    >
                      {ep.number}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14.5px] font-semibold text-white">{ep.title}</div>
                      {ep.overview && (
                        <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-white/55">{ep.overview}</div>
                      )}
                    </div>
                    {current && (
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#0e0e11]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#e50914]" />
                        Viendo
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {sourcesOpen && (
        <SourcePickerModal
          title={titleHeading}
          sources={rankedSources}
          loading={searchPending}
          onSelect={(src) => {
            setSourcesOpen(false);
            if (src.id !== activeSource?.id) notify('Cambiando de fuente…');
            awaitingPickRef.current = false;
            setErrorMsg('');
            setLoading(true);
            sourceIndexRef.current = Math.max(0, rankedSources.findIndex((s) => s.id === src.id));
            // A manual pick starts a fresh fallback chain from that source.
            triedSourceIdsRef.current = new Set([src.id]);
            failedHostsRef.current = new Set();
            lastFailureRefusedRef.current = false;
            setActiveSource(src);
          }}
          onClose={() => setSourcesOpen(false)}
        />
      )}
    </div>
  );
};
