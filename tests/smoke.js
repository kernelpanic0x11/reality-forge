// Browser smoke test: runs the real app in headless Chrome against the private
// recorded fixture (assets/demo.mp4) and fails if the pipeline breaks.
//
//   npm run smoke
//
// Screenshots land in tests/output/ so a change can be checked by eye too.
// This proves the app loads, tracks and draws. It is not a live gesture test.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { decodeWav } from '../src/wav.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'http://127.0.0.1:8794/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9333;
const OUTPUT = join(ROOT, 'tests', 'output');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function reachable(url) {
  try { return (await fetch(url)).ok; } catch { return false; }
}
async function waitFor(check, what, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) {
    const value = await check();
    if (value) return value;
  }
  throw Error(`Timed out waiting for ${what}`);
}

const children = [];
const errors = []; // page errors, printed if the run fails so the cause is visible
const profile = mkdtempSync(join(tmpdir(), 'reality-forge-smoke-'));
function cleanup() {
  for (const child of children) child.kill();
  // Chrome may still be writing as it exits; retry, and never fail the run over a temp folder.
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* left in the OS temp dir */ }
}

async function main() {
  assert.ok(existsSync(join(ROOT, 'assets', 'demo.mp4')), 'assets/demo.mp4 (the recorded fixture) is required');
  assert.ok(existsSync(CHROME), `Chrome not found at ${CHROME}; set CHROME=/path/to/chrome`);
  mkdirSync(OUTPUT, { recursive: true });

  if (!await reachable(APP)) {
    children.push(spawn('python3', ['main.py'], { cwd: ROOT, stdio: 'ignore' }));
    await waitFor(() => reachable(APP), 'main.py to serve the app');
  }
  children.push(spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
    '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--window-size=800,1000',
    // A synthetic camera, so the live-camera path can be exercised without hardware or prompts.
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', 'about:blank',
  ], { stdio: 'ignore' }));
  const page = await waitFor(async () => {
    try { return (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json()).find(t => t.type === 'page'); } catch { return null; }
  }, 'Chrome');

  // Minimal Chrome DevTools Protocol client.
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = message => {
    const data = JSON.parse(message.data);
    if (data.id) pending.get(data.id)?.(data);
    else if (data.method === 'Log.entryAdded' && data.params.entry.level === 'error' && !/favicon/.test(data.params.entry.url || '')) errors.push(`${data.params.entry.text} ${data.params.entry.url || ''}`);
    else if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
    // MediaPipe logs routine startup notes as console warnings, so only errors count.
    else if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') errors.push(data.params.args.map(a => a.description || a.value).join(' '));
  };
  const send = (method, params = {}) => new Promise(resolve => { pending.set(++nextId, resolve); socket.send(JSON.stringify({ id: nextId, method, params })); });
  const evaluate = async expression => {
    const { result } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const screenshot = async name => {
    const { result } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUTPUT, name), Buffer.from(result.data, 'base64'));
  };
  const state = async () => JSON.parse(await evaluate(
    `JSON.stringify({ debug: window.liveLab.debug, state: window.liveLab.state, status: document.getElementById('status').textContent })`));

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable'); // failed file loads are reported here, not as exceptions
  await send('Page.navigate', { url: APP });
  await waitFor(() => evaluate(`Boolean(window.liveLab)`).catch(() => false), 'the app to load');
  await evaluate(`import('./app.js').then(m => m.start(true)).then(() => true)`);

  // The fixture contains a pinch; capture the moment the object is held.
  let grabbed = false;
  for (const end = Date.now() + 12000; Date.now() < end; await sleep(150)) {
    if ((await state()).state === 'grabbed') { grabbed = true; await sleep(400); await screenshot('grab.png'); break; }
  }
  await sleep(1500);
  await screenshot('end.png');
  const final = await state();

  // Live path: start Chrome's synthetic (non-Canon) camera through the same code a real one uses.
  await evaluate(`import('./app.js').then(m => m.start()).then(() => true)`);
  await sleep(2500);
  const live = await state();
  const liveRotation = await evaluate(`document.getElementById('rotation').value`);
  await screenshot('live.png');

  // One button: it offers Stop while running and Start once stopped.
  const buttonRunning = await evaluate(`document.getElementById('start').textContent`);
  await evaluate(`document.getElementById('start').click()`);
  await sleep(200);
  const buttonStopped = await evaluate(`document.getElementById('start').textContent + '|' + document.getElementById('status').textContent + '|' + Boolean(document.getElementById('stop'))`);
  await evaluate(`document.getElementById('start').click()`);
  await waitFor(async () => (await evaluate(`document.getElementById('start').textContent`)) === 'Stop', 'the button to restart the camera');
  await sleep(500);

  // Snapshot saves two still frames through main.py; remove them again afterwards.
  const snapshots = await evaluate(`window.liveLab.snapshot()`);
  const snapshotSizes = snapshots.map(name => statSync(join(ROOT, 'logs', name)).size);
  for (const name of snapshots) rmSync(join(ROOT, 'logs', name));

  // Guitar mode on the synthetic camera and Chrome's synthetic audio input (a repeating beep).
  await evaluate(`window.liveLab.setMode('guitar').then(() => true)`);
  let loudest = 0;
  let bigName = null;
  for (const end = Date.now() + 4000; Date.now() < end; await sleep(100)) {
    const now = (await state()).debug;
    loudest = Math.max(loudest, now.audioLevel || 0);
    bigName = now.bigName || bigName;
  }
  const guitar = await state();
  await screenshot('guitar.png');

  // Save clip records the audio input to a WAV file through main.py; remove it again afterwards.
  const clipFile = await evaluate(`window.liveLab.saveClip(4)`);
  const clipPath = join(ROOT, 'assets', 'clips', String(clipFile));
  const clipBytes = readFileSync(clipPath);
  rmSync(clipPath);
  const clip = decodeWav(clipBytes.buffer.slice(clipBytes.byteOffset, clipBytes.byteOffset + clipBytes.byteLength));

  // Record saves a video of the picture with sound through main.py; remove it again afterwards.
  const recording = evaluate(`window.liveLab.record()`);
  await sleep(3500);
  await evaluate(`window.liveLab.record()`); // second call stops and saves
  const recordingFile = await recording;
  const recordingPath = join(ROOT, 'recordings', String(recordingFile));
  const recordingSize = statSync(recordingPath).size;
  if (!process.env.KEEP_RECORDING) rmSync(recordingPath); // KEEP_RECORDING=1 leaves it for inspection

  // Stopping the camera partway through a clip keeps what was recorded, instead of losing it.
  const partial = evaluate(`window.liveLab.saveClip(30)`);
  await sleep(4000);
  await evaluate(`document.getElementById('start').click()`); // Stop
  const partialFile = await partial;
  const partialPath = join(ROOT, 'assets', 'clips', String(partialFile));
  const partialBytes = readFileSync(partialPath);
  rmSync(partialPath);
  const partialClip = decodeWav(partialBytes.buffer.slice(partialBytes.byteOffset, partialBytes.byteOffset + partialBytes.byteLength));
  await evaluate(`document.getElementById('start').click()`); // Start again for the rest of the run
  await waitFor(async () => (await evaluate(`document.getElementById('start').textContent`)) === 'Stop', 'the camera to restart');
  await sleep(500);

  // The on-screen button switches the background on (which starts the person mask) and off.
  const masksBefore = guitar.debug.segments;
  const buttonEnabled = await evaluate(`window.liveLab.buttonEnabled`);
  const pressedOn = await evaluate(`window.liveLab.pressButton()`);
  await sleep(1200);
  const withBackdrop = await state();
  await screenshot('guitar-background.png');
  const pressedOff = await evaluate(`window.liveLab.pressButton()`);
  await evaluate(`window.liveLab.setMode('object').then(() => true)`);
  await sleep(300);

  // The session log must have reached disk through main.py.
  const sessionId = await evaluate(`window.liveLab.sessionId`);
  await sleep(1500);
  const logged = readFileSync(join(ROOT, 'logs', 'latest.jsonl'), 'utf8').split('\n').filter(Boolean)
    .map(line => JSON.parse(line)).filter(entry => entry.session === sessionId);
  const loggedEvents = new Set(logged.map(entry => entry.event));
  socket.close();

  const { debug } = final;
  console.log(JSON.stringify(final, null, 2));
  assert.deepEqual(errors, [], 'no console errors');
  assert.equal(debug.error, null, 'pipeline reported no error');
  assert.equal(debug.source, 'recorded fixture');
  assert.ok(debug.frames > 60, `processed frames (${debug.frames})`);
  assert.ok(debug.hands > 0, 'detected hands');
  assert.ok(debug.faces > 0, 'confirmed a face');
  assert.ok(debug.segments > 0, 'produced person masks');
  assert.equal(debug.orb3d, true, '3D object initialised');
  assert.ok(debug.objectFrames > 60, `3D object rendered (${debug.objectFrames})`);
  assert.ok(grabbed, 'the fixture pinch was recognised as a grab');
  assert.ok(debug.orbDistanceM > 0.2 && debug.orbDistanceM < 5, `plausible object distance (${debug.orbDistanceM})`);
  assert.equal(live.debug.error, null, `live camera started without error (${live.status})`);
  assert.notEqual(live.debug.source, 'recorded fixture', 'live camera became the source');
  assert.ok(live.debug.frames > debug.frames + 20, `live camera frames processed (${live.debug.frames - debug.frames})`);
  assert.equal(liveRotation, '0', 'a non-Canon camera starts upright');
  assert.match(live.status, /live/);
  assert.equal(buttonRunning, 'Stop', 'the button offers Stop while running');
  assert.equal(buttonStopped, 'Start|Camera stopped|false', 'clicking it stops the camera and it offers Start again; there is no separate Stop button');
  assert.equal(snapshots.length, 2, 'snapshot saved the camera and screen frames');
  assert.ok(snapshotSizes.every(size => size > 2000), `snapshots contain images (${snapshotSizes})`);
  assert.equal(withBackdrop.debug.error, null, `guitar mode kept running after a button press (${withBackdrop.status})`);
  if (buttonEnabled) {
    assert.equal(pressedOn, true, 'the button switches the background on');
    assert.ok(withBackdrop.debug.segments > masksBefore, 'the person mask runs while the background is on');
    assert.equal(pressedOff, false, 'and off again');
  } else {
    // The button is switched off in config: pressing it must do nothing.
    assert.equal(pressedOn, false, 'a disabled button cannot be pressed');
    assert.equal(withBackdrop.debug.segments, masksBefore, 'and the background stays off');
  }
  assert.ok(Math.abs(clip.samples.length / clip.sampleRate - 4) < 0.1, `the saved clip is 4 seconds long (${clip.samples.length / clip.sampleRate})`);
  assert.ok(clip.samples.some(v => Math.abs(v) > 0.01), 'the saved clip contains the test tone');
  assert.match(String(recordingFile), /^reel-\d{8}-\d{6}(-raw)?\.(mp4|webm)$/, `a recording was saved (${recordingFile})`);
  assert.ok(recordingSize > 50_000, `the recording contains video (${recordingSize} bytes)`);
  console.log(`recording format: ${String(recordingFile).split('.').pop()}, ${recordingSize} bytes for about 3.5 s`);
  const partialSeconds = partialClip.samples.length / partialClip.sampleRate;
  assert.ok(partialSeconds > 3 && partialSeconds < 6, `stopping the camera saved the ${partialSeconds.toFixed(1)} seconds recorded so far`);
  assert.equal(guitar.debug.error, null, `guitar mode ran without error (${guitar.status})`);
  assert.match(guitar.status, /Guitar/);
  assert.ok(guitar.debug.guitar, 'guitar measurements are produced');
  assert.ok(loudest > 0.001, `audio input was heard (${loudest})`);
  // Chrome's test tone is a beep shorter than the pitch analysis window, so whether it gets
  // named is down to timing. Reported, not required; naming is covered by the unit tests.
  console.log(`big note name seen for the test tone: ${bigName}`);
  if (bigName !== null) assert.match(String(bigName), /^[A-G]#?$/, 'the big name is a root letter');
  for (const event of ['mode', 'audio.started', 'audio.stop']) assert.ok(loggedEvents.has(event), `session log contains "${event}"`);
  for (const event of ['session.start', 'cameras', 'start.requested', 'models.ready', 'source.started', 'hand.appear', 'hand.state', 'object', 'face.appear', 'stats', 'source.stop']) {
    assert.ok(loggedEvents.has(event), `session log contains "${event}" (has: ${[...loggedEvents].join(', ')})`);
  }
  assert.deepEqual(logged.filter(entry => ['error', 'console.error'].includes(entry.event)), [], 'session log has no errors');
  assert.ok(logged.some(entry => entry.event === 'object' && entry.to === 'grabbed'), 'the grab was logged');
  console.log(`PASS smoke. Screenshots: ${OUTPUT}`);
}

main().then(cleanup, error => {
  cleanup();
  console.error(error);
  if (errors.length) console.error('Page errors:\n  ' + errors.join('\n  '));
  process.exitCode = 1;
});
