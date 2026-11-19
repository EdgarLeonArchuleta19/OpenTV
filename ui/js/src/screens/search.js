/* screens/search.js — Búsqueda: campo, teclado de TV, populares y búsqueda en los addons.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ================================================================ SEARCH */
/* "Populares": the first titles of the addons' catalogs (their first rows
   are their popular lists). */
function hotSearches() {
  return VOD.slice(0, 12);
}

function buildSearch() {
  searchKeyboard = $('search-keyboard');
  searchHot = $('search-hot');
  searchResults = $('search-results');
  searchEmpty = $('search-empty');
  searchHotGrid = $('search-hot-grid');
  searchResultGrid = $('search-result-grid');
  searchNav = $('search-nav');
  /* Rebuilt when the catalogue reloads: the key in focus is focused again. */
  var tvKeyIndex = -1;
  if (searchTvKb && state.focus && searchKeyboard.contains(state.focus)) {
    tvKeyIndex = Array.prototype.indexOf.call(searchKeyboard.querySelectorAll('.tvk-key'), state.focus);
  }
  clear(searchKeyboard); clear(searchHotGrid); clear(searchResultGrid);
  /* Result rows can extend beyond the first screen.  Mark their viewport as
     scrollable so reveal() follows D-pad focus down through every result. */
  if (searchResults) { searchResults.classList.add('scrollable'); }
  if (window.OPENTV_DESKTOP && searchHot) { searchHot.classList.add('scrollable'); }
  if (window.OPENTV_DESKTOP && searchResults && !searchStateBox) {
    /* Centered state (Buscando… / error) and a small line under the counter. */
    searchStateBox = el('div', 'search-state');
    searchResults.appendChild(searchStateBox);
    searchInlineState = el('div', 'search-inline-state');
    searchResults.appendChild(searchInlineState);
  }

  /* --- keyboard panel (layout_search_keybord_full_uni) --- */
  searchInput = el(window.OPENTV_DESKTOP ? 'input' : 'div', 'kb-edit focusable');
  if (window.OPENTV_DESKTOP) {
    searchInput.type = 'search';
    searchInput.id = 'desktop-search-input';
    searchInput.placeholder = 'Buscar películas o series';
    searchInput.setAttribute('aria-label', 'Buscar películas o series');
    searchInput.autocomplete = 'off';
    /* The system keyboard (Fire TV, Android TV) shows "Buscar" on its action key. */
    searchInput.setAttribute('enterkeyhint', 'search');
    /* Typing only edits the query. The server is asked once, on Enter or
       the Buscar button, instead of on every letter. Emptying the box
       (or its ✕) goes back to the popular titles. */
    searchInput.addEventListener('input', function (event) {
      if (event.isComposing) return;
      state.searchQuery = searchInput.value;
      if (!state.searchQuery.trim()) { clearSearchState(); renderPopularSearch(); }
      updateSearchSuggest();
    });
    searchInput.addEventListener('focus', updateSearchSuggest);
    searchInput.addEventListener('blur', function () { setTimeout(hideSearchSuggest, 120); });
    searchInput.addEventListener('compositionend', function () { state.searchQuery = searchInput.value; });
    searchInput.addEventListener('keydown', function (event) {
      if (event.isComposing) return;
      /* TV: the remote already left the field but the WebView kept it as
         the page's focus; its keys belong to the app's navigation. */
      if (platformIsTv() && state.focus !== searchInput) {
        event.preventDefault();
        event.stopPropagation();
        handleKey({ keyCode: event.keyCode, key: event.key, target: document.body, preventDefault: function () {}, stopPropagation: function () {} });
        return;
      }
      if (searchSuggestKey(event)) { event.stopPropagation(); return; }
      if (event.key === 'Enter' || event.keyCode === 13) {
        event.preventDefault();
        state.searchQuery = searchInput.value;
        if (platformIsTv()) { submitTvSearch(); return; }
        runSearch();
      }
      if (event.key === 'Escape') { searchInput.blur(); back(); }
      /* TV: the remote's up/down leave the field (to the results, the
         Buscar button…) like any other control. */
      /* (Moved here: on the Fire TV blur() does not release the field, and
         the global handler ignores keys aimed at a text field, so the
         arrow did nothing.) */
      if (platformIsTv() && (event.keyCode === 38 || event.keyCode === 40)) {
        event.preventDefault();
        event.stopPropagation();
        searchInput.blur();
        moveFocus(event.keyCode === 40 ? 'down' : 'up');
        return;
      }
      event.stopPropagation();
    });
    /* TV: the system keyboard's "Siguiente" / "Listo" may only close the
       keyboard (no Enter): searching then too. */
    searchInput.addEventListener('change', function () {
      if (!platformIsTv()) { return; }
      state.searchQuery = searchInput.value;
      if (norm(state.searchQuery.trim()) !== tvSearchedQuery) { submitTvSearch(); }
    });
    searchInput._activate = function () { searchInput.focus(); };
  } else {
    searchInput._activate = function () { /* TV keyboard field */ };
  }
  searchKeyboard.appendChild(searchInput);

  var actions = el('div', 'kb-actions');
  var actionDefs = [
    { cls: 'switch', w: 100.5 },
    { cls: 'clear', w: 100.5 },
    { cls: 'del', w: 100.5 },
    { cls: 'go', w: 120 }
  ];
  for (var a = 0; a < actionDefs.length; a++) {
    var act = el('div', 'kb-action focusable ' + actionDefs[a].cls);
    act.style.width = actionDefs[a].w + 'px';
    if (actionDefs[a].cls === 'go') {
      if (window.OPENTV_DESKTOP) {
        act.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span>Buscar</span>';
      } else {
        act.textContent = 'Busca';
      }
    } else {
      act.appendChild(el('div', 'ico'));
    }
    act._kind = actionDefs[a].cls;
    act._activate = (function (kind) {
      return function () {
        if (kind === 'switch') { toggleSearchNumeric(); }
        else if (kind === 'clear') { setSearchQuery(''); }
        else if (kind === 'del') { setSearchQuery(state.searchQuery.slice(0, -1)); }
        else {
          if (window.OPENTV_DESKTOP && searchInput) { state.searchQuery = searchInput.value; }
          runSearch();
        }
      };
    })(actionDefs[a].cls);
    actions.appendChild(act);
  }
  searchKeyboard.appendChild(actions);

  /* TVs: the on-screen keyboard on the left (core/tv-keyboard.js) instead
     of the text field, which opened the system keyboard over everything.
     The results on the right follow what is typed. */
  if (tvSearchKeyboardOn()) {
    searchKeyboard.classList.add('has-tvk');
    searchKeyboard.appendChild(el('div', 'tvk-title', 'Buscar'));
    searchTvKb = makeTvKeyboard({
      placeholder: 'Película, serie o actor',
      value: state.searchQuery,
      cls: 'is-search',
      onChange: onTvSearchTyped,
      doneLabel: 'Buscar',
      onDone: function () { if (String(state.searchQuery || '').trim()) { submitTvSearch(); } }
    });
    searchKeyboard.appendChild(searchTvKb.el);
    if (tvKeyIndex >= 0) {
      var again = searchTvKb.el.querySelectorAll('.tvk-key')[tvKeyIndex];
      if (again) { setFocus(again, true); }
    }
  }

  searchKeys = [];
  var rows = [
    ['A', 'Á', 'B', 'C', 'D', 'E', 'É'],
    ['F', 'G', 'H', 'I', 'Í', 'J', 'K'],
    ['L', 'M', 'N', 'Ñ', 'O', 'Ó', 'P'],
    ['Q', 'R', 'S', 'T', 'U', 'Ú', 'Ü'],
    ['V', 'W', 'X', 'Y', 'Z', ' ']
  ];
  for (var r = 0; r < rows.length; r++) {
    var row = el('div', 'kb-row');
    row.style.top = (264 + r * 88.5) + 'px';
    for (var c = 0; c < rows[r].length; c++) {
      var key = el('div', 'kb-key focusable' + (rows[r][c] === ' ' ? ' space' : ''),
        rows[r][c] === ' ' ? '' : rows[r][c]);
      key._char = rows[r][c];
      key._activate = (function (ch) {
        return function () { setSearchQuery(state.searchQuery + ch); };
      })(rows[r][c]);
      row.appendChild(key);
      searchKeys.push(key);
    }
    searchKeyboard.appendChild(row);
  }

  /* --- hot search grid (observed "Búsqueda popular", 10 portrait cells) --- */
  renderPopularSearch();

  searchResults.classList.remove('is-active');
  searchEmpty.classList.remove('is-active');
  searchHot.classList.remove('is-hidden');
  updateSearchInput();
}

