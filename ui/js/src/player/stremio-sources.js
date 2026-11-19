/* player/stremio-sources.js — Modo manual (Stremio, solo PC): elegir la fuente
   de una película o capítulo (enlace directo o torrent) y reproducirla.
   Parte del módulo único de la app (ver ui/js/src/README.md).

   Flujo: Reproducir → (fuente guardada de ese título, o panel "Elegir
   fuente") → servicio resolveExternal (y torrentStart para torrents) → el
   mismo reproductor y modo compatible para todo lo que dan los addons. */

var STREMIO_PICKS_KEY = 'opentv_stremio_picks_v1';
var TORRENT_NOTICE_KEY = 'opentv_torrent_notice_v1';
var STREMIO_PICKS_MAX = 300;

/* ------------------------------------------------ remembered sources */
function stremioTargetId(item, episode) {
  if (isSeriesItem(item)) { return episode && episode.id ? String(episode.id) : ''; }
  return item._stremioId || String(item.id).replace(/^stremio:/, '');
}

function loadStremioPicks() {
  try { return JSON.parse(localStorage.getItem(STREMIO_PICKS_KEY) || '{}') || {}; }
  catch (e) { return {}; }
}

function savedStremioPick(item, episode) {
  var id = stremioTargetId(item, episode);
  return id ? (loadStremioPicks()[id] || null) : null;
}

function rememberStremioPick(item, episode, src) {
  var id = stremioTargetId(item, episode);
  if (!id || !src) { return; }
  var picks = loadStremioPicks();
  picks[id] = {
    addon: src.addon, url: src.url || '', infoHash: src.infoHash || '', fileIdx: src.fileIdx,
    sources: src.sources || null, headers: src.headers || null, notWebReady: !!src.notWebReady,
    filename: src.filename || '', label: src.label || '', quality: src.quality || '',
    langs: src.langs || [], original: !!src.original, at: Date.now()
  };
  var keys = Object.keys(picks);
  if (keys.length > STREMIO_PICKS_MAX) {
    keys.sort(function (a, b) { return (picks[a].at || 0) - (picks[b].at || 0); });
    for (var i = 0; i < keys.length - STREMIO_PICKS_MAX; i++) { delete picks[keys[i]]; }
  }
  try { localStorage.setItem(STREMIO_PICKS_KEY, JSON.stringify(picks)); } catch (e) { /* full */ }
}

function forgetStremioPick(item, episode) {
  var id = stremioTargetId(item, episode);
  var picks = loadStremioPicks();
  if (id && picks[id]) {
    delete picks[id];
    try { localStorage.setItem(STREMIO_PICKS_KEY, JSON.stringify(picks)); } catch (e) { /* ignore */ }
  }
  var target = episode || item;
  if (target) { target._stremioSource = null; }
}

/* ------------------------------------------------ the addons' sources */
function stremioStreamId(item, episode) {
  var id = isSeriesItem(item) ? (episode && episode.id) : (item._stremioId || String(item.id).replace(/^stremio:/, ''));
  return encodeURIComponent(String(id || '')).replace(/%3A/gi, ':');
}

/* "Torrentio\n1080p" + "Movie.2010.1080p.mkv\n👤 23 💾 2.1 GB ⚙️ Site" → parts. */
function describeStremioStream(s, addonName) {
  var name = String(s.name || addonName || '').replace(/\s+/g, ' ').trim();
  var title = String(s.title || s.description || '');
  var text = name + ' ' + title;
  var quality = /\b(2160p|4k|uhd)\b/i.test(text) ? '4K' : (/\b1080p\b/i.test(text) ? '1080p' :
    (/\b720p\b/i.test(text) ? '720p' : (/\b(480p|sd)\b/i.test(text) ? 'SD' : '')));
  var size = /💾\s*([\d.,]+\s*[KMGT]i?B)/i.exec(title) || /\b([\d.,]+\s?[MG]B)\b/i.exec(title);
  var seeds = /👤\s*(\d+)/.exec(title);
  /* Size and peers have their own place in the row: drop them from the text. */
  var lines = title.replace(/👤\s*\d+/g, '').replace(/💾\s*[\d.,]+\s*[KMGT]i?B/gi, '').split(/\n+/);
  var hints = s.behaviorHints || {};
  var tags = sourceTags(name, title, hints.filename);
  return {
    addon: addonName,
    kind: s.infoHash ? 'torrent' : (s.url ? 'direct' : 'other'),
    url: s.url || '',
    infoHash: s.infoHash ? String(s.infoHash).toLowerCase() : '',
    fileIdx: s.fileIdx,
    sources: s.sources || null,
    headers: (hints.proxyHeaders && hints.proxyHeaders.request) || null,
    notWebReady: !!hints.notWebReady,
    filename: hints.filename || '',
    quality: quality,
    size: size ? size[1] : '',
    sizeBytes: size ? sizeToBytes(size[1]) : 0,
    seeds: seeds ? Number(seeds[1]) : null,
    /* Languages as the addons write them (flags or words): latino,
       castellano, es (Spanish, variant not said), en… (source-rank.js). */
    langs: tags.langs,
    original: tags.original,
    multi: tags.multi,
    subsEs: tags.subsEs,
    spanish: tags.langs.indexOf('latino') !== -1 || tags.langs.indexOf('castellano') !== -1 || tags.langs.indexOf('es') !== -1,
    cam: tags.cam,
    hevc: tags.hevc,
    tenBit: tags.tenBit,
    hdr: tags.hdr,
    remux: tags.remux,
    audioDts: tags.audioDts,
    audioTrueHd: tags.audioTrueHd,
    audioEac3: tags.audioEac3,
    av1: tags.av1,
    threeD: tags.threeD,
    mp4: tags.mp4,
    provider: tags.provider,
    label: (lines[0] || name || 'Fuente').trim(),
    detail: lines.slice(1).join(' ').replace(/\s+/g, ' ').trim(),
    name: name
  };
}

/* "2.1 GB" → bytes, to sort the sources by size. */
function sizeToBytes(text) {
  var m = /([\d.,]+)\s*([KMGT])i?B/i.exec(String(text || ''));
  if (!m) { return 0; }
  var n = parseFloat(m[1].replace(',', '.')) || 0;
  return n * Math.pow(1024, { K: 1, M: 2, G: 3, T: 4 }[m[2].toUpperCase()]);
}

function stremioSourcePlayable(src) {
  if (src.kind === 'torrent') { return platformHas('torrents') && /^[0-9a-f]{40}$/.test(src.infoHash); }
  return src.kind === 'direct' && /^https?:\/\//i.test(src.url);
}

/* Asks every addon with "stream" at once; onUpdate(groups, pending) runs as
   each one answers, so the list fills in while the slow ones search. */
/* What the addons answered for a title or episode, kept 10 minutes: an
   episode picked on the details screen has its sources ready when the
   viewer presses Reproducir. Also one lookup at a time per episode. */
var STREAMS_CACHE_MS = 10 * 60 * 1000;
var streamsCache = {};      /* key → { at, groups } */
var streamsInFlight = {};   /* key → [onUpdate…] */

function copyStreamGroups(groups) {
  return groups.map(function (g) {
    var c = {};
    for (var k in g) { if (Object.prototype.hasOwnProperty.call(g, k)) { c[k] = g[k]; } }
    c.sources = g.sources.slice();
    return c;
  });
}

