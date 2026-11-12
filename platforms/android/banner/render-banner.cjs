'use strict';
/* Renders tv-banner.svg into the launcher banner PNGs (Android TV and Fire TV
   show it as a 16:9 card). Run with Electron:
     node_modules/electron/dist/electron platforms/android/banner/render-banner.cjs */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const svg = fs.readFileSync(path.join(__dirname, 'tv-banner.svg'), 'utf8');
const res = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
const sizes = { mdpi: 320, hdpi: 480, xhdpi: 640, xxhdpi: 960, xxxhdpi: 1280 };

app.disableHardwareAcceleration();
app.on('window-all-closed', function () { /* quit explicitly below */ });
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, frame: false,
    webPreferences: { offscreen: true } });
  const tmp = path.join(os.tmpdir(), 'opentv-banner.html');
  fs.writeFileSync(tmp, '<!doctype html><html><body style="margin:0;overflow:hidden;background:#0E0E11">' + svg + '</body></html>');
  await win.loadFile(tmp);
  await new Promise(r => setTimeout(r, 400));
  const full = await win.webContents.capturePage({ x: 0, y: 0, width: 1280, height: 720 });
  for (const dpi of Object.keys(sizes)) {
    const w = sizes[dpi], h = Math.round(w * 9 / 16);
    const dir = path.join(res, 'drawable-' + dpi);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tv_banner.png'), full.resize({ width: w, height: h, quality: 'best' }).toPNG());
    console.log('drawable-' + dpi + '/tv_banner.png', w + 'x' + h);
  }
  /* TVs (uiMode television): a square full-bleed icon with the name.
     Fire TV ignores android:banner for apps not installed from its
     Appstore and draws the launcher icon as a square in a wide card; the
     phone icon (rounded, mipmap-anydpi-v26) showed gray at its corners and
     a 16:9 picture gets squeezed. Phones keep their icon. */
  const iconSvg = fs.readFileSync(path.join(__dirname, 'tv-icon.svg'), 'utf8');
  win.setContentSize(512, 512);
  fs.writeFileSync(tmp, '<!doctype html><html><body style="margin:0;overflow:hidden;background:#0E0E11">' + iconSvg + '</body></html>');
  await win.loadFile(tmp);
  await new Promise(r => setTimeout(r, 400));
  const icon = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const iconSizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const dpi of Object.keys(iconSizes)) {
    /* Twice the launcher size: the TV card draws it larger than a phone. */
    const s = iconSizes[dpi] * 2;
    const tvDir = path.join(res, 'mipmap-television-' + dpi);
    fs.mkdirSync(tvDir, { recursive: true });
    const png = icon.resize({ width: s, height: s, quality: 'best' }).toPNG();
    fs.writeFileSync(path.join(tvDir, 'ic_launcher.png'), png);
    fs.writeFileSync(path.join(tvDir, 'ic_launcher_round.png'), png);
    console.log('mipmap-television-' + dpi + '/ic_launcher.png', s + 'x' + s);
  }
  win.destroy();
  fs.unlinkSync(tmp);
  app.quit();
}).catch(function (e) { console.error(e); app.exit(1); });
