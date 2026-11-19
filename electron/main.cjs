const { app, BrowserWindow, net, protocol } = require('electron');
const { createHash } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const { isAbsolute, join, relative, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');

const scheme = 'benchreplay';
const entry = scheme + '://app/';
const root = resolve(__dirname, '../out');
protocol.registerSchemesAsPrivileged([{
  scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

app.whenReady().then(async () => {
  const [html, lesson] = await Promise.all([
    readFile(join(root, 'index.html'), 'utf8'),
    readFile(join(root, 'lesson/paper-box.mp4')),
  ]);
  // Next's static export embeds its hydration payload as inline scripts.
  const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(([, attributes]) => !/\bsrc=/.test(attributes))
    .map(([, , contents]) => "'sha256-" + createHash('sha256').update(contents).digest('base64') + "'");
  const policy = [
    "default-src 'self'", "script-src 'self' " + hashes.join(' '), "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:", "media-src 'self' blob:", "img-src 'self' data:",
    "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'",
  ].join('; ');
  protocol.handle(scheme, request => {
    const url = new URL(request.url);
    if (url.host !== 'app' || request.method !== 'GET') return new Response(null, { status: 404 });
    if (url.pathname === '/') return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': policy },
    });
    if (url.pathname === '/lesson/paper-box.mp4') {
      const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' };
      const range = request.headers.get('range');
      if (!range) return new Response(lesson, { headers: { ...headers, 'Content-Length': String(lesson.length) } });
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      const start = match ? Number(match[1]) : lesson.length;
      const end = match?.[2] ? Math.min(Number(match[2]), lesson.length - 1) : lesson.length - 1;
      if (start > end) return new Response(null, {
        status: 416, headers: { ...headers, 'Content-Range': 'bytes */' + lesson.length },
      });
      return new Response(lesson.subarray(start, end + 1), {
        status: 206,
        headers: {
          ...headers, 'Content-Length': String(end - start + 1),
          'Content-Range': 'bytes ' + start + '-' + end + '/' + lesson.length,
        },
      });
    }
    let file;
    try {
      file = resolve(root, '.' + decodeURIComponent(url.pathname));
    } catch {
      return new Response(null, { status: 400 });
    }
    const location = relative(root, file);
    if (location.startsWith('..') || isAbsolute(location)) return new Response(null, { status: 404 });
    return net.fetch(pathToFileURL(file).href, { headers: request.headers });
  });
  const window = new BrowserWindow({
    title: 'BenchReplay', width: 1320, height: 930, minWidth: 420, minHeight: 620,
    backgroundColor: '#f1eee6', autoHideMenuBar: true,
    webPreferences: {
      preload: require.resolve('@smartspectra/node-sdk/preload'), contextIsolation: true, sandbox: true,
    },
  });
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => event.preventDefault());
  contents.session.setPermissionRequestHandler((sender, permission, callback, details) => {
    const appPage = sender === contents && sender.getURL().split('#')[0] === entry;
    callback(appPage && details.isMainFrame && permission === 'media' &&
      details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'video');
  });
  bindSmartSpectraIpc(window);
  await window.loadURL(entry);
}).catch(error => {
  console.error(error.message);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
