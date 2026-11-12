'use strict';
/*
 * Shared by the TV/phone package builds (build-android.cjs, build-webos.cjs):
 *
 *   copyUi(dest)       copies ui/ without what only development uses (module
 *                      sources, the Tailwind input, backups)
 *   copyTree(...)      the plain recursive copy behind it
 *   minifyUi(dir)      shrinks the copied interface in place:
 *                        .js  → terser, ES5 output (the LG TV runs Chromium 53),
 *                               function names kept; *.min.js left as is
 *                        .css → comments and spacing removed only (no rule is
 *                               merged or reordered, so the cascade is the same)
 *
 * The development tree (ui/) and the PC app (Electron) keep the readable files.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

/* Only what the devices run: no module sources, Tailwind input or backups. */
const SKIP_UI = [path.join('js', 'src'), path.join('desktop', 'tw')];
function skipUi(rel) {
  if (/\.bak$/i.test(rel)) { return true; }
  return SKIP_UI.some((s) => rel === s || rel.startsWith(s + path.sep));
}

function copyTree(from, to, skip, rel = '') {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const r = path.join(rel, entry.name);
    if (skip && skip(r)) { continue; }
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) { copyTree(src, dst, skip, r); }
    else { fs.copyFileSync(src, dst); }
  }
}

function copyUi(dest) {
  copyTree(path.join(ROOT, 'ui'), dest, skipUi);
}

function listFiles(dir, re, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { listFiles(p, re, out); }
    else if (re.test(entry.name)) { out.push(p); }
  }
  return out;
}

function minifyCss(text) {
  const postcss = require('postcss');
  const root = postcss.parse(text);
  root.walkComments((c) => { c.remove(); });
  root.walk((node) => {
    node.raws.before = '';
    node.raws.after = '';
    if (node.type === 'decl') { node.raws.between = ':'; }
    else if (node.type === 'rule') { node.raws.between = ''; node.raws.semicolon = false; node.selector = node.selectors.join(','); }
    else if (node.type === 'atrule') { node.raws.between = ''; node.raws.afterName = node.params ? ' ' : ''; node.raws.semicolon = false; }
  });
  return root.toString();
}

async function minifyUi(dir) {
  const { minify } = require('terser');
  let before = 0, after = 0;
  for (const file of listFiles(dir, /\.js$/i)) {
    if (/\.min\.js$/i.test(file)) { continue; }
    const code = fs.readFileSync(file, 'utf8');
    const out = await minify(code, {
      ecma: 5,
      compress: { ecma: 5 },
      mangle: true,
      keep_fnames: true,
      format: { ecma: 5, comments: false }
    });
    before += code.length; after += out.code.length;
    fs.writeFileSync(file, out.code);
  }
  for (const file of listFiles(dir, /\.css$/i)) {
    const css = fs.readFileSync(file, 'utf8');
    const out = minifyCss(css);
    before += css.length; after += out.length;
    fs.writeFileSync(file, out);
  }
  const kb = (n) => Math.round(n / 1024) + ' KB';
  console.log('Interfaz minificada: ' + kb(before) + ' → ' + kb(after));
}

module.exports = { ROOT, copyTree, copyUi, minifyUi, minifyCss };
