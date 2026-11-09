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
  if (nextEpisodePrompt) { nextEpisodePrompt.classList.remove('is-visible'); }
}
