const { app, BrowserWindow } = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');

app.whenReady().then(() => {
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
      preload: require.resolve('@smartspectra/node-sdk/preload'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => event.preventDefault());
  contents.session.setPermissionRequestHandler((sender, permission, callback, details) => {
    callback(sender === contents && sender.getURL() === entryUrl && details.isMainFrame &&
      permission === 'media' && details.mediaTypes?.length === 1 &&
      details.mediaTypes[0] === 'video');
  });
  bindSmartSpectraIpc(window);
  window.loadFile(entry);
});

app.on('window-all-closed', () => app.quit());
