/* player/downloads.js — Descargas (Modo Addons, solo PC por ahora): guardar
   una película o un capítulo para verlo sin internet. El servicio descarga en
   segundo plano (service/downloads.js); aquí se pide, se avisa y se muestra
   el panel Ajustes → Descargas (en curso y completadas).
   Parte del módulo único de la app (ver ui/js/src/README.md). */

var downloadsList = [];
var downloadsDir = '';
var downloadsLoaded = false;
var downloadsFree = 0;

/* Asks the service for the list (also at start, so "Reproducir" finds the
   downloaded files without waiting). */
function refreshDownloads(done) {
  if (!platformHas('downloads')) { if (done) { done([]); } return; }
  portalServiceCall('downloadList', {}, function (err, answer) {
    if (!err && answer && answer.items) {
      downloadsList = answer.items;
      downloadsDir = answer.dir || downloadsDir;
      /* Android: free space where the downloads go (the PC service omits it). */
      downloadsFree = answer.free > 0 ? answer.free : 0;
      downloadsLoaded = true;
    }
    updateDownloadsIndicator();
    if (done) { done(downloadsList); }
  });
}

function downloadRunning(d) { return d.status === 'downloading' || d.status === 'queued'; }

/* Title bar: how far the running downloads are, in one number. While any
   runs, the list is read every 2 s; then the watch stops. */
var downloadsWatchTimer = null;
var DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 19h14"/></svg>';
function updateDownloadsIndicator() {
  var running = downloadsList.filter(downloadRunning);
  if (running.length) { watchDownloads(); }
  var btn = $('atb-downloads');
  if (!btn) { return; }
  if (!running.length) { btn.hidden = true; return; }
  var bytes = 0, total = 0, speed = 0;
  running.forEach(function (d) { bytes += d.bytes || 0; total += d.total || 0; speed += d.speed || 0; });
  var pct = total > 0 ? Math.min(99, Math.floor(bytes * 100 / total)) : 0;
  btn.hidden = false;
  btn.innerHTML = DOWNLOAD_ICON + '<span>' + pct + ' %</span>';
  var tip = running.length + (running.length === 1 ? ' descarga' : ' descargas') + (speed ? ' · ' + formatSpeed(speed) : '') + ' · Ver descargas';
  btn.setAttribute('data-tip', tip);
  btn.setAttribute('aria-label', tip);
}

function watchDownloads() {
  if (downloadsWatchTimer) { return; }
  downloadsWatchTimer = setInterval(function () {
    refreshDownloads(function (list) {
      if (!list.some(downloadRunning)) { clearInterval(downloadsWatchTimer); downloadsWatchTimer = null; }
    });
  }, 2000);
}

/* The finished download of this movie or episode, or null. */
function downloadedFileFor(item, episode) {
  if (!platformHas('downloads') || !item || !item._stremio) { return null; }
  if (!downloadsLoaded) { refreshDownloads(); return null; }
  var id = stremioTargetId(item, isSeriesItem(item) ? (episode || state.playerEpisode || state.detailEpisode) : null);
  if (!id) { return null; }
  for (var i = 0; i < downloadsList.length; i++) {
    if (downloadsList[i].targetId === id && downloadsList[i].status === 'done') { return downloadsList[i]; }
  }
  return null;
}

function downloadFor(item, episode) {
  var id = stremioTargetId(item, episode);
  for (var i = 0; i < downloadsList.length; i++) { if (downloadsList[i].targetId === id) { return downloadsList[i]; } }
  return null;
}

/* Detail page "Descargar": choose the source (the recommended one first),
   the service starts it in the background and a short notice says so. */
function startTitleDownload(item, episode) {
  if (isSeriesItem(item) && !episode) { episode = state.detailEpisode || (item.episodes && item.episodes[0]) || null; }
  if (isSeriesItem(item) && !episode) { return; }
  var existing = downloadFor(item, episode);
  if (existing && existing.status !== 'error' && existing.status !== 'missing') { return openSettingsAt('downloads'); }
  openSourcePicker(item, episode, function (src) {
    var target = episode || item;
    portalServiceCall('downloadStart', {
      title: item.title || '',
      subtitle: episode ? ((episode.season ? 'T' + episode.season + ' ' : '') + (episode.number ? 'Capítulo ' + episode.number : (episode.title || ''))) : '',
      targetId: stremioTargetId(item, episode),
      itemId: String(item.id || ''),
      poster: item.poster || item.cover || '',
      url: src.url || '', headers: src.headers || null,
      infoHash: src.infoHash || '', fileIdx: src.fileIdx, sources: src.sources || null,
      filename: src.filename || '',
      duration: durationToSeconds(target.duration || item.duration)
    }, function (err, answer) {
      var failed = err || !answer || answer.returnValue === false;
      refreshDownloads();
      showDownloadNotice(failed ? ('No se pudo descargar: ' + (err || (answer && answer.errorText) || 'error desconocido')) : '');
    });
  }, { download: true });
}

