#!/usr/bin/env node
'use strict';
/*
 * Builds the standalone Rust loopback HTTP binary (`opentv-service`) into
 * `core/target/release/` for HTTP integration tests (`tests/core.test.cjs`).
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'core', 'Cargo.toml');
const exe = process.platform === 'win32' ? 'opentv-service.exe' : 'opentv-service';

const r = spawnSync(
  'cargo',
  ['build', '--manifest-path', MANIFEST, '--release', '-p', 'opentv-service'],
  { cwd: ROOT, stdio: 'inherit' }
);
if (r.status !== 0) process.exit(r.status || 1);

const out = path.join(ROOT, 'core', 'target', 'release', exe);
const mb = (fs.statSync(out).size / 1048576).toFixed(2);
console.log('Binario de pruebas Rust listo: ' + path.relative(ROOT, out) + ' (' + mb + ' MB)');
