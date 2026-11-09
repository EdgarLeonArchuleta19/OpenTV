#!/usr/bin/env node
'use strict';
/*
 * Builds ui/js/app.js from the modules in ui/js/src.
 *
 *   node scripts/build-app.cjs          write ui/js/app.js
 *   node scripts/build-app.cjs --check  exit 1 if ui/js/app.js is out of date
 *
 * The modules are joined in the order of ui/js/src/modules.json inside one
 * function scope, exactly as the app ran before it was split, so they share
 * state without imports. The result stays plain ES5 in a single file: the LG
 * webOS TV build (Chromium 53) loads it as-is, with no bundler or transpiler.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'ui', 'js', 'src');
const outFile = path.join(root, 'ui', 'js', 'app.js');
const order = JSON.parse(fs.readFileSync(path.join(srcDir, 'modules.json'), 'utf8'));

const indent = (text) => text.split('\n').map((l) => (l.trim() ? '  ' + l : '')).join('\n');

const parts = [
  '/* =============================================================================',
  '   OpenTV — interfaz (TV LG webOS y escritorio Windows)',
  '   ARCHIVO GENERADO por scripts/build-app.cjs: no lo edites a mano.',
  '   El código fuente está en ui/js/src/ (orden en ui/js/src/modules.json).',
  '   ============================================================================= */',
  '(function () {',
  "  'use strict';",
  ''
];
const seen = new Set();
for (const rel of order) {
  if (seen.has(rel)) throw new Error('Módulo repetido en modules.json: ' + rel);
  seen.add(rel);
  const file = path.join(srcDir, rel);
  if (!fs.existsSync(file)) throw new Error('No existe el módulo: ' + rel);
  const body = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '');
  parts.push('  /* ---- ' + rel + ' ' + '-'.repeat(Math.max(4, 70 - rel.length)) + ' */');
  parts.push(indent(body));
  parts.push('');
}
// Every .js file under src must be listed, so nothing is silently left out.
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (name.endsWith('.js')) {
      const rel = path.relative(srcDir, full).split(path.sep).join('/');
      if (!seen.has(rel)) throw new Error('Módulo sin listar en modules.json: ' + rel);
    }
  }
})(srcDir);
parts.push('})();', '');
const output = parts.join('\n');

if (process.argv.includes('--check')) {
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== output) {
    console.error('ui/js/app.js no está al día. Ejecuta: npm run build:js');
    process.exit(1);
  }
  console.log('ui/js/app.js está al día (' + order.length + ' módulos).');
} else {
  fs.writeFileSync(outFile, output);
  console.log('ui/js/app.js generado desde ' + order.length + ' módulos.');
}
