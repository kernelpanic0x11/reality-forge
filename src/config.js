// Every tunable number in one place. Nothing here touches the DOM, so the
// Node tests can import it too.

// STAGE is the coordinate space everything is positioned and tracked in.
// OUTPUT is the size the picture is actually drawn and recorded at: full
// Instagram Reel size, so the camera image and overlay stay sharp.
export const STAGE = { width: 720, height: 1280 };
export const OUTPUT = { width: 1080, height: 1920 };

// Recording settings for an Instagram Reel. main.py then finishes the file with
// ffmpeg (constant 30 frames a second, standard colour format, 48 kHz sound).
export const RECORDING = { fps: 30, videoBitsPerSecond: 20_000_000, audioBitsPerSecond: 256_000 };

export const CAMERA = {
  preferredLabel: /canon/i,  // picked by default when connected; any listed camera can be used
  width: 1920,
  height: 1080,
  frameRate: 30,
  preferredRotation: '90',   // the Canon is mounted sideways
  otherRotation: '0',        // built-in and other webcams are upright
  fixtureRotation: '0',
  fixtureUrl: '/demo.mp4',
};

export const MODELS = {
  wasmPath: './vendor/wasm',
  delegate: 'GPU',
  hand: { path: './vendor/models/hand.task', numHands: 2, minDetectionConfidence: 0.55, minTrackingConfidence: 0.55 },
  face: { path: './vendor/models/face.tflite', minDetectionConfidence: 0.6 },
  person: { path: './vendor/models/person.tflite' },
};

export const HAND = {
  minHandednessScore: 0.65, // a Left/Right label less sure than this does not vote on a hand's side
  sideVoteFlip: 2,          // summed label confidence needed before a hand's side changes
  sideVoteLimit: 3,         // cap on that sum, so a long history can still be overturned
  matchSizeFactor: 2.5,     // a hand may move this many hand-sizes between frames and stay the same hand
  matchMinPx: 150,          // ...and at least this many pixels
  duplicateFactor: 0.5,     // two detections closer than this many hand-sizes are one hand
  pinchCloseRatio: 0.35,    // thumb-index gap / palm width below this closes an open hand
  pinchOpenRatio: 0.58,     // a pinched hand must exceed this to open (hysteresis)
  confirmMs: 90,            // a pinch change must persist this long
  reappearMs: 180,          // after a gap this long, the confirmation timer restarts
  lostMs: 650,              // owner absent this long releases the object
  boxPadding: 18,           // px around the landmarks for the overlay box
  follow: 0.55,             // per-frame smoothing of the object toward the pinch point
};

export const FACE = {
  minScore: 0.8,
  minSize: 30,              // px, both width and height
  consistencyMinPx: 45,     // a detection is "the same face" within max(this,
  consistencyWidthFactor: 0.65, // this * box width) of the previous one
  confirmCount: 3,
  confirmMs: 240,
  dropoutMs: 220,           // tolerated gap before the face resets
  smoothing: 0.3,
  fadeDelayMs: 70,
  fadeMs: 150,
};

export const SEGMENT = {
  everyNthFrame: 3,
  maskLow: 0.2,             // confidence mapped to alpha 0
  maskRange: 0.6,           // confidence span mapped to alpha 0..1
};

export const ORB = {
  home: { x: 0.62, y: 0.43 },            // fraction of the stage
  idleDrift: { x: 45, y: 25 },           // px
  idleSpeed: { x: 0.0008, y: 0.0012 },   // radians per ms
  grabbedScale: 1.15,
};

// Throw-to-background is disabled: nothing triggers it. These drive the
// dormant animation kept for roadmap item 4.
export const THROW = {
  flightMs: 650,
  arcHeight: 180,
  target: { x: 0.5, y: 0.32 },
  impactMs: 850,
  backgroundFadeMs: 650,
};

export const COLORS = {
  face: '#69f5d4',
  hand: '#c495ff',
  grabbed: '#7fff83',
  released: '#ffcf80',
  labelBackground: '#090b12dd',
};

