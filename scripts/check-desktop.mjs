import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { launchDesktop } from './desktop.mjs';

const profile = await mkdtemp(join(tmpdir(), 'cueback-check-'));
process.env.PRESAGE_API_KEY = 'desktop-test';
const child = launchDesktop([
  '--remote-debugging-port=0', '--user-data-dir=' + profile,
  '--use-fake-device-for-media-stream', '--disable-background-timer-throttling',
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
    return pages.find(page => page.url.startsWith('file:') && page.url.endsWith('/dist/index.html'));
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
  assert.equal(await evaluate('document.title'), 'cueback');
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
  assert.equal(await evaluate('document.querySelector("#consent input").required'), false);
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
  assert.equal(await evaluate('document.querySelector("#consent input").value'), '');
  await evaluate('document.querySelector("#consent form").requestSubmit()');
  await until(() => evaluate('document.querySelector("#camera-help").textContent.includes("Camera access was denied")'));
  assert.equal(await evaluate('!document.querySelector("#enable").hidden'), true);
  await evaluate('document.querySelectorAll(".step")[2].click()');
  await click('captions');
  assert.equal(await evaluate('document.querySelector("#caption").hidden'), true);
  await click('demo');
  await click('play');
  await until(() => evaluate('document.querySelector("#camera-status").textContent === "Simulated input ready"'));
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
  await evaluate(`(() => {
    const slider = document.querySelector('#seek');
    slider.value = '16.25';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
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

  await evaluate('document.querySelector(".replay-check summary").click()');
  await click('start-take');
  await until(() => evaluate('!document.querySelector("#lesson").paused'));
  await click('replay');
  await click('play');
  await click('finish-take');
  assert.equal(await evaluate('document.querySelector("#manual-inputs").textContent'), '2');
  assert.equal(await evaluate('document.querySelector("#live-replays").textContent'), '—');
  await command('Emulation.setDeviceMetricsOverride', { width: 420, height: 780, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await click('open-lesson');
  assert.equal(await evaluate('document.querySelector("#lesson-picker").scrollWidth <= document.querySelector("#lesson-picker").clientWidth + 2'), true);
  await click('cancel-lesson');
  await command('Emulation.clearDeviceMetricsOverride');
  await click('demo');
  assert.equal(await evaluate('document.querySelector("#start-take").disabled'), true);
  await click('demo');

  const media = join(profile, 'My lesson.mp4');
  const chapters = join(profile, 'chapters.json');
  await copyFile(new URL('../public/lesson/paper-box.mp4', import.meta.url), media);
  const setFile = async (selector, path) => {
    const { root } = await command('DOM.getDocument');
    const { nodeId } = await command('DOM.querySelector', { nodeId: root.nodeId, selector });
    await command('DOM.setFileInputFiles', { nodeId, files: [path] });
  };
  await click('open-lesson');
  assert.equal(await evaluate('document.querySelector("#chapter-file").files.length'), 0);
  await setFile('#lesson-file', media);
  await writeFile(chapters, '[{"start":3,"title":"Wait"}]');
  await setFile('#chapter-file', chapters);
  await click('load-lesson');
  await until(() => evaluate('!document.querySelector("#lesson-error").hidden'));
  assert.equal(await evaluate('document.querySelectorAll(".step").length'), 7);
  await writeFile(chapters, JSON.stringify([
    { start: 0, title: 'Set up' },
    { start: 12, title: 'Make the fold', caption: 'Press the crease flat.' },
  ]));
  await setFile('#chapter-file', chapters);
  await click('load-lesson');
  await until(() => evaluate('!document.querySelector("#lesson-picker").open && document.querySelector("#lesson").readyState >= 1'));
  assert.equal(await evaluate('document.querySelector("#lesson-title").textContent'), 'My lesson');
  assert.equal(await evaluate('document.querySelectorAll(".step").length'), 2);
  assert.equal(await evaluate('document.querySelector("#check-results").hidden'), true);
  await evaluate('document.querySelectorAll(".step")[1].click()');
  assert.equal(await evaluate('document.querySelector("#caption").textContent'), 'Press the crease flat.');
  await click('replay');
  assert.ok(await evaluate('Math.abs(document.querySelector("#lesson").currentTime - 12) < .5'));
  await click('open-lesson');
  await click('restore-lesson');
  await until(() => evaluate('document.querySelectorAll(".step").length === 7 && document.querySelector("#lesson").readyState >= 1'));
  await click('open-lesson');
  await setFile('#lesson-file', media);
  await click('load-lesson');
  await until(() => evaluate('!document.querySelector("#lesson-picker").open && document.querySelector("#lesson").readyState >= 1'));
  assert.equal(await evaluate('document.querySelector(".step span:nth-child(2)").textContent'), 'Full video');
  assert.equal(await evaluate('document.querySelector("#captions").hidden'), true);
  await click('open-lesson');
  await click('restore-lesson');
  await until(() => evaluate('document.querySelectorAll(".step").length === 7'));
  console.log('Desktop playback, captions, consent, responsive layout, replay, lesson import, and manual take checks passed.');
} finally {
  socket?.close();
  if (child.exitCode === null) {
    const closed = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await closed;
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
}
