# S22 · Volumetric Cumulus

A procedural, shader-only seascape: run `npm install && npm run dev` and the browser opens on a field of cumulus over open ocean, the camera gliding low beneath the cloud base while the sun sinks toward the horizon into golden hour.

## Run

```bash
npm install
npm run dev        # opens http://localhost:5173
npm run build      # static build in dist/
npm run capture    # re-renders ../render.mp4 (needs ffmpeg on PATH and a Playwright Chromium)
```

Needs a WebGL2 browser. Targets 60 fps at 1280x720 on a mid-range GPU (clouds are ray-marched at half resolution in real time and full resolution in capture mode).

## What you see

- **Cumulus**: ray-marched through a curved slab 0.85 to 3 km above the sea. The density is a 2D weather fbm with a height profile (flat bases, domed tops), eroded by billowy 3D value noise. Each sample marches 6 to 7 taps toward the sun; light uses multiple-scattering octaves, a dual-lobe Henyey-Greenstein phase and a powder term, so the edges glow silver against the sun.
- **Light shafts**: a second march through the air under the cloud base estimates the cloud optical depth toward the sun at each step. That gives the crepuscular rays and the moving cloud shadows on the water.
- **Ocean**: analytic deep-water waves whose normals filter by pixel footprint, so far waves fade without aliasing and their slope is folded into the glint roughness. It has Fresnel reflection of the sky and of the clouds (a mirrored cloud march), a Beckmann sun glint, and scattering in the water body.
- **Sky and sun**: a single-scatter style Rayleigh and Mie model driven by Kasten-Young air mass, so the sun and sky redden as the elevation drops from 15° to about 3°. Aerial perspective, ACES tonemap and a triangular dither to avoid banding.

No textures, HDRIs, meshes or voxel grids: everything is computed in `src/shaders/*.glsl|frag`.

## Controls

| Input | Action |
|---|---|
| drag | look around |
| `[` / `]` | move the sun earlier / later |
| space | pause |
| `r` | reset view and sun |
| `h` | hide the HUD |

`?capture=1` switches to deterministic capture mode: time = frame / 30 s, `window.renderFrame(n)` draws frame n and resolves when the GPU is done, and there is no HUD.

## Licence

MIT © 2026 CodePawl. See `../CREDITS.md` for third-party snippets and techniques.
