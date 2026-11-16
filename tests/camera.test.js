import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRotation, shortLabel } from '../src/camera.js';

test('the Canon starts rotated; built-in and other cameras start upright', () => {
  assert.equal(defaultRotation('Canon Digital Camera'), '90');
  assert.equal(defaultRotation('FaceTime HD Camera (05ac:8514)'), '0');
  assert.equal(defaultRotation(''), '0');
});

test('camera labels are shortened for the status line', () => {
  assert.equal(shortLabel('FaceTime HD Camera (05ac:8514)'), 'FaceTime HD Camera');
  assert.equal(shortLabel('Canon Digital Camera'), 'Canon Digital Camera');
  assert.equal(shortLabel(''), 'Camera');
});
