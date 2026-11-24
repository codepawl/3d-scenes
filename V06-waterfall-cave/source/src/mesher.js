// Meshers written for this project: face-culled rock mesh with per-vertex AO, and a per-frame water mesh.
import * as THREE from 'three';
import { NX, NY, NZ, LAYER, idx } from './world.js';
import { hash3, fbm3, noise3 } from './noise.js';

// face dirs: axis a (0=x,1=y,2=z), sign s
const DIRS = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
const AO_CURVE = [0.38, 0.6, 0.8, 1.0];

function inb(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < NX && y < NY && z < NZ; }

export function buildTerrainMesh(mat, wet, moss) {
  const solidAt = (x, y, z) => (inb(x, y, z) ? mat[idx(x, y, z)] !== 0 : true);
  const pos = [], nor = [], col = [], uv = [], loc = [], wetA = [], ind = [];
  const p = [0, 0, 0], q = [0, 0, 0];
  let vcount = 0;
  const base = new THREE.Color();
  for (let y = 0; y < NY; y++) for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    const i = idx(x, y, z);
    const m = mat[i];
    if (m === 0) continue;
    // per-voxel colour: strata, jitter, material
    const j = hash3(x, y, z);
    const strata = Math.floor(y * 0.55 + 3 * fbm3(x * 0.07, y * 0.05, z * 0.07, 2)) % 3;
    if (m === 2) base.setRGB(0.42 + 0.08 * j, 0.37 + 0.07 * j, 0.30 + 0.05 * j);
    else if (strata === 0) base.setRGB(0.34, 0.31, 0.28);
    else if (strata === 1) base.setRGB(0.27, 0.25, 0.24);
    else base.setRGB(0.38, 0.33, 0.27);
    if (m !== 2) {
      const jj = 0.82 + 0.36 * j;
      base.multiplyScalar(jj);
      const mineral = noise3(x * 0.3, y * 0.3, z * 0.3);
      if (mineral > 0.72) base.lerp(new THREE.Color(0.30, 0.22, 0.16), 0.5); // iron staining
    }
    const w = wet[i];
    p[0] = x; p[1] = y; p[2] = z;
    for (const [a, s] of DIRS) {
      q[0] = x; q[1] = y; q[2] = z; q[a] += s;
      if (solidAt(q[0], q[1], q[2])) continue;
      // outside the grid counts as solid, so faces at the boundary are never emitted
      const u = (a + 1) % 3, v = (a + 2) % 3;
      let c = base.clone();
      if (a === 1 && s === 1 && moss[i] > 0) {
        c.lerp(new THREE.Color(0.16 + 0.08 * j, 0.26 + 0.1 * j, 0.08), Math.min(1, moss[i]));
      } else if (a !== 1 && moss[i] > 0.6) {
        c.lerp(new THREE.Color(0.17, 0.24, 0.1), 0.35);
      }
      const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
      if (s < 0) corners.reverse();
      const aos = [];
      for (const [du, dv] of corners) {
        const su = du ? 1 : -1, sv = dv ? 1 : -1;
        const c1 = [...q]; c1[u] += su;
        const c2 = [...q]; c2[v] += sv;
        const c3 = [...q]; c3[u] += su; c3[v] += sv;
        const s1 = solidAt(c1[0], c1[1], c1[2]) ? 1 : 0;
        const s2 = solidAt(c2[0], c2[1], c2[2]) ? 1 : 0;
        const s3 = solidAt(c3[0], c3[1], c3[2]) ? 1 : 0;
        const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + s3);
        aos.push(ao);
        const vp = [x, y, z];
        if (s > 0) vp[a] += 1;
        vp[u] += du; vp[v] += dv;
        pos.push(vp[0], vp[1], vp[2]);
        const n = [0, 0, 0]; n[a] = s;
        nor.push(n[0], n[1], n[2]);
        const k = AO_CURVE[ao];
        col.push(c.r * k, c.g * k, c.b * k);
        uv.push(vp[u] * 0.25 + a * 0.37, vp[v] * 0.25 + a * 0.61);
        loc.push(du, dv);
        wetA.push(w);
      }
      // flip the quad diagonal to avoid AO anisotropy
      if (aos[0] + aos[2] < aos[1] + aos[3]) ind.push(vcount + 1, vcount + 2, vcount + 3, vcount + 1, vcount + 3, vcount);
      else ind.push(vcount, vcount + 1, vcount + 2, vcount, vcount + 2, vcount + 3);
      vcount += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aLocal', new THREE.Float32BufferAttribute(loc, 2));
  g.setAttribute('aWet', new THREE.Float32BufferAttribute(wetA, 1));
  g.setIndex(vcount > 65535 ? new THREE.Uint32BufferAttribute(ind, 1) : new THREE.Uint16BufferAttribute(ind, 1));
  g.computeBoundingSphere();
  return g;
}

