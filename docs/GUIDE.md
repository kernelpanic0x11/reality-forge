# Run it yourself

This is the code behind the guitar hand and note tracking reel. It runs entirely on your own computer: one camera, a browser, and no account, no cloud, no upload.

You do not need to know JavaScript or machine learning to run it. If you can paste three commands into a terminal, you can have your own hands tracked in about five minutes.

## What you get

- **Guitar mode.** The joints of both hands drawn over the live picture, fading fingertip trails, and a big letter showing the note or power chord it hears (A, G, F#).
- **Object mode.** Pinch your thumb and index finger to grab a glowing 3D object out of the air and move it around.
- **Record.** Saves the picture with the overlay as a 1080 by 1920, 30 fps MP4, ready for a vertical video.

## What you need

| Thing | Notes |
| --- | --- |
| A computer with a camera | Built on a Mac. Nothing in it is Mac-only, but Windows and Linux are untested. |
| Google Chrome | The only browser it has been tested in. |
| Python 3 | Already on most Macs. Check with `python3 --version`. |
| Git | To download the code. |
| For guitar mode: a way to get the guitar's sound in | An audio interface, or a microphone close to the amp. A laptop mic across the room will not hear an electric guitar well enough. |
| Optional: ffmpeg | Only for **Record**. Without it you still get a video, in the browser's own format. |

No GPU setup, no API keys, no `npm install`.

## Install

```sh
git clone https://github.com/kernelpanic0x11/reality-forge.git
cd reality-forge
python3 scripts/fetch_deps.py
```

The last command downloads the hand tracking models and Three.js (about 28 MB) into a `vendor/` folder and checks every file against a pinned SHA-256 hash before keeping it. It should end with `Verified 9 pinned files in vendor/.`

## Start it

```sh
python3 main.py
```

Leave that terminal open, then go to http://127.0.0.1:8794 in Chrome.

1. Pick your camera in the **Camera** list.
2. Click **Start** and allow camera access.
3. If the picture is sideways or upside down, change the rotation list (0°, 90°, 180°, 270°). **Mirror** flips it left to right.

The picture is portrait. A normal landscape webcam is cropped to its centre strip, so stand in the middle.

Press Ctrl+C in the terminal to shut it down.

## First test: grab the object

Start in **Object** mode (the default) to check that tracking works before you bring a guitar into it.

- Hold a hand up. You should see its joints drawn and a label: OPEN, GRAB or RELEASE.
- Pinch thumb and index finger near the object to grab it. Open your hand to let go.

If your hand shows joints here, the hard part works on your machine.

## Guitar mode

Switch the **Mode** list to **Guitar**. Chrome will ask for microphone access; that is the guitar's audio input.

### Framing

- Portrait, with both hands and the whole neck in the picture.
- Sit close enough that your hands are not tiny. The model has to find them in the frame, and small hands are the first thing it loses.

### Light

This matters more than anything else.

- Light your **hands**, not just the room. A lamp or light strip aimed at the guitar is enough.
- Neutral white light tracks best. Strong coloured light (teal, purple, red) makes hands much harder to find.
- It can work in a dim, moody room as long as something is pointed at your hands.

### Sound

- Pick your input in the audio list that appears in guitar mode.
- Best: an audio interface. Good: a microphone right next to the amp speaker.
- Tick **Stats** to see the level meter. If it says **no signal**, the wrong input is selected or it is too quiet.

### Playing

- Right-handed players fret with the left hand. Tick **Lefty** if you are the other way round.
- Show the camera both hands at once for a second when you start. The app learns where each hand sits and uses that from then on.
- **Stats** adds a practice panel: the note with how sharp or flat it is, pick strokes per minute, position shifts along the neck, and notes per minute. Untick it for the clean look.

## Record a take

1. Untick **Stats** (it records exactly what is on screen).
2. Click **Record**, play, then click **Stop rec**. The button shows **Saving…** for a few seconds.
3. Your video is in the `recordings/` folder as `reel-<date>-<time>.mp4`.

## When it does not work

| What you see | What to try |
| --- | --- |
| No joints on your hands | More light on your hands, less coloured light, move closer. This is the cause nine times out of ten. |
| It loses the fretting hand during fast slides | Brighter light on the neck. It finds the hand again by itself, usually within a second. |
| Picture is sideways | Change the rotation list. |
| **no signal** in the Stats panel | Choose the right audio input; move the mic closer to the amp. |
| The letter shows the wrong note | See the limits below. Low power chords are sometimes read as their fifth (a G shown as D). |
| The page says the code failed to load | Run `python3 scripts/fetch_deps.py` again, then reload. |
| `Address already in use` when starting | Something else is using port 8794, usually another copy of this. Close it and start again. |
| Nothing happens after **Start** | Check that Chrome has camera permission (the camera icon in the address bar, and your system privacy settings). |

For anything else, the app writes a plain text log of what it is doing to `logs/latest.jsonl`. It holds events and numbers only, never pictures or sound.

## What it does not do

Being straight about the limits:

- It names **single notes and power chords**. Full chords (open G, barre shapes with a third) are not recognised.
- The chord letter is sometimes the fifth of the chord and not the root.
- It does not know which fret or string you are on. It tracks where your hands are and listens to what comes out.
- 30 frames a second. Very fast picking is counted more reliably from the sound than from the picture.
- Depth in object mode is estimated from how big your hand looks. It is convincing, but it is not a depth camera.

## Privacy

- The server only listens on your own machine (`127.0.0.1`). Nothing is uploaded anywhere.
- After the one-time model download, it works with the network off.
- The camera and microphone are analysed live and thrown away. Three buttons save something to disk, and only when you click them: **Record** (video), **Snapshot** (one still frame) and **Save clip** (30 seconds of audio).

## How it works, in one minute

- **Hands:** Google's MediaPipe hand model runs in your browser and returns 21 points per hand. Hands on a guitar are small and half hidden, so guitar mode searches the frame in overlapping tiles, and when a hand drops out it searches a zoomed, brightened crop around where that hand was last seen.
- **Notes:** the pitch comes from the YIN algorithm on the live audio. Hits are counted from sudden changes in loudness and tone.
- **Drawing:** a plain canvas for the overlay and Three.js for the 3D object.
- **No build step:** plain JavaScript modules served by a small Python file. Open `src/config.js` and every number that shapes the behaviour is there to change.

## Make it yours

- Colours and font: `THEME` in `src/config.js`.
- How long trails last, how big the chord letter is, how strong the hit animation is: `GUITAR` in `src/config.js`.
- `npm test` runs the unit tests (needs Node 20 or newer) so you can tell whether a change broke something.
- The code is MIT licensed. Fork it, change it, post what you make.

The full reference is in the [README](../README.md).
