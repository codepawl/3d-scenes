# Credits

No textures, HDRIs, models or shader files were copied into this project. The following published techniques
informed code that was written from scratch here:

| What | Source | Licence |
|---|---|---|
| Integer hash `uvec2(ivec2(p)) * (1597334673u, 3812015801u)`, `(q.x ^ q.y) * 1597334673u` used for value noise, stars and glitter (also mirrored in JS) | Dave Hoskins, "Hash without Sine 2", https://www.shadertoy.com/view/XdGfRR | MIT |
| Value noise / fbm, heightfield ray marching with secant refinement, soft shadows by `min(k*d/t)` | Inigo Quilez articles, https://iquilezles.org/articles/ (terrainmarching, rmshadows) | technique descriptions (no code copied) |
| Single-scattering sky (Rayleigh + Mie, Nishita-style), constants commonly used for Earth | Nishita et al. 1993, "Display of the Earth Taking into Account Atmospheric Scattering"; structure similar to wwwtyro/glsl-atmosphere, https://github.com/wwwtyro/glsl-atmosphere | paper / The Unlicense |
| ACES filmic tone-mapping curve fit | Krzysztof Narkowicz, "ACES Filmic Tone Mapping Curve", https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/ | public blog snippet (CC0-style, free use) |
| three.js 0.187.0 | https://github.com/mrdoob/three.js | MIT |
| Vite 8 (build/dev server) | https://github.com/vitejs/vite | MIT |
| Playwright (capture only, dev dependency) | https://github.com/microsoft/playwright | Apache-2.0 |

Everything else (dune profile and terrain function, ripple model, lighting, night sky, exposure, capture
pipeline) is original work by CodePawl, 2026, released under the MIT licence.
