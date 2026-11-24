#!/usr/bin/env node
'use strict';
/**
 * Writes `dist/SHA256SUMS.txt` covering all release installers (`.exe`, `.apk`) in `dist/`.
 * Both the PC (`updater.rs`) and Android/TV (`app_update.rs`) updaters fetch this file from
 * GitHub Releases and verify cryptographic integrity before installing any update.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function sha256Of(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read = 0;
    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function writeChecksums() {
  if (!fs.existsSync(DIST)) return;
  const files = fs
    .readdirSync(DIST)
    .filter((f) => /\.(exe|apk)$/i.test(f))
    .sort((a, b) => a.localeCompare(b));
  if (files.length === 0) return;

  const lines = files.map((name) => `${sha256Of(path.join(DIST, name))}  ${name}`);
  const out = path.join(DIST, 'SHA256SUMS.txt');
  fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');
  console.log(`Checksums SHA-256 escritos: ${path.relative(ROOT, out)} (${files.length} archivos)`);
}

if (require.main === module) {
  writeChecksums();
}

module.exports = { writeChecksums, sha256Of };
