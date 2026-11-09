/* home/catalog-pages.js — Páginas de catálogo del inicio: mosaicos, cuadrículas, Destacados, Películas, Series, Kids, etc.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ---------------------------------------------------------- home posters */
/* Bento mosaic measured on the running app (WSA, 1920x1080):
     mRecommend01 831x534 @ 192,212   mRecommend02 831x534 @ 1029,212
     mRecommend03..06 413x222 @ y 752, x 192/609/1028/1446
     pagination dots around 843,723 (screen) -> page coords subtract 173.5.
   The page grid is identical for DESTACADOS, PELICULA, SERIES and ANIME. */
var BENTO_GAP = 9;
var BENTO = {
  bigW: 831, bigH: 534, bigY: 38.5,
  smallW: 413, smallH: 222, smallY: 578.5,
  bigX: [192, 1029],
  smallX: [192, 609, 1028, 1446]
};

function makeBento(item, x, y, w, h, opts) {
  opts = opts || {};
  var t = el('div', 'bento focusable');
  /* Desktop: a little air between the large tiles. */
  var gap = window.XUPER_DESKTOP ? BENTO_GAP : 0;
  abs(t, x + gap, y + gap, w - gap * 2, h - gap * 2);
  var art = item ? (item.landscape || item.poster) : '';
  if (art) {
    var img = el('img', 'bento-img');
    img.setAttribute('data-poster-src', art);
    img.onerror = posterImageError;
    img.onload = posterImageLoaded;
    t.appendChild(img);
  }
  if (opts.shade) { t.appendChild(el('div', 'bento-shade')); }
  if (opts.title && item) { t.appendChild(el('div', 'bento-title', item.title)); }
  if (opts.badge) { t.appendChild(el('div', 'bento-badge', opts.badge)); }
  t._item = item;
  if (item) { t._activate = function () { openDetail(item); }; }
  schedulePosterMemoryPass();
  return t;
}

function bentoDots(x, y, count, active) {
  var d = el('div', 'bento-dots');
  abs(d, x, y, 21 + Math.max(0, count - 1) * 40, 11);
  for (var i = 0; i < count; i++) {
    d.appendChild(el('span', 'bento-dot' + (i === active ? ' is-active' : '')));
  }
  return d;
}

function bentoPage(page, items, opts) {
  opts = opts || {};
  var source = items.length ? items : VOD;
  if (!source.length) { return; }
  var i;
  for (i = 0; i < 2; i++) {
    page.appendChild(makeBento(source[i % source.length], BENTO.bigX[i], BENTO.bigY,
                               BENTO.bigW, BENTO.bigH,
                               { shade: opts.shade !== false, title: opts.titles }));
  }
  for (i = 0; i < 4; i++) {
    page.appendChild(makeBento(source[(i + 2) % source.length], BENTO.smallX[i], BENTO.smallY,
                               BENTO.smallW, BENTO.smallH, {}));
  }
  if (opts.dots) {
    var dots = bentoDots(848, 535.5, opts.dots, 0);
    page.appendChild(dots);
    if (window.XUPER_DESKTOP && opts.titles && source.length > 1) {
      registerBannerCarousel(page, page.querySelector('.bento'), dots, source.slice(0, Math.min(opts.dots, source.length)));
    }
  }
}

/* Desktop banner carousel. Every few seconds the big banner shows the next
   title (and its dot lights up). It pauses while the pointer is on it or it
   has focus, and only runs on the visible home page. Dots can be clicked. */
var bannerCarousels = [];
var bannerTimer = null;
var BANNER_INTERVAL_MS = 6500;
var bannerKeyAt = 0;
var bannerPointerAt = 0;
if (window.XUPER_DESKTOP) {
  document.addEventListener('keydown', function () { bannerKeyAt = Date.now(); }, true);
  document.addEventListener('pointermove', function () { bannerPointerAt = Date.now(); }, { capture: true, passive: true });
}

function registerBannerCarousel(page, hero, dots, items) {
  if (!hero || items.length < 2) { return; }
  var c = { page: page, hero: hero, dots: dots, items: items, index: 0 };
  bannerCarousels = bannerCarousels.filter(function (x) { return x.hero.isConnected; });
  bannerCarousels.push(c);
  var spans = dots.querySelectorAll('.bento-dot');
  for (var i = 0; i < spans.length; i++) {
    (function (k) {
      spans[k].setAttribute('data-tip', items[k] ? items[k].title : '');
      spans[k].addEventListener('click', function (event) {
        event.stopPropagation();
        showBannerSlide(c, k);
      });
    })(i);
  }
  if (!bannerTimer) { bannerTimer = setInterval(advanceBanners, BANNER_INTERVAL_MS); }
}

