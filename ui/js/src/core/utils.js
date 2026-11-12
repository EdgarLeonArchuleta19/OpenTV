/* core/utils.js — Utilidades DOM y de texto: el(), $(), clear(), abs(), closest(), norm()…
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------------------ utils */
function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) { n.className = cls; }
  if (text !== undefined && text !== null) { n.textContent = text; }
  return n;
}
function $(id) { return document.getElementById(id); }
function clear(n) { while (n.firstChild) { n.removeChild(n.firstChild); } }
function abs(n, x, y, w, h) {
  n.style.position = 'absolute';
  n.style.left = x + 'px';
  n.style.top = y + 'px';
  if (w !== undefined) { n.style.width = w + 'px'; }
  if (h !== undefined) { n.style.height = h + 'px'; }
  return n;
}
function closest(node, sel) {
  /* Native Element.closest (Chromium 41+, so every TV we target): the focus
     engine calls this thousands of times per key press. */
  if (node && node.nodeType !== 1) { node = node.parentNode; }
  if (node && node.nodeType === 1 && node.closest) { return node.closest(sel); }
  while (node && node !== document) {
    if (node.nodeType === 1 && node.matches && node.matches(sel)) { return node; }
    node = node.parentNode;
  }
  return null;
}
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function norm(s) {
  s = String(s).toLowerCase();
  if (s.normalize) {
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  return s;
}

/* norm() of an item's title/alias, kept on the item. Search and its
   suggestions read every catalogue title on each letter; NFD over thousands
   of titles is slow on a Fire TV. Not enumerable, so it never ends up in a
   saved catalogue. */
function itemNorm(item, field) {
  if (!item) { return ''; }
  var src = item[field] ? String(item[field]) : '';
  var cache = item.__norm;
  if (!cache) {
    cache = {};
    try { Object.defineProperty(item, '__norm', { value: cache, enumerable: false, writable: true }); }
    catch (eDefine) { return src ? norm(src) : ''; }
  }
  if (cache[field + '$'] !== src) { cache[field + '$'] = src; cache[field] = src ? norm(src) : ''; }
  return cache[field];
}