// Pure audio analysis: level, pitch, note names and attack detection.
// No Web Audio or DOM here, so it is unit tested with synthetic signals.
import { AUDIO } from './config.js';

export function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

// Fundamental frequency in Hz using the YIN method, or null when there is no
// clear pitch. `samples` should hold at least two periods of the lowest note.
export function detectPitch(samples, sampleRate, options = AUDIO) {
  return pitchDetails(samples, sampleRate, options).hz;
}

// The same analysis with its working shown, for troubleshooting:
//   hz       the pitch, or null when no single pitch is clear enough
//   bestHz   the most likely pitch even when it was rejected
//   clarity  0..1, how strongly the sound repeats at bestHz. A single clean
//            note is near 1; chords, noise and heavy distortion are much lower.
export function pitchDetails(samples, sampleRate, options = AUDIO) {
  const none = { hz: null, bestHz: null, clarity: 0 };
  const tauMin = Math.max(2, Math.floor(sampleRate / options.maxHz));
  const tauMax = Math.min(Math.floor(sampleRate / options.minHz), samples.length >> 1);
  const window = samples.length - tauMax;
  if (tauMax <= tauMin || window < tauMax) return none;

  // Cumulative mean normalised difference: near 0 where the signal repeats.
  const normalised = new Float32Array(tauMax + 1);
  normalised[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    let difference = 0;
    for (let i = 0; i < window; i++) {
      const delta = samples[i] - samples[i + tau];
      difference += delta * delta;
    }
    running += difference;
    normalised[tau] = running > 0 ? difference * tau / running : 1;
  }

  let best = tauMin;
  for (let t = tauMin; t <= tauMax; t++) if (normalised[t] < normalised[best]) best = t;
  const details = { hz: null, bestHz: running > 0 ? sampleRate / best : null, clarity: running > 0 ? Math.max(0, 1 - normalised[best]) : 0 };

  let tau = tauMin;
  while (tau <= tauMax && normalised[tau] >= options.yinThreshold) tau++;
  if (tau > tauMax) return details;
  while (tau + 1 <= tauMax && normalised[tau + 1] < normalised[tau]) tau++;

  // Power chord check. A root and its fifth played together repeat fully only
  // at three times the fifth's period, and the fifth alone repeats sooner, so
  // the first dip found can be the fifth (G5 read as D). If the dip at three
  // times this period is clearly deeper, that longer period is the real one.
  // A single note repeats equally well at both, so it is left alone.
  if (options.fifthMargin > 0) {
    let triple = -1;
    for (let t = Math.floor(tau * 2.9); t <= Math.min(tauMax, Math.ceil(tau * 3.1)); t++) {
      if (triple < 0 || normalised[t] < normalised[triple]) triple = t;
    }
    if (triple > 0 && normalised[triple] < normalised[tau] - options.fifthMargin) tau = triple;
  }

  // Parabolic interpolation between neighbouring lags for sub-sample accuracy.
  let refined = tau;
  if (tau > 1 && tau < tauMax) {
    const a = normalised[tau - 1], b = normalised[tau], c = normalised[tau + 1];
    const denominator = a - 2 * b + c;
    if (denominator > 0) refined = tau + (a - c) / (2 * denominator);
  }
  details.hz = sampleRate / refined;
  return details;
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// 440 -> { name: 'A4', cents: 0 }. Cents is how far the pitch is from that note.
export function noteName(hz) {
  if (!(hz > 0)) return null;
  const midi = 69 + 12 * Math.log2(hz / 440);
  const nearest = Math.round(midi);
  return { name: NAMES[((nearest % 12) + 12) % 12] + (Math.floor(nearest / 12) - 1), cents: Math.round((midi - nearest) * 100) };
}

// What a detected pitch should be called. A power chord (root plus fifth)
// repeats at half its root's frequency, which is below any guitar string, so
// a pitch that low is reported as that power chord: 55 Hz -> "A5".
export function soundName(hz, options = AUDIO) {
  if (!(hz > 0)) return null;
  if (hz >= options.lowestNoteHz) return { ...noteName(hz), chord: false };
  const root = noteName(hz * 2);
  return { name: root.name.replace(/-?\d+$/, '') + '5', cents: root.cents, chord: true };
}

// Decides whether a moment is loud enough to be worth reading or counting.
// It follows the loudest recent playing (fading slowly) and passes only sound
// above a fraction of that, so the quiet tail of a chord, hum and handling
// noise between hits are ignored however loud or soft the input is set.
export class LevelGate {
  constructor(fraction, floor, decay = 0.999) {
    Object.assign(this, { fraction, floor, decay });
    this.peak = 0;
  }

  // Returns true when `level` counts as playing. `threshold` is the level it had to reach.
  update(level) {
    this.peak = Math.max(level, this.peak * this.decay);
    this.threshold = Math.max(this.floor, this.peak * this.fraction);
    return level >= this.threshold;
  }
}

// Steadies a flickering reading for display: a new name is only taken once it
// has been read `needed` times with no different name in between. Brief
// misreads never reach the screen. Silence between readings does not reset
// the count, so short, choppy notes still register.
export class StableName {
  constructor(needed = 2) {
    this.needed = needed;
    this.name = null;
    this.candidate = null;
    this.count = 0;
  }

  update(name) {
    if (!name) return this.name;
    if (name === this.candidate) this.count++;
    else { this.candidate = name; this.count = 1; }
    if (this.count >= this.needed) this.name = name;
    return this.name;
  }

  clear() { this.name = this.candidate = null; this.count = 0; }
}

// How much new energy appeared between two magnitude spectra, 0..1.
// Near 0 while a sound sustains; high when a new note or chord is struck.
export function spectralFlux(previous, current) {
  let rise = 0, total = 0;
  for (let i = 0; i < current.length; i++) {
    if (current[i] > previous[i]) rise += current[i] - previous[i];
    total += current[i];
  }
  return total > 0 ? rise / total : 0;
}

// Reports an attack when the level jumps well above its recent average, or
// when the tone changes abruptly. A level jump must also be rising, so a note
// that keeps ringing is not counted again.
export class OnsetDetector {
  constructor(options = AUDIO.onset) {
    this.options = options;
    this.average = 0;
    this.previous = 0;
    this.averageFlux = 0;
    this.last = -Infinity;
  }

  // flux: spectralFlux since the previous reading, when available.
  // floor: the quietest level that can count as a hit right now (see LevelGate).
  update(level, time, flux = null, floor = this.options.floor) {
    const o = this.options;
    const louder = level > this.average * o.ratio && level > this.previous * o.rise;
    const changed = flux !== null && flux >= o.flux && flux > this.averageFlux * o.fluxRatio;
    if (flux !== null) this.averageFlux += (flux - this.averageFlux) * o.smoothing;
    const onset = level > floor && (louder || changed) && time - this.last >= o.minGapMs;
    if (onset) this.last = time;
    this.average += (level - this.average) * o.smoothing;
    this.previous = level;
    return onset;
  }
}
