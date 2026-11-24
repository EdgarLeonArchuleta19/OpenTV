import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Play, X } from 'lucide-react';
import type { MediaItem, StreamSource, WatchProgress } from '../types/models';
import { formatContinueSubtitle } from '../services/locales';
import { formatBytes, languageSummary, sourceHasLang } from '../services/sourceRanker';
import { prefetchImage, resizedImageUrl } from '../services/tauri';

/** Exact OpenTV TV-outline + antennas + play-triangle logo (`ui/images/logo-mark.svg`) */
export const OpenTvLogo: React.FC<{ className?: string }> = ({ className = 'h-6 w-6' }) => (
  <svg
    viewBox="72 68 368 372"
    fill="none"
    stroke="currentColor"
    strokeWidth="24"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M196 84 256 144 316 84" />
    <rect x="92" y="144" width="328" height="232" rx="44" />
    <path d="M231 224v72l62-36z" />
    <path d="M188 424h136" />
  </svg>
);

/**
 * Smooth mouse press-and-drag horizontal scrolling hook for any carousel container.
 * Suppresses accidental clicks after dragging > 5 px so rows can be dragged freely without opening cards.
 */
export function useDragScroll(externalRef?: React.RefObject<HTMLDivElement | null>) {
  const internalRef = useRef<HTMLDivElement>(null);
  const ref = externalRef || internalRef;
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef({ active: false, moved: false, startX: 0, startScrollLeft: 0 });
  const suppressClickUntilRef = useRef(0);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const st = dragStateRef.current;
      const el = ref.current;
      if (!st.active || !el) return;
      const dx = e.clientX - st.startX;
      if (!st.moved && Math.abs(dx) > 5) {
        st.moved = true;
        setDragging(true);
      }
      if (st.moved) {
        e.preventDefault();
        el.scrollLeft = st.startScrollLeft - dx;
      }
    };
    const onUp = () => {
      const st = dragStateRef.current;
      if (!st.active) return;
      if (st.moved) {
        suppressClickUntilRef.current = Date.now() + 180;
      }
      st.active = false;
      st.moved = false;
      setDragging(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
    };
  }, [ref]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const el = ref.current;
      if (!el) return;
      dragStateRef.current = {
        active: true,
        moved: false,
        startX: e.clientX,
        startScrollLeft: el.scrollLeft,
      };
    },
    [ref],
  );

  const onClickCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() < suppressClickUntilRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return { ref, dragging, onMouseDown, onClickCapture };
}

/**
 * Exact OpenTV v1 Poster Card (`04-en-vivo-ajustes-posteres.css:274-294`):
 * - Responsive fluid proportions across all PC displays (~6 posters across standard desktop)
 * - Clean dark shadow gradient rising smoothly on hover showing the title right over the poster (no floating HoverCard)
 * - Authentic dark OpenTV generic cover when poster is absent (`buscador.jpg`)
 * - Optional caption below (`captionMode`: 'none' | 'title' | 'full')
 */
