// Screen Recorder — lógica do UI.
// Arquitetura: a tela/janela capturada e a webcam são desenhadas num <canvas>
// (o preview que você vê É exatamente o que é gravado). O canvas vira um
// MediaStream (captureStream) misturado com áudio (mic + sistema via WebAudio)
// e gravado pelo MediaRecorder. O loop de desenho usa setInterval + janela sem
// backgroundThrottling, então minimizar o app NÃO congela a gravação.
'use strict';

const $ = (id) => document.getElementById(id);
const IS_SMOKE = new URLSearchParams(location.search).get('smoke') === '1';

const els = {
  sourceList: $('sourceList'),
  tabs: document.querySelectorAll('#sourceTabs .tab'),
  refresh: $('btnRefreshSources'),
  camSelect: $('camSelect'), micSelect: $('micSelect'),
  camOverlay: $('camOverlay'), camFloat: $('camFloat'), camPos: $('camPos'), camSize: $('camSize'),
  micOn: $('micOn'), sysAudioOn: $('sysAudioOn'),
  fps: $('fpsSelect'), bitrate: $('bitrateSelect'),
  preview: $('preview'), previewEmpty: $('previewEmpty'),
  recBadge: $('recBadge'), recTimer: $('recTimer'),
  camReturn: $('camReturn'),
  btnRecord: $('btnRecord'), btnPause: $('btnPause'), btnStop: $('btnStop'),
  status: $('status'),
  screenVideo: $('screenVideo'),
};

const state = {
  sources: [],
  tab: 'screens',
  selected: null,          // {id, name, isScreen}
  screenStream: null,
  camStream: null,
  drawTimer: null,
  recorder: null,
  chunks: [],
  recording: false,
  paused: false,
  startedAt: 0,
  pausedTotal: 0,
  pausedAt: 0,
  timerTimer: null,
  audioCtx: null,
  mimeType: '',
};

const ctx = els.preview.getContext('2d');

function setStatus(msg, ok) {
  els.status.textContent = msg;
  els.status.classList.toggle('ok', !!ok);
}

// ---------------------------------------------------------------------------
// Fontes (telas / janelas)
async function loadSources() {
  state.sources = await window.api.getSources();
  renderSources();
}

// o Windows não lista janelas minimizadas; atualizamos sozinhos para que um
// app restaurado apareça na hora (re-render só quando a lista muda de fato)
let lastSourcesKey = '';
async function autoRefreshSources() {
  if (state.recording) return;
  try {
    const sources = await window.api.getSources();
    const key = sources.map((s) => s.id + s.name).join('|');
    if (key !== lastSourcesKey) {
      lastSourcesKey = key;
      state.sources = sources;
      renderSources();
    }
  } catch (e) { }
}
setInterval(autoRefreshSources, 2500);

function renderSources() {
  els.sourceList.innerHTML = '';
  const list = state.sources.filter((s) => (state.tab === 'screens' ? s.isScreen : !s.isScreen));
  for (const s of list) {
    const btn = document.createElement('button');
    btn.className = 'source-item' + (state.selected?.id === s.id ? ' selected' : '');
    const thumb = document.createElement('img');
    thumb.className = 'thumb'; thumb.src = s.thumbnail;
    const meta = document.createElement('div'); meta.className = 'meta';
    if (s.icon) { const ic = document.createElement('img'); ic.className = 'appicon'; ic.src = s.icon; meta.appendChild(ic); }
    const name = document.createElement('span'); name.className = 'name'; name.textContent = s.name;
    meta.appendChild(name);
    btn.appendChild(thumb); btn.appendChild(meta);
    btn.addEventListener('click', () => selectSource(s));
    els.sourceList.appendChild(btn);
  }
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = state.tab === 'windows'
      ? 'Nenhuma janela visível. Restaure (desminimize) o app que quer gravar — a lista atualiza sozinha.'
      : 'Nada encontrado. Clique em Atualizar.';
    els.sourceList.appendChild(p);
  }
}

async function selectSource(s) {
  if (state.recording) return;
  state.selected = { id: s.id, name: s.name, isScreen: s.isScreen };
  renderSources();
  await acquireScreen();
}

async function acquireScreen() {
  stopStream(state.screenStream);
  state.screenStream = null;
  if (!state.selected) return;
  try {
    await window.api.selectSource({ ...state.selected, systemAudio: true });
    state.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: Number(els.fps.value) },
      audio: true,
    });
  } catch (e) {
    // alguns sistemas recusam o loopback de áudio: tenta só vídeo
    try {
      await window.api.selectSource({ ...state.selected, systemAudio: false });
      state.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: Number(els.fps.value) },
      });
      setStatus('Som do sistema indisponível neste dispositivo — gravando sem ele.');
    } catch (e2) {
      setStatus('Não consegui capturar a fonte: ' + (e2.message || e2));
      return;
    }
  }
  els.screenVideo.srcObject = state.screenStream;
  await els.screenVideo.play().catch(() => { });
  els.previewEmpty.hidden = true;
  els.btnRecord.disabled = false;
  startDrawLoop();
  setStatus('Fonte: ' + state.selected.name + ' — pronto para gravar.', true);
}

