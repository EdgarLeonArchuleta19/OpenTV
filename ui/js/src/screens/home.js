/* screens/home.js — Inicio: construcción de páginas, rail de pestañas, barra superior y reloj.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* =================================================================== HOME */
var pageDefs = [buildLivePage, buildFeaturedPage, buildMoviesPage, buildSeriesPage,
                buildKidsPage, buildAnimePage, buildNovelsPage, buildExplorePage];
var pagesBuilt = {};

var pageBuiltAt = {};
var catalogStaleAt = 0;

function ensurePageBuilt(idx) {
  var rebuilt = false, hadFocus = false, focusId = null, keepScroll = 0;
  if (pagesBuilt[idx] && (pageBuiltAt[idx] || 0) < catalogStaleAt && idx > 0) {
    /* Built with an older catalog (or with covers that turned out broken,
       or before this week's trends arrived). */
    hadFocus = !!(state.focus && pages[idx].contains(state.focus));
    focusId = hadFocus && state.focus._item ? String(state.focus._item.id) : null;
    keepScroll = pages[idx].scrollTop;
    clear(pages[idx]);
    pages[idx].scrollTop = 0;
    pages[idx]._tvLine = null;
    pagesBuilt[idx] = false;
    rebuilt = true;
  }
  if (pagesBuilt[idx] || !pages[idx] || !pageDefs[idx]) { return; }
  pagesBuilt[idx] = true;
  pageBuiltAt[idx] = catalogStaleAt || Date.now();
  pageDefs[idx](pages[idx]);
  /* The remote was on this page: keep it on the same title (or on the first
     element) instead of on a node that no longer exists. */
  if (rebuilt && hadFocus) {
    var again = null;
    if (focusId !== null) {
      var tiles = pages[idx].querySelectorAll('.focusable');
      for (var i = 0; i < tiles.length && !again; i++) {
        if (tiles[i]._item && String(tiles[i]._item.id) === focusId && isVisible(tiles[i])) { again = tiles[i]; }
      }
    }
    if (!again) { pages[idx].scrollTop = keepScroll; }
    setFocus(again || firstIn(pages[idx]) || tabEls[state.tab]);
  }
}

/* Desktop: a new catalog (or a broken cover) refreshes the VOD pages. */
function markCatalogPagesStale() {
  catalogStaleAt = Math.max(Date.now() + 1, catalogStaleAt + 1);
  var current = TABS[state.tab] ? TABS[state.tab].page : 0;
  /* TVs: a refresh in the background (every 20 min) rebuilt the section on
     screen in front of the viewer, a short flash like a reload. After the
     first minute (when the real catalogue replaces the saved one) it is
     redrawn the next time the section is opened instead. */
  var onScreen = state.screen === 'home' && pagesBuilt[current];
  if (platformIsTv() && onScreen && window.performance && performance.now() > 60000) { return; }
  if (current > 0 && pages[current]) {
    ensurePageBuilt(current);
    if (window.XUPER_DESKTOP && state.screen === 'home') { showHeroForPage(current); }
  }
}

function buildHome() {
  homeBuilt = true;
  pagesEl = $('home-pages');
  notifyEl = $('home-notify');
  clear(pagesEl);
  pages = [];
  pagesBuilt = {};

  /* Create placeholder wrappers for each tab, but build DOM only on demand */
  for (var i = 0; i < pageDefs.length; i++) {
    var page = el('div', 'home-page scrollable');
    if (window.XUPER_DESKTOP) {
      /* Top bar: solid once the page scrolls (pages without a hero too). */
      page.addEventListener('scroll', function () {
        if (this.classList.contains('is-current')) { document.body.classList.toggle('is-home-scrolled', this.scrollTop > 140); }
      }, { passive: true });
    }
    if (i === 0) { page.classList.add('is-current'); }
    pagesEl.appendChild(page);
    pages.push(page);
  }

  var initialTab = (TABS[state.tab] && TABS[state.tab].page >= 0) ? TABS[state.tab].page : 0;
  ensurePageBuilt(initialTab);

  buildTabs();
  buildNotify();
}

