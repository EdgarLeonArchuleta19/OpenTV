'use strict';
/*
 * Regenerates ui/data/portal.js: the catalogue copy bundled with the app,
 * shown on the very first start (and offline) before the live catalogue
 * arrives. It asks the portal for the six home sections, the same way the
 * app does, and keeps only public catalogue data (titles, artwork links,
 * synopsis…), never a user id or token.
 *
 *   npm run snapshot            write the new copy
 *   npm run snapshot -- --dry   only print what would be written
 *
 * If the portal answers with too little (offline, blocked), the current file
 * is left untouched.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'ui', 'data', 'portal.js');
const magis = require(path.join(ROOT, 'service', 'magis.js'));
const DRY = process.argv.includes('--dry');

const ROOTS = ['featured', 'movies', 'series', 'kids', 'anime', 'free'];
const MIN_ITEMS = 150;
const MIN_PER_SECTION = 10;
const FIELDS = ['id', 'title', 'category', 'kind', 'score', 'year', 'duration', 'genres', 'director',
  'actors', 'synopsis', 'poster', 'landscape', 'backdrop', 'type', 'alias', 'row'];

function homeRoot(key) {
  return new Promise((resolve, reject) => {
    magis.home(key, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

function slim(item) {
  const out = {};
  for (const f of FIELDS) out[f] = item[f] === undefined || item[f] === null ? '' : item[f];
  if (item.volumeCount) out.volumeCount = item.volumeCount;
  if (item.updateCount) out.updateCount = item.updateCount;
  out.streamUrl = '';
  return out;
}

async function main() {
  const byId = new Map();
  const roots = {};
  for (const key of ROOTS) {
    const code = magis.constants.ROOT_CODES[key];
    let data;
    try { data = await homeRoot(key); }
    catch (e) { throw new Error('el portal no respondió para ' + code + ': ' + e.message); }
    const items = data.items || [];
    const rows = new Set();
    let added = 0;
    for (const item of items) {
      if (!item || !item.id || !item.title) continue;
      if (item.row) rows.add(item.row);
      const known = byId.get(item.id);
      if (!known) { const rec = slim(item); rec.rows = item.row ? [item.row] : []; byId.set(item.id, rec); added++; continue; }
      if (item.row && known.rows.indexOf(item.row) === -1) known.rows.push(item.row);
      /* Same title in several sections: one record, every section listed;
         the first shelf it appeared in is kept. */
      const cats = new Set(String(known.category).split(',').filter(Boolean));
      for (const c of String(item.category || '').split(',')) if (c) cats.add(c);
      known.category = Array.from(cats).join(',');
    }
    roots[code] = { rows: rows.size, added };
    console.log(code.padEnd(18) + String(items.length).padStart(4) + ' títulos, ' + rows.size + ' filas');
  }

  const items = Array.from(byId.values());
  const perSection = {};
  for (const it of items) for (const c of String(it.category).split(',')) perSection[c] = (perSection[c] || 0) + 1;
  const missing = ['destacado', 'pelicula', 'serie', 'infantil', 'anime'].filter((c) => (perSection[c] || 0) < MIN_PER_SECTION);
  if (items.length < MIN_ITEMS || missing.length) {
    throw new Error('respuesta incompleta (' + items.length + ' títulos; secciones con pocos títulos: ' +
      (missing.join(', ') || 'ninguna') + '). No se cambió ' + path.relative(ROOT, OUT));
  }

  const now = new Date().toISOString();
  const payload = { generatedAt: now, source: 'Magis portal (anonymous session)', roots, items };
  const header = [
    '/*',
    ' * CATALOGUE SNAPSHOT  -  generated ' + now + ' by scripts/snapshot-catalog.cjs',
    ' *',
    ' * The catalogue OpenTV shows on its first start (and offline) until the live',
    ' * one arrives. Only public catalogue metadata and the artwork links the',
    ' * portal returns are stored: no user id, token, licence or personal data.',
    ' *',
    ' * Roots: ' + ROOTS.map((k) => magis.constants.ROOT_CODES[k]).join(', '),
    ' *        (getNextColumns, page 1, pageSize 60)',
    ' *',
    ' * Titles and artwork belong to their owners; they are catalogue references.',
    ' * Regenerate with:  npm run snapshot',
    ' */'
  ].join('\n');
  const text = header + '\nwindow.XUPERTV_PORTAL = ' + JSON.stringify(payload, null, 1) + ';\n';
  console.log('\n' + items.length + ' títulos en total · ' + Object.keys(perSection).map((c) => c + ' ' + perSection[c]).join(', '));
  if (DRY) { console.log('(--dry: no se escribió nada)'); return; }
  fs.writeFileSync(OUT, text);
  console.log('Escrito ' + path.relative(ROOT, OUT) + ' (' + Math.round(text.length / 1024) + ' KB)');
}

main().then(() => process.exit(0), (e) => { console.error('No se regeneró el catálogo: ' + e.message); process.exit(1); });