// ---------------------------------------------------------------------------
// Dispositivos (webcam / microfone)
async function loadDevices() {
  // pede permissão uma vez para liberar os nomes dos dispositivos
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    tmp.getTracks().forEach((t) => t.stop());
  } catch (e) { }
  const devs = await navigator.mediaDevices.enumerateDevices();
  const cams = devs.filter((d) => d.kind === 'videoinput');
  const mics = devs.filter((d) => d.kind === 'audioinput');
  els.camSelect.innerHTML = '';
  els.micSelect.innerHTML = '';
  for (const c of cams) {
    const o = document.createElement('option');
    o.value = c.deviceId; o.textContent = c.label || 'Câmera';
    els.camSelect.appendChild(o);
  }
  for (const m of mics) {
    const o = document.createElement('option');
    o.value = m.deviceId; o.textContent = m.label || 'Microfone';
    els.micSelect.appendChild(o);
  }
  if (!cams.length) {
    const o = document.createElement('option');
    o.textContent = 'Nenhuma câmera'; els.camSelect.appendChild(o);
    els.camOverlay.checked = false;
  }
  return { cams: cams.length, mics: mics.length };
}

async function acquireCam() {
  stopStream(state.camStream);
  state.camStream = null;
  const id = els.camSelect.value;
  if (!id) return;
  try {
    state.camStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: id }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    els.camReturn.srcObject = state.camStream;
    await els.camReturn.play().catch(() => { });
  } catch (e) {
    setStatus('Webcam indisponível: ' + (e.message || e));
  }
}

function stopStream(stream) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
}

// ---------------------------------------------------------------------------
// Composição (preview = gravação)
function startDrawLoop() {
  if (state.drawTimer) clearInterval(state.drawTimer);
  const fps = Number(els.fps.value);
  state.drawTimer = setInterval(drawFrame, Math.round(1000 / fps));
}

function drawFrame() {
  const sv = els.screenVideo;
  if (!sv.videoWidth) return;
  if (els.preview.width !== sv.videoWidth || els.preview.height !== sv.videoHeight) {
    els.preview.width = sv.videoWidth;
    els.preview.height = sv.videoHeight;
  }
  const W = els.preview.width, H = els.preview.height;
  ctx.drawImage(sv, 0, 0, W, H);

  // webcam PiP
  const cv = els.camReturn;
  if (els.camOverlay.checked && state.camStream && cv.videoWidth) {
    const frac = Number(els.camSize.value);
    const cw = Math.round(W * frac);
    const ch = Math.round(cw * cv.videoHeight / cv.videoWidth);
    const m = Math.round(W * 0.02);
    const pos = els.camPos.value;
    const x = pos.includes('l') ? m : W - cw - m;
    const y = pos.includes('t') ? m : H - ch - m;
    const r = Math.round(cw * 0.06);
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, x, y, cw, ch, r);
    ctx.clip();
    ctx.drawImage(cv, x, y, cw, ch);
    ctx.restore();
    ctx.beginPath();
    roundRect(ctx, x, y, cw, ch, r);
    ctx.lineWidth = Math.max(2, W / 640);
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.stroke();
  }
}

function roundRect(c, x, y, w, h, r) {
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// ---------------------------------------------------------------------------
// Gravação
function pickMimeType() {
  const prefs = [
    'video/mp4;codecs="avc1.640028,mp4a.40.2"',
    'video/mp4',
    'video/webm;codecs="h264,opus"',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return prefs.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function buildRecordingStream() {
  const fps = Number(els.fps.value);
  const stream = els.preview.captureStream(fps);

  // mixagem de áudio: microfone + som do sistema
  const wantMic = els.micOn.checked && els.micSelect.value;
  const sysTrack = els.sysAudioOn.checked ? state.screenStream.getAudioTracks()[0] : null;
  const micPromise = wantMic
    ? navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: els.micSelect.value } } }).catch(() => null)
    : Promise.resolve(null);

  return micPromise.then((micStream) => {
    state.micStream = micStream;
    if (!micStream && !sysTrack) return stream;
    state.audioCtx = new AudioContext();
    const dest = state.audioCtx.createMediaStreamDestination();
    if (micStream) state.audioCtx.createMediaStreamSource(micStream).connect(dest);
    if (sysTrack) state.audioCtx.createMediaStreamSource(new MediaStream([sysTrack])).connect(dest);
    for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
    return stream;
  });
}

async function startRecording() {
  if (!state.screenStream) return;
  const stream = await buildRecordingStream();
  state.mimeType = pickMimeType();
  state.chunks = [];
  state.recorder = new MediaRecorder(stream, {
    mimeType: state.mimeType || undefined,
    videoBitsPerSecond: Number(els.bitrate.value),
    audioBitsPerSecond: 192000,
  });
  state.recorder.ondataavailable = (e) => { if (e.data.size) state.chunks.push(e.data); };
  state.recorder.onstop = onRecorderStop;
  state.recorder.start(1000);

  state.recording = true;
  state.paused = false;
  state.startedAt = Date.now();
  state.pausedTotal = 0;
  state.timerTimer = setInterval(updateTimer, 400);
  els.recBadge.hidden = false;
  els.btnRecord.disabled = true;
  els.btnPause.disabled = false;
  els.btnStop.disabled = false;
  lockSettings(true);
  window.api.setRecordingState(true);
  // retorno flutuante acompanha a gravação (invisível no vídeo)
  if (state.camStream) {
    els.camFloat.checked = true;
    window.api.camPopup({ show: true, deviceId: els.camSelect.value });
  }
  setStatus('Gravando… (Ctrl+Shift+F9 para, mesmo com o app minimizado)', true);
}

