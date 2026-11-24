// Chunked marching cubes over the density field.
// Lookup tables are Paul Bourke's (public domain), taken from the three.js examples module.
import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';
import { ISO } from './field.js';

// Bourke edge -> [corner offset dx,dy,dz, axis]
const EDGE = [
  [0, 0, 0, 0], [1, 0, 0, 1], [0, 1, 0, 0], [0, 0, 0, 1],
  [0, 0, 1, 0], [1, 0, 1, 1], [0, 1, 1, 0], [0, 0, 1, 1],
  [0, 0, 0, 2], [1, 0, 0, 2], [1, 1, 0, 2], [0, 1, 0, 2],
];
const CORNER = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const AO_DIRS = [[0, 1, 0], [0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.7, 0.7], [0, 0.7, -0.7]];

export class ChunkMesher {
  constructor(field) {
    this.f = field;
    const c = field.chunk, p = c + 1;
    this.p = p;
    this.cache = new Int32Array(p * p * p * 3);
    const maxV = p * p * p * 3, maxI = c * c * c * 15;
    this.pos = new Float32Array(maxV * 3);
    this.nor = new Float32Array(maxV * 3);
    this.aux = new Float32Array(maxV * 2);
    this.idx = new Uint32Array(maxI);
    this.ox = (field.nx - 1) / 2; this.oz = (field.nz - 1) / 2; this.oy = 0;
  }

  // gradient of total density at an integer grid point (central differences, clamped)
  grad(x, y, z, out) {
    const f = this.f, t = f.total, nx = f.nx, ny = f.ny, nz = f.nz, sy = nx, sz = nx * ny;
    const i = x + y * sy + z * sz;
    const xm = x > 0 ? i - 1 : i, xp = x < nx - 1 ? i + 1 : i;
    const ym = y > 0 ? i - sy : i, yp = y < ny - 1 ? i + sy : i;
    const zm = z > 0 ? i - sz : i, zp = z < nz - 1 ? i + sz : i;
    out[0] = t[xp] - t[xm]; out[1] = t[yp] - t[ym]; out[2] = t[zp] - t[zm];
  }

  // returns {positions, normals, aux, index} or null when the chunk is empty
  build(cx, cy, cz) {
    const f = this.f, c = f.chunk, p = this.p;
    const nx = f.nx, ny = f.ny, nz = f.nz, sy = nx, sz = nx * ny;
    const T = f.total, C = f.coral;
    const x0 = cx * c, y0 = cy * c, z0 = cz * c;
    const x1 = Math.min(x0 + c, nx - 1), y1 = Math.min(y0 + c, ny - 1), z1 = Math.min(z0 + c, nz - 1);
    const cache = this.cache; cache.fill(-1);
    const pos = this.pos, nor = this.nor, aux = this.aux, idx = this.idx;
    let nv = 0, ni = 0;
    const ga = [0, 0, 0], gb = [0, 0, 0];
    const vals = new Float32Array(8);
    const ox = this.ox, oz = this.oz;

    const vertexFor = (lx, ly, lz, axis) => {
      const key = ((lx + ly * p + lz * p * p) * 3) + axis;
      let v = cache[key];
      if (v >= 0) return v;
      const ax = x0 + lx, ay = y0 + ly, az = z0 + lz;
      const bx = ax + (axis === 0), by = ay + (axis === 1), bz = az + (axis === 2);
      const ia = ax + ay * sy + az * sz, ib = bx + by * sy + bz * sz;
      const va = T[ia], vb = T[ib];
      let t = (ISO - va) / (vb - va);
      if (!(t >= 0 && t <= 1)) t = 0.5;
      const px = ax + (bx - ax) * t, py = ay + (by - ay) * t, pz = az + (bz - az) * t;
      this.grad(ax, ay, az, ga); this.grad(bx, by, bz, gb);
      let gx = ga[0] + (gb[0] - ga[0]) * t, gy = ga[1] + (gb[1] - ga[1]) * t, gz = ga[2] + (gb[2] - ga[2]) * t;
      let gl = Math.hypot(gx, gy, gz) || 1;
      gx = -gx / gl; gy = -gy / gl; gz = -gz / gl; // density grows inward: outward normal is -grad
      // coral fraction
      const ca = C[ia] / Math.max(va, 1e-4), cb = C[ib] / Math.max(vb, 1e-4);
      const coral = Math.min(1, ca + (cb - ca) * t);
      // ambient occlusion from the field: probe along the normal and a few upward directions
      let occ = 0;
      occ += Math.min(1, f.sample(px + gx * 1.6, py + gy * 1.6, pz + gz * 1.6) / ISO) * 0.30;
      occ += Math.min(1, f.sample(px + gx * 3.2, py + gy * 3.2, pz + gz * 3.2) / ISO) * 0.25;
      for (let k = 0; k < AO_DIRS.length; k++) {
        const d = AO_DIRS[k], s = 4.5;
        const qx = px + (d[0] + gx) * s, qy = py + (d[1] + gy) * s, qz = pz + (d[2] + gz) * s;
        occ += Math.min(1, f.sample(qx, qy, qz) / ISO) * 0.09;
        occ += Math.min(1, f.sample(qx * 1 + d[0] * 5, qy + d[1] * 5, qz + d[2] * 5) / ISO) * 0.07;
      }
      const ao = Math.max(0, 1 - occ);
      v = nv++;
      pos[v * 3] = px - ox; pos[v * 3 + 1] = py; pos[v * 3 + 2] = pz - oz;
      nor[v * 3] = gx; nor[v * 3 + 1] = gy; nor[v * 3 + 2] = gz;
      aux[v * 2] = coral; aux[v * 2 + 1] = ao;
      cache[key] = v;
      return v;
    };

    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = x + y * sy + z * sz;
      vals[0] = T[i]; vals[1] = T[i + 1]; vals[2] = T[i + 1 + sy]; vals[3] = T[i + sy];
      vals[4] = T[i + sz]; vals[5] = T[i + 1 + sz]; vals[6] = T[i + 1 + sy + sz]; vals[7] = T[i + sy + sz];
      let ci = 0;
      for (let k = 0; k < 8; k++) if (vals[k] < ISO) ci |= 1 << k;
      if (edgeTable[ci] === 0) continue;
      const lx = x - x0, ly = y - y0, lz = z - z0;
      const base = ci * 16;
      for (let k = 0; triTable[base + k] !== -1; k += 3) {
        for (let m = 0; m < 3; m++) {
          const e = EDGE[triTable[base + k + m]];
          idx[ni++] = vertexFor(lx + e[0], ly + e[1], lz + e[2], e[3]);
        }
      }
    }
    if (ni === 0) return null;
    return {
      positions: pos.slice(0, nv * 3),
      normals: nor.slice(0, nv * 3),
      aux: aux.slice(0, nv * 2),
      index: idx.slice(0, ni),
    };
  }
}
export { CORNER };
