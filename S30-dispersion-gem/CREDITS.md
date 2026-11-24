# Credits

Third-party code and techniques used in this project:

| What | Where used | Licence | Link |
|---|---|---|---|
| three.js 0.187.0 (renderer, `OrbitControls`, `ConvexGeometry`/`ConvexHull`) | `source/src/*.js` | MIT | https://github.com/mrdoob/three.js |
| Vite 7 (dev server / build) | `source/` tooling | MIT | https://github.com/vitejs/vite |
| Playwright (headless capture) | `source/scripts/` | Apache-2.0 | https://github.com/microsoft/playwright |
| "Hash without Sine" (`hash12`, `hash13`) by Dave Hoskins | `common.glsl`, `composite.frag` | MIT | https://www.shadertoy.com/view/4djSRW |
| Interleaved gradient noise (Jorge Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare", SIGGRAPH 2014) — formula only | `gem.frag` | published formula | https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare/ |
| ACES filmic curve fit (Krzysztof Narkowicz, 2015) — formula only | `composite.frag` | public domain / CC0 (blog formula) | https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/ |
| Cauchy dispersion coefficients for diamond (A = 2.3818, B = 0.0121 µm²), textbook optics data | `gem.frag` | factual data | https://refractiveindex.info/?shelf=3d&book=crystals&page=diamond |

No textures, HDRIs, models or audio are used: every surface and the lighting environment are procedural GLSL.

Everything else — the gem geometry builder, the convex-polytope interior ray tracer, spectral weighting, the studio
environment, plinth/pin/backdrop materials, caustics, bloom and composite shaders, and the capture tooling — is
original work by CodePawl, 2026.