// Depth is estimated from how large the hand appears, using MediaPipe's
// metric hand model. Calibrate replaces the two defaults below.
export const DEPTH = {
  defaultFocalPx: 1400,       // camera focal length in stage pixels (a guess until calibrated)
  defaultFaceWidthM: 0.16,    // real width of the face box (a guess until calibrated)
  scaleSmoothing: 0.35,       // per-frame smoothing of a hand's apparent scale
  handInFrontRatio: 1.12,     // a hand appearing this much larger than the object's scale is in front of it
  behindBodyMarginM: 0.12,    // the object must be this far behind the face to go behind the body
  bodyOcclusionNeedsCalibration: true,
  boneSoftnessPx: 14,         // depth range over which a finger fades from behind to in front
  fingerWidthM: 0.02,
  calibration: {
    countdownMs: 3000,
    sampleMs: 1000,
    minSamples: 8,
    storageKey: 'reality-forge.calibration',
  },
};

export const ORB3D = {
  radiusM: 0.045,             // real-world radius of the held object
  idleRadiusPx: 58,           // size before it has ever been grabbed
  minRadiusPx: 18,
  maxRadiusPx: 220,
  radiusSmoothing: 0.2,
  rotationSmoothing: 0.25,    // how quickly it follows the wrist
  idleSpin: 0.0006,           // radians per ms when not held
  cameraDistancePx: 1400,     // virtual camera distance; only sets how strong the perspective looks
};

// Light the object casts on you, and the room light it picks up.
export const LIGHT = {
  castRadiusFactor: 3.6,       // glow radius on skin, in object radii
  castAlpha: 0.32,
  castAlphaGrabbed: 0.45,
  haloRadiusFactor: 2.2,
  filamentBoost: 0.3,         // extra additive pass that makes the thin filaments glow
  sampleEveryNthFrame: 6,     // how often the room color is re-sampled
  sampleRadiusFactor: 3,
  smoothing: 0.15,
};

// Session log written to logs/latest.jsonl by main.py.
export const LOGGING = { statsEveryMs: 2000 };

export const JOINTS = { lineWidth: 2, radius: 3.5, tipRadius: 5 };

// Mr. Robot terminal palette, used by guitar mode and the toolbar.
export const THEME = {
  green: '#00ff41',
  background: '#0a0a0a',
  panel: '#111111',
  border: '#333333',
  red: '#ff0000',
  yellow: '#ffff00',
  muted: '#666666',
  text: '#cccccc',
  font: '"Courier New", monospace',
};

