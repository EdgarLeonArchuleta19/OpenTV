/* screens/detail.js — Ficha de un título: datos, botones, temporadas, episodios y recomendaciones.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ============================================================ VOD DETAIL */
function openDetail(item) {
  /* A video floating in the PiP window keeps playing (and keeps its own
     player state) while the viewer browses other titles. */
  var floating = keepFloatingVideo() && state.playerItem !== item;
  if (!floating) { stopPlayerVideo(); }
  state.detail = item;
  state.streamError = '';
  if (!floating) {
    state.playerMode = 'vod';
    state.playerItem = item;
    state.playerEpisode = null;
  }
  lastVodAttempt = { phase: 'ficha y capítulos', status: 'cargando', error: '' };
  state.detailReturn = { screen: state.screen, focus: state.focus };
  state.detailRange = 0;
  state.detailSeason = 0;
  state.detailEpisode = null;

  if (item.seasons && item.seasons.length) {
    for (var s = 0; s < item.seasons.length; s++) {
      if (item.seasons[s].id === item.id) {
        state.detailSeason = s;
        break;
      }
    }
  }
  if (item.episodes && item.episodes.length) {
    state.detailEpisode = item.episodes[0];
  }
  resetResumePlan();
  preferHistoryEpisode(item);
  applyPendingHistoryEpisode(item);

  /* New title: forget the previous audio/subtitle/rendition choice and ask
     the portal for this one's real tracks (cached for the dialog/panel). */
  if (!floating) {
    resetMediaSelection();
    restoreSmoothMode(item);
  }
  ensureMediaInfo(item);

  buildDetail(item);
  showScreen('detail');

  /* Mostrar reproductor en recuadro mini */
  if (!playerStage) { buildPlayer(); }
  var scrPlayer = $('screen-player');
  if (scrPlayer) {
    scrPlayer.classList.add('is-mini');
    scrPlayer.classList.add('is-active');
  }

  var f = detailButtons ? detailButtons.querySelector('.focusable') : null;
  if (f) { setFocus(f); }

  if (item._detailsLoaded) {
    if (autoPreviewAllowed(item)) { startPlayerVideo(item, state.detailEpisode); }
  } else {
    if (autoPreviewAllowed(item)) { setPlayerStatus('Preparando la reproducción…'); }
    loadVodDetail(item, function (loaded) {
      if (loaded && state.screen === 'detail' && state.detail === loaded) {
        applyPendingHistoryEpisode(loaded);
        if (autoPreviewAllowed(loaded)) { startPlayerVideo(loaded, state.detailEpisode); }
      }
    });
  }
}

function toggleSynopsis() {
  var screen = $('screen-detail');
  if (!screen) { return; }
  var open = !screen.classList.contains('is-synopsis-open');
  screen.classList.toggle('is-synopsis-open', open);
  if (window.XUPER_DESKTOP) {
    var backdrop = screen.querySelector('.synopsis-backdrop');
    if (!backdrop) {
      backdrop = el('div', 'synopsis-backdrop');
      backdrop.addEventListener('click', function (event) {
        event.stopPropagation();
        if (screen.classList.contains('is-synopsis-open')) { toggleSynopsis(); }
      });
      screen.appendChild(backdrop);
    }
  }
  var more = document.querySelector('.detail-more');
  if (more) {
    more.textContent = window.XUPER_DESKTOP ? (open ? '✕  Cerrar' : 'Leer más') : (open ? 'Menos' : 'Más');
  }
}

/* Line icons for the desktop detail buttons (currentColor, 24px grid). */
var DESKTOP_DETAIL_ICONS = {
  fullscreen: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z" fill="currentColor"/></svg>',
  language: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 11h3M13 11h4M7 15h6M15 15h2"/></svg>',
  favorite: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z"/></svg>',
  restart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.5-5.8L4 8.5"/><path d="M4 3.5v5h5"/></svg>',
  mode: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/></svg>'
};

