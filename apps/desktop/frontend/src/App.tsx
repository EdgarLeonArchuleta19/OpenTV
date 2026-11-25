import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { setLiteMode } from './services/liteMode';
import type { DownloadItem, Episode, ExternalSubtitle, HomeTabId, MediaItem, StreamSource, UpdateStatus, WatchProgress } from './types/models';
import { desktopApi, getAppVersion } from './services/tauri';
import { isMandatoryUpdate } from './services/version';
import { routeGlobalToast } from './services/playerNotice';
import { resolveAccent, zoomFor } from './services/theme';
import { useAppStore } from './store/useAppStore';
import { ForceUpdateGate } from './components/ForceUpdateGate';
import { TitleBar } from './components/TitleBar';
import { TopNavBar } from './components/TopNavBar';
import { HomeScreen } from './screens/HomeScreen';
import type { PlayerSession } from './screens/PlayerScreen';
import type { SettingsSectionId } from './screens/SettingsScreen';

// Lazy-loaded screens keep hls.js (~595 KB) and off-screen views out of the initial boot bundle
const DetailScreen = lazy(() => import('./screens/DetailScreen').then((m) => ({ default: m.DetailScreen })));
const PlayerScreen = lazy(() => import('./screens/PlayerScreen').then((m) => ({ default: m.PlayerScreen })));
const LiveTvScreen = lazy(() => import('./screens/LiveTvScreen').then((m) => ({ default: m.LiveTvScreen })));
const SearchScreen = lazy(() => import('./screens/SearchScreen').then((m) => ({ default: m.SearchScreen })));
const PluginsScreen = lazy(() => import('./screens/PluginsScreen').then((m) => ({ default: m.PluginsScreen })));
const SettingsScreen = lazy(() => import('./screens/SettingsScreen').then((m) => ({ default: m.SettingsScreen })));
const ProfilesScreen = lazy(() => import('./screens/ProfilesScreen').then((m) => ({ default: m.ProfilesScreen })));

const ScreenFallback: React.FC = () => (
  <div className="flex h-full w-full items-center justify-center bg-page">
    <div
      style={{ borderTopColor: 'var(--ot-accent)' }}
      className="h-8 w-8 animate-spin rounded-full border-2 border-fg/15"
    />
  </div>
);

type ScreenId = 'home' | 'detail' | 'player' | 'search' | 'plugins' | 'settings' | 'profiles';

const SECTION_LABELS: Record<HomeTabId, string> = {
  live: 'TV en vivo',
  home: 'Inicio',
  movies: 'Películas',
  series: 'Series',
  kids: 'Kids',
  anime: 'Anime',
};

