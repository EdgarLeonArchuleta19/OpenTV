/* live/guide.js — Escritorio: guía de canales (cuadrícula con buscador), favoritos y recientes.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* The M3U lists bring no programme schedule (EPG), only the channels, so the
   guide lists channels: by the lists' categories (group-title), with a name
   filter, the favourites and the channels watched last. Favourites and
   recents are kept with their link, so they play from any category. */
var LIVE_SAVED_KEY = 'opentv_live_saved_v1';
var LIVE_RECENT_MAX = 24;
var LIVE_SAVED_CATS = {
  favs: { id: 'saved:favs', name: 'Favoritos', isSaved: 'favs' },
  recent: { id: 'saved:recent', name: 'Recientes', isSaved: 'recent' }
};

function liveSaved() {
  var s = safeLocalRead(LIVE_SAVED_KEY, null);
  if (!s || typeof s !== 'object') { s = {}; }
  if (Object.prototype.toString.call(s.favs) !== '[object Array]') { s.favs = []; }
  if (Object.prototype.toString.call(s.recent) !== '[object Array]') { s.recent = []; }
  return s;
}

function savedChannelCopy(ch) {
  var out = { channelCode: ch.channelCode || '', name: ch.name || 'Canal', logo: ch.logo || '', uhd: !!ch.uhd };
  if (ch.streamUrl) { out.streamUrl = ch.streamUrl; }
  return out;
}

function sameChannel(a, b) {
  return !!(a && b) && liveChannelKey(a) !== '' && liveChannelKey(a) === liveChannelKey(b);
}

function rememberLiveChannel(ch) {
  if (!window.OPENTV_DESKTOP || !ch || !liveChannelKey(ch)) { return; }
  var s = liveSaved();
  s.recent = s.recent.filter(function (x) { return !sameChannel(x, ch); });
  s.recent.unshift(savedChannelCopy(ch));
  s.recent = s.recent.slice(0, LIVE_RECENT_MAX);
  safeLocalWrite(LIVE_SAVED_KEY, s);
}

function syncSavedFavorite(ch, on) {
  if (!window.OPENTV_DESKTOP || !ch || !liveChannelKey(ch)) { return; }
  var s = liveSaved();
  s.favs = s.favs.filter(function (x) { return !sameChannel(x, ch); });
  if (on) { s.favs.unshift(savedChannelCopy(ch)); }
  safeLocalWrite(LIVE_SAVED_KEY, s);
}

function toggleLiveFavorite(ch) {
  if (!ch) { return false; }
  var key = liveFavKey(ch);
  var on = !(ch.fav || state.favs[key]);
  if (!!state.favs[key] !== on) { toggleFavorite({ id: key }); }
  /* Earlier versions saved M3U favourites as 'live:m3u_N' (the position in
     a list): drop that key when the channel stops being a favourite. */
  var legacy = ch.channelCode ? 'live:' + ch.channelCode : '';
  if (!on && legacy && legacy !== key && state.favs[legacy]) { toggleFavorite({ id: legacy }); }
  ch.fav = on;
  syncSavedFavorite(ch, ch.fav);
  syncLiveFavButton();
  return ch.fav;
}

/* Shows the saved list as the current channel list. */
function loadSavedChannels(kind, done) {
  var keepPlaying = livePlayingToKeep();
  var list = liveSaved()[kind] || [];
  CHANNELS.splice(0, CHANNELS.length);
  var favUrls = liveFavoriteUrls();
  for (var i = 0; i < list.length; i++) {
    /* Channels saved from the old portal have no link and cannot play. */
    if (!list[i] || !list[i].streamUrl) { continue; }
    var ch = savedChannelCopy(list[i]);
    ch.index = CHANNELS.length + 1;
    ch.now = 'En vivo';
    ch.fav = !!(favUrls[ch.streamUrl] || state.favs[liveFavKey(ch)]);
    CHANNELS.push(ch);
  }
  state.channel = 0;
  if (keepPlaying && CHANNELS.length) { keepLivePlayingChannel(keepPlaying); }
  renderLiveRows(false);
  renderPlayerChannels();
  if (CHANNELS[state.channel]) {
    setLiveInfoText(CHANNELS[state.channel].name);
    if (state.screen === 'player' && state.playerMode === 'live') { updatePlayer(); if (!keepPlaying) { startLiveChannel(CHANNELS[0], true); } }
    else { scheduleLivePreview(CHANNELS[state.channel]); }
  }
  syncLiveFavButton();
  if (done) { done(); }
}

