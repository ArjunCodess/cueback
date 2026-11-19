import { createCamera, type Features } from './camera';
import { classifyPose, median, ReplayGesture, type Pose } from './sensing';
import steps from './lesson.json';

type Mode = 'manual' | 'connecting' | 'live' | 'demo';
type Gesture = 'pose' | 'blink';
type Sample = { features: Features; time: number };
type Calibration = {
  stage: 'screen' | 'desk' | 'eyes';
  samples: Sample[];
  deadline: number;
  first?: number;
};
type Counts = { manual: number; demo: number; live: number };

const initial = {
  mode: 'manual' as Mode,
  gesture: 'pose' as Gesture,
  position: 0,
  duration: 62,
  paused: true,
  step: 0,
  note: '',
  cameraStatus: 'Off',
  hint: 'Look down to fold, then look back to replay the step.',
  calibration: 'Calibrate',
  measuring: false,
  simulation: 'screen' as Pose,
  counts: { manual: 0, demo: 0, live: 0 } as Counts,
};

export const formatTime = (seconds: number) => {
  const whole = Math.floor(seconds);
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
};

const stepAt = (time: number) =>
  steps.findLastIndex((step) => step.start <= time);

export function createPlayer() {
  let state = initial;
  const listeners = new Set<() => void>();
  let video: HTMLVideoElement | null = null;
  let preview: HTMLVideoElement | null = null;
  let camera: ReturnType<typeof createCamera> | undefined;
  let stream: MediaStream | undefined;
  let sample: Sample | undefined;
  let captureHint = '';
  let calibration: Calibration | undefined;
  let baseline: { screen: number; desk: number } | undefined;
  let eyes: NonNullable<Features['eyes']> | undefined;
  let lastScreenStep: number | undefined;
  let heldStep = 0;
  const detector = new ReplayGesture();

  function update(patch: Partial<typeof state>) {
    if (
      !(Object.keys(patch) as (keyof typeof state)[]).some(
        (key) => state[key] !== patch[key],
      )
    )
      return;
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }

  function sync() {
    if (!video) return;
    const position = video.currentTime;
    const step = stepAt(position);
    const note =
      state.note.startsWith('Replaying ') &&
      !video.paused &&
      position > steps[step].start + 2
        ? ''
        : state.note;
    update({
      position,
      step,
      note,
      paused: video.paused,
      duration: video.duration || initial.duration,
    });
  }

  function clearHold() {
    detector.reset();
    lastScreenStep = undefined;
    update({ note: '' });
  }

  function play() {
    void video
      ?.play()
      .catch(() =>
        update({ note: 'Playback could not start. Try Play again.' }),
      );
  }

  function toggle() {
    clearHold();
    if (video?.paused) {
      if (video.ended) video.currentTime = 0;
      play();
    } else {
      video?.pause();
    }
  }

  function seek(position: number) {
    clearHold();
    if (video) video.currentTime = position;
    sync();
  }

  function replay(index: number, input: keyof Counts) {
    if (!video) return;
    video.currentTime = steps[index].start;
    play();
    update({
      counts: { ...state.counts, [input]: state.counts[input] + 1 },
      note: 'Replaying ' + steps[index].title.toLowerCase() + '.',
    });
    sync();
  }

  function resetCalibration() {
    calibration = undefined;
    baseline = undefined;
    eyes = undefined;
    update({ calibration: 'Calibrate', measuring: false });
  }

  function stopCamera(
    message = 'Camera off. Use the player controls to continue.',
  ) {
    const previous = camera;
    camera = undefined;
    previous?.stop();
    stream = undefined;
    sample = undefined;
    captureHint = '';
    if (preview) preview.srcObject = null;
    resetCalibration();
    clearHold();
    update({ mode: 'manual', cameraStatus: 'Off', hint: message });
  }

  async function startCamera(key: string) {
    if (state.mode !== 'manual') return;
    if (window.location.protocol !== 'benchreplay:') {
      update({ hint: 'Open the BenchReplay desktop app to use a camera. You can try simulated input here.' });
      return;
    }
    update({
      mode: 'connecting',
      cameraStatus: 'Starting…',
      hint: 'Waiting for your camera and Presage.',
    });
    const pending = createCamera();
    camera = pending;
    try {
      const active = await pending.start(key, {
        sample: (features) => {
          sample = features ? { features, time: performance.now() } : undefined;
          if (sample) collect(sample);
        },
        hint: (hint) => {
          captureHint = hint;
        },
        failed: (message) => stopCamera(message),
      });
      if (!active || camera !== pending) return;
      stream = active;
      update({
        mode: 'live',
        cameraStatus: 'Calibrate',
        hint: 'Choose a gesture, then calibrate before playing.',
      });
    } catch (error) {
      if (camera !== pending) return;
      const reason = error instanceof DOMException ? error.name : '';
      if (reason === 'NotAllowedError') {
        stopCamera(
          'Camera access was denied. Check system permissions or use manual playback.',
        );
      } else if (reason === 'NotFoundError' || reason === 'NotReadableError') {
        stopCamera(
          'Camera unavailable. Connect a webcam or close other apps using it.',
        );
      } else {
        stopCamera(
          'Live sensing could not start. Check your Presage key, credits, and connection.',
        );
      }
    }
  }

  function calibrate() {
    clearHold();
    video?.pause();
    const stage =
      state.gesture === 'blink'
        ? 'eyes'
        : calibration?.stage === 'desk'
          ? 'desk'
          : 'screen';
    calibration = {
      stage,
      samples: [],
      first: calibration?.first,
      deadline: performance.now() + 6000,
    };
    baseline = undefined;
    eyes = undefined;
    update({
      measuring: true,
      cameraStatus: 'Measuring…',
      hint:
        stage === 'desk'
          ? 'Hold your work pose with your face inside the preview.'
          : 'Face the screen with your eyes open and hold still.',
    });
  }

  function collect(next: Sample) {
    if (
      !calibration ||
      !state.measuring ||
      (calibration.stage === 'eyes' && !next.features.eyes)
    )
      return;
    const samples = calibration.samples;
    const last = samples.at(-1);
    if (last && next.time - last.time > 360) samples.length = 0;
    samples.push(next);
    if (samples.length < 8 || next.time - samples[0].time < 650) return;
    const pitch = median(samples.map((item) => item.features.pitch));
    if (calibration.stage === 'screen') {
      calibration = { stage: 'desk', samples: [], first: pitch, deadline: 0 };
      update({
        measuring: false,
        calibration: 'Capture work pose',
        cameraStatus: 'Step 2 of 2',
        hint: 'Look down at your paper, then select Capture work pose while keeping your face visible.',
      });
      return;
    }
    if (calibration.stage === 'eyes') {
      const left = median(samples.map((item) => item.features.eyes?.left ?? 0));
      const right = median(
        samples.map((item) => item.features.eyes?.right ?? 0),
      );
      if (Math.min(left, right) >= 0.09) eyes = { left, right };
    } else if (
      calibration.first !== undefined &&
      Math.abs(pitch - calibration.first) >= 0.035
    ) {
      baseline = { screen: calibration.first, desk: pitch };
    }
    calibration = undefined;
    const ready = Boolean(eyes || baseline);
    update({
      measuring: false,
      calibration: 'Calibrate again',
      cameraStatus: ready ? 'Ready' : 'Try again',
      hint: ready
        ? 'Calibration complete. Press Play.'
        : 'The poses were too similar. Try again or choose Long blink.',
    });
  }

  function tick() {
    if (!video || (state.mode !== 'live' && state.mode !== 'demo')) return;
    const now = performance.now();
    const features =
      sample && now - sample.time < 280 ? sample.features : undefined;
    if (state.measuring && calibration) {
      if (now >= calibration.deadline) {
        update({
          measuring: false,
          cameraStatus: 'Try again',
          hint:
            captureHint ||
            'No steady landmarks. Keep your face in view and try again.',
        });
      } else if (captureHint) {
        update({ hint: captureHint });
      }
      return;
    }
    if (state.mode === 'live' && state.gesture === 'blink') {
      if (!eyes) return;
      const pair = features?.eyes;
      const closed = pair
        ? pair.left < eyes.left * 0.62 && pair.right < eyes.right * 0.62
        : null;
      if (detector.blink(closed, now))
        replay(stepAt(video.currentTime), 'live');
      update({
        cameraStatus: pair ? 'Ready' : 'Signal lost',
        hint: pair
          ? 'Close both eyes briefly, then reopen to replay.'
          : captureHint || 'Face the camera to use blink replay.',
      });
      return;
    }
    if (state.mode === 'live' && !baseline) return;
    const pose =
      state.mode === 'demo'
        ? state.simulation
        : features && baseline
          ? classifyPose(features.pitch, baseline.screen, baseline.desk)
          : 'unknown';
    const playing = !video.paused && !video.ended && !video.seeking;
    if (pose === 'screen' && playing)
      lastScreenStep = stepAt(video.currentTime);
    const action = detector.pose(pose, now, playing);
    if (action === 'hold') {
      heldStep = lastScreenStep ?? stepAt(video.currentTime);
      video.pause();
      update({ note: 'Paused for your work. Look back to replay this step.' });
    } else if (action === 'replay') {
      replay(heldStep, state.mode);
    } else if (action === 'lost') {
      video.pause();
      update({ note: 'Tracking interrupted. Press Play when you’re ready.' });
    }
    if (state.mode === 'live') {
      if (detector.held)
        update({
          cameraStatus: 'Holding',
          hint: 'Look back to replay the instruction.',
        });
      else if (pose === 'unknown')
        update({
          cameraStatus: 'Finding face',
          hint: captureHint || 'Keep your face in view.',
        });
      else update({ cameraStatus: 'Ready', hint: initial.hint });
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    getServerSnapshot: () => initial,
    bindVideo(node: HTMLVideoElement | null) {
      video = node;
    },
    bindPreview(node: HTMLVideoElement | null) {
      preview = node;
      if (node) node.srcObject = stream ?? null;
    },
    sync,
    tick,
    toggle,
    seek,
    startCamera,
    stopCamera,
    calibrate,
    mediaError() {
      update({
        note: 'The bundled lesson could not be loaded. Restart BenchReplay and try again.',
      });
    },
    manualReplay() {
      clearHold();
      replay(stepAt(video?.currentTime ?? 0), 'manual');
    },
    setGesture(gesture: Gesture) {
      clearHold();
      resetCalibration();
      update({
        gesture,
        cameraStatus: 'Calibrate',
        hint: 'Calibrate the selected gesture.',
      });
    },
    toggleDemo() {
      clearHold();
      if (state.mode === 'demo')
        update({ mode: 'manual', cameraStatus: 'Off', hint: initial.hint });
      else
        update({
          mode: 'demo',
          simulation: 'screen',
          cameraStatus: 'Simulated',
          hint: 'Play the lesson, then simulate looking down and back. The camera is off.',
        });
    },
    simulate(pose: Pose) {
      update({ simulation: pose });
    },
    dispose() {
      camera?.stop();
      camera = undefined;
      stream = undefined;
    },
  };
}
