/* desktop/hovercard.js — Tarjeta ampliada al dejar el ratón sobre un póster (como Netflix).
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* After a short pause over a poster of the home pages, a bigger card grows
   out of it with wide artwork, quick buttons (play, Mi lista, details),
   rating, year, type and genres. It lives in real pixels on <body>, so it
   can overflow rows and the screen edges are respected. */
var HOVER_DELAY_MS = 520;
var hoverCard = null;
var hoverCardFor = null;
var hoverTimer = null;
var hoverHideTimer = null;

function hoverPosterFrom(target) {
  if (!target || !target.closest) { return null; }
  var poster = target.closest('.poster');
  if (!poster || !poster._item || !poster.closest('#screen-home .home-page.is-current')) { return null; }
  return poster;
}

function installHoverCards() {
  if (!window.XUPER_DESKTOP || !platformHas('mouse')) { return; }
  document.addEventListener('mouseover', function (event) {
    if (hoverCard && hoverCard.contains(event.target)) { cancelHoverHide(); return; }
    var poster = hoverPosterFrom(event.target);
    if (!poster) { return; }
    /* Modo ligero: no enlarged card (it costs a lot to draw). */
    if (document.body.classList.contains('is-lite')) { return; }
    if (poster === hoverCardFor && hoverCard && hoverCard.classList.contains('is-open')) { cancelHoverHide(); return; }
    if (hoverTimer) { clearTimeout(hoverTimer); }
    hoverTimer = setTimeout(function () {
      hoverTimer = null;
      if (poster.matches(':hover') && state.screen === 'home') { openHoverCard(poster); }
    }, HOVER_DELAY_MS);
  }, true);
  document.addEventListener('mouseout', function (event) {
    var to = event.relatedTarget;
    var poster = hoverPosterFrom(event.target);
    if (poster && hoverTimer && !(to && poster.contains(to))) { clearTimeout(hoverTimer); hoverTimer = null; }
    if (!hoverCard || !hoverCard.classList.contains('is-open')) { return; }
    if (to && (hoverCard.contains(to) || (hoverCardFor && hoverCardFor.contains(to)))) { return; }
    if (hoverCard.contains(event.target) || (hoverCardFor && hoverCardFor.contains(event.target))) { scheduleHoverHide(); }
  }, true);
  /* Anything that moves the page or changes the screen closes it. */
  ['wheel', 'keydown', 'scroll'].forEach(function (type) {
    document.addEventListener(type, function (event) {
      if (type === 'scroll' && hoverCard && hoverCard.contains(event.target)) { return; }
      closeHoverCard();
    }, { capture: true, passive: true });
  });
  window.addEventListener('blur', closeHoverCard);
  window.addEventListener('resize', closeHoverCard);
}

function scheduleHoverHide() {
  cancelHoverHide();
  hoverHideTimer = setTimeout(closeHoverCard, 120);
}
function cancelHoverHide() {
  if (hoverHideTimer) { clearTimeout(hoverHideTimer); hoverHideTimer = null; }
}

function closeHoverCard() {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  cancelHoverHide();
  if (hoverCard) { hoverCard.classList.remove('is-open'); }
  hoverCardFor = null;
}

function hoverButton(cls, icon, tip, run) {
  var b = el('button', 'hc-btn ' + cls);
  b.type = 'button';
  b.innerHTML = icon;
  b.setAttribute('data-tip', tip);
  b.setAttribute('aria-label', tip);
  b.addEventListener('click', function (event) { event.stopPropagation(); run(b); });
  return b;
}

function openHoverCard(poster) {
  var item = poster._item;
  if (!hoverCard) {
    hoverCard = el('div', 'hover-card');
    hoverCard.setAttribute('data-no-gesture', '');
    document.body.appendChild(hoverCard);
  }
  clear(hoverCard);
  var art = el('div', 'hc-art');
  var src = item.landscape || item.backdrop || item.poster;
  if (src) {
    var img = el('img');
    img.alt = '';
    img.decoding = 'async';
    img.onload = function () { art.classList.add('is-loaded'); };
    img.onerror = function () { img.remove(); art.classList.add('is-generic'); };
    img.src = src;
    art.appendChild(img);
  }
  art.appendChild(el('div', 'hc-art-shade'));
  art.appendChild(el('div', 'hc-art-title', item.title));
  art.addEventListener('click', function () { closeHoverCard(); openDetail(item); });
  hoverCard.appendChild(art);

  var body = el('div', 'hc-body');
  var buttons = el('div', 'hc-buttons');
  buttons.appendChild(hoverButton('is-play', UI_ICONS.play, 'Reproducir', function () { closeHoverCard(); playTitleNow(item); }));
  var inList = inMyList(item);
  buttons.appendChild(hoverButton('is-list' + (inList ? ' is-on' : ''), inList ? UI_ICONS.check : UI_ICONS.mylist,
    inList ? 'Quitar de Mi lista' : 'Añadir a Mi lista', function (b) {
      var on = toggleMyList(item);
      b.classList.toggle('is-on', on);
      b.innerHTML = on ? UI_ICONS.check : UI_ICONS.mylist;
      b.setAttribute('data-tip', on ? 'Quitar de Mi lista' : 'Añadir a Mi lista');
    }));
  var info = hoverButton('is-info', UI_ICONS.info, 'Más información', function () { closeHoverCard(); openDetail(item); });
  buttons.appendChild(info);
  body.appendChild(buttons);
  body.appendChild(el('div', 'hc-meta', itemMetaLine(item)));
  var genres = itemGenres(item, 3);
  if (genres.length) { body.appendChild(el('div', 'hc-genres', genres.join('  •  '))); }
  hoverCard.appendChild(body);

  /* Grow from the poster, wider than it, kept inside the window. */
  var r = poster.getBoundingClientRect();
  var w = Math.max(300, Math.min(420, r.width * 1.55));
  hoverCard.style.width = w + 'px';
  hoverCard.classList.add('is-measuring');
  var h = hoverCard.offsetHeight;
  hoverCard.classList.remove('is-measuring');
  var left = r.left + r.width / 2 - w / 2;
  var top = r.top + r.height / 2 - h / 2;
  var minTop = (document.body.classList.contains('has-titlebar') ? 44 : 8);
  left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
  top = Math.max(minTop, Math.min(window.innerHeight - h - 8, top));
  hoverCard.style.left = Math.round(left) + 'px';
  hoverCard.style.top = Math.round(top) + 'px';
  hoverCard.style.transformOrigin = Math.round(r.left + r.width / 2 - left) + 'px ' + Math.round(r.top + r.height / 2 - top) + 'px';
  hoverCardFor = poster;
  void hoverCard.offsetWidth;
  hoverCard.classList.add('is-open');
}
