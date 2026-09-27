// Gera build/icon.ico (multi-tamanho, PNGs embutidos) renderizando um SVG
// no próprio Electron (janela offscreen transparente + capturePage).
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#262636"/>
      <stop offset="1" stop-color="#15151f"/>
    </linearGradient>
    <radialGradient id="dot" cx="0.35" cy="0.35" r="1">
      <stop offset="0" stop-color="#ff6b6f"/>
      <stop offset="1" stop-color="#d93036"/>
    </radialGradient>
  </defs>
  <!-- "tela" -->
  <rect width="256" height="256" rx="52" fill="url(#bg)"/>
  <rect x="6" y="6" width="244" height="244" rx="46" fill="none" stroke="#3a3a52" stroke-width="4"/>
  <!-- ponto REC -->
  <circle cx="118" cy="118" r="58" fill="url(#dot)"/>
  <circle cx="118" cy="118" r="76" fill="none" stroke="#ffffff" stroke-opacity="0.92" stroke-width="12"/>
  <!-- PiP da webcam -->
  <rect x="158" y="168" width="66" height="48" rx="12" fill="#e8e8f0"/>
  <circle cx="191" cy="192" r="11" fill="#15151f"/>
</svg>`;

const SIZES = [256, 128, 64, 48, 32, 24, 16];

function buildIco(pngs) {
  // ICONDIR (6 bytes) + ICONDIRENTRY (16 bytes cada) + dados PNG
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reservado
  header.writeUInt16LE(1, 2);      // tipo: ícone
  header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + 16 * count;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);   // largura (0 = 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1);   // altura
    e.writeUInt8(0, 2);                        // paleta
    e.writeUInt8(0, 3);                        // reservado
    e.writeUInt16LE(1, 4);                     // planos
    e.writeUInt16LE(32, 6);                    // bpp
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 256, height: 256, frame: false, transparent: true,
    webPreferences: { offscreen: true },
  });
  const html = `<!DOCTYPE html><html><head><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block}</style></head><body>${SVG}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 600));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  const pngs = SIZES.map((size) => ({
    size,
    buf: (size === 256 ? img : img.resize({ width: size, height: size, quality: 'best' })).toPNG(),
  }));
  fs.mkdirSync(path.join(__dirname, 'build'), { recursive: true });
  const icoPath = path.join(__dirname, 'build', 'icon.ico');
  fs.writeFileSync(icoPath, buildIco(pngs));
  fs.writeFileSync(path.join(__dirname, 'build', 'icon-256.png'), pngs[0].buf);
  console.log('OK', icoPath, fs.statSync(icoPath).size, 'bytes');
  app.quit();
});
