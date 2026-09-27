// Ponte segura entre o UI e o processo principal.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSources: () => ipcRenderer.invoke('get-sources'),
  selectSource: (sel) => ipcRenderer.invoke('select-source', sel),
  setRecordingState: (rec) => ipcRenderer.invoke('recording-state', rec),
  saveRecording: (payload) => ipcRenderer.invoke('save-recording', payload),
  smokeReport: (report) => ipcRenderer.invoke('smoke-report', report),
  onHotkeyToggle: (cb) => ipcRenderer.on('hotkey-toggle', cb),
  camPopup: (opts) => ipcRenderer.invoke('cam-popup', opts),
  onCamPopupClosed: (cb) => ipcRenderer.on('cam-popup-closed', cb),
});