function buildTabs() {
  var host = $('home-tabs');
  clear(host);
  host.classList.add('scrollable');
  host.classList.add('is-expanded');
  tabEls = [];
  /* TVs: a vertical menu on the left (like the LG version). Moving through it
     only previews the section once the remote rests on it, so holding the
     arrow does not build every page on the way. */
  var railTv = platformIsTv();
  var railTimer = null;
  function railPreview(idx) {
    if (railTimer) { clearTimeout(railTimer); }
    railTimer = setTimeout(function () {
      railTimer = null;
      if (state.focus === tabEls[idx] && state.screen === 'home') { selectTab(idx, false); }
    }, 280);
  }
  function railMoveTo(idx) {
    if (!tabEls[idx]) { return; }
    setFocus(tabEls[idx]);
    if (railTv) { railPreview(idx); } else { selectTab(idx, false); }
  }
  function enterTab(idx) {
    if (railTimer) { clearTimeout(railTimer); railTimer = null; }
    if (TABS[idx].action) {
      runTabAction(TABS[idx].action);
      return;
    }
    selectTab(idx, false);
    if (TABS[idx].page === 0) {
      var row = liveRows.filter(function (r) { return r._channel === state.channel; })[0];
      if (row) { setFocus(row); }
      else if (liveRows.length) { setFocus(liveRows[0]); }
      else if (liveFocus) { setFocus(liveFocus); }
    } else if (TABS[idx].page >= 0) {
      /* Back into the same section (from the menu): where the viewer was,
         the page as it was; the first element only for a section just
         opened (selectTab forgets the place when the section changes). */
      var pg = pages[TABS[idx].page];
      var last = pg && pg._lastFocus;
      if (last && last.isConnected && pg.contains(last) && isVisible(last)) { setFocus(last); return; }
      var f = firstIn(pg);
      if (f) { setFocus(f); }
    }
  }
  for (var i = 0; i < TABS.length; i++) {
    var item = el('div', 'tab-item focusable');
    item.appendChild(el('div', 'tab-pill'));
    var icon = el('div', 'tab-icon');
    icon.innerHTML = TABS[i].svg || TAB_ICONS[TABS[i].icon] || '';
    item.appendChild(icon);
    var title = el('div', 'tab-title', TABS[i].label);
    item.appendChild(title);
    item._tab = i;
    item._activate = (function (idx) {
      return function () { enterTab(idx); };
    })(i);
    item._onMove = (function (idx) {
      return function (dir) {
        if (railTv) {
          if (dir === 'up') { railMoveTo(idx - 1); return true; }
          if (dir === 'down') { railMoveTo(idx + 1); return true; }
          if (dir === 'left') { return true; }
          if (dir === 'right') { enterTab(idx); return true; }
          return false;
        }
        /* Desktop: the tabs are a horizontal bar at the top (left/right
           change tab, down goes into the page). */
        if (window.XUPER_DESKTOP) {
          if (dir === 'up') { return true; }
          if (dir === 'down') { dir = 'right'; }
          else if (dir === 'left') {
            if (idx > 0 && tabEls[idx - 1]) { setFocus(tabEls[idx - 1]); selectTab(idx - 1, false); }
            return true;
          } else if (dir === 'right') {
            if (idx < tabEls.length - 1 && tabEls[idx + 1]) { setFocus(tabEls[idx + 1]); selectTab(idx + 1, false); }
            return true;
          }
        }
        if (dir === 'up') {
          if (idx > 0 && tabEls[idx - 1]) {
            setFocus(tabEls[idx - 1]);
            selectTab(idx - 1, false);
          }
          return true;
        }
        if (dir === 'down') {
          if (idx < tabEls.length - 1 && tabEls[idx + 1]) {
            setFocus(tabEls[idx + 1]);
            selectTab(idx + 1, false);
          }
          return true;
        }
        if (dir === 'left') {
          return true;
        }
        if (dir === 'right') {
          if (TABS[idx].action === 'history') {
            historyViewTab = 'history';
            openSettings();
            showSettingsPanel(1, true);
            return true;
          }
          selectTab(idx, false);
          if (idx === 0) {
            var row = liveRows.filter(function (r) { return r._channel === state.channel; })[0];
            if (row) { setFocus(row); }
            else if (liveRows.length) { setFocus(liveRows[0]); }
            else if (liveFocus) { setFocus(liveFocus); }
          } else if (TABS[idx].page >= 0) {
            var page = pages[TABS[idx].page];
            var f = firstIn(page);
            if (f) { setFocus(f); }
          }
          return true;
        }
        return false;
      };
    })(i);
    host.appendChild(item);
    tabEls.push(item);
  }
}

/* Rail entries that open a screen instead of a section (HISTORIAL on the
   old TV layout). */
function runTabAction(action) {
  if (action === 'history') {
    historyViewTab = 'history';
    openSettings();
    showSettingsPanel(1, true);
  }
}

