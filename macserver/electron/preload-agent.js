'use strict';
// 숨김 에이전트 창 ↔ 메인 프로세스 브리지 (화면 캡처 소스/입력/클립보드/권한)
const { contextBridge, ipcRenderer } = require('electron');
let configCb = null;
ipcRenderer.on('agent:config', (_e, cfg) => { if (configCb) configCb(cfg); });
let clipCb = null;
ipcRenderer.on('native:clipboard', (_e, text) => { if (clipCb) clipCb(text); });
contextBridge.exposeInMainWorld('macserverAgent', {
  token: ipcRenderer.sendSync('agent:token'),
  input: (events) => ipcRenderer.invoke('agent:input', events),
  getDisplays: () => ipcRenderer.invoke('agent:displays'),
  readClipboard: () => ipcRenderer.invoke('agent:clipboard:get'),
  writeClipboard: (text) => ipcRenderer.invoke('agent:clipboard:set', text),
  setConfig: (cfg) => ipcRenderer.invoke('agent:setconfig', cfg),
  status: (txt) => ipcRenderer.send('agent:status', txt),
  onConfig: (cb) => { configCb = cb; },
  onClipboard: (cb) => { clipCb = cb; },
});
