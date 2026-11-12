/* mobile/mobile-app.js — Celulares (Android; el mismo diseño servirá para iOS).
   Parte del módulo único de la app (ver ui/js/src/README.md).

   The PC and TV interfaces are drawn on a fixed 1920×1080 canvas, which a
   phone held upright would shrink to a strip. Phones get their own layer
   instead (#m-app, ui/mobile/mobile.css): a vertical, touch layout with the
   menu at the bottom, laid out by the browser (no canvas), reusing the same
   catalogue, trends, history, favourites and profiles. Playing a title
   opens the existing player full screen (the phone turned sideways); when it
   closes, the phone layer comes back. Preview on a PC: open the app with
   ?platform=android in a phone-sized browser window. */

function isPhone() { return platformName() === 'android' && !platformIsTv(); }

var mob = {
  root: null, main: null, nav: null, tab: 'inicio', chip: 'todo', screen: 'home',
  stamp: '', detail: null, playPending: 0, rotateTimer: null, searchTimer: null
};

var M_TABS = [
  { id: 'inicio', label: 'Inicio', icon: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h13V9"/>' },
  { id: 'pelicula', label: 'Películas', icon: '<rect x="3" y="3.5" width="18" height="17" rx="2"/><path d="M7.5 3.5v17M16.5 3.5v17M3 12h18"/>' },
  { id: 'serie', label: 'Series', icon: '<rect x="2.5" y="6.5" width="19" height="13" rx="2"/><path d="M8 2.5l4 4 4-4"/>' },
  { id: 'live', label: 'TV en vivo', icon: '<rect x="2.5" y="5" width="19" height="13" rx="2"/><path d="M8 21h8"/>' },
  { id: 'cuenta', label: 'Mi cuenta', icon: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>' }
];
/* Inicio's chips: the sections that do not fit in the bottom menu. */
var M_CHIPS = [
  { id: 'todo', label: 'Todo', category: 'destacado', trend: 'inicio' },
  { id: 'kids', label: 'Kids', category: 'infantil', trend: 'kids' },
  { id: 'anime', label: 'Anime', category: 'anime', trend: 'anime' },
  { id: 'milista', label: 'Mi lista' }
];

function mSvg(body, size) {
  return '<svg width="' + (size || 24) + '" height="' + (size || 24) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
}

/* Images at the size they are shown (the app's native resizer on Android). */
function mImg(url, cssWidth) {
  if (!url) { return ''; }
  if (!nativeImageSizer || !/^https?:\/\//i.test(url)) { return url; }
  var px = Math.round(cssWidth * (window.devicePixelRatio || 1));
  return 'https://opentv-img.local/i?w=' + px + '&u=' + encodeURIComponent(url);
}

function mPicture(url, cssWidth, cls) {
  var img = el('img', cls || 'm-img');
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  if (url) { img.src = mImg(url, cssWidth); }
  img.onerror = function () { img.style.visibility = 'hidden'; };
  return img;
}

function mButton(cls, html, label, run) {
  var b = el('button', cls);
  b.type = 'button';
  if (html) { b.innerHTML = html; }
  if (label) { b.setAttribute('aria-label', label); }
  b.addEventListener('click', function (event) { event.preventDefault(); run(event); });
  return b;
}

/* -------------------------------------------------------------- shell */
function installMobileApp() {
  if (!isPhone() || mob.root) { return; }
  document.body.classList.add('is-phone');
  var css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'mobile/mobile.css';
  document.head.appendChild(css);

  mob.root = el('div', 'm-app');
  mob.root.id = 'm-app';
  mob.main = el('main', 'm-main');
  mob.root.appendChild(mob.main);
  mob.nav = el('nav', 'm-nav');
  mob.nav.setAttribute('aria-label', 'Menú principal');
  /* A kids profile only sees Kids (no TV, no adult sections), as on the PC. */
  if (activeProfile().kids) {
    M_TABS = M_TABS.filter(function (t) { return t.id === 'inicio' || t.id === 'cuenta'; });
    M_CHIPS = M_CHIPS.filter(function (c) { return c.id === 'kids' || c.id === 'milista'; });
    mob.chip = 'kids';
  }
  /* Several profiles and none chosen yet: "¿Quién está viendo?" first. */
  if (profilesData.list.length > 1 && !profileChosenThisSession) { mob.screen = 'picker'; }
  M_TABS.forEach(function (t) {
    var b = mButton('m-tab', mSvg(t.icon) + '<span>' + t.label + '</span>', null, function () { mobileGoTab(t.id); });
    b._tab = t.id;
    mob.nav.appendChild(b);
  });
  mob.root.appendChild(mob.nav);
  document.body.appendChild(mob.root);
  renderMobile();
  setInterval(mobileSync, 1000);
}

/* Redraw when the catalogue, the trends, the history or the favourites
   change, and hide the phone layer while the player is on screen. */
function mobileSync() {
  var playing = state.screen === 'player';
  document.body.classList.toggle('m-playing', playing);
  if (playing) { return; }
  unlockMobileRotation();
  var stamp = [VOD.length, catalogStaleAt, trendingRows.length, (localProfile.history || []).length,
    Object.keys(state.favs || {}).length, CHANNELS.length].join('|');
  if (stamp !== mob.stamp && mob.screen === 'home') { mob.stamp = stamp; renderMobile(true); }
}

function mobileGoTab(id) {
  mob.tab = id;
  mob.screen = 'home';
  renderMobile();
  mob.main.scrollTop = 0;
}

/* Back (the phone's button or gesture): close what is open in the phone
   layer first. Returns true when it handled it. */
function mobileBack() {
  if (!mob.root || state.screen === 'player') { return false; }
  if (mob.screen === 'picker') { return false; }
  if (mob.screen !== 'home') { mob.screen = M_PARENT[mob.screen] || 'home'; renderMobile(); return true; }
  var homeChip = M_CHIPS[0].id;
  if (mob.tab !== 'inicio' || mob.chip !== homeChip) { mob.tab = 'inicio'; mob.chip = homeChip; renderMobile(); mob.main.scrollTop = 0; return true; }
  return false;
}

function renderMobile(keepScroll) {
  if (!mob.root) { return; }
  var top = keepScroll ? mob.main.scrollTop : 0;
  if (mob.rotateTimer) { clearInterval(mob.rotateTimer); mob.rotateTimer = null; }
  clear(mob.main);
  for (var i = 0; i < mob.nav.children.length; i++) {
    mob.nav.children[i].classList.toggle('is-on', mob.nav.children[i]._tab === mob.tab);
  }
  mob.root.classList.toggle('is-sub', mob.screen !== 'home');
  if (mob.screen === 'detail' && mob.detail) { renderMobileDetail(mob.detail); }
  else if (mob.screen === 'search') { renderMobileSearch(); }
  else if (M_SCREENS[mob.screen]) { M_SCREENS[mob.screen](); }
  else if (mob.tab === 'live') { renderMobileLive(); }
  else if (mob.tab === 'cuenta') { renderMobileAccount(); }
  else { renderMobileFeed(); }
  if (keepScroll) { mob.main.scrollTop = top; }
}

function mobileHeader(title) {
  var h = el('header', 'm-head');
  if (title) {
    h.appendChild(el('h1', 'm-h1', title));
  } else {
    var brand = el('div', 'm-brand');
    brand.innerHTML = '<svg width="26" height="26" viewBox="72 68 368 372" fill="none" stroke="#fff" stroke-width="28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M196 84 256 144 316 84"/><rect x="92" y="144" width="328" height="232" rx="44"/><path d="M231 224v72l62-36z"/><path d="M188 424h136"/></svg><span>OpenTV</span>';
    h.appendChild(brand);
  }
  /* (No search on a kids profile, as on the PC.) */
  if (!activeProfile().kids) {
    h.appendChild(mButton('m-round', mSvg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 20), 'Buscar', function () {
      mob.screen = 'search';
      renderMobile();
    }));
  }
  var me = mButton('m-round m-avatar', avatarSvg(activeProfile().avatar || 0), 'Mi cuenta', function () { mobileGoTab('cuenta'); });
  h.appendChild(me);
  return h;
}

/* ---------------------------------------------------------- the feed */
function renderMobileFeed() {
  var chip = M_CHIPS[0];
  if (mob.tab === 'inicio') {
    for (var c = 0; c < M_CHIPS.length; c++) { if (M_CHIPS[c].id === mob.chip) { chip = M_CHIPS[c]; } }
  }
  var category = mob.tab === 'pelicula' ? 'pelicula' : mob.tab === 'serie' ? 'serie' : chip.category;
  var trendKey = mob.tab === 'pelicula' ? 'movie' : mob.tab === 'serie' ? 'series' : chip.trend;
  mob.main.appendChild(mobileHeader(mob.tab === 'pelicula' ? 'Películas' : mob.tab === 'serie' ? 'Series' : null));

  if (mob.tab === 'inicio') {
    var chips = el('nav', 'm-chips');
    chips.setAttribute('aria-label', 'Secciones');
    M_CHIPS.forEach(function (ch) {
      var b = mButton('m-chip' + (ch.id === mob.chip ? ' is-on' : ''), null, null, function () {
        mob.chip = ch.id;
        renderMobile();
        mob.main.scrollTop = 0;
      });
      b.textContent = ch.label;
      chips.appendChild(b);
    });
    mob.main.appendChild(chips);
  }

  if (chip.id === 'milista' && mob.tab === 'inicio') { renderMobileMyList(); return; }

  var all = allVodFor(category) || [];
  if (!all.length) {
    mob.main.appendChild(el('p', 'm-empty', VOD.length ? 'No hay títulos en esta sección todavía.' : 'Cargando el catálogo…'));
    return;
  }
  /* Top of the section: this week's TMDB trends that the catalogue has, then
     the portal's titles (the same list the PC hero and the TV cards use). */
  var trends = trendKey ? sectionTrendItems(trendKey) : [];
  var seen = {}, pool = [];
  trends.concat(all).forEach(function (v) {
    if (v && !seen[v.id] && (heroArt(v) || v._trendArt) && hasUsableCover(v) && pool.length < 9) { seen[v.id] = true; pool.push(v); }
  });
  /* #1 opens the big card (then it takes turns with #6 onwards); #2–#5 are
     the four small cards, like the TV's top. */
  if (pool.length) { mob.main.appendChild(mobileFeature([pool[0]].concat(pool.slice(5)))); }
  if (pool.length >= 5) { mob.main.appendChild(mobileSmallCards(pool.slice(1, 5))); }

  var filter = mob.tab === 'pelicula' ? 'movie' : mob.tab === 'serie' ? 'series' : '';
  var records = continueRecords(filter);
  if (records.length && chip.id === 'todo') { mob.main.appendChild(mobileContinueRow(records)); }

  var shelves = portalRowsFor(category, 4);
  for (var s = 0; s < shelves.length; s++) {
    var top = /top\s*1[05]|clasificad/i.test(shelves[s].title);
    if (top && mob.tab === 'inicio' && chip.id === 'todo') {
      var series = shelves[s].items.length && isSeriesItem(shelves[s].items[0]);
      mob.main.appendChild(mobileTopRow(series ? 'Top 10 series hoy' : 'Top 10 películas hoy', shelves[s].items.slice(0, 10)));
    } else if (!top) {
      mob.main.appendChild(mobilePosterRow(shelves[s].title, shelves[s].items));
    }
  }
  if (!shelves.length) { mob.main.appendChild(mobileGrid('Catálogo', all.slice(0, 60))); }
}

/* The big card: one title at a time, the next one every few seconds. */
function mobileFeature(items) {
  var box = el('section', 'm-feature');
  box.setAttribute('aria-label', 'Destacado');
  var card = el('a', 'm-feature-card');
  card.href = '#';
  var img = mPicture('', 360, 'm-img');
  var shade = el('div', 'm-shade');
  var text = el('div', 'm-feature-text');
  var kicker = el('span', 'm-kicker');
  var title = el('span', 'm-feature-title');
  var meta = el('span', 'm-meta');
  text.appendChild(kicker); text.appendChild(title); text.appendChild(meta);
  var dots = el('div', 'm-dots');
  for (var d = 0; d < Math.min(items.length, 6); d++) { dots.appendChild(el('i')); }
  card.appendChild(img); card.appendChild(shade); card.appendChild(text); card.appendChild(dots);
  box.appendChild(card);
  var at = 0;
  function show(n) {
    var item = items[n % items.length];
    at = n % items.length;
    img.style.visibility = '';
    img.src = mImg(item._trendArt || heroArt(item) || item.poster, 360);
    kicker.textContent = isSeriesItem(item) ? 'SERIE' : 'PELÍCULA';
    title.textContent = item.title || '';
    meta.textContent = itemMetaLine(item) || '';
    for (var i = 0; i < dots.children.length; i++) { dots.children[i].className = i === at % dots.children.length ? 'is-on' : ''; }
    card._item = item;
  }
  card.addEventListener('click', function (event) { event.preventDefault(); openMobileDetail(card._item); });
  show(0);
  if (items.length > 1) {
    mob.rotateTimer = setInterval(function () {
      if (mob.screen !== 'home' || state.screen === 'player' || document.hidden) { return; }
      var next = items[(at + 1) % items.length];
      var pre = new Image();
      pre.onload = function () { show(at + 1); };
      pre.src = mImg(next._trendArt || heroArt(next) || next.poster, 360);
    }, 7000);
  }
  return box;
}

function mobileSmallCards(items) {
  var grid = el('section', 'm-small');
  grid.setAttribute('aria-label', 'Más tendencias');
  items.forEach(function (item) {
    var a = el('a', 'm-small-card');
    a.href = '#';
    a.appendChild(mPicture(item._trendArt || heroArt(item) || item.poster, 180));
    a.appendChild(el('div', 'm-shade'));
    a.appendChild(el('span', 'm-small-title', item.title || ''));
    a.addEventListener('click', function (event) { event.preventDefault(); openMobileDetail(item); });
    grid.appendChild(a);
  });
  return grid;
}

function mobileRow(title) {
  var sec = el('section', 'm-section');
  sec.appendChild(el('h2', 'm-h2', title));
  var row = el('div', 'm-row');
  sec.appendChild(row);
  sec._row = row;
  return sec;
}

function mobilePosterRow(title, items) {
  var sec = mobileRow(title);
  items.slice(0, 30).forEach(function (item) { sec._row.appendChild(mobilePoster(item)); });
  return sec;
}

function mobilePoster(item) {
  var a = el('a', 'm-poster');
  a.href = '#';
  a.setAttribute('aria-label', item.title || 'Título');
  a.appendChild(mPicture(item.poster, 112));
  a.addEventListener('click', function (event) { event.preventDefault(); openMobileDetail(item); });
  return a;
}

function mobileTopRow(title, items) {
  var sec = mobileRow(title);
  sec._row.classList.add('is-top');
  items.forEach(function (item, n) {
    var a = el('a', 'm-top');
    a.href = '#';
    a.setAttribute('aria-label', (n + 1) + '. ' + (item.title || ''));
    var num = el('span', 'm-top-n', String(n + 1));
    num.setAttribute('aria-hidden', 'true');
    a.appendChild(num);
    a.appendChild(mPicture(item.poster, 100));
    a.addEventListener('click', function (event) { event.preventDefault(); openMobileDetail(item); });
    sec._row.appendChild(a);
  });
  return sec;
}

function mobileContinueRow(records) {
  var sec = mobileRow('Seguir viendo');
  records.forEach(function (r) {
    var item = vodForHistoryRecord(r);
    var a = el('a', 'm-continue');
    a.href = '#';
    var frame = el('div', 'm-continue-frame');
    frame.appendChild(mPicture((item && (item.landscape || item.backdrop || item.poster)) || r.poster, 210));
    var pct = r.duration ? Math.min(100, Math.max(2, Math.round(r.position / r.duration * 100))) : 0;
    if (pct) {
      var bar = el('div', 'm-progress');
      var fill = el('i');
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      frame.appendChild(bar);
    }
    a.appendChild(frame);
    a.appendChild(el('span', 'm-continue-title', r.title || (item && item.title) || 'Contenido'));
    a.appendChild(el('span', 'm-continue-sub', continueSubtitle(r)));
    a.addEventListener('click', function (event) {
      event.preventDefault();
      mobileWillPlay();
      openHistoryRecord(r);
    });
    sec._row.appendChild(a);
  });
  return sec;
}

function mobileGrid(title, items) {
  var sec = el('section', 'm-section');
  if (title) { sec.appendChild(el('h2', 'm-h2', title)); }
  var grid = el('div', 'm-grid');
  items.forEach(function (item) { grid.appendChild(mobilePoster(item)); });
  sec.appendChild(grid);
  return sec;
}

/* Mi lista: Historial (a medias, with its progress) · Mi lista (para ver
   después) · Mis favoritos, like the other layouts (screens/history.js). */
var mobLibraryTab = 'history';
function renderMobileMyList() {
  var seg = el('div', 'm-seg m-library-tabs');
  LIBRARY_TABS.forEach(function (t) {
    var b = mButton('m-seg-btn' + (mobLibraryTab === t.id ? ' is-on' : ''), null, null, function () {
      mobLibraryTab = t.id;
      renderMobile(true);
    });
    b.textContent = t.label;
    b.setAttribute('aria-pressed', mobLibraryTab === t.id ? 'true' : 'false');
    seg.appendChild(b);
  });
  var wrap = el('div', 'm-pad');
  wrap.appendChild(seg);
  mob.main.appendChild(wrap);
  var records = libraryRecords(mobLibraryTab);
  if (!records.length) { mob.main.appendChild(el('p', 'm-empty', LIBRARY_EMPTY[mobLibraryTab])); return; }
  var sec = el('section', 'm-section');
  var grid = el('div', 'm-grid');
  records.slice(0, 90).forEach(function (r) {
    var item = libraryItem(r);
    if (!item) { return; }
    var a = mobilePoster(item);
    if (mobLibraryTab === 'history') {
      var pct = historyRecordLine(r).pct;
      var bar = el('div', 'm-progress');
      var fill = el('i');
      fill.style.width = Math.max(2, pct) + '%';
      bar.appendChild(fill);
      a.appendChild(bar);
    }
    grid.appendChild(a);
  });
  sec.appendChild(grid);
  mob.main.appendChild(sec);
}

/* ------------------------------------------------------- details */
function openMobileDetail(item) {
  if (!item) { return; }
  mob.detail = item;
  mob.screen = 'detail';
  renderMobile();
  loadVodDetail(item, function (loaded) {
    if (loaded && mob.screen === 'detail' && mob.detail === item) { renderMobile(); }
  });
}

function renderMobileDetail(item) {
  var page = el('article', 'm-detail');
  var hero = el('div', 'm-detail-hero');
  hero.appendChild(mPicture(item._trendArt || heroArt(item) || item.poster, 390));
  hero.appendChild(el('div', 'm-detail-shade'));
  hero.appendChild(mButton('m-round m-back', mSvg('<path d="M15 18l-6-6 6-6"/>', 22), 'Volver', function () { mobileBack(); }));
  page.appendChild(hero);

  var body = el('div', 'm-detail-body');
  body.appendChild(el('h1', 'm-detail-title', item.title || ''));
  var meta = itemMetaLine(item);
  if (meta) { body.appendChild(el('div', 'm-meta', meta)); }
  var genres = itemGenres(item, 3);
  if (genres.length) {
    var g = el('div', 'm-tags');
    genres.forEach(function (name) { g.appendChild(el('span', 'm-tag', name)); });
    body.appendChild(g);
  }

  var rec = historyRecordFor(item);
  var resume = rec && (rec.position || 0) > 5 && !(rec.duration && rec.position / rec.duration > 0.95);
  var play = mButton('m-play', '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l11-6.8a.8.8 0 0 0 0-1.4l-11-6.8a.8.8 0 0 0-1.2.7z"/></svg>' +
    '<span>' + (resume ? 'Reanudar' : 'Reproducir') + '</span>', null, function () {
    if (resume) { mobileWillPlay(); openHistoryRecord(rec); } else { mobilePlay(item, null); }
  });
  body.appendChild(play);

  /* Two icon-only toggles: Favorito and Mi lista (always resumes where it was left). */
  var actions = el('div', 'm-actions is-icons');
  var fav = !!state.favs[String(item.id)];
  var listed = inMyList(item);
  var favBtn = mButton('m-action is-icon' + (fav ? ' is-on' : ''),
    mSvg('<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z"' + (fav ? ' fill="currentColor"' : '') + '/>'),
    fav ? 'Quitar de favoritos' : 'Añadir a favoritos', function () {
      toggleFavorite(item);
      renderMobile(true);
    });
  var listBtn = mButton('m-action is-icon' + (listed ? ' is-on' : ''),
    mSvg('<path d="M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z"' + (listed ? ' fill="currentColor"' : '') + '/>'),
    listed ? 'Quitar de Mi lista' : 'Añadir a Mi lista', function () {
      toggleMyList(item);
      renderMobile(true);
    });
  actions.appendChild(favBtn);
  actions.appendChild(listBtn);
  body.appendChild(actions);

  var syn = String(item.synopsis || '');
  if (syn && !/^sin sinopsis/i.test(syn)) {
    var p = el('p', 'm-synopsis is-short', syn);
    p.addEventListener('click', function () { p.classList.toggle('is-short'); });
    body.appendChild(p);
  }
  page.appendChild(body);

  if (isSeriesItem(item)) { page.appendChild(mobileEpisodes(item)); }
  var related = allVodFor(norm(item.category || '').split(',')[0] || 'destacado').filter(function (v) { return v.id !== item.id; }).slice(0, 18);
  if (related.length) { page.appendChild(mobilePosterRow('Quizás te guste', related)); }
  mob.main.appendChild(page);
}

function mobileEpisodes(item) {
  var sec = el('section', 'm-section m-episodes');
  var head = el('div', 'm-ep-head');
  head.appendChild(el('h2', 'm-h2', 'Episodios'));
  var seasons = item.seasons || [];
  if (seasons.length > 1) {
    var select = document.createElement('select');
    select.className = 'm-select';
    select.setAttribute('aria-label', 'Temporada');
    seasons.forEach(function (s, n) {
      var o = document.createElement('option');
      o.value = String(n);
      o.textContent = s.name || ('Temporada ' + (s.number || n + 1));
      if (n === (state.detailSeason || 0)) { o.selected = true; }
      select.appendChild(o);
    });
    select.addEventListener('change', function () {
      var n = parseInt(select.value, 10) || 0;
      var season = seasons[n];
      state.detailSeason = n;
      if (season._episodes && season._episodes.length) {
        item.episodes = season._episodes; item.seasonId = season.id; renderMobile(true); return;
      }
      portalServiceCall('detail', { contentId: season.id }, function (err, payload) {
        if (!err && payload && payload.returnValue !== false) {
          season._episodes = payload.episodes || [];
          item.episodes = season._episodes;
          item.seasonId = season.id;
        }
        if (mob.detail === item) { renderMobile(true); }
      });
    });
    head.appendChild(select);
  }
  sec.appendChild(head);
  var eps = item.episodes || [];
  if (!eps.length) { sec.appendChild(el('p', 'm-empty', item._detailsLoaded ? 'Sin episodios disponibles.' : 'Cargando episodios…')); }
  eps.forEach(function (ep, n) {
    var a = el('a', 'm-episode');
    a.href = '#';
    var thumb = el('div', 'm-ep-thumb');
    thumb.appendChild(mPicture(ep.poster || ep.image || item.landscape || item.backdrop || item.poster, 132));
    a.appendChild(thumb);
    var t = el('div', 'm-ep-text');
    /* "Supergatinhos Temp.1_03" only repeats the series: "Episodio 3". */
    var epNo = ep.number || n + 1;
    var epName = ep.title || ep.name || '';
    var seriesNorm = norm(String(item.title || '').replace(/\s*(T|Temp\.?|Temporada)\s*\d+\s*$/i, ''));
    if (!epName || (seriesNorm && norm(epName).indexOf(seriesNorm) === 0) || /^(episodio|capitulo|cap\.?)\s*\d+$/i.test(norm(epName))) {
      epName = 'Episodio ' + epNo;
    } else {
      epName = epNo + '. ' + epName;
    }
    t.appendChild(el('span', 'm-ep-title', epName));
    if (ep.duration) { t.appendChild(el('span', 'm-ep-meta', String(ep.duration))); }
    a.appendChild(t);
    a.addEventListener('click', function (event) { event.preventDefault(); mobilePlay(item, ep); });
    sec.appendChild(a);
  });
  return sec;
}

/* ---------------------------------------------------------- playing */
/* The phone turns sideways for the player and back afterwards (where the
   browser lets the page lock the orientation; the Android app does). */
function lockMobileRotation() {
  try { if (screen.orientation && screen.orientation.lock) { screen.orientation.lock('landscape').catch(function () {}); } } catch (e) { /* not allowed */ }
}
function unlockMobileRotation() {
  try { if (screen.orientation && screen.orientation.unlock && mob.rotated) { screen.orientation.unlock(); } } catch (e) { /* not allowed */ }
  mob.rotated = false;
}

/* Shows the player as soon as it opens (no wait for the next sync). */
function mobileWillPlay() {
  mob.rotated = true;
  lockMobileRotation();
  var started = Date.now();
  if (mob.playPending) { clearInterval(mob.playPending); }
  mob.playPending = setInterval(function () {
    if (state.screen === 'player' || Date.now() - started > 20000) {
      clearInterval(mob.playPending);
      mob.playPending = 0;
      mobileSync();
    }
  }, 120);
}

function mobilePlay(item, episode) {
  mobileWillPlay();
  openDetail(item);
  loadVodDetail(item, function (loaded) {
    if (!loaded || state.detail !== item) { return; }
    expandToFullscreen(item, episode || state.detailEpisode);
  });
}

/* ---------------------------------------------------------- TV en vivo */
var M_LIVE_BATCH = 80;
function renderMobileLive() {
  mob.main.appendChild(mobileHeader('TV en vivo'));
  if (!CHANNELS.length) {
    mob.main.appendChild(el('p', 'm-empty', liveChannelsLoaded ? 'No se encontraron canales.' : 'Cargando canales…'));
    if (!liveChannelsLoaded && typeof loadLiveChannels === 'function') { loadLiveChannels(); }
    return;
  }
  var cur = CHANNELS[state.channel] || CHANNELS[0];
  var now = el('section', 'm-live-now');
  now.appendChild(el('span', 'm-live-badge', 'EN VIVO'));
  now.appendChild(el('span', 'm-live-name', cur.name || 'Canal'));
  now.appendChild(mButton('m-play is-compact', mSvg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', 18) + '<span>Ver</span>', null, function () {
    mobileWillPlay();
    openPlayer('live');
  }));
  mob.main.appendChild(now);

  var list = el('section', 'm-channels');
  list.setAttribute('aria-label', 'Canales');
  var shown = 0;
  function more() {
    var end = Math.min(CHANNELS.length, shown + M_LIVE_BATCH);
    for (; shown < end; shown++) {
      (function (i) {
        var ch = CHANNELS[i];
        var a = el('a', 'm-channel' + (i === state.channel ? ' is-on' : ''));
        a.href = '#';
        var logo = el('span', 'm-ch-logo');
        if (ch.logo) { logo.appendChild(mPicture(ch.logo, 44)); } else { logo.textContent = String(i + 1); }
        a.appendChild(logo);
        a.appendChild(el('span', 'm-ch-name', ch.name || ('Canal ' + (i + 1))));
        a.addEventListener('click', function (event) {
          event.preventDefault();
          setChannel(i, true);
          mobileWillPlay();
          openPlayer('live');
        });
        list.appendChild(a);
      })(shown);
    }
  }
  more();
  mob.main.appendChild(list);
  mob.main.onscroll = function () {
    if (mob.tab !== 'live' || shown >= CHANNELS.length) { return; }
    if (mob.main.scrollTop + mob.main.clientHeight > mob.main.scrollHeight - 600) { more(); }
  };
}

/* ---------------------------------------------------------- search */
function renderMobileSearch() {
  var head = el('header', 'm-head m-search-head');
  head.appendChild(mButton('m-round', mSvg('<path d="M15 18l-6-6 6-6"/>', 22), 'Volver', function () { mobileBack(); }));
  var input = document.createElement('input');
  input.type = 'search';
  input.className = 'm-search';
  input.placeholder = 'Películas, series, anime…';
  input.setAttribute('aria-label', 'Buscar');
  head.appendChild(input);
  mob.main.appendChild(head);
  var results = el('div', 'm-search-results');
  mob.main.appendChild(results);
  function run() {
    var q = input.value.trim();
    clear(results);
    if (q.length < 2) { return; }
    results.appendChild(el('p', 'm-empty', 'Buscando…'));
    portalServiceCall('search', { value: q, pageNum: 1, pageSize: 30 }, function (error, payload) {
      if (input.value.trim() !== q) { return; }
      clear(results);
      var items = [];
      var list = (payload && payload.items) || [];
      for (var i = 0; i < list.length; i++) {
        var v = normalizeVod(list[i], i + 1);
        v._portal = true;
        items.push(vodById(v.id) || v);
      }
      if (error || !items.length) { results.appendChild(el('p', 'm-empty', 'Sin resultados para «' + q + '».')); return; }
      results.appendChild(mobileGrid('', items));
    });
  }
  input.addEventListener('input', function () {
    if (mob.searchTimer) { clearTimeout(mob.searchTimer); }
    mob.searchTimer = setTimeout(run, 450);
  });
  setTimeout(function () { try { input.focus(); } catch (e) { /* ignore */ } }, 50);
}

/* ---------------------------------------------------------- account */
/* Sub-screens of Mi cuenta and where Back goes from each. */
var M_PARENT = { profiles: 'home', profileEdit: 'profiles', playback: 'home', history: 'home', mylist: 'home', about: 'home' };
var M_SCREENS = {
  picker: function () { renderMobilePicker(); },
  profiles: function () { renderMobileProfiles(); },
  profileEdit: function () { renderMobileProfileEdit(); },
  playback: function () { renderMobilePlayback(); },
  history: function () { renderMobileHistory(); },
  mylist: function () { mob.main.appendChild(mobileSubHeader('Mi lista')); renderMobileMyList(true); },
  about: function () { renderMobileAbout(); }
};

function mobileOpen(screen) {
  mob.screen = screen;
  renderMobile();
  mob.main.scrollTop = 0;
}

/* Title bar of a sub-screen: Back and its name. */
function mobileSubHeader(title) {
  var h = el('header', 'm-head');
  h.appendChild(mButton('m-round', mSvg('<path d="M15 18l-6-6 6-6"/>', 22), 'Volver', function () { mobileBack(); }));
  h.appendChild(el('h1', 'm-h1', title));
  return h;
}

/* A settings row: icon, title, short text and a chevron. */
function mobileListItem(icon, title, sub, run) {
  var b = mButton('m-item', null, null, run);
  var ic = el('span', 'm-item-icon');
  ic.innerHTML = mSvg(icon, 22);
  b.appendChild(ic);
  var tx = el('span', 'm-item-text');
  tx.appendChild(el('span', 'm-item-title', title));
  if (sub) { tx.appendChild(el('span', 'm-item-sub', sub)); }
  b.appendChild(tx);
  var ch = el('span', 'm-item-chevron');
  ch.innerHTML = mSvg('<path d="M9 6l6 6-6 6"/>', 18);
  b.appendChild(ch);
  return b;
}

/* An on/off switch row. */
function mobileSwitch(title, sub, on, change) {
  var row = el('label', 'm-switch-row');
  var tx = el('span', 'm-item-text');
  tx.appendChild(el('span', 'm-item-title', title));
  if (sub) { tx.appendChild(el('span', 'm-item-sub', sub)); }
  row.appendChild(tx);
  var box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'm-switch';
  box.checked = !!on;
  box.addEventListener('change', function () { change(box.checked); });
  row.appendChild(box);
  return row;
}

/* One choice among a few (segmented buttons). */
function mobileChoice(title, options, selected, change) {
  var box = el('div', 'm-choice');
  box.appendChild(el('span', 'm-choice-title', title));
  var seg = el('div', 'm-seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', title);
  options.forEach(function (label, i) {
    var b = mButton('m-seg-btn' + (i === selected ? ' is-on' : ''), null, null, function () {
      for (var k = 0; k < seg.children.length; k++) { seg.children[k].classList.toggle('is-on', k === i); seg.children[k].setAttribute('aria-checked', String(k === i)); }
      change(i);
    });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(i === selected));
    b.innerHTML = label;
    seg.appendChild(b);
  });
  box.appendChild(seg);
  return box;
}

