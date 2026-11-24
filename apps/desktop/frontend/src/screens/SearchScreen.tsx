import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Clock, LayoutGrid, List, Search, X } from 'lucide-react';
import type { InstalledPlugin, MediaItem } from '../types/models';
import { loadCatalogSection, searchAllCatalogs } from '../services/stremio';
import { resizedImageUrl } from '../services/tauri';
import { PosterCard } from '../components/CommonComponents';

interface SearchScreenProps {
  kidsOnly: boolean;
  plugins: InstalledPlugin[];
  recentSearches: string[];
  onAddRecent: (q: string) => void;
  onRemoveRecent: (q: string) => void;
  onClearRecents: () => void;
  onOpenTitle: (item: MediaItem) => void;
  onBack: () => void;
}

/**
 * Exact 1:1 replica of OpenTV v1 Search screen (`docs/screenshots/buscador.jpg`
 * + `02-busqueda-menu-componentes.css` + `05-filas-busqueda-guia.css`):
 * - Floating top-left round `( < )` button
 * - Centered rounded search bar + solid white `🔍 Buscar` button separated by hairline divider
 * - When empty: Búsquedas recientes (removable chips) + Búsqueda popular (6-col grid)
 * - Results header: `N resultados` on left + `[⊞ Cuadrícula | ☰ Lista]` white-pill toggle on right
 * - Clean 6-column poster grid with authentic generic TV-logo cover fallback & `Year · Type` captions.
 */
