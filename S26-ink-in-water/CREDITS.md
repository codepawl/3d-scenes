# Credits

Third-party software (runtime / build only, no assets):

- three.js r187 (`three@0.187.0`), MIT, https://github.com/mrdoob/three.js
- Vite (`vite@8.3.8`), MIT, https://github.com/vitejs/vite
- Playwright (`playwright-core@1.65.1`, capture only), Apache-2.0, https://github.com/microsoft/playwright
- FFmpeg / libx264 (external encoding tool), LGPL/GPL, https://ffmpeg.org

Techniques and references (re-implemented, no code copied):

- Jos Stam, "Stable Fluids", SIGGRAPH 1999: semi-Lagrangian advection and pressure projection.
- Fedkiw, Stam, Jensen, "Visual Simulation of Smoke", SIGGRAPH 2001: vorticity confinement.
- Pavel Dobryakov, WebGL-Fluid-Simulation (MIT), https://github.com/PavelDoGreat/WebGL-Fluid-Simulation, used as a
  general reference for organising a GPU fluid as fragment-shader passes.
- Dave Hoskins, "Hash without Sine" (MIT), https://www.shadertoy.com/view/4djSRW. The `h12` / `h13` / `h22` hash
  functions follow this pattern.
- Krzysztof Narkowicz, "ACES Filmic Tone Mapping Curve" (2016),
  https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/ for the tonemap fit.
- Henyey-Greenstein phase function and Schlick's Fresnel approximation (standard formulas).

No textures, HDRIs, models or fonts are used. Every surface is procedural GLSL.

Everything else (the fluid shaders, the ray-traced scene, the procedural concrete, plaster and glass grime, and the
capture pipeline) is original work by CodePawl, 2026.
