'use strict';
/*
 * Error log for troubleshooting: <profile>/logs/opentv.log.
 * Keeps page errors, crashes of the page/GPU/service processes and
 * unexpected errors of the main process. Nothing is sent anywhere; the
 * viewer can open the folder from Ajustes → Ayuda and attach the file.
 * The file is capped at 1 MB (the previous one is kept as opentv.old.log).
 */
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 1024 * 1024;
let file = null;

function init(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'opentv.log');
  } catch { file = null; }
  return file;
}

function rotate() {
  try {
    if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file.replace(/\.log$/, '.old.log'));
  } catch { /* first write */ }
}

function write(kind, message) {
  if (!file) return;
  const line = new Date().toISOString() + ' [' + kind + '] ' + String(message).replace(/\s+/g, ' ').slice(0, 2000) + '\n';
  try { rotate(); fs.appendFileSync(file, line); } catch { /* disk full or read-only */ }
}

function attach(app, contents) {
  contents.on('console-message', (event, level, message, line, source) => {
    const isError = event.level === 'error' || level === 3;
    if (!isError) return;
    const text = event.message || message || '';
    // Network noise from unreachable artwork/streams is expected; skip it.
    if (/Failed to load resource|net::ERR_/i.test(text)) return;
    write('página', text + (event.lineNumber || line ? ' (' + (event.sourceId || source || '') + ':' + (event.lineNumber || line) + ')' : ''));
  });
  contents.on('render-process-gone', (_e, d) => write('crash', 'la página se cerró: ' + d.reason + ' (' + d.exitCode + ')'));
  contents.on('unresponsive', () => write('aviso', 'la página dejó de responder'));
}

function watchProcess() {
  process.on('uncaughtException', (error) => write('principal', (error && error.stack) || error));
  process.on('unhandledRejection', (error) => write('principal', 'promesa sin capturar: ' + ((error && error.stack) || error)));
}

module.exports = { init, write, attach, watchProcess, file: () => file };
