/* live/private.js — Escritorio: canales para adultos (+18) ocultos y protegidos con PIN.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* The portal has an adult ("18+") TV category. On desktop it is never in
   the category lists. It can be switched on in Mi cuenta → Privacidad,
   which asks for a 4-digit PIN; from then on it opens only with that PIN,
   from the lock button of the channel guide (or from Mi cuenta), under the
   neutral name "Privado". It locks again as soon as the viewer changes
   category or leaves the TV, and its channels are never written to
   Recientes, Favoritos or the title bar. */
var PRIVATE_KEY = 'opentv_private_v1';
var PRIVATE_MAX_TRIES = 5;
var privateCategories = [];
var privateUnlocked = false;
var privateFailedTries = 0;
var privateBlockedUntil = 0;

function privateSettings() {
  var s = safeLocalRead(PRIVATE_KEY, null);
  return s && typeof s === 'object' ? s : { enabled: false };
}
function privateEnabled() { var s = privateSettings(); return !!(s.enabled && s.hash); }

function isAdultCategory(cat) {
  if (!cat) { return false; }
  var name = String(cat.name || '');
  return /18\s*\+|\+\s*18|adult|xxx/i.test(name) || String(cat.id) === '76208';
}

/* Takes the adult categories out of the list the app shows (desktop). */
function splitPrivateCategories(cats) {
  if (!window.XUPER_DESKTOP) { return cats; }
  var visible = [];
  var hidden = [];
  for (var i = 0; i < cats.length; i++) { (isAdultCategory(cats[i]) ? hidden : visible).push(cats[i]); }
  if (hidden.length) { privateCategories = hidden; }
  return visible;
}

function privateCategoryActive() {
  return !!(window.XUPER_DESKTOP && currentLiveCategory && (currentLiveCategory.isPrivate || isAdultCategory(currentLiveCategory)));
}

/* ------------------------------------------------------------------ PIN */
function hexOf(buffer) {
  var bytes = new Uint8Array(buffer), out = '';
  for (var i = 0; i < bytes.length; i++) { out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16); }
  return out;
}
function hashPin(pin, salt, done) {
  var data = new TextEncoder().encode(salt + ':' + pin + ':opentv');
  window.crypto.subtle.digest('SHA-256', data).then(function (h) { done(hexOf(h)); }, function () { done(''); });
}
function newSalt() {
  var a = new Uint8Array(16);
  window.crypto.getRandomValues(a);
  return hexOf(a.buffer);
}
function checkPin(pin, done) {
  var s = privateSettings();
  if (!s.hash || !s.salt) { done(false); return; }
  hashPin(pin, s.salt, function (h) { done(!!h && h === s.hash); });
}
function savePin(pin, done) {
  var salt = newSalt();
  hashPin(pin, salt, function (h) {
    if (!h) { done(false); return; }
    safeLocalWrite(PRIVATE_KEY, { enabled: true, salt: salt, hash: h });
    done(true);
  });
}

/* ---------------------------------------------------------- PIN dialog */
var pinDialogOpen = false;
var pinDialog = null;
var pinDialogState = null;

/* opts: { title, text, onPin(pin, retry) }  — retry(message) clears the
   dots and shows a message, so the same dialog asks again. */
function openPinDialog(opts) {
  if (!pinDialog) { buildPinDialog(); }
  pinDialogState = { pin: '', opts: opts, returnFocus: state.focus };
  pinDialog.querySelector('.pd-title').textContent = opts.title;
  pinDialog.querySelector('.pd-text').textContent = opts.text || '';
  setPinMessage('');
  renderPinDots();
  pinDialogOpen = true;
  pinDialog.classList.add('is-open');
  var first = pinDialog.querySelector('.pd-key');
  if (first) { setFocus(first, true); }
}

function closePinDialog() {
  if (!pinDialogOpen) { return; }
  pinDialogOpen = false;
  pinDialog.classList.remove('is-open');
  var back = pinDialogState && pinDialogState.returnFocus;
  pinDialogState = null;
  if (back && back.isConnected) { setFocus(back, true); }
}

function setPinMessage(text, isError) {
  var m = pinDialog.querySelector('.pd-msg');
  m.textContent = text || '';
  m.classList.toggle('is-error', !!isError);
}

function renderPinDots() {
  var dots = pinDialog.querySelectorAll('.pd-dot');
  for (var i = 0; i < dots.length; i++) { dots[i].classList.toggle('is-on', i < pinDialogState.pin.length); }
}

function pinPress(key) {
  if (!pinDialogState) { return; }
  if (key === 'back') { pinDialogState.pin = pinDialogState.pin.slice(0, -1); renderPinDots(); return; }
  if (key === 'cancel') { closePinDialog(); return; }
  if (pinDialogState.pin.length >= 4) { return; }
  pinDialogState.pin += key;
  renderPinDots();
  if (pinDialogState.pin.length === 4) {
    var current = pinDialogState;
    var pin = current.pin;
    setTimeout(function () {
      if (pinDialogState !== current) { return; }
      current.opts.onPin(pin, function (message) {
        current.pin = '';
        renderPinDots();
        setPinMessage(message, true);
        pinDialog.classList.remove('is-shaking');
        void pinDialog.offsetWidth;
        pinDialog.classList.add('is-shaking');
      });
    }, 120);
  }
}

