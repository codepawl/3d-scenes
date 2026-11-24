# S28 — Aurora Tundra

Green and magenta aurora curtains fold and drift over a dark, snow-covered tundra under a field of twinkling
stars. The camera stands on a frozen lake whose black, cracked and frost-patched ice mirrors the aurora. The whole
picture comes from a single procedural GLSL fragment shader in three.js (WebGL2, no textures). The aurora is a
jittered ray march through an altitude slab, where the curtains are the zero level set of a domain-warped noise
field and the vertical ray striations come from noise that depends only on xz. The tundra is a ray-marched height
field with derivative-damped fbm, with snow, rock, scrub and grime. The ice is an analytic plane with roughness that
varies across the lake, Fresnel reflection (the reflected ray is marched against the terrain and the aurora), Voronoi
cracks and parallax air bubbles. To run: `cd source && npm install && npm run dev`. `npm run capture` re-renders
`render.mp4`, and `bash smoke_test.sh` checks the build and the video.
