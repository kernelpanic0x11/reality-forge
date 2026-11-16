import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeWav, decodeWav } from '../src/wav.js';
import { analyseClip, magnitudes } from '../src/clipanalysis.js';

test('a WAV file survives being written and read back', () => {
  const samples = Float32Array.from({ length: 4800 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / 48000));
  const { samples: back, sampleRate } = decodeWav(encodeWav(samples, 48000));
  assert.equal(sampleRate, 48000);
  assert.equal(back.length, samples.length);
  for (let i = 0; i < samples.length; i += 97) assert.ok(Math.abs(back[i] - samples[i]) < 1e-4);
  assert.throws(() => decodeWav(new ArrayBuffer(64)), /Not a WAV/);
});

test('the spectrum of a pure tone peaks at that tone', () => {
  const frame = Float32Array.from({ length: 1024 }, (_, i) => Math.sin(2 * Math.PI * 1500 * i / 48000));
  const spectrum = magnitudes(frame);
  const peak = spectrum.indexOf(Math.max(...spectrum));
  assert.equal(peak, Math.round(1500 / (48000 / 1024)));
});

// Power chords struck one after another, each ringing into the next.
function riff(roots, rate = 48000, each = 0.6) {
  const out = new Float32Array(Math.round(rate * each * roots.length) + rate / 2);
  roots.forEach((root, n) => {
    const start = Math.round(rate * (0.25 + n * each));
    for (let i = 0; i < rate * each; i++) {
      const t = i / rate, decay = Math.exp(-t * 1.5), attack = Math.min(1, t / 0.004);
      let v = 0;
      for (const [f, a] of [[root, 1], [root * 1.5, 0.8], [root * 2, 0.7], [root * 3, 0.3]]) v += a * Math.sin(2 * Math.PI * f * t);
      out[start + i] = 0.12 * v * decay * attack;
    }
  });
  return out;
}

test('a clip is analysed as the live app would: every hit heard and the right letters shown', () => {
  const roots = [110, 98, 92.5, 87.31, 82.41]; // A G F# F E
  const result = analyseClip(riff(roots), 48000);
  assert.equal(result.hits.length, roots.length, `hits at ${result.hits.map(h => h.t)}`);
  const shown = result.display.filter(d => d.to - d.from >= 150).map(d => d.letter);
  assert.deepEqual(shown, ['A', 'G', 'F#', 'F', 'E']);
  assert.ok(result.namedShare > 0.8);
});

// Real playing: each assets/clips/<name>.wav with a <name>.json beside it is
// checked against the expectations in that file. assets/ is private and not
// in Git, so this is skipped where no clips exist.
const CLIPS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'clips');
const expectations = existsSync(CLIPS) ? readdirSync(CLIPS).filter(f => f.endsWith('.json')) : [];
test('saved clips of real playing still read as expected', { skip: expectations.length === 0 && 'no clips with expectations in assets/clips' }, () => {
  for (const file of expectations) {
    const expected = JSON.parse(readFileSync(join(CLIPS, file), 'utf8'));
    const data = readFileSync(join(CLIPS, file.replace(/\.json$/, '.wav')));
    const { samples, sampleRate } = decodeWav(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    const result = analyseClip(samples, sampleRate);
    const where = `${file}: `;
    if (expected.hits) assert.ok(result.hits.length >= expected.hits.min && result.hits.length <= expected.hits.max, `${where}${result.hits.length} hits, expected ${expected.hits.min} to ${expected.hits.max}`);
    if (expected.minNamedShare) assert.ok(result.namedShare >= expected.minNamedShare, `${where}pitch found ${(result.namedShare * 100).toFixed(0)}% of the time`);
    if (expected.letters) {
      const shown = result.display.filter(d => d.to - d.from >= 150);
      const wrong = shown.filter(d => !expected.letters.includes(d.letter)).reduce((ms, d) => ms + d.to - d.from, 0);
      const total = shown.reduce((ms, d) => ms + d.to - d.from, 0);
      assert.ok(total > 0, `${where}nothing was shown`);
      assert.ok(wrong / total <= (expected.maxWrongShare ?? 0.1), `${where}${(wrong / total * 100).toFixed(0)}% of display time showed a letter outside ${expected.letters}`);
    }
  }
});
