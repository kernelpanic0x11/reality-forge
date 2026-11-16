import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandInteraction } from '../src/tracking.js';
import {
  DepthModel, HAND_BONES, handPxPerMeter, palmBasis, boneOcclusion, handHidesOrb, bodyHidesOrb, median,
} from '../src/depth.js';

// A flat, open right hand in metres, palm facing the camera, fingers up (y is down).
const WORLD = Array.from({ length: 21 }, (_, i) => {
  if (i === 0) return { x: 0, y: 0.08, z: 0 };
  const finger = Math.floor((i - 1) / 4), joint = (i - 1) % 4;
  if (finger === 0) return { x: -0.05 - joint * 0.015, y: 0.05 - joint * 0.012, z: 0 }; // thumb splayed out
  return { x: -0.04 + finger * 0.02, y: 0.02 - joint * 0.025, z: 0 };
});
// The same hand as stage pixels at `scale` px per metre.
const image = (scale, z = () => 0) => WORLD.map((p, i) => ({ x: 360 + p.x * scale, y: 640 + p.y * scale, z: z(i) }));
const close = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} is not ${b}`);

test('hand scale is recovered in pixels per metre', () => {
  close(handPxPerMeter(image(1500), WORLD), 1500);
  close(handPxPerMeter(image(750), WORLD), 750);
});

test('hand scale is unavailable without metric landmarks', () => {
  assert.equal(handPxPerMeter(image(1500), undefined), null);
});

test('a hand twice as far away reads twice the distance', () => {
  const depth = new DepthModel();
  close(depth.handDistance(750) / depth.handDistance(1500), 2);
});

test('calibration fixes distance and puts the face at the hand it was held beside', () => {
  const depth = new DepthModel();
  assert.equal(depth.calibrated, false);
  const saved = depth.calibrate({ handPxPerMeter: 1500, faceWidthPx: 240, distanceM: 0.9 });
  assert.equal(depth.calibrated, true);
  close(depth.handDistance(1500), 0.9);
  close(depth.faceDistance(240), 0.9);
  close(depth.faceDistance(120), 1.8);

  const restored = new DepthModel(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.calibrated, true);
  close(restored.handDistance(1500), 0.9);
});

test('calibration without a face keeps the default face width', () => {
  const depth = new DepthModel();
  const before = depth.faceWidthM;
  depth.calibrate({ handPxPerMeter: 1500, faceWidthPx: null, distanceM: 1 });
  assert.equal(depth.faceWidthM, before);
});

test('calibration rejects a missing hand, and corrupt saved values are ignored', () => {
  assert.throws(() => new DepthModel().calibrate({ handPxPerMeter: null, faceWidthPx: 200, distanceM: 1 }));
  assert.equal(new DepthModel({ focalPx: 'x', faceWidthM: -1 }).calibrated, false);
});

test('the palm basis is a proper rotation that follows the hand', () => {
  const [x, y, z] = palmBasis(WORLD);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (const axis of [x, y, z]) close(dot(axis, axis), 1);
  close(dot(x, y), 0); close(dot(x, z), 0); close(dot(y, z), 0);
  // Right-handed: x cross y equals z.
  close(x[1] * y[2] - x[2] * y[1], z[0]); close(x[2] * y[0] - x[0] * y[2], z[1]); close(x[0] * y[1] - x[1] * y[0], z[2]);
  // Fingers point up on screen, which is +y in the 3D scene.
  assert.ok(y[1] > 0.9);
  // Rotating the hand a quarter turn in the image plane rotates the basis with it.
  const turned = palmBasis(WORLD.map(p => ({ x: -p.y, y: p.x, z: p.z })));
  assert.ok(Math.abs(turned[1][0]) > 0.9, 'fingers now point sideways');
});

test('fingers nearer the camera than the pinch hide the object; farther ones do not', () => {
  // Index finger (joints 5..8) pushed toward the camera, except its tip at the pinch.
  const near = boneOcclusion(image(1500, i => (i >= 5 && i <= 7 ? -40 : 0)));
  const indexBone = HAND_BONES.findIndex(([a, b]) => a === 5 && b === 6);
  const pinkyBone = HAND_BONES.findIndex(([a, b]) => a === 17 && b === 18);
  assert.equal(near[indexBone], 1);
  assert.equal(near[pinkyBone], 0);
  const far = boneOcclusion(image(1500, i => (i >= 5 && i <= 7 ? 40 : 0)));
  assert.equal(far[indexBone], 0);
});

test('a clearly nearer hand hides a released object; one at the same depth does not', () => {
  assert.equal(handHidesOrb(1800, 1500), true);
  assert.equal(handHidesOrb(1500, 1500), false);
  assert.equal(handHidesOrb(1200, 1500), false);
  assert.equal(handHidesOrb(1800, null), false);
});

test('the body hides the object only when it is clearly behind the face', () => {
  assert.equal(bodyHidesOrb(1.3, 1.0), true);
  assert.equal(bodyHidesOrb(1.05, 1.0), false);
  assert.equal(bodyHidesOrb(0.6, 1.0), false);
  assert.equal(bodyHidesOrb(null, 1.0), false);
});

test('median ignores outliers', () => {
  assert.equal(median([5, 1, 100, 3, 4]), 4);
  assert.equal(median([]), null);
});

// MediaPipe-shaped result for one right hand; pinched moves thumb and index tips together.
function handResult(scale, pinched) {
  const world = WORLD.map(p => ({ ...p }));
  if (pinched) world[4] = { ...world[8] };
  return {
    landmarks: [world.map(p => ({ x: (360 + p.x * scale) / 720, y: (640 + p.y * scale) / 1280, z: 0 }))],
    worldLandmarks: [world],
    handedness: [[{ categoryName: 'Right', score: 0.99 }]],
  };
}

test('the tracker reports joints and scale, and the object keeps its depth after release', () => {
  const tracker = new HandInteraction(720, 1280);
  let boxes;
  for (let t = 0; t <= 200; t += 20) boxes = tracker.update(handResult(1500, true), t);
  assert.equal(tracker.owner, 'Right');
  assert.equal(boxes[0].points.length, 21);
  assert.ok(Math.abs(boxes[0].pxPerMeter - tracker.orbScale) < 1e-6);
  assert.ok(tracker.orbScale > 1000 && tracker.orbScale < 2000);
  assert.equal(tracker.orbBasis.length, 3);

  const held = tracker.orbScale;
  // Release, then move the hand much nearer: the object stays at its depth.
  for (let t = 220; t <= 400; t += 20) tracker.update(handResult(1500, false), t);
  for (let t = 420; t <= 800; t += 20) boxes = tracker.update(handResult(2400, false), t);
  assert.equal(tracker.state, 'released');
  assert.equal(tracker.orbScale, held);
  assert.equal(handHidesOrb(boxes[0].pxPerMeter, tracker.orbScale), true);
});
