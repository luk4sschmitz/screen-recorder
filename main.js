// Screen Recorder — processo principal do Electron.
// Responsável por: janela, lista de fontes de captura (telas/janelas),
// handler de getDisplayMedia (com áudio loopback do sistema), salvamento
// do arquivo e conversão para MP4 via ffmpeg externo quando disponível.
'use strict';

const { app, BrowserWindow, ipcMain, desktopCapturer, session, shell, powerSaveBlocker, globalShortcut, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const SMOKE = process.argv.includes('--smoke');

let mainWindow = null;
let selectedSource = null;      // fonte escolhida no UI (objeto do desktopCapturer)
let wantSystemAudio = false;
let blockerId = null;

// ---------------------------------------------------------------------------
// ffmpeg externo (opcional): procura em locais conhecidos para converter p/ MP4
function findFfmpeg() {
  // no build portable o exe roda de uma pasta temporária; PORTABLE_EXECUTABLE_DIR
  // é a pasta real de onde o usuário abriu o app
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  const candidates = [
    portableDir && path.join(portableDir, 'ffmpeg', 'ffmpeg.exe'),
    portableDir && path.join(portableDir, 'ffmpeg.exe'),
    path.join(path.dirname(app.getPath('exe')), 'ffmpeg', 'ffmpeg.exe'),
    path.join(__dirname, 'ffmpeg', 'ffmpeg.exe'),
    'C:\\Claude Code\\Screen Recorder\\ffmpeg\\ffmpeg.exe',
    'C:\\Claude Code\\Scripts Affinity\\tools\\ffmpeg\\bin\\ffmpeg.exe',
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (e) { }
  }
  // PATH
  const dirs = (process.env.PATH || '').split(';');
  for (const d of dirs) {
    try { if (d && fs.existsSync(path.join(d, 'ffmpeg.exe'))) return path.join(d, 'ffmpeg.exe'); } catch (e) { }
  }
  return null;
}

function outputDir() {
  const dir = path.join(app.getPath('videos'), 'Screen Recorder');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// remove .raw.mp4 órfãos (app fechado entre o remux e a limpeza, ou crash)
function sweepRawFiles() {
  try {
    const dir = outputDir();
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.raw.mp4')) continue;
      const raw = path.join(dir, f);
      const final = path.join(dir, f.replace(/\.raw\.mp4$/, '.mp4'));
      // só descarta o bruto se o arquivo final existe e não está vazio
      if (fs.existsSync(final) && fs.statSync(final).size > 0) fs.unlinkSync(raw);
      else fs.renameSync(raw, final);   // remux não chegou a rodar: o bruto vira o vídeo
    }
  } catch (e) { }
}

function timestampName() {
  const t = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `rec_${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}_${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`;
}

// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#12121a',
    autoHideMenuBar: true,
    title: 'Screen Recorder',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // gravação continua mesmo com o app minimizado: sem throttling
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'), SMOKE ? { query: { smoke: '1' } } : {});
  // o pop-up da webcam é outra janela: sem isto, window-all-closed nunca dispara e ele fica na tela
  mainWindow.on('closed', () => app.quit());

  // permissões de mídia (webcam/microfone/captura) sempre concedidas ao nosso UI
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(['media', 'display-capture', 'mediaKeySystem'].includes(permission));
  });

  // getDisplayMedia entrega a fonte que o usuário escolheu no nosso UI;
  // áudio 'loopback' captura o som do sistema no Windows
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!selectedSource) { callback({}); return; }
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      const src = sources.find((s) => s.id === selectedSource.id);
      if (!src) { callback({}); return; }
      callback(wantSystemAudio ? { video: src, audio: 'loopback' } : { video: src });
    }).catch(() => callback({}));
  }, { useSystemPicker: false });

  if (SMOKE) {
    mainWindow.webContents.on('console-message', (e, level, message) => {
      console.log('[renderer]', message);
    });
    setTimeout(() => { console.log('[smoke] fim'); app.quit(); }, 40000);
  }
}

// ---------------------------------------------------------------------------
// IPC
ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 400, height: 225 },
    fetchWindowIcons: true,
  });
  return sources
    .filter((s) => s.name !== 'Screen Recorder')   // não listar o próprio app
    .map((s) => ({
      id: s.id,
      name: s.name,
      isScreen: s.id.startsWith('screen'),
      thumbnail: s.thumbnail.toDataURL(),
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
    }));
});

ipcMain.handle('select-source', (e, { id, name, isScreen, systemAudio }) => {
  selectedSource = { id, name, isScreen };
  wantSystemAudio = !!systemAudio;
  return true;
});

