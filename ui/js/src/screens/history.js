/* screens/history.js — Historial: panel lateral, registros y panel de historial en Ajustes.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------------------
   Desktop: history as a panel sliding in from the left, over the current
   screen. Nothing behind it changes (the preview video keeps playing), so
   closing it returns exactly where the viewer was.
   ------------------------------------------------------------------ */
var historyDrawerOpen = false;
var historyDrawer = null, historyDrawerList = null, historyDrawerBackdrop = null;
var historyDrawerTab = 'history';
var historyDrawerReturnFocus = null;

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

function buildHistoryDrawer() {
  historyDrawerBackdrop = el('div', 'history-drawer-backdrop');
  historyDrawerBackdrop.addEventListener('click', function (event) {
    event.stopPropagation();
    closeHistoryDrawer();
  });
  historyDrawer = el('aside', 'history-drawer');
  historyDrawer.setAttribute('role', 'dialog');
  historyDrawer.setAttribute('aria-label', 'Historial');
  var head = el('div', 'hd-head');
  var tabs = el('div', 'hd-tabs');
  [{ id: 'history', label: 'Historial' }, { id: 'favs', label: 'Favoritos' }].forEach(function (t) {
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

function historyDrawerRecords() {
  if (historyDrawerTab === 'history') {
    return (localProfile.history || []).filter(function (r) { return !!vodForHistoryRecord(r); });
  }
  var out = [];
  for (var v = 0; v < VOD.length; v++) {
    if (state.favs && state.favs[VOD[v].id]) {
      out.push({ id: VOD[v].id, title: VOD[v].title, poster: VOD[v].poster || VOD[v].cover, series: isSeriesItem(VOD[v]), position: 0, fav: true });
    }
  }
  return out;
}

function renderHistoryDrawer() {
  if (!historyDrawer) { return; }
  var tabs = historyDrawer.querySelectorAll('.hd-tab');
  for (var t = 0; t < tabs.length; t++) { tabs[t].classList.toggle('is-selected', tabs[t]._hdTab === historyDrawerTab); }
  clear(historyDrawerList);
  var records = historyDrawerRecords();
  if (!records.length) {
    historyDrawerList.appendChild(el('div', 'hd-empty', historyDrawerTab === 'history'
      ? 'Aún no has visto nada. Lo que reproduzcas aparecerá aquí para seguir donde lo dejaste.'
      : 'Todavía no tienes favoritos. Pulsa “Favorito” en una película o serie para guardarla aquí.'));
  }
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
    if (!record.fav) {
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
    remove.title = record.fav ? 'Quitar de favoritos' : 'Quitar del historial';
    remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>';
    remove.addEventListener('click', function (event) {
      event.stopPropagation();
      if (record.fav) {
        delete state.favs[record.id];
        safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
      } else {
        localProfile.history = (localProfile.history || []).filter(function (h) { return String(h.id) !== String(record.id); });
        safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
      }
      renderHistoryDrawer();
    });
    row.appendChild(remove);
    row.title = (record.fav ? 'Abrir ' : 'Seguir viendo ') + (record.title || '');
    row._activate = function () {
      closeHistoryDrawer(true);
      openHistoryRecord(record);
    };
    historyDrawerList.appendChild(row);
  });
  var foot = el('div', 'hd-foot');
  if (historyDrawerTab === 'history' && records.length) {
    var clearAll = el('div', 'hd-link focusable is-danger', 'Borrar historial');
    clearAll._activate = function () {
      if (!window.confirm('¿Borrar todo el historial de reproducción de este equipo?')) { return; }
      localProfile.history = [];
      safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
      renderHistoryDrawer();
    };
    foot.appendChild(clearAll);
  }
  var all = el('div', 'hd-link focusable', 'Ver en pantalla completa');
  all._activate = function () {
    var tab = historyDrawerTab;
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

/* Full-page history (Ajustes → Mi lista). Callers choose historyViewTab. */
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

function buildHistoryPanel() {
  var p = el('div', 'settings-panel history-panel');
  var tabs = el('div', 'history-tabs');
  var tabDefs = [
    { id: 'history', label: 'Historia' },
    { id: 'favs', label: window.XUPER_DESKTOP ? 'Mis favoritos' : 'Mi favoritos' }
  ];
  for (var t = 0; t < tabDefs.length; t++) {
    (function (tab) {
      var tabEl = el('div', 'history-tab focusable' + (historyViewTab === tab.id ? ' is-selected' : ''), tab.label);
      tabEl._activate = function () {
        historyViewTab = tab.id;
        showSettingsPanel(1, true);
      };
      tabs.appendChild(tabEl);
    })(tabDefs[t]);
  }
  p.appendChild(tabs);
  p.appendChild(el('div', 'history-rule'));

  var records = [];
  if (historyViewTab === 'history') {
    records = (localProfile.history || []).filter(function (r) { return !!vodForHistoryRecord(r); });
  } else if (historyViewTab === 'favs') {
    for (var v = 0; v < VOD.length; v++) {
      if (state.favs && state.favs[VOD[v].id]) {
        records.push({ id: VOD[v].id, title: VOD[v].title, poster: VOD[v].poster || VOD[v].cover, series: isSeriesItem(VOD[v]), position: 0 });
      }
    }
  }
  var desk = !!window.XUPER_DESKTOP;
  var total = el('div', 'history-total', desk ? (historyViewTab === 'history' ? 'Vistos recientemente · ' : 'Guardados · ') : 'Total ');
  total.appendChild(el('span', null, String(records.length)));
  if (desk && historyViewTab === 'history' && records.length) {
    var clearBtn = el('div', 'history-clear focusable', 'Borrar historial');
    clearBtn._activate = function () {
      if (!window.confirm('¿Borrar todo el historial de reproducción de este equipo?')) { return; }
      localProfile.history = [];
      safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
      showSettingsPanel(1, true);
    };
    total.appendChild(clearBtn);
  }
  p.appendChild(total);
  var grid = el('div', 'history-grid' + (desk ? ' scrollable' : ''));
  if (!records.length) {
    grid.appendChild(el('div', 'history-grid-empty', historyViewTab === 'history'
      ? 'Aún no has visto nada. Lo que reproduzcas aparecerá aquí para seguir donde lo dejaste.'
      : 'No hay títulos para mostrar todavía.'));
  } else {
    for (var i = 0; i < records.length && i < (desk ? 30 : 15); i++) {
      (function (record) {
        var card = el('div', 'history-card focusable');
        var img = document.createElement('img');
        img.className = 'history-poster';
        img.alt = '';
        img.src = record.poster || 'assets/original/common/bg_placehoder_vertical.png';
        card.appendChild(img);
        if (desk && historyViewTab === 'history') {
          var pos = Math.max(0, record.position || 0);
          var dur = Math.max(0, record.duration || 0);
          var pct = dur > 0 ? Math.min(100, Math.round(pos / dur * 100)) : 0;
          var bar = el('div', 'history-bar');
          var fill = el('i');
          fill.style.width = pct + '%';
          bar.appendChild(fill);
          card.appendChild(bar);
          var left = dur > pos ? Math.max(1, Math.round((dur - pos) / 60)) : 0;
          var line = record.series
            ? ('Ep. ' + (record.episodeNumber || '?') + (left ? ' · quedan ' + left + ' min' : ''))
            : (left ? ('Quedan ' + left + ' min') : ('Vas por ' + Math.max(1, Math.round(pos / 60)) + ' min'));
          if (pct >= 95) { line = record.series ? ('Ep. ' + (record.episodeNumber || '?') + ' · terminado') : 'Terminada'; }
          card.appendChild(el('div', 'history-card-title', record.title || 'Contenido'));
          card.appendChild(el('div', 'history-sub', line));
          card.appendChild(el('div', 'history-when', timeAgo(record.updatedAt)));
          var playIco = el('i', 'history-play');
          playIco.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
          card.appendChild(playIco);
          card.title = 'Seguir viendo ' + (record.title || '');
          card._activate = function () { openHistoryRecord(record); };
          grid.appendChild(card);
          return;
        }
        var progress = record.series ? ('Ya miró hasta ' + (record.episodeNumber ? ('epis. ' + record.episodeNumber) : 'un episodio')) : ('Ya miró hasta ' + formatTime(record.position || 0));
        card.appendChild(el('div', 'history-progress', progress));
        card.appendChild(el('div', 'history-card-title', record.title || 'Contenido'));
        card._activate = function () { openHistoryRecord(record); };
        grid.appendChild(card);
      })(records[i]);
    }
  }
  p.appendChild(grid);
  return p;
}
