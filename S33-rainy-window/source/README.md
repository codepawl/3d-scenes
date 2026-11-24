# S33 — Rainy Window

Rain slides down a fogged, grimy window pane at night. Behind it, a defocused street of bokeh lights: sodium street
lamps, a traffic signal cycling, neon signs, cars passing with headlights and tail lights, reflections smeared across
wet tarmac. Each drop is a tiny inverting lens that refracts the street; sliding drops stop and start, wipe a trail
through the condensation and leave beads behind it.

Everything is generated in GLSL (three.js `ShaderMaterial`, GLSL 3 / WebGL2). No textures, models or HDRIs.

## Run

```
npm install
npm run dev        # opens the scene in your browser
npm run build      # production build in dist/
```

Re-render the video (needs ffmpeg on PATH and Playwright's Chromium: `npx playwright install chromium`):

```
npm run capture    # writes ../render.mp4 (6 s, 1280x720, 30 fps, H.264)
```

`?capture=1` switches to capture mode: fixed 1280x720, time driven by a frame counter (1/30 s per frame), and
`window.renderFrame(n)` draws frame n and resolves when done.

## Controls

| Input  | Action                          |
| ------ | ------------------------------- |
| Mouse  | small parallax head movement    |
| Space  | pause / resume                  |
| `[` `]`| slower / faster time            |
| `s`    | toggle camera sway              |
| `f`    | toggle fps counter              |

## How it works

1. `street.frag` (half resolution, half-float): sky glow, soft building masses with lit windows, wet road, and ~60
   analytic bokeh discs (rounded-hexagon aperture, bright rim, onion rings, lens dust, chromatic fringe, cat-eye
   vignetting near the frame edge) with rippled road reflections. Light positions/colours are animated in JS.
2. A separable Gaussian chain to 1/4 and 1/8 resolution, which is the view through condensation.
3. `glass.frag` (full resolution): three layers of sliding drops (stick-slip motion, wobbly paths, teardrop shape,
   trails that clear the fog and slowly re-fog, beads left in the trail), three layers of static condensation beads,
   patchy fog, old wipe smears, dirty run-off streaks, dried water-mark rings, dust specks, fine scratches, and a
   painted window frame with chipped paint, wood grain, cracked putty and water pooled on the sill. Drops sample the
   street inverted through their centre, with dark rims, specular glints and a focused caustic. ACES-style tonemap,
   film grain and dithering to avoid banding.

Runs at about 1.2 ms per frame at 1280x720 on an RTX 3060-class GPU.

## Licence

MIT. Original work by CodePawl, 2026. See `../CREDITS.md`.
