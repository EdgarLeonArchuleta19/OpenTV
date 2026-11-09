'use strict';
/* Starts the E2E smoke test in Electron. ELECTRON_RUN_AS_NODE (set by some
   editors' terminals) would make Electron behave as plain Node, so it is
   removed for the child process. */
const { spawn } = require('node:child_process');
const path = require('node:path');

const electron = require('electron');
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(__dirname, 'smoke.cjs')], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code === null ? 1 : code));