function pauseResume() {
  if (!state.recorder) return;
  if (state.paused) {
    state.recorder.resume();
    state.pausedTotal += Date.now() - state.pausedAt;
    state.paused = false;
    els.btnPause.textContent = '⏸ Pausar';
    setStatus('Gravando…', true);
  } else {
    state.recorder.pause();
    state.pausedAt = Date.now();
    state.paused = true;
    els.btnPause.textContent = '⏵ Retomar';
    setStatus('Pausado.');
  }
}

function stopRecording() {
  if (!state.recorder || !state.recording) return;
  state.recording = false;
  clearInterval(state.timerTimer);
  state.recorder.stop();     // onstop salva
}

async function onRecorderStop() {
  setStatus('Salvando…');
  els.btnPause.disabled = true;
  els.btnStop.disabled = true;
  const blob = new Blob(state.chunks, { type: state.mimeType || 'video/webm' });
  state.chunks = [];
  const buffer = await blob.arrayBuffer();
  const isMp4 = /mp4/.test(state.mimeType);
  const isH264 = /h264|avc1/i.test(state.mimeType);
  try {
    const res = await window.api.saveRecording({ buffer, container: isMp4 ? 'mp4' : 'webm', isH264 });
    setStatus('Salvo: ' + res.path, true);
  } catch (e) {
    setStatus('Erro ao salvar: ' + (e.message || e));
  }
  // limpeza
  if (state.audioCtx) { state.audioCtx.close().catch(() => { }); state.audioCtx = null; }
  stopStream(state.micStream); state.micStream = null;
  els.recBadge.hidden = true;
  els.btnRecord.disabled = false;
  els.btnPause.textContent = '⏸ Pausar';
  lockSettings(false);
  window.api.setRecordingState(false);
}

function lockSettings(locked) {
  for (const el of [els.camSelect, els.micSelect, els.micOn, els.sysAudioOn, els.fps, els.bitrate, els.refresh]) {
    el.disabled = locked;
  }
}

function updateTimer() {
  if (state.paused) return;
  const s = Math.floor((Date.now() - state.startedAt - state.pausedTotal) / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  els.recTimer.textContent = `${mm}:${ss}`;
}

// ---------------------------------------------------------------------------
// Eventos
els.tabs.forEach((t) => t.addEventListener('click', () => {
  els.tabs.forEach((x) => x.classList.remove('active'));
  t.classList.add('active');
  state.tab = t.dataset.tab;
  renderSources();
}));
els.refresh.addEventListener('click', loadSources);
els.camSelect.addEventListener('change', () => {
  acquireCam();
  if (els.camFloat.checked) window.api.camPopup({ show: true, deviceId: els.camSelect.value });
});
// pop-up flutuante do retorno: abre/fecha na hora; fechá-lo desmarca a caixa
els.camFloat.addEventListener('change', () => {
  window.api.camPopup({ show: els.camFloat.checked, deviceId: els.camSelect.value });
});
window.api.onCamPopupClosed(() => { els.camFloat.checked = false; });
els.fps.addEventListener('change', () => { if (!state.recording) { startDrawLoop(); if (state.selected) acquireScreen(); } });
els.btnRecord.addEventListener('click', startRecording);
els.btnPause.addEventListener('click', pauseResume);
els.btnStop.addEventListener('click', stopRecording);
window.api.onHotkeyToggle(() => {
  if (state.recording) stopRecording();
  else if (!els.btnRecord.disabled) startRecording();
});

// ---------------------------------------------------------------------------
// Inicialização
(async function init() {
  const devs = await loadDevices();
  await acquireCam();
  await loadSources();
  // seleciona a tela principal por padrão
  const firstScreen = state.sources.find((s) => s.isScreen);
  if (firstScreen) await selectSource(firstScreen);

  if (IS_SMOKE) {
    // teste automatizado: grava 2s da composição e reporta
    const report = {
      sources: state.sources.length,
      cams: devs.cams, mics: devs.mics,
      mimeType: pickMimeType(),
      screenOk: !!state.screenStream,
      camOk: !!state.camStream,
    };
    try {
      if (state.screenStream) {
        await startRecording();
        await new Promise((r) => setTimeout(r, 2500));
        const stopped = new Promise((r) => { state.recorder.addEventListener('stop', r, { once: true }); });
        stopRecording();
        await stopped;
        await new Promise((r) => setTimeout(r, 1500));
        report.recorded = true;
        report.finalStatus = els.status.textContent;
      }
    } catch (e) { report.err = String(e); }
    window.api.smokeReport(report);
  }
})();
