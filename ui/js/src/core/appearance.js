/* core/appearance.js — Color de acento y tamaño de la interfaz (PC) o margen
   de pantalla (tele). Ajustes → Apariencia. Compartido por todos los perfiles.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* Accent: focus rings, selected tabs and options, the main play button and
   the progress bars. White keeps the original monochrome look. Only colours
   change (no layers or effects), so it costs nothing on a Fire TV. */
var ACCENT_KEY = 'opentv_accent_v1';
var ACCENTS = [
  { id: 'white', label: 'Blanco', color: '#ffffff', ink: '#0e0e11' },
  { id: 'red', label: 'Rojo', color: '#e50914', ink: '#ffffff' },
  { id: 'blue', label: 'Azul', color: '#3b82f6', ink: '#ffffff' },
  { id: 'purple', label: 'Morado', color: '#8b5cf6', ink: '#ffffff' },
  { id: 'green', label: 'Verde', color: '#22c55e', ink: '#0e0e11' },
  { id: 'amber', label: 'Ámbar', color: '#f59e0b', ink: '#0e0e11' }
];

function accentIndex() {
  var saved = '';
  try { saved = localStorage.getItem(ACCENT_KEY) || ''; } catch (eRead) { saved = ''; }
  for (var i = 0; i < ACCENTS.length; i++) { if (ACCENTS[i].id === saved) { return i; } }
  return 0;
}

function applyAccent() {
  var a = ACCENTS[accentIndex()];
  var root = document.documentElement;
  if (root && root.style) {
    root.style.setProperty('--ot-accent', a.color);
    root.style.setProperty('--ot-accent-ink', a.ink);
  }
  if (document.body) { document.body.classList.toggle('has-accent', a.id !== 'white'); }
}

function setAccent(index) {
  var a = ACCENTS[index] || ACCENTS[0];
  try { localStorage.setItem(ACCENT_KEY, a.id); } catch (eSave) { /* storage off */ }
  applyAccent();
}

/* Text size, every device: "Aumentado" makes the text and the buttons
   around it (hero, details, row titles, Ajustes, the player's menus,
   notices) about 12 % bigger, for whoever sits far from the screen. The
   posters keep their own size (Tamaño de los pósteres). Done in CSS
   (13-acento.css, .is-text-large). */
var TEXT_SIZE_KEY = 'opentv_text_size_v1';

function textLarge() {
  try { return localStorage.getItem(TEXT_SIZE_KEY) === 'large'; } catch (eRead) { return false; }
}

function applyTextSize() {
  if (document.body) { document.body.classList.toggle('is-text-large', textLarge()); }
}

function setTextSize(large) {
  try { localStorage.setItem(TEXT_SIZE_KEY, large ? 'large' : 'normal'); } catch (eSave) { /* storage off */ }
  applyTextSize();
}

/* Interface size. The design is a 1920×1080 canvas scaled to the window
   (desktop/display.js), so it can only get smaller: a smaller scale makes
   the canvas wider and taller, and more titles fit on screen. Making it
   larger would shrink the canvas below 1920 px and cut the screens.
   On a TV the same setting is the screen margin: some sets crop the edges
   of the picture (overscan), so the canvas is drawn a bit inside. */
var UI_SIZE_KEY = 'opentv_ui_size_v1';
var UI_SIZE_PC = [1, 0.9, 0.8];          /* Normal, Compacto, Muy compacto */
var UI_MARGIN_TV = [0, 0.025, 0.05];     /* per side: Ninguno, Pequeño, Grande */

function uiSizeIndex() {
  var saved = 0;
  try { saved = parseInt(localStorage.getItem(UI_SIZE_KEY) || '0', 10) || 0; } catch (eRead) { saved = 0; }
  return saved >= 0 && saved <= 2 ? saved : 0;
}

/* Scale factor for the canvas on the PC (1 on other devices). */
function uiScaleFactor() {
  if (platformIsTv() || !platformHas('window')) { return 1; }
  return UI_SIZE_PC[uiSizeIndex()];
}

/* Margin on each side of the TV screen, as a fraction (0 elsewhere). */
function uiScreenMargin() {
  return platformIsTv() ? UI_MARGIN_TV[uiSizeIndex()] : 0;
}

function setUiSize(index) {
  try { localStorage.setItem(UI_SIZE_KEY, String(index)); } catch (eSave) { /* storage off */ }
  fitDesignViewport();
}