// Guitar mode: follows the fretting and picking hands and listens to the guitar.
export const GUITAR = {
  trailMs: 600,              // how long fingertip trails stay on screen
  speedSmoothing: 0.3,
  gapMs: 250,                // a hand unseen this long restarts its motion measurements
  minStrokeM: 0.006,         // the pick must travel this far before a reversal counts as a stroke
  rateWindowMs: 4000,        // strokes and notes per minute are averaged over this window
  shiftM: 0.05,              // the fretting hand moving this far along the neck is a position shift
  settleCmPerS: 8,           // ...once it slows below this speed
  fallbackPxPerMeter: 1300,  // used when the hand's real scale is unknown
  pitchEveryNthFrame: 1,     // every frame, so short muted hits are read often enough to be named
  noteHoldMs: 400,           // the note name stays on screen this long after the pitch is last heard
  noteDelayMs: 80,           // pitch is read this long after an attack, once the pick noise has passed
  learnFrames: 15,           // confident frames with both hands in view before each role's usual place is used
  confidentLabel: 0.9,       // Left/Right labels this sure, on both hands, decide the roles directly
  // Low light and small hands: whenever the tiles miss a hand, look again in a zoomed-in,
  // brightened crop around where that hand was last seen. With no idea where a hand is,
  // sweep the picture one crop per frame until it turns up.
  recover: {
    giveUpMs: 8000,          // stop following a spot this long after the hand was last seen there
    cropPx: 360,
    nearPx: 140,             // a tile detection this close to the spot means the hand is already found
    scanStepPx: 180,
    sweepAfterMs: 300,       // a hand missed this long at its expected spot: sweep outward from there
    predictMs: 120,          // follow a moving hand by assuming it kept going, up to this far ahead
    tilesEveryNthFrame: 4,   // while both hands are being followed up close, the wide search runs less often
    targetBrightness: 0.5,   // dark pictures are brightened toward this before searching
    minGain: 1.3,
    maxGain: 5,
  },
  homeSmoothing: 0.05,       // how quickly a role's usual place follows the hand
  clipSeconds: 30,           // length of a saved test clip
  clipMinSeconds: 3,         // a clip stopped sooner than this is thrown away
  noSignalMs: 5000,          // audio quieter than silence for this long shows "no signal"
  // Hands on a guitar are small, partly hidden and often in coloured light, so guitar
  // mode looks for them in overlapping square tiles and accepts less certain detections.
  detection: { tileOverlapPx: 160, detect: 0.3, presence: 0.3, tracking: 0.3 },
  // The on-screen button: rest a fingertip on it to switch the background. Position is a
  // fraction of the picture; drag it with the mouse to place it (the place is remembered).
  // Switched off for now; set `enabled: true` to bring it back.
  button: { enabled: false, x: 0.26, y: 0.6, radiusPx: 46, dwellMs: 350, cooldownMs: 900, storageKey: 'reality-forge.button' },
  // The reel look: a big chord name that nudges on each hit, and a gentle pulse through
  // the hands and trails. Deliberately restrained: nothing flashes, nothing fills the
  // screen, and at most a few animated hits per second, however fast the playing.
  show: {
    chordY: 0.2,             // where the chord name sits, as a fraction of the picture height
    chordPx: 150,
    stableReads: 4,          // the same name must be read this many times before it is shown (about 0.13 s)
    popMs: 220,              // how long the nudge on a hit lasts
    popScale: 0.07,          // how much the name grows at the moment of a hit
    holdMs: 900,             // the name stays this long after it was last heard...
    fadeMs: 600,             // ...then fades out over this long
    pulseMs: 280,            // how long hands and trails stay slightly thicker after a hit
    pulseWidth: 0.3,         // how much thicker
    ringMs: 420,             // the thin ring that spreads from the picking hand
    ringPx: 150,
    ringAlpha: 0.35,
    holdHandMs: 250,         // a hand that drops out keeps being drawn this long, so one missed frame does not blink
    heldAlpha: 0.6,
    minHitGapMs: 330,        // hits closer together than this share one animation (about 3 per second)
  },
  colors: { fret: THEME.green, pick: THEME.text },
};

// Audio is analysed live and never recorded, saved or sent anywhere.
export const AUDIO = {
  fftSize: 4096,
  silenceRms: 0.004,         // below this level no pitch is reported
  // The next four values were tuned on real clips of guitar playing (assets/clips), not on synthetic tones.
  pitchGate: 0.3,            // ...nor below this fraction of the loudest recent playing: the quiet tail of a
                             // chord and the noise between hits were being read as stray notes
  hitGate: 0.05,             // hits quieter than this fraction of the loudest recent playing are ignored
  minHz: 38,                 // low enough to catch the "phantom" bass note a power chord produces
  lowestNoteHz: 70,          // no guitar string sounds below this (covers drop D); lower means a power chord
  fluxFftSize: 4096,         // window used to spot attacks by how the tone changes. It must span several
                             // cycles of the lowest notes: a short window sees a ringing low chord as
                             // constantly changing and counts hits that never happened.
  fluxMinHz: 60,
  fluxMaxHz: 6000,
  maxHz: 1200,
  fifthMargin: 0,            // see the power chord check in pitch.js (0 = off)
  yinThreshold: 0.3,         // how clearly a sound must repeat to be named. Distorted power chords are less
                             // clean than single notes; at 0.15 most of them went unnamed
  // An attack is either a jump in loudness (louder than `floor`, `ratio` times the recent average and
  // `rise` times the previous reading), or a sudden change in tone (`flux` or more, and `fluxRatio` times
  // its recent average). The second catches a new chord hit while a distorted one is still ringing.
  onset: { ratio: 1.8, rise: 1.3, floor: 0.006, minGapMs: 70, smoothing: 0.15, flux: 0.35, fluxRatio: 2 },
};