/* ------------------------------------------------------------------ guide */
var liveGuideOpen = false;
var liveGuide = null, liveGuideCats = null, liveGuideGrid = null, liveGuideCount = null, liveGuideSearch = null;
var liveGuideReturnFocus = null;

function buildLiveGuide() {
  liveGuide = el('div', 'live-guide');
  liveGuide.setAttribute('data-no-gesture', '');
  var panel = el('div', 'lg-panel');
  var head = el('div', 'lg-head');
  var titles = el('div', 'lg-titles');
  titles.appendChild(el('div', 'lg-title', 'Guía de canales'));
  liveGuideCount = el('div', 'lg-count', '');
  titles.appendChild(liveGuideCount);
  head.appendChild(titles);
  liveGuideSearch = document.createElement('input');
  liveGuideSearch.type = 'search';
  liveGuideSearch.className = 'lg-search focusable';
  liveGuideSearch.placeholder = 'Buscar canal';
  liveGuideSearch.setAttribute('aria-label', 'Buscar canal');
  liveGuideSearch.autocomplete = 'off';
  liveGuideSearch.addEventListener('input', renderLiveGuideGrid);
  liveGuideSearch.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeLiveGuide(); return; }
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.keyCode === 13) {
      event.preventDefault();
      guideSearchToResults();
    } else if (platformIsTv() && /^Arrow(Up|Left|Right)$/.test(event.key)) {
      /* TV, keyboard closed: the remote's arrows leave the field like any
         other control (the page key handler ignores text fields). */
      event.preventDefault();
      liveGuideSearch.blur();
      moveFocus(event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowLeft' ? 'left' : 'right');
    }
    event.stopPropagation();
  });
  /* TV: the system keyboard's "Listo" may only close it (no Enter). */
  liveGuideSearch.addEventListener('change', function () {
    if (platformIsTv()) { guideSearchToResults(); }
  });
  liveGuideSearch._activate = function () {
    /* TVs: the on-screen keyboard (core/tv-keyboard.js) over the category
       column; the channels on the right are filtered while typing. */
    if (platformIsTv()) { openGuideKeyboard(panel); return; }
    liveGuideSearch.focus();
  };
  head.appendChild(liveGuideSearch);
  var close = el('button', 'lg-close focusable');
  close.type = 'button';
  close.innerHTML = UI_ICONS.close;
  close.setAttribute('data-tip', 'Cerrar (Esc)');
  close._activate = closeLiveGuide;
  head.appendChild(close);
  panel.appendChild(head);

  var body = el('div', 'lg-body');
  liveGuideCats = el('div', 'lg-cats scrollable');
  body.appendChild(liveGuideCats);
  liveGuideGrid = el('div', 'lg-grid scrollable');
  liveGuideGrid.addEventListener('scroll', guideNeedMore, { passive: true });
  body.appendChild(liveGuideGrid);
  panel.appendChild(body);
  liveGuide.appendChild(panel);
  liveGuide.addEventListener('click', function (event) {
    if (event.target === liveGuide) { closeLiveGuide(); }
  });
  ($('screen-home') || document.body).appendChild(liveGuide);
}

/* The guide's on-screen keyboard (TVs). Typing only edits the text; the
   channels are filtered once, with the Buscar key (a batch of cards per
   letter kept a Fire TV busy). */
