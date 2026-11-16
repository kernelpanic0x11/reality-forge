// Pure guitar-mode logic: how each hand is moving. No DOM, unit tested.
import { GUITAR } from './config.js';
import { FINGERTIPS } from './depth.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Counts events and reports a per-minute rate over a recent window.
export class RateCounter {
  constructor(windowMs = GUITAR.rateWindowMs) {
    this.windowMs = windowMs;
    this.count = 0;
    this.times = [];
  }

  add(time) {
    this.count++;
    this.times.push(time);
  }

  perMinute(time) {
    while (this.times.length && time - this.times[0] > this.windowMs) this.times.shift();
    return Math.round(this.times.length * 60000 / this.windowMs);
  }
}

// Counts pick strokes as reversals of direction, whichever way the pick moves.
// Each down stroke and each up stroke counts once.
export class StrokeCounter {
  constructor(options = GUITAR) {
    this.options = options;
    this.rate = new RateCounter(options.rateWindowMs);
    this.restart();
  }

  restart() { this.anchor = null; this.far = null; this.farDistance = 0; }
  get count() { return this.rate.count; }

  // point: the pick position in pixels. Returns true when a stroke completes.
  update(point, pxPerMeter, time) {
    const minimum = this.options.minStrokeM * pxPerMeter;
    if (!this.anchor) { this.anchor = this.far = point; this.farDistance = 0; return false; }
    const fromAnchor = distance(point, this.anchor);
    if (fromAnchor > this.farDistance) { this.far = point; this.farDistance = fromAnchor; return false; }
    if (this.farDistance < minimum || distance(point, this.far) < minimum) return false;
    // The pick travelled far enough and has now come back: that was one stroke.
    this.anchor = this.far;
    this.far = point;
    this.farDistance = distance(point, this.anchor);
    this.rate.add(time);
    return true;
  }
}

// Counts fretting-hand position shifts: moving well away, then settling.
export class ShiftCounter {
  constructor(options = GUITAR) {
    this.options = options;
    this.count = 0;
    this.home = null;
  }

  restart() { this.home = null; }

  update(point, pxPerMeter, speedCmPerS) {
    if (!this.home) { this.home = point; return false; }
    if (distance(point, this.home) < this.options.shiftM * pxPerMeter || speedCmPerS > this.options.settleCmPerS) return false;
    this.home = point;
    this.count++;
    return true;
  }
}

// Speed, distance travelled, finger movement and fingertip trails for one hand.
export class HandMotion {
  constructor(options = GUITAR) {
    this.options = options;
    this.travelledM = 0;
    this.speed = 0;        // palm speed, cm per second
    this.fingerSpeed = 0;  // fingertips relative to the palm, cm per second
    this.trails = FINGERTIPS.map(() => []);
    this.last = null;
  }

  update(points, pxPerMeter, time) {
    const o = this.options;
    const palm = { x: (points[0].x + points[5].x + points[17].x) / 3, y: (points[0].y + points[5].y + points[17].y) / 3 };
    // Fingertips measured from the palm, so moving the whole hand is not finger movement.
    const tips = FINGERTIPS.map(i => ({ x: points[i].x - palm.x, y: points[i].y - palm.y }));
    const fresh = !this.last || time - this.last.time > o.gapMs || time <= this.last.time;
    if (fresh) {
      this.speed = this.fingerSpeed = 0;
      this.trails = FINGERTIPS.map(() => []);
    } else {
      const seconds = (time - this.last.time) / 1000;
      const movedM = distance(palm, this.last.palm) / pxPerMeter;
      const fingersM = tips.reduce((sum, tip, i) => sum + distance(tip, this.last.tips[i]), 0) / tips.length / pxPerMeter;
      this.travelledM += movedM;
      this.speed += (movedM * 100 / seconds - this.speed) * o.speedSmoothing;
      this.fingerSpeed += (fingersM * 100 / seconds - this.fingerSpeed) * o.speedSmoothing;
    }
    FINGERTIPS.forEach((joint, i) => {
      const trail = this.trails[i];
      trail.push({ x: points[joint].x, y: points[joint].y, time });
      while (trail.length && time - trail[0].time > o.trailMs) trail.shift();
    });
    // Palm velocity in pixels per millisecond, used to predict where a fast-moving hand went.
    const velocity = fresh ? { x: 0, y: 0 } : { x: (palm.x - this.last.palm.x) / (time - this.last.time), y: (palm.y - this.last.palm.y) / (time - this.last.time) };
    this.last = { time, palm, tips, velocity };
    return { palm, fresh };
  }
}

// Assigns the two hands their guitar roles and measures each one.
// A right-handed player frets with the left hand; `lefty` swaps the roles.
//
// Left/Right labels are unreliable on a hand wrapped around a guitar neck.
// When both hands are in view and both labels are confident, the labels
// decide, and the session keeps learning where each role usually is. When a
// label is unsure, or only one hand is visible, the role comes from which
// usual place the hand is nearer. Because confident frames keep correcting
// the learned places, an early mistake does not stick.
export class GuitarSession {
  constructor(options = GUITAR) {
    this.options = options;
    this.reset();
  }

  reset() {
    this.fret = { motion: new HandMotion(this.options), shifts: new ShiftCounter(this.options) };
    this.pick = { motion: new HandMotion(this.options), strokes: new StrokeCounter(this.options) };
    this.notes = new RateCounter(this.options.rateWindowMs);
    this.homes = { fret: null, pick: null }; // each role's usual palm position
    this.learned = 0;                        // frames seen with both hands
  }

