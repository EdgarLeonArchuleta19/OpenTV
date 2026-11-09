/* player/quality.js — Calidad de imagen del stream HLS: fila del menú VOD y botón de calidad en la TV.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* Many portal streams carry several resolutions inside one HLS playlist.
   desktop/player.js exposes them as window.__opentvHls; here they become
   choices: "Automática" (adapts to the connection) or a fixed height. The
   choice is remembered for later videos and channels. */
function hlsQualityApi() {
  return window.XUPER_DESKTOP && window.__opentvHls ? window.__opentvHls : null;
}

function hlsQualityLabel(height) {
  if (height >= 2000) { return '4K'; }
  return height + 'p';
}

/* Fills the VOD "Calidad" row from the stream levels. Returns false when the
   stream has a single resolution (the row stays hidden). */
function renderHlsQualityRow(row) {
  var api = hlsQualityApi();
  var levels = api ? api.levels() : [];
  if (levels.length < 2) { return false; }
  var cur = api.current() || { auto: true, height: 0 };
  var options = [{ h: 0, label: 'Automática' + (cur.auto && cur.height ? ' · ' + hlsQualityLabel(cur.height) : '') }];
  levels.forEach(function (l) { options.push({ h: l.height, label: hlsQualityLabel(l.height) }); });
  var selected = cur.auto ? 0 : cur.height;
  options.forEach(function (opt) {
    var b = el('button', 'psv-btn focusable' + (opt.h === selected ? ' is-selected' : ''));
    b.appendChild(el('span', 'psv-check', '✔'));
    b.appendChild(document.createTextNode(opt.label));
    b._activate = function () {
      api.choose(opt.h);
      renderPlaySettingQuality();
      schedulePlaySettingHide();
    };
    row.appendChild(b);
  });
  return true;
}

/* Live TV: the quality button cycles Automática → highest → … → lowest. */
function cycleHlsQuality(btn) {
  var api = hlsQualityApi();
  var levels = api ? api.levels() : [];
  if (levels.length < 2) { return; }
  var cur = api.current() || { auto: true };
  var order = [0].concat(levels.map(function (l) { return l.height; }));
  var at = cur.auto ? 0 : order.indexOf(cur.height);
  var next = order[(at + 1) % order.length];
  api.choose(next);
  setPlayerStatus('Calidad: ' + (next ? hlsQualityLabel(next) : 'Automática'));
  setTimeout(function () { if (/^Calidad:/.test((playerStatus && playerStatus.textContent) || '')) { setPlayerStatus(''); } }, 1600);
  updateLiveQualityButton();
}

function updateLiveQualityButton() {
  var btn = document.querySelector('.pi-quality-btn');
  if (!btn) { return; }
  var api = hlsQualityApi();
  var levels = api ? api.levels() : [];
  var cur = api ? api.current() : null;
  if (levels.length < 2 || state.playerMode !== 'live') {
    btn.setAttribute('aria-disabled', 'true');
    setButtonText(btn, cur && cur.height ? 'Calidad ' + hlsQualityLabel(cur.height) + ' (única disponible)' : 'Calidad automática');
    return;
  }
  btn.removeAttribute('aria-disabled');
  setButtonText(btn, 'Calidad: ' + (cur && !cur.auto ? hlsQualityLabel(cur.height)
    : 'Automática' + (cur && cur.height ? ' · ' + hlsQualityLabel(cur.height) : '')) + ' — clic para cambiar');
  btn.classList.toggle('is-selected', !!(cur && !cur.auto));
}

