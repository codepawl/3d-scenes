// Height-grid garden: the voxel source of truth, rake stamping and a chunked column mesher (original code).
import * as THREE from 'three';
import { hash2, noise2, fbm2 } from './noise.js';

export const S = 0.0375;            // voxel edge (m)
export const NX = 352, NZ = 256;    // grid size (cells)
export const B = 8;                 // base sand height (voxels)
export const G0X = 48, G1X = 304, G0Z = 48, G1Z = 208; // garden interior bounds (cells)
export const CH = 32;               // chunk size

export const SAND = 0, MOSS = 1, WOOD = 2, SOIL = 3, GRAVEL = 4;

export const ROCKS = [
  // cell centre, footprint radius (cells), height (voxels), seed
  { i: 96, j: 96, r: 15, h: 24, seed: 1 },
  { i: 117, j: 108, r: 8, h: 12, seed: 2 },
  { i: 84, j: 116, r: 5, h: 7, seed: 3 },
  { i: 160, j: 150, r: 11, h: 17, seed: 4 },
  { i: 172, j: 160, r: 5, h: 6, seed: 5 },
  { i: 70, j: 168, r: 7, h: 9, seed: 6 },
];
// groups for ring patterns: centre + outer radius of the moss island
export const ISLANDS = [
  { i: 99, j: 103, r: 27 },
  { i: 163, j: 153, r: 18 },
  { i: 70, j: 168, r: 10 },
];

// rake geometry (cells)
export const RAKE_HALF = 8;
export const PERIOD = 4;

export const xOf = (i) => (i - NX / 2) * S;
export const zOf = (j) => (j - NZ / 2) * S;

export function lin(r, g, b) {
  return [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];
}

// tine profile: lateral offset u (cells, relative to rake centre) -> height delta
export function profile(u) {
  const ph = (((u + RAKE_HALF) / PERIOD) % 1 + 1) % 1; // groove centre at ph=0.5 -> u=-6,-2,2,6
  const c = -Math.cos((ph - 0.5) * Math.PI * 2); // -1 at groove centre, +1 at ridge
  return Math.round(c * 1.25);
}

export class Garden {
  constructor() {
    this.h = new Int16Array(NX * NZ);
    this.t = new Uint8Array(NX * NZ);
    this.cx = NX / CH; this.cz = NZ / CH;
    this.dirty = new Uint8Array(this.cx * this.cz).fill(1);
    this.reset();
  }
  id(i, j) { return i + j * NX; }
  H(i, j) {
    if (i < 0 || j < 0 || i >= NX || j >= NZ) return 0;
    return this.h[i + j * NX];
  }
  isGarden(i, j) { return i >= G0X && i < G1X && j >= G0Z && j < G1Z; }

