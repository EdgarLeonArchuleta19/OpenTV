/* player/episodes.js — Temporadas y episodios: navegador en el reproductor y paso al siguiente capítulo.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ================= Season/episode browser (in-player) =================
   Netflix-style list: season rail on the left, episode rows on the right.
   Episodes for other seasons are fetched once from the portal and cached on
   the season object.  The series id (item.id) is never overwritten, so the
   resolver keeps sending seriesContentId = the real series. */
function seriesSeasons(item) {
  if (item && item.seasons && item.seasons.length) { return item.seasons; }
  return [{ id: item ? item.id : '', number: 1 }];
}

function seasonEpisodes(item, season, done) {
  done = done || function () {};
  if (!item || !season) { return done([]); }
  if (season.id === (item.seasonId || item.id) && item.episodes && item.episodes.length) {
    season._episodes = item.episodes;
    return done(item.episodes);
  }
  if (season._episodes) { return done(season._episodes); }
  if (season._loading) {
    season._wait = season._wait || [];
    season._wait.push(done);
    return;
  }
  season._loading = true;
  season._wait = [done];
  portalServiceCall('detail', { contentId: season.id }, function (error, payload) {
    season._loading = false;
    var eps = (!error && payload && payload.returnValue !== false && payload.episodes)
      ? payload.episodes : [];
    if (eps.length) { season._episodes = eps; }
    var waiters = season._wait || [];
    season._wait = [];
    for (var i = 0; i < waiters.length; i++) {
      try { waiters[i](eps); } catch (eWaiter) { /* ignore */ }
    }
  });
}

function episodeDisplayTitle(item, ep, index) {
  var num = (ep && ep.number !== undefined && ep.number !== null) ? ep.number : (index + 1);
  var raw = String((ep && (ep.title || ep.name)) || '').trim();
  var base = String((item && item.title) || '').trim()
    .replace(/[\s\-–_]*[TtSs]\d+$/, '');   /* "Serie T10" -> "Serie" */
  if (base && raw.indexOf(base) === 0) {
    raw = raw.substring(base.length);
  }
  /* Language tags like "(Español Latino)" are shown apart (episodeLangTag). */
  raw = raw.replace(/\s*[(\[][^)\]]{1,30}[)\]]\s*/g, ' ');
  raw = raw.replace(/^[\s\-–_:.]+/, '').replace(/\s{2,}/g, ' ').trim();
  /* Only a season/episode code left ("T1_06", "S01E06", "6")? Use a clean
     label instead of repeating the series name. */
  if (!raw || /^(?:[TtSs]?\d+[\s\-–_.:]*)+$/.test(raw)) {
    raw = 'Episodio ' + num;
  }
  return raw;
}

/* "(Español Latino) T1_23" -> "Latino"; empty when the title has no tag. */
function episodeLangTag(ep) {
  var m = /[(\[]([^)\]]{1,30})[)\]]/.exec(String((ep && (ep.title || ep.name)) || ''));
  if (!m) { return ''; }
  var tag = m[1].trim();
  if (/latino/i.test(tag)) { return 'Latino'; }
  if (/castellano|españa/i.test(tag)) { return 'Castellano'; }
  if (/sub/i.test(tag)) { return 'Subtitulado'; }
  return tag;
}

function episodeDurationLabel(ep) {
  var raw = String((ep && ep.duration) || '').trim();
  /* The player may store the measured length as plain seconds ("1388.82"). */
  if (/^\d+(?:\.\d+)?$/.test(raw) && parseFloat(raw) >= 60) {
    var totalMin = Math.round(parseFloat(raw) / 60);
    var hh = Math.floor(totalMin / 60);
    return hh ? (hh + ' h ' + (totalMin % 60) + ' min') : (totalMin + ' min');
  }
  var m = /^(\d+):(\d+)(?::(\d+))?$/.exec(raw);
  if (!m) { return raw; }
  if (m[3]) {
    var h = parseInt(m[1], 10) || 0;
    var min = parseInt(m[2], 10) || 0;
    return h ? (h + ' h ' + min + ' min') : (min + ' min');
  }
  return (parseInt(m[1], 10) || 0) + ' min';
}

