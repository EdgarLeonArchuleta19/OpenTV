/* core/tv-keyboard.js — Teclado en pantalla para la tele: letras, números, espacio y borrar, que se recorren con el control (buscador y guía de canales).
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* TVs only. The system keyboard of a Fire TV covers the whole screen and
   hides what is being searched; this one sits next to the results, which
   change while the viewer types. Keys are plain focusable elements (the
   usual spatial navigation moves through them); nothing animates. */
var TVK_ROWS = [
  ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  ['h', 'i', 'j', 'k', 'l', 'm', 'n'],
  ['ñ', 'o', 'p', 'q', 'r', 's', 't'],
  ['u', 'v', 'w', 'x', 'y', 'z', '\''],
  ['1', '2', '3', '4', '5', '6', '7'],
  ['8', '9', '0', '.', '-', ':', '&']
];
var TVK_MAX = 60;
var TVK_BACKSPACE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="m16 9-5 6M11 9l5 6"/></svg>';

/* opts: placeholder, value, onChange(text), doneLabel + onDone(text)
   (the white button in the bar), cls (extra class for its size).
   Returns { el, first, set(text), get() }. */
function makeTvKeyboard(opts) {
  opts = opts || {};
  var value = String(opts.value || '');
  var box = el('div', 'tvk' + (opts.cls ? ' ' + opts.cls : ''));
  /* The bar: what is typed and, with doneLabel, the white Buscar button
     next to it (as on the desktop search bar). Up from the keys reaches it. */
  var bar = el('div', 'tvk-bar');
  var display = el('div', 'tvk-display');
  var text = el('span', 'tvk-text');
  display.appendChild(text);
  bar.appendChild(display);
  if (opts.doneLabel) {
    var go = el('div', 'tvk-go focusable');
    go.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
    go.appendChild(el('span', '', opts.doneLabel));
    go._activate = function () { if (opts.onDone) { opts.onDone(value); } };
    bar.appendChild(go);
  }
  box.appendChild(bar);
  var grid = el('div', 'tvk-grid');

  function show() {
    text.textContent = value || opts.placeholder || '';
    display.classList.toggle('is-empty', !value);
  }
  function set(v, quiet) {
    value = String(v || '').slice(0, TVK_MAX);
    show();
    if (!quiet && opts.onChange) { opts.onChange(value); }
  }
  function key(label, cls, fn) {
    var k = el('div', 'tvk-key focusable' + (cls ? ' ' + cls : ''), label);
    k._activate = fn;
    grid.appendChild(k);
    return k;
  }
  for (var r = 0; r < TVK_ROWS.length; r++) {
    for (var c = 0; c < TVK_ROWS[r].length; c++) {
      key(TVK_ROWS[r][c], '', (function (ch) {
        return function () { set(value + ch); };
      })(TVK_ROWS[r][c]));
    }
  }
  key('Espacio', 'is-wide3', function () {
    if (value && value.charAt(value.length - 1) !== ' ') { set(value + ' '); }
  });
  var del = key('', 'is-wide2 is-del', function () { if (value) { set(value.slice(0, -1)); } });
  del.innerHTML = TVK_BACKSPACE + '<span>Borrar</span>';
  key('Limpiar', 'is-wide2', function () { if (value) { set(''); } });
  box.appendChild(grid);
  show();
  return {
    el: box,
    first: grid.firstChild,
    set: function (v) { set(v, true); },
    get: function () { return value; }
  };
}

/* ---------------------------------------------- keyboard over a window */
/* A panel with the keyboard over part of a window (the channel guide):
   `cover` is the part it hides, whose controls stop taking the focus
   while it is open (core/focus.js isVisible). Back closes it
   (tvKeyboardBack, from handleKey). */
var tvKbPanel = null;

function openTvKeyboardPanel(host, opts) {
  closeTvKeyboardPanel(true);
  var panel = el('div', 'tvk-panel');
  if (opts.title) { panel.appendChild(el('div', 'tvk-title', opts.title)); }
  var kb = makeTvKeyboard({
    placeholder: opts.placeholder, value: opts.value, cls: opts.cls,
    onChange: opts.onChange,
    doneLabel: opts.doneLabel,
    onDone: function (v) { closeTvKeyboardPanel(true); if (opts.onDone) { opts.onDone(v); } }
  });
  panel.appendChild(kb.el);
  host.appendChild(panel);
  if (opts.cover) { opts.cover.classList.add('tvk-covered'); }
  if (opts.hostClass) { host.classList.add(opts.hostClass); }
  tvKbPanel = { panel: panel, host: host, opts: opts, returnFocus: state.focus };
  setFocus(kb.first);
  return kb;
}

/* `quiet`: no focus change (the caller decides where it goes). */
function closeTvKeyboardPanel(quiet) {
  if (!tvKbPanel) { return false; }
  var p = tvKbPanel;
  tvKbPanel = null;
  if (p.panel.parentNode) { p.panel.parentNode.removeChild(p.panel); }
  if (p.opts.cover) { p.opts.cover.classList.remove('tvk-covered'); }
  if (p.opts.hostClass) { p.host.classList.remove(p.opts.hostClass); }
  if (!quiet && p.returnFocus && p.returnFocus.isConnected) { setFocus(p.returnFocus, true); }
  return true;
}

/* Back with the panel open: close it (true when it did). */
function tvKeyboardBack() {
  return closeTvKeyboardPanel(false);
}
