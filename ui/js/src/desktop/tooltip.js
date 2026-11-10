/* desktop/tooltip.js — Descripciones emergentes al pasar el ratón (data-tip / title).
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* One tooltip for the whole app, drawn in the app's style instead of the
   native Windows one. Any element with data-tip or title gets it; a title is
   moved to data-tip on hover so the native tooltip does not appear too. */
var tooltipEl = null;
var tooltipTarget = null;
var tooltipTimer = null;

function installTooltips() {
  if (tooltipEl || !window.XUPER_DESKTOP || !platformHas('mouse')) { return; }
  tooltipEl = el('div', 'ui-tooltip');
  tooltipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tooltipEl);

  document.addEventListener('pointerover', function (event) {
    if (event.pointerType && event.pointerType !== 'mouse') { return; }
    var node = event.target instanceof Element ? event.target.closest('[data-tip], [title]') : null;
    if (node && node.hasAttribute('title')) {
      var t = node.getAttribute('title');
      node.removeAttribute('title');
      if (t && !node.getAttribute('data-tip')) { node.setAttribute('data-tip', t); }
    }
    if (node === tooltipTarget) { return; }
    hideTooltip();
    if (!node || !node.getAttribute('data-tip')) { return; }
    tooltipTarget = node;
    tooltipTimer = setTimeout(showTooltip, 380);
  }, true);
  document.addEventListener('pointerout', function (event) {
    if (tooltipTarget && (!event.relatedTarget || !tooltipTarget.contains(event.relatedTarget))) { hideTooltip(); }
  }, true);
  document.addEventListener('pointerdown', hideTooltip, true);
  document.addEventListener('keydown', hideTooltip, true);
  document.addEventListener('scroll', hideTooltip, true);
  window.addEventListener('blur', hideTooltip);
}

function showTooltip() {
  tooltipTimer = null;
  var node = tooltipTarget;
  if (!node || !node.isConnected || !tooltipEl) { return; }
  var text = node.getAttribute('data-tip');
  if (!text) { return; }
  tooltipEl.textContent = text;
  tooltipEl.classList.add('is-visible');
  var r = node.getBoundingClientRect();
  var tw = tooltipEl.offsetWidth;
  var th = tooltipEl.offsetHeight;
  var gap = 8;
  var top = r.bottom + gap;
  /* Controls at the bottom of the player: show the tooltip above them. */
  if (top + th > window.innerHeight - 6) { top = r.top - th - gap; }
  var left = Math.max(6, Math.min(window.innerWidth - tw - 6, r.left + r.width / 2 - tw / 2));
  tooltipEl.style.left = Math.round(left) + 'px';
  tooltipEl.style.top = Math.round(Math.max(6, top)) + 'px';
}

function hideTooltip() {
  if (tooltipTimer) { clearTimeout(tooltipTimer); tooltipTimer = null; }
  tooltipTarget = null;
  if (tooltipEl) { tooltipEl.classList.remove('is-visible'); }
}
