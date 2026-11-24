import { create } from 'zustand';
import type {
  AppearancePrefs,
  InstalledPlugin,
  LiveChannel,
  M3uPlaylist,
  MediaItem,
  PlaybackPrefs,
  ProfileBucket,
  SourcePrefs,
  UserProfile,
  WatchProgress,
} from '../types/models';
import { PRESET_M3U_LISTS, isBuiltinUrl, seedBuiltinPlugins, stremioBaseFromUrl } from '../services/catalogs';
import { desktopApi } from '../services/tauri';

const STORAGE_KEY = 'opentv_v2_state';

interface PersistedState {
  version: number;
  profiles: UserProfile[];
  activeProfileId: string;
  profileData: Record<string, ProfileBucket>;
  plugins: InstalledPlugin[];
  m3uPlaylists: M3uPlaylist[];
  sourcePrefs: SourcePrefs;
  appearance: AppearancePrefs;
  playback: PlaybackPrefs;
  parentalPin: string;
  parentalLocked: boolean;
  localFolders: string[];
}

const DEFAULT_BUCKET: ProfileBucket = {
  myList: [],
  favorites: [],
  watchProgress: [],
  recentSearches: [],
  favoriteChannelUrls: [],
  recentChannels: [],
};

function defaultState(): PersistedState {
  const pluto = PRESET_M3U_LISTS.find((p) => p.id === 'pluto_mx');
  return {
    version: 2,
    profiles: [
      { id: 'main', name: 'Mi usuario', avatarIndex: 0, avatarColor: '#3a7bff', kids: false },
      { id: 'kids', name: 'Kids', avatarIndex: 2, avatarColor: '#11998e', kids: true },
    ],
    activeProfileId: 'main',
    profileData: {},
    plugins: seedBuiltinPlugins([]),
    m3uPlaylists: pluto ? [pluto] : [],
    sourcePrefs: {
      langs: ['latino', 'castellano'],
      quality: 'auto',
      exclude: [],
      minSeeds: 0,
      maxMovieGb: 0,
      maxEpisodeGb: 0,
      autoPlay: true,
      subsFrom: 'file',
    },
    appearance: {
      accentId: 'white',
      textLarge: false,
      uiDensity: 'normal',
      uiScale: 'normal',
      catalogLang: 'es',
      liteMode: false,
    },
    playback: {
      autoNextEpisode: true,
      screenFormat: 'contain',
      preferredAudio: 'es',
      subtitlesEnabled: false,
      preferredSubLang: 'es',
      subtitleStyle: {
        sizePx: 22,
        color: '#ffffff',
        bgAlpha: 0.65,
        delayMs: 0,
      },
    },
    parentalPin: '',
    parentalLocked: false,
    localFolders: [],
  };
}

function normalizeProfile(p: Partial<UserProfile>, idx: number): UserProfile {
  return {
    id: String(p.id || `p_${idx}`),
    name: String(p.name || 'Mi usuario'),
    avatarIndex: typeof p.avatarIndex === 'number' ? p.avatarIndex : idx === 0 ? 0 : idx === 1 ? 2 : idx,
    avatarColor: String(p.avatarColor || '#3a7bff'),
    kids: Boolean(p.kids),
  };
}

function normalizeBucket(b: Partial<ProfileBucket> | undefined): ProfileBucket {
  return {
    myList: Array.isArray(b?.myList) ? b.myList : [],
    favorites: Array.isArray(b?.favorites) ? b.favorites : [],
    watchProgress: Array.isArray(b?.watchProgress) ? b.watchProgress : [],
    recentSearches: Array.isArray(b?.recentSearches) ? b.recentSearches : [],
    favoriteChannelUrls: Array.isArray(b?.favoriteChannelUrls) ? b.favoriteChannelUrls : [],
    recentChannels: Array.isArray(b?.recentChannels) ? b.recentChannels : [],
  };
}

