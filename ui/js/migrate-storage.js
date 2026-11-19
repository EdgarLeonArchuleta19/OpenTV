/* migrate-storage.js — Datos de instalaciones anteriores al cambio de nombre.
   Se carga antes que cualquier otro script de la página. */
(function () {
  'use strict';
  /* Installs from before the rename kept their data (history, favourites,
     M3U lists, preferences, per-profile copies such as "…@p3") under keys
     starting with this prefix. Each one moves to the opentv_ name once; a
     value already saved under the new name wins. Do not remove: users who
     update from an old version would lose their data. */
  var OLD = 'xuper_';
  var NEW = 'opentv_';

  function renamed(key) {
    return key && key.indexOf(OLD) === 0 ? NEW + key.slice(OLD.length) : key;
  }

  try {
    var store = window.localStorage;
    var legacy = [];
    for (var i = 0; i < store.length; i++) {
      var k = store.key(i);
      if (k && k.indexOf(OLD) === 0) { legacy.push(k); }
    }
    for (var j = 0; j < legacy.length; j++) {
      try {
        var target = renamed(legacy[j]);
        if (store.getItem(target) === null) { store.setItem(target, store.getItem(legacy[j])); }
        store.removeItem(legacy[j]);
      } catch (eKey) { /* storage full: keep the old key, try next start */ }
    }
  } catch (eStore) { /* storage off (private mode) */ }

  /* A backup made by an old version (Restaurar perfiles) uses the old keys. */
  window.opentvStorageKey = renamed;
})();
