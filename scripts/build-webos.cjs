#!/usr/bin/env node
'use strict';
/*
 * Arma el paquete de la TV LG (webOS) en dist/webos:
 *   dist/webos/app/      la interfaz (ui/ sin fuentes ni herramientas) + appinfo.json
 *   dist/webos/service/  el servicio JS (service/)
 * y, si el CLI de webOS (ares-package) está instalado, el .ipk en dist/.
 *
 *   npm run build:webos
 *
 * Instalar en la TV:  ares-install --device <tv> dist/<id>_<versión>_all.ipk
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, copyTree, copyUi, minifyUi } = require('./lib/ui-package.cjs');

const OUT = path.join(ROOT, 'dist', 'webos');
const APP = path.join(OUT, 'app');
const SERVICE = path.join(OUT, 'service');

(async function main() {
fs.rmSync(OUT, { recursive: true, force: true });
copyUi(APP);
await minifyUi(APP);
fs.copyFileSync(path.join(ROOT, 'platforms', 'webos', 'appinfo.json'), path.join(APP, 'appinfo.json'));
/* The Windows FFmpeg and its licence are not for the TV. */
copyTree(path.join(ROOT, 'service'), SERVICE, (r) => /\.exe$/i.test(r));

const info = JSON.parse(fs.readFileSync(path.join(APP, 'appinfo.json'), 'utf8'));
console.log('webOS: ' + info.id + ' ' + info.version + ' → ' + path.relative(ROOT, OUT));

/* One quoted command line: the project path can contain spaces and, on
   Windows, ares-package is a .cmd that only runs through the shell. */
const q = (p) => '"' + p + '"';
const ares = spawnSync('ares-package ' + [q(APP), q(SERVICE), '-o', q(path.join(ROOT, 'dist'))].join(' '),
  { stdio: 'inherit', shell: true });
if (ares.error || ares.status !== 0) {
  console.log('\nNo se generó el .ipk (falta el CLI de webOS: npm i -g @webos-tools/cli).');
  console.log('La carpeta dist/webos ya se puede empaquetar con: ares-package dist/webos/app dist/webos/service');
}
})().catch((e) => { console.error(e); process.exit(1); });
