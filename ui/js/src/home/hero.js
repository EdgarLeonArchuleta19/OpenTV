/* home/hero.js — Escritorio: portada grande de cada sección (imagen a todo el ancho, título y botones).
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* The artwork is one layer behind the whole home screen (under the
   transparent top bar, edge to edge) and moves up with the page's scroll.
   The text and buttons live inside the page, so keyboard focus and scroll
   work as for any other tile. It rotates through a few titles. */
var HERO_INTERVAL_MS = 9000;
var HERO_MAX = 6;
var HERO_TEXT_H = 640;           /* page height used by the hero block */
var heroLayer = null;
var heroPages = {};              /* page index -> { items, index, info } */
var heroTimer = null;
var heroShownPage = -1;
var heroHoverAt = 0;

var GENRE_ES = {
  'action': 'Acción', 'adventure': 'Aventura', 'animation': 'Animación', 'cartoon': 'Animación', 'comedy': 'Comedia',
  'crime': 'Crimen', 'documentary': 'Documental', 'drama': 'Drama', 'family': 'Familia', 'fantasy': 'Fantasía',
  'history': 'Historia', 'horror': 'Terror', 'music': 'Música', 'musical': 'Musical', 'mystery': 'Misterio',
  'romance': 'Romance', 'sci-fi': 'Ciencia ficción', 'science fiction': 'Ciencia ficción', 'sport': 'Deporte',
  'thriller': 'Suspenso', 'war': 'Bélica', 'western': 'Western', 'biography': 'Biografía', 'reality-tv': 'Reality',
  'anime': 'Anime', 'short': 'Corto', 'tv movie': 'Película de TV', 'game show': 'Concurso', 'news': 'Noticias'
};
function genreName(g) {
  var k = String(g || '').trim().toLowerCase();
  return GENRE_ES[k] || String(g || '').trim();
}

function heroArt(item) { return item ? (item.backdrop || item.landscape || '') : ''; }

function itemMetaLine(item) {
  var bits = [];
  var score = parseFloat(item.score);
  if (score > 0) { bits.push('★ ' + score.toFixed(1)); }
  var year = String(item.year || item.releaseDate || '').match(/\d{4}/);
  if (year) { bits.push(year[0]); }
  bits.push(isSeriesItem(item) ? 'Serie' : 'Película');
  var secs = durationToSeconds(item.duration);
  if (!isSeriesItem(item) && secs > 600) {
    var h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
    bits.push(h ? h + ' h ' + (m ? m + ' min' : '') : m + ' min');
  }
  return bits.join('   ·   ');
}

function itemGenres(item, max) {
  var out = [];
  var list = item.genres || [];
  for (var i = 0; i < list.length && out.length < (max || 3); i++) {
    var g = genreName(list[i]);
    if (g && !/^sin clasificar$/i.test(g) && !/^\d+$/.test(g) && out.indexOf(g) === -1) { out.push(g); }
  }
  return out;
}

/* Play right away: open the title (it loads its episodes / streams) and go
   full screen as soon as it is ready. */
function playTitleNow(item) {
  if (!item) { return; }
  openDetail(item);
  loadVodDetail(item, function (loaded) {
    if (loaded && state.screen === 'detail' && state.detail === item) {
      expandToFullscreen(item, state.detailEpisode);
    }
  });
}

function ensureHeroLayer() {
  if (heroLayer && heroLayer.isConnected) { return heroLayer; }
  var home = $('screen-home');
  heroLayer = el('div', 'home-hero');
  heroLayer.appendChild(el('img', 'hh-img is-a'));
  heroLayer.appendChild(el('img', 'hh-img is-b'));
  heroLayer.appendChild(el('div', 'hh-shade'));
  var imgs = heroLayer.querySelectorAll('img');
  for (var i = 0; i < imgs.length; i++) { imgs[i].alt = ''; imgs[i].decoding = 'async'; }
  home.insertBefore(heroLayer, $('home-pages'));
  return heroLayer;
}

function setHeroArt(art) {
  var layer = ensureHeroLayer();
  var a = layer.querySelector('.is-a'), b = layer.querySelector('.is-b');
  var shown = a.classList.contains('is-shown') ? a : (b.classList.contains('is-shown') ? b : null);
  if (shown && shown.getAttribute('src') === art) { return; }
  var next = shown === a ? b : a;
  next.onload = function () {
    next.classList.add('is-shown');
    if (shown && shown !== next) { shown.classList.remove('is-shown'); }
  };
  next.onerror = function () { next.classList.remove('is-shown'); };
  next.src = art;
}

/* Builds the hero block at the top of `page`. Returns the y where the rest
   of the page starts, or 0 when the section has no artwork to show. */
