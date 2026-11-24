# Credits

Third-party code, data and techniques used in this project:

| What | Where used | Licence | Link |
|---|---|---|---|
| three.js 0.187.0 (incl. `OrbitControls` addon) | rendering, camera controls | MIT | https://github.com/mrdoob/three.js |
| Vite | dev server and build | MIT | https://github.com/vitejs/vite |
| Playwright | headless frame capture (dev dependency) | Apache-2.0 | https://github.com/microsoft/playwright |
| "Hash without Sine" by David Hoskins (`hash11`, `hash12`, `hash22`) | `source/src/shaders/common.glsl` | MIT | https://www.shadertoy.com/view/4djSRW |
| ACES filmic tone-curve fit by Krzysztof Narkowicz | post pass in `source/src/main.js` | public formula (blog post) | https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/ |
| CIE 1931 colour-matching function fit: Wyman, Sloan & Shirley, "Simple Analytic Approximations to the CIE XYZ Color Matching Functions", JCGT 2(2), 2013 | `source/src/spectral.js` | published coefficients (open-access paper) | https://jcgt.org/published/0002/02/01/ |
| Thin-film (Airy) reflectance and Fresnel equations | `ground.frag` `thinFilm()` | textbook physics, own implementation | https://en.wikipedia.org/wiki/Thin-film_interference |

No textures, HDRIs, models or sounds are used. Everything is procedural.

Everything else (the shaders, the asphalt, puddle, rain-ring and oil-film models, the analytic environment, the rain streaks, and the capture tooling) is original work by CodePawl, 2026.
