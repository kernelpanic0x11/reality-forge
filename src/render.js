// All Canvas drawing: the camera plate, person mask, background, overlays, and
// compositing the 3D object into the picture (occlusion and cast light).
import { STAGE, OUTPUT, SEGMENT, ORB, ORB3D, LIGHT, DEPTH, JOINTS, THROW, COLORS } from './config.js';
import { HAND_BONES, PALM_OUTLINE, FINGERTIPS, boneOcclusion, handHidesOrb } from './depth.js';
import { createOrb3D } from './scene3d.js';

const { width: W, height: H } = STAGE;

export function createScene() {
  return {
    state: 'idle', // idle | grabbed | released | throwing | impact
    orb: { x: W * ORB.home.x, y: H * ORB.home.y },
    orbPxPerMeter: null, // apparent scale at the object's depth, once it has been held
    orbBasis: null,      // palm orientation of the holding hand
    world: 0,      // number of background swaps; 0 shows the plain camera
    transition: 0,
    throwStart: 0,
    throwFrom: null,
  };
}

export function createRenderer(stage) {
  // The stage is drawn at OUTPUT size, but all drawing code works in STAGE
  // coordinates: this one scale factor maps between them.
  stage.width = OUTPUT.width;
  stage.height = OUTPUT.height;
  const K = OUTPUT.width / W;
  const ctx = stage.getContext('2d');
  ctx.setTransform(K, 0, 0, K, 0, 0);
  let source = null; // { video, rotation, mirrored } of the latest frame, for drawing the camera at full sharpness
  // plate: the rotated/mirrored camera frame that the models read.
  const plate = document.createElement('canvas');
  const plateCtx = plate.getContext('2d', { willReadFrequently: true });
  // person: the plate cut out by the mask, for compositing over a background.
  const person = document.createElement('canvas');
  const personCtx = person.getContext('2d');
  const mask = document.createElement('canvas');
  const maskCtx = mask.getContext('2d');
  // layer: the 3D object after hands and body have been cut out of it.
  const layer = document.createElement('canvas');
  const layerCtx = layer.getContext('2d');
  // light: the object's glow, kept only where it lands on the person.
  const light = document.createElement('canvas');
  const lightCtx = light.getContext('2d');
  // probe: a tiny copy of the camera around the object, to read the room light.
  const probe = document.createElement('canvas');
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });
  probe.width = probe.height = 8;
  for (const c of [plate, person, layer, light]) { c.width = W; c.height = H; }

  // Falls back to the flat Canvas object if WebGL is unavailable.
  let orb3d = null;
  try { orb3d = createOrb3D(W, H); } catch (e) { console.warn('3D object unavailable, using the 2D one.', e); }

  let maskReady = false, shownRadius = ORB3D.idleRadiusPx, room = null, lightFrame = 0;

  // Draws the camera, rotated, mirrored and cropped to fill a STAGE-sized area of `c`.
  function drawVideo(c, video, rotation, mirrored) {
    c.save();
    c.translate(W / 2, H / 2);
    if (mirrored) c.scale(-1, 1);
    c.rotate(rotation * Math.PI / 180);
    const swapped = rotation % 180 !== 0;
    const dw = swapped ? H : W, dh = swapped ? W : H;
    const scale = Math.max(dw / video.videoWidth, dh / video.videoHeight);
    c.drawImage(video, -video.videoWidth * scale / 2, -video.videoHeight * scale / 2,
      video.videoWidth * scale, video.videoHeight * scale);
    c.restore();
  }

  // The plate is the small copy of the camera that the tracking models read.
  function drawPlate(video, rotation, mirrored) {
    plateCtx.clearRect(0, 0, W, H);
    drawVideo(plateCtx, video, rotation, mirrored);
    source = { video, rotation, mirrored };
  }

  // Converts a segmenter confidence mask into an alpha mask. Returns false if absent.
  function updateMask(result) {
    const m = result.confidenceMasks?.[0];
    if (!m) return false;
    mask.width = m.width;
    mask.height = m.height;
    const values = m.getAsFloat32Array();
    const img = maskCtx.createImageData(m.width, m.height);
    for (let i = 0; i < values.length; i++) {
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = Math.max(0, Math.min(1, (values[i] - SEGMENT.maskLow) / SEGMENT.maskRange)) * 255;
    }
    maskCtx.putImageData(img, 0, 0);
    maskReady = true;
    return true;
  }

  function drawBackground(t, world) {
    const hue = world % 2 ? 270 : 190;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, `hsl(${hue} 70% 5%)`);
    g.addColorStop(1, `hsl(${hue + 45} 75% 19%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 70; i++) {
      const x = (Math.sin(i * 72.13) * 0.5 + 0.5) * W, y = (i * 97 + t * 0.01) % H;
      ctx.fillStyle = `hsla(${hue + i % 50} 90% 80% / ${0.15 + i % 5 * 0.1})`;
      ctx.beginPath();
      ctx.arc(x, y, 1 + i % 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = `hsla(${hue + 40} 100% 65% / .22)`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      for (let y = 0; y < H; y += 12) {
        const x = W / 2 + Math.sin(y * 0.004 + t * 0.0004 + i * 0.35) * (150 + i * 12);
        y ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // The flat filament object: only used when WebGL is unavailable.
  function drawOrb(t, orb, scale = 1) {
    ctx.save();
    ctx.translate(orb.x, orb.y);
    ctx.scale(scale, scale);
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 120);
    glow.addColorStop(0, '#fa9cff66');
    glow.addColorStop(1, '#ad35ff00');
    ctx.fillStyle = glow;
    ctx.fillRect(-120, -120, 240, 240);
    for (let j = 0; j < 20; j++) {
      ctx.strokeStyle = `hsla(${280 + j * 3} 100% ${65 + j % 3 * 10}% / .65)`;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (let i = 0; i <= 90; i++) {
        const a = i / 90 * Math.PI * 2, r = 47 + 13 * Math.sin(a * 3 + t * 0.002 + j * 0.25);
        const x = Math.cos(a + j * 0.05) * r;
        const y = Math.sin(a) * r * 0.7 + Math.sin(a * 2 + t * 0.003 + j * 0.2) * 16;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // Reads the camera around the object: average color and which side is brighter.
  function sampleRoom(orb, radius) {
    const size = radius * LIGHT.sampleRadiusFactor * 2;
    probeCtx.drawImage(plate, orb.x - size / 2, orb.y - size / 2, size, size, 0, 0, 8, 8);
    const data = probeCtx.getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0, dx = 0, dy = 0, total = 0;
    for (let i = 0; i < 64; i++) {
      const pr = data[i * 4] / 255, pg = data[i * 4 + 1] / 255, pb = data[i * 4 + 2] / 255;
      const luminance = 0.2126 * pr + 0.7152 * pg + 0.0722 * pb;
      r += pr; g += pg; b += pb;
      dx += ((i % 8) - 3.5) / 3.5 * luminance;
      dy += ((i >> 3) - 3.5) / 3.5 * luminance;
      total += luminance;
    }
    const next = { r: r / 64, g: g / 64, b: b / 64, dx: total ? dx / total * 3 : 0, dy: total ? dy / total * 3 : 0 };
    if (!room) room = next;
    else for (const k in next) room[k] += (next[k] - room[k]) * LIGHT.smoothing;
  }

  // The object's glow falling on the person: a soft light clipped to the person mask.
  function castLight(orb, radius, held) {
    if (!maskReady) return;
    const reach = radius * LIGHT.castRadiusFactor;
    lightCtx.globalCompositeOperation = 'source-over';
    lightCtx.clearRect(0, 0, W, H);
    const glow = lightCtx.createRadialGradient(orb.x, orb.y, radius * 0.3, orb.x, orb.y, reach);
    glow.addColorStop(0, `rgba(215,140,255,${held ? LIGHT.castAlphaGrabbed : LIGHT.castAlpha})`);
    glow.addColorStop(1, 'rgba(150,60,255,0)');
    lightCtx.fillStyle = glow;
    lightCtx.fillRect(orb.x - reach, orb.y - reach, reach * 2, reach * 2);
    lightCtx.globalCompositeOperation = 'destination-in';
    lightCtx.drawImage(mask, 0, 0, W, H);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(light, 0, 0);
    ctx.restore();
  }

  // Erases a hand's silhouette from the object layer. `strengths` gives a
  // 0..1 weight per bone; without it the whole hand, palm included, is erased.
  function eraseHand(hand, strengths) {
    layerCtx.lineCap = layerCtx.lineJoin = 'round';
    layerCtx.lineWidth = DEPTH.fingerWidthM * (hand.pxPerMeter || 1300);
    HAND_BONES.forEach(([a, b], i) => {
      const strength = strengths ? strengths[i] : 1;
      if (strength < 0.02) return;
      layerCtx.globalAlpha = strength;
      layerCtx.beginPath();
      layerCtx.moveTo(hand.points[a].x, hand.points[a].y);
      layerCtx.lineTo(hand.points[b].x, hand.points[b].y);
      layerCtx.stroke();
    });
    layerCtx.globalAlpha = 1;
    if (!strengths) {
      layerCtx.beginPath();
      PALM_OUTLINE.forEach((j, i) => i ? layerCtx.lineTo(hand.points[j].x, hand.points[j].y) : layerCtx.moveTo(hand.points[j].x, hand.points[j].y));
      layerCtx.closePath();
      layerCtx.fill();
    }
  }

  // Draws the object where it belongs in depth: lit by the room, lighting the
  // person, and hidden by whatever is in front of it.
  function drawObject(t, scene, scale, handBoxes, options) {
    const { orb } = scene;
    const held = scene.state === 'grabbed';
    const targetRadius = scene.orbPxPerMeter
      ? Math.max(ORB3D.minRadiusPx, Math.min(ORB3D.maxRadiusPx, ORB3D.radiusM * scene.orbPxPerMeter))
      : ORB3D.idleRadiusPx;
    shownRadius += (targetRadius - shownRadius) * ORB3D.radiusSmoothing;
    const radius = shownRadius * scale;

    if (!orb3d) { drawOrb(t, orb, radius / 55); return; }

    if (lightFrame++ % LIGHT.sampleEveryNthFrame === 0) sampleRoom(orb, radius);
    castLight(orb, radius, held);

    // Halo: light, so it spills over fingers instead of being hidden by them.
    const reach = radius * LIGHT.haloRadiusFactor;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(orb.x, orb.y, 2, orb.x, orb.y, reach);
    halo.addColorStop(0, '#fa9cff55');
    halo.addColorStop(1, '#ad35ff00');
    ctx.fillStyle = halo;
    ctx.fillRect(orb.x - reach, orb.y - reach, reach * 2, reach * 2);
    ctx.restore();

    orb3d.render(t, { x: orb.x, y: orb.y, radius, basis: held ? scene.orbBasis : null, room, held });
    layerCtx.globalCompositeOperation = 'source-over';
    layerCtx.clearRect(0, 0, W, H);
    layerCtx.drawImage(orb3d.canvas, 0, 0);

    layerCtx.globalCompositeOperation = 'destination-out';
    for (const hand of handBoxes) {
      if (!hand.points) continue;
      if (hand.owner) eraseHand(hand, boneOcclusion(hand.points));
      else if (handHidesOrb(hand.pxPerMeter, scene.orbPxPerMeter)) eraseHand(hand, null);
    }
    if (options.bodyInFront && maskReady) layerCtx.drawImage(mask, 0, 0, W, H);
    ctx.drawImage(layer, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = LIGHT.filamentBoost;
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }

  // pulse: 0..1, makes the skeleton flare (used for hits in guitar mode).
  function drawJoints(hand, color, pulse = 0) {
    ctx.strokeStyle = ctx.fillStyle = color;
    // Slightly thicker for a moment after a hit; no glow or brightness change.
    ctx.lineWidth = JOINTS.lineWidth * (1 + 0.3 * pulse);
    ctx.save();
    ctx.beginPath();
    for (const [a, b] of HAND_BONES) {
      ctx.moveTo(hand.points[a].x, hand.points[a].y);
      ctx.lineTo(hand.points[b].x, hand.points[b].y);
    }
    ctx.stroke();
    hand.points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, (FINGERTIPS.includes(i) ? JOINTS.tipRadius : JOINTS.radius) * (1 + 0.15 * pulse), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
    ctx.lineWidth = 2.5;
  }

  function drawBoxes(boxes, baseColor, isHand, options = {}) {
    for (const b of boxes) {
      const color = b.color ?? (isHand && b.state === 'grabbed' ? COLORS.grabbed
        : isHand && b.state === 'released' ? COLORS.released : baseColor);
      ctx.strokeStyle = color;
      ctx.globalAlpha = b.opacity ?? 1;
      if (isHand && options.showJoints && b.points) drawJoints(b, color, options.pulse || 0);
      if (isHand && options.hideBoxes) continue; // joints only: the clean look for recording
      const x = Math.max(1, b.x), y = Math.max(1, b.y);
      const w = Math.min(W - 2, x + b.w) - x, h = Math.min(H - 2, y + b.h) - y;
      if (w <= 0 || h <= 0) continue;
      ctx.strokeRect(x, y, w, h);
      if (!isHand) continue;
      const stateLabel = b.state === 'grabbed' ? 'GRAB' : b.state === 'released' ? 'RELEASE' : 'OPEN';
      // "~" marks a distance estimated without calibration.
      const distance = b.distanceM ? ` · ${options.calibrated ? '' : '~'}${Math.round(b.distanceM * 100)} cm` : '';
      const label = b.caption ?? `${b.side.toUpperCase()} · ${stateLabel}${distance}${b.owner ? ' •' : ''}`;
      const ly = Math.max(24, y);
      ctx.fillStyle = COLORS.labelBackground;
      ctx.fillRect(x, ly - 24, ctx.measureText(label).width + 16, 24);
      ctx.fillStyle = color;
      ctx.fillText(label, x + 8, ly - 6);
    }
  }

  function drawTrackingBoxes(faceBoxes, handBoxes, options) {
    ctx.save();
    ctx.lineWidth = 2.5;
    ctx.font = '600 17px system-ui';
    drawBoxes(faceBoxes, COLORS.face, false);
    drawBoxes(handBoxes, COLORS.hand, true, options);
    ctx.restore();
  }

  // Draws one output frame and advances the scene's own animations.
  // options: { showJoints, calibrated, bodyInFront, hideBoxes, pulse }
  function drawFrame(t, scene, faceBoxes, handBoxes, options = {}) {
    if (scene.world) drawBackdrop(t, scene.world, scene.transition);
    else drawCamera();

    const { orb } = scene;
    if (scene.state === 'idle') {
      orb.x = W * ORB.home.x + Math.sin(t * ORB.idleSpeed.x) * ORB.idleDrift.x;
      orb.y = H * ORB.home.y + Math.sin(t * ORB.idleSpeed.y) * ORB.idleDrift.y;
      drawObject(t, scene, 1, handBoxes, options);
    } else if (scene.state === 'grabbed' || scene.state === 'released') {
      drawObject(t, scene, scene.state === 'grabbed' ? ORB.grabbedScale : 1, handBoxes, options);
    } else if (scene.state === 'throwing') {
      // Dormant: nothing sets this state while throw is disabled.
      const p = Math.min(1, (t - scene.throwStart) / THROW.flightMs);
      orb.x = scene.throwFrom.x + (W * THROW.target.x - scene.throwFrom.x) * p;
      orb.y = scene.throwFrom.y + (H * THROW.target.y - scene.throwFrom.y) * p - Math.sin(p * Math.PI) * THROW.arcHeight;
      drawObject(t, scene, 1 - p * 0.9, handBoxes, options);
      if (p === 1) { scene.world++; scene.transition = t; scene.state = 'impact'; }
    } else if (scene.state === 'impact') {
      const p = (t - scene.transition) / THROW.impactMs;
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.strokeStyle = `rgba(210,100,255,${Math.max(0, 1 - p)})`;
      ctx.lineWidth = 35 * (1 - p);
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, Math.max(0, p) * H, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      if (p > 1) scene.state = 'idle';
    }

    drawTrackingBoxes(faceBoxes, handBoxes, options);
  }

  // Brightness and contrast of what the tracker is being shown, 0..1, for the log.
  const meter = document.createElement('canvas');
  const meterCtx = meter.getContext('2d', { willReadFrequently: true });
  meter.width = meter.height = 32;
  function pictureStats() {
    meterCtx.drawImage(plate, 0, 0, 32, 32);
    const data = meterCtx.getImageData(0, 0, 32, 32).data;
    let sum = 0, squares = 0, dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      const luminance = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      sum += luminance;
      squares += luminance * luminance;
      if (luminance < 0.08) dark++;
    }
    const n = data.length / 4, mean = sum / n;
    return { brightness: mean, contrast: Math.sqrt(Math.max(0, squares / n - mean * mean)), darkShare: dark / n };
  }

  // For modes that draw their own picture over the plain camera.
  function drawCamera() {
    ctx.setTransform(K, 0, 0, K, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // Straight from the camera at full resolution; the plate is only a fallback.
    if (source?.video.videoWidth) drawVideo(ctx, source.video, source.rotation, source.mirrored);
    else ctx.drawImage(plate, 0, 0);
  }

  // The person cut out over an animated background. `style` picks the colours
  // and `since` is when it was switched on, for the fade from the camera.
  function drawBackdrop(t, style, since) {
    if (!maskReady) { drawCamera(); return; } // no cut-out yet: keep the camera
    ctx.clearRect(0, 0, W, H);
    drawBackground(t, style);
    personCtx.clearRect(0, 0, W, H);
    personCtx.globalCompositeOperation = 'source-over';
    personCtx.drawImage(plate, 0, 0);
    personCtx.globalCompositeOperation = 'destination-in';
    personCtx.drawImage(mask, 0, 0, W, H);
    ctx.drawImage(person, 0, 0);
    const mix = Math.min(1, (t - since) / THROW.backgroundFadeMs);
    if (mix < 1) {
      ctx.globalAlpha = 1 - mix;
      ctx.drawImage(plate, 0, 0);
      ctx.globalAlpha = 1;
    }
  }

  return {
    plate, ctx, drawPlate, updateMask, drawFrame, drawCamera, drawBackdrop, drawTrackingBoxes, pictureStats,
    get has3D() { return Boolean(orb3d); },
    get objectFrames() { return orb3d ? orb3d.frames : 0; },
  };
}
