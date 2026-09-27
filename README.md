# Screen Recorder

Gravador de tela para Windows com webcam em PiP e retorno em tempo real. Feito em Electron.

## Como usar

- Abra o **Screen Recorder.exe** (em `dist\`, ou pelo atalho da Área de Trabalho).
- **1. Fonte**: escolha uma tela inteira ou uma janela de app. Gravar janela esconde a barra de tarefas e continua gravando mesmo com outros apps por cima ou com o gravador minimizado. (Limite do Windows: se a janela gravada for *minimizada*, a imagem dela congela até restaurar.)
- **2. Webcam**: o retorno aparece ao vivo no canto superior direito. O PiP no vídeo é opcional (posição e tamanho configuráveis). O preview central mostra exatamente o que será gravado.
- **Retorno flutuante**: marque *"Retorno flutuante sobre a tela"* para abrir um pop-up da webcam que fica **sempre por cima de qualquer app ou monitor** — arraste pela imagem, redimensione pelas bordas, feche no × do canto. Ele é **invisível na gravação e em prints**, então pode ficar em cima da tela gravada sem sujar o vídeo. Abre sozinho quando você começa a gravar.
- **3. Áudio**: microfone e/ou som do sistema.
- **4. Qualidade**: FPS (24/30/60) e bitrate.
- **● Gravar** — e **Ctrl+Shift+F9** grava/para de qualquer lugar, mesmo com o app minimizado.
- Os vídeos saem em **MP4 (H.264+AAC)** direto em `Vídeos\Screen Recorder\`, com duração/índice corretos (barra de tempo funcionando em qualquer player); o Explorer abre no arquivo ao terminar.

## Desenvolvimento

```
npm install
npm start            # roda em modo dev
npm run smoke        # teste automatizado (grava 2,5s e reporta no stdout)
npm run dist         # gera o executável portátil em dist\
```

Nota: rodando a partir do VSCode/Claude Code, remova `ELECTRON_RUN_AS_NODE` do ambiente antes (`unset ELECTRON_RUN_AS_NODE`).