function buildHero(page, source) {
  var items = [];
  for (var i = 0; i < source.length && items.length < HERO_MAX; i++) {
    if (heroArt(source[i]) && hasUsableCover(source[i])) { items.push(source[i]); }
  }
  if (!items.length) { return 0; }
  var idx = pages.indexOf(page);
  var info = el('div', 'hero-info');
  abs(info, 192, 70, 1180, 530);
  info.addEventListener('pointermove', function () { heroHoverAt = Date.now(); });
  page.appendChild(info);
  var dots = el('div', 'hero-dots');
  abs(dots, 1500, 560, 340, 20);
  page.appendChild(dots);
  heroPages[idx] = { items: items, index: 0, info: info, dots: dots, page: page };
  renderHeroInfo(heroPages[idx]);
  if (!page._heroScroll) {
    page._heroScroll = true;
    page.addEventListener('scroll', function () {
      if (!page.classList.contains('is-current')) { return; }
      syncHeroScroll(page);
    }, { passive: true });
  }
  if (!heroTimer) { heroTimer = setInterval(rotateHero, HERO_INTERVAL_MS); }
  if (page.classList.contains('is-current')) { showHeroForPage(idx); }
  return HERO_TEXT_H;
}

function renderHeroInfo(h) {
  var item = h.items[h.index];
  var info = h.info;
  info.classList.add('is-swapping');
  setTimeout(function () {
    clear(info);
    info.appendChild(el('div', 'hero-kicker', isSeriesItem(item) ? 'Serie' : 'Película'));
    /* Long titles get a smaller size instead of being cut. */
    var len = String(item.title || '').length;
    info.appendChild(el('div', 'hero-title' + (len > 52 ? ' is-xlong' : len > 30 ? ' is-long' : ''), item.title));
    info.appendChild(el('div', 'hero-meta', itemMetaLine(item)));
    var genres = itemGenres(item, 3);
    if (genres.length) { info.appendChild(el('div', 'hero-genres', genres.join('  •  '))); }
    var syn = String(item.synopsis || '');
    if (syn && !/^sin sinopsis/i.test(syn)) { info.appendChild(el('div', 'hero-synopsis', syn)); }
    var row = el('div', 'hero-buttons');
    var play = el('div', 'hero-btn is-primary focusable');
    play.innerHTML = UI_ICONS.play + '<span>Reproducir</span>';
    play._activate = function () { playTitleNow(item); };
    var more = el('div', 'hero-btn focusable');
    more.innerHTML = UI_ICONS.info + '<span>Más información</span>';
    more._activate = function () { openDetail(item); };
    var fav = el('div', 'hero-btn is-round focusable' + (state.favs[String(item.id)] ? ' is-on' : ''));
    fav.innerHTML = state.favs[String(item.id)] ? UI_ICONS.check : UI_ICONS.mylist;
    fav.setAttribute('data-tip', state.favs[String(item.id)] ? 'Quitar de Mi lista' : 'Añadir a Mi lista');
    fav._activate = function () {
      var on = toggleFavorite(item);
      fav.classList.toggle('is-on', on);
      fav.innerHTML = on ? UI_ICONS.check : UI_ICONS.mylist;
      fav.setAttribute('data-tip', on ? 'Quitar de Mi lista' : 'Añadir a Mi lista');
    };
    row.appendChild(play);
    row.appendChild(more);
    row.appendChild(fav);
    info.appendChild(row);
    info.classList.remove('is-swapping');
  }, info.childNodes.length ? 220 : 0);
  clear(h.dots);
  for (var d = 0; d < h.items.length; d++) {
    (function (k) {
      var dot = el('i', 'hero-dot' + (k === h.index ? ' is-active' : ''));
      dot.addEventListener('click', function () { h.index = k; renderHeroInfo(h); showHeroForPage(pages.indexOf(h.page)); });
      h.dots.appendChild(dot);
    })(d);
  }
  if (heroShownPage === pages.indexOf(h.page)) { setHeroArt(heroArt(item)); }
}

function rotateHero() {
  var h = heroPages[heroShownPage];
  if (!h || state.screen !== 'home' || document.hidden || h.items.length < 2) { return; }
  if (Date.now() - heroHoverAt < 5000) { return; }
  if (state.focus && closest(state.focus, '.hero-info') && focusRingVisible) { return; }
  if (h.page.scrollTop > 500) { return; }
  h.index = (h.index + 1) % h.items.length;
  renderHeroInfo(h);
}

/* Called when the home page changes (or the home screen shows again). */
function showHeroForPage(idx) {
  if (!window.XUPER_DESKTOP) { return; }
  var h = heroPages[idx];
  var layer = ensureHeroLayer();
  heroShownPage = h && h.info.isConnected ? idx : -1;
  layer.classList.toggle('is-visible', heroShownPage >= 0);
  if (heroShownPage >= 0) {
    setHeroArt(heroArt(h.items[h.index]));
    syncHeroScroll(h.page);
  } else {
    document.body.classList.toggle('is-home-scrolled', !!(pages[idx] && pages[idx].scrollTop > 140));
  }
}

function syncHeroScroll(page) {
  var y = page.scrollTop;
  if (heroLayer && heroShownPage === pages.indexOf(page)) {
    heroLayer.style.transform = 'translateY(' + (-y) + 'px)';
  }
  document.body.classList.toggle('is-home-scrolled', y > 140);
}
