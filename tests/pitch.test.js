import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rms, detectPitch, pitchDetails, noteName, soundName, spectralFlux, OnsetDetector, StableName, LevelGate } from '../src/pitch.js';

const RATE = 24000; // the app analyses at half the usual 48 kHz
// A plucked-string-like tone: a fundamental plus weaker harmonics.
function tone(hz, amplitude = 0.3, length = 2048) {
  return Float32Array.from({ length }, (_, i) => {
    const phase = 2 * Math.PI * hz * i / RATE;
    return amplitude * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase)) / 1.75;
  });
}

test('level of a sine is its amplitude over root two', () => {
  const sine = Float32Array.from({ length: 2400 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 100 * i / RATE));
  assert.ok(Math.abs(rms(sine) - 0.5 / Math.SQRT2) < 0.001);
  assert.equal(rms(new Float32Array(100)), 0);
});

test('every open guitar string is recognised', () => {
  const strings = { E2: 82.41, A2: 110, D3: 146.83, G3: 196, B3: 246.94, E4: 329.63 };
  for (const [name, hz] of Object.entries(strings)) {
    const detected = detectPitch(tone(hz), RATE);
    assert.ok(Math.abs(detected - hz) < hz * 0.01, `${name}: ${detected} is not ${hz}`);
    assert.equal(noteName(detected).name, name);
  }
});

test('a high fretted note is recognised', () => {
  assert.equal(noteName(detectPitch(tone(880), RATE)).name, 'A5');
});

test('silence and noise report no pitch', () => {
  assert.equal(detectPitch(new Float32Array(2048), RATE), null);
  let seed = 1;
  const noise = Float32Array.from({ length: 2048 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5));
  assert.equal(detectPitch(noise, RATE), null);
});

test('note names include how far out of tune the pitch is', () => {
  assert.deepEqual(noteName(440), { name: 'A4', cents: 0 });
  assert.equal(noteName(445).name, 'A4');
  assert.ok(noteName(445).cents > 15 && noteName(445).cents < 25);
  assert.equal(noteName(0), null);
});

test('an attack is a jump in level, counted once, and quiet hiss is ignored', () => {
  const detector = new OnsetDetector();
  let onsets = 0, t = 0;
  const feed = (level, frames) => { for (let i = 0; i < frames; i++, t += 33) if (detector.update(level, t)) onsets++; };
  feed(0.001, 30);          // hiss
  assert.equal(onsets, 0);
  feed(0.2, 1); feed(0.12, 20); // pluck, then the note rings
  assert.equal(onsets, 1);
  feed(0.03, 20);           // decays
  feed(0.25, 1); feed(0.1, 10); // second pluck
  assert.equal(onsets, 2);
});

test('clarity separates a single note from a chord, and still offers a best guess', () => {
  const single = pitchDetails(tone(110), RATE);
  assert.ok(single.clarity > 0.9, `single note clarity ${single.clarity}`);
  assert.equal(noteName(single.hz).name, 'A2');

  // An E minor chord: three notes at once have no single repeating period.
  const chord = tone(82.41).map((v, i) => (v + tone(123.47)[i] + tone(196)[i]) / 3);
  const details = pitchDetails(chord, RATE);
  assert.ok(details.clarity < single.clarity - 0.1, `chord clarity ${details.clarity}`);
  assert.ok(details.bestHz > 0, 'a best guess is still reported');
  assert.equal(pitchDetails(new Float32Array(2048), RATE).clarity, 0);
});

// Root, fifth and octave together, as in a rock power chord.
const powerChord = root => tone(root).map((v, i) => (v + tone(root * 1.5)[i] + tone(root * 2)[i]) / 3);

