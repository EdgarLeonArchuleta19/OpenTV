import React, { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ExternalLink,
  Plus,
  Power,
  PowerOff,
  Search,
  Settings2,
  Shield,
  Trash2,
  X,
} from 'lucide-react';
import type { CommunityPlugin, InstalledPlugin, M3uPlaylist, SourcePrefs } from '../types/models';
import { COMMUNITY_PLUGINS, PLUGIN_CATEGORIES, isLiveTvPlugin, stremioBaseFromUrl } from '../services/catalogs';
import { inspectPlugin } from '../services/stremio';
import { desktopApi } from '../services/tauri';
import { PluginIcon } from '../components/PluginIcon';

interface PluginsScreenProps {
  embedded?: boolean;
  plugins: InstalledPlugin[];
  m3uPlaylists: M3uPlaylist[];
  sourcePrefs: SourcePrefs;
  onUpsertPlugin: (p: InstalledPlugin) => void;
  onTogglePluginDisabled: (url: string) => void;
  onRemovePlugin: (url: string) => void;
  onSetAllowLan: (url: string, allow: boolean) => void;
  onAddM3u: (pl: M3uPlaylist) => void;
  onRemoveM3u: (url: string) => void;
  onUpdateSourcePrefs: (fn: (cur: SourcePrefs) => SourcePrefs) => void;
  onBack?: () => void;
  onToast: (msg: string) => void;
}

const LANG_OPTIONS = [
  { id: 'latino', label: 'Español Latino' },
  { id: 'castellano', label: 'Castellano' },
  { id: 'en', label: 'Inglés' },
  { id: 'pt', label: 'Portugués' },
  { id: 'ja', label: 'Japonés' },
];

const EXCLUDE_OPTIONS = [
  { id: 'cam', label: 'CAM / Telesync' },
  { id: '3d', label: '3D' },
  { id: '4k', label: '4K' },
  { id: 'hdr', label: 'HDR / Dolby Vision' },
  { id: 'hevc', label: 'HEVC / x265' },
  { id: 'remux', label: 'Remux' },
  { id: 'dts', label: 'DTS' },
  { id: 'truehd', label: 'TrueHD' },
];

// Community categories that belong to the "TV en vivo" section (M3U lists).
const LIVE_TV_CATEGORIES = new Set(['gratis', 'deportes', 'paises', 'noticias', 'infantil', 'cine', 'documentales']);

/**
 * Plugins screen (same structure as Android `PluginsPanel`):
 * - 2-tab switch (`Instalados` | `Comunidad`) + `Agregar plugin` button
 * - Instalados: "Mis plugins" (user plugins + M3U lists), split into "Películas y series" / "TV en vivo".
 *   The bundled system plugins (catalog fallbacks and subtitles) work internally and are never listed.
 * - Comunidad: search + category picker, recommended plugins, then "Películas y series" / "TV en vivo".
 */
