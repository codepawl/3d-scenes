# S23 — Caustic Pool

A slow underwater dolly along the floor of a tiled swimming pool, lit by a sun whose light is focused into moving
caustic webs by the waves overhead. Nothing is textured: the mosaic (per-tile colour jitter, hand-laid tilt, bevelled
edges, anti-aliased grout, lane markings), the glaze fresnel and sun glints, the water medium and the surface seen from
below are all GLSL `ShaderMaterial`s. The caustics are not a noise pattern but a ray-density model: the water surface
is a sum of eleven deep-water sine waves with an analytic gradient and Hessian, and the brightness on any receiver at
depth *D* is `1/|det(I + D·c·Hess h)|`, the Jacobian of the refracted-ray map, evaluated per colour channel for slight
dispersion. The same function, sampled along each view ray, produces volumetric light shafts, and Beer-Lambert
absorption per wavelength gives the cyan falloff. The HDR image goes through ACES tonemapping with dither against
banding. Run it with `cd source && npm install && npm run dev`; `render.mp4` is a 6 s, 1280x720 capture made with
`npm run capture` (deterministic `?capture=1` mode), and `bash smoke_test.sh` checks the build and the video.
