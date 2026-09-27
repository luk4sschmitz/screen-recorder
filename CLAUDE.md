# Screen Recorder (Electron)

Gravador de tela + webcam para Windows. Responder ao usuário em **português (BR)**; UI em PT-BR. Melhorias e novas funções: **propor primeiro e aguardar aprovação**.

## Arquitetura

- `main.js` — janela, `desktopCapturer` (lista de fontes), `setDisplayMediaRequestHandler` (entrega a fonte escolhida + áudio `'loopback'` = som do sistema no Windows), salvamento e conversão.
- `preload.js` — ponte `window.api` (contextIsolation ligado).
- `renderer/` — UI. O preview central é um `<canvas>` onde tela + webcam PiP são desenhadas; **o preview É a gravação** (`canvas.captureStream(fps)` + mix de áudio WebAudio → MediaRecorder).

## Fatos verificados (2026-09, Electron 38 / Chromium ~140)

- **MediaRecorder grava MP4 nativo**: `video/mp4;codecs="avc1.640028,mp4a.40.2"` é suportado → salvar .mp4 direto. Fallbacks webm no `pickMimeType()`; ffmpeg externo procurado em locais conhecidos (incl. `C:\Claude Code\Scripts Affinity\tools\ffmpeg`).
- **MP4 do MediaRecorder sai SEM duração/índice** (modo streaming: sem `moov` completo) → player mostra vídeo "sem fim", sem barra de tempo. **Correção obrigatória**: remux `ffmpeg -i in -c copy -movflags +faststart out` ao salvar (instantâneo, sem reencodar). Vale para o mp4 nativo e para o webm→mp4.
- **`setContentProtection(true)` funciona de verdade** (testado: janela protegida sai preta no `desktopCapturer`, janela de controle aparece) → usado no pop-up flutuante da webcam para que ele NÃO entre na gravação nem em prints.
- **Pop-up flutuante**: BrowserWindow `frame:false, transparent:true, alwaysOnTop` + `setAlwaysOnTop(true,'screen-saver')` (fica acima de apps em tela cheia) + `skipTaskbar`. Arrasto via CSS `-webkit-app-region: drag` (botões precisam de `no-drag`).
- **Gravar minimizado**: exige `backgroundThrottling: false` no BrowserWindow + loop de desenho com `setInterval` (nunca rAF, que congela em janela oculta).
- **Áudio do sistema**: `audio: 'loopback'` no callback do `setDisplayMediaRequestHandler`; se `getDisplayMedia({audio:true})` falhar, refazer sem áudio (fallback já implementado).
- **ELECTRON_RUN_AS_NODE=1 vem herdado do VSCode** e faz `require('electron')` voltar sem API (ipcMain undefined) — sempre `unset ELECTRON_RUN_AS_NODE` antes de `npx electron`/`electron-builder`. No app **empacotado** o sintoma é diferente: o .exe roda como Node e responde `bad option: --smoke` / sai com código 9.
- Logs do empacotado: `ELECTRON_ENABLE_LOGGING=1 ./"Screen Recorder.exe"`, filtrando o ruído do DXGI (`grep -viE 'dxgi|webrtc|duplicator'`).
- **Ícone**: `gen-icon.js` renderiza um SVG em janela offscreen e escreve `build/icon.ico` multi-tamanho na mão. Cuidado: sem `overflow:hidden` no CSS, as **barras de rolagem entram no ícone**.
- Janela minimizada da FONTE congela frames (limitação do Windows Graphics Capture); janela coberta grava normal.
- Smoke test: `npm run smoke` — abre o app, enumera fontes/dispositivos, grava 2,5s de verdade, imprime `[smoke-report] {...}` e sai. Usar sempre antes de entregar mudança.

## Build

`npm run dist` → `dist\Screen Recorder.exe` (portátil). Ícone ainda é o padrão do Electron (melhoria proposta pendente).