function buildDetail(item) {
  detailLeft = $('detail-left');
  detailPlayer = $('detail-player');
  detailButtons = $('detail-buttons');
  detailBottom = $('detail-bottom');
  clear(detailLeft); clear(detailButtons); clear(detailBottom);

  /* left column: 806px at 80/50 */
  var tw = el('div', 'detail-titlewrap');
  tw.appendChild(el('div', 'detail-title', item.title));
  tw.appendChild(el('div', 'detail-score', item.score));
  detailLeft.appendChild(tw);

  var metaText;
  if (item.country || item.releaseDate || item.tagline) {
    /* mTextTimeType: "country | release date | viewpoint" (reference). */
    var bits = [];
    if (item.country) { bits.push(item.country); }
    if (item.releaseDate) { bits.push(item.releaseDate); }
    if (item.tagline) { bits.push(item.tagline); }
    metaText = bits.join(' | ');
  } else {
    var parts = [];
    if (item.year && item.year !== '—') { parts.push(item.year); }
    if (item.duration && item.duration !== '—') { parts.push(item.duration); }
    parts.push('HD');
    metaText = parts.join('  ·  ');
  }
  detailLeft.appendChild(el('div', 'detail-meta', metaText));

  /* mTextUpdate: gold "T10 - E73", series only. The season comes from the
     alias ("... S10") or the season list; the count is the episode total. */
  if (isSeriesItem(item)) {
    var seasonNo = 0;
    var sm = /S(\d+)/i.exec(item.alias || '') || /T(\d+)/i.exec(item.title || '');
    if (sm) { seasonNo = parseInt(sm[1], 10) || 0; }
    if (!seasonNo && item.seasons && item.seasons.length) {
      var curSeason = item.seasons[state.detailSeason] || item.seasons[0];
      seasonNo = (curSeason && curSeason.number) || 1;
    }
    if (!seasonNo) { seasonNo = 1; }
    var epTotal = item.updateCount || item.volumeCount || (item.episodes ? item.episodes.length : 0);
    if (epTotal) {
      detailLeft.appendChild(el('div', 'detail-update', 'T' + seasonNo + ' - E' + epTotal));
    }
  }

  var genres = el('div', 'detail-genres');
  genres.appendChild(el('span', 'label', 'Género : '));
  for (var g = 0; g < item.genres.length; g++) {
    /* Informational metadata must not take D-pad focus on the detail page. */
    var chip = el('div', 'chip', item.genres[g]);
    genres.appendChild(chip);
  }
  detailLeft.appendChild(genres);

  var desk = !!window.XUPER_DESKTOP;
  function emptyValue(v) { return !v || /^[\s—–\-]*$/.test(String(v)); }

  var dir = el('div', 'detail-row');
  if (desk) { dir.appendChild(el('span', 'row-label', 'Dirección')); }
  else { dir.appendChild(document.createTextNode('Director : ')); }
  var dirV = el('span', 'val', item.director);
  dir.appendChild(dirV);
  if (!(desk && emptyValue(item.director))) { detailLeft.appendChild(dir); }

  var act = el('div', 'detail-row');
  if (desk) { act.appendChild(el('span', 'row-label', 'Reparto')); }
  else { act.appendChild(document.createTextNode('Actors : ')); }
  var actV = el('span', 'val', desk ? String(item.actors || '').replace(/\s*,\s*/g, ', ') : item.actors);
  act.appendChild(actV);
  if (!(desk && emptyValue(item.actors))) { detailLeft.appendChild(act); }

  var syn = el('div', 'detail-synopsis');
  syn.appendChild(el('span', 'label', desk ? 'Sinopsis' : 'Sinopsis : '));
  syn.appendChild(el('div', 'text', item.synopsis));
  /* mTextIntroduction + tvMore: the APK expands the 2-line preview in place.
     Here the expanded block overlays the button row (documented). */
  var more = el('div', 'detail-more focusable', desk ? 'Leer más' : 'Más');
  more._activate = toggleSynopsis;
  syn.appendChild(more);
  detailLeft.appendChild(syn);
  if (desk) { fitDetailLeft(syn); }

  /* player window 765x430 at right 80 / top 50. */
  clear(detailPlayer);
  detailPlayer.classList.add('focusable');
  detailPlayer._activate = function () { expandToFullscreen(item, state.detailEpisode); };
  detailPlayer._onMove = function () { return false; };

  /* buttons 276x68, gap 30 */
  var btnDefs = [
    { icon: 'icon_detail_fullscreen.png', label: 'Pantalla completa', kind: 'fullscreen' },
    { icon: 'icon_detail_subtitle_audio.png', label: 'Idioma', kind: 'language' },
    { icon: 'icon_detail_favorite.png', label: 'Favorito', kind: 'favorite' }
  ];
  /* Desktop: notifications are not implemented, so the button is left out. */
  if (isSeriesItem(item) && !desk) {
    btnDefs.push({ icon: 'icon_detail_subscribe.png', label: 'Notificaciones', kind: 'subscribe' });
  }
  if (desk) {
    btnDefs[0].label = resumeLabelFor(item) || 'Reproducir';
    btnDefs[1].label = 'Idioma y subtítulos';
    /* Started before: also offer to play it from the beginning. */
    if (resumeLabelFor(item) && /^Reanudar/.test(resumeLabelFor(item))) {
      btnDefs.splice(1, 0, { icon: 'icon_detail_fullscreen.png', label: 'Desde el inicio', kind: 'restart' });
    }
  }
  for (var b = 0; b < btnDefs.length; b++) {
    var btn = el('div', 'detail-btn focusable');
    btn.setAttribute('data-kind', btnDefs[b].kind);
    if (desk && DESKTOP_DETAIL_ICONS[btnDefs[b].kind]) {
      var svgWrap = el('i', 'detail-btn-icon');
      svgWrap.innerHTML = DESKTOP_DETAIL_ICONS[btnDefs[b].kind];
      btn.appendChild(svgWrap);
    } else {
      var ico = el('img');
      ico.src = 'assets/original/vod/' + btnDefs[b].icon;
      ico.alt = '';
      btn.appendChild(ico);
    }
    btn.appendChild(el('span', null, btnDefs[b].label));
    btn._kind = btnDefs[b].kind;
    if (btnDefs[b].kind === 'favorite' && state.favs[String(item.id)]) {
      btn.classList.add('is-selected');
      btn.querySelector('span').textContent = 'En favoritos';
    }
    if (window.XUPER_DESKTOP && btnDefs[b].kind === 'subscribe') {
      btn.setAttribute('aria-disabled', 'true');
      btn.title = 'Las notificaciones del servicio no están disponibles';
    }
    btn._activate = (function (kind, it) {
      return function () {
        if (kind === 'fullscreen') { expandToFullscreen(it, state.detailEpisode); }
        else if (kind === 'restart') {
          resumePlan = null;
          resumeSkipOnce = true;
          expandToFullscreen(it, state.detailEpisode);
          setTimeout(function () { var at = vodPlaybackPosition(); if (at > 3) { playerSeek(-at); } }, 400);
        }
        else if (kind === 'language') { openPlaySettingsDialog(it); }
        else if (kind === 'favorite') {
          var enabled = toggleFavorite(it);
          this.classList.toggle('is-selected', enabled);
          var label = this.querySelector('span');
          if (label) { label.textContent = enabled ? 'En favoritos' : 'Favorito'; }
        } else if (kind === 'subscribe') {
          var img = this.querySelector('img');
          var on = img.src.indexOf('subscribed') === -1;
          img.src = 'assets/original/vod/icon_detail_' + (on ? 'subscribed' : 'subscribe') + '.png';
        }
      };
    })(btnDefs[b].kind, item);
    detailButtons.appendChild(btn);
  }
  var modeBtn = el('div', 'detail-btn focusable');
  modeBtn.setAttribute('data-kind', 'mode');
  if (desk) {
    var modeSvg = el('i', 'detail-btn-icon');
    modeSvg.innerHTML = DESKTOP_DETAIL_ICONS.mode;
    modeBtn.appendChild(modeSvg);
  } else {
    var modeIcon = el('img');
    modeIcon.src = 'assets/original/vod/icon_detail_quality.png';
    modeIcon.alt = '';
    modeBtn.appendChild(modeIcon);
  }
  function modeText() {
    if (desk) { return 'Modo fluido'; }
    return state.streamMode === 'smooth' ? 'Modo fluido: Sí' : 'Modo fluido: No';
  }
  var modeLabel = el('span', null, modeText());
  modeBtn.appendChild(modeLabel);
  if (desk) {
    modeBtn.appendChild(el('i', 'detail-switch'));
    modeBtn.title = 'Convierte el vídeo para mayor compatibilidad (usa más CPU)';
  }
  modeBtn.classList.toggle('is-on', state.streamMode === 'smooth');
  modeBtn._activate = function () {
    setSmoothMode(item, state.streamMode !== 'smooth');
    modeLabel.textContent = modeText();
    modeBtn.classList.toggle('is-on', state.streamMode === 'smooth');
    if (window.XUPER_DESKTOP && state.playerItem === item && playerVideo && playerVideo.currentSrc) restartCurrentPlayback();
  };
  /* Desktop: compatibility is automatic (see tryCompatFallback); the manual
     choice lives in the player settings, not next to Play. */
  if (!desk) { detailButtons.appendChild(modeBtn); }

  renderDetailBottom(item);
}

