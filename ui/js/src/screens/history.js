/* screens/history.js — Mi lista: Historial (lo que dejaste a medias), Mi lista
   (para ver después) y Mis favoritos; página en Ajustes y panel lateral (Ctrl+J).
   Parte del módulo único de la app (ver ui/js/src/README.md). */

var LIBRARY_TABS = [
  { id: 'history', label: 'Historial' },
  { id: 'mylist', label: 'Mi lista' },
  { id: 'favs', label: 'Mis favoritos' }
];

var LIBRARY_EMPTY = {
  history: 'No tienes nada sin terminar. Lo que empieces a ver aparecerá aquí para seguir donde lo dejaste.',
  mylist: 'Tu lista está vacía. Pulsa el icono de Mi lista en una película o serie para guardarla y verla después.',
  favs: 'Todavía no tienes favoritos. Pulsa el corazón en una película o serie para guardarla aquí.'
};

/* Titles from addons (Stremio, PC) show only in that mode, the rest only in
   the automatic one: the same rule as "Seguir viendo". */
function libraryModeMatches(id, stremio) {
  var fromAddon = !!stremio || String(id).indexOf('stremio:') === 0;
  var manual = typeof stremioModeOn === 'function' && stremioModeOn();
  return manual ? fromAddon : !fromAddon;
}

function historyStarted(id) {
  var list = localProfile.history || [];
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].id) === String(id) && (list[i].position || 0) >= 5) { return true; }
  }
  return false;
}

/* What each tab lists, as history-like records (newest first):
   - history: started and not finished (a series stays until it is dropped);
   - mylist:  saved to watch later and not started yet (once started it is
              under Historial);
   - favs:    favourites (TV channels have their own list in the guide). */
function libraryRecords(tab) {
  if (tab === 'history') {
    return (localProfile.history || []).filter(function (r) {
      if (!r || !r.id || r.hideContinue || (r.position || 0) < 5) { return false; }
      if (!r.series && r.duration && r.position / r.duration > 0.95) { return false; }
      return !!vodForHistoryRecord(r);
    });
  }
  var store = (tab === 'mylist' ? state.mylist : state.favs) || {};
  var out = [];
  for (var id in store) {
    if (!Object.prototype.hasOwnProperty.call(store, id) || !store[id] || id.indexOf('live:') === 0) { continue; }
    var snap = typeof store[id] === 'object' ? store[id] : null;
    var item = vodById(id);
    if (!item && !snap) { continue; }
    var stremio = snap ? !!snap.stremio : !!item._stremio;
    if (!libraryModeMatches(id, stremio)) { continue; }
    if (tab === 'mylist' && historyStarted(id)) { continue; }
    out.push({
      id: id,
      title: (item && item.title) || (snap && snap.title) || 'Contenido',
      poster: (item && (item.poster || item.cover)) || (snap && snap.poster) || '',
      series: item ? !!isSeriesItem(item) : !!(snap && snap.series),
      stremio: stremio,
      stremioBase: (snap && snap.stremioBase) || (item && item._stremioBase) || '',
      at: (snap && snap.at) || 0,
      saved: tab
    });
  }
  out.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
  return out;
}

/* The title behind a record, to open its details (the phone layout opens
   its own page; openHistoryRecord does the same for the other layouts). */
function libraryItem(record) {
  var item = vodById(record.id);
  if (item) { return item; }
  if (record.stremio || String(record.id).indexOf('stremio:') === 0) { return stremioItemFromHistory(record); }
  if (record.position) { return vodForHistoryRecord(record) || null; }
  var recovered = normalizeVod({ id: record.id, title: record.title, poster: record.poster,
    type: record.series ? 'teleplay' : 'movie', portal: true }, 0);
  recovered._portal = true;
  return recovered;
}

/* Taking a title out of Seguir viendo / Historial forgets it completely, as
   if it had never been watched: where it was left (and the episode), the
   source and addon chosen for it and its episodes (Modo Addons), and the
   subtitles and audio details kept for this session. Mi lista and
   favourites stay. */