function advanceBanners() {
  for (var i = 0; i < bannerCarousels.length; i++) {
    var c = bannerCarousels[i];
    if (!c.hero.isConnected || state.screen !== 'home' || !c.page.classList.contains('is-current')) { continue; }
    /* Paused while the pointer moves over it, or while the keyboard is on it. The
       first banner gets focus by itself when a tab opens, so focus alone must
       not stop it. */
    var keyboardOnHero = state.focus === c.hero && Date.now() - bannerKeyAt < 15000;
    var pointerOnHero = Date.now() - bannerPointerAt < 4000 && (c.hero.matches(':hover') || c.dots.matches(':hover'));
    if (keyboardOnHero || pointerOnHero) { continue; }
    showBannerSlide(c, (c.index + 1) % c.items.length);
  }
}

function showBannerSlide(c, k) {
  if (k === c.index || !c.items[k]) { return; }
  var item = c.items[k];
  c.index = k;
  var spans = c.dots.querySelectorAll('.bento-dot');
  for (var i = 0; i < spans.length; i++) { spans[i].classList.toggle('is-active', i === k); }
  var hero = c.hero;
  hero.classList.add('is-sliding');
  setTimeout(function () {
    var art = item.landscape || item.poster;
    var img = hero.querySelector('.bento-img');
    if (art) {
      if (!img) { img = el('img', 'bento-img'); img.onerror = posterImageError; img.onload = posterImageLoaded; hero.insertBefore(img, hero.firstChild); }
      img.style.display = '';
      img._posterRetries = 0;
      img.setAttribute('data-poster-src', art);
      img.src = art;
    }
    var title = hero.querySelector('.bento-title');
    if (title) { title.textContent = item.title; }
    hero._item = item;
    hero._activate = function () { openDetail(item); };
    hero.classList.remove('is-sliding');
  }, 260);
}

/* DESTACADOS / PELICULA: the observed 831x534 crops already contain the
   real title bar and pagination dots drawn by the APK, so the port must not
   paint a second copy over them. Portal artwork is plain 16:9 art, so the
   title and dots have to be drawn. */
function allVodFor(category) {
  var out = [], i;
  if (category) {
    for (i = 0; i < VOD.length; i++) {
      var cats = norm(VOD[i].category || '').split(',');
      if (cats.indexOf(category) !== -1 || (VOD[i].kind && norm(VOD[i].kind).indexOf(category) !== -1)) {
        out.push(VOD[i]);
      }
    }
  }
  return out.length ? out : VOD;
}

function appendCatalogGrid(page, items, startY, titleText) {
  if (!items || !items.length) { return; }
  var y = startY || 860;
  var sub = el('div', 'kids-subtitle', titleText || 'Catálogo');
  abs(sub, 192, y, 1249, 40);
  page.appendChild(sub);
  y += 50;

  var colW = 276;
  var colH = 390;
  var maxCols = 6;
  var cursor = 0;
  var more = null;
  if (window.XUPER_DESKTOP) {
    more = el('button', 'desktop-more focusable');
    more.type = 'button';
    more._activate = appendBatch;
    page.appendChild(more);
    page.addEventListener('scroll', function () {
      if (cursor < items.length && page.scrollTop + page.clientHeight >= page.scrollHeight - 250) appendBatch();
    }, { passive: true });
  }
  function appendBatch() {
    var limit = Math.min(items.length, cursor + 60);
    for (; cursor < limit; cursor++) {
      var col = cursor % maxCols;
      var row = Math.floor(cursor / maxCols);
      page.appendChild(makePoster(items[cursor], 192 + col * colW, y + row * colH, 250, 360, { gold: true }));
    }
    if (more) {
      abs(more, 192, y + Math.ceil(cursor / maxCols) * colH + 15, 1600, 74);
      more.textContent = cursor < items.length ? 'Ver más · ' + cursor + ' de ' + items.length : 'Has visto los ' + items.length + ' títulos';
      more.disabled = cursor >= items.length;
    }
    schedulePosterMemoryPass();
  }
  appendBatch();
}

function buildFeaturedPage(page) {
  var all = allVodFor('destacado');
  var items = all.slice(0, 6);
  var real = !!(items[0] && items[0]._portal);
  bentoPage(page, items, { titles: real, dots: real ? 4 : 0, shade: real });
  var rest = all.slice(6);
  if (rest.length) {
    appendCatalogGrid(page, rest, 860, 'Títulos destacados');
  }
}

function buildMoviesPage(page) {
  var all = allVodFor('pelicula');
  var items = all.slice(0, 6);
  var real = !!(items[0] && items[0]._portal);
  bentoPage(page, items, { titles: real, dots: real ? 4 : 0, shade: real });
  var rest = all.slice(6);
  if (rest.length) {
    appendCatalogGrid(page, rest, 860, 'Más películas');
  }
}

