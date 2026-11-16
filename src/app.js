// Entry point: wires the toolbar to the camera, models, tracking and renderer,
// and runs the per-frame loop.
import { STAGE, OUTPUT, RECORDING, CAMERA, SEGMENT, DEPTH, HAND, FACE, LOGGING, GUITAR, AUDIO } from './config.js';
import { HandInteraction, StableFace } from './tracking.js';
import { DepthModel, bodyHidesOrb, median } from './depth.js';
import { loadModels, detectHandsTiled, detectHandZoom, scanForHands, restartScan } from './models.js';
import { lowLightGain } from './tiles.js';
import { listCameras, openLive, openFixture, releaseTracks, closeVideo, defaultRotation, shortLabel, streamSettings } from './camera.js';
import { log, logError, round, sessionId } from './log.js';
import { changes } from './telemetry.js';
import { GuitarSession } from './guitar.js';
import { OnsetDetector, soundName, StableName, LevelGate } from './pitch.js';
import { openAudio, closeAudio, readAudio, audioOpen, listAudioInputs, recordClip, finishClip, audioTrack } from './audio.js';
import { encodeWav } from './wav.js';
import { drawTrails, drawReadout, drawButton, drawChordName, drawHitRing } from './guitarview.js';
import { DwellButton } from './hotspot.js';
import { FINGERTIPS } from './depth.js';
import { createRenderer, createScene } from './render.js';

const $ = id => document.getElementById(id);
const video = $('video');
const renderer = createRenderer($('stage'));
const interaction = new HandInteraction(STAGE.width, STAGE.height);
const stableFace = new StableFace();

let models = null;
let scene = createScene();
let running = false, lastVideoTime = -1, frame = 0;
let handBoxes = [], faceBoxes = [], trackingLost = false, bodyInFront = false;
let mode = 'object';     // 'object' (grab the 3D object) or 'guitar' (follow both hands and listen)
const guitar = new GuitarSession();
// What the big on-screen chord name shows: steadied, and timed to the hits.
const bigName = new StableName(GUITAR.show.stableReads);
const show = { hitAt: -Infinity, heardAt: -Infinity, ringFrom: null };
// The last drawing of each hand, kept briefly so a single missed frame does not make it blink.
const lastDrawn = { fret: null, pick: null };
function withHeldHands(boxes, t) {
  const drawn = [...boxes];
  for (const role of ['fret', 'pick']) {
    const now = boxes.find(hand => hand.role === role);
    if (now) lastDrawn[role] = { hand: now, at: t };
    else if (lastDrawn[role] && t - lastDrawn[role].at <= GUITAR.show.holdHandMs && boxes.length < 2) {
      drawn.push({ ...lastDrawn[role].hand, opacity: GUITAR.show.heldAlpha });
    }
  }
  return drawn;
}
let onsets = new OnsetDetector();
let hitGate = new LevelGate(AUDIO.hitGate, AUDIO.onset.floor);
let sound = { level: 0, hz: null, note: null, cents: 0, pendingNote: null };
// Guitar mode's on-screen button switches the background behind you.
function savedButtonPlace() {
  try {
    const place = JSON.parse(localStorage.getItem(GUITAR.button.storageKey));
    if (place?.x >= 0 && place.x <= 1 && place?.y >= 0 && place.y <= 1) return place;
  } catch { /* use the default place */ }
  return GUITAR.button;
}
const button = new DwellButton({
  x: savedButtonPlace().x * STAGE.width, y: savedButtonPlace().y * STAGE.height,
  radius: GUITAR.button.radiusPx, dwellMs: GUITAR.button.dwellMs, cooldownMs: GUITAR.button.cooldownMs,
});
const backdrop = { style: 0, since: 0 }; // style alternates each time it is switched on
function backdropChanged(by) {
  if (button.on) { backdrop.style++; backdrop.since = performance.now(); }
  debug.backdrop = button.on;
  log('button', { on: button.on, by, style: backdrop.style });
}
let calibration = null;  // { start, hand: [], face: [] } while Calibrate is running
let notice = null;       // { text, until }: a message that briefly replaces the status line

function loadCalibration() {
  try { return JSON.parse(localStorage.getItem(DEPTH.calibration.storageKey)); } catch { return null; }
}
function saveCalibration(value) {
  try {
    if (value) localStorage.setItem(DEPTH.calibration.storageKey, JSON.stringify(value));
    else localStorage.removeItem(DEPTH.calibration.storageKey);
  } catch { /* storage unavailable: calibration lasts until reload */ }
}
const depth = new DepthModel(loadCalibration());

