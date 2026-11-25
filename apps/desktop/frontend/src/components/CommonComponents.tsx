import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Play, X } from 'lucide-react';
import type { MediaItem, StreamSource, WatchProgress } from '../types/models';
import { formatContinueSubtitle } from '../services/locales';
import {
  formatBytes,
  isDirectSource,
  matchesLangFilter,
  matchesQualityFilter,
  matchesTypeFilter,
  pickerFilterOptions,
  plainLanguageLabel,
  qualityLabel,
  sourceDetailLine,
  typeLabel,
  type PickerOption,
} from '../services/sourceRanker';
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
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-[14px] bg-surface-alt ring-1 ring-inset ring-fg/[0.07] transition-shadow duration-200 group-hover:shadow-[0_22px_50px_rgba(0,0,0,0.65)] group-hover:ring-fg/25">
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
          <div className="truncate text-[13.5px] font-semibold text-fg/90 group-hover:text-fg">{item.title}</div>
          {captionMode === 'full' && (
            <div className="mt-0.5 truncate text-[12px] text-fg/50 light:text-muted">
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
        className="relative aspect-video w-full cursor-pointer overflow-hidden rounded-[14px] bg-[#1a1a1f] light:bg-surface-alt ring-1 ring-inset ring-fg/[0.08] transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_22px_50px_rgba(0,0,0,0.6)] group-hover:ring-fg/20"
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
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#2b2b33] to-surface light:from-elev-hi light:to-surface-alt">
            <OpenTvLogo className="h-10 w-10 text-fg/25 light:text-faint" />
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
        <div className="truncate text-[15.5px] font-semibold text-fg">{entry.title}</div>
        {subtitle && <div className="mt-0.5 truncate text-[13px] text-fg/55 light:text-muted">{subtitle}</div>}
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
        <h2 className="font-display text-[clamp(18px,1.4vw,24px)] font-semibold tracking-[-0.015em] text-fg">
          {title}
        </h2>
      )}

      <div className="relative -mx-4">
        {!atStart && (
          <button
            type="button"
            aria-label="Anterior"
            onClick={() => scroll(-1)}
            className="absolute top-1/2 left-1 z-30 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-fg/15 bg-[#16161a]/88 light:bg-surface/95 text-fg opacity-0 shadow-[0_10px_30px_rgba(0,0,0,0.55)] backdrop-blur-md transition duration-200 hover:scale-105 hover:bg-fg/20 group-hover/row:opacity-100 cursor-pointer"
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
            className="absolute top-1/2 right-1 z-30 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-fg/15 bg-[#16161a]/88 light:bg-surface/95 text-fg opacity-0 shadow-[0_10px_30px_rgba(0,0,0,0.55)] backdrop-blur-md transition duration-200 hover:scale-105 hover:bg-fg/20 group-hover/row:opacity-100 cursor-pointer"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>
    </section>
  );
};

/**
 * Dark dropdown used by the source picker filters ("Calidad", "Idioma", "Tipo").
 * Keyboard: arrows move, Enter picks, Esc closes and gives focus back to the button.
 */
