# Reality Forge

A local, camera-driven effects playground. Grab glowing objects out of the air with your hands and blend live effects into your space.

## Run

Python 3 and Chrome are enough; the local checkout includes pinned tracking models.

```sh
python3 main.py
```

Open http://127.0.0.1:8794, pick a camera in the list, click **Start**, and allow camera access. The same button becomes **Stop** while the camera is running. The Canon is selected by default when it is connected (put it into USB UVC/UAC streaming first); otherwise the first camera is, such as the MacBook's built-in one. The Canon starts at 90° rotation and other cameras at 0°; adjust rotation and Mirror for your mounting. The picture is portrait, so a landscape webcam is cropped to its centre strip. The camera is currently wired; wireless input is future work.

## Current interaction

- Separate anatomical left/right hand boxes and OPEN / GRAB / RELEASE states.
- Pinch thumb + index finger to grab; open to release in place.
- The first grabbing hand owns the single object until release or a sustained tracking loss. The other hand cannot steal it.
- Each hand is followed by its position. MediaPipe's Left/Right label flickers, so it only votes on what a hand is called, and the holding hand is never renamed.
- Face box uses confidence gating, confirmation, coordinate smoothing and brief dropout tolerance.
- Throw-to-background is disabled for now.
- Hand and finger joints are drawn over each hand; the **Joints** checkbox hides them.
- Each hand label shows its estimated distance from the camera (`~` means uncalibrated).
- Compact toolbar and fullscreen preview. No bottom controls or instructions.

## Modes

The **Mode** list in the toolbar switches between two experiments. The choice is remembered.

- **Object**: grab the 3D object out of the air (everything described below).
- **Guitar**: follow both hands while you play, and listen to the guitar.

## Guitar mode

Built for portrait reel framing. By default it shows the clean look for recording:

