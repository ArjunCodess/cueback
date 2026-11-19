import { createPlayer, formatTime } from './player';
import { bundledLesson, readLocalLesson, type Lesson } from './lesson';

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
const keyError = element('p', 'key-error');
const form = consent.querySelector('form')!;
const confirmCamera = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const lessonPicker = element('dialog', 'lesson-picker');
const openLesson = element('button', 'open-lesson');
const restoreLesson = element('button', 'restore-lesson');
const loadLesson = element('button', 'load-lesson');
const lessonForm = lessonPicker.querySelector('form')!;
const lessonFile = element('input', 'lesson-file');
const chapterFile = element('input', 'chapter-file');
const lessonError = element('p', 'lesson-error');
const lessonTitle = element('h1', 'lesson-title');
const lessonDescription = element('p', 'lesson-description');
const transcriptPanel = element('details', 'transcript-panel');
const startTake = element('button', 'start-take');
const finishTake = element('button', 'finish-take');
const resetCheck = element('button', 'reset-check');
const checkHelp = element('p', 'check-help');
const checkStatus = element('p', 'check-status');
const checkResults = element('table', 'check-results');
const observations = element('fieldset', 'observations');
const manualInputs = element('td', 'manual-inputs');
const liveInputs = element('td', 'live-inputs');
const liveHolds = element('td', 'live-holds');
const liveReplays = element('td', 'live-replays');
const liveLosses = element('td', 'live-losses');

declare global {
  interface Window {
    cueback: { readPresageKey(): Promise<string> };
  }
}

player.bindVideo(video);
const stepList = element('ol', 'steps');
const transcript = element('ol', 'transcript');
let stepButtons: HTMLButtonElement[] = [];
let captionsEnabled = true;

function renderLesson(lesson: Lesson) {
  setText(lessonTitle, lesson.title);
  setText(lessonDescription, lesson.description);
  lessonDescription.hidden = !lesson.description;
  restoreLesson.hidden = lesson === bundledLesson;
  stepList.replaceChildren();
  transcript.replaceChildren();
  stepButtons = lesson.chapters.map((cue, index) => {
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

    if (cue.caption) {
      const line = document.createElement('li');
      const heading = document.createElement('strong');
      heading.textContent = formatTime(cue.start) + ' ' + cue.title;
      line.append(heading, cue.caption);
      transcript.append(line);
    }
    return button;
  });
  cc.hidden = transcriptPanel.hidden = !transcript.childElementCount;
  transcriptPanel.open = false;
}

const modeNames = {
  manual: 'Manual mode',
  demo: 'Simulation only',
  connecting: 'Connecting camera',
  live: 'Live SmartSpectra',
};
let previous: ReturnType<typeof player.getSnapshot> | undefined;

