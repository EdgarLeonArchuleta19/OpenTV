import type { AccentDef, CommunityPlugin, InstalledPlugin, M3uPlaylist } from '../types/models';

export const ACCENTS: AccentDef[] = [
  { id: 'white', label: 'Blanco', color: '#ffffff', ink: '#0e0e11' },
  { id: 'red', label: 'Rojo', color: '#e50914', ink: '#ffffff' },
  { id: 'blue', label: 'Azul', color: '#3b82f6', ink: '#ffffff' },
  { id: 'purple', label: 'Morado', color: '#8b5cf6', ink: '#ffffff' },
  { id: 'green', label: 'Verde', color: '#22c55e', ink: '#0e0e11' },
  { id: 'amber', label: 'Ámbar', color: '#f59e0b', ink: '#0e0e11' },
];

export const CINEMETA_URL = 'https://v3-cinemeta.strem.io/manifest.json';
export const KITSU_URL = 'https://anime-kitsu.strem.fun/manifest.json';
export const OPENSUBTITLES_URL = 'https://opensubtitles-v3.strem.io/manifest.json';

export const BUILTIN_PLUGINS: InstalledPlugin[] = [
  {
    id: 'default_cinemeta',
    name: 'Cinemeta',
    url: CINEMETA_URL,
    baseUrl: 'https://v3-cinemeta.strem.io',
    kind: 'stremio',
    description: 'Catálogo oficial de películas y series',
    logo: '',
    version: '3.0',
    builtin: true,
    disabled: false,
    allowLan: false,
    hasCatalog: true,
    hasStream: false,
    hasSubtitles: false,
    hasMeta: true,
    types: ['movie', 'series'],
    catalogs: [],
  },
  {
    id: 'default_kitsu',
    name: 'Anime Kitsu',
    url: KITSU_URL,
    baseUrl: 'https://anime-kitsu.strem.fun',
    kind: 'stremio',
    description: 'Catálogo de anime en emisión, populares y mejor valorados',
    logo: '',
    version: '1.0',
    builtin: true,
    disabled: false,
    allowLan: false,
    hasCatalog: true,
    hasStream: false,
    hasSubtitles: false,
    hasMeta: true,
    types: ['anime'],
    catalogs: [],
  },
  {
    id: 'default_opensubtitles',
    name: 'OpenSubtitles v3',
    url: OPENSUBTITLES_URL,
    baseUrl: 'https://opensubtitles-v3.strem.io',
    kind: 'stremio',
    description: 'Subtítulos automáticos en español y otros idiomas',
    logo: 'https://www.strem.io/images/addons/opensubtitles-logo.png',
    version: '3.0',
    builtin: true,
    disabled: false,
    allowLan: false,
    hasCatalog: false,
    hasStream: false,
    hasSubtitles: true,
    hasMeta: false,
    types: ['movie', 'series'],
    catalogs: [],
  },
];