/* ------------------------------------------------- TV on-screen keyboard */
var searchTvKb = null;

function tvSearchKeyboardOn() { return platformIsTv() && !!window.OPENTV_DESKTOP; }

/* Typing only edits the text: the addons are asked once, with the Buscar
   key (searching on every letter kept a Fire TV busy). Emptying it goes
   back to the popular titles. */
function onTvSearchTyped(text) {
  state.searchQuery = text;
  if (!text.trim()) { clearSearchState(); renderPopularSearch(); }
}

/* TV, the system keyboard's action key: search, close the keyboard and move
   to the first result as soon as there is one (renderDesktopSearchList). */
var tvSearchedQuery = '';
var tvFocusResults = false;
function submitTvSearch() {
  tvSearchedQuery = norm(String(state.searchQuery || '').trim());
  tvFocusResults = !!tvSearchedQuery;
  try { searchInput.blur(); } catch (eBlur) { /* ignore */ }
  runSearch();
}

function makeSearchCell(item, index) {
  var cell = el('div', 'search-cell');
  abs(cell, (index % 5) * 246, Math.floor(index / 5) * 437, 246, 437);
  cell.appendChild(makePoster(item, 0, 0, 222, 329, { gold: true }));
  cell.appendChild(el('div', 's-name', item.title));
  return cell;
}

