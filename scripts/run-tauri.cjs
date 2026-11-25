#!/usr/bin/env node
'use strict';
/*
 * Runs Tauri v2 dev (with Vite React HMR), a production preview (no installer) or the
 * production NSIS build from `apps/desktop/`.
 * On `build`, compiles the React + TypeScript + Tailwind v4 frontend (`apps/desktop/frontend/`)
 * into `apps/desktop/dist-ui/` first, then packages the NSIS installer into `dist/`.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TAURI_DIR = path.join(ROOT, 'apps', 'desktop');
const FRONTEND_DIR = path.join(TAURI_DIR, 'frontend');
const cmd = process.argv[2] || 'dev';
const extra = process.argv.slice(3);

function runNpm(args, cwd) {
  return process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm', ...args], { cwd, stdio: 'inherit' })
    : spawnSync('npm', args, { cwd, stdio: 'inherit' });
}

if (!fs.existsSync(path.join(FRONTEND_DIR, 'node_modules'))) {
  const inst = runNpm(['install'], FRONTEND_DIR);
  if (inst.status !== 0) process.exit(inst.status || 1);
}

if (cmd === 'build' || cmd === 'preview') {
  const prep = runNpm(['run', 'build'], FRONTEND_DIR);
  if (prep.status !== 0) process.exit(prep.status || 1);
}

const tauriCli = require.resolve('@tauri-apps/cli/tauri.js');

// `preview`: the installed app's exact speed (release core + production React), with no
// installer, no checksums and nothing published.
if (cmd === 'preview') {
  const built = spawnSync(process.execPath, [tauriCli, 'build', '--no-bundle'].concat(extra), {
    cwd: TAURI_DIR,
    stdio: 'inherit',
  });
  if (built.status !== 0) process.exit(built.status === null ? 1 : built.status);
  const releaseDir = path.join(TAURI_DIR, 'src-tauri', 'target', 'release');
  const exe = fs
    .readdirSync(releaseDir)
    .find((f) => f.endsWith('.exe') && !/build-script|deps/i.test(f));
  if (!exe) {
    console.error('No se encontró el ejecutable en ' + path.relative(ROOT, releaseDir));
    process.exit(1);
  }
  console.log('\nAbriendo ' + path.relative(ROOT, path.join(releaseDir, exe)) + ' (modo vista previa)');
  spawnSync(path.join(releaseDir, exe), [], { cwd: releaseDir, stdio: 'inherit' });
  process.exit(0);
}

const res = spawnSync(process.execPath, [tauriCli, cmd].concat(extra), {
  cwd: TAURI_DIR,
  stdio: 'inherit',
});
if (res.status !== 0) process.exit(res.status === null ? 1 : res.status);

if (cmd === 'build') {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const nsisDir = path.join(TAURI_DIR, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  if (fs.existsSync(nsisDir)) {
    // The bundle folder keeps older installers: take the one of this version (else the newest).
    const setups = fs.readdirSync(nsisDir).filter((f) => f.endsWith('-setup.exe'));
    const setup =
      setups.find((f) => f.includes(`_${pkg.version}_`)) ||
      setups.sort((a, b) => fs.statSync(path.join(nsisDir, b)).mtimeMs - fs.statSync(path.join(nsisDir, a)).mtimeMs)[0];
    if (setup) {
      const distDir = path.join(ROOT, 'dist');
      fs.mkdirSync(distDir, { recursive: true });
      const outExe = path.join(distDir, `OpenTV-Setup-${pkg.version}.exe`);
      fs.copyFileSync(path.join(nsisDir, setup), outExe);
      const mb = (fs.statSync(outExe).size / 1048576).toFixed(2);
      console.log(`\nInstalador PC Tauri v2 listo: ${path.relative(ROOT, outExe)} (${mb} MB)`);
      require('./write-checksums.cjs').writeChecksums();
    }
  }
}
