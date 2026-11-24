"""Build plateau-tokyo-glb from the downloaded PLATEAU OBJ tiles.
usage: build_pack.py RAW PACK [--jobs 4] [--only MESH,...] [--index-only]
Resumable: a layer whose stats file exists is skipped.
"""
import sys, os, json, subprocess, argparse, glob, hashlib, shutil
from concurrent.futures import ThreadPoolExecutor
from pyproj import Transformer

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
BASH = shutil.which('bash')
E0, N0 = -10000.0, -35500.0
COL = {'dem': '0.72,0.71,0.68', 'tran': '0.42,0.43,0.45', 'brid': '0.70,0.70,0.70',
       'bldg_lod1': '0.88,0.87,0.84', 'bldg_lod2': '0.80,0.80,0.78'}
LAYER_DESC = {'dem': 'terrain (DEM TIN)', 'tran': 'roads (LOD1 road surfaces, clipped from the 10 km file)',
              'brid': 'bridges / elevated roads (LOD2, textured)', 'bldg_lod1': 'buildings LOD1 block models (only those not in LOD2)',
              'bldg_lod2': 'buildings LOD2 with photo facades (atlased)'}

def mesh_corners(m):
    m = str(m); p, u, q, w, v, x = int(m[:2]), int(m[2:4]), int(m[4]), int(m[5]), int(m[6]), int(m[7])
    lat0 = p / 1.5 + q * 5 / 60 + v * 30 / 3600; lon0 = 100 + u + w * 7.5 / 60 + x * 45 / 3600
    return lat0, lon0, lat0 + 30 / 3600, lon0 + 45 / 3600

def sources(raw, mesh):
    r = os.path.join(raw, '13100_tokyo23-ku_2020_obj_3_op')
    s = {'dem': f'{r}/dem/{mesh}_dem_6677.obj',
         'tran': f'{r}/tran/{mesh[:6]}_tran_6677.obj',
         'brid': f'{r}/brid/{mesh}_brid_6677_obj/{mesh}_brid_6677.obj',
         'bldg_lod1': f'{r}/bldg/lod1/{mesh}_bldg_6677_obj/{mesh}_bldg_6677.obj',
         'bldg_lod2': f'{r}/bldg/lod2/{mesh}_bldg_6677_obj/{mesh}_bldg_6677.obj'}
    return {k: v for k, v in s.items() if os.path.exists(v)}

def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0: raise RuntimeError(' '.join(cmd) + '\n' + p.stderr[-2000:])
    return p.stdout

