// Pop-up de retorno da webcam: só exibe a câmera escolhida, espelhada.
'use strict';
const dev = new URLSearchParams(location.search).get('device');
const constraints = {
  video: dev
    ? { deviceId: { exact: dev }, width: { ideal: 1280 }, height: { ideal: 720 } }
    : { width: { ideal: 1280 }, height: { ideal: 720 } },
};
navigator.mediaDevices.getUserMedia(constraints)
  .then((s) => { document.getElementById('v').srcObject = s; })
  .catch(() => { document.getElementById('wrap').style.borderColor = '#e5484d'; });
document.getElementById('close').addEventListener('click', () => window.close());
