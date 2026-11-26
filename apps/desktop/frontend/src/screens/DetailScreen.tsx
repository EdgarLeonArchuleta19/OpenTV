import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  Captions,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Heart,
  ListFilter,
  Play,
  X,
} from 'lucide-react';
import type {
  Episode,
  InstalledPlugin,
  MediaItem,
  PlaybackPrefs,
  SourcePrefs,
  StreamSource,
  TitleDetail,
  WatchProgress,
} from '../types/models';
import { loadSeasonEpisodes, loadTitleDetail } from '../services/stremio';
import { mergeSeasonEpisodes } from '../services/tmdbDetail';
import { peekLocalized } from '../services/localize';
import { getSourceSearch, type SourceSearch } from '../services/sourceSearch';
import { formatDuration, localizedGenres } from '../services/locales';
import { rankSources, runtimeMinutesOf } from '../services/sourceRanker';
import { desktopApi, resizedImageUrl } from '../services/tauri';
import { isLiteMode } from '../services/liteMode';
import { PosterCard, ScrollRow, SourcePickerModal, useDragScroll } from '../components/CommonComponents';

interface DetailScreenProps {
  initialItem: MediaItem;
  plugins: InstalledPlugin[];
  hasSourcePlugins: boolean;
  sourcePrefs: SourcePrefs;
  playbackPrefs: PlaybackPrefs;
  inMyList: boolean;
  isFavorite: boolean;
  watchProgress: WatchProgress[];
  /** Episode to preselect (e.g. opened from a "Seguir viendo" card). */
  resumeEpisode?: { season: number; episode: number } | null;
  onBack: () => void;
  onToggleMyList: (item: MediaItem) => void;
  onToggleFavorite: (item: MediaItem) => void;
  onUpdatePlayback: (fn: (cur: PlaybackPrefs) => PlaybackPrefs) => void;
  onOpenPlugins: () => void;
  onOpenRelated: (item: MediaItem) => void;
  onPlayStream: (
    item: MediaItem,
    episode: Episode | null,
    allEpisodes: Episode[],
    /** `null` = the player searches and auto-picks inside its own loading screen. */
    chosen: StreamSource | null,
    ranked: StreamSource[],
    fromStart?: boolean,
  ) => void;
  onToast: (msg: string) => void;
}

