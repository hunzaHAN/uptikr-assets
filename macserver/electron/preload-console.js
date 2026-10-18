'use strict';
const { contextBridge, ipcRenderer, shell } = require('electron');
contextBridge.exposeInMainWorld('macserver', {
  isElectron: true,
  pickFolder: (start) => ipcRenderer.invoke('pick-folder', start),
  openRemote: (url) => ipcRenderer.invoke('open-remote', url),
  openExternal: (url) => shell.openExternal(url),
  minimize: () => ipcRenderer.invoke('win', 'minimize'),
});
