# S35 — Soap film

A soap film stretched on a hand-bent, rusty galvanised wire loop in a dim room. A breeze gusts through, bulging the
film into a shallow dome with travelling ripples, while thin-film interference colours swirl and drain downward.

## Run

```
npm install
npm run dev        # opens the scene in your browser
npm run build      # production build into dist/
npm run capture    # re-renders ../render.mp4 (needs ffmpeg on PATH and Playwright's Chromium)
```

`?capture=1` switches to deterministic capture mode: time is driven by `window.renderFrame(n)` at 1/30 s per frame
and the canvas is fixed at 1280x720.

## What you are looking at

- **Film colour** (`src/shaders/film.frag`): real thin-film optics — Airy reflectance of a free-standing water layer
  (n = 1.335), s and p Fresnel terms, refraction angle inside the film, integrated over 16 wavelengths with an
  analytic CIE 1931 fit, converted XYZ -> linear sRGB. Thick regions fade to the incoherent average reflectance.
- **Thickness field**: gravity drainage (silver/black film at the top, high-order pastel bands at the bottom),
  differential rotation from the breeze, two levels of domain-warped fbm, fine striations, black-film patches,
  drifting specks and a thick Plateau border where the film meets the wire.
- **Membrane**: a polar mesh built from the loop shape, so the film ends exactly on the wire.
- **Breeze** (`src/shaders/loop.glsl`): gusting uniform-pressure membrane bulge (paraboloid) with a lopsided tilt and
  travelling ripples; normals are finite differences of the same analytic function.
- **Wire** (`src/shaders/wire.frag`): metal shading — zinc-coloured F0, Schlick Fresnel, cone-filtered environment
  reflection, GGX lamp highlight, drawing grooves, spangle, grime, scratches and small rust blooms that vary the roughness.
- **Environment** (`src/shaders/env.glsl`): one analytic function — plaster room, big soft-edged window onto sky and
  garden behind the camera, a tungsten lamp, soft bokeh of varied size on the back wall — used by the background, the film reflection
  and the wire (with a blur parameter standing in for roughness). No textures or HDRIs.
- HDR MSAA render target -> quarter-res bloom -> ACES tone map, vignette, grain/dither.

## Controls

Drag to orbit, wheel to zoom, Space pauses the breeze, H hides the hint. The camera drifts on its own until you touch it.

## Licence

MIT. Original work by CodePawl, 2026. See `../CREDITS.md` for third-party formulas.
