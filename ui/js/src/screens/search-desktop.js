/* screens/search-desktop.js — Búsqueda en escritorio: estados, vista cuadrícula/lista y carga continua.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------------------
   Desktop search states. The local catalogue only holds what the app has
   loaded, so 0 local matches does not mean 0 results: say "Buscando…"
   until the server answers, and only then "No hay resultados". While
   typing, keep the previous results on screen instead of blanking them.
   ------------------------------------------------------------------ */
var searchStateBox = null, searchInlineState = null;
var searchRequestTimeout = null;

function runDesktopSearch(rawQ, localMatches) {
  if (state.searchTimer) { clearTimeout(state.searchTimer); state.searchTimer = null; }
  if (searchRequestTimeout) { clearTimeout(searchRequestTimeout); searchRequestTimeout = null; }
  var seq = ++state.searchSeq;
  var query = rawQ.trim();
  rememberRecentSearch(query);
  hideSearchSuggest();
  var addonSearch = norm(query).length >= 2;
  state.searchRemote = null;
  if (addonSearch) {
    /* The addons that can search answer (catalogs with the "search" extra). */
    state.searchStatus = 'searching';
    renderSearchResults(localMatches);
    state.searchTimer = setTimeout(function () {
      state.searchTimer = null;
      /* Results show as each addon answers, best match first (the loaded
         titles that match go into the same order). */
      searchTitles(query, function (found, finished) {
        if (seq !== state.searchSeq) { return; }
        state.searchStatus = finished ? 'done' : 'searching';
        renderSearchResults(rankSearchResults(query, localMatches.concat(found)));
      });
    }, 350);
    return;
  }
  state.searchStatus = 'done';
  renderSearchResults(localMatches);
}

function retrySearch() {
  runSearch();
}

/* ------------------------------------------------------------------
   Desktop results: one scrolling page (no "Siguiente"), grid or list
   view, 2-line titles, and the next server pages load on their own when
   the viewer scrolls near the end.
   ------------------------------------------------------------------ */
var SEARCH_REMOTE_PAGE = 50;
var SEARCH_VIEW_KEY = 'opentv_search_view_v1';
var srWrap = null, srCount = null, srBody = null, srMore = null, srToggle = null;

function getSearchView() {
  var v = safeLocalRead(SEARCH_VIEW_KEY, 'grid');
  return v === 'list' ? 'list' : 'grid';
}

function setSearchView(mode) {
  safeLocalWrite(SEARCH_VIEW_KEY, mode);
  var keep = searchResults ? searchResults.scrollTop : 0;
  renderDesktopSearchList();
  if (searchResults) { searchResults.scrollTop = mode === 'list' ? 0 : keep; }
}