- The joints of both hands, with fading fingertip trails.
- A big root-note letter near the top (A, G, F#) that nudges slightly on each hit and fades when the sound stops. A letter is only shown once it has been read twice, so stray misreads do not appear.
- On each hit the hands and trails thicken slightly for a moment, and a thin, faint ring spreads from the picking hand.

The look follows the Mr. Robot terminal palette (green on black, monospace; see `THEME` in `src/config.js`). The animation is deliberately restrained: nothing flashes or changes brightness, nothing fills the screen, and hits closer together than a third of a second share one animation. This has not been checked against a formal photosensitivity standard.

Tick **Stats** in the toolbar to add the hand boxes and a readout panel for practice:

- **Note**: the pitch being played, with how many cents sharp or flat it is, and an input level meter.
- **Pick**: pick strokes per minute and in total. A stroke is a reversal of the pick's direction, so down and up strokes each count.
- **Fret**: position shifts along the neck, and how fast the fretting fingers are moving.
- **Notes**: attacks heard per minute and in total.

**Background button (currently switched off).** It is disabled with `GUITAR.button.enabled` in `src/config.js`; set that to `true` to bring it back. When enabled, a round **BG** button is drawn in the picture. Rest any fingertip on it for about a third of a second (a ring fills as you hold) and the background behind you switches to an animated one; do it again to switch back. A hand passing through does nothing. Drag the button with the mouse to place it, for example just above the neck; the place is remembered. Clicking it with the mouse also presses it. The cut-out comes from a person mask, so edges around hair, fast movement and the guitar itself can be rough.

A right-handed player's left hand is the fretting hand; tick **Lefty** to swap. Left/Right detection is unreliable on a hand wrapped around a neck, so once both hands have been seen together the app remembers where each one sits and assigns roles by position. The session log records all of this every 2 seconds, plus one line per note heard.

Pick the audio input in the toolbar list that appears in guitar mode (an audio interface or amp-facing mic will work far better than the laptop mic on an unamplified electric guitar). The readout says **no signal** when the input stays silent. It is analysed live in the browser and discarded: nothing is recorded, saved, played back or uploaded. If no input is available the hands are still tracked. The microphone is only opened in guitar mode.

Hands on a guitar are small, partly hidden and often in coloured stage light, which defeats the hand model on a full portrait frame. Guitar mode therefore looks for hands in two overlapping square tiles, accepts less certain detections, and when a hand drops out it searches a zoomed-in, contrast-boosted crop around where that hand was last seen. Brighter, more neutral light on the hands still tracks best.

It names single notes and power chords (for example **A5**); full chords are not recognised yet. Fast picking can outrun a 30 fps camera, so the audio note count is the more reliable measure of speed.

## 3D object, depth and lighting

The object is a Three.js crystal with filament rings, drawn on a transparent layer over the camera.

- **Rotation and size.** While held it turns with your wrist. It has a fixed real-world size (4.5 cm radius), so it grows and shrinks as your hand moves toward or away from the camera, and keeps its depth where you release it.
- **Occlusion.** Fingers of the holding hand that are nearer the camera than the pinch are drawn in front of it. Any hand that passes clearly in front of a released object hides it. After calibration, the object also goes behind your body when it is farther away than your face.
- **Light.** The object glows onto you (clipped to the person mask), and its own lighting is tinted by the camera colors around it.

Depth comes from one ordinary camera: it is estimated from how large the hand appears, using MediaPipe's metric hand landmarks. It is convincing for a held object but it does not measure or reconstruct the room. Finger occlusion uses landmark-based finger shapes, so edges are approximate.

### Calibrate

Uncalibrated, hand-versus-object depth already works, but distances in cm are rough and body occlusion is off.

1. Measure roughly how far your face is from the camera and type it into the **cm** box.
2. Click **Calibrate**, then hold an open hand beside your face, at the same distance from the camera, through the 3 second countdown and the 1 second measurement.

This sets the camera's focal length and your face width as seen by the detector. It is saved in the browser. Recalibrate after changing rotation, zoom or camera; shift-click **Calibrate** to clear it.

Frames and inference stay local. No recording, upload, broadcast or card deletion. The microphone is used only in guitar mode, for live analysis that is never stored. Server binds only to localhost.

## Layout

```
main.py            Single entry point: starts all local services (today, the localhost web server)
src/
  index.html       Page and toolbar
  app.js           Entry point: wires the toolbar, camera, models and frame loop
  config.js        Every tunable number: pinch thresholds, timings, model settings, colors
  tracking.js      Hand and face interaction logic (no DOM; shared with the tests)
  depth.js         Depth, calibration, palm orientation and occlusion math (no DOM; tested)
  scene3d.js       The Three.js object
  guitar.js        Guitar mode: hand roles, pick strokes, position shifts, hand motion (no DOM; tested)
  pitch.js         Level, pitch detection, note names, attack detection (no DOM; tested)
  audio.js         Live audio input for guitar mode
  guitarview.js    Guitar mode drawing: fingertip trails, the readout panel and the on-screen button
  hotspot.js       The press-by-resting-a-fingertip button logic (no DOM; tested)
  tiles.js         Splits the frame into square tiles for hand detection and merges the results (no DOM; tested)
  clipanalysis.js  Runs the live audio analysis over a saved clip, for tests and `npm run clips` (no DOM; tested)
  wav.js           WAV writer and reader for test clips (no DOM; tested)
  log.js           Session log sender; telemetry.js decides which tracking changes are worth logging
  camera.js        Camera selection and the recorded fixture
  models.js        Loads the local MediaPipe models
  render.js        Canvas drawing and compositing: camera, masks, occlusion, cast light, overlays
tests/             Unit tests (*.test.js) and the browser smoke test (smoke.js)
scripts/           fetch_deps.py restores vendor/ from dependencies.json
docs/              Prototype history and notes
dependencies.json  Pinned upstream URLs and SHA-256 hashes
vendor/            MediaPipe runtime and models, Three.js (local, not in Git)
assets/            Private recorded fixture (local, not in Git)
```

The app is plain JavaScript (ES modules, no build step). Python is used only for the local server and the dependency fetcher.

## Check

```sh
npm test         # unit tests: fast, no browser (Node 20 or newer)
npm run smoke    # runs the real app in headless Chrome on the recorded fixture
npm run check    # both
```

Unit tests cover the pure logic: hand states, reversed detection order, object ownership, release position, tracking loss, mirrored labels, face stability, depth, calibration and occlusion decisions.

**Test clips of real playing.** In guitar mode, **Save clip** records up to 30 seconds of your playing to `assets/clips/` (private, not in Git). Click it again (**Stop clip**) to end early; stopping the camera also keeps what was recorded, as long as it is at least 3 seconds. `npm run clips` prints what the app hears in each clip: hits, the letters read, and what the big display would show (`-- --hits` lists every hit). Put a `<clip name>.json` beside a clip to make `npm test` check it on every change, for example `{ "letters": ["A", "G", "F#", "F", "E"], "hits": { "min": 40, "max": 60 }, "minNamedShare": 0.5 }`.

The smoke test needs Chrome and `assets/demo.mp4`. It fails on any page error, or if frames, hands, the face, person masks, the 3D object or the fixture's grab stop working. It also starts Chrome's synthetic camera through the live-camera path, and it saves screenshots to `tests/output/` for a visual check. Neither replaces trying a change live on the Canon.

For the private recorded fixture, run this in the browser development console:

```js
await (await import('./app.js')).start(true)
```

This fixture is prerecorded studio footage, not evidence of a live gesture test. `assets/` is local and excluded from Git, so the smoke test and this fixture only run where that file exists; `npm test` runs anywhere.

## Recording a take

Click **Record** to start and **Stop rec** to stop. The video is saved to `recordings/` on this Mac (not in Git) as `reel-<date>-<time>.mp4`, in Instagram Reel format: 1080 by 1920, a constant 30 frames a second, H.264 with AAC sound at 48 kHz from the selected audio input. The picture is drawn at that size from the camera's full resolution, and `main.py` finishes the file with ffmpeg after you stop (if ffmpeg is missing, the browser's own file is kept with `-raw` in its name). Stopping the camera also stops and saves the recording. It records exactly what is drawn, so untick **Stats** for the clean look.

