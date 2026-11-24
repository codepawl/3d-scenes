# Paint Drip Wall (V20)

A voxel brick wall with paint poured in streams over its top. A gravity cellular automaton runs the
paint down the wall, and colours mix where drips meet.

## Run
```
npm install
npm run dev        # opens the scene in the browser
npm run build      # production build in dist/
node capture.mjs   # after build: renders ../render.mp4 (6 s, 1280x720, 30 fps) with headless Chrome + ffmpeg
```
Capture mode: open `?capture=1` (optional `&ss=2` supersampling). Time then advances 1/30 s per frame, and
`window.renderFrame(n)` simulates up to frame n and draws it. Needs `ffmpeg` on PATH and Playwright's Chromium
(`npx playwright install chromium`).

## What it shows
- **Grid**: 260×112 cells on the wall face. Each cell stores wet mass, absorbance RGB, holding capacity (porosity
  noise, mortar soaks up more) and a dried layer baked from older pours.
- **Automaton** (60 steps/s, scanned bottom-up, alternating direction): mass above capacity moves to one of the three
  cells below. Heavy drip heads move more often. The choice favours wetter cells (trails attract, so drips merge),
  follows a per-column wander field and resists stepping outward. Small beads join heavier neighbours (curtains break
  into drips), mortar bed joints pull paint sideways, and large excess spreads sideways.
- **Mixing**: mass-weighted average of absorbance, which is a weighted geometric mean of reflectance, so blue + yellow
  gives green.
- **Pours**: ballistic voxel droplets fall in streams onto the coping and deposit into the grid. Three pairs sweep
  towards each other so their drips meet; every drip trails back to its pour point.
- **Rendering**: InstancedMesh voxels for the wall, the paint and the droplets. Albedo and roughness variation is
  texel-matched (one texel per voxel cell), so wall and paint share one scale. Running paint gets a clearcoat and small
  per-voxel tilts that catch glints; settled and dried paint is matte. Shadowed key light, hemisphere fill, RoomEnvironment reflections.

## Controls (interactive mode)
- Click the wall: pour a stream onto the coping above that spot
- `1`–`5`: colour (blue, yellow, magenta, white, teal)
- `Space`: pause / resume, `R`: wash off the wet paint and restart the scripted pours
- Drag / wheel: orbit / zoom

## Licence
MIT. Original work by CodePawl, 2026. See `../CREDITS.md` for third-party code.
