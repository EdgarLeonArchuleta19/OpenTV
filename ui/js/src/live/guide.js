/* live/guide.js — Escritorio: guía de canales (cuadrícula con buscador), favoritos y recientes.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* The portal sends no programme schedule (EPG) for its channels, only the
   channel itself, so the guide lists channels: by country/theme, with a
   name filter, the favourites and the channels watched last. Favourites and
   recents are kept with the data needed to play them from any category. */
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
  if (!window.XUPER_DESKTOP || !ch || !liveChannelKey(ch)) { return; }
  var s = liveSaved();
  s.recent = s.recent.filter(function (x) { return !sameChannel(x, ch); });
  s.recent.unshift(savedChannelCopy(ch));
  s.recent = s.recent.slice(0, LIVE_RECENT_MAX);
  safeLocalWrite(LIVE_SAVED_KEY, s);
}

function syncSavedFavorite(ch, on) {
  if (!window.XUPER_DESKTOP || !ch || !liveChannelKey(ch)) { return; }
  var s = liveSaved();
  s.favs = s.favs.filter(function (x) { return !sameChannel(x, ch); });
  if (on) { s.favs.unshift(savedChannelCopy(ch)); }
  safeLocalWrite(LIVE_SAVED_KEY, s);
}

function toggleLiveFavorite(ch) {
  if (!ch) { return false; }
  ch.fav = toggleFavorite({ id: liveFavKey(ch) });
  syncSavedFavorite(ch, ch.fav);
  syncLiveFavButton();
  return ch.fav;
}

/* Shows the saved list as the current channel list. */
function loadSavedChannels(kind, done) {
  var list = liveSaved()[kind] || [];
  CHANNELS.splice(0, CHANNELS.length);
  for (var i = 0; i < list.length; i++) {
    var ch = savedChannelCopy(list[i]);
    ch.index = i + 1;
    ch.now = 'En vivo';
    ch.fav = !!state.favs[liveFavKey(ch)];
    CHANNELS.push(ch);
  }
  state.channel = 0;
  liveChannelsLoaded = true;
  liveChannelsLoading = false;
  liveChannelRequestSeq++;
  renderLiveRows(false);
  renderPlayerChannels();
  if (CHANNELS[0]) {
    if (liveInfoText) { liveInfoText.textContent = CHANNELS[0].name; }
    if (state.screen === 'player' && state.playerMode === 'live') { updatePlayer(); startLiveChannel(CHANNELS[0], true); }
    else { scheduleLivePreview(CHANNELS[0]); }
  } else if (liveList) {
    clear(liveList);
    liveList.appendChild(el('div', 'live-list-status', kind === 'favs'
      ? 'Aún no tienes canales favoritos. Usa la estrella para guardar uno.'
      : 'Aquí aparecerán los últimos canales que veas.'));
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
    if (event.key === 'ArrowDown' || event.key === 'Enter') {
      event.preventDefault();
      var first = liveGuideGrid.querySelector('.lg-card');
      if (first) { liveGuideSearch.blur(); setFocusRingVisible(true); setFocus(first); }
    }
    event.stopPropagation();
  });
  liveGuideSearch._activate = function () { liveGuideSearch.focus(); };
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
  body.appendChild(liveGuideGrid);
  panel.appendChild(body);
  liveGuide.appendChild(panel);
  liveGuide.addEventListener('click', function (event) {
    if (event.target === liveGuide) { closeLiveGuide(); }
  });
  ($('screen-home') || document.body).appendChild(liveGuide);
}

function openLiveGuide() {
  if (!window.XUPER_DESKTOP) { return; }
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
  if (liveGuide) { liveGuide.classList.remove('is-open'); }
  document.body.classList.remove('has-live-guide');
  if (liveGuideSearch) { liveGuideSearch.blur(); }
  var back = liveGuideReturnFocus && liveGuideReturnFocus.isConnected ? liveGuideReturnFocus : liveFocus;
  if (back) { setFocus(back, true); }
}

function guideCategories() {
  var groups = [{ title: '', items: [] }, { title: 'Países', items: [] }, { title: 'Temas', items: [] }];
  for (var i = 0; i < liveCategories.length; i++) {
    var c = liveCategories[i];
    if (c.name === 'Todos') { groups[0].items.push({ cat: c, label: 'Todos' }); }
    else if (LIVE_COUNTRIES.indexOf(c.name) !== -1) { groups[1].items.push({ cat: c, label: c.name }); }
    else { groups[2].items.push({ cat: c, label: c.isAddon ? 'Mis listas M3U' : c.name }); }
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
      b._activate = function () {
        liveGuideSearch.value = '';
        switchLiveCategory(it.cat, function () { renderLiveGuideGrid(); });
        renderLiveGuideCats();
        renderLiveDockCats();
        renderLiveGuideGrid();
        setFocus(b, true);
      };
      liveGuideCats.appendChild(b);
    });
  });
}

function renderLiveGuideGrid() {
  if (!liveGuideOpen || !liveGuideGrid) { return; }
  var keep = liveGuideGrid.scrollTop;
  var focusedKey = state.focus && state.focus._guideKey;
  clear(liveGuideGrid);
  var q = norm(String(liveGuideSearch.value || '').trim());
  var shown = 0;
  for (var i = 0; i < CHANNELS.length; i++) {
    var ch = CHANNELS[i];
    if (q && norm(ch.name || '').indexOf(q) === -1) { continue; }
    liveGuideGrid.appendChild(makeGuideCard(ch, i));
    shown++;
  }
  if (!shown) {
    var msg = !CHANNELS.length && liveChannelsLoading ? 'Cargando canales…'
      : q ? 'Ningún canal coincide con «' + liveGuideSearch.value.trim() + '»'
      : currentLiveCategory && currentLiveCategory.isSaved === 'favs' ? 'Aún no tienes canales favoritos. Pasa el ratón por un canal y toca la estrella.'
      : currentLiveCategory && currentLiveCategory.isSaved === 'recent' ? 'Aquí aparecerán los últimos canales que veas.'
      : 'No hay canales en esta categoría.';
    liveGuideGrid.appendChild(el('div', 'lg-empty', msg));
  }
  var name = currentLiveCategory ? (currentLiveCategory.isAddon ? 'Mis listas M3U' : currentLiveCategory.name) : 'Todos';
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

  card._activate = function () {
    closeLiveGuide();
    if (idx !== state.channel) { setChannel(idx, true); }
    else if (focusRingVisible) { openPlayer('live'); }
  };
  card.addEventListener('dblclick', function () { closeLiveGuide(); setChannel(idx, true); openPlayer('live'); });
  return card;
}

function installLiveGuide() {
  if (!window.XUPER_DESKTOP) { return; }
  document.addEventListener('keydown', function (event) {
    if (!liveGuideOpen) {
      /* G opens the guide from the TV tab. */
      if ((event.key === 'g' || event.key === 'G') && !event.ctrlKey && !event.altKey && state.screen === 'home' && state.tab === 0 &&
          !(document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName))) {
        event.preventDefault();
        openLiveGuide();
      }
      return;
    }
    if (event.key === 'Escape' || event.key === 'Backspace' || event.keyCode === 461) {
      if (document.activeElement === liveGuideSearch && event.key === 'Backspace') { return; }
      event.preventDefault();
      event.stopPropagation();
      closeLiveGuide();
    }
  }, true);
}
