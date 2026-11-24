// Voxel grid: generation, meshing and the per-column tide simulation.
// The Uint8Array `vox` is the source of truth; everything rendered is derived from it.
import * as THREE from 'three';

export const N = 160;   // grid width/depth (x, z)
export const H = 48;    // grid height (y)

export const MAT = { AIR: 0, SAND: 1, GRASS: 2, DIRT: 3, ROCK: 4, SEABED: 5, WOOD: 6, LEAVES: 7, GRAVEL: 8 };

// ---------- deterministic noise (original) ----------
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uz;
}
function fbm(x, z, seed, oct = 5) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(x * f, z * f, seed + i * 17);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return s / norm;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- grid ----------
export const vox = new Uint8Array(N * N * H);
export const top = new Int16Array(N * N);       // terrain surface height (first air above ground, trees excluded)
const I = (x, y, z) => (y * N + z) * N + x;
export const get = (x, y, z) =>
  (x < 0 || z < 0 || x >= N || z >= N || y < 0 || y >= H) ? 0 : vox[I(x, y, z)];
const set = (x, y, z, m) => { if (x >= 0 && z >= 0 && x < N && z < N && y >= 0 && y < H) vox[I(x, y, z)] = m; };

export function generate(seed = 7) {
  const rnd = mulberry32(seed);
  vox.fill(0);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const nx = (x / (N - 1)) * 2 - 1, nz = (z / (N - 1)) * 2 - 1;
    const wx = (fbm(x * 0.02, z * 0.02, seed + 3, 3) - 0.5) * 0.55;
    const wz = (fbm(x * 0.02 + 40, z * 0.02, seed + 9, 3) - 0.5) * 0.55;
    const d = Math.hypot(nx * 1.05 + wx, nz * 1.2 + wz + 0.05);
    const mask = smooth(0.9, 0.2, d);
    const n = fbm(x * 0.035, z * 0.035, seed, 5);
    const e = mask * (0.45 + 0.75 * n);
    // seabed shelf -> broad beach plateau around the tide band -> hills
    let h = 0.5 + 5.5 * smooth(0.0, 0.3, mask) + 4.8 * smooth(0.18, 0.42, e);
    const hill = Math.max(0, e - 0.42);
    const ridge = 1 - Math.abs(fbm(x * 0.05 + 11, z * 0.05, seed + 5, 4) * 2 - 1);
    h += Math.pow(hill, 1.25) * 52 * (0.7 + 0.5 * ridge);
    h += (fbm(x * 0.15, z * 0.15, seed + 21, 2) - 0.5) * 1.4; // small dunes / ripples
    const hi = Math.max(1, Math.min(H - 12, Math.round(h)));
    top[z * N + x] = hi;
  }
  // rock stacks in the shallows
  for (let k = 0; k < 9; k++) {
    const ang = rnd() * Math.PI * 2, r = 0.5 + rnd() * 0.18;
    const cx = Math.round(N / 2 + Math.cos(ang) * r * N * 0.5), cz = Math.round(N / 2 + Math.sin(ang) * r * N * 0.5);
    const rad = 1.5 + rnd() * 2.5, ht = 10 + rnd() * 6;
    for (let z = cz - 5; z <= cz + 5; z++) for (let x = cx - 5; x <= cx + 5; x++) {
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const dd = Math.hypot(x - cx, z - cz) / rad + (hash2(x, z, 99) - 0.5) * 0.5;
      if (dd < 1) { const t = Math.round(ht * (1 - dd * dd * 0.6)); if (t > top[z * N + x]) top[z * N + x] = t; }
    }
  }
  // fill columns with materials
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const t = top[z * N + x];
    let maxNb = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = Math.min(N - 1, Math.max(0, x + dx)), zz = Math.min(N - 1, Math.max(0, z + dz));
      maxNb = Math.max(maxNb, Math.abs(top[zz * N + xx] - t));
    }
    const jitter = hash2(x, z, 5);
    const grassLine = 12 + Math.round(fbm(x * 0.08, z * 0.08, seed + 31, 2) * 2.5);
    for (let y = 0; y < t; y++) {
      const depth = t - 1 - y;
      let m;
      if (t <= 7) m = depth < 2 ? (jitter < 0.1 ? MAT.GRAVEL : MAT.SEABED) : MAT.ROCK;
      else if (maxNb >= 3 || t > 27 + jitter * 4) m = depth < 1 && t < 24 && maxNb < 4 ? MAT.DIRT : MAT.ROCK;
      else if (t < grassLine) m = depth < 3 ? (jitter < 0.04 && t < 10 ? MAT.GRAVEL : MAT.SAND) : MAT.ROCK;
      else m = depth === 0 ? MAT.GRASS : depth < 3 ? MAT.DIRT : MAT.ROCK;
      // stray rocks poking through sand
      if (depth > 3 && hash2(x, y * 31 + z, 3) < 0.2) m = MAT.ROCK;
      set(x, y, z, m);
    }
  }
  // trees on flat grass
  let placed = 0;
  for (let tries = 0; tries < 4000 && placed < 46; tries++) {
    const x = 4 + Math.floor(rnd() * (N - 8)), z = 4 + Math.floor(rnd() * (N - 8));
    const t = top[z * N + x];
    if (get(x, t - 1, z) !== MAT.GRASS || t > 24) continue;
    let ok = true;
    for (let dz = -3; dz <= 3 && ok; dz++) for (let dx = -3; dx <= 3; dx++) {
      const yy = get(x + dx, t + 1, z + dz); if (yy !== MAT.AIR) { ok = false; break; }
    }
    if (!ok) continue;
    const th = 4 + Math.floor(rnd() * 3);
    for (let y = t; y < t + th; y++) set(x, y, z, MAT.WOOD);
    const cy = t + th, R = 2.2 + rnd() * 0.8;
    for (let dy = -2; dy <= 2; dy++) for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const dd = Math.hypot(dx, dy * 1.35, dz) + (hash2(x + dx, cy + dy + z * 7, z + dz) - 0.5) * 0.9;
      if (dd < R && get(x + dx, cy + dy, z + dz) === MAT.AIR) set(x + dx, cy + dy, z + dz, MAT.LEAVES);
    }
    placed++;
  }
}

