/* core/toast.js — Avisos cortos ("Se agregó Torrentio"): una cápsula negra abajo al centro que se va sola.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* One toast at a time: a new one replaces the one on screen. It lives on
   <body>, outside the scaled canvas (like the top loading bar), so it looks
   the same on PC, TVs and phones. Only opacity and a transform animate. */
var toastNode = null;
var toastTimer = null;

var TOAST_ICONS = {
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  err: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/></svg>'
};

/* kind: 'ok' (default), 'err' or 'info'. */
function showToast(text, kind) {
  if (!document.body || !text) { return; }
  kind = TOAST_ICONS[kind] ? kind : 'ok';
  if (!toastNode) {
    toastNode = el('div', 'ot-toast');
    toastNode.setAttribute('role', 'status');
    toastNode.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastNode);
  }
  toastNode.className = 'ot-toast is-' + kind;
  toastNode.innerHTML = '<span class="ot-toast-icon">' + TOAST_ICONS[kind] + '</span>';
  toastNode.appendChild(el('span', 'ot-toast-text', text));
  /* Restart the entrance even when one is already showing. */
  void toastNode.offsetWidth;
  toastNode.classList.add('is-on');
  if (toastTimer) { clearTimeout(toastTimer); }
  toastTimer = setTimeout(function () {
    toastTimer = null;
    if (toastNode) { toastNode.classList.remove('is-on'); }
  }, kind === 'err' ? 4200 : 2800);
}