ipcMain.handle('recording-state', (e, recording) => {
  if (recording) {
    if (blockerId === null) blockerId = powerSaveBlocker.start('prevent-display-sleep');
    mainWindow.setTitle('● GRAVANDO — Screen Recorder');
  } else {
    if (blockerId !== null) { powerSaveBlocker.stop(blockerId); blockerId = null; }
    mainWindow.setTitle('Screen Recorder');
  }
  return true;
});

function runFfmpeg(ffmpeg, args) {
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, args, { windowsHide: true });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}

ipcMain.handle('save-recording', async (e, { buffer, container, isH264 }) => {
  const dir = outputDir();
  const base = path.join(dir, timestampName());
  const ffmpeg = findFfmpeg();

  // MediaRecorder entrega MP4 em modo streaming, SEM duração/índice no
  // cabeçalho (player fica sem barra de tempo). O remux -c copy reescreve o
  // container com moov correto e faststart — instantâneo, sem reencodar.
  if (container === 'mp4') {
    const rawPath = base + '.raw.mp4';
    const mp4Direct = base + '.mp4';
    fs.writeFileSync(rawPath, Buffer.from(buffer));
    if (ffmpeg && await runFfmpeg(ffmpeg, ['-y', '-i', rawPath, '-c', 'copy', '-movflags', '+faststart', mp4Direct]) && fs.existsSync(mp4Direct)) {
      fs.unlinkSync(rawPath);
    } else {
      fs.renameSync(rawPath, mp4Direct);   // sem ffmpeg: fica como veio
    }
    shell.showItemInFolder(mp4Direct);
    return { path: mp4Direct, mp4: true };
  }

  const webmPath = base + '.webm';
  fs.writeFileSync(webmPath, Buffer.from(buffer));

  let finalPath = webmPath;
  if (ffmpeg) {
    const mp4Path = base + '.mp4';
    // h264 no webm: remux instantâneo (-c copy). Outros codecs: reencode.
    const args = isH264
      ? ['-y', '-i', webmPath, '-c', 'copy', '-movflags', '+faststart', mp4Path]
      : ['-y', '-i', webmPath, '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', mp4Path];
    if (await runFfmpeg(ffmpeg, args) && fs.existsSync(mp4Path)) {
      fs.unlinkSync(webmPath);
      finalPath = mp4Path;
    }
  }
  shell.showItemInFolder(finalPath);
  return { path: finalPath, mp4: finalPath.endsWith('.mp4') };
});

// ---------------------------------------------------------------------------
// Pop-up flutuante do retorno da webcam: sempre no topo, arrastável,
// redimensionável e EXCLUÍDO da captura de tela (content protection) — pode
// ficar sobre a tela gravada sem aparecer no vídeo.
let camPopup = null;

ipcMain.handle('cam-popup', (e, { show, deviceId }) => {
  if (!show) {
    if (camPopup && !camPopup.isDestroyed()) camPopup.close();
    return true;
  }
  if (camPopup && !camPopup.isDestroyed()) {
    // troca de câmera: recarrega com o novo dispositivo
    camPopup.loadFile(path.join(__dirname, 'renderer', 'campopup.html'), { query: { device: deviceId || '' } });
    return true;
  }
  const wa = screen.getPrimaryDisplay().workArea;
  const W = 300, H = 200;
  camPopup = new BrowserWindow({
    x: wa.x + wa.width - W - 24, y: wa.y + wa.height - H - 24,
    width: W, height: H, minWidth: 160, minHeight: 110,
    frame: false, transparent: true, resizable: true,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  camPopup.setAlwaysOnTop(true, 'screen-saver');
  camPopup.setContentProtection(true);   // invisível para gravações e prints
  camPopup.loadFile(path.join(__dirname, 'renderer', 'campopup.html'), { query: { device: deviceId || '' } });
  camPopup.on('closed', () => {
    camPopup = null;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('cam-popup-closed');
  });
  return true;
});

ipcMain.handle('smoke-report', (e, report) => {
  console.log('[smoke-report]', JSON.stringify(report));
  // no app empacotado não há stdout: o relatório vai para um arquivo ao lado do exe
  try {
    fs.writeFileSync(path.join(path.dirname(app.getPath('exe')), 'smoke-report.json'), JSON.stringify(report, null, 1));
  } catch (err) { }
  if (SMOKE) setTimeout(() => app.quit(), 500);
  return true;
});

// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  sweepRawFiles();
  createWindow();
  // atalho global: funciona mesmo com o app minimizado / outro app em foco
  globalShortcut.register('Control+Shift+F9', () => {
    if (mainWindow) mainWindow.webContents.send('hotkey-toggle');
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
