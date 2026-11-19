/* live/channels.js — TV en vivo: listas M3U, categorías, carga de canales y vista previa compartida con el reproductor.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* --- Live TV Categories & Addons (M3U / IPTV) --- */
var PRESET_ADDONS = [
  /* Free ad-supported (FAST) channels from Pluto TV, Plex, Samsung TV Plus,
     Tubi and Roku, as M3U lists rebuilt every day by
     github.com/BuddyChewChew/app-m3u-generator (from i.mjh.nz data).
     First, so "Buscar" shows them at the top. */
  { id: 'pluto_mx', name: 'Pluto TV México', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_mx.m3u', desc: '200+ canales gratis: películas, series, anime, deportes e infantil' },
  { id: 'pluto_ar', name: 'Pluto TV Argentina', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_ar.m3u', desc: '190+ canales gratis de películas y series en español' },
  { id: 'plex_mx', name: 'Plex México', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plex_mx.m3u', desc: '270+ canales gratis de películas, series y documentales' },
  { id: 'samsung_es', name: 'Samsung TV Plus España', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/samsungtvplus_es.m3u', desc: '180+ canales gratis: cine, series, documentales y música' },
  { id: 'pluto_es', name: 'Pluto TV España', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_es.m3u', desc: '150+ canales gratis: cine, series, policiacas e infantil' },
  { id: 'pluto_us', name: 'Pluto TV Estados Unidos', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_us.m3u', desc: 'Con una sección En Español; el resto en inglés' },
  { id: 'tubi_us', name: 'Tubi (EE. UU.)', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/tubi_all.m3u', desc: 'Canales en vivo de Tubi, en inglés: reality, comedia y deportes' },
  { id: 'roku_us', name: 'The Roku Channel (EE. UU.)', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/roku_all.m3u', desc: 'Canales en inglés: series, deportes y noticias' },
  /* Free-to-air channels from iptv-org. */
  {
    id: 'es_tdt',
    name: 'España - Canales Nacionales y TDT',
    url: 'https://iptv-org.github.io/iptv/countries/es.m3u',
    desc: '320+ canales: La 1, La 2, Antena 3, Telecinco, laSexta, autonómicas'
  },
  {
    id: 'latam_spa',
    name: 'Latinoamérica y Deportes (Hispano)',
    url: 'https://iptv-org.github.io/iptv/languages/spa.m3u',
    desc: 'Canales en español de Colombia, México, Argentina, Chile y Perú'
  },
  {
    id: 'sports_iptv',
    name: 'Deportes Internacionales',
    url: 'https://iptv-org.github.io/iptv/categories/sports.m3u',
    desc: 'Transmisiones deportivas y canales de competiciones'
  },
  {
    id: 'movies_iptv',
    name: 'Cine y Series 24/7',
    url: 'https://iptv-org.github.io/iptv/categories/movies.m3u',
    desc: 'Cine clásico, cine de acción y canales continuos de series'
  },
  /* More free lists from iptv-org, found with "Buscar" in Ajustes → Addons → TV en vivo. */
  { id: 'mx', name: 'México', url: 'https://iptv-org.github.io/iptv/countries/mx.m3u', desc: 'Canales abiertos y locales de México' },
  { id: 'ar', name: 'Argentina', url: 'https://iptv-org.github.io/iptv/countries/ar.m3u', desc: 'Canales abiertos y locales de Argentina' },
  { id: 'co', name: 'Colombia', url: 'https://iptv-org.github.io/iptv/countries/co.m3u', desc: 'Canales abiertos y locales de Colombia' },
  { id: 'cl', name: 'Chile', url: 'https://iptv-org.github.io/iptv/countries/cl.m3u', desc: 'Canales abiertos y locales de Chile' },
  { id: 'pe', name: 'Perú', url: 'https://iptv-org.github.io/iptv/countries/pe.m3u', desc: 'Canales abiertos y locales de Perú' },
  { id: 've', name: 'Venezuela', url: 'https://iptv-org.github.io/iptv/countries/ve.m3u', desc: 'Canales abiertos y locales de Venezuela' },
  { id: 'ec', name: 'Ecuador', url: 'https://iptv-org.github.io/iptv/countries/ec.m3u', desc: 'Canales abiertos y locales de Ecuador' },
  { id: 'us', name: 'Estados Unidos', url: 'https://iptv-org.github.io/iptv/countries/us.m3u', desc: 'Canales de EE. UU., muchos en inglés' },
  { id: 'news', name: 'Noticias', url: 'https://iptv-org.github.io/iptv/categories/news.m3u', desc: 'Canales de noticias de todo el mundo' },
  { id: 'kids', name: 'Infantil', url: 'https://iptv-org.github.io/iptv/categories/kids.m3u', desc: 'Dibujos y programas para niños' },
  { id: 'animation', name: 'Animación', url: 'https://iptv-org.github.io/iptv/categories/animation.m3u', desc: 'Canales de dibujos y anime' },
  { id: 'music', name: 'Música', url: 'https://iptv-org.github.io/iptv/categories/music.m3u', desc: 'Videoclips y radios con imagen' },
  { id: 'documentary', name: 'Documentales', url: 'https://iptv-org.github.io/iptv/categories/documentary.m3u', desc: 'Naturaleza, historia y ciencia' },
  { id: 'comedy', name: 'Comedia', url: 'https://iptv-org.github.io/iptv/categories/comedy.m3u', desc: 'Series y programas de humor' }
];

function getSavedAddons() {
  try {
    var raw = localStorage.getItem('opentv_m3u_addons');
    if (raw) {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) { return parsed; }
    }
  } catch (e) {}
  /* Default seed: España TDT so user has working external addon out of the box */
  var initial = PRESET_ADDONS.filter(function (p) { return p.id === 'es_tdt'; });
  try { localStorage.setItem('opentv_m3u_addons', JSON.stringify(initial)); } catch (e2) {}
  return initial;
}

function saveSavedAddons(list) {
  try { localStorage.setItem('opentv_m3u_addons', JSON.stringify(list || [])); } catch (e) {}
}

var liveCategories = [];
var currentLiveCategory = null;
var liveCategoriesLoaded = false;
var liveChannelsLoaded = false;
var liveChannelsLoading = false;
/* Home only keeps one muted live preview alive.  This warms the channel
   without creating a second full player or playing sound in the menu. */
var livePreviewVideo = null;
var livePreviewStatus = null;
var livePreviewSeq = 0;
var livePreviewTimer = null;
var livePreviewChannel = '';
var dialogAddonsOpen = false;

/* ------------------------------------------------------------------
   Desktop: the home TV preview and the full-screen TV player hand the same
   playing <video> to each other, so "Pantalla completa" and "Volver" do not
   reload the channel (the TV app used two separate players).
     type 'preview': the home preview element is shown inside the player;
     type 'player' : the player element is shown in the home preview.
   ------------------------------------------------------------------ */
var liveHandoff = null;
var livePreviewHls = null;
/* M3U channels are known by their link: their channelCode ('m3u_N') is only
   the position in one list and repeats between lists. */
function liveChannelKey(ch) { return ch ? (ch.streamUrl || ch.channelCode || '') : ''; }

function borrowPreviewIntoPlayer() {
  if (!window.OPENTV_DESKTOP || !livePreviewVideo || !playerStage || !liveMain || liveHandoff) { return false; }
  var ch = CHANNELS[state.channel];
  if (!liveMain.classList.contains('is-preview-playing') || !livePreviewChannel ||
      livePreviewChannel !== liveChannelKey(ch) || livePreviewVideo.paused) { return false; }
  if (livePreviewTimer) { clearTimeout(livePreviewTimer); livePreviewTimer = null; }
  playerStage.insertBefore(livePreviewVideo, playerVideo.nextSibling);
  livePreviewVideo.classList.add('is-handoff');
  if (playerFrame) { playerFrame.style.display = 'none'; }
  liveHandoff = { type: 'preview', key: livePreviewChannel };
  return true;
}

function returnPreviewHome() {
  if (!liveHandoff || liveHandoff.type !== 'preview') { return; }
  liveHandoff = null;
  livePreviewVideo.classList.remove('is-handoff');
  liveMain.insertBefore(livePreviewVideo, liveMain.firstChild);
}

function playerIsPlayingLive() {
  return state.playerMode === 'live' && playerVideo && !!playerVideo.currentSrc &&
    !playerVideo.paused && playerVideo.readyState >= 2;
}

function borrowPlayerIntoHome() {
  if (!window.OPENTV_DESKTOP || !liveMain || liveHandoff || !playerIsPlayingLive()) { return false; }
  stopLivePreview();
  liveMain.insertBefore(playerVideo, liveMain.firstChild);
  playerVideo.classList.add('is-handoff-home');
  playerVideo.muted = liveAudio.muted;
  livePreviewChannel = liveChannelKey(CHANNELS[state.channel]);
  liveMain.classList.remove('is-preview-loading');
  liveMain.classList.add('is-preview-playing');
  liveHandoff = { type: 'player', key: livePreviewChannel };
  return true;
}

/* Puts the player element back on the player stage; stops it unless the
   same channel is about to be shown full screen. */
function returnPlayerToStage(keepPlaying) {
  if (!liveHandoff || liveHandoff.type !== 'player') { return; }
  liveHandoff = null;
  playerVideo.classList.remove('is-handoff-home');
  playerVideo.muted = false;
  var anchor = playerStage.querySelector('.player-frame');
  playerStage.insertBefore(playerVideo, anchor ? anchor.nextSibling : playerStage.firstChild);
  if (liveMain) { liveMain.classList.remove('is-preview-playing'); }
  livePreviewChannel = '';
  if (!keepPlaying) { stopPlayerVideo(); }
}

function stopLivePreview() {
  if (liveHandoff && liveHandoff.type === 'preview') { returnPreviewHome(); }
  if (liveHandoff && liveHandoff.type === 'player') { returnPlayerToStage(false); }
  livePreviewSeq++;
  livePreviewChannel = '';
  if (livePreviewTimer) { clearTimeout(livePreviewTimer); livePreviewTimer = null; }
  if (liveMain) { liveMain.classList.remove('is-preview-playing', 'is-preview-loading'); }
  if (livePreviewStatus) { livePreviewStatus.textContent = ''; }
  if (!livePreviewVideo) { return; }
  if (livePreviewHls) { try { livePreviewHls.destroy(); } catch (eDestroy) { /* ignore */ } livePreviewHls = null; }
  try { livePreviewVideo.pause(); } catch (ePause) { /* ignore */ }
  livePreviewVideo.removeAttribute('src');
  try { livePreviewVideo.src = ''; livePreviewVideo.load(); } catch (eClear) { /* ignore */ }
}

function startLivePreview(ch) {
  if (!livePreviewVideo || !ch || !ch.streamUrl) { return; }
  /* A preview belongs only to the TV tab on the home screen. */
  if (state.screen !== 'home' || !onTvTab()) { return; }
  /* The full-screen player is already showing this channel here. */
  if (liveHandoff && liveHandoff.type === 'player') {
    if (liveHandoff.key === liveChannelKey(ch)) { return; }
    returnPlayerToStage(false);
  }
  var key = liveChannelKey(ch);
  if (key === livePreviewChannel && liveMain &&
      (liveMain.classList.contains('is-preview-loading') || liveMain.classList.contains('is-preview-playing'))) {
    return;
  }
  stopLivePreview();
  livePreviewChannel = key;
  noteLivePlaying(ch);
  var mySeq = ++livePreviewSeq;
  liveMain.classList.add('is-preview-loading');
  if (livePreviewStatus) { livePreviewStatus.textContent = 'Cargando ' + (ch.name || 'canal') + '…'; }
  /* An M3U channel plays its own link (no service round trip). */
  var url = ch.streamUrl;
  (function () {
    /* Playing: the "Cargando…" label goes. Android's native player sends
       loadeddata only for the first channel on this element, so playing and
       canplay clear it too (it stayed over the picture). */
    livePreviewVideo.onloadeddata = livePreviewVideo.onplaying = livePreviewVideo.oncanplay = function () {
      if (mySeq !== livePreviewSeq) { return; }
      liveMain.classList.remove('is-preview-loading');
      liveMain.classList.add('is-preview-playing');
      if (livePreviewStatus) { livePreviewStatus.textContent = ''; }
    };
    livePreviewVideo.onerror = function () {
      if (mySeq !== livePreviewSeq) { return; }
      liveMain.classList.remove('is-preview-loading', 'is-preview-playing');
      if (livePreviewStatus) { livePreviewStatus.textContent = ''; }
    };
    /* Desktop: play HLS with hls.js, like the full-screen player. Chromium's
       own HLS support rejects some channels (ECDF: error 4). */
    if (window.OPENTV_DESKTOP && !platformHas('native-player') && window.Hls && window.Hls.isSupported() && /\.m3u8(?:\?|$)/i.test(url)) {
      try {
        var hls = new window.Hls({ enableWorker: true, maxBufferLength: 20, backBufferLength: 10 });
        livePreviewHls = hls;
        hls.on(window.Hls.Events.MEDIA_ATTACHED, function () { hls.loadSource(url); });
        hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
          if (mySeq !== livePreviewSeq) { return; }
          var pp = livePreviewVideo.play();
          if (pp && pp.catch) { pp.catch(function () {}); }
        });
        hls.on(window.Hls.Events.ERROR, function (_, data) {
          if (!data || !data.fatal || mySeq !== livePreviewSeq) { return; }
          liveMain.classList.remove('is-preview-loading', 'is-preview-playing');
          if (livePreviewStatus) { livePreviewStatus.textContent = ''; }
        });
        hls.attachMedia(livePreviewVideo);
        return;
      } catch (eHls) { livePreviewHls = null; /* fall back to the native player */ }
    }
    try {
      livePreviewVideo.src = url;
      livePreviewVideo.load();
      var promise = livePreviewVideo.play();
      if (promise && promise.catch) { promise.catch(function () {}); }
    } catch (ePlay) { liveMain.classList.remove('is-preview-loading'); }
  })();
}

function scheduleLivePreview(ch) {
  if (livePreviewTimer) { clearTimeout(livePreviewTimer); }
  livePreviewTimer = setTimeout(function () {
    livePreviewTimer = null;
    startLivePreview(ch || CHANNELS[state.channel]);
  }, 220);
}

/* ------------------------------------------------------------------
   Loading. Every saved M3U list is downloaded once (service fetchM3u),
   merged into liveAllChannels and split into categories by group-title.
   Choosing a category only filters that list in memory (no network), so
   the 1 GB Fire TV does no extra work when the viewer changes category.
   ------------------------------------------------------------------ */
var LIVE_ALL_CATEGORY = { id: 'm3u:all', name: 'Todos', isAddon: true };
var liveAllChannels = [];
/* '' (not loaded yet), 'none' (no lists saved), 'failed' (no list could be
   read), 'ok' (at least one list answered). */
var liveListsStatus = '';
var liveListsLoadedKey = null;
var liveListsSeq = 0;
var liveListsWaiting = [];
currentLiveCategory = LIVE_ALL_CATEGORY;

/* group-title values of the free iptv-org lists come in English. */
var LIVE_GROUP_NAMES = {
  animation: 'Animación', auto: 'Motor', business: 'Negocios', classic: 'Clásicos', comedy: 'Comedia',
  cooking: 'Cocina', culture: 'Cultura', documentary: 'Documentales', education: 'Educación',
  entertainment: 'Entretenimiento', family: 'Familia', general: 'General', kids: 'Infantil',
  legislative: 'Legislativo', lifestyle: 'Estilo de vida', movies: 'Cine', music: 'Música', news: 'Noticias',
  outdoor: 'Aire libre', relax: 'Relax', religious: 'Religión', science: 'Ciencia', series: 'Series',
  shop: 'Compras', sports: 'Deportes', travel: 'Viajes', weather: 'Clima', public: 'Públicos',
  undefined: 'Otros', other: 'Otros', others: 'Otros', addon: 'Otros'
};

function liveListsKey(addons) {
  var key = '';
  for (var i = 0; i < addons.length; i++) { key += (addons[i] && addons[i].url) + '\n'; }
  return key;
}

function liveChannelGroups(ch) {
  var parts = String((ch && ch.group) || '').split(';');
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var g = parts[i].replace(/^\s+|\s+$/g, '');
    var known = LIVE_GROUP_NAMES[g.toLowerCase()];
    if (known) { g = known; }
    if (g && out.indexOf(g) === -1) { out.push(g); }
  }
  if (!out.length) { out.push('Otros'); }
  return out;
}

/* Favourites are kept by the channel's link; the old saved list (and its
   links) still marks the channels saved by earlier versions. */
function liveFavoriteUrls() {
  var set = {};
  var favs = liveSaved().favs;
  for (var i = 0; i < favs.length; i++) { if (favs[i] && favs[i].streamUrl) { set[favs[i].streamUrl] = true; } }
  return set;
}

/* Merges the answers of every list (in the order the lists were added):
   repeated links and adult groups are left out. */
function mergeLiveLists(results) {
  var seen = {};
  var favUrls = liveFavoriteUrls();
  var out = [];
  for (var r = 0; r < results.length; r++) {
    var list = results[r] || [];
    for (var c = 0; c < list.length; c++) {
      var ch = list[c];
      if (!ch || !ch.streamUrl || seen[ch.streamUrl]) { continue; }
      var groups = liveChannelGroups(ch);
      var adult = false;
      for (var g = 0; g < groups.length; g++) { if (isAdultCategory({ name: groups[g] })) { adult = true; break; } }
      if (adult) { continue; }
      seen[ch.streamUrl] = true;
      ch._groups = groups;
      ch.index = out.length + 1;
      if (!ch.now) { ch.now = 'En vivo'; }
      ch.fav = !!(favUrls[ch.streamUrl] || state.favs[liveFavKey(ch)]);
      out.push(ch);
    }
  }
  return out;
}

function buildLiveCategories(channels) {
  var byName = {};
  var cats = [];
  for (var i = 0; i < channels.length; i++) {
    var groups = channels[i]._groups || liveChannelGroups(channels[i]);
    for (var g = 0; g < groups.length; g++) {
      var cat = byName[groups[g]];
      if (!cat) {
        cat = { id: 'm3u:' + groups[g], name: groups[g], isAddon: true, channels: [] };
        byName[groups[g]] = cat;
        cats.push(cat);
      }
      cat.channels.push(channels[i]);
    }
  }
  cats.sort(function (a, b) {
    if (a.name === 'Otros') { return 1; }
    if (b.name === 'Otros') { return -1; }
    return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
  });
  /* One group holding every channel adds nothing next to Todos. */
  if (cats.length === 1 && cats[0].channels.length === channels.length) { cats = []; }
  return [LIVE_ALL_CATEGORY].concat(cats);
}

function liveCategoryChannels(cat) {
  if (!cat || cat.id === LIVE_ALL_CATEGORY.id) { return liveAllChannels; }
  for (var i = 0; i < liveCategories.length; i++) {
    if (liveCategories[i].id === cat.id) { return liveCategories[i].channels || []; }
  }
  return [];
}

/* The text shown where the channels go when there are none. */
function liveEmptyMessage() {
  if (currentLiveCategory && currentLiveCategory.isSaved === 'favs') {
    return platformIsTv()
      ? 'Aún no tienes canales favoritos. Usa el botón Favorito debajo de la vista previa de TV en vivo.'
      : 'Aún no tienes canales favoritos. Usa la estrella para guardar uno.';
  }
  if (currentLiveCategory && currentLiveCategory.isSaved === 'recent') { return 'Aquí aparecerán los últimos canales que veas.'; }
  if (liveChannelsPending()) { return 'Cargando canales…'; }
  if (liveListsStatus === 'none') {
    return 'Aún no tienes listas de TV en vivo. Agrega una lista M3U en Ajustes → Addons → TV en vivo.';
  }
  if (liveListsStatus === 'failed') {
    return 'No se pudieron cargar tus listas de TV en vivo. Revisa tu conexión o agrega otra lista M3U en Ajustes → Addons → TV en vivo.';
  }
  if (!liveAllChannels.length) {
    return 'Tus listas no tienen canales. Agrega otra lista M3U en Ajustes → Addons → TV en vivo.';
  }
  return 'No hay canales en esta categoría.';
}

/* True while the channel lists are still being read (and none is in yet). */
function liveChannelsPending() {
  return !liveChannelsLoaded || (liveChannelsLoading && !liveAllChannels.length);
}

/* True when the viewer needs to add (or fix) a list to see any channel. */
function liveNeedsLists() {
  return liveChannelsLoaded && !liveChannelsLoading && !liveAllChannels.length;
}

/* "Agregar lista M3U": opens Ajustes → Addons, where the TV lists are. */
function makeLiveListsButton() {
  var b = el('div', 'fx-btn live-add-lists focusable', 'Agregar lista M3U');
  b.style.display = 'inline-flex';
  b.style.marginTop = '24px';
  b._activate = function () {
    if (state.screen === 'player') { restorePlayerReturn(); }
    openSettingsAt('sources');
  };
  return b;
}

/* Shows one category of the loaded lists as the channel list. */
function showLiveCategory(cat, keepIndex) {
  var keep = livePlayingToKeep();
  var list = liveCategoryChannels(cat);
  var previous = state.channel;
  CHANNELS.splice(0, CHANNELS.length);
  for (var i = 0; i < list.length; i++) { CHANNELS.push(list[i]); }
  state.channel = keepIndex && previous > 0 && previous < CHANNELS.length ? previous : 0;
  var kept = keep && CHANNELS.length ? keepLivePlayingChannel(keep) : false;
  renderLiveRows(false);
  renderPlayerChannels();
  setLiveInfoText(CHANNELS[state.channel] ? CHANNELS[state.channel].name : '');
  syncLiveFavButton();
  if (!CHANNELS[state.channel]) { return; }
  if (state.screen === 'player' && state.playerMode === 'live') {
    updatePlayer();
    if (!kept) { startLiveChannel(CHANNELS[state.channel], true); }
  } else {
    scheduleLivePreview(CHANNELS[state.channel]);
  }
}

function switchLiveCategory(cat, done) {
  if (!cat) { return; }
  if (isAdultCategory(cat)) { return; }
  currentLiveCategory = cat;
  renderPlayerCategories();
  if (cat.isSaved) { loadSavedChannels(cat.isSaved, done); return; }
  /* The lists changed in Ajustes meanwhile: read them again first. */
  if (liveListsLoadedKey !== null && liveListsLoadedKey !== liveListsKey(getSavedAddons())) {
    reloadLiveLists(done);
    return;
  }
  if (!liveChannelsLoaded) { loadLiveChannels(done); return; }
  showLiveCategory(cat, false);
  if (done) { done(); }
}

/* Loads the viewer's lists once (boot, the TV page, the phone layout). Later
   calls only redraw, unless the saved lists changed since. */
function loadLiveChannels(done) {
  if (typeof done !== 'function') { done = null; }
  if (liveChannelsLoading) { if (done) { liveListsWaiting.push(done); } return; }
  if (liveChannelsLoaded && liveListsLoadedKey === liveListsKey(getSavedAddons())) {
    if (done) { done(); }
    return;
  }
  reloadLiveLists(done);
}

/* Reads every saved list again (a list was added or removed, "Actualizar"). */
function loadAddonChannels(done) { reloadLiveLists(done); }

function reloadLiveLists(done) {
  if (typeof done === 'function') { liveListsWaiting.push(done); }
  var addons = getSavedAddons();
  var seq = ++liveListsSeq;
  liveListsLoadedKey = liveListsKey(addons);
  liveChannelsLoading = true;
  if (!addons.length) { finishLiveLists(seq, [], 'none'); return; }
  if (!CHANNELS.length) { renderLiveRows(false); renderPlayerChannels(); }
  if (state.screen === 'player' && state.playerMode === 'live' && !CHANNELS.length) { setPlayerStatus('Cargando canales…'); }
  var results = [];
  var pending = addons.length;
  var answered = 0;
  for (var a = 0; a < addons.length; a++) {
    (function (idx, ad) {
      portalServiceCall('fetchM3u', { url: ad.url }, function (err, payload) {
        if (seq !== liveListsSeq) { return; }
        var chs = !err && payload && payload.channels ? payload.channels : [];
        if (chs.length) { answered++; }
        results[idx] = chs;
        pending--;
        if (pending > 0) { return; }
        /* Merging thousands of channels runs once, after the last answer. */
        finishLiveLists(seq, mergeLiveLists(results), answered ? 'ok' : 'failed');
      });
    })(a, addons[a]);
  }
}

/* Tests (window.__opentv.live.use): shows the given channels as if they came
   from the viewer's lists, without the network. */
function useLiveChannels(list) {
  var seq = ++liveListsSeq;
  liveListsLoadedKey = liveListsKey(getSavedAddons());
  liveChannelsLoading = true;
  finishLiveLists(seq, mergeLiveLists([list || []]), list && list.length ? 'ok' : 'none');
}

function finishLiveLists(seq, channels, status) {
  if (seq !== liveListsSeq) { return; }
  var firstLoad = !liveChannelsLoaded;
  liveAllChannels = channels;
  liveListsStatus = status;
  /* Now and next on each channel, from the lists' guides (live/epg.js). */
  loadLiveEpg(channels);
  liveCategories = buildLiveCategories(channels);
  liveCategoriesLoaded = true;
  liveChannelsLoading = false;
  liveChannelsLoaded = true;
  if (state.screen === 'player' && state.playerMode === 'live') { setPlayerStatus(''); }
  /* Stay on the same category if the new lists still have it. */
  var cur = currentLiveCategory;
  if (!cur || !cur.isSaved) {
    var found = LIVE_ALL_CATEGORY;
    for (var i = 0; cur && i < liveCategories.length; i++) {
      if (liveCategories[i].id === cur.id) { found = liveCategories[i]; break; }
    }
    currentLiveCategory = found;
    showLiveCategory(found, firstLoad);
    if (!CHANNELS.length && state.screen === 'player' && state.playerMode === 'live') { setPlayerStatus(liveEmptyMessage()); }
  }
  renderPlayerCategories();
  renderLiveDockCats();
  if (liveGuideOpen) { renderLiveGuideCats(); renderLiveGuideGrid(); }
  var waiting = liveListsWaiting;
  liveListsWaiting = [];
  for (var w = 0; w < waiting.length; w++) { waiting[w](); }
}

function renderLiveRows(favOnly) {
  if (!liveList) { return; }
  /* The remote was on a channel of the list: it stays on that channel's new
     row (the list is redrawn when the channels refresh). */
  var focusedChannel = state.focus && liveList.contains(state.focus) ? state.focus._channel : undefined;
  renderLiveRowsNow(favOnly);
  if (focusedChannel !== undefined && !liveList.contains(state.focus)) {
    var again = liveRows.filter(function (r) { return r._channel === focusedChannel; })[0] || liveRows[0];
    if (again) { setFocus(again, true); }
  }
}

function renderLiveRowsNow(favOnly) {
  var keepScroll = window.OPENTV_DESKTOP ? liveList.scrollTop : 0;
  clear(liveList);
  if (keepScroll) { setTimeout(function () { liveList.scrollTop = keepScroll; }, 0); }
  liveRows = [];
  if (!CHANNELS.length) {
    var saved = currentLiveCategory && currentLiveCategory.isSaved;
    if (liveChannelsPending() && !saved) {
      liveList.appendChild(makeLoader('Cargando canales…', 'is-list'));
      setLiveInfoText('');
      return;
    }
    var listStatus = el('div', 'live-list-status', liveEmptyMessage());
    /* No lists (or none could be read): a way to add one. */
    if (liveNeedsLists() && !saved) {
      listStatus.appendChild(document.createElement('br'));
      listStatus.appendChild(makeLiveListsButton());
    }
    liveList.appendChild(listStatus);
    setLiveInfoText('');
    return;
  }
  /* Desktop: the list can hold 1000+ channels. Drawing them all made every
     return to the home screen recompute ~7,500 elements (a visible stall),
     so rows are added in batches as the list scrolls (or as the current
     channel moves further down). */
  liveRowsFavOnly = !!favOnly;
  var hasQuery = !!(liveChannelQuery && norm(liveChannelQuery));
  var limit = (window.OPENTV_DESKTOP && !favOnly && !hasQuery)
    ? Math.min(CHANNELS.length, Math.max(LIVE_ROWS_BATCH, state.channel + (platformIsTv() ? 12 : 25)))
    : CHANNELS.length;
  appendLiveRows(limit);
  if (hasQuery && !liveRows.length) {
    liveList.appendChild(el('div', 'live-list-status', 'Sin canales para «' + liveChannelQuery.trim() + '»'));
  }
  if (CHANNELS[state.channel] && liveInfoText) {
    setLiveInfoText(CHANNELS[state.channel].name);
  }
  if (!hasQuery) { scrollLiveList(); }
  if (liveGuideOpen) { renderLiveGuideGrid(); }
}

/* TVs show bigger rows (about seven at a time): a smaller first batch makes
   TV en vivo quicker to open; more are added as the remote goes down. */
var LIVE_ROWS_BATCH = (typeof platformIsTv === 'function' && platformIsTv()) ? 24 : 60;
var liveRowsFavOnly = false;
var liveRowsShown = 0;
var liveChannelQuery = '';

function channelMatchesQuery(ch, index, query) {
  if (!query) { return true; }
  var q = norm(query);
  if (!q) { return true; }
  var name = norm((ch && ch.name) || '');
  var num = String((ch && ch.index) || (index + 1));
  var code = norm((ch && ch.channelCode) || '');
  return name.indexOf(q) !== -1 || num.indexOf(q) !== -1 || code.indexOf(q) !== -1;
}

function setLiveChannelQuery(val, sourceInput) {
  liveChannelQuery = String(val || '');
  var inputs = document.querySelectorAll('.csb-input');
  for (var i = 0; i < inputs.length; i++) {
    if (inputs[i] !== sourceInput && inputs[i].value !== liveChannelQuery) {
      inputs[i].value = liveChannelQuery;
    }
    if (inputs[i].parentNode) {
      inputs[i].parentNode.classList.toggle('has-text', !!liveChannelQuery);
    }
  }
  renderLiveRows(liveRowsFavOnly);
  if (playerChannels) { renderPlayerChannels(state.channel); }
}

function createChannelSearchBox(cls, placeholder) {
  var wrap = el('div', 'channel-search-box ' + (cls || ''));
  var ico = el('i', 'csb-icon');
  ico.innerHTML = UI_ICONS.search;
  var inp = document.createElement('input');
  inp.type = 'search';
  inp.className = 'csb-input';
  inp.placeholder = placeholder || 'Buscar canal…';
  inp.autocomplete = 'off';
  inp.spellcheck = false;
  inp.value = liveChannelQuery || '';
  var clr = el('button', 'csb-clear');
  clr.type = 'button';
  clr.innerHTML = UI_ICONS.close;
  clr.setAttribute('data-tip', 'Limpiar búsqueda');
  clr.setAttribute('aria-label', 'Limpiar búsqueda');
  wrap.classList.toggle('has-text', !!inp.value);
  inp.addEventListener('input', function () {
    setLiveChannelQuery(inp.value, inp);
  });
  inp.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (inp.value) {
        setLiveChannelQuery('', null);
      } else {
        inp.blur();
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      inp.blur();
      if (cls === 'is-player' && playerChannels) {
        var firstPc = playerChannels.querySelector('.pc-row');
        if (firstPc) { setFocus(firstPc); }
      } else if (liveRows && liveRows.length) {
        setFocus(liveRows[0]);
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (cls === 'is-player' && playerChannels) {
        var firstMatch = playerChannels.querySelector('.pc-row');
        if (firstMatch && firstMatch._activate) { firstMatch._activate(); }
      } else if (liveRows && liveRows.length && liveRows[0]._activate) {
        setChannel(liveRows[0]._channel, true);
      }
      return;
    }
    event.stopPropagation();
  });
  clr.addEventListener('click', function (event) {
    event.preventDefault();
    event.stopPropagation();
    setLiveChannelQuery('', null);
    inp.focus();
  });
  wrap.appendChild(ico);
  wrap.appendChild(inp);
  wrap.appendChild(clr);
  /* TVs, TV en vivo: the box is one focusable control; OK opens the
     on-screen keyboard (core/tv-keyboard.js) over the channel column, not
     the system keyboard. The list is filtered with its Buscar key. */
  if (cls === 'is-home' && platformIsTv()) {
    inp.readOnly = true;
    inp.tabIndex = -1;
    wrap.classList.add('focusable');
    wrap._activate = function () { openLiveSearchKeyboard(wrap); };
  }
  return wrap;
}

function openLiveSearchKeyboard(box) {
  var side = closest(box, '.live-side');
  var page = side && side.parentNode;
  if (!page) { return; }
  openTvKeyboardPanel(page, {
    placeholder: 'Nombre del canal',
    value: liveChannelQuery,
    cls: 'is-live',
    cover: side,
    doneLabel: 'Buscar',
    onDone: function (v) {
      setLiveChannelQuery(v, null);
      if (liveRows && liveRows.length) { setFocus(liveRows[0]); }
      else { setFocus(box); }
    }
  });
}

/* Renders channel rows up to (not including) index `upTo`. */
function appendLiveRows(upTo) {
  if (!liveList) { return; }
  if (window.OPENTV_DESKTOP && !liveList._lazyRows) {
    liveList._lazyRows = true;
    liveList.addEventListener('scroll', function () {
      if (liveRowsShown < CHANNELS.length && liveList.scrollTop + liveList.clientHeight > liveList.scrollHeight - 700) {
        appendLiveRows(liveRowsShown + LIVE_ROWS_BATCH);
      }
    }, { passive: true });
  }
  if (!liveRows.length) { liveRowsShown = 0; }
  var frag = document.createDocumentFragment();
  for (var i = liveRowsShown; i < Math.min(upTo, CHANNELS.length); i++) {
    if (liveRowsFavOnly && !CHANNELS[i].fav) { continue; }
    if (liveChannelQuery && !channelMatchesQuery(CHANNELS[i], i, liveChannelQuery)) { continue; }
    var row = makeLiveRow(i);
    frag.appendChild(row);
    liveRows.push(row);
  }
  liveRowsShown = Math.max(liveRowsShown, Math.min(upTo, CHANNELS.length));
  liveList.appendChild(frag);
}

function ensureLiveRowsUpTo(index) {
  if (window.OPENTV_DESKTOP && liveRowsShown < CHANNELS.length && index >= liveRowsShown - 5) {
    appendLiveRows(Math.min(CHANNELS.length, index + LIVE_ROWS_BATCH));
  }
}

function makeLiveRow(i) {
  var row = el('div', 'live-row focusable');
  row._channel = i;
  var icon = el('div', 'row-icon');
  if (CHANNELS[i].logo) {
    icon.style.backgroundImage = 'url(' + CHANNELS[i].logo + ')';
    icon.style.backgroundSize = 'contain';
    icon.style.backgroundRepeat = 'no-repeat';
    icon.style.backgroundPosition = 'center';
  }
  var play = el('div', 'row-play');
  var name = el('div', 'row-name', CHANNELS[i].name);
  /* PC: number, logo, then the name with its category under it. */
  if (typeof liveSideLayout === 'function' && liveSideLayout()) {
    row.appendChild(el('div', 'row-num', String(i + 1)));
    row.appendChild(icon);
    var rowText = el('div', 'row-text');
    rowText.appendChild(name);
    rowText.appendChild(el('div', 'row-sub', liveChannelGroups(CHANNELS[i]).join(', ')));
    row.appendChild(rowText);
  } else {
    row.appendChild(icon);
    row.appendChild(play);
    row.appendChild(name);
  }
  if (i === state.channel) { row.classList.add('is-current'); }
  if (CHANNELS[i]._keptPlaying) { row.classList.add('is-kept'); row.title = 'En reproducción (de otra categoría)'; }
  row._activate = (function (idx) {
    return function () {
      if (window.OPENTV_DESKTOP) {
        /* Desktop: a click only switches the home preview. Enter on the
           channel already playing (keyboard) opens it big. */
        if (idx === state.channel) { if (focusRingVisible) { openPlayer('live'); } return; }
        setChannel(idx, true);
        return;
      }
      setChannel(idx, true); openPlayer('live');
    };
  })(i);
  if (window.OPENTV_DESKTOP) {
    (function (idx, r) {
      r.addEventListener('dblclick', function () { setChannel(idx, true); openPlayer('live'); });
      var open = el('button', 'row-open');
      open.type = 'button';
      open.innerHTML = UI_ICONS.fullscreen;
      open.setAttribute('data-tip', 'Ver en pantalla grande');
      open.setAttribute('aria-label', 'Ver ' + (CHANNELS[idx].name || 'canal') + ' en pantalla grande');
      open.addEventListener('click', function (event) {
        event.stopPropagation();
        setChannel(idx, true);
        openPlayer('live');
      });
      r.appendChild(open);
      r.setAttribute('data-tip', 'Clic: ver aquí · Doble clic: pantalla grande');
    })(i, row);
  }
  row._onMove = (function (rowIdx) {
    return function (dir) {
      /* Design "3A": the video is on the right of the list; on a TV, left
         goes to the menu. */
      var side = typeof liveSideLayout === 'function' && liveSideLayout();
      if (dir === (side ? 'right' : 'left')) {
        if (liveFocus) { setFocus(liveFocus); }
        else if (tabEls[0]) { setFocus(tabEls[0]); }
        return true;
      }
      if (side && dir === 'left') {
        if (platformIsTv() && tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
        return true;
      }
      if (dir === 'up') {
        var catBtn = side && liveDockCats ? liveDockCats.querySelector('.live-cat-btn') : null;
        if (rowIdx > 0 && liveRows[rowIdx - 1]) {
          setFocus(liveRows[rowIdx - 1]);
        } else if (catBtn) {
          setFocus(catBtn);
        } else {
          /* From the first channel: up to Buscar, Mi lista and the profile. */
          focusHomeTopIcons();
        }
        return true;
      }
      if (dir === 'down') {
        if (rowIdx >= liveRows.length - 2) { ensureLiveRowsUpTo(liveRows[rowIdx]._channel + 1); }
        if (rowIdx < liveRows.length - 1 && liveRows[rowIdx + 1]) {
          setFocus(liveRows[rowIdx + 1]);
        }
        return true;
      }
      return false;
    };
  })(liveRows.length);
  return row;
}

/* The round icons at the top of the home screen (Buscar first). */
function focusHomeTopIcons() {
  var bar = $('home-notify');
  if (!bar) { return false; }
  var first = bar.querySelector('.notify-item.search') || firstIn(bar);
  if (first && isVisible(first)) { setFocus(first); return true; }
  return false;
}

function scrollLiveList() {
  ensureLiveRowsUpTo(state.channel);
  if (!liveRows.length) { return; }
  var visible = liveRows.filter(function (r) { return r._channel === state.channel; })[0];
  if (!visible) { return; }
  var idx = liveRows.indexOf(visible);
  var top = idx * 120;
  var max = Math.max(0, liveList.scrollHeight - liveList.clientHeight);
  var target = liveList.scrollTop;
  if (top < target) { target = top; }
  if (top + 100.5 > target + liveList.clientHeight) {
    target = top + 100.5 - liveList.clientHeight;
  }
  liveList.scrollTop = Math.max(0, Math.min(max, target));
}

function setChannel(index, immediate) {
  /* Arrow keys before the list has loaded must not leave channel -1. */
  if (!CHANNELS.length) { return; }
  if (index < 0) { index = 0; }
  if (index > CHANNELS.length - 1) { index = CHANNELS.length - 1; }
  state.channel = index;
  for (var i = 0; i < liveRows.length; i++) {
    liveRows[i].classList.toggle('is-current', liveRows[i]._channel === index);
  }
  if (CHANNELS[index] && liveInfoText) {
    setLiveInfoText(CHANNELS[index].name);
  }
  scrollLiveList();
  syncLiveFavButton();
  if (window.OPENTV_DESKTOP && CHANNELS[index]) { rememberLiveChannel(CHANNELS[index]); updateTitleBarSection(); }
  if (state.screen === 'player') {
    updatePlayerChannel();
    if (state.playerMode === 'live') {
      startLiveChannel(CHANNELS[index], !!immediate);
    }
  } else if (state.screen === 'home' && onTvTab()) {
    scheduleLivePreview(CHANNELS[index]);
  }
}