function buildSeriesPage(page) {
  var all = allVodFor('serie');
  var items = all.slice(0, 6);
  var real = !!(items[0] && items[0]._portal);
  bentoPage(page, items, { titles: real, dots: real ? 3 : 2, shade: real });
  var rest = all.slice(6);
  if (rest.length) {
    appendCatalogGrid(page, rest, 860, 'Más series');
  }
}

function buildAnimePage(page) {
  var all = allVodFor('anime');
  var items = all.slice(0, 6);
  var real = !!(items[0] && items[0]._portal);
  bentoPage(page, items, { titles: real, dots: real ? 3 : 2, shade: real });
  var rest = all.slice(6);
  if (rest.length) {
    appendCatalogGrid(page, rest, 860, 'Anime y animación');
  }
}

function novelCatalogItems() {
  var out = [];
  for (var i = 0; i < VOD.length; i++) {
    var item = VOD[i];
    var text = norm([
      item.row || '', item.category || '', item.kind || '', item.title || '', item.alias || '',
      item.genres && item.genres.join ? item.genres.join(' ') : (item.genres || '')
    ].join(' '));
    if (text.indexOf('novela') !== -1 || text.indexOf('telenovela') !== -1) {
      out.push(item);
    }
  }
  return out;
}

function buildNovelsPage(page) {
  /* The portal already includes its novela rows in the loaded home roots.
     Filter those exact records only: no synthetic catalog and no secondary
     query that could return a different host/list.

     Keep the six featured tiles above, but do not remove those titles from
     the catalogue below.  The portal currently delivers ten items in its
     official "Telenovelas" row; slicing at six made "Más novelas" look as
     if the category only had four titles. */
  var all = novelCatalogItems();
  if (!all.length) {
    var empty = el('div', 'catalog-empty', 'No se encontraron novelas en el catálogo actual.');
    abs(empty, 192, 170, 1500, 80);
    page.appendChild(empty);
  } else {
    var items = all.slice(0, 6);
    var real = !!(items[0] && items[0]._portal);
    bentoPage(page, items, { titles: real, dots: real ? 3 : 2, shade: real });
    appendCatalogGrid(page, all, 860, 'Más novelas');
  }
}

/* KIDS: hero 831x534 + 2x2 grid 413x222 on the right, a subtitle line and a
   horizontal poster row (7 columns, last one clipped by the screen edge). */
function buildKidsPage(page) {
  if (window.XUPER_DESKTOP) {
    var allKids = allVodFor('infantil');
    var kidsTop = allKids.slice(0, 6);
    var realKids = !!(kidsTop[0] && kidsTop[0]._portal);
    bentoPage(page, kidsTop, { titles: realKids, dots: realKids ? 4 : 0, shade: realKids });
    var kidsRest = allKids.slice(6);
    appendCatalogGrid(page, kidsRest.length ? kidsRest : allKids, 860, 'Para toda la familia');
    return;
  }
  var source = vodFor('infantil', 12, 0);
  if (!source.length) { source = VOD; }
  var real = !!(source[0] && source[0]._portal);
  page.appendChild(makeBento(source[0], 192, 38.5, 831, 534, { shade: true, title: real }));
  var cells = [
    [1029, 38.5], [1446, 38.5], [1029, 269.5], [1446, 269.5]
  ];
  for (var i = 0; i < cells.length; i++) {
    page.appendChild(makeBento(source[(i + 1) % source.length], cells[i][0], cells[i][1],
                               413, 222, {}));
  }
  page.appendChild(bentoDots(833, 468.5, 4, 0));
  if (source[0]) {
    var sub = el('div', 'kids-subtitle', source[0].tagline || source[0].title);
    abs(sub, 192, 526.5, 1249, 40);
    page.appendChild(sub);
  }
  var row = el('div', 'poster-row');
  abs(row, 192, 578.5, 1920, 310);
  for (var k = 0; k < 7; k++) {
    var it = source[k % source.length];
    if (!it) { break; }
    row.appendChild(makePoster(it, k * 266, 0, 266, 310, { gold: true }));
  }
  page.appendChild(row);
}

/* EXPLORAR: hero 1249x703 + three stacked 413x226 tiles on the right,
   provider row label and logo strip underneath. */
function buildExplorePage(page) {
  var source = VOD.length ? VOD : [];
  page.appendChild(makeBento(source[0], 192, 38.5, 1249, 703, { shade: true }));
  for (var i = 0; i < 3; i++) {
    page.appendChild(makeBento(source[(i + 1) % source.length], 1446, 38.5 + i * 231,
                               413, 226, { badge: i === 2 ? 'Adult' : '' }));
  }
  page.appendChild(el('div', 'explore-row-title', 'Netflix'));
  var strip = el('div', 'explore-strip');
  abs(strip, 192, 811.5, 1920, 130);
  for (var k = 0; k < 8; k++) {
    var cell = el('div', 'explore-logo');
    abs(cell, k * 272, 0, 260, 120);
    strip.appendChild(cell);
  }
  page.appendChild(strip);
}
