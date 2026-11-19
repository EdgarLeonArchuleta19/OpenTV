/* live/epg.js — Guía de horarios de TV en vivo: qué hay ahora y qué sigue en cada canal, de la guía (XMLTV) de cada lista M3U.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* A list whose header names a guide (#EXTM3U url-tvg="…") gives each of its
   channels `epg` (that link) and `tvgId`. The service reads the guide
   (service/epg.js, Epg.java) and answers now and next for the ids asked.
   Here: ch.now (title), ch.time ("22:00 – 23:00"), ch.next and ch._epgDesc,
   which the guide, the channel list and the player's channel bar show.
   A minute timer moves each channel to its next programme; the guide is
   asked again every LIVE_EPG_REFRESH_MS (the service keeps its own copy). */
var LIVE_EPG_REFRESH_MS = 15 * 60 * 1000;
var LIVE_EPG_BATCH = 400;
var liveEpgData = {};      /* epg link + '|' + tvgId -> [ { s, e, t, d } ] */
var liveEpgAskedAt = {};   /* epg link -> when it was last asked */
var liveEpgTicker = null;

function liveEpgKey(ch) {
  return ch && ch.epg && ch.tvgId ? ch.epg + '|' + ch.tvgId : '';
}

function liveEpgClock(ms) {
  var d = new Date(ms);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/* Now and next of one channel, or null when its guide has nothing. */
function liveEpgFor(ch) {
  var list = liveEpgData[liveEpgKey(ch)];
  if (!list || !list.length) { return null; }
  var now = Date.now();
  for (var i = 0; i < list.length; i++) {
    if (list[i].e <= now) { continue; }
    if (list[i].s > now) { return { now: null, next: list[i] }; }
    return { now: list[i], next: list[i + 1] || null };
  }
  return null;
}

function applyLiveEpg(ch, from) {
  var g = liveEpgFor(from || ch);
  if (g && g.now) {
    ch.now = g.now.t;
    ch.time = liveEpgClock(g.now.s) + ' – ' + liveEpgClock(g.now.e);
    ch.next = g.next ? g.next.t + ' · ' + liveEpgClock(g.next.s) : '';
    ch._epgDesc = g.now.d || '';
  } else {
    ch.now = 'En vivo';
    ch.time = '';
    ch.next = g && g.next ? g.next.t + ' · ' + liveEpgClock(g.next.s) : '';
    ch._epgDesc = '';
  }
}

/* Every loaded channel, and the copies shown from Favoritos / Recientes
   (they keep only the link: matched by it). */
function applyLiveEpgAll() {
  var byUrl = {};
  for (var i = 0; i < liveAllChannels.length; i++) {
    applyLiveEpg(liveAllChannels[i]);
    if (liveAllChannels[i].streamUrl) { byUrl[liveAllChannels[i].streamUrl] = liveAllChannels[i]; }
  }
  for (var c = 0; c < CHANNELS.length; c++) {
    var src = CHANNELS[c].streamUrl && byUrl[CHANNELS[c].streamUrl];
    if (src && src !== CHANNELS[c]) { applyLiveEpg(CHANNELS[c], src); }
  }
  refreshGuideCardsEpg();
  syncLiveUnder();
}

/* "Ahora: Noticias · 22:00 – 23:00 · Después: Deportes · 23:00". */
function liveProgrammeLine(ch) {
  var parts = [];
  if (ch.now && ch.now !== 'En vivo') { parts.push('Ahora: ' + ch.now + (ch.time ? ' · ' + ch.time : '')); }
  if (ch.next) { parts.push('Después: ' + ch.next); }
  return parts.join('  ·  ');
}

/* Asks the guide of every list that has one, for its channels. */
function loadLiveEpg(channels) {
  var byLink = {};
  for (var i = 0; i < channels.length; i++) {
    var ch = channels[i];
    if (!ch.epg || !ch.tvgId) { continue; }
    (byLink[ch.epg] = byLink[ch.epg] || []).push(ch.tvgId);
  }
  applyLiveEpgAll();
  Object.keys(byLink).forEach(function (link) {
    if (Date.now() - (liveEpgAskedAt[link] || 0) < LIVE_EPG_REFRESH_MS) { return; }
    liveEpgAskedAt[link] = Date.now();
    /* In batches: on Android the ids travel in the request's address. The
       first batch makes the service read the guide; the others reuse it. */
    var ids = byLink[link];
    (function ask(from) {
      portalServiceCall('epg', { url: link, ids: ids.slice(from, from + LIVE_EPG_BATCH) }, function (err, payload) {
        if (err || !payload || !payload.programmes) {
          /* Try again sooner than a full refresh. */
          liveEpgAskedAt[link] = Date.now() - LIVE_EPG_REFRESH_MS + 2 * 60 * 1000;
          return;
        }
        var progs = payload.programmes;
        for (var id in progs) {
          if (Object.prototype.hasOwnProperty.call(progs, id)) { liveEpgData[link + '|' + id] = progs[id]; }
        }
        applyLiveEpgAll();
        if (from + LIVE_EPG_BATCH < ids.length) { ask(from + LIVE_EPG_BATCH); }
      }, 45000);
    })(0);
  });
  if (!liveEpgTicker && Object.keys(byLink).length) {
    liveEpgTicker = setInterval(function () {
      if (!liveAllChannels.length) { return; }
      loadLiveEpg(liveAllChannels);
    }, 60000);
  }
}

/* The guide's cards already drawn: their programme line, in place. */
function refreshGuideCardsEpg() {
  if (!liveGuideGrid) { return; }
  var cards = liveGuideGrid.querySelectorAll('.lg-card');
  for (var i = 0; i < cards.length; i++) {
    if (cards[i]._ch) { setGuideCardProgramme(cards[i], cards[i]._ch); }
  }
}

function setGuideCardProgramme(card, ch) {
  var info = card.querySelector('.lg-info');
  if (!info) { return; }
  var line = info.querySelector('.lg-prog');
  /* The time first: a long title is what gets cut ("23:30 – 00:30 · Hechos…"). */
  var text = ch.now && ch.now !== 'En vivo' ? (ch.time ? ch.time + ' · ' : '') + ch.now : '';
  if (!text) { if (line) { line.parentNode.removeChild(line); } return; }
  if (!line) { line = el('div', 'lg-prog'); info.appendChild(line); }
  if (line.textContent !== text) { line.textContent = text; }
}
