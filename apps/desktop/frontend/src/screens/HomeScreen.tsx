import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookmarkPlus, Check, Info, Play } from 'lucide-react';
import type { CatalogRow, HomeTabId, InstalledPlugin, MediaItem, WatchProgress } from '../types/models';
import { loadCatalogSection } from '../services/stremio';
import { formatHeroMeta, localizedGenres } from '../services/locales';
import { localizeItem, peekLocalized } from '../services/localize';
import { resizedImageUrl } from '../services/tauri';
import { ContinueCard, PosterCard, ScrollRow } from '../components/CommonComponents';

interface HomeScreenProps {
  tab: HomeTabId;
  plugins: InstalledPlugin[];
  continueWatching: WatchProgress[];
  myListIds: Set<string>;
  compact: boolean;
  liteMode: boolean;
  onScrolledChange: (scrolled: boolean) => void;
  onPlayItem: (item: MediaItem) => void;
  onResumeEntry: (entry: WatchProgress) => void;
  onRemoveContinue: (itemId: string) => void;
  onOpenDetail: (item: MediaItem) => void;
  onToggleMyList: (item: MediaItem) => void;
}

const GRID_TITLES: Partial<Record<HomeTabId, string>> = {
  movies: 'Todas las películas',
  series: 'Todas las series',
  kids: 'Todo para niños',
  anime: 'Todo el anime',
};

/**
 * Exact 1:1 replica of OpenTV v1 Home (`docs/screenshots/inicio.jpg`, `peliculas.jpg`, `anime.jpg`):
 * - Full-bleed Hero layer behind TopNavBar with `.ot-hero-mask` bottom fade (zero hard edge!)
 *   scrolling cleanly with the page so the first row peeks right into the bottom ~30% of viewport
 * - Dynamic Hero title scaling (`is-long` / `is-xlong` / `is-xxlong`), translated Spanish genres (`•`),
 *   exact Reproducir / Más información / circular Mi lista buttons, and 6 thin horizontal dash indicators
 * - Authentic large posters (~6 across), Seguir viendo with titles below, Tendencias de la semana first,
 *   Top 10 hollow numerals, full 6-column catalog grid at end of sections, and Netflix-style HoverCard.
 */
