import React, { useEffect, useState } from 'react';
import { COMMUNITY_PLUGINS, stremioBaseFromUrl } from '../services/catalogs';

const LOGO_CACHE_KEY = 'opentv_plugin_logos_v1';
const inflightUrls = new Set<string>();

function readLogoCache(): Record<string, string> {
  try {
    return (JSON.parse(localStorage.getItem(LOGO_CACHE_KEY) || '{}') as Record<string, string>) || {};
  } catch {
    return {};
  }
}

function writeLogoCache(url: string, logo: string): void {
  try {
    const all = readLogoCache();
    if (all[url] === logo) return;
    all[url] = logo;
    localStorage.setItem(LOGO_CACHE_KEY, JSON.stringify(all));
  } catch {
    // ignore quota errors
  }
}

function normalizeLogoUrl(raw: unknown, manifestUrl: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https:\/\//i.test(s)) return s;
  if (/^http:\/\//i.test(s)) return s.replace(/^http:\/\//i, 'https://');
  if (s.startsWith('//')) return `https:${s}`;
  const base = manifestUrl.replace(/\/(?:manifest|kino-plugin)\.json(\?.*)?$/i, '').replace(/\/$/, '');
  return `${base}/${s.replace(/^\//, '')}`;
}

function knownCommunityLogoFor(url: string): string {
  const base = stremioBaseFromUrl(url);
  const found = COMMUNITY_PLUGINS.find((c) => c.logo && stremioBaseFromUrl(c.url) === base);
  return found?.logo || '';
}

interface PluginIconProps {
  id?: string;
  name: string;
  url?: string;
  logo?: string;
  kind?: 'stremio' | 'kino-js' | 'm3u';
  category?: string;
  hasStream?: boolean;
  hasCatalog?: boolean;
  hasSubtitles?: boolean;
  dimmed?: boolean;
}

/**
 * Renders the official manifest logo of a plugin when available (pre-seeded or auto-fetched & cached),
 * and provides a crisp, distinct custom brand/category badge for every single plugin & M3U list
 * so no card falls back to a generic repeated puzzle icon.
 */
export const PluginIcon: React.FC<PluginIconProps> = ({
  id = '',
  name,
  url = '',
  logo = '',
  kind = 'stremio',
  category = '',
  hasStream = false,
  hasCatalog = false,
  hasSubtitles = false,
  dimmed = false,
}) => {
  const initialLogo = (() => {
    if (logo) return normalizeLogoUrl(logo, url);
    if (url) {
      const fromCommunity = knownCommunityLogoFor(url);
      if (fromCommunity) return fromCommunity;
      const cached = readLogoCache()[url];
      if (cached) return cached;
    }
    return '';
  })();

  const [resolvedLogo, setResolvedLogo] = useState<string>(initialLogo);
  const [imgFailed, setImgFailed] = useState<boolean>(false);

  useEffect(() => {
    setImgFailed(false);
    if (initialLogo) {
      setResolvedLogo(initialLogo);
      return;
    }
    // Auto-discover official logo from manifest.json / kino-plugin.json once per session
    if (!url || kind === 'm3u' || id === 'default_kitsu' || id === 'default_cinemeta') return;
    if (!/(?:manifest|kino-plugin)\.json/i.test(url)) return;
    const cached = readLogoCache();
    if (Object.prototype.hasOwnProperty.call(cached, url)) {
      if (cached[url]) setResolvedLogo(cached[url]);
      return;
    }
    if (inflightUrls.has(url)) return;
    inflightUrls.add(url);

    let alive = true;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((manifest: Record<string, unknown> | null) => {
        if (!manifest) return;
        const found = normalizeLogoUrl(manifest.logo || manifest.icon, url);
        writeLogoCache(url, found);
        if (alive && found) setResolvedLogo(found);
      })
      .catch(() => {
        // ignore offline/CORS failure and keep custom badge
      })
      .finally(() => {
        inflightUrls.delete(url);
      });
    return () => {
      alive = false;
    };
  }, [initialLogo, kind, url]);

  const dimCls = dimmed ? 'opacity-45' : '';

  if (resolvedLogo && !imgFailed) {
    return (
      <div
        className={`flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#1d1d24] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${dimCls}`}
      >
        <img
          src={resolvedLogo}
          alt={name}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setImgFailed(true)}
          className="h-full w-full rounded-[8px] object-contain"
        />
      </div>
    );
  }

  // Distinct brand / category vector badges for built-ins, community plugins without remote logos, and M3U lists
  const key = `${id} ${name} ${url} ${category}`.toLowerCase();

  // 1. Cinemeta (official Stremio purple film-clapper badge)
  if (key.includes('cinemeta')) {
    return (
      <div
        style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-[0_6px_18px_rgba(99,102,241,0.3)] ${dimCls}`}
      >
        <svg viewBox="0 0 32 32" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          <rect x="4.5" y="7" width="23" height="18" rx="3.5" />
          <path d="M9.5 7v18M22.5 7v18M4.5 12h5M4.5 16h5M4.5 20h5M22.5 12h5M22.5 16h5M22.5 20h5" />
          <path d="M14 13v6l5-3z" fill="currentColor" stroke="none" />
        </svg>
      </div>
    );
  }

  // 2. Anime Kitsu fallback (coral-orange fox/star badge)
  if (key.includes('kitsu') || key.includes('anime')) {
    return (
      <div
        style={{ background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)' }}
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-[0_6px_18px_rgba(249,115,22,0.3)] ${dimCls}`}
      >
        <svg viewBox="0 0 32 32" className="h-7 w-7" fill="currentColor">
          <path d="M7 7l6.5 4.8L16 9.5l2.5 2.3L25 7v9.5c0 4.8-4 8.5-9 8.5s-9-3.7-9-8.5V7zm5.5 10a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zm7 0a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z" />
        </svg>
      </div>
    );
  }

  // 3. OpenSubtitles / Subtitles Website (emerald-teal CC badge)
  if (key.includes('opensubtitles') || key.includes('subtit') || hasSubtitles || category === 'subtitulos') {
    return (
      <div
        style={{ background: 'linear-gradient(135deg, #10b981 0%, #0d9488 100%)' }}
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-[0_6px_18px_rgba(16,185,129,0.28)] ${dimCls}`}
      >
        <svg viewBox="0 0 32 32" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="7" width="24" height="18" rx="4" />
          <path d="M14 13.4a3.1 3.1 0 1 0 0 5.2M22.5 13.4a3.1 3.1 0 1 0 0 5.2" />
        </svg>
      </div>
    );
  }

  // 4. Pluto TV (iconic dark + yellow/cyan/magenta orbital brand dots)
  if (key.includes('pluto')) {
    return (
      <div
        style={{ background: 'linear-gradient(145deg, #17171d 0%, #0b0b0f 100%)' }}
        className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-[14px] border border-[#facc15]/30 shadow-[0_6px_18px_rgba(250,204,21,0.16)] ${dimCls}`}
      >
        <svg viewBox="0 0 40 40" className="h-9 w-9">
          <circle cx="11" cy="14" r="3.4" fill="#facc15" />
          <circle cx="20" cy="11" r="3.8" fill="#38bdf8" />
          <circle cx="29" cy="14" r="3.4" fill="#fb7185" />
          <text x="20" y="30" textAnchor="middle" fill="#ffffff" fontSize="11.5" fontWeight="800" fontFamily="Segoe UI, system-ui, sans-serif">
            pluto
          </text>
        </svg>
      </div>
    );
  }

  // 5. Plex TV (signature dark charcoal + golden-amber Plex chevron)
  if (key.includes('plex')) {
    return (
      <div
        style={{ background: 'linear-gradient(145deg, #1f1e1a 0%, #121214 100%)' }}
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] border border-[#e5a00d]/35 shadow-[0_6px_18px_rgba(229,160,13,0.18)] ${dimCls}`}
      >
        <svg viewBox="0 0 32 32" className="h-7 w-7">
          <path d="M11 6h6.5L24 16l-6.5 10H11l6.5-10L11 6z" fill="#e5a00d" />
        </svg>
      </div>
    );
  }

  // 6. Samsung TV Plus (royal Samsung blue with crisp TV+)
  if (key.includes('samsung')) {
    return (
      <div
        style={{ background: 'linear-gradient(135deg, #1428a0 0%, #2563eb 100%)' }}
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-[0_6px_18px_rgba(37,99,235,0.3)] ${dimCls}`}
      >
        <svg viewBox="0 0 40 40" className="h-9 w-9">
          <text x="18" y="25" textAnchor="middle" fill="#ffffff" fontSize="14.5" fontWeight="800" fontFamily="Segoe UI, system-ui, sans-serif">
            TV
          </text>
          <path d="M30 14v8M26 18h8" stroke="#60a5fa" strokeWidth="2.8" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  // 7. TDTChannels España (vibrant cyan-teal TDT broadcast badge)
  if (key.includes('tdt')) {
    return (
      <div
        style={{ background: 'linear-gradient(135deg, #0e7490 0%, #06b6d4 100%)' }}
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-[0_6px_18px_rgba(6,182,212,0.28)] ${dimCls}`}
      >
        <svg viewBox="0 0 40 40" className="h-9 w-9">
          <path d="M14 12a9 9 0 0 1 12 0M16.5 15.5a5 5 0 0 1 7 0" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2" strokeLinecap="round" />
          <text x="20" y="29" textAnchor="middle" fill="#ffffff" fontSize="12.5" fontWeight="800" fontFamily="Segoe UI, system-ui, sans-serif">
            TDT
          </text>
        </svg>
      </div>
    );
  }

  // 8. DeepFlix (crimson-violet DF play badge)
  if (key.includes('deepflix')) {
    return (
      <div
        style={{ background: 'linear-gradient(135deg, #e11d48 0%, #7c3aed 100%)' }}
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-[0_6px_18px_rgba(225,29,72,0.3)] ${dimCls}`}
      >
        <svg viewBox="0 0 36 36" className="h-8 w-8">
          <text x="18" y="23.5" textAnchor="middle" fill="#ffffff" fontSize="14.5" fontWeight="900" fontFamily="Segoe UI, system-ui, sans-serif">
            DF
          </text>
        </svg>
      </div>
    );
  }

  // 9. Deportes en Vivo (emerald soccer ball)
  if (category === 'deportes' || key.includes('sport') || key.includes('deport')) {
    return (
      <div
        style={{ background: 'linear-gradient(135deg, #16a34a 0%, #059669 100%)' }}
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-[0_6px_18px_rgba(22,163,74,0.28)] ${dimCls}`}
      >
        <svg viewBox="0 0 32 32" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
          <circle cx="16" cy="16" r="10.5" />
          <path d="m16 11.2 4.2 3-1.6 4.8h-5.2l-1.6-4.8zM16 11.2V5.5M20.2 14.2l5-1.5M18.6 19l3 4.4M13.4 19l-3 4.4M11.8 14.2l-5-1.5" />
        </svg>
      </div>
    );
  }

  // 10. Noticias 24 Horas (red-coral live news badge)
  if (category === 'noticias' || key.includes('news') || key.includes('notic')) {
    return (
      <div
        style={{ background: 'linear-gradient(135deg, #dc2626 0%, #ea580c 100%)' }}
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-[0_6px_18px_rgba(220,38,38,0.28)] ${dimCls}`}
      >
        <svg viewBox="0 0 32 32" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6.5 7h15v18H8.5a2 2 0 0 1-2-2z" />
          <path d="M21.5 12h4v11a2 2 0 0 1-2 2M10.5 12h7M10.5 16h7M10.5 20h4.5" />
        </svg>
      </div>
    );
  }

  // 11. Infantil y Caricaturas (warm gold-pink star badge)
  if (category === 'infantil' || key.includes('kids') || key.includes('infantil')) {
    return (
      <div
        style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #ec4899 100%)' }}
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-[0_6px_18px_rgba(245,158,11,0.28)] ${dimCls}`}
      >
        <svg viewBox="0 0 32 32" className="h-7 w-7" fill="currentColor">
          <path d="m16 5.5 3.2 6.6 7.3 1-5.3 5.1 1.3 7.3L16 22l-6.5 3.5 1.3-7.3-5.3-5.1 7.3-1z" />
        </svg>
      </div>
    );
  }

  // 12. Documentales y Naturaleza (teal-forest leaf badge)
  if (category === 'documentales' || key.includes('document')) {
    return (
      <div
        style={{ background: 'linear-gradient(135deg, #0d9488 0%, #15803d 100%)' }}
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-[0_6px_18px_rgba(13,148,136,0.28)] ${dimCls}`}
      >
        <svg viewBox="0 0 32 32" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 25c0-10 6-17 18.5-18-1 13-8 18.5-18.5 18.5" />
          <path d="M7 25 18.5 13.5" />
        </svg>
      </div>
    );
  }

  // 13. Cine y Series 24/7 / Catalogs (amber-crimson film badge)
  if (category === 'cine' || category === 'catalogos' || key.includes('movies_iptv') || hasCatalog) {
    return (
      <div
        style={{ background: 'linear-gradient(135deg, #d97706 0%, #b91c1c 100%)' }}
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-[0_6px_18px_rgba(217,119,6,0.28)] ${dimCls}`}
      >
        <svg viewBox="0 0 32 32" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
          <rect x="5" y="6.5" width="22" height="19" rx="3" />
          <path d="M10.5 6.5v19M21.5 6.5v19M5 11.5h5.5M5 16h5.5M5 20.5h5.5M21.5 11.5H27M21.5 16H27M21.5 20.5H27" />
        </svg>
      </div>
    );
  }

  // 14. México (tricolor accent broadcast emblem)
  if (id === 'm3u_mx' || id === 'mx' || key.includes('méxico (canales')) {
    return (
      <div
        style={{ background: 'linear-gradient(135deg, #15803d 0%, #1e293b 52%, #dc2626 100%)' }}
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-[0_6px_18px_rgba(21,128,61,0.25)] ${dimCls}`}
      >
        <svg viewBox="0 0 36 36" className="h-8 w-8">
          <text x="18" y="23.5" textAnchor="middle" fill="#ffffff" fontSize="14" fontWeight="800" fontFamily="Segoe UI, system-ui, sans-serif">
            MX
          </text>
        </svg>
      </div>
    );
  }

  // 15. TV por país / TV Abierta Hispana (indigo-sky broadcast globe)
  if (category === 'paises' || key.includes('latam') || key.includes('hispana')) {
    return (
      <div
        style={{ background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)' }}
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-[0_6px_18px_rgba(37,99,235,0.28)] ${dimCls}`}
      >
        <svg viewBox="0 0 32 32" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          <circle cx="16" cy="16" r="10.5" />
          <path d="M5.5 16h21M16 5.5c3 3.2 4.5 6.8 4.5 10.5S19 23.3 16 26.5c-3-3.2-4.5-6.8-4.5-10.5S13 8.7 16 5.5z" />
        </svg>
      </div>
    );
  }

  // 16. Generic M3U TV list
  if (kind === 'm3u' || category === 'gratis') {
    return (
      <div
        style={{ background: 'linear-gradient(135deg, #0284c7 0%, #4f46e5 100%)' }}
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-[0_6px_18px_rgba(2,132,199,0.28)] ${dimCls}`}
      >
        <svg viewBox="0 0 32 32" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4.5" y="9" width="23" height="15.5" rx="3" />
          <path d="m12 4.5 4 4.5 4-4.5M11.5 27.5h9" />
        </svg>
      </div>
    );
  }

  // 17. Stream / Torrent / Direct Source fallback
  return (
    <div
      style={{
        background: hasStream || category === 'torrents' || category === 'directas'
          ? 'linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)'
          : 'linear-gradient(135deg, #3f3f46 0%, #27272a 100%)',
      }}
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-[0_6px_18px_rgba(124,58,237,0.26)] ${dimCls}`}
    >
      <svg viewBox="0 0 32 32" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <circle cx="16" cy="16" r="10.5" />
        <path d="M13.5 11.5v9l7.5-4.5z" fill="currentColor" stroke="none" />
      </svg>
    </div>
  );
};