function fetchStremioStreams(item, episode, onUpdate) {
  var type = item._stremioType || (isSeriesItem(item) ? 'series' : 'movie');
  var key = type + '|' + stremioStreamId(item, episode) + '|' + getVodSourcesConfig().addons.length;
  var hit = streamsCache[key];
  if (hit && Date.now() - hit.at < STREAMS_CACHE_MS) { onUpdate(copyStreamGroups(hit.groups), 0); return; }
  if (streamsInFlight[key]) { streamsInFlight[key].push(onUpdate); return; }
  var listeners = streamsInFlight[key] = [onUpdate];
  fetchStremioStreamsNow(item, episode, function (groups, pending) {
    if (!pending) {
      delete streamsInFlight[key];
      /* (Nothing kept when every addon failed: try again next time.) */
      if (groups.some(function (g) { return g.state === 'done'; })) { streamsCache[key] = { at: Date.now(), groups: copyStreamGroups(groups) }; }
    }
    for (var i = 0; i < listeners.length; i++) { listeners[i](pending ? groups : copyStreamGroups(groups), pending); }
  });
}

function fetchStremioStreamsNow(item, episode, onUpdate) {
  var cfg = getVodSourcesConfig();
  var type = item._stremioType || (isSeriesItem(item) ? 'series' : 'movie');
  var rawId = isSeriesItem(item) ? (episode && episode.id) : (item._stremioId || '');
  var groups = [];
  for (var i = 0; i < cfg.addons.length; i++) {
    if (addonSupports(cfg.addons[i], 'stream', type, rawId)) {
      groups.push({ addon: cfg.addons[i], name: cfg.addons[i].name, state: 'loading', sources: [], hidden: 0, dead: 0 });
    }
  }
  var pending = groups.length;
  onUpdate(groups, pending);
  groups.forEach(function (g) {
    addonRequest(g.addon.baseUrl + '/stream/' + encodeURIComponent(type) + '/' + stremioStreamId(item, episode) + '.json', function (err, payload) {
      var streams = (!err && payload && payload.streams) ? payload.streams : [];
      for (var s = 0; s < streams.length; s++) {
        var src = describeStremioStream(streams[s], g.name);
        src._i = g.sources.length;   /* the addon's own order, a tie-breaker */
        /* A torrent nobody is sharing (0 peers) would never start: left out. */
        if (src.kind === 'torrent' && src.seeds === 0) { g.dead++; }
        else if (stremioSourcePlayable(src)) { g.sources.push(src); } else { g.hidden++; }
      }
      g.state = err ? 'error' : 'done';
      g.error = err || '';
      noteSourceProviders(g.sources);
      onUpdate(groups, --pending);
    }, 25000);
  });
}

/* Next episode with no source chosen: the best one from the same addon,
   quality and type as before, or else the best of all. */
function autoPickStremioSource(item, episode, previous, done) {
  var finished = false;
  fetchStremioStreams(item, episode, function (groups, pending) {
    if (finished || pending > 0) { return; }
    finished = true;
    var all = [];
    groups.forEach(function (g) { all = all.concat(g.sources); });
    var ctx = sourceRankContext(item, episode);
    var best = null;
    if (previous) {
      best = bestSource(all.filter(function (s) {
        return s.addon === previous.addon && s.quality === previous.quality && s.kind === previous.kind;
      }), ctx);
    }
    done(best || bestSource(all, ctx) || null);
  });
}

/* ------------------------------------------------ "Elegir fuente" panel */
var sourcePickerOpen = false;
var sourcePickerNode = null;
var sourcePickerReturn = null;
var sourcePickerSeq = 0;
var sourcePickerCleanup = null;

function closeSourcePicker() {
  sourcePickerOpen = false;
  sourcePickerSeq++;
  if (sourcePickerCleanup) { sourcePickerCleanup(); sourcePickerCleanup = null; }
  if (sourcePickerNode && sourcePickerNode.parentNode) { sourcePickerNode.parentNode.removeChild(sourcePickerNode); }
  sourcePickerNode = null;
  if (sourcePickerReturn && isVisible(sourcePickerReturn)) { setFocus(sourcePickerReturn); }
  sourcePickerReturn = null;
}

