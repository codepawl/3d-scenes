# S35 — Soap film

A soap film stretched across a hand-bent, rusty wire loop bulges and ripples in a gusting breeze while its
interference colours swirl and drain from silver-black at the top to pastel high-order bands at the bottom. Everything
is GLSL in three.js ShaderMaterials: the film colour is computed physically per pixel (Airy reflectance of a soap layer,
s/p Fresnel, 16 spectral samples through an analytic CIE 1931 fit), the thickness field is gravity drainage warped by
time-advected fbm with black-film patches, specks and a Plateau border, the membrane bulge and ripples are an
analytic vertex displacement, and the room, window and bokeh it reflects are a single analytic environment function
shared by the background, film and procedurally rusted wire — no textures or HDRIs. Run it with
`cd source && npm install && npm run dev`; `npm run capture` re-renders `render.mp4`, and `bash smoke_test.sh` checks
the build and the video.