/* Episode ranges are chunks of 20 ("1-20", "21-40", ...) as observed. */
function detailRanges(count) {
  var out = [];
  for (var s = 0; s < count; s += 20) {
    out.push({ start: s, end: Math.min(count, s + 20) });
  }
  return out;
}

function detailSeasonLabel(item) {
  var n = 0;
  if (item.seasons && item.seasons.length > 0) {
    var cur = item.seasons[state.detailSeason] || item.seasons[0];
    n = cur && cur.number ? cur.number : state.detailSeason + 1;
  }
  if (!n) {
    var m = /S(\d+)/i.exec(item.alias || '') || /T(\d+)/i.exec(item.title || '');
    if (m) { n = parseInt(m[1], 10) || 0; }
  }
  return 'Temporada ' + (n || 1);
}

function selectDetailRange(index, item) {
  state.detailRange = index;
  buildDetail(item);
  var f = detailBottom.querySelector('.detail-range.is-selected');
  if (f) { setFocus(f); }
}

var seasonPopup = null;
function closeSeasonPopup() {
  if (seasonPopup && seasonPopup.parentNode) {
    seasonPopup.parentNode.removeChild(seasonPopup);
    seasonPopup = null;
  }
  var arrow = detailBottom ? detailBottom.querySelector('.season-arrow') : null;
  if (arrow) { arrow.classList.remove('is-open'); }
}