/* "Elegir fuente" filters, kept for the next title. */
var SOURCE_FILTERS_KEY = 'opentv_source_filters_v1';
function loadSourceFilters() {
  var f = { quality: 'all', kind: 'all', lang: 'all', sort: 'rec' };
  try {
    var saved = JSON.parse(localStorage.getItem(SOURCE_FILTERS_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      if (/^(all|4K|1080p|720p|SD|CAM)$/.test(saved.quality)) { f.quality = saved.quality; }
      if (/^(all|direct|torrent)$/.test(saved.kind)) { f.kind = saved.kind; }
      if (/^(rec|big|small|seeds)$/.test(saved.sort)) { f.sort = saved.sort; }
      if (/^(all|latino|castellano|es|en)$/.test(saved.lang)) { f.lang = saved.lang; }
    }
  } catch (e) { /* defaults */ }
  return f;
}
function saveSourceFilters(f) {
  try { localStorage.setItem(SOURCE_FILTERS_KEY, JSON.stringify(f)); } catch (e) { /* ignore */ }
}

/* The quick filters of the panel (the preferences hide sources before). */
function sourcePassesFilters(src, filters) {
  if (filters.quality === 'CAM') { if (!src.cam) { return false; } }
  else if (filters.quality !== 'all' && (src.quality !== filters.quality || src.cam)) { return false; }
  if (filters.kind !== 'all' && src.kind !== filters.kind) { return false; }
  if (filters.lang !== 'all' && !sourceHasLang(src, filters.lang)) { return false; }
  return true;
}

function torrentNoticeSeen(key) {
  try { return localStorage.getItem(key || TORRENT_NOTICE_KEY) === '1'; } catch (e) { return false; }
}

var DOWNLOAD_NOTICE_KEY = 'opentv_download_notice_v1';

/* opts.auto: play the recommended source when the search ends, unless the
   viewer presses a key or clicks first. opts.download: pick what to
   download (never automatic). */
function openSourcePicker(item, episode, onPick, opts) {
  opts = opts || {};
  if (sourcePickerOpen) { closeSourcePicker(); }
  sourcePickerOpen = true;
  sourcePickerReturn = state.focus;
  var seq = ++sourcePickerSeq;
  var ctx = sourceRankContext(item, episode);
  var root = el('div', 'source-picker');
  root.id = 'dialog-sources';
  var panel = el('div', 'srcp-panel');
  var head = el('div', 'srcp-head');
  head.appendChild(el('div', 'srcp-title', opts.download ? 'Descargar' : 'Elegir fuente'));
  var what = item.title || '';
  if (episode) { what += ' · ' + (episode.number ? 'Capítulo ' + episode.number : (episode.title || '')); }
  head.appendChild(el('div', 'srcp-sub', what));
  panel.appendChild(head);
  /* Filters: quality, type, language, and the order (kept for next time). */
  var filters = loadSourceFilters();
  var showHidden = false;
  var bar = el('div', 'srcp-filters');
  panel.appendChild(bar);
  var body = el('div', 'srcp-body scrollable');
  panel.appendChild(body);
  var foot = el('div', 'srcp-foot');
  var note = el('div', 'srcp-note', '');
  var cancel = el('div', 'acc-seg-btn focusable', 'Cancelar');
  cancel._activate = closeSourcePicker;
  foot.appendChild(note);
  foot.appendChild(cancel);
  panel.appendChild(foot);
  root.appendChild(panel);
  root.addEventListener('click', function (ev) { if (ev.target === root) { closeSourcePicker(); } });
  mountOverlay(root);
  sourcePickerNode = root;
  setFocus(cancel);

  /* Automatic choice: off as soon as the viewer does anything here. */
  var waiting = !!opts.auto && !opts.download && ctx.prefs.autoPlay;
  var autoTimer = null;
  function stopWaiting() {
    if (!waiting) { return; }
    waiting = false;
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    if (seq === sourcePickerSeq && sourcePickerOpen) { render(lastGroups, lastPending); }
  }
  function onKey() { stopWaiting(); }
  document.addEventListener('keydown', onKey, true);
  root.addEventListener('mousedown', stopWaiting);
  root.addEventListener('wheel', stopWaiting);
  sourcePickerCleanup = function () {
    document.removeEventListener('keydown', onKey, true);
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  };

  function choose(src) {
    var key = opts.download ? DOWNLOAD_NOTICE_KEY : TORRENT_NOTICE_KEY;
    if (src.kind === 'torrent' && !torrentNoticeSeen(key)) { return showTorrentNotice(src, key); }
    closeSourcePicker();
    onPick(src);
  }

  /* First torrent (and first torrent download): a short, calm note, once. */
  function showTorrentNotice(src, key) {
    waiting = false;
    clear(body);
    bar.hidden = true;
    var box = el('div', 'srcp-notice');
    box.appendChild(el('b', null, opts.download ? 'Descargar con torrent' : 'Reproducir con torrent'));
    box.appendChild(el('p', null, opts.download
      ? 'El archivo llega de otras personas que lo comparten, y mientras se descarga tu equipo también comparte las partes que ya tiene. Al terminar queda en tu carpeta Videos\\OpenTV.'
      : 'El vídeo llega de otras personas que lo comparten, y mientras lo ves tu equipo también comparte lo que ya bajó. Al terminar, se borra.'));
    box.appendChild(el('p', 'srcp-notice-small', opts.download ? 'Descarga solo contenido que tengas derecho a guardar.' : 'Usa solo contenido que tengas derecho a ver.'));
    var row = el('div', 'srcp-notice-actions');
    var ok = el('div', 'acc-seg-btn focusable is-selected', opts.download ? 'Descargar' : 'Reproducir');
    ok._activate = function () {
      try { localStorage.setItem(key, '1'); } catch (e) { /* ignore */ }
      closeSourcePicker();
      onPick(src);
    };
    var backBtn = el('div', 'acc-seg-btn focusable', 'Volver');
    backBtn._activate = function () { bar.hidden = false; render(lastGroups, lastPending); };
    row.appendChild(ok);
    row.appendChild(backBtn);
    box.appendChild(row);
    body.appendChild(box);
    setFocus(ok);
  }

  /* Ajustes de fuentes inside the panel (Torrentio-style preferences). */
  function showPrefs() {
    waiting = false;
    clear(body);
    bar.hidden = true;
    var back = el('div', 'srcp-chip focusable is-on srcpref-back', '← Volver a las fuentes');
    back._activate = function () { bar.hidden = false; render(lastGroups, lastPending); body.scrollTop = 0; };
    body.appendChild(back);
    body.appendChild(buildSourcePrefsEditor(function () { ctx = sourceRankContext(item, episode); }));
    setFocus(back);
  }

  /* Chip rows of the filter bar, with how many sources each would show. */
  function renderFilters(all) {
    var keepChip = state.focus && state.focus._chipKey;
    clear(bar);
    function count(test) { var n = 0; all.forEach(function (s) { if (test(s)) { n++; } }); return n; }
    function chip(group, value, label, n) {
      var on = filters[group] === value;
      var c = el('div', 'srcp-chip focusable' + (on ? ' is-on' : '') + (n === 0 && value !== 'all' && !on ? ' is-empty' : ''),
        label + (typeof n === 'number' && value !== 'all' ? ' · ' + n : ''));
      c._chipKey = group + ':' + value;
      c._activate = function () {
        filters[group] = value;
        saveSourceFilters(filters);
        render(lastGroups, lastPending);
        body.scrollTop = 0;   /* the new list starts at its top */
      };
      return c;
    }
    var qRow = el('div', 'srcp-chips');
    qRow.appendChild(chip('quality', 'all', 'Todas'));
    [['4K', '4K'], ['1080p', 'Full HD'], ['720p', 'HD'], ['SD', 'SD']].forEach(function (q) {
      qRow.appendChild(chip('quality', q[0], q[1], count(function (s) { return s.quality === q[0] && !s.cam; })));
    });
    var cams = count(function (s) { return s.cam; });
    if (cams || filters.quality === 'CAM') { qRow.appendChild(chip('quality', 'CAM', 'CAM', cams)); }
    qRow.appendChild(el('span', 'srcp-chips-gap'));
    [['all', 'Todo'], ['direct', 'Directo'], ['torrent', 'Torrent']].forEach(function (k) {
      qRow.appendChild(chip('kind', k[0], k[1], count(function (s) { return s.kind === k[0]; })));
    });
    bar.appendChild(qRow);
    var lRow = el('div', 'srcp-chips');
    lRow.appendChild(el('span', 'srcp-chips-label', 'Idioma'));
    lRow.appendChild(chip('lang', 'all', 'Todos'));
    [['latino', 'Latino'], ['castellano', 'Castellano'], ['es', 'Español'], ['en', 'Inglés']].forEach(function (l) {
      var n = count(function (s) { return sourceHasLang(s, l[0]); });
      /* "Español" (variant not said) only when some source says just that. */
      if (l[0] === 'es' && !n && filters.lang !== 'es') { return; }
      lRow.appendChild(chip('lang', l[0], l[1], n));
    });
    bar.appendChild(lRow);
    var sRow = el('div', 'srcp-chips');
    sRow.appendChild(el('span', 'srcp-chips-label', 'Ordenar'));
    [['rec', 'Recomendado'], ['big', 'Más pesadas'], ['small', 'Más ligeras'], ['seeds', 'Más semillas']].forEach(function (o) {
      sRow.appendChild(chip('sort', o[0], o[1]));
    });
    sRow.appendChild(el('span', 'srcp-chips-gap'));
    var prefsChip = el('div', 'srcp-chip focusable srcp-chip-prefs', 'Preferencias');
    prefsChip._chipKey = 'prefs';
    prefsChip._activate = showPrefs;
    sRow.appendChild(prefsChip);
    bar.appendChild(sRow);
    if (keepChip) {
      var again = bar.querySelector('.srcp-chip.focusable');
      var chips = bar.querySelectorAll('.srcp-chip');
      for (var i = 0; i < chips.length; i++) { if (chips[i]._chipKey === keepChip) { again = chips[i]; } }
      if (again) { setFocus(again); }
    }
  }

  function ordered(list) {
    var out = list.slice();
    if (filters.sort === 'big') { out.sort(function (a, b) { return (b.sizeBytes || 0) - (a.sizeBytes || 0) || a._i - b._i; }); }
    else if (filters.sort === 'small') { out.sort(function (a, b) { return (a.sizeBytes || Infinity) - (b.sizeBytes || Infinity) || a._i - b._i; }); }
    else if (filters.sort === 'seeds') { out.sort(function (a, b) { return (b.seeds || 0) - (a.seeds || 0) || a._i - b._i; }); }
    else { out.sort(function (a, b) { return b._score - a._score; }); }
    return out;
  }

  /* Like Torrentio's "max results per quality": the first N of each. */
  function capPerQuality(list) {
    var max = ctx.prefs.perQuality;
    if (!max || showHidden) { return list; }
    var seen = {};
    return list.filter(function (s) {
      var q = s.cam ? 'CAM' : (s.quality || '?');
      seen[q] = (seen[q] || 0) + 1;
      return seen[q] <= max;
    });
  }

  function sourceRow(src, key, best) {
    var row = el('div', 'srcp-item focusable' + (src === best ? ' is-best' : ''));
    row._srcKey = key;
    var q = el('span', 'srcp-q' + (src.quality || src.cam ? '' : ' is-empty') + (src.cam ? ' is-cam' : ''), src.cam ? 'CAM' : (src.quality || '—'));
    var txt = el('div', 'srcp-text');
    txt.appendChild(el('div', 'srcp-label', src.label));
    var meta = [];
    var langs = sourceLangText(src);
    meta.push(langs || 'Idioma original');
    meta.push(src.kind === 'torrent' ? 'Torrent' : 'Directo');
    if (src.size) { meta.push(src.size); }
    if (src.seeds !== null) { meta.push(src.seeds + (src.seeds === 1 ? ' semilla' : ' semillas')); }
    if (src.hdr) { meta.push('HDR'); }
    if (src.hevc) { meta.push('HEVC'); }
    if (src.provider) { meta.push(src.provider); }
    else if (src.detail) { meta.push(src.detail); }
    txt.appendChild(el('div', 'srcp-meta', meta.join(' · ')));
    /* Android: why this device avoids it (silent audio, no room…). */
    var warn = sourceDeviceNote(src);
    if (warn) { txt.appendChild(el('div', 'srcp-warn', warn)); }
    row.appendChild(q);
    row.appendChild(txt);
    row.classList.toggle('is-torrent', src.kind === 'torrent');
    row._activate = function () { choose(src); };
    return row;
  }

  var lastGroups = [], lastPending = 0;
  function render(groups, pending) {
    lastGroups = groups;
    lastPending = pending;
    if (bar.hidden) { return; }   /* the notice or the preferences are open */
    var keepFocus = state.focus && state.focus._srcKey;
    var all = [];
    groups.forEach(function (g) {
      g.sources.forEach(function (s, i) { s._i = i; s._score = scoreSource(s, ctx); all.push(s); });
    });
    var best = bestSource(all, ctx);
    renderFilters(all);
    clear(body);
    if (!groups.length) {
      body.appendChild(el('div', 'srcp-empty', 'Ninguno de tus addons da fuentes para reproducir. Agrega un addon de fuentes en Ajustes → Addons.'));
    }
    var total = 0, shown = 0, first = null, again = null;
    /* The recommended one first, with why. */
    if (best && all.length > 1) {
      var rec = el('div', 'srcp-group srcp-rec');
      var rh = el('div', 'srcp-group-head');
      rh.appendChild(el('span', 'srcp-group-name', 'Recomendada'));
      rh.appendChild(el('span', 'srcp-group-state', best.addon));
      rec.appendChild(rh);
      var bestRow = sourceRow(best, 'best', best);
      rec.appendChild(bestRow);
      rec.appendChild(el('div', 'srcp-why', sourceReason(best)));
      body.appendChild(rec);
      first = bestRow;
      if (keepFocus === 'best') { again = bestRow; }
    }
    var prefHidden = 0;
    groups.forEach(function (g) {
      var sec = el('div', 'srcp-group');
      var gh = el('div', 'srcp-group-head');
      gh.appendChild(el('span', 'srcp-group-name', g.name));
      var allowed = g.sources.filter(function (s) { return showHidden || !sourcePrefsBlock(s, ctx.prefs, !!episode); });
      prefHidden += g.sources.length - allowed.length;
      var visible = capPerQuality(ordered(allowed.filter(function (s) { return sourcePassesFilters(s, filters); })));
      total += g.sources.length;
      gh.appendChild(el('span', 'srcp-group-state', g.state === 'loading' ? 'Buscando…'
        : (g.state === 'error' ? 'No respondió' : (visible.length === g.sources.length
          ? g.sources.length + (g.sources.length === 1 ? ' fuente' : ' fuentes')
          : visible.length + ' de ' + g.sources.length))));
      sec.appendChild(gh);
      if (g.state === 'done' && g.sources.length && !visible.length) {
        sec.appendChild(el('div', 'srcp-hidden', 'Ninguna fuente con estos filtros.'));
      }
      visible.forEach(function (src) {
        shown++;
        /* Already at the top, under "Recomendada". */
        if (src === best && all.length > 1) { return; }
        var row = sourceRow(src, g.name + '#' + src._i, best);
        sec.appendChild(row);
        if (!first) { first = row; }
        if (keepFocus && keepFocus === row._srcKey) { again = row; }
      });
      if (g.dead) { sec.appendChild(el('div', 'srcp-hidden', g.dead + (g.dead === 1 ? ' torrent oculto: nadie lo está compartiendo ahora.' : ' torrents ocultos: nadie los está compartiendo ahora.'))); }
      if (g.hidden) { sec.appendChild(el('div', 'srcp-hidden', g.hidden + ' no se pueden reproducir en OpenTV (YouTube o enlaces externos).')); }
      body.appendChild(sec);
    });
    if (prefHidden || showHidden) {
      var more = el('div', 'srcp-chip focusable srcp-showhidden', showHidden ? 'Aplicar mis preferencias otra vez'
        : prefHidden + (prefHidden === 1 ? ' fuente oculta' : ' fuentes ocultas') + ' por tus preferencias · Mostrar');
      more._srcKey = 'showhidden';
      more._activate = function () { showHidden = !showHidden; render(lastGroups, lastPending); };
      body.appendChild(more);
      if (keepFocus === 'showhidden') { again = more; }
    }
    var count = pending > 0 ? 'Buscando en ' + pending + (pending === 1 ? ' addon…' : ' addons…')
      : (shown === total ? total + (total === 1 ? ' fuente' : ' fuentes') : shown + ' de ' + total + ' fuentes');
    note.textContent = waiting && best ? count + ' · Se reproducirá la recomendada. Pulsa cualquier tecla para elegir otra.' : count;

    /* Play the recommended one when every addon answered, or 8 s after the
       first sources arrived (a slow addon must not hold the viewer). */
    if (waiting && best) {
      if (pending === 0) { return autoChoose(); }
      if (!autoTimer) {
        autoTimer = setTimeout(function () {
          autoTimer = null;
          if (waiting && seq === sourcePickerSeq && sourcePickerOpen) { autoChoose(); }
        }, 8000);
      }
    }
    if (waiting && pending === 0 && !best) { waiting = false; }

    /* Focus the first source as soon as one shows up, but never take the
       focus away from where the viewer already is (a filter chip, too). */
    if (state.focus && state.focus._chipKey && isVisible(state.focus)) { return; }
    if (again) { setFocus(again); }
    else if (first && (!state.focus || state.focus === cancel || !isVisible(state.focus))) { setFocus(first); }
  }

  function autoChoose() {
    waiting = false;
    var all = [];
    lastGroups.forEach(function (g) { all = all.concat(g.sources); });
    var best = bestSource(all, ctx);
    if (best) { choose(best); }
  }

  fetchStremioStreams(item, episode, function (groups, pending) {
    if (seq !== sourcePickerSeq || !sourcePickerOpen) { return; }
    render(groups, pending);
  });
}

/* ------------------------------------------------ playback */
/* Called by expandToFullscreen: true when it must wait (details still
   loading, or the viewer has to pick a source first). */
function stremioNeedsPick(item, episode) {
  if (!item || !item._stremio || item._plain) { return false; }
  if (isSeriesItem(item) && !episode) {
    var ep = state.detailEpisode || (item.episodes && item.episodes[0]) || null;
    if (!ep && !item._detailsLoaded) {
      loadStremioMeta(item, function () {
        if (item.episodes && item.episodes.length) { expandToFullscreen(item, state.detailEpisode || item.episodes[0]); }
      });
      return true;
    }
    if (ep) { expandToFullscreen(item, ep); return true; }
    return false;
  }
  var target = episode || item;
  if (target._stremioSource) { return false; }
  /* Downloaded: plays from the disk, no source to choose. */
  if (item._downloadId || downloadedFileFor(item, episode)) { return false; }
  /* No addon gives sources: say where to add one, play nothing. */
  if (!hasSourceAddons()) { showNoSourcesNotice(); return true; }
  var saved = savedStremioPick(item, episode);
  if (saved) { target._stremioSource = saved; return false; }
  openSourcePicker(item, episode, function (src) {
    target._stremioSource = src;
    rememberStremioPick(item, episode, src);
    expandToFullscreen(item, episode);
  }, { auto: true });
  return true;
}

/* "Reproducir" with no addon that gives sources (Cinemeta and Kitsu only
   give the catalog): say so, and where to add one. */
function showNoSourcesNotice() {
  showShortNotice('Agrega un addon para reproducir',
    'Para ver este contenido necesitas un addon de fuentes. Agrégalo en Addons.',
    'Ir a Addons', function () { openSettingsAt('sources'); });
}

/* Panels over the app (source picker, notices, the guide): inside the
   1920×1080 canvas; on a phone, over its own layer instead (the canvas is
   hidden there until a video plays). */
function mountOverlay(root) {
  if (typeof isPhone === 'function' && isPhone()) {
    root.classList.add('is-sheet');
    document.body.appendChild(root);
    return;
  }
  ($('app') || document.body).appendChild(root);
}

/* A short message in the panel window: title, one sentence, and an
   optional action next to "Entendido". */
function showShortNotice(title, text, actionLabel, action) {
  if (sourcePickerOpen) { closeSourcePicker(); }
  sourcePickerOpen = true;
  sourcePickerReturn = state.focus;
  sourcePickerSeq++;
  var root = el('div', 'source-picker');
  var panel = el('div', 'srcp-panel is-notice');
  var head = el('div', 'srcp-head');
  head.appendChild(el('div', 'srcp-title', title));
  panel.appendChild(head);
  var body = el('div', 'srcp-body');
  var box = el('div', 'srcp-notice');
  box.appendChild(el('p', null, text));
  body.appendChild(box);
  panel.appendChild(body);
  var foot = el('div', 'srcp-foot');
  var ok = el('div', 'acc-seg-btn focusable' + (action ? '' : ' is-selected'), 'Entendido');
  ok._activate = closeSourcePicker;
  foot.appendChild(ok);
  var first = ok;
  if (action) {
    var go = el('div', 'acc-seg-btn focusable is-selected', actionLabel);
    go._activate = function () { closeSourcePicker(); action(); };
    foot.appendChild(go);
    first = go;
  }
  panel.appendChild(foot);
  root.appendChild(panel);
  root.addEventListener('click', function (ev) { if (ev.target === root) { closeSourcePicker(); } });
  mountOverlay(root);
  sourcePickerNode = root;
  setFocus(first);
}

/* Detail page "Cambiar fuente". */
function changeStremioSource(item, episode) {
  if (isSeriesItem(item) && !episode) { episode = state.detailEpisode || (item.episodes && item.episodes[0]) || null; }
  openSourcePicker(item, episode, function (src) {
    var target = episode || item;
    target._stremioSource = src;
    target._stremioNoCopy = false;   /* a new file: try copying its video again */
    rememberStremioPick(item, episode, src);
    resumeRestarted = false;
    /* Stop the current source the player's own way (it saves the position
       and detaches its handlers: emptying src by hand fires an error that
       the compatibility watchdog takes for an unplayable video). */
    if (playerVideo && state.playerItem === item) {
      stopPlayerVideo();
      /* src="" reads back as the page's own URL, which expandToFullscreen
         would take for a video still loaded: no attribute at all. */
      playerVideo.removeAttribute('src');
    }
    state.streamMode = 'normal';
    expandToFullscreen(item, episode);
  });
}

var torrentPoll = null;
var torrentInUse = false;

function stopTorrentPoll() {
  if (torrentPoll) { clearInterval(torrentPoll); torrentPoll = null; }
}

/* Leaving movies and series for good (not just to the details page, where
   the small player keeps going): stop the torrent and free the disk. */
function stremioTorrentRelease() {
  stopTorrentPoll();
  if (!torrentInUse) { return; }
  torrentInUse = false;
  portalServiceCall('torrentStop', {}, function () {});
}

function formatSpeed(bytes) {
  if (bytes >= 1048576) { return (bytes / 1048576).toFixed(1).replace('.', ',') + ' MB/s'; }
  return Math.max(0, Math.round(bytes / 1024)) + ' KB/s';
}

/* While the torrent starts: how many people it found and how fast it goes. */
function startTorrentPoll(item) {
  stopTorrentPoll();
  torrentPoll = setInterval(function () {
    if (state.playerItem !== item || (state.screen !== 'player' && state.screen !== 'detail')) { return stopTorrentPoll(); }
    if (playerVideo && playerVideo.readyState >= 3 && !playerVideo.paused) { return stopTorrentPoll(); }
    portalServiceCall('torrentStats', {}, function (err, st) {
      if (!torrentPoll || err || !st || !st.active || state.playerItem !== item) { return; }
      /* The fastest download seen tells how good this connection is. */
      noteNetSpeed(st.speed);
      if (playerVideo && playerVideo.readyState >= 3) { return; }
      setPlayerStatus((st.ready ? 'Cargando torrent' : 'Buscando el torrent') + ' · ' +
        st.peers + (st.peers === 1 ? ' conexión' : ' conexiones') + ' · ' + formatSpeed(st.speed));
    }, 5000);
  }, 1000);
}

/* resolvePlayerStream for addon titles: the chosen source → playable URL. */
function resolveStremioPlayback(item, done) {
  var mySeq = resolveSeq;
  if (item._plain) { return done(item.streamUrl || ''); }
  var series = isSeriesItem(item);
  var ep = series ? (state.playerEpisode || (item.episodes && item.episodes[0]) || null) : null;
  if (series && !ep) {
    if (!item._detailsLoaded) {
      setPlayerStatus('Cargando capítulos…');
      loadStremioMeta(item, function () {
        if (mySeq !== resolveSeq) { return; }
        if (item.episodes && item.episodes.length) { resolveStremioPlayback(item, done); }
        else { vodFailure('los capítulos', item._detailError || 'Ninguno de tus addons da los capítulos'); done(''); }
      });
      return;
    }
    vodFailure('los capítulos', item._detailError || 'Ninguno de tus addons da los capítulos');
    return done('');
  }
  if (ep && !state.playerEpisode) { state.playerEpisode = ep; }
  var target = ep || item;
  /* Downloaded: the file on disk, through the downloads' local server. */
  var local = item._downloadId ? { id: item._downloadId, fileName: '' }
    : (target._stremioSource ? null : downloadedFileFor(item, ep));
  if (local) {
    stremioTorrentRelease();
    setPlayerStatus('Abriendo la descarga…');
    portalServiceCall('downloadOpen', { id: local.id }, function (err, info) {
      if (mySeq !== resolveSeq) { return; }
      if (err || !info || info.returnValue === false || !info.url) {
        vodFailure('la descarga', err || (info && info.errorText) || 'No se encontró el archivo descargado');
        return done('');
      }
      resolveExternal(info.url, info.name || local.fileName, null, false);
    });
    return;
  }
  var src = target._stremioSource || savedStremioPick(item, ep);
  if (src) { return go(src); }
  var previous = null;
  if (item.episodes) {
    for (var i = 0; i < item.episodes.length && !previous; i++) {
      if (item.episodes[i] !== ep && item.episodes[i]._stremioSource) { previous = item.episodes[i]._stremioSource; }
    }
  }
  /* Nothing chosen and no earlier episode to copy: the panel opens and plays
     the recommended source unless the viewer picks another one. */
  if (!previous) {
    setPlayerStatus('Buscando la mejor fuente…');
    openSourcePicker(item, ep, function (picked) {
      target._stremioSource = picked;
      rememberStremioPick(item, ep, picked);
      if (mySeq === resolveSeq) { go(picked); }
    }, { auto: true });
    return;
  }
  /* Next episode played on its own: same addon and quality as the last one. */
  setPlayerStatus('Buscando fuente…');
  autoPickStremioSource(item, ep, previous, function (picked) {
    if (mySeq !== resolveSeq) { return; }
    if (!picked) { vodFailure('la fuente', 'Tus addons no dieron ninguna fuente para este título'); return done(''); }
    rememberStremioPick(item, ep, picked);
    go(picked);
  });

  function go(chosen) {
    target._stremioSource = chosen;
    if (chosen.infoHash) {
      if (!platformHas('torrents')) { vodFailure('la fuente', 'Los torrents no funcionan en este aparato'); return done(''); }
      setPlayerStatus('Buscando el torrent…');
      torrentInUse = true;
      startTorrentPoll(item);
      portalServiceCall('torrentStart', { infoHash: chosen.infoHash, fileIdx: chosen.fileIdx, sources: chosen.sources }, function (err, info) {
        if (mySeq !== resolveSeq) { return; }
        if (err || !info || info.returnValue === false || !info.url) {
          stopTorrentPoll();
          vodFailure('el torrent', err || (info && info.errorText) || 'No se pudo abrir el torrent');
          return done('');
        }
        /* Android: plays, but the whole file will not fit on this device. */
        if (info.fits === false) { setPlayerStatus('Este torrent no cabe completo en el aparato: se verá mientras haya espacio.'); }
        resolveExternal(info.url, info.name || chosen.filename, null, false);
      }, 75000);
      return;
    }
    stremioTorrentRelease();
    resolveExternal(chosen.url, chosen.filename, chosen.headers, chosen.notWebReady);
  }

  function resolveExternal(url, name, headers, notWebReady) {
    var smooth = state.streamMode === 'smooth' || state.streamMode === 'relay';
    var params = {
      url: url, name: name || '', headers: headers || {}, notWebReady: !!notWebReady,
      forceRelay: smooth,
      /* Copy the video and convert only the audio, unless that already failed. */
      videoCopy: !target._stremioNoCopy,
      audioTrack: vodCurrentAudioTrack || 0,
      duration: durationToSeconds(target.duration)
    };
    lastVodAttempt = { phase: 'enlace de vídeo', status: 'cargando', error: '' };
    portalServiceCall('resolveExternal', params, function (error, payload) {
      if (mySeq !== resolveSeq) { return; }
      if (error || !payload || payload.returnValue === false || !(payload.proxyPath || payload.url)) {
        vodFailure('el enlace de vídeo', error || (payload && payload.errorText) || 'Respuesta vacía del servicio');
        return done('');
      }
      lastVodAttempt = { phase: 'enlace de vídeo', status: 'recibido', error: '' };
      item.streamMime = payload.mime || '';
      item.streamCodec = '';
      item.isHls = !!payload.isHls;
      item._relayUrl = payload.relayUrl || '';
      if (ep) { ep._relayUrl = item._relayUrl; }
      target._stremioRelayCopy = !!payload.isRelay && params.videoCopy;
      /* A new file: its own tracks and the addons' are read again; what the
         viewer imported stays with the title. */
      var old = mediaInfoCache[mediaInfoKey(item)];
      var info = { audio: '', subtitles: [], tracks: [], selected: {}, duration: 0, _importedSubs: (old && old._importedSubs) || [] };
      info.subtitles = info._importedSubs.slice();
      item.subtitles = info.subtitles;
      stopEmbeddedSubtitle();
      /* Android: ExoPlayer starts each file with its own tracks off. */
      nativeSubIndex = -1;
      nativeCueText = '';
      mediaInfoCache[mediaInfoKey(item)] = info;
      done(payload.proxyPath || payload.url);
      requestVideoDuration(item, ep, payload);
      loadStremioSubtitles(item, ep, { url: url, headers: headers, name: name });
      bindNativeTextTracks();
    }, 30000);
  }
}

/* A torrent is slow to start and may pause while it downloads: that is the
   network, not a video the player cannot read (compat-watchdog.js). */
function stremioPlayingTorrent() {
  var item = state.playerItem;
  var target = item ? (state.playerEpisode || item) : null;
  return !!(item && item._stremio && target._stremioSource && target._stremioSource.infoHash);
}

/* The relay copied a video the player then could not show: try once more
   converting the video too (slower, but plays anything). */
function stremioRetryTranscode() {
  var item = state.playerItem;
  if (!item || !item._stremio || state.playerMode !== 'vod') { return false; }
  var target = state.playerEpisode || item;
  if (target._stremioNoCopy || !target._stremioRelayCopy) { return false; }
  target._stremioNoCopy = true;
  state.streamMode = 'smooth';
  setPlayerStatus('Ajustando la reproducción…');
  setTimeout(function () {
    if (state.playerItem === item && state.playerMode === 'vod') { restartCurrentPlayback(); }
  }, 0);
  return true;
}

/* ------------------------------------------------ the file's audio tracks */
/* One track as the settings dialog shows it. The track's own title says the
   dub ("Latino", "Castellano"); when it says nothing, the source's tags do
   (a "Latino" release with one Spanish track is Latino). */
function audioTrackLabel(t, src) {
  var title = String(t.title || '');
  var low = title.toLowerCase();
  var label;
  if (/latin|latam|\blat\b|m[eé]xic|hispanoam/.test(low)) { label = 'Español (Latino)'; }
  else if (/castell|espa[ñn]a\b|\bspain\b|europe|\bcast\b/.test(low)) { label = 'Español (Castellano)'; }
  else {
    var code = String(t.lang || '').toLowerCase();
    var known = code && !/^(und|unk|mis|zxx|mul)$/.test(code);
    label = known ? formatAudioLang(code) : '';
    if (!label && title) {
      label = /english|ingl[eé]s/.test(low) ? 'Inglés' : (/spanish|espa[ñn]ol/.test(low) ? 'Español'
        : (/portug/.test(low) ? 'Portugués' : (/fran[cç]|french/.test(low) ? 'Francés'
        : (/ital/.test(low) ? 'Italiano' : (/german|deutsch/.test(low) ? 'Alemán'
        : (/japan|jap[oó]n/.test(low) ? 'Japonés' : title.charAt(0).toUpperCase() + title.slice(1)))))));
    }
    if (!label) { label = 'Pista'; }
    if (label === 'Español' && src && src.langs) {
      var lat = src.langs.indexOf('latino') !== -1, cas = src.langs.indexOf('castellano') !== -1;
      if (lat && !cas) { label = 'Español (Latino)'; } else if (cas && !lat) { label = 'Español (Castellano)'; }
    }
  }
  if (/comment|comentario/.test(low)) { label += ' · Comentarios'; }
  return label;
}

/* The tracks the service read from the file → [{index, code, label}],
   telling apart two tracks with the same name by title or channels. */
function stremioAudioList(tracks, src) {
  var out = tracks.map(function (t, i) {
    return { index: i, code: String(t.lang || 'und'), label: audioTrackLabel(t, src), title: String(t.title || ''), channels: String(t.channels || '') };
  });
  var counts = {};
  out.forEach(function (t) { counts[t.label] = (counts[t.label] || 0) + 1; });
  out.forEach(function (t) {
    if (counts[t.label] < 2) { return; }
    var extra = t.title && t.title.toLowerCase() !== t.label.toLowerCase() ? t.title : (t.channels || ('pista ' + (t.index + 1)));
    t.label += ' · ' + extra;
  });
  return out;
}

/* Which track the viewer's languages want (Ajustes → Preferencias de addons), -1 = none. */
function preferredSourceAudioIndex(list) {
  var langs = loadSourcePrefs().langs;
  var tests = {
    latino: [/Latino/, /^Español$/], castellano: [/Castellano/, /^Español$/],
    en: [/^Inglés/], pt: [/^Portugués/]
  };
  for (var i = 0; i < langs.length; i++) {
    var rules = tests[langs[i]] || [];
    for (var r = 0; r < rules.length; r++) {
      for (var t = 0; t < list.length; t++) { if (rules[r].test(list[t].label)) { return list[t].index; } }
    }
  }
  return -1;
}

function stremioMediaInfo(item) {
  var key = mediaInfoKey(item);
  var info = mediaInfoCache[key] || { audio: '', subtitles: item.subtitles || [], tracks: [], selected: {}, duration: 0 };
  mediaInfoCache[key] = info;
  return info;
}

/* playback.js requestVideoDuration: the service read the file's tracks.
   Audio: shown with its real language, and a file that starts on another
   dub switches to the viewer's language once. Subtitles: the text ones
   inside the file join the addons' (Preferencias decides the order). */
function onSourceTracks(item, episode, answer) {
  if (!item || !item._stremio) { return; }
  var target = episode || item;
  var info = stremioMediaInfo(item);
  var tracks = answer.audio || [];
  if (tracks.length) {
    var list = stremioAudioList(tracks, target._stremioSource || null);
    info.audioTracks = list;
    info.audio = list.map(function (t) { return t.code; }).join(',');
    if (state.playerItem === item && list.length > 1 && !vodAudioChosen && relayBaseUrl) {
      var want = preferredSourceAudioIndex(list);
      if (want >= 0 && want !== (vodCurrentAudioTrack || 0)) { switchAudioTrack(want); }
    }
    if (dialogPlaySettingsOpen) { renderDialogAudio(); }
  }
  /* Only through the relay (it writes them while playing), and only text
     ones: picture subtitles (PGS, VobSub) cannot become text. */
  var fileSubs = [];
  (answer.subtitles || []).forEach(function (s, idx) {
    if (!s.text) { return; }
    fileSubs.push({ lang: s.lang || 'und', url: 'embedded:' + idx, format: 'vtt', forced: !!s.forced,
      label: audioTrackLabel({ lang: s.lang, title: s.title }, null) + (s.forced ? ' · forzados' : '') + ' · del archivo' });
  });
  /* (Android: ExoPlayer lists the file's own tracks, see bindNativeTextTracks.) */
  if (relayBaseUrl) { info._fileSubs = fileSubs; }
  composeStremioSubtitles(item, info);
}

/* The subtitle list of the title: the file's own tracks and the addons',
   in the order (or only the ones) Preferencias says. */
function composeStremioSubtitles(item, info) {
  var from = loadSourcePrefs().subsFrom;
  var file = from === 'addonsOnly' ? [] : (info._fileSubs || []);
  var addons = from === 'fileOnly' ? [] : (info._addonSubs || []);
  var imported = info._importedSubs || [];
  /* Forced tracks (only the foreign lines) go after the full ones. */
  file = file.filter(function (s) { return !s.forced; }).concat(file.filter(function (s) { return s.forced; }));
  var list = (from === 'addons' || from === 'addonsOnly') ? addons.concat(file) : file.concat(addons);
  info.subtitles = imported.concat(list);
  item.subtitles = info.subtitles;
  if (state.playerItem === item) { applySubtitleDefaults(info); }
  if (dialogPlaySettingsOpen) { renderDialogSubtitle(); }
}

/* ------------------------------------------------ subtitles inside the file */
/* Android: ExoPlayer reads the file's own text tracks (MKV, MP4) and sends
   the line on screen; the page draws it with the viewer's style
   (ui/js/native-player.js: window.__opentvNative). */
var nativeTextBound = false;
function bindNativeTextTracks() {
  var n = window.__opentvNative;
  if (nativeTextBound || !n || typeof n.onTextTracks !== 'function') { return; }
  nativeTextBound = true;
  n.onTextTracks(function (tracks) {
    var item = state.playerItem;
    if (!item || !item._stremio) { return; }
    var info = stremioMediaInfo(item);
    info._fileSubs = (tracks || []).map(function (t) {
      return { lang: t.lang || 'und', url: 'native:' + t.index, format: 'native', forced: !!t.forced,
        label: audioTrackLabel({ lang: t.lang, title: t.label }, null) + (t.forced ? ' · forzados' : '') + ' · del archivo' };
    });
    composeStremioSubtitles(item, info);
  });
  n.onCues(function (text) {
    nativeCueText = text || '';
    if (nativeSubIndex >= 0) { updateSubtitleDisplay(vodPlaybackPosition()); }
  });
}

var embeddedSub = null;   /* { n, base, timer } */

function embeddedSubtitleOn(sub) {
  return !!(embeddedSub && relayBaseUrl === embeddedSub.base && sub.url === 'embedded:' + embeddedSub.n);
}

function stopEmbeddedSubtitle() {
  if (!embeddedSub) { return; }
  if (embeddedSub.timer) { clearInterval(embeddedSub.timer); }
  var base = embeddedSub.base;
  embeddedSub = null;
  /* The next relay runs stop writing them (the current one may finish). */
  try { var x = new XMLHttpRequest(); x.open('GET', base + '?setsub=-1', true); x.send(null); } catch (e) { /* ignore */ }
}

/* Asks the relay to write that track while it plays (one restart at the
   same second), then reads what it wrote every 2 s. */
function startEmbeddedSubtitle(sub, seq) {
  stopEmbeddedSubtitle();
  activeSubtitleCues = [];
  if (!relayBaseUrl || !playerVideo) { return; }
  var n = parseInt(String(sub.url).split(':')[1], 10) || 0;
  var base = relayBaseUrl;
  embeddedSub = { n: n, base: base, timer: null };
  var mine = embeddedSub;
  function read() {
    if (embeddedSub !== mine || seq !== subtitleSeq) { return; }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', base + '?vtt=1', true);
    xhr.onload = function () {
      if (embeddedSub !== mine || seq !== subtitleSeq) { return; }
      var data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { return; }
      if (!data || !data.text) { return; }
      var shift = Number(data.base) || 0;
      var cues = parseSRT(data.text).map(function (c) { return { start: c.start + shift, end: c.end + shift, text: c.text }; });
      if (cues.length !== activeSubtitleCues.length) { activeSubtitleCues = cues; syncNativeSubtitleTrack(); }
    };
    try { xhr.send(null); } catch (e) { /* ignore */ }
  }
  var set = new XMLHttpRequest();
  set.open('GET', base + '?setsub=' + n, true);
  set.onload = function () {
    if (embeddedSub !== mine) { return; }
    var cur = Math.floor(relayStartOffset + (playerVideo.currentTime || 0));
    playUrl(base + '?start=' + cur + '&a=' + (vodCurrentAudioTrack || 0), { remainPaused: playerVideo.paused });
    mine.timer = setInterval(read, 2000);
  };
  try { set.send(null); } catch (e) { /* ignore */ }
}

/* "Importar subtítulos": a .srt / .vtt file of the viewer, read here. */
function importSubtitleFile(done) {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.srt,.vtt,.sub,.txt';
  input.onchange = function () {
    var f = input.files && input.files[0];
    if (!f) { return; }
    function use(text) {
      var cues = parseSRT(text);
      if (!cues.length) { return done('El archivo no tiene subtítulos que se puedan leer (usa .srt o .vtt).'); }
      done(null, { lang: 'imp', url: 'imported:' + Date.now(), format: 'srt', label: f.name.replace(/\.[^.]+$/, '').slice(0, 40), cues: cues });
    }
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || '');
      /* Most Spanish .srt files are Windows-1252: read again if UTF-8 broke the accents. */
      if (text.indexOf('�') !== -1) {
        var again = new FileReader();
        again.onload = function () { use(String(again.result || '')); };
        again.readAsText(f, 'windows-1252');
        return;
      }
      use(text);
    };
    reader.onerror = function () { done('No se pudo leer el archivo.'); };
    reader.readAsText(f, 'utf-8');
  };
  input.click();
}

