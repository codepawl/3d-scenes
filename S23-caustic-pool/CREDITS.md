# Credits

Third-party code and techniques used in this project:

| What | Where used | Licence | Link |
|---|---|---|---|
| three.js 0.187.0 | renderer, scene graph, render targets | MIT | https://github.com/mrdoob/three.js |
| Vite 8.3.8 | dev server / build | MIT | https://github.com/vitejs/vite |
| Playwright 1.65.1 | headless frame capture (dev only) | Apache-2.0 | https://github.com/microsoft/playwright |
| "Hash without Sine" (`hash12`, `hash32`), Dave Hoskins | per-tile random values | MIT | https://www.shadertoy.com/view/4djSRW |
| Interleaved gradient noise, Jorge Jimenez (Next Generation Post Processing in Call of Duty: AW, 2014) | dither against banding, shaft-march jitter | formula from a public talk | https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare |
| ACES filmic tonemap curve fit, Krzysztof Narkowicz | post tonemap | public domain formula (blog post) | https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/ |
| Henyey-Greenstein phase function, Schlick fresnel, GGX distribution | lighting | textbook formulas | — |

No textures, HDRIs, models or sound are used: every pixel comes from the GLSL in `source/src/shaders.js`.

Everything else (the ray-density caustic model, mosaic tile shader, medium/shaft integration, surface shader,
camera, capture pipeline and docs) is original work by CodePawl, 2026, released under the MIT licence.
