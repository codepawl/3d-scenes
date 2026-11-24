# S31 — Black Hole Lens

A Schwarzschild black hole seen almost edge-on: a procedural star field and dusty galactic band are bent into an Einstein
ring around a black shadow, while a turbulent accretion disk wraps over and under the hole — its far side lensed into
the familiar arch — with the approaching side blazing blue-white and the receding side dim orange from relativistic
Doppler beaming. Everything is one GLSL fragment shader in three.js: each pixel integrates a null geodesic
(`x'' = -1.5 h² x / r⁵`, r_s = 1) until it falls in, escapes to the sky, or is absorbed by the disk, which is sampled at
every equatorial-plane crossing with a thin-disk emissivity profile, Keplerian-sheared fbm filaments and dust lanes,
optical depth by view angle, and a Planck colour at the Doppler/gravitationally shifted temperature; an HDR bloom,
filmic tonemap and dithered grain finish the image. Run it with `cd source && npm install && npm run dev`; `render.mp4`
is a 6 s capture made with `node capture.mjs` (deterministic 1/30 s frames, headless Chrome + ffmpeg), and
`bash smoke_test.sh` builds the project and validates the video.
