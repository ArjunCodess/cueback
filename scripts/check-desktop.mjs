import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { launchDesktop } from './desktop.mjs';

const profile = await mkdtemp(join(tmpdir(), 'benchreplay-check-'));
const child = launchDesktop([
  '--remote-debugging-port=0', '--user-data-dir=' + profile,
  '--use-fake-device-for-media-stream',
], ['ignore', 'ignore', 'pipe']);
let socket;

async function until(predicate, limit = 10000) {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    const result = await predicate();
    if (result) return result;
    await delay(60);
  }
  throw new Error('Desktop check timed out');
}

try {
  let logs = '';
  child.stderr.on('data', chunk => { logs += chunk; });
  const port = await until(() => {
    if (child.exitCode !== null) throw new Error(logs);
    return logs.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1];
  });
  const target = await until(async () => {
    const pages = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json());
    return pages.find(page => page.url.endsWith('/dist/index.html'));
  });
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  function command(method, params = {}) {
    const current = ++id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.removeEventListener('message', receive);
        reject(new Error('Timed out: ' + method));
      }, 10000);
      function receive(event) {
        const data = JSON.parse(event.data);
        if (data.id !== current) return;
        clearTimeout(timeout);
        socket.removeEventListener('message', receive);
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result);
      }
      socket.addEventListener('message', receive);
      socket.send(JSON.stringify({ id: current, method, params }));
    });
  }

  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }

  const click = id => evaluate('document.getElementById(' + JSON.stringify(id) + ').click()');
  await until(() => evaluate('document.querySelectorAll(".step").length === 7 && document.querySelector("#lesson").duration > 60'));
  const screenshot = process.argv[2];
  if (screenshot) {
    const { data } = await command('Page.captureScreenshot', { format: 'png' });
    await writeFile(screenshot, Buffer.from(data, 'base64'));
  }
  await click('enable');
  assert.equal(await evaluate('document.querySelector("#consent").open'), true);
  await click('cancel');
  assert.equal(await evaluate('document.querySelector("#consent").open'), false);
  assert.equal(await evaluate(`(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({video:true});
    const tracks = stream.getTracks();
    tracks.forEach(track => track.stop());
    return tracks.every(track => track.kind === 'video' && track.readyState === 'ended');
  })()`), true);
  assert.equal(await evaluate(`navigator.mediaDevices.getUserMedia({audio:true})
    .then(stream => { stream.getTracks().forEach(track => track.stop()); return false; },
      error => error.name === 'NotAllowedError')`), true);
  await evaluate('document.querySelectorAll(".step")[2].click()');
  await click('captions');
  assert.equal(await evaluate('document.querySelector("#caption").hidden'), true);
  await click('demo');
  await click('play');
  await until(() => evaluate('document.querySelector("#lesson").currentTime >= 18'));
  await click('demo-input');
  await until(() => evaluate('document.querySelector("#video-note").textContent.includes("Paused for your work")'));
  assert.equal(await evaluate('document.querySelector("#lesson").paused'), true);
  await click('demo-input');
  await until(() => evaluate('document.querySelector("#replay-count").textContent === "1 hands-free replay"'));
  assert.equal(await evaluate('document.querySelector("#lesson").currentTime < 18'), true);
  assert.equal(await evaluate('document.querySelector("#lesson").paused'), false);
  await click('demo');
  assert.equal(await evaluate('document.querySelector("#mode").textContent.trim()'), 'Manual mode');
  console.log('Desktop playback, captions, camera permission, and simulated replay passed.');
} finally {
  socket?.close();
  if (child.exitCode === null) {
    const closed = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await closed;
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
}
