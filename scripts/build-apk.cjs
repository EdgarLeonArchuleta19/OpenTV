#!/usr/bin/env node
'use strict';
/*
 * Builds the installable Android APK (Android, Android TV, Fire TV):
 *
 *   npm run build:apk        → dist/OpenTV-<version>.apk
 *
 * Runs after build:android (interface + cap sync). Release build: R8 on,
 * signed with the key named in platforms/android/android/keystore.properties
 * (git-ignored; without it, the debug key). Needs JDK 17 (JAVA_HOME) and the
 * Android SDK (ANDROID_HOME or local.properties).
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PROJECT = path.join(ROOT, 'platforms', 'android', 'android');
const version = require(path.join(ROOT, 'package.json')).version;

if (!process.env.JAVA_HOME) {
  console.error('Falta JAVA_HOME (JDK 17). Ejemplo: set JAVA_HOME=C:\\Users\\<tú>\\dev\\jdk17');
  process.exit(1);
}
if (!fs.existsSync(path.join(PROJECT, 'keystore.properties'))) {
  console.warn('Aviso: sin keystore.properties, el APK se firma con la clave de depuración.');
}

const gradlew = '"' + path.join(PROJECT, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew') + '"';
const r = spawnSync(gradlew + ' assembleRelease --no-daemon -q', { cwd: PROJECT, stdio: 'inherit', shell: true });
if (r.status !== 0) { process.exit(r.status || 1); }

const apk = path.join(PROJECT, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const out = path.join(ROOT, 'dist', 'OpenTV-' + version + '.apk');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync(apk, out);
console.log('APK listo: ' + path.relative(ROOT, out) + ' (' + (fs.statSync(out).size / 1048576).toFixed(1) + ' MB)');
