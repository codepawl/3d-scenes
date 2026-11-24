// Paint gravity automaton on the front face of a voxel wall.
// The grid is the source of truth; rendering only reads these arrays.

export function hash3(a, b, c) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// smooth 2D value noise (lattice spacing s)
export function vnoise(x, y, s, seed) {
  const fx = x / s, fy = y / s;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  let tx = fx - ix, ty = fy - iy;
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  const a = hash3(ix, iy, seed), b = hash3(ix + 1, iy, seed);
  const c = hash3(ix, iy + 1, seed), d = hash3(ix + 1, iy + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

export const BRICK_H = 5; // 4 brick rows + 1 mortar row
export const BRICK_W = 12; // 11 brick cols + 1 mortar col

export function buildWall(W, H) {
  // wallZ: front-face depth of each cell; kind: 0 brick, 1 mortar, 2 coping
  const wallZ = new Float32Array(W * H);
  const kind = new Uint8Array(W * H);
  const brickId = new Int32Array(W * H);
  const copingRows = 3;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (y >= H - copingRows) {
        // concrete coping slab, proud of the wall
        kind[i] = 2;
        let z = 1.2;
        if (y === H - copingRows) z = 1.0; // drip edge
        const chip = hash3(x, y, 77);
        if (chip > 0.93) z -= 0.2 + 0.2 * hash3(x, y, 78);
        wallZ[i] = z;
        brickId[i] = -1;
        continue;
      }
      const row = Math.floor(y / BRICK_H);
      const yy = y % BRICK_H;
      const off = (row & 1) * (BRICK_W >> 1);
      const col = Math.floor((x + off) / BRICK_W);
      const xx = (x + off) % BRICK_W;
      const isMortar = yy === BRICK_H - 1 || xx === BRICK_W - 1;
      const id = row * 1000 + col;
      brickId[i] = id;
      if (isMortar) {
        kind[i] = 1;
        wallZ[i] = -0.5 + Math.round(hash3(x, y, 5) * 2) * 0.1 - (hash3(x, y, 6) > 0.9 ? 0.2 : 0);
      } else {
        kind[i] = 0;
        // per-brick proudness, and chipped edges/corners
        let z = Math.round((hash3(id, 1, 9) - 0.5) * 3) * 0.1;
        const edge = Math.min(yy, BRICK_H - 2 - yy, xx, BRICK_W - 2 - xx);
        const chipN = vnoise(x, y, 2.5, id) + 0.4 * hash3(x, y, 11);
        if (edge === 0 && chipN > 0.95) z -= 0.3;
        else if (edge <= 1 && chipN > 1.15) z -= 0.2;
        // voxel-scale wear: worn/eroded cells and pitting
        const wear = hash3(x, y, 12);
        if (wear > 0.993) z -= 0.2;
        else if (wear > 0.8) z -= 0.1;
        wallZ[i] = z;
      }
    }
  }
  return { wallZ, kind, brickId, copingRows };
}

