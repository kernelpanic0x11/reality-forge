import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StrokeCounter, ShiftCounter, HandMotion, GuitarSession, RateCounter } from '../src/guitar.js';

const SCALE = 1500; // pixels per metre
// 21 joints of a hand whose palm is at (x, y); `spread` moves the fingertips relative to the palm.
const points = (x, y, spread = 0) => Array.from({ length: 21 }, (_, i) => ({ x: x + (i % 5) * 10 + ([4, 8, 12, 16, 20].includes(i) ? spread : 0), y: y + i * 3, z: 0 }));

test('each down stroke and each up stroke is counted once', () => {
  const strokes = new StrokeCounter();
  let t = 0;
  // Four full down-up cycles of 2 cm, sampled like a 30 fps camera.
  for (let i = 0; i <= 80; i++, t += 33) strokes.update({ x: 300, y: 600 + 15 * Math.sin(i / 10 * Math.PI) }, SCALE, t);
  assert.ok(strokes.count >= 7 && strokes.count <= 8, `${strokes.count} strokes`);
});

test('sideways picking counts the same as up-and-down picking', () => {
  const strokes = new StrokeCounter();
  for (let i = 0, t = 0; i <= 80; i++, t += 33) strokes.update({ x: 300 + 15 * Math.sin(i / 10 * Math.PI), y: 600 }, SCALE, t);
  assert.ok(strokes.count >= 7 && strokes.count <= 8);
});

test('tracking jitter smaller than a stroke is not counted', () => {
  const strokes = new StrokeCounter();
  for (let i = 0, t = 0; i <= 200; i++, t += 33) strokes.update({ x: 300 + (i % 2) * 3, y: 600 - (i % 3) * 2 }, SCALE, t);
  assert.equal(strokes.count, 0);
});

test('rates are per minute over the recent window only', () => {
  const rate = new RateCounter(4000);
  for (let t = 0; t < 4000; t += 500) rate.add(t);
  assert.equal(rate.perMinute(3999), 120);
  assert.equal(rate.perMinute(20000), 0);
  assert.equal(rate.count, 8);
});

test('hand speed and distance are reported in real units', () => {
  const motion = new HandMotion();
  // 10 cm per second for two seconds.
  for (let i = 0; i <= 60; i++) motion.update(points(100 + i * 5, 500), SCALE, i * 1000 / 30);
  assert.ok(Math.abs(motion.speed - 10) < 0.5, `${motion.speed} cm/s`);
  assert.ok(Math.abs(motion.travelledM - 0.2) < 0.01, `${motion.travelledM} m`);
  assert.ok(motion.fingerSpeed < 0.01, 'moving the whole hand is not finger movement');
});

test('finger movement is measured separately from the hand moving', () => {
  const motion = new HandMotion();
  for (let i = 0; i <= 60; i++) motion.update(points(100, 500, (i % 2) * 15), SCALE, i * 1000 / 30);
  assert.ok(motion.fingerSpeed > 10, `${motion.fingerSpeed} cm/s`);
  assert.ok(motion.speed < 0.01);
});

test('a hand reappearing elsewhere does not count the gap as travel', () => {
  const motion = new HandMotion();
  motion.update(points(100, 500), SCALE, 0);
  motion.update(points(100, 500), SCALE, 33);
  motion.update(points(600, 900), SCALE, 2000);
  assert.equal(motion.travelledM, 0);
  assert.equal(motion.trails[0].length, 1);
});

test('fingertip trails only keep recent positions', () => {
  const motion = new HandMotion();
  for (let i = 0; i <= 60; i++) motion.update(points(100 + i, 500), SCALE, i * 33);
  const trail = motion.trails[0];
  assert.ok(trail.length > 5 && trail.length < 25);
  assert.ok(trail.at(-1).time - trail[0].time <= 600);
});

