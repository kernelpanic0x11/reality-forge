import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandInteraction, StableFace } from '../src/tracking.js';

// A 21-landmark hand. Thumb tip (4) and index tip (8) are apart when open and
// together when pinched; `offset` shifts the whole hand sideways.
function hand(open, offset = 0) {
  return Array.from({ length: 21 }, (_, i) => ({
    x: offset + (i === 4 ? 0.34 : i === 8 ? (open ? 0.52 : 0.35) : i === 5 ? 0.2 : i === 17 ? 0.4 : 0.3),
    y: i === 4 || i === 8 ? 0.45 : 0.6,
  }));
}

// A MediaPipe-shaped result with a Left hand and a Right hand, optionally in reversed order.
function result(leftOpen, rightOpen, reverse = false) {
  const pairs = [['Left', hand(leftOpen)], ['Right', hand(rightOpen, 0.4)]];
  if (reverse) pairs.reverse();
  return {
    landmarks: pairs.map(p => p[1]),
    handedness: pairs.map(p => [{ categoryName: p[0], score: 0.99 }]),
  };
}
const NO_HANDS = { landmarks: [], handedness: [] };

// Feeds frames every 20 ms, flipping detection order on alternate frames.
function feed(tracker, from, to, leftOpen, rightOpen, shuffle = true) {
  for (let t = from; t <= to; t += 20) tracker.update(result(leftOpen, rightOpen, shuffle && t % 40 === 0), t);
}

const newTracker = () => new HandInteraction(720, 1280);
function leftGrabs(tracker = newTracker()) { feed(tracker, 0, 120, false, true); return tracker; }
function leftReleases(tracker = leftGrabs()) { feed(tracker, 140, 260, true, true); return tracker; }
function rightGrabs(tracker = leftReleases()) { feed(tracker, 280, 400, true, false, false); return tracker; }

test('a pinching hand grabs the object while the other hand stays open', () => {
  const tracker = leftGrabs();
  assert.equal(tracker.owner, 'Left');
  assert.equal(tracker.state, 'grabbed');
  assert.equal(tracker.hands.get('Right').state, 'open');
});

test('a pinch must persist before it counts as a grab', () => {
  const tracker = newTracker();
  feed(tracker, 0, 80, false, true);
  assert.equal(tracker.owner, null);
});

test('release leaves the object exactly where it was, despite reversed detection order', () => {
  const tracker = leftGrabs();
  const before = { ...tracker.orb };
  leftReleases(tracker);
  assert.equal(tracker.state, 'released');
  assert.equal(tracker.owner, null);
  assert.deepEqual(tracker.orb, before);
});

test('after a release the other hand can grab with a fresh pinch', () => {
  assert.equal(rightGrabs().owner, 'Right');
});

test('a second pinching hand cannot steal a held object', () => {
  const tracker = rightGrabs();
  const held = { ...tracker.orb };
  feed(tracker, 420, 540, false, false, false);
  assert.equal(tracker.owner, 'Right');
  assert.equal(tracker.hands.get('Left').state, 'grabbed');
  assert.ok(tracker.orb.x > held.x - 2, 'object stayed with the right hand');
});

test('brief tracking loss keeps ownership; sustained loss releases', () => {
  const tracker = rightGrabs();
  tracker.update(NO_HANDS, 560);
  assert.equal(tracker.owner, 'Right');
  tracker.update(NO_HANDS, 1250);
  assert.equal(tracker.owner, null);
  assert.equal(tracker.state, 'released');
});

test('mirroring swaps the Left/Right labels', () => {
  const boxes = newTracker().update(result(true, true), 0, true);
  assert.equal(boxes[0].side, 'Right');
  assert.equal(boxes[1].side, 'Left');
});

const detection = (x = 100, score = 0.95) => ({
  boundingBox: { originX: x, originY: 100, width: 120, height: 150 },
  categories: [{ score }],
});

