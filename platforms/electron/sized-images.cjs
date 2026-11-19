'use strict';
/*
 * Images at the size they are shown (port of Android's SizedImages.java).
 *
 * The page asks for opentv-img://local/i?w=<px>&u=<image url>. The image is
 * downloaded once, reduced to w pixels wide with Chromium's best filter and
 * kept on disk as a JPEG. Episode pictures come in every size (Kitsu's go
 * from 825 px to 4K, some of those heavily compressed); shrunk by the page
 * itself the big ones looked rough next to the others, and each 4K picture
 * cost ~33 MB once decoded. Formats nativeImage cannot read (WebP, AVIF) are
 * passed on as they came.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { nativeImage } = require('electron');

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_FILES = 4000;           /* the oldest go when there are more */
const KEEP_DAYS = 30;

function key(text) { return crypto.createHash('sha1').update(text).digest('hex'); }

function prune(dir) {
  fs.readdir(dir, (err, names) => {
    if (err) return;
    const limit = Date.now() - KEEP_DAYS * 86400000;
    const files = [];
    for (const name of names) {
      try {
        const st = fs.statSync(path.join(dir, name));
        if (st.mtimeMs < limit) fs.unlinkSync(path.join(dir, name));
        else files.push({ name, at: st.mtimeMs });
      } catch { /* gone */ }
    }
    if (files.length <= MAX_FILES) return;
    files.sort((a, b) => a.at - b.at);
    for (const f of files.slice(0, files.length - MAX_FILES)) {
      try { fs.unlinkSync(path.join(dir, f.name)); } catch { /* gone */ }
    }
  });
}

function install(protocol, net, dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
  setTimeout(() => prune(dir), 30000);
  protocol.handle('opentv-img', async (request) => {
    let src, w;
    try {
      const url = new URL(request.url);
      src = url.searchParams.get('u') || '';
      w = parseInt(url.searchParams.get('w'), 10) || 0;
    } catch { return new Response('Bad request', { status: 400 }); }
    if (!/^https?:\/\//i.test(src) || w < 16 || w > 3840) return new Response('Bad request', { status: 400 });
    const file = path.join(dir, key(w + '|' + src) + '.jpg');
    try {
      const cached = await fs.promises.readFile(file);
      if (cached.length) return new Response(cached, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=31536000' } });
    } catch { /* not yet */ }
    let res;
    try { res = await net.fetch(src); } catch { return new Response('Bad gateway', { status: 502 }); }
    if (!res.ok) return new Response('Not found', { status: res.status || 404 });
    const raw = Buffer.from(await res.arrayBuffer());
    if (!raw.length || raw.length > MAX_BYTES) return new Response('Too large', { status: 413 });
    const img = nativeImage.createFromBuffer(raw);
    if (img.isEmpty()) {
      /* A format nativeImage does not read: the original, untouched. */
      return new Response(raw, { headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream' } });
    }
    const size = img.getSize();
    const small = size.width > w ? img.resize({ width: w, quality: 'best' }) : img;
    const jpeg = small.toJPEG(86);
    fs.promises.writeFile(file + '.tmp', jpeg)
      .then(() => fs.promises.rename(file + '.tmp', file))
      .catch(() => {});
    return new Response(jpeg, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=31536000' } });
  });
}

module.exports = { install };