function openEpisodeBrowser() {
  var item = state.playerItem;
  if (!item || !isSeriesItem(item)) { return; }
  if (playSettingViewOpen) { closePlaySettingView(); }
  if (!episodeBrowser) { buildPlayer(); }
  if (!episodeBrowser) { return; }

  if ((!item.episodes || !item.episodes.length) && !item._detailsLoaded) {
    setPlayerStatus('Cargando capítulos…');
    loadVodDetail(item, function () {
      if (state.screen !== 'player') { return; }
      if (!state.playerEpisode && item.episodes && item.episodes.length) {
        state.playerEpisode = item.episodes[0];
        state.detailEpisode = item.episodes[0];
      }
      openEpisodeBrowser();
    });
    return;
  }

  if (!state.playerEpisode && item.episodes && item.episodes.length) {
    state.playerEpisode = item.episodes[0];
    state.detailEpisode = item.episodes[0];
    state.playerSeasonIndex = state.detailSeason || 0;
  }

  state.episodeBrowserOpen = true;
  state.browserSeason = state.playerSeasonIndex || 0;
  episodeBrowser.classList.add('is-active');
  hideVodInfobar();
  renderEpisodeBrowser();

  var cur = peEpisodes ? peEpisodes.querySelector('.pe-ep.is-current') : null;
  var f = cur || (peEpisodes ? firstIn(peEpisodes) : null) ||
          (peSeasonsCol && peSeasonsCol.style.display !== 'none' ? firstIn(peSeasons) : null);
  if (f) { setFocus(f); }
}

function closeEpisodeBrowser(keepFocus) {
  if (!episodeBrowser || !state.episodeBrowserOpen) { return; }
  state.episodeBrowserOpen = false;
  episodeBrowser.classList.remove('is-active');
  if (!keepFocus && state.screen === 'player' && playerStage) { setFocus(playerStage); }
}

function renderEpisodeBrowser() {
  var item = state.playerItem;
  if (!item || !episodeBrowser) { return; }
  var seasons = seriesSeasons(item);
  if (state.browserSeason >= seasons.length) { state.browserSeason = 0; }
  if (state.browserSeason < 0) { state.browserSeason = 0; }
  var season = seasons[state.browserSeason];
  var playingSeason = seasons[state.playerSeasonIndex] || seasons[0];
  var ep = state.playerEpisode;

  if (peTitle) { peTitle.textContent = item.title || ''; }
  if (peSub) {
    if (ep) {
      var tag = [];
      if (playingSeason && playingSeason.number) { tag.push('T' + playingSeason.number); }
      if (ep.number) { tag.push('E' + ep.number); }
      peSub.textContent = 'Reproduciendo ' + tag.join(' ') + ' · ' + episodeDisplayTitle(item, ep);
    } else {
      peSub.textContent = 'Elige un episodio';
    }
  }
  if (peSeasonLabel) {
    peSeasonLabel.textContent = 'Episodios · Temporada ' + ((season && season.number) || (state.browserSeason + 1));
  }

  renderBrowserSeasons(item, seasons);
  renderBrowserEpisodes(item, season);
}

function renderBrowserSeasons(item, seasons) {
  if (!peSeasons || !peSeasonsCol) { return; }
  clear(peSeasons);
  peSeasonsCol.style.display = 'flex';
  for (var i = 0; i < seasons.length; i++) {
    (function (idx) {
      var s = seasons[idx];
      var b = el('div', 'pe-season focusable', 'Temporada ' + (s.number || (idx + 1)));
      if (idx === state.browserSeason) { b.classList.add('is-selected'); }
      /* Netflix behaviour: just moving the season rail already shows that
         season's episodes, so OK is only needed to jump into the list. */
      b._onFocus = function () {
        if (state.browserSeason !== idx) { selectBrowserSeason(idx, false); }
      };
      b._activate = function () { selectBrowserSeason(idx, true); };
      peSeasons.appendChild(b);
    })(i);
  }
}

