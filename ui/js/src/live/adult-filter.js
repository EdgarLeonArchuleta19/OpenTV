/* live/adult-filter.js — Las categorías para adultos (+18) de las listas M3U no se muestran nunca.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* M3U lists can carry adult ("18+", "XXX") groups. OpenTV never lists them
   or their channels, on any platform, and never opens them. */
function isAdultCategory(cat) {
  if (!cat) { return false; }
  var name = String(cat.name || '');
  return /18\s*\+|\+\s*18|adult|xxx/i.test(name);
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