function renderMobileAccount() {
  mob.main.appendChild(mobileHeader('Mi cuenta'));
  var me = activeProfile();
  var card = el('section', 'm-me');
  var av = el('span', 'm-me-avatar');
  av.innerHTML = avatarSvg(me.avatar || 0);
  card.appendChild(av);
  var who = el('span', 'm-me-who');
  who.appendChild(el('span', 'm-me-name', me.name || 'Mi usuario'));
  who.appendChild(el('span', 'm-item-sub', (me.kids ? 'Perfil infantil · ' : '') + 'Guardado solo en este equipo'));
  card.appendChild(who);
  mob.main.appendChild(card);

  if (profilesData.list.length > 1) {
    var sec = el('section', 'm-section');
    sec.appendChild(el('h2', 'm-h2', 'Cambiar de perfil'));
    var row = el('div', 'm-profiles');
    profilesData.list.forEach(function (p) {
      var b = mButton('m-profile' + (p.id === me.id ? ' is-on' : ''), null, null, function () { switchToProfile(p.id); });
      var a = el('span', 'm-profile-avatar');
      a.innerHTML = avatarSvg(p.avatar || 0);
      b.appendChild(a);
      b.appendChild(el('span', 'm-profile-name', p.name || 'Perfil'));
      row.appendChild(b);
    });
    sec.appendChild(row);
    mob.main.appendChild(sec);
  }

  var titles = 0;
  for (var key in state.mylist) {
    if (Object.prototype.hasOwnProperty.call(state.mylist, key)) { titles++; }
  }
  var list = el('section', 'm-list');
  list.appendChild(mobileListItem('<path d="M6 3.5h12v17l-6-4-6 4z"/>', 'Mi lista', 'Historial, Mi lista y favoritos' + (titles ? ' · ' + titles + (titles === 1 ? ' guardado' : ' guardados') : ''), function () { mobileOpen('mylist'); }));
  list.appendChild(mobileListItem('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>', 'Historial', 'Sigue donde lo dejaste', function () { mobileOpen('history'); }));
  list.appendChild(mobileListItem('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>', 'Reproducción y subtítulos', 'Formato, idioma y subtítulos', function () { mobileOpen('playback'); }));
  list.appendChild(mobileListItem('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.7c1.7.8 2.7 2.6 3 5.3"/>', 'Administrar perfiles', 'Crear, editar o eliminar perfiles', function () { mobileOpen('profiles'); }));
  mob.main.appendChild(list);

  var look = el('section', 'm-list');
  look.appendChild(mobileSwitch('Modo ligero', 'Menos efectos; úsalo si la app va lenta en tu celular.', liteMode(), function (on) { setLiteMode(on); }));
  mob.main.appendChild(look);

  var more = el('section', 'm-list');
  more.appendChild(mobileListItem('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>', 'Acerca de OpenTV', 'Versión, privacidad y créditos', function () { mobileOpen('about'); }));
  mob.main.appendChild(more);
}