function ensureDesktopSearchLayout() {
  if (srWrap) { return; }
  srWrap = el('div', 'sr-wrap');
  var head = el('div', 'sr-head');
  srCount = el('div', 'sr-count');
  head.appendChild(srCount);
  srToggle = el('div', 'sr-toggle');
  [
    { mode: 'grid', label: 'Cuadrícula', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg>' },
    { mode: 'list', label: 'Lista', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="4" width="5" height="6" rx="1.5"/><rect x="10" y="5" width="11" height="2" rx="1"/><rect x="10" y="8" width="7" height="1.6" rx=".8"/><rect x="3" y="14" width="5" height="6" rx="1.5"/><rect x="10" y="15" width="11" height="2" rx="1"/><rect x="10" y="18" width="7" height="1.6" rx=".8"/></svg>' }
  ].forEach(function (v) {
    var b = el('div', 'sr-view focusable');
    b._mode = v.mode;
    b.title = 'Vista de ' + v.label.toLowerCase();
    b.innerHTML = v.icon + '<span>' + v.label + '</span>';
    b._activate = function () { setSearchView(v.mode); setFocus(b, true); };
    srToggle.appendChild(b);
  });
  head.appendChild(srToggle);
  srWrap.appendChild(head);
  if (searchInlineState) { srWrap.appendChild(searchInlineState); }
  srBody = el('div', 'sr-body');
  srWrap.appendChild(srBody);
  srMore = el('div', 'sr-more');
  srWrap.appendChild(srMore);
  searchResults.appendChild(srWrap);
  searchResults.addEventListener('scroll', maybeLoadMoreSearch);
}

function makeDesktopSearchCard(item) {
  var card = el('div', 'sr-card focusable');
  var art = el('div', 'sr-art');
  if (item.poster) {
    var img = document.createElement('img');
    img.className = 'sr-poster';
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = item.poster;
    img.onerror = function () {
      if (!img._posterProTried && item && typeof posterProFallbackForItem === 'function') {
        var alt = posterProFallbackForItem(item, 'poster');
        if (alt && alt !== item.poster) {
          img._posterProTried = true;
          item.poster = alt;
          img.src = alt;
          return;
        }
      }
      if (window.OPENTV_DESKTOP) { markCoverBroken(item); applyGenericCover(art, item); }
      else { this.style.visibility = 'hidden'; }
    };
    art.appendChild(img);
  } else if (window.OPENTV_DESKTOP) {
    applyGenericCover(art, item);
  }
  card.appendChild(art);
  var info = el('div', 'sr-info');
  info.appendChild(el('div', 'sr-title', item.title || 'Sin título'));
  var bits = [];
  var year = String(item.year || item.releaseDate || '').match(/\d{4}/);
  if (year) { bits.push(year[0]); }
  bits.push(isSeriesItem(item) ? 'Serie' : 'Película');
  info.appendChild(el('div', 'sr-meta', bits.join(' · ')));
  if (item.genres && item.genres.length && itemGenres(item, 3).length) {
    info.appendChild(el('div', 'sr-genres', itemGenres(item, 3).join(', ')));
  }
  /* The search answer carries no synopsis; skip the "Sin sinopsis" filler. */
  if (item.synopsis && !/^[\s—–\-]*$/.test(String(item.synopsis)) && !/^sin sinopsis/i.test(String(item.synopsis).trim())) {
    info.appendChild(el('div', 'sr-desc', String(item.synopsis)));
  }
  card.appendChild(info);
  card.title = item.title || '';
  card._item = item;
  card._activate = function () {
    if (item && item.title) {
      rememberRecentSearch(item.title);
      renderRecentSearches();
    }
    openDetail(item);
  };
  return card;
}

function appendSearchCards(list, offset) {
  var frag = document.createDocumentFragment();
  for (var i = 0; i < list.length; i++) {
    var raw = list[i];
    frag.appendChild(makeDesktopSearchCard(raw && raw._stremio ? raw : normalizeVod(raw, offset + i + 1)));
  }
  srBody.appendChild(frag);
}

function updateSearchCount() {
  if (!srCount) { return; }
  var shown = (state.searchMatches || []).length;
  srCount.textContent = shown === 1 ? '1 resultado' : (shown + ' resultados');
}

/* (The addons answer one page: there is nothing more to load.) */
function updateSearchMore() {
  if (srMore) { clear(srMore); srMore.className = 'sr-more'; }
}

function maybeLoadMoreSearch() {}

function renderDesktopSearchList() {
  ensureDesktopSearchLayout();
  var matches = state.searchMatches || [];
  var view = getSearchView();
  searchHot.classList.add('is-hidden');
  searchResults.classList.add('is-active');
  /* Each addon's answer re-renders the cards: a remote on one of them keeps
     its place instead of losing the focus (TV). Read before the cards are
     removed (after, the focused card was already detached and the focus
     was lost when the second addon answered). */
  var focusedIndex = -1;
  if (state.focus && state.focus.parentNode === srBody) {
    focusedIndex = Array.prototype.indexOf.call(srBody.children, state.focus);
  }
  clear(searchResultGrid);
  if (searchNav) { searchNav.textContent = ''; }
  clear(srBody);
  srBody.className = 'sr-body is-' + view;
  var views = srToggle.children;
  for (var v = 0; v < views.length; v++) { views[v].classList.toggle('is-selected', views[v]._mode === view); }
  if (!matches.length) {
    searchEmpty.classList.add('is-active');
    srWrap.hidden = true;
    updateSearchStateUi();
    return;
  }
  searchEmpty.classList.remove('is-active');
  srWrap.hidden = false;
  appendSearchCards(matches, 0);
  updateSearchCount();
  updateSearchStateUi();
  updateSearchMore();
  if (state.screen !== 'search') { return; }
  if (focusedIndex >= 0) {
    setFocus(srBody.children[Math.min(focusedIndex, srBody.children.length - 1)]);
  } else if (typeof tvFocusResults !== 'undefined' && tvFocusResults) {
    /* TV, after the keyboard's "Buscar": straight to the first result. */
    tvFocusResults = false;
    setFocus(srBody.children[0]);
  }
}

function updateSearchStateUi() {
  if (!searchStateBox || !searchInlineState) { return; }
  var count = (state.searchMatches || []).length;
  var status = state.searchStatus || 'done';
  clear(searchStateBox);
  clear(searchInlineState);
  searchStateBox.className = 'search-state';
  searchInlineState.className = 'search-inline-state';
  if (!count && status === 'searching') {
    searchEmpty.classList.remove('is-active');
    searchStateBox.classList.add('is-active');
    searchStateBox.appendChild(el('div', 'search-spinner'));
    searchStateBox.appendChild(el('div', 'search-state-title', 'Buscando…'));
    searchStateBox.appendChild(el('div', 'search-state-hint', 'Buscando en tus plugins'));
    return;
  }
  if (!count && status === 'error') {
    searchEmpty.classList.remove('is-active');
    searchStateBox.classList.add('is-active');
    searchStateBox.appendChild(el('div', 'search-state-title', 'No se pudo completar la búsqueda'));
    searchStateBox.appendChild(el('div', 'search-state-hint', 'Tus plugins no respondieron. Revisa la conexión e inténtalo otra vez.'));
    var retry = el('div', 'search-retry focusable', 'Reintentar');
    retry._activate = retrySearch;
    searchStateBox.appendChild(retry);
    return;
  }
  if (count && status === 'searching') {
    searchInlineState.classList.add('is-active');
    searchInlineState.appendChild(el('i', 'search-spinner is-small'));
    searchInlineState.appendChild(document.createTextNode('Buscando en tus plugins…'));
    return;
  }
  if (count && status === 'error') {
    searchInlineState.classList.add('is-active', 'is-error');
    searchInlineState.appendChild(document.createTextNode('Algún plugin no respondió. '));
    var retry2 = el('span', 'search-retry-link focusable', 'Reintentar');
    retry2._activate = retrySearch;
    searchInlineState.appendChild(retry2);
  }
}

var SEARCH_PAGE_SIZE = 10;

/* TVs: at most this many results ("spi" matched 445). More cards only cost
   memory and make the way back up long; the count asks for a longer word. */
var SEARCH_TV_MAX = 100;
function searchCapped() { return platformIsTv() && window.OPENTV_DESKTOP; }

function renderSearchResults(matches) {
  /* A short query can match hundreds of portal titles.  A 1 GB TV stick runs
     out of media/UI memory if every poster is inserted at once, so retain the
     complete result list in JS but render one 2-row page at a time. */
  matches = matches || [];
  if (searchCapped() && matches.length > SEARCH_TV_MAX) { matches = matches.slice(0, SEARCH_TV_MAX); }
  state.searchMatches = matches;
  state.searchPage = 0;
  renderSearchResultPage(0, -1);
}

function renderSearchResultPage(requestedPage, focusIndex) {
  if (window.OPENTV_DESKTOP) { renderDesktopSearchList(); return; }
  var matches = state.searchMatches || [];
  searchHot.classList.add('is-hidden');
  searchResults.classList.add('is-active');
  clear(searchResultGrid);
  if (matches.length === 0) {
    searchEmpty.classList.add('is-active');
    if (searchNav) { searchNav.textContent = ''; }
    updateSearchStateUi();
    return;
  }
  searchEmpty.classList.remove('is-active');
  updateSearchStateUi();
  var pageCount = Math.ceil(matches.length / SEARCH_PAGE_SIZE);
  var page = Math.max(0, Math.min(pageCount - 1, requestedPage || 0));
  state.searchPage = page;
  var start = page * SEARCH_PAGE_SIZE;
  var end = Math.min(matches.length, start + SEARCH_PAGE_SIZE);
  if (searchNav) {
    searchNav.textContent = 'Resultados ' + (start + 1) + '-' + end + ' de ' + matches.length +
      (pageCount > 1 ? '  ·  Página ' + (page + 1) + '/' + pageCount : '');
    if (window.OPENTV_DESKTOP && pageCount > 1) {
      function pageButton(label, next, disabled) {
        var button = el('button', 'desktop-search-page focusable', label);
        button.type = 'button';
        button.disabled = disabled;
        button._activate = function () {
          if (button.disabled) return;
          searchResults.scrollTop = 0;
          renderSearchResultPage(next, 0);
        };
        searchNav.appendChild(button);
      }
      pageButton('Anterior', page - 1, page === 0);
      pageButton('Siguiente', page + 1, page + 1 === pageCount);
    }
  }
  for (var m = start; m < end; m++) {
    var localIndex = m - start;
    var cell = makeSearchCell(normalizeVod(matches[m], m + 1), localIndex);
    var poster = cell.querySelector('.poster');
    if (poster) {
      (function (indexOnPage, column) {
        poster._onMove = function (dir) {
          if (dir === 'down' && indexOnPage >= 5 && end < matches.length) {
            renderSearchResultPage(page + 1, column);
            return true;
          }
          if (dir === 'up' && indexOnPage < 5 && start > 0) {
            renderSearchResultPage(page - 1, 5 + column);
            return true;
          }
          return false;
        };
      })(localIndex, localIndex % 5);
    }
    searchResultGrid.appendChild(cell);
  }
  searchResultGrid.style.height = '874px';
  if (focusIndex >= 0) {
    var requested = searchResultGrid.querySelectorAll('.poster.focusable')[focusIndex];
    if (!requested) { requested = firstIn(searchResultGrid); }
    if (requested) { setFocus(requested); }
  } else if (state.screen === 'search' && (closest(state.focus, '.search-hot') || closest(state.focus, '.search-results'))) {
    var f = firstIn(searchResultGrid);
    if (f) { setFocus(f); }
  }
}

function toggleSearchNumeric() {
  state.searchNumeric = !state.searchNumeric;
  var sw = searchKeyboard.querySelector('.kb-action.switch .ico');
  if (sw) {
    sw.style.backgroundImage = 'url(assets/original/search/' +
      (state.searchNumeric ? 'ic_vod_search_abc.png' : 'ic_vod_search_123.png') + ')';
  }
  var rows = searchKeyboard.querySelectorAll('.kb-row:not(.kb-row-num)');
  if (!state.searchNumeric) {
    for (var i = 0; i < rows.length; i++) { rows[i].classList.remove('hidden'); }
    searchKeys.forEach(function (k) { k.classList.remove('hidden'); });
    var old = searchKeyboard.querySelectorAll('.kb-row-num');
    for (var o = 0; o < old.length; o++) { old[o].classList.add('hidden'); }
    return;
  }
  for (var r = 0; r < rows.length; r++) { rows[r].classList.add('hidden'); }
  if (!searchKeyboard.querySelector('.kb-row-num')) {
    var digits = [['1', '2', '3', '4', '5', '6', '7'], ['8', '9', '0', ' ']];
    for (var d = 0; d < digits.length; d++) {
      var row = el('div', 'kb-row kb-row-num');
      row.style.top = (264 + d * 88.5) + 'px';
      for (var c = 0; c < digits[d].length; c++) {
        var key = el('div', 'kb-key focusable' + (digits[d][c] === ' ' ? ' space' : ''),
          digits[d][c] === ' ' ? '' : digits[d][c]);
        key._activate = (function (ch) {
          return function () { setSearchQuery(state.searchQuery + ch); };
        })(digits[d][c]);
        row.appendChild(key);
      }
      searchKeyboard.appendChild(row);
    }
  }
  var numRows = searchKeyboard.querySelectorAll('.kb-row-num');
  for (var n = 0; n < numRows.length; n++) { numRows[n].classList.remove('hidden'); }
}
