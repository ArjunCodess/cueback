import './style.css';
import steps from './lesson.json';
import { SmartSpectraSDK, MetricType, ValidationCode } from '@smartspectra/node-sdk/renderer';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import { classifyPose, faceFeatures, median, ReplayGesture } from './sensing.ts';
import type { Pose } from './sensing.ts';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, id: string): HTMLElementTagNameMap[K] {
  const node = document.getElementById(id);
  if (node?.localName !== tag) throw new Error('Missing element: ' + id);
  return node as HTMLElementTagNameMap[K];
}

const video = element('video', 'lesson');
const play = element('button', 'play');
const overlay = element('button', 'overlay-play');
const replay = element('button', 'replay');
const seek = element('input', 'seek');
const time = element('span', 'time');
const captions = element('button', 'captions');
const caption = element('p', 'caption');
const note = element('p', 'video-note');
const list = element('ol', 'steps');
const status = element('span', 'camera-state');
const help = element('p', 'camera-help');
const mode = element('span', 'mode');
const enable = element('button', 'enable');
const demo = element('button', 'demo');
const demoInput = element('button', 'demo-input');
const calibrate = element('button', 'calibrate');
const gesture = element('select', 'gesture');
const gestureLabel = element('label', 'gesture-label');
const preview = element('div', 'preview');
const cameraPreview = element('video', 'camera-preview');
const consent = element('dialog', 'consent');
const key = element('input', 'key');
const replayCount = element('span', 'replay-count');

type Source = 'off' | 'connecting' | 'live' | 'demo' | 'stopping';
type Features = NonNullable<ReturnType<typeof faceFeatures>>;
type Sample = { features: Features; time: number };
type Calibration = { stage: 'screen' | 'desk' | 'eyes'; values: Sample[]; first?: number; deadline: number };

const detector = new ReplayGesture();
let source: Source = 'off';
let sdk: SmartSpectraSDK | undefined;
let stream: MediaStream | undefined;
let currentSample: Sample | undefined;
let sampleTimestamp: number | undefined;
let captureMessage = '';
let calibration: Calibration | undefined;
let baseline: { screen: number; desk: number } | undefined;
let eyeBaseline: NonNullable<Features['eyes']> | undefined;
let simulatedPose: Pose = 'screen';
let heldStep = 0;
let count = 0;
let showCaptions = true;
let activeStep = -1;

const stamp = (seconds: number) => {
  const whole = Math.floor(seconds);
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
};

const stepAt = (seconds: number) => steps.findLastIndex(step => step.start <= seconds);
const stepButtons = steps.map((step, index) => {
  const li = document.createElement('li');
  const button = document.createElement('button');
  const number = document.createElement('span');
  const label = document.createElement('span');
  const duration = document.createElement('time');
  button.className = 'step';
  number.textContent = String(index + 1).padStart(2, '0');
  number.setAttribute('aria-hidden', 'true');
  label.textContent = step.title;
  duration.textContent = stamp(step.start);
  duration.dateTime = 'PT' + step.start + 'S';
  button.append(number, label, duration);
  button.addEventListener('click', () => {
    clearHold();
    seekTo(step.start);
  });
  li.append(button);
  list.append(li);
  return button;
});

function syncPlayer() {
  const index = stepAt(video.currentTime);
  if (activeStep !== index) {
    stepButtons[activeStep]?.removeAttribute('aria-current');
    stepButtons[index].setAttribute('aria-current', 'step');
    caption.textContent = steps[index].caption;
    activeStep = index;
  }
  const duration = Number.isFinite(video.duration) ? video.duration : 60;
  seek.max = String(duration);
  seek.value = String(video.currentTime);
  seek.setAttribute('aria-valuetext', stamp(video.currentTime) + ' of ' + stamp(duration));
  time.textContent = stamp(video.currentTime) + ' / ' + stamp(duration);
  play.textContent = video.paused ? 'Play' : 'Pause';
  overlay.hidden = !video.paused || video.currentTime > 0 || !note.hidden;
}

