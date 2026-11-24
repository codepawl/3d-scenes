"""Film-only copies of the float32 intermediate GLBs (work/raw) with a per-building _ANCHOR attribute.
_ANCHOR = (centre x, base y, centre z, height) of the welded connected component each vertex belongs to,
so a shader can grow every building from its own base as one piece.
usage: film_assets.py WORK_RAW OUT_DIR [--hero MESH,...] [--tex 2048]
Non-hero LOD2/bridge atlases are shrunk to --tex to save VRAM. Pack files are not touched.
"""
import sys, os, json, struct, argparse, glob, io
import numpy as np
from PIL import Image
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

def read_glb(p):
    b = open(p, 'rb').read()
    jl = struct.unpack_from('<I', b, 12)[0]; js = json.loads(b[20:20 + jl])
    bin_off = 20 + jl + 8; binb = b[bin_off:]
    def acc(i):
        a = js['accessors'][i]; v = js['bufferViews'][a['bufferView']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        dt = {5126: np.float32, 5125: np.uint32}[a['componentType']]
        return np.frombuffer(binb, dt, a['count'] * n, v['byteOffset']).reshape(a['count'], n) if n > 1 else \
               np.frombuffer(binb, dt, a['count'], v['byteOffset'])
    prim = js['meshes'][0]['primitives'][0]
    out = {k: acc(i) for k, i in prim['attributes'].items()}
    out['indices'] = acc(prim['indices'])
    img = None
    if 'images' in js:
        v = js['bufferViews'][js['images'][0]['bufferView']]; img = binb[v['byteOffset']:v['byteOffset'] + v['byteLength']]
    col = js['materials'][0]['pbrMetallicRoughness'].get('baseColorFactor', [1, 1, 1, 1])
    return out, img, col

def write_glb(p, attrs, idx, img, col):
    bufs = []; views = []; accs = []
    def add(arr, target, comp, typ, mm=False):
        bb = arr.tobytes(); off = sum(len(x) for x in bufs); bufs.append(bb + b'\0' * ((-len(bb)) % 4))
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(bb), **({'target': target} if target else {})})
        a = {'bufferView': len(views) - 1, 'componentType': comp, 'count': len(arr), 'type': typ}
        if mm: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
        accs.append(a); return len(accs) - 1
    T = {2: 'VEC2', 3: 'VEC3', 4: 'VEC4'}
    at = {k: add(np.ascontiguousarray(v, np.float32), 34962, 5126, T[v.shape[1]], k == 'POSITION') for k, v in attrs.items()}
    ia = add(np.ascontiguousarray(idx, np.uint32), 34963, 5125, 'SCALAR')
    mat = {'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 0.9, 'baseColorFactor': col}}
    gl = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0}],
          'meshes': [{'primitives': [{'attributes': at, 'indices': ia, 'material': 0}]}], 'materials': [mat],
          'accessors': accs, 'bufferViews': views}
    if img is not None:
        off = sum(len(x) for x in bufs); bufs.append(img + b'\0' * ((-len(img)) % 4))
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(img)})
        gl.update(images=[{'bufferView': len(views) - 1, 'mimeType': 'image/jpeg'}], textures=[{'source': 0, 'sampler': 0}],
                  samplers=[{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}])
        mat['pbrMetallicRoughness']['baseColorTexture'] = {'index': 0}
    binb = b''.join(bufs); gl['buffers'] = [{'byteLength': len(binb)}]
    js = json.dumps(gl, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
    with open(p, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(binb)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(binb), 0x004E4942)); f.write(binb)

def anchors(pos, idx):
    key = np.round(pos.astype(np.float64) * 20).astype(np.int64)          # weld at 5 cm
    _, wid = np.unique(key, axis=0, return_inverse=True); wid = wid.ravel()
    t = wid[idx.reshape(-1, 3)]; n = wid.max() + 1
    g = coo_matrix((np.ones(len(t) * 2), (np.r_[t[:, 0], t[:, 1]], np.r_[t[:, 1], t[:, 2]])), shape=(n, n))
    nc, lab = connected_components(g, directed=False)
    vl = lab[wid]
    cx = np.bincount(vl, pos[:, 0], nc) / np.bincount(vl, None, nc)
    cz = np.bincount(vl, pos[:, 2], nc) / np.bincount(vl, None, nc)
    ymin = np.full(nc, np.inf); np.minimum.at(ymin, vl, pos[:, 1])
    ymax = np.full(nc, -np.inf); np.maximum.at(ymax, vl, pos[:, 1])
    return np.stack([cx[vl], ymin[vl], cz[vl], (ymax - ymin)[vl]], 1).astype(np.float32), nc

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('raw'); ap.add_argument('out')
    ap.add_argument('--hero', default=''); ap.add_argument('--tex', type=int, default=2048)
    a = ap.parse_args(); hero = set(a.hero.split(',')) if a.hero else set()
    os.makedirs(a.out, exist_ok=True); index = {}
    for p in sorted(glob.glob(f'{a.raw}/*.glb')):
        name = os.path.basename(p)[:-4]; mesh, layer = name.split('_', 1)
        dst = f'{a.out}/{name}.glb'
        index.setdefault(mesh, {})[layer] = f'{name}.glb'
        if os.path.exists(dst) and os.path.getmtime(dst) > os.path.getmtime(p): continue
        g, img, col = read_glb(p); idx = g.pop('indices')
        info = {'file': name}
        if layer in ('bldg_lod1', 'bldg_lod2', 'brid'):
            g['_ANCHOR'], nc = anchors(g['POSITION'], idx); info['buildings'] = int(nc)
        if img is not None and mesh not in hero:
            im = Image.open(io.BytesIO(img)); s = a.tex / max(im.size)
            if s < 1:
                im = im.resize((max(1, int(im.size[0] * s)), max(1, int(im.size[1] * s))), Image.LANCZOS)
                bio = io.BytesIO(); im.save(bio, 'JPEG', quality=88); img = bio.getvalue()
        write_glb(dst, g, idx, img, col)
        print(json.dumps(info), flush=True)
    index = {}                                   # index every film GLB in the folder (pack tiles + film-only ring)
    for q in sorted(glob.glob(f'{a.out}/*.glb')):
        n = os.path.basename(q)[:-4]
        if n.startswith('_'): continue           # scene-wide film assets (ground) are loaded separately
        m, l = n.split('_', 1); index.setdefault(m, {})[l] = n + '.glb'
    json.dump(index, open(f'{a.out}/index.json', 'w'), indent=0)

if __name__ == '__main__':
    main()
