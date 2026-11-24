# S36-lava-flow

A dusk view down a basalt slope as a pahoehoe flow creeps toward the camera. Its glassy black crust drifts
downslope in plates, the cracks between them open to show glowing lava, the front buds into slowly inflating
toes, and the air above the flow shimmers with heat. It is a shader piece in three.js. One displaced terrain mesh
uses the same analytic height field in its vertex and fragment shaders (slope, old billowy lava, channel and toes).
Normals come from per-pixel finite differences. The crust is Voronoi cells moved downslope by a two-phase flow map.
A temperature field drives blackbody-style HDR emission. The basalt is procedural: vesicles, fractures, ash,
oxidation and varying roughness. After that come a custom bloom, screen-space heat shimmer driven by a heat mask,
ACES tonemapping and dithered grain. Run it with `cd source && npm install && npm run dev`. `npm run capture`
re-renders `render.mp4`, and `bash smoke_test.sh` builds the project and checks the video.
