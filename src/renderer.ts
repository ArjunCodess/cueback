import { createPlayer, formatTime } from './player';
import steps from './lesson.json';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, id: string): HTMLElementTagNameMap[K] {
  const node = document.querySelector(tag + '#' + id);
  if (node?.localName !== tag) throw new Error('Missing element: ' + id);
  return node as HTMLElementTagNameMap[K];
}

function setText(node: HTMLElement, text: string) {
  if (node.textContent !== text) node.textContent = text;
}

const player = createPlayer();
const video = element('video', 'lesson');
const seek = element('input', 'seek');
const play = element('button', 'play');
const overlay = element('button', 'overlay-play');
const note = element('p', 'video-note');
const time = element('span', 'time');
const cc = element('button', 'captions');
const caption = element('p', 'caption');
const mode = element('span', 'mode');
const modeLabel = element('b', 'mode-label');
const status = element('p', 'camera-status');
const help = element('p', 'camera-help');
const enable = element('button', 'enable');
const stop = element('button', 'stop-camera');
const demo = element('button', 'demo');
const simulation = element('div', 'simulation-actions');
const simulatePose = element('button', 'demo-input');
const preview = element('div', 'camera-preview');
const cameraFeed = element('video', 'camera-feed');
const gesture = element('select', 'gesture');
const calibrate = element('button', 'calibrate');
const progress = element('small', 'step-progress');
const counter = element('span', 'replay-count');
const consent = element('dialog', 'consent');
const key = element('input', 'key');
const form = consent.querySelector('form')!;

player.bindVideo(video);
const stepList = element('ol', 'steps');
const transcript = element('ol', 'transcript');
const stepButtons = steps.map((cue, index) => {
  const item = document.createElement('li');
  const button = document.createElement('button');
  const number = document.createElement('span');
  const title = document.createElement('span');
  const start = document.createElement('time');
  number.textContent = String(index + 1).padStart(2, '0');
  number.setAttribute('aria-hidden', 'true');
  title.textContent = cue.title;
  start.dateTime = 'PT' + cue.start + 'S';
  start.textContent = formatTime(cue.start);
  button.type = 'button';
  button.className = 'step';
  button.append(number, title, start);
  button.addEventListener('click', () => player.seek(cue.start));
  item.append(button);
  stepList.append(item);

  const line = document.createElement('li');
  const heading = document.createElement('strong');
  heading.textContent = formatTime(cue.start) + ' ' + cue.title;
  line.append(heading, cue.caption);
  transcript.append(line);
  return button;
});

const modeNames = {
  manual: 'Manual mode',
  demo: 'Simulation only',
  connecting: 'Connecting camera',
  live: 'Live SmartSpectra',
};
let previous: ReturnType<typeof player.getSnapshot> | undefined;

function render() {
  const state = player.getSnapshot();
  seek.max = String(state.duration);
  seek.value = String(state.position);
  seek.setAttribute('aria-valuetext', formatTime(state.position) + ' of ' + formatTime(state.duration));
  setText(time, formatTime(state.position) + ' / ' + formatTime(state.duration));
  setText(play, state.paused ? 'Play' : 'Pause');
  setText(note, state.note);
  note.hidden = !state.note;
  overlay.hidden = !state.paused || state.position > 0 || !!state.note;

  if (previous?.step !== state.step) {
    if (previous) stepButtons[previous.step].removeAttribute('aria-current');
    stepButtons[state.step].setAttribute('aria-current', 'step');
    setText(caption, steps[state.step].caption);
    setText(progress, (state.step + 1) + ' of ' + steps.length);
  }
  if (previous?.mode !== state.mode) {
    const live = state.mode === 'live';
    const simulated = state.mode === 'demo';
    const connecting = state.mode === 'connecting';
    mode.dataset.kind = state.mode;
    setText(modeLabel, modeNames[state.mode]);
    status.hidden = state.mode === 'manual';
    enable.hidden = state.mode !== 'manual';
    stop.hidden = !live && !connecting;
    demo.hidden = live || connecting;
    simulation.hidden = !simulated;
    preview.hidden = !live;
    player.bindPreview(live ? cameraFeed : null);
    setText(demo, simulated ? 'End simulation' : 'Try simulated input');
    if (previous?.mode === 'connecting' && live) calibrate.focus();
    if (previous && previous.mode !== 'demo' && state.mode === 'manual') enable.focus();
  }
  setText(status, state.cameraStatus);
  setText(help, state.hint);
  gesture.value = state.gesture;
  calibrate.disabled = state.measuring;
  setText(calibrate, state.calibration);
  setText(simulatePose, state.simulation === 'desk' ? 'Simulate looking back' : 'Simulate looking down');

  if (previous?.counts !== state.counts) {
    const { manual, demo, live } = state.counts;
    const total = manual + demo + live;
    counter.hidden = total === 0;
    setText(counter, [manual && manual + ' manual', demo && demo + ' simulated', live && live + ' camera']
      .filter(Boolean).join(' \u00b7 ') + (total === 1 ? ' replay' : ' replays'));
  }
  previous = state;
}

for (const event of ['loadedmetadata', 'timeupdate', 'play', 'pause', 'seeked', 'ended']) {
  video.addEventListener(event, player.sync);
}
video.addEventListener('error', player.mediaError);
seek.addEventListener('input', () => player.seek(seek.valueAsNumber));
play.addEventListener('click', player.toggle);
overlay.addEventListener('click', () => { player.toggle(); play.focus(); });
element('button', 'replay').addEventListener('click', player.manualReplay);
cc.addEventListener('click', () => {
  caption.hidden = !caption.hidden;
  cc.setAttribute('aria-pressed', String(!caption.hidden));
});
enable.addEventListener('click', () => {
  enable.focus();
  consent.showModal();
});
element('button', 'cancel').addEventListener('click', () => consent.close());
consent.addEventListener('close', () => { form.reset(); });
form.addEventListener('submit', event => {
  event.preventDefault();
  const value = key.value.trim();
  if (!value) {
    key.focus();
    return;
  }
  form.reset();
  consent.close();
  void player.startCamera(value);
  if (!stop.hidden) stop.focus();
});
stop.addEventListener('click', () => player.stopCamera());
calibrate.addEventListener('click', player.calibrate);
gesture.addEventListener('change', () => player.setGesture(gesture.value === 'blink' ? 'blink' : 'pose'));
demo.addEventListener('click', player.toggleDemo);
simulatePose.addEventListener('click', () => player.simulate(player.getSnapshot().simulation === 'desk' ? 'screen' : 'desk'));
element('button', 'demo-loss').addEventListener('click', () => player.simulate('unknown'));

document.addEventListener('keydown', event => {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || consent.open ||
      (event.target instanceof Element && event.target.closest('input,select,textarea,[contenteditable]'))) return;
  if (event.code === 'KeyR') player.manualReplay();
  if (event.code === 'Space' &&
      !(event.target instanceof Element && event.target.closest('button,summary,a'))) {
    event.preventDefault();
    player.toggle();
  }
});

const unsubscribe = player.subscribe(render);
const timer = window.setInterval(player.tick, 50);
window.addEventListener('pagehide', () => {
  window.clearInterval(timer);
  unsubscribe();
  player.dispose();
}, { once: true });
player.sync();
render();
