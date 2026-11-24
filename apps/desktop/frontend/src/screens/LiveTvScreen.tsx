import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronDown,
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
  loadChannelSchedule12h,
  loadEpgNowNext,
  loadLiveChannels,
  peekEpgNowNext,
  peekLiveChannels,
  resolveLiveStream,
} from '../services/liveTv';
import { resizedImageUrl } from '../services/tauri';

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

function fmtHour(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function programProgress(p: EpgProgram | undefined): number {
  if (!p || !p.startMs || !p.endMs || p.endMs <= p.startMs) return 0;
  return Math.max(0, Math.min(100, ((Date.now() - p.startMs) / (p.endMs - p.startMs)) * 100));
}

/**
 * Exact 1:1 replica of OpenTV v1 Live TV Design "3A" (`home/live-page.js` + `11-fuentes-stremio.css:512-774`)
 * AND full "Guía de canales" modal (`docs/screenshots/guia.jpg`):
 * - LEFT column: Search box + Category Dropdown + clean logo+name channel rows
 * - RIGHT stage: 16:9 rounded video card with red `EN VIVO` pill (no controls covering picture)
 *   + single bottom row (`live-bar3a`): Channel logo/name/EPG on left + round controls on right
 * - Fullscreen mode (`pi-v2`): red `En directo` live line + 3-group bottom bar + slide-in channels drawer.
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

  const [selectedGroup, setSelectedGroup] = useState<string>('Todos');
  const [catMenuOpen, setCatMenuOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [volume, setVolume] = useState<number>(0.85);
  const [muted, setMuted] = useState<boolean>(false);

  const [guideOpen, setGuideOpen] = useState<boolean>(false);
  const [guideGroup, setGuideGroup] = useState<string>('Todos');
  const [guideQuery, setGuideQuery] = useState<string>('');

  const [scheduleOpen, setScheduleOpen] = useState<boolean>(false);
  const [scheduleItems, setScheduleItems] = useState<EpgProgram[]>([]);
  const [loadingSchedule, setLoadingSchedule] = useState<boolean>(false);

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
        if (alive) setEpgMap(epg);
      }
    });
    return () => {
      alive = false;
    };
  }, [playlists, listReloadNonce]);

  const epgFor = useCallback(
    (ch: LiveChannel | null): EpgNowNext | undefined => {
      if (!ch) return undefined;
      const k1 = ch.tvgId.toLowerCase();
      const k2 = ch.tvgName.toLowerCase();
      return (k1 && epgMap[k1]) || (k2 && epgMap[k2]) || undefined;
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

  const m3uGroups = useMemo(() => {
    const set = new Set<string>();
    for (const c of channels) set.add(c.group);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }, [channels]);

  const allGroups = useMemo(() => ['Todos', 'Favoritos', 'Recientes', ...m3uGroups], [m3uGroups]);

  const filterList = useCallback(
    (grp: string, q: string) => {
      const ql = q.trim().toLowerCase();
      let base = channels;
      if (grp === 'Favoritos') base = channels.filter((c) => favoriteUrls.includes(c.url));
      else if (grp === 'Recientes') base = recentChannels;
      else if (grp !== 'Todos') base = channels.filter((c) => c.group === grp);
      if (!ql) return base;
      return base.filter(
        (c) =>
          c.name.toLowerCase().includes(ql) ||
          c.group.toLowerCase().includes(ql) ||
          Boolean(epgFor(c)?.now?.title?.toLowerCase().includes(ql)),
      );
    },
    [channels, epgFor, favoriteUrls, recentChannels],
  );

  const visibleChannels = useMemo(() => filterList(selectedGroup, query), [filterList, query, selectedGroup]);
  const guideChannels = useMemo(() => filterList(guideGroup, guideQuery), [filterList, guideGroup, guideQuery]);

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

  // Keyboard shortcuts (G = Guide, M = mute, Space = pause, Up/Down = zap in fullscreen)
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
      } else if (e.key === 'Escape') {
        if (guideOpen) setGuideOpen(false);
        else if (scheduleOpen) setScheduleOpen(false);
        else if (fsDrawerOpen) setFsDrawerOpen(false);
        else if (catMenuOpen) setCatMenuOpen(false);
        else if (isFullscreen) onToggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [catMenuOpen, fsDrawerOpen, guideOpen, isFullscreen, onToggleFullscreen, prevChannel, scheduleOpen, selectChannel, togglePause, wakeFsHud, zapChannel]);

  const openSchedule = async () => {
    if (!activeChannel) return;
    setScheduleOpen(true);
    setLoadingSchedule(true);
    const items = await loadChannelSchedule12h(activeChannel);
    setScheduleItems(items);
    setLoadingSchedule(false);
  };

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div
          style={{ borderTopColor: 'var(--ot-accent)' }}
          className="h-9 w-9 animate-spin rounded-full border-2 border-white/15"
        />
      </div>
    );
  }

  if (channels.length === 0) {
    const hasEnabled = playlists.some((p) => p.enabled && p.url);
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-8 text-center">
        <Tv className="h-12 w-12 text-white/35" />
        <div className="font-display text-[22px] font-bold text-white">
          {hasEnabled ? 'No se pudieron cargar los canales' : 'Sin listas de TV en vivo'}
        </div>
        <p className="max-w-md text-[14px] text-white/55">
          {hasEnabled
            ? 'Revisa tu conexión o vuelve a intentar cargar tus listas M3U configuradas.'
            : 'Agrega una lista M3U gratuita o propia desde Plugins para ver canales en vivo con guía de programación.'}
        </p>
        <div className="flex items-center gap-3">
          {hasEnabled && (
            <button
              type="button"
              onClick={() => setListReloadNonce((n) => n + 1)}
              className="rounded-xl border border-white/15 bg-white/[0.08] px-5 py-2.5 text-[14px] font-semibold text-white transition hover:bg-white/15 cursor-pointer"
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

  const activeEpg = epgFor(activeChannel);
  const activeChannelIndex = activeChannel ? channels.findIndex((c) => c.url === activeChannel.url) + 1 : 0;
  const isFav = activeChannel ? favoriteUrls.includes(activeChannel.url) : false;
  const epgLine = [
    activeEpg?.now ? `Ahora: ${activeEpg.now.title}` : null,
    activeEpg?.next ? `Después: ${activeEpg.next.title}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <div
      style={
        isFullscreen
          ? undefined
          : { paddingLeft: 'var(--ot-gutter)', paddingRight: 'var(--ot-gutter)' }
      }
      className={`flex h-full w-full overflow-hidden ${isFullscreen ? 'bg-black' : 'gap-4 lg:gap-7 pt-[78px] lg:pt-[86px] pb-5 lg:pb-6'}`}
    >
      {/* =========================================================
          LEFT COLUMN (Design 3A): Search + Category Dropdown + Clean Channel List
          ========================================================= */}
      {!isFullscreen && (
        <aside className="relative flex w-[clamp(220px,24vw,368px)] shrink-0 flex-col gap-3">
          {/* Search box */}
          <div className="relative flex h-[46px] items-center gap-2.5 rounded-[14px] border border-white/[0.12] bg-white/[0.06] px-3.5 focus-within:border-white/45 focus-within:bg-white/[0.09]">
            <Search className="h-4 w-4 shrink-0 text-white/50" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar canal"
              className="h-full min-w-0 flex-1 bg-transparent text-[14.5px] text-white placeholder-white/45 outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-white/12 text-white/80 hover:bg-white/25 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Category Dropdown (`live-cat-btn` / `live-cat-menu`) */}
          <div className="relative z-40">
            <button
              type="button"
              onClick={() => setCatMenuOpen((o) => !o)}
              className={`flex h-[46px] w-full items-center justify-between gap-2 rounded-[14px] border px-4 text-left text-[14.5px] font-semibold text-white transition cursor-pointer ${
                catMenuOpen
                  ? 'border-white/25 bg-white/[0.12]'
                  : 'border-white/[0.1] bg-white/[0.07] hover:bg-white/[0.11]'
              }`}
            >
              <span className="truncate">{selectedGroup}</span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-white/75 transition-transform duration-200 ${
                  catMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {catMenuOpen && (
              <>
                <div onClick={() => setCatMenuOpen(false)} className="fixed inset-0 z-30" />
                <div className="ot-scroll ot-fade-up absolute top-[54px] right-0 left-0 z-40 max-h-[380px] overflow-y-auto rounded-[16px] border border-white/12 bg-[#1c1c22] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.68)]">
                  {allGroups.map((g) => {
                    const active = g === selectedGroup;
                    return (
                      <button
                        key={g}
                        type="button"
                        onClick={() => {
                          setSelectedGroup(g);
                          setCatMenuOpen(false);
                        }}
                        className={`flex h-10 w-full items-center justify-between gap-2 rounded-[10px] px-3 text-left text-[14px] transition cursor-pointer ${
                          active ? 'font-bold text-white' : 'text-white/80 hover:bg-white/[0.08] hover:text-white'
                        }`}
                      >
                        <span className="truncate">{g}</span>
                        {active && <Check className="h-4 w-4 shrink-0 text-white" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Clean Channel Rows (logo + name only, exact `11-fuentes-stremio.css:589`) */}
          <div className="ot-scroll min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {visibleChannels.map((ch) => {
              const isCur = activeChannel?.url === ch.url;
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => selectChannel(ch)}
                  className={`flex h-[60px] w-full items-center gap-3.5 rounded-[14px] px-3 text-left transition cursor-pointer ${
                    isCur ? 'bg-white/[0.13] text-white' : 'text-white/88 hover:bg-white/[0.06]'
                  }`}
                >
                  <ChannelThumb channel={ch} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{ch.name}</span>
                </button>
              );
            })}
            {visibleChannels.length === 0 && (
              <div className="py-10 text-center text-[13.5px] text-white/45">Sin canales en esta categoría.</div>
            )}
          </div>
        </aside>
      )}

      {/* =========================================================
          RIGHT STAGE (Design 3A): 16:9 Video Card + Under-bar (`live-bar3a`)
          ========================================================= */}
      <div
        onMouseMove={isFullscreen ? wakeFsHud : undefined}
        className={`relative flex min-w-0 flex-1 flex-col ${isFullscreen ? 'h-full w-full bg-black' : 'justify-center'}`}
      >
        {/* 16:9 Rounded Video Frame */}
        <div
          className={`relative w-full overflow-hidden bg-black ${
            isFullscreen
              ? 'h-full'
              : 'aspect-video max-h-[calc(100%-86px)] rounded-[20px] shadow-[0_30px_70px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.07]'
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
            <span className="pointer-events-none absolute top-4 left-4 z-10 rounded-[7px] bg-[#e5383b] px-2.5 py-1 text-[11.5px] font-extrabold tracking-[0.08em] text-white uppercase">
              EN VIVO
            </span>
          )}

          {/* Centered Pause Mark */}
          {paused && streamStatus !== 'error' && (
            <button
              type="button"
              onClick={togglePause}
              className="absolute top-1/2 left-1/2 z-10 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-[#0e0e11]/60 text-white backdrop-blur-md transition hover:bg-[#0e0e11]/80 cursor-pointer"
            >
              <Play className="ml-1 h-9 w-9 fill-current" />
            </button>
          )}

          {/* Loading / Error Overlays */}
          {streamStatus === 'loading' && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/35">
              <div
                style={{ borderTopColor: 'var(--ot-accent)' }}
                className="h-9 w-9 animate-spin rounded-full border-2 border-white/20"
              />
            </div>
          )}
          {streamStatus === 'error' && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/75 p-6 text-center">
              <div className="text-[15.5px] font-bold text-white">Señal temporalmente no disponible</div>
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
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-[#141418]/65 text-white backdrop-blur-md hover:bg-white/20 cursor-pointer"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <span className="truncate font-display text-[24px] font-extrabold text-white drop-shadow">
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
                    <div className="truncate font-display text-[28px] leading-tight font-extrabold text-white">
                      {activeChannel.name}
                    </div>
                    <div className="truncate text-[14.5px] text-white/75">
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
                  <span className="text-[13.5px] font-bold text-white">En directo</span>
                </div>

                {/* 3-Group Buttons */}
                <div className="grid grid-cols-3 items-center">
                  {/* Left: Volume */}
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setMuted((m) => !m)}
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 cursor-pointer"
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
                    <span className="text-[13px] tabular-nums text-white/75">
                      {muted || volume === 0 ? '0%' : `${Math.round(volume * 100)}%`}
                    </span>
                  </div>

                  {/* Center: Prev · White Play/Pause · Next */}
                  <div className="flex items-center justify-center gap-3.5">
                    <button
                      type="button"
                      onClick={() => zapChannel(-1)}
                      title="Canal anterior"
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 cursor-pointer"
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
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 cursor-pointer"
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
                      className={`flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/15 cursor-pointer ${
                        isFav ? 'text-[#ffd34d]' : 'text-white'
                      }`}
                    >
                      <Star className={`h-5 w-5 ${isFav ? 'fill-current' : ''}`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setGuideOpen(true)}
                      title="Guía de canales (G)"
                      className="flex h-11 w-11 items-center justify-center rounded-full text-white hover:bg-white/15 cursor-pointer"
                    >
                      <LayoutGrid className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void openSchedule()}
                      title="Programación 12 h"
                      className="flex h-11 w-11 items-center justify-center rounded-full text-white hover:bg-white/15 cursor-pointer"
                    >
                      <CalendarClock className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setFsDrawerOpen((o) => !o)}
                      title="Lista de canales"
                      className="flex h-11 w-11 items-center justify-center rounded-full text-white hover:bg-white/15 cursor-pointer"
                    >
                      <List className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setReloadNonce((n) => n + 1)}
                      title="Reintentar"
                      className="flex h-11 w-11 items-center justify-center rounded-full text-white hover:bg-white/15 cursor-pointer"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={onToggleFullscreen}
                      title="Salir de pantalla completa"
                      className="flex h-11 w-11 items-center justify-center rounded-full text-white hover:bg-white/15 cursor-pointer"
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
            <div className="ot-fade-up absolute top-0 right-0 bottom-0 z-30 flex w-96 flex-col border-l border-white/10 bg-[#111114]/95 backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
                <span className="font-display text-[17px] font-bold text-white">Canales ({visibleChannels.length})</span>
                <button
                  type="button"
                  onClick={() => setFsDrawerOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-white/65 hover:bg-white/10 cursor-pointer"
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
                        isCur ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/[0.07]'
                      }`}
                    >
                      <ChannelThumb channel={ch} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-semibold">{ch.name}</div>
                        {epg?.now && <div className="truncate text-[12px] text-white/50">{epg.now.title}</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Windowed Bottom Row (`live-bar3a`): Channel Info on Left + Round Controls on Right */}
        {!isFullscreen && activeChannel && (
          <div className="mt-4 flex items-center justify-between gap-6">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <ChannelThumb channel={activeChannel} size="md" />
              <div className="min-w-0">
                <div className="truncate font-display text-[22px] leading-tight font-extrabold tracking-[-0.01em] text-white">
                  {activeChannel.name}
                </div>
                <div className="truncate text-[13.5px] text-white/65">
                  Canal {activeChannelIndex} · {activeChannel.group}
                </div>
                {epgLine && <div className="mt-0.5 truncate text-[13.5px] text-white/85">{epgLine}</div>}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => zapChannel(-1)}
                title="Canal anterior"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/18 cursor-pointer"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>

              <button
                type="button"
                onClick={togglePause}
                title={paused ? 'Reproducir' : 'Pausar'}
                style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
                className="flex h-[52px] w-[52px] items-center justify-center rounded-full transition hover:brightness-90 cursor-pointer"
              >
                {paused ? <Play className="ml-0.5 h-5 w-5 fill-current" /> : <Pause className="h-5 w-5 fill-current" />}
              </button>

              <button
                type="button"
                onClick={() => zapChannel(1)}
                title="Canal siguiente"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/18 cursor-pointer"
              >
                <ChevronRight className="h-5 w-5" />
              </button>

              {/* Volume button with hover popup slider (`11-fuentes-stremio.css:664`) */}
              <div className="group/vol relative ml-1.5 border-l border-white/15 pl-3">
                <button
                  type="button"
                  onClick={() => setMuted((m) => !m)}
                  title={muted ? 'Activar sonido (M)' : 'Silenciar (M)'}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/18 cursor-pointer"
                >
                  {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                </button>
                <div className="pointer-events-none absolute bottom-[52px] left-1/2 z-30 flex -translate-x-1/2 items-center gap-2.5 rounded-[14px] bg-[#16161a]/96 px-4 py-3 opacity-0 shadow-[0_16px_40px_rgba(0,0,0,0.55)] ring-1 ring-white/10 transition group-hover/vol:pointer-events-auto group-hover/vol:opacity-100">
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
                  <span className="w-8 text-right text-[12px] font-semibold tabular-nums text-white/80">
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
                className={`flex h-11 w-11 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/18 cursor-pointer ${
                  isFav ? 'text-[#ffd34d]' : 'text-white'
                }`}
              >
                <Star className={`h-5 w-5 ${isFav ? 'fill-current' : ''}`} />
              </button>

              {prevChannel && prevChannel.url !== activeChannel.url && (
                <button
                  type="button"
                  onClick={() => selectChannel(prevChannel)}
                  title={`Volver a ${prevChannel.name} (0)`}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/18 cursor-pointer"
                >
                  <Undo2 className="h-5 w-5" />
                </button>
              )}

              <button
                type="button"
                onClick={() => void openSchedule()}
                title="Programación (12 h)"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/18 cursor-pointer"
              >
                <CalendarClock className="h-5 w-5" />
              </button>

              <button
                type="button"
                onClick={() => setGuideOpen(true)}
                title="Guía de canales (G)"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/18 cursor-pointer"
              >
                <LayoutGrid className="h-5 w-5" />
              </button>

              <button
                type="button"
                onClick={onToggleFullscreen}
                title="Pantalla completa"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/18 cursor-pointer"
              >
                <Maximize2 className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}
      </div>

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
            className="ot-fade-up flex h-[86vh] w-full max-w-[1220px] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#141418]/98 shadow-[0_40px_120px_rgba(0,0,0,0.68)]"
          >
            {/* Header (`guia.jpg`) */}
            <div className="flex items-center justify-between gap-4 border-b border-white/[0.07] px-8 py-5">
              <div>
                <h2 className="font-display text-[26px] font-bold tracking-[-0.02em] text-white">Guía de canales</h2>
                <p className="mt-0.5 text-[14px] text-white/50">
                  {guideGroup} · {guideChannels.length} {guideChannels.length === 1 ? 'canal' : 'canales'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative w-80">
                  <Search className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-white/45" />
                  <input
                    type="text"
                    value={guideQuery}
                    onChange={(e) => setGuideQuery(e.target.value)}
                    placeholder="Buscar canal"
                    className="h-11 w-full rounded-[14px] border border-white/12 bg-white/[0.06] pr-4 pl-11 text-[15px] text-white placeholder-white/45 outline-none focus:border-white/50 focus:bg-white/[0.09]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setGuideOpen(false)}
                  aria-label="Cerrar guía"
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] text-white hover:bg-white/16 cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1">
              {/* Left Category Rail (exact `guia.jpg`: white active pill, ☆ Favoritos, ↺ Recientes, CATEGORÍAS) */}
              <div className="ot-scroll w-[225px] shrink-0 overflow-y-auto border-r border-white/[0.07] px-3.5 py-4">
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
                          active ? 'font-bold' : 'text-white/78 hover:bg-white/[0.07] hover:text-white'
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
                    <div className="mt-5 mb-2 px-3.5 text-[11.5px] font-bold tracking-[0.1em] text-white/40 uppercase">
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
                              active ? 'font-bold' : 'text-white/75 hover:bg-white/[0.07] hover:text-white'
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
                            ? 'border-white/55 bg-white/[0.1]'
                            : 'border-white/[0.07] bg-white/[0.045] hover:border-white/18 hover:bg-white/[0.09]'
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
                          <div className="line-clamp-2 text-[14.5px] leading-tight font-semibold text-white">
                            {ch.name}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[12px]">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-[#ff4d4f] shadow-[0_0_0_2.5px_rgba(255,77,79,0.2)]" />
                              <span className={isCur ? 'font-semibold text-white' : 'text-white/55'}>
                                {isCur ? 'Viendo ahora' : 'En vivo'}
                              </span>
                            </span>
                          </div>
                          {epg?.now && (
                            <div className="mt-0.5 truncate text-[11.5px] text-white/70">{epg.now.title}</div>
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
                          className={`absolute top-1/2 right-2.5 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/25 cursor-pointer ${
                            fav ? 'text-[#ffd34d] opacity-100' : 'text-white opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          <Star className={`h-4 w-4 ${fav ? 'fill-current' : ''}`} />
                        </button>
                      </div>
                    );
                  })}
                  {guideChannels.length === 0 && (
                    <div className="col-span-full py-16 text-center text-[15px] text-white/50">
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
            className="ot-fade-up flex max-h-[82vh] w-full max-w-[680px] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#141418] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/[0.08] px-7 py-5">
              <div>
                <h3 className="font-display text-[22px] font-bold text-white">Programación · 12 horas</h3>
                <p className="text-[13.5px] text-white/55">{activeChannel.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setScheduleOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-white/65 hover:bg-white/10 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="ot-scroll flex-1 space-y-1 overflow-y-auto p-5">
              {loadingSchedule ? (
                <div className="py-12 text-center text-white/55">Cargando horarios…</div>
              ) : scheduleItems.length === 0 ? (
                <div className="py-12 text-center text-white/55">
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
                        isNow ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="w-[68px] shrink-0 pt-0.5">
                        <div className="text-[15.5px] font-bold tabular-nums text-white">{fmtHour(p.startMs)}</div>
                        <div className="text-[12px] tabular-nums text-white/40">{fmtHour(p.endMs)}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2.5">
                          <span className="truncate text-[15px] font-semibold text-white">{p.title}</span>
                          {isNow && (
                            <span className="shrink-0 rounded-full bg-[#e9e7e2] px-2.5 py-0.5 text-[10.5px] font-bold tracking-wider text-[#15151a] uppercase">
                              Ahora
                            </span>
                          )}
                        </div>
                        {p.description && (
                          <p className="mt-1 line-clamp-2 text-[13px] text-white/55">{p.description}</p>
                        )}
                        {isNow && (
                          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/12">
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

const ChannelThumb: React.FC<{ channel: LiveChannel; size: 'sm' | 'md' | 'lg' }> = ({ channel, size }) => {
  const [failed, setFailed] = useState(false);
  const src = useMemo(() => resizedImageUrl(channel.logo, 128), [channel.logo]);
  const cls =
    size === 'lg'
      ? 'h-[66px] w-[66px] rounded-[16px] text-[22px]'
      : size === 'md'
      ? 'h-[54px] w-[54px] rounded-[14px] text-[19px]'
      : 'h-[44px] w-[44px] rounded-[11px] text-[14px]';

  if (!src || failed) {
    return (
      <div className={`flex shrink-0 items-center justify-center bg-white/[0.08] font-extrabold text-white/80 ${cls}`}>
        {channel.name.charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden bg-white/[0.08] p-1.5 ${cls}`}>
      <img
        src={src}
        alt={channel.name}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-contain"
      />
    </div>
  );
};
