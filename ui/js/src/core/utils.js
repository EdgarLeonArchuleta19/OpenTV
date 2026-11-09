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
function each(list, fn) { for (var i = 0; i < list.length; i++) { fn(list[i], i); } }
