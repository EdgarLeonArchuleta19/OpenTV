#!/usr/bin/env node
'use strict';
/*
 * Runs Tauri v2 dev (with Vite React HMR) or production NSIS build from `apps/desktop/`.
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

if (cmd === 'build') {
  const prep = runNpm(['run', 'build'], FRONTEND_DIR);
  if (prep.status !== 0) process.exit(prep.status || 1);
}

const tauriCli = require.resolve('@tauri-apps/cli/tauri.js');
const res = spawnSync(process.execPath, [tauriCli, cmd].concat(extra), {
  cwd: TAURI_DIR,
  stdio: 'inherit',
});
if (res.status !== 0) process.exit(res.status === null ? 1 : res.status);

if (cmd === 'build') {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const nsisDir = path.join(TAURI_DIR, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  if (fs.existsSync(nsisDir)) {
    const setup = fs.readdirSync(nsisDir).find((f) => f.endsWith('-setup.exe'));
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