export const PosterCard: React.FC<{
  item: MediaItem;
  compact?: boolean;
  fluid?: boolean;
  captionMode?: 'none' | 'title' | 'full';
  onClick: () => void;
}> = React.memo(({ item, compact = false, fluid = false, captionMode = 'none', onClick }) => {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const src = useMemo(() => resizedImageUrl(item.poster, compact ? 300 : 400), [item.poster, compact]);
  const kindLabel = item.type === 'anime' ? 'Serie' : item.type === 'series' ? 'Serie' : 'Película';

  const widthClass = fluid
    ? 'w-full'
    : compact
    ? 'w-[clamp(124px,11.2vw,172px)]'
    : 'w-[clamp(142px,13.4vw,224px)]';

  const hasArt = Boolean(src && !failed);

  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={() => prefetchImage(item.backdrop || item.poster, 1280)}
      onFocus={() => prefetchImage(item.backdrop || item.poster, 1280)}
      className={`group relative flex shrink-0 flex-col text-left select-none transition-transform duration-200 hover:z-20 hover:scale-[1.04] focus:outline-none cursor-pointer ${widthClass}`}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-[14px] bg-[#18181d] ring-1 ring-inset ring-white/[0.07] transition-shadow duration-200 group-hover:shadow-[0_22px_50px_rgba(0,0,0,0.65)] group-hover:ring-white/25">
        {hasArt ? (
          <img
            src={src}
            alt={item.title}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`pointer-events-none h-full w-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          />
        ) : (
          <div
            style={{
              background:
                'radial-gradient(120% 80% at 50% 0%, rgba(255,255,255,0.09), transparent 60%), linear-gradient(160deg, #1d1d22 0%, #111114 100%)',
            }}
            className="flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center"
          >
            <OpenTvLogo className="h-11 w-11 text-white/30" />
            <span className="line-clamp-3 text-[13px] leading-snug font-semibold text-white/85">{item.title}</span>
          </div>
        )}

        {/* Exact v1 hover title shadow overlay (`04-en-vivo-ajustes-posteres.css:274-294`) */}
        {captionMode === 'none' && hasArt && (
          <div
            style={{
              background:
                'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.58) 55%, rgba(0,0,0,0) 100%)',
            }}
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 translate-y-2 px-3.5 pt-14 pb-3 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
          >
            <div className="line-clamp-2 text-[14px] leading-[1.28] font-semibold text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.75)]">
              {item.title}
            </div>
          </div>
        )}
      </div>

      {captionMode !== 'none' && (
        <div className="mt-2 px-0.5">
          <div className="truncate text-[13.5px] font-semibold text-white/90 group-hover:text-white">{item.title}</div>
          {captionMode === 'full' && (
            <div className="mt-0.5 truncate text-[12px] text-white/50">
              {[item.year || null, kindLabel].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
      )}
    </button>
  );
});

/**
 * Exact OpenTV v1 "Seguir viendo" 16:9 card (`05-filas-busqueda-guia.css:38-78`):
 * Title and `Episodio X · Quedan Y min` sit BELOW the rounded 16:9 frame!
 */
export const ContinueCard: React.FC<{
  entry: WatchProgress;
  compact?: boolean;
  onResume: () => void;
  onRemove: () => void;
}> = React.memo(({ entry, compact = false, onResume, onRemove }) => {
  const [failed, setFailed] = useState(false);
  const src = useMemo(() => resizedImageUrl(entry.backdrop || entry.poster, 520), [entry.backdrop, entry.poster]);
  const pct =
    entry.durationMs > 0 ? Math.min(100, Math.max(2, Math.round((entry.positionMs / entry.durationMs) * 100))) : 0;
  const subtitle = formatContinueSubtitle(entry);

  return (
    <div className={`group relative shrink-0 select-none ${compact ? 'w-[clamp(210px,18vw,270px)]' : 'w-[clamp(230px,20vw,340px)]'}`}>
      <div
        onClick={onResume}
        className="relative aspect-video w-full cursor-pointer overflow-hidden rounded-[14px] bg-[#1a1a1f] ring-1 ring-inset ring-white/[0.08] transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_22px_50px_rgba(0,0,0,0.6)] group-hover:ring-white/20"
      >
        {src && !failed ? (
          <img
            src={src}
            alt={entry.title}
            loading="lazy"
            draggable={false}
            onError={() => setFailed(true)}
            className="pointer-events-none h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#2b2b33] to-[#141418]">
            <OpenTvLogo className="h-10 w-10 text-white/25" />
          </div>
        )}

        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0) 55%)' }}
        />

        {/* Centered play circle on hover */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex h-12 w-12 scale-90 items-center justify-center rounded-full bg-white/92 text-[#0e0e11] opacity-0 shadow-xl transition duration-200 group-hover:scale-100 group-hover:opacity-100">
            <Play className="ml-0.5 h-5 w-5 fill-current" />
          </div>
        </div>

        {/* Rounded progress bar inset inside bottom of frame */}
        {pct > 0 && (
          <div className="absolute right-3 bottom-3 left-3 h-[5px] overflow-hidden rounded-full bg-white/25">
            <div style={{ width: `${pct}%`, backgroundColor: 'var(--ot-accent)' }} className="h-full rounded-full" />
          </div>
        )}

        {/* Remove X button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Quitar de Seguir viendo"
          className="absolute top-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-[#0e0e11]/75 text-white opacity-0 transition hover:bg-white/25 group-hover:opacity-100 cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Title & remaining subtitle BELOW frame (`cc-title` / `cc-sub`) */}
      <div className="mt-2.5 px-1">
        <div className="truncate text-[15.5px] font-semibold text-white">{entry.title}</div>
        {subtitle && <div className="mt-0.5 truncate text-[13px] text-white/55">{subtitle}</div>}
      </div>
    </div>
  );
});

/**
 * Exact OpenTV v1 horizontal carousel row (`05-filas-busqueda-guia.css`):
 * - Aligned cleanly to `--ot-gutter`
 * - Mouse click-and-drag horizontal scrolling (`useDragScroll`) + hover arrows auto-hiding at bounds
 * - Subtle side fade mask (`.ot-row-mask`)
 */
export const ScrollRow: React.FC<{
  title: string;
  children: React.ReactNode;
  noGutter?: boolean;
}> = ({ title, children, noGutter = false }) => {
  const { ref, dragging, onMouseDown, onClickCapture } = useDragScroll();
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const syncBounds = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft >= el.scrollWidth - el.clientWidth - 4);
  }, [ref]);

  // Re-measure only when the number of cards changes: depending on `children` re-ran this
  // (a forced layout read + listener churn) for every row on every parent render.
  const childCount = React.Children.count(children);
  useEffect(() => {
    syncBounds();
  }, [syncBounds, childCount]);
  useEffect(() => {
    window.addEventListener('resize', syncBounds);
    return () => window.removeEventListener('resize', syncBounds);
  }, [syncBounds]);

  const scroll = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(460, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <section
      onMouseEnter={syncBounds}
      style={noGutter ? undefined : { paddingLeft: 'var(--ot-gutter)', paddingRight: 'var(--ot-gutter)' }}
      className="ot-cv-row group/row relative space-y-2.5"
    >
      {title && (
        <h2 className="font-display text-[clamp(18px,1.4vw,24px)] font-semibold tracking-[-0.015em] text-white">
          {title}
        </h2>
      )}

      <div className="relative -mx-4">
        {!atStart && (
          <button
            type="button"
            aria-label="Anterior"
            onClick={() => scroll(-1)}
            className="absolute top-1/2 left-1 z-30 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-[#16161a]/88 text-white opacity-0 shadow-[0_10px_30px_rgba(0,0,0,0.55)] backdrop-blur-md transition duration-200 hover:scale-105 hover:bg-white/20 group-hover/row:opacity-100 cursor-pointer"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}

        <div
          ref={ref}
          onScroll={syncBounds}
          onMouseDown={onMouseDown}
          onClickCapture={onClickCapture}
          className={`ot-no-scrollbar ot-row-mask flex gap-[clamp(12px,1.2vw,20px)] overflow-x-auto px-4 py-3 ${
            dragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
        >
          {children}
        </div>

        {!atEnd && (
          <button
            type="button"
            aria-label="Siguiente"
            onClick={() => scroll(1)}
            className="absolute top-1/2 right-1 z-30 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-[#16161a]/88 text-white opacity-0 shadow-[0_10px_30px_rgba(0,0,0,0.55)] backdrop-blur-md transition duration-200 hover:scale-105 hover:bg-white/20 group-hover/row:opacity-100 cursor-pointer"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>
    </section>
  );
};

/**
 * Exact 1:1 replica of OpenTV v1 "Elegir fuente" modal (`docs/screenshots/fuentes.jpg`)
 */
export const SourcePickerModal: React.FC<{
  title: string;
  sources: StreamSource[];
  loading: boolean;
  onSelect: (src: StreamSource) => void;
  onClose: () => void;
  onOpenPrefs?: () => void;
}> = ({ title, sources, loading, onSelect, onClose, onOpenPrefs }) => {
  const [qualityFilter, setQualityFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'direct' | 'torrent'>('all');
  const [langFilter, setLangFilter] = useState('all');
  const [sortMode, setSortMode] = useState<'rec' | 'heavy' | 'light' | 'seeds'>('rec');

  const counts = useMemo(
    () => ({
      q4k: sources.filter((s) => s.quality === '4K').length,
      q1080: sources.filter((s) => s.quality === '1080p').length,
      q720: sources.filter((s) => s.quality === '720p').length,
      qSd: sources.filter((s) => s.quality === 'SD').length,
      direct: sources.filter((s) => Boolean(s.url || s.isJsPlugin)).length,
      torrent: sources.filter((s) => Boolean(s.infoHash && !s.url)).length,
      latino: sources.filter((s) => sourceHasLang(s, 'latino') || sourceHasLang(s, 'es')).length,
      castellano: sources.filter((s) => sourceHasLang(s, 'castellano')).length,
      en: sources.filter((s) => sourceHasLang(s, 'en')).length,
    }),
    [sources],
  );

  const filtered = useMemo(() => {
    const base = sources.filter((s) => {
      if (qualityFilter !== 'all' && s.quality !== qualityFilter) return false;
      const isDirect = Boolean(s.url || s.isJsPlugin);
      if (typeFilter === 'direct' && !isDirect) return false;
      if (typeFilter === 'torrent' && isDirect) return false;
      if (langFilter === 'latino' && !(sourceHasLang(s, 'latino') || sourceHasLang(s, 'es'))) return false;
      if (langFilter === 'castellano' && !sourceHasLang(s, 'castellano')) return false;
      if (langFilter === 'en' && !sourceHasLang(s, 'en')) return false;
      return true;
    });
    if (sortMode === 'heavy') return [...base].sort((a, b) => b.sizeBytes - a.sizeBytes);
    if (sortMode === 'light') return [...base].sort((a, b) => (a.sizeBytes || 1e15) - (b.sizeBytes || 1e15));
    if (sortMode === 'seeds') return [...base].sort((a, b) => b.seeders - a.seeders);
    return base;
  }, [sources, qualityFilter, typeFilter, langFilter, sortMode]);

  const recommended = filtered[0] || null;

  // Group sources by plugin name exactly like `fuentes.jpg`
  const grouped = useMemo(() => {
    const map = new Map<string, StreamSource[]>();
    for (const s of filtered) {
      const k = s.addonName || 'Plugin';
      const arr = map.get(k);
      if (arr) arr.push(s);
      else map.set(k, [s]);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const pillClass = (on: boolean, empty = false) =>
    `rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition cursor-pointer ${
      on
        ? 'bg-[var(--ot-accent)] text-[var(--ot-accent-ink)]'
        : empty
        ? 'bg-white/[0.05] text-white/35 hover:bg-white/[0.08]'
        : 'bg-white/[0.07] text-white/80 hover:bg-white/[0.13] hover:text-white'
    }`;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="ot-fade-up flex max-h-[85vh] w-full max-w-[780px] flex-col overflow-hidden rounded-[22px] border border-white/10 bg-[#141418]/98 shadow-[0_40px_120px_rgba(0,0,0,0.82),inset_0_1px_0_rgba(255,255,255,0.06)]"
      >
        {/* Header & 3 filter rows (exact `fuentes.jpg`) */}
        <div className="space-y-2.5 border-b border-white/[0.08] px-7 pt-6 pb-4">
          <div>
            <h2 className="font-display text-[25px] font-bold tracking-[-0.02em] text-white">Elegir fuente</h2>
            <p className="mt-0.5 truncate text-[14px] text-white/55">{title}</p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <button type="button" onClick={() => setQualityFilter('all')} className={pillClass(qualityFilter === 'all')}>
              Todas
            </button>
            <button
              type="button"
              onClick={() => setQualityFilter('4K')}
              className={pillClass(qualityFilter === '4K', counts.q4k === 0)}
            >
              4K · {counts.q4k}
            </button>
            <button
              type="button"
              onClick={() => setQualityFilter('1080p')}
              className={pillClass(qualityFilter === '1080p', counts.q1080 === 0)}
            >
              Full HD · {counts.q1080}
            </button>
            <button
              type="button"
              onClick={() => setQualityFilter('720p')}
              className={pillClass(qualityFilter === '720p', counts.q720 === 0)}
            >
              HD · {counts.q720}
            </button>
            <button
              type="button"
              onClick={() => setQualityFilter('SD')}
              className={pillClass(qualityFilter === 'SD', counts.qSd === 0)}
            >
              SD · {counts.qSd}
            </button>
            <span className="mx-1.5" />
            <button type="button" onClick={() => setTypeFilter('all')} className={pillClass(typeFilter === 'all')}>
              Todo
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter('direct')}
              className={pillClass(typeFilter === 'direct', counts.direct === 0)}
            >
              Directo · {counts.direct}
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter('torrent')}
              className={pillClass(typeFilter === 'torrent', counts.torrent === 0)}
            >
              Torrent · {counts.torrent}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[12.5px] text-white/45">Idioma</span>
            <button type="button" onClick={() => setLangFilter('all')} className={pillClass(langFilter === 'all')}>
              Todos
            </button>
            <button
              type="button"
              onClick={() => setLangFilter('latino')}
              className={pillClass(langFilter === 'latino', counts.latino === 0)}
            >
              Latino · {counts.latino}
            </button>
            <button
              type="button"
              onClick={() => setLangFilter('castellano')}
              className={pillClass(langFilter === 'castellano', counts.castellano === 0)}
            >
              Castellano · {counts.castellano}
            </button>
            <button
              type="button"
              onClick={() => setLangFilter('en')}
              className={pillClass(langFilter === 'en', counts.en === 0)}
            >
              Inglés · {counts.en}
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[12.5px] text-white/45">Ordenar</span>
              <button type="button" onClick={() => setSortMode('rec')} className={pillClass(sortMode === 'rec')}>
                Recomendado
              </button>
              <button type="button" onClick={() => setSortMode('heavy')} className={pillClass(sortMode === 'heavy')}>
                Más pesadas
              </button>
              <button type="button" onClick={() => setSortMode('light')} className={pillClass(sortMode === 'light')}>
                Más ligeras
              </button>
              <button type="button" onClick={() => setSortMode('seeds')} className={pillClass(sortMode === 'seeds')}>
                Más semillas
              </button>
            </div>
            {onOpenPrefs && (
              <button type="button" onClick={onOpenPrefs} className={pillClass(false)}>
                Preferencias
              </button>
            )}
          </div>
        </div>

        {/* Source list */}
        <div className="ot-scroll flex-1 overflow-y-auto px-5 py-3">
          {loading && sources.length === 0 ? (
            <div className="py-16 text-center text-white/60">Buscando fuentes en tus plugins…</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-white/60">No hay fuentes con esos filtros.</div>
          ) : (
            <div className="space-y-4">
              {recommended && (
                <div className="border-b border-white/[0.08] pb-3">
                  <div className="mb-1 flex items-baseline justify-between px-3">
                    <span className="text-[15px] font-bold text-white">Recomendada</span>
                    <span className="text-[12.5px] text-white/45">{recommended.addonName}</span>
                  </div>
                  <SourceRow source={recommended} isRecommended onClick={() => onSelect(recommended)} />
                </div>
              )}

              {grouped.map(([groupName, items]) => (
                <div key={groupName}>
                  <div className="mb-1 flex items-baseline justify-between px-3">
                    <span className="text-[15px] font-bold text-white">{groupName}</span>
                    <span className="text-[12.5px] text-white/45">
                      {items.length} {items.length === 1 ? 'fuente' : 'fuentes'}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {items.map((s) => (
                      <SourceRow key={s.id} source={s} isRecommended={false} onClick={() => onSelect(s)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/[0.08] px-7 py-3.5">
          <span className="text-[13.5px] text-white/50">
            {filtered.length} {filtered.length === 1 ? 'fuente' : 'fuentes'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-white/[0.06] px-5 py-2 text-[14px] font-semibold text-white transition hover:bg-white/15 cursor-pointer"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};

const SourceRow: React.FC<{ source: StreamSource; isRecommended: boolean; onClick: () => void }> = ({
  source,
  isRecommended,
  onClick,
}) => {
  const isTorrent = Boolean(source.infoHash && !source.url);
  const qText = source.quality === 'unknown' ? 'Auto' : source.quality;
  const hasQ = source.quality !== 'unknown';
  const displayName =
    source.filename || source.title.split('\n')[0]?.trim() || source.name.replace(/\n/g, ' ').trim();
  const lang = languageSummary(source);
  const size = formatBytes(source.sizeBytes);
  const metaParts = [
    lang || 'Idioma original',
    isTorrent ? 'Torrent' : 'Directo',
    size || null,
    isTorrent && source.seeders > 0 ? `${source.seeders} semillas` : null,
    source.provider || source.addonName,
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-4 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/[0.07] cursor-pointer"
    >
      <div
        className={`flex h-9 w-[66px] shrink-0 items-center justify-center rounded-[10px] text-[13.5px] font-extrabold ${
          source.isCam
            ? 'bg-[#ffcf7a] text-[#0e0e11]'
            : hasQ
            ? 'bg-white text-[#0e0e11]'
            : 'bg-white/10 text-white/60'
        } ${isRecommended ? 'ring-2 ring-[#7ee2a8]' : ''}`}
      >
        {qText}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-semibold text-white">{displayName}</div>
        <div className="truncate text-[12.5px] text-white/55">
          {isTorrent ? '⇅ ' : ''}
          {metaParts.join(' · ')}
        </div>
        {isRecommended && (
          <div className="mt-0.5 truncate text-[12.5px] font-medium text-[#7ee2a8]">
            {[
              lang || null,
              source.quality === '1080p' ? 'Full HD' : qText,
              source.isHdr ? 'HDR' : null,
              source.isAtmos ? 'Dolby Atmos' : null,
              source.seeders > 0 ? `${source.seeders} semillas` : null,
              size || null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        )}
      </div>
    </button>
  );
};
