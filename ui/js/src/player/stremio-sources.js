/* player/stremio-sources.js — Modo manual (Stremio, solo PC): elegir la fuente
   de una película o capítulo (enlace directo o torrent) y reproducirla.
   Parte del módulo único de la app (ver ui/js/src/README.md).

   Flujo: Reproducir → (fuente guardada de ese título, o panel "Elegir
   fuente") → servicio resolveExternal (y torrentStart para torrents) → el
   mismo reproductor y modo compatible que el catálogo integrado. */

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
    filename: src.filename || '', label: src.label || '', quality: src.quality || '', at: Date.now()
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
    /* Spanish audio or subtitles, as the addons write it (flags or words). */
    spanish: /🇪🇸|🇲🇽|🇦🇷|🇨🇴|\b(latino|lat|castellano|spanish|español|espanol|esp|spa)\b/i.test(text),
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
function fetchStremioStreams(item, episode, onUpdate) {
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
        /* A torrent nobody is sharing (0 peers) would never start: left out. */
        if (src.kind === 'torrent' && src.seeds === 0) { g.dead++; }
        else if (stremioSourcePlayable(src)) { g.sources.push(src); } else { g.hidden++; }
      }
      g.state = err ? 'error' : 'done';
      g.error = err || '';
      onUpdate(groups, --pending);
    }, 25000);
  });
}

/* Next episode with no source chosen: same addon and quality as before. */
function autoPickStremioSource(item, episode, previous, done) {
  var finished = false;
  fetchStremioStreams(item, episode, function (groups, pending) {
    if (finished || pending > 0) { return; }
    finished = true;
    var all = [];
    groups.forEach(function (g) { all = all.concat(g.sources); });
    var best = null;
    if (previous) {
      for (var i = 0; i < all.length && !best; i++) {
        if (all[i].addon === previous.addon && all[i].quality === previous.quality && all[i].kind === previous.kind) { best = all[i]; }
      }
      for (var j = 0; j < all.length && !best; j++) { if (all[j].addon === previous.addon) { best = all[j]; } }
    }
    done(best || all[0] || null);
  });
}

/* ------------------------------------------------ "Elegir fuente" panel */
var sourcePickerOpen = false;
var sourcePickerNode = null;
var sourcePickerReturn = null;
var sourcePickerSeq = 0;

function closeSourcePicker() {
  sourcePickerOpen = false;
  sourcePickerSeq++;
  if (sourcePickerNode && sourcePickerNode.parentNode) { sourcePickerNode.parentNode.removeChild(sourcePickerNode); }
  sourcePickerNode = null;
  if (sourcePickerReturn && isVisible(sourcePickerReturn)) { setFocus(sourcePickerReturn); }
  sourcePickerReturn = null;
}

