# Credits

| Source | Used for | Licence | Link |
|---|---|---|---|
| three.js 0.187.0 | renderer, MeshStandardMaterial lighting, OrbitControls | MIT | https://github.com/mrdoob/three.js |
| Marching-cubes edge/triangle tables (Paul Bourke, after Cory Gene Bloyd), imported from `three/examples/jsm/objects/MarchingCubes.js` | lookup tables only; the mesher is my own | public domain tables, distributed in three.js under MIT | http://paulbourke.net/geometry/polygonise/ |
| `perturbNormalArb` bump technique (Morten Mikkelsen), adapted from three.js `bumpmap_pars_fragment` | screen-space bump from the procedural height | MIT (three.js) | https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk/bumpmap_pars_fragment.glsl.js |
| "Hash without Sine" constants (Dave Hoskins) | `hash13` / `hash33` in the shaders | MIT | https://www.shadertoy.com/view/4djSRW |
| mulberry32 PRNG (Tommy Ettinger) | seeded RNG for the DLA | public domain | https://gist.github.com/tommyettinger/46a874533244883189143505d203312c |
| Vite, Playwright | dev server/build, headless capture | MIT, Apache-2.0 | https://vitejs.dev, https://playwright.dev |

No textures, HDRIs or models are used. All surface detail is procedural.

Everything else (DLA growth, density splatting, chunked marching-cubes mesher, field AO, shaders, water, capture
pipeline) is original work by CodePawl, 2026.
