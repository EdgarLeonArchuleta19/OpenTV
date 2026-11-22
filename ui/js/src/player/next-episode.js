/* player/next-episode.js — Al terminar un episodio: cuenta atrás de 10 s con "Siguiente episodio" o "Salir".
   Parte del módulo único de la app (ver ui/js/src/README.md). */

var NEXT_EPISODE_SECONDS = 10;
var nextEpisodePrompt = null;
var nextEpisodeTimer = null;
var nextEpisodeTick = null;

/* The episode after the current one: { episode, label } or null. */
function upcomingEpisode(item) {
  var episodes = episodeListForCurrentSeason(item);
  var current = state.playerEpisode;
  for (var i = 0; i < episodes.length; i++) {
    if (current && (episodes[i].id === current.id || episodes[i].number === current.number)) {
      if (i + 1 < episodes.length) {
        var ep = episodes[i + 1];
        var num = (ep.number !== undefined && ep.number !== null) ? ep.number : i + 2;
        var title = episodeDisplayTitle(item, ep, i + 1);
        return { label: 'Episodio ' + num + (title && title !== 'Episodio ' + num ? ' · ' + title : '') };
      }
      break;
    }
  }
  var seasons = seriesSeasons(item);
  if (seasons[(state.playerSeasonIndex || 0) + 1]) { return { label: 'Primer episodio de la siguiente temporada' }; }
  return null;
}

function offerNextEpisode() {
  var item = state.playerItem;
  if (!item || !isSeriesItem(item) || state.screen !== 'player') { return; }
  var next = upcomingEpisode(item);
  if (!next) { return; }
  hideNextEpisodePrompt();
  showOsdIcon('none');
  if (!nextEpisodePrompt) {
    nextEpisodePrompt = el('div', 'next-episode-prompt');
    nextEpisodePrompt.setAttribute('data-no-gesture', '');
    nextEpisodePrompt.addEventListener('click', function (event) { event.stopPropagation(); });
    playerStage.appendChild(nextEpisodePrompt);
  }
  clear(nextEpisodePrompt);
  nextEpisodePrompt.appendChild(el('div', 'nep-kicker', 'Siguiente episodio'));
  nextEpisodePrompt.appendChild(el('div', 'nep-title', next.label));
  var bar = el('div', 'nep-bar');
  var fill = el('i', 'nep-fill');
  fill.style.animationDuration = NEXT_EPISODE_SECONDS + 's';
  bar.appendChild(fill);
  nextEpisodePrompt.appendChild(bar);
  var actions = el('div', 'nep-actions');
  var go = el('div', 'nep-btn is-primary focusable');
  go.innerHTML = UI_ICONS.play + '<span>Reproducir ahora · ' + NEXT_EPISODE_SECONDS + '</span>';
  var label = go.querySelector('span');
  go._activate = function () { hideNextEpisodePrompt(); advanceToNextEpisode(); };
  var exit = el('div', 'nep-btn focusable');
  exit.innerHTML = UI_ICONS.back + '<span>Salir</span>';
  exit._activate = function () { hideNextEpisodePrompt(); desktopBack(); };
  /* The card stops clicks from reaching the video, so the buttons handle
     their own clicks. */
  go.addEventListener('click', function () { go._activate(); });
  exit.addEventListener('click', function () { exit._activate(); });
  actions.appendChild(go);
  actions.appendChild(exit);
  nextEpisodePrompt.appendChild(actions);
  nextEpisodePrompt.classList.add('is-visible');
  setFocus(go, true);

  var left = NEXT_EPISODE_SECONDS;
  nextEpisodeTick = setInterval(function () {
    left--;
    if (label) { label.textContent = 'Reproducir ahora · ' + Math.max(0, left); }
    if (state.screen !== 'player' || state.playerItem !== item) { hideNextEpisodePrompt(); }
  }, 1000);
  nextEpisodeTimer = setTimeout(function () {
    hideNextEpisodePrompt();
    if (state.screen === 'player' && state.playerItem === item) { advanceToNextEpisode(); }
  }, NEXT_EPISODE_SECONDS * 1000);
  /* Seeking back or pressing play again means "keep watching this one". */
  playerVideo.addEventListener('play', hideNextEpisodePrompt, { once: true });
}