function tellPlayer(message = '') {
  note.textContent = message;
  note.hidden = message === '';
  syncPlayer();
}

function clearHold() {
  detector.reset();
  tellPlayer();
}

function seekTo(seconds: number) {
  video.currentTime = seconds;
  syncPlayer();
}

function startPlayback() {
  void video.play().catch(() => tellPlayer('Playback could not start. Try Play again.'));
}

function togglePlayback() {
  clearHold();
  if (video.paused) startPlayback();
  else video.pause();
}

function replayStep(index: number, handsFree: boolean) {
  seekTo(steps[index].start);
  startPlayback();
  if (handsFree) {
    count += 1;
    replayCount.textContent = count + (count === 1 ? ' hands-free replay' : ' hands-free replays');
    tellPlayer('Replaying: ' + steps[index].title);
  }
}

function manualReplay() {
  clearHold();
  replayStep(stepAt(video.currentTime), false);
}

for (const event of ['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata', 'seeked']) {
  video.addEventListener(event, syncPlayer);
}
video.addEventListener('error', () => tellPlayer('The bundled lesson could not be loaded.'));
video.addEventListener('timeupdate', () => {
  if (!video.paused && note.textContent?.startsWith('Replaying:') &&
    video.currentTime > steps[stepAt(video.currentTime)].start + 2) tellPlayer();
});
overlay.addEventListener('click', togglePlayback);
play.addEventListener('click', togglePlayback);
replay.addEventListener('click', manualReplay);
seek.addEventListener('input', () => {
  clearHold();
  seekTo(seek.valueAsNumber);
});
captions.addEventListener('click', () => {
  showCaptions = !showCaptions;
  captions.setAttribute('aria-pressed', String(showCaptions));
  caption.hidden = !showCaptions;
});
document.addEventListener('keydown', event => {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || consent.open ||
    (event.target instanceof Element && event.target.closest('button,input,select,textarea'))) return;
  if (event.code === 'Space') {
    event.preventDefault();
    togglePlayback();
  }
  if (event.code === 'KeyR') manualReplay();
});

function showCamera(label: string, message: string) {
  if (status.textContent !== label) status.textContent = label;
  if (help.textContent !== message) help.textContent = message;
}

function showSource(next: Source) {
  source = next;
  const labels = {
    off: 'Manual mode', connecting: 'Starting camera', live: 'Live SmartSpectra',
    demo: 'Simulation only', stopping: 'Stopping camera',
  };
  mode.lastChild!.textContent = ' ' + labels[next];
  mode.dataset.kind = next;
  enable.disabled = next === 'stopping';
  enable.hidden = next === 'demo';
  enable.textContent = next === 'off' ? 'Set up camera' : 'Turn off camera';
  demo.hidden = next === 'live' || next === 'connecting' || next === 'stopping';
  demo.textContent = next === 'demo' ? 'End simulation' : 'Try simulated input';
  demoInput.hidden = next !== 'demo';
  calibrate.hidden = next !== 'live';
  gestureLabel.hidden = next !== 'live';
  preview.hidden = next !== 'live';
}

async function stopCamera(message: string) {
  showSource('stopping');
  const previous = sdk;
  sdk = undefined;
  stream?.getTracks().forEach(track => track.stop());
  stream = undefined;
  cameraPreview.srcObject = null;
  baseline = undefined;
  eyeBaseline = undefined;
  calibration = undefined;
  currentSample = undefined;
  sampleTimestamp = undefined;
  captureMessage = '';
  clearHold();
  showCamera('Stopping', 'Releasing the camera.');
  try {
    await previous?.stop();
  } catch {
    // The host already stopped every camera track, even if the SDK failed.
  } finally {
    previous?.destroy();
    showSource('off');
    showCamera('Off', message);
  }
}