// Counters for checking a run from the console: window.liveLab.debug
const debug = { frames: 0, hands: 0, segments: 0, faces: 0, handBoxes: 0, faceBoxes: 0, error: null, source: null };
window.liveLab = { debug, depth, sessionId, get state() { return scene.state; }, get world() { return scene.world; } };

const status = text => { $('status').textContent = text; };
const mirrored = () => $('mirror').checked;
const say = (text, ms = 3500) => { notice = { text, until: performance.now() + ms }; status(text); };

// Everything below "Logging" feeds logs/latest.jsonl for troubleshooting.
let lastSnapshot = null;
const stats = { since: 0, renders: 0, videoFrames: 0, trackMs: 0, trackMaxMs: 0, rawHands: 0, zoomTries: 0, zoomFound: 0, scanTries: 0, scanFound: 0 };
const controls = () => ({ mode, rotation: $('rotation').value, mirror: mirrored(), joints: $('joints').checked, lefty: $('lefty').checked, stats: $('stats').checked });
const cm = metres => (metres ? Math.round(metres * 100) : null);

function logTracking() {
  const hands = {};
  // In guitar mode a hand's "state" is its role; pinching is constant there and not worth logging.
  for (const h of handBoxes) hands[h.side] = { state: mode === 'guitar' ? h.role : h.state, ratio: round(h.pinchRatio, 2), cm: cm(h.distanceM), x: Math.round(h.x + h.w / 2), y: Math.round(h.y + h.h / 2), label: h.label, labelScore: round(h.labelScore, 2) };
  const snapshot = {
    state: mode === 'guitar' ? 'guitar' : scene.state, owner: mode === 'guitar' ? null : interaction.owner,
    face: faceBoxes.length > 0, bodyInFront, hands,
    object: { x: Math.round(scene.orb.x), y: Math.round(scene.orb.y), cm: cm(debug.orbDistanceM) },
  };
  for (const { event, ...data } of changes(lastSnapshot, snapshot)) log(event, data);
  lastSnapshot = snapshot;
}

function logStats(t) {
  if (t - stats.since < LOGGING.statsEveryMs) return;
  const seconds = (t - stats.since) / 1000;
  log('stats', {
    fps: round(stats.renders / seconds), videoFps: round(stats.videoFrames / seconds),
    trackMs: round(stats.trackMs / Math.max(1, stats.videoFrames)), trackMaxMs: round(stats.trackMaxMs),
    rawHands: stats.rawHands, picture: Object.fromEntries(Object.entries(renderer.pictureStats()).map(([k, v]) => [k, round(v, 2)])),
    state: scene.state, owner: interaction.owner, face: faceBoxes.length > 0,
    faceCm: cm(debug.faceDistanceM), faceScore: round(debug.faceScore, 2), bodyInFront, ...lastSnapshot?.hands && { hands: lastSnapshot.hands },
    object: lastSnapshot?.object, masks: debug.segments, objectFrames: renderer.objectFrames,
    ...(mode === 'guitar' && { guitar: guitar.summary(t), rolesLearned: guitar.rolesLearned, backdrop: button.on, zoom: { tries: stats.zoomTries, found: stats.zoomFound }, scan: { tries: stats.scanTries, found: stats.scanFound }, gain: round(track.gain, 2), audio: { on: audioOpen(), level: round(sound.level, 4), peak: round(sound.peak, 4), note: sound.note, hz: round(sound.hz), clarity: round(sound.clarity, 2), fluxPeak: round(sound.fluxPeak, 2) } }),
  });
  sound.peak = sound.fluxPeak = 0; // loudest moment and biggest tone change since the previous stats line
  Object.assign(stats, { since: t, renders: 0, videoFrames: 0, trackMs: 0, trackMaxMs: 0, rawHands: 0, zoomTries: 0, zoomFound: 0, scanTries: 0, scanFound: 0 });
}

// The one Start/Stop button always shows what clicking it will do.
let starting = false;
function showRunState() {
  const button = $('start');
  button.textContent = starting ? 'Starting…' : running ? 'Stop' : 'Start';
  button.title = running ? 'Stop the camera' : 'Start the selected camera';
  button.disabled = starting;
  button.classList.toggle('primary', !running && !starting);
  button.classList.toggle('live', running);
}

function fail(e) {
  logError('pipeline', e);
  debug.error = String(e);
  status(e.message);
  console.error(e);
  releaseTracks();
  running = false;
  starting = false;
  showRunState();
}