function fmtResume(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** Searches whose plugin failures were already reported, so a reused search doesn't repeat the toast. */
const reportedFailures = new WeakSet<SourceSearch>();

/**
 * Exact 1:1 replica of OpenTV v1 Detail screen (`ficha.jpg` + `detail.js` + `11-fuentes-stremio.css` design 8):
 * - Floating top-left round `( < )` back button (`top-4 left-4`)
 * - Seamless right-side artwork fading softly into the page colour (`.ot-detail-art-mask`)
 * - Compact left info: Title + inline `★ score` pill, inline `Year · Duration · HD` + translated genre chips,
 *   Credits (`Dirección · Reparto`), `SINOPSIS` + `Leer más` modal
 * - Exact 2-group action bar (`detail.js:358-395`):
 *   [▶ Reproducir | ⇄ Cambiar fuente], [↺] (if resumable), [▤ Idioma y subtítulos]  |  [♡], [🔖], [↓]
 * - Horizontal episode cards row with hover arrows + `Quizás te guste` row with HoverCard.
 */
export const DetailScreen: React.FC<DetailScreenProps> = ({
  initialItem,
  plugins,
  hasSourcePlugins,
  sourcePrefs,
  playbackPrefs,
  inMyList,
  isFavorite,
  watchProgress,
  resumeEpisode,
  onBack,
  onToggleMyList,
  onToggleFavorite,
  onUpdatePlayback,
  onOpenPlugins,
  onOpenRelated,
  onPlayStream,
  onToast,
}) => {
  const epRowRef = useRef<HTMLDivElement>(null);
  const epDrag = useDragScroll(epRowRef);
  const [epAtStart, setEpAtStart] = useState(true);
  const [epAtEnd, setEpAtEnd] = useState(false);
  const syncEpBounds = useCallback(() => {
    const el = epRowRef.current;
    if (!el) return;
    setEpAtStart(el.scrollLeft <= 4);
    setEpAtEnd(el.scrollLeft >= el.scrollWidth - el.clientWidth - 4);
  }, []);

  const [detail, setDetail] = useState<TitleDetail>({ item: peekLocalized(initialItem), episodes: [], seasons: [], related: [] });
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [loadingSeason, setLoadingSeason] = useState(false);
  const [seasonSelectOpen, setSeasonSelectOpen] = useState(false);
  const seasonSelectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!seasonSelectOpen) return;
    const onDown = (e: MouseEvent) => {
      if (seasonSelectRef.current && !seasonSelectRef.current.contains(e.target as Node)) {
        setSeasonSelectOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [seasonSelectOpen]);
  const [synopsisOpen, setSynopsisOpen] = useState(false);
  const [langDialogOpen, setLangDialogOpen] = useState(false);

  const [sources, setSources] = useState<StreamSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerEp, setPickerEp] = useState<Episode | null>(null);
  /** Unsubscribes the picker from the running source search. */
  const unwatchRef = useRef<(() => void) | null>(null);
  const stopWatching = useCallback(() => {
    unwatchRef.current?.();
    unwatchRef.current = null;
  }, []);

  // Esc closes the open overlay first (capture phase, before App's "leave the title" shortcut).
  // An open filter list inside the source picker handles its own Esc.
  const overlayOpen = pickerOpen || synopsisOpen || langDialogOpen || seasonSelectOpen;
  useEffect(() => {
    if (!overlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.target instanceof Element && e.target.closest('[role="listbox"]')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (pickerOpen) {
        setPickerOpen(false);
        stopWatching();
      } else if (langDialogOpen) setLangDialogOpen(false);
      else if (synopsisOpen) setSynopsisOpen(false);
      else setSeasonSelectOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [langDialogOpen, overlayOpen, pickerOpen, seasonSelectOpen, stopWatching, synopsisOpen]);

  useEffect(() => {
    let alive = true;
    setLoadingMeta(true);
    setDetail({ item: peekLocalized(initialItem), episodes: [], seasons: [], related: [] });
    setSynopsisOpen(false);
    const saved = resumeEpisode?.season
      ? { season: resumeEpisode.season }
      : watchProgress.find((w) => w.itemId === initialItem.id && w.season > 0);
    // The saved season loads first; the rest come on demand from the season selector.
    loadTitleDetail(initialItem, saved?.season).then((loaded) => {
      if (!alive) return;
      setDetail(loaded);
      if (loaded.seasons.length > 0) {
        setSelectedSeason(saved && loaded.seasons.includes(saved.season) ? saved.season : loaded.seasons[0]);
      }
      setLoadingMeta(false);
    });
    return () => {
      alive = false;
      stopWatching();
    };
  }, [initialItem.id]);

  const item = detail.item;
  const lite = isLiteMode();
  // Lite mode skips the big backdrop: the title opens with text only.
  const artSrc = useMemo(
    () => (lite ? '' : resizedImageUrl(item.backdrop || item.poster, 1280)),
    [item.backdrop, item.poster, lite],
  );
  // Same width as the poster cards, so the file is usually already in the browser cache.
  const posterSrc = useMemo(() => (lite ? resizedImageUrl(item.poster, 400) : ''), [item.poster, lite]);
  const genres = useMemo(() => localizedGenres(item.genres, 6), [item.genres]);

  const defaultEpisode = useMemo(() => {
    if (item.type === 'movie') return null;
    if (resumeEpisode?.season) {
      const wanted = detail.episodes.find((e) => e.season === resumeEpisode.season && e.number === resumeEpisode.episode);
      if (wanted) return wanted;
    }
    const saved = watchProgress.find(
      (w) => w.itemId === item.id && !(w.durationMs > 60_000 && w.positionMs / w.durationMs >= 0.92),
    );
    return (
      detail.episodes.find((e) => saved && e.season === saved.season && e.number === saved.episode) ||
      detail.episodes.find((e) => e.season === selectedSeason) ||
      detail.episodes[0] ||
      null
    );
  }, [detail.episodes, item.id, item.type, resumeEpisode, selectedSeason, watchProgress]);

  const activeProgress = useMemo(
    () =>
      watchProgress.find(
        (w) =>
          w.itemId === item.id &&
          (!defaultEpisode || (w.season === defaultEpisode.season && w.episode === defaultEpisode.number)),
      ),
    [defaultEpisode, item.id, watchProgress],
  );
  const canResume = Boolean(
    activeProgress &&
      activeProgress.positionMs > 15_000 &&
      activeProgress.durationMs > 60_000 &&
      activeProgress.positionMs / activeProgress.durationMs < 0.92,
  );

  const seasonEpisodes = useMemo(
    () => detail.episodes.filter((e) => e.season === selectedSeason),
    [detail.episodes, selectedSeason],
  );

  // TMDB episodes load per season: fetch the selected one if missing, then prefetch the next
  // one in the background (so "next episode" in the player can cross into it).
  const detailRef = useRef(detail);
  detailRef.current = detail;
  useEffect(() => {
    const d = detailRef.current;
    if (!d.tmdbTvId || !d.seasons.includes(selectedSeason)) return;
    let alive = true;
    const itemId = d.item.id;
    const merge = (season: number, eps: Episode[]) => {
      if (!alive || eps.length === 0) return;
      setDetail((cur) =>
        cur.item.id === itemId ? { ...cur, episodes: mergeSeasonEpisodes(cur.episodes, season, eps) } : cur,
      );
    };
    const prefetchNext = () => {
      const next = d.seasons[d.seasons.indexOf(selectedSeason) + 1];
      if (next !== undefined && !detailRef.current.episodes.some((e) => e.season === next)) {
        void loadSeasonEpisodes(d, next).then((eps) => merge(next, eps));
      }
    };
    if (d.episodes.some((e) => e.season === selectedSeason)) {
      prefetchNext();
    } else {
      setLoadingSeason(true);
      void loadSeasonEpisodes(d, selectedSeason).then((eps) => {
        merge(selectedSeason, eps);
        if (alive) {
          setLoadingSeason(false);
          prefetchNext();
        }
      });
    }
    return () => {
      alive = false;
      setLoadingSeason(false);
    };
  }, [detail.tmdbTvId, detail.item.id, selectedSeason]);

  useEffect(() => {
    syncEpBounds();
    window.addEventListener('resize', syncEpBounds);
    return () => window.removeEventListener('resize', syncEpBounds);
  }, [syncEpBounds, seasonEpisodes.length, selectedSeason]);

  useEffect(() => {
    epRowRef.current?.scrollTo({ left: 0, behavior: 'auto' });
    syncEpBounds();
  }, [selectedSeason, syncEpBounds]);

  /**
   * Follows the shared progressive search for this title (the player reuses it, so slow
   * JS plugins answering later still reach the player). Resolves with the final ranking.
   */
  const watchSources = (ep: Episode | null): Promise<StreamSource[]> => {
    stopWatching();
    const search = getSourceSearch(item, ep, plugins);
    setSources([]);
    setLoadingSources(!search.done);
    return new Promise((resolve) => {
      unwatchRef.current = search.subscribe((st) => {
        const ranked = rankSources(st.raw, sourcePrefs, ep !== null, undefined, runtimeMinutesOf(item, ep));
        setSources(ranked);
        const done = st.stremioDone && st.jsDone;
        setLoadingSources(!done);
        if (!done) return;
        // Say which plugin failed and why, instead of an empty list without a reason.
        if (st.failures.length > 0 && !reportedFailures.has(search)) {
          reportedFailures.add(search);
          const shown = st.failures.slice(0, 2).map((f) => f.message).join(' · ');
          onToast(st.failures.length > 2 ? `${shown} (+${st.failures.length - 2})` : shown);
        }
        resolve(ranked);
      });
    });
  };

  const triggerPlay = (ep: Episode | null, forcePicker: boolean) => {
    if (!hasSourcePlugins) {
      onToast('Para reproducir, agrega un plugin de fuentes en Plugins.');
      return;
    }
    setPickerEp(ep);
    if (forcePicker || !sourcePrefs.autoPlay) {
      setPickerOpen(true);
      void watchSources(ep);
      return;
    }
    // Auto-play: the player opens at once and searches/picks inside its own loading screen.
    stopWatching();
    onPlayStream(item, ep, detail.episodes, null, [], false);
  };

  const triggerDownload = async (ep: Episode | null) => {
    if (!hasSourcePlugins) {
      onToast('Agrega un plugin de fuentes en Plugins para descargar');
      return;
    }
    onToast('Preparando descarga…');
    const ranked = await watchSources(ep);
    const best = ranked[0];
    if (!best) {
      onToast('No hay fuentes disponibles para descargar');
      return;
    }
    const sub = ep ? `T${ep.season} · E${ep.number} ${ep.title}` : item.year;
    const res = await desktopApi.service<{ returnValue?: boolean }>('downloadStart', {
      targetId: `${item.id}_${ep ? ep.id : 'movie'}`,
      itemId: item.id,
      title: item.title,
      subtitle: sub,
      poster: item.poster,
      filename: best.filename,
      headers: best.headers,
      ...(best.infoHash && !best.url
        ? { infoHash: best.infoHash, fileIdx: best.fileIdx, sources: best.trackers }
        : { url: best.url }),
    });
    onToast(res?.returnValue === false ? 'No se pudo iniciar la descarga' : 'Descarga iniciada en segundo plano');
  };

  const metaLine = [
    item.year && item.year !== '—' ? item.year : null,
    item.duration && item.duration !== '—' ? formatDuration(item.duration) : null,
    detail.seasons.length > 0
      ? `T${selectedSeason} · ${seasonEpisodes.length} ep.`
      : null,
    'HD',
  ]
    .filter(Boolean)
    .join(' · ');

  const titleClass =
    item.title.length > 70
      ? 'text-[clamp(22px,2.2vw,30px)] leading-[1.14]'
      : item.title.length > 40
      ? 'text-[clamp(26px,2.6vw,36px)] leading-[1.12]'
      : 'text-[clamp(30px,3.2vw,46px)] leading-[1.08]';

  return (
    <div className="ot-scroll relative h-full w-full overflow-x-hidden overflow-y-auto bg-page pb-16">
      {/* Floating top-left round Back button (`ficha.jpg` + `02-busqueda-menu-componentes.css:159`) */}
      <button
        type="button"
        onClick={onBack}
        aria-label="Volver"
        className="fixed top-[50px] left-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-fg/20 bg-surface/70 text-fg backdrop-blur-xl transition hover:border-fg/40 hover:bg-fg/15 cursor-pointer"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      <div className={detail.seasons.length > 0 ? 'min-h-[100svh]' : ''}>
      {/* Seamless Right Backdrop Art (`11-fuentes-stremio.css:273` design 8) */}
      {artSrc && (
        <div className="pointer-events-none absolute top-0 right-0 z-0 h-[clamp(340px,48vh,560px)] w-[74%] lg:w-[66%] overflow-hidden">
          {/* Keyed by address: a new title never keeps the previous title's art on screen. */}
          <img
            key={artSrc}
            src={artSrc}
            alt=""
            decoding="async"
            fetchPriority="high"
            onLoad={(e) => e.currentTarget.classList.remove('opacity-0')}
            className="ot-detail-art-mask h-full w-full object-cover object-[center_20%] brightness-[0.84] light:brightness-100 opacity-0 transition-opacity duration-300"
          />
        </div>
      )}

      {/* Lite mode: the poster (same small file the card already loaded) instead of the backdrop. */}
      {lite && posterSrc && (
        <div
          style={{ right: 'var(--ot-gutter)' }}
          className="pointer-events-none absolute top-14 z-0 hidden w-[clamp(150px,15vw,230px)] md:block"
        >
          <img
            key={posterSrc}
            src={posterSrc}
            alt=""
            decoding="async"
            onLoad={(e) => e.currentTarget.classList.remove('opacity-0')}
            className="aspect-[2/3] w-full rounded-[16px] object-cover opacity-0 shadow-[0_24px_60px_rgba(0,0,0,0.6)] ring-1 ring-fg/10 transition-opacity duration-200"
          />
        </div>
      )}

      {/* Main Content aligned to `--ot-gutter` */}
      <div
        style={{ paddingLeft: 'var(--ot-gutter)', paddingRight: 'var(--ot-gutter)' }}
        className="relative z-10 pt-14"
      >
        {/* Top Metadata Column */}
        <div className="max-w-[660px] space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className={`font-display font-bold tracking-[-0.025em] text-fg ${titleClass}`}>{item.title}</h1>
            {item.score && !/^[\s—–-]*$/.test(item.score) && (
              <span className="inline-flex items-center rounded-full border border-fg/10 bg-fg/10 px-3 py-1 text-[13.5px] font-bold text-fg">
                ★ {item.score}
              </span>
            )}
          </div>

          {/* Inline meta + translated genre chips (`detail.js:254-258`) */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[14.5px] font-medium text-fg/70">{metaLine}</span>
            {genres.map((g) => (
              <span
                key={g}
                className="rounded-full border border-fg/[0.08] bg-fg/[0.06] px-3 py-0.5 text-[12.5px] text-fg/80"
              >
                {g}
              </span>
            ))}
          </div>

          {/* Single-line credits (`Dirección · Reparto`) */}
          {(item.director || (item.cast && item.cast.length > 0)) && (
            <div className="truncate text-[13.5px] text-fg/60">
              {item.director && (
                <>
                  <span className="font-semibold text-fg/80">Dirección </span>
                  <span>{item.director}</span>
                </>
              )}
              {item.director && item.cast?.length ? <span className="mx-2 text-fg/30 light:text-faint">·</span> : null}
              {item.cast && item.cast.length > 0 && (
                <>
                  <span className="font-semibold text-fg/80">Reparto </span>
                  <span>{item.cast.slice(0, 5).join(', ')}</span>
                </>
              )}
            </div>
          )}

          {/* Sinopsis + Leer más */}
          {item.synopsis && (
            <div className="space-y-1 pt-1">
              <div className="text-[11px] font-bold tracking-[0.14em] text-fg/45 light:text-muted uppercase">SINOPSIS</div>
              <p className="line-clamp-3 text-[14.5px] leading-relaxed text-fg/82">
                {item.synopsis}
              </p>
              {item.synopsis.length > 150 && (
                <button
                  type="button"
                  onClick={() => setSynopsisOpen(true)}
                  className="text-[13.5px] font-bold text-fg underline underline-offset-4 hover:text-fg/80 cursor-pointer"
                >
                  Leer más
                </button>
              )}
            </div>
          )}
        </div>

        {/* Exact 2-Group Action Bar (`detail.js:358-395` + `ficha.jpg`) */}
        <div className="mt-7 flex flex-wrap items-center gap-2.5">
          {!hasSourcePlugins ? (
            <div className="flex flex-wrap items-center gap-4 rounded-[16px] border border-fg/10 bg-fg/[0.07] py-2 pr-2.5 pl-5">
              <span className="text-[14.5px] text-fg/85">Para reproducir, agrega un plugin de fuentes.</span>
              <button
                type="button"
                onClick={onOpenPlugins}
                style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
                className="h-10 rounded-xl px-4 text-[13.5px] font-bold transition hover:brightness-90 cursor-pointer"
              >
                Ir a Plugins
              </button>
            </div>
          ) : (
            <>
              {/* Joined Split Button: [▶ Reproducir / Reanudar | ⇄ Cambiar fuente] */}
              <div className="inline-flex items-stretch">
                <button
                  type="button"
                  onClick={() => triggerPlay(defaultEpisode, false)}
                  className="relative flex h-[48px] items-center gap-2.5 overflow-hidden rounded-l-[14px] border border-r-0 border-fg/[0.09] bg-fg/[0.06] pr-5 pl-6 text-[15px] font-bold text-fg transition hover:border-fg/20 hover:bg-fg/[0.12] cursor-pointer"
                >
                  <Play className="h-5 w-5 fill-current" />
                  <span>
                    {canResume && activeProgress
                      ? defaultEpisode
                        ? `Reanudar · T${defaultEpisode.season}·E${defaultEpisode.number}`
                        : `Reanudar · ${fmtResume(activeProgress.positionMs)}`
                      : defaultEpisode
                      ? `Reproducir T${defaultEpisode.season}·E${defaultEpisode.number}`
                      : 'Reproducir'}
                  </span>
                  {canResume && activeProgress && (
                    <span className="pointer-events-none absolute inset-x-5 bottom-[6px] h-[3px] overflow-hidden rounded-full bg-fg/15">
                      <span
                        style={{
                          width: `${Math.min(100, (activeProgress.positionMs / activeProgress.durationMs) * 100)}%`,
                          backgroundColor: 'var(--ot-accent)',
                        }}
                        className="block h-full rounded-full"
                      />
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => triggerPlay(defaultEpisode, true)}
                  title="Cambiar fuente"
                  aria-label="Cambiar fuente"
                  className="flex h-[48px] w-[46px] items-center justify-center rounded-r-[14px] border border-fg/[0.09] bg-fg/[0.06] text-fg transition hover:border-fg/20 hover:bg-fg/[0.12] cursor-pointer"
                >
                  <ListFilter className="h-4 w-4" />
                </button>
              </div>

              {/* Idioma y subtítulos (`ficha.jpg`) */}
              <button
                type="button"
                onClick={() => setLangDialogOpen(true)}
                className="flex h-[48px] items-center gap-2.5 rounded-[14px] border border-fg/[0.09] bg-fg/[0.06] px-5 text-[14.5px] font-semibold text-fg transition hover:border-fg/20 hover:bg-fg/[0.12] cursor-pointer"
              >
                <Captions className="h-4 w-4" />
                <span>Idioma y subtítulos</span>
              </button>
            </>
          )}

          {/* Vertical separator between Watch and Mine */}
          <span className="mx-1.5 h-7 w-px bg-fg/18" />

          {/* Favorito ♡ (`ficha.jpg`) */}
          <button
            type="button"
            onClick={() => onToggleFavorite(item)}
            title={isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
            className={`flex h-[48px] w-[48px] items-center justify-center rounded-full border transition cursor-pointer ${
              isFavorite
                ? 'border-fg/30 bg-fg/15 text-fg'
                : 'border-fg/[0.09] bg-fg/[0.06] text-fg/85 hover:border-fg/20 hover:bg-fg/[0.12]'
            }`}
          >
            <Heart className={`h-5 w-5 ${isFavorite ? 'fill-current' : ''}`} />
          </button>

          {/* Mi lista 🔖 (`ficha.jpg`) */}
          <button
            type="button"
            onClick={() => onToggleMyList(item)}
            title={inMyList ? 'Quitar de Mi lista' : 'Añadir a Mi lista'}
            className={`flex h-[48px] w-[48px] items-center justify-center rounded-full border transition cursor-pointer ${
              inMyList
                ? 'border-fg/30 bg-fg/15 text-fg'
                : 'border-fg/[0.09] bg-fg/[0.06] text-fg/85 hover:border-fg/20 hover:bg-fg/[0.12]'
            }`}
          >
            <Bookmark className={`h-5 w-5 ${inMyList ? 'fill-current' : ''}`} />
          </button>

          {/* Descargar ↓ (`ficha.jpg`) */}
          {hasSourcePlugins && (
            <button
              type="button"
              onClick={() => void triggerDownload(defaultEpisode)}
              title="Descargar para ver sin conexión"
              className="flex h-[48px] w-[48px] items-center justify-center rounded-full border border-fg/[0.09] bg-fg/[0.06] text-fg/85 transition hover:border-fg/20 hover:bg-fg/[0.12] cursor-pointer"
            >
              <Download className="h-5 w-5" />
            </button>
          )}
        </div>

        {loadingMeta && (
          <div className="flex justify-center py-6">
            <div
              style={{ borderTopColor: 'var(--ot-accent)' }}
              className="h-7 w-7 animate-spin rounded-full border-2 border-fg/15"
            />
          </div>
        )}

        {/* Horizontal Scrollable Episodes Row (`11-fuentes-stremio.css:316` + `04-en-vivo-ajustes-posteres.css:472`) */}
        {detail.seasons.length > 0 && (
          <section className="mt-10 space-y-3.5">
            <div className="flex items-center gap-3">
              <div ref={seasonSelectRef} className="relative">
                <button
                  type="button"
                  onClick={() => setSeasonSelectOpen((v) => !v)}
                  className="flex items-center gap-2 rounded-xl border border-fg/[0.12] bg-fg/[0.06] px-4 py-2 text-[14px] font-semibold text-fg transition hover:bg-fg/[0.12] cursor-pointer"
                >
                  <span>Temporada {selectedSeason}</span>
                  <ChevronDown className={`h-4 w-4 text-fg/70 transition-transform ${seasonSelectOpen ? 'rotate-180' : ''}`} />
                </button>
                {seasonSelectOpen && (
                  <div className="ot-scroll absolute left-0 top-full z-30 mt-2 max-h-[min(320px,45vh)] min-w-[180px] overflow-y-auto overscroll-contain rounded-xl border border-fg/10 bg-surface-alt py-1 shadow-2xl">
                    {detail.seasons.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          setSelectedSeason(s);
                          setSeasonSelectOpen(false);
                        }}
                        ref={s === selectedSeason ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                        style={s === selectedSeason ? { color: 'var(--ot-accent)' } : undefined}
                        className={`flex w-full items-center px-4 py-2.5 text-left text-[14px] transition cursor-pointer ${
                          s === selectedSeason ? 'bg-fg/[0.06] font-semibold' : 'text-fg/85 hover:bg-fg/[0.08]'
                        }`}
                      >
                        Temporada {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <span className="text-[13px] text-fg/45 light:text-muted">
                {loadingSeason && seasonEpisodes.length === 0 ? 'Cargando episodios…' : `${seasonEpisodes.length} episodios`}
              </span>
            </div>

            <div className="group/ep relative -mx-2" onMouseEnter={syncEpBounds}>
              {!epAtStart && (
                <button
                  type="button"
                  aria-label="Episodios anteriores"
                  onClick={() => epRowRef.current?.scrollBy({ left: -640, behavior: 'smooth' })}
                  className="absolute top-1/2 left-1 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-fg/15 bg-[#16161a]/90 light:bg-surface/95 text-fg opacity-0 shadow-xl backdrop-blur-md transition hover:bg-fg/20 group-hover/ep:opacity-100 cursor-pointer"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              )}

              <div
                ref={epRowRef}
                onScroll={syncEpBounds}
                onMouseDown={epDrag.onMouseDown}
                onClickCapture={epDrag.onClickCapture}
                className={`ot-no-scrollbar flex gap-4 overflow-x-auto px-2 py-2 ${
                  epDrag.dragging ? 'cursor-grabbing' : 'cursor-grab'
                }`}
              >
                {seasonEpisodes.map((ep) => {
                  const prog = watchProgress.find(
                    (w) => w.itemId === item.id && w.season === ep.season && w.episode === ep.number,
                  );
                  const pct = prog && prog.durationMs > 0 ? Math.min(100, (prog.positionMs / prog.durationMs) * 100) : 0;
                  if (lite) {
                    // Lite mode: same horizontal row of cards, designed without a picture.
                    return (
                      <div
                        key={ep.id}
                        onClick={() => triggerPlay(ep, false)}
                        className="group relative flex min-h-[148px] w-[clamp(240px,22vw,320px)] shrink-0 cursor-pointer flex-col gap-2 overflow-hidden rounded-[16px] border border-fg/[0.08] bg-fg/[0.04] p-4 select-none transition hover:border-fg/20 hover:bg-fg/[0.08]"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            style={{ color: 'var(--ot-accent)' }}
                            className="rounded-md bg-fg/[0.07] px-2 py-0.5 text-[11.5px] font-bold tracking-wide uppercase"
                          >
                            Episodio {ep.number}
                          </span>
                          <button
                            type="button"
                            title="Elegir fuente"
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerPlay(ep, true);
                            }}
                            className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg/50 light:text-muted opacity-0 hover:bg-fg/15 hover:text-fg group-hover:opacity-100 cursor-pointer"
                          >
                            <ListFilter className="h-3.5 w-3.5" />
                          </button>
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fg/[0.08] text-fg transition group-hover:bg-fg group-hover:text-black light:group-hover:text-white">
                            <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
                          </span>
                        </div>
                        <span className="line-clamp-1 text-[15px] font-semibold text-fg">{ep.title}</span>
                        {ep.overview && (
                          <p className="line-clamp-3 text-[12.5px] leading-snug text-fg/55 light:text-muted">{ep.overview}</p>
                        )}
                        {pct > 2 && (
                          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-fg/15">
                            <div style={{ width: `${pct}%`, backgroundColor: 'var(--ot-accent)' }} className="h-full" />
                          </div>
                        )}
                      </div>
                    );
                  }
                  const thumb = resizedImageUrl(ep.thumbnail, 440);
                  return (
                    <div
                      key={ep.id}
                      onClick={() => triggerPlay(ep, false)}
                      className="group flex w-[clamp(240px,22vw,320px)] shrink-0 cursor-pointer flex-col overflow-hidden rounded-[16px] border border-fg/[0.08] bg-fg/[0.04] select-none transition hover:border-fg/20 hover:bg-fg/[0.09]"
                    >
                      <div className="relative aspect-video w-full overflow-hidden bg-elev">
                        {thumb && (
                          <img
                            src={thumb}
                            alt={ep.title}
                            loading="lazy"
                            draggable={false}
                            className="pointer-events-none h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                          />
                        )}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition group-hover:opacity-100">
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur-sm">
                            <Play className="ml-0.5 h-5 w-5 fill-current" />
                          </div>
                        </div>
                        {pct > 2 && (
                          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
                            <div style={{ width: `${pct}%`, backgroundColor: 'var(--ot-accent)' }} className="h-full" />
                          </div>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-1 p-3.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[15px] font-semibold text-fg">
                            {ep.number}. {ep.title}
                          </span>
                          <button
                            type="button"
                            title="Elegir fuente"
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerPlay(ep, true);
                            }}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg/50 light:text-muted opacity-0 transition hover:bg-fg/15 hover:text-fg group-hover:opacity-100 cursor-pointer"
                          >
                            <ListFilter className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {ep.overview && (
                          <p className="line-clamp-2 text-[12.5px] leading-snug text-fg/55 light:text-muted">{ep.overview}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {!epAtEnd && (
                <button
                  type="button"
                  aria-label="Siguientes episodios"
                  onClick={() => epRowRef.current?.scrollBy({ left: 640, behavior: 'smooth' })}
                  className="absolute top-1/2 right-1 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-fg/15 bg-[#16161a]/90 light:bg-surface/95 text-fg opacity-0 shadow-xl backdrop-blur-md transition hover:bg-fg/20 group-hover/ep:opacity-100 cursor-pointer"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              )}
            </div>
          </section>
        )}

      </div>
      </div>

      {/* "Quizás te guste" below the fold on series; visible on scroll */}
      {detail.related.length > 0 && (
        <div
          style={{ paddingLeft: 'var(--ot-gutter)', paddingRight: 'var(--ot-gutter)' }}
          className="relative z-10 mt-10 pb-16"
        >
          <ScrollRow title="Quizás te guste" noGutter>
            {detail.related.map((rel) => (
              <PosterCard
                key={rel.id}
                item={rel}
                compact
                captionMode="title"
                onClick={() => onOpenRelated(rel)}
              />
            ))}
          </ScrollRow>
        </div>
      )}

      {/* Full Synopsis Modal (`02-busqueda-menu-componentes.css:198`) */}
      {synopsisOpen && (
        <div
          onClick={() => setSynopsisOpen(false)}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="ot-fade-up max-w-2xl space-y-4 rounded-[24px] border border-fg/10 bg-surface p-7 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4">
              <h3 className="font-display text-[22px] font-bold text-fg">{item.title}</h3>
              <button
                type="button"
                onClick={() => setSynopsisOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-fg/65 hover:bg-fg/10 hover:text-fg cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-[15px] leading-relaxed text-fg/85">{item.synopsis}</p>
          </div>
        </div>
      )}

      {/* Audio y subtítulos Dialog (`SelectSubTitleAndAudioDialog` from Detail screen) */}
      {langDialogOpen && (
        <div
          onClick={() => setLangDialogOpen(false)}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="ot-fade-up w-full max-w-[580px] space-y-5 rounded-[24px] border border-fg/10 bg-surface p-7 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-[22px] font-bold text-fg">Audio y subtítulos</h3>
              <button
                type="button"
                onClick={() => setLangDialogOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-fg/65 hover:bg-fg/10 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[14.5px] font-medium text-fg/75">Audio preferido</span>
                <div className="inline-flex gap-1 rounded-xl bg-fg/[0.06] p-1">
                  {([['es', 'Español'], ['pt', 'Portugués'], ['en', 'Inglés']] as const).map(([id, lbl]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onUpdatePlayback((p) => ({ ...p, preferredAudio: id }))}
                      style={
                        playbackPrefs.preferredAudio === id
                          ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }
                          : undefined
                      }
                      className={`rounded-lg px-3.5 py-1.5 text-[13px] font-semibold cursor-pointer ${
                        playbackPrefs.preferredAudio === id ? '' : 'text-fg/70 hover:text-fg'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-[14.5px] font-medium text-fg/75">Subtítulos</span>
                <div className="inline-flex gap-1 rounded-xl bg-fg/[0.06] p-1">
                  {([false, true] as const).map((on) => (
                    <button
                      key={String(on)}
                      type="button"
                      onClick={() => onUpdatePlayback((p) => ({ ...p, subtitlesEnabled: on }))}
                      style={
                        playbackPrefs.subtitlesEnabled === on
                          ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }
                          : undefined
                      }
                      className={`rounded-lg px-4 py-1.5 text-[13px] font-semibold cursor-pointer ${
                        playbackPrefs.subtitlesEnabled === on ? '' : 'text-fg/70 hover:text-fg'
                      }`}
                    >
                      {on ? 'Sí' : 'No'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-[14.5px] font-medium text-fg/75">Idioma de subtítulos</span>
                <div className="inline-flex gap-1 rounded-xl bg-fg/[0.06] p-1">
                  {([['es', 'Español'], ['pt', 'Portugués'], ['en', 'Inglés']] as const).map(([id, lbl]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onUpdatePlayback((p) => ({ ...p, preferredSubLang: id }))}
                      style={
                        playbackPrefs.preferredSubLang === id
                          ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }
                          : undefined
                      }
                      className={`rounded-lg px-3.5 py-1.5 text-[13px] font-semibold cursor-pointer ${
                        playbackPrefs.preferredSubLang === id ? '' : 'text-fg/70 hover:text-fg'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-[14.5px] font-medium text-fg/75">Tamaño</span>
                <div className="inline-flex gap-1 rounded-xl bg-fg/[0.06] p-1">
                  {([[18, 'Pequeño'], [22, 'Normal'], [28, 'Grande']] as const).map(([sz, lbl]) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() =>
                        onUpdatePlayback((p) => ({ ...p, subtitleStyle: { ...p.subtitleStyle, sizePx: sz } }))
                      }
                      style={
                        playbackPrefs.subtitleStyle.sizePx === sz
                          ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }
                          : undefined
                      }
                      className={`rounded-lg px-3.5 py-1.5 text-[13px] font-semibold cursor-pointer ${
                        playbackPrefs.subtitleStyle.sizePx === sz ? '' : 'text-fg/70 hover:text-fg'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => {
                  setLangDialogOpen(false);
                  onToast('Preferencias de audio y subtítulos guardadas');
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

      {pickerOpen && (
        <SourcePickerModal
          title={pickerEp ? `${item.title} · T${pickerEp.season}E${pickerEp.number}` : item.title}
          sources={sources}
          loading={loadingSources}
          onSelect={(src) => {
            setPickerOpen(false);
            stopWatching();
            onPlayStream(item, pickerEp, detail.episodes, src, sources, false);
          }}
          onClose={() => {
            setPickerOpen(false);
            stopWatching();
          }}
          onOpenPrefs={() => {
            setPickerOpen(false);
            stopWatching();
            onOpenPlugins();
          }}
        />
      )}
    </div>
  );
};
