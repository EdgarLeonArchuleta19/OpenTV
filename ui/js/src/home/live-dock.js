/* home/live-dock.js — Barra de controles de la TV del inicio: volumen, favoritos y países/temas.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------------------
   Desktop: sound for the home TV preview, a control bar and country /
   topic chips under the video (the TV app kept this preview muted).
   ------------------------------------------------------------------ */
var LIVE_COUNTRIES = ['Perú', 'México', 'Colombia', 'Venezuela', 'Ecuador', 'Chile', 'Bolivia',
  'Uruguay', 'Paraguay', 'Argentina', 'Panamá', 'Puerto Rico', 'España', 'Costa Rica',
  'Estados Unidos', 'Centroamérica', 'Honduras', 'El Salvador', 'República Dominicana', 'Guatemala', 'Nicaragua'];
var liveDock = null, liveDockCats = null, liveMuteBtn = null, liveVolLabel = null, liveFavBtn = null;
var liveAudio = { muted: false, volume: 0.8 };

var LIVE_DOCK_ICONS = {
  prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zM9.5 12 18 6v12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 6l8.5 6L6 18z"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 12h12"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 12h12M12 6v12"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>'
};

function loadLiveAudio() {
  var saved = safeLocalRead('xuper_live_audio_v1', null);
  if (saved) {
    liveAudio.muted = !!saved.muted;
    if (typeof saved.volume === 'number') { liveAudio.volume = Math.max(0, Math.min(1, saved.volume)); }
  }
}
function applyLiveAudio(save) {
  if (livePreviewVideo) {
    livePreviewVideo.muted = liveAudio.muted;
    livePreviewVideo.volume = liveAudio.volume;
    if (liveAudio.muted) { livePreviewVideo.setAttribute('muted', 'muted'); } else { livePreviewVideo.removeAttribute('muted'); }
  }
  if (playerVideo) {
    playerVideo.volume = liveAudio.volume;
    /* While the player's video stands in for the home preview it follows the
       preview's mute button. */
    if (liveHandoff && liveHandoff.type === 'player') { playerVideo.muted = liveAudio.muted; }
  }
  if (liveMuteBtn) {
    var off = liveAudio.muted || liveAudio.volume === 0;
    liveMuteBtn.innerHTML = off ? LIVE_DOCK_ICONS.mute : LIVE_DOCK_ICONS.sound;
    liveMuteBtn.title = off ? 'Activar sonido' : 'Silenciar';
    liveMuteBtn.classList.toggle('is-off', off);
  }
  if (liveVolLabel) { liveVolLabel.textContent = Math.round(liveAudio.volume * 100) + '%'; }
  if (save) { safeLocalWrite('xuper_live_audio_v1', liveAudio); }
}
function changeLiveVolume(delta) {
  liveAudio.volume = Math.max(0, Math.min(1, Math.round((liveAudio.volume + delta) * 10) / 10));
  if (delta > 0) { liveAudio.muted = false; }
  applyLiveAudio(true);
}

function liveFavKey(ch) { return 'live:' + (ch.channelCode || ch.id || ch.name); }
function syncLiveFavButton() {
  if (!liveFavBtn) { return; }
  var ch = CHANNELS[state.channel];
  var on = !!(ch && state.favs[liveFavKey(ch)]);
  liveFavBtn.classList.toggle('is-selected', on);
  liveFavBtn.querySelector('span').textContent = on ? 'En favoritos' : 'Favorito';
}

function dockButton(cls, icon, label, title, run) {
  var b = el('div', 'live-dock-btn focusable ' + cls);
  var ico = el('i', 'live-dock-ico');
  ico.innerHTML = icon;
  b.appendChild(ico);
  if (label) { b.appendChild(el('span', null, label)); }
  if (title) { b.title = title; }
  b._activate = run;
  return b;
}