/* ---------------------------------------------------------- profiles */
function renderMobilePicker() {
  var page = el('section', 'm-picker');
  page.appendChild(el('h1', 'm-picker-title', '¿Quién está viendo?'));
  var grid = el('div', 'm-picker-grid');
  profilesData.list.forEach(function (p) {
    var b = mButton('m-picker-item', null, null, function () {
      try { sessionStorage.setItem(ACTIVE_PROFILE_SESSION, p.id); } catch (e) { /* private mode */ }
      profileChosenThisSession = true;
      if (!switchToProfile(p.id)) { mob.screen = 'home'; renderMobile(); }
    });
    var a = el('span', 'm-picker-avatar');
    a.innerHTML = avatarSvg(p.avatar || 0);
    b.appendChild(a);
    b.appendChild(el('span', 'm-picker-name', (p.name || 'Perfil') + (p.kids ? ' · Kids' : '')));
    grid.appendChild(b);
  });
  page.appendChild(grid);
  page.appendChild(mButton('m-ghost', null, null, function () { mob.screen = 'profiles'; mob.pickerManage = true; renderMobile(); })).textContent = 'Administrar perfiles';
  mob.main.appendChild(page);
}

function renderMobileProfiles() {
  mob.main.appendChild(mobileSubHeader('Perfiles'));
  var list = el('section', 'm-list');
  profilesData.list.forEach(function (p) {
    var b = mButton('m-item', null, null, function () { mob.editing = p; mobileOpen('profileEdit'); });
    var a = el('span', 'm-item-avatar');
    a.innerHTML = avatarSvg(p.avatar || 0);
    b.appendChild(a);
    var tx = el('span', 'm-item-text');
    tx.appendChild(el('span', 'm-item-title', p.name || 'Perfil'));
    tx.appendChild(el('span', 'm-item-sub', (p.kids ? 'Perfil infantil' : 'Perfil') + (p.id === activeProfileId ? ' · en uso' : '')));
    b.appendChild(tx);
    var ch = el('span', 'm-item-chevron');
    ch.innerHTML = mSvg('<path d="M9 6l6 6-6 6"/>', 18);
    b.appendChild(ch);
    list.appendChild(b);
  });
  mob.main.appendChild(list);
  if (profilesData.list.length < 6) {
    var add = mButton('m-play is-secondary', mSvg('<path d="M12 5v14M5 12h14"/>', 18) + '<span>Añadir perfil</span>', null, function () { mob.editing = null; mobileOpen('profileEdit'); });
    var wrap = el('div', 'm-pad');
    wrap.appendChild(add);
    mob.main.appendChild(wrap);
  }
}