function toggleSeasonPopup(anchorBtn, item) {
  if (seasonPopup) {
    closeSeasonPopup();
    return;
  }
  if (!item.seasons || item.seasons.length < 2) { return; }

  var arrow = anchorBtn.querySelector('.season-arrow');
  if (arrow) { arrow.classList.add('is-open'); }

  seasonPopup = el('div', 'season-popup');
  if (window.XUPER_DESKTOP) {
    /* Flow layout: open right under the season button. */
    /* Many seasons (Anatomía según Grey has 22): a compact grid of numbers
       so they all fit without scrolling. */
    var gridMode = item.seasons.length > 6;
    if (gridMode) { seasonPopup.classList.add('is-grid'); }
    abs(seasonPopup, anchorBtn.offsetLeft, anchorBtn.offsetTop + anchorBtn.offsetHeight + 8,
      gridMode ? Math.min(6, item.seasons.length) * 62 + 28 : Math.max(260, anchorBtn.offsetWidth));
    seasonPopup.style.maxHeight = gridMode ? 'none' : '360px';
  } else {
    abs(seasonPopup, 80, 100, 280, Math.min(320, item.seasons.length * 54));
  }

  for (var s = 0; s < item.seasons.length; s++) {
    (function (sIndex) {
      var sData = item.seasons[sIndex];
      var isSelected = sIndex === state.detailSeason;
      var pItem = el('div', 'season-popup-item focusable' + (isSelected ? ' is-selected' : ''));
      var sText = 'Temporada ' + (sData.number || (sIndex + 1));
      var compact = window.XUPER_DESKTOP && item.seasons.length > 6;
      pItem.appendChild(el('span', 'season-item-text', compact ? String(sData.number || (sIndex + 1)) : sText));
      if (compact) { pItem.title = sText; }

      var check = el('img', 'season-item-check');
      check.src = 'assets/original/vod/icon_nation_selected.png';
      check.alt = '';
      pItem.appendChild(check);

      pItem._activate = function () {
        closeSeasonPopup();
        if (state.detailSeason !== sIndex) {
          state.detailSeason = sIndex;
          state.detailRange = 0;
          state.detailEpisode = null;
          var targetSeason = item.seasons[sIndex];
          if (targetSeason && targetSeason.id) {
            setPlayerStatus('Cargando temporada…');
            portalServiceCall('detail', { contentId: targetSeason.id }, function (err, payload) {
              if (!err && payload && payload.returnValue !== false) {
                if (payload.item) { mergeDetail(item, payload.item); }
                item.episodes = payload.episodes || [];
                item.seasonId = targetSeason.id;
                targetSeason._episodes = item.episodes;
                state.detailEpisode = item.episodes[0] || null;
              }
              buildDetail(item);
              if (state.detailEpisode) {
                startPlayerVideo(item, state.detailEpisode);
              }
              var sBtn = detailBottom ? detailBottom.querySelector('.detail-season') : null;
              if (sBtn) { setFocus(sBtn); }
            });
          }
        } else {
          var sBtn2 = detailBottom ? detailBottom.querySelector('.detail-season') : null;
          if (sBtn2) { setFocus(sBtn2); }
        }
      };

      seasonPopup.appendChild(pItem);
    })(s);
  }

  detailBottom.appendChild(seasonPopup);
  var focusedChild = seasonPopup.children[state.detailSeason] || seasonPopup.children[0];
  /* Desktop: focus without scrolling the page. Revealing the current
     season pushed the whole "Episodios" section out of view. */
  if (focusedChild) { setFocus(focusedChild, !!window.XUPER_DESKTOP); }
}