function hideNextEpisodePrompt() {
  if (nextEpisodeTimer) { clearTimeout(nextEpisodeTimer); nextEpisodeTimer = null; }
  if (nextEpisodeTick) { clearInterval(nextEpisodeTick); nextEpisodeTick = null; }
  if (nextEpisodePrompt) {
    nextEpisodePrompt.classList.remove('is-visible');
    /* Focus left on a hidden button: back to the video. */
    if (state.focus && nextEpisodePrompt.contains(state.focus) && playerStage && state.screen === 'player') { setFocus(playerStage, true); }
  }
}

/* ------------------------------------------- Apple TV+ style hero loader */
var playerHeroLoad = null;

function showPlayerHeroLoad(item, episode) {
  if (!playerStage || !item || state.playerMode !== 'vod') { return; }
  if (!playerHeroLoad) {
    playerHeroLoad = el('div', 'player-hero-load');
    playerHeroLoad.id = 'player-hero-load';
    playerStage.appendChild(playerHeroLoad);
  }
  clear(playerHeroLoad);
  var bg = item.backdrop || item.landscape || item.poster || '';
  if (bg) {
    var bgEl = el('div', 'phl-bg');
    bgEl.style.backgroundImage = 'url("' + bg.replace(/"/g, '%22') + '")';
    playerHeroLoad.appendChild(bgEl);
  }
  var center = el('div', 'phl-center');
  if (item.logo) {
    var logoImg = document.createElement('img');
    logoImg.className = 'phl-logo';
    logoImg.alt = item.title || '';
    logoImg.src = item.logo;
    logoImg.onerror = function () {
      if (logoImg.parentNode) {
        var fallbackTitle = el('div', 'phl-title', item.title || '');
        logoImg.parentNode.replaceChild(fallbackTitle, logoImg);
      }
    };
    center.appendChild(logoImg);
  } else {
    center.appendChild(el('div', 'phl-title', item.title || ''));
  }
  if (episode) {
    var epSub = (episode.season ? 'T' + episode.season + ' · ' : '') +
      (episode.number ? 'E' + episode.number : '') +
      (episode.title ? ' · ' + episode.title : '');
    if (epSub) { center.appendChild(el('div', 'phl-sub', epSub)); }
  }
  center.appendChild(el('div', 'phl-status', 'Conectando con el vídeo…'));
  playerHeroLoad.appendChild(center);
  playerHeroLoad.classList.add('is-visible');
}

function updatePlayerHeroLoadStatus(text) {
  if (!playerHeroLoad || !playerHeroLoad.classList.contains('is-visible')) { return; }
  var st = playerHeroLoad.querySelector('.phl-status');
  if (st && text) { st.textContent = text; }
}

function hidePlayerHeroLoad() {
  if (playerHeroLoad) { playerHeroLoad.classList.remove('is-visible'); }
}

/* ------------------------------------------- Skip Intro (IntroDB) */
var activeIntroSeg = null;
var skipIntroBtn = null;
var skipIntroQueryKey = '';

function clearSkipIntro() {
  activeIntroSeg = null;
  skipIntroQueryKey = '';
  if (skipIntroBtn) { skipIntroBtn.classList.remove('is-visible'); }
}