/* Create or edit a profile: name, avatar and kids profile, with the same
   rules as the PC (a name, not repeated; at most six profiles). */
function renderMobileProfileEdit() {
  var p = mob.editing;
  var isNew = !p;
  var draft = p ? { name: p.name, avatar: p.avatar || 0, kids: !!p.kids } : { name: '', avatar: profilesData.list.length % AVATARS.length, kids: false };
  mob.main.appendChild(mobileSubHeader(isNew ? 'Nuevo perfil' : 'Editar perfil'));
  var form = el('form', 'm-form');
  var preview = el('span', 'm-me-avatar m-edit-preview');
  preview.innerHTML = avatarSvg(draft.avatar);
  form.appendChild(preview);

  var label = el('label', 'm-field');
  label.appendChild(el('span', 'm-field-label', 'Nombre'));
  var name = document.createElement('input');
  name.className = 'm-input';
  name.maxLength = 20;
  name.value = draft.name;
  name.placeholder = 'Nombre del perfil';
  label.appendChild(name);
  form.appendChild(label);

  form.appendChild(el('span', 'm-field-label', 'Elige un avatar'));
  var grid = el('div', 'm-avatars');
  AVATARS.forEach(function (a, i) {
    var b = mButton('m-avatar-pick' + (i === draft.avatar ? ' is-on' : ''), avatarSvg(i), 'Avatar ' + (i + 1), function () {
      draft.avatar = i;
      preview.innerHTML = avatarSvg(i);
      for (var k = 0; k < grid.children.length; k++) { grid.children[k].classList.toggle('is-on', k === i); }
    });
    grid.appendChild(b);
  });
  form.appendChild(grid);
  form.appendChild(mobileSwitch('Perfil infantil', 'Solo muestra la sección Kids.', draft.kids, function (on) { draft.kids = on; }));

  var msg = el('p', 'm-form-msg');
  form.appendChild(msg);
  var save = el('button', 'm-play');
  save.type = 'submit';
  save.textContent = isNew ? 'Crear perfil' : 'Guardar';
  form.appendChild(save);
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var n = name.value.trim();
    if (!n) { msg.textContent = 'Escribe un nombre.'; return; }
    for (var i = 0; i < profilesData.list.length; i++) {
      if (profilesData.list[i] !== p && profilesData.list[i].name.toLowerCase() === n.toLowerCase()) { msg.textContent = 'Ya hay un perfil con ese nombre.'; return; }
    }
    if (isNew) {
      profilesData.list.push({ id: 'p' + Date.now().toString(36), name: n, avatar: draft.avatar, kids: draft.kids, createdAt: Date.now() });
    } else {
      p.name = n; p.avatar = draft.avatar; p.kids = draft.kids;
    }
    profilesData.created = true;
    saveProfiles();
    if (!isNew && p.id === activeProfileId) { location.reload(); return; }
    mob.screen = 'profiles';
    renderMobile();
  });
  if (!isNew && profilesData.list.length > 1) {
    var del = mButton('m-danger', null, null, function () {
      if (window.confirm('¿Eliminar el perfil «' + p.name + '»? Se borran su lista y su historial.')) {
        deleteProfile(p.id);
        mob.screen = 'profiles';
        renderMobile();
      }
    });
    del.textContent = 'Eliminar perfil';
    form.appendChild(del);
  }
  mob.main.appendChild(form);
}

