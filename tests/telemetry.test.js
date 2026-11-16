import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changes } from '../src/telemetry.js';

const snap = (overrides = {}) => ({ state: 'idle', owner: null, face: false, bodyInFront: false, hands: {}, ...overrides });
const names = events => events.map(e => e.event);

test('an unchanged snapshot logs nothing', () => {
  const same = snap({ hands: { Right: { state: 'open', ratio: 0.9 } }, face: true });
  assert.deepEqual(changes(same, structuredClone(same)), []);
});

test('hands appearing, changing state and disappearing are logged with their details', () => {
  const appeared = changes(snap(), snap({ hands: { Right: { state: 'open', ratio: 0.9, cm: 60 } } }));
  assert.deepEqual(appeared, [{ event: 'hand.appear', side: 'Right', state: 'open', ratio: 0.9, cm: 60 }]);

  const grabbed = changes(
    snap({ hands: { Right: { state: 'open', ratio: 0.9 } } }),
    snap({ hands: { Right: { state: 'grabbed', ratio: 0.3 } }, state: 'grabbed', owner: 'Right', object: { x: 10, y: 20 } }));
  assert.deepEqual(grabbed, [
    { event: 'hand.state', side: 'Right', from: 'open', state: 'grabbed', ratio: 0.3 },
    { event: 'object', from: 'idle', to: 'grabbed', owner: 'Right', x: 10, y: 20 },
  ]);

  assert.deepEqual(changes(snap({ hands: { Left: { state: 'grabbed' } } }), snap()),
    [{ event: 'hand.lost', side: 'Left', last: 'grabbed' }]);
});

test('face and body occlusion changes are logged once each way', () => {
  assert.deepEqual(names(changes(snap(), snap({ face: true, bodyInFront: true }))), ['face.appear', 'body.occlusion']);
  assert.deepEqual(names(changes(snap({ face: true, bodyInFront: true }), snap())), ['face.lost', 'body.occlusion']);
});

test('the first snapshot reports what is visible but no object transition', () => {
  assert.deepEqual(names(changes(null, snap({ state: 'grabbed', owner: 'Left', hands: { Left: { state: 'grabbed' } } }))), ['hand.appear']);
});
