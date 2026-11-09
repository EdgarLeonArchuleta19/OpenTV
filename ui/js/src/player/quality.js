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

function installQualityControls() {
  if (!window.XUPER_DESKTOP) { return; }
  document.addEventListener('xuper:hls-levels', function () {
    updateLiveQualityButton();
    if (playSettingViewOpen) { renderPlaySettingQuality(); }
  });
}
