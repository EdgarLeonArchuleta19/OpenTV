/* screens/guide.js — Guía de inicio: cuatro pasos cortos la primera vez que se
   abre la app (y siempre desde Ajustes → Ayuda). Usa la ventana de los paneles
   de fuentes (player/stremio-sources.js), así funciona con ratón y control.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

var GUIDE_SEEN_KEY = 'opentv_guide_seen_v1';

function guideSteps() {
  var steps = [
    { title: 'Bienvenido a OpenTV', text: 'Películas, series y TV en vivo en un solo lugar. El catálogo ya viene listo para explorar.' },
    { title: 'Para reproducir', text: 'Agrega un addon de fuentes en Ajustes → Addons. Pega la dirección que termina en manifest.json.',
      action: 'Ir a Addons', run: function () { openSettingsAt('sources'); } },
    { title: 'TV en vivo', text: 'Agrega tus listas M3U o IPTV en Ajustes → Addons → TV en vivo.' },
    { title: 'La mejor fuente, sola', text: 'OpenTV elige el idioma, la calidad y la fuente más estable. Cámbialo en Ajustes → Preferencias de addons.' }
  ];
  if (platformHas('downloads')) {
    steps[3].text += ' Y descarga para ver sin internet.';
  }
  return steps;
}

/* After the welcome screen, once per install. */
function maybeShowFirstRunGuide() {
  var seen = false;
  try { seen = localStorage.getItem(GUIDE_SEEN_KEY) === '1'; } catch (e) { seen = true; }
  if (!seen) { setTimeout(function () { if (!sourcePickerOpen) { openGuide(); } }, 600); }
}

function openGuide() {
  try { localStorage.setItem(GUIDE_SEEN_KEY, '1'); } catch (e) { /* ignore */ }
  if (sourcePickerOpen) { closeSourcePicker(); }
  sourcePickerOpen = true;
  sourcePickerReturn = state.focus;
  sourcePickerSeq++;
  var steps = guideSteps();
  var index = 0;
  var root = el('div', 'source-picker');
  root.id = 'dialog-guide';
  var panel = el('div', 'srcp-panel is-notice guide-panel');
  var head = el('div', 'srcp-head');
  var title = el('div', 'srcp-title', '');
  var count = el('div', 'srcp-sub', '');
  head.appendChild(title);
  head.appendChild(count);
  panel.appendChild(head);
  var body = el('div', 'srcp-body');
  var text = el('p', 'guide-text', '');
  var dots = el('div', 'guide-dots');
  body.appendChild(text);
  body.appendChild(dots);
  panel.appendChild(body);
  var foot = el('div', 'srcp-foot');
  var skip = el('div', 'acc-seg-btn focusable', 'Omitir');
  skip._activate = closeSourcePicker;
  var right = el('div', 'srcp-foot-actions');
  var back = el('div', 'acc-seg-btn focusable', 'Anterior');
  var extra = el('div', 'acc-seg-btn focusable', '');
  var next = el('div', 'acc-seg-btn focusable is-selected', '');
  back._activate = function () { if (index > 0) { index--; paint(); } };
  next._activate = function () { if (index < steps.length - 1) { index++; paint(); } else { closeSourcePicker(); } };
  extra._activate = function () { var run = steps[index].run; closeSourcePicker(); if (run) { run(); } };
  right.appendChild(back);
  right.appendChild(extra);
  right.appendChild(next);
  foot.appendChild(skip);
  foot.appendChild(right);
  panel.appendChild(foot);
  root.appendChild(panel);
  root.addEventListener('click', function (ev) { if (ev.target === root) { closeSourcePicker(); } });
  mountOverlay(root);
  sourcePickerNode = root;

  function paint() {
    var s = steps[index];
    title.textContent = s.title;
    count.textContent = 'Paso ' + (index + 1) + ' de ' + steps.length;
    text.textContent = s.text;
    clear(dots);
    for (var i = 0; i < steps.length; i++) { dots.appendChild(el('span', 'guide-dot' + (i === index ? ' is-on' : ''))); }
    back.hidden = index === 0;
    extra.hidden = !s.action;
    extra.textContent = s.action || '';
    next.textContent = index === steps.length - 1 ? 'Empezar' : 'Siguiente';
    setFocus(next);
  }
  paint();
}