export const SearchScreen: React.FC<SearchScreenProps> = ({
  kidsOnly,
  plugins,
  recentSearches,
  onAddRecent,
  onRemoveRecent,
  onClearRecents,
  onOpenTitle,
  onBack,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MediaItem[]>([]);
  const [popular, setPopular] = useState<MediaItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Load "Búsqueda popular" items for empty state
  useEffect(() => {
    let alive = true;
    loadCatalogSection(kidsOnly ? 'kids' : 'home', plugins).then((rows) => {
      if (!alive) return;
      const seen = new Set<string>();
      const out: MediaItem[] = [];
      for (const r of rows.slice(0, 2)) {
        for (const it of r.items) {
          if (!seen.has(it.id)) {
            seen.add(it.id);
            out.push(it);
            if (out.length >= 12) break;
          }
        }
        if (out.length >= 12) break;
      }
      setPopular(out);
    });
    return () => {
      alive = false;
    };
  }, [kidsOnly, plugins]);

  const searchSeq = useRef(0);
  const executeSearch = async (text: string, addRecent = true) => {
    const clean = text.trim();
    if (clean.length < 2) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    setHasSearched(true);
    if (addRecent) onAddRecent(clean);
    // Direct hits show at once; the TMDB original-title query merges in when it lands.
    const hits = await searchAllCatalogs(clean, kidsOnly, (partial) => {
      if (seq !== searchSeq.current || partial.length === 0) return;
      setResults(partial);
      setSearching(false);
    });
    // Ignore stale responses from earlier keystrokes.
    if (seq !== searchSeq.current) return;
    setResults(hits);
    setSearching(false);
  };

  // Search as you type (debounced); Enter still searches immediately and saves it as recent.
  useEffect(() => {
    const clean = query.trim();
    if (clean.length < 2) return;
    const t = setTimeout(() => void executeSearch(clean, false), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, kidsOnly]);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#0e0e11]">
      {/* Floating top-left round Back button (`buscador.jpg`) */}
      <button
        type="button"
        onClick={onBack}
        aria-label="Volver"
        className="fixed top-[50px] left-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-[#141418]/70 text-white backdrop-blur-xl transition hover:border-white/40 hover:bg-white/15 cursor-pointer"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      {/* Top Search Bar separated by hairline (`02-busqueda-menu-componentes.css:10`) */}
      <div className="flex shrink-0 items-center justify-center border-b border-white/[0.07] px-16 py-5 sm:px-20 lg:py-7">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void executeSearch(query);
          }}
          className="flex w-full max-w-[820px] items-center gap-2.5 sm:gap-3"
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-5 h-5 w-5 -translate-y-1/2 text-white/45" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                const v = e.target.value;
                setQuery(v);
                if (!v.trim()) {
                  setResults([]);
                  setHasSearched(false);
                }
              }}
              placeholder="Buscar películas, series o anime"
              className="h-[56px] w-full rounded-[16px] border border-white/[0.12] bg-white/[0.06] pr-11 pl-14 text-[18px] text-white placeholder-white/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_30px_rgba(0,0,0,0.35)] outline-none transition hover:border-white/25 focus:border-white focus:bg-white/[0.09]"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setResults([]);
                  setHasSearched(false);
                  inputRef.current?.focus();
                }}
                className="absolute top-1/2 right-3.5 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-white/55 hover:bg-white/10 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <button
            type="submit"
            style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
            className="flex h-[56px] shrink-0 items-center gap-2.5 rounded-[16px] px-7 text-[17px] font-semibold shadow-[0_10px_30px_rgba(255,255,255,0.08)] transition hover:brightness-90 active:scale-[0.98] cursor-pointer"
          >
            <Search className="h-5 w-5" />
            <span>Buscar</span>
          </button>
        </form>
      </div>

      {/* Scrollable Results / Popular Body */}
      <div
        style={{ paddingLeft: 'var(--ot-gutter)', paddingRight: 'var(--ot-gutter)' }}
        className="ot-scroll flex-1 overflow-y-auto pt-7 pb-16"
      >
        {!hasSearched ? (
          <div className="space-y-9">
            {/* Búsquedas recientes */}
            {recentSearches.length > 0 && (
              <section className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-[20px] font-bold tracking-[-0.02em] text-white">
                    Búsquedas recientes
                  </h2>
                  <button
                    type="button"
                    onClick={onClearRecents}
                    className="rounded-lg px-3 py-1 text-[13.5px] font-medium text-white/55 transition hover:bg-white/[0.08] hover:text-white cursor-pointer"
                  >
                    Limpiar
                  </button>
                </div>

                <div className="flex flex-wrap gap-2.5">
                  {recentSearches.map((q) => (
                    <div
                      key={q}
                      onClick={() => void executeSearch(q)}
                      className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] pr-1.5 pl-4 text-[14.5px] text-white transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.12]"
                    >
                      <Clock className="h-3.5 w-3.5 text-white/50" />
                      <span>{q}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveRecent(q);
                        }}
                        aria-label={`Quitar ${q}`}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-white/45 transition hover:bg-white/15 hover:text-white cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Búsqueda popular (`02-busqueda-menu-componentes.css:60-81`) */}
            {popular.length > 0 && (
              <section className="space-y-4">
                <div className="flex items-baseline justify-between">
                  <h2 className="font-display text-[22px] font-bold tracking-[-0.02em] text-white">
                    Búsqueda popular
                  </h2>
                  <span className="text-[14px] text-white/45">Total: {popular.length}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 lg:gap-x-5 lg:gap-y-7">
                  {popular.map((item) => (
                    <PosterCard
                      key={item.id}
                      item={item}
                      fluid
                      captionMode="title"
                      onClick={() => onOpenTitle(item)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Exact `buscador.jpg` results bar: count on left, Cuadrícula | Lista capsule on right */}
            <div className="flex items-center justify-between">
              <span className="text-[16px] font-semibold text-white/85">
                {searching ? 'Buscando…' : `${results.length} ${results.length === 1 ? 'resultado' : 'resultados'}`}
              </span>

              <div className="inline-flex rounded-full border border-white/10 bg-white/[0.06] p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  style={
                    viewMode === 'grid' ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' } : undefined
                  }
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition cursor-pointer ${
                    viewMode === 'grid' ? '' : 'text-white/65 hover:text-white'
                  }`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  <span>Cuadrícula</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  style={
                    viewMode === 'list' ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' } : undefined
                  }
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition cursor-pointer ${
                    viewMode === 'list' ? '' : 'text-white/65 hover:text-white'
                  }`}
                >
                  <List className="h-3.5 w-3.5" />
                  <span>Lista</span>
                </button>
              </div>
            </div>

            {searching ? (
              <div className="flex justify-center py-24">
                <div
                  style={{ borderTopColor: 'var(--ot-accent)' }}
                  className="h-9 w-9 animate-spin rounded-full border-2 border-white/15"
                />
              </div>
            ) : results.length === 0 ? (
              <div className="space-y-2 py-24 text-center">
                <div className="font-display text-[22px] font-bold text-white">No hay resultados</div>
                <p className="text-[14.5px] text-white/55">
                  Prueba con otro nombre de película, serie, director o actor, o revisa cómo está escrito.
                </p>
                <p className="text-[13.5px] text-white/40">
                  Para buscar un canal, abre TV en vivo y usa la Guía.
                </p>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-4 gap-x-5 gap-y-7 md:grid-cols-6">
                {results.map((item) => (
                  <PosterCard
                    key={item.id}
                    item={item}
                    fluid
                    captionMode="full"
                    onClick={() => onOpenTitle(item)}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-2.5">
                {results.map((item) => {
                  const img = resizedImageUrl(item.poster, 180);
                  const kind = item.type === 'movie' ? 'Película' : 'Serie';
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onOpenTitle(item)}
                      className="flex w-full items-center gap-4 rounded-[16px] border border-white/[0.07] bg-white/[0.04] p-3 text-left transition hover:border-white/20 hover:bg-white/[0.08] cursor-pointer"
                    >
                      <div className="aspect-[2/3] w-14 shrink-0 overflow-hidden rounded-lg bg-[#1c1c22]">
                        {img && <img src={img} alt={item.title} loading="lazy" className="h-full w-full object-cover" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[16px] font-bold text-white">{item.title}</span>
                          {item.score && (
                            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11.5px] font-bold text-white/90">
                              ★ {item.score}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[13px] text-white/55">
                          {[item.year || null, kind].filter(Boolean).join(' · ')}
                        </div>
                        {item.synopsis && (
                          <p className="mt-1 line-clamp-1 text-[13px] text-white/45">{item.synopsis}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
