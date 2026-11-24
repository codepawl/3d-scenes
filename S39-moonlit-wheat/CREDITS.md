# Credits

## Third-party code
- **three.js** 0.187.0 (MIT): https://github.com/mrdoob/three.js. Renderer, `ShaderMaterial`, `OrbitControls`,
  and the built-in `tonemapping_fragment` / `colorspace_fragment` shader chunks (ACES filmic + sRGB output).
- **Vite** (MIT): https://github.com/vitejs/vite. Dev server and bundler.
- **Playwright** (Apache-2.0): https://github.com/microsoft/playwright. Headless Chrome for frame capture only.
- **"Hash without Sine"** by David Hoskins (MIT): https://www.shadertoy.com/view/4djSRW. The `hash12` / `hash13`
  functions in `source/src/shaders/common.glsl.js` follow its constants and structure.
- **mulberry32** PRNG (public domain), from Tommy Ettinger's description: https://gist.github.com/tommyettinger/46a874533244883189143505d203312c.
  Used for deterministic instance scattering in `main.js`.
- **Kajiya–Kay** anisotropic hair/fibre highlight (Kajiya & Kay, SIGGRAPH 1989). Only the published formula is used,
  written from scratch.

## Assets
None. No textures, HDRIs, models or audio. Everything visible is computed in GLSL.

Everything else (the wheat geometry and wind bending, gust field, lighting model, procedural soil, sky, moon,
stars, clouds and treeline, and the capture pipeline) is original work by CodePawl, 2026.