/* Desktop layout: one scrollable column (episodes, then related titles)
   laid out by CSS instead of fixed TV coordinates. */
function renderDetailBottomDesktop(item) {
  var episodes = (isSeriesItem(item) && item.episodes) ? item.episodes : [];
  var ranges = detailRanges(episodes.length);
  if (state.detailRange >= ranges.length) { state.detailRange = 0; }
  detailBottom.classList.add('scrollable', 'dd-flow');

  if (isSeriesItem(item)) {
    var epSection = el('section', 'dd-section');
    var head = el('div', 'dd-head');
    head.appendChild(el('h2', 'dd-title', 'Episodios'));

    var seasonBtn = el('div', 'detail-season focusable');
    seasonBtn.appendChild(el('span', 'season-text', detailSeasonLabel(item)));
    var multi = item.seasons && item.seasons.length > 1;
    if (multi) {
      var arrow = el('i', 'season-arrow');
      arrow.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
      seasonBtn.appendChild(arrow);
    } else {
      seasonBtn.classList.add('is-single');
    }
    seasonBtn._activate = function () {
      if (!multi) { return; }
      toggleSeasonPopup(seasonBtn, item);
    };
    head.appendChild(seasonBtn);
    if (episodes.length) {
      head.appendChild(el('span', 'dd-count', episodes.length + (episodes.length === 1 ? ' episodio' : ' episodios')));
    }
    epSection.appendChild(head);

    if (episodes.length > 20) {
      var rangeRow = el('div', 'detail-ranges dd-ranges');
      for (var i = 0; i < ranges.length; i++) {
        (function (idx) {
          var tab = el('div', 'detail-range focusable' + (idx === state.detailRange ? ' is-selected' : ''),
                       (ranges[idx].start + 1) + '–' + ranges[idx].end);
          tab._activate = function () { selectDetailRange(idx, item); };
          rangeRow.appendChild(tab);
        })(i);
      }
      epSection.appendChild(rangeRow);
    }

    if (episodes.length) {
      var current = ranges[state.detailRange] || { start: 0, end: episodes.length };
      var grid = el('div', 'detail-episodes dd-grid');
      for (var e = current.start; e < current.end; e++) {
        (function (ep, index) {
          var isPlaying = state.detailEpisode && (state.detailEpisode.id === ep.id || state.detailEpisode === ep);
          var tile = el('div', 'detail-episode focusable' + (isPlaying ? ' is-playing' : ''));
          var numText = (ep.number !== undefined && ep.number !== null) ? String(ep.number) : String(index + 1);
          tile.appendChild(el('span', 'ep-num', numText));
          var info = el('span', 'ep-info');
          var title = episodeDisplayTitle(item, ep, index);
          /* "Episodio 7" only repeats the big number: leave it out. */
          if (title !== 'Episodio ' + numText) {
            info.appendChild(el('span', 'ep-title', title));
          } else {
            tile.classList.add('is-generic');
          }
          var dur = episodeDurationLabel(ep);
          var metaBits = [];
          if (dur) { metaBits.push(dur); }
          var lang = episodeLangTag(ep);
          if (lang) { metaBits.push(lang); }
          info.appendChild(el('span', 'ep-meta', metaBits.join(' · ')));
          info.appendChild(el('span', 'ep-now', 'Viendo'));
          tile.appendChild(info);
          var play = el('i', 'ep-play');
          play.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
          tile.appendChild(play);
          tile.title = 'Episodio ' + numText + (title && title !== 'Episodio ' + numText ? ' · ' + title : '');
          tile._ep = ep;
          tile._activate = function () { playEpisode(item, ep); };
          grid.appendChild(tile);
        })(episodes[e], e);
      }
      epSection.appendChild(grid);
    } else {
      epSection.appendChild(el('div', 'dd-empty', 'Cargando episodios…'));
    }
    detailBottom.appendChild(epSection);
  }

  var relSection = el('section', 'dd-section');
  relSection.appendChild(el('h2', 'dd-title detail-related', 'Quizás te guste'));
  /* A sideways row of up to 30 similar titles (same kind, shared genres),
     with arrows; the wheel keeps scrolling the page. */
  var relWrap = el('div', 'dd-related-wrap');
  var rel = el('div', 'detail-grid dd-related scrollable');
  var related = relatedTitles(item, 30);
  for (var r = 0; r < related.length; r++) {
    var cell = el('div', 'cell');
    cell.appendChild(makePoster(related[r], 0, 0, 190, 279, { gold: true }));
    cell.appendChild(el('div', 'd-name', related[r].title));
    rel.appendChild(cell);
  }
  relWrap.appendChild(rel);
  ['prev', 'next'].forEach(function (dir) {
    var arrow = el('button', 'dd-rel-arrow is-' + dir);
    arrow.type = 'button';
    arrow.innerHTML = dir === 'prev' ? UI_ICONS.prev : UI_ICONS.next;
    arrow.setAttribute('aria-label', dir === 'prev' ? 'Anteriores' : 'Más títulos');
    arrow.addEventListener('click', function (event) {
      event.stopPropagation();
      var by = Math.max(300, rel.clientWidth * 0.8) * (dir === 'prev' ? -1 : 1);
      try { rel.scrollBy({ left: by, behavior: 'smooth' }); } catch (eScroll) { rel.scrollLeft += by; }
    });
    relWrap.appendChild(arrow);
  });
  function syncArrows() {
    relWrap.classList.toggle('at-start', rel.scrollLeft <= 4);
    relWrap.classList.toggle('at-end', rel.scrollLeft >= rel.scrollWidth - rel.clientWidth - 4);
    schedulePosterMemoryPass();
  }
  rel.addEventListener('scroll', syncArrows, { passive: true });
  relWrap.addEventListener('mouseenter', syncArrows);
  setTimeout(syncArrows, 0);
  relSection.appendChild(relWrap);
  detailBottom.appendChild(relSection);
}