  reset() {
    const { h, t } = this;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const k = this.id(i, j);
      if (this.isGarden(i, j)) {
        t[k] = SAND;
        h[k] = B;
        // moss islands
        for (const is of ISLANDS) {
          const d = Math.hypot(i - is.i, j - is.j);
          const edge = is.r * (0.55 + 0.12 * fbm2(i * 0.12, j * 0.12, 9)) - 2;
          if (d < edge) {
            t[k] = MOSS;
            h[k] = B + 1 + (d < edge * 0.6 ? 1 : 0) + (noise2(i * 0.3, j * 0.3, 4) > 0.72 ? 1 : 0);
          }
        }
        if (t[k] === SAND) h[k] = B + this.prePattern(i, j);
      } else {
        const inner = i >= G0X - 4 && i < G1X + 4 && j >= G0Z - 4 && j < G1Z + 4;
        if (inner) { t[k] = WOOD; h[k] = B + 3; }
        else {
          const g = fbm2(i * 0.05, j * 0.05, 21);
          // gravel walk around the edging, soil + moss further out
          const ring = Math.min(Math.abs(i - (G0X - 4)), Math.abs(i - (G1X + 3)), Math.abs(j - (G0Z - 4)), Math.abs(j - (G1Z + 3)));
          const nearIn = i >= G0X - 14 && i < G1X + 14 && j >= G0Z - 14 && j < G1Z + 14;
          if (nearIn && ring < 10) { t[k] = GRAVEL; h[k] = B + 1; }
          else { t[k] = g > 0.5 ? MOSS : SOIL; h[k] = B + 2 + Math.floor(g * 3); }
        }
      }
    }
    this.dirty.fill(1);
  }

  // pre-raked pattern: rings around islands, straight lines (along z) elsewhere, leveled work band
  prePattern(i, j) {
    let best = null;
    for (const is of ISLANDS) {
      const d = Math.hypot(i - is.i, j - is.j);
      const rel = d - is.r * 0.55;
      if (rel < 14 && (best === null || rel < best)) best = rel;
    }
    if (best !== null) return profile(best - RAKE_HALF + 2);
    if (i >= 200) return 0; // leveled band for the rake to work
    return profile(i - 200 + RAKE_HALF);
  }

  markDirty(i, j) {
    const ci = Math.floor(i / CH), cj = Math.floor(j / CH);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const x = Math.floor((i + a) / CH), z = Math.floor((j + b) / CH);
      if (x >= 0 && z >= 0 && x < this.cx && z < this.cz) this.dirty[x + z * this.cx] = 1;
    }
    void ci; void cj;
  }

  // stamp the rake head at (pi,pj) (cells, continuous) heading (dx,dz)
  stamp(pi, pj, dx, dz) {
    const px = -dz, pz = dx; // lateral axis
    const R = RAKE_HALF + 1;
    for (let j = Math.floor(pj - R); j <= Math.ceil(pj + R); j++) {
      for (let i = Math.floor(pi - R); i <= Math.ceil(pi + R); i++) {
        if (!this.isGarden(i, j)) continue;
        const k = this.id(i, j);
        if (this.t[k] !== SAND) continue;
        const rx = i + 0.5 - pi, rz = j + 0.5 - pj;
        const a = rx * dx + rz * dz;
        const u = rx * px + rz * pz;
        if (Math.abs(a) > 0.75 || Math.abs(u) > RAKE_HALF) continue;
        const nh = B + profile(u);
        if (this.h[k] !== nh) { this.h[k] = nh; this.markDirty(i, j); }
      }
    }
  }

  // per-cell albedo (linear) with wear and grime
  cellColor(i, j, out, flat = false) {
    const k = this.id(i, j);
    const t = this.t[k], hh = this.h[k];
    const n1 = hash2(i, j, 1), n2 = fbm2(i * 0.04, j * 0.04, 3), n3 = fbm2(i * 0.18, j * 0.18, 8);
    let r, g, b;
    if (t === SAND) {
      // pale granite grit: per-grain jitter, broad damp/dirty patches, darker compacted groove floors
      const d = flat ? 0 : hh - B;
      const v = 0.86 + (n1 - 0.5) * 0.12 + (n2 - 0.5) * 0.16 + d * 0.035;
      r = 0.80 * v; g = 0.76 * v; b = 0.68 * v;
      if (n1 > 0.993) { r *= 0.78; g *= 0.77; b *= 0.78; }          // dark grit
      else if (n1 < 0.012) { r *= 1.08; g *= 1.06; b *= 1.02; }     // quartz flecks
      // grime near the edging
      const e = Math.min(i - G0X, G1X - 1 - i, j - G0Z, G1Z - 1 - j);
      if (e < 6) { const f = 0.82 + e * 0.03; r *= f; g *= f; b *= f * 0.97; }
    } else if (t === MOSS) {
      const v = 0.75 + n3 * 0.5 + (n1 - 0.5) * 0.2;
      r = 0.24 * v; g = 0.36 * v; b = 0.12 * v;
      if (n3 > 0.68) { r = 0.42 * v; g = 0.44 * v; b = 0.16 * v; } // dry tips
      if (n1 > 0.97) { r = 0.55; g = 0.27; b = 0.12; }              // fallen maple bits
    } else if (t === WOOD) {
      // weathered timber edging: grain along the beam, dark stains
      const along = (j < G0Z || j >= G1Z) ? i : j;
      const across = (j < G0Z || j >= G1Z) ? j : i;
      const grain = noise2(along * 0.08, across * 1.3, 11);
      const v = 0.62 + grain * 0.3 + (n1 - 0.5) * 0.1 - (n2 > 0.6 ? 0.15 : 0);
      r = 0.42 * v; g = 0.33 * v; b = 0.25 * v;
      if (along % 40 === 0) { r *= 0.5; g *= 0.5; b *= 0.5; } // plank joints
    } else if (t === GRAVEL) {
      const v = 0.55 + n1 * 0.4;
      r = 0.52 * v; g = 0.5 * v; b = 0.47 * v;
      if (hash2(i, j, 9) > 0.9) { r *= 0.6; g *= 0.6; b *= 0.6; }
    } else {
      const v = 0.6 + n3 * 0.5 + (n1 - 0.5) * 0.2;
      r = 0.30 * v; g = 0.24 * v; b = 0.17 * v;
    }
    const L = lin(Math.min(r, 1), Math.min(g, 1), Math.min(b, 1));
    out[0] = L[0]; out[1] = L[1]; out[2] = L[2];
  }

  // build geometry for chunk (cx, cz)
  meshChunk(ccx, ccz, skipCell) {
    const pos = [], nrm = [], col = [], bas = [], idx = [];
    let vc = 0;
    const c = [0, 0, 0], cb = [0, 0, 0];
    const i0 = ccx * CH, j0 = ccz * CH;
    const quad = (p, n, cs) => {
      for (let q = 0; q < 4; q++) {
        pos.push(p[q * 3], p[q * 3 + 1], p[q * 3 + 2]);
        nrm.push(n[0], n[1], n[2]);
        col.push(cs[q * 3], cs[q * 3 + 1], cs[q * 3 + 2]);
        bas.push(cb[0], cb[1], cb[2]);
      }
      const a0 = cs[0] + cs[6], a1 = cs[3] + cs[9];
      if (a0 > a1) idx.push(vc, vc + 1, vc + 2, vc, vc + 2, vc + 3);
      else idx.push(vc + 1, vc + 2, vc + 3, vc + 1, vc + 3, vc);
      vc += 4;
    };
    const AO = [1.0, 0.82, 0.68, 0.55];
    for (let j = j0; j < j0 + CH; j++) for (let i = i0; i < i0 + CH; i++) {
      const h = this.H(i, j);
      this.cellColor(i, j, c);
      this.cellColor(i, j, cb, true); // height- and AO-free colour, used when grooves are filtered with distance
      const x0 = xOf(i), x1 = xOf(i + 1), z0 = zOf(j), z1 = zOf(j + 1), y = h * S;
      if (!(skipCell && skipCell(i, j, h))) {
        // top face, corners (x0,z0) (x0,z1) (x1,z1) (x1,z0) -> CCW from above
        const occ = (di, dj) => (this.H(i + di, j + dj) > h ? 1 : 0);
        const cornerAO = (di, dj) => {
          const s1 = occ(di, 0), s2 = occ(0, dj), cc = occ(di, dj);
          return AO[s1 && s2 ? 3 : s1 + s2 + cc];
        };
        const a = [cornerAO(-1, -1), cornerAO(-1, 1), cornerAO(1, 1), cornerAO(1, -1)];
        quad([x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0], [0, 1, 0],
          [c[0] * a[0], c[1] * a[0], c[2] * a[0], c[0] * a[1], c[1] * a[1], c[2] * a[1],
           c[0] * a[2], c[1] * a[2], c[2] * a[2], c[0] * a[3], c[1] * a[3], c[2] * a[3]]);
      }
      // sides
      const sides = [
        [1, 0, [x1, z1, x1, z0], [1, 0, 0]],
        [-1, 0, [x0, z0, x0, z1], [-1, 0, 0]],
        [0, 1, [x0, z1, x1, z1], [0, 0, 1]],
        [0, -1, [x1, z0, x0, z0], [0, 0, -1]],
      ];
      for (const [di, dj, e, n] of sides) {
        const nh = this.H(i + di, j + dj);
        if (nh >= h) continue;
        const yb = Math.max(nh, 0) * S;
        const depth = h - nh;
        const bot = depth <= 2 ? 0.62 : 0.5, top = 0.96;
        // bottom-left, bottom-right, top-right, top-left (CCW from outside)
        quad([e[0], yb, e[1], e[2], yb, e[3], e[2], y, e[3], e[0], y, e[1]], n,
          [c[0] * bot, c[1] * bot, c[2] * bot, c[0] * bot, c[1] * bot, c[2] * bot,
           c[0] * top, c[1] * top, c[2] * top, c[0] * top, c[1] * top, c[2] * top]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('base', new THREE.Float32BufferAttribute(bas, 3));
    geo.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    return geo;
  }
}

// ---------------- rake path: serpentine rows along z with U-turn arcs ----------------
export function buildPath() {
  const rows = [208, 224, 240, 256, 272, 288];
  const jA = 60, jB = 192; // row extents (cell z)
  const segs = [];
  for (let r = 0; r < rows.length; r++) {
    const i = rows[r];
    const down = r % 2 === 0; // even rows move +z (toward camera)
    const s = down ? jA : jB, e = down ? jB : jA;
    segs.push({ type: 'line', x0: i, z0: s, x1: i, z1: e, len: Math.abs(e - s) });
    if (r < rows.length - 1) {
      const cxp = i + (rows[r + 1] - i) / 2, rad = (rows[r + 1] - i) / 2;
      // semicircle around (cxp, e) from angle pi to 0, bulging outward in z
      segs.push({ type: 'arc', cx: cxp, cz: e, rad, dir: down ? 1 : -1, len: Math.PI * rad });
    }
  }
  let total = 0;
  for (const s of segs) { s.start = total; total += s.len; }
  return { segs, total };
}

// returns {i, j, dx, dz}
export function pathAt(path, d) {
  d = Math.max(0, Math.min(d, path.total - 1e-6));
  let s = path.segs[0];
  for (const q of path.segs) if (d >= q.start) s = q;
  const f = (d - s.start) / s.len;
  if (s.type === 'line') {
    const dx = Math.sign(s.x1 - s.x0), dz = Math.sign(s.z1 - s.z0);
    return { i: s.x0 + (s.x1 - s.x0) * f, j: s.z0 + (s.z1 - s.z0) * f, dx, dz };
  }
  const ang = Math.PI * (1 - f); // pi -> 0 : from left (smaller x) to right
  const i = s.cx + Math.cos(ang) * s.rad;
  const j = s.cz + Math.sin(ang) * s.rad * s.dir;
  // tangent derivative wrt f: (sin(ang)*rad*pi, -cos(ang)*rad*pi*dir)
  let dx = Math.sin(ang), dz = -Math.cos(ang) * s.dir;
  const l = Math.hypot(dx, dz) || 1;
  return { i, j, dx: dx / l, dz: dz / l };
}
