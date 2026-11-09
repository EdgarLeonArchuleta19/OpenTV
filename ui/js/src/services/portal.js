/* services/portal.js — Servicio del portal (Luna en webOS / IPC en escritorio): catálogo, detalle, keep-alive y errores.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------ portal service
   The Magis portal answers no CORS preflight, so the page cannot call it.
   The bundled Node service speaks the encrypted protocol and returns plain
   JSON over Luna; devServiceUrl mirrors the same methods for desktop tests. */
function hasLuna() {
  if (window.PalmServiceBridge && (!window.webOS || !window.webOS.service)) {
    window.webOS = window.webOS || {};
    window.webOS.service = {
      request: function (uri, opts) {
        opts = opts || {};
        var bridge = new window.PalmServiceBridge();
        bridge.onservicecallback = function (msg) {
          var res;
          try { res = JSON.parse(msg); } catch (e) { res = { returnValue: false, errorText: msg }; }
          if (res.returnValue === false) {
            if (opts.onFailure) { opts.onFailure(res); }
          } else {
            if (opts.onSuccess) { opts.onSuccess(res); }
          }
        };
      var fullUri = opts.method ? (uri.replace(/\/$/, '') + '/' + opts.method) : uri;
      bridge.call(fullUri, JSON.stringify(opts.parameters || {}));
      return bridge;
    }
  };
}
return !!(window.webOS && window.webOS.service && window.webOS.service.request);
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

/* ls-hubd refuses a call when the app is missing from the service ACL, which
 happens when the installed manifest is stale after an update.  "Denied
 method netdiag for category /" means nothing to a viewer, so translate it
 into the two things that actually fix it and keep the raw text in brackets
 for whoever supports the TV. */
var SERVICE_BLOCKED_HINT = 'La TV tiene bloqueado el servicio de OpenTV. ' +
'Desenchufa la TV 10 segundos y vuelve a abrir la app; si sigue igual, ' +
'reinstala con el instalador.';
function describeServiceError(text) {
var raw = String(text == null ? '' : text);
if (window.XUPER_DESKTOP) { return raw; }
if (/denied|permission|not permitted/i.test(raw)) {
  return SERVICE_BLOCKED_HINT + ' (' + raw + ')';
}
return raw;
}

/* The network test can only judge the carrier by touching the real CDN, so the
 page remembers the last raw CDN URLs the portal handed out.  Loopback proxy
 URLs are useless here: they always answer, even when the carrier drops the
 upstream connection. */
var lastCdnProbe = { live: null, vod: null };
var lastVodAttempt = { phase: 'sin intento', status: 'sin datos', error: '' };
function vodFailure(phase, message) {
var safe = reportSafeText(String(message || 'El servicio no devolvió los datos necesarios'));
lastVodAttempt = { phase: phase, status: 'error', error: safe };
state.streamError = 'No se pudo cargar ' + phase + ': ' + safe;
setPlayerStatus(state.streamError);
}
document.addEventListener('xuper:playback-timeout', function () {
if (state.playerMode === 'vod' && (state.screen === 'detail' || state.screen === 'player')) {
  vodFailure(lastVodAttempt.phase, 'La carga no terminó dentro de 30 segundos');
}
});
function rememberCdnProbe(kind, payload) {
try {
  if (!payload) { return; }
  var url = payload.url || '';
  if (!/^https?:\/\//i.test(url)) { return; }
  if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(url)) { return; }
  lastCdnProbe[kind] = { url: url, headers: payload.headers || {} };
} catch (eProbe) { /* ignore */ }
}

function portalServiceCall(method, params, done, customTimeout) {
var serviceId = vodApi.serviceId || 'com.webosflux.xuptertv.fidelity.service';
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
/* webOSTV.js defines webOS.service.request even in a plain browser; without
   the native bridge it only reports an error, so the desktop harness must
   skip the Luna branch entirely. */
if (hasLuna() && window.PalmServiceBridge) {
  try {
    window.webOS.service.request('luna://' + serviceId, {
      method: method,
      parameters: params || {},
      timeout: customTimeout || parseInt(vodApi.timeoutMs, 10) || 20000,
      onSuccess: function (payload) { finish(null, payload); },
      onFailure: function (error) {
        finish((error && error.errorText) || 'Error del servicio OpenTV', null);
      }
    });
    return true;
  } catch (e) {
    if (!vodApi.devServiceUrl) {
      finish('Error comunicando con el servicio: ' + (e.message || e), null);
      return false;
    }
  }
}
/* Desktop harness: reach the same methods over plain HTTP when the Luna
   bridge is missing or rejected the request (webOSTV.js on a browser). */
if (vodApi.devServiceUrl) {
  apiRequest(String(vodApi.devServiceUrl).replace(/\/$/, '') + '/' + method + '?' + queryString(params || {}),
    function (error, payload) { finish(error, payload); }, null);
  return true;
}
finish('El servicio OpenTV no está disponible', null);
return false;
}

function startServiceKeepAlive() {
  if (!hasLuna()) { return; }
  var serviceId = vodApi.serviceId || 'com.webosflux.xuptertv.fidelity.service';
  try {
    window.webOS.service.request('luna://' + serviceId, {
      method: 'keepAlive',
      parameters: { subscribe: true },
      resubscribe: true,
      onSuccess: function () {},
      onFailure: function () {}
    });
  } catch (eSub) { /* ignore */ }

  setInterval(function () {
    try {
      window.webOS.service.request('luna://' + serviceId, {
        method: 'heartbeat',
        parameters: {},
        onSuccess: function () {},
        onFailure: function () {}
      });
    } catch (eHb) { /* ignore */ }
  }, 15000);
}

function portalSnapshot() {
  var data = window.XUPERTV_PORTAL;
  return data ? apiArray(data) : [];
}

/* Open movies are kept only to exercise the detail -> player pipeline; they
   are not portal titles, so they never go through the resolver. */
function openSamples() {
  var all = bundledCatalog();
  var out = [];
  for (var i = 0; i < all.length; i++) {
    if (all[i] && all[i].streamUrl) {
      var rec = {};
      for (var k in all[i]) {
        if (Object.prototype.hasOwnProperty.call(all[i], k)) { rec[k] = all[i][k]; }
      }
      rec.category = 'demo';
      rec.portal = false;
      out.push(rec);
    }
  }
  return out;
}

function applyPortalRefresh(roots) {
  var byId = {}, order = [], cats = {};
  function absorb(item) {
    if (!item || !item.id) { return; }
    var id = String(item.id);
    if (!byId[id]) { byId[id] = item; order.push(id); item._rows = item.row ? [item.row] : []; }
    else {
      var cur = byId[id];
      /* A title in several home sections keeps every shelf it is on (the
         TOP 15 shelves lost titles when a later section overwrote it). */
      if (item.row && cur._rows && cur._rows.indexOf(item.row) === -1) { cur._rows.push(item.row); }
      for (var k in item) {
        if (Object.prototype.hasOwnProperty.call(item, k) && k !== 'row' && k !== '_rows' &&
            item[k] !== '' && item[k] !== '—' && item[k] !== null && item[k] !== undefined) {
          cur[k] = item[k];
        }
      }
      if (!cur.row && item.row) { cur.row = item.row; }
    }
    var list = String(item.category || '').split(',');
    cats[id] = cats[id] || {};
    for (var c = 0; c < list.length; c++) { if (list[c]) { cats[id][list[c]] = true; } }
  }
  for (var r = 0; r < PORTAL_ROOTS.length; r++) {
    var list = roots[PORTAL_ROOTS[r]] || [];
    for (var i = 0; i < list.length; i++) { list[i].portal = true; absorb(list[i]); }
  }
  if (!order.length) {
    /* Refresh received no items (service offline or slow): preserve snapshot catalog! */
    return;
  }
  var records = [];
  for (var o = 0; o < order.length; o++) {
    var rec = byId[order[o]];
    rec.category = Object.keys(cats[order[o]]).join(',');
    records.push(rec);
  }
  var demo = openSamples();
  for (var d = 0; d < demo.length; d++) { records.push(demo[d]); }
  if (records.length) { replaceVod(records, 'portal', true); }
}

function refreshPortalCatalog() {
  if (portalState.refreshing) { return; }
  portalState.refreshing = true;
  portalState.error = null;
  portalState.roots = 0;
  var fresh = {};
  var index = 0;
  function next() {
    if (index >= PORTAL_ROOTS.length) {
      portalState.refreshing = false;
      if (portalState.roots > 0) {
        portalState.lastSync = Date.now();
        applyPortalRefresh(fresh);
      } else {
        portalState.error = portalState.error || 'No se pudo actualizar el catálogo del servicio';
      }
      return;
    }
    var root = PORTAL_ROOTS[index++];
    portalServiceCall('home', { root: root }, function (error, payload) {
      if (!error && payload && payload.returnValue !== false && payload.items && payload.items.length) {
        fresh[root] = payload.items;
        portalState.roots++;
      } else if (error) {
        portalState.error = error;
      }
      next();
    });
  }
  next();
}

/* Desktop: refresh the catalog from the portal every 20 minutes so new
   titles appear without restarting. It waits until the viewer is not in the
   middle of browsing the home page, because a refresh rebuilds it. */
var CATALOG_REFRESH_MS = 20 * 60 * 1000;
var lastUserActivity = Date.now();
function startCatalogAutoRefresh() {
  if (!window.XUPER_DESKTOP || vodApi.mode !== 'portal' || vodApi.refresh === false) { return; }
  ['pointermove', 'keydown', 'wheel'].forEach(function (type) {
    document.addEventListener(type, function () { lastUserActivity = Date.now(); }, { passive: true, capture: true });
  });
  setInterval(function () {
    if (portalState.refreshing || Date.now() - portalState.lastSync < CATALOG_REFRESH_MS) { return; }
    var browsingHome = state.screen === 'home' && Date.now() - lastUserActivity < 60000;
    if (!browsingHome) { refreshPortalCatalog(); }
  }, 60000);
}

function loadPortalCatalog() {
  var snap = portalSnapshot();
  if (snap.length) {
    replaceVod(snap, 'portal-snapshot', true);
  }
  if (vodApi.refresh === false) {
    if (!snap.length) { vodApiState.error = 'Sin snapshot del portal'; }
    return;
  }
  refreshPortalCatalog();
}

function useBundledCatalog(source, error) {
  var records = bundledCatalog();
  if (!replaceVod(records, source || 'bundled')) {
    vodApiState.error = error || 'No hay catálogo local ni remoto';
    return false;
  }
  if (error) { vodApiState.error = error; }
  return true;
}

function loadVodCatalog() {
  if (!vodApi.enabled) { return; }
  if (vodApi.mode === 'portal') { loadPortalCatalog(); return; }
  if (vodApi.mode === 'static') { useBundledCatalog('bundled', null); return; }
  var url = apiUrl('catalog');
  if (vodApi.mode === 'xuper' && !hasXuperSession()) {
    vodApiState.error = 'Falta la sesión OpenTV (userId, userToken y portalCode)';
    return;
  }
  if (!url) {
    if (vodApi.useBundledCatalog) { useBundledCatalog('bundled', null); }
    else { vodApiState.error = 'Falta baseUrl/catalogUrl del catálogo autorizado'; }
    return;
  }
  vodApiState.loading = true;
  apiRequest(url, function (error, payload) {
    vodApiState.loading = false;
    var responseError = apiError(payload);
    if (!error && !responseError && replaceVod(apiArray(payload), 'api')) { return; }
    var message = error || responseError || 'La API no devolvió películas';
    /* A remote endpoint that is offline must not leave the port empty. */
    if (!useBundledCatalog('bundled-fallback', message)) {
      vodApiState.error = message;
    }
  }, vodApi.mode === 'xuper' ? { method: 'POST', body: xuperPayload('catalog') } : null);
}

function mergeDetail(item, raw) {
  var groupedId = item && item._seriesGroup ? item.id : null;
  var groupedTitle = item && item._seriesGroup ? item._seriesTitle : null;
  var full = normalizeVod(raw, item.id);
  /* Catalog values remain useful when a detail response omits a field. */
  for (var key in full) {
    /* An empty list in the answer (seasons, episodes…) must not wipe what
       the title already knows: it removed every season from the dropdown
       after switching season in House M.D. */
    if (Object.prototype.hasOwnProperty.call(full, key) && full[key] !== '—' && full[key] !== '' &&
        full[key] !== 'Sin sinopsis disponible.' && !(Array.isArray(full[key]) && !full[key].length)) {
      item[key] = full[key];
    }
  }
  if (groupedId !== null) {
    item.id = groupedId;
    item.title = groupedTitle;
    item.alias = groupedTitle;
    item.seasons = item._catalogSeasons || item.seasons;
  }
}

function loadVodDetail(item, done) {
  done = done || function () {};
  if (!item) { return done(null); }
  if (item._detailsLoaded) { return done(item); }
  if (item._detailLoading) {
    item._detailWait = item._detailWait || [];
    item._detailWait.push(done);
    return;
  }
  if (vodApi.mode === 'portal' && item._portal) {
    item._detailLoading = true;
    item._detailWait = [done];
    portalServiceCall('detail', { contentId: item.id }, function (error, payload) {
      item._detailLoading = false;
      /* portal100006 ("the episode list does not exist") is the portal's
         normal answer for a movie: the catalogue record already has its
         data, so the movie is ready to play. */
      var noEpisodes = /portal100006/.test(String(error || (payload && payload.errorText) || ''));
      if (noEpisodes && !isSeriesItem(item)) {
        error = null;
        payload = { item: item, episodes: [], seasons: [] };
      }
      if (error || !payload || payload.returnValue === false || !payload.item) {
        item._detailError = error || (payload && payload.errorText) || 'El servidor no devolvió la ficha ni los capítulos';
        var failedWaiters = item._detailWait || [];
        item._detailWait = [];
        if ((state.screen === 'detail' && state.detail === item) ||
            (state.screen === 'player' && state.playerItem === item)) vodFailure('la ficha o los capítulos', item._detailError);
        for (var failed = 0; failed < failedWaiters.length; failed++) failedWaiters[failed](null);
        return;
      }
      item._detailError = '';
      if (!error && payload && payload.returnValue !== false && payload.item) {
        mergeDetail(item, payload.item);
        item.episodes = payload.episodes || [];
        item.seasons = item._catalogSeasons || payload.seasons || [];
        /* The portal keys episodes by the season container, so remember
           which container this list came from (item.id stays the series). */
        if (!item.seasonId) { item.seasonId = item.id; }

        /* Ordenar temporadas ascendentemente por numero */
        if (item.seasons && item.seasons.length) {
          item.seasons.sort(function (a, b) {
            var na = parseInt(a.number, 10) || 0;
            var nb = parseInt(b.number, 10) || 0;
            return na - nb;
          });
        }

        /* Si no hay temporadas pero el titulo o alias tiene T/S, asegurar al menos una temporada */
        if ((!item.seasons || !item.seasons.length) && isSeriesItem(item)) {
          var sNum = 1;
          var sm = /S(\d+)/i.exec(item.alias || '') || /T(\d+)/i.exec(item.title || '');
          if (sm) { sNum = parseInt(sm[1], 10) || 1; }
          item.seasons = [{ id: item.id, number: sNum }];
        }

        /* Sincronizar indice de temporada activa con item.id */
        if (item.seasons && item.seasons.length) {
          var activeIdx = 0;
          for (var s = 0; s < item.seasons.length; s++) {
            if (item.seasons[s].id === item.id) {
              activeIdx = s;
              break;
            }
          }
          state.detailSeason = activeIdx;
        }

        /* Episodio por defecto si no hay uno seleccionado */
        if (item.episodes && item.episodes.length && !state.detailEpisode) {
          state.detailEpisode = item.episodes[0];
        }
        applyPendingHistoryEpisode(item);

        item._detailsLoaded = true;
      }
      var wait = item._detailWait || [];
      item._detailWait = [];
      var hadWaiters = wait.length > 0;
      for (var i = 0; i < wait.length; i++) { wait[i](item); }
      if (state.detail === item && state.screen === 'detail') {
        buildDetail(item);
        if (!hadWaiters && (!playerVideo || !playerVideo.src || playerVideo.paused) && autoPreviewAllowed(item)) {
          startPlayerVideo(item, state.detailEpisode);
        }
      }
    });
    return;
  }
  var endpoint = apiUrl('detail');
  if (!vodApi.enabled || !endpoint) { return done(item); }
  if (vodApi.mode === 'xuper' && !hasXuperSession()) { return done(item); }
  item._detailLoading = true;
  var url = endpoint.replace('{id}', encodeURIComponent(item.id));
  apiRequest(url, function (error, payload) {
    item._detailLoading = false;
    if (!error) {
      var records = apiArray(payload);
      var raw = records.length ? records[0] : (payload && (payload.item || payload.movie || payload));
      if (raw && typeof raw === 'object') {
        mergeDetail(item, raw);
        item._detailsLoaded = true;
        if (state.detail === item && state.screen === 'detail') {
          buildDetail(item);
          if ((!playerVideo || !playerVideo.src || playerVideo.paused) && autoPreviewAllowed(item)) {
            startPlayerVideo(item, state.detailEpisode);
          }
        }
      }
    }
    done(item);
  }, vodApi.mode === 'xuper' ? { method: 'POST', body: xuperPayload('detail', item.id) } : null);
}
