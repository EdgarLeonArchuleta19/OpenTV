/* live/adult-filter.js — Las categorías para adultos (+18) del portal no se muestran nunca.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* The portal has an adult ("18+") TV category. OpenTV never lists it, on
   any platform, and never opens it. */
function isAdultCategory(cat) {
  if (!cat) { return false; }
  var name = String(cat.name || '');
  return /18\s*\+|\+\s*18|adult|xxx/i.test(name) || String(cat.id) === '76208';
}

function hideAdultCategories(cats) {
  var visible = [];
  for (var i = 0; i < cats.length; i++) {
    if (!isAdultCategory(cats[i])) { visible.push(cats[i]); }
  }
  return visible;
}

/* Settings and PIN left by older versions (the private section is gone). */
function forgetPrivateContent() {
  try {
    var keys = ['opentv_private_v1', 'opentv_private_block_v1'];
    for (var i = localStorage.length - 1; i >= 0; i--) {
      var k = localStorage.key(i);
      if (k && /^opentv_private_(v1|block_v1)(@|$)/.test(k)) { keys.push(k); }
    }
    for (var j = 0; j < keys.length; j++) { localStorage.removeItem(keys[j]); }
  } catch (eForget) { /* storage off */ }
}