// Guitar mode listens to the default audio input; without it the hands are still tracked.
async function startAudio() {
  try {
    let label;
    try { label = await openAudio($('audioInput').value); }
    catch (e) {
      if (!$('audioInput').value) throw e;
      log('audio.fallback', { reason: String(e?.message || e) }); // the saved input is gone: use the default
      $('audioInput').value = '';
      label = await openAudio('');
    }
    onsets = new OnsetDetector();
    hitGate = new LevelGate(AUDIO.hitGate, AUDIO.onset.floor);
    sound.lastLoud = performance.now();
    sound.peak = 0;
    // Device names are only visible once permission is granted, so list them now.
    const inputs = await listAudioInputs();
    const chosen = $('audioInput').value;
    $('audioInput').replaceChildren(new Option('Default audio input', ''), ...inputs.filter(d => d.deviceId !== 'default').map(d => new Option(d.label || 'Audio input', d.deviceId)));
    $('audioInput').value = inputs.some(d => d.deviceId === chosen) ? chosen : '';
    log('audio.started', { label, inputs: inputs.map(d => d.label) });
  } catch (e) {
    log('audio.unavailable', { reason: String(e?.message || e) });
    say('No audio input: tracking hands only');
  }
}

function stopAudio() {
  if (audioOpen()) log('audio.stop');
  closeAudio();
  sound = { level: 0, hz: null, note: null, cents: 0, pendingNote: null };
  bigName.clear();
}

async function setMode(next) {
  mode = next === 'guitar' ? 'guitar' : 'object';
  $('mode').value = mode;
  $('leftyLabel').hidden = $('statsLabel').hidden = $('audioInput').hidden = $('clip').hidden = mode !== 'guitar';
  try { localStorage.setItem('reality-forge.mode', mode); } catch { /* not remembered */ }
  log('mode', { mode });
  reset();
  if (mode === 'guitar' && running && debug.source !== 'recorded fixture') await startAudio();
  if (mode !== 'guitar') stopAudio();
}

function stop() {
  endRecording(); // finish and save a recording in progress before the picture stops
  if (running) log('source.stop', { frames: debug.frames });
  stopAudio();
  running = false;
  closeVideo(video);
  handBoxes = [];
  faceBoxes = [];
  lastVideoTime = -1;
  status('Camera stopped');
  showRunState();
}

function reset() {
  if (running) log('reset');
  lastSnapshot = null;
  interaction.reset();
  stableFace.reset();
  guitar.reset();
  lastDrawn.fret = lastDrawn.pick = null;
  trackingLost = false;
  bodyInFront = false;
  scene = createScene();
}

// start(true) plays the recorded fixture instead of the selected camera.
export async function start(fixture = false) {
  if (starting) return; // a start is already under way
  try {
    stop();
    starting = true;
    showRunState();
    status('Loading local tracking models…');
    log('start.requested', { fixture, ...controls() });
    const loadStart = performance.now();
    models = await loadModels();
    log('models.ready', { loadMs: Math.round(performance.now() - loadStart) });
    if (fixture) {
      $('rotation').value = CAMERA.fixtureRotation;
      openFixture(video);
      debug.source = 'recorded fixture';
    } else {
      const previous = debug.source;
      const label = await openLive($('camera'), video);
      // Switching cameras applies that camera's usual rotation. The very first
      // start keeps whatever rotation is selected when it suits the camera.
      if (label !== previous && (previous !== null || defaultRotation(label) !== CAMERA.preferredRotation)) {
        $('rotation').value = defaultRotation(label);
      }
      debug.source = label;
      if (mode === 'guitar') await startAudio();
    }
    await video.play();
    lastVideoTime = -1;
    reset();
    running = true;
    starting = false;
    showRunState();
    stats.since = performance.now();
    log('source.started', {
      source: debug.source, ...(fixture ? {} : { camera: streamSettings() }),
      video: { width: video.videoWidth, height: video.videoHeight }, ...controls(), calibrated: depth.calibrated,
    });
    status(fixture ? 'Recorded fixture • tracking active' : `${shortLabel(debug.source)} live`);
    requestAnimationFrame(tick);
  } catch (e) {
    fail(e);
  }
}