  get rolesLearned() { return this.learned >= this.options.learnFrames; }

  // Decides each hand's role for this frame.
  assignRoles(hands, lefty) {
    const palm = hand => ({ x: (hand.points[0].x + hand.points[5].x + hand.points[17].x) / 3, y: (hand.points[0].y + hand.points[5].y + hand.points[17].y) / 3 });
    const other = role => (role === 'fret' ? 'pick' : 'fret');
    const { homes } = this;
    const palms = hands.map(palm);
    let roles = hands.map(hand => this.roleOf(hand.side, lefty));
    // Sure of both hands: each label agrees with the tracker and is confident.
    const sure = hand => (hand.label ?? hand.side) === hand.side && (hand.labelScore ?? 1) >= this.options.confidentLabel;
    const confident = hands.length === 2 && roles[0] !== roles[1] && hands.every(sure);
    if (!confident && this.rolesLearned) {
      if (hands.length === 2) {
        // Whichever pairing keeps both hands nearer their usual places.
        const cost = (first) => distance(palms[0], homes[first]) + distance(palms[1], homes[other(first)]);
        const first = cost('fret') <= cost('pick') ? 'fret' : 'pick';
        roles = [first, other(first)];
      } else if (hands.length === 1) {
        roles = [distance(palms[0], homes.fret) <= distance(palms[0], homes.pick) ? 'fret' : 'pick'];
      }
    }
    if (confident) {
      this.learned++;
      roles.forEach((role, i) => {
        if (!homes[role]) homes[role] = { ...palms[i] };
        else {
          homes[role].x += (palms[i].x - homes[role].x) * this.options.homeSmoothing;
          homes[role].y += (palms[i].y - homes[role].y) * this.options.homeSmoothing;
        }
      });
    }
    return roles;
  }

  roleOf(side, lefty = false) {
    return (side === 'Left') !== lefty ? 'fret' : 'pick';
  }

  // hands: tracker boxes with { side, points, pxPerMeter }. Tags each with its
  // role and returns what happened this frame.
  update(hands, time, { lefty = false } = {}) {
    const events = { stroke: false, shift: false };
    hands = hands.filter(hand => hand.points).slice(0, 2);
    const roles = this.assignRoles(hands, lefty);
    for (const [i, hand] of hands.entries()) {
      const role = hand.role = roles[i];
      const scale = hand.pxPerMeter || this.options.fallbackPxPerMeter;
      const { motion } = this[role];
      const { palm, fresh } = motion.update(hand.points, scale, time);
      if (role === 'pick') {
        // The pick sits between the thumb tip (4) and index tip (8).
        const pick = { x: (hand.points[4].x + hand.points[8].x) / 2, y: (hand.points[4].y + hand.points[8].y) / 2 };
        if (fresh) this.pick.strokes.restart();
        events.stroke = this.pick.strokes.update(pick, scale, time) || events.stroke;
      } else {
        if (fresh) this.fret.shifts.restart();
        events.shift = this.fret.shifts.update(palm, scale, motion.speed) || events.shift;
      }
    }
    return events;
  }

  // Where to look closer for hands the first pass missed. `seen` holds the
  // palm positions found so far this frame. For each role with no detection
  // near it, returns where it is expected to be: its last known place, moved
  // on a little by how fast it was going (a slide along the neck is quick).
  // `missingFor` is how long ago it was last actually seen.
  searchTargets(time, seen = []) {
    const { giveUpMs, nearPx, predictMs } = this.options.recover;
    this.separateRoles();
    const targets = [];
    for (const role of ['fret', 'pick']) {
      const last = this[role].motion.last;
      if (!last || time - last.time >= giveUpMs) continue;
      const ahead = Math.min(time - last.time, predictMs);
      const expected = { x: last.palm.x + last.velocity.x * ahead, y: last.palm.y + last.velocity.y * ahead };
      if (seen.some(palm => distance(palm, last.palm) < nearPx || distance(palm, expected) < nearPx)) continue;
      targets.push({ role, ...expected, missingFor: time - last.time });
    }
    return targets;
  }

  // Two roles can never be the same hand. If both were last seen in the same
  // place, one of them was a mislabelled sighting of the other hand: forget the
  // staler one, so it is searched for afresh instead of shadowing its partner.
  separateRoles() {
    const fret = this.fret.motion.last, pick = this.pick.motion.last;
    if (!fret || !pick || distance(fret.palm, pick.palm) >= this.options.recover.nearPx) return null;
    const stale = fret.time <= pick.time ? 'fret' : 'pick';
    this[stale].motion.last = null;
    return stale;
  }

  // Roles whose whereabouts are unknown: never seen, or not seen for too long.
  unknownRoles(time) {
    return ['fret', 'pick'].filter(role => {
      const last = this[role].motion.last;
      return !last || time - last.time >= this.options.recover.giveUpMs;
    });
  }

  noteOnset(time) { this.notes.add(time); }

  summary(time) {
    const one = value => Math.round(value * 10) / 10;
    return {
      pick: { strokes: this.pick.strokes.count, strokesPerMin: this.pick.strokes.rate.perMinute(time), cmPerS: one(this.pick.motion.speed), travelledM: one(this.pick.motion.travelledM) },
      fret: { shifts: this.fret.shifts.count, fingerCmPerS: one(this.fret.motion.fingerSpeed), cmPerS: one(this.fret.motion.speed), travelledM: one(this.fret.motion.travelledM) },
      notes: { count: this.notes.count, perMin: this.notes.perMinute(time) },
    };
  }
}
