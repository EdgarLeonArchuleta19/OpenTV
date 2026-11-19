/* js/platform.js — En qué aparato corre OpenTV y qué puede hacer ahí.
   Se carga antes que todo lo demás (index.html) y no depende de nada.

   window.OPENTV_PLATFORM = {
     name:  'electron' | 'android' | 'browser',
     tv:    true en Android TV y Fire TV (control remoto, pantalla grande),
     has(capacidad) → true / false
   }

   Capacidades:
     'window'        ventana propia: barra de título, pantalla completa de ventana,
                     siempre encima (solo Electron)
     'pip'           ventana flotante del sistema (Electron)
     'mouse'         ratón o puntero como entrada principal (Electron)
     'system-volume' volumen del sistema operativo (Electron, Windows)
     'updates'       actualizaciones dentro de la app (Electron)
     'logs'          carpeta del registro de errores (Electron)
     'backup'        copia de perfiles fuera de la app (Electron)
     'hls-js'        reproducir HLS con hls.js (Electron, y Android sin reproductor nativo)
     'native-player' el vídeo lo reproduce la app nativa (Android: ExoPlayer,
                     js/native-player.js + NativePlayerPlugin.java)

   Para probar otra plataforma en el PC: añade ?platform=android-tv (o
   android) a la dirección de la página. */
(function () {
  'use strict';
  var ua = navigator.userAgent || '';
  var forced = (/[?&]platform=([a-z-]+)/.exec(location.search || '') || [])[1] || '';

  var name = 'browser';
  var tv = false;
  if (forced) {
    name = forced.replace(/-tv$/, '');
    tv = /-tv$/.test(forced);
  } else if (window.desktop) {
    name = 'electron';
  } else if (window.Capacitor && typeof window.Capacitor.getPlatform === 'function' &&
             window.Capacitor.getPlatform() === 'android') {
    name = 'android';
    /* The Android shell says whether it runs on a TV; the user agent is the
       fallback (Fire TV models start with AFT). */
    tv = !!(window.OPENTV_ANDROID_TV || /\bAFT[A-Z0-9]|Android TV|GoogleTV|BRAVIA/i.test(ua));
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
    /* addons: movies and series from the viewer's addons (every platform).
       torrents and downloads: PC only for now (the PC service has the engine). */
    electron: ['window', 'pip', 'mouse', 'system-volume', 'updates', 'logs', 'backup', 'hls-js', 'addons', 'torrents', 'downloads'],
    /* Android: the app's native player (ExoPlayer) when the app has it;
       hls.js in the WebView otherwise. */
    android: nativePlayerPlugin() ? ['native-player', 'addons'] : ['hls-js', 'addons'],
    browser: ['mouse', 'pip', 'hls-js', 'addons']
  };
  var caps = CAPS[name] || CAPS.browser;

  window.OPENTV_PLATFORM = {
    name: name,
    tv: tv,
    has: function (cap) { return caps.indexOf(cap) !== -1; },
    /* A capability the device confirms at run time (Android: torrents
       when the service's ping says the engine runs here). */
    enable: function (cap) { if (caps.indexOf(cap) === -1) { caps = caps.concat([cap]); } }
  };

  document.addEventListener('DOMContentLoaded', function () {
    document.body.classList.add('platform-' + name);
    if (tv) { document.body.classList.add('is-tv'); }
  });
}());