function forgetWatchedTitle(id) {
  var key = String(id);
  localProfile.history = (localProfile.history || []).filter(function (h) { return String(h.id) !== key; });
  safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
  /* Sources picked in Modo Addons: the movie's, or every episode's
     ('tt123:1:4' for the series 'tt123'). */
  var raw = key.replace(/^stremio:/, '');
  try {
    var picks = JSON.parse(localStorage.getItem(STREMIO_PICKS_KEY) || '{}') || {};
    var changed = false;
    for (var p in picks) {
      if (Object.prototype.hasOwnProperty.call(picks, p) && (p === raw || p.indexOf(raw + ':') === 0)) { delete picks[p]; changed = true; }
    }
    if (changed) { localStorage.setItem(STREMIO_PICKS_KEY, JSON.stringify(picks)); }
  } catch (ePicks) { /* storage off */ }
  /* This session's copies (the loaded title and its episodes). */
  var item = typeof vodById === 'function' ? vodById(key) : null;
  var targets = item ? [item].concat(item.episodes || []) : [];
  for (var t = 0; t < targets.length; t++) {
    var x = targets[t];
    if (!x) { continue; }
    x._stremioSource = null;
    x._stremioNoCopy = false;
    x._stremioRelayCopy = false;
    if (x._stremio || item._stremio) { x.subtitles = []; }
    if (x.id !== undefined) { delete mediaInfoCache[String(x.id)]; }
  }
  if (item) { delete mediaInfoCache[mediaInfoKey(item)]; delete smoothModeByTitle[smoothModeKey(item)]; }
  if (typeof refreshContinueRows === 'function') { refreshContinueRows(); }
}

/* "Borrar historial": every title forgotten the same way, and every source
   chosen in Modo Addons with them. */
function forgetAllWatched() {
  var ids = (localProfile.history || []).map(function (h) { return h.id; });
  for (var i = 0; i < ids.length; i++) { forgetWatchedTitle(ids[i]); }
  localProfile.history = [];
  safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
  try { localStorage.removeItem(STREMIO_PICKS_KEY); } catch (eAll) { /* storage off */ }
  if (typeof refreshContinueRows === 'function') { refreshContinueRows(); }
}

function removeLibraryRecord(tab, record) {
  if (tab === 'history') {
    forgetWatchedTitle(record.id);
    return;
  } else if (tab === 'mylist') {
    delete state.mylist[record.id];
    localProfile.mylist = state.mylist;
  } else {
    delete state.favs[record.id];
    localProfile.favs = state.favs;
  }
  safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
}

function historyRecordLine(record) {
  var pos = Math.max(0, record.position || 0);
  var dur = Math.max(0, record.duration || 0);
  var pct = dur > 0 ? Math.min(100, Math.round(pos / dur * 100)) : 0;
  var left = dur > pos ? Math.max(1, Math.round((dur - pos) / 60)) : 0;
  var line = record.series
    ? ('Ep. ' + (record.episodeNumber || '?') + (left ? ' · quedan ' + left + ' min' : ''))
    : (left ? ('Quedan ' + left + ' min') : (pos ? ('Vas por ' + Math.max(1, Math.round(pos / 60)) + ' min') : ''));
  if (pct >= 95) { line = record.series ? ('Ep. ' + (record.episodeNumber || '?') + ' · terminado') : 'Terminada'; }
  return { line: line, pct: pct };
}

var REMOVE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>';

/* ------------------------------------------------------------------
   Desktop: the same three tabs as a panel sliding in from the left (Ctrl+J),
   over the current screen; closing it returns exactly where the viewer was.
   ------------------------------------------------------------------ */
var historyDrawerOpen = false;
var historyDrawer = null, historyDrawerList = null, historyDrawerBackdrop = null;
var historyDrawerTab = 'history';
var historyDrawerReturnFocus = null;

function buildHistoryDrawer() {
  historyDrawerBackdrop = el('div', 'history-drawer-backdrop');
  historyDrawerBackdrop.addEventListener('click', function (event) {
    event.stopPropagation();
    closeHistoryDrawer();
  });
  historyDrawer = el('aside', 'history-drawer');
  historyDrawer.setAttribute('role', 'dialog');
  historyDrawer.setAttribute('aria-label', 'Mi lista');
  var head = el('div', 'hd-head');
  var tabs = el('div', 'hd-tabs');
  LIBRARY_TABS.forEach(function (t) {
    var tab = el('div', 'hd-tab focusable', t.label);
    tab._hdTab = t.id;
    tab._activate = function () { historyDrawerTab = t.id; renderHistoryDrawer(); setFocus(tab); };
    tabs.appendChild(tab);
  });
  head.appendChild(tabs);
  var close = el('div', 'hd-close focusable');
  close.title = 'Cerrar (Esc)';
  close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  close._activate = closeHistoryDrawer;
  head.appendChild(close);
  historyDrawer.appendChild(head);
  historyDrawerList = el('div', 'hd-list scrollable');
  historyDrawer.appendChild(historyDrawerList);
  document.body.appendChild(historyDrawerBackdrop);
  document.body.appendChild(historyDrawer);
}