function renderDetailBottom(item) {
  if (window.XUPER_DESKTOP) { return renderDetailBottomDesktop(item); }
  var episodes = (isSeriesItem(item) && item.episodes) ? item.episodes : [];
  var hasEpisodes = episodes.length > 0;
  var ranges = detailRanges(episodes.length);
  if (state.detailRange >= ranges.length) { state.detailRange = 0; }

  /* Season dropdown button (flChoose / llSeanson) */
  if (isSeriesItem(item)) {
    var seasonBtn = el('div', 'detail-season focusable');
    abs(seasonBtn, 80, 42, 280, 53);
    seasonBtn.appendChild(el('span', 'season-text', detailSeasonLabel(item)));
    var arrow = el('img', 'season-arrow');
    arrow.src = 'assets/original/vod/ic_down_icon.png';
    arrow.alt = '▼';
    seasonBtn.appendChild(arrow);
    seasonBtn._activate = function () {
      if (!item.seasons || item.seasons.length < 2) { return; }
      toggleSeasonPopup(seasonBtn, item);
    };
    detailBottom.appendChild(seasonBtn);
  }

  /* Range tabs (1-20, 21-40...) */
  if (hasEpisodes && episodes.length > 20) {
    var rangeRow = el('div', 'detail-ranges');
    abs(rangeRow, 398, 51, 1522, 46);
    for (var i = 0; i < ranges.length; i++) {
      (function (idx) {
        var tab = el('div', 'detail-range focusable' + (idx === state.detailRange ? ' is-selected' : ''),
                     (ranges[idx].start + 1) + '-' + ranges[idx].end);
        abs(tab, idx * 160, 0, 150, 46);
        tab._activate = function () { selectDetailRange(idx, item); };
        rangeRow.appendChild(tab);
      })(i);
    }
    detailBottom.appendChild(rangeRow);
  }

  /* Episode grid */
  if (hasEpisodes) {
    var current = ranges[state.detailRange] || { start: 0, end: episodes.length };
    var row = el('div', 'detail-episodes scrollable');
    abs(row, 80, 149, 1840, 65);
    for (var e = current.start; e < current.end; e++) {
      (function (ep, index) {
        var isPlaying = state.detailEpisode && (state.detailEpisode.id === ep.id || state.detailEpisode === ep);
        var tile = el('div', 'detail-episode focusable' + (isPlaying ? ' is-playing' : ''));
        abs(tile, index * 160, 0, 150, 65);
        var numText = (ep.number !== undefined && ep.number !== null) ? String(ep.number) : String(e + 1);
        tile.appendChild(el('span', 'ep-num', numText));
        tile._ep = ep;
        tile._activate = function () {
          playEpisode(item, ep);
        };
        row.appendChild(tile);
      })(episodes[e], e - current.start);
    }
    detailBottom.appendChild(row);
  }

  /* mTextRelated + mGridRelated. The series layout pushes them below the
     episode selector, so the poster row is clipped by the screen edge. */
  var relatedTop = hasEpisodes ? 240 : 25;
  var gridTop = hasEpisodes ? 290 : 91;
  var heading = el('div', 'detail-related', 'Quizás te guste');
  abs(heading, 80, relatedTop, 400, 44);
  detailBottom.appendChild(heading);

  var grid = el('div', 'detail-grid scrollable');
  abs(grid, 80, gridTop, 1750, hasEpisodes ? 180 : 380);
  var seed = parseInt(item.id, 10);
  if (isNaN(seed)) {
    seed = 0;
    for (var s = 0; s < VOD.length; s++) { if (VOD[s] === item) { seed = s; break; } }
  }
  var start = (seed * 3) % Math.max(1, VOD.length - 6);
  for (var r = 0; r < 8; r++) {
    var rel = VOD[(start + r) % VOD.length];
    if (!rel) { continue; }
    var cell = el('div', 'cell');
    cell.appendChild(makePoster(rel, 0, 0, 210, 308, { gold: true }));
    cell.appendChild(el('div', 'd-name', rel.title));
    grid.appendChild(cell);
  }
  detailBottom.appendChild(grid);
}