function confirmedFace() {
  const face = new StableFace();
  for (let t = 1000; t <= 1240; t += 80) face.update([detection()], t);
  return face;
}

test('an isolated face detection is never shown', () => {
  const face = new StableFace();
  assert.equal(face.update([detection()], 0).length, 0);
  assert.equal(face.update([], 300).length, 0);
});

test('flickering low-confidence detections are never shown', () => {
  const face = new StableFace();
  for (let t = 320; t <= 800; t += 80) {
    assert.equal(face.update(t % 160 === 0 ? [detection(100, 0.65)] : [], t).length, 0);
  }
});

test('a persistent face appears', () => {
  assert.equal(confirmedFace().update([detection()], 1280).length, 1);
});

test('a brief dropout does not blink the face box; a long one clears it', () => {
  const face = confirmedFace();
  face.update([detection()], 1280);
  assert.equal(face.update([], 1400).length, 1);
  assert.equal(face.update([], 1600).length, 0);
});

// One hand at a fixed place, reported with whatever label and confidence the test chooses.
const oneHand = (open, label, score = 0.99, offset = 0) => ({
  landmarks: [hand(open, offset)],
  handedness: [[{ categoryName: label, score }]],
});

test('a flickering Left/Right label does not change which hand it is', () => {
  const tracker = newTracker();
  const sides = new Set();
  for (let t = 0; t <= 600; t += 20) {
    const boxes = tracker.update(oneHand(true, t % 40 === 0 ? 'Left' : 'Right'), t);
    assert.equal(boxes.length, 1);
    sides.add(boxes[0].side);
  }
  assert.equal(sides.size, 1);
  assert.equal(tracker.hands.size, 1);
});

test('the holding hand keeps the object when it is relabelled as the other side', () => {
  const tracker = newTracker();
  for (let t = 0; t <= 200; t += 20) tracker.update(oneHand(false, 'Left'), t);
  assert.equal(tracker.owner, 'Left');
  let boxes;
  for (let t = 220; t <= 1400; t += 20) boxes = tracker.update(oneHand(false, 'Right'), t);
  assert.equal(tracker.state, 'grabbed');
  assert.equal(tracker.owner, 'Left');
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].owner, true);
});

test('a hand with an unsure label stays visible and keeps its side', () => {
  const tracker = newTracker();
  tracker.update(oneHand(true, 'Right'), 0);
  for (let t = 20; t <= 400; t += 20) {
    const boxes = tracker.update(oneHand(true, 'Left', 0.4), t);
    assert.equal(boxes.length, 1);
    assert.equal(boxes[0].side, 'Right');
  }
});

test('a hand that is not holding anything is renamed after sustained confident relabelling', () => {
  const tracker = newTracker();
  tracker.update(oneHand(true, 'Left'), 0);
  let boxes;
  for (let t = 20; t <= 200; t += 20) boxes = tracker.update(oneHand(true, 'Right'), t);
  assert.equal(boxes[0].side, 'Right');
});

test('two detections of the same physical hand count as one hand', () => {
  const tracker = newTracker();
  const doubled = { landmarks: [hand(true), hand(true, 0.01)], handedness: [[{ categoryName: 'Left', score: 0.9 }], [{ categoryName: 'Right', score: 0.8 }]] };
  for (let t = 0; t <= 100; t += 20) assert.equal(tracker.update(doubled, t).length, 1);
  assert.equal(tracker.hands.size, 1);
});

test('two hands given the same label are still shown as two different hands', () => {
  const tracker = newTracker();
  const sameLabel = { landmarks: [hand(true), hand(true, 0.4)], handedness: [[{ categoryName: 'Left', score: 0.95 }], [{ categoryName: 'Left', score: 0.9 }]] };
  const boxes = tracker.update(sameLabel, 0);
  assert.deepEqual(boxes.map(b => b.side).sort(), ['Left', 'Right']);
});
