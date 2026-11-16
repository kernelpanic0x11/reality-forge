// Loads the three local MediaPipe models. Each call builds fresh ones (about
// 0.2 s), so pressing Start always recovers tracking, for example after the
// browser dropped the graphics context while the tab was in the background.
import { FilesetResolver, HandLandmarker, ImageSegmenter, FaceDetector } from './vendor/vision_bundle.mjs';
import { MODELS, STAGE, GUITAR } from './config.js';
import { squareTiles, mergeTiles, scanGrid, scanOrder, cropAround } from './tiles.js';

export const TILES = squareTiles(STAGE.width, STAGE.height, GUITAR.detection.tileOverlapPx);

let loading, current = null;

export function loadModels() {
  if (loading) return loading; // a load already in progress
  loading = (async () => {
    for (const model of Object.values(current || {})) { try { model.close(); } catch { /* already gone */ } }
    current = null;
    const files = await FilesetResolver.forVisionTasks(MODELS.wasmPath);
    const base = path => ({ modelAssetPath: path, delegate: MODELS.delegate });
    const hand = await HandLandmarker.createFromOptions(files, {
      baseOptions: base(MODELS.hand.path),
      runningMode: 'VIDEO',
      numHands: MODELS.hand.numHands,
      minHandDetectionConfidence: MODELS.hand.minDetectionConfidence,
      minTrackingConfidence: MODELS.hand.minTrackingConfidence,
    });
    const face = await FaceDetector.createFromOptions(files, {
      baseOptions: base(MODELS.face.path),
      runningMode: 'VIDEO',
      minDetectionConfidence: MODELS.face.minDetectionConfidence,
    });
    const segmenter = await ImageSegmenter.createFromOptions(files, {
      baseOptions: base(MODELS.person.path),
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
    // Guitar mode: one extra hand model per square tile (see tiles.js).
    const tileHands = [];
    for (const _ of TILES) {
      tileHands.push(await HandLandmarker.createFromOptions(files, {
        baseOptions: base(MODELS.hand.path),
        runningMode: 'VIDEO',
        numHands: MODELS.hand.numHands,
        minHandDetectionConfidence: GUITAR.detection.detect,
        minHandPresenceConfidence: GUITAR.detection.presence,
        minTrackingConfidence: GUITAR.detection.tracking,
      }));
    }
    // Guitar mode: two more that each follow one hand in a zoomed-in crop, and one
    // (single-image mode, so it never assumes continuity) that sweeps for lost hands.
    const guitarOptions = (runningMode, numHands) => ({
      baseOptions: base(MODELS.hand.path),
      runningMode,
      numHands,
      minHandDetectionConfidence: GUITAR.detection.detect,
      minHandPresenceConfidence: GUITAR.detection.presence,
      minTrackingConfidence: GUITAR.detection.tracking,
    });
    const zoomHands = [
      await HandLandmarker.createFromOptions(files, guitarOptions('VIDEO', 1)),
      await HandLandmarker.createFromOptions(files, guitarOptions('VIDEO', 1)),
    ];
    const scanHand = await HandLandmarker.createFromOptions(files, guitarOptions('IMAGE', 2));
    current = { hand, face, segmenter, tileHands, zoomHands, scanHand };
    return current;
  })().finally(() => { loading = null; });
  return loading;
}

// Finds hands tile by tile and returns one result in whole-frame coordinates.
const tileCanvases = TILES.map(tile => {
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
  if (canvas) canvas.width = canvas.height = tile.size;
  return canvas;
});
export function detectHandsTiled(models, source, time) {
  const results = TILES.map((tile, i) => {
    const canvas = tileCanvases[i];
    canvas.getContext('2d').drawImage(source, tile.x, tile.y, tile.size, tile.size, 0, 0, tile.size, tile.size);
    return models.tileHands[i].detectForVideo(canvas, time);
  });
  return mergeTiles(results, TILES, source.width, source.height);
}

// Zoomed-in, brightened crops. Small hands in dim or coloured light are found
// here when the tiles miss them. `gain` is how much to brighten (see lowLightGain).
const SCAN = scanGrid(STAGE.width, STAGE.height, GUITAR.recover.cropPx, GUITAR.recover.scanStepPx);
const cropCanvas = typeof document === 'undefined' ? null : document.createElement('canvas');
if (cropCanvas) cropCanvas.width = cropCanvas.height = GUITAR.recover.cropPx;
function drawCrop(source, tile, gain) {
  const ctx = cropCanvas.getContext('2d');
  ctx.filter = `grayscale(1) contrast(1.3) brightness(${gain.toFixed(2)})`;
  ctx.drawImage(source, tile.x, tile.y, tile.size, tile.size, 0, 0, tile.size, tile.size);
}

// Follows one hand: `which` is 0 or 1, one model per hand so each keeps its own continuity.
export function detectHandZoom(models, which, source, x, y, time, gain) {
  const tile = cropAround(x, y, GUITAR.recover.cropPx, source.width, source.height);
  drawCrop(source, tile, gain);
  return mergeTiles([models.zoomHands[which].detectForVideo(cropCanvas, time)], [tile], source.width, source.height);
}

// Sweeps for hands whose position is unknown: one crop per call, cycling over
// the frame, starting nearest to `focus` (where the hand was last seen) if given.
let scanIndex = 0;
export function restartScan() { scanIndex = 0; }
export function scanForHands(models, source, gain, focus = null) {
  const tile = scanOrder(SCAN, focus)[scanIndex++ % SCAN.length];
  drawCrop(source, tile, gain);
  return mergeTiles([models.scanHand.detect(cropCanvas)], [tile], source.width, source.height);
}