/* ---------------------------------------------------------- playback */
/* The same global preferences as Ajustes → Reproducción on the PC. The
   "Compatibilidad máxima" choice is not offered: Android has no FFmpeg. */
function renderMobilePlayback() {
  mob.main.appendChild(mobileSubHeader('Reproducción y subtítulos'));
  var box = el('section', 'm-settings');
  function set(key, value) {
    state.playback[key] = value;
    applyGlobalPlaybackPreferences();
    saveGlobalPlayback();
  }
  box.appendChild(el('p', 'm-note', 'Se aplican a todas las películas y series que veas.'));
  box.appendChild(mobileChoice('Formato de pantalla', ['Llenar', 'Original', '16:9', '4:3'], state.playback.screen === undefined ? 1 : Number(state.playback.screen), function (i) { set('screen', i); }));
  box.appendChild(mobileChoice('Audio preferido', ['Español', 'Portugués', 'Inglés'], Number(state.playback.audio) || 0, function (i) { set('audio', i); }));
  box.appendChild(el('h2', 'm-h2 m-flush', 'Subtítulos'));
  box.appendChild(mobileSwitch('Mostrar subtítulos', 'Cuando el título los tiene.', !!state.playback.subtitle, function (on) { set('subtitle', on); }));
  box.appendChild(mobileChoice('Idioma', ['Español', 'Portugués', 'Inglés'], Number(state.playback.subLang) || 0, function (i) { set('subLang', i); }));
  box.appendChild(mobileChoice('Tamaño', ['Normal', 'Grande', 'Pequeño'], Number(state.playback.size) || 0, function (i) { set('size', i); }));
  box.appendChild(mobileChoice('Estilo', ['<span class="m-sub-aa is-white">Aa</span>', '<span class="m-sub-aa is-yellow">Aa</span>', '<span class="m-sub-aa is-black">Aa</span>'],
    Number(state.playback.style) || 0, function (i) { set('style', i); }));
  mob.main.appendChild(box);
}