function loadInitialState(): PersistedState {
  const base = defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      const profiles =
        Array.isArray(parsed.profiles) && parsed.profiles.length > 0
          ? parsed.profiles.map((p, i) => normalizeProfile(p, i))
          : base.profiles;
      const activeProfileId = profiles.some((p) => p.id === parsed.activeProfileId)
        ? parsed.activeProfileId!
        : profiles[0].id;
      const profileData: Record<string, ProfileBucket> = {};
      for (const [k, v] of Object.entries(parsed.profileData || {})) {
        profileData[k] = normalizeBucket(v);
      }
      return {
        ...base,
        ...parsed,
        profiles,
        activeProfileId,
        profileData,
        plugins: seedBuiltinPlugins(Array.isArray(parsed.plugins) ? parsed.plugins : []),
        m3uPlaylists: Array.isArray(parsed.m3uPlaylists) ? parsed.m3uPlaylists : base.m3uPlaylists,
        sourcePrefs: { ...base.sourcePrefs, ...(parsed.sourcePrefs || {}) },
        appearance: { ...base.appearance, ...(parsed.appearance || {}) },
        playback: {
          ...base.playback,
          ...(parsed.playback || {}),
          subtitleStyle: { ...base.playback.subtitleStyle, ...(parsed.playback?.subtitleStyle || {}) },
        },
        localFolders: Array.isArray(parsed.localFolders)
          ? parsed.localFolders.filter((d): d is string => typeof d === 'string' && d.trim().length > 0).slice(0, 20)
          : [],
      };
    }

    // Seamless one-time migration of legacy v1 storage keys
    const legacyVodRaw = localStorage.getItem('opentv_vod_sources_v1');
    if (legacyVodRaw) {
      const legacyVod = JSON.parse(legacyVodRaw) as { addons?: Array<Record<string, unknown>> };
      if (Array.isArray(legacyVod?.addons)) {
        const migrated: InstalledPlugin[] = legacyVod.addons
          .filter((a) => a && typeof a.url === 'string')
          .map((a) => ({
            id: String(a.id || stremioBaseFromUrl(String(a.url))),
            name: String(a.name || 'Plugin'),
            url: String(a.url),
            baseUrl: String(a.baseUrl || stremioBaseFromUrl(String(a.url))),
            kind: a.kind === 'kino-js' ? 'kino-js' : 'stremio',
            description: String(a.description || ''),
            logo: String(a.logo || ''),
            version: String(a.version || ''),
            builtin: isBuiltinUrl(String(a.url)),
            disabled: Boolean(a.disabled),
            allowLan: Boolean(a.allowLan),
            hasCatalog: true,
            hasStream: !isBuiltinUrl(String(a.url)),
            hasSubtitles: String(a.url).includes('subtitles'),
            hasMeta: true,
            types: ['movie', 'series'],
            catalogs: [],
          }));
        base.plugins = seedBuiltinPlugins(migrated);
      }
    }
    const legacyM3uRaw = localStorage.getItem('opentv_m3u_addons');
    if (legacyM3uRaw) {
      const legacyM3u = JSON.parse(legacyM3uRaw) as Array<Record<string, unknown>>;
      if (Array.isArray(legacyM3u) && legacyM3u.length > 0) {
        base.m3uPlaylists = legacyM3u
          .filter((x) => x && typeof x.url === 'string')
          .map((x, idx) => ({
            id: String(x.id || `m3u_${idx}`),
            name: String(x.name || 'Lista TV'),
            url: String(x.url),
            description: String(x.desc || x.description || ''),
            enabled: true,
          }));
      }
    }
  } catch {
    /* keep defaults */
  }
  return base;
}

let backupTimer: ReturnType<typeof setTimeout> | null = null;

function persist(next: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore storage quota */
  }
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    void desktopApi.backupWrite(next);
  }, 1200);
}

