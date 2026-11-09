(function () {
  'use strict';
  // The TV layout is scaled from a 1920px canvas and includes clipped lists.
  // Route wheel/trackpad gestures to the list under the pointer in CSS units.
  document.addEventListener('wheel', function (event) {
    if (event.ctrlKey || event.defaultPrevented) return;
    var node = event.target instanceof Element ? event.target : null;
    var candidates = [];
    while (node && node !== document.body) {
      if (node.matches('.scrollable, .pc-list, .live-list')) candidates.push(node);
      node = node.parentElement;
    }
    var current = document.querySelector('#screen-home.is-active .home-page.is-current');
    if (current && candidates.indexOf(current) === -1 && !event.target.closest('.home-tabs')) candidates.push(current);
    for (var i = 0; i < candidates.length; i++) {
      var box = candidates[i];
      var scale = box.offsetWidth ? box.getBoundingClientRect().width / box.offsetWidth : 1;
      scale = Math.max(0.2, scale || 1);
      var unit = event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? box.clientHeight : 1;
      // Rows marked data-wheel-x (for example the TV chips) scroll sideways
      // with the normal mouse wheel.
      var horizontal = event.shiftKey || box.hasAttribute('data-wheel-x') || Math.abs(event.deltaX) > Math.abs(event.deltaY);
      var delta = (horizontal ? (event.deltaX || event.deltaY) : event.deltaY) * unit / scale;
      var maximum = horizontal ? box.scrollWidth - box.clientWidth : box.scrollHeight - box.clientHeight;
      var position = horizontal ? box.scrollLeft : box.scrollTop;
      if (maximum <= 1 || !delta || (delta < 0 && position <= 0) || (delta > 0 && position >= maximum - 1)) continue;
      smoothScroll(box, horizontal, delta, maximum);
      event.preventDefault();
      return;
    }
  }, { passive: false });

  // Desplazamiento suave: cada giro de rueda mueve un objetivo y la lista se
  // acerca a él fotograma a fotograma, en lugar de saltar de golpe.
  var glides = [];
  var glideFrame = 0;
  function smoothScroll(box, horizontal, delta, maximum) {
    var prop = horizontal ? 'scrollLeft' : 'scrollTop';
    var glide = null;
    for (var i = 0; i < glides.length; i++) if (glides[i].box === box && glides[i].prop === prop) glide = glides[i];
    if (!glide) { glide = { box: box, prop: prop, target: box[prop] }; glides.push(glide); }
    glide.target = Math.max(0, Math.min(maximum, glide.target + delta));
    if (!glideFrame) glideFrame = requestAnimationFrame(glideStep);
  }
  function glideStep() {
    glideFrame = 0;
    for (var i = glides.length - 1; i >= 0; i--) {
      var g = glides[i];
      var current = g.box[g.prop];
      var gap = g.target - current;
      if (Math.abs(gap) < 0.6 || !g.box.isConnected) { g.box[g.prop] = g.target; glides.splice(i, 1); continue; }
      g.box[g.prop] = current + gap * 0.22;
      // The browser rounds/clamps scroll positions; stop if it did not move.
      if (Math.abs(g.box[g.prop] - current) < 0.01) glides.splice(i, 1);
    }
    if (glides.length) glideFrame = requestAnimationFrame(glideStep);
  }
  function stopGlides() { glides.length = 0; if (glideFrame) cancelAnimationFrame(glideFrame); glideFrame = 0; }

  // Arrastrar para desplazar, como en una app de móvil: mantener pulsado y
  // mover el ratón desplaza la lista bajo el puntero, con inercia al soltar.
  // Si hubo arrastre, el clic de ese gesto no abre nada.
  var SCROLLERS = '.scrollable, .pc-list, .live-list, .home-page.is-current';
  var NO_DRAG = 'input, textarea, select, #vod-seekbar, .player-stage, [data-no-drag]';
  var drag = null;
  var swallowClick = false;
  var inertia = 0;

  function canScroll(box, horizontal) {
    if (!box) return false;
    var style = getComputedStyle(box);
    var overflow = horizontal ? style.overflowX : style.overflowY;
    if (overflow !== 'auto' && overflow !== 'scroll') return false;
    return horizontal ? box.scrollWidth > box.clientWidth + 1 : box.scrollHeight > box.clientHeight + 1;
  }
  function scrollerFor(target, horizontal) {
    var node = target;
    while (node && node !== document.body) {
      if (node.matches && node.matches(SCROLLERS) && canScroll(node, horizontal)) return node;
      node = node.parentElement;
    }
    return null;
  }
  function scaleOf(box) {
    var s = box.offsetWidth ? box.getBoundingClientRect().width / box.offsetWidth : 1;
    return Math.max(0.2, s || 1);
  }

  document.addEventListener('pointerdown', function (event) {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    var target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest(NO_DRAG)) return;
    cancelAnimationFrame(inertia);
    stopGlides();
    drag = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY,
             lastT: performance.now(), vx: 0, vy: 0, box: null, horizontal: false, active: false, target: target };
  }, true);

  document.addEventListener('pointermove', function (event) {
    if (!drag || event.pointerType !== 'mouse') return;
    if (!(event.buttons & 1)) { drag = null; return; }
    var dx = event.clientX - drag.x;
    var dy = event.clientY - drag.y;
    if (!drag.active) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      var horizontal = Math.abs(dx) > Math.abs(dy);
      var box = scrollerFor(drag.target, horizontal) || scrollerFor(drag.target, !horizontal);
      if (!box) { drag = null; return; }
      drag.box = box;
      drag.horizontal = canScroll(box, horizontal) ? horizontal : !horizontal;
      drag.scale = scaleOf(box);
      drag.active = true;
      document.documentElement.classList.add('is-drag-scrolling');
    }
    var now = performance.now();
    var mx = (event.clientX - drag.lastX) / drag.scale;
    var my = (event.clientY - drag.lastY) / drag.scale;
    if (drag.horizontal) drag.box.scrollLeft -= mx; else drag.box.scrollTop -= my;
    var dt = Math.max(1, now - drag.lastT);
    drag.vx = 0.8 * (mx / dt) + 0.2 * drag.vx;
    drag.vy = 0.8 * (my / dt) + 0.2 * drag.vy;
    drag.lastX = event.clientX; drag.lastY = event.clientY; drag.lastT = now;
    event.preventDefault();
  }, true);

  function endDrag() {
    if (!drag) return;
    var finished = drag;
    drag = null;
    if (!finished.active) return;
    document.documentElement.classList.remove('is-drag-scrolling');
    swallowClick = true;
    setTimeout(function () { swallowClick = false; }, 0);
    // Inercia: sigue desplazando y frena poco a poco.
    var v = (finished.horizontal ? finished.vx : finished.vy) * 16;
    if (performance.now() - finished.lastT > 80) v = 0;
    var box = finished.box;
    function step() {
      if (Math.abs(v) < 0.5) return;
      if (finished.horizontal) box.scrollLeft -= v; else box.scrollTop -= v;
      v *= 0.93;
      inertia = requestAnimationFrame(step);
    }
    inertia = requestAnimationFrame(step);
  }
  document.addEventListener('pointerup', endDrag, true);
  document.addEventListener('pointercancel', function () {
    if (drag && drag.active) document.documentElement.classList.remove('is-drag-scrolling');
    drag = null;
  }, true);
  window.addEventListener('click', function (event) {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  // Evita arrastrar imágenes y seleccionar texto al desplazar.
  document.addEventListener('dragstart', function (event) {
    if (!(event.target instanceof Element) || !event.target.closest('input, textarea')) event.preventDefault();
  }, true);
})();
