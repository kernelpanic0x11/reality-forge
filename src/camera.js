// Camera selection and video sources. Video only; audio is never requested.
import { CAMERA } from './config.js';

let stream = null;

const videoInputs = async () =>
  (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');

// The rotation a camera starts with: the Canon is mounted sideways, webcams are upright.
export function defaultRotation(label) {
  return CAMERA.preferredLabel.test(label || '') ? CAMERA.preferredRotation : CAMERA.otherRotation;
}

// "FaceTime HD Camera (05ac:8514)" -> "FaceTime HD Camera"
export function shortLabel(label) {
  return (label || '').replace(/\s*\([^)]*\)\s*$/, '') || 'Camera';
}

// Fills the <select> with cameras, preferring the previous choice, then the Canon.
export async function listCameras(select) {
  const devices = await videoInputs();
  const previous = select.value;
  select.replaceChildren(...devices.map(d => new Option(d.label || 'Camera (permission needed)', d.deviceId)));
  const canon = devices.find(d => CAMERA.preferredLabel.test(d.label));
  select.value = previous || canon?.deviceId || devices[0]?.deviceId || '';
  return devices;
}

// Attaches the camera selected in the list to the video element and returns its label.
export async function openLive(select, video) {
  const devices = await listCameras(select);
  let selected = devices.find(d => d.deviceId === select.value);
  if (!selected?.label) {
    // Labels are hidden until permission is granted; probe once, then re-list.
    const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    probe.getTracks().forEach(t => t.stop());
    await listCameras(select);
    selected = (await navigator.mediaDevices.enumerateDevices()).find(d => d.deviceId === select.value);
  }
  if (!selected) throw Error('No camera found. Connect one and choose it in the camera list.');
  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: { exact: selected.deviceId },
      width: { ideal: CAMERA.width },
      height: { ideal: CAMERA.height },
      frameRate: { ideal: CAMERA.frameRate },
    },
    audio: false,
  });
  video.srcObject = stream;
  return selected.label;
}

// What the camera actually delivered, which can differ from what was asked for.
export function streamSettings() {
  const { width, height, frameRate } = stream?.getVideoTracks()[0]?.getSettings() || {};
  return { width, height, frameRate };
}

// Plays the private recorded fixture instead of a camera.
export function openFixture(video) {
  video.src = CAMERA.fixtureUrl;
  video.loop = true;
}

export function releaseTracks() {
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
}

export function closeVideo(video) {
  releaseTracks();
  video.pause();
  video.srcObject = null;
  video.removeAttribute('src');
}
