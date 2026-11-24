// Voxel grid + 3D diffusion-limited aggregation.
// The grid is the source of truth: occ[] says what each voxel is, order[] says when a coral voxel attached.

export const EMPTY = 0, ROCK = 1, CORAL = 2;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// small value-noise for the seabed (integer lattice hash, smooth interpolation)
function hash2(x, z, s) {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(s, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise2(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi, s), b = hash2(xi + 1, zi, s);
  const c = hash2(xi, zi + 1, s), d = hash2(xi + 1, zi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm2(x, z, s) {
  let f = 0, amp = 0.5, fr = 1;
  for (let o = 0; o < 4; o++) { f += amp * vnoise2(x * fr, z * fr, s + o * 17); amp *= 0.5; fr *= 2.03; }
  return f;
}

export class VoxelGrid {
  constructor(nx, ny, nz) {
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.sy = nx; this.sz = nx * ny;
    this.size = nx * ny * nz;
    this.occ = new Uint8Array(this.size);
    this.order = new Int32Array(this.size).fill(-1);
    this.sticky = new Uint8Array(this.size); // 1 = touches coral (26-neighbourhood)
    this.height = new Float32Array(nx * nz); // seabed height per column
    this.coralList = []; // voxel indices in attach order
    this.colony = new Uint8Array(this.size); // colony id + 1 for coral voxels
  }
  idx(x, y, z) { return x + y * this.sy + z * this.sz; }

  buildSeabed(seed) {
    const { nx, nz, ny } = this;
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const n = fbm2(x * 0.045, z * 0.045, seed);
      const r = fbm2(x * 0.14 + 40, z * 0.14, seed + 5);
      // low rolling base plus a few rocky ridges
      let h = 4 + n * 9 + Math.pow(Math.max(0, r - 0.45), 1.5) * 22;
      // dip towards the edges so the reef sits on a mound
      const dx = (x - nx / 2) / (nx / 2), dz = (z - nz / 2) / (nz / 2);
      h -= (dx * dx + dz * dz) * 4;
      h = Math.max(2, Math.min(ny * 0.4, h));
      // flatten to a common height near the grid border so it meets the outer seabed cleanly
      const border = Math.min(x, z, nx - 1 - x, nz - 1 - z);
      const bw = Math.min(1, Math.max(0, (border - 2) / 14));
      h = 3 + (h - 3) * bw * bw * (3 - 2 * bw);
      this.height[x + z * nx] = h;
      const top = Math.floor(h);
      for (let y = 0; y <= top; y++) this.occ[this.idx(x, y, z)] = ROCK;
    }
    // a few loose boulders
    const rnd = mulberry32(seed * 7 + 3);
    for (let b = 0; b < 14; b++) {
      const cx = 8 + rnd() * (nx - 16), cz = 8 + rnd() * (nz - 16);
      const rad = 2 + rnd() * 3.5;
      const cy = this.height[Math.floor(cx) + Math.floor(cz) * nx] + rad * 0.3;
      for (let z = Math.floor(cz - rad); z <= cz + rad; z++)
        for (let y = Math.floor(cy - rad); y <= cy + rad; y++)
          for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
            if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
            const d = Math.hypot(x - cx, (y - cy) * 1.3, z - cz) + vnoise2(x * 0.7, z * 0.7 + y, b) * 1.2;
            if (d < rad) this.occ[this.idx(x, y, z)] = ROCK;
          }
    }
  }

  attach(i, col = 0) {
    this.occ[i] = CORAL;
    this.colony[i] = col + 1;
    this.order[i] = this.coralList.length;
    this.coralList.push(i);
    const { nx, ny, nz, sy, sz } = this;
    const x = i % nx, y = ((i / sy) | 0) % ny, z = (i / sz) | 0;
    for (let dz = -1; dz <= 1; dz++) {
      const zz = z + dz; if (zz < 0 || zz >= nz) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= ny) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= nx) continue;
          this.sticky[xx + yy * sy + zz * sz] = 1;
        }
      }
    }
  }

  // Grow `target` coral voxels by lattice DLA, several colonies at once. Deterministic for a given seed.
  // Each colony releases walkers on a hemisphere just outside its current reach; walkers diffuse with a slight
  // sinking drift and stick on contact. Tips catch most walkers, which is what makes the branches.
  growDLA(seed, target, seeds = 7) {
    const { nx, ny, nz, sy, sz, occ, sticky, height } = this;
    const rnd = mulberry32(seed);
    const cols = [];
    let guard = 0;
    while (cols.length < seeds && guard++ < 2000) {
      const x = 14 + Math.floor(rnd() * (nx - 28)), z = 14 + Math.floor(rnd() * (nz - 28));
      if (cols.some(c => Math.hypot(c.x - x, c.z - z) < 36)) continue;
      const y = Math.floor(height[x + z * nx]) + 1;
      cols.push({ x, y, z, cx: x, cy: y + 1, cz: z, sx: 0, sy: 0, sz: 0, n: 0, reach: 3, weight: 0.25 + 1.5 * rnd() * rnd() });
    }
    cols.forEach((c, k) => { for (let y = c.y; y < c.y + 3; y++) this.attach(this.idx(c.x, y, c.z), k); });
    const wsum = cols.reduce((a, c) => a + c.weight, 0);

    const pDown = 0.185, pUp = 0.15;
    const pH = (1 - pDown - pUp) / 4;
    const c0 = pH, c1 = 2 * pH, c2 = 3 * pH, c3 = 4 * pH, c4 = 4 * pH + pDown;
    const maxSteps = 20000;
    const NB = [];
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (dx || dy || dz) NB.push(dx + dy * sy + dz * sz);
    const topY = ny - 6;
    let attempts = 0;
    while (this.coralList.length < target && attempts < target * 60) {
      attempts++;
      // pick a colony by weight
      let r0 = rnd() * wsum, col = cols[0];
      for (const c of cols) { r0 -= c.weight; if (r0 <= 0) { col = c; break; } }
      const R = col.reach + 4, kill = col.reach + 14;
      // random point on a sphere around the colony centroid (biased upward)
      const u = rnd() * 2 * Math.PI, v = Math.acos(1 - rnd() * 1.4);
      let x = Math.round(col.cx + Math.cos(u) * Math.sin(v) * R);
      let z = Math.round(col.cz + Math.sin(u) * Math.sin(v) * R);
      let y = Math.round(col.cy + Math.cos(v) * R);
      if (x < 1 || x >= nx - 1 || z < 1 || z >= nz - 1 || y >= topY || y < 1) continue;
      let i = x + y * sy + z * sz;
      if (occ[i] !== EMPTY) continue;
      const kill2 = kill * kill;
      for (let s = 0; s < maxSteps; s++) {
        if (sticky[i]) {
          const p = occ[i - sy] === CORAL ? 1.0 : 0.85;
          if (rnd() < p) {
            // join whichever colony we touched
            let id = 0;
            for (let k = 0; k < NB.length && !id; k++) id = this.colony[i + NB[k]] || 0;
            const ci = Math.max(0, id - 1);
            this.attach(i, ci);
            const col = cols[ci];
            // update the colony reach (distance from its base)
            col.sx += x; col.sy += y; col.sz += z; col.n++;
            col.cx = col.sx / col.n; col.cy = col.sy / col.n; col.cz = col.sz / col.n;
            const d = Math.hypot(x - col.cx, y - col.cy, z - col.cz);
            if (d > col.reach && d < col.reach + 2.5) col.reach = d;
            break;
          }
        }
        const r = rnd();
        let nxp = x, nyp = y, nzp = z;
        if (r < c0) nxp++; else if (r < c1) nxp--; else if (r < c2) nzp++; else if (r < c3) nzp--;
        else if (r < c4) nyp--; else nyp++;
        if (nxp < 1 || nxp >= nx - 1 || nzp < 1 || nzp >= nz - 1 || nyp >= topY) continue;
        const ni = nxp + nyp * sy + nzp * sz;
        const o = occ[ni];
        if (o === ROCK) { if (rnd() < 0.35) break; continue; } // settles on rock sometimes
        if (o === CORAL) continue;
        x = nxp; y = nyp; z = nzp; i = ni;
        const dx = x - col.cx, dy = y - col.cy, dz = z - col.cz;
        if (dx * dx + dy * dy + dz * dz > kill2) break; // wandered off
      }
    }
    this.colonies = cols;
    return this.coralList.length;
  }
}
