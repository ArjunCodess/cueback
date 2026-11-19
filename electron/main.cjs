const { app, BrowserWindow, ipcMain } = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');

app.whenReady().then(() => {
  try {
    process.loadEnvFile(join(__dirname, '../.env'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const entry = join(__dirname, '../dist/index.html');
  const entryUrl = pathToFileURL(entry).href;
  const window = new BrowserWindow({
    title: 'BenchReplay',
    width: 1320,
    height: 930,
    minWidth: 420,
    minHeight: 620,
    backgroundColor: '#f1eee6',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../dist/preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      zoomFactor: 1.2,
    },
  });
  const contents = window.webContents;
  ipcMain.handle('benchreplay:presage-key', event => {
    const frame = event.senderFrame;
    if (event.sender !== contents || !frame || frame.parent || frame.url.split('#')[0] !== entryUrl) return '';
    return process.env.PRESAGE_API_KEY?.trim() ?? '';
  });
  window.on('closed', () => ipcMain.removeHandler('benchreplay:presage-key'));
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => event.preventDefault());
  contents.session.setPermissionRequestHandler((sender, permission, callback, details) => {
    callback(sender === contents && sender.getURL().split('#')[0] === entryUrl && details.isMainFrame &&
      permission === 'media' && details.mediaTypes?.length === 1 &&
      details.mediaTypes[0] === 'video');
  });
  bindSmartSpectraIpc(window);
  return window.loadFile(entry);
}).catch(error => {
  console.error(error.message);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