const PickerSelect: React.FC<{
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
}> = ({ label, value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = options.find((o) => o.value === value) ?? options[0];
  const active = value !== 'all';

  useEffect(() => {
    if (!open) return;
    const idx = Math.max(0, options.findIndex((o) => o.value === value));
    itemRefs.current[idx]?.focus();
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
    // Focus the current value only when the list opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const idx = itemRefs.current.findIndex((el) => el === document.activeElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = Math.min(options.length - 1, idx + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, idx - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault();
      e.stopPropagation();
      close();
      return;
    } else if (e.key !== 'Enter' && e.key !== ' ') return;
    // Keep the player's global shortcuts (arrows, space, Esc) out of the open list.
    e.stopPropagation();
    if (next >= 0) {
      e.preventDefault();
      itemRefs.current[next]?.focus();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }
        }}
        className={`flex h-11 min-w-[150px] items-center gap-2 rounded-xl border px-3.5 text-left transition cursor-pointer ${
          open || active
            ? 'border-[var(--ot-accent)] bg-fg/[0.09]'
            : 'border-fg/10 bg-fg/[0.05] hover:bg-fg/[0.09]'
        }`}
      >
        <span className="text-[12.5px] text-fg/50 light:text-muted">{label}</span>
        <span className="flex-1 truncate text-[14px] font-semibold text-fg">{current?.label}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-fg/60 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={label}
          onKeyDown={onListKey}
          className="ot-scroll absolute top-full left-0 z-30 mt-1.5 max-h-[320px] min-w-full overflow-y-auto rounded-xl border border-fg/10 bg-[#1b1b20] p-1 shadow-[0_18px_50px_rgba(0,0,0,0.7)] light:bg-surface light:shadow-[0_18px_50px_rgba(0,0,0,0.18)]"
        >
          {options.map((o, i) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(o.value);
                  close();
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[14px] whitespace-nowrap transition cursor-pointer hover:bg-fg/[0.08] focus:bg-fg/[0.1] focus:outline-none ${
                  selected ? 'font-bold text-fg' : 'text-fg/80'
                }`}
              >
                <Check className={`h-4 w-4 shrink-0 ${selected ? 'text-[var(--ot-accent)]' : 'opacity-0'}`} />
                <span className="flex-1">{o.label}</span>
                <span className="pl-3 text-[12.5px] text-fg/40 light:text-muted">{o.count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

/**
 * "Elegir fuente": simple list for everyone. Three dropdown filters (Calidad / Idioma / Tipo),
 * the ranker's best pick on top as "Recomendada", and one plain row per source
 * (quality badge, language, Directo/Torrent, size, plugin). Same design as Android `SourcePickerDialog`.
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
  const [langFilter, setLangFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  const options = useMemo(() => pickerFilterOptions(sources), [sources]);

  const filtered = useMemo(
    () =>
      sources.filter(
        (s) =>
          matchesQualityFilter(s, qualityFilter) && matchesLangFilter(s, langFilter) && matchesTypeFilter(s, typeFilter),
      ),
    [sources, qualityFilter, langFilter, typeFilter],
  );

  const recommended = filtered[0] || null;
  const others = filtered.slice(1);
  const anyFilter = qualityFilter !== 'all' || langFilter !== 'all' || typeFilter !== 'all';

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="ot-fade-up flex max-h-[85vh] w-full max-w-[760px] flex-col overflow-hidden rounded-[22px] border border-fg/10 bg-surface/98 shadow-[0_40px_120px_rgba(0,0,0,0.82),inset_0_1px_0_rgba(255,255,255,0.06)]"
      >
        {/* Header + dropdown filters */}
        <div className="relative z-20 border-b border-fg/[0.08] px-7 pt-6 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-display text-[25px] font-bold tracking-[-0.02em] text-fg">Elegir fuente</h2>
              <p className="mt-0.5 truncate text-[14px] text-fg/55 light:text-muted">{title}</p>
            </div>
            <button
              type="button"
              aria-label="Cerrar"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fg/[0.06] text-fg/80 transition hover:bg-fg/15 hover:text-fg cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <PickerSelect label="Calidad" value={qualityFilter} options={options.quality} onChange={setQualityFilter} />
            <PickerSelect label="Idioma" value={langFilter} options={options.lang} onChange={setLangFilter} />
            <PickerSelect label="Tipo" value={typeFilter} options={options.type} onChange={setTypeFilter} />
            {anyFilter && (
              <button
                type="button"
                onClick={() => {
                  setQualityFilter('all');
                  setLangFilter('all');
                  setTypeFilter('all');
                }}
                className="h-11 rounded-xl px-3 text-[13.5px] font-semibold text-fg/60 transition hover:bg-fg/[0.06] hover:text-fg cursor-pointer"
              >
                Quitar filtros
              </button>
            )}
          </div>
        </div>

        {/* Source list */}
        <div className="ot-scroll flex-1 overflow-y-auto px-5 py-4">
          {loading && sources.length === 0 ? (
            <div className="py-16 text-center text-fg/60">Buscando fuentes en tus plugins…</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-fg/60">
              {sources.length === 0 ? 'No se encontraron fuentes.' : 'No hay fuentes con esos filtros.'}
            </div>
          ) : (
            <div className="space-y-1.5">
              {recommended && <SourceRow source={recommended} isRecommended onClick={() => onSelect(recommended)} />}
              {others.length > 0 && (
                <div className="flex items-baseline justify-between px-3 pt-3 pb-1">
                  <span className="text-[14px] font-bold text-fg/85">Más opciones</span>
                  <span className="text-[12.5px] text-fg/45 light:text-muted">
                    {others.length} {others.length === 1 ? 'fuente' : 'fuentes'}
                  </span>
                </div>
              )}
              {others.map((s) => (
                <SourceRow key={s.id} source={s} isRecommended={false} onClick={() => onSelect(s)} />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-fg/[0.08] px-7 py-3.5">
          <span className="text-[13.5px] text-fg/50 light:text-muted">
            {filtered.length} {filtered.length === 1 ? 'fuente' : 'fuentes'}
            {loading && sources.length > 0 ? ' · buscando más…' : ''}
          </span>
          <div className="flex items-center gap-2">
            {onOpenPrefs && (
              <button
                type="button"
                onClick={onOpenPrefs}
                className="rounded-xl px-4 py-2 text-[14px] font-semibold text-fg/70 transition hover:bg-fg/[0.08] hover:text-fg cursor-pointer"
              >
                Preferencias
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-fg/[0.06] px-5 py-2 text-[14px] font-semibold text-fg transition hover:bg-fg/15 cursor-pointer"
            >
              Cancelar
            </button>
          </div>
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
  const quality = qualityLabel(source);
  const hasQuality = source.quality !== 'unknown';
  const size = formatBytes(source.sizeBytes);
  const isDirect = isDirectSource(source);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-4 rounded-2xl border px-4 py-3.5 text-left transition cursor-pointer ${
        isRecommended
          ? 'border-[#7ee2a8]/30 bg-[#7ee2a8]/[0.06] hover:bg-[#7ee2a8]/[0.11]'
          : 'border-transparent hover:bg-fg/[0.06]'
      }`}
    >
      <div
        className={`flex h-11 w-[74px] shrink-0 items-center justify-center rounded-xl text-[15px] font-extrabold ${
          hasQuality ? 'bg-fg text-page' : 'bg-fg/10 text-fg/70'
        }`}
      >
        {quality}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[16px] font-semibold text-fg">{plainLanguageLabel(source)}</span>
          {isRecommended && (
            <span className="shrink-0 rounded-full bg-[#7ee2a8] px-2.5 py-0.5 text-[11.5px] font-bold text-[#0e0e11]">
              Recomendada
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[12.5px] text-fg/45 light:text-muted">{sourceDetailLine(source)}</div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {size && <span className="text-[13px] text-fg/55 light:text-muted tabular-nums">{size}</span>}
        <span
          className={`rounded-lg px-2.5 py-1 text-[12.5px] font-semibold ${
            isDirect ? 'bg-fg/[0.12] text-fg' : 'bg-fg/[0.05] text-fg/65'
          }`}
        >
          {typeLabel(source)}
        </span>
        <Play className="h-4 w-4 fill-current text-fg/0 transition group-hover:text-fg/80" />
      </div>
    </button>
  );
};