function openGuideKeyboard(panel) {
  openTvKeyboardPanel(panel, {
    title: 'Buscar canal',
    placeholder: 'Nombre del canal',
    value: liveGuideSearch.value,
    cls: 'is-guide',
    cover: liveGuideCats,
    hostClass: 'is-typing',
    doneLabel: 'Buscar',
    /* (Back closes it without changing the search.) */
    onDone: function (v) {
      liveGuideSearch.value = v;
      renderLiveGuideGrid();
      guideSearchToResults();
    }
  });
}

function openLiveGuide() {
  if (!window.OPENTV_DESKTOP) { return; }
  if (!liveGuide || !liveGuide.isConnected) { buildLiveGuide(); }
  liveGuideOpen = true;
  liveGuideReturnFocus = state.focus;
  liveGuideSearch.value = '';
  renderLiveGuideCats();
  renderLiveGuideGrid();
  liveGuide.classList.add('is-open');
  document.body.classList.add('has-live-guide');
  var current = liveGuideGrid.querySelector('.lg-card.is-current') || liveGuideGrid.querySelector('.lg-card');
  if (current) {
    setFocus(current, true);
    setTimeout(function () { reveal(current); }, 0);
  }
}

function closeLiveGuide() {
  if (!liveGuideOpen) { return; }
  liveGuideOpen = false;
  closeTvKeyboardPanel(true);
  if (liveGuide) { liveGuide.classList.remove('is-open'); }
  document.body.classList.remove('has-live-guide');
  if (liveGuideSearch) { liveGuideSearch.blur(); }
  var back = liveGuideReturnFocus && liveGuideReturnFocus.isConnected ? liveGuideReturnFocus : liveFocus;
  if (back) { setFocus(back, true); }
}

function guideCategories() {
  var groups = [{ title: '', items: [] }, { title: 'Categorías', items: [] }];
  groups[0].items.push({ cat: LIVE_ALL_CATEGORY, label: 'Todos' });
  for (var i = 0; i < liveCategories.length; i++) {
    var c = liveCategories[i];
    if (c.id !== LIVE_ALL_CATEGORY.id) { groups[1].items.push({ cat: c, label: c.name }); }
  }
  groups[0].items.push({ cat: LIVE_SAVED_CATS.favs, label: 'Favoritos', icon: UI_ICONS.star });
  groups[0].items.push({ cat: LIVE_SAVED_CATS.recent, label: 'Recientes', icon: UI_ICONS.history });
  return groups;
}

function renderLiveGuideCats() {
  if (!liveGuideCats) { return; }
  clear(liveGuideCats);
  guideCategories().forEach(function (g) {
    if (!g.items.length) { return; }
    if (g.title) { liveGuideCats.appendChild(el('div', 'lg-cat-label', g.title)); }
    g.items.forEach(function (it) {
      var selected = currentLiveCategory && (currentLiveCategory === it.cat || currentLiveCategory.id === it.cat.id);
      var b = el('div', 'lg-cat focusable' + (selected ? ' is-selected' : ''));
      if (it.icon) { b.innerHTML = it.icon; }
      b.appendChild(el('span', '', it.label));
      b._catId = it.cat.id || it.label;
      b._activate = function () {
        liveGuideSearch.value = '';
        switchLiveCategory(it.cat, function () { renderLiveGuideGrid(); });
        renderLiveGuideCats();
        renderLiveDockCats();
        renderLiveGuideGrid();
        /* The list was rebuilt: focus the new button of this category, not
           the old one (detached, the next arrow would leave the guide). */
        focusGuideCategory(b._catId);
      };
      liveGuideCats.appendChild(b);
    });
  });
}

/* From the guide's search field to the first channel found. */
function guideSearchToResults() {
  if (!liveGuideOpen) { return; }
  var first = liveGuideGrid.querySelector('.lg-card');
  liveGuideSearch.blur();
  if (first) { setFocusRingVisible(true); setFocus(first); }
  /* Nothing found: back on the search field (the keyboard's panel that had
     the focus is gone), to try another name. */
  else { setFocus(liveGuideSearch); }
}

