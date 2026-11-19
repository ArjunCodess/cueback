import { createCamera, type Features } from './camera';
import { classifyPose, median, ReplayGesture, type Pose } from './sensing';
import { bundledLesson, type Lesson } from './lesson';

type Mode = 'manual' | 'connecting' | 'live' | 'demo';
type Gesture = 'pose' | 'blink';
type Sample = { features: Features; time: number };
type Calibration = {
  stage: 'screen' | 'desk' | 'eyes';
  samples: Sample[];
  captureAfter: number;
  deadline: number;
  first?: number;
};
type Counts = { manual: number; demo: number; live: number };
type TakeMode = 'manual' | 'live';
type Take = { inputs: number; holds: number; replays: number; losses: number };
type Check = {
  step: number;
  active: TakeMode | null;
  manual?: Take;
  live?: Take;
};

const initial = {
  mode: 'manual' as Mode,
  gesture: 'pose' as Gesture,
  position: 0,
  lesson: bundledLesson,
  duration: bundledLesson.duration,
  paused: true,
  step: 0,
  note: '',
  cameraStatus: 'Off',
  hint: 'Look down to fold, then look back to replay the step.',
  calibration: 'Calibrate',
  measuring: false,
  simulation: 'screen' as Pose,
  poseReady: false,
  check: null as Check | null,
  counts: { manual: 0, demo: 0, live: 0 } as Counts,
};