export const HomeScreen: React.FC<HomeScreenProps> = ({
  tab,
  plugins,
  continueWatching,
  myListIds,
  compact,
  liteMode,
  onScrolledChange,
  onPlayItem,
  onResumeEntry,
  onRemoveContinue,
  onOpenDetail,
  onToggleMyList,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const heroBgRef = useRef<HTMLDivElement>(null);
  const heroHoverAtRef = useRef<number>(0);

  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [heroIdx, setHeroIdx] = useState(0);
  const [swapping, setSwapping] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setHeroIdx(0);
    onScrolledChange(false);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    if (heroBgRef.current) heroBgRef.current.style.transform = 'translateY(0px)';

    loadCatalogSection(tab, plugins).then((data) => {
      if (!alive) return;
      setRows(data);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [tab, plugins, onScrolledChange]);

  // Hero items: up to 6 items with landscape/backdrop artwork (mixed movies & series on Inicio)
  const heroItems = useMemo(() => {
    const seen = new Set<string>();
    const list: MediaItem[] = [];
    const maxPerRow = tab === 'home' ? 3 : 6;
    for (const r of rows.slice(0, 2)) {
      let taken = 0;
      for (const it of r.items) {
        if ((it.backdrop || it.poster) && !seen.has(it.id)) {
          seen.add(it.id);
          list.push(it);
          taken++;
          if (taken >= maxPerRow || list.length >= 6) break;
        }
      }
      if (list.length >= 6) break;
    }
    return list;
  }, [rows, tab]);

  const switchHero = useCallback((nextIdx: number) => {
    setSwapping(true);
    setTimeout(() => {
      setHeroIdx(nextIdx);
      setSwapping(false);
    }, 180);
  }, []);

  // Rotate hero every 9 seconds (exact `HERO_INTERVAL_MS = 9000`), pausing on hover or deep scroll
  useEffect(() => {
    if (heroItems.length <= 1) return;
    const t = setInterval(() => {
      if (Date.now() - heroHoverAtRef.current < 5000) return;
      if (scrollRef.current && scrollRef.current.scrollTop > 350) return;
      switchHero((heroIdx + 1) % heroItems.length);
    }, 9000);
    return () => clearInterval(t);
  }, [heroIdx, heroItems.length, switchHero]);

  const filteredContinue = useMemo(
    () =>
      continueWatching
        .filter((e) => !(e.durationMs > 60_000 && e.positionMs / e.durationMs >= 0.95))
        .filter((e) => {
          if (tab === 'movies') return e.type === 'movie';
          if (tab === 'series') return e.type === 'series';
          if (tab === 'anime') return e.type === 'anime';
          return tab === 'home';
        }),
    [continueWatching, tab],
  );

  // Deduplicated catalog grid items for bottom of Movies / Series / Kids / Anime
  const allGridItems = useMemo(() => {
    if (tab === 'home') return [];
    const seen = new Set<string>();
    const out: MediaItem[] = [];
    for (const r of rows) {
      for (const it of r.items) {
        if (!seen.has(it.id)) {
          seen.add(it.id);
          out.push(it);
        }
      }
    }
    return out;
  }, [rows, tab]);

  // Spanish title/synopsis for the hero slides (TMDB, cached); re-render as each one arrives.
  const [esTick, setEsTick] = useState(0);
  useEffect(() => {
    let alive = true;
    for (const it of heroItems) {
      void localizeItem(it).then((loc) => {
        if (alive && loc !== it) setEsTick((t) => t + 1);
      });
    }
    return () => {
      alive = false;
    };
  }, [heroItems]);

  const heroRaw = heroItems[heroIdx] || heroItems[0] || null;
  const hero = useMemo(() => (heroRaw ? peekLocalized(heroRaw) : null), [heroRaw, esTick]);
  const heroArt = useMemo(() => (hero ? resizedImageUrl(hero.backdrop || hero.poster, 1600) : ''), [hero]);
  const heroTitleClass = useMemo(() => {
    const len = hero?.title.length || 0;
    if (len > 80) return 'text-[clamp(26px,2.4vw,34px)] leading-[1.12]';
    if (len > 52) return 'text-[clamp(30px,2.9vw,42px)] leading-[1.08]';
    if (len > 30) return 'text-[clamp(34px,3.5vw,50px)] leading-[1.05]';
    return 'text-[clamp(40px,4.4vw,62px)] leading-[1.02]';
  }, [hero?.title]);

  const heroGenres = useMemo(() => (hero ? localizedGenres(hero.genres, 3) : []), [hero]);
  const heroInList = hero ? myListIds.has(hero.id) : false;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Full-bleed Hero Artwork Layer behind TopNavBar & Rows (`07-inicio-hero-perfiles.css:61-81`) */}
      {hero && (
        <div
          ref={heroBgRef}
          className="ot-hero-mask pointer-events-none absolute top-0 right-0 left-0 z-0 h-[clamp(440px,80vh,860px)] overflow-hidden will-change-transform"
        >
          {heroArt && (
            <img
              key={hero.id}
              src={heroArt}
              alt=""
              className={`absolute inset-0 h-full w-full object-cover object-[center_20%] transition-opacity duration-700 ${
                liteMode ? '' : 'ot-kenburns'
              }`}
            />
          )}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, rgba(14,14,17,0.94) 0%, rgba(14,14,17,0.70) 28%, rgba(14,14,17,0.15) 58%, rgba(14,14,17,0) 75%), linear-gradient(0deg, #0e0e11 0%, rgba(14,14,17,0.85) 14%, rgba(14,14,17,0) 45%)',
            }}
          />
        </div>
      )}

      {/* Scrollable Page Layer */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const y = e.currentTarget.scrollTop;
          onScrolledChange(y > 120);
          if (heroBgRef.current) heroBgRef.current.style.transform = `translateY(${-y}px)`;
        }}
        className="ot-home-scroll relative z-10 h-full w-full overflow-y-auto pb-16"
      >
        {/* Hero Text + Buttons Block (`inicio.jpg` — scales fluidly from 720p laptops to 4K!) */}
        {hero && (
          <section
            onMouseMove={() => {
              heroHoverAtRef.current = Date.now();
            }}
            style={{ paddingLeft: 'var(--ot-gutter)', paddingRight: 'var(--ot-gutter)' }}
            className="flex min-h-[clamp(380px,65vh,680px)] flex-col justify-end pt-[84px] pb-6"
          >
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
              <div
                className={`max-w-[min(680px,68vw)] space-y-2.5 transition-all duration-200 ${
                  swapping ? 'translate-y-2 opacity-0' : 'translate-y-0 opacity-100'
                }`}
              >
                <div className="text-[12.5px] font-bold tracking-[0.22em] text-white/70 uppercase">
                  {hero.type === 'movie' ? 'PELÍCULA' : 'SERIE'}
                </div>

                <h1
                  className={`font-display font-extrabold tracking-[-0.02em] text-white drop-shadow-[0_4px_30px_rgba(0,0,0,0.45)] ${heroTitleClass}`}
                >
                  {hero.title}
                </h1>

                <div className="text-[15.5px] font-semibold text-white/90">{formatHeroMeta(hero)}</div>

                {heroGenres.length > 0 && (
                  <div className="text-[14px] text-white/65">{heroGenres.join('  •  ')}</div>
                )}

                {hero.synopsis && (
                  <p className="ot-text-scalable line-clamp-3 max-w-[620px] text-[15px] leading-[1.48] text-white/82">
                    {hero.synopsis}
                  </p>
                )}

                {/* Exact Hero Buttons (`inicio.jpg`) */}
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => onPlayItem(hero)}
                    style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
                    className="flex h-[50px] items-center gap-2.5 rounded-[10px] px-7 text-[16.5px] font-bold transition duration-150 hover:-translate-y-0.5 hover:brightness-90 cursor-pointer"
                  >
                    <Play className="h-5 w-5 fill-current" />
                    <span>Reproducir</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenDetail(hero)}
                    className="flex h-[50px] items-center gap-2.5 rounded-[10px] bg-[rgba(109,109,115,0.55)] px-6 text-[16.5px] font-bold text-white backdrop-blur-md transition duration-150 hover:-translate-y-0.5 hover:bg-[rgba(109,109,115,0.8)] cursor-pointer"
                  >
                    <Info className="h-5 w-5" />
                    <span>Más información</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleMyList(hero)}
                    title={heroInList ? 'Quitar de Mi lista' : 'Añadir a Mi lista'}
                    className="flex h-[50px] w-[50px] items-center justify-center rounded-full bg-[#141418]/50 text-white shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.55)] transition duration-150 hover:-translate-y-0.5 hover:shadow-[inset_0_0_0_2px_#fff] cursor-pointer"
                  >
                    {heroInList ? <Check className="h-5 w-5" /> : <BookmarkPlus className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              {/* Exact 6 Horizontal Dash Indicators (`07-inicio-hero-perfiles.css:118-120`) */}
              {heroItems.length > 1 && (
                <div className="flex shrink-0 items-center gap-2 pb-2">
                  {heroItems.map((it, i) => (
                    <button
                      key={it.id}
                      type="button"
                      aria-label={it.title}
                      onClick={() => switchHero(i)}
                      style={i === heroIdx ? { backgroundColor: 'var(--ot-accent)' } : undefined}
                      className={`h-[4px] rounded-full transition-all duration-300 cursor-pointer ${
                        i === heroIdx ? 'w-10' : 'w-4 bg-white/30 hover:bg-white/60'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Loading state */}
        {loading && rows.length === 0 ? (
          <div className="flex h-[55vh] flex-col items-center justify-center gap-3 pt-20">
            <div
              style={{ borderTopColor: 'var(--ot-accent)' }}
              className="h-9 w-9 animate-spin rounded-full border-2 border-white/15"
            />
            <span className="text-[14px] text-white/50">Cargando catálogo de tus plugins…</span>
          </div>
        ) : (
          <div className={`space-y-8 ${hero ? 'pt-1' : 'pt-24'}`}>
            {/* Seguir viendo */}
            {filteredContinue.length > 0 && (
              <ScrollRow title="Seguir viendo">
                {filteredContinue.map((entry) => (
                  <ContinueCard
                    key={`${entry.itemId}_${entry.season}_${entry.episode}`}
                    entry={entry}
                    compact={compact}
                    onResume={() => onResumeEntry(entry)}
                    onRemove={() => onRemoveContinue(entry.itemId)}
                  />
                ))}
              </ScrollRow>
            )}

            {/* Catalog / Trending Rows (no Top 10 rows, hover title shadow on each poster) */}
            {rows.map((row) => (
              <ScrollRow key={row.id} title={row.title}>
                {row.items.map((it) => (
                  <PosterCard
                    key={it.id}
                    item={it}
                    compact={compact}
                    onClick={() => onOpenDetail(it)}
                  />
                ))}
              </ScrollRow>
            ))}

            {/* Full responsive catalog grid at end of Movies / Series / Kids / Anime (`catalog-pages.js`) */}
            {allGridItems.length > 0 && GRID_TITLES[tab] && (
              <section
                style={{ paddingLeft: 'var(--ot-gutter)', paddingRight: 'var(--ot-gutter)' }}
                className="space-y-4 pt-3"
              >
                <h2 className="font-display text-[clamp(18px,1.4vw,24px)] font-semibold tracking-[-0.015em] text-white">
                  {GRID_TITLES[tab]}
                </h2>
                <div
                  className={`grid gap-4 lg:gap-5 ${
                    compact
                      ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8'
                      : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7'
                  }`}
                >
                  {allGridItems.slice(0, 48).map((it) => (
                    <PosterCard
                      key={`grid_${it.id}`}
                      item={it}
                      fluid
                      onClick={() => onOpenDetail(it)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
