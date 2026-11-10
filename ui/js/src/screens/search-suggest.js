/* screens/search-suggest.js — Escritorio: sugerencias mientras se escribe y búsquedas recientes.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* Suggestions come only from the catalogue already loaded in the app, so
   typing never sends anything to the server. The portal is asked once, on
   Enter or "Buscar", as before. */
var RECENT_SEARCH_KEY = 'opentv_recent_searches_v1';
var RECENT_SEARCH_MAX = 8;
var SUGGEST_MAX = 7;
var searchSuggestBox = null;
var searchSuggestItems = [];
var searchSuggestIndex = -1;
var searchRecentBox = null;

function recentSearches() {
  var list = safeLocalRead(RECENT_SEARCH_KEY, []);
  return Object.prototype.toString.call(list) === '[object Array]' ? list : [];
}

function rememberRecentSearch(query) {
  var q = String(query || '').replace(/\s+/g, ' ').trim();
  if (norm(q).length < 2) { return; }
  var list = recentSearches().filter(function (x) { return norm(x) !== norm(q); });
  list.unshift(q);
  safeLocalWrite(RECENT_SEARCH_KEY, list.slice(0, RECENT_SEARCH_MAX));
}

function forgetRecentSearch(query) {
  safeLocalWrite(RECENT_SEARCH_KEY, recentSearches().filter(function (x) { return x !== query; }));
  renderRecentSearches();
}

function searchFor(query) {
  state.searchQuery = query;
  updateSearchInput();
  hideSearchSuggest();
  runSearch();
}

/* "Búsquedas recientes" chips above the popular titles. */
function renderRecentSearches() {
  if (!window.XUPER_DESKTOP || !searchHot) { return; }
  if (!searchRecentBox || searchRecentBox.parentNode !== searchHot) {
    searchRecentBox = el('div', 'search-recent');
    searchHot.insertBefore(searchRecentBox, searchHot.firstChild);
  }
  clear(searchRecentBox);
  var list = recentSearches();
  searchRecentBox.hidden = !list.length;
  if (!list.length) { return; }
  var head = el('div', 'sr-recent-head');
  head.appendChild(el('div', 'sr-recent-title', 'Búsquedas recientes'));
  var wipe = el('button', 'sr-recent-clear focusable', 'Borrar todo');
  wipe.type = 'button';
  wipe._activate = function () { safeLocalWrite(RECENT_SEARCH_KEY, []); renderRecentSearches(); setFocus(searchInput, true); };
  head.appendChild(wipe);
  searchRecentBox.appendChild(head);
  var chips = el('div', 'sr-recent-chips');
  list.forEach(function (q) {
    var chip = el('div', 'sr-chip focusable');
    chip.innerHTML = UI_ICONS.history;
    chip.appendChild(el('span', 'sr-chip-text', q));
    var x = el('button', 'sr-chip-x');
    x.type = 'button';
    x.innerHTML = UI_ICONS.close;
    x.setAttribute('data-tip', 'Quitar');
    x.addEventListener('click', function (event) { event.stopPropagation(); forgetRecentSearch(q); });
    chip.appendChild(x);
    chip._activate = function () { searchFor(q); };
    chips.appendChild(chip);
  });
  searchRecentBox.appendChild(chips);
}

/* Best local matches: title start, then a word start, then anywhere. */
function localSuggestions(raw) {
  var q = norm(String(raw || '').trim());
  if (q.length < 2) { return []; }
  var buckets = [[], [], []];
  var seen = {};
  var pool = VOD.slice();
  var srcCfg = typeof getVodSourcesConfig === 'function' ? getVodSourcesConfig() : { mode: 'auto' };
  if (srcCfg.mode !== 'external' && localProfile && localProfile.history) {
    for (var h = 0; h < localProfile.history.length; h++) {
      var hr = localProfile.history[h];
      if (hr && hr.id && hr.title && !hr.stremio && String(hr.id).indexOf('stremio:') !== 0) {
        var histItem = normalizeVod({
          id: hr.id,
          title: hr.title,
          poster: hr.poster,
          landscape: hr.landscape,
          type: hr.series ? 'teleplay' : 'movie',
          portal: true
        }, 0);
        histItem._portal = true;
        pool.push(histItem);
      }
    }
  }
  for (var i = 0; i < pool.length; i++) {
    var item = pool[i];
    var t = norm(item.title || '');
    var a = item.alias ? norm(item.alias) : '';
    var key = t + '|' + (isSeriesItem(item) ? 's' : 'm');
    if (seen[key]) { continue; }
    var rank = -1;
    if (t.indexOf(q) === 0 || (a && a.indexOf(q) === 0)) { rank = 0; }
    else if (t.indexOf(' ' + q) !== -1 || (a && a.indexOf(' ' + q) !== -1)) { rank = 1; }
    else if (t.indexOf(q) !== -1 || (a && a.indexOf(q) !== -1)) { rank = 2; }
    if (rank < 0) { continue; }
    seen[key] = true;
    buckets[rank].push(item);
  }
  return buckets[0].concat(buckets[1], buckets[2]).slice(0, SUGGEST_MAX);
}