export const App: React.FC = () => {
  const store = useAppStore();
  const profile = store.activeProfile();
  const bucket = store.activeBucket();
  const hasSourcePlugins = store.hasSourcePlugins();
  setLiteMode(store.appearance.liteMode);

  const [screen, setScreen] = useState<ScreenId>('home');
  const [activeTab, setActiveTab] = useState<HomeTabId>(profile.kids ? 'kids' : 'home');
  const [detailStack, setDetailStack] = useState<MediaItem[]>([]);
  /**
   * Screens behind the current one. Home (any tab) is the root, so going there empties it.
   * Back pops it; the player is never re-entered by Back.
   */
  const historyRef = useRef<ScreenId[]>([]);
  const screenRef = useRef<ScreenId>('home');
  screenRef.current = screen;
  const detailCountRef = useRef(0);
  detailCountRef.current = detailStack.length;
  const go = useCallback((to: ScreenId) => {
    const from = screenRef.current;
    if (to === 'home') historyRef.current = [];
    else if (from !== to) historyRef.current = [...historyRef.current.slice(-19), from];
    screenRef.current = to;
    setScreen(to);
  }, []);
  /** Returns to the screen the user was on before, skipping `skip` screens (and the player). */
  const goBack = useCallback((skip: ScreenId[] = []) => {
    const h = [...historyRef.current];
    let to: ScreenId = 'home';
    while (h.length > 0) {
      const s = h.pop() as ScreenId;
      if (s === 'player' || skip.includes(s) || (s === 'detail' && detailCountRef.current === 0)) continue;
      to = s;
      break;
    }
    historyRef.current = h;
    screenRef.current = to;
    setScreen(to);
  }, []);
  /** Leaves a title (and the recommendations opened from it) for wherever the user browsed from. */
  const leaveDetail = useCallback(() => {
    detailCountRef.current = 0;
    setDetailStack([]);
    goBack(['detail']);
  }, [goBack]);
  /** Episode a "Seguir viendo" card asked Detail to preselect, by item id. */
  const [detailResume, setDetailResume] = useState<Record<string, { season: number; episode: number }>>({});
  const [playerSession, setPlayerSession] = useState<PlayerSession | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('account');
  const [manageProfilesInitial, setManageProfilesInitial] = useState(false);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle', version: getAppVersion() });
  const [toast, setToast] = useState<string>('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateLocked = isMandatoryUpdate(updateStatus, getAppVersion());

  const handleSaveProgress = useCallback(
    (positionMs: number, durationMs: number) => {
      if (!playerSession || playerSession.item.id.startsWith('local:')) return;
      const { item, episode } = playerSession;
      useAppStore.getState().saveWatchProgress({
        itemId: item.id,
        type: item.type,
        title: item.title,
        poster: item.poster,
        backdrop: item.backdrop,
        season: episode?.season || 0,
        episode: episode?.number || 0,
        episodeTitle: episode?.title || '',
        positionMs,
        durationMs,
      });
    },
    [playerSession],
  );

  // While the player is open it is the only place that shows messages (its own HUD notice).
  const playerActiveRef = useRef(false);
  playerActiveRef.current = screen === 'player';
  const [playerExtNotice, setPlayerExtNotice] = useState<{ id: number; text: string } | null>(null);

  const showToast = useCallback((msg: string) => {
    if (routeGlobalToast(playerActiveRef.current) === 'drop') return;
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), 3200);
  }, []);

  /** App-level info (pin, file drop): inside the player while it is open, else a toast. */
  const appNotice = useCallback(
    (msg: string) => {
      if (playerActiveRef.current) setPlayerExtNotice((cur) => ({ id: (cur?.id ?? 0) + 1, text: msg }));
      else showToast(msg);
    },
    [showToast],
  );

  // Entering the player hides any toast still on screen (never two messages at once).
  useEffect(() => {
    if (screen !== 'player') return;
    setToast('');
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, [screen]);

  const myListIds = useMemo(() => new Set(bucket.myList.map((m) => m.id)), [bucket.myList]);
  const favoriteIds = useMemo(() => new Set(bucket.favorites.map((m) => m.id)), [bucket.favorites]);

  // Apply theme + accent tokens and lite mode
  const theme = store.appearance.theme;
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    // Both shades are exposed so forced-dark subtrees (the player) keep the dark accent.
    const dark = resolveAccent(store.appearance.accentId, 'dark');
    const light = resolveAccent(store.appearance.accentId, 'light');
    root.style.setProperty('--ot-accent-dark', dark.color);
    root.style.setProperty('--ot-accent-ink-dark', dark.ink);
    root.style.setProperty('--ot-accent-light', light.color);
    root.style.setProperty('--ot-accent-ink-light', light.ink);
    document.body.classList.toggle('is-lite', store.appearance.liteMode);
  }, [theme, store.appearance.accentId, store.appearance.liteMode]);

  // Native window background/border follow the theme; "Texto aumentado" zooms the whole WebView.
  useEffect(() => {
    void desktopApi.appearance(theme, zoomFor(store.appearance.textLarge));
  }, [theme, store.appearance.textLarge]);

  useEffect(() => {
    if (profile.kids && activeTab !== 'kids') setActiveTab('kids');
  }, [profile.kids, activeTab]);

  const openLocalVideoPath = useCallback(
    async (filePath: string) => {
      if (updateLocked) return;
      const res = await desktopApi.service<{
        returnValue?: boolean;
        url?: string;
        title?: string;
        name?: string;
        subtitles?: Array<{ id: string; lang: string; label: string; url: string }>;
        errorText?: string;
      }>('localRegister', { path: filePath });
      if (!res?.returnValue || !res.url) {
        showToast(res?.errorText || 'No se pudo abrir el archivo de video');
        return;
      }
      const localSubs: ExternalSubtitle[] = Array.isArray(res.subtitles)
        ? res.subtitles.map((s) => ({
            id: s.id,
            lang: s.lang || 'es',
            label: s.label,
            url: s.url,
            source: 'Archivo local',
          }))
        : [];
      const fakeItem: MediaItem = {
        id: `local:${res.name || Date.now()}`,
        type: 'movie',
        title: res.title || res.name || 'Video local',
        year: 'Archivo local',
        score: '',
        duration: '',
        genres: [],
        synopsis: '',
        poster: '',
        backdrop: '',
        isAnime: false,
      };
      setPlayerSession({
        item: fakeItem,
        episode: null,
        allEpisodes: [],
        chosen: null,
        ranked: [],
        offlineUrl: res.url,
        initialSubtitles: localSubs,
      });
      go('player');
      if (localSubs.length > 0) {
        // Shown by the player itself once it mounts.
        setPlayerExtNotice((cur) => ({
          id: (cur?.id ?? 0) + 1,
          text: `Reproduciendo video local · ${localSubs.length} subtítulo(s) detectado(s)`,
        }));
      }
    },
    [showToast, updateLocked],
  );

  const openLocalRef = useRef(openLocalVideoPath);
  openLocalRef.current = openLocalVideoPath;

  useEffect(() => {
    void desktopApi.update('status').then((st) => {
      if (st && st.state) setUpdateStatus(st);
    });
    const offFs = desktopApi.listen<boolean>('desktop:fullscreen-changed', (fs) => setIsFullscreen(Boolean(fs)));
    const offUpd = desktopApi.listen<UpdateStatus>('desktop:update-status', (ev) => {
      if (ev && ev.state) {
        setUpdateStatus(ev);
      }
    });
    const offDrop = desktopApi.listen<string[]>('desktop:file-drop', (paths) => {
      if (!Array.isArray(paths) || paths.length === 0) return;
      const videoExt = /\.(mp4|m4v|mkv|webm|avi|mov|ts|m2ts|flv|wmv|ogv|mpg|mpeg|3gp)$/i;
      const firstVideo = paths.find((p) => typeof p === 'string' && videoExt.test(p));
      if (firstVideo) {
        void openLocalRef.current(firstVideo);
      } else {
        appNotice('Arrastra un archivo de video compatible (.mp4, .mkv, .avi, .mov, .webm…)');
      }
    });
    return () => {
      offFs();
      offUpd();
      offDrop();
    };
  }, [appNotice]);

  // Immediately stop active playback whenever a mandatory update locks the app
  useEffect(() => {
    if (updateLocked && playerSession) {
      setPlayerSession(null);
      go('home');
    }
  }, [updateLocked, playerSession]);

  // Adaptive polling for active background downloads (fast while downloading, low-power when idle/hidden)
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (!alive) return;
      if (document.hidden) {
        timer = setTimeout(poll, 15_000);
        return;
      }
      const res = await desktopApi.service<{ items?: DownloadItem[] }>('downloadList', {});
      if (!alive) return;
      const active = (res?.items || []).filter((d) => d.status === 'downloading' || d.status === 'queued');
      if (active.length === 0) {
        setDownloadPct(null);
        timer = setTimeout(poll, 15_000);
        return;
      }
      const total = active.reduce((acc, d) => acc + (d.total || 0), 0);
      const done = active.reduce((acc, d) => acc + (d.bytes || 0), 0);
      setDownloadPct(total > 0 ? Math.min(99, Math.round((done / total) * 100)) : 0);
      timer = setTimeout(poll, 2_500);
    };
    timer = setTimeout(poll, 4_000);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    desktopApi.fullscreen().then((fs) => setIsFullscreen(Boolean(fs)));
  }, []);

  const togglePin = useCallback(() => {
    desktopApi.pin().then((pinned) => {
      setIsPinned(Boolean(pinned));
      appNotice(pinned ? 'Ventana fijada siempre encima' : 'Ventana desfijada');
    });
  }, [appNotice]);

  // Global desktop keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        toggleFullscreen();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        go('search');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        go('home');
      } else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setSettingsSection('prefs');
        go('settings');
      } else if (e.key === 'Escape' && screen !== 'player' && !(screen === 'home' && activeTab === 'live')) {
        // An open dialog closes first (same as clicking its backdrop) instead of leaving the screen.
        const modals = document.querySelectorAll<HTMLElement>('[data-ot-modal]');
        if (modals.length > 0) {
          e.preventDefault();
          modals[modals.length - 1].click();
        } else if (isFullscreen) {
          e.preventDefault();
          toggleFullscreen();
        } else if (screen === 'detail') {
          leaveDetail();
        } else if (screen !== 'home') {
          goBack();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTab, go, goBack, isFullscreen, leaveDetail, screen, toggleFullscreen]);

  const openDetail = useCallback((item: MediaItem) => {
    setDetailResume((cur) => {
      if (!(item.id in cur)) return cur;
      const next = { ...cur };
      delete next[item.id];
      return next;
    });
    setDetailStack((st) => [...st, item]);
    go('detail');
  }, []);

  const startPlayback = useCallback(
    (
      item: MediaItem,
      episode: Episode | null,
      allEpisodes: Episode[],
      chosen: StreamSource | null,
      ranked: StreamSource[],
      fromStart = false,
    ) => {
      const saved = bucket.watchProgress.find(
        (w) => w.itemId === item.id && (!episode || (w.season === episode.season && w.episode === episode.number)),
      );
      const startPositionMs =
        !fromStart && saved && saved.durationMs > 60_000 && saved.positionMs / saved.durationMs < 0.92
          ? saved.positionMs
          : 0;
      setPlayerSession({ item, episode, allEpisodes, chosen, ranked, startPositionMs });
      go('player');
    },
    [bucket.watchProgress],
  );

  const handleHeroPlay = useCallback(
    (item: MediaItem) => {
      if (!hasSourcePlugins) {
        showToast('Para reproducir, agrega un plugin de fuentes en Plugins.');
        setSettingsSection('plugins');
        go('settings');
        return;
      }
      if (item.type !== 'movie') {
        openDetail(item);
        return;
      }
      // The player opens at once and finds the best source inside its loading screen.
      startPlayback(item, null, [], null, []);
    },
    [hasSourcePlugins, openDetail, showToast, startPlayback],
  );

  // "Seguir viendo" opens the title's Detail (episode kept) instead of playing blindly.
  const handleResumeEntry = useCallback(
    (entry: WatchProgress) => {
      openDetail({
        id: entry.itemId,
        type: entry.type,
        title: entry.title,
        year: '',
        score: '',
        duration: '',
        genres: [],
        synopsis: '',
        poster: entry.poster,
        backdrop: entry.backdrop,
        isAnime: entry.type === 'anime',
      });
      if (entry.season > 0) {
        setDetailResume((cur) => ({ ...cur, [entry.itemId]: { season: entry.season, episode: entry.episode } }));
      }
    },
    [openDetail],
  );

  const handleRemoveContinue = useCallback((id: string) => useAppStore.getState().removeWatchProgress(id), []);
  const handleToggleMyList = useCallback(
    (it: MediaItem) => {
      const added = useAppStore.getState().toggleMyList(it);
      showToast(added ? 'Se añadió a Mi lista' : 'Se quitó de Mi lista');
    },
    [showToast],
  );

  const sectionLabel = useMemo(() => {
    if (screen === 'home') return SECTION_LABELS[activeTab];
    if (screen === 'detail') return detailStack[detailStack.length - 1]?.title || 'Ficha';
    if (screen === 'player') return playerSession?.item.title || 'Reproductor';
    if (screen === 'search') return 'Buscar';
    if (screen === 'plugins') return 'Plugins';
    if (screen === 'settings') return 'Ajustes';
    return 'Perfiles';
  }, [activeTab, detailStack, playerSession?.item.title, screen]);

  const currentDetail = detailStack[detailStack.length - 1] || null;
  const showTopNav = screen === 'home' && !(activeTab === 'live' && isFullscreen);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-page text-fg">
      {/* Over the (always dark) player the title bar stays dark too, so a light theme never frames it in white. */}
      <div data-theme={screen === 'player' ? 'dark' : undefined} className="contents">
        <TitleBar
          sectionLabel={sectionLabel}
          isFullscreen={isFullscreen}
          isPinned={isPinned}
          activeDownloadPct={downloadPct}
          onTogglePin={togglePin}
          onOpenDownloads={() => {
            setSettingsSection('downloads');
            go('settings');
          }}
          onToggleFullscreen={toggleFullscreen}
        />
      </div>

      <div className={`relative min-h-0 flex-1 overflow-hidden ${isFullscreen ? '' : 'pt-9'}`}>
        <div className="relative h-full w-full overflow-hidden">
          {showTopNav && (
            <TopNavBar
              activeTab={activeTab}
              profile={profile}
              scrolled={scrolled || activeTab === 'live'}
              onSelectTab={(tab) => {
                setActiveTab(tab);
                setScrolled(false);
              }}
              onOpenSearch={() => {
                go('search');
              }}
              onOpenMyList={() => {
                setSettingsSection('mylist');
                go('settings');
              }}
              onOpenAccount={() => {
                setSettingsSection('account');
                go('settings');
              }}
            />
          )}

          {screen === 'home' && activeTab !== 'live' && (
            <HomeScreen
              tab={activeTab}
              plugins={store.plugins}
              continueWatching={bucket.watchProgress}
              myListIds={myListIds}
              compact={store.appearance.uiDensity === 'compact'}
              liteMode={store.appearance.liteMode}
              onScrolledChange={setScrolled}
              onPlayItem={handleHeroPlay}
              onResumeEntry={handleResumeEntry}
              onRemoveContinue={handleRemoveContinue}
              onOpenDetail={openDetail}
              onToggleMyList={handleToggleMyList}
            />
          )}

          <Suspense fallback={<ScreenFallback />}>
          {screen === 'home' && activeTab === 'live' && (
            <LiveTvScreen
              playlists={store.m3uPlaylists}
              favoriteUrls={bucket.favoriteChannelUrls}
              recentChannels={bucket.recentChannels}
              isFullscreen={isFullscreen}
              onToggleFullscreen={toggleFullscreen}
              onToggleFavorite={(url) => store.toggleFavoriteChannel(url)}
              onRecordRecent={(ch) => store.recordRecentChannel(ch)}
              onOpenPlugins={() => {
                setSettingsSection('plugins');
                go('settings');
              }}
              onToast={showToast}
            />
          )}

          {screen === 'detail' && currentDetail && (
            <DetailScreen
              initialItem={currentDetail}
              plugins={store.plugins}
              hasSourcePlugins={hasSourcePlugins}
              sourcePrefs={store.sourcePrefs}
              playbackPrefs={store.playback}
              inMyList={myListIds.has(currentDetail.id)}
              isFavorite={favoriteIds.has(currentDetail.id)}
              watchProgress={bucket.watchProgress}
              resumeEpisode={detailResume[currentDetail.id] ?? null}
              onBack={leaveDetail}
              onToggleMyList={(it) => {
                const added = store.toggleMyList(it);
                showToast(added ? 'Se añadió a Mi lista' : 'Se quitó de Mi lista');
              }}
              onToggleFavorite={(it) => {
                const added = store.toggleFavorite(it);
                showToast(added ? 'Se añadió a favoritos' : 'Se quitó de favoritos');
              }}
              onUpdatePlayback={store.updatePlayback}
              onOpenPlugins={() => {
                setSettingsSection('plugins');
                go('settings');
              }}
              onOpenRelated={openDetail}
              onPlayStream={startPlayback}
              onToast={showToast}
            />
          )}

          {screen === 'player' && playerSession && (
            // The player keeps the dark palette in every theme.
            <div data-theme="dark" className="contents text-fg">
            <PlayerScreen
              key={`${playerSession.item.id}:${playerSession.episode?.id ?? 'movie'}:${playerSession.startPositionMs ?? 0}`}
              session={playerSession}
              plugins={store.plugins}
              sourcePrefs={store.sourcePrefs}
              playbackPrefs={store.playback}
              isFullscreen={isFullscreen}
              onToggleFullscreen={toggleFullscreen}
              onSaveProgress={handleSaveProgress}
              onUpdateSubtitleStyle={(fn) =>
                store.updatePlayback((p) => ({ ...p, subtitleStyle: fn(p.subtitleStyle) }))
              }
              onSwitchSession={(next) => setPlayerSession(next)}
              onExit={() => {
                setPlayerSession(null);
                setPlayerExtNotice(null);
                goBack();
              }}
              externalNotice={playerExtNotice}
            />
            </div>
          )}

          {screen === 'search' && (
            <SearchScreen
              kidsOnly={profile.kids}
              plugins={store.plugins}
              recentSearches={bucket.recentSearches}
              onAddRecent={store.addRecentSearch}
              onRemoveRecent={store.removeRecentSearch}
              onClearRecents={store.clearRecentSearches}
              onOpenTitle={openDetail}
              onBack={() => goBack()}
            />
          )}

          {screen === 'plugins' && (
            <PluginsScreen
              plugins={store.plugins}
              m3uPlaylists={store.m3uPlaylists}
              sourcePrefs={store.sourcePrefs}
              onUpsertPlugin={store.upsertPlugin}
              onTogglePluginDisabled={store.togglePluginDisabled}
              onRemovePlugin={store.removePlugin}
              onSetAllowLan={store.setPluginAllowLan}
              onAddM3u={store.addM3uPlaylist}
              onRemoveM3u={store.removeM3uPlaylist}
              onUpdateSourcePrefs={store.updateSourcePrefs}
              onBack={() => goBack()}
              onToast={showToast}
            />
          )}

          {screen === 'settings' && (
            <SettingsScreen
              initialSection={settingsSection}
              profile={profile}
              myList={bucket.myList}
              favorites={bucket.favorites}
              watchProgress={bucket.watchProgress}
              plugins={store.plugins}
              m3uPlaylists={store.m3uPlaylists}
              sourcePrefs={store.sourcePrefs}
              appearance={store.appearance}
              playback={store.playback}
              parentalPin={store.parentalPin}
              parentalLocked={store.parentalLocked}
              localFolders={store.localFolders}
              onBack={() => goBack()}
              onOpenProfiles={(manage) => {
                setManageProfilesInitial(Boolean(manage));
                go('profiles');
              }}
              onOpenTitle={openDetail}
              onRemoveFromMyList={(it) => store.toggleMyList(it)}
              onRemoveFavorite={(it) => store.toggleFavorite(it)}
              onClearHistory={store.clearHistory}
              onPlayOffline={(dl: DownloadItem, offlineUrl: string) => {
                const fakeItem: MediaItem = {
                  id: dl.id,
                  type: 'movie',
                  title: dl.title,
                  year: dl.subtitle,
                  score: '',
                  duration: '',
                  genres: [],
                  synopsis: '',
                  poster: dl.poster,
                  backdrop: dl.poster,
                  isAnime: false,
                };
                setPlayerSession({
                  item: fakeItem,
                  episode: null,
                  allEpisodes: [],
                  chosen: null,
                  ranked: [],
                  offlineUrl,
                });
                go('player');
              }}
              onPlayLocalPath={(p: string) => void openLocalVideoPath(p)}
              onAddLocalFolder={store.addLocalFolder}
              onRemoveLocalFolder={store.removeLocalFolder}
              onUpsertPlugin={store.upsertPlugin}
              onTogglePluginDisabled={store.togglePluginDisabled}
              onRemovePlugin={store.removePlugin}
              onSetAllowLan={store.setPluginAllowLan}
              onAddM3u={store.addM3uPlaylist}
              onRemoveM3u={store.removeM3uPlaylist}
              onUpdateSourcePrefs={store.updateSourcePrefs}
              onUpdateAppearance={store.updateAppearance}
              onUpdatePlayback={store.updatePlayback}
              onSetParental={store.setParental}
              onExportJson={store.exportStateJson}
              onImportJson={store.importStateJson}
              onToast={showToast}
            />
          )}

          {screen === 'profiles' && (
            <ProfilesScreen
              initialManage={manageProfilesInitial}
              profiles={store.profiles}
              activeProfileId={store.activeProfileId}
              parentalPin={store.parentalPin}
              parentalLocked={store.parentalLocked}
              onSelectProfile={(id) => {
                store.selectProfile(id);
                const chosen = store.profiles.find((p) => p.id === id);
                setActiveTab(chosen?.kids ? 'kids' : 'home');
                go('home');
              }}
              onAddProfile={store.addProfile}
              onUpdateProfile={store.updateProfile}
              onRemoveProfile={store.removeProfile}
              onToast={showToast}
            />
          )}
          </Suspense>

          {toast && !updateLocked && (
            <div className="ot-fade-up pointer-events-none fixed bottom-7 left-1/2 z-[120] -translate-x-1/2 rounded-full border border-white/15 bg-[#1a1a20]/95 px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-2xl backdrop-blur-md">
              {toast}
            </div>
          )}

          {updateLocked && (
            <ForceUpdateGate
              currentVersion={getAppVersion()}
              status={updateStatus}
              onDownload={() => void desktopApi.update('download').then((st) => st?.state && setUpdateStatus(st))}
              onInstall={() => void desktopApi.update('install').then((st) => st?.state && setUpdateStatus(st))}
              onRetryCheck={() => void desktopApi.update('check').then((st) => st?.state && setUpdateStatus(st))}
              onOpenReleases={() => void desktopApi.update('releases')}
            />
          )}
        </div>
      </div>
    </div>
  );
};
