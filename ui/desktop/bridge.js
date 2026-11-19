(function () {
  'use strict';
  window.OPENTV_DESKTOP = true;
  // A stable opentv://app origin keeps favourites and progress across launches.
  // The preload exposes only registered service calls, not Node or filesystem APIs.
  if (window.desktop) {
    window.desktop.onAction(function (action) {
      if (!window.__opentv) return;
      if (action === 'back') window.__opentv.key(27);
      else window.__opentv.show(action);
    });
  }
  // Default to Directo (normal), preserving a later user choice.
  try {
    if (!localStorage.getItem('opentv_global_playback_v1')) {
      localStorage.setItem('opentv_global_playback_v1', JSON.stringify({ streamMode: 'normal', screen: 1,
        audio: 0, subLang: 0, size: 0, style: 0, subtitle: true }));
    }
  } catch (_) { /* storage may be disabled by the host */ }
  document.addEventListener('DOMContentLoaded', function () {
    document.body.classList.add('desktop');
    var badge = document.createElement('div');
    badge.id = 'desktop-status';
    badge.textContent = 'Catálogo guardado · conectando con el servicio…';
    document.body.appendChild(badge);
    var playback = document.createElement('div');
    playback.id = 'desktop-playback-message';
    playback.setAttribute('role', 'status');
    playback.setAttribute('aria-live', 'polite');
    playback.hidden = true;
    document.body.appendChild(playback);
    var guard = null;
    document.addEventListener('opentv:player-status', function (event) {
      var info = event.detail || {};
      var app = window.__opentv;
      var visible = info.mode === 'vod' && info.text && (!app || app.state.screen === 'detail' || app.state.screen === 'player');
      playback.hidden = !visible;
      playback.textContent = visible ? info.text : '';
      playback.classList.toggle('is-error', !!info.error);
      if (guard) { clearTimeout(guard); guard = null; }
      if (visible && !info.error && info.loading) {
        guard = setTimeout(function () {
          playback.hidden = false;
          playback.classList.add('is-error');
          playback.textContent = 'El vídeo no terminó de cargar. Inténtalo otra vez o prueba otra fuente.';
          document.dispatchEvent(new CustomEvent('opentv:playback-timeout'));
        }, 30000);
      }
    });
    document.addEventListener('playing', function (event) {
      if (event.target && event.target.id === 'player-video') {
        if (guard) { clearTimeout(guard); guard = null; }
        playback.hidden = true;
      }
    }, true);
    /* Only a problem is shown, on the home: the addons gave no titles. */
    setInterval(function () {
      var app = window.__opentv;
      if (!app) return;
      if (app.state.screen !== 'player' && app.state.screen !== 'detail') playback.hidden = true;
      var failed = app.state.screen === 'home' && app.vod && !app.vod.length && app.api && !app.api.loading && app.api.error;
      badge.hidden = !failed;
      badge.textContent = failed ? app.api.error + ' · Ajustes → Addons' : '';
    }, 1200);
  });
})();
