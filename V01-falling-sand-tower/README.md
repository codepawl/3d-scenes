# V01 — Falling Sand Tower

A 3D falling-sand cellular automaton on a 128×128×128 voxel grid: a nozzle circles above a rock tower with a spiral
ledge and floating shelves, cycling sand, water and lava every three seconds. Sand piles up at its angle of repose and
sinks through water, water pours down the ledges and spreads into a basin, and lava creeps slowly until it touches
water, where it hardens into dark basalt and the water boils off. The `Uint8Array` grid is the only source of truth:
a CPU automaton sweeps it bottom-up, but only inside 16³ chunks that changed recently, and a hand-written chunk mesher
turns dirty chunks into face-culled geometry with per-vertex ambient occlusion (opaque and translucent-water meshes),
lit by a shadowing sun, with an emissive attribute on lava feeding a bloom pass. The simulation is seeded and runs at a
fixed 60 ticks/s, so the `?capture=1` mode renders the same frames every time.

Run it: `cd source && npm install && npm run dev`. Re-render the video with `npm run capture` (needs Chrome and
ffmpeg on PATH). `./smoke_test.sh` builds the project and checks `render.mp4`. See `source/README.md` for controls.
