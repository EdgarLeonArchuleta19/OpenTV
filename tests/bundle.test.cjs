'use strict';
/* The TV (webOS, Chromium 53) runs ui/js/app.js as is: it must be ES5 and
   match the modules in ui/js/src. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const acorn = require('acorn');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'ui', 'js', 'src');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
}

test('modules.json lists every module once', () => {
  const listed = JSON.parse(fs.readFileSync(path.join(SRC, 'modules.json'), 'utf8'));
  assert.equal(new Set(listed).size, listed.length, 'a module is listed twice');
  const onDisk = walk(SRC).filter((f) => f.endsWith('.js')).map((f) => path.relative(SRC, f).split(path.sep).join('/'));
  for (const f of onDisk) assert.ok(listed.includes(f), f + ' is not in modules.json');
  for (const f of listed) assert.ok(fs.existsSync(path.join(SRC, f)), f + ' is listed but missing');
});

test('ui/js/app.js is up to date with the modules', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-app.cjs'), '--check'], { stdio: 'pipe' });
});

test('ui/js/app.js is ES5 (webOS TV)', () => {
  const code = fs.readFileSync(path.join(ROOT, 'ui', 'js', 'app.js'), 'utf8');
  assert.doesNotThrow(() => acorn.parse(code, { ecmaVersion: 5 }));
});

test('each module is ES5 on its own (clear error location)', () => {
  const listed = JSON.parse(fs.readFileSync(path.join(SRC, 'modules.json'), 'utf8'));
  for (const f of listed) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    try { acorn.parse(code, { ecmaVersion: 5, allowReturnOutsideFunction: true }); }
    catch (e) { assert.fail(f + ': ' + e.message); }
  }
});

test('desktop main and preload parse', () => {
  for (const f of ['desktop/main.cjs', 'desktop/preload.cjs', 'desktop/system-volume.cjs', 'desktop/service.cjs']) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotThrow(() => acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true }), f);
  }
});
