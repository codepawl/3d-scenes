# Credits

Third-party code used (all from npm, unmodified):

- **three.js** 0.187.0, MIT licence: https://github.com/mrdoob/three.js
  Includes the example add-ons used here: `OrbitControls`, `RoomEnvironment`, `EffectComposer`, `RenderPass`,
  `UnrealBloomPass`, `OutputPass`, `ShaderPass` (all MIT, part of the three.js repository).
- **Vite** 8.3.8, MIT licence: https://github.com/vitejs/vite (dev server and bundler)
- **Playwright** 1.65.1, Apache-2.0 licence: https://github.com/microsoft/playwright (video capture only, `capture/`)
- **FFmpeg / libx264** (external tool, LGPL/GPL): https://ffmpeg.org (video encoding only, not distributed)
- `mulberry32` PRNG by Tommy Ettinger, public domain: https://github.com/bryc/code/blob/master/jshash/PRNGs.md
- The one-line `fract(sin(dot(...)))` hash in the dither pass is a widely used public-domain GLSL idiom.

No textures, HDRIs or models are used. Lighting reflections come from three.js `RoomEnvironment`, which is
generated procedurally.

Everything else (the automaton, voxel packing and burial culling, shaders, palette, camera and capture
pipeline) is original work by CodePawl, 2026.
