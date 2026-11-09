/* player/settings-dialog.js — Diálogo de audio/subtítulos, formato de pantalla y cambio de pista.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

function renderPlaySettingPlayerOptions() {
  /* 'normal' is the default direct path; only 'relay'/'smooth' means FFmpeg. */
  var isRelay = (state.streamMode === 'relay' || state.streamMode === 'smooth');
  if (psvBtnP1) {
    psvBtnP1.classList.toggle('is-selected', isRelay);
    var chk1 = psvBtnP1.querySelector('.psv-check');
    if (chk1) chk1.style.display = isRelay ? 'block' : 'none';
  }
  if (psvBtnP2) {
    psvBtnP2.classList.toggle('is-selected', !isRelay);
    var chk2 = psvBtnP2.querySelector('.psv-check');
    if (chk2) chk2.style.display = !isRelay ? 'block' : 'none';
  }
}

function renderPlaySettingAspectOptions() {
  if (!psvAspectRow) return;
  var btns = psvAspectRow.querySelectorAll('.psv-btn');
  for (var i = 0; i < btns.length; i++) {
    var asp = btns[i].getAttribute('data-aspect');
    var isSel = (asp === playerCurrentAspect);
    btns[i].classList.toggle('is-selected', isSel);
    var chk = btns[i].querySelector('.psv-check');
    if (chk) chk.style.display = isSel ? 'block' : 'none';
  }
}

function setPlayerAspect(aspect) {
  playerCurrentAspect = aspect || 'contain';
  if (playerVideo) {
    playerVideo.classList.remove('aspect-cover', 'aspect-contain', 'aspect-16-9', 'aspect-4-3');
    playerVideo.classList.add('aspect-' + playerCurrentAspect);
  }
  renderPlaySettingAspectOptions();
}

function openPlaySettingsDialog(fromItem) {
  if (!dialogPlaySettings) { buildPlayer(); }
  if (!dialogPlaySettings) return;
  if (playSettingTimer) { clearTimeout(playSettingTimer); playSettingTimer = null; }
  dialogPlaySettingsOpen = true;
  dialogReturnFocus = state.focus;

  var item = fromItem || playSettingsItem();
  if (state.screen === 'detail') { item = state.detail || item; }

  renderDialogAudio();
  renderDialogSubtitle();
  applySubtitleStyles();

  dialogPlaySettings.classList.add('is-active');

  ensureMediaInfo(item, function () {
    if (!dialogPlaySettingsOpen) { return; }
    renderDialogAudio();
    renderDialogSubtitle();
  });

  /* Focus first audio pill or switch */
  var firstFocus = (dpsAudioOptions && dpsAudioOptions.querySelector('.focusable')) || dpsSubSwitch || dpsBtnExit;
  if (firstFocus) { setFocus(firstFocus); }
}

function closePlaySettingsDialog() {
  dialogPlaySettingsOpen = false;
  if (dialogPlaySettings) { dialogPlaySettings.classList.remove('is-active'); }
  if (playSettingViewOpen) {
    if (psvBtnConfig) { setFocus(psvBtnConfig); }
    schedulePlaySettingHide();
  } else if (dialogReturnFocus && isVisible(dialogReturnFocus)) {
    setFocus(dialogReturnFocus);
  } else if (state.screen === 'player') {
    setFocus(playerStage);
  }
  dialogReturnFocus = null;
}

function renderDialogAudio() {
  if (!dpsAudioOptions) return;
  clear(dpsAudioOptions);

  var info = mediaInfoCache[mediaInfoKey(playSettingsItem())];
  if (info && !vodAudioChosen) {
    vodCurrentAudioTrack = preferredAudioIndex(info.audio);
  }
  var tracks = audioLanguageList(info);
  if (!tracks.length) {
    /* mediaInfo has not answered yet: keep the current language visible. */
    tracks = [{ index: vodCurrentAudioTrack || 0, label: 'Español' }];
  }
  for (var t = 0; t < tracks.length; t++) {
    (function (track) {
      var btn = el('button', 'dps-btn focusable');
      btn.textContent = track.label;
      if (vodCurrentAudioTrack === track.index) { btn.classList.add('is-selected'); }
      btn._activate = function () {
        switchAudioTrack(track.index);
        renderDialogAudio();
        schedulePlaySettingHide();
      };
      dpsAudioOptions.appendChild(btn);
    })(tracks[t]);
  }
}