/* OpenSubtitles answers dozens of files (six Dutch, four Spanish…). The
   dialog shows one button per language, so keep the first file of each
   language: Spanish, English and Portuguese first, then the rest, at most
   STREMIO_SUBTITLE_MAX (the local service keeps that many links alive). */
var STREMIO_SUBTITLE_MAX = 16;
function pickStremioSubtitles(all) {
  var seen = {}, first = [], rest = [];
  for (var i = 0; i < all.length; i++) {
    var label = formatAudioLang(all[i].lang);
    if (seen[label]) { continue; }
    seen[label] = true;
    (/^(Español|Inglés|Portugués)/.test(label) ? first : rest).push(all[i]);
  }
  first.sort(function (a, b) {
    var order = ['Español', 'Inglés', 'Portugués'];
    return order.indexOf(formatAudioLang(a.lang).split(' ')[0]) - order.indexOf(formatAudioLang(b.lang).split(' ')[0]);
  });
  return first.concat(rest).slice(0, STREMIO_SUBTITLE_MAX);
}

/* Subtitles from the addons that offer them (for example OpenSubtitles),
   through the local service like the catalog's own subtitles. */
/* file: { url, headers, name } of the video playing. Like Stremio, the
   addon is told the file's OpenSubtitles hash, size and name: it then
   answers the subtitles made for this release first (same cut and frame
   rate), the ones that stay in sync. */
