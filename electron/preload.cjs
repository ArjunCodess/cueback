const { contextBridge, ipcRenderer } = require('electron');
require('@smartspectra/node-sdk/preload');

contextBridge.exposeInMainWorld('benchReplay', {
  readPresageKey: () => ipcRenderer.invoke('benchreplay:presage-key'),
});