function track(t) {
  if (mode === 'guitar') {
    faceBoxes = []; // the face is not used in guitar mode
  } else {
    const faces = models.face.detectForVideo(renderer.plate, t).detections;
    debug.faceScore = Math.max(0, ...faces.map(f => f.categories?.[0]?.score || 0)); // raw, before gating
    faceBoxes = stableFace.update(faces, t);
  }
  debug.faces += faceBoxes.length;
  debug.faceBoxes = faceBoxes.length;

  // Guitar mode: the wide search can run less often while both hands are being followed up close.
  const wide = mode !== 'guitar' || !track.followed || debug.frames % GUITAR.recover.tilesEveryNthFrame === 0;
  const found = mode !== 'guitar' ? models.hand.detectForVideo(renderer.plate, t)
    : wide ? detectHandsTiled(models, renderer.plate, t) : { landmarks: [], worldLandmarks: [], handedness: [] };
  if (mode === 'guitar') {
    // Second look, zoomed in and brightened, for hands the tiles missed.
    if (debug.frames % 15 === 0 || !track.gain) track.gain = lowLightGain(renderer.pictureStats().brightness, GUITAR.recover);
    const add = extra => { for (const key of ['landmarks', 'worldLandmarks', 'handedness']) found[key].push(...extra[key]); };
    const palmOf = p => ({ x: (p[0].x + p[5].x + p[17].x) / 3 * STAGE.width, y: (p[0].y + p[5].y + p[17].y) / 3 * STAGE.height });
    const palms = found.landmarks.map(palmOf);
    const targets = guitar.searchTargets(t, palms);
    track.followed = 0;
    let slipped = null; // a hand that is no longer where it was expected
    for (const target of targets) {
      const zoomed = detectHandZoom(models, target.role === 'fret' ? 0 : 1, renderer.plate, target.x, target.y, t, track.gain);
      stats.zoomTries++;
      if (zoomed.landmarks.length) { stats.zoomFound++; track.followed++; }
      else if (target.missingFor > GUITAR.recover.sweepAfterMs) slipped = target;
      add(zoomed);
    }
    // A hand whose whereabouts are unknown, or that slid away from where it was
    // expected: sweep one crop of the picture per frame, nearest to its last place first.
    // Count separate hands: the same hand reported twice (by a tile and a zoom, or by both zooms) is one.
    const separate = [];
    for (const palm of found.landmarks.map(palmOf)) {
      if (!separate.some(k => Math.hypot(k.x - palm.x, k.y - palm.y) < GUITAR.recover.nearPx)) separate.push(palm);
    }
    if (separate.length < 2 && (slipped || guitar.unknownRoles(t).length)) {
      if (!track.sweeping) restartScan();
      track.sweeping = true;
      const scanned = scanForHands(models, renderer.plate, track.gain, slipped);
      stats.scanTries++;
      // Only a hand that is not already being followed counts as a find. Coming across
      // the known hand again must not restart the sweep, or it never reaches the lost one.
      const known = found.landmarks.map(palmOf);
      const fresh = scanned.landmarks.some(p => !known.some(k => Math.hypot(k.x - palmOf(p).x, k.y - palmOf(p).y) < GUITAR.recover.nearPx));
      if (fresh) { stats.scanFound++; restartScan(); }
      add(scanned);
    } else {
      track.sweeping = false;
    }
  }
  stats.rawHands = Math.max(stats.rawHands, found.landmarks.length); // what the model returned, before any filtering
  handBoxes = interaction.update(found, t, mirrored());
  debug.handBoxes = handBoxes.length;
  debug.hands += handBoxes.length;
  debug.leftHand = handBoxes.find(h => h.side === 'Left')?.state || 'absent';
  debug.rightHand = handBoxes.find(h => h.side === 'Right')?.state || 'absent';
  debug.owner = interaction.owner;

  trackingLost = handBoxes.length === 0;
  for (const hand of handBoxes) hand.distanceM = depth.handDistance(hand.pxPerMeter);
  if (mode === 'guitar') {
    trackGuitar(t);
    logTracking();
    return;
  }

  scene.state = interaction.state;
  if (interaction.orb) scene.orb = { ...interaction.orb };
  scene.orbPxPerMeter = interaction.orbScale;
  scene.orbBasis = interaction.orbBasis;

  const orbDistance = depth.handDistance(scene.orbPxPerMeter);
  const faceDistance = depth.faceDistance(faceBoxes[0]?.w);
  bodyInFront = (depth.calibrated || !DEPTH.bodyOcclusionNeedsCalibration) && bodyHidesOrb(orbDistance, faceDistance);
  debug.orbDistanceM = orbDistance;
  debug.faceDistanceM = faceDistance;
  debug.bodyInFront = bodyInFront;
  debug.calibrated = depth.calibrated;

  logTracking();

  if (calibration && t - calibration.start >= DEPTH.calibration.countdownMs) {
    if (handBoxes[0]?.pxPerMeter) calibration.hand.push(handBoxes[0].pxPerMeter);
    if (faceBoxes[0]) calibration.face.push(faceBoxes[0].w);
  }
}

