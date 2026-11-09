/* screens/search.js — Búsqueda: campo, teclado de TV, populares y búsqueda local + portal.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ================================================================ SEARCH */
function hotSearches() {
  var all = bundledCatalog();
  var out = [];
  for (var i = 0; i < all.length; i++) {
    var cat = String((all[i] && all[i].category) || '').toLowerCase();
    if (cat.indexOf('busqueda') !== -1) { out.push(normalizeVod(all[i], i + 1)); }
  }
  return out;
}

function buildSearch() {
  searchKeyboard = $('search-keyboard');
  searchHot = $('search-hot');
  searchResults = $('search-results');
  searchEmpty = $('search-empty');
  searchHotGrid = $('search-hot-grid');
  searchResultGrid = $('search-result-grid');
  searchNav = $('search-nav');
  clear(searchKeyboard); clear(searchHotGrid); clear(searchResultGrid);
  /* Result rows can extend beyond the first screen.  Mark their viewport as
     scrollable so reveal() follows D-pad focus down through every result. */
  if (searchResults) { searchResults.classList.add('scrollable'); }
  if (window.XUPER_DESKTOP && searchHot) { searchHot.classList.add('scrollable'); }
  if (window.XUPER_DESKTOP && searchResults && !searchStateBox) {
    /* Centered state (Buscando… / error) and a small line under the counter. */
    searchStateBox = el('div', 'search-state');
    searchResults.appendChild(searchStateBox);
    searchInlineState = el('div', 'search-inline-state');
    searchResults.appendChild(searchInlineState);
  }

  /* --- keyboard panel (layout_search_keybord_full_uni) --- */
  searchInput = el(window.XUPER_DESKTOP ? 'input' : 'div', 'kb-edit focusable');
  if (window.XUPER_DESKTOP) {
    searchInput.type = 'search';
    searchInput.id = 'desktop-search-input';
    searchInput.placeholder = 'Buscar películas o series';
    searchInput.setAttribute('aria-label', 'Buscar películas o series');
    searchInput.autocomplete = 'off';
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
      if (searchSuggestKey(event)) { event.stopPropagation(); return; }
      if (event.key === 'Enter') { event.preventDefault(); state.searchQuery = searchInput.value; runSearch(); }
      if (event.key === 'Escape') { searchInput.blur(); back(); }
      event.stopPropagation();
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
      if (window.XUPER_DESKTOP) {
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
          if (window.XUPER_DESKTOP && searchInput) { state.searchQuery = searchInput.value; }
          runSearch();
        }
      };
    })(actionDefs[a].cls);
    actions.appendChild(act);
  }
  searchKeyboard.appendChild(actions);

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

  var feedback = el('div', 'kb-feedback focusable', 'Diagnóstico');
  feedback._activate = openDesktopDiagnostic;
  searchKeyboard.appendChild(feedback);

  /* --- hot search grid (observed "Búsqueda popular", 10 portrait cells) --- */
  renderPopularSearch();

  searchResults.classList.remove('is-active');
  searchEmpty.classList.remove('is-active');
  searchHot.classList.remove('is-hidden');
  updateSearchInput();
}

function makeSearchCell(item, index) {
  var cell = el('div', 'search-cell');
  abs(cell, (index % 5) * 246, Math.floor(index / 5) * 437, 246, 437);
  cell.appendChild(makePoster(item, 0, 0, 222, 329, { gold: true }));
  cell.appendChild(el('div', 's-name', item.title));
  return cell;
}

function openSearch() {
  if (!searchKeyboard) { buildSearch(); }
  showScreen('search');
  if (!state.searchQuery) { renderPopularSearch(); }
  setFocus(searchInput);
  if (window.XUPER_DESKTOP) searchInput.focus();
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
  if (window.XUPER_DESKTOP && searchInput.tagName === 'INPUT') {
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
    var tNorm = norm(VOD[i].title || '');
    var aNorm = VOD[i].alias ? norm(VOD[i].alias) : '';
    if (tNorm.indexOf(q) !== -1 || (aNorm && aNorm.indexOf(q) !== -1)) {
      localMatches.push(VOD[i]);
    }
  }
  if (window.XUPER_DESKTOP) { runDesktopSearch(rawQ, localMatches); return; }
  renderSearchResults(localMatches);

  /* Debounced remote portal search (350ms) */
  if (state.searchTimer) { clearTimeout(state.searchTimer); }
  if (vodApi.mode === 'portal' && q.length >= 2) {
    var seq = ++state.searchSeq;
    state.searchTimer = setTimeout(function () {
      portalServiceCall('search', { value: rawQ.trim() }, function (error, payload) {
        if (seq !== state.searchSeq) { return; }
        if (error || !payload || payload.returnValue === false || !payload.items || !payload.items.length) {
          /* Keep existing local matches, never clear on empty remote response */
          return;
        }
        var merged = localMatches.slice();
        var seen = {};
        for (var m = 0; m < merged.length; m++) { seen[String(merged[m].id)] = true; }
        for (var p = 0; p < payload.items.length; p++) {
          var item = normalizeVod(payload.items[p], merged.length + 1);
          if (!seen[String(item.id)]) {
            seen[String(item.id)] = true;
            merged.push(item);
          }
        }
        renderSearchResults(merged);
      });
    }, 350);
  }
}
