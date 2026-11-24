#!/usr/bin/env node
'use strict';
/*
 * Cross-compiles the unified Rust Android JNI library (`opentv-android` ->
 * `libopentv_service.so`) for armeabi-v7a (Fire TV Stick 1 GB) and arm64-v8a
 * (Android phones & newer TVs) using the local Android NDK clang toolchain.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'core', 'Cargo.toml');
const JNI_LIBS_DESTS = [
  path.join(ROOT, 'apps', 'android', 'app', 'src', 'main', 'jniLibs')
];

function findNdkBin() {
  const sdkCandidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(process.env.USERPROFILE || '', 'dev', 'android-sdk'),
    path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')
  ].filter(Boolean);

  for (const sdk of sdkCandidates) {
    const ndkRoot = path.join(sdk, 'ndk');
    if (!fs.existsSync(ndkRoot)) continue;
    const versions = fs.readdirSync(ndkRoot).sort().reverse();
    for (const v of versions) {
      const host = process.platform === 'win32' ? 'windows-x86_64' : 'linux-x86_64';
      const bin = path.join(ndkRoot, v, 'toolchains', 'llvm', 'prebuilt', host, 'bin');
      if (fs.existsSync(bin)) return bin;
    }
  }
  return null;
}

const ndkBin = findNdkBin();
if (!ndkBin) {
  console.error('No se encontró Android NDK. Configura ANDROID_HOME con NDK instalado.');
  process.exit(1);
}
console.log('Usando Android NDK:', ndkBin);

const ext = process.platform === 'win32' ? '.cmd' : '';
const arExe = path.join(ndkBin, process.platform === 'win32' ? 'llvm-ar.exe' : 'llvm-ar');
const ranlibExe = path.join(ndkBin, process.platform === 'win32' ? 'llvm-ranlib.exe' : 'llvm-ranlib');
const clangExe = path.join(ndkBin, process.platform === 'win32' ? 'clang.exe' : 'clang');
const clangppExe = path.join(ndkBin, process.platform === 'win32' ? 'clang++.exe' : 'clang++');

const TARGETS = [
  {
    triple: 'aarch64-linux-android',
    abi: 'arm64-v8a',
    linker: path.join(ndkBin, 'aarch64-linux-android22-clang' + ext),
    ccFlags: '--target=aarch64-linux-android22',
    envKey: 'AARCH64_LINUX_ANDROID'
  },
  {
    triple: 'armv7-linux-androideabi',
    abi: 'armeabi-v7a',
    linker: path.join(ndkBin, 'armv7a-linux-androideabi22-clang' + ext),
    ccFlags: '--target=armv7a-linux-androideabi22',
    envKey: 'ARMV7_LINUX_ANDROIDEABI'
  }
];

const filterAbi = process.argv[2] || '';

for (const t of TARGETS) {
  if (filterAbi && filterAbi !== t.abi && filterAbi !== t.triple) continue;
  if (!fs.existsSync(t.linker)) {
    console.error('Falta compilador NDK:', t.linker);
    process.exit(1);
  }
  console.log('\n==> Compilando Rust para ' + t.abi + ' (' + t.triple + ')...');

  const env = Object.assign({}, process.env, {
    ['CARGO_TARGET_' + t.envKey + '_LINKER']: t.linker,
    ['CARGO_TARGET_' + t.envKey + '_AR']: arExe,
    ['CC_' + t.triple.replace(/-/g, '_')]: clangExe,
    ['CXX_' + t.triple.replace(/-/g, '_')]: clangppExe,
    ['AR_' + t.triple.replace(/-/g, '_')]: arExe,
    ['RANLIB_' + t.triple.replace(/-/g, '_')]: ranlibExe,
    ['CFLAGS_' + t.triple.replace(/-/g, '_')]: t.ccFlags,
    ['CXXFLAGS_' + t.triple.replace(/-/g, '_')]: t.ccFlags,
    // aws-lc-sys / ring cross-compile hints on Windows host:
    AWS_LC_SYS_NO_JITTER_ENTROPY: '1',
    CMAKE_TOOLCHAIN_FILE: path.resolve(ndkBin, '..', '..', '..', '..', 'build', 'cmake', 'android.toolchain.cmake'),
    ANDROID_ABI: t.abi,
    ANDROID_PLATFORM: 'android-22'
  });

  const r = spawnSync(
    'cargo',
    ['build', '--manifest-path', MANIFEST, '--release', '-p', 'opentv-android', '--target', t.triple],
    { cwd: ROOT, stdio: 'inherit', env }
  );
  if (r.status !== 0) {
    process.exit(r.status || 1);
  }

  const built = path.join(ROOT, 'core', 'target', t.triple, 'release', 'libopentv_service.so');
  const mb = (fs.statSync(built).size / 1048576).toFixed(2);
  for (const base of JNI_LIBS_DESTS) {
    const destDir = path.join(base, t.abi);
    const dest = path.join(destDir, 'libopentv_service.so');
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(built, dest);
    console.log('Listo: ' + path.relative(ROOT, dest) + ' (' + mb + ' MB)');
  }
}
