'use strict';
/*
 * Publishes a new version to GitHub Releases from this PC:
 *   1. raise "version" in package.json (for example 1.0.0 -> 1.0.1)
 *   2. set GH_TOKEN (a GitHub token with "repo" / "contents: write")
 *   3. npm run release:github
 * It updates the catalogue copy (if the portal answers), builds, runs the
 * tests and uploads the installer, the portable .exe and latest.yml, which
 * is what the installed apps read to update themselves.
 * (The same happens on GitHub itself when a "v1.0.1" tag is pushed: see
 * .github/workflows/release.yml.)
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const publish = [].concat(pkg.build.publish || [])[0] || {};

function fail(message) { console.error('\n' + message + '\n'); process.exit(1); }
function run(cmd, args, optional) {
  console.log('\n> ' + cmd + ' ' + args.join(' '));
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0 && !optional) fail('Falló: ' + cmd + ' ' + args.join(' '));
  return r.status === 0;
}

if (publish.provider !== 'github' || !publish.owner || publish.owner === 'TU_USUARIO_GITHUB') {
  fail('Primero pon tu usuario de GitHub en package.json → build.publish[0].owner (y el repo en "repo").');
}
if (!process.env.GH_TOKEN) {
  fail('Falta GH_TOKEN. Crea un token en GitHub (Settings → Developer settings → Tokens) y en PowerShell:\n  $env:GH_TOKEN = "ghp_..."');
}
console.log('Publicando OpenTV ' + pkg.version + ' en github.com/' + publish.owner + '/' + publish.repo);
if (!run('npm', ['run', 'snapshot'], true)) console.warn('(No se pudo actualizar el catálogo; se usa la copia anterior.)');
run('npm', ['run', 'build']);
run('npm', ['test']);
run('npx', ['electron-builder', '--win', 'nsis', 'portable', '--publish', 'always']);
console.log('\nListo: https://github.com/' + publish.owner + '/' + publish.repo + '/releases');
