/* player/play-settings.js — Menú de ajustes del reproductor (hoja inferior): audio, calidad, selección.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

function schedulePlaySettingHide() {
  if (playSettingTimer) { clearTimeout(playSettingTimer); }
  playSettingTimer = setTimeout(function () {
    closePlaySettingView();
  }, 8000);
}

function openPlaySettingView() {
  if (!playSettingView) { buildPlayer(); }
  if (!playSettingView) return;
  playSettingViewOpen = true;
  dialogPlaySettingsOpen = false;
  hideInfobar();

  renderPlaySettingView();
  playSettingView.classList.add('is-active');
  if (playerSubtitles) { playerSubtitles.classList.add('shift-up'); }

  /* Audio languages, subtitle files and renditions come from the portal;
     refresh the rows as soon as the service answers. */
  ensureMediaInfo(state.playerItem, function () {
    if (playSettingViewOpen) { renderPlaySettingView(); }
  });

  schedulePlaySettingHide();

  /* Seasons are selected in detail; this panel contains only chapters. */
  var item = state.playerItem;
  if (isSeriesItem(item) && psvEpisodesRow) {
    var chapter = psvEpisodesRow.querySelector('.psv-ep-btn');
    if (chapter) { setFocus(chapter); return; }
  }
  if (isSeriesItem(item) && psvBtnEpisodes) {
    setFocus(psvBtnEpisodes);
    return;
  }
  if (psvBtnConfig) { setFocus(psvBtnConfig); }
}

function closePlaySettingView() {
  if (playSettingTimer) { clearTimeout(playSettingTimer); playSettingTimer = null; }
  playSettingViewOpen = false;
  if (playSettingView) { playSettingView.classList.remove('is-active'); }
  if (playerSubtitles) { playerSubtitles.classList.remove('shift-up'); }
  if (state.screen === 'player' && !dialogPlaySettingsOpen) {
    setFocus(playerStage);
  }
}

function renderPlaySettingView() {
  /* Keep the d-pad where the user was: the rows rebuild their pills, so a
     plain re-render used to leave focus on a detached node (the OK press
     then did nothing and the panel closed by timeout). */
  var focusRow = state.focus ? closest(state.focus, '.psv-row') : null;
  var focusRowId = focusRow ? focusRow.id : '';
  var focusText = (focusRow && state.focus) ? state.focus.textContent : '';

  renderPlaySettingSelection();
  renderPlaySettingAudio();
  renderPlaySettingQuality();
  renderPlaySettingPlayerOptions();
  renderPlaySettingAspectOptions();
  renderPlaySettingRowFocus();

  if (!playSettingViewOpen || !focusRowId || !playSettingView) { return; }
  var rows = playSettingView.querySelectorAll('.psv-row');
  for (var r = 0; r < rows.length; r++) {
    if (rows[r].id !== focusRowId) { continue; }
    var btns = rows[r].querySelectorAll('.focusable');
    var match = null;
    for (var b = 0; b < btns.length; b++) {
      if (btns[b].textContent === focusText) { match = btns[b]; break; }
    }
    var target = match || firstIn(rows[r]);
    if (target) { setFocus(target, true); }
    break;
  }
}

function renderPlaySettingAudio() {
  if (!psvSecAudio) { return; }
  /* Always present: it is the entry point to "Ajuste de reproducir". */
  psvSecAudio.classList.remove('is-hidden');
}

/* ud/n1.dd() builds the RESOLUCIÓN row from the portal's quality map and
   shows shifted labels: the 720p copy is titled "1080P" and the 1080p copy
   "4K". Mirror that so the row matches the real app. */
function qualityChoices(info) {
  var tracks = (info && info.tracks) || [];
  var out = [];
  var seen = {};
  for (var i = 0; i < tracks.length; i++) {
    var raw = String(tracks[i].quality || '').toLowerCase().replace(/p$/, '');
    var label = raw === '480' ? '480P'
              : raw === '720' ? '1080P'
              : raw === '1080' ? '4K'
              : qualityLabel(tracks[i]);
    if (seen[label]) { continue; }
    seen[label] = true;
    out.push({ label: label, trackIndex: i });
  }
  /* The APK adds a "4K" pill whenever the 720p copy is present and the
     portal has no separate 1080p entry. */
  if (seen['1080P'] && !seen['4K']) { out.push({ label: '4K', trackIndex: -1 }); }
  return out;
}

/* Desktop "Calidad" row. Most portal episodes have a single version, so the
   row only appears when the current episode offers more than one height.
   The choice is a preferred height (e.g. 720) kept for later titles too;
   "Automática" lets the service pick the most compatible version. */
var QUALITY_PREF_KEY = 'xuper_quality_pref_v1';
function preferredQualityHeight() {
  return parseInt(safeLocalRead(QUALITY_PREF_KEY, 0), 10) || 0;
}
function trackLines(track) {
  var h = parseInt(track && track.height, 10) || 0;
  if (h) { return h; }
  var m = /(\d{3,4})\s*[pi]?/i.exec(String((track && track.quality) || ''));
  return m ? parseInt(m[1], 10) : 0;
}
function currentTrackInfo() {
  var item = state.playerItem;
  if (!item) { return null; }
  var ep = state.playerEpisode;
  return mediaInfoCache[(ep && ep.id) || ''] || mediaInfoCache[mediaInfoKey(item)] || null;
}

