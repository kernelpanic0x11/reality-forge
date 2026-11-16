// Runs the app's own audio analysis over a recorded clip, step by step as the
// live app would, so real playing can be checked without a browser. Pure.
import { AUDIO, GUITAR } from './config.js';
import { rms, pitchDetails, soundName, spectralFlux, OnsetDetector, StableName, LevelGate } from './pitch.js';

// Magnitude spectrum of a frame (length must be a power of two), Blackman windowed.
export function magnitudes(frame) {
  const n = frame.length, re = new Float32Array(n), im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[i] = frame[i] * (0.42 - 0.5 * Math.cos(2 * Math.PI * i / n) + 0.08 * Math.cos(4 * Math.PI * i / n));
  for (let i = 1, j = 0; i < n; i++) { // bit reversal
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = -2 * Math.PI / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const cos = Math.cos(angle * k), sin = Math.sin(angle * k), a = start + k, b = a + size / 2;
        const tr = re[b] * cos - im[b] * sin, ti = re[b] * sin + im[b] * cos;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
  const out = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) out[i] = Math.hypot(re[i], im[i]);
  return out;
}

const letterOf = name => name.replace(/-?\d+$/, '');

// samples: mono audio; sampleRate: its rate. stepMs: one "frame" of the app.
// Returns the hits heard, what each was named, and what the big display showed.
// `overrides` replaces individual settings, for trying values out: { audio, onset, stableReads }.
export function analyseClip(samples, sampleRate, stepMs = 33, overrides = {}) {
  const audio = { ...AUDIO, ...overrides.audio }, onsetOptions = { ...AUDIO.onset, ...overrides.onset };
  const step = Math.round(sampleRate * stepMs / 1000);
  const fluxBins = { first: Math.ceil(AUDIO.fluxMinHz / (sampleRate / AUDIO.fluxFftSize)), last: Math.floor(AUDIO.fluxMaxHz / (sampleRate / AUDIO.fluxFftSize)) };
  const onsets = new OnsetDetector(onsetOptions), shownName = new StableName(overrides.stableReads ?? GUITAR.show.stableReads);
  const pitchGate = new LevelGate(audio.pitchGate, audio.silenceRms), hitGate = new LevelGate(audio.hitGate, onsetOptions.floor);
  const half = new Float32Array(AUDIO.fftSize / 2);
  let previousSpectrum = null, latest = { name: null, clarity: 0 }, pending = null, shown = null, shownSince = 0;
  let sounding = 0, named = 0, peak = 0;
  const hits = [], letters = {}, display = [];

  for (let end = AUDIO.fftSize; end <= samples.length; end += step) {
    const t = end / sampleRate * 1000;
    const frame = samples.subarray(end - AUDIO.fftSize, end);
    const level = rms(frame);
    peak = Math.max(peak, level);

    const spectrum = magnitudes(samples.subarray(end - AUDIO.fluxFftSize, end)).subarray(fluxBins.first, fluxBins.last);
    const flux = previousSpectrum ? spectralFlux(previousSpectrum, spectrum) : 0;
    previousSpectrum = spectrum;

    hitGate.update(level);
    if (pitchGate.update(level)) {
      sounding++;
      // Halve the sample rate exactly as the app does before reading the pitch.
      for (let i = 0; i < half.length; i++) half[i] = (frame[i * 2] + frame[i * 2 + 1]) / 2;
      const details = pitchDetails(half, sampleRate / 2, audio);
      const name = details.hz ? soundName(details.hz).name : null;
      if (name) { named++; letters[letterOf(name)] = (letters[letterOf(name)] || 0) + 1; }
      latest = { name, clarity: details.clarity, bestGuess: soundName(details.bestHz)?.name ?? null };
      const now = shownName.update(name ? letterOf(name) : null);
      if (now !== shown) { if (shown) display.push({ from: shownSince, to: t, letter: shown }); shown = now; shownSince = t; }
    }

    if (onsets.update(level, t, flux, hitGate.threshold)) pending = { t, level, flux };
    if (pending && t - pending.t >= GUITAR.noteDelayMs) {
      hits.push({ t: Math.round(pending.t), name: latest.name, bestGuess: latest.bestGuess, clarity: Math.round(latest.clarity * 100) / 100, level: Math.round(pending.level * 1000) / 1000, flux: Math.round(pending.flux * 100) / 100 });
      pending = null;
    }
  }
  if (shown) display.push({ from: shownSince, to: samples.length / sampleRate * 1000, letter: shown });
  return { seconds: samples.length / sampleRate, peak, hits, letters, display, namedShare: sounding ? named / sounding : 0 };
}