// Guitar mode: measure each hand, listen for notes, and caption the hand boxes.
function trackGuitar(t) {
  const events = guitar.update(handBoxes, t, { lefty: $('lefty').checked });
  const fingertips = handBoxes.flatMap(hand => FINGERTIPS.map(i => hand.points[i]));
  if (GUITAR.button.enabled && button.update(fingertips, t)) backdropChanged('finger');
  if (events.shift) log('guitar.shift', { shifts: guitar.fret.shifts.count });

  if (audioOpen()) {
    const { level, hz, analysed, bestHz, clarity, flux } = readAudio(debug.frames % GUITAR.pitchEveryNthFrame === 0);
    if (analysed) Object.assign(sound, { bestHz, clarity }); // kept for the log, to explain missing pitches
    // The big name shows the root letter only (A, F#): steadier than A3 / A5 flickering between octaves.
    if (analysed && bigName.update(hz ? soundName(hz).name.replace(/-?\d+$/, '') : null) && hz) show.heardAt = t;
    sound.level = level;
    sound.peak = Math.max(sound.peak || 0, level);
    if (level >= AUDIO.silenceRms) sound.lastLoud = t;
    const noSignal = t - sound.lastLoud > GUITAR.noSignalMs;
    if (noSignal && !sound.noSignal) log('audio.no-signal', { level: round(level, 4), hint: 'input is below the silence level; check the audio input' });
    sound.noSignal = noSignal;
    if (hz) {
      const note = soundName(hz);
      Object.assign(sound, { hz, note: note.name, cents: note.cents, chord: note.chord, heardAt: t });
    } else if (sound.note && t - sound.heardAt > GUITAR.noteHoldMs) {
      Object.assign(sound, { hz: null, note: null, cents: 0 });
    }
    sound.fluxPeak = Math.max(sound.fluxPeak || 0, flux || 0);
    hitGate.update(level);
    if (onsets.update(level, t, flux, hitGate.threshold)) {
      sound.onsetFlux = flux;
      guitar.noteOnset(t);
      sound.pendingNote = t; // read the pitch once the pick noise has passed
      // The hit drives the on-screen punch, pulse and ring (from the pick, if the hand is in view).
      // Fast playing shares one animation, so the picture never strobes.
      if (t - show.hitAt >= GUITAR.show.minHitGapMs) {
        show.hitAt = t;
        const picking = handBoxes.find(hand => hand.role === 'pick');
        show.ringFrom = picking ? { x: (picking.points[4].x + picking.points[8].x) / 2, y: (picking.points[4].y + picking.points[8].y) / 2 } : null;
      }
    }
    if (sound.pendingNote !== null && t - sound.pendingNote >= GUITAR.noteDelayMs) {
      log('note', { note: sound.note, chord: Boolean(sound.note && sound.chord), hz: round(sound.hz), cents: sound.cents, level: round(level, 4), clarity: round(sound.clarity, 2), bestGuess: soundName(sound.bestHz)?.name ?? null, flux: round(sound.onsetFlux, 2) });
      sound.pendingNote = null;
    }
  }

  const summary = guitar.summary(t);
  for (const hand of handBoxes) {
    hand.color = GUITAR.colors[hand.role];
    hand.caption = hand.role === 'pick'
      ? `PICK · ${summary.pick.strokesPerMin} moves/min`
      : `FRET · ${summary.fret.fingerCmPerS} cm/s`;
  }
  debug.guitar = summary;
  debug.audioLevel = sound.level;
  debug.note = sound.note;
  debug.bigName = bigName.name;
}

// Snapshot: saves one still frame to logs/ on this Mac, only when asked.
// "camera" is exactly what the tracker sees; "screen" includes the overlay.
async function snapshot() {
  if (!running) { say('Start the camera before taking a snapshot'); return []; }
  const files = [];
  for (const [name, canvas] of [['camera', renderer.plate], ['screen', $('stage')]]) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    const response = await fetch(`/snapshot/${name}`, { method: 'POST', body: blob });
    if (!response.ok) throw Error(`Snapshot failed (${response.status}). Restart main.py if it is an old version.`);
    files.push(await response.text());
  }
  log('snapshot', { files, picture: renderer.pictureStats(), hands: handBoxes.length });
  say(`Snapshot saved to logs/`);
  return files;
}

