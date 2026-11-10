'use strict';
/*
 * Profiles backup: Documents\OpenTV\perfiles-opentv.json.
 *
 * The app's own data (%APPDATA%\OpenTV) already survives an uninstall, but
 * it is gone if that folder is cleaned up or on a new PC. This small file
 * keeps the profiles (names, avatars) and each profile's history, Mi lista
 * and preferences, so a fresh install can offer to bring them back.
 * Only the page writes it, through validated JSON of limited size.
 */
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 4 * 1024 * 1024;
let file = null;

function init(app) {
  try {
    const dir = path.join(app.getPath('documents'), 'OpenTV');
    file = path.join(dir, 'perfiles-opentv.json');
  } catch { file = null; }
}

function read() {
  if (!file) return null;
  try {
    const text = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(text);
    return data && data.kind === 'opentv-profiles' ? data : null;
  } catch { return null; }
}

function write(data) {
  if (!file || !data || data.kind !== 'opentv-profiles') return false;
  const text = JSON.stringify(data);
  if (text.length > MAX_BYTES) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}

module.exports = { init, read, write, where: () => file };