test('power chords are named by their root', () => {
  // The chords of a descending riff: A5, G5, F#5, F5, E5.
  const roots = { A5: 110, G5: 98, 'F#5': 92.5, F5: 87.31, E5: 82.41 };
  for (const [name, root] of Object.entries(roots)) {
    const named = soundName(detectPitch(powerChord(root), RATE));
    assert.equal(named?.name, name, `${name} read as ${named?.name}`);
    assert.equal(named.chord, true);
  }
});

test('single notes keep their own names and are not called chords', () => {
  assert.deepEqual(soundName(110), { name: 'A2', cents: 0, chord: false });
  assert.equal(soundName(detectPitch(tone(82.41), RATE)).name, 'E2');
  assert.equal(soundName(73.42).chord, false, 'drop D low string is still a note');
  assert.equal(soundName(null), null);
});

test('spectral flux is near zero for a sustained sound and high for a new one', () => {
  const chordA = Float32Array.from({ length: 64 }, (_, i) => (i % 8 === 0 ? 1 : 0.02));
  const chordB = Float32Array.from({ length: 64 }, (_, i) => (i % 8 === 4 ? 1 : 0.02));
  assert.ok(spectralFlux(chordA, chordA) < 0.01);
  assert.ok(spectralFlux(chordA, chordB) > 0.8);
  assert.ok(spectralFlux(new Float32Array(64), chordA) > 0.99, 'attack out of silence');
  assert.equal(spectralFlux(chordA, new Float32Array(64)), 0, 'a sound stopping is not an attack');
});

test('a new chord struck while another still rings is counted, though the loudness never drops', () => {
  const detector = new OnsetDetector();
  let onsets = 0, t = 0;
  const feed = (level, flux, frames = 1) => { for (let i = 0; i < frames; i++, t += 33) if (detector.update(level, t, flux)) onsets++; };
  feed(0.001, 0.05, 20);
  feed(0.15, 0.95); feed(0.15, 0.08, 20);  // first chord, then it sustains at full level
  assert.equal(onsets, 1);
  feed(0.15, 0.7); feed(0.15, 0.08, 20);   // second chord at the same loudness
  assert.equal(onsets, 2);
  feed(0.15, 0.2, 20);                     // distortion wobble alone is not an attack
  assert.equal(onsets, 2);
});

test('the displayed name ignores one-off misreads and changes on a real chord change', () => {
  const shown = new StableName(2);
  assert.equal(shown.update('A5'), null, 'one reading is not enough');
  assert.equal(shown.update('A5'), 'A5');
  assert.equal(shown.update('C6'), 'A5', 'a single stray reading is ignored');
  assert.equal(shown.update('A5'), 'A5');
  assert.equal(shown.update(null), 'A5', 'a gap keeps the last name');
  assert.equal(shown.update('G5'), 'A5');
  assert.equal(shown.update('G5'), 'G5', 'two matching readings switch it');
  shown.clear();
  assert.equal(shown.update(null), null);
  // Short notes with silence between them still register.
  shown.update('E5'); shown.update(null); shown.update(null);
  assert.equal(shown.update('E5'), 'E5');
});

test('the level gate follows how loud the playing is and ignores the quiet tail', () => {
  const gate = new LevelGate(0.3, 0.004);
  assert.equal(gate.update(0.002), false, 'below the fixed floor');
  assert.equal(gate.update(0.01), true, 'quiet playing counts when nothing louder has been heard');
  assert.equal(gate.update(0.15), true);
  assert.equal(gate.update(0.02), false, 'now the same quiet level is just the tail of a loud chord');
  assert.equal(gate.update(0.06), true);
  // After a long quiet spell the gate relaxes again.
  for (let i = 0; i < 4000; i++) gate.update(0.001);
  assert.equal(gate.update(0.01), true);
});

test('a hit must be louder than the floor it is given', () => {
  const detector = new OnsetDetector();
  assert.equal(detector.update(0.02, 0, 0.9, 0.05), false, 'too quiet for the current floor');
  assert.equal(detector.update(0.08, 100, 0.9, 0.05), true);
});