function renderBrowserEpisodes(item, season) {
  if (!peEpisodes || !season) { return; }
  clear(peEpisodes);
  var cached = (season.id === (item.seasonId || item.id) && item.episodes && item.episodes.length)
    ? item.episodes : (season._episodes || []);

  if (!cached.length) {
    peEpisodes.appendChild(el('div', 'pe-loading', 'Cargando episodios…'));
    seasonEpisodes(item, season, function (eps) {
      if (!state.episodeBrowserOpen) { return; }
      var now = seriesSeasons(item)[state.browserSeason];
      if (now !== season) { return; }
      renderBrowserEpisodes(item, season);
      /* Only re-anchor focus when the user is already inside the list; when
         they are browsing seasons the rail keeps the d-pad. */
      if (closest(state.focus, '#pe-episodes')) {
        var cur = peEpisodes.querySelector('.pe-ep.is-current');
        var f = cur || firstIn(peEpisodes);
        if (f) { setFocus(f); }
      }
    });
    return;
  }

  /* Keep the drawer within the small webOS 4 renderer budget.  A full
     season can contain dozens of poster images; decoding all of them while
     video is active can make the system kill the app for memory. */
  /* Desktop has no such memory limit and no artwork here: list them all. */
  var visibleEpisodes = window.XUPER_DESKTOP ? cached.length : Math.min(cached.length, 24);
  for (var i = 0; i < visibleEpisodes; i++) {
    (function (ep, idx) {
      var row = el('div', 'pe-ep focusable');
      var num = (ep.number !== undefined && ep.number !== null) ? ep.number : (idx + 1);
      row.appendChild(el('div', 'pe-num', String(num)));

      var thumb = el('div', 'pe-thumb');
      /* Deliberately no <img> per episode: remote artwork is the dominant
         memory cost in this overlay on a 1 GB webOS 4 TV. */
      var playIcon = el('div', 'pe-thumb-play', '▶');
      thumb.appendChild(playIcon);
      row.appendChild(thumb);

      var info = el('div', 'pe-info');
      info.appendChild(el('div', 'pe-name', episodeDisplayTitle(item, ep, idx)));
      var bits = [];
      var dur = episodeDurationLabel(ep);
      if (dur) { bits.push(dur); }
      if (ep.quality) { bits.push(String(ep.quality).split(',')[0].toUpperCase()); }
      if (window.XUPER_DESKTOP && episodeLangTag(ep)) { bits.push(episodeLangTag(ep)); }
      info.appendChild(el('div', 'pe-meta', bits.join('   ·   ')));
      if (ep.description) {
        info.appendChild(el('div', 'pe-desc', ep.description));
      }
      row.appendChild(info);

      /* Same id, or (without ids) same number in the season that is playing.
         Comparing only the number marked episode 1 of every season. */
      var pe = state.playerEpisode;
      var isPlaying = !!pe && (pe === ep || (pe.id && ep.id ? pe.id === ep.id :
        (pe.number !== undefined && pe.number === ep.number && state.browserSeason === state.playerSeasonIndex)));
      row.appendChild(el('div', 'pe-badge', '▶ REPRODUCIENDO'));
      if (isPlaying) {
        row.classList.add('is-current');
      }
      row._activate = function () { chooseEpisode(ep); };
      peEpisodes.appendChild(row);
    })(cached[i], i);
  }
  if (cached.length > visibleEpisodes) {
    peEpisodes.appendChild(el('div', 'pe-loading', 'Mostrando los primeros ' + visibleEpisodes + ' capítulos'));
  }
}

/* Repaints the rail's selection without rebuilding the nodes, so the
   focused season keeps the d-pad while the list on the right updates. */
