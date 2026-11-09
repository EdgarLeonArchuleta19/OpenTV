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
      localStorage.setItem('xuper_global_playback_v1', JSON.stringify({ streamMode: 'normal', screen: 0,
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
          playback.textContent = 'El servicio no completó la carga del vídeo. Abre Diagnóstico para ver el último intento.';
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
    setInterval(function () {
      var app = window.__xuper;
      if (!app) return;
      if (app.state.screen !== 'player' && app.state.screen !== 'detail') playback.hidden = true;
      badge.hidden = app.state.screen !== 'home';
      if (app.portal && app.portal.error) badge.textContent = 'Catálogo guardado · no se pudo actualizar desde el servicio';
      else if (app.portal && app.portal.lastSync) badge.textContent = 'OpenTV · catálogo actualizado';
      else badge.textContent = 'Catálogo guardado · conexión pendiente';
    }, 1200);
  });
})();
