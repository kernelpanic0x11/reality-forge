# Reality Forge

Local, camera-driven effects app for portrait video (Instagram Reels). Two modes: Object (pinch to grab a 3D object out of the air) and Guitar (follow both hands and listen while the owner plays). Plain JavaScript ES modules in `src/`, no build step. Python only serves files (`main.py`) and fetches pinned dependencies (`scripts/fetch_deps.py`). See `README.md` for the layout.

## Keeping features from breaking

- After every change run `npm run check` (unit tests, then the headless Chrome smoke test). Do not report work as done if either fails.
- The owner often uses the running app while it is being edited, and `main.py` serves the working tree directly. Get `npm run check` passing before telling them to reload, and treat an intermittent smoke failure as a real bug to find, not a flake to rerun.
- After any visual change, open the screenshots in `tests/output/` and look at them.
- Every behavior the owner asks for gets a named unit test in the same change. Put the logic in a pure module (`tracking.js`, `depth.js`: no DOM, no MediaPipe or Three.js imports) so it can be tested in Node.
- A failing existing test means a feature broke. Fix the code; change the test only if the owner asked for that behavior to change.
- Tunable numbers go in `src/config.js`, not inline.
- The smoke test uses a private recorded fixture (`assets/demo.mp4`, not in Git). It does not prove a live gesture works; say so, and ask the owner to try it on the real camera.

## Troubleshooting

- The running app logs to `logs/latest.jsonl` (JSON lines; see "Session log" in `README.md`). When the owner reports a problem, read that file first: `error`, `console.*`, `hand.state` (pinch `ratio` against the thresholds in `session.start`), `object`, and `stats` (frame rate, `trackMs`).
- When adding a feature, log its state changes with `log()` from `src/log.js`, as events on change and not per frame.

- Audio detection (chord names, hit counting) is tuned against real clips in `assets/clips/`: run `npm run clips` before and after changing `src/pitch.js` or the `AUDIO` settings, and do not tune against synthetic tones alone.

## Constraints

- Everything stays local: no uploads, no recording, server bound to 127.0.0.1. Still frames are saved only on a click of Snapshot, audio only on Save clip, and video only on Record. The microphone is used in guitar mode only: live analysis, never stored or played back except by those buttons.
- Throw-to-background is disabled on purpose. Do not re-enable it unless asked.
- New third-party code is vendored and pinned with a SHA-256 in `dependencies.json`; `vendor/` and `assets/` stay out of Git.
- `main.py` is the single entry point; new servers are added to its `SERVICES` list.