function renderPlaySettingQuality() {
  if (!window.XUPER_DESKTOP || !psvSecQuality || !psvQualityRow) { return; }
  var info = currentTrackInfo();
  var heights = [];
  var tracks = (info && info.tracks) || [];
  for (var i = 0; i < tracks.length; i++) {
    var h = trackLines(tracks[i]);
    if (h && heights.indexOf(h) === -1) { heights.push(h); }
  }
  heights.sort(function (a, b) { return b - a; });
  clear(psvQualityRow);
  if (state.playerMode === 'vod' && heights.length < 2 && renderHlsQualityRow(psvQualityRow)) {
    psvSecQuality.classList.remove('is-hidden');
    return;
  }
  if (state.playerMode !== 'vod' || heights.length < 2) {
    psvSecQuality.classList.add('is-hidden');
    return;
  }
  psvSecQuality.classList.remove('is-hidden');
  var pref = preferredQualityHeight();
  var playing = trackLines(info.selected);
  var options = [{ h: 0, label: 'Automática' + (playing && !pref ? ' · ' + playing + 'p' : '') }];
  for (var k = 0; k < heights.length; k++) { options.push({ h: heights[k], label: heights[k] + 'p' }); }
  var selectedH = (pref && heights.indexOf(pref) !== -1) ? pref : 0;
  options.forEach(function (opt) {
    var b = el('button', 'psv-btn focusable' + (opt.h === selectedH ? ' is-selected' : ''));
    b.appendChild(el('span', 'psv-check', '✔'));
    b.appendChild(document.createTextNode(opt.label));
    b._activate = function () {
      if (opt.h === selectedH) { return; }
      safeLocalWrite(QUALITY_PREF_KEY, opt.h);
      renderPlaySettingQuality();
      restartCurrentPlayback();
    };
    psvQualityRow.appendChild(b);
  });
}

/* The APK turns the title of the row that holds focus white and 40px. */
function renderPlaySettingRowFocus() {
  if (!playSettingView) { return; }
  var rows = playSettingView.querySelectorAll('.psv-row');
  for (var i = 0; i < rows.length; i++) { rows[i].classList.remove('is-row-focused'); }
  var row = state.focus ? closest(state.focus, '.psv-row') : null;
  if (row) { row.classList.add('is-row-focused'); }
}

function renderPlaySettingSelection() {
  if (!psvSecSelection) return;
  var item = state.playerItem;
  if (!item || !isSeriesItem(item)) {
    psvSecSelection.style.display = 'none';
    return;
  }
  psvSecSelection.style.display = 'block';
  if (!psvEpisodesRow) return;

  clear(psvEpisodesRow);

  var seasons = seriesSeasons(item);
  var season = seasons[state.playerSeasonIndex] || seasons[0];
  var episodes = (season && season.id === (item.seasonId || item.id) && item.episodes && item.episodes.length)
    ? item.episodes : ((season && season._episodes) || item.episodes || []);
  if (!episodes.length) {
    psvEpisodesRow.appendChild(el('div', 'psv-selection-empty', 'Temporadas y episodios'));
    return;
  }
  var currentIndex = 0;
  for (var c = 0; c < episodes.length; c++) {
    if (state.playerEpisode && (episodes[c].id === state.playerEpisode.id || episodes[c].number === state.playerEpisode.number)) { currentIndex = c; break; }
  }
  var ranges = detailRanges(episodes.length);
  if (state.playerEpisodeRange === undefined || state.playerEpisodeRange >= ranges.length) {
    state.playerEpisodeRange = Math.floor(currentIndex / 20);
  }
  var range = ranges[state.playerEpisodeRange] || ranges[0];
  /* reveal() only follows .scrollable containers.  Without this class the
     d-pad could focus episode 16+ outside the visible row, making a
     20-episode page look capped around fifteen entries. */
  var numberRow = el('div', 'psv-episode-numbers scrollable');
  for (var i = range.start; i < range.end; i++) {
    (function (ep, idx) {
      var epNo = String(ep.number !== undefined && ep.number !== null ? ep.number : idx + 1);
      /* Desktop keeps the number visible and marks the current one by style. */
      var label = (idx === currentIndex && !window.XUPER_DESKTOP) ? '▶' : epNo;
      var btn = el('button', 'psv-ep-btn focusable' + (idx === currentIndex ? ' is-selected is-current' : ''), label);
      btn._activate = function () { chooseEpisode(ep); };
      numberRow.appendChild(btn);
    })(episodes[i], i);
  }
  psvEpisodesRow.appendChild(numberRow);
  var rangeRow = el('div', 'psv-episode-ranges scrollable');
  for (var r = 0; r < ranges.length; r++) {
    (function (idx, part) {
      var btn = el('button', 'psv-range-btn focusable' + (idx === state.playerEpisodeRange ? ' is-selected' : ''),
        (part.start + 1) + '-' + part.end);
      btn._activate = function () {
        state.playerEpisodeRange = idx;
        renderPlaySettingSelection();
        var first = psvEpisodesRow.querySelector('.psv-ep-btn');
        if (first) { setFocus(first); }
      };
      rangeRow.appendChild(btn);
    })(r, ranges[r]);
  }
  psvEpisodesRow.appendChild(rangeRow);
}
