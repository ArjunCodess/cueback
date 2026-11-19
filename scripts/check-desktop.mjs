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
    return pages.find(page => page.url === 'benchreplay://app/');
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
        reject(new Error('Timed out: ' + method + ' ' + (params.expression ?? '').trim().slice(0, 200)));
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
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }

  const click = id => evaluate('document.getElementById(' + JSON.stringify(id) + ').click()');
  await until(() => evaluate('document.querySelectorAll(".step").length === 7 && document.querySelector("#lesson").duration > 60'));
  await command('Page.enable');
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.registeredTools = new Map();
    window.agentErrors = [];
    addEventListener('unhandledrejection', event => window.agentErrors.push(String(event.reason)));
    Object.defineProperty(document, 'modelContext', { value: {
      async registerTool(tool) { window.registeredTools.set(tool.name, tool); },
      unregisterTool(name) { window.registeredTools.delete(name); },
    } });
  ` });
  await command('Page.navigate', { url: 'benchreplay://app/' });
  await until(() => evaluate('document.querySelectorAll(".step").length === 7 && document.querySelector("#lesson").duration > 60'));
  await until(() => evaluate('window.registeredTools?.size === 3')).catch(async error => {
    const details = await evaluate('({tools: window.registeredTools && [...window.registeredTools.keys()], errors: window.agentErrors})');
    throw new Error(error.message + ': ' + JSON.stringify(details));
  });
  const snapshot = await evaluate(`[...window.registeredTools.values()]
    .find(tool => tool.name.endsWith('snapshot')).execute({})`);
  assert.ok(snapshot.every(entry => entry.label || entry.component === 'more'));
  const modeAction = await evaluate(`[...window.registeredTools.values()]
    .find(tool => tool.name.endsWith('act')).execute({ steps: [{ ref: 'Try simulated input', action: 'press' }] })`);
  assert.equal(modeAction.ok, true, JSON.stringify(modeAction.error));
  await until(() => evaluate('document.querySelector("#mode").textContent.trim() === "Simulation only"'));
  await click('demo');
  const rejected = await evaluate(`[...window.registeredTools.values()]
    .find(tool => tool.name.endsWith('act')).execute({ steps: [{ ref: 'Set up camera', action: 'press' }] })`);
  assert.equal(rejected.ok, false);
  await command('Emulation.setDeviceMetricsOverride', { width: 420, height: 780, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await command('Emulation.clearDeviceMetricsOverride');
  const screenshot = process.argv[2];
  if (screenshot) {
    const { data } = await command('Page.captureScreenshot', { format: 'png' });
    await writeFile(screenshot, Buffer.from(data, 'base64'));
  }
  await click('enable');
  await until(() => evaluate("!!document.querySelector('#consent')?.matches('[open], [data-open]')"));
  assert.equal(await evaluate('document.querySelector("#consent input").required'), true);
  await evaluate('document.querySelector("#consent form").requestSubmit()');
  assert.equal(await evaluate("!!document.querySelector('#consent')?.matches('[open], [data-open]')"), true);
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => evaluate('document.activeElement.id === "enable"'));
  await click('enable');
  await until(() => evaluate("!!document.querySelector('#consent')?.matches('[open], [data-open]')"));
  await click('cancel');
  await until(() => evaluate("!document.querySelector('#consent')?.matches('[open], [data-open]')"));
  assert.equal(await evaluate(`(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({video:true});
    const tracks = stream.getTracks();
    tracks.forEach(track => track.stop());
    return tracks.every(track => track.kind === 'video' && track.readyState === 'ended');
  })()`), true);
  assert.equal(await evaluate(`navigator.mediaDevices.getUserMedia({audio:true})
    .then(stream => { stream.getTracks().forEach(track => track.stop()); return false; },
      error => error.name === 'NotAllowedError')`), true);
  await evaluate(`navigator.mediaDevices.getUserMedia = async () => {
    throw new DOMException('Denied in desktop test', 'NotAllowedError');
  }`);
  await click('enable');
  await until(() => evaluate('!!document.querySelector("#consent input")'));
  await evaluate(`document.querySelector('#consent input').value = 'desktop-test';
    document.querySelector('#consent form').requestSubmit()`);
  await until(() => evaluate('document.querySelector("#camera-help").textContent.includes("Camera access was denied")'));
  assert.equal(await evaluate('!!document.querySelector("#enable")'), true);
  await evaluate('document.querySelectorAll(".step")[2].click()');
  await click('captions');
  assert.equal(await evaluate('document.querySelector("#caption").hidden'), true);
  await click('demo');
  await click('play');
  await until(() => evaluate('document.querySelector("#lesson").currentTime >= 18')).catch(async error => {
    const details = await evaluate(`(() => {
      const media = document.querySelector('#lesson');
      return { time: media.currentTime, paused: media.paused, seeking: media.seeking,
        ready: media.readyState, error: media.error?.message, note: document.querySelector('#video-note').textContent };
    })()`);
    throw new Error(error.message + ': ' + JSON.stringify(details));
  });
  await click('demo-input');
  await until(() => evaluate('document.querySelector("#video-note").textContent.includes("Paused for your work")'));
  assert.equal(await evaluate('document.querySelector("#lesson").paused'), true);
  await click('demo-input');
  await until(() => evaluate('document.querySelector("#replay-count").textContent === "1 simulated replay"'));
  assert.equal(await evaluate('document.querySelector("#lesson").currentTime < 18'), true);
  assert.equal(await evaluate('document.querySelector("#lesson").paused'), false);
  await click('demo');
  assert.equal(await evaluate('document.querySelector("#mode").textContent.trim()'), 'Manual mode');
  await click('play');
  await click('demo');
  const seekAction = await evaluate(`[...window.registeredTools.values()]
    .find(tool => tool.name.endsWith('act')).execute({
      steps: [{ ref: 'Playback position', action: 'setValue', args: [16.25] }]
    })`);
  assert.equal(seekAction.ok, true, JSON.stringify(seekAction.error));
  await until(() => evaluate('Math.abs(document.querySelector("#lesson").currentTime - 16.25) < .04 && !document.querySelector("#lesson").seeking'));
  await click('play');
  await until(() => evaluate('document.querySelector("#lesson").currentTime >= 16.79'));
  await click('demo-input');
  await until(() => evaluate('document.querySelector("#video-note").textContent.startsWith("Paused for your work")'));
  assert.ok(await evaluate('document.querySelector("#lesson").currentTime >= 17'));
  await click('demo-input');
  await until(() => evaluate('document.querySelector("#replay-count").textContent.trim() === "2 simulated replays"'));
  assert.ok(await evaluate('document.querySelector("#lesson").currentTime < 9'));
  await click('demo-loss');
  await until(() => evaluate('document.querySelector("#video-note").textContent.startsWith("Tracking interrupted")'));
  assert.equal(await evaluate('document.querySelector("#lesson").paused'), true);
  await click('demo');
  await evaluate('document.querySelector("#main").focus()');
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82 });
  await until(() => evaluate('document.querySelector("#replay-count").textContent.includes("1 manual")'));
  console.log('Desktop playback, captions, consent, permissions, responsive layout, keyboard, UI SDK agent, and replay checks passed.');
} finally {
  socket?.close();
  if (child.exitCode === null) {
    const closed = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await closed;
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
}
