import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  ArrowLeft,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  LayoutGrid,
  List,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Star,
  Tv,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { EpgNowNext, EpgProgram, LiveChannel, M3uPlaylist } from '../types/models';
import {
  epgKeyOf,
  loadChannelSchedule12h,
  loadEpgNowNext,
  loadLiveChannels,
  loadSupplementNowNext,
  nowNextFromSchedule,
  peekEpgNowNext,
  peekLiveChannels,
  resolveLiveStream,
} from '../services/liveTv';
import {
  buildProgrammeCards,
  channelMonogram,
  fmtHour,
  isPlaceholderGuide,
  programmeProgress,
} from '../services/liveSchedule';
import { resizedImageUrl } from '../services/tauri';
import { LiveSelect, type LiveSelectOption } from '../components/LiveSelect';

interface LiveTvScreenProps {
  playlists: M3uPlaylist[];
  favoriteUrls: string[];
  recentChannels: LiveChannel[];
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onToggleFavorite: (url: string) => void;
  onRecordRecent: (ch: LiveChannel) => void;
  onOpenPlugins: () => void;
  onToast: (msg: string) => void;
}

function programProgress(p: EpgProgram | undefined): number {
  return programmeProgress(p, Date.now());
}

const SCHEDULE_TTL_MS = 10 * 60_000;
const ALL_PLAYLISTS = 'all';
const NO_PROGRAMMES: EpgProgram[] = [];

/**
 * Live TV, design "C":
 * - LEFT: 16:9 player (max 540 px tall, red `EN VIVO` pill) and, under it, the current channel's
 *   header with the playback controls plus today's programme cards (AHORA · DESPUÉS · next two).
 * - RIGHT: channel panel (playlist/category selects, search, numbered channel rows with `VIENDO`).
 * - Fullscreen: the same player fills the screen with the `pi-v2` HUD and slide-in channel drawer.
 */