/* ---------------------------------------------------------- history */
function renderMobileHistory() {
  mob.main.appendChild(mobileSubHeader('Historial'));
  var list = localProfile.history || [];
  if (!list.length) { mob.main.appendChild(el('p', 'm-empty', 'Aún no has visto nada en este perfil.')); return; }
  var sec = el('section', 'm-history');
  list.slice(0, 60).forEach(function (r) {
    var item = vodForHistoryRecord(r);
    var a = el('a', 'm-episode');
    a.href = '#';
    var thumb = el('div', 'm-ep-thumb');
    thumb.appendChild(mPicture((item && (item.landscape || item.backdrop || item.poster)) || r.poster, 132));
    var pct = r.duration ? Math.min(100, Math.max(2, Math.round((r.position || 0) / r.duration * 100))) : 0;
    if (pct) {
      var bar = el('div', 'm-progress');
      var fill = el('i');
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      thumb.appendChild(bar);
    }
    a.appendChild(thumb);
    var t = el('div', 'm-ep-text');
    t.appendChild(el('span', 'm-ep-title', r.title || (item && item.title) || 'Contenido'));
    t.appendChild(el('span', 'm-ep-meta', continueSubtitle(r)));
    a.appendChild(t);
    a.addEventListener('click', function (event) { event.preventDefault(); mobileWillPlay(); openHistoryRecord(r); });
    sec.appendChild(a);
  });
  mob.main.appendChild(sec);
  var wrap = el('div', 'm-pad');
  var clr = mButton('m-danger', null, null, function () {
    if (!window.confirm('¿Borrar todo el historial de este perfil?')) { return; }
    forgetAllWatched();
    renderMobile();
  });
  clr.textContent = 'Borrar historial';
  wrap.appendChild(clr);
  mob.main.appendChild(wrap);
}

