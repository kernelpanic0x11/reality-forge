// Splits a tall frame into overlapping square tiles for hand detection, and
// merges the per-tile results back into whole-frame coordinates.
//
// The hand model shrinks whatever it is given to a small square. A portrait
// frame loses so much detail that small or oddly lit hands vanish; square
// tiles keep hands large enough to find. Pure: no DOM, unit tested.

// Tiles as { x, y, size } in pixels, top to bottom, covering the whole frame.
export function squareTiles(width, height, overlap) {
  if (height <= width) return [{ x: 0, y: 0, size: height, wide: true }];
  const count = Math.max(1, Math.ceil((height - overlap) / (width - overlap)));
  if (count === 1) return [{ x: 0, y: Math.round((height - width) / 2), size: width }];
  return Array.from({ length: count }, (_, i) => ({ x: 0, y: Math.round(i * (height - width) / (count - 1)), size: width }));
}

// Overlapping crops that sweep the whole frame, for finding small hands.
export function scanGrid(width, height, size, step) {
  const positions = (length) => {
    const last = Math.max(0, length - size), count = Math.ceil(last / step) + 1;
    return Array.from({ length: count }, (_, i) => Math.round(count === 1 ? 0 : i * last / (count - 1)));
  };
  const tiles = [];
  for (const y of positions(height)) for (const x of positions(width)) tiles.push({ x, y, size });
  return tiles;
}

// The sweep order: crops nearest to `focus` first, so a hand that slid away
// from where it was last seen is found quickly. Without a focus, top to bottom.
export function scanOrder(grid, focus) {
  if (!focus) return grid;
  const away = tile => Math.hypot(tile.x + tile.size / 2 - focus.x, tile.y + tile.size / 2 - focus.y);
  return [...grid].sort((a, b) => away(a) - away(b));
}

// A crop of `size` centred on (x, y), kept inside the frame.
export function cropAround(x, y, size, width, height) {
  return {
    x: Math.round(Math.max(0, Math.min(width - size, x - size / 2))),
    y: Math.round(Math.max(0, Math.min(height - size, y - size / 2))),
    size,
  };
}

// How much to brighten a picture of the given mean brightness (0..1).
export function lowLightGain(brightness, { targetBrightness, minGain, maxGain }) {
  if (!(brightness > 0)) return maxGain;
  return Math.max(minGain, Math.min(maxGain, targetBrightness / brightness));
}

// results[i] is the hand model's output for tiles[i]. Returns one result in
// the same shape, with landmarks normalised to the whole frame. A hand seen
// by two tiles appears twice here; the tracker already merges such doubles.
export function mergeTiles(results, tiles, width, height) {
  const merged = { landmarks: [], worldLandmarks: [], handedness: [] };
  results.forEach((result, i) => {
    const tile = tiles[i];
    (result?.landmarks || []).forEach((points, hand) => {
      merged.landmarks.push(points.map(p => ({
        ...p,
        x: (tile.x + p.x * tile.size) / width,
        y: (tile.y + p.y * tile.size) / height,
        z: (p.z || 0) * tile.size / width, // z is in units of the image width
      })));
      merged.worldLandmarks.push(result.worldLandmarks?.[hand]);
      merged.handedness.push(result.handedness?.[hand]);
    });
  });
  return merged;
}