// ---------- water ----------
const MAXQ = 40000;
export class WaterMesher {
  constructor(mat) {
    this.mat = mat;
    this.pos = new Float32Array(MAXQ * 4 * 3);
    this.nor = new Float32Array(MAXQ * 4 * 3);
    this.flow = new Float32Array(MAXQ * 4 * 3);
    const ind = new Uint32Array(MAXQ * 6);
    for (let qd = 0; qd < MAXQ; qd++) {
      const v = qd * 4, o = qd * 6;
      ind[o] = v; ind[o + 1] = v + 1; ind[o + 2] = v + 2; ind[o + 3] = v; ind[o + 4] = v + 2; ind[o + 5] = v + 3;
    }
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aNor = new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage);
    this.aFlow = new THREE.BufferAttribute(this.flow, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('normal', this.aNor);
    g.setAttribute('aFlow', this.aFlow);
    g.setIndex(new THREE.BufferAttribute(ind, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(NX / 2, NY / 2, NZ / 2), 60);
    this.geometry = g;
  }

  build(water) {
    const { mat } = this;
    const M = water.mass, down = water.down, foam = water.foam;
    const air = water.air;
    let nq = 0;
    const P = this.pos, Nn = this.nor, Fl = this.flow;
    // a cell is part of a falling sheet when water is actually moving down through it
    const isFalling = (c) => {
      const b = c - LAYER;
      return mat[b] === 0 && M[b] < 0.9 && down[c] > 0.07 && M[c] > 0.03;
    };
    // thin films resting on a partially filled cell are merged visually into the cell below
    const skip = (c) => M[c] < 0.02 || (!isFalling(c) && mat[c - LAYER] === 0 && M[c - LAYER] < 0.95);
    const height = (c) => {
      if (skip(c)) return 0;
      const u = c + LAYER;
      if (mat[u] === 0 && !skip(u)) return 1;
      if (isFalling(c)) return Math.min(1, 0.55 + M[c]);
      return Math.min(1, M[c] + (mat[u] === 0 ? M[u] : 0));
    };
    const quad = (verts, n, fall, fo, depth) => {
      if (nq >= MAXQ) return;
      const o = nq * 12;
      for (let k = 0; k < 4; k++) {
        P[o + k * 3] = verts[k * 3]; P[o + k * 3 + 1] = verts[k * 3 + 1]; P[o + k * 3 + 2] = verts[k * 3 + 2];
        Nn[o + k * 3] = n[0]; Nn[o + k * 3 + 1] = n[1]; Nn[o + k * 3 + 2] = n[2];
        Fl[o + k * 3] = fall; Fl[o + k * 3 + 1] = fo; Fl[o + k * 3 + 2] = depth;
      }
      nq++;
    };
    // pass 1: surface height map of resting water, used to smooth top faces across cells
    const surf = this.surf || (this.surf = new Float32Array(NX * NZ));
    surf.fill(-1);
    for (let k = 0; k < air.length; k++) {
      const c = air[k];
      if (M[c] < 0.02) continue;
      const u = c + LAYER;
      if (!(mat[u] !== 0 || skip(u)) || isFalling(c)) continue;
      const h = height(c);
      if (h <= 0) continue;
      const col = c % LAYER;
      const yt = ((c / LAYER) | 0) + h;
      if (yt > surf[col]) surf[col] = yt;
    }
    const cornerH = (cx, cz, yt) => {
      let s = 0, n = 0;
      for (let oz = -1; oz <= 0; oz++) for (let ox = -1; ox <= 0; ox++) {
        const X = cx + ox, Z = cz + oz;
        if (X < 0 || Z < 0 || X >= NX || Z >= NZ) continue;
        const v = surf[X + Z * NX];
        if (v >= 0 && Math.abs(v - yt) < 0.75) { s += v; n++; }
      }
      return n ? s / n : yt;
    };
    for (let k = 0; k < air.length; k++) {
      const c = air[k];
      const h = height(c);
      if (h <= 0) continue;
      const x = c % NX, z = ((c / NX) | 0) % NZ, y = (c / LAYER) | 0;
      const b = c - LAYER;
      const falling = isFalling(c);
      const fall = falling ? Math.min(1, 0.4 + down[c] * 3) : 0;
      const fo = Math.min(1, foam[c]);
      const yt = y + h;
      // top
      if (mat[c + LAYER] !== 0 || skip(c + LAYER)) {
        if (falling) quad([x, yt, z, x, yt, z + 1, x + 1, yt, z + 1, x + 1, yt, z], [0, 1, 0], fall, fo, 0);
        else {
          const h00 = cornerH(x, z, yt), h01 = cornerH(x, z + 1, yt), h11 = cornerH(x + 1, z + 1, yt), h10 = cornerH(x + 1, z, yt);
          quad([x, h00, z, x, h01, z + 1, x + 1, h11, z + 1, x + 1, h10, z], [0, 1, 0], fall, fo, 1);
        }
      }
      // bottom of a falling column
      if (mat[b] === 0 && height(b) === 0) {
        quad([x, y, z, x + 1, y, z, x + 1, y, z + 1, x, y, z + 1], [0, -1, 0], fall, fo, 0);
      }
      // sides
      const sides = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dx, dz] of sides) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= NX || nz >= NZ) continue;
        const n = c + dx + dz * NX;
        if (mat[n] !== 0) continue;
        const hn = height(n);
        if (hn >= h) continue;
        // resting neighbours whose smoothed surface meets ours: no step face
        if (!falling) { const sn = surf[nx + nz * NX]; if (sn >= 0 && Math.abs(sn - yt) < 0.75) continue; }
        const y0 = y + hn, y1 = yt;
        let v;
        if (dx === -1) v = [x, y0, z, x, y0, z + 1, x, y1, z + 1, x, y1, z];
        else if (dx === 1) v = [x + 1, y0, z + 1, x + 1, y0, z, x + 1, y1, z, x + 1, y1, z + 1];
        else if (dz === -1) v = [x + 1, y0, z, x, y0, z, x, y1, z, x + 1, y1, z];
        else v = [x, y0, z + 1, x + 1, y0, z + 1, x + 1, y1, z + 1, x, y1, z + 1];
        quad(v, [dx, 0, dz], fall, fo, 0);
      }
    }
    this.geometry.setDrawRange(0, nq * 6);
    this.aPos.needsUpdate = true; this.aNor.needsUpdate = true; this.aFlow.needsUpdate = true;
    this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, nq * 12);
    this.aNor.clearUpdateRanges(); this.aNor.addUpdateRange(0, nq * 12);
    this.aFlow.clearUpdateRanges(); this.aFlow.addUpdateRange(0, nq * 12);
    return nq;
  }
}

