#!/usr/bin/env node
'use strict';
/*
 * Prepares the Android app (Android, Android TV, Fire TV) in platforms/android:
 *   platforms/android/www/   the interface (ui/ without module sources,
 *                            Tailwind input or backups)
 * then copies it into the native project (npx cap sync android).
 *
 *   npm run build:android            (from the repository root)
 *
 * The interface reaches the OpenTV service over HTTP on 127.0.0.1:8910
 * (vodApi.devServiceUrl). The app runs that service itself (Java port in
 * android/app/src/main/java/com/techpoint/opentv/service).
 * config/tmdb.json, when present, is copied to the app's assets for the
 * trending rows; that copy is git-ignored like the original.
 * The installable APK: npm run build:apk (release, R8, signed → dist/).
 * For WebView debugging: cd platforms/android/android && gradlew assembleDebug
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, copyUi, minifyUi } = require('./lib/ui-package.cjs');

const APP = path.join(ROOT, 'platforms', 'android');
const OUT = path.join(APP, 'www');
const SERVICE_URL = 'http://127.0.0.1:8910';

function patch(rel, from, to) {
  const file = path.join(OUT, rel);
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes(from)) { throw new Error(rel + ': no se encontró «' + from + '»'); }
  fs.writeFileSync(file, text.replace(from, to));
}

(async function main() {
fs.rmSync(OUT, { recursive: true, force: true });
copyUi(OUT);
patch('config/api.js', "devServiceUrl: '',", "devServiceUrl: '" + SERVICE_URL + "',");
await minifyUi(OUT);   /* after the patch: it matches the readable source */
console.log('Android: interfaz lista en ' + path.relative(ROOT, OUT));

// TMDB key for the native service, encrypted (AES-256-GCM with a fresh key
// per build, that key masked with a value Tmdb.java derives the same way).
// It keeps the key from showing as plain text to anyone unzipping the APK;
// the app has to hold what decrypts it, so it is obfuscation, not a secret
// (a read-only TMDB key; regenerate it on themoviedb.org if it ever leaks).
// Removed again when config/tmdb.json is gone, so an old key never stays in
// a build. Both files are git-ignored.
const crypto = require('node:crypto');
const TMDB_SRC = path.join(ROOT, 'config', 'tmdb.json');
const ASSETS = path.join(APP, 'android', 'app', 'src', 'main', 'assets');
const TMDB_DST = path.join(ASSETS, 'tmdb.bin');
fs.rmSync(path.join(ASSETS, 'tmdb.json'), { force: true });   /* plain copy of older builds */
if (fs.existsSync(TMDB_SRC)) {
  const plain = Buffer.from(JSON.stringify(JSON.parse(fs.readFileSync(TMDB_SRC, 'utf8'))), 'utf8');
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const mask = crypto.createHash('sha256').update('opentv:tmdb:mask:v1').digest();
  const masked = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) { masked[i] = key[i] ^ mask[i]; }
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  fs.mkdirSync(ASSETS, { recursive: true });
  /* [1 = format][12 iv][32 masked key][ciphertext + 16-byte tag] */
  fs.writeFileSync(TMDB_DST, Buffer.concat([Buffer.from([1]), iv, masked, body]));
  console.log('Android: clave de TMDB cifrada en los assets (ignorada por git)');
} else {
  fs.rmSync(TMDB_DST, { force: true });
  console.log('Android: sin config/tmdb.json, las filas de TMDB quedan apagadas');
}

const cap = spawnSync('npx cap sync android', { cwd: APP, stdio: 'inherit', shell: true });
if (cap.status !== 0) { process.exit(cap.status || 1); }
})().catch((e) => { console.error(e); process.exit(1); });
