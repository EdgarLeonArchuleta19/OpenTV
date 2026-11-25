import React, { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Film,
  FolderOpen,
  FolderPlus,
  HardDrive,
  HelpCircle,
  Info,
  Pause,
  Play,
  Puzzle,
  RefreshCw,
  Sliders,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react';
import type {
  AppearancePrefs,
  DownloadItem,
  InstalledPlugin,
  M3uPlaylist,
  MediaItem,
  PlaybackPrefs,
  SourcePrefs,
  UpdateStatus,
  UserProfile,
  WatchProgress,
} from '../types/models';
import { ACCENTS } from '../services/catalogs';
import { accentLabel, resolveAccent } from '../services/theme';
import { formatBytes } from '../services/sourceRanker';
import { desktopApi, getAppVersion } from '../services/tauri';
import { clearCatalogCache } from '../services/stremio';
import { clearLiveTvCache } from '../services/liveTv';
import { clearLocalizeCache } from '../services/localize';
import { OpenTvLogo, PosterCard } from '../components/CommonComponents';
import { ProfileAvatar } from '../components/Avatars';
import { PluginsScreen } from './PluginsScreen';

export type SettingsSectionId =
  | 'account'
  | 'mylist'
  | 'prefs'
  | 'plugins'
  | 'downloads'
  | 'help'
  | 'about';

interface SettingsScreenProps {
  initialSection?: SettingsSectionId;
  profile: UserProfile;
  myList: MediaItem[];
  favorites: MediaItem[];
  watchProgress: WatchProgress[];
  plugins: InstalledPlugin[];
  m3uPlaylists: M3uPlaylist[];
  sourcePrefs: SourcePrefs;
  appearance: AppearancePrefs;
  playback: PlaybackPrefs;
  parentalPin: string;
  parentalLocked: boolean;
  localFolders: string[];
  onBack: () => void;
  onOpenProfiles: (manage?: boolean) => void;
  onOpenTitle: (item: MediaItem) => void;
  onRemoveFromMyList: (item: MediaItem) => void;
  onRemoveFavorite: (item: MediaItem) => void;
  onClearHistory: () => void;
  onPlayOffline: (dl: DownloadItem, streamUrl: string) => void;
  onPlayLocalPath: (path: string) => void;
  onAddLocalFolder: (dir: string) => void;
  onRemoveLocalFolder: (dir: string) => void;
  onUpsertPlugin: (p: InstalledPlugin) => void;
  onTogglePluginDisabled: (url: string) => void;
  onRemovePlugin: (url: string) => void;
  onSetAllowLan: (url: string, allow: boolean) => void;
  onAddM3u: (pl: M3uPlaylist) => void;
  onRemoveM3u: (url: string) => void;
  onUpdateSourcePrefs: (fn: (cur: SourcePrefs) => SourcePrefs) => void;
  onUpdateAppearance: (fn: (cur: AppearancePrefs) => AppearancePrefs) => void;
  onUpdatePlayback: (fn: (cur: PlaybackPrefs) => PlaybackPrefs) => void;
  onSetParental: (pin: string, locked: boolean) => void;
  onExportJson: () => string;
  onImportJson: (raw: string) => boolean;
  onToast: (msg: string) => void;
}

const SECTIONS: Array<{ id: SettingsSectionId; label: string; icon: React.ReactNode }> = [
  { id: 'account', label: 'Mi cuenta', icon: <User className="h-5 w-5" /> },
  { id: 'mylist', label: 'Mi lista', icon: <Bookmark className="h-5 w-5" /> },
  { id: 'prefs', label: 'Ajustes', icon: <Sliders className="h-5 w-5" /> },
  { id: 'plugins', label: 'Plugins', icon: <Puzzle className="h-5 w-5" /> },
  { id: 'downloads', label: 'Descargas', icon: <Download className="h-5 w-5" /> },
  { id: 'help', label: 'Ayuda', icon: <HelpCircle className="h-5 w-5" /> },
  { id: 'about', label: 'Acerca de', icon: <Info className="h-5 w-5" /> },
];

const DESKTOP_SHORTCUTS: Array<[string, string]> = [
  ['Espacio', 'Reproducir o pausar'],
  ['← / →', 'Retroceder o adelantar 10 s'],
  ['Rueda', 'Volumen (sobre el vídeo)'],
  ['M', 'Silenciar'],
  ['F o F11', 'Pantalla completa'],
  ['Esc', 'Salir de pantalla completa o volver'],
  ['P', 'Ventana flotante (PiP)'],
  ['C', 'Abrir subtítulos'],
  ['G', 'Guía de canales (en TV)'],
  ['↑ / ↓', 'Canal anterior / siguiente (en TV)'],
  ['Ctrl + F', 'Buscar'],
  ['Ctrl + H', 'Inicio'],
  ['Ctrl + ,', 'Ajustes'],
];

/**
 * Exact 1:1 replica of OpenTV v1 Settings Hub (`account.js` + `settings-hub.js` + `settings-desktop.js`
 * + `04-en-vivo-ajustes-posteres.css`):
 * - Left sidebar with active 3px left accent line (`shadow-[inset_3px_0_0_var(--ot-accent)]`)
 * - Mi cuenta: 96px profile avatar + 3 stat cards + 3 quick-action cards + "Bloqueo y modo Kids" + backup export/import
 * - Mi lista: 3 tabs (Mi lista | Favoritos | Historial)
 * - Ajustes: 2 sub-tabs (Apariencia | Reproducción) with grouped segmented rows & ⓘ hints
 * - Ayuda & Acerca de: clean `sd-plain` layout + `<kbd>` shortcuts + TECHPOINT Software™ credits.
 */
export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  initialSection = 'account',
  profile,
  myList,
  favorites,
  watchProgress,
  plugins,
  m3uPlaylists,
  sourcePrefs,
  appearance,
  playback,
  parentalPin,
  parentalLocked,
  localFolders,
  onBack,
  onOpenProfiles,
  onOpenTitle,
  onRemoveFromMyList,
  onRemoveFavorite,
  onClearHistory,
  onPlayOffline,
  onPlayLocalPath,
  onAddLocalFolder,
  onRemoveLocalFolder,
  onUpsertPlugin,
  onTogglePluginDisabled,
  onRemovePlugin,
  onSetAllowLan,
  onAddM3u,
  onRemoveM3u,
  onUpdateSourcePrefs,
  onUpdateAppearance,
  onUpdatePlayback,
  onSetParental,
  onExportJson,
  onImportJson,
  onToast,
}) => {
  const [section, setSection] = useState<SettingsSectionId>(initialSection);
  const [hubTab, setHubTab] = useState<'look' | 'play'>('look');
  const [listTab, setListTab] = useState<'mylist' | 'favs' | 'history'>('mylist');
  const [downloadsTab, setDownloadsTab] = useState<'downloads' | 'local'>('downloads');
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [localVideos, setLocalVideos] = useState<
    Array<{ path: string; name: string; title: string; ext: string; size: number; modifiedMs: number; folder: string }>
  >([]);
  const [scanningLocal, setScanningLocal] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateStatus>({ state: 'idle', version: getAppVersion() });
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [runningDiag, setRunningDiag] = useState(false);
  const [diagRows, setDiagRows] = useState<Array<{ label: string; value: string; ok: boolean }> | null>(null);

  const runSystemDiagnostics = async () => {
    if (runningDiag) return;
    setRunningDiag(true);
    try {
      const rows: Array<{ label: string; value: string; ok: boolean }> = [];
      const t0 = performance.now();
      const ping = await desktopApi.service<{
        returnValue?: boolean;
        proxyPort?: number;
        relayAvailable?: boolean;
        tmdbAvailable?: boolean;
        storage?: { free?: number; total?: number };
      }>('ping', {});
      const pingMs = Math.max(1, Math.round(performance.now() - t0));

      if (ping?.returnValue) {
        rows.push({
          label: 'Núcleo Rust (opentv-core)',
          value: `Activo en 127.0.0.1:${ping.proxyPort || 0} · ${pingMs} ms`,
          ok: true,
        });
        rows.push({
          label: 'Motor híbrido FFmpeg / Remux GPU',
          value: ping.relayAvailable ? 'Disponible (MKV, HEVC, AC-3, DTS, AVI)' : 'Modo estándar WebView2',
          ok: Boolean(ping.relayAvailable),
        });
        if (typeof ping.storage?.free === 'number' && ping.storage.free > 0) {
          rows.push({
            label: 'Espacio libre en disco',
            value: `${formatBytes(ping.storage.free)} disponibles`,
            ok: ping.storage.free > 500 * 1024 * 1024,
          });
        }
        rows.push({
          label: 'Catálogo TMDB',
          value: ping.tmdbAvailable ? 'Conectado' : 'Sin clave (catálogo de respaldo)',
          ok: true,
        });
      } else {
        rows.push({
          label: 'Núcleo Rust (opentv-core)',
          value: 'No disponible en modo navegador',
          ok: false,
        });
      }

      // Bundled system plugins are internal fallbacks: never listed in the diagnostics.
      const activePlugins = plugins.filter((p) => !p.disabled && !p.builtin);
      const pluginChecks = await Promise.all(
        activePlugins.map(async (p) => {
          const start = performance.now();
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 5000);
          try {
            const targetUrl =
              p.kind === 'kino-js'
                ? p.url
                : p.url.endsWith('/manifest.json')
                  ? p.url
                  : `${p.baseUrl.replace(/\/+$/, '')}/manifest.json`;
            const resp = await fetch(targetUrl, { signal: ctrl.signal });
            const ms = Math.max(1, Math.round(performance.now() - start));
            return {
              label: `Plugin: ${p.name}`,
              value: resp.ok ? `OK · ${ms} ms` : `HTTP ${resp.status} · ${ms} ms`,
              ok: resp.ok,
            };
          } catch {
            return {
              label: `Plugin: ${p.name}`,
              value: 'Sin respuesta (> 5 s)',
              ok: false,
            };
          } finally {
            clearTimeout(timer);
          }
        }),
      );
      rows.push(...pluginChecks);
      setDiagRows(rows);
    } finally {
      setRunningDiag(false);
    }
  };

  const [pinInput, setPinInput] = useState(parentalPin);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (section !== 'downloads' || downloadsTab !== 'downloads') return;
    let alive = true;
    const refresh = async () => {
      const res = await desktopApi.service<{ items?: DownloadItem[] }>('downloadList', {});
      if (alive && Array.isArray(res?.items)) setDownloads(res.items);
    };
    void refresh();
    const t = setInterval(refresh, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [section, downloadsTab]);

  const scanLocalFolders = async (dirs: string[]) => {
    if (dirs.length === 0) {
      setLocalVideos([]);
      return;
    }
    setScanningLocal(true);
    try {
      const results = await Promise.all(
        dirs.map((dir) =>
          desktopApi.service<{
            returnValue?: boolean;
            items?: Array<{
              path: string;
              name: string;
              title: string;
              ext: string;
              size: number;
              modifiedMs: number;
              folder: string;
            }>;
          }>('localScanFolder', { dir }),
        ),
      );
      const seen = new Set<string>();
      const merged: Array<{
        path: string;
        name: string;
        title: string;
        ext: string;
        size: number;
        modifiedMs: number;
        folder: string;
      }> = [];
      for (const r of results) {
        if (!Array.isArray(r?.items)) continue;
        for (const it of r.items) {
          const key = it.path.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(it);
        }
      }
      merged.sort((a, b) => b.modifiedMs - a.modifiedMs || a.name.localeCompare(b.name));
      setLocalVideos(merged.slice(0, 200));
    } finally {
      setScanningLocal(false);
    }
  };

  useEffect(() => {
    if (section !== 'downloads' || downloadsTab !== 'local') return;
    void scanLocalFolders(localFolders);
  }, [section, downloadsTab, localFolders]);

  const handlePickLocalVideo = async () => {
    const picked = await desktopApi.pickLocalVideo();
    if (picked) onPlayLocalPath(picked);
  };

  const handleAddLocalFolder = async () => {
    const picked = await desktopApi.pickLocalFolder();
    if (!picked) return;
    onAddLocalFolder(picked);
    onToast('Carpeta local añadida');
  };

  const handleSavePin = () => {
    if (pinInput.length !== 4) {
      onToast('El PIN debe tener exactamente 4 dígitos');
      return;
    }
    const first = !parentalPin;
    // Creating the first PIN turns the Kids lock on (previous "Activar bloqueo" behaviour).
    onSetParental(pinInput, parentalLocked || first);
    onToast(first ? 'PIN creado · bloqueo parental activado' : 'PIN parental actualizado');
  };

  const handleToggleKidsLock = (idx: number) => {
    if (idx === 0) {
      if (parentalLocked) {
        onSetParental(parentalPin, false);
        onToast('Bloqueo parental desactivado');
      }
      return;
    }
    if (parentalLocked) return;
    const pin = parentalPin.length === 4 ? parentalPin : pinInput.length === 4 ? pinInput : '';
    if (!pin) {
      onToast('Primero crea un PIN parental de 4 dígitos');
      return;
    }
    onSetParental(pin, true);
    onToast('Bloqueo parental activado');
  };

  const [clearingCache, setClearingCache] = useState(false);
  const handleClearCache = async () => {
    if (clearingCache) return;
    setClearingCache(true);
    try {
      // Only re-downloadable data: never profiles, lists, progress, plugins or downloads.
      clearCatalogCache();
      clearLiveTvCache();
      clearLocalizeCache();
      try {
        localStorage.removeItem('opentv_plugin_logos_v1');
      } catch {
        /* ignore */
      }
      const res = await desktopApi.clearCache().catch(() => ({ bytes: 0 }));
      const freed = Number(res?.bytes) || 0;
      onToast(freed > 0 ? `Caché borrada · ${formatBytes(freed)} liberados` : 'Caché borrada');
    } finally {
      setClearingCache(false);
    }
  };

  const handleExport = () => {
    const json = onExportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'opentv-backup.json';
    a.click();
    URL.revokeObjectURL(url);
    onToast('Copia de seguridad descargada');
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const ok = onImportJson(String(reader.result || ''));
      onToast(ok ? 'Respaldo restaurado correctamente' : 'El archivo no es un respaldo válido');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDownloadAction = async (id: string, action: 'pause' | 'resume' | 'delete') => {
    await desktopApi.service('downloadAction', { id, action });
    const res = await desktopApi.service<{ items?: DownloadItem[] }>('downloadList', {});
    if (Array.isArray(res?.items)) setDownloads(res.items);
  };

  const handlePlayDownload = async (dl: DownloadItem) => {
    const res = await desktopApi.service<{ url?: string; errorText?: string }>('downloadOpen', { id: dl.id });
    if (res?.url) onPlayOffline(dl, res.url);
    else onToast(res?.errorText || 'No se pudo abrir la descarga local');
  };

  useEffect(() => {
    if (section !== 'about') return;
    void desktopApi.update('status').then((st) => {
      if (st?.state) setUpdateInfo(st);
    });
    return desktopApi.listen<UpdateStatus>('desktop:update-status', (st) => {
      if (st?.state) setUpdateInfo(st);
    });
  }, [section]);

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    const st = await desktopApi.update('check');
    setUpdateInfo(st);
    setCheckingUpdate(false);
    if (st.state === 'up-to-date') onToast('Ya tienes la versión más reciente');
    else if (st.state === 'available') onToast(`Nueva versión obligatoria disponible: v${st.available}`);
    else if (st.error) onToast(st.error);
  };

  const handleDownloadOrInstallUpdate = async () => {
    if (updateInfo.state === 'ready') {
      const st = await desktopApi.update('install');
      setUpdateInfo(st);
      return;
    }
    if (!updateInfo.downloadUrl) {
      await desktopApi.update('releases');
      return;
    }
    const st = await desktopApi.update('download');
    setUpdateInfo(st);
  };

  const historyAsItems: MediaItem[] = watchProgress.map((w) => ({
    id: w.itemId,
    type: w.type,
    title: w.title,
    year: w.season > 0 ? `T${w.season} · E${w.episode}` : '',
    score: '',
    duration: '',
    genres: [],
    synopsis: '',
    poster: w.poster,
    backdrop: w.backdrop,
    isAnime: w.type === 'anime',
  }));

  return (
    <div className="flex h-full w-full overflow-hidden bg-page">
      {/* Left Navigation Sidebar (`04-en-vivo-ajustes-posteres.css:145-160`) */}
      <aside className="relative flex w-[200px] md:w-[236px] lg:w-[268px] shrink-0 flex-col bg-[#111114] light:bg-surface px-3 md:px-4 pt-6 pb-5">
        <div className="mb-8 px-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Volver"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-fg/20 bg-surface/75 text-fg transition hover:border-fg/40 hover:bg-fg/15 cursor-pointer"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1.5">
          {SECTIONS.map((s) => {
            const active = section === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className={`relative flex h-12 w-full items-center gap-3.5 overflow-hidden rounded-[12px] px-4 text-left text-[16.5px] transition-all cursor-pointer ${
                  active
                    ? 'bg-fg/[0.09] font-semibold text-fg'
                    : 'font-medium text-fg/65 hover:bg-fg/[0.04] hover:pl-5 hover:text-fg'
                }`}
              >
                {active && (
                  <span
                    style={{ backgroundColor: 'var(--ot-accent)' }}
                    className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full"
                  />
                )}
                <span className={active ? 'text-fg' : 'text-fg/65'}>{s.icon}</span>
                <span>{s.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-4 pt-4 text-[12px] text-fg/35 light:text-faint">OpenTV v{getAppVersion()}</div>
      </aside>

      {/* Right Content Pane */}
      <main className="ot-scroll flex-1 overflow-y-auto px-6 py-8 md:px-10 lg:px-14 lg:py-12">
        <div className="max-w-[1080px]">
          {/* ======================== MI CUENTA (`account.js`) ======================== */}
          {section === 'account' && (
            <div className="space-y-7">
              <div className="flex flex-wrap items-center gap-6">
                <div className="overflow-hidden rounded-[22px] ring-2 ring-fg/20">
                  <ProfileAvatar index={profile.avatarIndex} size={92} />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="font-display text-[36px] leading-tight font-semibold tracking-[-0.02em] text-fg">
                    {profile.name}
                  </h1>
                  <div className="mt-1 text-[15px] text-fg/50 light:text-muted">
                    {profile.kids ? 'Perfil infantil · ' : ''}Guardado solo en este equipo
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenProfiles(false)}
                    className="rounded-[12px] border border-fg/12 bg-fg/[0.06] px-4 py-2.5 text-[14px] font-semibold text-fg transition hover:bg-fg/14 cursor-pointer"
                  >
                    Cambiar de perfil
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenProfiles(true)}
                    className="rounded-[12px] border border-fg/12 bg-fg/[0.06] px-4 py-2.5 text-[14px] font-semibold text-fg transition hover:bg-fg/14 cursor-pointer"
                  >
                    Administrar perfiles
                  </button>
                </div>
              </div>

              {/* 3 Stat Cards (`acc-stats`) */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {[
                  [myList.length, myList.length === 1 ? 'Título en Mi lista' : 'Títulos en Mi lista'],
                  [favorites.length, favorites.length === 1 ? 'Favorito' : 'Favoritos'],
                  [watchProgress.length, watchProgress.length === 1 ? 'Visto recientemente' : 'Vistos recientemente'],
                ].map(([num, lbl]) => (
                  <div
                    key={String(lbl)}
                    className="rounded-[18px] border border-fg/[0.07] bg-fg/[0.04] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                  >
                    <div className="font-display text-[44px] leading-none font-semibold text-fg">{num}</div>
                    <div className="mt-2.5 text-[14.5px] text-fg/55 light:text-muted">{lbl}</div>
                  </div>
                ))}
              </div>

              {/* Quick Actions (`acc-actions`) */}
              <div className="space-y-3.5">
                <div className="text-[12.5px] font-semibold tracking-[0.14em] text-fg/45 light:text-muted uppercase">
                  Accesos rápidos
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {[
                    {
                      icon: <Bookmark className="h-5 w-5" />,
                      title: 'Mi lista',
                      sub: 'Películas y series que guardaste',
                      run: () => {
                        setListTab('mylist');
                        setSection('mylist');
                      },
                    },
                    {
                      icon: <Clock className="h-5 w-5" />,
                      title: 'Historial',
                      sub: 'Sigue donde lo dejaste',
                      run: () => {
                        setListTab('history');
                        setSection('mylist');
                      },
                    },
                    {
                      icon: <Sliders className="h-5 w-5" />,
                      title: 'Ajustes',
                      sub: 'Apariencia y reproducción',
                      run: () => setSection('prefs'),
                    },
                  ].map((a) => (
                    <button
                      key={a.title}
                      type="button"
                      onClick={a.run}
                      className="flex items-center gap-4 rounded-[18px] border border-fg/[0.08] bg-fg/[0.05] p-5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:-translate-y-0.5 hover:border-fg/20 hover:bg-fg/[0.1] cursor-pointer"
                    >
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-fg/10 text-fg">
                        {a.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[16.5px] font-semibold text-fg">{a.title}</div>
                        <div className="mt-0.5 truncate text-[12.5px] text-fg/50 light:text-muted">{a.sub}</div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-fg/40 light:text-muted" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Bloqueo y modo Kids (same block as the TV app's "Mi cuenta") */}
              <SettingGroup title="Bloqueo y modo Kids">
                <SettingRow
                  label="Pedir PIN para salir del perfil Kids"
                  hint="Exige el PIN parental al cambiar desde un perfil Kids hacia un perfil de adultos."
                >
                  <Segmented options={['No', 'Sí']} value={parentalLocked ? 1 : 0} onChange={handleToggleKidsLock} />
                </SettingRow>
                <SettingRow label="PIN parental (4 dígitos)">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      value={pinInput}
                      onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="••••"
                      aria-label="PIN parental"
                      className="h-10 w-32 rounded-[12px] border border-fg/15 bg-fg/[0.06] text-center text-[17px] font-bold tracking-[0.45em] text-fg outline-none focus:border-fg/50"
                    />
                    <button
                      type="button"
                      onClick={handleSavePin}
                      style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
                      className="h-10 rounded-[12px] px-4 text-[13.5px] font-bold cursor-pointer"
                    >
                      {parentalPin ? 'Cambiar PIN' : 'Crear PIN'}
                    </button>
                    {parentalPin && (
                      <button
                        type="button"
                        onClick={() => {
                          onSetParental('', false);
                          setPinInput('');
                          onToast('PIN parental eliminado');
                        }}
                        className="h-10 rounded-[12px] border border-fg/15 bg-fg/[0.06] px-4 text-[13.5px] font-semibold text-fg/80 hover:bg-fg/12 cursor-pointer"
                      >
                        Quitar PIN
                      </button>
                    )}
                  </div>
                </SettingRow>
              </SettingGroup>

              {/* Backup export/import */}
              <div className="space-y-3 rounded-[18px] border border-fg/[0.07] bg-fg/[0.035] p-5">
                <div className="text-[15.5px] font-semibold text-fg">Copia de seguridad local</div>
                <p className="text-[13.5px] text-fg/55 light:text-muted">
                  Tus perfiles, plugins y preferencias se sincronizan automáticamente en{' '}
                  <code className="rounded bg-fg/[0.07] px-1.5 py-0.5 font-mono text-[12px] text-fg/75">
                    Documentos\OpenTV\backup.json
                  </code>
                  .
                </p>
                <div className="flex flex-wrap gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={handleExport}
                    className="flex items-center gap-2 rounded-xl border border-fg/14 bg-fg/[0.07] px-4 py-2 text-[13.5px] font-semibold text-fg hover:bg-fg/15 cursor-pointer"
                  >
                    <Download className="h-4 w-4" />
                    <span>Exportar respaldo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 rounded-xl border border-fg/14 bg-fg/[0.07] px-4 py-2 text-[13.5px] font-semibold text-fg hover:bg-fg/15 cursor-pointer"
                  >
                    <Upload className="h-4 w-4" />
                    <span>Importar respaldo</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={handleImportFile}
                    className="hidden"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ======================== MI LISTA (`history.js`) ======================== */}
          {section === 'mylist' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="inline-flex gap-1 rounded-[14px] bg-fg/[0.06] p-1">
                  {(
                    [
                      ['mylist', `Mi lista (${myList.length})`],
                      ['favs', `Favoritos (${favorites.length})`],
                      ['history', `Historial (${watchProgress.length})`],
                    ] as const
                  ).map(([id, lbl]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setListTab(id)}
                      style={
                        listTab === id ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' } : undefined
                      }
                      className={`rounded-[10px] px-5 py-2 text-[14px] font-semibold transition cursor-pointer ${
                        listTab === id ? '' : 'text-fg/65 hover:bg-fg/[0.08] hover:text-fg'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>

                {listTab === 'history' && watchProgress.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      onClearHistory();
                      onToast('Historial borrado');
                    }}
                    className="rounded-xl border border-[#ff8a8a]/30 bg-[#ff5a5a]/10 px-4 py-2 text-[13.5px] font-semibold text-[#ff8a8a] light:text-[#c62828] hover:bg-[#ff5a5a]/20 cursor-pointer"
                  >
                    Borrar historial
                  </button>
                )}
              </div>

              {(() => {
                const items = listTab === 'mylist' ? myList : listTab === 'favs' ? favorites : historyAsItems;
                if (items.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center gap-3 rounded-[22px] border border-dashed border-fg/14 py-20 text-center text-[15px] text-fg/55 light:text-muted">
                      <OpenTvLogo className="h-11 w-11 text-fg/25 light:text-faint" />
                      <span>
                        {listTab === 'mylist'
                          ? 'Aún no guardas títulos en Mi lista.'
                          : listTab === 'favs'
                          ? 'Todavía no marcas ningún favorito.'
                          : 'Aún no has visto películas ni series.'}
                      </span>
                    </div>
                  );
                }
                return (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">
                    {items.map((item) => (
                      <div key={item.id} className="group relative">
                        <PosterCard
                          item={item}
                          fluid
                          captionMode={listTab === 'history' ? 'full' : 'title'}
                          onClick={() => onOpenTitle(item)}
                        />
                        {listTab !== 'history' && (
                          <button
                            type="button"
                            title="Quitar"
                            onClick={() => {
                              if (listTab === 'mylist') onRemoveFromMyList(item);
                              else onRemoveFavorite(item);
                            }}
                            className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-white/85 opacity-0 transition hover:bg-[#e5484d] group-hover:opacity-100 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ======================== AJUSTES (`settings-hub.js`) ======================== */}
          {section === 'prefs' && (
            <div className="space-y-7">
              <h1 className="font-display text-[34px] font-semibold tracking-[-0.02em] text-fg">Ajustes</h1>

              {/* Exact 2 Sub-tabs (`Apariencia` | `Reproducción`) */}
              <div className="inline-flex gap-1 rounded-[14px] bg-fg/[0.06] p-1">
                <button
                  type="button"
                  onClick={() => setHubTab('look')}
                  style={hubTab === 'look' ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' } : undefined}
                  className={`rounded-[10px] px-6 py-2 text-[14.5px] font-semibold transition cursor-pointer ${
                    hubTab === 'look' ? '' : 'text-fg/65 hover:bg-fg/[0.08] hover:text-fg'
                  }`}
                >
                  Apariencia
                </button>
                <button
                  type="button"
                  onClick={() => setHubTab('play')}
                  style={hubTab === 'play' ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' } : undefined}
                  className={`rounded-[10px] px-6 py-2 text-[14.5px] font-semibold transition cursor-pointer ${
                    hubTab === 'play' ? '' : 'text-fg/65 hover:bg-fg/[0.08] hover:text-fg'
                  }`}
                >
                  Reproducción
                </button>
              </div>

              {hubTab === 'look' ? (
                <div className="space-y-6">
                  {/* ESTILO */}
                  <SettingGroup title="Estilo">
                    <SettingRow label="Tema" hint="Claro u oscuro. El reproductor siempre se ve oscuro.">
                      <Segmented
                        options={['Oscuro', 'Claro']}
                        value={appearance.theme === 'light' ? 1 : 0}
                        onChange={(i) => onUpdateAppearance((c) => ({ ...c, theme: i === 1 ? 'light' : 'dark' }))}
                      />
                    </SettingRow>
                    <SettingRow
                      label="Color de acento"
                      hint="El color del foco, de las opciones elegidas, del botón de reproducir y de las barras de progreso."
                    >
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {ACCENTS.map((a) => {
                          const on = appearance.accentId === a.id;
                          return (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => onUpdateAppearance((c) => ({ ...c, accentId: a.id }))}
                              style={on ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' } : undefined}
                              className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13.5px] font-semibold transition cursor-pointer ${
                                on ? '' : 'bg-fg/[0.07] text-fg/75 hover:bg-fg/[0.13] hover:text-fg'
                              }`}
                            >
                              <span
                                style={{ backgroundColor: resolveAccent(a.id, appearance.theme).color }}
                                className={`h-3 w-3 rounded-full ${on ? 'ring-2 ring-current' : 'ring-1 ring-black/25'}`}
                              />
                              <span>{accentLabel(a.id, a.label, appearance.theme)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </SettingRow>

                    <SettingRow
                      label="Tamaño del texto"
                      hint="Aumentado agranda un 12 % toda la app, Ajustes incluido."
                    >
                      <Segmented
                        options={['Normal', 'Aumentado']}
                        value={appearance.textLarge ? 1 : 0}
                        onChange={(i) => onUpdateAppearance((c) => ({ ...c, textLarge: i === 1 }))}
                      />
                    </SettingRow>
                  </SettingGroup>

                  {/* INICIO */}
                  <SettingGroup title="Inicio">
                    <SettingRow label="Tamaño de los pósteres" hint="Compacto muestra más títulos en cada fila.">
                      <Segmented
                        options={['Normal', 'Compacto']}
                        value={appearance.uiDensity === 'compact' ? 1 : 0}
                        onChange={(i) =>
                          onUpdateAppearance((c) => ({ ...c, uiDensity: i === 1 ? 'compact' : 'normal' }))
                        }
                      />
                    </SettingRow>
                    <SettingRow
                      label="Idioma del catálogo"
                      hint="Títulos y sinopsis de películas y series."
                    >
                      <Segmented
                        options={['Español', 'Inglés']}
                        value={appearance.catalogLang === 'en' ? 1 : 0}
                        onChange={(i) => onUpdateAppearance((c) => ({ ...c, catalogLang: i === 1 ? 'en' : 'es' }))}
                      />
                    </SettingRow>
                  </SettingGroup>

                  {/* RENDIMIENTO */}
                  <SettingGroup title="Rendimiento">
                    <SettingRow
                      label="Modo ligero"
                      hint="Para equipos modestos o internet lento: pósters más ligeros, fichas con póster en vez de imagen de fondo, episodios sin miniatura, sin animaciones ni desenfoques, sin precarga de menús y calidad HD."
                    >
                      <Segmented
                        options={['Apagado', 'Encendido']}
                        value={appearance.liteMode ? 1 : 0}
                        onChange={(i) => onUpdateAppearance((c) => ({ ...c, liteMode: i === 1 }))}
                      />
                    </SettingRow>
                  </SettingGroup>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* VÍDEO */}
                  <SettingGroup title="Vídeo">
                    <SettingRow label="Formato de pantalla">
                      <Segmented
                        options={['Llenar', 'Original', '16:9', '4:3']}
                        value={(['cover', 'contain', '16-9', '4-3'] as const).indexOf(playback.screenFormat)}
                        onChange={(i) => {
                          const fmts = ['cover', 'contain', '16-9', '4-3'] as const;
                          onUpdatePlayback((c) => ({ ...c, screenFormat: fmts[i] || 'contain' }));
                        }}
                      />
                    </SettingRow>
                    <SettingRow label="Siguiente episodio automático" hint="Al llegar a los créditos empieza una cuenta regresiva.">
                      <Segmented
                        options={['No', 'Sí']}
                        value={playback.autoNextEpisode ? 1 : 0}
                        onChange={(i) => onUpdatePlayback((c) => ({ ...c, autoNextEpisode: i === 1 }))}
                      />
                    </SettingRow>
                    <SettingRow label="Omitir intro automáticamente" hint="Solo cuando se conoce el tiempo exacto de la intro.">
                      <Segmented
                        options={['No', 'Sí']}
                        value={playback.autoSkipIntro ? 1 : 0}
                        onChange={(i) => onUpdatePlayback((c) => ({ ...c, autoSkipIntro: i === 1 }))}
                      />
                    </SettingRow>
                  </SettingGroup>

                  {/* AUDIO */}
                  <SettingGroup title="Audio">
                    <SettingRow label="Idioma preferido" hint="Si el archivo trae varios idiomas, empieza en este.">
                      <Segmented
                        options={['Español', 'Portugués', 'Inglés']}
                        value={(['es', 'pt', 'en'] as const).indexOf(playback.preferredAudio)}
                        onChange={(i) => {
                          const arr = ['es', 'pt', 'en'] as const;
                          onUpdatePlayback((c) => ({ ...c, preferredAudio: arr[i] || 'es' }));
                        }}
                      />
                    </SettingRow>
                  </SettingGroup>

                  {/* SUBTÍTULOS */}
                  <SettingGroup title="Subtítulos">
                    <SettingRow label="Mostrar">
                      <Segmented
                        options={['No', 'Sí']}
                        value={playback.subtitlesEnabled ? 1 : 0}
                        onChange={(i) => onUpdatePlayback((c) => ({ ...c, subtitlesEnabled: i === 1 }))}
                      />
                    </SettingRow>
                    <SettingRow label="Idioma">
                      <Segmented
                        options={['Español', 'Portugués', 'Inglés']}
                        value={(['es', 'pt', 'en'] as const).indexOf(playback.preferredSubLang)}
                        onChange={(i) => {
                          const arr = ['es', 'pt', 'en'] as const;
                          onUpdatePlayback((c) => ({ ...c, preferredSubLang: arr[i] || 'es' }));
                        }}
                      />
                    </SettingRow>
                    <SettingRow label="Tamaño">
                      <Segmented
                        options={['Pequeño', 'Normal', 'Grande']}
                        value={playback.subtitleStyle.sizePx <= 18 ? 0 : playback.subtitleStyle.sizePx >= 26 ? 2 : 1}
                        onChange={(i) => {
                          const sizes = [18, 22, 28];
                          onUpdatePlayback((c) => ({ ...c, subtitleStyle: { ...c.subtitleStyle, sizePx: sizes[i] } }));
                        }}
                      />
                    </SettingRow>
                    <SettingRow label="Estilo">
                      <Segmented
                        options={['Blanco', 'Amarillo', 'Fondo negro']}
                        value={
                          playback.subtitleStyle.color === '#fde047'
                            ? 1
                            : playback.subtitleStyle.bgAlpha >= 0.85
                            ? 2
                            : 0
                        }
                        onChange={(i) => {
                          if (i === 0)
                            onUpdatePlayback((c) => ({
                              ...c,
                              subtitleStyle: { ...c.subtitleStyle, color: '#ffffff', bgAlpha: 0.65 },
                            }));
                          else if (i === 1)
                            onUpdatePlayback((c) => ({
                              ...c,
                              subtitleStyle: { ...c.subtitleStyle, color: '#fde047', bgAlpha: 0.65 },
                            }));
                          else
                            onUpdatePlayback((c) => ({
                              ...c,
                              subtitleStyle: { ...c.subtitleStyle, color: '#ffffff', bgAlpha: 0.92 },
                            }));
                        }}
                      />
                    </SettingRow>
                  </SettingGroup>
                </div>
              )}
            </div>
          )}

          {/* ======================== PLUGINS ======================== */}
          {section === 'plugins' && (
            <div className="space-y-6">
              <h1 className="font-display text-[34px] font-semibold tracking-[-0.02em] text-fg">Plugins</h1>
              <PluginsScreen
                embedded
                plugins={plugins}
                m3uPlaylists={m3uPlaylists}
                sourcePrefs={sourcePrefs}
                onUpsertPlugin={onUpsertPlugin}
                onTogglePluginDisabled={onTogglePluginDisabled}
                onRemovePlugin={onRemovePlugin}
                onSetAllowLan={onSetAllowLan}
                onAddM3u={onAddM3u}
                onRemoveM3u={onRemoveM3u}
                onUpdateSourcePrefs={onUpdateSourcePrefs}
                onToast={onToast}
              />
            </div>
          )}

          {/* ======================== DESCARGAS & ARCHIVOS LOCALES ======================== */}
          {section === 'downloads' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="font-display text-[34px] font-semibold tracking-[-0.02em] text-fg">
                  {downloadsTab === 'downloads' ? 'Descargas' : 'Archivos locales'}
                </h1>
                {downloadsTab === 'downloads' ? (
                  <button
                    type="button"
                    onClick={() => void desktopApi.openDownloads()}
                    className="flex h-11 items-center gap-2 rounded-[14px] border border-fg/14 bg-fg/[0.07] px-4 text-[14px] font-semibold text-fg hover:bg-fg/15 cursor-pointer"
                  >
                    <FolderOpen className="h-4 w-4" />
                    <span>Abrir carpeta</span>
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handlePickLocalVideo()}
                      style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
                      className="flex h-11 items-center gap-2 rounded-[14px] px-4 text-[14px] font-bold hover:brightness-110 cursor-pointer"
                    >
                      <Film className="h-4 w-4" />
                      <span>Abrir video</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleAddLocalFolder()}
                      className="flex h-11 items-center gap-2 rounded-[14px] border border-fg/14 bg-fg/[0.07] px-4 text-[14px] font-semibold text-fg hover:bg-fg/15 cursor-pointer"
                    >
                      <FolderPlus className="h-4 w-4" />
                      <span>Agregar carpeta / USB</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="inline-flex gap-1.5 rounded-[14px] border border-fg/[0.08] bg-fg/[0.05] p-1">
                {([
                  ['downloads', 'Descargas'],
                  ['local', 'Archivos locales'],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setDownloadsTab(id)}
                    style={
                      downloadsTab === id
                        ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }
                        : undefined
                    }
                    className={`rounded-[10px] px-5 py-2 text-[14px] font-semibold transition cursor-pointer ${
                      downloadsTab === id ? '' : 'text-fg/70 hover:text-fg'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {downloadsTab === 'downloads' ? (
                downloads.length === 0 ? (
                  <div className="rounded-[20px] border border-fg/[0.08] bg-fg/[0.035] py-16 text-center text-[15px] text-fg/55 light:text-muted">
                    No tienes descargas activas ni completadas.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {downloads.map((dl) => {
                      const pct = dl.total > 0 ? Math.min(100, Math.round((dl.bytes / dl.total) * 100)) : 0;
                      return (
                        <div
                          key={dl.id}
                          className="flex items-center justify-between gap-4 rounded-[20px] border border-fg/[0.08] bg-fg/[0.04] p-5"
                        >
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex items-center gap-2.5">
                              <span className="truncate text-[16px] font-semibold text-fg">{dl.title}</span>
                              <span className="rounded-md bg-fg/10 px-2 py-0.5 text-[11px] font-bold text-fg/75 uppercase">
                                {dl.status === 'done'
                                  ? 'Lista'
                                  : dl.status === 'downloading'
                                  ? `${pct}%`
                                  : dl.status === 'paused'
                                  ? 'Pausada'
                                  : dl.status === 'error'
                                  ? 'Error'
                                  : 'En cola'}
                              </span>
                            </div>
                            <div className="text-[13px] text-fg/55 light:text-muted">
                              {[
                                dl.subtitle || null,
                                dl.total > 0 ? `${formatBytes(dl.bytes)} / ${formatBytes(dl.total)}` : null,
                                dl.status === 'downloading' && dl.speed > 0 ? `${formatBytes(dl.speed)}/s` : null,
                                dl.error || null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                            {dl.status !== 'done' && (
                              <div className="h-1.5 overflow-hidden rounded-full bg-fg/12">
                                <div
                                  style={{ width: `${pct}%`, backgroundColor: 'var(--ot-accent)' }}
                                  className="h-full transition-all"
                                />
                              </div>
                            )}
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            {dl.status === 'done' && (
                              <button
                                type="button"
                                onClick={() => void handlePlayDownload(dl)}
                                style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
                                className="flex h-10 items-center gap-1.5 rounded-xl px-4 text-[13.5px] font-bold cursor-pointer"
                              >
                                <Play className="h-3.5 w-3.5 fill-current" />
                                <span>Ver</span>
                              </button>
                            )}
                            {dl.status === 'downloading' && (
                              <button
                                type="button"
                                onClick={() => void handleDownloadAction(dl.id, 'pause')}
                                title="Pausar"
                                className="flex h-10 w-10 items-center justify-center rounded-xl border border-fg/12 bg-fg/[0.06] text-fg hover:bg-fg/15 cursor-pointer"
                              >
                                <Pause className="h-4 w-4" />
                              </button>
                            )}
                            {(dl.status === 'paused' || dl.status === 'error') && (
                              <button
                                type="button"
                                onClick={() => void handleDownloadAction(dl.id, 'resume')}
                                title="Reanudar"
                                className="flex h-10 w-10 items-center justify-center rounded-xl border border-fg/12 bg-fg/[0.06] text-fg hover:bg-fg/15 cursor-pointer"
                              >
                                <Play className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleDownloadAction(dl.id, 'delete')}
                              title="Eliminar"
                              className="flex h-10 w-10 items-center justify-center rounded-xl border border-fg/12 bg-fg/[0.05] text-fg/60 hover:bg-[#e5484d]/20 hover:text-[#ff7377] light:hover:text-[#c62828] cursor-pointer"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : (
                <div className="space-y-5">
                  <div className="rounded-[18px] border border-fg/[0.08] bg-fg/[0.03] px-5 py-4 text-[13.5px] text-fg/65">
                    Reproduce tus propios videos (<span className="text-fg/85">MKV, MP4, AVI, MOV, WEBM, TS</span>)
                    sin plugins. También puedes <strong className="text-fg">arrastrar cualquier video</strong> sobre
                    la ventana de OpenTV; los subtítulos{' '}
                    <code className="rounded bg-fg/10 px-1.5 py-0.5 text-[12px]">.srt</code> o{' '}
                    <code className="rounded bg-fg/10 px-1.5 py-0.5 text-[12px]">.vtt</code> en la misma carpeta se
                    detectan automáticamente.
                  </div>

                  {localFolders.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-bold tracking-[0.08em] text-fg/45 light:text-muted uppercase">
                          Carpetas vinculadas ({localFolders.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => void scanLocalFolders(localFolders)}
                          disabled={scanningLocal}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-fg/12 bg-fg/[0.06] px-3 py-1 text-[12px] font-semibold text-fg/80 hover:bg-fg/12 cursor-pointer disabled:opacity-50"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${scanningLocal ? 'animate-spin' : ''}`} />
                          <span>Actualizar</span>
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {localFolders.map((dir) => (
                          <div
                            key={dir}
                            className="inline-flex max-w-full items-center gap-2 rounded-full border border-fg/12 bg-fg/[0.06] px-3.5 py-1.5 text-[12.5px] text-fg/85"
                          >
                            <HardDrive className="h-3.5 w-3.5 shrink-0 text-fg/55 light:text-muted" />
                            <span className="truncate max-w-[360px]" title={dir}>
                              {dir}
                            </span>
                            <button
                              type="button"
                              onClick={() => onRemoveLocalFolder(dir)}
                              title="Quitar carpeta"
                              className="rounded-full p-0.5 text-fg/50 light:text-muted hover:bg-fg/15 hover:text-fg cursor-pointer"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {scanningLocal ? (
                    <div className="rounded-[20px] border border-fg/[0.08] bg-fg/[0.035] py-14 text-center text-[14.5px] text-fg/55 light:text-muted">
                      Buscando videos en tus carpetas…
                    </div>
                  ) : localVideos.length === 0 ? (
                    <div className="rounded-[20px] border border-fg/[0.08] bg-fg/[0.035] py-14 text-center text-[14.5px] text-fg/55 light:text-muted">
                      {localFolders.length === 0
                        ? 'Usa «Abrir video» para ver un archivo al instante o «Agregar carpeta / USB» para listar tu colección.'
                        : 'No se encontraron videos compatibles en las carpetas vinculadas.'}
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {localVideos.map((vid) => (
                        <div
                          key={vid.path}
                          className="flex items-center justify-between gap-4 rounded-[18px] border border-fg/[0.08] bg-fg/[0.04] px-5 py-4 transition hover:bg-fg/[0.07]"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-2.5">
                              <span className="truncate text-[15.5px] font-semibold text-fg">{vid.title}</span>
                              <span className="rounded-md bg-fg/10 px-2 py-0.5 text-[10.5px] font-bold text-fg/75 uppercase">
                                {vid.ext}
                              </span>
                            </div>
                            <div className="truncate text-[12.5px] text-fg/50 light:text-muted">
                              {[vid.folder || null, formatBytes(vid.size)].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => onPlayLocalPath(vid.path)}
                            style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
                            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-4 text-[13.5px] font-bold cursor-pointer"
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                            <span>Ver</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ======================== AYUDA (`sd-plain`) ======================== */}
          {section === 'help' && (
            <div className="space-y-2">
              <h1 className="mb-4 font-display text-[34px] font-semibold tracking-[-0.02em] text-fg">Ayuda</h1>

              <div className="border-b border-fg/[0.08] py-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[18px] font-semibold text-fg">Diagnóstico del sistema</div>
                    <p className="mt-1 text-[14px] text-fg/60">
                      Comprueba el estado del núcleo Rust, el motor FFmpeg, el espacio libre y la velocidad de respuesta
                      de tus plugins activos.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={runningDiag}
                    onClick={() => void runSystemDiagnostics()}
                    style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
                    className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13.5px] font-bold cursor-pointer disabled:opacity-60"
                  >
                    <RefreshCw className={`h-4 w-4 ${runningDiag ? 'animate-spin' : ''}`} />
                    <span>{runningDiag ? 'Analizando…' : 'Ejecutar diagnóstico'}</span>
                  </button>
                </div>

                {diagRows && (
                  <div className="mt-4 divide-y divide-fg/[0.07] overflow-hidden rounded-[16px] border border-fg/[0.08] bg-fg/[0.035]">
                    {diagRows.map((r) => (
                      <div key={r.label} className="flex items-center justify-between gap-4 px-5 py-3 text-[13.5px]">
                        <span className="font-medium text-fg/85">{r.label}</span>
                        <span className={`font-semibold tabular-nums ${r.ok ? 'text-[#7ee2a8] light:text-[#15803d]' : 'text-[#ff7377] light:text-[#c62828]'}`}>
                          {r.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-b border-fg/[0.08] py-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[18px] font-semibold text-fg">Almacenamiento</div>
                    <p className="mt-1 text-[14px] text-fg/60">
                      Borrar caché libera espacio: imágenes y catálogos guardados se vuelven a descargar. No borra
                      perfiles, listas ni descargas.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={clearingCache}
                    onClick={() => void handleClearCache()}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-fg/14 bg-fg/[0.07] px-4 text-[13.5px] font-semibold text-fg hover:bg-fg/15 cursor-pointer disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>{clearingCache ? 'Borrando…' : 'Borrar caché'}</span>
                  </button>
                </div>
              </div>

              <div className="border-b border-fg/[0.08] py-5">
                <div className="text-[18px] font-semibold text-fg">Registro de errores</div>
                <p className="mt-1 text-[14px] text-fg/60">
                  La app anota en un archivo los errores y cierres inesperados (no se envía nada). Si algo falla, abre
                  la carpeta y adjunta{' '}
                  <code className="rounded bg-fg/[0.07] px-1.5 py-0.5 font-mono text-[12px] text-fg/75">
                    opentv.log
                  </code>
                  .
                </p>
                <button
                  type="button"
                  onClick={() => void desktopApi.openLogs()}
                  className="mt-3.5 inline-flex h-10 items-center gap-2 rounded-xl border border-fg/14 bg-fg/[0.07] px-4 text-[13.5px] font-semibold text-fg hover:bg-fg/15 cursor-pointer"
                >
                  <FileText className="h-4 w-4" />
                  <span>Abrir carpeta del registro</span>
                </button>
              </div>

              <div className="pt-5">
                <div className="mb-4 text-[18px] font-semibold text-fg">Atajos de teclado</div>
                <div className="grid grid-cols-1 gap-x-10 gap-y-3 md:grid-cols-2">
                  {DESKTOP_SHORTCUTS.map(([key, desc]) => (
                    <div key={key} className="flex items-center gap-3.5 text-[14.5px] text-fg/75">
                      <kbd className="min-w-[64px] rounded-[9px] border border-fg/20 border-b-[3px] bg-fg/[0.06] px-3 py-1 text-center text-[13px] font-semibold text-fg">
                        {key}
                      </kbd>
                      <span>{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ======================== ACERCA DE (`sd-plain`) ======================== */}
          {section === 'about' && (
            <div className="space-y-0">
              <h1 className="mb-6 font-display text-[34px] font-semibold tracking-[-0.02em] text-fg">Acerca de</h1>

              <div className="flex items-center gap-6 border-b border-fg/[0.08] pb-7">
                <div className="flex h-20 w-20 items-center justify-center rounded-[22px] border border-fg/10 bg-surface-alt shadow-2xl">
                  <OpenTvLogo className="h-11 w-11 text-fg" />
                </div>
                <div>
                  <div className="font-display text-[34px] leading-none font-bold text-fg">OpenTV</div>
                  <div className="mt-1.5 text-[15px] text-fg/50 light:text-muted">
                    Versión {getAppVersion()} · Windows x64 (Tauri v2 + Rust)
                  </div>
                  <div className="mt-1 text-[14.5px] text-fg/72">
                    Películas, series y TV en vivo en un solo lugar.
                  </div>
                </div>
              </div>

              <div className="border-b border-fg/[0.08] py-6">
                <div className="text-[18px] font-semibold text-fg">Actualizaciones</div>
                <p className="mt-1 text-[14px] text-fg/60">
                  {updateInfo.state === 'available'
                    ? `Hay una nueva versión disponible: v${updateInfo.available}.`
                    : updateInfo.state === 'up-to-date'
                    ? 'Ya tienes la versión más reciente de OpenTV.'
                    : 'Comprueba si hay una versión más reciente disponible.'}
                </p>
                <div className="mt-3.5 flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    disabled={checkingUpdate}
                    onClick={() => void handleCheckUpdate()}
                    style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
                    className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13.5px] font-bold cursor-pointer disabled:opacity-60"
                  >
                    <RefreshCw className={`h-4 w-4 ${checkingUpdate ? 'animate-spin' : ''}`} />
                    <span>{checkingUpdate ? 'Buscando…' : 'Buscar actualizaciones'}</span>
                  </button>
                  {(updateInfo.state === 'available' || updateInfo.state === 'downloading' || updateInfo.state === 'ready') && (
                    <button
                      type="button"
                      disabled={updateInfo.state === 'downloading'}
                      onClick={() => void handleDownloadOrInstallUpdate()}
                      className="inline-flex h-10 items-center rounded-xl border border-[#7ee2a8]/40 bg-[#7ee2a8]/15 px-4 text-[13.5px] font-bold text-[#7ee2a8] light:text-[#15803d] cursor-pointer disabled:opacity-60"
                    >
                      {updateInfo.state === 'ready'
                        ? `Instalar v${updateInfo.available || ''} ahora`
                        : updateInfo.state === 'downloading'
                          ? `Descargando (${updateInfo.progress || 0}%)…`
                          : `Actualizar a v${updateInfo.available || ''}`}
                    </button>
                  )}
                </div>
                {updateInfo.state === 'downloading' && (
                  <div className="mt-3 h-2 w-full max-w-md overflow-hidden rounded-full bg-fg/10">
                    <div
                      style={{ width: `${Math.max(4, updateInfo.progress || 0)}%`, backgroundColor: 'var(--ot-accent)' }}
                      className="h-full rounded-full transition-[width] duration-200"
                    />
                  </div>
                )}
              </div>

              <div className="border-b border-fg/[0.08] py-6">
                <div className="text-[18px] font-semibold text-fg">Sin cuentas ni contraseñas</div>
                <p className="mt-1 text-[14px] text-fg/60">
                  Tu lista, el historial y tus preferencias se guardan solo en este equipo; no se envían a ningún
                  servidor.
                </p>
              </div>

              <div className="space-y-1.5 pt-6">
                <div className="text-[16px] font-semibold text-fg">Hecho por TECHPOINT Software™</div>
                <div className="text-[13px] text-fg/50 light:text-muted">
                  © 2026 TECHPOINT Software™ · Todos los derechos reservados
                </div>
                <div className="text-[13px] text-fg/50 light:text-muted">
                  Impulsado por Tauri v2, React, Rust (`opentv-core`), `librqbit` y HLS.js (código abierto).
                </div>
                <div className="text-[13px] text-fg/50 light:text-muted">
                  Tendencias con datos de TMDB. Este producto usa la API de TMDB pero no está avalado ni certificado por
                  TMDB.
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

const SettingGroup: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="overflow-hidden rounded-[18px] border border-fg/[0.08] bg-fg/[0.035]">
    <h3 className="px-6 pt-4 pb-1 text-[12px] font-bold tracking-[0.09em] text-fg/45 light:text-muted uppercase">{title}</h3>
    <div className="divide-y divide-fg/[0.07]">{children}</div>
  </section>
);

const SettingRow: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({
  label,
  hint,
  children,
}) => (
  <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
    <div className="flex items-center gap-2 text-[16px] font-medium text-fg">
      <span>{label}</span>
      {hint && (
        <span title={hint} className="inline-flex cursor-help text-fg/40 light:text-muted transition hover:text-fg">
          <Info className="h-4 w-4" />
        </span>
      )}
    </div>
    <div>{children}</div>
  </div>
);

const Segmented: React.FC<{ options: string[]; value: number; onChange: (idx: number) => void }> = ({
  options,
  value,
  onChange,
}) => (
  <div className="inline-flex gap-1 rounded-[12px] bg-fg/[0.07] p-1">
    {options.map((opt, idx) => {
      const on = idx === value;
      return (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(idx)}
          style={on ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' } : undefined}
          className={`rounded-[9px] px-4 py-1.5 text-[13.5px] font-semibold whitespace-nowrap transition cursor-pointer ${
            on ? '' : 'text-fg/70 hover:bg-fg/[0.09] hover:text-fg'
          }`}
        >
          {opt}
        </button>
      );
    })}
  </div>
);