async function startCamera(apiKey: string) {
  showSource('connecting');
  showCamera('Starting', 'Waiting for camera permission and Presage.');
  let pending: SmartSpectraSDK | undefined;
  try {
    pending = new SmartSpectraSDK({
      apiKey,
      requestedMetrics: [MetricType.FACE_LANDMARKS],
      enableTelemetry: false,
      sendTimeoutMs: 12000,
    });
    sdk = pending;
    pending.on('validationStatus', (code, _timestamp, hint) => {
      if (sdk !== pending) return;
      const visible = code === ValidationCode.kOk || code === ValidationCode.kFaceNotForward ||
        code === ValidationCode.kFaceTooLow || code === ValidationCode.kFaceTooHigh;
      captureMessage = visible ? '' : hint;
      if (!visible) currentSample = undefined;
    });
    pending.on('metrics', (buffer, timestamp) => {
      if (sdk !== pending || captureMessage) return;
      const landmarks = decodeMetrics(buffer).face?.landmarks?.at(-1);
      if (!landmarks?.value?.length) return;
      const frameTimestamp = Number(landmarks.timestamp ?? timestamp);
      if (sampleTimestamp === frameTimestamp) return;
      sampleTimestamp = frameTimestamp;
      const features = faceFeatures(landmarks.value);
      if (!features || landmarks.reset) {
        currentSample = undefined;
        return;
      }
      currentSample = { features, time: performance.now() };
      addCalibrationSample(currentSample);
    });
    pending.on('error', code => {
      if (sdk === pending) void stopCamera('SmartSpectra stopped (code ' + code + '). Check your key, credits, and camera.');
    });
    const acquired = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    });
    if (sdk !== pending) {
      acquired.getTracks().forEach(track => track.stop());
      return;
    }
    stream = acquired;
    acquired.getVideoTracks()[0].addEventListener('ended', () => {
      if (sdk === pending) void stopCamera('Camera disconnected. Manual controls are available.');
    });
    cameraPreview.srcObject = acquired;
    pending.useMediaStream(acquired);
    await pending.start();
    if (sdk !== pending) return;
    calibrate.disabled = false;
    calibrate.textContent = 'Calibrate';
    showSource('live');
    showCamera('Calibrate', 'Calibrate before starting the lesson.');
  } catch {
    if (sdk === pending) await stopCamera('Could not start live sensing. Check camera permission, your Presage key, and network access.');
  }
}

function beginCalibration() {
  clearHold();
  video.pause();
  const stage = gesture.value === 'blink' ? 'eyes' : calibration?.stage === 'desk' ? 'desk' : 'screen';
  calibration = { stage, values: [], first: calibration?.first, deadline: performance.now() + 6000 };
  baseline = undefined;
  eyeBaseline = undefined;
  calibrate.disabled = true;
  showCamera('Measuring', stage === 'desk' ? 'Hold your work pose. Keep your face in the preview.' :
    stage === 'eyes' ? 'Face the camera with both eyes open.' : 'Face the screen and hold still.');
}

function addCalibrationSample(sample: Sample) {
  if (!calibration || !calibrate.disabled) return;
  if (calibration.stage === 'eyes' && !sample.features.eyes) return;
  const values = calibration.values;
  if (values.length && sample.time - values.at(-1)!.time > 360) values.length = 0;
  values.push(sample);
  if (values.length < 8 || sample.time - values[0].time < 650) return;

  const pitch = median(values.map(item => item.features.pitch));
  calibrate.disabled = false;
  calibrate.textContent = 'Calibrate again';
  if (calibration.stage === 'eyes') {
    const eyes = values.map(item => item.features.eyes!);
    const left = median(eyes.map(item => item.left));
    const right = median(eyes.map(item => item.right));
    if (Math.min(left, right) >= 0.09) eyeBaseline = { left, right };
  } else if (calibration.stage === 'screen') {
    calibration = { stage: 'desk', values: [], first: pitch, deadline: 0 };
    calibrate.textContent = 'Capture work pose';
    showCamera('Step 2 of 2', 'Look down at the paper, then click Capture work pose while keeping your head there.');
    return;
  } else if (calibration.first !== undefined && Math.abs(pitch - calibration.first) >= 0.035) {
    baseline = { screen: calibration.first, desk: pitch };
  }
  calibration = undefined;
  showCamera(baseline || eyeBaseline ? 'Ready' : 'Try again', baseline || eyeBaseline ?
    'Calibration complete. Press Play.' : 'The poses were hard to separate. Try again or select Long blink.');
}