export const LiveTvScreen: React.FC<LiveTvScreenProps> = ({
  playlists,
  favoriteUrls,
  recentChannels,
  isFullscreen,
  onToggleFullscreen,
  onToggleFavorite,
  onRecordRecent,
  onOpenPlugins,
  onToast,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const triedProxyRef = useRef<boolean>(false);
  const retryCountRef = useRef<number>(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fsHudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scheduleCacheRef = useRef(new Map<string, { at: number; items: EpgProgram[] }>());
  const scheduleReqRef = useRef<string>('');

  // Seed from the in-memory cache so re-entering the tab renders instantly.
  const [channels, setChannels] = useState<LiveChannel[]>(() => peekLiveChannels(playlists)?.channels || []);
  const [epgMap, setEpgMap] = useState<Record<string, EpgNowNext>>(() => {
    const cached = peekLiveChannels(playlists);
    return (cached && peekEpgNowNext(cached.epgUrls)) || {};
  });
  const [loading, setLoading] = useState<boolean>(() => !peekLiveChannels(playlists));
  const [activeChannel, setActiveChannel] = useState<LiveChannel | null>(null);
  const [prevChannel, setPrevChannel] = useState<LiveChannel | null>(null);
  const [streamStatus, setStreamStatus] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const [paused, setPaused] = useState<boolean>(false);
  const [reloadNonce, setReloadNonce] = useState<number>(0);

  const [selectedPlaylist, setSelectedPlaylist] = useState<string>(ALL_PLAYLISTS);
  const [selectedGroup, setSelectedGroup] = useState<string>('Todos');
  const [query, setQuery] = useState<string>('');
  const [volume, setVolume] = useState<number>(0.85);
  const [muted, setMuted] = useState<boolean>(false);

  const [guideOpen, setGuideOpen] = useState<boolean>(false);
  const [guideGroup, setGuideGroup] = useState<string>('Todos');
  const [guideQuery, setGuideQuery] = useState<string>('');

  const [scheduleOpen, setScheduleOpen] = useState<boolean>(false);
  const [scheduleItems, setScheduleItems] = useState<EpgProgram[]>([]);
  const [loadingSchedule, setLoadingSchedule] = useState<boolean>(false);
  // Today's schedule of the playing channel (programme cards under the player).
  const [channelSchedule, setChannelSchedule] = useState<{ url: string; items: EpgProgram[] } | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const [fsDrawerOpen, setFsDrawerOpen] = useState<boolean>(false);
  const [fsHudVisible, setFsHudVisible] = useState<boolean>(true);

  const [listReloadNonce, setListReloadNonce] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    const force = listReloadNonce > 0;
    if (force || !peekLiveChannels(playlists)) setLoading(true);
    loadLiveChannels(playlists, force).then(async ({ channels: list, epgUrls }) => {
      if (!alive) return;
      setChannels(list);
      setLoading(false);
      if (list.length > 0 && !activeChannel) {
        const startCh = recentChannels.find((r) => list.some((c) => c.url === r.url)) || list[0];
        setActiveChannel(startCh);
      }
      if (epgUrls.length > 0 && list.length > 0) {
        const epg = await loadEpgNowNext(epgUrls, list, force);
        if (!alive) return;
        setEpgMap(epg);
        // Placeholder-only guides ("Azteca UNO -1" every hour) get the supplementary guide.
        const patch = await loadSupplementNowNext(list, epg).catch(() => ({}));
        if (alive && Object.keys(patch).length > 0) setEpgMap((m) => ({ ...m, ...patch }));
      }
    });
    return () => {
      alive = false;
    };
  }, [playlists, listReloadNonce]);

  // Keeps the "AHORA" progress bar and the card roll-over current.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => {
      clearInterval(id);
      // The fullscreen HUD auto-hide timer must not outlive the screen.
      if (fsHudTimerRef.current) clearTimeout(fsHudTimerRef.current);
    };
  }, []);

  // Load (debounced, cached) the schedule of the playing channel for the programme cards.
  useEffect(() => {
    if (!activeChannel) return;
    const ch = activeChannel;
    const hit = scheduleCacheRef.current.get(ch.url);
    if (hit && Date.now() - hit.at < SCHEDULE_TTL_MS) {
      setChannelSchedule({ url: ch.url, items: hit.items });
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      loadChannelSchedule12h(ch)
        .then((items) => {
          scheduleCacheRef.current.set(ch.url, { at: Date.now(), items });
          if (!alive) return;
          setChannelSchedule({ url: ch.url, items });
          // Without its own (real) now/next, the channel row shows the schedule's (supplementary) one.
          const pair = nowNextFromSchedule(items);
          if (pair) {
            const key = epgKeyOf(ch);
            setEpgMap((m) => {
              const own = m[key];
              const names = [ch.name, ch.tvgName].filter(Boolean);
              if (own && !isPlaceholderGuide(names, [own.now, own.next])) return m;
              if (own && isPlaceholderGuide(names, [pair.now, pair.next])) return m;
              return { ...m, [key]: pair };
            });
          }
        })
        .catch(() => {
          if (alive) setChannelSchedule({ url: ch.url, items: [] });
        });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [activeChannel]);

  const epgFor = useCallback(
    (ch: LiveChannel | null): EpgNowNext | undefined => {
      if (!ch) return undefined;
      const k1 = ch.tvgId.toLowerCase();
      const k2 = ch.tvgName.toLowerCase();
      return (k1 && epgMap[k1]) || (k2 && epgMap[k2]) || epgMap[`url:${ch.url.toLowerCase()}`] || undefined;
    },
    [epgMap],
  );

  const selectChannel = useCallback((ch: LiveChannel) => {
    setActiveChannel((cur) => {
      if (cur && cur.url !== ch.url) setPrevChannel(cur);
      return ch;
    });
  }, []);

  // Start stream with automatic CORS proxy fallback + silent exponential backoff (2s -> 4s -> 8s)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeChannel) return;

    let alive = true;
    triedProxyRef.current = false;
    retryCountRef.current = 0;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setStreamStatus('loading');
    setPaused(false);
    onRecordRecent(activeChannel);

    const startStream = async (forceProxy: boolean) => {
      const url = await resolveLiveStream(activeChannel, forceProxy);
      if (!alive || !videoRef.current) return;

      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      const fallbackOrReconnect = () => {
        if (!alive) return;
        if (!triedProxyRef.current) {
          triedProxyRef.current = true;
          void startStream(true);
          return;
        }
        if (retryCountRef.current < 3) {
          retryCountRef.current += 1;
          const delayMs = [2000, 4000, 8000][retryCountRef.current - 1] || 8000;
          setStreamStatus('loading');
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => {
            if (alive) void startStream(true);
          }, delayMs);
        } else {
          setStreamStatus('error');
        }
      };

      const isHls = /\.m3u8(\?|$)/i.test(url) || url.includes('/hls/') || !/\.(mp4|mkv|webm)(\?|$)/i.test(url);
      if (isHls && Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          liveSyncDurationCount: 3,
          startFragPrefetch: true,
          backBufferLength: 15,
        });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_ev, data) => {
          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) fallbackOrReconnect();
            else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
            else fallbackOrReconnect();
          }
        });
      } else {
        video.src = url;
        video.onerror = () => fallbackOrReconnect();
        video.load();
        video.play().catch(() => {});
      }
    };

    void startStream(false);
    return () => {
      alive = false;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [activeChannel, reloadNonce]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = muted;
  }, [volume, muted]);

  // Playlist scope: only offered when more than one list is enabled.
  const enabledPlaylists = useMemo(() => playlists.filter((p) => p.enabled && p.url), [playlists]);
  const playlistScope = enabledPlaylists.length > 1 && enabledPlaylists.some((p) => p.id === selectedPlaylist)
    ? selectedPlaylist
    : ALL_PLAYLISTS;

  const scopedChannels = useMemo(
    () => (playlistScope === ALL_PLAYLISTS ? channels : channels.filter((c) => c.playlistId === playlistScope)),
    [channels, playlistScope],
  );
  const scopedRecents = useMemo(
    () => (playlistScope === ALL_PLAYLISTS ? recentChannels : recentChannels.filter((c) => c.playlistId === playlistScope)),
    [playlistScope, recentChannels],
  );

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of scopedChannels) counts.set(c.group, (counts.get(c.group) || 0) + 1);
    return counts;
  }, [scopedChannels]);

  const m3uGroups = useMemo(
    () => Array.from(groupCounts.keys()).sort((a, b) => a.localeCompare(b, 'es')),
    [groupCounts],
  );

  const allGroups = useMemo(() => ['Todos', 'Favoritos', 'Recientes', ...m3uGroups], [m3uGroups]);
  const groupScope = allGroups.includes(selectedGroup) ? selectedGroup : 'Todos';

  const groupOptions = useMemo<LiveSelectOption[]>(
    () => [
      { value: 'Todos', label: 'Todos', count: scopedChannels.length },
      { value: 'Favoritos', label: 'Favoritos', count: scopedChannels.filter((c) => favoriteUrls.includes(c.url)).length },
      { value: 'Recientes', label: 'Recientes', count: scopedRecents.length },
      ...m3uGroups.map((g) => ({ value: g, label: g, count: groupCounts.get(g) || 0 })),
    ],
    [favoriteUrls, groupCounts, m3uGroups, scopedChannels, scopedRecents.length],
  );

  const playlistOptions = useMemo<LiveSelectOption[] | null>(() => {
    if (enabledPlaylists.length < 2) return null;
    return [
      { value: ALL_PLAYLISTS, label: 'Todas las listas', count: channels.length },
      ...enabledPlaylists.map((p) => ({
        value: p.id,
        label: p.name || 'Lista M3U',
        count: channels.filter((c) => c.playlistId === p.id).length,
      })),
    ];
  }, [channels, enabledPlaylists]);

  const filterList = useCallback(
    (grp: string, q: string) => {
      const ql = q.trim().toLowerCase();
      let base = scopedChannels;
      if (grp === 'Favoritos') base = scopedChannels.filter((c) => favoriteUrls.includes(c.url));
      else if (grp === 'Recientes') base = scopedRecents;
      else if (grp !== 'Todos') base = scopedChannels.filter((c) => c.group === grp);
      if (!ql) return base;
      return base.filter(
        (c) =>
          c.name.toLowerCase().includes(ql) ||
          c.group.toLowerCase().includes(ql) ||
          Boolean(epgFor(c)?.now?.title?.toLowerCase().includes(ql)),
      );
    },
    [epgFor, favoriteUrls, scopedChannels, scopedRecents],
  );

  const visibleChannels = useMemo(() => filterList(groupScope, query), [filterList, groupScope, query]);
  const guideChannels = useMemo(() => filterList(guideGroup, guideQuery), [filterList, guideGroup, guideQuery]);

  // Stable channel numbers: position in the full (all playlists) list.
  const channelNumbers = useMemo(() => new Map(channels.map((c, i) => [c.url, i + 1])), [channels]);
  const numberWidth = `${Math.max(2, String(channels.length).length) * 7 + 2}px`;

  const activeSchedule = channelSchedule && activeChannel && channelSchedule.url === activeChannel.url
    ? channelSchedule.items
    : NO_PROGRAMMES;
  const scheduleLoading = Boolean(activeChannel && channelSchedule?.url !== activeChannel.url);
  const activeEpg = epgFor(activeChannel);
  const programmeCards = useMemo(
    () => buildProgrammeCards(activeSchedule, activeEpg, nowMs),
    [activeEpg, activeSchedule, nowMs],
  );

  const zapChannel = useCallback(
    (dir: -1 | 1) => {
      if (visibleChannels.length < 2 || !activeChannel) return;
      const idx = visibleChannels.findIndex((c) => c.url === activeChannel.url);
      const nextIdx = (idx + dir + visibleChannels.length) % visibleChannels.length;
      selectChannel(visibleChannels[nextIdx]);
    },
    [activeChannel, selectChannel, visibleChannels],
  );

  const togglePause = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      setPaused(false);
    } else {
      v.pause();
      setPaused(true);
    }
  }, []);

  const wakeFsHud = useCallback(() => {
    setFsHudVisible(true);
    if (fsHudTimerRef.current) clearTimeout(fsHudTimerRef.current);
    fsHudTimerRef.current = setTimeout(() => {
      setFsHudVisible(false);
    }, 3200);
  }, []);

  const channelRows = useCallback(
    () => Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-ch]') ?? []),
    [],
  );

  // Moves keyboard focus into the channel list (playing row, else the first one).
  const focusChannelList = useCallback(() => {
    const rows = channelRows();
    const target = rows.find((r) => r.dataset.ch === activeChannel?.url) || rows[0];
    target?.focus();
  }, [activeChannel, channelRows]);

  // Up/Down/Home/End move between channel rows; Enter (native button click) plays.
  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) return;
    const rows = channelRows();
    if (rows.length === 0) return;
    const idx = rows.indexOf(document.activeElement as HTMLButtonElement);
    let next = idx;
    if (e.key === 'ArrowDown') next = Math.min(rows.length - 1, idx + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, idx - 1);
    else if (e.key === 'PageDown') next = Math.min(rows.length - 1, idx + 8);
    else if (e.key === 'PageUp') next = Math.max(0, idx - 8);
    else if (e.key === 'Home') next = 0;
    else next = rows.length - 1;
    e.preventDefault();
    e.stopPropagation();
    rows[next]?.focus();
    rows[next]?.scrollIntoView({ block: 'nearest' });
  };

  // Keep the playing channel visible in the list (zapping, guide, recents).
  useEffect(() => {
    if (isFullscreen || !activeChannel) return;
    const row = channelRows().find((r) => r.dataset.ch === activeChannel.url);
    row?.scrollIntoView({ block: 'nearest' });
  }, [activeChannel, channelRows, isFullscreen, groupScope, playlistScope]);

  // Keyboard shortcuts (G = Guide, M = mute, Space = pause, Up/Down = zap in fullscreen / list in window)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        setGuideOpen((o) => !o);
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        setMuted((m) => !m);
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePause();
      } else if ((e.key === '0' || e.key === 'Backspace') && prevChannel) {
        e.preventDefault();
        selectChannel(prevChannel);
        if (isFullscreen) wakeFsHud();
      } else if (isFullscreen && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        zapChannel(e.key === 'ArrowDown' ? 1 : -1);
        wakeFsHud();
      } else if (!isFullscreen && !guideOpen && !scheduleOpen && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (listRef.current?.contains(document.activeElement)) return;
        e.preventDefault();
        focusChannelList();
      } else if (e.key === 'Escape') {
        if (guideOpen) setGuideOpen(false);
        else if (scheduleOpen) setScheduleOpen(false);
        else if (fsDrawerOpen) setFsDrawerOpen(false);
        else if (isFullscreen) onToggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusChannelList, fsDrawerOpen, guideOpen, isFullscreen, onToggleFullscreen, prevChannel, scheduleOpen, selectChannel, togglePause, wakeFsHud, zapChannel]);

  const openSchedule = async () => {
    if (!activeChannel) return;
    const ch = activeChannel;
    setScheduleOpen(true);
    scheduleReqRef.current = ch.url;
    const hit = scheduleCacheRef.current.get(ch.url);
    if (hit && Date.now() - hit.at < SCHEDULE_TTL_MS) {
      setScheduleItems(hit.items);
      setLoadingSchedule(false);
      return;
    }
    setLoadingSchedule(true);
    const items = await loadChannelSchedule12h(ch).catch(() => [] as EpgProgram[]);
    scheduleCacheRef.current.set(ch.url, { at: Date.now(), items });
    // A later request (another channel's guide) wins over this one.
    if (scheduleReqRef.current !== ch.url) return;
    setScheduleItems(items);
    setLoadingSchedule(false);
  };

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div
          style={{ borderTopColor: 'var(--ot-accent)' }}
          className="h-9 w-9 animate-spin rounded-full border-2 border-fg/15"
        />
      </div>
    );
  }

  if (channels.length === 0) {
    const hasEnabled = playlists.some((p) => p.enabled && p.url);
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-8 text-center">
        <Tv className="h-12 w-12 text-fg/35 light:text-faint" />
        <div className="font-display text-[22px] font-bold text-fg">
          {hasEnabled ? 'No se pudieron cargar los canales' : 'Sin listas de TV en vivo'}
        </div>
        <p className="max-w-md text-[14px] text-fg/55 light:text-muted">
          {hasEnabled
            ? 'Revisa tu conexión o vuelve a intentar cargar tus listas M3U configuradas.'
            : 'Agrega una lista M3U gratuita o propia desde Plugins para ver canales en vivo con guía de programación.'}
        </p>
        <div className="flex items-center gap-3">
          {hasEnabled && (
            <button
              type="button"
              onClick={() => setListReloadNonce((n) => n + 1)}
              className="rounded-xl border border-fg/15 bg-fg/[0.08] px-5 py-2.5 text-[14px] font-semibold text-fg transition hover:bg-fg/15 cursor-pointer"
            >
              Reintentar
            </button>
          )}
          <button
            type="button"
            onClick={onOpenPlugins}
            style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
            className="rounded-xl px-6 py-2.5 text-[14px] font-bold cursor-pointer"
          >
            Ir a Plugins
          </button>
        </div>
      </div>
    );
  }

  const activeChannelIndex = activeChannel ? channelNumbers.get(activeChannel.url) || 0 : 0;
  const isFav = activeChannel ? favoriteUrls.includes(activeChannel.url) : false;
  const nowCard = programmeCards.find((c) => c.kind === 'now');
  const nextCard = programmeCards.find((c) => c.kind === 'next');
  const epgLine = [
    nowCard ? `Ahora: ${nowCard.title}` : activeEpg?.now ? `Ahora: ${activeEpg.now.title}` : null,
    nextCard ? `Después: ${nextCard.title}` : activeEpg?.next ? `Después: ${activeEpg.next.title}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');
  // Vertical room kept under the player for the programme header + cards (or the quiet empty line).
  const programmeReserve = programmeCards.length > 0 ? 182 : 86;
  const ctrlBtn =
    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fg/[0.08] text-fg transition hover:bg-fg/[0.16] cursor-pointer';

  return (
    <div
      style={
        isFullscreen
          ? undefined
          : {
              paddingLeft: 'var(--ot-gutter)',
              paddingRight: 'var(--ot-gutter)',
              gridTemplateColumns: 'minmax(0, 1fr) clamp(280px, 28vw, 400px)',
            }
      }
      className={`h-full w-full overflow-hidden ${
        isFullscreen ? 'bg-black' : 'grid grid-rows-[minmax(0,1fr)] gap-[18px] xl:gap-[22px] pt-[78px] lg:pt-[86px] pb-5 lg:pb-6'
      }`}
    >
      {/* LEFT: player + programme of the current channel. The <video> keeps its tree position in fullscreen. */}
      <div
        style={isFullscreen ? undefined : { containerType: 'size' }}
        className={isFullscreen ? 'h-full w-full' : 'flex min-h-0 min-w-0 flex-col gap-[18px]'}
      >
        {/* The live player and its fullscreen HUD keep the dark palette in every theme. */}
        <section
          aria-label="Reproductor"
          data-theme="dark"
          onMouseMove={isFullscreen ? wakeFsHud : undefined}
          style={
            isFullscreen
              ? undefined
              : { height: `min(540px, calc(100cqh - ${programmeReserve}px), calc(100cqw * 0.5625))` }
          }
          className={`relative w-full shrink-0 overflow-hidden bg-black text-white ${
            isFullscreen ? 'h-full' : 'rounded-[18px] border border-fg/[0.06]'
          }`}
        >
          <video
            ref={videoRef}
            onClick={togglePause}
            onDoubleClick={onToggleFullscreen}
            onPlaying={() => {
              retryCountRef.current = 0;
              setStreamStatus('playing');
              setPaused(false);
            }}
            onWaiting={() => setStreamStatus('loading')}
            className="h-full w-full object-contain"
          />

          {/* Solid Red EN VIVO badge (top-left in windowed mode) */}
          {!isFullscreen && (
            <span className="pointer-events-none absolute top-[18px] left-[18px] z-10 rounded-[6px] bg-[#e50914] px-[9px] py-1 text-[11.5px] font-extrabold tracking-[0.6px] text-white uppercase">
              EN VIVO
            </span>
          )}

          {/* Centered Pause Mark */}
          {paused && streamStatus !== 'error' && (
            <button
              type="button"
              onClick={togglePause}
              className="absolute top-1/2 left-1/2 z-10 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-fg/25 bg-page/60 text-fg backdrop-blur-md transition hover:bg-page/80 cursor-pointer"
            >
              <Play className="ml-1 h-9 w-9 fill-current" />
            </button>
          )}

          {/* Loading / Error Overlays */}
          {streamStatus === 'loading' && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/35">
              <div
                style={{ borderTopColor: 'var(--ot-accent)' }}
                className="h-9 w-9 animate-spin rounded-full border-2 border-fg/20"
              />
            </div>
          )}
          {streamStatus === 'error' && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/75 p-6 text-center">
              <div className="text-[15.5px] font-bold text-fg">Señal temporalmente no disponible</div>
              <button
                type="button"
                onClick={() => setReloadNonce((n) => n + 1)}
                style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
                className="rounded-xl px-5 py-2 text-[13.5px] font-bold cursor-pointer"
              >
                Reintentar
              </button>
            </div>
          )}

          {/* Fullscreen Live HUD (`pi-v2`: Top channel + EN VIVO, bottom red "En directo" line + 3-group buttons) */}
          {isFullscreen && activeChannel && (
            <div
              className={`pointer-events-none absolute inset-0 z-20 flex flex-col justify-between transition-opacity duration-200 ${
                fsHudVisible || paused || fsDrawerOpen ? 'opacity-100' : 'opacity-0'
              }`}
              style={{
                background:
                  'linear-gradient(to bottom, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0) 18%), linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.55) 26%, rgba(0,0,0,0) 46%)',
              }}
            >
              {/* Top: Back + Title + EN VIVO */}
              <div className="pointer-events-auto flex items-center gap-4 px-8 pt-6">
                <button
                  type="button"
                  onClick={onToggleFullscreen}
                  aria-label="Salir de pantalla completa"
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-fg/20 bg-surface/65 text-fg backdrop-blur-md hover:bg-fg/20 cursor-pointer"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <span className="truncate font-display text-[24px] font-extrabold text-fg drop-shadow">
                  {activeChannel.name}
                </span>
                <span className="rounded-[7px] bg-[#e5383b] px-2.5 py-1 text-[11.5px] font-extrabold tracking-[0.08em] text-white uppercase">
                  EN VIVO
                </span>
              </div>

              {/* Bottom: Channel info + Red En directo bar + 3-group controls */}
              <div className="pointer-events-auto space-y-4 px-12 pb-7">
                <div className="flex items-center gap-4">
                  <ChannelThumb channel={activeChannel} size="lg" />
                  <div className="min-w-0">
                    <div className="truncate font-display text-[28px] leading-tight font-extrabold text-fg">
                      {activeChannel.name}
                    </div>
                    <div className="truncate text-[14.5px] text-fg/75">
                      Canal {activeChannelIndex} · {activeChannel.group}
                      {epgLine ? ` · ${epgLine}` : ''}
                    </div>
                  </div>
                </div>

                {/* Red Live Line (`pi-liveline`) */}
                <div className="flex items-center gap-4">
                  <div className="relative h-[4px] flex-1 rounded-full bg-[#e5383b]">
                    <span className="absolute top-1/2 -right-1 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-[#e5383b] shadow-[0_0_0_5px_rgba(229,56,59,0.3)]" />
                  </div>
                  <span className="text-[13.5px] font-bold text-fg">En directo</span>
                </div>

                {/* 3-Group Buttons */}
                <div className="grid grid-cols-3 items-center">
                  {/* Left: Volume */}
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setMuted((m) => !m)}
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-fg/10 text-fg hover:bg-fg/20 cursor-pointer"
                    >
                      {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={muted ? 0 : volume}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setVolume(v);
                        setMuted(v === 0);
                      }}
                      className="ot-range w-28 cursor-pointer"
                    />
                    <span className="text-[13px] tabular-nums text-fg/75">
                      {muted || volume === 0 ? '0%' : `${Math.round(volume * 100)}%`}
                    </span>
                  </div>

                  {/* Center: Prev · White Play/Pause · Next */}
                  <div className="flex items-center justify-center gap-3.5">
                    <button
                      type="button"
                      onClick={() => zapChannel(-1)}
                      title="Canal anterior"
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-fg/10 text-fg hover:bg-fg/20 cursor-pointer"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={togglePause}
                      style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
                      className="flex h-14 w-14 items-center justify-center rounded-full shadow-xl transition hover:scale-105 cursor-pointer"
                    >
                      {paused ? <Play className="ml-0.5 h-6 w-6 fill-current" /> : <Pause className="h-6 w-6 fill-current" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => zapChannel(1)}
                      title="Canal siguiente"
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-fg/10 text-fg hover:bg-fg/20 cursor-pointer"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Right: Fav, Guide, Schedule, Channels, Reload, Exit FS */}
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onToggleFavorite(activeChannel.url);
                        onToast(isFav ? 'Quitado de favoritos' : 'Canal guardado en favoritos');
                      }}
                      title="Favorito"
                      className={`flex h-11 w-11 items-center justify-center rounded-full hover:bg-fg/15 cursor-pointer ${
                        isFav ? 'text-[#ffd34d] light:text-[#b45309]' : 'text-fg'
                      }`}
                    >
                      <Star className={`h-5 w-5 ${isFav ? 'fill-current' : ''}`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setGuideOpen(true)}
                      title="Guía de canales (G)"
                      className="flex h-11 w-11 items-center justify-center rounded-full text-fg hover:bg-fg/15 cursor-pointer"
                    >
                      <LayoutGrid className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void openSchedule()}
                      title="Programación 12 h"
                      className="flex h-11 w-11 items-center justify-center rounded-full text-fg hover:bg-fg/15 cursor-pointer"
                    >
                      <CalendarClock className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setFsDrawerOpen((o) => !o)}
                      title="Lista de canales"
                      className="flex h-11 w-11 items-center justify-center rounded-full text-fg hover:bg-fg/15 cursor-pointer"
                    >
                      <List className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setReloadNonce((n) => n + 1)}
                      title="Reintentar"
                      className="flex h-11 w-11 items-center justify-center rounded-full text-fg hover:bg-fg/15 cursor-pointer"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={onToggleFullscreen}
                      title="Salir de pantalla completa"
                      className="flex h-11 w-11 items-center justify-center rounded-full text-fg hover:bg-fg/15 cursor-pointer"
                    >
                      <Minimize2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Fullscreen Slide-In Channel Drawer */}
          {isFullscreen && fsDrawerOpen && (
            <div className="ot-fade-up absolute top-0 right-0 bottom-0 z-30 flex w-96 flex-col border-l border-fg/10 bg-[#111114]/95 backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-fg/[0.08] px-5 py-4">
                <span className="font-display text-[17px] font-bold text-fg">Canales ({visibleChannels.length})</span>
                <button
                  type="button"
                  onClick={() => setFsDrawerOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-fg/65 hover:bg-fg/10 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="ot-scroll flex-1 space-y-1 overflow-y-auto p-3">
                {visibleChannels.map((ch) => {
                  const isCur = activeChannel?.url === ch.url;
                  const epg = epgFor(ch);
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => {
                        selectChannel(ch);
                        setFsDrawerOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition cursor-pointer ${
                        isCur ? 'bg-fg/15 text-fg' : 'text-fg/80 hover:bg-fg/[0.07]'
                      }`}
                    >
                      <ChannelThumb channel={ch} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-semibold">{ch.name}</div>
                        {epg?.now && <div className="truncate text-[12px] text-fg/50 light:text-muted">{epg.now.title}</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Programme of the current channel: header + controls, then AHORA · DESPUÉS · next two */}
        {!isFullscreen && activeChannel && (
          <section aria-label="Programación" className="flex min-h-0 flex-1 flex-col gap-2.5">
            <div className="flex items-center gap-3">
              <ChannelThumb channel={activeChannel} size="xs" />
              <div className="flex min-w-0 flex-1 items-baseline gap-3">
                <span className="truncate text-[17px] font-bold text-fg">
                  {activeChannelIndex > 0 ? `${activeChannelIndex} · ` : ''}
                  {activeChannel.name}
                </span>
                <span className="hidden shrink-0 text-[13px] text-fg/55 light:text-muted xl:inline">Programación de hoy</span>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button type="button" onClick={() => zapChannel(-1)} title="Canal anterior" className={ctrlBtn}>
                  <ChevronLeft className="h-[18px] w-[18px]" />
                </button>
                <button
                  type="button"
                  onClick={togglePause}
                  title={paused ? 'Reproducir' : 'Pausar'}
                  style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:brightness-90 cursor-pointer"
                >
                  {paused ? <Play className="ml-0.5 h-4 w-4 fill-current" /> : <Pause className="h-4 w-4 fill-current" />}
                </button>
                <button type="button" onClick={() => zapChannel(1)} title="Canal siguiente" className={ctrlBtn}>
                  <ChevronRight className="h-[18px] w-[18px]" />
                </button>

                {/* Volume button with hover popup slider */}
                <div className="group/vol relative ml-1 border-l border-fg/[0.12] pl-2.5">
                  <button
                    type="button"
                    onClick={() => setMuted((m) => !m)}
                    title={muted ? 'Activar sonido (M)' : 'Silenciar (M)'}
                    className={ctrlBtn}
                  >
                    {muted || volume === 0 ? <VolumeX className="h-[18px] w-[18px]" /> : <Volume2 className="h-[18px] w-[18px]" />}
                  </button>
                  <div className="pointer-events-none absolute bottom-[44px] left-1/2 z-30 flex -translate-x-1/2 items-center gap-2.5 rounded-[14px] bg-elev px-4 py-3 opacity-0 shadow-[0_16px_40px_rgba(0,0,0,0.55)] ring-1 ring-fg/10 transition group-hover/vol:pointer-events-auto group-hover/vol:opacity-100 group-focus-within/vol:pointer-events-auto group-focus-within/vol:opacity-100">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={muted ? 0 : volume}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setVolume(v);
                        setMuted(v === 0);
                      }}
                      aria-label="Volumen"
                      className="ot-range w-28 cursor-pointer"
                    />
                    <span className="w-8 text-right text-[12px] font-semibold tabular-nums text-fg/80">
                      {muted ? 0 : Math.round(volume * 100)}%
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onToggleFavorite(activeChannel.url);
                    onToast(isFav ? 'Quitado de favoritos' : 'Canal guardado en favoritos');
                  }}
                  title={isFav ? 'Quitar de favoritos' : 'Guardar canal en favoritos'}
                  className={`${ctrlBtn} ${isFav ? '!text-[#ffd34d] light:!text-[#b45309]' : ''}`}
                >
                  <Star className={`h-[18px] w-[18px] ${isFav ? 'fill-current' : ''}`} />
                </button>

                {prevChannel && prevChannel.url !== activeChannel.url && (
                  <button
                    type="button"
                    onClick={() => selectChannel(prevChannel)}
                    title={`Volver a ${prevChannel.name} (0)`}
                    className={ctrlBtn}
                  >
                    <Undo2 className="h-[18px] w-[18px]" />
                  </button>
                )}

                <button type="button" onClick={() => void openSchedule()} title="Programación (12 h)" className={ctrlBtn}>
                  <CalendarClock className="h-[18px] w-[18px]" />
                </button>
                <button type="button" onClick={() => setGuideOpen(true)} title="Guía de canales (G)" className={ctrlBtn}>
                  <LayoutGrid className="h-[18px] w-[18px]" />
                </button>
                <button type="button" onClick={onToggleFullscreen} title="Pantalla completa" className={ctrlBtn}>
                  <Maximize2 className="h-[18px] w-[18px]" />
                </button>
              </div>
            </div>

            {programmeCards.length > 0 ? (
              <div
                className={`grid max-h-[200px] min-h-[116px] flex-1 grid-rows-[minmax(0,1fr)] gap-3 ${
                  programmeCards[0].kind === 'now'
                    ? 'grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))] max-[1100px]:grid-cols-[minmax(0,1.5fr)_repeat(2,minmax(0,1fr))]'
                    : 'grid-cols-[repeat(4,minmax(0,1fr))] max-[1100px]:grid-cols-[repeat(3,minmax(0,1fr))]'
                }`}
              >
                {programmeCards.map((card, i) => {
                  const isNow = card.kind === 'now';
                  return (
                    <article
                      key={card.key}
                      style={isNow ? { borderColor: 'var(--ot-accent)' } : undefined}
                      className={`flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-[14px] px-4 py-3.5 ${
                        isNow ? 'border-[1.5px] bg-fg/[0.09]' : 'border border-fg/[0.07] bg-surface'
                      } ${i === 3 ? 'max-[1100px]:hidden' : ''}`}
                    >
                      <span
                        style={isNow ? { color: 'var(--ot-accent)' } : undefined}
                        className={`text-[11px] font-extrabold tracking-[0.5px] tabular-nums ${isNow ? '' : 'text-fg/55 light:text-muted'}`}
                      >
                        {card.label}
                      </span>
                      <span className="line-clamp-2 text-[15px] leading-[1.25] font-bold text-fg" title={card.title}>
                        {card.title}
                      </span>
                      <span className="truncate text-[12.5px] tabular-nums text-fg/[0.58] light:text-muted">{card.time}</span>
                      {isNow && (
                        <span className="mt-auto block h-1 shrink-0 overflow-hidden rounded-full bg-fg/[0.18]">
                          <span
                            style={{ width: `${card.progress}%`, backgroundColor: 'var(--ot-accent)' }}
                            className="block h-full rounded-full"
                          />
                        </span>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="text-[13.5px] text-fg/50 light:text-muted">
                {scheduleLoading ? 'Cargando programación…' : 'Sin programación para este canal'}
              </div>
            )}
          </section>
        )}
      </div>

      {/* RIGHT: channel panel (playlist + category selects, search, numbered rows) */}
      {!isFullscreen && (
        <aside
          aria-label="Canales"
          className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[18px] border border-fg/[0.07] bg-surface"
        >
          <div className="relative z-20 flex flex-col gap-2.5 border-b border-fg/[0.06] p-3.5">
            {playlistOptions && (
              <LiveSelect
                ariaLabel="Lista de canales"
                value={playlistScope}
                options={playlistOptions}
                onChange={setSelectedPlaylist}
              />
            )}
            <LiveSelect ariaLabel="Categoría" value={groupScope} options={groupOptions} onChange={setSelectedGroup} />
            <label className="flex h-[38px] items-center gap-2 rounded-[10px] border border-transparent bg-elev px-3 text-fg/55 light:text-muted focus-within:border-fg/25">
              <Search className="h-4 w-4 shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    focusChannelList();
                  } else if (e.key === 'Escape' && query) {
                    e.stopPropagation();
                    setQuery('');
                  }
                }}
                placeholder="Buscar canal"
                aria-label="Buscar canal"
                className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] text-fg placeholder-fg/45 light:placeholder-faint outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Borrar búsqueda"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fg/12 text-fg/80 hover:bg-fg/25 cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </label>
          </div>

          <div ref={listRef} onKeyDown={onListKeyDown} className="ot-scroll min-h-0 flex-1 overflow-y-auto p-2">
            {visibleChannels.map((ch) => {
              const isCur = activeChannel?.url === ch.url;
              return (
                <button
                  key={ch.id}
                  data-ch={ch.url}
                  type="button"
                  onClick={() => selectChannel(ch)}
                  title={ch.name}
                  aria-current={isCur ? 'true' : undefined}
                  style={isCur ? { borderColor: 'var(--ot-accent)' } : undefined}
                  className={`mb-[3px] flex w-full items-center gap-3 rounded-[12px] border-[1.5px] px-2.5 py-[7px] text-left text-fg transition cursor-pointer focus:outline-none [contain-intrinsic-size:auto_53px] [content-visibility:auto] ${
                    isCur
                      ? 'bg-fg/[0.09] focus-visible:bg-fg/[0.14]'
                      : 'border-transparent hover:bg-fg/[0.05] focus-visible:border-fg/30 focus-visible:bg-fg/[0.07]'
                  }`}
                >
                  <span
                    style={{ width: numberWidth }}
                    className="shrink-0 text-right text-[12px] tabular-nums text-fg/50 light:text-muted"
                  >
                    {channelNumbers.get(ch.url) || ''}
                  </span>
                  <ChannelThumb channel={ch} size="row" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{ch.name}</span>
                  {favoriteUrls.includes(ch.url) && <Star className="h-3.5 w-3.5 shrink-0 fill-current text-[#ffd34d] light:text-[#b45309]" />}
                  {isCur && (
                    <span
                      style={{ color: 'var(--ot-accent)' }}
                      className="shrink-0 text-[10.5px] font-extrabold tracking-[0.5px]"
                    >
                      VIENDO
                    </span>
                  )}
                </button>
              );
            })}
            {visibleChannels.length === 0 && (
              <div className="py-10 text-center text-[13.5px] text-fg/45 light:text-muted">
                {query ? 'Sin resultados para tu búsqueda.' : 'Sin canales en esta categoría.'}
              </div>
            )}
          </div>
        </aside>
      )}

      {/* =========================================================
          Exact 1:1 Replica of "Guía de canales" Modal (`docs/screenshots/guia.jpg`)
          ========================================================= */}
      {guideOpen && (
        <div
          onClick={() => setGuideOpen(false)}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/68 p-7 backdrop-blur-md"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="ot-fade-up flex h-[86vh] w-full max-w-[1220px] flex-col overflow-hidden rounded-[24px] border border-fg/10 bg-surface/98 shadow-[0_40px_120px_rgba(0,0,0,0.68)]"
          >
            {/* Header (`guia.jpg`) */}
            <div className="flex items-center justify-between gap-4 border-b border-fg/[0.07] px-8 py-5">
              <div>
                <h2 className="font-display text-[26px] font-bold tracking-[-0.02em] text-fg">Guía de canales</h2>
                <p className="mt-0.5 text-[14px] text-fg/50 light:text-muted">
                  {guideGroup} · {guideChannels.length} {guideChannels.length === 1 ? 'canal' : 'canales'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative w-80">
                  <Search className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-fg/45 light:text-muted" />
                  <input
                    type="text"
                    value={guideQuery}
                    onChange={(e) => setGuideQuery(e.target.value)}
                    placeholder="Buscar canal"
                    className="h-11 w-full rounded-[14px] border border-fg/12 bg-fg/[0.06] pr-4 pl-11 text-[15px] text-fg placeholder-fg/45 light:placeholder-faint outline-none focus:border-fg/50 focus:bg-fg/[0.09]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setGuideOpen(false)}
                  aria-label="Cerrar guía"
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-fg/12 bg-fg/[0.06] text-fg hover:bg-fg/16 cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1">
              {/* Left Category Rail (exact `guia.jpg`: white active pill, ☆ Favoritos, ↺ Recientes, CATEGORÍAS) */}
              <div className="ot-scroll w-[225px] shrink-0 overflow-y-auto border-r border-fg/[0.07] px-3.5 py-4">
                <div className="space-y-1">
                  {(
                    [
                      { id: 'Todos', label: 'Todos', icon: null },
                      { id: 'Favoritos', label: 'Favoritos', icon: <Star className="h-4 w-4" /> },
                      { id: 'Recientes', label: 'Recientes', icon: <Clock className="h-4 w-4" /> },
                    ] as const
                  ).map((item) => {
                    const active = guideGroup === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setGuideGroup(item.id)}
                        style={
                          active ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' } : undefined
                        }
                        className={`flex h-10 w-full items-center gap-2.5 rounded-[12px] px-3.5 text-left text-[15px] transition cursor-pointer ${
                          active ? 'font-bold' : 'text-fg/78 hover:bg-fg/[0.07] hover:text-fg'
                        }`}
                      >
                        {item.icon}
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>

                {m3uGroups.length > 0 && (
                  <>
                    <div className="mt-5 mb-2 px-3.5 text-[11.5px] font-bold tracking-[0.1em] text-fg/40 light:text-muted uppercase">
                      CATEGORÍAS
                    </div>
                    <div className="space-y-0.5">
                      {m3uGroups.map((g) => {
                        const active = guideGroup === g;
                        return (
                          <button
                            key={g}
                            type="button"
                            onClick={() => setGuideGroup(g)}
                            style={
                              active ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' } : undefined
                            }
                            className={`flex h-9 w-full items-center rounded-[12px] px-3.5 text-left text-[14.5px] transition cursor-pointer ${
                              active ? 'font-bold' : 'text-fg/75 hover:bg-fg/[0.07] hover:text-fg'
                            }`}
                          >
                            <span className="truncate">{g}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* Right 3-Column Horizontal Channel Cards Grid (exact `guia.jpg`) */}
              <div className="ot-scroll flex-1 overflow-y-auto p-6">
                <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
                  {guideChannels.map((ch) => {
                    const isCur = activeChannel?.url === ch.url;
                    const fav = favoriteUrls.includes(ch.url);
                    const epg = epgFor(ch);
                    return (
                      <div
                        key={ch.id}
                        onClick={() => {
                          selectChannel(ch);
                          setGuideOpen(false);
                        }}
                        className={`group relative flex h-[88px] cursor-pointer items-center gap-3.5 rounded-[16px] border px-3.5 transition hover:-translate-y-0.5 ${
                          isCur
                            ? 'border-fg/55 bg-fg/[0.1]'
                            : 'border-fg/[0.07] bg-fg/[0.045] hover:border-fg/18 hover:bg-fg/[0.09]'
                        }`}
                      >
                        {/* Dark rectangular logo box (`lg-logo`) */}
                        <div className="flex h-[56px] w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-[#0e0e11] p-1.5">
                          {ch.logo ? (
                            <img
                              src={resizedImageUrl(ch.logo, 160)}
                              alt={ch.name}
                              loading="lazy"
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <span className="text-[20px] font-bold text-white/50">
                              {ch.name.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>

                        <div className="min-w-0 flex-1 pr-6">
                          <div className="line-clamp-2 text-[14.5px] leading-tight font-semibold text-fg">
                            {ch.name}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[12px]">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-[#ff4d4f] shadow-[0_0_0_2.5px_rgba(255,77,79,0.2)]" />
                              <span className={isCur ? 'font-semibold text-fg' : 'text-fg/55 light:text-muted'}>
                                {isCur ? 'Viendo ahora' : 'En vivo'}
                              </span>
                            </span>
                          </div>
                          {epg?.now && (
                            <div className="mt-0.5 truncate text-[11.5px] text-fg/70">{epg.now.title}</div>
                          )}
                        </div>

                        {/* Hover Favorite star */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite(ch.url);
                          }}
                          title="Favorito"
                          className={`absolute top-1/2 right-2.5 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-fg/10 transition hover:bg-fg/25 cursor-pointer ${
                            fav ? 'text-[#ffd34d] light:text-[#b45309] opacity-100' : 'text-fg opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          <Star className={`h-4 w-4 ${fav ? 'fill-current' : ''}`} />
                        </button>
                      </div>
                    );
                  })}
                  {guideChannels.length === 0 && (
                    <div className="col-span-full py-16 text-center text-[15px] text-fg/50 light:text-muted">
                      No hay canales para mostrar.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 12-Hour Programación Modal (`11-fuentes-stremio.css:783-805`) */}
      {scheduleOpen && activeChannel && (
        <div
          onClick={() => setScheduleOpen(false)}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="ot-fade-up flex max-h-[82vh] w-full max-w-[680px] flex-col overflow-hidden rounded-[24px] border border-fg/10 bg-surface shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-fg/[0.08] px-7 py-5">
              <div>
                <h3 className="font-display text-[22px] font-bold text-fg">Programación · 12 horas</h3>
                <p className="text-[13.5px] text-fg/55 light:text-muted">{activeChannel.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setScheduleOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-fg/65 hover:bg-fg/10 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="ot-scroll flex-1 space-y-1 overflow-y-auto p-5">
              {loadingSchedule ? (
                <div className="py-12 text-center text-fg/55 light:text-muted">Cargando horarios…</div>
              ) : scheduleItems.length === 0 ? (
                <div className="py-12 text-center text-fg/55 light:text-muted">
                  Este canal no tiene guía XMLTV disponible.
                </div>
              ) : (
                scheduleItems.map((p, i) => {
                  const isNow = Date.now() >= p.startMs && Date.now() < p.endMs;
                  const pct = programProgress(p);
                  return (
                    <div
                      key={`${p.startMs}_${i}`}
                      className={`flex gap-4 rounded-[14px] px-4 py-3.5 ${
                        isNow ? 'bg-fg/[0.08]' : 'hover:bg-fg/[0.04]'
                      }`}
                    >
                      <div className="w-[68px] shrink-0 pt-0.5">
                        <div className="text-[15.5px] font-bold tabular-nums text-fg">{fmtHour(p.startMs)}</div>
                        <div className="text-[12px] tabular-nums text-fg/40 light:text-muted">{fmtHour(p.endMs)}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2.5">
                          <span className="truncate text-[15px] font-semibold text-fg">{p.title}</span>
                          {isNow && (
                            <span className="shrink-0 rounded-full bg-[#e9e7e2] px-2.5 py-0.5 text-[10.5px] font-bold tracking-wider text-[#15151a] uppercase light:bg-fg light:text-page">
                              Ahora
                            </span>
                          )}
                        </div>
                        {p.description && (
                          <p className="mt-1 line-clamp-2 text-[13px] text-fg/55 light:text-muted">{p.description}</p>
                        )}
                        {isNow && (
                          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-fg/12">
                            <div style={{ width: `${pct}%`, backgroundColor: 'var(--ot-accent)' }} className="h-full" />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const THUMB_SIZES = {
  xs: 'h-[34px] w-[34px] rounded-[9px] text-[11px] p-1',
  row: 'h-9 w-9 rounded-[9px] text-[11px] p-1',
  sm: 'h-[44px] w-[44px] rounded-[11px] text-[13px] p-1.5',
  lg: 'h-[66px] w-[66px] rounded-[16px] text-[20px] p-1.5',
} as const;

const ChannelThumb: React.FC<{ channel: LiveChannel; size: keyof typeof THUMB_SIZES }> = ({ channel, size }) => {
  const [failedSrc, setFailedSrc] = useState<string>('');
  const src = useMemo(() => resizedImageUrl(channel.logo, 128), [channel.logo]);
  const cls = THUMB_SIZES[size];
  const failed = Boolean(src) && failedSrc === src;

  if (!src || failed) {
    return (
      <div className={`flex shrink-0 items-center justify-center bg-[#23232b] font-extrabold text-white/85 ${cls}`}>
        {channelMonogram(channel.name)}
      </div>
    );
  }
  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden bg-[#23232b] ${cls}`}>
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailedSrc(src)}
        className="h-full w-full object-contain"
      />
    </div>
  );
};
