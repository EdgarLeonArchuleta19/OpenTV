export type HomeTabId = 'live' | 'home' | 'movies' | 'series' | 'kids' | 'anime';

export interface MediaItem {
  id: string;
  type: 'movie' | 'series' | 'anime';
  title: string;
  originalTitle?: string;
  year: string;
  score: string;
  duration: string;
  genres: string[];
  synopsis: string;
  poster: string;
  backdrop: string;
  logo?: string;
  cast?: string[];
  director?: string;
  isAnime: boolean;
}

export interface Episode {
  id: string;
  season: number;
  number: number;
  title: string;
  overview: string;
  thumbnail: string;
  released: string;
  /** TMDB episode runtime in minutes (0/undefined = unknown); guards against wrong-content links. */
  runtimeMin?: number;
}

export interface TitleDetail {
  item: MediaItem;
  episodes: Episode[];
  seasons: number[];
  trailerYoutubeId?: string;
  related: MediaItem[];
  /** TMDB TV id when episodes come from TMDB: other seasons load on demand (`loadSeasonEpisodes`). */
  tmdbTvId?: string;
}

export interface StreamSource {
  id: string;
  addonId: string;
  addonName: string;
  name: string;
  title: string;
  url: string;
  infoHash: string;
  fileIdx?: number;
  filename: string;
  trackers: string[];
  headers: Record<string, string>;
  isJsPlugin?: boolean;
  quality: '4K' | '1080p' | '720p' | 'SD' | 'unknown';
  sizeBytes: number;
  seeders: number;
  langs: string[];
  isOriginal: boolean;
  isMulti: boolean;
  hasSubsEs: boolean;
  isCam: boolean;
  isHevc: boolean;
  isTenBit: boolean;
  isHdr: boolean;
  isRemux: boolean;
  isDts: boolean;
  isTrueHd: boolean;
  isEac3: boolean;
  isAtmos: boolean;
  isAv1: boolean;
  is3d: boolean;
  isMp4: boolean;
  provider: string;
  score: number;
}

export interface ExternalSubtitle {
  id: string;
  url: string;
  /** Original (non-proxied) URL, used as a fallback when the loopback proxy cannot fetch it. */
  directUrl?: string;
  lang: string;
  label: string;
  source: string;
  /** Where it comes from; drives the list order (see `orderSubtitles`). */
  origin?: SubtitleOrigin;
}

export type SubtitleOrigin = 'embedded' | 'local' | 'opensubtitles' | 'plugin' | 'subdl' | 'subtitlecat';

export interface PluginCatalogDef {
  type: string;
  id: string;
  name: string;
  supportsSearch: boolean;
  searchRequired: boolean;
  genres: string[];
}

export interface InstalledPlugin {
  id: string;
  name: string;
  url: string;
  baseUrl: string;
  kind: 'stremio' | 'kino-js';
  description: string;
  logo: string;
  version: string;
  builtin: boolean;
  disabled: boolean;
  allowLan: boolean;
  hasCatalog: boolean;
  hasStream: boolean;
  hasSubtitles: boolean;
  hasMeta: boolean;
  types: string[];
  catalogs: PluginCatalogDef[];
  rawRepoBase?: string;
}

export interface CommunityPlugin {
  id: string;
  name: string;
  url: string;
  description: string;
  category: string;
  kind: 'stremio' | 'kino-js' | 'm3u';
  logo?: string;
  recommendedRank?: number;
}

export interface M3uPlaylist {
  id: string;
  name: string;
  url: string;
  description: string;
  enabled: boolean;
  allowLan?: boolean;
}

export interface LiveChannel {
  id: string;
  name: string;
  url: string;
  logo: string;
  group: string;
  tvgId: string;
  tvgName: string;
  epgUrl: string;
  userAgent: string;
  referrer: string;
  playlistId: string;
  /** The playlist was allowed on the home network: its guide may be too. */
  allowLan?: boolean;
}

export interface EpgProgram {
  title: string;
  description: string;
  startMs: number;
  endMs: number;
}

export interface EpgNowNext {
  now?: EpgProgram;
  next?: EpgProgram;
}

export interface UserProfile {
  id: string;
  name: string;
  avatarIndex: number;
  avatarColor: string;
  kids: boolean;
}

export interface WatchProgress {
  itemId: string;
  type: 'movie' | 'series' | 'anime';
  title: string;
  poster: string;
  backdrop: string;
  season: number;
  episode: number;
  episodeTitle: string;
  positionMs: number;
  durationMs: number;
  updatedAt: number;
}

export interface SourcePrefs {
  langs: string[];
  quality: 'auto' | '4K' | '1080p' | '720p' | 'SD';
  exclude: string[];
  minSeeds: number;
  maxMovieGb: number;
  maxEpisodeGb: number;
  autoPlay: boolean;
  subsFrom: 'file' | 'addons' | 'fileOnly' | 'addonsOnly';
}

export interface AccentDef {
  id: string;
  label: string;
  color: string;
  ink: string;
}

export interface AppearancePrefs {
  /** 'dark' (default) or 'light'; the player stays dark in both. */
  theme: 'dark' | 'light';
  accentId: string;
  textLarge: boolean;
  uiDensity: 'normal' | 'compact';
  uiScale: 'normal' | 'compact' | 'xcompact';
  catalogLang: 'es' | 'en';
  liteMode: boolean;
}

export interface SubtitleStylePrefs {
  sizePx: number;
  color: string;
  bgAlpha: number;
  delayMs: number;
}

export interface PlaybackPrefs {
  autoNextEpisode: boolean;
  /** Skip the opening automatically when real timestamps exist (chapters / AniSkip / IntroDB). Off by default. */
  autoSkipIntro?: boolean;
  screenFormat: 'contain' | 'cover' | '16-9' | '4-3';
  preferredAudio: 'es' | 'pt' | 'en';
  subtitlesEnabled: boolean;
  preferredSubLang: 'es' | 'pt' | 'en';
  subtitleStyle: SubtitleStylePrefs;
}

export interface DownloadItem {
  id: string;
  title: string;
  subtitle: string;
  poster: string;
  status: 'queued' | 'downloading' | 'paused' | 'done' | 'error';
  bytes: number;
  total: number;
  speed: number;
  error?: string;
}

export interface CatalogRow {
  id: string;
  title: string;
  items: MediaItem[];
}

export interface ProfileBucket {
  myList: MediaItem[];
  favorites: MediaItem[];
  watchProgress: WatchProgress[];
  recentSearches: string[];
  favoriteChannelUrls: string[];
  recentChannels: LiveChannel[];
}

export interface UpdateStatus {
  state: 'idle' | 'available' | 'downloading' | 'ready' | 'installing' | 'up-to-date' | 'error';
  version?: string;
  available?: string | null;
  mandatory?: boolean;
  notes?: string;
  url?: string;
  downloadUrl?: string;
  bytes?: number;
  total?: number;
  progress?: number;
  error?: string;
}