/* ---- Quality button + menu in the movie player bar ---- */
/* Options from the portal versions of the title, or from the HLS stream. */
function playerQualityOptions() {
  var out = [];
  if (state.playerMode !== 'vod') { return out; }
  var info = currentTrackInfo();
  var tracks = (info && info.tracks) || [];
  var heights = [];
  for (var i = 0; i < tracks.length; i++) {
    var h = trackLines(tracks[i]);
    if (h && heights.indexOf(h) === -1) { heights.push(h); }
  }
  heights.sort(function (a, b) { return b - a; });
  if (heights.length >= 2) {
    var pref = preferredQualityHeight();
    var playing = trackLines(info.selected);
    var sel = (pref && heights.indexOf(pref) !== -1) ? pref : 0;
    out.push({ label: 'Automática', note: playing && !pref ? hlsQualityLabel(playing) : '', selected: sel === 0, apply: function () {
      if (sel === 0) { return; } safeLocalWrite(QUALITY_PREF_KEY, 0); restartCurrentPlayback(); } });
    heights.forEach(function (hh) {
      out.push({ label: hlsQualityLabel(hh), selected: sel === hh, apply: function () {
        if (sel === hh) { return; } safeLocalWrite(QUALITY_PREF_KEY, hh); restartCurrentPlayback(); } });
    });
    return out;
  }
  var api = hlsQualityApi();
  var levels = api ? api.levels() : [];
  if (levels.length < 2) { return out; }
  var cur = api.current() || { auto: true, height: 0 };
  out.push({ label: 'Automática', note: cur.auto && cur.height ? hlsQualityLabel(cur.height) : '', selected: !!cur.auto,
    apply: function () { api.choose(0); } });
  levels.forEach(function (l) {
    out.push({ label: hlsQualityLabel(l.height), selected: !cur.auto && cur.height === l.height,
      apply: function () { api.choose(l.height); } });
  });
  return out;
}

function updateQualityButton() {
  var btn = $('vod-quality');
  if (!btn) { return; }
  var opts = playerQualityOptions();
  btn.hidden = opts.length < 2;
  var chosen = null;
  for (var i = 0; i < opts.length; i++) { if (opts[i].selected) { chosen = opts[i]; } }
  setButtonText(btn, 'Calidad: ' + (chosen ? chosen.label + (chosen.note ? ' · ' + chosen.note : '') : 'Automática'));
}

var qualityMenu = null;
function closeQualityMenu() {
  if (qualityMenu) { qualityMenu.classList.remove('is-open'); }
}
function toggleQualityMenu(btn) {
  if (qualityMenu && qualityMenu.classList.contains('is-open')) { closeQualityMenu(); return; }
  var opts = playerQualityOptions();
  if (opts.length < 2 || !btn) { return; }
  if (!qualityMenu) {
    qualityMenu = el('div', 'quality-menu');
    document.body.appendChild(qualityMenu);
    document.addEventListener('pointerdown', function (event) {
      if (qualityMenu.classList.contains('is-open') && !qualityMenu.contains(event.target) &&
          !(event.target.closest && event.target.closest('#vod-quality'))) { closeQualityMenu(); }
    }, true);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && qualityMenu.classList.contains('is-open')) { event.stopPropagation(); event.preventDefault(); closeQualityMenu(); }
    }, true);
  }
  clear(qualityMenu);
  qualityMenu.appendChild(el('div', 'qm-title', 'Calidad'));
  opts.forEach(function (o) {
    var item = el('button', 'qm-item' + (o.selected ? ' is-selected' : ''));
    item.type = 'button';
    var check = el('span', 'qm-check');
    check.innerHTML = o.selected ? UI_ICONS.check : '';
    item.appendChild(check);
    item.appendChild(el('span', 'qm-label', o.label));
    if (o.note) { item.appendChild(el('span', 'qm-note', o.note)); }
    item.addEventListener('click', function (event) {
      event.stopPropagation();
      closeQualityMenu();
      o.apply();
      setTimeout(updateQualityButton, 300);
    });
    qualityMenu.appendChild(item);
  });
  var r = btn.getBoundingClientRect();
  qualityMenu.classList.add('is-open');
  var mw = qualityMenu.offsetWidth, mh = qualityMenu.offsetHeight;
  qualityMenu.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - mw - 8, r.left + r.width / 2 - mw / 2))) + 'px';
  qualityMenu.style.top = Math.round(Math.max(8, r.top - mh - 12)) + 'px';
}

function installQualityControls() {
  if (!window.XUPER_DESKTOP) { return; }
  document.addEventListener('xuper:hls-levels', function () {
    updateLiveQualityButton();
    updateQualityButton();
    if (playSettingViewOpen) { renderPlaySettingQuality(); }
  });
}
