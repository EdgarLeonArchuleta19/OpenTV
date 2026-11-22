/* services/js-plugins.js — Adaptador de plugins JS (kino-plugin.json + plugin.js)
   y mapeo de dominios web a repositorios de la comunidad.
   El código de cada plugin corre aislado en ui/plugin-sandbox.html
   (js/plugin-runtime.js); aquí está lo que la app hace por él (red, TMDB,
   navegador oculto, guardado) y cómo se le piden home/search/episodes/resolve.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* Known web domains mapped to their GitHub plugin repo (`owner/repo`). */
var JS_PLUGIN_HOST_MAP = {
  'framextv.cc': 'baskettv23/Framextv',
  'framextv.xyz': 'syberia1/frametv',
  'gnulahd.nu': 'JuanDEVYT/GnulaHD_plugin',
  'latinomegahd.net': 'baskettv23/Latinomegahd',
  'pelispanda.org': 'baskettv23/Pelispanda',
  'pelispro.net': 'baskettv23/Pelispro',
  'sololatino.net': 'xuper-plugin/kino-plugin-sololatino',
  'cuevana3.eu': 'xuper-plugin/kino-plugin-cuevanapro',
  'cinehdplus.org': 'xuper-plugin/kino-plugin-cinehdplus',
  'pelispedia.is': 'xuper-plugin/kino-plugin-pelispedia',
  'serieskao.top': 'xuper-plugin/kino-plugin-serieskao',
  'fuegocine.com': 'JuanDEVYT/FuegoCine_plugin',
  'animeav1.com': 'LifReizei/K-Av1',
  'jkanime.net': 'Susejing/kino-plugin-Jkanime',
  'monoschinos.st': 'syberia1/MonosChinos',
  'latanime.org': 'sonny-debug12/latanime-kino',
  'doramasyt.com': 'xuper-plugin/kino-plugin-doramasyt',
  'mundodonghua.com': 'xuper-plugin/kino-plugin-mundodonghua',
  'lacartoons.com': 'xuper-plugin/kino-plugin-lacartoons',
  'area-documental.com': 'xuper-plugin/kino-plugin-areadocumental',
  'tvenvivo.org': 'xuper-plugin/kino-plugin-tvenvivo'
};

var jsPluginInstances = {};

function resolveJsPluginRepoFromInput(input) {
  var s = String(input || '').trim();
  if (!s) { return ''; }
  /* Direct owner/repo */
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s)) { return s; }
  /* github.com/owner/repo or raw.githubusercontent.com/owner/repo */
  var gh = /^https?:\/\/(?:www\.)?(?:github\.com|raw\.githubusercontent\.com)\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i.exec(s);
  if (gh) { return gh[1].replace(/\.git$/i, ''); }
  /* Known web domain -> mapped repo */
  var hm = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})(?:\/.*)?$/i.exec(s);
  if (hm) {
    var host = hm[1].toLowerCase();
    if (JS_PLUGIN_HOST_MAP[host]) { return JS_PLUGIN_HOST_MAP[host]; }
  }
  return '';
}

function jsPluginRawBase(repoOrUrl) {
  var s = String(repoOrUrl || '').trim();
  if (/^https?:\/\/raw\.githubusercontent\.com\//i.test(s)) {
    return s.replace(/\/kino-plugin\.json(\?.*)?$/i, '').replace(/\/$/, '');
  }
  var repo = resolveJsPluginRepoFromInput(s);
  if (repo) { return 'https://raw.githubusercontent.com/' + repo + '/HEAD'; }
  return '';
}

function fetchPluginTextViaService(url, done) {
  portalServiceCall('pluginFetch', { url: url, method: 'GET', timeoutMs: 12000 }, function (err, res) {
    if (err || !res || !res.ok || !res.text) {
      return done((res && res.error) || err || 'No se pudo descargar el archivo del plugin');
    }
    done(null, res.text);
  }, 15000);
}

