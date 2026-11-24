import * as THREE from 'three';

// A voxel grid: Uint8 material ids, 0 = empty.
export class Grid {
  constructor(nx, ny, nz) {
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.d = new Uint8Array(nx * ny * nz);
  }
  i(x, y, z) { return x + this.nx * (y + this.ny * z); }
  get(x, y, z) {
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return 0;
    return this.d[this.i(x, y, z)];
  }
  set(x, y, z, v) {
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return;
    this.d[this.i(x, y, z)] = v;
  }
  box(x0, y0, z0, x1, y1, z1, v) {
    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, z, v);
  }
}

function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Face directions: normal, and the two tangent axes used for the quad corners.
const FACES = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];

// Face-culling mesher with per-vertex ambient occlusion (side/side/corner rule)
// and per-voxel colour jitter. `palette[id] = { color:[r,g,b] (linear), jitter, group }`.
// Returns one BufferGeometry per palette group.
export function meshGrid(grid, palette, scale = 1, opaque = (id) => id !== 0) {
  const buckets = new Map();
  const bucket = (g) => {
    if (!buckets.has(g)) buckets.set(g, { pos: [], nrm: [], col: [], idx: [] });
    return buckets.get(g);
  };
  const solid = (x, y, z) => opaque(grid.get(x, y, z));
  const aoLevel = [1.0, 0.72, 0.5, 0.32];

  for (let z = 0; z < grid.nz; z++)
    for (let y = 0; y < grid.ny; y++)
      for (let x = 0; x < grid.nx; x++) {
        const id = grid.get(x, y, z);
        if (!id) continue;
        const p = palette[id];
        const j = 1 + (hash3(x, y, z) - 0.5) * 2 * (p.jitter ?? 0.1);
        let base = p.color.map((c) => c * j);
        if (p.tint) { const t = p.tint(x, y, z); base = [base[0] * t[0], base[1] * t[1], base[2] * t[2]]; }
        const b = bucket(p.group ?? 0);
        for (const f of FACES) {
          const [nx, ny, nz] = f.n;
          if (solid(x + nx, y + ny, z + nz)) continue;
          // face plane origin: the voxel corner on the + side when normal is positive
          const ox = x + (nx > 0 ? 1 : 0), oy = y + (ny > 0 ? 1 : 0), oz = z + (nz > 0 ? 1 : 0);
          const ax = x + nx, ay = y + ny, az = z + nz; // neighbour cell in front of the face
          const vi = b.pos.length / 3;
          const ao = [];
          for (let c = 0; c < 4; c++) {
            const su = c === 1 || c === 2 ? 1 : 0;
            const sv = c >= 2 ? 1 : 0;
            const du = su ? 1 : -1, dv = sv ? 1 : -1;
            const s1 = solid(ax + f.u[0] * du, ay + f.u[1] * du, az + f.u[2] * du) ? 1 : 0;
            const s2 = solid(ax + f.v[0] * dv, ay + f.v[1] * dv, az + f.v[2] * dv) ? 1 : 0;
            const cr = solid(ax + f.u[0] * du + f.v[0] * dv, ay + f.u[1] * du + f.v[1] * dv, az + f.u[2] * du + f.v[2] * dv) ? 1 : 0;
            const occ = s1 && s2 ? 3 : s1 + s2 + cr;
            ao.push(aoLevel[occ]);
            const px = ox + f.u[0] * su + f.v[0] * sv;
            const py = oy + f.u[1] * su + f.v[1] * sv;
            const pz = oz + f.u[2] * su + f.v[2] * sv;
            b.pos.push(px * scale, py * scale, pz * scale);
            b.nrm.push(nx, ny, nz);
            const shade = ao[c] * (p.emissive ? 1 : 1);
            b.col.push(base[0] * shade, base[1] * shade, base[2] * shade);
          }
          // flip the diagonal to avoid anisotropic AO artefacts
          if (ao[0] + ao[2] > ao[1] + ao[3]) b.idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
          else b.idx.push(vi + 1, vi + 2, vi + 3, vi + 1, vi + 3, vi);
        }
      }

  const out = {};
  for (const [g, b] of buckets) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    geo.setIndex(b.idx.length > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
    geo.computeBoundingSphere();
    out[g] = geo;
  }
  return out;
}
