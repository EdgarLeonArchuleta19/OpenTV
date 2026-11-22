/* screens/detail.js — Ficha de un título: datos, botones, temporadas, episodios y recomendaciones.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ============================================================ VOD DETAIL */
/* Back from the player: bring the resume button ("Reanudar · 25:10") up to
   date. Returns true when the buttons had to be rebuilt (never now). */
function refreshDetailResume(item) {
  if (!window.OPENTV_DESKTOP || !item || !detailButtons) { return false; }
  var label = resumeLabelFor(item) || 'Reproducir';
  var span = detailButtons.querySelector('.detail-btn[data-kind="fullscreen"] span');
  if (span && span.textContent !== label) { span.textContent = label; }
  syncStartOverButton(item);
  return false;
}

/* "Ver desde el principio" shows only when Reproducir would resume. */
function syncStartOverButton(item) {
  var btn = detailButtons && detailButtons.querySelector('.detail-btn[data-kind="restart"]');
  if (!btn) { return; }
  var show = canStartOver(item, isSeriesItem(item) ? state.detailEpisode : null);
  btn.style.display = show ? '' : 'none';
  /* The focus never stays on a button that just went away. */
  if (!show && state.focus === btn) {
    var play = detailButtons.querySelector('.detail-btn[data-kind="fullscreen"]');
    if (play) { setFocus(play); }
  }
}

/* PC and TV: the details screen shows the title's picture, faded into the
   page behind the text, not a small playing preview (it searched sources
   and loaded a video just to look at a title). Reproducir goes full screen. */
function detailShowsArt() {
  return !!window.OPENTV_DESKTOP;
}