function render() {
  const state = player.getSnapshot();
  const changedLesson = previous?.lesson !== state.lesson;
  if (changedLesson) renderLesson(state.lesson);
  seek.max = String(state.duration);
  seek.value = String(state.position);
  seek.setAttribute('aria-valuetext', formatTime(state.position) + ' of ' + formatTime(state.duration));
  setText(time, formatTime(state.position) + ' / ' + formatTime(state.duration));
  setText(play, state.paused ? 'Play' : 'Pause');
  setText(note, state.note);
  note.hidden = !state.note;
  overlay.hidden = !state.paused || state.position > 0 || !!state.note;

  if (changedLesson || previous?.step !== state.step) {
    if (!changedLesson && previous) stepButtons[previous.step].removeAttribute('aria-current');
    stepButtons[state.step].setAttribute('aria-current', 'step');
    setText(caption, state.lesson.chapters[state.step].caption ?? '');
    caption.hidden = !captionsEnabled || !caption.textContent;
    setText(progress, (state.step + 1) + ' of ' + state.lesson.chapters.length);
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
    setText(demo, simulated ? 'End simulation' : 'Try simulation');
    if (previous?.mode === 'connecting' && live) calibrate.focus();
    if (previous && previous.mode !== 'demo' && state.mode === 'manual') enable.focus();
  }
  setText(status, state.cameraStatus);
  setText(help, state.hint);
  gesture.value = state.gesture;
  calibrate.disabled = state.measuring;
  setText(calibrate, state.calibration);
  setText(simulatePose, state.simulation === 'desk' ? 'Simulate looking back' : 'Simulate looking down');

  if (previous?.check !== state.check || previous?.mode !== state.mode ||
      previous?.poseReady !== state.poseReady || changedLesson) {
    const check = state.check;
    const active = check?.active;
    const live = state.mode === 'live';
    startTake.hidden = Boolean(active);
    startTake.disabled = state.mode !== 'manual' && (!live || !state.poseReady);
    finishTake.hidden = !active;
    resetCheck.hidden = !check || Boolean(active);
    checkResults.hidden = !check;
    observations.hidden = !check?.live || active === 'live';
    if (!check || (active === 'live' && previous?.check?.active !== 'live'))
      observations.querySelectorAll('input').forEach(input => { input.value = ''; });
    enable.disabled = demo.disabled = Boolean(active);
    setText(startTake, live ? 'Start camera take' : 'Start manual take');
    setText(checkHelp, state.mode === 'demo'
      ? 'End simulation to measure real playback. Simulated gestures do not count.'
      : live && !state.poseReady
        ? 'Calibrate Look down to start a camera take.'
        : 'Do the same work in both takes. Both start at the same step. Start and Finish are excluded from player inputs.');
    checkStatus.hidden = !check;
    setText(checkStatus, check
      ? (active === 'live' ? 'Camera take: ' : active ? 'Manual take: ' : 'Compared step: ') +
        state.lesson.chapters[check.step].title
      : '');
    setText(manualInputs, String(check?.manual?.inputs ?? '—'));
    setText(liveInputs, String(check?.live?.inputs ?? '—'));
    setText(liveHolds, String(check?.live?.holds ?? '—'));
    setText(liveReplays, String(check?.live?.replays ?? '—'));
    setText(liveLosses, String(check?.live?.losses ?? '—'));
  }

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
seek.addEventListener('input', () => player.seek(seek.valueAsNumber, false));
seek.addEventListener('change', player.recordControl);
play.addEventListener('click', player.toggle);
overlay.addEventListener('click', () => { player.toggle(); play.focus(); });
element('button', 'replay').addEventListener('click', player.manualReplay);
cc.addEventListener('click', () => {
  captionsEnabled = !captionsEnabled;
  caption.hidden = !captionsEnabled || !caption.textContent;
  cc.setAttribute('aria-pressed', String(captionsEnabled));
});
openLesson.addEventListener('click', () => {
  lessonForm.reset();
  lessonError.hidden = true;
  lessonPicker.showModal();
});
element('button', 'cancel-lesson').addEventListener('click', () => lessonPicker.close());
lessonPicker.addEventListener('cancel', event => {
  if (loadLesson.disabled) event.preventDefault();
});
restoreLesson.addEventListener('click', () => {
  player.setLesson(bundledLesson);
  lessonPicker.close();
});
lessonForm.addEventListener('submit', async event => {
  event.preventDefault();
  const file = lessonFile.files?.[0];
  if (!file || loadLesson.disabled) return;
  loadLesson.disabled = restoreLesson.disabled = true;
  const cancel = element('button', 'cancel-lesson');
  cancel.disabled = true;
  lessonError.hidden = true;
  setText(loadLesson, 'Opening…');
  try {
    player.setLesson(await readLocalLesson(file, chapterFile.files?.[0]));
    lessonPicker.close();
  } catch (error) {
    setText(lessonError, error instanceof Error ? error.message : 'The lesson could not be opened.');
    lessonError.hidden = false;
  } finally {
    loadLesson.disabled = restoreLesson.disabled = cancel.disabled = false;
    setText(loadLesson, 'Open video');
    if (lessonPicker.open) loadLesson.focus();
  }
});
enable.addEventListener('click', () => {
  enable.focus();
  consent.showModal();
});
element('button', 'cancel').addEventListener('click', () => consent.close());
consent.addEventListener('close', () => {
  form.reset();
  keyError.hidden = true;
  key.removeAttribute('aria-invalid');
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (confirmCamera.disabled) return;
  confirmCamera.disabled = true;
  const manualKey = key.value.trim();
  const value = manualKey || await window.cueback.readPresageKey().catch(() => '');
  confirmCamera.disabled = false;
  if (!consent.open) return;
  if (!value) {
    keyError.textContent = 'Enter a Presage API key, or set PRESAGE_API_KEY in .env and restart cueback.';
    keyError.hidden = false;
    key.setAttribute('aria-invalid', 'true');
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
startTake.addEventListener('click', () => { player.startTake(); finishTake.focus(); });
finishTake.addEventListener('click', () => { player.finishTake(); startTake.focus(); });
resetCheck.addEventListener('click', () => { player.resetCheck(); startTake.focus(); });

document.addEventListener('keydown', event => {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || consent.open || lessonPicker.open ||
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