test('a position shift is a move along the neck followed by settling', () => {
  const shifts = new ShiftCounter();
  shifts.update({ x: 300, y: 300 }, SCALE, 0);
  assert.equal(shifts.update({ x: 320, y: 300 }, SCALE, 2), false, 'small move');
  assert.equal(shifts.update({ x: 420, y: 300 }, SCALE, 40), false, 'still moving fast');
  assert.equal(shifts.update({ x: 430, y: 300 }, SCALE, 3), true, 'settled 8 cm away');
  assert.equal(shifts.update({ x: 432, y: 300 }, SCALE, 1), false);
  assert.equal(shifts.count, 1);
});

test('the left hand frets and the right hand picks, swapped for a left-handed player', () => {
  const session = new GuitarSession();
  const hands = () => [{ side: 'Left', points: points(100, 300), pxPerMeter: SCALE }, { side: 'Right', points: points(400, 800), pxPerMeter: SCALE }];
  const righty = hands();
  session.update(righty, 0);
  assert.deepEqual(righty.map(h => h.role), ['fret', 'pick']);
  const lefty = hands();
  session.update(lefty, 33, { lefty: true });
  assert.deepEqual(lefty.map(h => h.role), ['pick', 'fret']);
});

test('a session summary reports picking, fretting and notes', () => {
  const session = new GuitarSession();
  for (let i = 0, t = 0; i <= 90; i++, t += 33) {
    const pick = points(400, 800);
    pick[4] = { x: 400, y: 800 + 15 * Math.sin(i / 10 * Math.PI), z: 0 };
    pick[8] = { ...pick[4] };
    session.update([{ side: 'Left', points: points(100, 300, (i % 2) * 10), pxPerMeter: SCALE }, { side: 'Right', points: pick, pxPerMeter: SCALE }], t);
    if (i % 15 === 0) session.noteOnset(t);
  }
  const summary = session.summary(90 * 33);
  assert.ok(summary.pick.strokes >= 8, `${summary.pick.strokes} strokes`);
  assert.ok(summary.pick.strokesPerMin > 100);
  assert.ok(summary.fret.fingerCmPerS > 5);
  assert.equal(summary.notes.count, 7);
});

// Both hands in their usual places: fretting hand on the left of the picture, picking hand on the right.
const fretHand = (side = 'Left', x = 150) => ({ side, points: points(x, 900), pxPerMeter: SCALE });
const pickHand = (side = 'Right', x = 500) => ({ side, points: points(x, 900), pxPerMeter: SCALE });
function learnedSession() {
  const session = new GuitarSession();
  for (let i = 0; i < 20; i++) session.update([fretHand(), pickHand()], i * 33);
  assert.equal(session.rolesLearned, true);
  return session;
}

test('roles are not trusted from position until both hands have been seen together', () => {
  const session = new GuitarSession();
  for (let i = 0; i < 5; i++) session.update([fretHand(), pickHand()], i * 33);
  assert.equal(session.rolesLearned, false);
  const lone = pickHand('Left'); // mislabelled, and nothing learned yet: the label wins
  session.update([lone], 200);
  assert.equal(lone.role, 'fret');
});

test('once learned, a mislabelled hand keeps the role of the place it is in', () => {
  const session = learnedSession();
  const picking = pickHand('Left'), fretting = fretHand('Right');
  session.update([picking], 700);
  assert.equal(picking.role, 'pick');
  session.update([fretting], 733);
  assert.equal(fretting.role, 'fret');
});

test('once learned, unsure labels swapping at once do not swap the roles', () => {
  const session = learnedSession();
  // Both labels flip, but neither is confident: position decides.
  const hands = [{ ...fretHand('Right'), labelScore: 0.6 }, { ...pickHand('Left'), labelScore: 0.7 }];
  session.update(hands, 700);
  assert.deepEqual(hands.map(h => h.role), ['fret', 'pick']);
});

test('the fretting hand keeps its role while it slides up the neck toward the body', () => {
  const session = learnedSession();
  for (let i = 0; i <= 30; i++) {
    const hands = [fretHand('Left', 150 + i * 8), pickHand()];
    session.update(hands, 700 + i * 33);
    assert.deepEqual(hands.map(h => h.role), ['fret', 'pick']);
  }
});