## Session log

While the app runs it writes a text log of what it is doing to `logs/latest.jsonl` (one file per `main.py` run, the newest 30 kept, excluded from Git). It contains events only, never frames or audio, and stays on this machine. The exceptions are three buttons that save only when clicked: **Record** saves a video of the picture (overlay included, toolbar not) with the audio input to `recordings/`; **Snapshot** saves a single still frame (the raw camera picture and the screen with its overlay) to `logs/` for troubleshooting, and **Save clip** (guitar mode) saves 30 seconds of the audio input to `assets/clips/`. Nothing saves images or audio otherwise.

- **Setup:** cameras found, the camera and resolution actually delivered, rotation, mirror, model load time, the thresholds in use.
- **Interaction:** each hand appearing, changing state (with its pinch ratio and distance) or being lost; the object being grabbed and released; the face appearing; body occlusion switching.
- **Health, every 2 seconds:** frame rate, tracking time per frame, current hand and object positions and distances, picture brightness and contrast, and how many hands the model itself reported.
- **Problems:** page errors, pipeline failures, and console warnings. If the app's code fails to load at all, the page says so and a `load-failure` line is logged.
- **Calibration:** the samples taken and the values saved.

## Dependencies and origin

MediaPipe Tasks Vision 0.10.22-rc.20250304 (hand landmarker, selfie segmenter and BlazeFace short-range detector) and Three.js 0.170.0 (MIT). `dependencies.json` records exact upstream URLs and SHA-256 hashes. `vendor/` is local and excluded from Git; use `python3 scripts/fetch_deps.py` to restore pinned files in another checkout.

This started as a quick prototype for a short video and grew into its own project. See `docs/PROTOTYPE-NOTES.md` for the early experiment history.

## License

MIT; see `LICENSE`. The MediaPipe runtime and models (Apache-2.0) and Three.js (MIT) are downloaded by `scripts/fetch_deps.py` and are not part of this repository.