export const PluginsScreen: React.FC<PluginsScreenProps> = ({
  embedded = false,
  plugins,
  m3uPlaylists,
  sourcePrefs,
  onUpsertPlugin,
  onTogglePluginDisabled,
  onRemovePlugin,
  onSetAllowLan,
  onAddM3u,
  onRemoveM3u,
  onUpdateSourcePrefs,
  onBack,
  onToast,
}) => {
  const [tab, setTab] = useState<'mine' | 'community'>('mine');
  const [cat, setCat] = useState<string>('all');
  const [catModalOpen, setCatModalOpen] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [manualInput, setManualInput] = useState<string>('');
  const [manualName, setManualName] = useState<string>('');
  const [installingUrl, setInstallingUrl] = useState<string>('');
  const [configPlugin, setConfigPlugin] = useState<InstalledPlugin | null>(null);
  const [xtreamOpen, setXtreamOpen] = useState<boolean>(false);
  const [xtreamServer, setXtreamServer] = useState<string>('');
  const [xtreamUser, setXtreamUser] = useState<string>('');
  const [xtreamPass, setXtreamPass] = useState<string>('');

  // Only the user's plugins are listed; bundled system plugins stay hidden (internal fallbacks).
  const userPlugins = useMemo(() => plugins.filter((p) => !p.builtin), [plugins]);
  const userVod = useMemo(() => userPlugins.filter((p) => !isLiveTvPlugin(p)), [userPlugins]);
  const userLive = useMemo(() => userPlugins.filter(isLiveTvPlugin), [userPlugins]);
  const hasSourcePlugin = plugins.some((p) => !p.disabled && (p.hasStream || p.kind === 'kino-js'));

  const installedBases = useMemo(() => new Set(plugins.map((p) => stremioBaseFromUrl(p.url))), [plugins]);
  const installedM3uUrls = useMemo(() => new Set(m3uPlaylists.map((m) => m.url.toLowerCase())), [m3uPlaylists]);

  const communityList = useMemo(() => {
    const ql = search.trim().toLowerCase();
    return COMMUNITY_PLUGINS.filter((item) => {
      if (cat === 'recomendados' && !item.recommendedRank) return false;
      if (cat !== 'all' && cat !== 'recomendados' && item.category !== cat) return false;
      if (!ql) return true;
      return (
        item.name.toLowerCase().includes(ql) ||
        item.description.toLowerCase().includes(ql) ||
        item.category.toLowerCase().includes(ql)
      );
    });
  }, [cat, search]);

  const recommendedCommunity = useMemo(
    () => (cat === 'all' && !search.trim() ? communityList.filter((i) => i.recommendedRank) : []),
    [cat, communityList, search],
  );
  const regularCommunity = useMemo(
    () => (cat === 'all' && !search.trim() ? communityList.filter((i) => !i.recommendedRank) : communityList),
    [cat, communityList, search],
  );
  // Same split as "Mis plugins": on-demand sources vs live TV lists. Items keep the category order.
  const communitySections = useMemo(() => {
    const catOrder = new Map(PLUGIN_CATEGORIES.map((c, i) => [c.id, i]));
    const sorted = [...regularCommunity].sort(
      (a, b) => (catOrder.get(a.category) ?? 99) - (catOrder.get(b.category) ?? 99),
    );
    const isLive = (i: CommunityPlugin) => i.kind === 'm3u' || LIVE_TV_CATEGORIES.has(i.category);
    return [
      { id: 'vod', title: 'Películas y series', hint: 'Fuentes, torrents, catálogos y subtítulos', items: sorted.filter((i) => !isLive(i)) },
      { id: 'live', title: 'TV en vivo', hint: 'Listas M3U de canales gratis, deportes, noticias y más', items: sorted.filter(isLive) },
    ].filter((s) => s.items.length > 0);
  }, [regularCommunity]);

  const activeCatLabel = PLUGIN_CATEGORIES.find((c) => c.id === cat)?.label || 'Todas';

  const isXtreamLike = (url: string) => /get\.php\?/i.test(url) && /username=/i.test(url);
  const looksLikeM3u = (url: string) => /\.m3u8?(\?|#|$)/i.test(url) || isXtreamLike(url);
  const isPrivateHost = (url: string) => {
    try {
      const h = new URL(url).hostname.toLowerCase();
      return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.|::1|\[::1\]|.*\.local)$/.test(h);
    } catch { return false; }
  };
  const isShortCode = (v: string) => /^\d{4,9}$/.test(v) || /^![A-Za-z0-9_-]{2,48}$/.test(v) || /^[A-Za-z0-9_-]{4,48}$/.test(v);
  const looksLikeDirectMedia = (v: string) => /^magnet:\?/i.test(v) || /\.(mp4|mkv|webm|avi|mov|m4v|ts|m3u8)(\?|#|$)/i.test(v);

  const installM3uUrl = async (url: string, name?: string, allowLanHint?: boolean) => {
    const allowLan = allowLanHint ?? isPrivateHost(url);
    const res = await desktopApi.service<{ channels?: unknown[]; errorText?: string }>('fetchM3u', { url, allowLan });
    if (!res?.channels || res.channels.length === 0) {
      throw new Error(res?.errorText || 'La lista M3U no contiene canales válidos');
    }
    onAddM3u({
      id: `m3u_${Math.random().toString(36).slice(2, 9)}`,
      name: name?.trim() || (isXtreamLike(url) ? 'Cuenta Xtream' : 'Lista TV en vivo'),
      url,
      description: `${res.channels.length} canales en vivo`,
      enabled: true,
      allowLan,
    });
    onToast(`Lista agregada · ${res.channels.length} canales`);
  };

  const installFromInput = async (
    rawUrl: string,
    customName?: string,
    kindHint?: CommunityPlugin['kind'],
    opts?: { allowLan?: boolean },
  ) => {
    const raw = rawUrl.trim();
    if (!raw) return;
    setInstallingUrl(raw);
    try {
      let clean = raw;
      if (isShortCode(raw) && !/^https?:\/\//i.test(raw)) {
        const resolved = await desktopApi.service<{ url?: string; errorText?: string }>('resolveShortCode', { code: raw });
        if (!resolved?.url) throw new Error(resolved?.errorText || 'No se pudo resolver el código corto');
        clean = String(resolved.url).trim();
      }

      const looksM3u = kindHint === 'm3u' || looksLikeM3u(clean);
      if (looksM3u) {
        await installM3uUrl(clean, customName, opts?.allowLan);
        setAddOpen(false); setManualInput(''); setManualName('');
        setXtreamOpen(false); setXtreamServer(''); setXtreamUser(''); setXtreamPass('');
        return;
      }

      if (looksLikeDirectMedia(clean)) {
        const isMagnet = /^magnet:\?/i.test(clean);
        const name = customName?.trim() || (isMagnet ? 'Magnet directo' : 'Video directo');
        onUpsertPlugin({
          id: `direct_${Math.random().toString(36).slice(2, 9)}`,
          name,
          url: clean,
          baseUrl: '',
          kind: 'stremio',
          description: isMagnet ? 'Fuente magnet directa' : 'Fuente de video directa',
          logo: '',
          version: '',
          builtin: false,
          disabled: false,
          allowLan: false,
          hasCatalog: false,
          hasStream: true,
          hasSubtitles: false,
          hasMeta: false,
          types: ['movie', 'series'],
          catalogs: [],
        });
        onToast(`${name} agregado`);
        setAddOpen(false); setManualInput(''); setManualName('');
        return;
      }

      try {
        const inspected = await inspectPlugin(clean);
        if (inspected.kind === 'collection') {
          let added = 0;
          for (const ad of inspected.addons) {
            try {
              const r = await inspectPlugin(ad.url);
              if (r.kind === 'plugin') { onUpsertPlugin(r.plugin); added++; }
            } catch { /* skip bad addon */ }
          }
          if (added === 0) throw new Error('No se pudo instalar ningún plugin de la colección');
          onToast(`Colección “${inspected.name}”: ${added} plugins agregados`);
        } else {
          onUpsertPlugin(inspected.plugin);
          onToast(`Plugin “${inspected.plugin.name}” agregado`);
        }
        setAddOpen(false); setManualInput(''); setManualName('');
        return;
      } catch (pluginErr) {
        // Ambiguous domain/URL: try as M3U list before failing.
        const canTryM3u = /^https?:\/\//i.test(clean) || /^[a-z0-9.-]+\.[a-z]{2,}([/:].*)?$/i.test(clean);
        if (canTryM3u) {
          try {
            await installM3uUrl(/^https?:\/\//i.test(clean) ? clean : `https://${clean}`, customName, opts?.allowLan);
            setAddOpen(false); setManualInput(''); setManualName('');
            setXtreamOpen(false); setXtreamServer(''); setXtreamUser(''); setXtreamPass('');
            return;
          } catch { /* fall through to original error */ }
        }
        throw pluginErr;
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'No se pudo instalar el plugin');
    } finally {
      setInstallingUrl('');
    }
  };

  const renderCommunityCard = (item: CommunityPlugin) => {
    const installed =
      item.kind === 'm3u'
        ? installedM3uUrls.has(item.url.toLowerCase())
        : installedBases.has(stremioBaseFromUrl(item.url));
    const busy = installingUrl === item.url;
    const typeText = item.kind === 'm3u' ? 'TV en vivo' : 'Películas y series';

    return (
      <div
        key={item.id}
        onClick={() => {
          if (!installed && !busy) void installFromInput(item.url, item.name, item.kind);
        }}
        className={`group flex flex-col gap-3.5 rounded-[18px] border border-fg/[0.06] bg-surface p-5 transition ${
          installed ? 'cursor-default' : 'cursor-pointer hover:border-fg/15 hover:bg-[#17171d] light:hover:bg-surface-alt'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <PluginIcon
            id={item.id}
            name={item.name}
            url={item.url}
            logo={item.logo}
            kind={item.kind}
            category={item.category}
          />

          <button
            type="button"
            disabled={installed || busy}
            title={installed ? 'Instalado' : 'Agregar'}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition ${
              installed
                ? 'border-[#8fc7a5]/25 bg-[#8fc7a5]/10 text-[#8fc7a5] light:text-[#15803d]'
                : 'border-transparent bg-fg/[0.09] text-[#dcd9d3] light:text-fg group-hover:bg-[#e9e7e2] group-hover:text-[#15151a] light:group-hover:bg-fg light:group-hover:text-page cursor-pointer'
            }`}
          >
            {busy ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : installed ? (
              <Check className="h-4 w-4" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </button>
        </div>

        <div className="min-w-0">
          <div className="truncate text-[17px] font-bold text-[#eceae6] light:text-fg">{item.name}</div>
          <div className="mt-0.5 truncate text-[12.5px] text-[#eceae6]/42 light:text-muted">{typeText}</div>
          <p className="mt-2 line-clamp-2 min-h-[2.8em] text-[13px] leading-[1.42] text-[#eceae6]/55 light:text-muted">
            {item.description}
          </p>
        </div>
      </div>
    );
  };

  const renderInstalledCard = (p: InstalledPlugin) => (
    <div
      key={p.url}
      className={`group flex flex-col gap-3.5 rounded-[18px] border p-5 transition ${
        p.disabled
          ? 'border-[#ff786e]/25 bg-[#121216] light:bg-surface-alt'
          : 'border-fg/[0.06] bg-surface hover:border-fg/15 hover:bg-[#17171d] light:hover:bg-surface-alt'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <PluginIcon
          id={p.id}
          name={p.name}
          url={p.url}
          logo={p.logo}
          kind={p.kind}
          hasStream={p.hasStream}
          hasCatalog={p.hasCatalog}
          hasSubtitles={p.hasSubtitles}
          dimmed={p.disabled}
        />

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              onTogglePluginDisabled(p.url);
              onToast(p.disabled ? `“${p.name}” activado` : `“${p.name}” desactivado`);
            }}
            title={p.disabled ? 'Activar plugin' : 'Desactivar plugin'}
            aria-label={p.disabled ? 'Activar plugin' : 'Desactivar plugin'}
            aria-pressed={!p.disabled}
            className={`flex h-9 w-9 items-center justify-center rounded-full border transition cursor-pointer ${
              p.disabled
                ? 'border-fg/[0.10] bg-transparent text-fg/35 light:text-faint hover:border-fg/25 hover:text-fg/70'
                : 'border-[#7ee2a8]/45 bg-[#7ee2a8]/15 text-[#7ee2a8] light:text-[#15803d]'
            }`}
          >
            {p.disabled ? (
              <PowerOff className="h-4 w-4" />
            ) : (
              <Power className="h-4 w-4" strokeWidth={2.6} />
            )}
          </button>

          <button
            type="button"
            onClick={() => setConfigPlugin(p)}
            title="Configurar"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-fg/[0.08] text-[#eceae6]/55 light:text-muted transition hover:border-transparent hover:bg-[#e9e7e2] hover:text-[#15151a] light:hover:bg-fg light:hover:text-page cursor-pointer"
          >
            <Settings2 className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              onRemovePlugin(p.url);
              onToast(`Plugin “${p.name}” quitado`);
            }}
            title="Quitar"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-fg/[0.08] text-[#eceae6]/50 light:text-muted transition hover:border-transparent hover:bg-[#e59a91] hover:text-[#1a1212] cursor-pointer"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className={`min-w-0 ${p.disabled ? 'opacity-45' : ''}`}>
        <div className="truncate text-[17px] font-bold text-[#eceae6] light:text-fg">{p.name}</div>
        <div className="mt-0.5 truncate text-[12.5px] text-[#eceae6]/42 light:text-muted">
          {[
            p.hasCatalog ? 'Catálogo' : null,
            p.hasStream ? 'Fuentes' : null,
            p.hasSubtitles ? 'Subtítulos' : null,
            p.kind === 'kino-js' ? 'Aislado' : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'Plugin'}
        </div>
        <p className="mt-2 line-clamp-2 min-h-[2.8em] text-[13px] leading-[1.42] text-[#eceae6]/55 light:text-muted">
          {p.description || p.url}
        </p>
      </div>
    </div>
  );

  const renderM3uCard = (m: M3uPlaylist) => (
    <div
      key={m.url}
      className="flex flex-col gap-3 rounded-[18px] border border-fg/[0.06] bg-surface p-5"
    >
      <div className="flex items-start justify-between gap-2">
        <PluginIcon id={m.id} name={m.name} url={m.url} kind="m3u" />
        <button
          type="button"
          onClick={() => {
            onRemoveM3u(m.url);
            onToast(`Lista “${m.name}” quitada`);
          }}
          title="Quitar lista"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-fg/[0.08] text-[#eceae6]/50 light:text-muted transition hover:border-transparent hover:bg-[#e59a91] hover:text-[#1a1212] cursor-pointer"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="min-w-0">
        <div className="truncate text-[17px] font-bold text-[#eceae6] light:text-fg">{m.name}</div>
        <div className="mt-0.5 truncate text-[12.5px] text-[#eceae6]/42 light:text-muted">TV en vivo · Lista M3U</div>
        <p className="mt-2 line-clamp-2 text-[13px] text-[#eceae6]/55 light:text-muted">{m.description || m.url}</p>
      </div>
    </div>
  );

  // One sub-group ("Películas y series" / "TV en vivo"): uppercase label, card grid or a one-line empty state.
  const renderGroup = (title: string, cards: React.ReactNode[], empty: string) => (
    <div className="space-y-3">
      <div className="text-[12.5px] font-bold tracking-[0.1em] text-fg/45 light:text-muted uppercase">{title}</div>
      {cards.length > 0 ? (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">{cards}</div>
      ) : (
        <div className="px-1 text-[13.5px] text-fg/45 light:text-muted">{empty}</div>
      )}
    </div>
  );

  return (
    <div className={embedded ? 'space-y-6' : 'ot-scroll h-full w-full overflow-y-auto px-6 sm:px-10 lg:px-12 pt-8 pb-16'}>
      <div className={embedded ? 'space-y-6' : 'mx-auto max-w-[1160px] space-y-6'}>
        {!embedded && (
          <div className="flex items-center gap-4">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label="Volver"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-fg/15 bg-fg/[0.06] text-fg hover:bg-fg/15 cursor-pointer"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <h1 className="font-display text-[32px] font-bold tracking-[-0.02em] text-fg">Plugins</h1>
          </div>
        )}

        {/* Exact `pl-bar`: Encapsulated 2-tab switch on left + `Agregar plugin` CTA on right */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="inline-flex gap-1 rounded-[14px] bg-fg/[0.06] p-1">
            <button
              type="button"
              onClick={() => setTab('mine')}
              style={tab === 'mine' ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' } : undefined}
              className={`rounded-[10px] px-5 py-2 text-[14.5px] font-semibold transition cursor-pointer ${
                tab === 'mine' ? '' : 'text-fg/65 hover:bg-fg/[0.08] hover:text-fg'
              }`}
            >
              Instalados ({userPlugins.length + m3uPlaylists.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('community')}
              style={
                tab === 'community' ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' } : undefined
              }
              className={`rounded-[10px] px-5 py-2 text-[14.5px] font-semibold transition cursor-pointer ${
                tab === 'community' ? '' : 'text-fg/65 hover:bg-fg/[0.08] hover:text-fg'
              }`}
            >
              Comunidad
            </button>
          </div>

          <button
            type="button"
            onClick={() => setAddOpen(true)}
            style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
            className="flex h-11 items-center gap-2 rounded-[14px] px-5 text-[14px] font-bold transition hover:brightness-90 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Agregar plugin</span>
          </button>
        </div>

        {tab === 'mine' ? (
          <div className="space-y-9">
            <section className="space-y-4">
              <div className="flex items-baseline justify-between gap-3 px-1">
                <h3 className="text-[17px] font-bold text-[#eceae6] light:text-fg">Mis plugins</h3>
                {!hasSourcePlugin && (
                  <span className="truncate text-[12.5px] font-semibold text-[#e5b26b] light:text-[#9a5b0a]">
                    Sin plugin de fuentes no se puede reproducir
                  </span>
                )}
              </div>
              {renderGroup('Películas y series', userVod.map(renderInstalledCard), 'Sin plugins de películas y series.')}
              {renderGroup(
                'TV en vivo',
                [...userLive.map(renderInstalledCard), ...m3uPlaylists.map(renderM3uCard)],
                'Sin listas ni plugins de TV en vivo.',
              )}
            </section>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Exact `pl-tools`: Search bar + Category Dropdown (`11-fuentes-stremio.css:365-390`) */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex h-12 min-w-[240px] flex-1 items-center gap-3 rounded-[14px] border border-fg/[0.07] bg-surface-alt px-4 focus-within:border-fg/40">
                <Search className="h-4 w-4 shrink-0 text-fg/40 light:text-muted" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar en la comunidad…"
                  className="h-full min-w-0 flex-1 bg-transparent text-[14.5px] text-[#eceae6] light:text-fg placeholder-fg/35 light:placeholder-faint outline-none"
                />
              </div>

              <button
                type="button"
                onClick={() => setCatModalOpen(true)}
                className="flex h-12 min-w-[240px] items-center justify-between gap-2.5 rounded-[14px] border border-fg/[0.07] bg-surface-alt px-4 text-left transition hover:bg-[#1e1e24] light:hover:bg-elev cursor-pointer"
              >
                <span className="text-[13px] text-fg/45 light:text-muted">Categoría</span>
                <span className="flex-1 truncate text-[14px] font-semibold text-[#eceae6] light:text-fg">{activeCatLabel}</span>
                <ChevronDown className="h-4 w-4 text-fg/45 light:text-muted" />
              </button>
            </div>

            {recommendedCommunity.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-baseline justify-between px-1">
                  <h3 className="text-[17px] font-bold text-[#eceae6] light:text-fg">Recomendados para PC</h3>
                  <span className="text-[12.5px] text-[#eceae6]/42 light:text-muted">Verificados en español</span>
                </div>
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
                  {recommendedCommunity.map(renderCommunityCard)}
                </div>
              </section>
            )}

            {communitySections.map((s) => (
              <section key={s.id} className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-[12.5px] font-bold tracking-[0.1em] text-fg/45 light:text-muted uppercase">{s.title}</div>
                  <span className="truncate text-[12.5px] text-[#eceae6]/42 light:text-muted">
                    {s.hint} · {s.items.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
                  {s.items.map(renderCommunityCard)}
                </div>
              </section>
            ))}

            {communitySections.length === 0 && recommendedCommunity.length === 0 && (
              <div className="py-12 text-center text-[14.5px] text-fg/45 light:text-muted">No encontramos plugins con ese filtro.</div>
            )}
          </div>
        )}
      </div>

      {/* Category Picker Modal (`11-fuentes-stremio.css:492`) */}
      {catModalOpen && (
        <div
          data-ot-modal
          onClick={() => setCatModalOpen(false)}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="ot-fade-up flex max-h-[80vh] w-full max-w-[440px] flex-col overflow-hidden rounded-[22px] border border-fg/10 bg-surface shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-fg/[0.08] px-6 py-4">
              <h3 className="font-display text-[19px] font-bold text-fg">Categoría</h3>
              <button
                type="button"
                onClick={() => setCatModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-fg/60 hover:bg-fg/10 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="ot-scroll flex-1 space-y-1 overflow-y-auto p-3">
              {PLUGIN_CATEGORIES.map((c) => {
                const active = cat === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCat(c.id);
                      setCatModalOpen(false);
                    }}
                    className={`flex h-11 w-full items-center justify-between rounded-xl px-4 text-left text-[15px] transition cursor-pointer ${
                      active ? 'bg-fg/[0.09] font-bold text-fg' : 'text-[#dcd9d3] light:text-fg hover:bg-fg/[0.05]'
                    }`}
                  >
                    <span>{c.label}</span>
                    {active && <span className="h-2.5 w-2.5 rounded-full bg-[#e9e7e2] light:bg-fg" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Add Plugin Modal */}
      {addOpen && (
        <div
          data-ot-modal
          onClick={() => setAddOpen(false)}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void installFromInput(manualInput, manualName);
            }}
            className="ot-fade-up w-full max-w-lg space-y-4 rounded-[24px] border border-fg/10 bg-surface p-7 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[22px] font-bold text-fg">Agregar plugin</h2>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-fg/60 hover:bg-fg/10 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-[13.5px] text-fg/55 light:text-muted">
              Pega un enlace compatible con Stremio (
              <code className="rounded bg-fg/[0.07] px-1.5 py-0.5 font-mono text-[12px] text-fg/80">
                manifest.json
              </code>
              ), un repositorio GitHub, una lista M3U o usa una cuenta Xtream.
            </p>

            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="https://…/manifest.json, usuario/repo o https://…/lista.m3u"
              autoFocus
              className="h-12 w-full rounded-[14px] border border-fg/12 bg-[#1b1b21] light:bg-surface-alt px-4 text-[14.5px] text-fg placeholder-fg/35 light:placeholder-faint outline-none focus:border-fg/50"
            />

            {(/\.m3u8?(\?.*)?$/i.test(manualInput.trim()) || isXtreamLike(manualInput.trim())) && (
              <input
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Nombre para la lista de TV (opcional)"
                className="h-12 w-full rounded-[14px] border border-fg/12 bg-[#1b1b21] light:bg-surface-alt px-4 text-[14.5px] text-fg placeholder-fg/35 light:placeholder-faint outline-none focus:border-fg/50"
              />
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={() => setXtreamOpen((v) => !v)}
                className="rounded-xl border border-fg/12 px-4 py-2 text-[13.5px] font-semibold text-fg/80 hover:bg-fg/[0.06] cursor-pointer"
              >
                {xtreamOpen ? 'Ocultar Xtream' : 'Cuenta Xtream'}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAddOpen(false)}
                  className="rounded-xl px-4 py-2 text-[14px] font-semibold text-fg/70 hover:text-fg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={Boolean(installingUrl)}
                  style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
                  className="rounded-xl px-6 py-2 text-[14px] font-bold cursor-pointer disabled:opacity-60"
                >
                  {installingUrl ? 'Verificando…' : 'Agregar'}
                </button>
              </div>
            </div>

            {xtreamOpen && (
              <div className="space-y-3 rounded-[16px] border border-fg/10 bg-fg/[0.03] p-4">
                <div className="text-[13px] font-semibold text-fg/80">Cuenta IPTV / Xtream</div>
                <input
                  type="text"
                  value={xtreamServer}
                  onChange={(e) => setXtreamServer(e.target.value)}
                  placeholder="Servidor (ej. http://servidor.com:8080)"
                  className="h-11 w-full rounded-[12px] border border-fg/12 bg-[#1b1b21] light:bg-surface-alt px-3.5 text-[14px] text-fg placeholder-fg/35 light:placeholder-faint outline-none focus:border-fg/50"
                />
                <input
                  type="text"
                  value={xtreamUser}
                  onChange={(e) => setXtreamUser(e.target.value)}
                  placeholder="Usuario"
                  className="h-11 w-full rounded-[12px] border border-fg/12 bg-[#1b1b21] light:bg-surface-alt px-3.5 text-[14px] text-fg placeholder-fg/35 light:placeholder-faint outline-none focus:border-fg/50"
                />
                <input
                  type="password"
                  value={xtreamPass}
                  onChange={(e) => setXtreamPass(e.target.value)}
                  placeholder="Contraseña"
                  className="h-11 w-full rounded-[12px] border border-fg/12 bg-[#1b1b21] light:bg-surface-alt px-3.5 text-[14px] text-fg placeholder-fg/35 light:placeholder-faint outline-none focus:border-fg/50"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={Boolean(installingUrl)}
                    style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
                    className="rounded-xl px-5 py-2 text-[13.5px] font-bold cursor-pointer disabled:opacity-60"
                    onClick={() => {
                      const srv = xtreamServer.trim().replace(/\/+$/, '');
                      const usr = xtreamUser.trim();
                      const pwd = xtreamPass;
                      if (!srv || !usr || !pwd) {
                        onToast('Completa servidor, usuario y contraseña de Xtream');
                        return;
                      }
                      if (!/^https?:\/\//i.test(srv)) {
                        onToast('El servidor Xtream debe empezar con http:// o https://');
                        return;
                      }
                      const xtreamUrl = `${srv}/get.php?username=${encodeURIComponent(usr)}&password=${encodeURIComponent(pwd)}&type=m3u_plus&output=ts`;
                      void installFromInput(xtreamUrl, manualName.trim() || `Xtream · ${(() => { try { return new URL(srv).host; } catch { return 'IPTV'; } })()}`, 'm3u', { allowLan: isPrivateHost(srv) });
                    }}
                  >
                    {installingUrl ? 'Verificando…' : 'Agregar cuenta Xtream'}
                  </button>
                </div>
              </div>
            )}
          </form>
        </div>
      )}

      {/* Configure Plugin Modal */}
      {configPlugin && (
        <div
          data-ot-modal
          onClick={() => setConfigPlugin(null)}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="ot-fade-up flex max-h-[85vh] w-full max-w-[660px] flex-col overflow-hidden rounded-[24px] border border-fg/10 bg-surface shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4 border-b border-fg/[0.08] px-6 py-5 sm:px-7">
              <div className="flex min-w-0 items-center gap-3.5">
                <PluginIcon
                  id={configPlugin.id}
                  name={configPlugin.name}
                  url={configPlugin.url}
                  logo={configPlugin.logo}
                  kind={configPlugin.kind}
                  hasStream={configPlugin.hasStream}
                  hasCatalog={configPlugin.hasCatalog}
                  hasSubtitles={configPlugin.hasSubtitles}
                />
                <div className="min-w-0">
                  <h2 className="truncate font-display text-[20px] font-bold text-fg">
                    Configurar · {configPlugin.name}
                  </h2>
                  <p className="truncate text-[13px] text-fg/50 light:text-muted">Preferencias de elección automática de fuentes</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfigPlugin(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-fg/60 hover:bg-fg/10 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="ot-scroll flex-1 space-y-5 overflow-y-auto p-7">
              {configPlugin.kind === 'stremio' && !configPlugin.builtin && (
                <div className="flex items-center justify-between gap-3 rounded-[16px] border border-fg/[0.08] bg-fg/[0.04] p-4">
                  <div>
                    <div className="text-[14.5px] font-semibold text-fg">Configuración web del plugin</div>
                    <div className="text-[12.5px] text-fg/50 light:text-muted">Abre la página del proveedor en tu navegador.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void desktopApi.openAddonConfig(configPlugin.baseUrl + '/configure')}
                    className="flex items-center gap-1.5 rounded-xl border border-fg/15 bg-fg/10 px-4 py-2 text-[13px] font-semibold text-fg hover:bg-fg/20 cursor-pointer"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Abrir</span>
                  </button>
                </div>
              )}

              {configPlugin.kind === 'kino-js' && (
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[16px] border border-fg/[0.08] bg-fg/[0.04] p-4">
                  <div className="flex items-start gap-3">
                    <Shield className="mt-0.5 h-5 w-5 text-[#7ee2a8] light:text-[#15803d]" />
                    <div>
                      <div className="text-[14.5px] font-semibold text-fg">Red de tu casa</div>
                      <div className="text-[12.5px] text-fg/50 light:text-muted">
                        Permite que este plugin aislado consulte servidores en tu red local (nunca este mismo equipo).
                      </div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={configPlugin.allowLan}
                    onChange={(e) => {
                      const val = e.target.checked;
                      onSetAllowLan(configPlugin.url, val);
                      setConfigPlugin({ ...configPlugin, allowLan: val });
                    }}
                    className="h-4 w-4 accent-fg"
                  />
                </label>
              )}

              <div className="space-y-2">
                <div className="text-[13.5px] font-bold text-fg/80">Idiomas preferidos</div>
                <div className="flex flex-wrap gap-2">
                  {LANG_OPTIONS.map((l) => {
                    const active = sourcePrefs.langs.includes(l.id);
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() =>
                          onUpdateSourcePrefs((cur) => ({
                            ...cur,
                            langs: active ? cur.langs.filter((x) => x !== l.id) : [...cur.langs, l.id],
                          }))
                        }
                        style={
                          active ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' } : undefined
                        }
                        className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition cursor-pointer ${
                          active ? '' : 'border border-fg/10 bg-fg/[0.06] text-fg/75 hover:bg-fg/12'
                        }`}
                      >
                        {l.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[13.5px] font-bold text-fg/80">Calidad objetivo</div>
                <div className="flex flex-wrap gap-2">
                  {(['auto', '4K', '1080p', '720p', 'SD'] as const).map((q) => {
                    const active = sourcePrefs.quality === q;
                    return (
                      <button
                        key={q}
                        type="button"
                        onClick={() => onUpdateSourcePrefs((cur) => ({ ...cur, quality: q }))}
                        style={
                          active ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' } : undefined
                        }
                        className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition cursor-pointer ${
                          active ? '' : 'border border-fg/10 bg-fg/[0.06] text-fg/75 hover:bg-fg/12'
                        }`}
                      >
                        {q === 'auto' ? 'Automática' : q === '1080p' ? 'Full HD (1080p)' : q}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[13.5px] font-bold text-fg/80">Excluir formatos</div>
                <div className="flex flex-wrap gap-2">
                  {EXCLUDE_OPTIONS.map((ex) => {
                    const active = sourcePrefs.exclude.includes(ex.id);
                    return (
                      <button
                        key={ex.id}
                        type="button"
                        onClick={() =>
                          onUpdateSourcePrefs((cur) => ({
                            ...cur,
                            exclude: active ? cur.exclude.filter((x) => x !== ex.id) : [...cur.exclude, ex.id],
                          }))
                        }
                        className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition cursor-pointer ${
                          active
                            ? 'bg-fg/[0.06] text-fg/45 light:text-muted line-through'
                            : 'border border-fg/10 bg-fg/[0.06] text-fg/75 hover:bg-fg/12'
                        }`}
                      >
                        {ex.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="flex cursor-pointer items-center justify-between rounded-[16px] border border-fg/[0.08] bg-fg/[0.04] px-4 py-3.5">
                <div>
                  <div className="text-[14.5px] font-semibold text-fg">Reproducir mejor fuente automáticamente</div>
                  <div className="text-[12.5px] text-fg/50 light:text-muted">
                    Si lo desactivas, siempre podrás elegir la fuente antes de reproducir.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={sourcePrefs.autoPlay}
                  onChange={(e) => onUpdateSourcePrefs((cur) => ({ ...cur, autoPlay: e.target.checked }))}
                  className="h-4 w-4 accent-fg"
                />
              </label>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[12px] text-fg/55 light:text-muted">Semillas mín.</label>
                  <input
                    type="number"
                    min={0}
                    max={500}
                    value={sourcePrefs.minSeeds}
                    onChange={(e) =>
                      onUpdateSourcePrefs((cur) => ({ ...cur, minSeeds: Math.max(0, Number(e.target.value) || 0) }))
                    }
                    className="h-10 w-full rounded-xl border border-fg/15 bg-fg/[0.06] px-3 text-[13.5px] text-fg outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[12px] text-fg/55 light:text-muted">Máx. película (GB)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={sourcePrefs.maxMovieGb}
                    onChange={(e) =>
                      onUpdateSourcePrefs((cur) => ({ ...cur, maxMovieGb: Math.max(0, Number(e.target.value) || 0) }))
                    }
                    className="h-10 w-full rounded-xl border border-fg/15 bg-fg/[0.06] px-3 text-[13.5px] text-fg outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[12px] text-fg/55 light:text-muted">Máx. episodio (GB)</label>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    value={sourcePrefs.maxEpisodeGb}
                    onChange={(e) =>
                      onUpdateSourcePrefs((cur) => ({ ...cur, maxEpisodeGb: Math.max(0, Number(e.target.value) || 0) }))
                    }
                    className="h-10 w-full rounded-xl border border-fg/15 bg-fg/[0.06] px-3 text-[13.5px] text-fg outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end border-t border-fg/[0.08] px-7 py-4">
              <button
                type="button"
                onClick={() => {
                  setConfigPlugin(null);
                  onToast('Preferencias guardadas');
                }}
                style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
                className="rounded-xl px-6 py-2 text-[14px] font-bold cursor-pointer"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