function openDetail(item) {
  /* (A stale card or an empty catalog: nothing to open.) */
  if (!item) { return; }
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
  if (window.OPENTV_DESKTOP && pendingHistoryRecord && item.seasons && item.seasons.length > 1) {
    var wantedSid = String(pendingHistoryRecord.seasonId || pendingHistoryRecord.id || '');
    for (var hs = 0; hs < item.seasons.length; hs++) {
      if (String(item.seasons[hs].id) === wantedSid) {
        state.detailSeason = hs;
        state.playerSeasonIndex = hs;
        if (item.seasons[hs]._episodes && item.seasons[hs]._episodes.length) {
          item.episodes = item.seasons[hs]._episodes;
          item.seasonId = item.seasons[hs].id;
        }
        break;
      }
    }
  }
  applyPendingHistoryEpisode(item);

  /* New title: forget the previous audio/subtitle/rendition choice and ask
     the portal for this one's real tracks (cached for the dialog/panel). */
  if (!floating) {
    resetMediaSelection();
    restoreSmoothMode(item);
  }
  ensureMediaInfo(item);

  /* Spanish texts (home/catalog-lang.js): from the cache before drawing;
     when they come from TMDB a moment later, they are put in place. */
  localizeItem(item, function (changed) {
    if (!changed || state.detail !== item || !detailLeft || !detailLeft.isConnected) { return; }
    var tNode = detailLeft.querySelector('.detail-title');
    if (tNode) { tNode.textContent = item.title; }
    var sNode = detailLeft.querySelector('.detail-synopsis .text');
    if (sNode) { sNode.textContent = item.synopsis; }
  });

  buildDetail(item);
  showScreen('detail');

  /* Mostrar reproductor en recuadro mini */
  if (!playerStage) { buildPlayer(); }
  var scrPlayer = $('screen-player');
  /* (PC and TVs: no small player on the details screen, only the picture.) */
  var scrDetailPage = $('screen-detail');
  if (scrDetailPage) {
    /* (TVs: the whole screen scrolls as one page, core/focus.js reveal.) */
    scrDetailPage.scrollTop = 0;
    scrDetailPage._tvTop = 0;
  }
  if (scrPlayer && !detailShowsArt()) {
    scrPlayer.classList.add('is-mini');
    scrPlayer.classList.add('is-active');
    /* The title's picture while the preview loads (or when there is none:
       addon titles) instead of an empty black box. */
    if (playerVideo && (!document.pictureInPictureElement || state.playerItem === item)) {
      var stillArt = heroArt(item) || item.poster || '';
      if (stillArt) { playerVideo.poster = sizedImageUrl(stillArt, 1280); }
      else { playerVideo.removeAttribute('poster'); }
    }
  }

  var f = detailButtons ? detailButtons.querySelector('.focusable') : null;
  if (f) { setFocus(f); }

  if (item._detailsLoaded) {
    /* "Seguir viendo" on another season: its episodes came with the title. */
    var recSeason = window.OPENTV_DESKTOP && pendingHistoryRecord && item.seasons && item.seasons[state.detailSeason];
    if (recSeason && recSeason._episodes && recSeason._episodes.length &&
        String(recSeason.id) !== String(item.seasonId || item.id)) {
      item.episodes = recSeason._episodes;
      item.seasonId = recSeason.id;
      applyPendingHistoryEpisode(item);
      buildDetail(item);
    }
    if (autoPreviewAllowed(item)) { startPlayerVideo(item, state.detailEpisode); }
  } else {
    if (autoPreviewAllowed(item)) { setPlayerStatus('Preparando la reproducción…'); }
    loadVodDetail(item, function (loaded) {
      if (loaded && state.screen === 'detail' && state.detail === loaded) {
        applyPendingHistoryEpisode(loaded);
        buildDetail(loaded);
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
  if (window.OPENTV_DESKTOP) {
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
    more.textContent = window.OPENTV_DESKTOP ? (open ? '✕  Cerrar' : 'Leer más') : (open ? 'Menos' : 'Más');
  }
}

/* Line icons for the desktop detail buttons (currentColor, 24px grid). */
var DESKTOP_DETAIL_ICONS = {
  fullscreen: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z" fill="currentColor"/></svg>',
  restart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/></svg>',
  language: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 11h3M13 11h4M7 15h6M15 15h2"/></svg>',
  favorite: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z"/></svg>',
  mylist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z"/></svg>',
  mode: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/></svg>',
  source: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h11M4 12h16M4 17h9"/><path d="m17 4 3 3-3 3"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 19h14"/></svg>'
};

function buildDetail(item) {
  detailLeft = $('detail-left');
  detailPlayer = $('detail-player');
  detailButtons = $('detail-buttons');
  detailBottom = $('detail-bottom');
  clear(detailLeft); clear(detailButtons); clear(detailBottom);

  /* left column: 806px at 80/50 */
  var tw = el('div', 'detail-titlewrap');
  /* Long titles (anime: "… Season 2 - Arise from the Shadow") get a
     smaller size and every line shows; fitDetailLeft shrinks more if needed. */
  var titleLen = String(item.title || '').length;
  tw.appendChild(el('div', 'detail-title' + (titleLen > 70 ? ' is-xlong' : titleLen > 40 ? ' is-long' : ''), item.title));
  /* No rating from the addon: no empty "★ —" badge. */
  if (item.score && !/^[\s—–-]*$/.test(String(item.score))) { tw.appendChild(el('div', 'detail-score', item.score)); }
  detailLeft.appendChild(tw);

  var metaText;
  if (item.country || item.releaseDate || item.tagline) {
    /* mTextTimeType: "country | release date | viewpoint" (reference). */
    var bits = [];
    if (item.country) { bits.push(countryName(item.country)); }
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
  /* PC: a tighter top. Year · length · HD go on the genres' line, and
     Dirección / Reparto on one line (below). */
  var pcPage = !!window.OPENTV_DESKTOP && !platformIsTv();
  if (!pcPage) { detailLeft.appendChild(el('div', 'detail-meta', metaText)); }

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
  /* Informational metadata must not take D-pad focus on the detail page.
     Names in Spanish, without repeats (Animation and Cartoon are one). */
  var genreList = itemGenres(item, 6);
  if (!genreList.length) { genreList = ['Sin clasificar']; }
  for (var g = 0; g < genreList.length; g++) {
    genres.appendChild(el('div', 'chip', genreList[g]));
  }
  if (item.nextEpisodeDate) {
    genres.appendChild(el('div', 'chip is-next-ep', 'Próximo: ' + item.nextEpisodeDate));
  }
  if (pcPage) {
    genres.classList.add('has-meta');
    genres.insertBefore(el('span', 'detail-meta is-inline', metaText), genres.firstChild);
  }
  detailLeft.appendChild(genres);

  var desk = !!window.OPENTV_DESKTOP;
  function emptyValue(v) { return !v || /^[\s—–\-]*$/.test(String(v)); }

  if (pcPage && !(emptyValue(item.director) && emptyValue(item.actors))) {
    var credits = el('div', 'detail-row is-credits');
    if (!emptyValue(item.director)) {
      credits.appendChild(el('span', 'row-label', 'Dirección'));
      credits.appendChild(el('span', 'val', item.director));
    }
    if (!emptyValue(item.actors)) {
      if (!emptyValue(item.director)) { credits.appendChild(el('span', 'row-sep', '·')); }
      credits.appendChild(el('span', 'row-label', 'Reparto'));
      credits.appendChild(el('span', 'val', String(item.actors).replace(/\s*,\s*/g, ', ')));
    }
    detailLeft.appendChild(credits);
  }
  var dir = el('div', 'detail-row');
  if (desk) { dir.appendChild(el('span', 'row-label', 'Dirección')); }
  else { dir.appendChild(document.createTextNode('Director : ')); }
  var dirV = el('span', 'val', item.director);
  dir.appendChild(dirV);
  if (!(desk && emptyValue(item.director)) && !pcPage) { detailLeft.appendChild(dir); }

  var act = el('div', 'detail-row');
  if (desk) { act.appendChild(el('span', 'row-label', 'Reparto')); }
  else { act.appendChild(document.createTextNode('Actors : ')); }
  var actV = el('span', 'val', desk ? String(item.actors || '').replace(/\s*,\s*/g, ', ') : item.actors);
  act.appendChild(actV);
  if (!(desk && emptyValue(item.actors)) && !pcPage) { detailLeft.appendChild(act); }

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
  detailPlayer.classList.toggle('is-art', detailShowsArt());
  if (detailShowsArt()) {
    /* TVs: the title's picture instead of a playing preview (a second video
       next to the buttons came out black on the Fire TV and slowed the whole
       screen down). Reproducir opens the full-screen player. */
    detailPlayer.classList.remove('focusable');
    var tvArt = tvCardArt(item);
    if (tvArt) {
      var artImg = el('img', 'detail-tv-art');
      artImg.decoding = 'async';
      artImg.src = sizedImageUrl(tvArt, 1280);   /* backdrop behind the text (desktop/tw/input.css) */
      detailPlayer.appendChild(artImg);
    }
  } else {
    detailPlayer.classList.add('focusable');
    detailPlayer._activate = function () { expandToFullscreen(item, state.detailEpisode); };
    detailPlayer._onMove = function () { return false; };
    /* Addon titles play no preview here (it could start a torrent just by
       opening the page): their picture instead, with a play mark, until the
       title is playing in this box. */
    var playingHere = state.playerItem === item && playerVideo && playerVideo.currentSrc;
    var pcArt = !autoPreviewAllowed(item) && !playingHere ? (heroArt(item) || item.poster) : '';
    if (pcArt) {
      var pic = el('div', 'detail-pc-art');
      pic.style.backgroundImage = 'url("' + String(sizedImageUrl(pcArt, 1280)).replace(/"/g, '%22') + '")';
      var mark = el('i', 'detail-pc-play');
      mark.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
      pic.appendChild(mark);
      detailPlayer.appendChild(pic);
      /* Once a video plays in this box, the picture steps aside. */
      if (playerVideo) {
        var dropArt = function () {
          playerVideo.removeEventListener('playing', dropArt);
          if (pic.parentNode) { pic.parentNode.removeChild(pic); }
        };
        playerVideo.addEventListener('playing', dropArt);
      }
    }
  }

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
    /* Two groups, one big button. Watching: Reproducir (with Cambiar
       fuente joined to it) and Idioma y subtítulos. Then, after a line, the
       viewer's own: Favorito, Mi lista, Descargar. Icons show their name
       as a tooltip, and on a TV / keyboard when they have the focus. */
    btnDefs = [
      { label: resumeLabelFor(item) || 'Reproducir', kind: 'fullscreen' }
    ];
    var canChooseSource = item._stremio && !item._plain && !item._downloadId;
    if (canChooseSource) { btnDefs.push({ label: 'Cambiar fuente', kind: 'source', iconOnly: true, attached: true }); }
    /* Hidden by syncStartOverButton while there is nothing to resume. */
    btnDefs.push({ label: 'Ver desde el principio', kind: 'restart', iconOnly: true });
    btnDefs.push({ label: 'Idioma y subtítulos', kind: 'language', iconOnly: true });
    btnDefs.push({ label: state.favs[String(item.id)] ? 'Quitar de favoritos' : 'Añadir a favoritos', kind: 'favorite', iconOnly: true, group: true });
    btnDefs.push({ label: inMyList(item) ? 'Quitar de Mi lista' : 'Añadir a Mi lista', kind: 'mylist', iconOnly: true });
    if (canChooseSource) {
      /* PC and phone: save the movie or the selected episode to watch
         without internet (TVs never get the capability, main.js). */
      if (platformHas('downloads')) {
        var dl = downloadFor(item, isSeriesItem(item) ? state.detailEpisode : null);
        btnDefs.push({ label: dl && dl.status === 'done' ? 'Descargado' : (dl && dl.status !== 'error' && dl.status !== 'missing' ? 'Descargando…' : 'Descargar'),
          kind: 'download', iconOnly: true });
      }
    }
  }
  /* No addon with sources: information only, and where to add one. */
  var canPlay = !item._stremio || item._downloadId || hasSourceAddons() || !!downloadedFileFor(item, state.detailEpisode);
  if (!canPlay) {
    btnDefs = btnDefs.filter(function (d) { return d.kind === 'favorite' || d.kind === 'mylist'; });
    var noSrc = el('div', 'detail-nosrc');
    noSrc.appendChild(el('span', 'detail-nosrc-text', 'Para reproducir, agrega un plugin de fuentes.'));
    var goAddons = el('div', 'detail-btn focusable detail-nosrc-btn');
    goAddons.appendChild(el('span', null, 'Ir a Plugins'));
    goAddons._activate = function () { openSettingsAt('sources'); };
    noSrc.appendChild(goAddons);
    detailButtons.appendChild(noSrc);
  }
  for (var b = 0; b < btnDefs.length; b++) {
    /* The line between "watch" and "mine". */
    if (btnDefs[b].group && b > 0) { detailButtons.appendChild(el('i', 'detail-btn-sep')); }
    var btn = el('div', 'detail-btn focusable');
    if (btnDefs[b].attached) { btn.classList.add('is-attached'); }
    if (btnDefs[b + 1] && btnDefs[b + 1].attached) { btn.classList.add('has-attached'); }
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
    if (btnDefs[b].iconOnly) {
      /* Only the icon shows; the label is the tooltip and what a screen reader says. */
      btn.classList.add('is-icon-only');
      btn.setAttribute('data-tip', btnDefs[b].label);
      btn.setAttribute('aria-label', btnDefs[b].label);
    }
    if ((btnDefs[b].kind === 'favorite' && state.favs[String(item.id)]) ||
        (btnDefs[b].kind === 'mylist' && inMyList(item))) {
      btn.classList.add('is-selected');
      if (!desk) { btn.querySelector('span').textContent = 'En favoritos'; }
    }
    if (window.OPENTV_DESKTOP && btnDefs[b].kind === 'subscribe') {
      btn.setAttribute('aria-disabled', 'true');
      btn.title = 'Las notificaciones del servicio no están disponibles';
    }
    btn._activate = (function (kind, it) {
      return function () {
        /* (A click reaches here even while it is off: an episode's sources
           still loading.) */
        if (this && this.getAttribute && this.getAttribute('aria-disabled') === 'true') { return; }
        if (kind === 'fullscreen') { resumeFromStartKey = ''; expandToFullscreen(it, state.detailEpisode); }
        else if (kind === 'restart') { startOverTitle(it, isSeriesItem(it) ? state.detailEpisode : null); }
        else if (kind === 'language') { openPlaySettingsDialog(it); }
        else if (kind === 'source') { changeStremioSource(it, state.detailEpisode); }
        else if (kind === 'download') { startTitleDownload(it, state.detailEpisode); }
        else if (kind === 'favorite' || kind === 'mylist') {
          var enabled = kind === 'favorite' ? toggleFavorite(it) : toggleMyList(it);
          this.classList.toggle('is-selected', enabled);
          showToast(kind === 'favorite' ? (enabled ? 'Se añadió a favoritos' : 'Se quitó de favoritos')
            : (enabled ? 'Se añadió a Mi lista' : 'Se quitó de Mi lista'));
          var label = this.querySelector('span');
          var text = kind === 'favorite'
            ? (desk ? (enabled ? 'Quitar de favoritos' : 'Añadir a favoritos') : (enabled ? 'En favoritos' : 'Favorito'))
            : (enabled ? 'Quitar de Mi lista' : 'Añadir a Mi lista');
          if (label) { label.textContent = text; }
          if (this.classList.contains('is-icon-only')) {
            this.setAttribute('data-tip', text);
            this.setAttribute('aria-label', text);
          }
        } else if (kind === 'subscribe') {
          var img = this.querySelector('img');
          var on = img.src.indexOf('subscribed') === -1;
          img.src = 'assets/original/vod/icon_detail_' + (on ? 'subscribed' : 'subscribe') + '.png';
        }
      };
    })(btnDefs[b].kind, item);
    detailButtons.appendChild(btn);
  }
  syncStartOverButton(item);
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
    if (window.OPENTV_DESKTOP && state.playerItem === item && playerVideo && playerVideo.currentSrc) restartCurrentPlayback();
  };
  /* Desktop: compatibility is automatic (see tryCompatFallback); the manual
     choice lives in the player settings, not next to Play. */
  if (!desk && canPlay) { detailButtons.appendChild(modeBtn); }

  renderDetailBottom(item);
  /* Rebuilt once the full details arrive: the remote must not stay on the
     buttons that were just replaced (nothing looked focused). */
  if (state.screen === 'detail' && (!state.focus || !document.documentElement.contains(state.focus))) {
    var firstBtn = detailButtons.querySelector('.focusable');
    if (firstBtn) { setFocus(firstBtn, true); }
  }
}

/* Episode ranges: only very long series are split ("1-100", "101-200"…),
   so a season of 25 is one row (it was cut at 20 for no reason); a
   1,000-episode anime still does not draw every card at once. */
var DETAIL_RANGE_SIZE = 100;
function detailRanges(count) {
  var out = [];
  for (var s = 0; s < count; s += DETAIL_RANGE_SIZE) {
    out.push({ start: s, end: Math.min(count, s + DETAIL_RANGE_SIZE) });
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
  if (window.OPENTV_DESKTOP) {
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
      var compact = window.OPENTV_DESKTOP && item.seasons.length > 6;
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
          /* The addon gave every season's episodes with the title. */
          var targetSeason = item.seasons[sIndex];
          if (targetSeason) {
            item.episodes = targetSeason._episodes || [];
            item.seasonId = targetSeason.id;
            state.detailEpisode = item.episodes[0] || null;
            buildDetail(item);
            /* Changing season only shows its episodes. (It used to start
               the first one: with addons that searched a torrent and played
               it without the viewer asking.) */
            if (state.detailEpisode && autoPreviewAllowed(item)) { startPlayerVideo(item, state.detailEpisode); }
            var sBtn = detailBottom ? detailBottom.querySelector('.detail-season') : null;
            if (sBtn) { setFocus(sBtn); }
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
  if (focusedChild) { setFocus(focusedChild, !!window.OPENTV_DESKTOP); }
}

/* Desktop layout: one scrollable column (episodes, then related titles)
   laid out by CSS instead of fixed TV coordinates. */
function renderDetailBottomDesktop(item) {
  var episodes = (isSeriesItem(item) && item.episodes) ? item.episodes : [];
  var ranges = detailRanges(episodes.length);
  if (state.detailRange >= ranges.length) { state.detailRange = 0; }
  detailBottom.classList.add('dd-flow');
  /* PC: the whole page scrolls (the top too), not only this part. TVs keep
     their own scrolling list under the buttons. */
  var pageScroll = !platformIsTv();
  detailBottom.classList.toggle('scrollable', !pageScroll);
  var detailScreen = $('screen-detail');
  if (detailScreen) {
    detailScreen.classList.toggle('scrollable', pageScroll);
    detailScreen.classList.toggle('is-page-scroll', pageScroll);
  }

  if (isSeriesItem(item)) {
    var epSection = el('section', 'dd-section');
    var head = el('div', 'dd-head');
    var tvDetail = platformIsTv();
    /* TVs: the season button says enough (no "Episodios" title or count). */
    if (!tvDetail) { head.appendChild(el('h2', 'dd-title', 'Episodios')); }
    /* TVs: "Viendo" only on the episode really in the history, not on the
       first one of a series never watched. */
    var watchedRec = tvDetail ? historyRecordFor(item) : null;
    var watchedEp = watchedRec && watchedRec.episodeId ? String(watchedRec.episodeId) : '';

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
    if (episodes.length && !tvDetail) {
      head.appendChild(el('span', 'dd-count', episodes.length + (episodes.length === 1 ? ' episodio' : ' episodios')));
    }
    epSection.appendChild(head);

    if (episodes.length > DETAIL_RANGE_SIZE) {
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
      /* Addon series with a picture per episode (Cinemeta has them): cards
         with the picture, the title and two lines of summary. */
      var cards = !!item._stremio && episodes.some(function (x) { return x.thumb && x.thumb !== item.backdrop && x.thumb !== item.poster; });
      /* One sideways row, with arrows like "Recomendaciones". */
      var grid = el('div', 'detail-episodes dd-grid dd-ep-row scrollable' + (cards ? ' has-cards' : ''));
      for (var e = current.start; e < current.end; e++) {
        (function (ep, index) {
          var isPlaying = tvDetail ? (!!watchedEp && String(ep.id) === watchedEp)
            : (state.detailEpisode && (state.detailEpisode.id === ep.id || state.detailEpisode === ep));
          var tile = el('div', 'detail-episode focusable' + (isPlaying ? ' is-playing' : ''));
          tile._epIndex = index;
          var numText = (ep.number !== undefined && ep.number !== null) ? String(ep.number) : String(index + 1);
          var title = episodeDisplayTitle(item, ep, index);
          var play = el('i', 'ep-play');
          play.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
          if (cards) {
            var thumb = el('div', 'ep-thumb');
            if (ep.thumb) { thumb.style.backgroundImage = 'url("' + String(sizedImageUrl(ep.thumb, 480)).replace(/"/g, '%22') + '")'; }
            thumb.appendChild(play);
            tile.appendChild(thumb);
            var cardText = el('span', 'ep-info');
            cardText.appendChild(el('span', 'ep-title', numText + '. ' + (title !== 'Episodio ' + numText ? title : 'Capítulo ' + numText)));
            var cdur = episodeDurationLabel(ep);
            if (cdur) { cardText.appendChild(el('span', 'ep-meta', cdur)); }
            if (ep.synopsis) { cardText.appendChild(el('span', 'ep-syn', ep.synopsis)); }
            cardText.appendChild(el('span', 'ep-now', 'Viendo'));
            tile.appendChild(cardText);
            tile.title = 'Capítulo ' + numText + (title ? ' · ' + title : '');
            tile._ep = ep;
            tile._activate = function () { selectDetailEpisode(item, ep); };
            grid.appendChild(tile);
            return;
          }
          tile.appendChild(el('span', 'ep-num', numText));
          var info = el('span', 'ep-info');
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
          tile.appendChild(play);
          tile.title = 'Episodio ' + numText + (title && title !== 'Episodio ' + numText ? ' · ' + title : '');
          tile._ep = ep;
          /* Like the cards: picks the episode and loads its sources first. */
          tile._activate = function () { selectDetailEpisode(item, ep); };
          grid.appendChild(tile);
        })(episodes[e], e);
      }
      /* The season's episodes in Spanish (home/catalog-lang.js), written
         into the cards already drawn when they arrive. */
      var seasonNow = item.seasons && item.seasons[state.detailSeason];
      var seasonNo = seasonNow ? (seasonNow.number || state.detailSeason + 1) : 1;
      localizeSeason(item, seasonNo, episodes, function (changed) {
        if (changed && grid.isConnected) { refreshEpisodeTiles(item, grid); }
      });
      /* Kitsu's anime: TMDB's pictures when the series matches for sure. */
      animeEpisodeStills(item, episodes, function (changed) {
        if (changed && grid.isConnected) { refreshEpisodeTiles(item, grid); }
      });
      var epWrap = el('div', 'dd-related-wrap dd-ep-wrap');
      epWrap.appendChild(grid);
      addDetailRowArrows(epWrap, grid, 'Capítulos anteriores', 'Más capítulos');
      epSection.appendChild(epWrap);
      /* The episode being watched in view (row opened at its place). */
      setTimeout(function () {
        var now = grid.querySelector('.detail-episode.is-playing');
        if (now && now.offsetLeft > grid.clientWidth - now.offsetWidth) { grid.scrollLeft = now.offsetLeft - 40; }
      }, 0);
    } else if (item._detailsLoaded && !item._detailLoading) {
      /* Loaded and still no episodes: say so instead of a loader that
         never ends (a plugin that gave the series but not its episodes). */
      epSection.appendChild(el('p', 'dd-empty', item._detailError || 'Tus plugins no dan los capítulos de esta serie.'));
    } else {
      epSection.appendChild(makeLoader('Cargando episodios…', 'is-small'));
    }
    detailBottom.appendChild(epSection);
  }

  var relSection = el('section', 'dd-section');
  relSection.appendChild(el('h2', 'dd-title detail-related', 'Recomendaciones'));
  /* A sideways row of up to 30 similar titles (same kind, shared genres),
     with arrows; the wheel keeps scrolling the page. */
  var relWrap = el('div', 'dd-related-wrap');
  var rel = el('div', 'detail-grid dd-related scrollable');
  var related = relatedTitles(item, 30);
  for (var r = 0; r < related.length; r++) {
    var cell = el('div', 'cell');
    /* (No name under it: as on the home rows; the hover card says it.) */
    cell.appendChild(makePoster(related[r], 0, 0, 190, 279, { gold: true }));
    rel.appendChild(cell);
  }
  relWrap.appendChild(rel);
  addDetailRowArrows(relWrap, rel, 'Anteriores', 'Más títulos');
  relSection.appendChild(relWrap);
  detailBottom.appendChild(relSection);
  /* TVs, a series: the screen stays still and the lower part shows one
     section at a time, the episodes first (core/focus.js
     tvDetailSectionMove swaps them for Recomendaciones and back). */
  var sectioned = platformIsTv() && isSeriesItem(item) && detailBottom.querySelectorAll('.dd-section').length > 1;
  detailBottom.classList.toggle('tv-sections', sectioned);
  detailBottom.classList.toggle('show-ep', sectioned);
  detailBottom.classList.remove('show-rel');
  detailBottom._lastEp = null;
}

/* New names and summaries (catalogue language) into the episode cards. */
function refreshEpisodeTiles(item, grid) {
  var tiles = grid.querySelectorAll('.detail-episode');
  var cards = grid.classList.contains('has-cards');
  for (var i = 0; i < tiles.length; i++) {
    var ep = tiles[i]._ep;
    if (!ep) { continue; }
    var idx = tiles[i]._epIndex || 0;
    var num = (ep.number !== undefined && ep.number !== null) ? String(ep.number) : String(idx + 1);
    var name = episodeDisplayTitle(item, ep, idx);
    var tNode = tiles[i].querySelector('.ep-title');
    if (tNode) { tNode.textContent = cards ? num + '. ' + (name !== 'Episodio ' + num ? name : 'Capítulo ' + num) : name; }
    var sNode = tiles[i].querySelector('.ep-syn');
    if (sNode && ep.synopsis) { sNode.textContent = ep.synopsis; }
    var thumb = tiles[i].querySelector('.ep-thumb');
    if (thumb && ep.thumb) { thumb.style.backgroundImage = 'url("' + String(sizedImageUrl(ep.thumb, 480)).replace(/"/g, '%22') + '")'; }
  }
}

/* Picking an episode on the details screen (PC and TVs): Reproducir now
   plays it, and its sources are looked up first (kept for a while, so
   "Elegir fuente" opens with them at once). Reproducir and Cambiar fuente
   stay off until the lookup ends. On a TV the focus goes up to Reproducir,
   so the next OK plays; OK again on the picked episode once its sources are
   ready plays it too. */
var detailEpisodeLookup = 0;
var detailEpisodeReady = null;

/* Reproducir and Cambiar fuente on or off while an episode's sources load. */
function setDetailPlayWaiting(waiting) {
  if (!detailButtons) { return; }
  ['fullscreen', 'source'].forEach(function (kind) {
    var b = detailButtons.querySelector('.detail-btn[data-kind="' + kind + '"]');
    if (!b) { return; }
    b.classList.toggle('is-waiting', !!waiting);
    if (waiting) { b.setAttribute('aria-disabled', 'true'); } else { b.removeAttribute('aria-disabled'); }
  });
}

function selectDetailEpisode(item, ep) {
  if (detailEpisodeReady === ep && state.detailEpisode === ep) { playEpisode(item, ep); return; }
  state.detailEpisode = ep;
  detailEpisodeReady = null;
  syncDetailEpisodeHighlight(item);
  var season = item.seasons && item.seasons[state.detailSeason];
  var code = (season && season.number ? 'T' + season.number + ':' : '') + 'E' + (ep.number || '');
  var resume = resumeLabelFor(item);
  var playSpan = detailButtons ? detailButtons.querySelector('.detail-btn[data-kind="fullscreen"] span') : null;
  if (playSpan) { playSpan.textContent = resume && resume.indexOf(code) !== -1 ? resume : 'Reproducir ' + code; }
  syncStartOverButton(item);
  var status = detailButtons ? detailButtons.querySelector('.detail-ep-status') : null;
  var playBtn = detailButtons ? detailButtons.querySelector('.detail-btn[data-kind="fullscreen"]') : null;
  if (platformIsTv() && playBtn) { setFocus(playBtn); }
  if (!item._stremio || item._plain || !hasSourceAddons() || downloadedFileFor(item, ep)) {
    if (status) { status.textContent = ''; }
    setDetailPlayWaiting(false);
    detailEpisodeReady = ep;
    return;
  }
  if (!status) {
    status = el('span', 'detail-ep-status');
    status.setAttribute('aria-live', 'polite');
    detailButtons.appendChild(status);
  }
  var mine = ++detailEpisodeLookup;
  var name = 'Capítulo ' + (ep.number || '');
  status.textContent = 'Buscando fuentes del ' + name.toLowerCase() + '…';
  status.className = 'detail-ep-status is-busy';
  setDetailPlayWaiting(true);
  fetchStremioStreams(item, ep, function (groups, pending) {
    if (mine !== detailEpisodeLookup || pending) { return; }
    if (state.screen !== 'detail' || state.detailEpisode !== ep) { return; }
    var count = 0;
    groups.forEach(function (g) { count += g.sources.length; });
    /* The result as a toast, like the app's other notices; the line next
       to the buttons only shows the search in progress. */
    status.className = 'detail-ep-status';
    status.textContent = '';
    showToast(count ? (name + ' · ' + count + (count === 1 ? ' fuente lista' : ' fuentes listas')) : ('Sin fuentes para el ' + name.toLowerCase()),
      count ? 'ok' : 'info');
    /* Cambiar fuente opens even with none (it says why); Reproducir only
       with something to play. */
    setDetailPlayWaiting(false);
    if (!count && playBtn) {
      playBtn.classList.add('is-waiting');
      playBtn.setAttribute('aria-disabled', 'true');
    }
    if (count) { detailEpisodeReady = ep; }
  });
}

/* The two arrows of a sideways row (episodes, "Recomendaciones"): one
   page of the row per click; hidden at each end. */
function addDetailRowArrows(wrap, strip, prevLabel, nextLabel) {
  ['prev', 'next'].forEach(function (dir) {
    var arrow = el('button', 'dd-rel-arrow is-' + dir);
    arrow.type = 'button';
    arrow.innerHTML = dir === 'prev' ? UI_ICONS.prev : UI_ICONS.next;
    arrow.setAttribute('aria-label', dir === 'prev' ? prevLabel : nextLabel);
    arrow.addEventListener('click', function (event) {
      event.stopPropagation();
      var by = Math.max(300, strip.clientWidth * 0.8) * (dir === 'prev' ? -1 : 1);
      try { strip.scrollBy({ left: by, behavior: 'smooth' }); } catch (eScroll) { strip.scrollLeft += by; }
    });
    wrap.appendChild(arrow);
  });
  function syncArrows() {
    wrap.classList.toggle('at-start', strip.scrollLeft <= 4);
    wrap.classList.toggle('at-end', strip.scrollLeft >= strip.scrollWidth - strip.clientWidth - 4);
    schedulePosterMemoryPass();
  }
  strip.addEventListener('scroll', syncArrows, { passive: true });
  wrap.addEventListener('mouseenter', syncArrows);
  setTimeout(syncArrows, 0);
}

function renderDetailBottom(item) {
  if (window.OPENTV_DESKTOP) { return renderDetailBottomDesktop(item); }
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
  if (hasEpisodes && episodes.length > DETAIL_RANGE_SIZE) {
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
  var heading = el('div', 'detail-related', 'Recomendaciones');
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
  var title = detailLeft.querySelector('.detail-title');
  function overflowing() { return detailLeft.scrollHeight > detailLeft.clientHeight + 1; }
  function fit() {
    if (!detailLeft.clientHeight || !text) { return; }
    text.style.webkitLineClamp = '';
    if (title) { title.style.fontSize = ''; }
    var rows = detailLeft.querySelectorAll('.detail-row');
    for (var r = 0; r < rows.length; r++) { rows[r].style.display = ''; }
    /* The whole title always shows: first the synopsis gives up lines, then
       Dirección / Reparto go, and only then the title gets smaller. */
    for (var lines = 2; overflowing() && lines >= 1; lines--) { text.style.webkitLineClamp = String(lines); }
    for (var k = 0; overflowing() && k < rows.length; k++) { rows[k].style.display = 'none'; }
    if (title) {
      var size = parseFloat(window.getComputedStyle(title).fontSize) || 52;
      var cut = function () { return title.scrollHeight > title.clientHeight + 2; };
      while ((overflowing() || cut()) && size > 32) { size -= 3; title.style.fontSize = size + 'px'; }
    }
  }
  setTimeout(fit, 0);
  /* Once more when the page has settled (fonts, entrance animation): the
     first pass can measure too early and leave the title too small. */
  setTimeout(function () { if (detailLeft && detailLeft.contains(syn)) { fit(); } }, 450);
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
