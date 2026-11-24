# S29-frost-orb

A solid glass orb sits on a worn wooden table in a dim, window-lit room while frost grows over it from a single
point: fern-like dendrites radiate away from the seed, small hexagonal stars and a granular rime fill in behind the
front, and wherever the ice spreads the glass turns rough and milky, blurring the inverted room seen through the
orb and dimming the caustic it throws on the table. It is one hand-written GLSL fragment shader on a fullscreen
three.js `RawShaderMaterial`: an analytic sphere tracer with Fresnel reflection, refraction through the solid ball
with internal bounces and absorption, rough transmission from roughness-driven microfacet jitter plus an analytic
blur of the procedural environment, and a frost growth field built from noise-roughened geodesic fronts,
cell-based nucleation and distance-field dendrites; no textures or stock materials. Run it with
`cd source && npm install && npm run dev`; `npm run capture` re-renders `render.mp4`, and `bash smoke_test.sh`
checks the build and the video.
