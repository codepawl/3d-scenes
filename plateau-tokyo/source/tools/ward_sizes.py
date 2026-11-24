import csv, re, sys, collections, json
L = sys.argv[1]
wards = collections.defaultdict(set); names = {}
for r in csv.DictReader(open(f'{L}/mesh_13.csv', encoding='utf-8')):
    c = r['都道府県市区町村コード']
    if '13101' <= c <= '13123':
        wards[c].add(r['基準メッシュ・コード']); names[c] = r['市区町村名']
def load(f):
    out = []
    for line in open(f'{L}/{f}', encoding='utf-8'):
        cs, fs, name = line.rstrip('\n').split('\t'); out.append((int(cs), name))
    return out
obj, cg = load('obj.tsv'), load('citygml_v2.tsv')
def cat(name):
    m = re.search(r'/(\d{8})_', name)
    mesh = m.group(1) if m else None
    tex = name.lower().endswith(('.jpg', '.png'))
    if '/bldg/lod1/' in name: k = 'obj_lod1'
    elif '/bldg/lod2/' in name: k = 'obj_lod2_tex' if tex else 'obj_lod2_geom'
    elif '/dem/' in name: k = 'obj_dem'
    elif '/udx/bldg/' in name: k = 'gml_bldg_tex' if tex else 'gml_bldg'
    else: k = None
    return mesh, k
rows = {}
order = sys.argv[2].split(',') if len(sys.argv) > 2 else sorted(wards)
for c in order:
    s = collections.Counter(); n = collections.Counter()
    for lst in (obj, cg):
        for cs, name in lst:
            mesh, k = cat(name)
            if k and mesh in wards[c]: s[k] += cs; n[k] += 1
    rows[c] = dict(name=names[c], meshes=len(wards[c]), **{k: round(v/1e6, 1) for k, v in s.items()}, lod2_tex_files=n['obj_lod2_tex'], lod2_tiles=len({cat(nm)[0] for _, nm in obj if '/bldg/lod2/' in nm and cat(nm)[0] in wards[c]}))
    print(json.dumps({c: rows[c]}, ensure_ascii=False))
