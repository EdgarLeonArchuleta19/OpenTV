#!/usr/bin/env node
'use strict';
/*
 * Signs a release checksum list with the owner's Ed25519 release key.
 *
 *   node scripts/sign-release.cjs [dist/SHA256SUMS]
 *
 * Writes `<file>.sig` (base64 Ed25519 signature over the exact file bytes) next to it.
 * Upload both SHA256SUMS and SHA256SUMS.sig to the GitHub release: the desktop updater
 * only trusts the checksums after verifying this signature with the public key embedded
 * in the app (scripts/release-public-key.txt).
 *
 * The private key never lives in the repo. Default location:
 *   %USERPROFILE%\.opentv\release-signing\opentv-release-private.pem
 * Override with OPENTV_RELEASE_KEY=<path to PEM>.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const target = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'SHA256SUMS'));
const keyPath =
  process.env.OPENTV_RELEASE_KEY ||
  path.join(os.homedir(), '.opentv', 'release-signing', 'opentv-release-private.pem');
const pubPath = path.join(__dirname, 'release-public-key.txt');

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(target)) fail(`no existe ${target}`);
if (!fs.existsSync(keyPath)) fail(`no se encontró la llave privada en ${keyPath}`);

const data = fs.readFileSync(target);
const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath));
const signature = crypto.sign(null, data, privateKey);

// Self-check against the public key the app embeds, so a wrong key never ships.
const pubB64 = fs.readFileSync(pubPath, 'utf8').trim();
const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
const publicKey = crypto.createPublicKey({
  key: Buffer.concat([spkiPrefix, Buffer.from(pubB64, 'base64')]),
  format: 'der',
  type: 'spki',
});
if (!crypto.verify(null, data, publicKey, signature)) {
  fail('la llave privada no corresponde a scripts/release-public-key.txt');
}

const sigPath = `${target}.sig`;
fs.writeFileSync(sigPath, `${signature.toString('base64')}\n`);
console.log(`Firmado: ${path.relative(ROOT, sigPath)}`);
