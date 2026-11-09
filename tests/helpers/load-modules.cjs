'use strict';
/*
 * Loads some UI modules from ui/js/src into a sandbox, the same way the
 * bundle joins them, so their pure functions can be tested without a
 * browser. `globals` provides the stubs the modules expect (storage, VOD…).
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', '..', 'ui', 'js', 'src');

function fakeStorage(initial) {
  const data = Object.assign({}, initial || {});
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    dump: () => data
  };
}

function loadModules(files, globals) {
  const storage = fakeStorage();
  const classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  const context = Object.assign({
    window: { XUPER_DESKTOP: true },
    document: { body: { classList }, createElement: () => ({ classList, style: {}, setAttribute() {}, appendChild() {} }) },
    localStorage: storage,
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    safeLocalRead: (key, fallback) => {
      const raw = storage.getItem(key);
      try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
    },
    safeLocalWrite: (key, value) => storage.setItem(key, JSON.stringify(value)),
    VOD: [],
    isKidsProfile: () => false,
    profileKey: (k) => k,
    state: { favs: {}, screen: 'home', tab: 0 }
  }, globals || {});
  context.window.localStorage = storage;
  vm.createContext(context);
  const code = files.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  vm.runInContext(code, context, { filename: files.join('+') });
  context.__storage = storage;
  return context;
}

module.exports = { loadModules, fakeStorage, SRC };
