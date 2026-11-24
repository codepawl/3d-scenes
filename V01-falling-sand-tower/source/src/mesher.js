// Chunk mesher: emits only exposed faces, with per-vertex ambient occlusion and hashed per-voxel tint.
import { N, NN, CS, EMPTY, ROCK, SAND, WATER, LAVA, BASALT } from './sim.js';

const MAX_FACES = CS * CS * CS * 6;
const tmp = {
  pos: new Float32Array(MAX_FACES * 4 * 3),
  nrm: new Int8Array(MAX_FACES * 4 * 3),
  col: new Uint8Array(MAX_FACES * 4 * 3),
  emi: new Uint8Array(MAX_FACES * 4),
};
const tmpIdx = new Uint32Array(MAX_FACES * 6);

// face definitions: normal, and the 4 corners (as offsets 0/1) in CCW order seen from outside
const FACES = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], o: [1, 0, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], o: [0, 0, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0], o: [0, 1, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], o: [0, 0, 0] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], o: [0, 0, 1] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0], o: [0, 0, 0] },
];
const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
const AO_LEVEL = [0.42, 0.62, 0.8, 1.0];
const SHADE = [1, 1, 1, 1, 1, 1]; // lighting handles direction; kept as a hook

function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function baseColor(m, x, y, z, out) {
  const h = hash3(x, y, z);
  switch (m) {
    case ROCK: {
      const band = Math.sin(y * 0.55 + Math.sin(x * 0.11 + z * 0.07) * 1.6) * 0.5 + 0.5; // strata
      const v = 0.85 + h * 0.2;
      out[0] = (0.42 + band * 0.12) * v; out[1] = (0.37 + band * 0.08) * v; out[2] = (0.33 + band * 0.04) * v;
      return 0;
    }
    case SAND: {
      const v = 0.88 + h * 0.2;
      out[0] = 0.93 * v; out[1] = 0.76 * v; out[2] = 0.47 * v; return 0;
    }
    case WATER: {
      const v = 0.92 + h * 0.12;
      out[0] = 0.16 * v; out[1] = 0.46 * v; out[2] = 0.78 * v; return 0;
    }
    case LAVA: {
      out[0] = 1.0; out[1] = 0.28 + h * 0.25; out[2] = 0.04; return 0.75 + h * 0.25;
    }
    case BASALT: {
      const v = 0.8 + h * 0.4;
      out[0] = 0.2 * v; out[1] = 0.19 * v; out[2] = 0.22 * v;
      return h > 0.93 ? 0.25 : 0; // a few still-glowing embers
    }
  }
  return 0;
}

// solid (occluding) for AO / opaque face culling
const isSolid = (m) => m !== EMPTY && m !== WATER;

export function meshChunk(grid, cx, cy, cz) {
  const out = { opaque: null, water: null };
  const c = [0, 0, 0];
  const g = grid;
  const at = (x, y, z) => {
    if (y < 0) return ROCK;
    if (x < 0 || z < 0 || x >= N || z >= N || y >= N) return EMPTY;
    return g[x + z * N + y * NN];
  };

  for (let pass = 0; pass < 2; pass++) {
    const wantWater = pass === 1;
    let nf = 0;
    const { pos, nrm, col, emi } = tmp;
    for (let ly = 0; ly < CS; ly++) {
      const y = cy * CS + ly;
      for (let lz = 0; lz < CS; lz++) {
        const z = cz * CS + lz;
        for (let lx = 0; lx < CS; lx++) {
          const x = cx * CS + lx;
          const m = g[x + z * N + y * NN];
          if (m === EMPTY || (m === WATER) !== wantWater) continue;
          let colorDone = false, e = 0;
          for (let f = 0; f < 6; f++) {
            const F = FACES[f];
            const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
            const nb = at(nx, ny, nz);
            if (wantWater ? nb !== EMPTY : isSolid(nb)) continue;
            if (!colorDone) { e = baseColor(m, x, y, z, c); colorDone = true; }
            const shade = SHADE[f];
            const u = F.u, v = F.v;
            const aoV = [0, 0, 0, 0];

            for (let k = 0; k < 4; k++) {
              const su = corners[k][0] ? 1 : -1, sv = corners[k][1] ? 1 : -1;
              const s1 = isSolid(at(nx + u[0] * su, ny + u[1] * su, nz + u[2] * su)) ? 1 : 0;
              const s2 = isSolid(at(nx + v[0] * sv, ny + v[1] * sv, nz + v[2] * sv)) ? 1 : 0;
              const cc = isSolid(at(nx + u[0] * su + v[0] * sv, ny + u[1] * su + v[1] * sv, nz + u[2] * su + v[2] * sv)) ? 1 : 0;
              aoV[k] = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
            }
            const vb = nf * 4;
            for (let k = 0; k < 4; k++) {
              const cu = corners[k][0], cv = corners[k][1];
              const p = (vb + k) * 3;
              pos[p] = x + F.o[0] + u[0] * cu + v[0] * cv - 64;
              pos[p + 1] = y + F.o[1] + u[1] * cu + v[1] * cv;
              pos[p + 2] = z + F.o[2] + u[2] * cu + v[2] * cv - 64;
              nrm[p] = F.n[0] * 127; nrm[p + 1] = F.n[1] * 127; nrm[p + 2] = F.n[2] * 127;
              const l = (wantWater ? 1 : AO_LEVEL[aoV[k]]) * shade * (e > 0 ? 1 : 1);
              const lit = e > 0 ? 1 : l;
              col[p] = Math.min(255, c[0] * lit * 255);
              col[p + 1] = Math.min(255, c[1] * lit * 255);
              col[p + 2] = Math.min(255, c[2] * lit * 255);
              emi[vb + k] = e * 255;
            }
            // flip quad diagonal to avoid AO anisotropy
            const ii = nf * 6;
            if (aoV[0] + aoV[2] > aoV[1] + aoV[3]) {
              tmpIdx[ii] = vb; tmpIdx[ii + 1] = vb + 1; tmpIdx[ii + 2] = vb + 2;
              tmpIdx[ii + 3] = vb; tmpIdx[ii + 4] = vb + 2; tmpIdx[ii + 5] = vb + 3;
            } else {
              tmpIdx[ii] = vb + 1; tmpIdx[ii + 1] = vb + 2; tmpIdx[ii + 2] = vb + 3;
              tmpIdx[ii + 3] = vb + 1; tmpIdx[ii + 4] = vb + 3; tmpIdx[ii + 5] = vb;
            }
            nf++;
          }
        }
      }
    }
    const res = nf === 0 ? null : {
      pos: tmp.pos.slice(0, nf * 12),
      nrm: tmp.nrm.slice(0, nf * 12),
      col: tmp.col.slice(0, nf * 12),
      emi: tmp.emi.slice(0, nf * 4),
      idx: tmpIdx.slice(0, nf * 6),
    };
    if (wantWater) out.water = res; else out.opaque = res;
  }
  return out;
}