// ---------- mesher: face culling + per-vertex AO ----------
const FACES = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const solid = (x, y, z) => (get(x, y, z) !== MAT.AIR ? 1 : 0);

export function buildMesh() {
  const pos = [], nor = [], mat = [], ao = [], idx = [];
  let vc = 0;
  for (let y = 0; y < H; y++) for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const m = vox[I(x, y, z)];
    if (!m) continue;
    for (const f of FACES) {
      const [nx, ny, nz] = f.n;
      const ax = x + nx, ay = y + ny, az = z + nz;
      if (ay < 0) continue;                                  // never visible from below
      if (ax < 0 || az < 0 || ax >= N || az >= N) { if (ny === 0 && y < 3) continue; }
      else if (solid(ax, ay, az)) continue;
      const aos = [];
      for (const [su, sv] of CORNERS) {
        const ux = f.u[0] * su, uy = f.u[1] * su, uz = f.u[2] * su;
        const vx = f.v[0] * sv, vy = f.v[1] * sv, vz = f.v[2] * sv;
        const s1 = solid(ax + ux, ay + uy, az + uz), s2 = solid(ax + vx, ay + vy, az + vz);
        const c = solid(ax + ux + vx, ay + uy + vy, az + uz + vz);
        const a = s1 && s2 ? 0 : 3 - (s1 + s2 + c);
        aos.push(a / 3);
        pos.push(x + 0.5 + nx * 0.5 + (ux + vx) * 0.5, y + 0.5 + ny * 0.5 + (uy + vy) * 0.5, z + 0.5 + nz * 0.5 + (uz + vz) * 0.5);
        nor.push(nx, ny, nz); mat.push(m); ao.push(a / 3);
      }
      // flip the diagonal so AO interpolates without the classic anisotropy seam
      if (aos[0] + aos[2] < aos[1] + aos[3]) idx.push(vc + 1, vc + 2, vc + 3, vc + 1, vc + 3, vc);
      else idx.push(vc, vc + 1, vc + 2, vc, vc + 2, vc + 3);
      vc += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aMat', new THREE.Float32BufferAttribute(mat, 1));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
  g.setIndex(vc > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return { geometry: g, quads: vc / 4 };
}

// ---------- tide simulation (per column, lives beside the grid) ----------
export const TIDE = { mid: 8.5, amp: 1.6, period: 30 };
export const tideLevel = (tt) => TIDE.mid + TIDE.amp * Math.cos((tt / TIDE.period) * Math.PI * 2);

export const sim = {
  wetH: new Float32Array(N * N),
  foam: new Float32Array(N * N),
  dist: new Float32Array(N * N),
  level: tideLevel(0),
  data: new Float32Array(N * N * 4),
  texture: null,
};
const queue = new Int32Array(N * N);

function shoreDistance(L) {
  const d = sim.dist;
  let head = 0, tail = 0;
  for (let i = 0; i < N * N; i++) {
    if (top[i] > L) { d[i] = 0; queue[tail++] = i; } else d[i] = 99;
  }
  while (head < tail) {
    const i = queue[head++], x = i % N, z = (i / N) | 0, nd = d[i] + 1;
    if (nd > 24) continue;
    if (x > 0 && d[i - 1] > nd) { d[i - 1] = nd; queue[tail++] = i - 1; }
    if (x < N - 1 && d[i + 1] > nd) { d[i + 1] = nd; queue[tail++] = i + 1; }
    if (z > 0 && d[i - N] > nd) { d[i - N] = nd; queue[tail++] = i - N; }
    if (z < N - 1 && d[i + N] > nd) { d[i + N] = nd; queue[tail++] = i + N; }
  }
}

export function initSim(L) {
  sim.level = L;
  for (let i = 0; i < N * N; i++) { sim.wetH[i] = Math.min(top[i], L); sim.foam[i] = 0; }
  sim.texture = new THREE.DataTexture(sim.data, N, N, THREE.RGBAFormat, THREE.FloatType);
  sim.texture.magFilter = sim.texture.minFilter = THREE.NearestFilter;
  sim.texture.generateMipmaps = false;
  shoreDistance(L);
  upload();
}

// dtTide: tide-clock seconds; wave: real-time seconds (for swash run-up)
export function stepSim(L, dtTide, time) {
  sim.level = L;
  shoreDistance(L);
  const dry = 0.035 * dtTide, fade = 0.5 * dtTide;
  const { wetH, foam, dist } = sim;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = z * N + x, t = top[i];
    // swash: waves run a little further up the beach than the still level
    const swash = 0.18 + 0.22 * Math.sin(time * 1.3 - (x + z) * 0.06 + hash2(x >> 3, z >> 3, 4) * 6);
    const reach = L + swash;
    wetH[i] = Math.max(wetH[i] - dry, Math.min(reach, t + 0.5));
    // foam collects where the surface meets the water line next to open water
    let nearWater = false;
    if (t > L - 0.9) {
      if ((x > 0 && top[i - 1] <= L) || (x < N - 1 && top[i + 1] <= L) ||
          (z > 0 && top[i - N] <= L) || (z < N - 1 && top[i + N] <= L) || t <= L) nearWater = true;
    }
    const contact = nearWater ? Math.max(0, 1 - Math.abs(t - reach) * 1.1) : 0;
    foam[i] = Math.max(foam[i] - fade, contact);
  }
  upload();
}

function upload() {
  const { data, wetH, foam, dist } = sim;
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = top[i]; data[i * 4 + 1] = wetH[i]; data[i * 4 + 2] = foam[i]; data[i * 4 + 3] = dist[i];
  }
  if (sim.texture) sim.texture.needsUpdate = true;
}