export function stremioBaseFromUrl(url: string): string {
  return String(url || '')
    .trim()
    .replace(/^stremio:\/\//i, 'https://')
    .split('?')[0]
    .replace(/\/manifest\.json$/i, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

export function isBuiltinUrl(url: string): boolean {
  const base = stremioBaseFromUrl(url);
  return BUILTIN_PLUGINS.some((p) => stremioBaseFromUrl(p.url) === base);
}

export function seedBuiltinPlugins(current: InstalledPlugin[]): InstalledPlugin[] {
  const builtinByBase = new Map(BUILTIN_PLUGINS.map((b) => [stremioBaseFromUrl(b.url), b]));
  const list = current.map((p) => {
    const b = builtinByBase.get(stremioBaseFromUrl(p.url));
    // Built-in plugins keep their capabilities even if an old save lost them (e.g. OpenSubtitles without `hasSubtitles`).
    return b
      ? {
          ...p,
          builtin: true,
          disabled: false,
          logo: p.logo || b.logo,
          baseUrl: p.baseUrl || b.baseUrl,
          hasSubtitles: p.hasSubtitles || b.hasSubtitles,
          hasCatalog: p.hasCatalog || b.hasCatalog,
          hasMeta: p.hasMeta || b.hasMeta,
        }
      : p;
  });
  const seen = new Set(list.map((p) => stremioBaseFromUrl(p.url)));
  for (const b of BUILTIN_PLUGINS) {
    const base = stremioBaseFromUrl(b.url);
    if (!seen.has(base)) {
      if (b.id === 'default_kitsu') {
        const cinIdx = list.findIndex((x) => stremioBaseFromUrl(x.url) === stremioBaseFromUrl(CINEMETA_URL));
        list.splice(cinIdx >= 0 ? cinIdx + 1 : list.length, 0, b);
      } else {
        list.push(b);
      }
      seen.add(base);
    }
  }
  return list;
}

export const JS_PLUGIN_HOST_MAP: Record<string, string> = {
  'framextv.cc': 'baskettv23/Framextv',
  'framextv.xyz': 'syberia1/frametv',
  'gnulahd.nu': 'JuanDEVYT/GnulaHD_plugin',
  'latinomegahd.net': 'baskettv23/Latinomegahd',
  'pelispanda.org': 'baskettv23/Pelispanda',
  'pelispro.net': 'baskettv23/Pelispro',
  'sololatino.net': 'xuper-plugin/kino-plugin-sololatino',
  'cuevana3.eu': 'xuper-plugin/kino-plugin-cuevanapro',
  'cinehdplus.org': 'xuper-plugin/kino-plugin-cinehdplus',
  'pelispedia.is': 'xuper-plugin/kino-plugin-pelispedia',
  'serieskao.top': 'xuper-plugin/kino-plugin-serieskao',
  'fuegocine.com': 'JuanDEVYT/FuegoCine_plugin',
  'animeav1.com': 'LifReizei/K-Av1',
  'jkanime.net': 'Susejing/kino-plugin-Jkanime',
  'monoschinos.st': 'syberia1/MonosChinos',
  'latanime.org': 'sonny-debug12/latanime-kino',
  'doramasyt.com': 'xuper-plugin/kino-plugin-doramasyt',
  'mundodonghua.com': 'xuper-plugin/kino-plugin-mundodonghua',
  'lacartoons.com': 'xuper-plugin/kino-plugin-lacartoons',
  'area-documental.com': 'xuper-plugin/kino-plugin-areadocumental',
  'tvenvivo.org': 'xuper-plugin/kino-plugin-tvenvivo',
};

export const PRESET_M3U_LISTS: M3uPlaylist[] = [
  { id: 'pluto_mx', name: 'Pluto TV México y Latam', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_mx.m3u', description: '200+ canales gratis en español: cine, series, anime, deportes e infantil', enabled: true },
  { id: 'plex_mx', name: 'Plex TV en Español', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plex_mx.m3u', description: '270+ canales gratis 24/7 de películas, series, acción y documentales', enabled: true },
  { id: 'pluto_ar', name: 'Pluto TV Cono Sur', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_ar.m3u', description: '190+ canales gratis de películas, comedias y series en español', enabled: true },
  { id: 'es_tdt', name: 'TDTChannels España (Oficial)', url: 'https://www.tdtchannels.com/lists/tv.m3u8', description: 'Canales abiertos verificados con guía de programación', enabled: true },
  { id: 'samsung_es', name: 'Samsung TV Plus', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/samsungtvplus_es.m3u', description: '180+ canales continuos de cine, series, documentales y música', enabled: true },
  { id: 'pluto_es', name: 'Pluto TV España', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_es.m3u', description: '150+ canales gratis: cine, series, policiacas e infantil', enabled: true },
  { id: 'latam_spa', name: 'TV Abierta Hispana', url: 'https://iptv-org.github.io/iptv/languages/spa.m3u', description: 'Canales en español de México, Argentina, Colombia, Chile, Perú y más', enabled: true },
  { id: 'sports_iptv', name: 'Deportes en Vivo', url: 'https://iptv-org.github.io/iptv/categories/sports.m3u', description: 'Canales deportivos, fútbol y transmisiones en vivo', enabled: true },
  { id: 'movies_iptv', name: 'Cine y Series 24/7', url: 'https://iptv-org.github.io/iptv/categories/movies.m3u', description: 'Cine clásico, acción y canales continuos de películas', enabled: true },
  { id: 'kids', name: 'Infantil y Caricaturas', url: 'https://iptv-org.github.io/iptv/categories/kids.m3u', description: 'Canales de dibujos animados y programación familiar', enabled: true },
  { id: 'news', name: 'Noticias 24 Horas', url: 'https://iptv-org.github.io/iptv/categories/news.m3u', description: 'Noticieros en vivo en español e internacionales', enabled: true },
  { id: 'documentary', name: 'Documentales y Naturaleza', url: 'https://iptv-org.github.io/iptv/categories/documentary.m3u', description: 'Naturaleza, historia, ciencia y exploración', enabled: true },
  { id: 'mx', name: 'México (Canales Abiertos)', url: 'https://iptv-org.github.io/iptv/countries/mx.m3u', description: 'Canales nacionales y regionales de México', enabled: true },
];

export const COMMUNITY_PLUGINS: CommunityPlugin[] = [
  { id: 'torrentio', name: 'Torrentio', url: 'https://torrentio.strem.fun/manifest.json', description: 'El catálogo torrent más amplio con audio latino, castellano, 4K HDR y Dolby', category: 'torrents', kind: 'stremio', logo: 'https://torrentio.strem.fun/images/logo_v1.png', recommendedRank: 1 },
  { id: 'cuevana_pro', name: 'Cuevana Pro', url: 'https://raw.githubusercontent.com/xuper-plugin/kino-plugin-cuevanapro/HEAD/kino-plugin.json', description: 'Catálogo amplio de películas y series en español latino y subtitulado', category: 'directas', kind: 'kino-js', logo: 'https://raw.githubusercontent.com/xuper-plugin/kino-plugin-cuevanapro/HEAD/icon.png', recommendedRank: 2 },
  { id: 'pelispedia', name: 'Pelispedia', url: 'https://raw.githubusercontent.com/xuper-plugin/kino-plugin-pelispedia/HEAD/kino-plugin.json', description: 'Películas y series en español latino, castellano y subtitulado sin torrents', category: 'directas', kind: 'kino-js', logo: 'https://raw.githubusercontent.com/xuper-plugin/kino-plugin-pelispedia/HEAD/icon.png', recommendedRank: 3 },
  { id: 'framextv_plus', name: 'FrameXTV +', url: 'https://raw.githubusercontent.com/syberia1/frametv/HEAD/kino-plugin.json', description: 'Catálogo completo de FrameXTV en español latino, subtitulado y castellano', category: 'directas', kind: 'kino-js', logo: 'https://raw.githubusercontent.com/syberia1/frametv/HEAD/icon.png' },
  { id: 'cinehd_plus', name: 'CineHD Plus', url: 'https://raw.githubusercontent.com/xuper-plugin/kino-plugin-cinehdplus/HEAD/kino-plugin.json', description: 'Estrenos y series en HD en español latino y castellano', category: 'directas', kind: 'kino-js', logo: 'https://raw.githubusercontent.com/xuper-plugin/kino-plugin-cinehdplus/HEAD/icon.png' },
  { id: 'deepflix', name: 'DeepFlix', url: 'https://mg.homelabx.qzz.io/manifest.json', description: 'Películas y series en español latino por enlace directo, sin torrents', category: 'directas', kind: 'stremio' },
  { id: 'cncverse', name: 'CNCVerse', url: 'https://cncverse.dpdns.org/manifest.json', description: 'Catálogos y fuentes de películas y series por enlace directo HTTP', category: 'directas', kind: 'stremio', logo: 'https://raw.githubusercontent.com/NivinCNC/CNCVerse-Bridge/refs/heads/main/logo.png' },
  { id: 'torrentsdb', name: 'TorrentsDB', url: 'https://torrentsdb.com/manifest.json', description: 'Fuentes torrent sin debrid, con proveedores y estrenos en varios idiomas', category: 'torrents', kind: 'stremio', logo: 'https://torrentsdb.com/icon.svg' },
  { id: 'peerflix_es', name: 'Peerflix ES', url: 'https://addon.peerflix.mov/language=es,en/manifest.json', description: 'Películas y series con audio en español latino y castellano primero', category: 'torrents', kind: 'stremio', logo: 'https://peerflix.mov/static/logo.png' },
  { id: 'torrentclaw', name: 'TorrentClaw', url: 'https://torrentclaw.com/api/stremio/manifest.json', description: 'Más de 30 fuentes de películas y series con audio en español e inglés', category: 'torrents', kind: 'stremio', logo: 'https://torrentclaw.com/icon-512.png' },
  { id: 'streaming_catalogs', name: 'Streaming Catalogs', url: 'https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/manifest.json', description: 'Tendencias de Netflix, Max, Disney+, Prime Video y Apple TV+', category: 'catalogos', kind: 'stremio', logo: 'https://play-lh.googleusercontent.com/TBRwjS_qfJCSj1m7zZB93FnpJM5fSpMA_wUlFDLxWAb45T9RmwBvQd5cWR5viJJOhkI' },
  { id: 'imdb_catalogs', name: 'IMDb Catalogs', url: 'https://1fe84bc728af-imdb-catalogs.baby-beamup.club/manifest.json', description: 'Listas populares y mejor valoradas de películas y series de IMDb', category: 'catalogos', kind: 'stremio', logo: 'https://londonfeministfilmfestival.files.wordpress.com/2017/05/imdb-logo.png' },
  { id: 'subtitles_website', name: 'Subtitles Website', url: 'https://subtitles.website/stremio/manifest.json', description: 'Más de 630.000 subtítulos en español y otros idiomas', category: 'subtitulos', kind: 'stremio' },
  ...PRESET_M3U_LISTS.map((m): CommunityPlugin => ({
    id: `m3u_${m.id}`,
    name: m.name,
    url: m.url,
    description: m.description,
    category: ['pluto_mx', 'plex_mx', 'pluto_ar', 'samsung_es', 'pluto_es'].includes(m.id)
      ? 'gratis'
      : m.id === 'sports_iptv'
      ? 'deportes'
      : m.id === 'movies_iptv'
      ? 'cine'
      : m.id === 'kids'
      ? 'infantil'
      : m.id === 'news'
      ? 'noticias'
      : m.id === 'documentary'
      ? 'documentales'
      : 'paises',
    kind: 'm3u',
  })),
];

export const PLUGIN_CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'Todas' },
  { id: 'recomendados', label: 'Recomendados' },
  { id: 'directas', label: 'Fuentes directas' },
  { id: 'torrents', label: 'Torrents' },
  { id: 'catalogos', label: 'Catálogos' },
  { id: 'subtitulos', label: 'Subtítulos' },
  { id: 'gratis', label: 'Televisión gratis' },
  { id: 'deportes', label: 'Deportes en vivo' },
  { id: 'paises', label: 'TV por país' },
  { id: 'noticias', label: 'Noticias' },
  { id: 'infantil', label: 'Infantil' },
  { id: 'cine', label: 'Cine TV' },
  { id: 'documentales', label: 'Documentales' },
];
