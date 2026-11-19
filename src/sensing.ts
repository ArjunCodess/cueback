type Point = { x?: number | null; y?: number | null };
export type Pose = 'screen' | 'desk' | 'unknown';
type Action = 'hold' | 'replay' | 'lost';

export function faceFeatures(points: Point[]) {
  const landmark = (index: number) => {
    const p = points[index];
    return p && typeof p.x === 'number' && typeof p.y === 'number' &&
      Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
  };
  const left = landmark(33), right = landmark(263), nose = landmark(1);
  if (!left || !right || !nose) return null;

  const dx = right.x - left.x, dy = right.y - left.y;
  const width = Math.hypot(dx, dy);
  if (width < 1e-4) return null;
  const pitch = (dx * (nose.y - left.y) - dy * (nose.x - left.x)) / width ** 2;

  const eyeRatio = (indices: number[]) => {
    const [outer, inner, upperA, lowerA, upperB, lowerB] = indices.map(landmark);
    if (!outer || !inner || !upperA || !lowerA || !upperB || !lowerB) return null;
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);
    const span = distance(outer, inner);
    return span > 1e-4 ? (distance(upperA, lowerA) + distance(upperB, lowerB)) / (2 * span) : null;
  };
  const a = eyeRatio([33, 133, 160, 144, 158, 153]);
  const b = eyeRatio([263, 362, 387, 373, 385, 380]);
  return { pitch, eyes: a === null || b === null ? null : { left: a, right: b } };
}

export function classifyPose(pitch: number, screen: number, desk: number): Pose {
  const progress = (pitch - screen) / (desk - screen);
  if (progress >= 0.68) return 'desk';
  if (progress <= 0.34) return 'screen';
  return 'unknown';
}

export function median(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export class ReplayGesture {
  held = false;
  #lost = false;
  #armed = false;
  #lastPose: Pose = 'unknown';
  #since = 0;
  #closedSince: number | null = null;

  get armed() {
    return this.#armed;
  }

  reset() {
    this.held = false;
    this.#lost = false;
    this.#armed = false;
    this.#lastPose = 'unknown';
    this.#since = 0;
    this.#closedSince = null;
  }

  pose(pose: Pose, time: number, playing: boolean): Action | undefined {
    if (pose !== this.#lastPose) {
      this.#lastPose = pose;
      this.#since = time;
    }
    const duration = time - this.#since;
    if (pose === 'unknown' && duration >= 850 && !this.#lost && (playing || this.held)) {
      this.#lost = true;
      this.#armed = false;
      this.held = false;
      return 'lost';
    }
    if (pose === 'screen' && duration >= 300) {
      this.#lost = false;
      this.#armed = true;
      if (this.held) {
        this.held = false;
        return 'replay';
      }
    }
    if (pose === 'desk' && duration >= 420 && this.#armed && playing && !this.held) {
      this.held = true;
      return 'hold';
    }
  }

  blink(closed: boolean | null, time: number): boolean {
    if (closed === null) {
      this.#closedSince = null;
      return false;
    }
    if (closed) {
      this.#closedSince ??= time;
      return false;
    }
    const duration = this.#closedSince === null ? 0 : time - this.#closedSince;
    this.#closedSince = null;
    return duration >= 650 && duration <= 2200;
  }
}
