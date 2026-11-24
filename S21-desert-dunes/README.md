# S21 — Desert Dunes

A procedural desert seen from just above the sand as the camera drifts across a field of transverse dunes while
the sun climbs from dawn, crosses noon, sets and gives way to a starry night. Everything comes from one GLSL3
fragment shader in three.js: the dunes are a ray-marched heightfield built from an asymmetric dune profile with
noise-warped crests, wind ripples are a footprint-filtered normal field that lives on the windward slopes, shadows
are marched through the heightfield toward the sun, and the sky, sun colour and aerial haze come from a
single-scattering Rayleigh/Mie atmosphere, with hash-grid stars and cool moonlight at night. Run it with
`cd source && npm install && npm run dev`; `render.mp4` is a 6 s capture made with `node capture.mjs` (headless
Chrome, frame-stepped, 2x supersampled), and `./smoke_test.sh` checks the build and the video.