function updateBrowserSeasonSelection() {
  if (!peSeasons) { return; }
  var rows = peSeasons.children;
  for (var i = 0; i < rows.length; i++) {
    rows[i].classList.toggle('is-selected', i === state.browserSeason);
  }
}

function selectBrowserSeason(idx, moveFocus) {
  var item = state.playerItem;
  var seasons = seriesSeasons(item);
  if (!seasons[idx]) { return; }
  state.browserSeason = idx;
  updateBrowserSeasonSelection();
  if (peSeasonLabel) {
    peSeasonLabel.textContent = 'Episodios · Temporada ' + (seasons[idx].number || (idx + 1));
  }
  renderBrowserEpisodes(item, seasons[idx]);
  if (moveFocus) {
    var cur = peEpisodes ? (peEpisodes.querySelector('.pe-ep.is-current') || firstIn(peEpisodes)) : null;
    if (cur) { setFocus(cur); }
  }
}

function seasonIndexOfEpisode(item, ep) {
  var seasons = seriesSeasons(item);
  function has(list) {
    if (!list) { return false; }
    for (var e = 0; e < list.length; e++) {
      if (list[e] === ep || (ep.id && list[e] && list[e].id === ep.id)) { return true; }
    }
    return false;
  }
  /* The season shown in the episode browser is the most likely one. */
  var order = [];
  if (state.browserSeason !== undefined && state.browserSeason !== null) { order.push(state.browserSeason); }
  for (var i = 0; i < seasons.length; i++) { if (order.indexOf(i) === -1) { order.push(i); } }
  for (var k = 0; k < order.length; k++) {
    var s = seasons[order[k]];
    if (!s) { continue; }
    var list = (s.id === (item.seasonId || item.id) && item.episodes && item.episodes.length) ? item.episodes : s._episodes;
    if (has(list)) { return order[k]; }
  }
  return -1;
}

function chooseEpisode(ep) {
  var item = state.playerItem;
  if (!item || !ep) { return; }
  var seasons = seriesSeasons(item);
  var prev = seasons[state.playerSeasonIndex];
  if (prev && prev.id === (item.seasonId || item.id) && item.episodes && item.episodes.length) {
    prev._episodes = item.episodes;
  }
  /* Use the season the chosen episode belongs to. Taking the season that
     was playing sent "T6 episode 1" inside "T1", and the portal answered
     portal100008 (the programme does not exist). */
  var sIdx = seasonIndexOfEpisode(item, ep);
  if (sIdx < 0) {
    sIdx = state.episodeBrowserOpen ? (state.browserSeason || 0)
      : ((state.playerSeasonIndex !== undefined && state.playerSeasonIndex !== null) ? state.playerSeasonIndex : 0);
  }
  state.playerSeasonIndex = sIdx;
  var season = seasons[sIdx];
  if (season) {
    if (state.detailSeason !== sIdx) {
      state.detailSeason = sIdx;
      state.detailNeedsRebuild = true;
    }
    if (season.id) { item.seasonId = season.id; }
    if (season._episodes) { item.episodes = season._episodes; }
  }
  closeEpisodeBrowser();
  if (playSettingViewOpen) { closePlaySettingView(); }
  playEpisode(item, ep);
}

/* Single path for changing episode while watching: keeps the detail screen,
   the infobar and the resolver on the same episode. */