enable.addEventListener('click', () => {
  if (source === 'off') consent.showModal();
  else void stopCamera('Camera off. Use the player controls to continue.');
});
element('button', 'cancel').addEventListener('click', () => consent.close());
consent.addEventListener('close', () => { key.value = ''; });
element('form', 'camera-form').addEventListener('submit', event => {
  event.preventDefault();
  const apiKey = key.value.trim();
  if (!apiKey) return;
  key.value = '';
  consent.close();
  void startCamera(apiKey);
});
calibrate.addEventListener('click', beginCalibration);
gesture.addEventListener('change', () => {
  clearHold();
  calibration = undefined;
  calibrate.disabled = false;
  calibrate.textContent = 'Calibrate';
  baseline = undefined;
  eyeBaseline = undefined;
  showCamera('Calibrate', 'Calibrate the selected gesture.');
});
demo.addEventListener('click', () => {
  clearHold();
  simulatedPose = 'screen';
  demoInput.textContent = 'Simulate looking down';
  if (source === 'demo') {
    showSource('off');
    showCamera('Off', 'Look down to fold, then look back to replay the step.');
  } else {
    showSource('demo');
    showCamera('Simulated', 'Play the lesson and use the button to simulate head movement. The camera is off.');
  }
});
demoInput.addEventListener('click', () => {
  simulatedPose = simulatedPose === 'desk' ? 'screen' : 'desk';
  demoInput.textContent = simulatedPose === 'desk' ? 'Simulate looking back' : 'Simulate looking down';
});

setInterval(() => {
  if (source !== 'live' && source !== 'demo') return;
  const now = performance.now();
  const fresh = currentSample && now - currentSample.time < 280 ? currentSample.features : undefined;
  if (source === 'live' && calibration && calibrate.disabled) {
    if (now >= calibration.deadline) {
      calibration.values.length = 0;
      calibrate.disabled = false;
      showCamera('Try again', captureMessage || 'No steady landmarks. Keep your face in view and try again.');
      return;
    }
    if (captureMessage) showCamera('Measuring', captureMessage);
    else showCamera('Measuring', calibration.stage === 'desk' ? 'Hold the work pose steadily.' : 'Face the camera and hold still.');
    return;
  }
  if (source === 'live' && gesture.value === 'blink') {
    if (!eyeBaseline) return;
    const pair = fresh?.eyes;
    const closed = pair ? pair.left < eyeBaseline.left * 0.62 && pair.right < eyeBaseline.right * 0.62 : null;
    if (detector.blink(closed, now)) replayStep(stepAt(video.currentTime), true);
    showCamera(pair ? 'Ready' : 'Signal lost', pair ? 'Close both eyes briefly to replay this step.' :
      captureMessage || 'Face the camera to use blink replay.');
    return;
  }
  if (source === 'live' && !baseline) return;
  const pose = source === 'demo' ? simulatedPose :
    fresh && baseline ? classifyPose(fresh.pitch, baseline.screen, baseline.desk) : 'unknown';
  const action = detector.pose(pose, now, !video.paused && !video.ended && !video.seeking);
  if (action === 'hold') {
    heldStep = stepAt(video.currentTime);
    video.pause();
    tellPlayer('Paused for your work. Look back to replay this step.');
  } else if (action === 'replay') {
    replayStep(heldStep, true);
  } else if (action === 'lost') {
    video.pause();
    tellPlayer('Tracking interrupted. Press Play when you’re ready.');
  }
  if (source === 'live') {
    if (detector.held) showCamera('Holding', 'Look back at the screen to replay the instruction.');
    else if (pose === 'unknown') showCamera('Finding face', captureMessage || 'Keep your face visible.');
    else showCamera('Ready', 'Look down to fold, then look back to replay the step.');
  }
}, 50);

window.addEventListener('pagehide', () => {
  stream?.getTracks().forEach(track => track.stop());
  sdk?.destroy();
});
syncPlayer();