export class PaintSim {
  constructor(W, H, wall) {
    this.W = W; this.H = H; this.wall = wall;
    const N = W * H;
    this.m = new Float32Array(N); // wet mass
    this.ar = new Float32Array(N); this.ag = new Float32Array(N); this.ab = new Float32Array(N); // absorbance
    this.cap = new Float32Array(N); // holding capacity
    this.bias = new Float32Array(N); // lateral wander bias (-1..1)
    this.dry = new Float32Array(N); // dried layer thickness
    this.dr = new Float32Array(N); this.dg = new Float32Array(N); this.db = new Float32Array(N); // dried reflectance
    this.stepN = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const k = wall.kind[i];
      let c = 0.11 + 0.13 * vnoise(x, y, 9, 3) + 0.05 * hash3(x, y, 4);
      if (k === 1) c += 0.10;
      if (k === 2) c += 0.05;
      this.cap[i] = c;
      this.bias[i] = (vnoise(x, y * 0.35, 6, 21) - 0.5) * 2;
    }
  }

  reset() {
    this.m.fill(0); this.ar.fill(0); this.ag.fill(0); this.ab.fill(0);
    this.stepN = 0;
  }

  // add `a` mass with absorbance A into cell i
  addInto(i, a, Ar, Ag, Ab) {
    const mt = this.m[i];
    const w = a / (mt + a);
    this.ar[i] += (Ar - this.ar[i]) * w;
    this.ag[i] += (Ag - this.ag[i]) * w;
    this.ab[i] += (Ab - this.ab[i]) * w;
    this.m[i] = mt + a;
  }

  move(i, t, a) {
    this.addInto(t, a, this.ar[i], this.ag[i], this.ab[i]);
    this.m[i] -= a;
  }

  deposit(x, y, amount, A, radius = 1) {
    const { W, H } = this;
    const cx = Math.round(x), cy = Math.round(y);
    let tot = 0;
    const cells = [];
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const px = cx + dx, py = cy + dy;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const w = Math.exp(-(dx * dx + dy * dy) / (0.6 * radius * radius + 0.3));
      cells.push(py * W + px, w); tot += w;
    }
    for (let k = 0; k < cells.length; k += 2) this.addInto(cells[k], amount * cells[k + 1] / tot, A[0], A[1], A[2]);
  }

  step() {
    const { W, H, m, cap, bias, dry } = this;
    const kind = this.wall.kind;
    const s = this.stepN++;
    const ltr = (s & 1) === 0;
    for (let y = 0; y < H; y++) {
      for (let xi = 0; xi < W; xi++) {
        const x = ltr ? xi : W - 1 - xi;
        const i = y * W + x;
        const mi = m[i];
        if (mi < 0.05) continue;
        const effCap = cap[i] * (dry[i] > 0.05 ? 0.7 : 1);
        const e = mi - effCap;
        if (e <= 0) continue;
        const r = hash3(x + s * 131, y, s);
        // bottom row: pool sideways
        if (y === 0) {
          if (e > 0.3) {
            const l = x > 0 ? i - 1 : i, rr = x < W - 1 ? i + 1 : i;
            const q = e * 0.2;
            if (l !== i && m[l] < mi) this.move(i, l, q);
            if (rr !== i && m[rr] < mi) this.move(i, rr, q);
          }
          continue;
        }
        // heavy excess spreads sideways (splash blobs, puddles on coping)
        if (e > 0.9) {
          const q = (e - 0.9) * 0.18;
          if (x > 0 && m[i - 1] < mi - 0.2) this.move(i, i - 1, q);
          if (x < W - 1 && m[i + 1] < mi - 0.2) this.move(i, i + 1, q);
        }
        const e2 = m[i] - effCap;
        if (e2 <= 0) continue;
        // surface tension: small beads join a heavier neighbour in the same row (curtains break into drips)
        if (e2 < 0.7) {
          const l = x > 0 ? m[i - 1] : 0, rr = x < W - 1 ? m[i + 1] : 0;
          const big = l > rr ? -1 : 1, mb = Math.max(l, rr);
          if (mb > mi + 0.12 && hash3(x, y, s + 23) < 0.6) { this.move(i, i + big, e2 * 0.8); continue; }
        }
        // mortar groove: capillary pull along the bed joint
        if (kind[i] === 1 && kind[i - W] === 0 && e2 < 0.5 && r < 0.3) {
          const dx = bias[i] + (hash3(x, y, s + 7) - 0.5) > 0 ? 1 : -1;
          const t = i + dx;
          if (x + dx >= 0 && x + dx < W && kind[t] === 1) { this.move(i, t, e2 * 0.6); continue; }
        }
        const pMove = Math.min(1, 0.22 + e2 * 2.4);
        if (r > pMove) continue;
        // choose among below-left, below, below-right
        const b = i - W;
        let best = b, bestS = -1e9;
        for (let dx = -1; dx <= 1; dx++) {
          const px = x + dx;
          if (px < 0 || px >= W) continue;
          const t = b + dx;
          let sc = dx === 0 ? 1.0 : 0.15 + 0.35 * bias[i] * dx;
          sc += 1.6 * Math.min(m[t], 0.6); // wet cells attract: rivulets merge
          sc -= 0.8 * Math.max(0, this.wall.wallZ[t] - this.wall.wallZ[i]); // stepping out is harder
          sc += 0.7 * (hash3(px, y + s * 17, s + 3) - 0.5);
          if (sc > bestS) { bestS = sc; best = t; }
        }
        const amt = e2 * (0.82 + 0.16 * hash3(x, y, s + 11));
        this.move(i, best, amt);
      }
    }
  }

  // bake the wet layer into a faded dry layer (used for old paint history)
  bakeDry(fade) {
    const { m, dry } = this;
    for (let i = 0; i < m.length; i++) {
      if (m[i] < 0.02) continue;
      const r = Math.exp(-this.ar[i]), g = Math.exp(-this.ag[i]), b = Math.exp(-this.ab[i]);
      const grey = 0.28;
      const f = fade * (0.7 + 0.6 * hash3(i, 3, 99));
      const nd = Math.min(m[i], 0.9) * 0.8;
      const w = nd / (dry[i] + nd);
      this.dr[i] += ((r + (grey - r) * f) * 0.8 - this.dr[i]) * w;
      this.dg[i] += ((g + (grey - g) * f) * 0.78 - this.dg[i]) * w;
      this.db[i] += ((b + (grey - b) * f) * 0.74 - this.db[i]) * w;
      dry[i] += nd;
    }
    this.reset();
  }
}