function loadSkipIntroSegments(item, episode) {
  clearSkipIntro();
  if (!item || !episode || !isSeriesItem(item)) { return; }
  var imdb = String(item._stremioId || item.id || '').replace(/^stremio:/, '').split(':')[0];
  if (!/^tt\d{5,}$/.test(imdb)) { return; }
  var hint = typeof torrentEpisodeHint === 'function' ? torrentEpisodeHint(episode) : { season: 0, episode: 0 };
  var sNum = hint.season || episode.season || 1;
  var eNum = hint.episode || episode.number || 0;
  if (!eNum) { return; }
  var qKey = imdb + ':' + sNum + ':' + eNum;
  skipIntroQueryKey = qKey;
  var url = 'https://api.introdb.app/intro?imdb_id=' + encodeURIComponent(imdb) + '&season=' + sNum + '&episode=' + eNum;
  addonRequest(url, function (err, data) {
    if (err || !data || skipIntroQueryKey !== qKey) { return; }
    var start = Number(data.start_sec !== undefined ? data.start_sec : data.start);
    var end = Number(data.end_sec !== undefined ? data.end_sec : data.end);
    if (isFinite(start) && isFinite(end) && end > start + 5 && start >= 0 && end < 1800) {
      activeIntroSeg = { start: start, end: end, skipped: false };
    }
  }, 6000);
}

/* Is "Saltar intro" on screen? (OK on the remote skips it then.) */
function skipIntroShown() {
  return !!(skipIntroBtn && skipIntroBtn.classList.contains('is-visible') && activeIntroSeg && !activeIntroSeg.skipped);
}

function updateSkipIntroButton(cur) {
  if (!playerStage || !activeIntroSeg || activeIntroSeg.skipped) {
    if (skipIntroBtn) { skipIntroBtn.classList.remove('is-visible'); }
    return;
  }
  var show = cur >= activeIntroSeg.start && cur < activeIntroSeg.end - 1;
  if (!show) {
    if (skipIntroBtn) { skipIntroBtn.classList.remove('is-visible'); }
    return;
  }
  if (!skipIntroBtn) {
    skipIntroBtn = el('div', 'skip-intro-btn focusable');
    skipIntroBtn.setAttribute('data-no-gesture', '');
    /* TVs: the key to press, since the remote's arrows seek. */
    skipIntroBtn.innerHTML = platformIsTv() ? '<span class="skip-intro-key">OK</span><span>Saltar intro</span>' : '<span>Saltar intro</span>';
    skipIntroBtn._activate = function () {
      if (!activeIntroSeg || !playerVideo) { return; }
      var target = activeIntroSeg.end;
      activeIntroSeg.skipped = true;
      skipIntroBtn.classList.remove('is-visible');
      var curPos = vodPlaybackPosition();
      if (target > curPos) { playerSeek(target - curPos); }
    };
    skipIntroBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      skipIntroBtn._activate();
    });
    playerStage.appendChild(skipIntroBtn);
  }
  skipIntroBtn.classList.add('is-visible');
}

/* ------------------------------------------- External Player / Cast */
function openCurrentInExternalPlayer() {
  var item = state.playerItem;
  var ep = isSeriesItem(item) ? state.playerEpisode : null;
  var src = (ep ? ep._stremioSource : (item && item._stremioSource)) || null;
  var url = lastPlayingUrl || (src && src.url) || '';
  if (!/^https?:\/\//i.test(url)) {
    if (typeof showToast === 'function') { showToast('No hay un enlace de vídeo activo para abrir afuera', 'err'); }
    return;
  }
  var title = (item && item.title) || 'OpenTV';
  if (playerVideo && !playerVideo.paused) { try { playerVideo.pause(); } catch (e) {} }
  if (window.desktop && typeof window.desktop.openExternalPlayer === 'function') {
    window.desktop.openExternalPlayer(url).then(function (r) {
      if (typeof showToast === 'function') {
        showToast(r && r.ok ? ('Abriendo en ' + (r.app || 'reproductor externo') + '…') : ((r && r.error) || 'No se pudo abrir'), r && r.ok ? 'ok' : 'err');
      }
    });
    return;
  }
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BrowserCapture &&
      typeof window.Capacitor.Plugins.BrowserCapture.openExternalPlayer === 'function') {
    window.Capacitor.Plugins.BrowserCapture.openExternalPlayer({ url: url, title: title }).then(function (r) {
      if (typeof showToast === 'function') {
        showToast(r && r.ok ? 'Elige VLC, MX Player o app para enviar a la tele' : ((r && r.error) || 'No se pudo abrir'), r && r.ok ? 'ok' : 'err');
      }
    });
    return;
  }
  if (typeof showToast === 'function') { showToast('No disponible en este navegador', 'info'); }
}