/* Desktop: a two-line title leaves less room above the buttons. Give up
   whole synopsis lines (3 → 2 → 1), then the credits, so nothing is cut in
   half and "Leer más" stays visible. */
function fitDetailLeft(syn) {
  var text = syn.querySelector('.text');
  function overflowing() { return detailLeft.scrollHeight > detailLeft.clientHeight + 1; }
  function fit() {
    if (!detailLeft.clientHeight || !text) { return; }
    text.style.webkitLineClamp = '';
    var rows = detailLeft.querySelectorAll('.detail-row');
    for (var r = 0; r < rows.length; r++) { rows[r].style.display = ''; }
    for (var lines = 2; overflowing() && lines >= 1; lines--) { text.style.webkitLineClamp = String(lines); }
    for (var k = 0; overflowing() && k < rows.length; k++) { rows[k].style.display = 'none'; }
  }
  setTimeout(fit, 0);
}

/* Similar titles: same kind first, then shared genres, then the same
   home section; the catalogue order breaks ties. */
function relatedTitles(item, max) {
  var genres = {};
  (item.genres || []).forEach(function (g) { genres[norm(g)] = true; });
  var cats = String(item.category || '').split(',');
  var series = !!isSeriesItem(item);
  var scored = [];
  for (var i = 0; i < VOD.length; i++) {
    var v = VOD[i];
    if (!v || v === item || String(v.id) === String(item.id) || !hasUsableCover(v)) { continue; }
    var score = (!!isSeriesItem(v) === series) ? 3 : 0;
    (v.genres || []).forEach(function (g) { if (genres[norm(g)]) { score += 2; } });
    var vc = String(v.category || '').split(',');
    for (var c = 0; c < vc.length; c++) { if (vc[c] && cats.indexOf(vc[c]) !== -1) { score += 1; break; } }
    scored.push({ v: v, s: score, i: i });
  }
  scored.sort(function (a, b) { return b.s - a.s || a.i - b.i; });
  var out = [], seen = {};
  for (var k = 0; k < scored.length && out.length < max; k++) {
    var key = norm(scored[k].v.title);
    if (seen[key]) { continue; }
    seen[key] = true;
    out.push(scored[k].v);
  }
  return out;
}