export const formatTime = (seconds: number) => {
  const whole = Math.floor(seconds);
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
};

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
  const stepAt = (time: number) =>
    state.lesson.chapters.findLastIndex((chapter) => chapter.start <= time);

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
      state.note.startsWith('Replaying: ') &&
      !video.paused &&
      position > state.lesson.chapters[step].start + 2
        ? ''
        : state.note;
    update({
      position,
      step,
      note,
      paused: video.paused,
      duration: Number.isFinite(video.duration) ? video.duration : state.lesson.duration,
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
    record('inputs');
    clearHold();
    if (video?.paused) {
      if (video.ended) video.currentTime = 0;
      play();
    } else {
      video?.pause();
    }
  }

  function seek(position: number, manual = true) {
    if (manual) record('inputs');
    clearHold();
    if (video) video.currentTime = position;
    sync();
  }

  function replay(index: number, input: keyof Counts) {
    if (!video) return;
    const chapter = state.lesson.chapters[index];
    video.currentTime = chapter.start;
    play();
    if (input === 'live') record('replays');
    update({
      counts: { ...state.counts, [input]: state.counts[input] + 1 },
      note: 'Replaying: ' + chapter.title,
    });
    sync();
  }

  function record(metric: keyof Take) {
    const check = state.check;
    const mode = check?.active;
    if (!mode) return;
    const take = check[mode]!;
    update({ check: { ...check, [mode]: { ...take, [metric]: take[metric] + 1 } } });
  }

  function startTake() {
    if (!video || state.check?.active) return;
    const mode = state.mode;
    if (mode !== 'manual' && (mode !== 'live' || !state.poseReady)) return;
    const check = state.check ?? { step: state.step };
    seek(state.lesson.chapters[check.step].start, false);
    update({
      check: { ...check, active: mode, [mode]: { inputs: 0, holds: 0, replays: 0, losses: 0 } },
    });
    play();
  }

  function finishTake() {
    if (!state.check?.active) return;
    video?.pause();
    clearHold();
    update({ check: { ...state.check, active: null } });
  }

  function setLesson(lesson: Lesson) {
    if (!video) return;
    const previous = state.lesson.source;
    finishTake();
    video.pause();
    clearHold();
    video.poster = lesson.poster ?? '';
    video.querySelector('track')?.remove();
    if (lesson.captions) {
      const track = document.createElement('track');
      track.kind = 'captions';
      track.srclang = 'en';
      track.label = 'English';
      track.src = lesson.captions;
      video.append(track);
    }
    video.src = lesson.source;
    video.load();
    if (previous.startsWith('blob:')) URL.revokeObjectURL(previous);
    update({ lesson, duration: lesson.duration, position: 0, step: 0,
      paused: true, check: null, counts: initial.counts });
  }

  function resetCalibration() {
    calibration = undefined;
    baseline = undefined;
    eyes = undefined;
    update({ calibration: 'Calibrate', measuring: false, poseReady: false });
  }

  function stopCamera(
    message = 'Camera off. Use the player controls to continue.',
  ) {
    finishTake();
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
    finishTake();
    clearHold();
    video?.pause();
    const stage =
      state.gesture === 'blink'
        ? 'eyes'
        : calibration?.stage === 'desk'
          ? 'desk'
          : 'screen';
    const now = performance.now();
    const captureAfter = now + (stage === 'desk' ? 2000 : 0);
    calibration = {
      stage,
      samples: [],
      first: calibration?.first,
      captureAfter,
      deadline: captureAfter + 6000,
    };
    baseline = undefined;
    eyes = undefined;
    update({
      measuring: true,
      poseReady: false,
      cameraStatus: 'Measuring…',
      hint:
        stage === 'desk'
          ? 'Look down now. Keep your face in the preview.'
          : 'Face the screen with your eyes open and hold still.',
    });
  }

  function collect(next: Sample) {
    if (
      !calibration ||
      !state.measuring ||
      next.time < calibration.captureAfter ||
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
      calibration = { stage: 'desk', samples: [], first: pitch, deadline: 0, captureAfter: 0 };
      update({
        measuring: false,
        calibration: 'Capture work pose',
        cameraStatus: 'Step 2 of 2',
        hint: 'Select Capture work pose, then look down at your paper. You have two seconds to get into position.',
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
      poseReady: Boolean(baseline),
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
      } else if (now < calibration.captureAfter) {
        update({ cameraStatus: 'Capturing in ' + Math.ceil((calibration.captureAfter - now) / 1000) + ' s' });
      } else if (captureHint) {
        update({ cameraStatus: 'Measuring…' });
        update({ hint: captureHint });
      } else {
        update({ cameraStatus: 'Measuring…' });
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
      record('holds');
      update({ note: 'Paused for your work. Look back to replay this step.' });
    } else if (action === 'replay') {
      replay(heldStep, state.mode);
    } else if (action === 'lost') {
      video.pause();
      record('losses');
      update({ note: 'Tracking interrupted. Press Play when you’re ready.' });
    }
    if (state.mode === 'live') {
      if (detector.held)
        update({
          cameraStatus: 'Holding',
          hint: 'Look back to replay the instruction.',
        });
      else if (!features)
        update({
          cameraStatus: 'Face signal unavailable',
          hint: captureHint || 'Keep your face in view.',
        });
      else if (pose === 'unknown')
        update({ cameraStatus: 'Between poses', hint: 'Face the screen or look down at your work.' });
      else update({
        cameraStatus: pose === 'screen'
          ? detector.armed ? 'Screen pose ready' : 'Hold the screen pose'
          : 'Work pose detected',
        hint: initial.hint,
      });
    } else {
      update({ cameraStatus: detector.armed ? 'Simulated input ready' : 'Waiting for simulated screen pose' });
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
    setLesson,
    startTake,
    finishTake,
    recordControl: () => record('inputs'),
    resetCheck: () => { if (!state.check?.active) update({ check: null }); },
    startCamera,
    stopCamera,
    calibrate,
    mediaError() {
      update({
        note: 'This video stopped loading. Try opening the lesson again.',
      });
    },
    manualReplay() {
      record('inputs');
      clearHold();
      replay(stepAt(video?.currentTime ?? 0), 'manual');
    },
    setGesture(gesture: Gesture) {
      finishTake();
      clearHold();
      resetCalibration();
      update({
        gesture,
        cameraStatus: 'Calibrate',
        hint: 'Calibrate the selected gesture.',
      });
    },
    toggleDemo() {
      finishTake();
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
      if (state.lesson.source.startsWith('blob:')) URL.revokeObjectURL(state.lesson.source);
      camera?.stop();
      camera = undefined;
      stream = undefined;
    },
  };
}
