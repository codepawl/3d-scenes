# S39 — Moonlit Wheat

A night field of about 240,000 instanced wheat stalks under a low full moon, bent by gusts that roll across the
field toward the camera while the view drifts slowly forward. Every pixel comes from hand-written GLSL in three.js
`ShaderMaterial`s; there are no textures. The vertex shader bends each stalk along a length-preserving constant-curvature arc.
The bend is driven by a scrolling fbm gust field plus warped travelling wave fronts, with per-plant flutter.
Ears are widened with distance so they stay at least about a pixel wide. The fragment shader lights the backlit crop with
wrap diffuse, thin-blade translucency, a silvery rim and Kajiya–Kay fibre sheen. Ears tilted by a gust catch more
moonlight, which makes the waves visible. Each blade gets its own tint and moonlit edge translucency; the soil under the crop is lit by moon dapples and ambient light so gaps read as depth. Surfaces carry procedural rust blotches, base grime, fibre streaks, spikelets,
node bands and field-scale ripeness patches. A procedural soil, and a sky with a limb-darkened moon, stars, drifting
cloud and a treeline silhouette, complete the scene. A scotopic desaturation, ACES tone mapping and dithering keep
the dark gradients clean.

Run it: `cd source && npm install && npm run dev`. `render.mp4` is a 6 s, 1280×720, 30 fps capture of
`?capture=1`. `bash smoke_test.sh` builds the project and checks the video. See `source/README.md` for controls
and capture instructions.
