"""PLATEAU OBJ (EPSG:6677) -> single-material atlased GLB in a shared local frame.

usage: build_tile.py OBJ OUT.glb [--atlas 4096] [--density 0] [--clip MESH8] [--color r,g,b]
  Local frame: X = easting - E0, Y = height, Z = -(northing - N0)  (glTF Y-up, metres)
  --clip MESH8 keeps only triangles whose centroid falls inside that 3rd-level mesh (for 10 km road files).
Prints one JSON line of stats.
"""
import sys, os, json, math, argparse, struct, re
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
E0, N0 = -10000.0, -35500.0          # pack origin in JGD2011 Plane IX (approx. Akasaka / Nagatacho)

def mesh_of(lat, lon):
    p = np.floor(lat * 1.5).astype(int); u = np.floor(lon - 100).astype(int)
    a = lat * 60 - p * 40; q = np.floor(a / 5).astype(int); v = np.floor((a - q * 5) * 2).astype(int)
    f = (lon - 100 - u) * 60; w = np.floor(f / 7.5).astype(int); x = np.floor((f - w * 7.5) / 0.75).astype(int)
    return p * 1000000 + u * 10000 + q * 1000 + w * 100 + v * 10 + x

def parse_obj(path):
    V, VT, mats, faces = [], [], [], []   # faces: (mat_idx, v0,v1,v2, t0,t1,t2)
    cur = -1; matnames = {}
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            c = line[:2]
            if c == 'v ':
                V.append(line[2:].split()[:3])
            elif c == 'vt':
                VT.append(line[3:].split()[:2])
            elif c == 'f ':
                parts = line[2:].split()
                idx = [p.split('/') for p in parts]
                vi = [int(p[0]) for p in idx]
                ti = [int(p[1]) if len(p) > 1 and p[1] else 0 for p in idx]
                for k in range(1, len(vi) - 1):   # fan triangulation
                    faces.append((cur, vi[0], vi[k], vi[k + 1], ti[0], ti[k], ti[k + 1]))
            elif line.startswith('usemtl'):
                n = line.split(None, 1)[1].strip()
                if n not in matnames: matnames[n] = len(mats); mats.append(n)
                cur = matnames[n]
            elif line.startswith('mtllib'):
                mtllib = line.split(None, 1)[1].strip()
    V = np.array(V, dtype=np.float64) if V else np.zeros((0, 3))
    VT = np.array(VT, dtype=np.float64) if VT else np.zeros((0, 2))
    F = np.array(faces, dtype=np.int64) if faces else np.zeros((0, 7), dtype=np.int64)
    return V, VT, F, mats

def parse_mtl(path):
    out = {}; cur = None
    if not os.path.exists(path): return out
    for line in open(path, encoding='utf-8', errors='replace'):
        s = line.strip().split(None, 1)
        if not s: continue
        if s[0] == 'newmtl': cur = s[1]; out[cur] = {}
        elif cur and s[0] == 'map_Kd': out[cur]['tex'] = s[1].replace('\\', '/')
        elif cur and s[0] == 'Kd': out[cur]['kd'] = [float(x) for x in s[1].split()[:3]]
    return out

def shelf_pack(sizes, A):
    """sizes: list of (w,h). Returns positions or None if overflow."""
    order = sorted(range(len(sizes)), key=lambda i: -sizes[i][1])
    pos = [None] * len(sizes); x = y = rowh = 0
    for i in order:
        w, h = sizes[i]
        if w > A: return None
        if x + w > A: y += rowh; x = 0; rowh = 0
        if y + h > A: return None
        pos[i] = (x, y); x += w; rowh = max(rowh, h)
    return pos

