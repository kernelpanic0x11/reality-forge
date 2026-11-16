import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DwellButton } from '../src/hotspot.js';

const button = () => new DwellButton({ x: 200, y: 600, radius: 46, dwellMs: 350, cooldownMs: 900 });
const ON = [{ x: 205, y: 610 }], OFF = [{ x: 400, y: 900 }];
// Feeds frames every 33 ms and returns how many times the button toggled.
function feed(b, points, from, to) {
  let toggles = 0;
  for (let t = from; t <= to; t += 33) if (b.update(points, t)) toggles++;
  return toggles;
}

test('resting a fingertip on the button toggles it once', () => {
  const b = button();
  assert.equal(feed(b, ON, 0, 300), 0, 'not yet held long enough');
  assert.ok(b.progress > 0.5 && b.progress < 1);
  assert.equal(feed(b, ON, 333, 2000), 1, 'toggles once, however long the finger stays');
  assert.equal(b.on, true);
});

test('a hand passing through does not toggle it', () => {
  const b = button();
  assert.equal(feed(b, ON, 0, 200), 0);
  assert.equal(feed(b, OFF, 233, 400), 0);
  assert.equal(b.progress, 0);
  assert.equal(feed(b, ON, 433, 700), 0, 'the hold starts again from zero');
  assert.equal(b.on, false);
});

test('it toggles back off only after the finger leaves and returns', () => {
  const b = button();
  feed(b, ON, 0, 500);
  assert.equal(b.on, true);
  assert.equal(feed(b, OFF, 533, 1600), 0);
  assert.equal(feed(b, ON, 1633, 2100), 1);
  assert.equal(b.on, false);
});

test('leaving and coming straight back within the cooldown does nothing', () => {
  const b = button();
  feed(b, ON, 0, 500);
  feed(b, OFF, 533, 600);
  assert.equal(feed(b, ON, 633, 1100), 0);
  assert.equal(b.on, true);
});

test('any fingertip of either hand counts, and no hands means no press', () => {
  const b = button();
  assert.equal(feed(b, [...OFF, { x: 400, y: 100 }, ...ON], 0, 500), 1);
  assert.equal(feed(button(), [], 0, 2000), 0);
});

test('the button can be moved, and then responds at its new place', () => {
  const b = button();
  b.moveTo(400, 900);
  assert.equal(feed(b, ON, 0, 1000), 0);
  assert.equal(feed(b, OFF, 1033, 1600), 1);
});
