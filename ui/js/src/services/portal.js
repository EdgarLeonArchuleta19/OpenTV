/* services/portal.js — Servicio local (IPC en escritorio / HTTP en Android):
   llamadas, errores y la carga del catálogo de los addons.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------ local service
   portalServiceCall reaches the bundled service: IPC in Electron
   (window.desktop.service), HTTP on 127.0.0.1 on Android (devServiceUrl). */
function hasDesktopService() {
  return !!(window.desktop && typeof window.desktop.service === 'function');
}

function queryString(params) {
var parts = [];
for (var k in params) {
  if (Object.prototype.hasOwnProperty.call(params, k)) {
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
  }
}
return parts.join('&');
}

function describeServiceError(text) {
return String(text == null ? '' : text);
}

var lastVodAttempt = { phase: 'sin intento', status: 'sin datos', error: '' };
/* An error shown on screen must never expose a playable URL, signed query,
   token or request header: only a short, readable reason. */
function reportSafeText(value) {
  var text = String(value == null ? '' : value);
  text = text.replace(/https?:\/\/[^\s"']+/ig, '[URL OCULTA]');
  text = text.replace(/(token|signature|authorization|cookie|key)=?[^\s,&]*/ig, '$1=[OCULTO]');
  text = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');
  return text.slice(0, 150);
}
function vodFailure(phase, message) {
var safe = reportSafeText(String(message || 'El servicio no devolvió los datos necesarios'));
lastVodAttempt = { phase: phase, status: 'error', error: safe };
state.streamError = 'No se pudo cargar ' + phase + ': ' + safe;
setPlayerStatus(state.streamError);
}
document.addEventListener('opentv:playback-timeout', function () {
if (state.playerMode === 'vod' && (state.screen === 'detail' || state.screen === 'player')) {
  vodFailure(lastVodAttempt.phase, 'La carga no terminó dentro de 30 segundos');
}
});

function portalServiceCall(method, params, done, customTimeout) {
var settled = false;
var timeoutMs = customTimeout || parseInt(vodApi.timeoutMs, 10) || 20000;
var callTimer = null;
function finish(error, payload) {
  if (settled) { return; }
  settled = true;
  if (callTimer) { clearTimeout(callTimer); callTimer = null; }
  done(error ? describeServiceError(error) : error, payload);
}
callTimer = setTimeout(function () {
  finish('El servicio de la TV no respondió en ' + Math.round(timeoutMs / 1000) + ' s. Cierra y vuelve a abrir la aplicación de Windows.', null);
}, timeoutMs + 1000);
if (hasDesktopService()) {
  try {
    window.desktop.service(method, params || {}).then(function (payload) {
      if (!payload || payload.returnValue === false) {
        finish((payload && payload.errorText) || 'Error del servicio OpenTV', null);
      } else {
        finish(null, payload);
      }
    }, function () {
      finish('No se pudo contactar con el servicio local de Windows', null);
    });
    return true;
  } catch (e) {
    if (!vodApi.devServiceUrl) {
      finish('Error comunicando con el servicio: ' + (e.message || e), null);
      return false;
    }
  }
}
/* Android (and the browser harness): the same methods over plain HTTP. */
if (vodApi.devServiceUrl) {
  apiRequest(String(vodApi.devServiceUrl).replace(/\/$/, '') + '/' + method + '?' + queryString(params || {}),
    function (error, payload) { finish(error, payload); }, null);
  return true;
}
finish('El servicio OpenTV no está disponible', null);
return false;
}

/* The portal's kids section also carries mature anime (Tokyo Ghoul,
   Beastars...). Those titles keep their other sections but leave Kids. */
var KIDS_BLOCKED_GENRES = /crime|crimen|thriller|suspense|erotic|adult|war\b|guerra|gore/;
var KIDS_BLOCKED_TITLES = /tokyo ghoul|beastars|attack on titan|shingeki|death note|chainsaw|jujutsu|berserk|devilman|parasyte|kiseijuu|hellsing|elfen lied|kimetsu|demon slayer|hunter x hunter|akame|goblin slayer|psycho.?pass|vinland|banana fish|terror in resonance/;
function notForKids(item) {
  var genres = item.genres || [];
  if (Object.prototype.toString.call(genres) !== '[object Array]') { genres = [String(genres)]; }
  return KIDS_BLOCKED_GENRES.test(norm(genres.join(' '))) || KIDS_BLOCKED_TITLES.test(norm(item.title || ''));
}
function keepKidsSafe(item) {
  if (!item || String(item.category || '').indexOf('infantil') === -1 || !notForKids(item)) { return; }
  item.category = String(item.category).split(',').filter(function (c) { return c !== 'infantil'; }).join(',');
}

/* Movies and series: the viewer's addons. If none answers, the home says so. */
function loadVodCatalog() {
  if (!vodApi.enabled) { return; }
  vodApiState.loading = true;
  syncExternalVodCatalogs(function (err, count) {
    vodApiState.loading = false;
    vodApiState.error = count ? null : (getVodSourcesConfig().addons.length ? 'Tus addons no respondieron' : 'Agrega un addon con catálogo');
  });
}

/* PC: the addons' catalogs are read again every 20 minutes so new titles
   appear without restarting. It waits until the viewer is not in the middle
   of browsing the home page, because a refresh rebuilds it. */
var CATALOG_REFRESH_MS = 20 * 60 * 1000;
var lastUserActivity = Date.now();
var lastCatalogSync = Date.now();
function startCatalogAutoRefresh() {
  if (!window.OPENTV_DESKTOP || vodApi.refresh === false) { return; }
  ['pointermove', 'keydown', 'wheel'].forEach(function (type) {
    document.addEventListener(type, function () { lastUserActivity = Date.now(); }, { passive: true, capture: true });
  });
  setInterval(function () {
    if (vodApiState.loading || Date.now() - lastCatalogSync < CATALOG_REFRESH_MS) { return; }
    var browsingHome = state.screen === 'home' && Date.now() - lastUserActivity < 60000;
    if (browsingHome) { return; }
    lastCatalogSync = Date.now();
    syncExternalVodCatalogs(function () {});
  }, 60000);
}

/* A title's full details: the addon's meta (episodes, cast…). Anything else
   already carries what it has. */
function loadVodDetail(item, done) {
  done = done || function () {};
  if (!item) { return done(null); }
  if (item._detailsLoaded) { return done(item); }
  if (item._stremio) { return loadStremioMeta(item, done); }
  item._detailsLoaded = true;
  done(item);
}