/* "Se está descargando": continue using the app, or go see it. */
function showDownloadNotice(error) {
  if (sourcePickerOpen) { closeSourcePicker(); }
  sourcePickerOpen = true;
  sourcePickerReturn = state.focus;
  sourcePickerSeq++;
  var root = el('div', 'source-picker');
  root.id = 'dialog-download-started';
  var panel = el('div', 'srcp-panel is-notice');
  var head = el('div', 'srcp-head');
  head.appendChild(el('div', 'srcp-title', error ? 'No se pudo descargar' : 'Se está descargando'));
  panel.appendChild(head);
  var body = el('div', 'srcp-body');
  var box = el('div', 'srcp-notice');
  box.appendChild(el('p', null, error ||
    'Puedes seguir usando la app mientras se descarga. Si cierras OpenTV, la descarga se detiene y sigue cuando lo vuelvas a abrir.'));
  body.appendChild(box);
  panel.appendChild(body);
  var foot = el('div', 'srcp-foot');
  var ok = el('div', 'acc-seg-btn focusable', 'Entendido');
  ok._activate = closeSourcePicker;
  var go = el('div', 'acc-seg-btn focusable is-selected', 'Ver mis descargas');
  go._activate = function () { closeSourcePicker(); openSettingsAt('downloads'); };
  foot.appendChild(ok);
  foot.appendChild(go);
  panel.appendChild(foot);
  root.appendChild(panel);
  root.addEventListener('click', function (ev) { if (ev.target === root) { closeSourcePicker(); } });
  mountOverlay(root);
  sourcePickerNode = root;
  setFocus(go);
}

function formatBytes(n) {
  if (!(n > 0)) { return '0 MB'; }
  if (n >= 1073741824) { return (n / 1073741824).toFixed(2).replace('.', ',') + ' GB'; }
  /* Small files: "450 KB" / "3,2 MB", never "0 MB". */
  if (n < 1048576) { return Math.max(1, Math.round(n / 1024)) + ' KB'; }
  if (n < 10485760) { return (n / 1048576).toFixed(1).replace('.', ',') + ' MB'; }
  return Math.round(n / 1048576) + ' MB';
}

/* Plays a finished download as its own title (the file goes through the
   same relay as any addon source: MKV, other audio…). */
function watchDownload(d) {
  expandToFullscreen({ id: 'download:' + d.id, title: d.title + (d.subtitle ? ' · ' + d.subtitle : ''),
    _stremio: true, _downloadId: d.id, kind: 'pelicula', type: 'movie', poster: d.poster || '', cover: d.poster || '' }, null);
}

/* ------------------------------------------------ Ajustes → Descargas */
/* Same look as Mi lista: two tabs (En curso / Completadas) and a grid of
   posters with the progress bar on them. While it is shown it refreshes
   every 1.5 s, touching only what changed (no flicker, hover kept). */
var downloadsTab = 'running';
var downloadsPanel = null;
var downloadsCards = {};      /* id -> { card, fill, sub, status } */
var downloadsPanelTimer = null;
var DL_PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/></svg>';
var DL_PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg>';

function downloadIsRunning(d) { return d.status !== 'done' && d.status !== 'missing'; }

function downloadPct(d) { return d.total > 0 ? Math.min(100, Math.floor(d.bytes * 100 / d.total)) : 0; }

function downloadSubText(d) {
  if (d.status === 'downloading') { return downloadPct(d) + ' %' + (d.speed ? ' · ' + formatSpeed(d.speed) : ''); }
  if (d.status === 'queued') { return 'En espera'; }
  if (d.status === 'paused') { return 'En pausa · ' + downloadPct(d) + ' %'; }
  if (d.status === 'error') { return 'Error · toca para reintentar'; }
  if (d.status === 'missing') { return 'El archivo ya no está'; }
  return formatBytes(d.total || d.bytes);
}

function buildDownloadsPanel() {
  downloadsPanel = el('div', 'settings-panel history-panel is-library downloads-panel');
  paintDownloadsPanel(true);
  return downloadsPanel;
}

/* While the panel is shown: refresh every 1.5 s (progress and speed). */
function setDownloadsPanelLive(on) {
  if (downloadsPanelTimer) { clearInterval(downloadsPanelTimer); downloadsPanelTimer = null; }
  if (!on) { return; }
  refreshDownloads(function () {
    /* Nothing downloading but some ready: open on Completadas. */
    var running = downloadsList.some(downloadIsRunning);
    var ready = downloadsList.some(function (d) { return !downloadIsRunning(d); });
    if (!running && ready && downloadsTab !== 'done') { downloadsTab = 'done'; return paintDownloadsPanel(true); }
    paintDownloadsPanel(false);
  });
  downloadsPanelTimer = setInterval(function () {
    if (state.screen !== 'settings') { clearInterval(downloadsPanelTimer); downloadsPanelTimer = null; return; }
    refreshDownloads(function () { paintDownloadsPanel(false); });
  }, 1500);
}

function downloadAct(d, what) {
  portalServiceCall('downloadAction', { id: d.id, action: what }, function () {
    refreshDownloads(function () { paintDownloadsPanel(true); });
  });
}

