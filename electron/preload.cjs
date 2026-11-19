const { contextBridge, ipcRenderer } = require('electron');
require('@smartspectra/node-sdk/preload');

contextBridge.exposeInMainWorld('cueback', {
  readPresageKey: () => ipcRenderer.invoke('cueback:presage-key'),
});