function focusGuideCategory(catId) {
  var cats = liveGuideCats ? liveGuideCats.querySelectorAll('.lg-cat') : [];
  for (var i = 0; i < cats.length; i++) {
    if (cats[i]._catId === catId) { setFocus(cats[i], true); return; }
  }
  if (cats[0]) { setFocus(cats[0], true); }
}

/* Somewhere to put the focus back inside the open guide (a rebuilt card or
   category, a key that tried to leave it). */
function guideFocusFallback() {
  if (!liveGuide) { return null; }
  return liveGuide.querySelector('.lg-card.is-focused') || liveGuide.querySelector('.lg-cat.is-selected') ||
    liveGuideGrid.querySelector('.lg-card.is-current') || liveGuideGrid.querySelector('.lg-card') || liveGuide.querySelector('.focusable');
}

var GUIDE_BATCH = 36;
var guideIndexes = [];   /* CHANNELS indexes shown in the grid (search applied) */
var guideShown = 0;      /* how many of them have a card */

function appendGuideCards(upTo) {
  var end = Math.min(upTo, guideIndexes.length);
  if (end <= guideShown) { return; }
  var frag = document.createDocumentFragment();
  for (var i = guideShown; i < end; i++) {
    var card = makeGuideCard(CHANNELS[guideIndexes[i]], guideIndexes[i]);
    card._guidePos = i;
    frag.appendChild(card);
  }
  guideShown = end;
  liveGuideGrid.appendChild(frag);
}

/* Near the end of what is drawn (scrolling, or the remote going down). */
function guideNeedMore() {
  if (!liveGuideGrid || guideShown >= guideIndexes.length) { return; }
  if (liveGuideGrid.scrollTop + liveGuideGrid.clientHeight > liveGuideGrid.scrollHeight - 600) {
    appendGuideCards(guideShown + GUIDE_BATCH);
  }
}

