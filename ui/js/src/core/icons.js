/* core/icons.js — Iconos de línea de la interfaz de escritorio y botones de icono con descripción.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* One stroke style for every desktop control (24px grid, currentColor). */
function uiSvg(body, filled) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="' + (filled ? 'currentColor' : 'none') +
    '" stroke="' + (filled ? 'none' : 'currentColor') +
    '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
}

var UI_ICONS = {
  back: uiSvg('<path d="M15 18l-6-6 6-6"/>'),
  history: uiSvg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>'),
  mylist: uiSvg('<path d="M6 3.5h12v17l-6-4-6 4z"/><path d="M12 7.5v5M9.5 10h5"/>'),
  search: uiSvg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  user: uiSvg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'),
  play: uiSvg('<path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z"/>', true),
  pause: uiSvg('<rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/>', true),
  rewind: uiSvg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M10 10.2v5.3M13.4 10.2h1.3a1.2 1.2 0 0 1 1.2 1.2v2.9a1.2 1.2 0 0 1-1.2 1.2h-1.3a1.2 1.2 0 0 1-1.2-1.2v-2.9a1.2 1.2 0 0 1 1.2-1.2z" stroke-width="1.6"/>'),
  forward: uiSvg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M8.6 10.2v5.3M12 10.2h1.3a1.2 1.2 0 0 1 1.2 1.2v2.9a1.2 1.2 0 0 1-1.2 1.2H12a1.2 1.2 0 0 1-1.2-1.2v-2.9a1.2 1.2 0 0 1 1.2-1.2z" stroke-width="1.6"/>'),
  settings: uiSvg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  episodes: uiSvg('<path d="M3 6h12M3 12h8M3 18h12"/><path d="M16 10.5l5 3-5 3z"/>'),
  fullscreen: uiSvg('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
  exitFullscreen: uiSvg('<path d="M9 4v5H4M15 4v5h5M15 20v-5h5M9 20v-5H4"/>'),
  pip: uiSvg('<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><rect x="12" y="11" width="7" height="6" rx="1.2" fill="currentColor" stroke="none"/>'),
  prev: uiSvg('<path d="M6 5v14"/><path d="M18 6.2v11.6a.7.7 0 0 1-1.1.6L9 12.6a.7.7 0 0 1 0-1.2l7.9-5.8a.7.7 0 0 1 1.1.6z"/>'),
  next: uiSvg('<path d="M18 5v14"/><path d="M6 6.2v11.6a.7.7 0 0 0 1.1.6l7.9-5.8a.7.7 0 0 0 0-1.2L7.1 5.6A.7.7 0 0 0 6 6.2z"/>'),
  star: uiSvg('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>'),
  aspect: uiSvg('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M6.5 9v-1h3M17.5 15v1h-3"/>'),
  retry: uiSvg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  lock: uiSvg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  diagnostics: uiSvg('<path d="M3 12h4l3-7 4 14 3-7h4"/>'),
  channels: uiSvg('<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="3"/>'),
  quality: uiSvg('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M7 9.5v5M10 9.5v5M7 12h3M13.5 9.5v5h1.6a2.5 2.5 0 0 0 0-5z"/>'),
  close: uiSvg('<path d="M6 6l12 12M18 6 6 18"/>'),
  share: uiSvg('<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1"/>'),
  help: uiSvg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 1c0 1.8-2.5 2.2-2.5 4"/><path d="M12 17.5h.01"/>'),
  info: uiSvg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>'),
  wifi: uiSvg('<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.5a9.5 9.5 0 0 1 13 0"/><path d="M8.7 16a5 5 0 0 1 6.6 0"/><path d="M12 19.5h.01"/>'),
  keyboard: uiSvg('<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8"/>'),
  check: uiSvg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  expand: uiSvg('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
  speed: uiSvg('<path d="M12 14.5l4.5-4.5"/><path d="M3.6 18.5a9.5 9.5 0 1 1 16.8 0"/><circle cx="12" cy="14.5" r="1.2"/>')
};

/* Turns a text button into an icon button. The text becomes its tooltip
   (data-tip, see desktop/tooltip.js) and accessible name. */
function iconizeButton(btn, icon, tip) {
  if (!btn || !icon) { return btn; }
  var text = tip || btn.getAttribute('aria-label') || btn.textContent;
  btn.innerHTML = icon;
  btn.classList.add('is-icon-btn');
  btn._iconized = true;
  setButtonText(btn, text);
  return btn;
}

/* Updates a button's label: the visible text, or the tooltip and accessible
   name when the button shows an icon. Optionally swaps the icon too. */
function setButtonText(btn, text, icon) {
  if (!btn) { return; }
  if (btn._iconized) {
    if (icon) { btn.innerHTML = icon; }
    btn.setAttribute('data-tip', text);
    btn.setAttribute('aria-label', text);
    btn.removeAttribute('title');
  } else {
    btn.textContent = text;
  }
}