/* ---------------------------------------------------------- about */
function renderMobileAbout() {
  mob.main.appendChild(mobileSubHeader('Acerca de'));
  var box = el('section', 'm-about');
  var brand = el('div', 'm-about-brand');
  brand.innerHTML = '<svg width="56" height="56" viewBox="72 68 368 372" fill="none" stroke="#fff" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M196 84 256 144 316 84"/><rect x="92" y="144" width="328" height="232" rx="44"/><path d="M231 224v72l62-36z"/><path d="M188 424h136"/></svg>';
  brand.appendChild(el('span', 'm-about-name', 'OpenTV'));
  brand.appendChild(el('span', 'm-item-sub', 'Versión ' + String(((document.querySelector('.welcome-version') || {}).textContent || '1.1.0')).replace(/^v/, '')));
  box.appendChild(brand);
  [
    ['Sin registro ni contraseña', 'Tu lista, el historial y tus preferencias se guardan solo en este celular; no se envían a ningún servidor.'],
    ['Tendencias', 'Este producto usa la API de TMDB pero no está avalado ni certificado por TMDB.'],
    ['Desarrollado por', 'TECHPOINT Software™'],
    ['Código abierto', 'Capacitor, HLS.js (Apache 2.0) y ExoPlayer (Apache 2.0).']
  ].forEach(function (b) {
    var card = el('div', 'm-about-card');
    card.appendChild(el('span', 'm-item-title', b[0]));
    card.appendChild(el('span', 'm-item-sub', b[1]));
    box.appendChild(card);
  });
  mob.main.appendChild(box);
}