test('roles learned wrongly at the start are corrected by later confident frames', () => {
  const session = new GuitarSession();
  // While setting up, the hands are briefly labelled the wrong way round.
  for (let i = 0; i < 20; i++) session.update([fretHand('Right'), pickHand('Left')], i * 33);
  assert.equal(session.rolesLearned, true);
  // Then the labels are right, and confident, for a couple of seconds.
  let hands;
  for (let i = 0; i < 60; i++) {
    hands = [{ ...fretHand('Left'), labelScore: 0.98 }, { ...pickHand('Right'), labelScore: 0.99 }];
    session.update(hands, 700 + i * 33);
  }
  assert.deepEqual(hands.map(h => h.role), ['fret', 'pick']);
  // And a lone, unsure hand now gets the role of the corrected place.
  const lone = { ...pickHand('Left'), labelScore: 0.5 };
  session.update([lone], 2800);
  assert.equal(lone.role, 'pick');
});

test('a label that disagrees with the tracked side is not treated as confident', () => {
  const session = learnedSession();
  const hands = [{ ...fretHand('Right'), label: 'Left', labelScore: 0.99 }, { ...pickHand('Left'), label: 'Right', labelScore: 0.99 }];
  session.update(hands, 700);
  assert.deepEqual(hands.map(h => h.role), ['fret', 'pick'], 'position decides');
});

test('a hand the first pass missed is searched for where it was last seen', () => {
  const session = new GuitarSession();
  assert.deepEqual(session.searchTargets(0), [], 'nothing has been seen yet');
  assert.deepEqual(session.unknownRoles(0), ['fret', 'pick']);
  for (let i = 0; i < 10; i++) session.update([fretHand(), pickHand()], i * 33);
  assert.deepEqual(session.unknownRoles(330), []);

  // This frame the first pass found only the picking hand.
  const pickPalm = { x: 520, y: 910 };
  const targets = session.searchTargets(330, [pickPalm]);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].role, 'fret');
  assert.ok(Math.abs(targets[0].x - 170) < 30 && Math.abs(targets[0].y - 910) < 30, `${targets[0].x},${targets[0].y}`);

  assert.equal(session.searchTargets(330, []).length, 2, 'both missed: look for both');
  assert.deepEqual(session.searchTargets(60000, []), [], 'gives up on a spot after a long absence');
  assert.deepEqual(session.unknownRoles(60000), ['fret', 'pick'], 'and goes back to sweeping');
});

test('a hand sliding fast along the neck is looked for ahead of where it was last seen', () => {
  const session = new GuitarSession();
  // The fretting hand slides right at 600 px per second while the picking hand stays put.
  for (let i = 0; i < 10; i++) session.update([fretHand('Left', 100 + i * 20), pickHand('Right', 620)], i * 33);
  const lastX = 100 + 9 * 20 + 20; // palm of the last frame (points() puts the palm about 20 px right of x)
  const [target] = session.searchTargets(9 * 33 + 66, [{ x: 640, y: 910 }]);
  assert.equal(target.role, 'fret');
  assert.ok(target.x > lastX + 25, `looks ahead of ${lastX}, at ${target.x}`);
  assert.ok(target.x < lastX + 100, 'but not unreasonably far');
  assert.equal(target.missingFor, 66);
  // A detection at the predicted place counts as that hand being found.
  assert.equal(session.searchTargets(9 * 33 + 66, [{ x: 640, y: 910 }, { x: target.x, y: target.y }]).length, 0);
});

test('two roles are never left following the same hand', () => {
  const session = new GuitarSession();
  // Before the roles are learned, the picking hand alone is briefly mislabelled as the fretting hand.
  session.update([pickHand('Left')], 0);
  session.update([pickHand('Right')], 33);
  // Both roles were now last seen in the same place. Only one may keep it.
  const targets = session.searchTargets(66, []);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].role, 'pick', 'the more recent sighting keeps the place');
  assert.deepEqual(session.unknownRoles(66), ['fret'], 'the other is searched for afresh');
});

test('roles seen in different places are left alone', () => {
  const session = learnedSession();
  assert.equal(session.separateRoles(), null);
  assert.equal(session.searchTargets(700, []).length, 2);
});
