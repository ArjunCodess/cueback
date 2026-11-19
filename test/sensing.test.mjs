import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPose, faceFeatures, median, ReplayGesture } from '../src/sensing.ts';

test('landmark pitch is proportional to face size and robust to roll', () => {
  const points = [];
  points[33] = { x: 100, y: 100 };
  points[263] = { x: 160, y: 100 };
  points[1] = { x: 130, y: 118 };
  const rotated = points.map(({ x, y }) => ({ x: 1000 - 2 * y, y: 2 * x }));
  assert.equal(faceFeatures(points).pitch, 0.3);
  assert.equal(faceFeatures(rotated).pitch, 0.3);
  assert.equal(faceFeatures([]), null);
  assert.equal(median([9, 3, 1, 7]), 5);
});

test('calibration learns either pitch direction and leaves a dead zone', () => {
  assert.equal(classifyPose(0.2, 0.2, 0.4), 'screen');
  assert.equal(classifyPose(0.36, 0.2, 0.4), 'desk');
  assert.equal(classifyPose(0.3, 0.2, 0.4), 'unknown');
  assert.equal(classifyPose(0.2, 0.4, 0.2), 'desk');
});

function armedGesture() {
  const detector = new ReplayGesture();
  detector.pose('screen', 0, false);
  detector.pose('screen', 300, true);
  return detector;
}

test('a held desk pose pauses once and a stable return replays once', () => {
  const detector = armedGesture();
  assert.equal(detector.pose('desk', 400, true), undefined);
  assert.equal(detector.pose('desk', 819, true), undefined);
  assert.equal(detector.pose('desk', 820, true), 'hold');
  assert.equal(detector.pose('screen', 900, false), undefined);
  assert.equal(detector.pose('screen', 1200, false), 'replay');
  assert.equal(detector.pose('screen', 1300, true), undefined);
});

test('sustained signal loss cancels automatic resume', () => {
  const detector = armedGesture();
  detector.pose('desk', 400, true);
  detector.pose('desk', 900, true);
  detector.pose('unknown', 1000, false);
  assert.equal(detector.pose('unknown', 1850, false), 'lost');
  detector.pose('screen', 1900, false);
  assert.equal(detector.pose('screen', 2200, false), undefined);
});

test('manual control cancels a pending replay', () => {
  const detector = armedGesture();
  detector.pose('desk', 400, true);
  detector.pose('desk', 900, true);
  detector.reset();
  detector.pose('screen', 1000, false);
  assert.equal(detector.pose('screen', 1300, false), undefined);
});

test('only a complete deliberate blink fires and lost frames reset it', () => {
  const detector = new ReplayGesture();
  detector.blink(true, 0);
  assert.equal(detector.blink(false, 100), false);
  detector.blink(true, 200);
  detector.blink(null, 700);
  assert.equal(detector.blink(false, 900), false);
  detector.blink(true, 1000);
  assert.equal(detector.blink(false, 1720), true);
  assert.equal(detector.blink(false, 1900), false);
  detector.blink(true, 2200);
  assert.equal(detector.blink(false, 4900), false);
});