function renderLiveGuideGrid() {
  if (!liveGuideOpen || !liveGuideGrid) { return; }
  var keep = liveGuideGrid.scrollTop;
  var focusedKey = state.focus && state.focus._guideKey;
  clear(liveGuideGrid);
  var q = norm(String(liveGuideSearch.value || '').trim());
  /* The channels that match; their cards are drawn in batches (a category
     can hold 760 channels, about 7,000 elements at once on a Fire TV). */
  guideIndexes = [];
  var want = GUIDE_BATCH;
  for (var i = 0; i < CHANNELS.length; i++) {
    var ch = CHANNELS[i];
    if (q && itemNorm(ch, 'name').indexOf(q) === -1) { continue; }
    /* Far enough to include the channel playing and the focused card. */
    if (i === state.channel || (focusedKey && liveChannelKey(ch) === focusedKey)) { want = Math.max(want, guideIndexes.length + 13); }
    guideIndexes.push(i);
  }
  guideShown = 0;
  appendGuideCards(want);
  var shown = guideIndexes.length;
  if (!shown) {
    var msg = q ? 'Ningún canal coincide con «' + liveGuideSearch.value.trim() + '»'
      : currentLiveCategory && currentLiveCategory.isSaved === 'favs' && !platformIsTv()
        ? 'Aún no tienes canales favoritos. Pasa el ratón por un canal y toca la estrella.'
      : liveEmptyMessage();
    var empty = el('div', 'lg-empty', msg);
    if (!CHANNELS.length && liveChannelsLoading) { empty.insertBefore(el('i', 'tv-loader'), empty.firstChild); }
    if (!q && liveNeedsLists() && !(currentLiveCategory && currentLiveCategory.isSaved)) {
      empty.appendChild(document.createElement('br'));
      var addBtn = makeLiveListsButton();
      var baseActivate = addBtn._activate;
      addBtn._activate = function () { closeLiveGuide(); baseActivate(); };
      empty.appendChild(addBtn);
    }
    liveGuideGrid.appendChild(empty);
  }
  var name = currentLiveCategory ? currentLiveCategory.name : 'Todos';
  liveGuideCount.textContent = name + ' · ' + (q ? shown + ' de ' + CHANNELS.length : CHANNELS.length) + (CHANNELS.length === 1 && !q ? ' canal' : ' canales') +
    (liveChannelsLoading ? ' · cargando…' : '');
  liveGuideGrid.scrollTop = keep;
  if (focusedKey) {
    var again = liveGuideGrid.querySelector('[data-key="' + String(focusedKey).replace(/"/g, '') + '"]');
    if (again) { setFocus(again, true); }
  }
}

function makeGuideCard(ch, idx) {
  var card = el('div', 'lg-card focusable' + (idx === state.channel ? ' is-current' : ''));
  card._guideKey = liveChannelKey(ch) || ('i' + idx);
  card.setAttribute('data-key', String(card._guideKey).replace(/"/g, ''));
  var logo = el('div', 'lg-logo');
  if (ch.logo) { logo.style.backgroundImage = 'url("' + String(ch.logo).replace(/"/g, '%22') + '")'; }
  else { logo.appendChild(el('span', 'lg-initial', String(ch.name || '?').charAt(0).toUpperCase())); }
  card.appendChild(logo);
  var info = el('div', 'lg-info');
  info.appendChild(el('div', 'lg-name', ch.name || 'Canal'));
  var meta = el('div', 'lg-meta');
  meta.appendChild(el('span', 'lg-live', idx === state.channel ? 'Viendo ahora' : 'En vivo'));
  if (ch.uhd) { meta.appendChild(el('span', 'lg-badge', '4K')); }
  info.appendChild(meta);
  card.appendChild(info);

  var fav = el('button', 'lg-fav' + (ch.fav ? ' is-on' : ''));
  fav.type = 'button';
  fav.innerHTML = UI_ICONS.star;
  fav.setAttribute('data-tip', ch.fav ? 'Quitar de favoritos' : 'Añadir a favoritos');
  fav.addEventListener('click', function (event) {
    event.stopPropagation();
    var on = toggleLiveFavorite(ch);
    fav.classList.toggle('is-on', on);
    fav.setAttribute('data-tip', on ? 'Quitar de favoritos' : 'Añadir a favoritos');
  });
  card.appendChild(fav);
  var big = el('button', 'lg-open');
  big.type = 'button';
  big.innerHTML = UI_ICONS.fullscreen;
  big.setAttribute('data-tip', 'Ver en pantalla grande');
  big.addEventListener('click', function (event) {
    event.stopPropagation();
    closeLiveGuide();
    setChannel(idx, true);
    openPlayer('live');
  });
  card.appendChild(big);

  /* Up from the first row goes to the search field (it went to the
     category list, the nearest by distance). */
  card._onMove = function (dir) {
    var first = liveGuideGrid.querySelector('.lg-card');
    if (dir === 'up' && first && card.offsetTop <= first.offsetTop + 2) { setFocus(liveGuideSearch); return true; }
    /* Down near the last drawn row: draw the next batch first. */
    if (dir === 'down' && card._guidePos >= guideShown - 6) { appendGuideCards(guideShown + GUIDE_BATCH); }
    return false;
  };
  card._activate = function () {
    closeLiveGuide();
    if (idx !== state.channel) { setChannel(idx, true); }
    else if (focusRingVisible) { openPlayer('live'); }
  };
  card.addEventListener('dblclick', function () { closeLiveGuide(); setChannel(idx, true); openPlayer('live'); });
  return card;
}

function installLiveGuide() {
  if (!window.OPENTV_DESKTOP) { return; }
  document.addEventListener('keydown', function (event) {
    if (!liveGuideOpen) {
      /* G opens the guide from the TV tab. */
      if ((event.key === 'g' || event.key === 'G') && !event.ctrlKey && !event.altKey && state.screen === 'home' && onTvTab() &&
          !(document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName))) {
        event.preventDefault();
        openLiveGuide();
      }
      return;
    }
    if (event.key === 'Escape' || event.key === 'Backspace') {
      if (document.activeElement === liveGuideSearch && event.key === 'Backspace') { return; }
      event.preventDefault();
      event.stopPropagation();
      closeLiveGuide();
    }
  }, true);
}
