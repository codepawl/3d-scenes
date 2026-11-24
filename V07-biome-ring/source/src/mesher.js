// Chunk mesher: face culling, per-vertex ambient occlusion with quad flipping, per-voxel colour variation.
import * as THREE from 'three';
import { B, SMALL, OPAQUE, SX, SY, SZ, WL, CHUNK, WETLAND } from './world.js';
import { ihash, vnoise2 } from './noise.js';

const srgb = (hex) => {
  const c = new THREE.Color(hex); // three converts hex (sRGB) to linear working space
  return [c.r, c.g, c.b];
};
const PAL = [];
PAL[B.SAND] = srgb(0xd8b47a); PAL[B.SANDSTONE] = srgb(0xc08a58); PAL[B.REDROCK] = srgb(0x9c4f36);
PAL[B.CACTUS] = srgb(0x4d7638); PAL[B.SNOW] = srgb(0xe9eef4); PAL[B.ICE] = srgb(0x9ccbe0);
PAL[B.STONE] = srgb(0x77797c); PAL[B.DIRT] = srgb(0x6a4d34); PAL[B.WOOD] = srgb(0x5b3f29);
PAL[B.PINE] = srgb(0x2c4a33); PAL[B.MUD] = srgb(0x5e4a35); PAL[B.GRASS] = srgb(0x5d7a37);
PAL[B.REED] = srgb(0x8d9048); PAL[B.MOSS] = srgb(0x45652d); PAL[B.GRAVEL] = srgb(0x8a847e);
PAL[B.LEAF] = srgb(0x4e7236); PAL[B.DRYBUSH] = srgb(0x8b6b45); PAL[B.CATTAIL] = srgb(0x5a3a22);
const BANDS = [srgb(0xb5764c), srgb(0x9c4f36), srgb(0xd09a66), srgb(0x8a4632), srgb(0xc8865a)];

// material class consumed by the fragment shader
const MAT = new Float32Array(32);
MAT[B.SAND] = 1; MAT[B.SNOW] = 2; MAT[B.ICE] = 3; MAT[B.WOOD] = 4; MAT[B.DRYBUSH] = 4; MAT[B.CATTAIL] = 4;
MAT[B.CACTUS] = 5; MAT[B.PINE] = 5; MAT[B.REED] = 5; MAT[B.LEAF] = 5;
MAT[B.MUD] = 6; MAT[B.DIRT] = 6; MAT[B.GRASS] = 7; MAT[B.MOSS] = 7;

// face table: normal n, tangent axes u, v with u x v = n
const FACES = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];
const CORN = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const AO_CURVE = [0.42, 0.62, 0.81, 1.0];

class Buf {
  constructor(cs = 3) { this.cs = cs; this.pos = []; this.nor = []; this.col = []; this.info = []; this.idx = []; this.n = 0; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, this.cs));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 2));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

function blockColor(world, b, x, y, z, face) {
  let c = PAL[b];
  if (b === B.REDROCK || b === B.SANDSTONE) {
    const k = ((y + Math.floor(vnoise2(x * 0.08, z * 0.08, 3) * 3)) % 5 + 5) % 5;
    const bc = BANDS[k];
    const m = b === B.REDROCK ? 0.7 : 0.35;
    c = [c[0] * (1 - m) + bc[0] * m, c[1] * (1 - m) + bc[1] * m, c[2] * (1 - m) + bc[2] * m];
  }
  if (b === B.GRASS && face !== 2 && face !== 3) c = [c[0] * 0.8 + 0.03, c[1] * 0.8, c[2] * 0.8];
  const h = ihash(x, y, z, 99);
  const v = 0.9 + h * 0.2;
  const tint = (ihash(x, y, z, 7) - 0.5) * 0.06;
  return [c[0] * v * (1 + tint), c[1] * v, c[2] * v * (1 - tint)];
}

export function meshChunk(world, cx, cz) {
  const T = new Buf(), W = new Buf(4);
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const g = world.grid;
  const get = (x, y, z) => world.get(x, y, z);
  const solid = (x, y, z) => OPAQUE[get(x, y, z)];

  for (let y = 0; y < SY; y++) for (let z = z0; z < z0 + CHUNK; z++) for (let x = x0; x < x0 + CHUNK; x++) {
    const b = g[x + SX * (z + SZ * y)];
    if (b === B.AIR) continue;
    const wi = (x + z * SX) * 3;
    const wet = world.weights[wi + WETLAND];
    if (b === B.WATER) { waterFaces(world, W, x, y, z); continue; }
    if (SMALL[b]) { smallBox(T, world, b, x, y, z, wet); continue; }
    for (let f = 0; f < 6; f++) {
      const F = FACES[f];
      const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
      if (ny < 0 || nx < 0 || nz < 0 || nx >= SX || nz >= SZ) continue;
      if (solid(nx, ny, nz)) continue;
      const col = blockColor(world, b, x, y, z, f);
      const ao = [0, 0, 0, 0];
      for (let c = 0; c < 4; c++) {
        const [su, sv] = CORN[c];
        const s1 = solid(nx + su * F.u[0], ny + su * F.u[1], nz + su * F.u[2]);
        const s2 = solid(nx + sv * F.v[0], ny + sv * F.v[1], nz + sv * F.v[2]);
        const cc = solid(nx + su * F.u[0] + sv * F.v[0], ny + su * F.u[1] + sv * F.v[1], nz + su * F.u[2] + sv * F.v[2]);
        ao[c] = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
      }
      const base = T.n;
      const cxp = x + 0.5 + F.n[0] * 0.5, cyp = y + 0.5 + F.n[1] * 0.5, czp = z + 0.5 + F.n[2] * 0.5;
      for (let c = 0; c < 4; c++) {
        const [su, sv] = CORN[c];
        T.pos.push(cxp + 0.5 * (su * F.u[0] + sv * F.v[0]), cyp + 0.5 * (su * F.u[1] + sv * F.v[1]), czp + 0.5 * (su * F.u[2] + sv * F.v[2]));
        T.nor.push(F.n[0], F.n[1], F.n[2]);
        const a = AO_CURVE[ao[c]];
        T.col.push(col[0] * a, col[1] * a, col[2] * a);
        T.info.push(MAT[b], wet);
      }
      if (ao[0] + ao[2] > ao[1] + ao[3]) T.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else T.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
      T.n += 4;
    }
  }
  return { terrain: T.n ? T.geometry() : null, water: W.n ? W.geometry() : null };
}

