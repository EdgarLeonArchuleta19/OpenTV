/* desktop/titlebar.js — Barra de título propia de la ventana (logo + zona para arrastrar).
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* The window has no native title bar: this strip takes its place, and
   Windows draws its own minimize / maximize / close buttons over the right
   end of it. It disappears in full screen. The canvas is laid out below it
   (see fitDesignViewport). */
var titleBarEl = null;

function titleBarHeight() {
  if (!titleBarEl || document.body.classList.contains('is-window-fullscreen')) { return 0; }
  return titleBarEl.offsetHeight || 0;
}

function installTitleBar() {
  var info = window.XUPER_DESKTOP && window.desktop && window.desktop.titleBar;
  if (!info || titleBarEl) { return; }
  titleBarEl = el('div', 'app-titlebar');
  titleBarEl.id = 'app-titlebar';
  titleBarEl.style.height = (parseInt(info.height, 10) || 36) + 'px';
  var brand = el('div', 'atb-brand');
  var logo = el('img', 'atb-logo');
  logo.src = 'images/logo-mark.svg';
  logo.alt = '';
  brand.appendChild(logo);
  brand.appendChild(el('span', 'atb-name', 'OpenTV'));
  titleBarEl.appendChild(brand);
  titleBarEl.appendChild(el('div', 'atb-section', ''));
  document.body.insertBefore(titleBarEl, document.body.firstChild);
  document.body.classList.add('has-titlebar');
  if (window.desktop.onFullscreenChanged) {
    window.desktop.onFullscreenChanged(function (isFull) {
      document.body.classList.toggle('is-window-fullscreen', !!isFull);
      fitDesignViewport();
    });
  }
  if (window.desktop.fullscreen) {
    try {
      var q = window.desktop.fullscreen('query');
      if (q && q.then) {
        q.then(function (isFull) {
          document.body.classList.toggle('is-window-fullscreen', !!isFull);
          fitDesignViewport();
        }).catch(function () {});
      }
    } catch (eQuery) { /* no full-screen info */ }
  }
}

/* Shows where the viewer is ("Películas", "Ajustes"…) next to the logo. */
function updateTitleBarSection() {
  if (!titleBarEl) { return; }
  var label = '';
  if (state.screen === 'home') {
    var tab = TABS[state.tab];
    label = tab ? String(tab.label || '').charAt(0) + String(tab.label || '').slice(1).toLowerCase() : '';
    if (label === 'Pelicula') { label = 'Películas'; }
    if (label === 'Tv') { label = 'TV en vivo'; }
    if (label === 'Kids') { label = 'Kids'; }
  } else if (state.screen === 'search') { label = 'Buscar'; }
  else if (state.screen === 'settings') { label = 'Ajustes'; }
  else if (state.screen === 'detail' && state.detail) { label = state.detail.title || ''; }
  else if (state.screen === 'player') {
    label = state.playerMode === 'live' ? ((CHANNELS[state.channel] || {}).name || 'TV en vivo')
      : ((state.playerItem && state.playerItem.title) || '');
  }
  var node = titleBarEl.querySelector('.atb-section');
  if (node.textContent !== label) { node.textContent = label; }
}