/* full: rebuild everything; otherwise only bars and texts are updated while
   the same downloads are on screen in the same states. */
function paintDownloadsPanel(full) {
  var p = downloadsPanel;
  if (!p) { return; }
  var list = downloadsList.filter(function (d) { return downloadsTab === 'running' ? downloadIsRunning(d) : !downloadIsRunning(d); });
  var speed = 0;
  downloadsList.forEach(function (d) { if (d.status === 'downloading') { speed += d.speed || 0; } });
  if (speed) { noteNetSpeed(speed); }
  var same = !full && list.length === Object.keys(downloadsCards).length && list.every(function (d) {
    return downloadsCards[d.id] && downloadsCards[d.id].status === d.status;
  });
  if (same) {
    list.forEach(function (d) {
      var c = downloadsCards[d.id];
      c.sub.textContent = downloadSubText(d);
      if (c.fill) { c.fill.style.width = Math.max(2, downloadPct(d)) + '%'; }
    });
    return;
  }
  var keep = state.focus && state.focus._dlKey;
  var again = null;
  clear(p);
  downloadsCards = {};
  var tabs = el('div', 'history-tabs');
  [['running', 'En curso'], ['done', 'Completadas']].forEach(function (t) {
    var tab = el('div', 'history-tab focusable' + (downloadsTab === t[0] ? ' is-selected' : ''), t[1]);
    tab._dlKey = 'tab:' + t[0];
    tab._activate = function () { downloadsTab = t[0]; paintDownloadsPanel(true); };
    if (keep === tab._dlKey) { again = tab; }
    tabs.appendChild(tab);
  });
  p.appendChild(tabs);
  p.appendChild(el('div', 'history-rule'));
  var total = el('div', 'history-total', downloadsTab === 'running' ? 'Descargando · ' : 'Para ver sin internet · ');
  total.appendChild(el('span', null, String(list.length)));
  if (downloadsFree) { total.appendChild(document.createTextNode(' · ' + formatBytes(downloadsFree) + ' libres')); }
  if (window.desktop && window.desktop.openDownloads) {
    var folder = el('div', 'history-clear focusable', 'Abrir carpeta');
    folder._dlKey = 'folder';
    folder._activate = function () { window.desktop.openDownloads(); };
    total.appendChild(folder);
  }
  p.appendChild(total);
  var grid = el('div', 'history-grid library-grid scrollable');
  if (!list.length) {
    grid.appendChild(el('div', 'history-grid-empty', downloadsTab === 'running'
      ? 'Nada descargándose. En la ficha de una película o capítulo, toca el botón de descarga.'
      : 'Aún no hay descargas completas.'));
  }
  list.forEach(function (d) {
    var running = d.status === 'downloading' || d.status === 'queued';
    var card = el('div', 'history-card library-card focusable' + (d.status === 'paused' ? ' is-paused' : ''));
    card._dlKey = 'card:' + d.id;
    var art = el('div', 'library-art');
    var img = document.createElement('img');
    img.className = 'history-poster';
    img.alt = '';
    img.loading = 'lazy';
    img.src = d.poster || 'assets/original/common/bg_placehoder_vertical.png';
    img.onerror = function () { this.style.visibility = 'hidden'; };
    art.appendChild(img);
    var fill = null;
    if (downloadIsRunning(d)) {
      var bar = el('div', 'history-bar library-bar');
      fill = el('i');
      fill.style.width = Math.max(2, downloadPct(d)) + '%';
      bar.appendChild(fill);
      art.appendChild(bar);
    }
    /* The big icon: play a finished one, pause / resume a running one. */
    var ico = el('i', 'history-play');
    ico.innerHTML = running ? DL_PAUSE_SVG : DL_PLAY_SVG;
    art.appendChild(ico);
    if (platformHas('mouse')) {
      var remove = el('button', 'library-remove desktop-native-control');
      remove.type = 'button';
      remove.title = d.status === 'done' ? 'Borrar descarga' : 'Cancelar descarga';
      remove.innerHTML = REMOVE_SVG;
      remove.addEventListener('click', function (event) { event.stopPropagation(); downloadAct(d, 'delete'); });
      art.appendChild(remove);
    }
    card.appendChild(art);
    card.appendChild(el('div', 'history-card-title', d.title + (d.subtitle ? ' · ' + d.subtitle : '')));
    var sub = el('div', 'history-sub', downloadSubText(d));
    card.appendChild(sub);
    card.title = d.status === 'done' ? 'Ver ' + d.title : (running ? 'Pausar' : 'Reanudar');
    card._activate = function () {
      if (d.status === 'done') { return watchDownload(d); }
      if (d.status === 'missing') { return downloadAct(d, 'remove'); }
      downloadAct(d, running ? 'pause' : 'resume');
    };
    if (keep === card._dlKey) { again = card; }
    downloadsCards[d.id] = { card: card, fill: fill, sub: sub, status: d.status };
    grid.appendChild(card);
  });
  p.appendChild(grid);
  if (again) { setFocus(again); }
}