function renderDialogSubtitle() {
  var info = mediaInfoCache[mediaInfoKey(playSettingsItem())];
  var list = subtitleLanguageList(info);

  if (dpsSubSwitch) {
    /* Without subtitle files there is nothing to switch on. */
    var switchRow = dpsSubSwitch.parentNode;
    if (switchRow) { switchRow.classList.toggle('is-hidden', !list.length); }
    dpsSubSwitch.classList.toggle('is-on', vodSubActive);
    var dotText = dpsSubSwitch.querySelector('.dps-switch-text');
    if (dotText) dotText.textContent = vodSubActive ? 'ON' : 'OFF';
  }

  if (dpsRowLang) dpsRowLang.classList.toggle('is-visible', vodSubActive && list.length > 0);
  if (dpsRowSize) dpsRowSize.classList.toggle('is-visible', vodSubActive && list.length > 0);
  if (dpsRowStyle) dpsRowStyle.classList.toggle('is-visible', vodSubActive && list.length > 0);

  if (!vodSubActive) return;

  /* Render languages */
  if (dpsLangOptions) {
    clear(dpsLangOptions);
    for (var s = 0; s < list.length; s++) {
      (function (sub) {
        var btn = el('button', 'dps-btn focusable');
        btn.textContent = formatAudioLang(sub.lang || 'Sub');
        if (vodCurrentSubtitle && vodCurrentSubtitle.url === sub.url) {
          btn.classList.add('is-selected');
        }
        btn._activate = function () {
          vodCurrentSubtitle = sub;
          vodSubActive = true;
          vodSubChosen = true;
          loadSubtitleTrack(sub);
          renderDialogSubtitle();
          schedulePlaySettingHide();
        };
        dpsLangOptions.appendChild(btn);
      })(list[s]);
    }
  }

  /* Size buttons */
  if (dpsSizeOptions) {
    var sBtns = dpsSizeOptions.querySelectorAll('.dps-btn');
    for (var si = 0; si < sBtns.length; si++) {
      var sz = sBtns[si].getAttribute('data-size');
      sBtns[si].classList.toggle('is-selected', sz === vodSubSize);
    }
  }

  /* Style buttons */
  if (dpsStyleOptions) {
    var stBtns = dpsStyleOptions.querySelectorAll('.dps-btn');
    for (var sti = 0; sti < stBtns.length; sti++) {
      var st = stBtns[sti].getAttribute('data-style');
      stBtns[sti].classList.toggle('is-selected', st === vodSubStyle);
    }
  }
}

function formatAudioLang(code) {
  var c = (code || '').toLowerCase().trim().split(/[-_]/)[0];
  if (/^(spa|esp|es|castellano|latino|lat|latam)$/.test(c)) return 'Español';
  if (/^(eng|ing|en)$/.test(c)) return 'Inglés';
  if (/^(jpn|jap|ja)$/.test(c)) return 'Japonés';
  if (/^(kor|cor|ko)$/.test(c)) return 'Coreano';
  if (/^(por|pt)$/.test(c)) return 'Portugués';
  if (/^(fra|fre|fr|franc)$/.test(c)) return 'Francés';
  if (/^(ita|it)$/.test(c)) return 'Italiano';
  if (/^(deu|ger|de)$/.test(c)) return 'Alemán';
  if (/^(chi|zho|zh)$/.test(c)) return 'Chino';
  return c ? (c.charAt(0).toUpperCase() + c.slice(1)) : 'Pista';
}

/* A direct MP4/TS source must stay direct when the viewer selects an audio
   language.  Some webOS media pipelines expose the native AudioTrackList;
   in that case the change is immediate and does not need FFmpeg.  Older
   sets expose no writable list, so we leave the existing source untouched
   instead of silently changing the player to Modo Fluido. */
function selectNativeAudioTrack(trackIndex) {
  if (!playerVideo) { return false; }
  var tracks;
  try { tracks = playerVideo.audioTracks; } catch (eTracks) { return false; }
  if (!tracks || !tracks.length || !(trackIndex >= 0 && trackIndex < tracks.length)) {
    return false;
  }
  try {
    for (var i = 0; i < tracks.length; i++) {
      tracks[i].enabled = (i === trackIndex);
    }
    return true;
  } catch (eSelect) {
    return false;
  }
}

function switchAudioTrack(trackIndex) {
  /* On the detail screen the choice is only remembered for the next play. */
  if ((state.screen !== 'player' && !(window.XUPER_DESKTOP && state.screen === 'detail' && playerVideo && playerVideo.currentSrc)) || !playerVideo) {
    vodCurrentAudioTrack = trackIndex;
    vodAudioChosen = true;
    return;
  }
  /* Normal (Directo) must never be converted to Fluido merely by opening
     the audio selector.  Use the native track list when webOS provides it.
     A TV without that API keeps its playing source and clearly tells the
     viewer that a remux is required for per-track selection. */
  if (state.streamMode !== 'relay' && state.streamMode !== 'smooth') {
    if (selectNativeAudioTrack(trackIndex)) {
      vodCurrentAudioTrack = trackIndex;
      vodAudioChosen = true;
      audioTrackSwitchUntil = Date.now() + 5000;
      setPlayerStatus('Idioma cambiado');
    } else {
      setPlayerStatus('Para cambiar a esa pista de audio, elige Ajustes → Calidad → Compatibilidad máxima.');
    }
    return;
  }
  vodCurrentAudioTrack = trackIndex;
  vodAudioChosen = true;
  /* HTML5 cannot pick a PID inside a TS/MP4, so the FFmpeg relay maps it
     with -map 0:a:<n>. */
  if (relayBaseUrl) {
    var curSec = relayStartOffset + (playerVideo.currentTime || 0);
    playUrl(relayBaseUrl + '?start=' + Math.floor(curSec) + '&a=' + trackIndex);
    return;
  }
  restartCurrentPlayback();
}

function restartCurrentPlayback() {
  if (!playerVideo) return;
  var curSec = relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
  var wasPaused = playerVideo.paused;
  var item = state.playerItem;
  stopPlayerVideo();
  setPlayerStatus('Cambiando reproductor…');
  resolvePlayerStream(item, function (url) {
    if (url) {
      if (/^https?:\/\/127\.0\.0\.1:\d+\/s\//i.test(url)) {
        var seekUrl = url + '?start=' + Math.floor(curSec);
        if (vodCurrentAudioTrack) { seekUrl += '&a=' + vodCurrentAudioTrack; }
        playUrl(seekUrl, { remainPaused: wasPaused });
      } else {
        playUrl(url, { startPosition: curSec, remainPaused: wasPaused });
      }
    } else if (!state.streamError) {
      setPlayerStatus('Sin fuente de reproducción');
    }
  });
}
