/* js/platform.js — En qué aparato corre OpenTV y qué puede hacer ahí.
   Se carga antes que todo lo demás (index.html) y no depende de nada.

   window.OPENTV_PLATFORM = {
     name:  'electron' | 'webos' | 'android' | 'browser',
     tv:    true en TV LG, Android TV y Fire TV (control remoto, pantalla grande),
     has(capacidad) → true / false
   }

   Capacidades:
     'window'        ventana propia: barra de título, pantalla completa de ventana,
                     siempre encima (solo Electron)
     'pip'           ventana flotante del sistema (Electron)
     'mouse'         ratón o puntero como entrada principal (Electron; el Magic
                     Remote de LG también apunta)
     'system-volume' volumen del sistema operativo (Electron, Windows)
     'updates'       actualizaciones dentro de la app (Electron)
     'logs'          carpeta del registro de errores (Electron)
     'backup'        copia de perfiles fuera de la app (Electron)
     'hls-js'        reproducir HLS con hls.js (Electron; las TV lo hacen nativo)
     'native-player' el vídeo lo reproduce la app nativa (Android: ExoPlayer,
                     js/native-player.js + NativePlayerPlugin.java)

   Para probar otra plataforma en el PC: añade ?platform=webos (o android,
   android-tv) a la dirección de la página. */
(function () {
  'use strict';
  var ua = navigator.userAgent || '';
  var forced = (/[?&]platform=([a-z-]+)/.exec(location.search || '') || [])[1] || '';

  var name = 'browser';
  var tv = false;
  if (forced) {
    name = forced.replace(/-tv$/, '');
    tv = forced === 'webos' || /-tv$/.test(forced);
  } else if (window.desktop) {
    name = 'electron';
  } else if (window.Capacitor && typeof window.Capacitor.getPlatform === 'function' &&
             window.Capacitor.getPlatform() === 'android') {
    name = 'android';
    /* The Android shell says whether it runs on a TV; the user agent is the
       fallback (Fire TV models start with AFT). */
    tv = !!(window.OPENTV_ANDROID_TV || /\bAFT[A-Z0-9]|Android TV|GoogleTV|BRAVIA/i.test(ua));
  } else if (window.PalmSystem || /Web0S|webOS/i.test(ua)) {
    name = 'webos';
    tv = true;
  }

  function nativePlayerPlugin() {
    var cap = window.Capacitor;
    if (!cap) { return false; }
    /* localStorage opentv_player = 'web' goes back to hls.js (tests). */
    try { if (localStorage.getItem('opentv_player') === 'web') { return false; } } catch (e) { /* ignore */ }
    var headers = cap.PluginHeaders || [];
    for (var i = 0; i < headers.length; i++) {
      if (headers[i] && headers[i].name === 'NativePlayer') { return true; }
    }
    return !!(cap.Plugins && cap.Plugins.NativePlayer);
  }

  var CAPS = {
    /* addons: the catalog modes (automatic / Stremio) and torrents, PC only. */
    electron: ['window', 'pip', 'mouse', 'system-volume', 'updates', 'logs', 'backup', 'hls-js', 'addons', 'torrents'],
    webos: ['mouse'],
    /* Android: the app's native player (ExoPlayer) when the app has it;
       hls.js in the WebView otherwise. */
    android: nativePlayerPlugin() ? ['native-player'] : ['hls-js'],
    browser: ['mouse', 'pip', 'hls-js']
  };
  var caps = CAPS[name] || CAPS.browser;

  window.OPENTV_PLATFORM = {
    name: name,
    tv: tv,
    has: function (cap) { return caps.indexOf(cap) !== -1; }
  };

  document.addEventListener('DOMContentLoaded', function () {
    document.body.classList.add('platform-' + name);
    if (tv) { document.body.classList.add('is-tv'); }
  });
}());
