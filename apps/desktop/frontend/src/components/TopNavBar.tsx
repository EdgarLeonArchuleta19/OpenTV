import React, { useEffect, useState } from 'react';
import { BookmarkPlus, Search, Wifi } from 'lucide-react';
import type { HomeTabId, UserProfile } from '../types/models';
import { OpenTvLogo } from './CommonComponents';
import { ProfileAvatar } from './Avatars';

export const DESKTOP_TABS: Array<{ id: HomeTabId; label: string }> = [
  { id: 'live', label: 'TV en vivo' },
  { id: 'home', label: 'Inicio' },
  { id: 'movies', label: 'Películas' },
  { id: 'series', label: 'Series' },
  { id: 'kids', label: 'Kids' },
  { id: 'anime', label: 'Anime' },
];

interface TopNavBarProps {
  activeTab: HomeTabId;
  scrolled: boolean;
  profile: UserProfile;
  onSelectTab: (tab: HomeTabId) => void;
  onOpenSearch: () => void;
  onOpenMyList: () => void;
  onOpenAccount: () => void;
}

function formatClock(): string {
  return new Date()
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\u202f|\u00a0/g, ' ');
}

/**
 * Exact 1:1 replica of OpenTV v1 TopNavBar (`docs/screenshots/inicio.jpg`, `peliculas.jpg`, `anime.jpg`):
 * - Aligned cleanly to `--ot-gutter` (~6.25vw) matching the Hero and first poster card
 * - Left: OpenTV TV logo + wordmark + clean horizontal tabs with white underline bar
 * - Right: EXACTLY 3 circular controls (`Buscar`, `Mi lista`, `Avatar` -> opens Mi cuenta / Ajustes),
 *   vertical separator `|`, Wi-Fi icon and crisp clock (`1:56 AM`). No extra Settings gear!
 */
export const TopNavBar: React.FC<TopNavBarProps> = ({
  activeTab,
  scrolled,
  profile,
  onSelectTab,
  onOpenSearch,
  onOpenMyList,
  onOpenAccount,
}) => {
  const [clock, setClock] = useState(() => formatClock());

  useEffect(() => {
    const t = setInterval(() => setClock(formatClock()), 15_000);
    return () => clearInterval(t);
  }, []);

  const tabs = profile.kids ? DESKTOP_TABS.filter((t) => t.id === 'kids') : DESKTOP_TABS;

  return (
    <nav
      style={{ paddingLeft: 'var(--ot-gutter)', paddingRight: 'var(--ot-gutter)' }}
      className={`absolute top-0 right-0 left-0 z-30 flex h-[68px] lg:h-[76px] items-center justify-between gap-2 transition-colors duration-300 ${
        scrolled
          ? 'bg-page/[0.97] shadow-[0_1px_0_rgba(255,255,255,0.06)] light:shadow-[0_1px_0_rgba(0,0,0,0.08)]'
          : 'bg-gradient-to-b from-[#08080a]/75 via-[#08080a]/30 to-transparent light:from-page/85 light:via-page/40'
      }`}
    >
      {/* Left: Brand + Horizontal Tabs */}
      <div className="flex min-w-0 items-center gap-3 md:gap-5 xl:gap-10">
        <button
          type="button"
          onClick={() => onSelectTab(profile.kids ? 'kids' : 'home')}
          className="flex shrink-0 items-center gap-2 text-fg cursor-pointer"
        >
          <OpenTvLogo className="h-[24px] w-[24px] lg:h-[26px] lg:w-[26px] shrink-0" />
          <span className="hidden lg:inline font-display text-[21px] xl:text-[22px] font-semibold tracking-[-0.02em] whitespace-nowrap">
            OpenTV
          </span>
        </button>

        <div className="flex items-center gap-0.5 xl:gap-1">
          {tabs.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectTab(tab.id)}
                className={`relative shrink-0 whitespace-nowrap px-2 py-2 text-[14px] md:px-2.5 md:text-[15px] xl:px-3.5 xl:text-[17px] transition-colors cursor-pointer ${
                  active ? 'font-bold text-fg' : 'font-medium text-fg/68 hover:text-fg'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  style={{ backgroundColor: 'var(--ot-accent)' }}
                  className={`absolute right-2 bottom-0 left-2 md:right-2.5 md:left-2.5 xl:right-3.5 xl:left-3.5 h-[2.5px] rounded-full transition-transform duration-300 ${
                    active ? 'scale-x-100' : 'scale-x-0'
                  }`}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Search, Mi lista, Profile Avatar (opens Mi cuenta & Ajustes) | Wi-Fi + Clock */}
      <div className="flex shrink-0 items-center gap-1.5 md:gap-2 xl:gap-2.5">
        {!profile.kids && (
          <button
            type="button"
            onClick={onOpenSearch}
            title="Buscar (Ctrl+F)"
            aria-label="Buscar"
            className="flex h-9 w-9 xl:h-10 xl:w-10 items-center justify-center rounded-full border border-fg/[0.08] bg-fg/[0.08] text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:bg-fg/[0.16] cursor-pointer"
          >
            <Search className="h-[17px] w-[17px] xl:h-[18px] xl:w-[18px]" />
          </button>
        )}

        <button
          type="button"
          onClick={onOpenMyList}
          title="Mi lista"
          aria-label="Mi lista"
          className="flex h-9 w-9 xl:h-10 xl:w-10 items-center justify-center rounded-full border border-fg/[0.08] bg-fg/[0.08] text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:bg-fg/[0.16] cursor-pointer"
        >
          <BookmarkPlus className="h-[17px] w-[17px] xl:h-[18px] xl:w-[18px]" />
        </button>

        <button
          type="button"
          onClick={onOpenAccount}
          title="Mi cuenta y ajustes"
          aria-label="Mi cuenta y ajustes"
          className="h-9 w-9 xl:h-10 xl:w-10 overflow-hidden rounded-full ring-1 ring-fg/20 transition hover:scale-105 hover:ring-fg/60 cursor-pointer"
        >
          <ProfileAvatar index={profile.avatarIndex} size={40} round className="h-full w-full" />
        </button>

        <span className="mx-1 hidden lg:inline-block h-5 w-px bg-fg/15 xl:mx-1.5" />

        <div className="hidden lg:flex shrink-0 items-center gap-2.5 text-fg">
          <Wifi className="h-[20px] w-[20px] shrink-0 text-fg/65" />
          <span className="font-display text-[18px] xl:text-[20px] font-semibold tracking-[-0.01em] whitespace-nowrap tabular-nums">
            {clock}
          </span>
        </div>
      </div>
    </nav>
  );
};