interface AppStore extends PersistedState {
  activeProfile: () => UserProfile;
  activeBucket: () => ProfileBucket;
  hasSourcePlugins: () => boolean;
  selectProfile: (id: string) => void;
  addProfile: (name: string, kids: boolean, avatarIndex: number) => void;
  updateProfile: (id: string, patch: Partial<Pick<UserProfile, 'name' | 'kids' | 'avatarIndex'>>) => void;
  removeProfile: (id: string) => void;
  toggleMyList: (item: MediaItem) => boolean;
  toggleFavorite: (item: MediaItem) => boolean;
  saveWatchProgress: (entry: Omit<WatchProgress, 'updatedAt'>) => void;
  removeWatchProgress: (itemId: string) => void;
  clearHistory: () => void;
  addRecentSearch: (query: string) => void;
  removeRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;
  toggleFavoriteChannel: (url: string) => boolean;
  recordRecentChannel: (ch: LiveChannel) => void;
  upsertPlugin: (plugin: InstalledPlugin) => void;
  togglePluginDisabled: (url: string) => void;
  removePlugin: (url: string) => void;
  setPluginAllowLan: (url: string, allow: boolean) => void;
  addM3uPlaylist: (pl: M3uPlaylist) => void;
  removeM3uPlaylist: (url: string) => void;
  updateSourcePrefs: (fn: (cur: SourcePrefs) => SourcePrefs) => void;
  updateAppearance: (fn: (cur: AppearancePrefs) => AppearancePrefs) => void;
  updatePlayback: (fn: (cur: PlaybackPrefs) => PlaybackPrefs) => void;
  setParental: (pin: string, locked: boolean) => void;
  addLocalFolder: (dir: string) => void;
  removeLocalFolder: (dir: string) => void;
  exportStateJson: () => string;
  importStateJson: (raw: string) => boolean;
}

function extractPersisted(s: AppStore): PersistedState {
  return {
    version: s.version,
    profiles: s.profiles,
    activeProfileId: s.activeProfileId,
    profileData: s.profileData,
    plugins: s.plugins,
    m3uPlaylists: s.m3uPlaylists,
    sourcePrefs: s.sourcePrefs,
    appearance: s.appearance,
    playback: s.playback,
    parentalPin: s.parentalPin,
    parentalLocked: s.parentalLocked,
    localFolders: s.localFolders,
  };
}