def build_layer(raw, pack, work, mesh, layer, src, lod2src):
    st_path = f'{work}/stats/{mesh}_{layer}.json'
    if os.path.exists(st_path): return json.load(open(st_path))
    rawglb = f'{work}/raw/{mesh}_{layer}.glb'
    out = f'{pack}/tiles/{mesh}/{mesh}_{layer}.glb'
    os.makedirs(os.path.dirname(rawglb), exist_ok=True); os.makedirs(os.path.dirname(out), exist_ok=True)
    cmd = [PY, '-X', 'utf8', f'{HERE}/build_tile.py', src, rawglb, '--color', COL[layer]]
    if layer == 'tran': cmd += ['--clip', mesh, '--smooth']
    if layer == 'dem': cmd += ['--smooth']
    if layer == 'bldg_lod1' and lod2src: cmd += ['--exclude', lod2src]
    st = json.loads(run(cmd).strip().splitlines()[-1])
    st.update(mesh=mesh, layer=layer)
    if 'skipped' not in st:
        run([BASH, f'{HERE}/optimize.sh', rawglb, out])
        st['glb_bytes'] = os.path.getsize(out)
        st['file'] = f'tiles/{mesh}/{mesh}_{layer}.glb'
        st['sha256'] = hashlib.sha256(open(out, 'rb').read()).hexdigest()
    os.makedirs(f'{work}/stats', exist_ok=True)
    json.dump(st, open(st_path, 'w'))
    print(json.dumps({k: st.get(k) for k in ('mesh', 'layer', 'src_tris', 'tris', 'glb_bytes', 'skipped')}), flush=True)
    return st

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('raw'); ap.add_argument('pack')
    ap.add_argument('--jobs', type=int, default=4); ap.add_argument('--only', default='')
    ap.add_argument('--index-only', action='store_true')
    a = ap.parse_args()
    tiles = json.load(open(f'{HERE}/tiles.json'))
    work = os.path.join(os.path.dirname(os.path.abspath(a.pack)), 'work')
    meshes = sorted(tiles) if not a.only else a.only.split(',')
    jobs = []
    for m in meshes:
        src = sources(a.raw, m)
        for layer in ('bldg_lod2', 'brid', 'bldg_lod1', 'dem', 'tran'):   # heavy first
            if layer in src: jobs.append((m, layer, src[layer], src.get('bldg_lod2')))
    if not a.index_only:
        with ThreadPoolExecutor(a.jobs) as ex:
            list(ex.map(lambda j: build_layer(a.raw, a.pack, work, *j), jobs))
    # index + metadata from every stats file present
    to_ll = Transformer.from_crs(6668, 6677, always_xy=True)
    idx = []; meta = open(f'{a.pack}/metadata.jsonl', 'w', encoding='utf-8')
    for m in sorted(tiles):
        sts = [json.load(open(p)) for p in sorted(glob.glob(f'{work}/stats/{m}_*.json'))]
        sts = [s for s in sts if 'file' in s]
        if not sts: continue
        lat0, lon0, lat1, lon1 = mesh_corners(m)
        bb = [[min(s['bbox'][0][i] for s in sts) for i in range(3)], [max(s['bbox'][1][i] for s in sts) for i in range(3)]]
        files = {s['layer']: s['file'] for s in sts}
        idx.append({'mesh': m, 'wards': tiles[m]['wards'], 'bbox': bb, 'files': files,
                    'thumb': f'thumbs/{m}.jpg', 'center_latlon': [round((lat0 + lat1) / 2, 6), round((lon0 + lon1) / 2, 6)]})
        for s in sts:
            row = {'file_name': s['file'], 'mesh_code': m, 'layer': s['layer'], 'layer_description': LAYER_DESC[s['layer']],
                   'wards': tiles[m]['wards'], 'thumbnail': f'thumbs/{m}.jpg',
                   'triangles': s['tris'], 'vertices': s['verts'], 'glb_bytes': s['glb_bytes'], 'sha256': s['sha256'],
                   'source_obj_bytes': s['src_bytes'], 'source_texture_bytes': s.get('src_tex_bytes', 0),
                   'source_textures': s.get('src_textures', 0), 'atlas': s.get('atlas'), 'texel_scale': s.get('texel_scale'),
                   'textured': bool(s.get('atlas')),
                   'mesh_bounds_latlon': [lat0, lon0, lat1, lon1], 'bbox_local_m': s['bbox'],
                   'frame': {'epsg': 6677, 'E0': E0, 'N0': N0, 'axes': 'X=E-E0, Y=height (T.P. m), Z=-(N-N0)'},
                   'source': 'MLIT Project PLATEAU, Tokyo 23 wards 2020 (OBJ release)', 'license': 'PDL1.0 (CC BY 4.0 compatible)'}
            if s['layer'] == 'bldg_lod1': row['lod1_buildings_total'] = s.get('lod1_buildings'); row['lod1_dropped_as_lod2'] = s.get('dropped_as_lod2')
            meta.write(json.dumps(row, ensure_ascii=False) + '\n')
    meta.close()
    json.dump({'origin': {'epsg': 6677, 'E0': E0, 'N0': N0, 'axes': 'X=E-E0, Y=height, Z=-(N-N0)'},
               'layers': list(LAYER_DESC), 'tiles': idx}, open(f'{a.pack}/tiles.json', 'w', encoding='utf-8'), ensure_ascii=False)
    print('index:', len(idx), 'tiles')

if __name__ == '__main__':
    main()