function smallBox(T, world, b, x, y, z, wet) {
  let hw = 0.13, h0 = 0, h1 = 1;
  if (b === B.DRYBUSH) { hw = 0.36; h1 = 0.55; }
  if (b === B.CATTAIL) { hw = 0.17; h1 = 0.8; }
  if (b === B.REED) { hw = 0.11; const j = ihash(x, y, z, 3); hw += j * 0.06; }
  const ox = (ihash(x, y, z, 11) - 0.5) * 0.3, oz = (ihash(x, y, z, 12) - 0.5) * 0.3;
  const cx = x + 0.5 + ox, cz = z + 0.5 + oz;
  const col = blockColor(world, b, x, y, z, 0);
  const groundAO = OPAQUE[world.get(x, y - 1, z)] ? 0.7 : 1.0;
  for (let f = 0; f < 6; f++) {
    const F = FACES[f];
    if (f === 3 && OPAQUE[world.get(x, y - 1, z)]) continue;
    if (f === 2 && world.get(x, y + 1, z) === b) continue;
    const base = T.n;
    const ext = [hw, (h1 - h0) / 2, hw];
    const ctr = [cx + F.n[0] * hw, y + (h0 + h1) / 2 + F.n[1] * ext[1], cz + F.n[2] * hw];
    for (let c = 0; c < 4; c++) {
      const [su, sv] = CORN[c];
      const px = ctr[0] + ext[0] * (su * F.u[0] + sv * F.v[0]);
      const py = ctr[1] + ext[1] * (su * F.u[1] + sv * F.v[1]);
      const pz = ctr[2] + ext[2] * (su * F.u[2] + sv * F.v[2]);
      T.pos.push(px, py, pz);
      T.nor.push(F.n[0], F.n[1], F.n[2]);
      const a = py - y < 0.3 ? groundAO : 1.0;
      T.col.push(col[0] * a, col[1] * a, col[2] * a);
      T.info.push(MAT[b], wet);
    }
    T.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    T.n += 4;
  }
}

const WCOL = [srgb(0x2f8f8c), srgb(0x3f7d97), srgb(0x3b4a2e)];
const OCEAN = srgb(0x15485a);
const WDEEP = [srgb(0x16606a), srgb(0x1d4a66), srgb(0x232c1c)];
export const OCEAN_COLOR = OCEAN;
export const WATER_TOP = 0.86;

function waterFaces(world, W, x, y, z) {
  const above = world.get(x, y + 1, z);
  const top = above !== B.WATER;
  const yt = y + (top ? WATER_TOP : 1);
  const i = x + z * SX;
  const w = world.weights;
  let c = [0, 0, 0];
  const depth = Math.max(0, WL - world.height[i]);
  const dk = Math.min(1, depth / 6);
  const dsm = dk * dk * (3 - 2 * dk);
  for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) c[j] += (WCOL[k][j] * (1 - dsm) + WDEEP[k][j] * dsm) * w[i * 3 + k];
  const sea = Math.min(1, Math.max(0, (-world.ringT[i] - 0.1) / 0.6));
  c = c.map((v, j) => v * (1 - sea) + OCEAN[j] * sea);
  const wet = w[i * 3 + WETLAND] * (1 - sea);
  // per-vertex opacity: clear shallows, opaque open sea (matches the ocean slabs outside the grid)
  const alpha = Math.max(0.7 + 0.2 * dsm, Math.min(1, sea * 1.6));
  const push = (pts, n) => {
    const base = W.n;
    for (const p of pts) { W.pos.push(p[0], p[1], p[2]); W.nor.push(n[0], n[1], n[2]); W.col.push(c[0], c[1], c[2], alpha); W.info.push(0, wet); }
    W.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    W.n += 4;
  };
  if (top && !OPAQUE[above]) push([[x, yt, z], [x, yt, z + 1], [x + 1, yt, z + 1], [x + 1, yt, z]], [0, 1, 0]);
  // sides against open air (e.g. a pool edge where the land is lower than the water - rare)
  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [ox, oz] of sides) {
    const nx = x + ox, nz = z + oz;
    if (nx < 0 || nz < 0 || nx >= SX || nz >= SZ) continue;
    const nb = world.get(nx, y, nz);
    if (nb !== B.AIR && !SMALL[nb]) continue;
    const xa = ox === 1 ? x + 1 : x, za = oz === 1 ? z + 1 : z;
    if (ox !== 0) push(ox > 0 ? [[xa, y, z], [xa, yt, z], [xa, yt, z + 1], [xa, y, z + 1]] : [[xa, y, z + 1], [xa, yt, z + 1], [xa, yt, z], [xa, y, z]], [ox, 0, 0]);
    else push(oz > 0 ? [[x + 1, y, za], [x + 1, yt, za], [x, yt, za], [x, y, za]] : [[x, y, za], [x, yt, za], [x + 1, yt, za], [x + 1, y, za]], [0, 0, oz]);
  }
}