function renderHistoryDrawer() {
  if (!historyDrawer) { return; }
  var tabs = historyDrawer.querySelectorAll('.hd-tab');
  for (var t = 0; t < tabs.length; t++) { tabs[t].classList.toggle('is-selected', tabs[t]._hdTab === historyDrawerTab); }
  clear(historyDrawerList);
  var tab = historyDrawerTab;
  var records = libraryRecords(tab);
  if (!records.length) { historyDrawerList.appendChild(el('div', 'hd-empty', LIBRARY_EMPTY[tab])); }
  records.slice(0, 30).forEach(function (record) {
    var row = el('div', 'hd-item focusable');
    var img = document.createElement('img');
    img.className = 'hd-poster';
    img.alt = '';
    img.src = record.poster || 'assets/original/common/bg_placehoder_vertical.png';
    img.onerror = function () { this.style.visibility = 'hidden'; };
    row.appendChild(img);
    var info = el('div', 'hd-info');
    info.appendChild(el('div', 'hd-title', record.title || 'Contenido'));
    if (tab === 'history') {
      var r = historyRecordLine(record);
      if (r.line) { info.appendChild(el('div', 'hd-sub', r.line)); }
      var bar = el('div', 'hd-bar');
      var fill = el('i');
      fill.style.width = r.pct + '%';
      bar.appendChild(fill);
      info.appendChild(bar);
      info.appendChild(el('div', 'hd-when', timeAgo(record.updatedAt)));
    } else {
      info.appendChild(el('div', 'hd-sub', record.series ? 'Serie' : 'Película'));
    }
    row.appendChild(info);
    var remove = el('div', 'hd-remove');
    remove.title = tab === 'history' ? 'Quitar del historial' : (tab === 'mylist' ? 'Quitar de Mi lista' : 'Quitar de favoritos');
    remove.innerHTML = REMOVE_SVG;
    remove.addEventListener('click', function (event) {
      event.stopPropagation();
      removeLibraryRecord(tab, record);
      renderHistoryDrawer();
    });
    row.appendChild(remove);
    row.title = (tab === 'history' ? 'Seguir viendo ' : 'Abrir ') + (record.title || '');
    row._activate = function () {
      closeHistoryDrawer(true);
      openHistoryRecord(record);
    };
    historyDrawerList.appendChild(row);
  });
  var foot = el('div', 'hd-foot');
  if (tab === 'history' && records.length) {
    var clearAll = el('div', 'hd-link focusable is-danger', 'Borrar historial');
    clearAll._activate = function () {
      if (!window.confirm('¿Borrar todo el historial de reproducción de este equipo?')) { return; }
      forgetAllWatched();
      renderHistoryDrawer();
    };
    foot.appendChild(clearAll);
  }
  var all = el('div', 'hd-link focusable', 'Ver en pantalla completa');
  all._activate = function () {
    closeHistoryDrawer(true);
    historyViewTab = tab;
    openHistoryPage();
  };
  foot.appendChild(all);
  historyDrawerList.appendChild(foot);
}

function openHistoryDrawer() {
  if (state.screen === 'player' || state.screen === 'welcome') { return; }
  if (!historyDrawer) { buildHistoryDrawer(); }
  historyDrawerReturnFocus = state.focus;
  historyDrawerOpen = true;
  renderHistoryDrawer();
  historyDrawerList.scrollTop = 0;
  document.body.classList.add('is-history-drawer-open');
  var first = historyDrawerList.querySelector('.hd-item') || historyDrawer.querySelector('.hd-tab');
  if (first) { setFocus(first, true); }
}

function closeHistoryDrawer(navigating) {
  if (!historyDrawerOpen) { return; }
  historyDrawerOpen = false;
  document.body.classList.remove('is-history-drawer-open');
  if (!navigating && historyDrawerReturnFocus && isVisible(historyDrawerReturnFocus)) {
    setFocus(historyDrawerReturnFocus, true);
  }
  historyDrawerReturnFocus = null;
}

/* The "Historial" button and Ctrl+J open the side panel. */
function openHistoryView() {
  if (window.XUPER_DESKTOP) {
    if (historyDrawerOpen) { closeHistoryDrawer(); } else { openHistoryDrawer(); }
    return;
  }
  historyViewTab = 'history';
  openHistoryPage();
}