function buildLiveDock(page) {
  loadLiveAudio();
  liveDock = el('div', 'live-dock');
  var bar = el('div', 'live-dock-bar');
  bar.appendChild(dockButton('', LIVE_DOCK_ICONS.prev, 'Anterior', 'Canal anterior', function () { setChannel(state.channel - 1, true); }));
  bar.appendChild(dockButton('', LIVE_DOCK_ICONS.next, 'Siguiente', 'Canal siguiente', function () { setChannel(state.channel + 1, true); }));
  bar.appendChild(el('i', 'live-dock-sep'));
  liveMuteBtn = dockButton('is-icon', LIVE_DOCK_ICONS.sound, '', 'Silenciar', function () {
    if (liveAudio.volume === 0) { liveAudio.volume = 0.5; liveAudio.muted = false; }
    else { liveAudio.muted = !liveAudio.muted; }
    applyLiveAudio(true);
  });
  liveMuteBtn.innerHTML = '';
  bar.appendChild(liveMuteBtn);
  bar.appendChild(dockButton('is-icon', LIVE_DOCK_ICONS.minus, '', 'Bajar volumen', function () { changeLiveVolume(-0.1); }));
  liveVolLabel = el('span', 'live-dock-vol', '80%');
  bar.appendChild(liveVolLabel);
  bar.appendChild(dockButton('is-icon', LIVE_DOCK_ICONS.plus, '', 'Subir volumen', function () { changeLiveVolume(0.1); }));
  bar.appendChild(el('i', 'live-dock-sep'));
  liveFavBtn = dockButton('is-fav', LIVE_DOCK_ICONS.star, 'Favorito', 'Guardar canal en favoritos', function () {
    var ch = CHANNELS[state.channel];
    if (!ch) { return; }
    ch.fav = toggleFavorite({ id: liveFavKey(ch) });
    syncLiveFavButton();
  });
  bar.appendChild(liveFavBtn);
  bar.appendChild(dockButton('', LIVE_DOCK_ICONS.full, 'Pantalla completa', 'Ver en pantalla completa', function () { openPlayer('live'); }));
  liveDock.appendChild(bar);

  liveDockCats = el('div', 'live-dock-cats scrollable');
  liveDockCats.setAttribute('data-wheel-x', '');
  liveDock.appendChild(liveDockCats);
  page.appendChild(liveDock);
  renderLiveDockCats();
  applyLiveAudio(false);
  syncLiveFavButton();
}

function renderLiveDockCats() {
  if (!liveDockCats) { return; }
  clear(liveDockCats);
  if (!liveCategories.length) {
    liveDockCats.appendChild(el('span', 'live-dock-label', 'Cargando países y temas…'));
    return;
  }
  var countries = [], topics = [], all = null;
  for (var i = 0; i < liveCategories.length; i++) {
    var c = liveCategories[i];
    if (c.name === 'Todos') { all = c; }
    else if (LIVE_COUNTRIES.indexOf(c.name) !== -1) { countries.push(c); }
    else { topics.push(c); }
  }
  function chip(cat, text) {
    var selected = currentLiveCategory === cat ||
      (currentLiveCategory && cat && currentLiveCategory.id === cat.id);
    var b = el('div', 'live-chip focusable' + (selected ? ' is-selected' : ''), text || cat.name);
    b._activate = function () {
      switchLiveCategory(cat);
      renderLiveDockCats();
    };
    liveDockCats.appendChild(b);
  }
  if (all) { chip(all, 'Todos'); }
  if (countries.length) {
    liveDockCats.appendChild(el('span', 'live-dock-label', 'Países'));
    for (var k = 0; k < countries.length; k++) { chip(countries[k]); }
  }
  if (topics.length) {
    liveDockCats.appendChild(el('span', 'live-dock-label', 'Temas'));
    for (var t = 0; t < topics.length; t++) { chip(topics[t], topics[t].isAddon ? 'Mis listas M3U' : null); }
  }
}