function buildNotify() {
  clear(notifyEl);
  /* Keep the compact controls used in the home screen: search, filter and
     profile.  The record shortcut and message bell are intentionally not
     shown here; history lives under Mi lista. */
  var defs = [
    { cls: 'search', icon: 'assets/original/home/icon_notify_search.png', small: true },
    { cls: 'filter', icon: 'assets/original/search/icon_category_filter_n.png', small: true },
    { cls: 'personal', icon: 'assets/original/home/icon_notify_personal.png', small: true }
  ];
  if (window.XUPER_DESKTOP) {
    defs = [
      { cls: 'search' + (isKidsProfile() ? ' is-hidden-kids' : ''), svg: UI_ICONS.search, tip: 'Buscar (Ctrl+F)', small: true, run: function () { openSearch(); } },
      { cls: 'mylist', svg: UI_ICONS.mylist, tip: 'Mi lista', small: true,
        run: function () { openSettings(); showSettingsPanel(1, true); } },
      { cls: 'personal', svg: UI_ICONS.user, tip: 'Mi cuenta y ajustes', small: true, run: function () { openSettings(); } }
    ];
  }
  for (var i = 0; i < defs.length; i++) {
    var d = defs[i];
    var item = el('div', 'notify-item focusable ' + d.cls + (d.small ? ' is-small' : ''));
    var nn = el('div', 'n-normal');
    if (d.svg) {
      nn.innerHTML = d.svg;
      nn.classList.add('is-svg');
      item.setAttribute('data-tip', d.tip);
      item.setAttribute('aria-label', d.tip);
      item._activate = d.run;
      item.appendChild(nn);
      notifyEl.appendChild(item);
      continue;
    }
    nn.style.backgroundImage = 'url(' + d.icon + ')';
    item.appendChild(nn);
    if (d.cls === 'personal') {
      item._activate = function () { openSettings(); };
    } else if (d.cls === 'search') {
      item._activate = function () { openSearch(); };
    } else {
      item.setAttribute('aria-disabled', 'true');
      item.title = 'Filtros no disponibles en esta versión. Usa la búsqueda por título.';
    }
    notifyEl.appendChild(item);
  }
  var div = el('div', 'notify-divider');
  notifyEl.appendChild(div);
  var wifi = el('div', 'notify-wifi');
  wifi.innerHTML = '<svg viewBox="0 0 30 22"><path d="M15 19.5a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2z" fill="currentColor"/><path d="M8.4 12.2a9.6 9.6 0 0 1 13.2 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M4.2 7.6a15.6 15.6 0 0 1 21.6 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  notifyEl.appendChild(wifi);
  var time = el('div', 'notify-time');
  time.id = 'notify-time';
  notifyEl.appendChild(time);
  updateClock();
  setInterval(updateClock, 30000);
  if (window.XUPER_DESKTOP) { refreshProfileChrome(); }
}

function updateClock() {
  var t = $('notify-time');
  if (!t) { return; }
  var d = new Date();
  var h = d.getHours();
  var ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) { h = 12; }
  var m = d.getMinutes();
  t.textContent = h + ':' + pad2(m) + ' ' + ap;
}

function selectTab(index, focusContent) {
  var def = TABS[index];
  /* Action rows are opened with OK/Right. Merely moving through the rail
     must not throw the user out of Home before they confirm the choice. */
  if (!def || def.action) { return; }
  var prevPage = TABS[state.tab] ? TABS[state.tab].page : def.page;
  state.tab = index;
  if (window.XUPER_DESKTOP) { updateTitleBarSection(); }
  for (var i = 0; i < tabEls.length; i++) {
    tabEls[i].classList.toggle('is-selected', i === index);
  }
  if (def.page >= 0) {
    ensurePageBuilt(def.page);
    if (window.XUPER_DESKTOP) { showHeroForPage(def.page); }
  }
  if (def.page === 0) {
    scheduleLivePreview(CHANNELS[state.channel]);
  } else {
    stopLivePreview();
  }
  /* A different section: the place kept in the one left is forgotten (it
     opens again at its start, like now). */
  if (def.page !== prevPage && pages[prevPage]) { pages[prevPage]._lastFocus = null; }
  for (var p = 0; p < pages.length; p++) {
    pages[p].classList.remove('is-entering', 'from-left', 'from-right');
    pages[p].classList.toggle('is-current', p === def.page);
    /* Desktop: a section opened from the tab bar starts at its top (once it
       is displayed: a hidden page ignores scrollTop). */
    if (window.XUPER_DESKTOP && p === def.page && def.page !== prevPage && def.page > 0) { pages[p].scrollTop = 0; pages[p]._tvLine = null; }
  }
  /* Same slide direction as the ViewPager; the page itself is the only
     visible layer, which keeps its raster sharp on webOS. */
  if (def.page !== prevPage && pages[def.page]) {
    var pg = pages[def.page];
    pg.classList.add('is-entering', def.page > prevPage ? 'from-right' : 'from-left');
    setTimeout(function () {
      pg.classList.remove('is-entering', 'from-left', 'from-right');
      /* Posters that were off screen during the slide load now. */
      schedulePosterMemoryPass();
    }, window.XUPER_DESKTOP ? 400 : 320);
  }
  if (focusContent) {
    if (def.page === 0) {
      var row = liveRows.filter(function (r) { return r._channel === state.channel; })[0];
      if (row) { setFocus(row); }
      else if (liveRows.length) { setFocus(liveRows[0]); }
      else if (liveFocus) { setFocus(liveFocus); }
    } else {
      var f = firstIn(pages[def.page]);
      if (f) { setFocus(f); }
    }
  }
  schedulePosterMemoryPass();
}
