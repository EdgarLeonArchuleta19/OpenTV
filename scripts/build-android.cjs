#!/usr/bin/env node
'use strict';
/*
 * Builds the pure Kotlin + Compose + Media3 universal release APK (`arm64-v8a` + `armeabi-v7a`)
 * in `apps/android/` backed by the unified Rust core (`libopentv_service.so`),
 * and copies the output APK to `dist/OpenTV-<version>.apk`.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const ANDROID_DIR = path.join(ROOT, 'apps', 'android');
const JNI_DIR = path.join(ANDROID_DIR, 'app', 'src', 'main', 'jniLibs');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const forceRust = process.argv.includes('--rust');
const testOnly = process.argv.includes('--test-only');
const arm64So = path.join(JNI_DIR, 'arm64-v8a', 'libopentv_service.so');
const armv7So = path.join(JNI_DIR, 'armeabi-v7a', 'libopentv_service.so');

if (!testOnly && (forceRust || !fs.existsSync(arm64So) || !fs.existsSync(armv7So))) {
  console.log('==> Compilando librerías Rust JNI (arm64-v8a + armeabi-v7a)...');
  const rustRes = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-rust-android.cjs')], {
    cwd: ROOT,
    stdio: 'inherit'
  });
  if (rustRes.status !== 0) process.exit(rustRes.status || 1);
}

const tasks = testOnly ? ['testReleaseUnitTest'] : ['testReleaseUnitTest', 'assembleRelease'];
console.log('\n==> Ejecutando Gradle (' + tasks.join(' ') + ')...');
// Windows: quote the absolute .bat path so folders with spaces ("my projects") work.
const gr = process.platform === 'win32'
  ? spawnSync('"' + path.join(ANDROID_DIR, 'gradlew.bat') + '"', tasks, { cwd: ANDROID_DIR, stdio: 'inherit', shell: true })
  : spawnSync('./gradlew', tasks, { cwd: ANDROID_DIR, stdio: 'inherit' });
if (gr.status !== 0) process.exit(gr.status || 1);
if (testOnly) process.exit(0);

const apkDir = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'release');
const distDir = path.join(ROOT, 'dist');
fs.mkdirSync(distDir, { recursive: true });

// Single universal APK covering Fire TV, Android TV and Android Mobile (armeabi-v7a + arm64-v8a).
const dstName = `OpenTV-${pkg.version}-FireTV-AndroidTV-Mobile.apk`;
const from = ['app-release.apk', 'app-universal-release.apk']
  .map((f) => path.join(apkDir, f))
  .find((p) => fs.existsSync(p));

if (!from) {
  console.error('No se encontró el APK universal generado en:', apkDir);
  process.exit(1);
}

// Clean up any stale split APKs in dist/ so only the single universal APK remains.
for (const entry of fs.readdirSync(distDir)) {
  if (/^OpenTV-.*\.apk$/i.test(entry) && entry !== dstName) {
    try { fs.unlinkSync(path.join(distDir, entry)); } catch { /* ignore */ }
  }
}

const to = path.join(distDir, dstName);
fs.copyFileSync(from, to);
// Same APK under a fixed name, so `…/releases/latest/download/OpenTV.apk` (Downloader) never changes.
fs.copyFileSync(from, path.join(distDir, 'OpenTV.apk'));
const mb = (fs.statSync(to).size / 1048576).toFixed(2);
console.log(`APK universal (Fire TV · Android TV · Android Mobile) listo: ${path.relative(ROOT, to)} (${mb} MB)`);
require('./write-checksums.cjs').writeChecksums();
