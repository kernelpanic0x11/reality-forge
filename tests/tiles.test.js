import { test } from 'node:test';
import assert from 'node:assert/strict';
import { squareTiles, mergeTiles, scanGrid, scanOrder, cropAround, lowLightGain } from '../src/tiles.js';
import { HandInteraction } from '../src/tracking.js';

test('a portrait frame is covered by overlapping square tiles', () => {
  const tiles = squareTiles(720, 1280, 160);
  assert.deepEqual(tiles, [{ x: 0, y: 0, size: 720 }, { x: 0, y: 560, size: 720 }]);
  assert.equal(tiles.at(-1).y + tiles.at(-1).size, 1280, 'reaches the bottom edge');
});

test('taller frames get more tiles, and every row is inside at least one', () => {
  const tiles = squareTiles(720, 1920, 160);
  assert.ok(tiles.length >= 3);
  for (let y = 0; y < 1920; y += 10) assert.ok(tiles.some(t => y >= t.y && y < t.y + t.size), `row ${y} is covered`);
  for (let i = 1; i < tiles.length; i++) assert.ok(tiles[i - 1].y + tiles[i - 1].size - tiles[i].y >= 100, 'neighbours overlap');
});

test('a landscape or square frame is a single tile', () => {
  assert.equal(squareTiles(1280, 720, 160).length, 1);
  assert.equal(squareTiles(720, 720, 160).length, 1);
});

const handAt = (x, y) => ({
  landmarks: [Array.from({ length: 21 }, (_, i) => ({ x: x + i * 0.004, y: y + i * 0.004, z: -0.02 }))],
  worldLandmarks: [Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }))],
  handedness: [[{ categoryName: 'Left', score: 0.9 }]],
});

test('tile results are mapped back to whole-frame positions', () => {
  const tiles = squareTiles(720, 1280, 160);
  // A hand in the middle of the bottom tile.
  const merged = mergeTiles([{ landmarks: [] }, handAt(0.5, 0.5)], tiles, 720, 1280);
  assert.equal(merged.landmarks.length, 1);
  const wrist = merged.landmarks[0][0];
  assert.ok(Math.abs(wrist.x * 720 - 360) < 0.01);
  assert.ok(Math.abs(wrist.y * 1280 - (560 + 360)) < 0.01);
  assert.equal(merged.handedness[0][0].categoryName, 'Left');
  assert.equal(merged.worldLandmarks.length, 1);
});

test('a hand seen by both tiles in their overlap is tracked as one hand', () => {
  const tiles = squareTiles(720, 1280, 160);
  // The same spot (y = 640 px) as each tile sees it.
  const top = handAt(0.4, 640 / 720), bottom = handAt(0.4, (640 - 560) / 720);
  const merged = mergeTiles([top, bottom], tiles, 720, 1280);
  assert.equal(merged.landmarks.length, 2);
  assert.ok(Math.abs(merged.landmarks[0][0].y - merged.landmarks[1][0].y) < 1e-9);
  const tracker = new HandInteraction(720, 1280);
  assert.equal(tracker.update(merged, 0).length, 1);
});

test('empty and missing tile results merge to no hands', () => {
  const merged = mergeTiles([{ landmarks: [] }, undefined], squareTiles(720, 1280, 160), 720, 1280);
  assert.deepEqual(merged, { landmarks: [], worldLandmarks: [], handedness: [] });
});

test('the sweep covers every part of the frame with overlapping crops', () => {
  const grid = scanGrid(720, 1280, 360, 180);
  for (const tile of grid) assert.ok(tile.x >= 0 && tile.y >= 0 && tile.x + 360 <= 720 && tile.y + 360 <= 1280, 'crop stays inside the frame');
  // Any 150 px hand is wholly inside at least one crop.
  for (let y = 0; y <= 1280 - 150; y += 30) for (let x = 0; x <= 720 - 150; x += 30) {
    assert.ok(grid.some(t => x >= t.x && y >= t.y && x + 150 <= t.x + 360 && y + 150 <= t.y + 360), `hand at ${x},${y} is covered`);
  }
  assert.ok(grid.length <= 30, `${grid.length} crops is a quick sweep`);
});

test('a crop around a point is kept inside the frame', () => {
  assert.deepEqual(cropAround(360, 640, 360, 720, 1280), { x: 180, y: 460, size: 360 });
  assert.deepEqual(cropAround(10, 1270, 360, 720, 1280), { x: 0, y: 920, size: 360 });
});

test('dark pictures are brightened more, within limits', () => {
  const options = { targetBrightness: 0.5, minGain: 1.3, maxGain: 5 };
  assert.equal(lowLightGain(0.25, options), 2);
  assert.equal(lowLightGain(0.6, options), 1.3);
  assert.equal(lowLightGain(0.02, options), 5);
  assert.equal(lowLightGain(0, options), 5);
});

test('the sweep starts nearest to where the hand was last seen', () => {
  const grid = scanGrid(720, 1280, 360, 180);
  const order = scanOrder(grid, { x: 60, y: 950 });
  assert.equal(order.length, grid.length, 'still covers everything');
  const centre = t => ({ x: t.x + 180, y: t.y + 180 });
  const away = t => Math.hypot(centre(t).x - 60, centre(t).y - 950);
  assert.ok(away(order[0]) <= 200, 'first crop contains the last known place');
  for (let i = 1; i < order.length; i++) assert.ok(away(order[i]) >= away(order[i - 1]), 'then works outward');
  assert.equal(scanOrder(grid, null), grid);
});