function playEpisode(item, ep) {
  if (!item || !ep) { return; }
  state.playerItem = item;
  state.playerEpisode = ep;
  state.detailEpisode = ep;
  state.playerSeasonIndex = state.detailSeason || 0;
  /* Drop the previous episode's subtitles right away; the new episode
     loads its own. They stayed on screen over a failed episode switch. */
  subtitleSeq++;
  activeSubtitleCues = [];
  if (playerSubtitles) { playerSubtitles.innerHTML = ''; }
  if (playerStage && playerInfo) { updatePlayer(); }
  syncDetailEpisodeHighlight(item);
  /* Starfish retains the old UMS/video pipeline briefly after src is
     cleared.  Starting a new episode in the same turn can exceed the RAM
     budget of webOS 4, especially with the FFmpeg relay.  Release first,
     then create exactly one replacement pipeline. */
  if (state.episodeSwitchTimer) { clearTimeout(state.episodeSwitchTimer); }
  state.episodeSwitchSeq = (state.episodeSwitchSeq || 0) + 1;
  var switchSeq = state.episodeSwitchSeq;
  stopPlayerVideo();
  setPlayerStatus('Cambiando capítulo…');
  state.episodeSwitchTimer = setTimeout(function () {
    state.episodeSwitchTimer = null;
    if (switchSeq !== state.episodeSwitchSeq || state.screen !== 'player') { return; }
    startPlayerVideo(item, ep);
  }, 600);
}

function episodeListForCurrentSeason(item) {
  var seasons = seriesSeasons(item);
  var season = seasons[state.playerSeasonIndex] || seasons[0];
  if (!season) { return []; }
  if (season.id === (item.seasonId || item.id) && item.episodes && item.episodes.length) { return item.episodes; }
  return season._episodes || [];
}

function showNextEpisodeLoading(item) {
  if (!nextEpisodeLoading) { nextEpisodeLoading = $('next-episode-loading'); }
  if (!nextEpisodeLoading) { return; }
  var image = (item && (item.backdrop || item.landscape || item.poster)) || '';
  nextEpisodeLoading.style.backgroundImage = image ? 'url("' + String(image).replace(/"/g, '%22') + '")' : '';
  nextEpisodeLoading.classList.add('is-active');
}

function hideNextEpisodeLoading() {
  if (!nextEpisodeLoading) { nextEpisodeLoading = $('next-episode-loading'); }
  if (!nextEpisodeLoading) { return; }
  nextEpisodeLoading.classList.remove('is-active');
  nextEpisodeLoading.style.backgroundImage = '';
}

function advanceToNextEpisode() {
  var item = state.playerItem;
  if (!item || !isSeriesItem(item) || state.screen !== 'player') { return; }
  var episodes = episodeListForCurrentSeason(item);
  var current = state.playerEpisode;
  var index = -1;
  for (var i = 0; i < episodes.length; i++) {
    if (current && (episodes[i].id === current.id || episodes[i].number === current.number)) { index = i; break; }
  }
  if (index < 0) { return; }
  showNextEpisodeLoading(item);
  if (index + 1 < episodes.length) {
    playEpisode(item, episodes[index + 1]);
    return;
  }
  /* At the end of a season, fetch only the first chapter of the next one.
     The previous season's episode array stays cached, so this does not turn
     the compact player selector into a full all-season list. */
  var seasons = seriesSeasons(item);
  var nextSeasonIndex = (state.playerSeasonIndex || 0) + 1;
  var nextSeason = seasons[nextSeasonIndex];
  if (!nextSeason) { hideNextEpisodeLoading(); return; }
  var endedEpisode = current;
  seasonEpisodes(item, nextSeason, function (nextEpisodes) {
    if (state.playerItem !== item || state.playerEpisode !== endedEpisode || state.screen !== 'player') {
      return;
    }
    if (!nextEpisodes || !nextEpisodes.length) { hideNextEpisodeLoading(); return; }
    state.detailSeason = nextSeasonIndex;
    state.playerSeasonIndex = nextSeasonIndex;
    item.seasonId = nextSeason.id || item.seasonId;
    item.episodes = nextEpisodes;
    nextSeason._episodes = nextEpisodes;
    playEpisode(item, nextEpisodes[0]);
  });
}

function syncDetailEpisodeHighlight(item) {
  if (!detailBottom) { return; }
  var tiles = detailBottom.querySelectorAll('.detail-episode');
  for (var i = 0; i < tiles.length; i++) {
    var on = !!(tiles[i]._ep && state.detailEpisode && tiles[i]._ep.id === state.detailEpisode.id);
    tiles[i].classList.toggle('is-playing', on);
  }
}