function loadStremioSubtitles(item, episode, file) {
  var cfg = getVodSourcesConfig();
  var type = item._stremioType || (isSeriesItem(item) ? 'series' : 'movie');
  var rawId = isSeriesItem(item) ? (episode && episode.id) : item._stremioId;
  var addons = cfg.addons.filter(function (ad) { return addonSupports(ad, 'subtitles', type, rawId); });
  if (!addons.length || !rawId) { return; }
  if (file && file.url && !file._hashed) {
    var asked = false;
    var go = function (extra) { if (!asked) { asked = true; loadStremioSubtitles(item, episode, { _hashed: true, extra: extra }); } };
    setTimeout(function () { go(''); }, 9000);   /* no hash in time: ask without it */
    portalServiceCall('videoHash', { url: file.url, headers: file.headers || {} }, function (err, info) {
      var name = String(file.name || '').split(/[\/\\]/).pop();
      var extra = [];
      if (!err && info && /^[0-9a-f]{16}$/.test(info.hash || '')) { extra.push('videoHash=' + info.hash, 'videoSize=' + info.size); }
      if (name) { extra.push('filename=' + encodeURIComponent(name)); }
      go(extra.join('&'));
    }, 9000);
    return;
  }
  var extraPath = file && file.extra ? '/' + file.extra : '';
  var all = [], left = addons.length;
  addons.forEach(function (ad) {
    addonRequest(ad.baseUrl + '/subtitles/' + encodeURIComponent(type) + '/' + stremioStreamId(item, episode) + extraPath + '.json', function (err, payload) {
      var subs = (!err && payload && payload.subtitles) ? payload.subtitles : [];
      for (var i = 0; i < subs.length; i++) {
        if (subs[i] && /^https?:\/\//i.test(subs[i].url || '')) { all.push({ lang: subs[i].lang || '', url: subs[i].url }); }
      }
      if (--left > 0) { return; }
      var found = pickStremioSubtitles(all);
      if (!found.length) { return; }
      portalServiceCall('proxySubtitles', { subtitles: found }, function (pErr, answer) {
        /* Subtitles belong to the title, not to one stream attempt: the
           player restarts the source (resume, audio, quality) and bumps
           resolveSeq, so check that the same title/episode is still on. */
        if (state.playerItem !== item || (episode && state.playerEpisode !== episode)) { return; }
        if (pErr || !answer || !answer.subtitles) { return; }
        var info = stremioMediaInfo(item);
        info._addonSubs = answer.subtitles;
        composeStremioSubtitles(item, info);
      });
    }, 15000);
  });
}
