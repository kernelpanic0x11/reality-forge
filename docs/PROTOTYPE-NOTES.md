# Early prototype notes

Historical notes from the first prototype, before the code was reorganized. Commands, ports and file names here are out of date; see `README.md` for the current ones.

The prototype ran from a single `server.py`.

Open http://127.0.0.1:8793 in Chrome. Start Canon and allow local camera access.
Select rotation for the current mounting, then fullscreen if useful. No audio capture,
recording, broadcasting, or camera-card writes. All inference runs locally using the
vendored MediaPipe runtime and models; dependency URLs and hashes are in dependencies.json.

Pinch thumb and index finger to summon/grab the ribbon object. Open the palm to display
it. A fast open-hand sweep releases it into an animated background transition. Reset
effect restores the camera background. Stop camera releases the device.

This is a gesture-driven 2D composite. It does not measure a literal throw behind the
body or reconstruct the room. Background replacement uses a person confidence mask;
hair, fast movement and low light can produce edge artifacts. The object is Canvas
filament animation, distinct from the existing offline Blender scene.

Testing controls include a clearly labeled recorded studio fixture and a manual throw
preview. Fixture rotation is 0°. Canon starts at 90° and can be adjusted. On 2026-11-15,
the fixture processed 288 frames with 39 hand detections and 96 masks without a pipeline
error. Manual background transition was visually checked. Visible Chrome subsequently
showed the Canon live picture and animated object. A human live grab-and-throw test is
still needed; the recorded fixture does not establish gesture success.

Runtime: @mediapipe/tasks-vision 0.10.22-rc.20250304 (Apache-2.0 per npm package).
Model documentation: https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
and https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter.

Throw-to-background is temporarily disabled. Fast hand movement no longer launches the object or changes the background. Pinch and palm display remain active.

Tracking overlay: mint face rectangles and lavender hand rectangles (up to two hands), computed on the rotated/mirrored plate. Face detector is local BlazeFace short range. Pinch release preserves the object’s hand-relative offset; nearest-palm association avoids jumping when detection order changes. Regression: `node tests/release.cjs` from this directory. Synthetic stationary release reproduced -17.82 px before the fix and 0.00 px after.

Current interaction: a confirmed pinch enters GRAB (green active-hand box); opening the fingers enters RELEASE (amber). Each change must persist 90 ms with separate close/open thresholds. Release detaches the object at its current position; it no longer follows the open palm. Tracking loss is shown separately and does not count as release. Throw remains disabled. Synthetic tests cover confirmation delay, fixed release position, tracking loss and re-grab.

Both hands now have separate anatomical Left/Right identity and pinch state. Labels are corrected for the Mirror control; handedness comes from MediaPipe rather than detection-array order. The first grabbing hand owns the single object until it releases or is absent for 650 ms. A second hand cannot steal it while held; after release it can grab with a fresh pinch. Each box shows LEFT/RIGHT plus OPEN/GRAB/RELEASE.

Face overlay requires confidence >=0.8, at least three spatially consistent detections over 240 ms. Coordinates are smoothed; brief missing frames fade for up to 220 ms. No scanning/search box is drawn. This suppresses short false positives but does not guarantee the detector never mistakes an object for a face.

Regression command remains `node tests/release.cjs`; it now exercises the shared tracking.mjs module used by the app, including reordered hand detections, independent states, ownership, mirrored labels, transient false faces and face loss. Handedness documentation: https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker.
