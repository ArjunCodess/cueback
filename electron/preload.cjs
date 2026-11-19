const { contextBridge, ipcRenderer } = require('electron');
const cameraAvailable = process.argv.includes('--cueback-camera');
if (cameraAvailable) require('@smartspectra/node-sdk/preload');

contextBridge.exposeInMainWorld('cueback', {
  cameraAvailable,
  readPresageKey: () => ipcRenderer.invoke('cueback:presage-key'),
});
