/* core/state.js — Estado global de la app, perfil local (favoritos) y referencias a nodos del DOM.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ---------------------------------------------------------------- state */
var state = {
  screen: 'welcome',
  tab: 0,
  channel: 0,
  focus: null,
  detail: null,
  detailReturn: null,
  detailRange: 0,
  detailSeason: 0,
  detailNeedsRebuild: false,
  playerReturn: null,
  playerMode: 'live',
  playerItem: null,
  playerEpisode: null,
  playerSeasonIndex: 0,
  episodeBrowserOpen: false,
  categoryPickerOpen: false,
  browserSeason: 0,
  streamError: '',
  streamMode: 'normal',
  trackIndex: 0,
  channelsOpen: false,
  infobar: true,
  infoTimer: null,
  searchQuery: '',
  searchNumeric: false,
  searchSeq: 0,
  searchFocus: null,
  playback: {
    streamMode: 'normal',
    screen: 0,
    audio: 0,
    subLang: 0,
    size: 0,
    style: 0,
    subtitle: true
  },
  crOn: false,
  favs: {}
};

/* Desktop: the app opens on Inicio (the TV stays one tab away). */
if (window.XUPER_DESKTOP) {
  for (var startTab = 0; startTab < TABS.length; startTab++) {
    if (TABS[startTab].page === 1) { state.tab = startTab; break; }
  }
}

/* A profile belongs to this TV only: no registration, credentials or
   network account is required.  It intentionally stays small because old
   webOS models have limited persistent storage. */
var LOCAL_PROFILE_KEY = 'xuper_local_profile_v1';
var LOCAL_PLAYBACK_KEY = 'xuper_global_playback_v1';
var localProfile = { id: '', createdAt: 0, history: [] };

function safeLocalRead(key, fallback) {
  try {
    var raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (eRead) { return fallback; }
}

function safeLocalWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (eWrite) { /* storage unavailable */ }
}

function loadLocalProfile() {
  var savedPlayback = safeLocalRead(LOCAL_PLAYBACK_KEY, null);
  if (savedPlayback) {
    for (var pKey in state.playback) {
      if (state.playback.hasOwnProperty(pKey) && savedPlayback[pKey] !== undefined) {
        state.playback[pKey] = savedPlayback[pKey];
      }
    }
  }
  /* Desktop: Directo is the default. Older profiles saved Fluido globally;
     reset that once. Later choices in Ajustes are kept as usual. */
  if (window.XUPER_DESKTOP && !safeLocalRead('xuper_direct_default_v1', false)) {
    state.playback.streamMode = 'normal';
    safeLocalWrite(LOCAL_PLAYBACK_KEY, state.playback);
    safeLocalWrite('xuper_direct_default_v1', true);
  }
  var savedProfile = safeLocalRead(LOCAL_PROFILE_KEY, null);
  if (savedProfile && savedProfile.id) {
    localProfile = savedProfile;
    if (!localProfile.history || !localProfile.history.length) { localProfile.history = []; }
  } else {
    localProfile.id = 'TV-' + String(Date.now()).slice(-8);
    localProfile.createdAt = Date.now();
    safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
  }
  if (!localProfile.favs) { localProfile.favs = {}; }
  state.favs = localProfile.favs;
}

function saveGlobalPlayback() {
  safeLocalWrite(LOCAL_PLAYBACK_KEY, state.playback);
}

function toggleFavorite(item) {
  if (!item || !item.id) { return false; }
  var key = String(item.id);
  var on = !state.favs[key];
  if (on) { state.favs[key] = true; }
  else { delete state.favs[key]; }
  localProfile.favs = state.favs;
  safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
  return on;
}

loadLocalProfile();

var homeBuilt = false;
var pagesEl, pages = [], tabEls = [], notifyEl;
var liveRows = [], liveInfoText, liveMain, liveFocus, liveList;
var detailLeft, detailPlayer, detailButtons, detailBottom;
var searchKeyboard, searchHot, searchResults, searchEmpty, searchHotGrid,
    searchResultGrid, searchInput, searchNav, searchKeys = [];
var settingsMenu, settingsRight, settingsPanels = {}, settingsItems = [];
var historyViewTab = 'history';
var playerStage, playerInfo, playerChannels, playerVideo, playerFrame, playerStatus, nextEpisodeLoading, playerChannelRows = {};
/* Live category picker (all portal columns in one grid). */
var categoryPicker = null, pcatGrid = null, pcatSub = null;
/* Key of the category list currently painted in the rail, so switching a
   category only updates classes instead of rebuilding (and detaching) the
   focused pill. */
var renderedCategoryKey = '';
/* Older webOS models cannot keep a full 500–1000-row channel category in
   memory.  The side panel therefore owns only this small moving window. */
var LIVE_PANEL_WINDOW = 48;
var playerVodInfo, vodInfobarPoster, vodInfobarTitle, vodTimeCurrent, vodTimeTotal, vodSeekbar, vodSeekProgress, vodSeekBuffered, vodSeekThumb, playerOsdIcon;
var vodScrubbing = false, vodScrubTime = 0;
var welcomeTimer = null;
