// Pure interaction logic: no DOM, no MediaPipe imports. Shared by the app
// and the Node tests.
import { HAND, FACE, DEPTH } from './config.js';
import { handPxPerMeter, palmBasis } from './depth.js';

const opposite = side => (side === 'Left' ? 'Right' : 'Left');

// Tracks each hand's pinch state and which hand owns the object.
//
// A hand is followed by where it is, not by MediaPipe's Left/Right label,
// because that label flickers from frame to frame. The label only votes on
// which side a tracked hand is called, and the holding hand never changes side.
export class HandInteraction {
  constructor(width, height, options = HAND) {
    this.width = width;
    this.height = height;
    this.options = options;
    this.reset();
  }

  reset() {
    this.tracks = [];
    this.ownerTrack = null;
    this.state = 'idle';
    this.orb = null;
    this.orbScale = null; // stage pixels per metre at the object's depth; kept after release
    this.orbBasis = null; // palm orientation of the holding hand
  }

  get owner() { return this.ownerTrack?.side ?? null; }
  get hands() { return new Map(this.tracks.map(track => [track.side, track])); }

  // Reads the detections, drops doubles of the same physical hand.
  detect(result, mirrored) {
    const o = this.options;
    const detections = result.landmarks.map((points, index) => {
      const category = result.handedness?.[index]?.[0];
      if (!['Left', 'Right'].includes(category?.categoryName)) return null;
      const xs = points.map(q => q.x * this.width), ys = points.map(q => q.y * this.height);
      return {
        index, points, xs, ys, world: result.worldLandmarks?.[index],
        label: mirrored ? opposite(category.categoryName) : category.categoryName,
        score: category.score || 0,
        // Palm centre and a size that stays usable when the palm is edge-on.
        cx: (xs[0] + xs[5] + xs[17]) / 3, cy: (ys[0] + ys[5] + ys[17]) / 3,
        size: Math.max(Math.hypot(xs[5] - xs[17], ys[5] - ys[17]), Math.hypot(xs[0] - xs[9], ys[0] - ys[9]), 1),
      };
    }).filter(Boolean);
    const better = (a, b) => a.score > b.score || (a.score === b.score && a.index < b.index);
    return detections.filter(d => !detections.some(e => e !== d && better(e, d) &&
      Math.hypot(e.cx - d.cx, e.cy - d.cy) < o.duplicateFactor * Math.max(e.size, d.size)));
  }

  // Pairs detections with the hands already being followed; returns Map(detection -> track).
  associate(detections, time) {
    const o = this.options;
    const matches = new Map(), taken = new Set();
    const pairs = [];
    for (const track of this.tracks) {
      for (const detection of detections) {
        const distance = Math.hypot(detection.cx - track.cx, detection.cy - track.cy);
        if (distance < Math.max(o.matchMinPx, o.matchSizeFactor * track.size)) pairs.push({ track, detection, distance });
      }
    }
    pairs.sort((a, b) => a.distance - b.distance);
    for (const { track, detection } of pairs) {
      if (taken.has(track) || matches.has(detection)) continue;
      matches.set(detection, track);
      taken.add(track);
    }
    for (const detection of detections) {
      if (matches.has(detection)) continue;
      // A hand that jumped too far to match by position: fall back to its label.
      let track = this.tracks.find(t => !taken.has(t) && t.side === detection.label);
      if (!track) {
        if (this.tracks.length >= 2) {
          const stale = this.tracks.find(t => !taken.has(t) && t !== this.ownerTrack);
          if (!stale) continue;
          this.tracks.splice(this.tracks.indexOf(stale), 1);
        }
        const side = this.tracks.some(t => t.side === detection.label) ? opposite(detection.label) : detection.label;
        track = {
          side, vote: (detection.label === 'Right' ? 1 : -1) * o.sideVoteFlip,
          pinched: false, candidate: false, since: time, last: time, state: 'open',
        };
        this.tracks.push(track);
      }
      matches.set(detection, track);
      taken.add(track);
    }
    return matches;
  }

  // Lets confident labels vote on a hand's side. A side changes only after
  // sustained disagreement, never for the holding hand, and never to a side
  // the other hand is using (unless both want to swap).
  voteSide(track, detection) {
    const o = this.options;
    const weight = detection.score >= o.minHandednessScore ? detection.score : 0;
    track.vote = Math.max(-o.sideVoteLimit, Math.min(o.sideVoteLimit, track.vote + (detection.label === 'Right' ? weight : -weight)));
    const wanted = track.vote >= o.sideVoteFlip ? 'Right' : track.vote <= -o.sideVoteFlip ? 'Left' : track.side;
    if (wanted === track.side || track === this.ownerTrack) return;
    const other = this.tracks.find(t => t !== track && t.side === wanted);
    if (!other) track.side = wanted;
    else if (other !== this.ownerTrack && Math.sign(other.vote) === Math.sign(track.side === 'Right' ? 1 : -1) && Math.abs(other.vote) >= o.sideVoteFlip) {
      other.side = track.side;
      track.side = wanted;
    }
  }

