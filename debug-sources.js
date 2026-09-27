// Diagnóstico: enumera fontes do desktopCapturer com várias opções.
'use strict';
const { app, desktopCapturer } = require('electron');

async function dump(label, opts) {
  try {
    const t = Date.now();
    const sources = await desktopCapturer.getSources(opts);
    console.log(`[${label}] ${sources.length} fontes em ${Date.now() - t}ms`);
    for (const s of sources) console.log(`   - ${s.id}  "${s.name}"`);
  } catch (e) {
    console.log(`[${label}] ERRO: ${e}`);
  }
}

app.whenReady().then(async () => {
  await dump('win+screen, thumbs 400x225, icons', { types: ['screen', 'window'], thumbnailSize: { width: 400, height: 225 }, fetchWindowIcons: true });
  await dump('window only, thumbs 400x225', { types: ['window'], thumbnailSize: { width: 400, height: 225 } });
  await dump('window only, sem thumbs', { types: ['window'], thumbnailSize: { width: 0, height: 0 } });
  await dump('window only, sem icons', { types: ['window'], thumbnailSize: { width: 150, height: 150 }, fetchWindowIcons: false });
  app.quit();
});
