# Next experiments

1. Validate anatomical left/right labels with each hand, mirrored and unmirrored, and tune for crossings/occlusion.
2. Tune grabbing gestures on dedicated studio takes; avoid accidental pinches while speaking.
3. Tune the 3D object live: calibration accuracy, finger occlusion edges, glow strength, and body occlusion. First version (Three.js object, estimated depth, occlusion, cast light) is in; it has only been run on the recorded fixture.
4. Add a deliberate, optional throw gesture after grab/release is reliable. Keep disabled by default for now.
5. Add wireless camera input after choosing the hardware/source; USB Canon is the working baseline.
6. Recording: a Record button now saves the picture and sound to `recordings/` (added 2026-11-15).

7. Guitar mode: try it on real playing, then tune stroke and attack detection, choose an audio input in the app, and decide what feedback is actually useful.
8. Guitar mode background button: built but switched off (`GUITAR.button.enabled`). Come back to it: check the cut-out with a real person and guitar, and decide what it should toggle.
9. Guitar learning mode (idea, not started): upcoming chords scroll toward a hit line and each hit is scored for timing and for the right chord, using the hit and chord detection that already exist. Needs a way to enter a song's chords and timing.
10. Chord naming sometimes shows a power chord's fifth instead of its root (G5 as D, F#5 as C#, F5 as C, E5 as B). A correction exists in `src/pitch.js` but is switched off (`AUDIO.fifthMargin`): on three real recordings it helped at one setting and not at its neighbours, so it needs more clips before it can be trusted.

No public deployment, publishing, or social automation is part of this project setup.
