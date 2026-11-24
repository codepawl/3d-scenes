# Credits

| Source | Use | Licence | Link |
|---|---|---|---|
| three.js 0.187.0 (incl. OrbitControls) | renderer, materials, shadows, camera controls | MIT | https://github.com/mrdoob/three.js |
| Vite 8.3.8 | dev server / build | MIT | https://github.com/vitejs/vite |
| Playwright (playwright-core 1.65.1) | headless Chrome frame capture | Apache-2.0 | https://github.com/microsoft/playwright |
| FFmpeg / libx264 (external tool, not bundled) | video encoding | LGPL/GPL | https://ffmpeg.org |

The integer hash multipliers in the GLSL and JS noise are well-known large odd constants from common public
integer-hash folklore. The hash, value-noise and fbm code itself was written for this project. No textures, HDRIs or
models are used: every colour is procedural.

Everything else (meshers, rake simulation, props, shaders, capture script) is original work by
CodePawl, 2026.
