// Prints what the app hears in each saved test clip (assets/clips/*.wav).
//
//   npm run clips
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeWav } from '../src/wav.js';
import { analyseClip } from '../src/clipanalysis.js';

const CLIPS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'clips');
const files = existsSync(CLIPS) ? readdirSync(CLIPS).filter(f => f.endsWith('.wav')).sort() : [];
if (!files.length) console.log('No clips yet. In guitar mode, click "Save clip" while playing.');
for (const file of files) {
  const data = readFileSync(join(CLIPS, file));
  const { samples, sampleRate } = decodeWav(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  const result = analyseClip(samples, sampleRate);
  const namedHits = result.hits.filter(h => h.name).length;
  console.log(`\n${file}: ${result.seconds.toFixed(1)} s at ${sampleRate} Hz, peak level ${result.peak.toFixed(3)}`);
  console.log(`  hits heard: ${result.hits.length} (${(result.hits.length / result.seconds * 60).toFixed(0)}/min), named: ${namedHits}`);
  console.log(`  pitch found in ${(result.namedShare * 100).toFixed(0)}% of the time there was sound`);
  console.log('  letters read: ' + Object.entries(result.letters).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
  console.log('  big display: ' + result.display.filter(d => d.to - d.from >= 150).map(d => `${(d.from / 1000).toFixed(1)}s ${d.letter}`).join('  '));
  if (process.argv.includes('--hits')) for (const hit of result.hits) console.log('   ', JSON.stringify(hit));
}
