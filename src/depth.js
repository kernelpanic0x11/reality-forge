// Pure depth and hand-pose math: no DOM, no MediaPipe or Three.js imports.
// Shared by the app and the Node tests.
import { DEPTH } from './config.js';

// MediaPipe hand landmark pairs that form the skeleton.
export const HAND_BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],         // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],         // index
  [5, 9], [9, 10], [10, 11], [11, 12],    // middle
  [9, 13], [13, 14], [14, 15], [15, 16],  // ring
  [13, 17], [17, 18], [18, 19], [19, 20], // pinky
  [0, 17],                                // palm edge
];
export const PALM_OUTLINE = [0, 1, 5, 9, 13, 17];
export const FINGERTIPS = [4, 8, 12, 16, 20];

const clamp01 = v => Math.max(0, Math.min(1, v));

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// How many stage pixels one real metre spans at the hand's depth.
// `points` are image landmarks in pixels; `world` are the same landmarks in
// metres. Comparing bone lengths in both stays correct when the hand rotates,
// because the world landmarks rotate with it.
export function handPxPerMeter(points, world) {
  if (!points || !world) return null;
  let px = 0, metres = 0;
  for (const [a, b] of HAND_BONES) {
    px += Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
    metres += Math.hypot(world[a].x - world[b].x, world[a].y - world[b].y);
  }
  return metres > 1e-6 && px > 0 ? px / metres : null;
}

// The palm's orientation as three perpendicular unit axes [x, y, z], in
// Three.js coordinates (y up, z toward the viewer). Null if degenerate.
export function palmBasis(world) {
  if (!world) return null;
  // Image coordinates have y down and z away from the camera; flip both.
  const between = (a, b) => [world[a].x - world[b].x, world[b].y - world[a].y, world[b].z - world[a].z];
  const normalize = v => { const n = Math.hypot(...v); return n > 1e-9 ? v.map(c => c / n) : null; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const x = normalize(between(5, 17));  // across the knuckles
  const up = normalize(between(9, 0));  // wrist to middle knuckle
  if (!x || !up) return null;
  const z = normalize(cross(x, up));
  if (!z) return null;
  return [x, cross(z, x), z];
}

// For a hand holding the object: how strongly each bone hides it, 0..1.
// Bones nearer the camera than the pinch point are in front of the object.
// (MediaPipe z shrinks toward the camera.)
export function boneOcclusion(points, softnessPx = DEPTH.boneSoftnessPx) {
  const pinchZ = (points[4].z + points[8].z) / 2;
  return HAND_BONES.map(([a, b]) => clamp01((pinchZ - (points[a].z + points[b].z) / 2) / softnessPx));
}

// A hand that appears clearly larger than the object's scale is nearer the camera.
export function handHidesOrb(handScale, orbScale, ratio = DEPTH.handInFrontRatio) {
  return handScale > 0 && orbScale > 0 && handScale / orbScale > ratio;
}

export function bodyHidesOrb(orbDistanceM, faceDistanceM, marginM = DEPTH.behindBodyMarginM) {
  return orbDistanceM > 0 && faceDistanceM > 0 && orbDistanceM > faceDistanceM + marginM;
}

const positive = v => Number.isFinite(v) && v > 0;

// Turns apparent sizes into distances from the camera. Uncalibrated, the
// distances are rough guesses; relative hand-versus-object depth does not
// depend on it.
export class DepthModel {
  constructor(saved = null, options = DEPTH) {
    this.options = options;
    this.reset();
    if (saved && positive(saved.focalPx) && positive(saved.faceWidthM)) {
      this.focalPx = saved.focalPx;
      this.faceWidthM = saved.faceWidthM;
      this.calibrated = true;
    }
  }

  reset() {
    this.focalPx = this.options.defaultFocalPx;
    this.faceWidthM = this.options.defaultFaceWidthM;
    this.calibrated = false;
  }

  handDistance(pxPerMeter) {
    return positive(pxPerMeter) ? this.focalPx / pxPerMeter : null;
  }

  faceDistance(faceWidthPx) {
    return positive(faceWidthPx) ? this.focalPx * this.faceWidthM / faceWidthPx : null;
  }

  // Taken while a hand is held beside the face at a known distance from the
  // camera. The distance fixes the focal length; the face seen at the same
  // depth as the hand fixes the face width. Without a face only the focal
  // length is updated.
  calibrate({ handPxPerMeter, faceWidthPx, distanceM }) {
    if (!positive(handPxPerMeter) || !positive(distanceM)) throw Error('Calibration needs a visible hand and a distance.');
    this.focalPx = handPxPerMeter * distanceM;
    if (positive(faceWidthPx)) this.faceWidthM = faceWidthPx / handPxPerMeter;
    this.calibrated = true;
    return this.toJSON();
  }

  toJSON() {
    return { focalPx: this.focalPx, faceWidthM: this.faceWidthM };
  }
}