function ensureSearchSuggestBox() {
  /* The search screen is rebuilt when a new catalogue arrives. */
  if (searchSuggestBox && searchSuggestBox.parentNode === searchKeyboard) { return searchSuggestBox; }
  searchSuggestBox = el('div', 'search-suggest');
  /* Keep the field focused while choosing with the mouse. */
  searchSuggestBox.addEventListener('mousedown', function (event) { event.preventDefault(); });
  searchKeyboard.appendChild(searchSuggestBox);
  return searchSuggestBox;
}

function suggestRow(cls, iconHtml, title, meta, run) {
  var row = el('div', 'ss-item ' + cls);
  var ico = el('div', 'ss-ico');
  ico.innerHTML = iconHtml;
  row.appendChild(ico);
  var text = el('div', 'ss-text');
  text.appendChild(el('div', 'ss-title', title));
  if (meta) { text.appendChild(el('div', 'ss-meta', meta)); }
  row.appendChild(text);
  row._run = run;
  row.addEventListener('click', function () { run(); });
  row.addEventListener('mousemove', function () {
    var idx = searchSuggestItems.indexOf(row);
    if (idx !== searchSuggestIndex) { highlightSuggest(idx); }
  });
  return row;
}

function updateSearchSuggest() {
  if (!window.XUPER_DESKTOP || !searchInput) { return; }
  var raw = searchInput.value;
  var q = String(raw || '').trim();
  var box = ensureSearchSuggestBox();
  clear(box);
  searchSuggestItems = [];
  searchSuggestIndex = -1;
  var rows = [];
  if (!q) {
    /* Empty field: offer the recent searches. */
    recentSearches().slice(0, 6).forEach(function (r) {
      rows.push(suggestRow('is-recent', UI_ICONS.history, r, '', function () { searchFor(r); }));
    });
  } else if (norm(q).length >= 2) {
    rows.push(suggestRow('is-query', UI_ICONS.search, 'Buscar «' + q + '»', 'En todo el catálogo', function () { searchFor(q); }));
    localSuggestions(q).forEach(function (item) {
      var bits = [];
      var year = String(item.year || '').match(/\d{4}/);
      bits.push(isSeriesItem(item) ? 'Serie' : 'Película');
      if (year) { bits.push(year[0]); }
      var thumb = item.poster ? '<img alt="" src="' + String(item.poster).replace(/"/g, '&quot;') + '">' : UI_ICONS.play;
      var row = suggestRow('is-title', thumb, item.title, bits.join(' · '), function () {
        rememberRecentSearch(item.title);
        hideSearchSuggest();
        openDetail(item);
      });
      var img = row.querySelector('img');
      if (img) { img.onerror = function () { img.parentNode.innerHTML = UI_ICONS.play; }; }
      rows.push(row);
    });
  }
  if (!rows.length) { hideSearchSuggest(); return; }
  if (!q) { box.appendChild(el('div', 'ss-head', 'Búsquedas recientes')); }
  rows.forEach(function (r) { box.appendChild(r); searchSuggestItems.push(r); });
  box.classList.add('is-open');
}

function highlightSuggest(idx) {
  searchSuggestIndex = idx;
  for (var i = 0; i < searchSuggestItems.length; i++) {
    searchSuggestItems[i].classList.toggle('is-active', i === idx);
  }
}

function hideSearchSuggest() {
  if (searchSuggestBox) { searchSuggestBox.classList.remove('is-open'); }
  searchSuggestIndex = -1;
}

/* Arrow keys / Enter / Esc while the list is open. Returns true when the
   key was used. */
function searchSuggestKey(event) {
  if (!searchSuggestBox || !searchSuggestBox.classList.contains('is-open') || !searchSuggestItems.length) { return false; }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    highlightSuggest((searchSuggestIndex + 1) % searchSuggestItems.length);
    return true;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    highlightSuggest(searchSuggestIndex <= 0 ? searchSuggestItems.length - 1 : searchSuggestIndex - 1);
    return true;
  }
  if (event.key === 'Enter' && searchSuggestIndex >= 0) {
    event.preventDefault();
    searchSuggestItems[searchSuggestIndex]._run();
    return true;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    hideSearchSuggest();
    return true;
  }
  return false;
}