def write_glb(path, pos, nrm, uv, idx, image_bytes, color, extras):
    bufs = []; views = []; accs = []
    def add(arr, target, comp, typ, minmax=False):
        b = arr.tobytes(); off = sum(len(x) for x in bufs)
        pad = (-len(b)) % 4; bufs.append(b + b'\0' * pad)
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(b), **({'target': target} if target else {})})
        a = {'bufferView': len(views) - 1, 'componentType': comp, 'count': len(arr), 'type': typ}
        if minmax: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
        accs.append(a); return len(accs) - 1
    attrs = {'POSITION': add(pos.astype(np.float32), 34962, 5126, 'VEC3', True),
             'NORMAL': add(nrm.astype(np.float32), 34962, 5126, 'VEC3')}
    if uv is not None: attrs['TEXCOORD_0'] = add(uv.astype(np.float32), 34962, 5126, 'VEC2')
    ia = add(idx.astype(np.uint32), 34963, 5125, 'SCALAR')
    mat = {'name': 'plateau', 'pbrMetallicRoughness': {'metallicFactor': 0.0, 'roughnessFactor': 0.9,
           'baseColorFactor': list(color) + [1.0]}, 'doubleSided': False}
    gl = {'asset': {'version': '2.0', 'generator': 'plateau-tokyo-glb build_tile.py'},
          'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': os.path.basename(path)[:-4]}],
          'meshes': [{'primitives': [{'attributes': attrs, 'indices': ia, 'material': 0}]}],
          'materials': [mat], 'accessors': accs, 'bufferViews': views, 'extras': extras}
    if image_bytes is not None:
        off = sum(len(x) for x in bufs); pad = (-len(image_bytes)) % 4
        bufs.append(image_bytes + b'\0' * pad)
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(image_bytes)})
        gl['images'] = [{'bufferView': len(views) - 1, 'mimeType': 'image/jpeg'}]
        gl['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}]
        gl['textures'] = [{'sampler': 0, 'source': 0}]
        mat['pbrMetallicRoughness']['baseColorTexture'] = {'index': 0}
        mat['pbrMetallicRoughness']['baseColorFactor'] = [1, 1, 1, 1]
    binb = b''.join(bufs); gl['buffers'] = [{'byteLength': len(binb)}]
    js = json.dumps(gl, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binb)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(binb), 0x004E4942)); f.write(binb)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('obj'); ap.add_argument('out')
    ap.add_argument('--atlas', type=int, default=4096)
    ap.add_argument('--clip', type=int, default=0)
    ap.add_argument('--color', default='0.8,0.8,0.8')
    ap.add_argument('--exclude', default='', help='LOD2 OBJ: drop buildings whose centroid lies in its footprint')
    ap.add_argument('--smooth', action='store_true', help='average normals (terrain)')
    a = ap.parse_args()
    V, VT, F, mats = parse_obj(a.obj)
    stats = {'src': os.path.basename(a.obj), 'src_bytes': os.path.getsize(a.obj), 'src_tris': int(len(F))}
    if len(F) == 0:
        print(json.dumps({**stats, 'skipped': 'empty'})); return
    tri = V[F[:, 1:4] - 1]                                  # (n,3,3) E,N,h
    if a.clip:
        from pyproj import Transformer
        t = Transformer.from_crs(6677, 6668, always_xy=True)
        c = tri.mean(1); lon, lat = t.transform(c[:, 0], c[:, 1])
        keep = mesh_of(np.asarray(lat), np.asarray(lon)) == a.clip
        F = F[keep]; tri = tri[keep]
        if len(F) == 0:
            print(json.dumps({**stats, 'skipped': 'clip-empty'})); return
    if a.exclude and os.path.exists(a.exclude):
        from PIL import ImageDraw
        from scipy.sparse import coo_matrix
        from scipy.sparse.csgraph import connected_components
        V2, _, F2, _ = parse_obj(a.exclude)
        t2 = V2[F2[:, 1:4] - 1][..., :2]
        ox, oy = t2[..., 0].min() - 5, t2[..., 1].min() - 5
        Wm, Hm = int(t2[..., 0].max() - ox + 10), int(t2[..., 1].max() - oy + 10)
        mask = Image.new('1', (Wm, Hm), 0); d = ImageDraw.Draw(mask)
        for t in t2: d.polygon([(x - ox, y - oy) for x, y in t], fill=1)
        mask = np.asarray(mask)
        # buildings = connected components over shared vertices
        nV = len(V); e = F[:, 1:4] - 1
        g = coo_matrix((np.ones(len(F) * 2), (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 2]])), shape=(nV, nV))
        ncomp, lab = connected_components(g, directed=False)
        fl = lab[e[:, 0]]
        cx = np.bincount(fl, tri[..., 0].mean(1), ncomp) / np.maximum(np.bincount(fl, None, ncomp), 1)
        cy = np.bincount(fl, tri[..., 1].mean(1), ncomp) / np.maximum(np.bincount(fl, None, ncomp), 1)
        ix = np.clip((cx - ox).astype(int), 0, Wm - 1); iy = np.clip((cy - oy).astype(int), 0, Hm - 1)
        inside = mask[iy, ix] & (cx >= ox) & (cx < ox + Wm) & (cy >= oy) & (cy < oy + Hm)
        keep = ~inside[fl]
        stats.update(lod1_buildings=int(ncomp), dropped_as_lod2=int(inside.sum()))
        F = F[keep]; tri = tri[keep]
    mtl = parse_mtl(os.path.join(os.path.dirname(a.obj), 'materials.mtl'))
    texdir = os.path.dirname(a.obj)
    has_uv = len(VT) > 0 and (F[:, 4:7] > 0).any()
    nouv = (F[:, 4:7] <= 0).any(1)
    if has_uv: F[nouv, 0] = -2; F[nouv, 4:7] = 1          # faces without UVs -> solid colour patch
    uv_out = None; image_bytes = None; color = [float(x) for x in a.color.split(',')]
    src_tex_bytes = 0
    if has_uv and any('tex' in mtl.get(m, {}) for m in mats):
        UV = VT[F[:, 4:7] - 1]                               # (n,3,2)
        regions = []                                         # per material: (img, crop rect px, faces mask)
        sizes = []; mat_regions = {}
        for mi, m in enumerate(mats):
            sel = F[:, 0] == mi
            if not sel.any(): continue
            info = mtl.get(m, {})
            tp = os.path.join(texdir, info['tex']) if 'tex' in info else None
            if tp and os.path.exists(tp):
                src_tex_bytes += os.path.getsize(tp)
                im = Image.open(tp); W, H = im.size          # lazy: header only
                u = UV[sel][..., 0]; v = UV[sel][..., 1]
                # shift whole-tile offsets, then clamp
                u = u - np.floor(u.min()) if u.min() < -0.01 or u.max() > 1.01 else u
                v = v - np.floor(v.min()) if v.min() < -0.01 or v.max() > 1.01 else v
                u = np.clip(u, 0, 1); v = np.clip(v, 0, 1)
                UV[sel, :, 0] = u; UV[sel, :, 1] = v
                px = u * W; py = (1 - v) * H
                x0 = max(int(math.floor(px.min())) - 1, 0); x1 = min(int(math.ceil(px.max())) + 1, W)
                y0 = max(int(math.floor(py.min())) - 1, 0); y1 = min(int(math.ceil(py.max())) + 1, H)
                mat_regions[mi] = ('img', im, (x0, y0, max(x1, x0 + 1), max(y1, y0 + 1)))
            else:
                kd = info.get('kd', color)
                mat_regions[mi] = ('col', tuple(int(c * 255) for c in kd), None)
        if nouv.any(): mat_regions[-2] = ('col', tuple(int(c * 255) for c in color), None)
        A = a.atlas; PAD = 2
        total = sum((r[2][2] - r[2][0]) * (r[2][3] - r[2][1]) for r in mat_regions.values() if r[0] == 'img')
        s = min(1.0, math.sqrt(0.82 * A * A / max(total, 1)))
        keys = list(mat_regions)
        while True:
            sizes = []
            for k in keys:
                kind, im, rect = mat_regions[k]
                if kind == 'img':
                    w = max(2, int(round((rect[2] - rect[0]) * s))); h = max(2, int(round((rect[3] - rect[1]) * s)))
                else: w = h = 2
                sizes.append((w + 2 * PAD, h + 2 * PAD))
            pos = shelf_pack(sizes, A)
            if pos: break
            s *= 0.93
        used_h = max(p[1] + sz[1] for p, sz in zip(pos, sizes))
        AH = 1 << max(6, math.ceil(math.log2(used_h)))      # trim atlas height to power of two
        atlas = np.zeros((AH, A, 3), np.uint8)
        for k, (x, y), (w2, h2) in zip(keys, pos, sizes):
            kind, im, rect = mat_regions[k]; w, h = w2 - 2 * PAD, h2 - 2 * PAD
            if kind == 'img':
                W0, H0 = im.size
                if im.format == 'JPEG':   # decode at reduced DCT scale, still >= target size
                    im.draft('RGB', (max(1, int(W0 * w / (rect[2] - rect[0]))), max(1, int(H0 * h / (rect[3] - rect[1])))))
                img = im.convert('RGB'); fx = img.size[0] / W0; fy = img.size[1] / H0
                r2 = (int(rect[0] * fx), int(rect[1] * fy), max(int(rect[0] * fx) + 1, int(math.ceil(rect[2] * fx))), max(int(rect[1] * fy) + 1, int(math.ceil(rect[3] * fy))))
                crop = np.asarray(img.crop(r2).resize((w, h), Image.LANCZOS)); im.close()
                atlas[y:y + h2, x:x + w2] = np.pad(crop, ((PAD, PAD), (PAD, PAD), (0, 0)), mode='edge')
                sel = F[:, 0] == k
                px = UV[sel][..., 0] * W0; py = (1 - UV[sel][..., 1]) * H0
                sx = w / (rect[2] - rect[0]); sy = h / (rect[3] - rect[1])
                UV[sel, :, 0] = (x + PAD + (px - rect[0]) * sx) / A
                UV[sel, :, 1] = (y + PAD + (py - rect[1]) * sy) / AH
            else:
                atlas[y:y + h2, x:x + w2] = im
                sel = F[:, 0] == k
                UV[sel, :, 0] = (x + PAD + 1) / A; UV[sel, :, 1] = (y + PAD + 1) / AH
        from io import BytesIO
        bio = BytesIO(); Image.fromarray(atlas).save(bio, 'JPEG', quality=88); image_bytes = bio.getvalue()
        uv_out = UV.reshape(-1, 2)
        stats.update(atlas=f'{A}x{AH}', texel_scale=round(s, 3), src_textures=len([r for r in mat_regions.values() if r[0] == 'img']),
                     src_tex_bytes=src_tex_bytes, untextured_tris=int(nouv.sum()))
    # local frame
    P = np.empty_like(tri); P[..., 0] = tri[..., 0] - E0; P[..., 1] = tri[..., 2]; P[..., 2] = -(tri[..., 1] - N0)
    n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); ln = np.linalg.norm(n, axis=1, keepdims=True)
    good = ln[:, 0] > 1e-9
    n = n / np.maximum(ln, 1e-12)
    P = P[good]; n = n[good]
    if uv_out is not None: uv_out = uv_out.reshape(-1, 3, 2)[good].reshape(-1, 2)
    pos = P.reshape(-1, 3); nrm = np.repeat(n, 3, axis=0)
    if a.smooth:   # shared vertex normals for terrain / roads
        key = np.round(pos, 2); _, inv = np.unique(key, axis=0, return_inverse=True)
        acc = np.zeros((inv.max() + 1, 3)); np.add.at(acc, inv, nrm * np.repeat(ln[good], 3, axis=0))
        acc /= np.maximum(np.linalg.norm(acc, axis=1, keepdims=True), 1e-12); nrm = acc[inv]
    # dedupe identical corners
    cols = [np.round(pos, 3), np.round(nrm, 3)] + ([np.round(uv_out, 6)] if uv_out is not None else [])
    keyarr = np.ascontiguousarray(np.hstack(cols)).view(np.dtype((np.void, 8 * sum(c.shape[1] for c in cols))))
    _, first, inv = np.unique(keyarr, return_index=True, return_inverse=True)
    idx = inv.ravel()
    bb = [pos.min(0).tolist(), pos.max(0).tolist()]
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    write_glb(a.out, pos[first], nrm[first], uv_out[first] if uv_out is not None else None, idx, image_bytes, color,
              {'crs_origin': {'epsg': 6677, 'E0': E0, 'N0': N0, 'axes': 'X=E-E0, Y=height, Z=-(N-N0)'}})
    stats.update(tris=int(len(idx) // 3), verts=int(len(first)), bbox=[[round(x, 1) for x in b] for b in bb],
                 out_bytes=os.path.getsize(a.out))
    print(json.dumps(stats))

if __name__ == '__main__':
    main()
