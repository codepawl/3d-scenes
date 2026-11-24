# S30 — Dispersion Gem

A round-brilliant-style diamond, balanced on its culet on a brass pin, turns slowly above a worn dark stone plinth in
a dark studio. The gem is not a stock material: its fragment shader ray-traces the light path inside the stone
analytically — the gem is a convex polytope, so each internal segment ends at the nearest facet plane the ray faces —
with exact Fresnel, total internal reflection and up to six internal bounces, repeated for seven jittered wavelength
samples whose refractive index follows a Cauchy fit for diamond (dispersion exaggerated 3x). Each wavelength exits in
a slightly different direction, so the white spark lights of the procedural studio environment split into spectral
"fire". The plinth, pin and backdrop are procedural shaders too (veins, dust, chipped edges, drip grime, tarnish,
rotating dispersive caustic), finished with HDR bloom, ACES tone mapping and dithered grain.

Run it: `cd source && npm install && npm run dev`. Render the video: `npm run build && npm run capture`
(writes `render.mp4`). Check everything: `bash smoke_test.sh`. Details in `source/README.md`.