function buildPinDialog() {
  pinDialog = el('div', 'pin-dialog');
  pinDialog.setAttribute('data-no-gesture', '');
  var card = el('div', 'pd-card');
  var lock = el('div', 'pd-lock');
  lock.innerHTML = UI_ICONS.lock;
  card.appendChild(lock);
  card.appendChild(el('div', 'pd-title', ''));
  card.appendChild(el('div', 'pd-text', ''));
  var dots = el('div', 'pd-dots');
  for (var d = 0; d < 4; d++) { dots.appendChild(el('i', 'pd-dot')); }
  card.appendChild(dots);
  card.appendChild(el('div', 'pd-msg', ''));
  var pad = el('div', 'pd-pad');
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'cancel', '0', 'back'].forEach(function (k) {
    var b = el('button', 'pd-key focusable' + (k.length > 1 ? ' is-action' : ''));
    b.type = 'button';
    if (k === 'back') { b.innerHTML = UI_ICONS.back; b.setAttribute('aria-label', 'Borrar'); }
    else if (k === 'cancel') { b.textContent = 'Cancelar'; }
    else { b.textContent = k; }
    b._activate = function () { pinPress(k); };
    b.addEventListener('click', function (event) { event.stopPropagation(); pinPress(k); });
    pad.appendChild(b);
  });
  card.appendChild(pad);
  pinDialog.appendChild(card);
  pinDialog.addEventListener('click', function (event) { if (event.target === pinDialog) { closePinDialog(); } });
  document.body.appendChild(pinDialog);
  document.addEventListener('keydown', function (event) {
    if (!pinDialogOpen) { return; }
    var k = event.key;
    if (/^[0-9]$/.test(k)) { pinPress(k); }
    else if (k === 'Backspace') { pinPress('back'); }
    else if (k === 'Escape') { closePinDialog(); }
    else if (k === 'Enter' && state.focus && closest(state.focus, '.pin-dialog')) { state.focus._activate(); }
    else if (/^Arrow/.test(k)) { return; }
    event.preventDefault();
    event.stopPropagation();
  }, true);
}

/* -------------------------------------------------------------- actions */
function askPrivatePin(title, onOk) {
  openPinDialog({
    title: title,
    text: 'Introduce tu PIN de 4 dígitos.',
    onPin: function (pin, retry) {
      if (Date.now() < privateBlockedUntil) { retry('Demasiados intentos. Espera unos segundos.'); return; }
      checkPin(pin, function (ok) {
        if (!ok) {
          privateFailedTries++;
          if (privateFailedTries >= PRIVATE_MAX_TRIES) { privateFailedTries = 0; privateBlockedUntil = Date.now() + 30000; retry('PIN incorrecto. Espera 30 segundos.'); }
          else { retry('PIN incorrecto'); }
          return;
        }
        privateFailedTries = 0;
        closePinDialog();
        onOk();
      });
    }
  });
}

function enablePrivateContent(done) {
  var first = '';
  openPinDialog({
    title: 'Crea un PIN',
    text: 'Elige 4 dígitos. Lo pedirá cada vez que abras el contenido privado.',
    onPin: function (pin, retry) {
      if (!first) {
        first = pin;
        pinDialog.querySelector('.pd-title').textContent = 'Repite el PIN';
        pinDialog.querySelector('.pd-text').textContent = 'Escríbelo otra vez para confirmarlo.';
        pinDialogState.pin = '';
        renderPinDots();
        setPinMessage('');
        return;
      }
      if (pin !== first) {
        first = '';
        pinDialog.querySelector('.pd-title').textContent = 'Crea un PIN';
        pinDialog.querySelector('.pd-text').textContent = 'Elige 4 dígitos.';
        retry('Los PIN no coinciden. Empieza otra vez.');
        return;
      }
      savePin(pin, function (ok) {
        closePinDialog();
        if (done) { done(ok); }
      });
    }
  });
}

function disablePrivateContent(done) {
  askPrivatePin('Desactivar contenido privado', function () {
    lockPrivateContent();
    safeLocalWrite(PRIVATE_KEY, { enabled: false });
    if (done) { done(); }
  });
}

function changePrivatePin(done) {
  askPrivatePin('PIN actual', function () { enablePrivateContent(done); });
}

/* Opens the private category on the TV tab after the PIN. */
function openPrivateContent() {
  if (!privateEnabled()) { return; }
  askPrivatePin('Contenido privado', function () {
    if (!privateCategories.length) {
      loadLiveCategories(function () {
        if (privateCategories.length) { showPrivateCategory(); }
        else { setPlayerStatus(''); }
      });
      return;
    }
    showPrivateCategory();
  });
}

function showPrivateCategory() {
  var cat = privateCategories[0];
  privateUnlocked = true;
  var view = { id: cat.id, name: 'Privado', code: cat.code, isPrivate: true };
  if (liveGuideOpen) { closeLiveGuide(); }
  if (state.screen !== 'home') { showScreen('home'); }
  if (state.tab !== 0) { selectTab(0, true); }
  switchLiveCategory(view);
  renderLiveDockCats();
  document.body.classList.add('is-private-tv');
}

/* Back to the normal channels; called when the viewer leaves the
   category, the TV tab or the app's TV screens. */
function lockPrivateContent() {
  if (!privateUnlocked && !privateCategoryActive()) { return; }
  privateUnlocked = false;
  document.body.classList.remove('is-private-tv');
  if (privateCategoryActive()) {
    var all = null;
    for (var i = 0; i < liveCategories.length; i++) { if (liveCategories[i].name === 'Todos') { all = liveCategories[i]; break; } }
    currentLiveCategory = all || liveCategories[0] || null;
    if (state.screen === 'home' && state.tab === 0 && currentLiveCategory) { switchLiveCategory(currentLiveCategory); }
    else if (currentLiveCategory) {
      stopLivePreview();
      CHANNELS.splice(0, CHANNELS.length);
      liveChannelsLoaded = false;
      loadLiveChannels(currentLiveCategory.id);
    }
    renderLiveDockCats();
  }
}