/* Full page (Ajustes → Mi lista). Callers choose historyViewTab. */
function openHistoryPage() {
  if (state.screen === 'player') { return; }
  if (state.screen === 'welcome') { finishWelcome(); }
  if (state.screen === 'detail') {
    /* Same cleanup as leaving the detail page: stop its preview video. */
    if (seasonPopup) { closeSeasonPopup(); }
    var scr = $('screen-detail');
    if (scr) { scr.classList.remove('is-synopsis-open'); }
    if (!keepFloatingVideo()) { stopPlayerVideo(); }  /* PiP keeps playing while browsing */
    var scrPlayer = $('screen-player');
    if (scrPlayer) { scrPlayer.classList.remove('is-mini'); scrPlayer.classList.remove('is-active'); }
  }
  openSettings();
  showSettingsPanel(1, true);
}

/* Ajustes → Mi lista: three tabs and a grid of posters, four per row. */
function buildHistoryPanel() {
  var p = el('div', 'settings-panel history-panel is-library');
  var tabs = el('div', 'history-tabs');
  if (!LIBRARY_EMPTY[historyViewTab]) { historyViewTab = 'history'; }
  var tabId = historyViewTab;
  LIBRARY_TABS.forEach(function (tab) {
    var tabEl = el('div', 'history-tab focusable' + (tabId === tab.id ? ' is-selected' : ''), tab.label);
    tabEl._activate = function () {
      historyViewTab = tab.id;
      showSettingsPanel(1, true);
      var again = settingsRight && settingsRight.querySelector('.history-tab.is-selected');
      if (again) { setFocus(again); }
    };
    tabs.appendChild(tabEl);
  });
  p.appendChild(tabs);
  p.appendChild(el('div', 'history-rule'));

  var records = libraryRecords(tabId);
  var total = el('div', 'history-total', tabId === 'history' ? 'Sin terminar · ' : (tabId === 'mylist' ? 'Para ver después · ' : 'Favoritos · '));
  total.appendChild(el('span', null, String(records.length)));
  if (tabId === 'history' && records.length) {
    var clearBtn = el('div', 'history-clear focusable', 'Borrar historial');
    clearBtn._activate = function () {
      if (!window.confirm('¿Borrar todo el historial de reproducción de este equipo?')) { return; }
      forgetAllWatched();
      showSettingsPanel(1, true);
    };
    total.appendChild(clearBtn);
  }
  p.appendChild(total);

  var grid = el('div', 'history-grid library-grid scrollable');
  if (!records.length) {
    grid.appendChild(el('div', 'history-grid-empty', LIBRARY_EMPTY[tabId]));
  }
  records.slice(0, 120).forEach(function (record) {
    var card = el('div', 'history-card library-card focusable');
    var art = el('div', 'library-art');
    var img = document.createElement('img');
    img.className = 'history-poster';
    img.alt = '';
    img.loading = 'lazy';
    img.src = record.poster || 'assets/original/common/bg_placehoder_vertical.png';
    img.onerror = function () { this.style.visibility = 'hidden'; };
    art.appendChild(img);
    var sub = record.series ? 'Serie' : 'Película';
    if (tabId === 'history') {
      var r = historyRecordLine(record);
      sub = r.line || sub;
      var bar = el('div', 'history-bar library-bar');
      var fill = el('i');
      fill.style.width = Math.max(2, r.pct) + '%';
      bar.appendChild(fill);
      art.appendChild(bar);
    }
    var playIco = el('i', 'history-play');
    playIco.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
    art.appendChild(playIco);
    /* PC: remove with the mouse (on TVs the details page's toggles do it). */
    if (platformHas('mouse')) {
      var remove = el('button', 'library-remove desktop-native-control');
      remove.type = 'button';
      remove.title = tabId === 'history' ? 'Quitar del historial' : (tabId === 'mylist' ? 'Quitar de Mi lista' : 'Quitar de favoritos');
      remove.innerHTML = REMOVE_SVG;
      remove.addEventListener('click', function (event) {
        event.stopPropagation();
        removeLibraryRecord(tabId, record);
        showSettingsPanel(1, true);
      });
      art.appendChild(remove);
    }
    card.appendChild(art);
    card.appendChild(el('div', 'history-card-title', record.title || 'Contenido'));
    card.appendChild(el('div', 'history-sub', sub));
    card.title = (tabId === 'history' ? 'Seguir viendo ' : 'Abrir ') + (record.title || '');
    card._activate = function () { openHistoryRecord(record); };
    grid.appendChild(card);
  });
  p.appendChild(grid);
  return p;
}
