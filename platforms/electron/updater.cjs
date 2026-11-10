'use strict';
/*
 * Automatic updates (electron-updater, installed version only).
 *
 * On start (and every 6 hours) the app asks the update feed whether a newer
 * version exists, downloads it in the background and installs it when the
 * app closes, or right away when the viewer presses "Reiniciar y actualizar".
 *
 * The feed is the "publish" entry of package.json → build (for example
 * GitHub Releases). electron-builder writes it into resources/app-update.yml
 * when the installer is built. Without it, updates stay off and Acerca de
 * says so. The portable .exe cannot replace itself: it only reports that a
 * new version exists.
 */
const { app } = require('electron');

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const PLACEHOLDER_OWNER = 'TU_USUARIO_GITHUB';

/* The GitHub repository the versions are published to (package.json →
   build.publish). Null while it still has the placeholder owner. */
function feed() {
  try {
    const publish = [].concat(require('../../package.json').build.publish || [])[0];
    if (!publish || publish.provider !== 'github' || !publish.owner || publish.owner === PLACEHOLDER_OWNER) return null;
    return { owner: publish.owner, repo: publish.repo, releases: 'https://github.com/' + publish.owner + '/' + publish.repo + '/releases/latest' };
  } catch { return null; }
}
let updater = null;
let send = () => {};
let status = { state: 'idle' };

function setStatus(next) {
  status = Object.assign({ at: Date.now() }, next);
  send(status);
}

function explain(error) {
  const text = String((error && error.message) || error || '');
  if (/app-update\.yml|ENOENT/i.test(text)) return { state: 'unconfigured' };
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|net::|network/i.test(text)) {
    return { state: 'error', error: 'Sin conexión con el servidor de actualizaciones' };
  }
  if (/404/.test(text)) return { state: 'error', error: 'No se encontró ninguna versión publicada' };
  return { state: 'error', error: text.split('\n')[0].slice(0, 160) };
}

function start(sendStatus) {
  send = sendStatus || send;
  if (!app.isPackaged) { setStatus({ state: 'dev' }); return; }
  if (!feed()) { setStatus({ state: 'unconfigured' }); return; }
  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch (error) {
    setStatus({ state: 'error', error: 'Módulo de actualización no disponible' });
    return;
  }
  updater.logger = null;
  updater.autoDownload = !portable;
  updater.autoInstallOnAppQuit = !portable;
  updater.allowPrerelease = false;
  updater.on('checking-for-update', () => setStatus({ state: 'checking' }));
  updater.on('update-not-available', () => setStatus({ state: 'current', version: app.getVersion() }));
  updater.on('update-available', (info) => setStatus({
    state: portable ? 'available-portable' : 'downloading', version: info && info.version, percent: 0
  }));
  updater.on('download-progress', (p) => setStatus({
    state: 'downloading', version: status.version, percent: Math.round((p && p.percent) || 0)
  }));
  updater.on('update-downloaded', (info) => setStatus({ state: 'ready', version: info && info.version }));
  updater.on('error', (error) => setStatus(explain(error)));
  setTimeout(check, 15000);
  setInterval(check, CHECK_EVERY_MS).unref?.();
}

function check() {
  if (!updater) return status;
  if (status.state === 'downloading' || status.state === 'ready') return status;
  updater.checkForUpdates().catch((error) => setStatus(explain(error)));
  return status;
}

function install() {
  if (!updater || status.state !== 'ready') return false;
  // Closes the window, runs the installer silently and opens the new version.
  setImmediate(() => updater.quitAndInstall(true, true));
  return true;
}

function current() { return status; }

/* Opens the download page (portable copies update by hand). */
function releasesUrl() { const f = feed(); return f ? f.releases : null; }

module.exports = { start, check, install, current, releasesUrl };