export const useAppStore = create<AppStore>((set, get) => {
  const initial = loadInitialState();

  const updateAndSave = (updater: (cur: PersistedState) => PersistedState) => {
    set((s) => {
      const next = updater(extractPersisted(s));
      // Keep the same array identity when plugins were not touched, so screens
      // depending on `plugins` (player subtitles, catalogs) do not refetch on every save.
      const plugins = next.plugins === s.plugins ? s.plugins : seedBuiltinPlugins(next.plugins);
      const safe = { ...next, plugins };
      persist(safe);
      return safe;
    });
  };

  const updateBucket = (updater: (b: ProfileBucket) => ProfileBucket) => {
    updateAndSave((s) => {
      const pid = s.activeProfileId;
      const cur = normalizeBucket(s.profileData[pid]);
      return {
        ...s,
        profileData: { ...s.profileData, [pid]: updater(cur) },
      };
    });
  };

  return {
    ...initial,
    activeProfile: () => {
      const s = get();
      return s.profiles.find((p) => p.id === s.activeProfileId) || s.profiles[0];
    },
    activeBucket: () => {
      const s = get();
      return normalizeBucket(s.profileData[s.activeProfileId] || DEFAULT_BUCKET);
    },
    hasSourcePlugins: () => get().plugins.some((p) => !p.disabled && (p.hasStream || p.kind === 'kino-js')),

    selectProfile: (id) =>
      updateAndSave((s) => (s.profiles.some((p) => p.id === id) ? { ...s, activeProfileId: id } : s)),

    addProfile: (name, kids, avatarIndex) => {
      const clean = name.trim().slice(0, 24);
      if (!clean) return;
      const id = `p_${Math.random().toString(36).slice(2, 10)}`;
      updateAndSave((s) => ({
        ...s,
        profiles: [...s.profiles, { id, name: clean, avatarIndex, avatarColor: '#3a7bff', kids }],
      }));
    },

    updateProfile: (id, patch) =>
      updateAndSave((s) => ({
        ...s,
        profiles: s.profiles.map((p) =>
          p.id === id
            ? {
                ...p,
                name: patch.name !== undefined ? patch.name.trim().slice(0, 24) || p.name : p.name,
                kids: patch.kids !== undefined && id !== 'main' ? patch.kids : p.kids,
                avatarIndex: patch.avatarIndex !== undefined ? patch.avatarIndex : p.avatarIndex,
              }
            : p,
        ),
      })),

    removeProfile: (id) => {
      if (id === 'main') return;
      updateAndSave((s) => {
        if (s.profiles.length <= 1) return s;
        const left = s.profiles.filter((p) => p.id !== id);
        const restData = { ...s.profileData };
        delete restData[id];
        return {
          ...s,
          profiles: left,
          activeProfileId: s.activeProfileId === id ? left[0].id : s.activeProfileId,
          profileData: restData,
        };
      });
    },

    toggleMyList: (item) => {
      let added = false;
      updateBucket((b) => {
        const exists = b.myList.some((x) => x.id === item.id);
        added = !exists;
        return {
          ...b,
          myList: exists ? b.myList.filter((x) => x.id !== item.id) : [item, ...b.myList].slice(0, 200),
        };
      });
      return added;
    },

    toggleFavorite: (item) => {
      let added = false;
      updateBucket((b) => {
        const exists = b.favorites.some((x) => x.id === item.id);
        added = !exists;
        return {
          ...b,
          favorites: exists ? b.favorites.filter((x) => x.id !== item.id) : [item, ...b.favorites].slice(0, 200),
        };
      });
      return added;
    },

    saveWatchProgress: (entry) => {
      // No-op when nothing actually advanced: the player saves on an interval
      // AND on unmount, and a blind write here would retrigger a rerender loop.
      const s = get();
      const cur = normalizeBucket(s.profileData[s.activeProfileId]);
      const existing = cur.watchProgress.find(
        (x) =>
          x.itemId === entry.itemId &&
          (entry.season === 0 || (x.season === entry.season && x.episode === entry.episode)),
      );
      if (
        existing &&
        Math.abs(existing.positionMs - entry.positionMs) < 1500 &&
        Math.abs(existing.durationMs - entry.durationMs) < 1500
      ) {
        return;
      }
      updateBucket((b) => {
        const filtered = b.watchProgress.filter(
          (x) =>
            !(x.itemId === entry.itemId && (entry.season === 0 || (x.season === entry.season && x.episode === entry.episode))),
        );
        return {
          ...b,
          watchProgress: [{ ...entry, updatedAt: Date.now() }, ...filtered].slice(0, 80),
        };
      });
    },

    removeWatchProgress: (itemId) =>
      updateBucket((b) => ({ ...b, watchProgress: b.watchProgress.filter((x) => x.itemId !== itemId) })),

    clearHistory: () => updateBucket((b) => ({ ...b, watchProgress: [] })),

    addRecentSearch: (query) => {
      const clean = query.trim();
      if (clean.length < 2) return;
      updateBucket((b) => ({
        ...b,
        recentSearches: [clean, ...b.recentSearches.filter((q) => q.toLowerCase() !== clean.toLowerCase())].slice(0, 8),
      }));
    },

    removeRecentSearch: (query) =>
      updateBucket((b) => ({
        ...b,
        recentSearches: b.recentSearches.filter((q) => q.toLowerCase() !== query.toLowerCase()),
      })),

    clearRecentSearches: () => updateBucket((b) => ({ ...b, recentSearches: [] })),

    toggleFavoriteChannel: (url) => {
      let fav = false;
      updateBucket((b) => {
        const exists = b.favoriteChannelUrls.includes(url);
        fav = !exists;
        return {
          ...b,
          favoriteChannelUrls: exists
            ? b.favoriteChannelUrls.filter((u) => u !== url)
            : [url, ...b.favoriteChannelUrls].slice(0, 200),
        };
      });
      return fav;
    },

    recordRecentChannel: (ch) =>
      updateBucket((b) => ({
        ...b,
        recentChannels: [ch, ...b.recentChannels.filter((x) => x.url !== ch.url)].slice(0, 20),
      })),

    upsertPlugin: (plugin) =>
      updateAndSave((s) => {
        const base = stremioBaseFromUrl(plugin.url);
        return {
          ...s,
          plugins: [...s.plugins.filter((p) => stremioBaseFromUrl(p.url) !== base), plugin],
        };
      }),

    togglePluginDisabled: (url) => {
      if (isBuiltinUrl(url)) return;
      const base = stremioBaseFromUrl(url);
      updateAndSave((s) => ({
        ...s,
        plugins: s.plugins.map((p) => (stremioBaseFromUrl(p.url) === base ? { ...p, disabled: !p.disabled } : p)),
      }));
    },

    removePlugin: (url) => {
      if (isBuiltinUrl(url)) return;
      const base = stremioBaseFromUrl(url);
      updateAndSave((s) => ({
        ...s,
        plugins: s.plugins.filter((p) => stremioBaseFromUrl(p.url) !== base),
      }));
    },

    setPluginAllowLan: (url, allow) => {
      const base = stremioBaseFromUrl(url);
      updateAndSave((s) => ({
        ...s,
        plugins: s.plugins.map((p) => (stremioBaseFromUrl(p.url) === base ? { ...p, allowLan: allow } : p)),
      }));
    },

    addM3uPlaylist: (pl) =>
      updateAndSave((s) => {
        if (s.m3uPlaylists.some((x) => x.url.toLowerCase() === pl.url.toLowerCase())) return s;
        return { ...s, m3uPlaylists: [...s.m3uPlaylists, pl] };
      }),

    removeM3uPlaylist: (url) =>
      updateAndSave((s) => ({
        ...s,
        m3uPlaylists: s.m3uPlaylists.filter((x) => x.url.toLowerCase() !== url.toLowerCase()),
      })),

    updateSourcePrefs: (fn) => updateAndSave((s) => ({ ...s, sourcePrefs: fn(s.sourcePrefs) })),
    updateAppearance: (fn) => updateAndSave((s) => ({ ...s, appearance: fn(s.appearance) })),
    updatePlayback: (fn) => updateAndSave((s) => ({ ...s, playback: fn(s.playback) })),
    setParental: (pin, locked) => updateAndSave((s) => ({ ...s, parentalPin: pin, parentalLocked: locked })),

    addLocalFolder: (dir) => {
      const clean = dir.trim();
      if (!clean) return;
      updateAndSave((s) => {
        if (s.localFolders.some((x) => x.toLowerCase() === clean.toLowerCase())) return s;
        return { ...s, localFolders: [...s.localFolders, clean].slice(0, 20) };
      });
    },

    removeLocalFolder: (dir) =>
      updateAndSave((s) => ({
        ...s,
        localFolders: s.localFolders.filter((x) => x.toLowerCase() !== dir.toLowerCase()),
      })),

    exportStateJson: () => JSON.stringify(extractPersisted(get()), null, 2),
    importStateJson: (raw) => {
      try {
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        if (!parsed || typeof parsed !== 'object') return false;
        updateAndSave((s) => ({
          ...s,
          ...parsed,
          profiles: Array.isArray(parsed.profiles)
            ? parsed.profiles.map((p, i) => normalizeProfile(p, i))
            : s.profiles,
          plugins: seedBuiltinPlugins(Array.isArray(parsed.plugins) ? parsed.plugins : s.plugins),
        }));
        return true;
      } catch {
        return false;
      }
    },
  };
});