// Record: saves a video of the picture exactly as drawn (overlay included,
// toolbar not) with the audio input, to recordings/ on this Mac. Only when
// asked: click Record to start and again to stop. Stopping the camera also
// stops and saves it.
let recorder = null, recordingSince = 0;
// Stops the recording and shows at once that it is being saved, so the button never looks stuck.
function endRecording() {
  if (!recorder || recorder.state === 'inactive') return;
  recorder.stop();
  $('record').textContent = 'Saving…';
  $('record').classList.remove('live');
  $('record').disabled = true;
}
function recordingType() {
  // MP4 plays everywhere and uploads to Instagram as is; WebM is the fallback.
  const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
  return types.find(type => MediaRecorder.isTypeSupported(type)) || '';
}
async function toggleRecording() {
  if (recorder) { endRecording(); return null; }
  if (!running) { say('Start the camera before recording'); return null; }
  const stream = $('stage').captureStream(RECORDING.fps);
  const sound = audioTrack();
  if (sound) stream.addTrack(sound.clone());
  const type = recordingType(), chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: RECORDING.videoBitsPerSecond, audioBitsPerSecond: RECORDING.audioBitsPerSecond });
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise(resolve => { recorder.onstop = resolve; });
  recorder.start(1000);
  recordingSince = performance.now();
  $('record').textContent = 'Stop rec';
  $('record').classList.add('live');
  log('recording.start', { type, audio: Boolean(sound), size: OUTPUT });
  try {
    await stopped;
    const seconds = (performance.now() - recordingSince) / 1000;
    stream.getTracks().forEach(track => track.stop());
    const extension = type.startsWith('video/mp4') ? 'mp4' : 'webm';
    notice = { text: 'Saving and finishing the recording… this can take a little while', until: performance.now() + 1800000 };
    status(notice.text);
    const response = await fetch(`/recording/${extension}`, { method: 'POST', body: new Blob(chunks, { type }) });
    if (!response.ok) throw Error(`Saving the recording failed (${response.status}). Restart main.py if it is an old version.`);
    const file = await response.text();
    log('recording.saved', { file, seconds: round(seconds), audio: Boolean(sound), megabytes: round(chunks.reduce((sum, c) => sum + c.size, 0) / 1e6) });
    say(`Recording saved: recordings/${file}`, 10000);
    return file;
  } finally {
    if (notice?.text.startsWith('Saving and finishing')) notice = null;
    recorder = null;
    $('record').textContent = 'Record';
    $('record').classList.remove('live');
    $('record').disabled = false;
  }
}

// Save clip: records the audio input for a while and saves it to assets/clips/
// on this Mac, only when asked. Clips of real playing are used to test the
// chord naming and hit counting against every future change.
let clipRemaining = null; // seconds left while a clip is recording
async function saveClip(seconds = GUITAR.clipSeconds) {
  if (!audioOpen()) { say('Start guitar mode with an audio input before saving a clip'); return null; }
  if (clipRemaining !== null) { finishClip(); return null; } // a second click ends the clip early and saves it
  clipRemaining = seconds;
  $('clip').textContent = 'Stop clip';
  log('clip.start', { seconds });
  try {
    // Ends when the time is up, on a second click, or if the camera is stopped; what was recorded is kept.
    const { samples, sampleRate } = await recordClip(seconds, remaining => { clipRemaining = remaining; });
    clipRemaining = null;
    $('clip').textContent = 'Save clip';
    if (samples.length / sampleRate < GUITAR.clipMinSeconds) {
      log('clip.too-short', { seconds: round(samples.length / sampleRate) });
      say(`Clip was under ${GUITAR.clipMinSeconds} seconds, so it was not saved. Click Save clip and keep playing.`, 6000);
      return null;
    }
    const response = await fetch('/clip', { method: 'POST', body: encodeWav(samples, sampleRate) });
    if (!response.ok) throw Error(`Saving the clip failed (${response.status}). Restart main.py if it is an old version.`);
    const file = await response.text();
    log('clip.saved', { file, seconds: round(samples.length / sampleRate), sampleRate });
    say(`Test clip saved: assets/clips/${file}`, 6000);
    return file;
  } finally {
    clipRemaining = null;
    $('clip').textContent = 'Save clip';
  }
}

// Calibrate: after a countdown, measures a hand held beside the face at the
// distance typed in the toolbar. Shift-click clears the saved calibration.
function calibrate(event) {
  if (event?.shiftKey) {
    log('calibration.cleared');
    depth.reset();
    saveCalibration(null);
    say('Calibration cleared');
    return;
  }
  if (!running) { say('Start the camera before calibrating'); return; }
  calibration = { start: performance.now(), hand: [], face: [] };
  log('calibration.start', { distanceCm: Number($('distance').value) });
}