function openSearch() {
  if (isKidsProfile()) { return; }   /* no search in a kids profile */
  if (!searchKeyboard) { buildSearch(); }
  showScreen('search');
  if (!state.searchQuery) { renderPopularSearch(); }
  if (searchTvKb) { setFocus(searchTvKb.first); return; }
  setFocus(searchInput);
  if (window.OPENTV_DESKTOP) searchInput.focus();
}

function popularSearchItems() {
  var featured = allVodFor('destacado');
  var out = featured && featured.length ? featured.slice(0, 10) : [];
  if (!out.length) { out = hotSearches(); }
  if (!out.length) { out = VOD.slice(0, 10); }
  return out;
}

function renderPopularSearch() {
  if (!searchHotGrid || state.searchQuery) { return; }
  clear(searchHotGrid);
  renderRecentSearches();
  var hotItems = popularSearchItems();
  for (var h = 0; h < hotItems.length; h++) {
    searchHotGrid.appendChild(makeSearchCell(hotItems[h], h));
  }
  schedulePosterMemoryPass();
}

function updateSearchInput() {
  if (!searchInput) { return; }
  if (searchTvKb && searchTvKb.get() !== (state.searchQuery || '')) { searchTvKb.set(state.searchQuery || ''); }
  if (window.OPENTV_DESKTOP && searchInput.tagName === 'INPUT') {
    if (searchInput.value !== state.searchQuery) searchInput.value = state.searchQuery;
    return;
  }
  if (state.searchQuery) {
    searchInput.textContent = state.searchQuery;
    searchInput.classList.remove('is-placeholder');
  } else {
    searchInput.textContent = 'Buscar películas, series, directores y actores.';
    searchInput.classList.add('is-placeholder');
  }
}

function setSearchQuery(q) {
  state.searchQuery = q;
  updateSearchInput();
  runSearch();
}

function clearSearchState() {
  if (state.searchTimer) { clearTimeout(state.searchTimer); state.searchTimer = null; }
  state.searchQuery = '';
  updateSearchInput();
  if (searchResultGrid) { clear(searchResultGrid); }
  state.searchMatches = [];
  state.searchPage = 0;
  if (searchNav) { searchNav.textContent = ''; }
  if (searchResults) { searchResults.classList.remove('is-active'); }
  if (searchEmpty) { searchEmpty.classList.remove('is-active'); }
  if (searchHot) { searchHot.classList.remove('is-hidden'); }
  state.searchSeq++;
  state.searchStatus = 'done';
  state.searchRemote = null;
  if (searchRequestTimeout) { clearTimeout(searchRequestTimeout); searchRequestTimeout = null; }
  updateSearchStateUi();
}

function runSearch() {
  var rawQ = state.searchQuery || '';
  var q = norm(rawQ.trim());
  if (!q) {
    clearSearchState();
    return;
  }
  /* Instant local matches (0ms response) */
  var localMatches = [];
  for (var i = 0; i < VOD.length; i++) {
    var tNorm = itemNorm(VOD[i], 'title');
    var aNorm = itemNorm(VOD[i], 'alias');
    if (tNorm.indexOf(q) !== -1 || (aNorm && aNorm.indexOf(q) !== -1)) {
      localMatches.push(VOD[i]);
    }
  }
  if (window.OPENTV_DESKTOP) { runDesktopSearch(rawQ, localMatches); return; }
  renderSearchResults(localMatches);

  /* Debounced search in the addons that can search (350 ms). */
  if (state.searchTimer) { clearTimeout(state.searchTimer); }
  if (q.length >= 2) {
    var seq = ++state.searchSeq;
    state.searchTimer = setTimeout(function () {
      searchTitles(rawQ.trim(), function (found) {
        if (seq !== state.searchSeq || !found.length) { return; }
        renderSearchResults(rankSearchResults(rawQ.trim(), localMatches.concat(found)));
      });
    }, 350);
  }
}
