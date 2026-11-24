# Steam spider

A steam-driven mechanical spider walking with procedural animation in three.js: planted feet,
distance-triggered tripod steps, analytic leg IK and a body that rides its feet. It walks over a
prototype-grid obstacle course of pipes, gears, I-beams, crates, a ramp and a stepped wall.

## Run it

```
npm install
npm run dev          # http://127.0.0.1:5391
```

Controls: point at the floor (or tap and drag) to lead the spider, the arrow keys steer it like a tank,
Space vents steam, `P` toggles pixel mode, `T` the obstacles, `C` the camera (free, side, hero), `R` replays
the scripted run, `H` hides the controls. Query flags: `record=1` (manual clock, no UI), `manual=1`, `script=1`,
`camera=side|hero|orbit`, `pixel=1`, `terrain=0`, `model=standin`.

## Model

`src/rig.js` loads `assets/spider.glb` when it exists and otherwise builds a stand-in with the same node graph
(`src/standin.js`). Lengths, hip positions, rest feet and ride height come from the extras. When an extra is
missing or disagrees with the joints, the rig falls back to the node graph and logs a warning.

## How it walks

- **Body:** it chases the target with limited acceleration and turn rate. Facing away, it pivots in place
  and only strides out once it is lined up. It slows down when planted feet are being dragged out of reach.
- **Steps:** each foot's home is its rest position under the moving body. When a foot drifts more than
  0.42 units from home, its tripod (L1 R2 L3 or R1 L2 R3) steps. Only one tripod is ever in the air. The
  landing spot is home predicted a little ahead along the body's motion and turn, raycast onto the obstacles,
  and nudged forward or back off steep faces.
- **Step shape:** a machine cycle, not an arc. The foot hoists straight up, swings across on a geared
  constant-speed profile, then drives down and stops dead. The tarsus folds in during the hoist and snaps out
  before contact, and the legs in a tripod start a few frames apart.
- **IK:** the coxa yaws toward the foot. The tarsus is held near vertical with a lean that follows the reach,
  which fixes the ankle. The femur and tibia then solve the two-bone problem with the knee up, so the knees
  ride high above the body.
- **Body pose:** height, pitch and roll follow a least-squares plane through the feet on damped springs, with
  a jolt at every plant, a sag at every lift and a sideways sway over the supporting tripod. A floor of
  hull clearance keeps the belly off whatever is underneath.
- **Clock:** one fixed 1/60 s step drives everything, and particles use a seeded generator, so the live
  page and the frame-stepped recorder integrate the same way and every recording of the script matches.

## Checks

`smoke.mjs` frame-steps the full 20 s scripted run and fails if any of these is broken: planted feet never
move, the Tip node sits on its planted foot (IK reaches), both tripods are never in the air together, at
least three feet are always down, knees stay above ankles, the hull clears the ground, the spider reaches
the end of the course and ends up facing back. It also saves seven review screenshots and
`artifacts/smoke/smoke-report.json`, and measures the live frame rate in both render modes.

The hull's underside is measured as the median height a grid of upward rays hits, not the bounding box,
so hanging cables and mandibles do not count as belly.

## Recordings

`record.mjs` plays the same scripted run for each shot: 600 frames at 30 fps, 1920x1080, H.264 yuv420p, UI
hidden. The run goes straight down the course, vents steam at the far end, turns around toward the camera
and walks back onto the steps. Each frame is encoded from the canvas in the page and piped to ffmpeg. A shot
takes about three minutes to capture. `artifacts/recording-report.json` holds the ffprobe result, the model
used and a one-second timeline per shot. `artifacts/gait-frames/` holds the 10 fps frame sheets used to
judge the gait.

## Battle video

`artifacts/battle/final/` holds the side-by-side comparison with the GPT-6 Astra spider in
`../procedural-pet`. Both sides play the same 22 s shot from `src/orbit-storyboard.mjs`: the spider stands
for 6 s, walks its course, is told to halt at 15.2 s and vents steam at 17 s. The camera swings half a turn
from the front around the +X flank to the rear, swings back while the spider walks, then pushes in on the
head. It swings back instead of closing the circle because this room's back wall stands 4.6 units off the
track, closer than the camera's orbit. Lengths are in leg spans (the distance between the outermost left and
right resting feet), so both models get the same framing.

```
node record.mjs orbit                     # opus-orbit.mp4, opus-orbit-events.json
node ../procedural-pet/record-orbit.mjs   # astra-orbit.mp4, astra-orbit-events.json
node battle-audio.mjs                     # battle-mix.wav, battle-sfx.wav, battle-music-bed.wav, audio-report.json
node ../../tools/battle-frame/make-battle.mjs --left artifacts/battle/final/opus-orbit.mp4 --left-label "Claude Opus 5.5" --right artifacts/battle/final/astra-orbit.mp4 --right-label "GPT-6 Astra" --title "Same steampunk spider brief" --layout side --out artifacts/battle/final/spider-battle-picture.mp4
ffmpeg -i artifacts/battle/final/spider-battle-picture.mp4 -i artifacts/battle/final/battle-mix.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -t 22 -movflags +faststart artifacts/battle/final/spider-battle-final.mp4
```

- On the manual clock the page logs every foot lift and plant, steam burst and walk start or stop;
  `window.spider.drainEventLog()` hands them to the recorder, which writes them in seconds from the first frame.
- `record-orbit.mjs` does not edit the Astra project. It injects `orbit-page-driver.js`, which steps that
  page's own animation loop on a virtual clock, aims its camera, hides its stats box and reads the same events
  from `spiderDebug.state`. That page's camera is orthographic, so there the storyboard sets the zoom instead
  of the distance. Its `server.mjs` points at a three.js checkout that has moved; the recorder serves the
  package from `67js/67js/node_modules/three` instead.
- `battle-audio.mjs` synthesises a clank, thud and tick per foot plant (pitched per leg, harder for a longer
  drop), a servo whir per swing, a steam hiss, a boiler rumble and a stop thunk, pans each spider about 70/30
  to its side, ducks the music 3 dB under the clanks and masters to -14 LUFS. The music is the excerpt of
  `music/` named in `music/source.json`, from 1:44.84.

## When the model changes

Run `node smoke.mjs`, read its `warnings` and `violations`, then run `node record.mjs`. No code change is
needed as long as the GLB keeps the node names, pivot axes and extras of the contract.

## Weak spots

- Tracking shots in pixel mode shimmer a little on thin grid lines and leg edges, because the low-resolution
  render is not snapped to the pixel grid.
- Feet choose flat ground only along their direction of travel; a foot can still land near the edge of a crate.
- Leg segments are not collision-checked against obstacles or each other. The step lift is sized from the
  ground under the path, which has been enough on this course.
- The body does not slow down for a climb unless its feet fall behind.
- Gait constants are in model units for the contract's size (3-unit span); a model of another scale needs
  them retuned.
