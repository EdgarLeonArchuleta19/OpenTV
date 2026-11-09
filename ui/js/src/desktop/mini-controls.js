/* desktop/mini-controls.js — Controles de la vista previa de la ficha (pausa, tiempo, barra y ampliar).
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* The detail page plays a preview in a small frame. On hover it shows a
   compact control bar: play/pause, current time / duration, a seek bar and
   a button to open the full player. Clicks on the bar never open the
   player by accident (data-no-gesture, see bindClickGestures). */
var miniControls = null;

function miniTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

function installMiniControls() {
  if (!window.XUPER_DESKTOP || !playerStage || !playerVideo || miniControls) { return; }
  miniControls = el('div', 'mini-controls');
  miniControls.setAttribute('data-no-gesture', '');

  var play = el('button', 'mc-btn mc-play');
  play.type = 'button';
  iconizeButton(play, UI_ICONS.pause, 'Pausa');
  var time = el('div', 'mc-time', '0:00');
  var bar = el('div', 'mc-bar');
  var fill = el('i', 'mc-fill');
  bar.appendChild(fill);
  var expand = el('button', 'mc-btn mc-expand');
  expand.type = 'button';
  iconizeButton(expand, UI_ICONS.expand, 'Ver en grande');

  miniControls.appendChild(play);
  miniControls.appendChild(time);
  miniControls.appendChild(bar);
  miniControls.appendChild(expand);
  playerStage.appendChild(miniControls);

  function stop(event) { event.preventDefault(); event.stopPropagation(); }
  miniControls.addEventListener('click', stop);
  miniControls.addEventListener('dblclick', stop);
  miniControls.addEventListener('pointerdown', function (event) { event.stopPropagation(); });

  play.addEventListener('click', function (event) {
    stop(event);
    togglePlayerPlayPause();
    update();
  });
  expand.addEventListener('click', function (event) {
    stop(event);
    if (playerStage._activate) { playerStage._activate(); }
  });
  bar.addEventListener('click', function (event) {
    stop(event);
    var duration = vodPlaybackDuration();
    if (!duration) { return; }
    var r = bar.getBoundingClientRect();
    var fraction = Math.max(0, Math.min(1, (event.clientX - r.left) / r.width));
    enterVodScrub();
    vodScrubTime = Math.max(0, Math.min(duration - 1, fraction * duration));
    leaveVodScrub(true);
  });

  var shownPaused = null;
  function update() {
    var scr = $('screen-player');
    if (!scr || !scr.classList.contains('is-mini')) { return; }
    var duration = vodPlaybackDuration();
    var position = vodPlaybackPosition();
    time.textContent = duration ? miniTime(position) + ' / ' + miniTime(duration) : miniTime(position);
    fill.style.width = duration ? Math.min(100, (position / duration) * 100) + '%' : '0';
    bar.classList.toggle('is-disabled', !duration);
    var paused = playerVideo.paused;
    if (paused !== shownPaused) {
      shownPaused = paused;
      setButtonText(play, paused ? 'Reproducir' : 'Pausa', paused ? UI_ICONS.play : UI_ICONS.pause);
    }
  }
  ['timeupdate', 'play', 'pause', 'durationchange', 'loadedmetadata', 'seeked'].forEach(function (type) {
    playerVideo.addEventListener(type, update);
  });
  playerStage.addEventListener('pointerenter', update);
}
