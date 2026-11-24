"""Film-only ground for the Tokyo layer film (the pack is not touched).
1. renders/film_assets/_ground.glb: 50 km x 50 km grid centred on the city, 250 m cells. Inside the data it sits
   1.5 m under the local DEM minimum (3x3 cell min), outside it extends the edge height and eases to a constant,
   so the camera never sees sky through the dataset edge or DEM cracks.
2. renders/film_assets/<mesh>_pads.glb: a flat convex-hull footprint at the base of every building that stands on
   no DEM triangle (union of all tiles), so no building floats over a void.
usage: film_ground.py FILM_ASSETS
"""
import sys, os, json, glob
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.spatial import ConvexHull
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from film_assets import read_glb, write_glb

D = sys.argv[1]
idx = json.load(open(f'{D}/index.json'))
# ---- DEM union: coverage raster (5 m) and min-height raster (250 m)
dems = {m: read_glb(f"{D}/{l['dem']}")[0] for m, l in idx.items() if 'dem' in l}
allp = np.concatenate([g['POSITION'] for g in dems.values()])
x0, z0 = allp[:, 0].min() - 100, allp[:, 2].min() - 100
x1, z1 = allp[:, 0].max() + 100, allp[:, 2].max() + 100
C = 5.0; W, H = int((x1 - x0) / C) + 1, int((z1 - z0) / C) + 1
cov = Image.new('1', (W, H), 0); dr = ImageDraw.Draw(cov)
for g in dems.values():
    for q in g['POSITION'][g['indices'].reshape(-1, 3)][:, :, [0, 2]]:
        dr.polygon([((x - x0) / C, (z - z0) / C) for x, z in q], fill=1)
cov = np.asarray(cov)

# ---- pads under uncovered buildings
npads = 0
for m, l in idx.items():
    tris = []
    for lay in ('bldg_lod1', 'bldg_lod2'):
        if lay not in l: continue
        g = read_glb(f"{D}/{l[lay]}")[0]; a = g['_ANCHOR']; p = g['POSITION']
        key, inv = np.unique(a, axis=0, return_inverse=True); inv = inv.ravel()
        ix = ((key[:, 0] - x0) / C).astype(int); iz = ((key[:, 2] - z0) / C).astype(int)
        inside = (ix >= 0) & (iz >= 0) & (ix < W) & (iz < H)
        covered = np.zeros(len(key), bool); covered[inside] = cov[iz[inside], ix[inside]]
        order = np.argsort(inv); starts = np.searchsorted(inv[order], np.arange(len(key)))
        ends = np.r_[starts[1:], len(inv)]
        for k in np.where(~covered)[0]:
            pts = p[order[starts[k]:ends[k]]][:, [0, 2]]
            if len(pts) < 3: continue
            try: hull = pts[ConvexHull(pts).vertices]
            except Exception: continue
            c = hull.mean(0); hull = c + (hull - c) * 1.04 + np.sign(hull - c) * 0.6   # a little wider than the walls
            y = key[k, 1] - 0.05
            for i in range(1, len(hull) - 1):
                for v in (hull[0], hull[i + 1], hull[i]):                       # counter-clockwise seen from above
                    tris.append((v[0], y, v[1]))
            npads += 1
    if tris:
        P = np.array(tris, np.float32); N = np.tile([0, 1, 0], (len(P), 1)).astype(np.float32)
        write_glb(f'{D}/{m}_pads.glb', {'POSITION': P, 'NORMAL': N}, np.arange(len(P), dtype=np.uint32), None, [0.8, 0.79, 0.76, 1])
        idx[m]['pads'] = f'{m}_pads.glb'

json.dump(idx, open(f'{D}/index.json', 'w'), indent=0)

# ---- ground grid
G = 250.0; cx, cz = (x0 + x1) / 2, (z0 + z1) / 2; half = 25000.0
nx = int(2 * half / G) + 1
gx = cx - half + np.arange(nx) * G; gz = cz - half + np.arange(nx) * G
hmin = np.full((nx, nx), np.nan)
ii = ((allp[:, 0] - (cx - half)) / G).round().astype(int); jj = ((allp[:, 2] - (cz - half)) / G).round().astype(int)
flat = jj * nx + ii; h = np.full(nx * nx, np.inf); np.minimum.at(h, flat, allp[:, 1]); h = h.reshape(nx, nx)
h[np.isinf(h)] = np.nan
data = ~np.isnan(h)
h = np.where(data, ndimage.minimum_filter(np.where(data, h, np.inf), size=3), np.nan)
h[np.isinf(h)] = np.nan; data = ~np.isnan(h)
_, (ni, nj) = ndimage.distance_transform_edt(~data, return_indices=True)
ext = h[ni, nj]                                                             # extend edge heights outward
dist = ndimage.distance_transform_edt(~data) * G
far = np.nanmedian(h)
blend = np.clip(dist / 6000.0, 0, 1); blend = blend * blend * (3 - 2 * blend)
ext = ndimage.gaussian_filter(ext, 2) * (1 - blend) + far * blend
Y = np.where(data, h, ext) - 1.5
X, Z = np.meshgrid(gx, gz)
P = np.stack([X, Y, Z], -1).reshape(-1, 3).astype(np.float32)
q = np.arange(nx * nx).reshape(nx, nx)
a, b, c_, d = q[:-1, :-1].ravel(), q[:-1, 1:].ravel(), q[1:, :-1].ravel(), q[1:, 1:].ravel()
I = np.stack([a, c_, b, b, c_, d], 1).ravel().astype(np.uint32)
N = np.tile([0, 1, 0], (len(P), 1)).astype(np.float32)
write_glb(f'{D}/_ground.glb', {'POSITION': P, 'NORMAL': N}, I, None, [0.66, 0.64, 0.6, 1])
print(json.dumps({'pads_buildings': npads, 'pad_tiles': len(glob.glob(f'{D}/*_pads.glb')), 'ground_cells': (nx - 1) ** 2,
                  'ground_y_inside': [round(float(np.nanmin(h)) - 1.5, 1), round(float(np.nanmax(h)) - 1.5, 1)], 'far_level': round(float(far) - 1.5, 1)}))
