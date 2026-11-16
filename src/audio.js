// Live audio input for guitar mode. Samples are analysed in memory and
// discarded. Nothing is played back or sent anywhere, and audio is only kept
// when a test clip is recorded on request (recordClip).
import { AUDIO } from './config.js';
import { rms, pitchDetails, spectralFlux, LevelGate } from './pitch.js';

let stream = null, context = null, analyser = null, samples = null, halved = null;
let source = null, tapReady = false;
let pitchGate = new LevelGate(AUDIO.pitchGate, AUDIO.silenceRms);
let toneAnalyser = null, decibels = null, spectrum = null, lastSpectrum = null, firstBin = 0;

// Audio inputs the browser can see. Labels are blank until permission is granted.
export async function listAudioInputs() {
  return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
}

// Opens the given audio input (or the default one) and returns its label.
export async function openAudio(deviceId = '') {
  closeAudio();
  // Voice-call processing would mangle a guitar, so it is all switched off.
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { ...(deviceId && { deviceId: { exact: deviceId } }), echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false,
  });
  context = new AudioContext();
  analyser = context.createAnalyser();
  analyser.fftSize = AUDIO.fftSize;
  source = context.createMediaStreamSource(stream);
  tapReady = false;
  pitchGate = new LevelGate(AUDIO.pitchGate, AUDIO.silenceRms);
  source.connect(analyser); // not connected to the speakers
  // A second, short-window analyser for spotting attacks by change in tone.
  toneAnalyser = context.createAnalyser();
  toneAnalyser.fftSize = AUDIO.fluxFftSize;
  toneAnalyser.smoothingTimeConstant = 0;
  source.connect(toneAnalyser);
  const binHz = context.sampleRate / AUDIO.fluxFftSize;
  firstBin = Math.ceil(AUDIO.fluxMinHz / binHz);
  const bins = Math.min(toneAnalyser.frequencyBinCount, Math.floor(AUDIO.fluxMaxHz / binHz)) - firstBin;
  decibels = new Float32Array(toneAnalyser.frequencyBinCount);
  spectrum = new Float32Array(bins);
  lastSpectrum = new Float32Array(bins);
  samples = new Float32Array(analyser.fftSize);
  halved = new Float32Array(analyser.fftSize / 2);
  return stream.getAudioTracks()[0]?.label || 'Audio input';
}

export const audioOpen = () => Boolean(analyser);

// The live input track, for including the sound in a video recording made on request.
export const audioTrack = () => stream?.getAudioTracks()[0] ?? null;

// Current level, and the pitch analysis when asked for and loud enough.
export function readAudio(wantPitch) {
  if (!analyser) return { level: 0, hz: null, analysed: false, flux: null };
  analyser.getFloatTimeDomainData(samples);
  const level = rms(samples);
  let details = null;
  const playing = pitchGate.update(level); // loud enough, relative to recent playing, to be worth naming
  if (wantPitch && playing) {
    // Halving the sample rate keeps pitch detection cheap; guitar fundamentals are low.
    for (let i = 0; i < halved.length; i++) halved[i] = (samples[i * 2] + samples[i * 2 + 1]) / 2;
    details = pitchDetails(halved, context.sampleRate / 2);
  }
  toneAnalyser.getFloatFrequencyData(decibels);
  for (let i = 0; i < spectrum.length; i++) spectrum[i] = 10 ** (decibels[i + firstBin] / 20);
  const flux = spectralFlux(lastSpectrum, spectrum);
  [spectrum, lastSpectrum] = [lastSpectrum, spectrum];

  // `analysed` is false on frames where pitch was not attempted.
  return { level, flux, analysed: Boolean(details), hz: details?.hz ?? null, bestHz: details?.bestHz ?? null, clarity: details?.clarity ?? 0 };
}

export function closeAudio() {
  activeClip?.finish(); // keep whatever a clip in progress has recorded
  stream?.getTracks().forEach(track => track.stop());
  context?.close().catch(() => {});
  stream = context = analyser = samples = halved = toneAnalyser = decibels = spectrum = lastSpectrum = source = null;
}

// Records up to `seconds` of the raw input for a test clip. Resolves with
// { samples: Float32Array, sampleRate } when the time is up, when finishClip()
// is called, or when the audio is stopped: whatever was recorded is kept.
// onProgress gets the seconds remaining.
let activeClip = null;
export function finishClip() { activeClip?.finish(); }
export async function recordClip(seconds, onProgress = () => {}) {
  if (!context || !source) throw Error('Audio is not running');
  if (!tapReady) { await context.audioWorklet.addModule('./clip-worklet.js'); tapReady = true; }
  const recording = context, input = source, tap = new AudioWorkletNode(recording, 'clip-tap');
  const wanted = Math.round(seconds * recording.sampleRate), chunks = [];
  let have = 0;
  return new Promise(resolve => {
    const finish = () => {
      if (activeClip?.finish !== finish) return; // already finished
      activeClip = null;
      tap.port.onmessage = null;
      try { input.disconnect(tap); } catch { /* audio already torn down */ }
      const samples = new Float32Array(Math.min(have, wanted));
      let offset = 0;
      for (const chunk of chunks) {
        if (offset >= samples.length) break;
        samples.set(chunk.subarray(0, samples.length - offset), offset);
        offset += chunk.length;
      }
      resolve({ samples, sampleRate: recording.sampleRate });
    };
    activeClip = { finish };
    tap.port.onmessage = event => {
      chunks.push(event.data);
      have += event.data.length;
      onProgress(Math.max(0, (wanted - have) / recording.sampleRate));
      if (have >= wanted) finish();
    };
    input.connect(tap); // the tap has no output, so nothing is played back
  });
}
