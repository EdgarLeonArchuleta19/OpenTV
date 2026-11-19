/* core/loader.js — Indicadores de carga: la barra fina de arriba mientras hay pedidos en curso y el indicador de una pantalla que espera datos.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------------- top bar */
/* A thin bar across the top of the window while addon or portal requests
   are pending, on every screen. It shows up only after NET_SHOW_DELAY (quick
   answers never flash it) and stays at least NET_MIN_VISIBLE once shown, so
   it never blinks. Only a transform animates (cheap on a Fire TV), and only
   while something is loading. It lives on <body>, outside the scaled
   canvas, so it is the same on PC, TVs and phones. */
var netPending = 0;
var netBar = null;
var netShowTimer = null;
var netHideTimer = null;
var netShownAt = 0;
var NET_SHOW_DELAY = 300;
var NET_MIN_VISIBLE = 450;

function netBarElement() {
  if (!netBar && document.body) {
    netBar = el('div', 'net-bar');
    netBar.setAttribute('aria-hidden', 'true');
    netBar.appendChild(el('div', 'net-bar-run'));
    document.body.appendChild(netBar);
  }
  return netBar;
}

function netBegin() {
  netPending++;
  if (netPending !== 1) { return; }
  /* Still on screen and about to hide: it just stays. */
  if (netHideTimer) { clearTimeout(netHideTimer); netHideTimer = null; return; }
  if (netShowTimer) { return; }
  netShowTimer = setTimeout(function () {
    netShowTimer = null;
    if (netPending <= 0) { return; }
    /* Never over a video being watched (the player shows its own
       "Cargando vídeo…"). */
    if (typeof state !== 'undefined' && state.screen === 'player') { return; }
    var bar = netBarElement();
    if (!bar) { return; }
    bar.classList.add('is-on');
    netShownAt = Date.now();
  }, NET_SHOW_DELAY);
}

function netEnd() {
  if (netPending > 0) { netPending--; }
  if (netPending > 0) { return; }
  if (netShowTimer) { clearTimeout(netShowTimer); netShowTimer = null; return; }
  if (!netBar || !netBar.classList.contains('is-on') || netHideTimer) { return; }
  var wait = Math.max(0, NET_MIN_VISIBLE - (Date.now() - netShownAt));
  netHideTimer = setTimeout(function () {
    netHideTimer = null;
    if (netPending === 0 && netBar) { netBar.classList.remove('is-on'); }
  }, wait);
}

/* Wraps a request's callback: the bar counts the request until the
   callback runs (once, even if it is called again). */
function trackedCallback(done) {
  netBegin();
  var ended = false;
  return function () {
    if (!ended) { ended = true; netEnd(); }
    return done.apply(this, arguments);
  };
}

/* ------------------------------------------------------- screen loader */
/* What a screen (or a part of one) shows while its data has not arrived:
   three dots breathing in turn and, optionally, one line of text. It fades
   in after a short moment, so content that is already there a split second
   later never flashes it. Replace it with the content when it is ready (the
   animation stops with the element). `cls` adds a size: 'is-small' for
   inline places such as an episode list. */
function makeLoader(text, cls) {
  var box = el('div', 'ot-loader' + (cls ? ' ' + cls : ''));
  box.setAttribute('role', 'status');
  var dots = el('div', 'ot-loader-dots');
  for (var i = 0; i < 3; i++) { dots.appendChild(el('span')); }
  box.appendChild(dots);
  if (text) { box.appendChild(el('div', 'ot-loader-text', text)); }
  return box;
}
