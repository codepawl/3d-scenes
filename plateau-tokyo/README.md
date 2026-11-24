# Tokyo layer film + plateau-tokyo-glb

A procedural three.js film of the Tokyo 23 wards built from the official PLATEAU open 3D city model, plus the matching GLB pack (71 tiles, 146 MB, 8.96M triangles) and the trajectory used to shoot it. Rendered at 1920x1080.

## Contents

```
plateau-tokyo/
  README.md                   this file
  CREDITS.md                  data, music, SFX, software licences
  renders/
    final_tokyo_layers.mp4    approved film render (960x540, h264, ~9.3 MB)
    cover.png                 1920x1080 cover frame
    cover/                    additional stills
  source/
    film/index.html           three.js app (standalone HTML + ES modules)
    tools/                    build, record and mix scripts
      build_pack.py           CityGML -> GLB tiling and compression
      build_tile.py           per-tile geometry builder
      film_assets.py          scene composition helpers
      film_ground.py          ground plane + horizon fog + LOD0 footprint fill
      mix.py                  audio mixdown
      optimize.sh             GLB post-processing (meshopt, draco)
      record.mjs              headless Playwright recorder
      shoot.mjs               trajectory player
      render_film.sh          end-to-end render pipeline
      rzip.py                 pack resizer
      ward_sizes.py           ward footprint statistics
      tiles.json / ring_tiles.json  tile manifests
      package.json            Node deps (meshoptimizer, draco, glTF Transform)
  trajectory/
    film_landmarks.json       camera key frames and timing
    tiles.json                tile layout used by the camera
  refs/
    listings/                 CityGML / OBJ / tile manifests (CSV, TSV)
    compare.html              ward-level comparison viewer
    proof_53394525_compare.jpg  overlay proof (raw vs built)
```

## How the film was built

1. PLATEAU 23-wards CityGML (DEM, TRAN, BLDG LOD1, BLDG LOD2, BRID) is downloaded from the geospatial.jp catalogue and re-projected from EPSG:6677 to a local metric frame.
2. `tools/build_pack.py` splits the region into 71 tiles, atlases textures, de-duplicates vertices and emits one GLB per tile at multiple LODs with meshopt + draco compression.
3. `tools/film_ground.py` adds three things so the city has a horizon and no voids under floating buildings. It places a 50 km ground plane just below DEM level, adds horizon fog, and fills LOD0 footprints for inner tiles that have LOD1 buildings but no DEM.
4. `source/film/index.html` loads the tiles, drives the camera along `trajectory/film_landmarks.json`, and renders layer by layer (terrain -> roads -> buildings -> bridges -> facades) with SFX cues.
5. `tools/record.mjs` drives the page with Playwright + d3d11 headless Chrome and writes PNG frames; `tools/render_film.sh` encodes them to MP4.

## Running the smoke test

From the package root:

```
bash smoke_test.sh
```

It checks the metadata, the shipped film, that the three.js page serves, that the GLB pack is consistent, and that the Node dependencies for the tools package install cleanly in a temp folder. Exits non-zero on the first failure.

## Reproducing from a clean clone

Requires Node 20+, Python 3.11+, ffmpeg. `uv` is recommended for Python deps.

```
cd source/tools
npm install
cd ../film
python -m http.server 8000           # serve the three.js app
# or for the headless render:
cd ../tools
node record.mjs ../film/index.html ../../renders/frames
bash render_film.sh
```

To render the full-quality 1920x1080 version:

```
cd source/tools
bash render_film.sh final
```

This writes `renders/final_tokyo_layers.mp4` at 1920x1080, 6-subframe motion blur, CRF 16. GPU wrapping is optional; set `LOCK=/path/to/your/gpu-lock.sh` if you want renders to pipe through one.

## Data

PLATEAU 3D city model for Tokyo 23 wards, released by MLIT (Ministry of Land, Infrastructure, Transport and Tourism) under PDL1.0. See `CREDITS.md` for the full attribution and edit statement.

## Notes

- The dataset ends at the 23-ward boundary; the ground plane and horizon fog taper that edge out so the camera does not see straight into the sky.
- Some inner tiles have LOD1 buildings but no DEM; those are filled with flat LOD0 footprints at ground level.
- The GLB pack under `renders/plateau-tokyo-glb/` (in the source redo tree) ships alongside this package and is loadable from the three.js viewer in `renders/plateau-tokyo-glb/viewer/`.