// Wetness and moss baked after warm-up from where the water actually is.
export function bakeWetMoss(mat, water) {
  const N = mat.length;
  const wet = new Float32Array(N), moss = new Float32Array(N);
  const M = water.mass;
  const R = 2;
  for (const c of water.air) {
    const m = M[c];
    if (m < 0.05) continue;
    const x = c % NX, z = ((c / NX) | 0) % NZ, y = (c / LAYER) | 0;
    const splash = water.down[c] > 0.05 || water.foam[c] > 0.5;
    const r = splash ? 4 : R;
    for (let oy = -r; oy <= r; oy++) for (let oz = -r; oz <= r; oz++) for (let ox = -r; ox <= r; ox++) {
      const X = x + ox, Y = y + oy, Z = z + oz;
      if (!inb(X, Y, Z)) continue;
      const i = idx(X, Y, Z);
      if (mat[i] === 0) continue;
      const d = Math.hypot(ox, oy * (oy > 0 ? 1.6 : 0.8), oz);
      const wv = Math.max(0, 1 - d / (r + 1));
      if (wv > wet[i]) wet[i] = wv;
    }
  }
  // seeps: wet streaks under the ceiling and down walls
  for (let i = 0; i < N; i++) {
    if (mat[i] === 0) continue;
    const x = i % NX, z = ((i / NX) | 0) % NZ, y = (i / LAYER) | 0;
    const seep = noise3(x * 0.35, y * 0.06, z * 0.35);
    if (seep > 0.68) wet[i] = Math.max(wet[i], (seep - 0.68) * 2.2);
    // moss: top-exposed, damp-but-not-submerged rock
    if (y < NY - 1 && mat[i + LAYER] === 0 && M[i + LAYER] < 0.3 && mat[i] === 1) {
      const n = fbm3(x * 0.25, y * 0.25, z * 0.25, 3);
      const damp = wet[i] > 0.15 && wet[i] < 0.95;
      if (damp && n > 0.42) moss[i] = Math.min(1, (n - 0.42) * 5);
      else if (n > 0.62) moss[i] = (n - 0.62) * 3;
    }
  }
  return { wet, moss };
}
