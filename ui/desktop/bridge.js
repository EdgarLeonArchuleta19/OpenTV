(function () {
  'use strict';
  window.XUPER_DESKTOP = true;
  // A stable xuper://app origin keeps favourites and progress across launches.
  // The preload exposes only registered service calls, not Node or filesystem APIs.
  if (window.desktop) {
    window.PalmServiceBridge = function () { this.cancelled = false; };
    window.PalmServiceBridge.prototype.call = function (uri, body) {
      var self = this;
      var method = uri.replace(/\/$/, '').split('/').pop();
      var payload;
      try { payload = JSON.parse(body || '{}'); } catch (_) { payload = {}; }
      window.desktop.service(method, payload).then(function (result) {
        if (!self.cancelled && self.onservicecallback) self.onservicecallback(JSON.stringify(result));
      }).catch(function () {
        if (!self.cancelled && self.onservicecallback) self.onservicecallback(JSON.stringify({
          returnValue: false, errorText: 'No se pudo contactar con el servicio local de Windows'
        }));
      });
    };
    window.PalmServiceBridge.prototype.cancel = function () { this.cancelled = true; };
    window.desktop.onAction(function (action) {
      if (!window.__xuper) return;
      if (action === 'back') window.__xuper.key(27);
      else window.__xuper.show(action);
    });
  }
  // Default to Directo (normal), preserving a later user choice.
  try {
    if (!localStorage.getItem('xuper_global_playback_v1')) {
      localStorage.setItem('xuper_global_playback_v1', JSON.stringify({ streamMode: 'normal', screen: 1,
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
    document.addEventListener('xuper:player-status', function (event) {
      var info = event.detail || {};
      var app = window.__xuper;
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
          document.dispatchEvent(new CustomEvent('xuper:playback-timeout'));
        }, 30000);
      }
    });
    document.addEventListener('playing', function (event) {
      if (event.target && event.target.id === 'player-video') {
        if (guard) { clearTimeout(guard); guard = null; }
        playback.hidden = true;
      }
    }, true);
    /* "Catálogo actualizado" is news for a few seconds, not a fixture over
       the posters; problems stay visible. */
    var seenSync = null, syncShownAt = 0;
    setInterval(function () {
      var app = window.__xuper;
      if (!app) return;
      if (app.state.screen !== 'player' && app.state.screen !== 'detail') playback.hidden = true;
      badge.hidden = app.state.screen !== 'home';
      var sync = app.portal && app.portal.lastSync;
      if (sync && sync !== seenSync) { seenSync = sync; syncShownAt = Date.now(); }
      if (sync && !(app.portal && app.portal.error) && Date.now() - syncShownAt > 5000) badge.hidden = true;
      /* Stremio mode: the 'Stremio' mark by the logo says it; here only a problem. */
      if (app.stremioOn && app.stremioOn()) {
        var failed = app.vod && !app.vod.length && app.api && app.api.error;
        badge.hidden = badge.hidden || !failed;
        badge.textContent = failed ? 'Tus addons no respondieron (Ajustes → Fuentes)' : '';
      }
      else if (app.portal && app.portal.error) badge.textContent = 'Catálogo guardado · no se pudo actualizar desde el servicio';
      else if (app.portal && app.portal.lastSync) badge.textContent = 'OpenTV · catálogo actualizado';
      else badge.textContent = 'Catálogo guardado · conexión pendiente';
    }, 1200);
  });
})();