function calibrationStatus(t) {
  const { countdownMs, sampleMs, minSamples } = DEPTH.calibration;
  const elapsed = t - calibration.start;
  if (elapsed < countdownMs) return `Calibrate: hold an open hand beside your face • ${Math.ceil((countdownMs - elapsed) / 1000)}`;
  if (elapsed < countdownMs + sampleMs) return 'Calibrating • hold still';
  const { hand, face } = calibration;
  calibration = null;
  const distanceM = Number($('distance').value) / 100;
  if (hand.length < minSamples || !(distanceM > 0)) {
    log('calibration.failed', { handSamples: hand.length, faceSamples: face.length, distanceM });
    say('Calibration failed: no hand seen, or no distance entered. Try again.');
  } else {
    const hasFace = face.length >= minSamples;
    const saved = depth.calibrate({ handPxPerMeter: median(hand), faceWidthPx: hasFace ? median(face) : null, distanceM });
    saveCalibration(saved);
    log('calibration.done', {
      handSamples: hand.length, faceSamples: face.length, distanceM, handPxPerMeter: round(median(hand)),
      faceWidthPx: hasFace ? round(median(face)) : null, focalPx: round(saved.focalPx), faceWidthM: round(saved.faceWidthM, 3),
    });
    say(hasFace ? `Calibrated at ${Math.round(distanceM * 100)} cm` : `Calibrated distance only (no face seen) at ${Math.round(distanceM * 100)} cm`);
  }
  return notice.text;
}

function segment(t) {
  models.segmenter.segmentForVideo(renderer.plate, t, result => {
    if (renderer.updateMask(result)) debug.segments++;
  });
}

function tick(t) {
  if (!running) return;
  try {
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      renderer.drawPlate(video, Number($('rotation').value), mirrored());
      const trackStart = performance.now();
      track(t);
      const trackMs = performance.now() - trackStart;
      stats.videoFrames++;
      stats.trackMs += trackMs;
      stats.trackMaxMs = Math.max(stats.trackMaxMs, trackMs);
      // The person mask is only needed by the object, or while the guitar background is on.
      if (frame++ % SEGMENT.everyNthFrame === 0 && (mode === 'object' || button.on)) segment(t);
      debug.frames++;
    }
    const overlay = { showJoints: $('joints').checked, calibrated: depth.calibrated, bodyInFront };
    if (mode === 'guitar') {
      const hitAge = t - show.hitAt, pulse = Math.max(0, 1 - hitAge / GUITAR.show.pulseMs);
      const stats = $('stats').checked;
      if (button.on) renderer.drawBackdrop(t, backdrop.style, backdrop.since);
      else renderer.drawCamera();
      drawHitRing(renderer.ctx, show.ringFrom, hitAge);
      drawTrails(renderer.ctx, guitar, t, pulse);
      if (GUITAR.button.enabled) drawButton(renderer.ctx, button, 'BG');
      // Drawing only: measurements still use just the hands actually seen this frame.
      renderer.drawTrackingBoxes([], withHeldHands(handBoxes, t), { ...overlay, pulse, hideBoxes: !stats });
      drawChordName(renderer.ctx, STAGE.width, STAGE.height, { name: bigName.name, hitAge, heardAge: t - show.heardAt });
      if (stats) drawReadout(renderer.ctx, STAGE.width, { ...sound, audio: audioOpen(), summary: guitar.summary(t) });
    } else {
      renderer.drawFrame(t, scene, faceBoxes, handBoxes, overlay);
    }
    stats.renders++;
    logStats(t);
    debug.orb3d = renderer.has3D;
    debug.objectFrames = renderer.objectFrames;
    const source = debug.source === 'recorded fixture' ? 'Recorded fixture' : `${shortLabel(debug.source)} live`;
    const action = mode === 'guitar' ? `Guitar • ${!audioOpen() ? 'no audio' : sound.noSignal ? 'no audio signal: check the input' : (sound.note || 'listening')}`
      : trackingLost ? 'Hand out of view'
      : scene.state === 'grabbed' ? 'GRAB'
      : scene.state === 'released' ? 'RELEASE' : 'Pinch to grab';
    if (recorder && recorder.state === 'recording') { const s = Math.floor((performance.now() - recordingSince) / 1000); status(`REC ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} • click Stop rec to save`); }
    else if (clipRemaining !== null) status(`Recording test clip • ${Math.ceil(clipRemaining)} s left • keep playing (Stop clip saves it early)`);
    else if (calibration) status(calibrationStatus(t));
    else if (notice && performance.now() < notice.until) status(notice.text);
    else status(`${source} • ${action}`);
  } catch (e) {
    fail(e);
    return;
  }
  requestAnimationFrame(tick);
}