/* "Elegir fuente" filters, kept for the next title. */
var SOURCE_FILTERS_KEY = 'opentv_source_filters_v1';
function loadSourceFilters() {
  var f = { quality: 'all', kind: 'all', spanish: false, sort: 'rec' };
  try {
    var saved = JSON.parse(localStorage.getItem(SOURCE_FILTERS_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      if (/^(all|4K|1080p|720p|SD)$/.test(saved.quality)) { f.quality = saved.quality; }
      if (/^(all|direct|torrent)$/.test(saved.kind)) { f.kind = saved.kind; }
      if (/^(rec|big|small|seeds)$/.test(saved.sort)) { f.sort = saved.sort; }
      f.spanish = saved.spanish === true;
    }
  } catch (e) { /* defaults */ }
  return f;
}
function saveSourceFilters(f) {
  try { localStorage.setItem(SOURCE_FILTERS_KEY, JSON.stringify(f)); } catch (e) { /* ignore */ }
}

function torrentNoticeSeen() {
  try { return localStorage.getItem(TORRENT_NOTICE_KEY) === '1'; } catch (e) { return false; }
}

function openSourcePicker(item, episode, onPick) {
  if (sourcePickerOpen) { closeSourcePicker(); }
  sourcePickerOpen = true;
  sourcePickerReturn = state.focus;
  var seq = ++sourcePickerSeq;
  var root = el('div', 'source-picker');
  root.id = 'dialog-sources';
  var panel = el('div', 'srcp-panel');
  var head = el('div', 'srcp-head');
  head.appendChild(el('div', 'srcp-title', 'Elegir fuente'));
  var what = item.title || '';
  if (episode) { what += ' · ' + (episode.number ? 'Capítulo ' + episode.number : (episode.title || '')); }
  head.appendChild(el('div', 'srcp-sub', what));
  panel.appendChild(head);
  /* Filters: quality, type, Spanish, and the order (kept for next time). */
  var filters = loadSourceFilters();
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
  ($('app') || document.body).appendChild(root);
  sourcePickerNode = root;
  setFocus(cancel);

  function choose(src) {
    if (src.kind === 'torrent' && !torrentNoticeSeen()) { return showTorrentNotice(src); }
    closeSourcePicker();
    onPick(src);
  }

  /* First torrent: a short, calm note (once). */
  function showTorrentNotice(src) {
    clear(body);
    bar.hidden = true;
    var box = el('div', 'srcp-notice');
    box.appendChild(el('b', null, 'Reproducir con torrent'));
    box.appendChild(el('p', null, 'El vídeo llega de otras personas que lo comparten, y mientras lo ves tu equipo también comparte lo que ya bajó. Al terminar, se borra.'));
    box.appendChild(el('p', 'srcp-notice-small', 'Usa solo contenido que tengas derecho a ver.'));
    var row = el('div', 'srcp-notice-actions');
    var ok = el('div', 'acc-seg-btn focusable is-selected', 'Reproducir');
    ok._activate = function () {
      try { localStorage.setItem(TORRENT_NOTICE_KEY, '1'); } catch (e) { /* ignore */ }
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
        filters[group] = (group === 'spanish') ? !filters.spanish : value;
        saveSourceFilters(filters);
        render(lastGroups, lastPending);
        body.scrollTop = 0;   /* the new list starts at its top */
      };
      return c;
    }
    var qRow = el('div', 'srcp-chips');
    qRow.appendChild(chip('quality', 'all', 'Todas'));
    [['4K', '4K'], ['1080p', 'Full HD'], ['720p', 'HD'], ['SD', 'SD']].forEach(function (q) {
      qRow.appendChild(chip('quality', q[0], q[1], count(function (s) { return s.quality === q[0]; })));
    });
    qRow.appendChild(el('span', 'srcp-chips-gap'));
    [['all', 'Todo'], ['direct', 'Directo'], ['torrent', 'Torrent']].forEach(function (k) {
      qRow.appendChild(chip('kind', k[0], k[1], count(function (s) { return s.kind === k[0]; })));
    });
    var es = chip('spanish', true, 'En español', count(function (s) { return s.spanish; }));
    es.classList.toggle('is-on', !!filters.spanish);
    qRow.appendChild(el('span', 'srcp-chips-gap'));
    qRow.appendChild(es);
    bar.appendChild(qRow);
    var sRow = el('div', 'srcp-chips');
    sRow.appendChild(el('span', 'srcp-chips-label', 'Ordenar'));
    [['rec', 'Recomendado'], ['big', 'Más pesadas'], ['small', 'Más ligeras'], ['seeds', 'Más fuentes']].forEach(function (o) {
      sRow.appendChild(chip('sort', o[0], o[1]));
    });
    bar.appendChild(sRow);
    if (keepChip) {
      var again = bar.querySelector('.srcp-chip.focusable');
      var chips = bar.querySelectorAll('.srcp-chip');
      for (var i = 0; i < chips.length; i++) { if (chips[i]._chipKey === keepChip) { again = chips[i]; } }
      if (again) { setFocus(again); }
    }
  }

  function passes(src) {
    if (filters.quality !== 'all' && src.quality !== filters.quality) { return false; }
    if (filters.kind !== 'all' && src.kind !== filters.kind) { return false; }
    if (filters.spanish && !src.spanish) { return false; }
    return true;
  }

  function ordered(list) {
    var out = list.slice();
    if (filters.sort === 'big') { out.sort(function (a, b) { return (b.sizeBytes || 0) - (a.sizeBytes || 0) || a._i - b._i; }); }
    else if (filters.sort === 'small') { out.sort(function (a, b) { return (a.sizeBytes || Infinity) - (b.sizeBytes || Infinity) || a._i - b._i; }); }
    else if (filters.sort === 'seeds') { out.sort(function (a, b) { return (b.seeds || 0) - (a.seeds || 0) || a._i - b._i; }); }
    return out;
  }

  var lastGroups = [], lastPending = 0;
  function render(groups, pending) {
    lastGroups = groups;
    lastPending = pending;
    var keepFocus = state.focus && state.focus._srcKey;
    var all = [];
    groups.forEach(function (g) { g.sources.forEach(function (s, i) { s._i = i; all.push(s); }); });
    renderFilters(all);
    clear(body);
    if (!groups.length) {
      body.appendChild(el('div', 'srcp-empty', 'Ninguno de tus addons da fuentes de reproducción. Agrega en Ajustes → Fuentes un addon que ofrezca "Fuentes".'));
    }
    var total = 0, shown = 0, first = null, again = null;
    groups.forEach(function (g) {
      var sec = el('div', 'srcp-group');
      var gh = el('div', 'srcp-group-head');
      gh.appendChild(el('span', 'srcp-group-name', g.name));
      var visible = ordered(g.sources.filter(passes));
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
        var i = src._i;
        var row = el('div', 'srcp-item focusable');
        row._srcKey = g.name + '#' + i;
        var q = el('span', 'srcp-q' + (src.quality ? '' : ' is-empty'), src.quality || '—');
        var txt = el('div', 'srcp-text');
        txt.appendChild(el('div', 'srcp-label', src.label));
        var meta = [src.kind === 'torrent' ? 'Torrent' : 'Directo'];
        if (src.size) { meta.push(src.size); }
        if (src.seeds !== null) { meta.push(src.seeds + (src.seeds === 1 ? ' fuente' : ' fuentes')); }
        if (src.detail) { meta.push(src.detail); }
        txt.appendChild(el('div', 'srcp-meta', meta.join(' · ')));
        row.appendChild(q);
        row.appendChild(txt);
        row.classList.toggle('is-torrent', src.kind === 'torrent');
        row._activate = function () { choose(src); };
        sec.appendChild(row);
        if (!first) { first = row; }
        if (keepFocus && keepFocus === row._srcKey) { again = row; }
      });
      if (g.dead) { sec.appendChild(el('div', 'srcp-hidden', g.dead + (g.dead === 1 ? ' torrent oculto: nadie lo está compartiendo ahora.' : ' torrents ocultos: nadie los está compartiendo ahora.'))); }
      if (g.hidden) { sec.appendChild(el('div', 'srcp-hidden', g.hidden + ' no se pueden reproducir en OpenTV (YouTube o enlaces externos).')); }
      body.appendChild(sec);
    });
    note.textContent = pending > 0 ? 'Buscando en ' + pending + (pending === 1 ? ' addon…' : ' addons…')
      : (shown === total ? total + (total === 1 ? ' fuente' : ' fuentes') : shown + ' de ' + total + ' fuentes');
    /* Focus the first source as soon as one shows up, but never take the
       focus away from where the viewer already is (a filter chip, too). */
    if (state.focus && state.focus._chipKey && isVisible(state.focus)) { return; }
    if (again) { setFocus(again); }
    else if (first && (!state.focus || state.focus === cancel || !isVisible(state.focus))) { setFocus(first); }
  }

  fetchStremioStreams(item, episode, function (groups, pending) {
    if (seq !== sourcePickerSeq || !sourcePickerOpen) { return; }
    if (body.querySelector('.srcp-notice')) { lastGroups = groups; lastPending = pending; return; }
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
  var saved = savedStremioPick(item, episode);
  if (saved) { target._stremioSource = saved; return false; }
  openSourcePicker(item, episode, function (src) {
    target._stremioSource = src;
    rememberStremioPick(item, episode, src);
    expandToFullscreen(item, episode);
  });
  return true;
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
  var src = target._stremioSource || savedStremioPick(item, ep);
  if (src) { return go(src); }
  var previous = null;
  if (item.episodes) {
    for (var i = 0; i < item.episodes.length && !previous; i++) {
      if (item.episodes[i] !== ep && item.episodes[i]._stremioSource) { previous = item.episodes[i]._stremioSource; }
    }
  }
  /* Nothing chosen and no earlier episode to copy: the viewer picks (a
     source is never chosen for them, it could be a torrent). */
  if (!previous) {
    setPlayerStatus('Elige una fuente para reproducir');
    openSourcePicker(item, ep, function (picked) {
      target._stremioSource = picked;
      rememberStremioPick(item, ep, picked);
      if (mySeq === resolveSeq) { go(picked); }
    });
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
      if (!platformHas('torrents')) { vodFailure('la fuente', 'Los torrents solo funcionan en la app de PC'); return done(''); }
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
      var info = { audio: '', subtitles: item.subtitles || [], tracks: [], selected: {}, duration: 0 };
      mediaInfoCache[mediaInfoKey(item)] = info;
      done(payload.proxyPath || payload.url);
      requestVideoDuration(item, ep, payload);
      loadStremioSubtitles(item, ep);
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
function loadStremioSubtitles(item, episode) {
  var cfg = getVodSourcesConfig();
  var type = item._stremioType || (isSeriesItem(item) ? 'series' : 'movie');
  var rawId = isSeriesItem(item) ? (episode && episode.id) : item._stremioId;
  var addons = cfg.addons.filter(function (ad) { return addonSupports(ad, 'subtitles', type, rawId); });
  if (!addons.length || !rawId) { return; }
  var all = [], left = addons.length;
  addons.forEach(function (ad) {
    addonRequest(ad.baseUrl + '/subtitles/' + encodeURIComponent(type) + '/' + stremioStreamId(item, episode) + '.json', function (err, payload) {
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
        item.subtitles = answer.subtitles;
        var info = mediaInfoCache[mediaInfoKey(item)] || { audio: '', tracks: [] };
        info.subtitles = item.subtitles;
        mediaInfoCache[mediaInfoKey(item)] = info;
        applySubtitleDefaults(info);
      });
    }, 15000);
  });
}

/* Ajustes → Fuentes, choosing "Stremio": what this mode depends on, before
   switching. Uses the same window as "Elegir fuente" (one at a time). */
function openStremioModeNotice(addons, onAccept) {
  if (sourcePickerOpen) { closeSourcePicker(); }
  sourcePickerOpen = true;
  sourcePickerReturn = state.focus;
  sourcePickerSeq++;
  var root = el('div', 'source-picker');
  root.id = 'dialog-sources';
  var panel = el('div', 'srcp-panel is-notice');
  var head = el('div', 'srcp-head');
  head.appendChild(el('div', 'srcp-title', 'Modo Addons'));
  head.appendChild(el('div', 'srcp-sub', 'Películas y series de addons de terceros, no de OpenTV.'));
  panel.appendChild(head);
  var body = el('div', 'srcp-body');
  var box = el('div', 'srcp-notice');
  box.appendChild(el('p', null, 'Este modo depende de:'));
  var list = el('ul', 'srcp-deps');
  var hasStream = false;
  (addons || []).forEach(function (ad) {
    var offers = typeof addonOffers === 'function' ? addonOffers(ad) : '';
    if (addonSupports(ad, 'stream')) { hasStream = true; }
    var li = el('li');
    li.appendChild(el('b', null, ad.name || 'Addon'));
    if (offers) { li.appendChild(document.createTextNode(' — ' + offers)); }
    list.appendChild(li);
  });
  box.appendChild(list);
  box.appendChild(el('p', null, (hasStream ? '' : 'Para reproducir necesitas además un addon con Fuentes (por ejemplo, Torrentio). ') +
    'Si un addon deja de funcionar, el contenido que da también. Puedes volver al modo Automático cuando quieras.'));
  body.appendChild(box);
  panel.appendChild(body);
  var foot = el('div', 'srcp-foot');
  var cancel = el('div', 'acc-seg-btn focusable', 'Cancelar');
  cancel._activate = closeSourcePicker;
  var ok = el('div', 'acc-seg-btn focusable is-selected', 'Activar modo Addons');
  ok._activate = function () { closeSourcePicker(); onAccept(); };
  foot.appendChild(cancel);
  foot.appendChild(ok);
  panel.appendChild(foot);
  root.appendChild(panel);
  root.addEventListener('click', function (ev) { if (ev.target === root) { closeSourcePicker(); } });
  ($('app') || document.body).appendChild(root);
  sourcePickerNode = root;   /* so closeSourcePicker() removes it */
  setFocus(ok);
}