export function absorb(rgb) {
  return [-Math.log(Math.max(rgb[0], 0.004)), -Math.log(Math.max(rgb[1], 0.004)), -Math.log(Math.max(rgb[2], 0.004))];
}

// Ballistic voxel droplets feeding the grid.
export class Pours {
  constructor(sim) {
    this.sim = sim;
    this.drops = []; // {x,y,z,vx,vy,vz,A,mass,col}
    this.g = 520;
  }

  spawnStream(x0, A, col, rate, s, dt, salt) {
    // stream falls from above onto the coping top
    const H = this.sim.H;
    const n = 3;
    for (let k = 0; k < n; k++) {
      const j = hash3(s, k, salt);
      const j2 = hash3(s, k, salt + 1);
      this.drops.push({
        x: x0 + (j - 0.5) * 2.2 + Math.sin(s * 0.05 + salt) * 0.8, y: H + 45 + j2 * 6, z: -0.6 + (j2 - 0.5) * 1.6,
        vx: (j2 - 0.5) * 3, vy: -170 - j * 20, vz: 0, A, col, mass: rate * dt / n,
      });
    }
  }

  spawnThrow(tx, ty, A, col, mass, s, salt, n = 6) {
    const T = 0.32;
    const sx = tx - 30, sy = ty + 8, sz = 120;
    for (let k = 0; k < n; k++) {
      const a = hash3(s, k, salt), b = hash3(s, k, salt + 5), c = hash3(s, k, salt + 9);
      const gx = tx + (a - 0.5) * 10 * (0.3 + c), gy = ty + (b - 0.5) * 7 * (0.3 + c);
      this.drops.push({
        x: sx, y: sy, z: sz,
        vx: (gx - sx) / T, vy: (gy - sy) / T + 0.5 * this.g * T, vz: (0 - sz) / T,
        A, col, mass: mass / n,
      });
    }
  }

  update(dt) {
    const sim = this.sim, { W, H } = sim, wz = sim.wall.wallZ;
    const out = [];
    for (const d of this.drops) {
      d.vy -= this.g * dt;
      // sub-step so fast drops don't tunnel through the wall
      const sub = 4;
      let hit = false;
      for (let k = 0; k < sub && !hit; k++) {
        d.x += d.vx * dt / sub; d.y += d.vy * dt / sub; d.z += d.vz * dt / sub;
        const cx = Math.round(d.x + W / 2), cy = Math.round(d.y);
        if (cx < 0 || cx >= W) continue;
        if (d.y < H - 0.3 && d.y > H - 2.5 && d.z < 1.0 && d.z > -4) {
          sim.deposit(cx, H - 1, d.mass, d.A, 1);
          hit = true;
        } else if (cy >= 0 && cy < H) {
          const i = cy * W + cx;
          if (d.z <= wz[i] + 0.4 + sim.m[i] * 0.5) {
            sim.deposit(cx, cy, d.mass, d.A, 1);
            hit = true;
          }
        }
      }
      if (!hit && d.y > -20) out.push(d);
    }
    this.drops = out;
  }
}