log('session.start', {
  userAgent: navigator.userAgent, stage: STAGE, object3d: renderer.has3D, calibration: depth.calibrated ? depth.toJSON() : null,
  thresholds: { hand: HAND, face: FACE, depth: { handInFrontRatio: DEPTH.handInFrontRatio, behindBodyMarginM: DEPTH.behindBodyMarginM } },
});
for (const id of ['rotation', 'mirror', 'joints', 'lefty', 'stats', 'camera']) {
  $(id).addEventListener('change', () => log('control', { changed: id, camera: shortLabel($('camera').selectedOptions[0]?.text), ...controls() }));
}
document.addEventListener('fullscreenchange', () => log('fullscreen', { on: Boolean(document.fullscreenElement) }));

// The button can be dragged with the mouse to place it, or clicked to press it.
function stagePoint(event) {
  const stage = $('stage'), box = stage.getBoundingClientRect();
  const scale = Math.min(box.width / STAGE.width, box.height / STAGE.height); // the picture is letterboxed
  return {
    x: (event.clientX - box.left - (box.width - STAGE.width * scale) / 2) / scale,
    y: (event.clientY - box.top - (box.height - STAGE.height * scale) / 2) / scale,
  };
}
let drag = null;
$('stage').addEventListener('pointerdown', event => {
  const point = stagePoint(event);
  if (!GUITAR.button.enabled || mode !== 'guitar' || !button.contains(point, 1.5)) return;
  drag = { from: point, moved: false };
  $('stage').setPointerCapture(event.pointerId);
});
$('stage').addEventListener('pointermove', event => {
  if (!drag) return;
  const point = stagePoint(event);
  if (Math.hypot(point.x - drag.from.x, point.y - drag.from.y) > 8) drag.moved = true;
  if (drag.moved) button.moveTo(Math.max(0, Math.min(STAGE.width, point.x)), Math.max(0, Math.min(STAGE.height, point.y)));
});
$('stage').addEventListener('pointerup', () => {
  if (!drag) return;
  if (drag.moved) {
    const place = { x: button.x / STAGE.width, y: button.y / STAGE.height };
    try { localStorage.setItem(GUITAR.button.storageKey, JSON.stringify(place)); } catch { /* not remembered */ }
    log('button.moved', { x: round(place.x, 3), y: round(place.y, 3) });
  } else {
    button.toggle(performance.now());
    backdropChanged('mouse');
  }
  drag = null;
});
window.liveLab.buttonEnabled = GUITAR.button.enabled;
window.liveLab.pressButton = () => {
  if (!GUITAR.button.enabled) return false; // switched off in config
  button.toggle(performance.now());
  backdropChanged('test');
  return button.on;
};

$('mode').onchange = () => setMode($('mode').value);
$('audioInput').onchange = () => {
  try { localStorage.setItem('reality-forge.audioInput', $('audioInput').value); } catch { /* not remembered */ }
  log('control', { changed: 'audioInput', input: $('audioInput').selectedOptions[0]?.text });
  if (audioOpen()) startAudio();
};
$('lefty').addEventListener('change', () => guitar.reset()); // roles are learned per player
$('stats').addEventListener('change', () => { try { localStorage.setItem('reality-forge.stats', $('stats').checked ? '1' : ''); } catch { /* not remembered */ } });
try { $('stats').checked = localStorage.getItem('reality-forge.stats') === '1'; } catch { /* stats off */ }
try {
  const saved = localStorage.getItem('reality-forge.audioInput');
  if (saved) { $('audioInput').append(new Option('Saved audio input', saved)); $('audioInput').value = saved; }
} catch { /* default input */ }
try { if (localStorage.getItem('reality-forge.mode') === 'guitar') setMode('guitar'); } catch { /* starts in object mode */ }
window.liveLab.setMode = setMode;

$('start').onclick = () => (running ? stop() : start());
$('reset').onclick = reset;
$('calibrate').onclick = calibrate;
$('snapshot').onclick = () => snapshot().catch(e => { logError('snapshot', e); say(e.message); });
window.liveLab.snapshot = snapshot;
$('clip').onclick = () => saveClip().catch(e => { logError('clip', e); say(e.message); });
window.liveLab.saveClip = saveClip;
$('record').onclick = () => toggleRecording().catch(e => { logError('recording', e); say(e.message); });
window.liveLab.record = toggleRecording;
$('full').onclick = () => $('stage').requestFullscreen();
navigator.mediaDevices?.addEventListener('devicechange', () => listCameras($('camera')).catch(console.error));
listCameras($('camera')).then(devices => log('cameras', { labels: devices.map(d => d.label || '(hidden until permission)') })).catch(console.error);