function inspectJsPlugin(input, done) {
  var base = jsPluginRawBase(input);
  if (!base) { return done('No es un repositorio o sitio con plugin conocido'); }
  var manifestUrl = base + '/kino-plugin.json';
  fetchPluginTextViaService(manifestUrl, function (err, text) {
    if (err || !text) { return done(err || 'No se encontró kino-plugin.json'); }
    var manifest = null;
    try { manifest = JSON.parse(text); } catch (e) { return done('kino-plugin.json no es JSON válido'); }
    if (!manifest || !manifest.id || !manifest.name) { return done('Manifiesto de plugin incompleto'); }
    var caps = manifest.capabilities || [];
    var hasHome = caps.indexOf('home') !== -1;
    var hasSearch = caps.indexOf('search') !== -1;
    var hasResolve = caps.indexOf('resolve') !== -1;
    var hasEpisodes = caps.indexOf('episodes') !== -1;
    var resources = [];
    var catalogs = [];
    var idPref = 'kino:' + manifest.id + ':';
    if (hasHome || hasSearch) {
      resources.push({ name: 'catalog', types: ['movie', 'series'], idPrefixes: [idPref] });
      catalogs.push({
        type: 'movie',
        id: 'kino_' + manifest.id + '_home',
        name: manifest.name,
        home: hasHome,
        search: hasSearch,
        genres: []
      });
    }
    if (hasEpisodes) {
      resources.push({ name: 'meta', types: ['movie', 'series'], idPrefixes: [idPref] });
    }
    if (hasResolve) {
      resources.push({ name: 'stream', types: ['movie', 'series'], idPrefixes: [idPref, 'tt'] });
    }
    var iconUrl = manifest.icon ? (/^https?:\/\//i.test(manifest.icon) ? manifest.icon : (base + '/' + manifest.icon.replace(/^\//, ''))) : '';
    var settingsList = Array.isArray(manifest.settings) ? manifest.settings.slice(0, 30) : [];
    done(null, {
      manifestV: 3,
      url: manifestUrl,
      baseUrl: base,
      entryFile: manifest.entry || 'plugin.js',
      pluginId: manifest.id,
      kind: 'jsplugin',
      name: manifest.name,
      desc: manifest.description || ('Plugin JS (' + manifest.name + ')'),
      logo: iconUrl,
      configurable: settingsList.length > 0,
      settingsSchema: settingsList,
      types: ['movie', 'series'],
      idPrefixes: [idPref, 'tt'],
      resources: resources,
      catalogs: catalogs
    });
  });
}

function jsPluginConfigKey(pluginId) {
  return 'opentv_jsp_cfg_' + (pluginId || 'p');
}

function loadJsPluginConfig(ad) {
  var out = {};
  var schema = (ad && ad.settingsSchema) || [];
  for (var i = 0; i < schema.length; i++) {
    var s = schema[i];
    if (s && s.key && s.default !== undefined) { out[s.key] = s.default; }
  }
  try {
    var saved = JSON.parse(localStorage.getItem(jsPluginConfigKey(ad && ad.pluginId)) || 'null');
    if (saved && typeof saved === 'object') {
      for (var k in saved) {
        if (Object.prototype.hasOwnProperty.call(saved, k)) { out[k] = saved[k]; }
      }
    }
  } catch (e) {}
  return out;
}

function saveJsPluginConfig(ad, values) {
  try {
    localStorage.setItem(jsPluginConfigKey(ad && ad.pluginId), JSON.stringify(values || {}));
  } catch (e) {}
  if (ad && ad.baseUrl) {
    var k = ad.baseUrl + '/' + (ad.entryFile || 'plugin.js');
    delete jsPluginHomeCache[k];
    unloadJsPluginInstance(k);
  }
}

/* --------------------------------------------------- the plugins' cookies */
/* One jar for every JS plugin (they share sites such as embed servers),
   kept by the app: added to each request and filled from the answers. */
var JS_COOKIES_KEY = 'opentv_jsp_cookies_v1';
function loadCookieJar() {
  try { return JSON.parse(localStorage.getItem(JS_COOKIES_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function saveCookieJar(jar) {
  var keys = Object.keys(jar);
  if (keys.length > 50) {
    for (var i = 0; i < keys.length - 50; i++) { delete jar[keys[i]]; }
  }
  try { localStorage.setItem(JS_COOKIES_KEY, JSON.stringify(jar)); } catch (e) {}
}
function cookieHostFrom(urlOrDomain) {
  var s = String(urlOrDomain || '').trim().toLowerCase();
  var m = /^https?:\/\/([^\/:?#]+)/i.exec(s);
  if (m) { s = m[1]; }
  return s.replace(/^\.+/, '').replace(/:\d+$/, '');
}
function storeSetCookies(targetUrl, setCookiesArr, rawHeader) {
  var list = Array.isArray(setCookiesArr) ? setCookiesArr : (rawHeader ? String(rawHeader).split('\n') : []);
  if (!list.length) { return; }
  var reqHost = cookieHostFrom(targetUrl);
  if (!reqHost) { return; }
  var jar = loadCookieJar();
  for (var i = 0; i < list.length; i++) {
    var line = String(list[i] || '').trim();
    if (!line) { continue; }
    var parts = line.split(';');
    var nv = parts[0].trim();
    var eq = nv.indexOf('=');
    if (eq <= 0) { continue; }
    var cName = nv.slice(0, eq).trim();
    var cVal = nv.slice(eq + 1).trim();
    var cHost = reqHost;
    var expired = false;
    for (var p = 1; p < parts.length; p++) {
      var attr = parts[p].trim();
      var dm = /^domain=(.+)$/i.exec(attr);
      if (dm) { cHost = cookieHostFrom(dm[1]); }
      var mm = /^max-age=(-?\d+)$/i.exec(attr);
      if (mm && parseInt(mm[1], 10) <= 0) { expired = true; }
    }
    if (!cHost) { continue; }
    if (!jar[cHost] || typeof jar[cHost] !== 'object') { jar[cHost] = {}; }
    if (expired) { delete jar[cHost][cName]; }
    else { jar[cHost][cName] = cVal; }
  }
  saveCookieJar(jar);
}
function storeCookieString(targetUrl, cookieStr) {
  var s = String(cookieStr || '').trim();
  if (!s) { return; }
  var host = cookieHostFrom(targetUrl);
  if (!host) { return; }
  var jar = loadCookieJar();
  if (!jar[host] || typeof jar[host] !== 'object') { jar[host] = {}; }
  var parts = s.split(';');
  for (var i = 0; i < parts.length; i++) {
    var nv = parts[i].trim();
    var eq = nv.indexOf('=');
    if (eq > 0) { jar[host][nv.slice(0, eq).trim()] = nv.slice(eq + 1).trim(); }
  }
  saveCookieJar(jar);
}
function getCookiesForHost(urlOrDomain) {
  var host = cookieHostFrom(urlOrDomain);
  if (!host) { return ''; }
  var jar = loadCookieJar();
  var merged = {};
  for (var dom in jar) {
    if (!Object.prototype.hasOwnProperty.call(jar, dom)) { continue; }
    if (host === dom || (host.length > dom.length && host.slice(-(dom.length + 1)) === '.' + dom)) {
      var map = jar[dom] || {};
      for (var k in map) {
        if (Object.prototype.hasOwnProperty.call(map, k)) { merged[k] = map[k]; }
      }
    }
  }
  var pairs = [];
  for (var ck in merged) {
    if (Object.prototype.hasOwnProperty.call(merged, ck)) { pairs.push(ck + '=' + merged[ck]); }
  }
  return pairs.join('; ');
}
function clearCookiesForHost(urlOrDomain) {
  if (!urlOrDomain) { saveCookieJar({}); return; }
  var host = cookieHostFrom(urlOrDomain);
  var jar = loadCookieJar();
  for (var dom in jar) {
    if (Object.prototype.hasOwnProperty.call(jar, dom) && (dom === host || host.slice(-(dom.length + 1)) === '.' + dom)) {
      delete jar[dom];
    }
  }
  saveCookieJar(jar);
}

/* ------------------------------------------------------- the sandbox */
/* The plugins' code runs in ui/plugin-sandbox.html (js/plugin-runtime.js):
   a hidden iframe with sandbox="allow-scripts" and no allow-same-origin,
   so it cannot touch the app (its storage, cookies, window.desktop, the
   service). One frame for every plugin (memory on a 1 GB TV). It asks the
   app for what only the app may do; the app answers after its own checks:
   requests through pluginFetch (no OpenTV loopback, the home network only
   when that plugin is allowed), TMDB reads, the hidden browser, and the
   plugin's own saved values under its own prefix. */
var jsSandbox = null;   /* { frame, ready, failed, queue: [fn], calls: { id: cb }, seq } */
var JS_PLUGIN_CALL_MS = 90000;

function jsPluginByKey(key) {
  var addons = getVodSourcesConfig().addons || [];
  for (var i = 0; i < addons.length; i++) {
    var ad = addons[i];
    if (ad && ad.kind === 'jsplugin' && ad.baseUrl + '/' + (ad.entryFile || 'plugin.js') === key) { return ad; }
  }
  return null;
}

function jsSandboxSend(msg) {
  msg.opentvPlugin = 1;
  try { jsSandbox.frame.contentWindow.postMessage(msg, '*'); } catch (e) { /* frame gone */ }
}

function jsSandboxReady(fn) {
  if (!jsSandbox) {
    var frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;left:-9999px;top:0';
    jsSandbox = { frame: frame, ready: false, failed: '', queue: [], calls: {}, seq: 0 };
    window.addEventListener('message', onJsSandboxMessage);
    frame.src = 'plugin-sandbox.html';
    document.body.appendChild(frame);
    setTimeout(function () {
      if (jsSandbox && !jsSandbox.ready && !jsSandbox.failed) { jsSandboxFail('El espacio de los plugins JS no respondió'); }
    }, 15000);
  }
  if (jsSandbox.failed) { fn(jsSandbox.failed); return; }
  if (jsSandbox.ready) { fn(null); return; }
  jsSandbox.queue.push(fn);
}

function jsSandboxFail(reason) {
  jsSandbox.failed = reason;
  var q = jsSandbox.queue;
  jsSandbox.queue = [];
  for (var i = 0; i < q.length; i++) { q[i](reason); }
}

/* A request to the sandbox and its answer: done(err, value). */
function jsSandboxCall(msg, done) {
  jsSandboxReady(function (err) {
    if (err) { return done(err); }
    var id = ++jsSandbox.seq;
    var timer = setTimeout(function () {
      if (jsSandbox.calls[id]) { delete jsSandbox.calls[id]; done('El plugin tardó demasiado en responder'); }
    }, JS_PLUGIN_CALL_MS);
    jsSandbox.calls[id] = function (e, v) { clearTimeout(timer); done(e, v); };
    msg.id = id;
    jsSandboxSend(msg);
  });
}

function onJsSandboxMessage(ev) {
  if (!jsSandbox || ev.source !== jsSandbox.frame.contentWindow) { return; }
  var m = ev.data;
  if (!m || m.opentvPlugin !== 1) { return; }
  if (m.kind === 'ready') {
    if (m.exposed) {
      if (window.console) { console.warn('[OpenTV] plugins JS: el puente de la app es visible dentro del espacio aislado; no se ejecutan'); }
      jsSandboxFail('Este aparato no puede aislar los plugins JS');
      return;
    }
    if (window.console) { console.info('[OpenTV] plugins JS: espacio aislado listo'); }
    jsSandbox.ready = true;
    var q = jsSandbox.queue;
    jsSandbox.queue = [];
    for (var i = 0; i < q.length; i++) { q[i](null); }
  } else if (m.kind === 'reply') {
    var cb = jsSandbox.calls[m.id];
    if (!cb) { return; }
    delete jsSandbox.calls[m.id];
    cb(m.error || null, m.value);
  } else if (m.kind === 'ask') {
    answerJsPluginAsk(m);
  }
}

/* What a plugin asked the app for. Only plugins that are installed may ask,
   and each one only for itself. */
function answerJsPluginAsk(m) {
  function answer(err, value, code) {
    jsSandboxSend({ kind: 'answer', id: m.id, error: err ? String(err) : '', code: code || '', value: value, jar: loadCookieJar() });
  }
  var ad = jsPluginByKey(m.key);
  if (!ad) { return answer('Plugin no instalado'); }
  var a = m.args || {};
  if (m.op === 'fetch') { return jsPluginFetch(ad, a.url, a.opts || {}, answer); }
  if (m.op === 'tmdb') { return jsPluginTmdb(a.route, a.params, answer); }
  if (m.op === 'browser') { return jsPluginBrowser(ad, a, answer); }
  if (m.op === 'storageSet' || m.op === 'storageRemove') {
    var k = String(a.k || '').slice(0, 200);
    try {
      if (m.op === 'storageSet') { localStorage.setItem(jsPluginStorePrefix(ad) + k, String(a.v).slice(0, 200000)); }
      else { localStorage.removeItem(jsPluginStorePrefix(ad) + k); }
    } catch (e) { /* full */ }
    return answer(null, true);
  }
  if (m.op === 'cookiesClear') { clearCookiesForHost(a.domain || ''); return answer(null, true); }
  answer('Operación no permitida');
}

function jsPluginStorePrefix(ad) {
  return 'opentv_jsp_' + String(ad.pluginId || 'p').replace(/[^A-Za-z0-9_.-]/g, '_') + '_';
}

function jsPluginStorageSnapshot(ad) {
  var out = {}, prefix = jsPluginStorePrefix(ad);
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(prefix) === 0) { out[k.slice(prefix.length)] = localStorage.getItem(k); }
    }
  } catch (e) {}
  return out;
}

/* May this plugin reach the home network (a NAS, a media server)? The
   viewer allows it per plugin in Configurar. OpenTV's own 127.0.0.1 is
   never reachable. */
var JS_PLUGIN_LAN_KEY = 'opentv_jsp_lan_v1';
function jsPluginAllowsLan(ad) {
  try { return !!(JSON.parse(localStorage.getItem(JS_PLUGIN_LAN_KEY) || '{}') || {})[ad.pluginId]; } catch (e) { return false; }
}
function setJsPluginAllowsLan(ad, on) {
  var all = {};
  try { all = JSON.parse(localStorage.getItem(JS_PLUGIN_LAN_KEY) || '{}') || {}; } catch (e) { all = {}; }
  if (on) { all[ad.pluginId] = true; } else { delete all[ad.pluginId]; }
  try { localStorage.setItem(JS_PLUGIN_LAN_KEY, JSON.stringify(all)); } catch (e2) {}
}

function jsPluginFetch(ad, url, opts, answer) {
  var headers = {};
  var hasCookieHeader = false;
  if (opts.headers && typeof opts.headers === 'object') {
    for (var hk in opts.headers) {
      if (Object.prototype.hasOwnProperty.call(opts.headers, hk) && !/[\r\n]/.test(hk + opts.headers[hk])) {
        headers[hk] = String(opts.headers[hk]);
        if (/^cookie$/i.test(hk)) { hasCookieHeader = true; }
      }
    }
  }
  if (!hasCookieHeader) {
    var jarCookie = getCookiesForHost(url);
    if (jarCookie) { headers['Cookie'] = jarCookie; }
  }
  var bodyStr = typeof opts.body === 'string' ? opts.body : null;
  var bodyBase64 = opts.bodyBase64 != null ? String(opts.bodyBase64) : null;
  if (bodyStr === null && bodyBase64 === null) {
    if (opts.bodyJson !== undefined) {
      bodyStr = JSON.stringify(opts.bodyJson);
      if (!headers['Content-Type'] && !headers['content-type']) { headers['Content-Type'] = 'application/json'; }
    } else if (opts.bodyForm && typeof opts.bodyForm === 'object') {
      var fParts = [];
      for (var fk in opts.bodyForm) {
        if (Object.prototype.hasOwnProperty.call(opts.bodyForm, fk)) {
          fParts.push(encodeURIComponent(fk) + '=' + encodeURIComponent(String(opts.bodyForm[fk])));
        }
      }
      bodyStr = fParts.join('&');
      if (!headers['Content-Type'] && !headers['content-type']) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    }
  }
  var timeoutMs = Math.min(25000, Math.max(1500, Number(opts.timeoutMs) || 12000));
  portalServiceCall('pluginFetch', {
    url: String(url || ''),
    method: String(opts.method || 'GET'),
    headers: headers,
    body: bodyStr,
    bodyBase64: bodyBase64,
    redirect: opts.redirect === 'manual' ? 'manual' : 'follow',
    timeoutMs: timeoutMs,
    allowLan: jsPluginAllowsLan(ad)
  }, function (err, r) {
    if (err || !r) { return answer(err || 'Error de red', null, 'network'); }
    var finalUrl = r.url || String(url || '');
    if ((r.setCookies && r.setCookies.length) || (r.headers && r.headers['set-cookie'])) {
      storeSetCookies(finalUrl, r.setCookies, r.headers && r.headers['set-cookie']);
    }
    answer(null, {
      ok: !!r.ok, status: r.status || 0, url: finalUrl, headers: r.headers || {},
      text: typeof r.text === 'string' ? r.text : '', base64: typeof r.base64 === 'string' ? r.base64 : ''
    });
  }, timeoutMs + 3000);
}

/* TMDB reads only (GET routes of the API, with the app's key). */
function jsPluginTmdb(route, params, answer) {
  var r = String(route || '');
  if (r.charAt(0) !== '/') { r = '/' + r; }
  if (!/^\/[A-Za-z0-9_\/.-]*(\?[^#]*)?$/.test(r) || r.indexOf('..') !== -1) { return answer('Ruta de TMDB no válida', null, 'bad_route'); }
  var qs = [];
  if (params && typeof params === 'object') {
    for (var pk in params) {
      if (Object.prototype.hasOwnProperty.call(params, pk) && params[pk] !== undefined && params[pk] !== null && !/^api_key$/i.test(pk)) {
        qs.push(encodeURIComponent(pk) + '=' + encodeURIComponent(String(params[pk])));
      }
    }
  }
  var full = r + (qs.length ? ((r.indexOf('?') === -1 ? '?' : '&') + qs.join('&')) : '');
  portalServiceCall('tmdb', { list: 'raw:' + full }, function (err, ans) {
    if (err || !ans || ans.returnValue === false || !ans.item) {
      return answer(err || (ans && ans.errorText) || 'Sin respuesta de TMDB', null, 'no_tmdb_key');
    }
    answer(null, ans.item);
  }, 12000);
}

/* The hidden browser (Electron window / Android WebView) for a plugin. */
function jsPluginBrowser(ad, a, answer) {
  var payload = {
    url: String(a.url || '').trim(),
    matchSource: String(a.matchSource || ''),
    matchFlags: String(a.matchFlags || 'i'),
    timeoutMs: Number(a.timeoutMs) || 15000,
    waitMs: Number(a.waitMs) || 350,
    headers: (a.headers && typeof a.headers === 'object') ? a.headers : {},
    script: String(a.script || ''),
    returnHtml: !!a.returnHtml,
    allowLan: jsPluginAllowsLan(ad)
  };
  var capPromise = null;
  if (window.desktop && typeof window.desktop.browserCapture === 'function') {
    capPromise = window.desktop.browserCapture(payload);
  } else if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BrowserCapture &&
      typeof window.Capacitor.Plugins.BrowserCapture.capture === 'function') {
    capPromise = window.Capacitor.Plugins.BrowserCapture.capture(payload);
  }
  if (!capPromise) { return answer('El navegador oculto no está disponible en este aparato', null, 'browser_unavailable'); }
  Promise.resolve(capPromise).then(function (res) {
    if (!res || !res.ok) { return answer((res && res.error) || 'No se pudo capturar el vídeo', null, 'browser_capture_failed'); }
    if (res.cookies) { storeCookieString(res.url || payload.url, res.cookies); }
    var capUrl = res.url || '';
    var capHeaders = res.headers || {};
    var mediaList = (!payload.returnHtml && capUrl) ? [{
      url: capUrl,
      headers: capHeaders,
      mime: /\.mp4(\?|$)/i.test(capUrl) ? 'video/mp4' : 'application/x-mpegURL'
    }] : [];
    answer(null, {
      url: capUrl || payload.url,
      headers: capHeaders,
      cookies: res.cookies || '',
      html: res.html || '',
      media: mediaList
    });
  }, function (e) {
    answer((e && e.message) || 'No se pudo capturar el vídeo', null, 'browser_capture_failed');
  });
}

/* A loaded plugin, as seen by the app: its home / search / episodes /
   resolve, each returning a Promise (they run in the sandbox). */
function jsPluginProxy(key, names) {
  var inst = {};
  names.forEach(function (name) {
    inst[name] = function () {
      var args = Array.prototype.slice.call(arguments);
      return new Promise(function (resolve, reject) {
        jsSandboxCall({ kind: 'call', key: key, fn: name, args: args }, function (err, value) {
          if (err) { reject(new Error(String(err))); } else { resolve(value); }
        });
      });
    };
  });
  return inst;
}

function unloadJsPluginInstance(key) {
  if (!jsPluginInstances[key]) { return; }
  delete jsPluginInstances[key];
  if (jsSandbox && jsSandbox.ready) { jsSandboxSend({ kind: 'unload', key: key }); }
}

function loadJsPluginInstance(ad, done) {
  var key = ad.baseUrl + '/' + (ad.entryFile || 'plugin.js');
  if (jsPluginInstances[key]) { return done(null, jsPluginInstances[key]); }
  fetchPluginTextViaService(key, function (err, code) {
    if (err || !code) { return done(err || 'No se pudo cargar plugin.js'); }
    loadJsPluginCode(ad, code, done);
  });
}

/* Runs a plugin's code in the sandbox (also window.__opentv, for tests). */
function loadJsPluginCode(ad, code, done) {
  var key = ad.baseUrl + '/' + (ad.entryFile || 'plugin.js');
  jsSandboxCall({
    kind: 'load', key: key, code: String(code), jar: loadCookieJar(),
    setup: { config: loadJsPluginConfig(ad), storage: jsPluginStorageSnapshot(ad), appVersion: '1.2.1' }
  }, function (lErr, info) {
    if (lErr) { return done(lErr); }
    /* TVs keep three loaded at most (memory). */
    if (typeof platformIsTv === 'function' && platformIsTv()) {
      var instKeys = Object.keys(jsPluginInstances);
      if (instKeys.length >= 3) { unloadJsPluginInstance(instKeys[0]); }
    }
    jsPluginInstances[key] = jsPluginProxy(key, (info && info.names) || []);
    done(null, jsPluginInstances[key]);
  });
}

function jsPluginItemToVodRecord(ad, it, rowName) {
  if (!it || (!it.ref && !it.id)) { return null; }
  var ref = String(it.ref || it.id);
  var isSeries = it.kind === 'series' || it.kind === 'tv' || it.type === 'series';
  var fullId = 'kino:' + ad.pluginId + ':' + ref;
  var poster = it.poster || it.image || '';
  var bg = it.backdrop || it.background || poster;
  return {
    _animeCat: it.kind === 'anime',
    id: 'stremio:' + fullId,
    title: String(it.title || it.name || 'Sin título'),
    category: it.kind === 'anime' ? 'anime' : ('destacado,' + (isSeries ? 'serie' : 'pelicula')),
    row: rowName || ad.name,
    _rows: [rowName || ad.name],
    score: String(it.rating || it.score || '—'),
    year: String(it.year || '—').slice(0, 4),
    duration: '—',
    genres: Array.isArray(it.genres) ? it.genres : [],
    director: '—',
    actors: '—',
    synopsis: it.synopsis || it.description || '',
    kind: isSeries ? 'serie' : 'película',
    type: isSeries ? 'teleplay' : 'movie',
    poster: poster,
    landscape: bg,
    backdrop: bg,
    logo: '',
    portal: false,
    _portal: false,
    _stremio: true,
    _stremioId: fullId,
    _stremioBase: ad.baseUrl,
    _stremioType: isSeries ? 'series' : 'movie'
  };
}

var JS_HOME_CACHE_MS = 20 * 60 * 1000;
var jsPluginHomeCache = {};

function fetchJsPluginCatalogs(ad, taken, done) {
  var cacheKey = ad.baseUrl + '/' + (ad.entryFile || 'plugin.js');
  var hit = jsPluginHomeCache[cacheKey];
  if (hit && Date.now() - hit.at < JS_HOME_CACHE_MS) {
    for (var hi = 0; hi < hit.rows.length; hi++) {
      var rName = hit.rows[hi];
      if (!taken[rName]) {
        taken[rName] = true;
        if (!(rName in stremioRowOrder)) { stremioRowOrder[rName] = stremioRowSeq++; }
      }
    }
    return done(hit.items.slice());
  }
  loadJsPluginInstance(ad, function (err, inst) {
    if (err || !inst || typeof inst.home !== 'function') { return done([]); }
    try {
      Promise.resolve(inst.home()).then(function (res) {
        /* { sections: [...] }, a list of rows ([{ title, items }]), or a
           plain list of titles (one row named after the plugin). */
        var rowsList = Array.isArray(res) && res.length && res[0] && Array.isArray(res[0].items);
        var sections = (res && Array.isArray(res.sections)) ? res.sections
          : (rowsList ? res : (Array.isArray(res) ? [{ title: ad.name, items: res }] : []));
        var out = [], rowNames = [];
        var maxSec = (typeof isLowSpecDevice === 'function' && isLowSpecDevice()) ? 3 : 6;
        var maxItems = (typeof isLowSpecDevice === 'function' && isLowSpecDevice()) ? 24 : 40;
        for (var s = 0; s < sections.length && s < maxSec; s++) {
          var sec = sections[s] || {};
          var rowName = (sec.title ? (sec.title + ' · ' + ad.name) : ad.name);
          rowNames.push(rowName);
          if (!taken[rowName]) {
            taken[rowName] = true;
            if (!(rowName in stremioRowOrder)) { stremioRowOrder[rowName] = stremioRowSeq++; }
          }
          var items = Array.isArray(sec.items) ? sec.items : [];
          for (var i = 0; i < items.length && i < maxItems; i++) {
            var rec = jsPluginItemToVodRecord(ad, items[i], rowName);
            if (rec) { out.push(rec); }
          }
        }
        if (out.length) { jsPluginHomeCache[cacheKey] = { at: Date.now(), items: out.slice(), rows: rowNames }; }
        done(out);
      }, function () { done([]); });
    } catch (e) {
      done([]);
    }
  });
}

function searchJsPlugin(ad, query, done) {
  loadJsPluginInstance(ad, function (err, inst) {
    if (err || !inst || typeof inst.search !== 'function') { return done([]); }
    try {
      Promise.resolve(inst.search({ q: query, query: query })).then(function (res) {
        var items = Array.isArray(res) ? res : ((res && Array.isArray(res.items)) ? res.items : []);
        var out = [];
        for (var i = 0; i < items.length && i < 40; i++) {
          var rec = jsPluginItemToVodRecord(ad, items[i], '');
          if (rec) { rec._searchOrder = i; out.push(rec); }
        }
        done(out);
      }, function () { done([]); });
    } catch (e) {
      done([]);
    }
  });
}

function flattenKinoEpisodes(epRes) {
  if (!epRes) { return []; }
  if (Array.isArray(epRes)) { return epRes; }
  if (Array.isArray(epRes.seasons)) {
    var out = [];
    for (var s = 0; s < epRes.seasons.length; s++) {
      var sea = epRes.seasons[s] || {};
      var sNum = parseInt(sea.number || sea.season || (s + 1), 10) || (s + 1);
      var list = Array.isArray(sea.episodes) ? sea.episodes : [];
      for (var j = 0; j < list.length; j++) {
        var ep = list[j] || {};
        out.push({
          season: parseInt(ep.season || sNum, 10) || sNum,
          number: parseInt(ep.number || ep.episode || (j + 1), 10) || (j + 1),
          ref: ep.ref || ep.id || '',
          title: ep.title || ep.name || '',
          synopsis: ep.synopsis || ep.description || '',
          thumb: ep.thumb || ep.image || ''
        });
      }
    }
    return out;
  }
  return Array.isArray(epRes.episodes) ? epRes.episodes : [];
}

function loadJsPluginEpisodes(ad, item, done) {
  loadJsPluginInstance(ad, function (err, inst) {
    if (err || !inst || typeof inst.episodes !== 'function') { return done('Sin episodios'); }
    var rawId = String(item._stremioId || item.id || '').replace(/^stremio:/, '');
    var prefix = 'kino:' + ad.pluginId + ':';
    if (rawId.indexOf(prefix) !== 0) { return done('ID no pertenece a este plugin'); }
    var ref = rawId.slice(prefix.length);
    try {
      Promise.resolve(inst.episodes(ref)).then(function (epRes) {
        var eps = flattenKinoEpisodes(epRes);
        var videos = [];
        for (var i = 0; i < eps.length; i++) {
          var e = eps[i] || {};
          var sNum = parseInt(e.season || 1, 10) || 1;
          var eNum = parseInt(e.number || e.episode || (i + 1), 10) || (i + 1);
          var eRef = String(e.ref || e.id || '');
          if (!eRef) { continue; }
          videos.push({
            id: prefix + eRef,
            season: sNum,
            episode: eNum,
            name: e.title || e.name || ('Capítulo ' + eNum),
            overview: e.synopsis || e.description || '',
            thumbnail: e.thumb || e.image || ''
          });
        }
        done(null, { videos: videos });
      }, function () { done('Error al cargar episodios'); });
    } catch (e) {
      done('Error al cargar episodios');
    }
  });
}

function resolveJsPluginStreams(ad, item, episode, done) {
  loadJsPluginInstance(ad, function (err, inst) {
    if (err || !inst || typeof inst.resolve !== 'function') { return done('El plugin no soporta resolve'); }
    var rawId = isSeriesItem(item) ? (episode && episode.id) : (item._stremioId || '');
    var prefix = 'kino:' + ad.pluginId + ':';
    function finishResolve(ans) {
      if (!ans) { return done(null, []); }
      var list = Array.isArray(ans) ? ans : [ans];
      var streams = [];
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (!r || !r.url) { continue; }
        streams.push({
          name: ad.name,
          title: r.label || r.title || (ad.name + ' · Directo'),
          url: r.url,
          subtitles: Array.isArray(r.subtitles) ? r.subtitles : undefined,
          behaviorHints: r.headers ? { proxyHeaders: { request: r.headers } } : {}
        });
        var alts = Array.isArray(r.alternatives) ? r.alternatives : [];
        for (var a = 0; a < alts.length; a++) {
          var alt = alts[a];
          if (!alt) { continue; }
          if (alt.url) {
            streams.push({
              name: ad.name,
              title: alt.label || alt.title || (ad.name + ' · Opción ' + (a + 2)),
              url: alt.url,
              subtitles: Array.isArray(alt.subtitles || r.subtitles) ? (alt.subtitles || r.subtitles) : undefined,
              behaviorHints: (alt.headers || r.headers) ? { proxyHeaders: { request: alt.headers || r.headers } } : {}
            });
          } else if (alt.ref) {
            streams.push({
              name: ad.name,
              title: alt.label || alt.title || (ad.name + ' · Opción ' + (a + 2)),
              url: '',
              jsLazyRef: String(alt.ref),
              jsAddonUrl: ad.url || '',
              subtitles: Array.isArray(alt.subtitles || r.subtitles) ? (alt.subtitles || r.subtitles) : undefined,
              behaviorHints: (alt.headers || r.headers) ? { proxyHeaders: { request: alt.headers || r.headers } } : {}
            });
          }
        }
      }
      done(null, streams);
    }
    if (String(rawId).indexOf(prefix) === 0) {
      var directRef = String(rawId).slice(prefix.length);
      try {
        Promise.resolve(inst.resolve(directRef)).then(finishResolve, function (e) { done((e && e.message) || 'Error al resolver'); });
      } catch (e) { done(e.message || 'Error'); }
      return;
    }
    /* Title came from Cinemeta/Kitsu (e.g. tt1234567): search the JS plugin by title first. */
    if (typeof inst.search !== 'function') { return done(null, []); }
    var qTitle = item.title || '';
    var imdbClean = String(item._stremioId || '').split(':')[0];
    var isSer = isSeriesItem(item);
    var yNum = parseInt(String(item.year || '').slice(0, 4), 10) || undefined;
    var kindStr = isSer ? 'series' : 'movie';
    try {
      Promise.resolve(inst.search({ q: qTitle, query: qTitle, type: kindStr, kind: kindStr, year: yNum, imdbId: imdbClean })).then(function (sRes) {
        var hits = Array.isArray(sRes) ? sRes : ((sRes && Array.isArray(sRes.items)) ? sRes.items : []);
        if (!hits.length) { return done(null, []); }
        var chosenRef = String(hits[0].ref || hits[0].id || '');
        if (!chosenRef) { return done(null, []); }
        if (isSer && episode && typeof inst.episodes === 'function') {
          var hint = torrentEpisodeHint(episode);
          var wantS = hint.season || 1;
          var wantE = hint.episode || episode.number || 1;
          Promise.resolve(inst.episodes(chosenRef)).then(function (epRes) {
            var eps = flattenKinoEpisodes(epRes);
            var epRef = '';
            for (var k = 0; k < eps.length; k++) {
              var epObj = eps[k] || {};
              var sN = parseInt(epObj.season || 1, 10);
              var eN = parseInt(epObj.number || epObj.episode || (k + 1), 10);
              if (sN === wantS && eN === wantE) { epRef = String(epObj.ref || epObj.id || ''); break; }
            }
            if (!epRef && eps[0]) { epRef = String(eps[0].ref || eps[0].id || ''); }
            if (!epRef) { return done(null, []); }
            return Promise.resolve(inst.resolve(epRef)).then(finishResolve, function () { done(null, []); });
          }, function () { done(null, []); });
          return;
        }
        Promise.resolve(inst.resolve(chosenRef)).then(finishResolve, function () { done(null, []); });
      }, function () { done(null, []); });
    } catch (e2) {
      done(null, []);
    }
  });
}

/* Resolves a lazy alternative ({ label, ref }) on demand when the viewer picks
   that server in the source picker. */
function resolveJsPluginLazyRef(addonUrl, ref, done) {
  var addons = getVodSourcesConfig().addons || [];
  var targetBase = stremioBaseFromUrl(addonUrl);
  var found = null;
  for (var i = 0; i < addons.length; i++) {
    if (addons[i] && addons[i].kind === 'jsplugin' && stremioBaseFromUrl(addons[i].url) === targetBase) {
      found = addons[i];
      break;
    }
  }
  if (!found) { return done('No se encontró el plugin para este servidor'); }
  loadJsPluginInstance(found, function (err, inst) {
    if (err || !inst || typeof inst.resolve !== 'function') { return done(err || 'El plugin no soporta resolver este servidor'); }
    try {
      Promise.resolve(inst.resolve(String(ref || ''))).then(function (ans) {
        var r = Array.isArray(ans) ? ans[0] : ans;
        if (!r || !r.url) { return done('Este servidor no devolvió un enlace reproducible'); }
        done(null, {
          url: r.url,
          headers: r.headers || null,
          subtitles: Array.isArray(r.subtitles) ? r.subtitles : null
        });
      }, function (e) {
        done((e && e.message) || 'No se pudo resolver este servidor');
      });
    } catch (e2) {
      done((e2 && e2.message) || 'No se pudo resolver este servidor');
    }
  });
}
