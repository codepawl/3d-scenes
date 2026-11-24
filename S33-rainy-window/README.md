# S33 — Rainy Window

A night street seen through a rain-streaked, fogged window: big drops stick, slip and slide down the glass, wiping
trails through the condensation and leaving beads behind, while each drop acts as a tiny inverting lens that refracts
the defocused street of sodium lamps, neon, traffic lights and passing cars behind it. It is all shaders, no
textures. A half-resolution GLSL pass draws the street as analytic bokeh discs (hexagonal aperture, rim, lens dust,
chromatic fringe, cat-eye vignetting) with wet-road reflections. A Gaussian chain makes the "seen through fog" version,
and a full-resolution glass pass computes procedural drops (height, normals, lens offsets), fog, smears, streaks, water
marks, dust, scratches and a worn painted frame, then composites with refraction, dark drop rims, glints, tonemapping,
grain and dither. Run it with `cd source && npm install && npm run dev`; `npm run capture` re-renders `render.mp4`,
and `bash smoke_test.sh` checks the build and the video.