/* ------------------------------------------- Phone touch gestures (VLC/YT) */
var phoneGesturesInstalled = false;
var phoneBrightness = 1;
function installPhonePlayerGestures() {
  if (phoneGesturesInstalled || !playerStage || typeof isPhone !== 'function' || !isPhone()) { return; }
  phoneGesturesInstalled = true;
  var osd = el('div', 'phone-gesture-osd');
  playerStage.appendChild(osd);
  var osdTimer = null;
  function showGestureOsd(text) {
    osd.textContent = text;
    osd.classList.add('is-visible');
    if (osdTimer) { clearTimeout(osdTimer); }
    osdTimer = setTimeout(function () { osd.classList.remove('is-visible'); }, 900);
  }
  var lastTapTime = 0, lastTapX = 0;
  var drag = null;
  playerStage.addEventListener('touchstart', function (ev) {
    if (!ev.touches || ev.touches.length !== 1) { drag = null; return; }
    if (ev.target && ev.target.closest && ev.target.closest('[data-no-gesture], button, .player-vod-infobar, .vod-seekbar')) { drag = null; return; }
    var t = ev.touches[0];
    var rect = playerStage.getBoundingClientRect();
    var side = (t.clientX - rect.left) < rect.width * 0.5 ? 'left' : 'right';
    drag = {
      x: t.clientX, y: t.clientY, side: side, active: false,
      startVol: playerVideo ? (playerVideo.volume || 1) : 1,
      startBright: phoneBrightness
    };
  }, { passive: true });
  playerStage.addEventListener('touchmove', function (ev) {
    if (!drag || !ev.touches || ev.touches.length !== 1) { return; }
    var t = ev.touches[0];
    var dx = t.clientX - drag.x;
    var dy = drag.y - t.clientY;
    if (!drag.active) {
      if (Math.abs(dy) < 18 || Math.abs(dy) < Math.abs(dx)) { return; }
      drag.active = true;
    }
    var delta = dy / 220;
    if (drag.side === 'right' && playerVideo) {
      var v = Math.max(0, Math.min(1, drag.startVol + delta));
      try { playerVideo.volume = v; playerVideo.muted = v === 0; } catch (e) {}
      showGestureOsd('Volumen ' + Math.round(v * 100) + '%');
    } else if (drag.side === 'left' && playerVideo) {
      phoneBrightness = Math.max(0.35, Math.min(1.35, drag.startBright + delta));
      playerVideo.style.filter = 'brightness(' + phoneBrightness.toFixed(2) + ')';
      showGestureOsd('Brillo ' + Math.round((phoneBrightness - 0.35) * 100) + '%');
    }
  }, { passive: true });
  playerStage.addEventListener('touchend', function (ev) {
    if (!drag) { return; }
    var wasDrag = drag.active;
    var side = drag.side;
    var x = drag.x;
    drag = null;
    if (wasDrag) { return; }
    var now = Date.now();
    if (now - lastTapTime < 280 && Math.abs(x - lastTapX) < 120 && state.playerMode === 'vod') {
      lastTapTime = 0;
      if (side === 'left') { playerSeek(-10); showGestureOsd('« -10 s'); }
      else { playerSeek(10); showGestureOsd('+10 s »'); }
    } else {
      lastTapTime = now;
      lastTapX = x;
    }
  }, { passive: true });
}