  update(result, time, mirrored = false) {
    const o = this.options;
    const detections = this.detect(result, mirrored);
    const matches = this.associate(detections, time);
    const visible = [];

    for (const detection of detections) {
      const hand = matches.get(detection);
      if (!hand) continue;
      const { points, world, xs, ys } = detection;
      this.voteSide(hand, detection);
      if (time - hand.last > o.reappearMs) { hand.candidate = hand.pinched; hand.since = time; }
      hand.last = time;
      hand.cx = detection.cx;
      hand.cy = detection.cy;
      hand.size = detection.size;

      const minX = Math.min(...xs), minY = Math.min(...ys);
      hand.box = {
        x: minX - o.boxPadding,
        y: minY - o.boxPadding,
        w: Math.max(...xs) - minX + o.boxPadding * 2,
        h: Math.max(...ys) - minY + o.boxPadding * 2,
      };

      // Landmarks: 4 thumb tip, 8 index tip, 5 index knuckle, 17 pinky knuckle.
      const palmWidth = Math.hypot(xs[5] - xs[17], ys[5] - ys[17]);
      const ratio = Math.hypot(xs[4] - xs[8], ys[4] - ys[8]) / Math.max(1, palmWidth);
      // z uses the same scale as x in MediaPipe; smaller is nearer the camera.
      const joints = points.map((q, i) => ({ x: xs[i], y: ys[i], z: (q.z || 0) * this.width }));
      const scale = handPxPerMeter(joints, world);
      if (scale) hand.pxPerMeter = hand.pxPerMeter ? hand.pxPerMeter + (scale - hand.pxPerMeter) * DEPTH.scaleSmoothing : scale;

      const closed = ratio < (hand.pinched ? o.pinchOpenRatio : o.pinchCloseRatio);
      if (closed !== hand.candidate) { hand.candidate = closed; hand.since = time; }

      if (hand.candidate !== hand.pinched && time - hand.since >= o.confirmMs) {
        hand.pinched = hand.candidate;
        hand.state = hand.pinched ? 'grabbed' : 'released';
        if (hand.pinched && !this.ownerTrack) { this.ownerTrack = hand; this.state = 'grabbed'; }
        if (!hand.pinched && this.ownerTrack === hand) { this.ownerTrack = null; this.state = 'released'; }
      }

      if (this.ownerTrack === hand && hand.pinched && closed) {
        const target = { x: (xs[4] + xs[8]) / 2, y: (ys[4] + ys[8]) / 2 };
        if (!this.orb) this.orb = target;
        else {
          this.orb.x += (target.x - this.orb.x) * o.follow;
          this.orb.y += (target.y - this.orb.y) * o.follow;
        }
        if (hand.pxPerMeter) this.orbScale = hand.pxPerMeter;
        this.orbBasis = palmBasis(world) || this.orbBasis;
      }
      visible.push({
        ...hand.box, side: hand.side, state: hand.state, owner: this.ownerTrack === hand, points: joints,
        pxPerMeter: hand.pxPerMeter ?? null, pinchRatio: ratio, label: detection.label, labelScore: detection.score,
      });
    }

    // A missing owner never hands its object to the other hand automatically.
    if (this.ownerTrack && time - this.ownerTrack.last > o.lostMs) { this.ownerTrack = null; this.state = 'released'; }
    this.tracks = this.tracks.filter(track => time - track.last <= o.lostMs);
    return visible;
  }
}

// Shows a face box only after several consistent, confident detections,
// smooths it, and fades it over brief dropouts.
export class StableFace {
  constructor(options = FACE) {
    this.options = options;
    this.reset();
  }

  reset() {
    this.box = null;
    this.pending = null;
    this.since = 0;
    this.last = 0;
    this.count = 0;
  }

  update(detections, time) {
    const o = this.options;
    const candidates = detections.filter(d =>
      (d.categories?.[0]?.score || 0) >= o.minScore &&
      d.boundingBox.width > o.minSize && d.boundingBox.height > o.minSize);
    const reference = this.box || this.pending;
    const distance = (b, r) => Math.hypot(
      b.originX + b.width / 2 - r.x - r.w / 2,
      b.originY + b.height / 2 - r.y - r.h / 2);
    candidates.sort((a, b) => reference
      ? distance(a.boundingBox, reference) - distance(b.boundingBox, reference)
      : b.categories[0].score - a.categories[0].score);

    const d = candidates[0];
    if (d) {
      const b = d.boundingBox;
      const next = { x: b.originX, y: b.originY, w: b.width, h: b.height };
      const consistent = reference &&
        distance(b, reference) < Math.max(o.consistencyMinPx, reference.w * o.consistencyWidthFactor);
      if (!consistent || time - this.last > o.dropoutMs) {
        this.pending = next; this.since = time; this.count = 1; this.box = null;
      } else {
        this.pending = next; this.count++;
      }
      this.last = time;
      if (this.count >= o.confirmCount && time - this.since >= o.confirmMs) {
        if (!this.box) this.box = next;
        else for (const k of ['x', 'y', 'w', 'h']) this.box[k] += (next[k] - this.box[k]) * o.smoothing;
      }
    } else if (time - this.last > o.dropoutMs) {
      this.reset();
    }
    if (!this.box) return [];
    const opacity = Math.max(0, 1 - Math.max(0, time - this.last - o.fadeDelayMs) / o.fadeMs);
    return [{ ...this.box, opacity }];
  }
}
