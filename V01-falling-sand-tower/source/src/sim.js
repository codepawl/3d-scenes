// 128^3 falling-sand cellular automaton. The Uint8Array `grid` is the single source of truth.
export const N = 128;
export const NN = N * N;
export const CS = 16;              // chunk size
export const CN = N / CS;          // chunks per axis (8)

export const EMPTY = 0, ROCK = 1, SAND = 2, WATER = 3, LAVA = 4, BASALT = 5;
export const MATERIAL_NAMES = ['empty', 'rock', 'sand', 'water', 'lava', 'basalt'];

export const idx = (x, y, z) => x + z * N + y * NN;

export class Sim {
  constructor(seed = 1337) {
    this.grid = new Uint8Array(N * N * N);
    this.stamp = new Uint16Array(N * N * N);
    this.activeNext = new Uint8Array(CN * CN * CN);
    this.activeNow = new Uint8Array(CN * CN * CN);
    this.dirtyMesh = new Uint8Array(CN * CN * CN).fill(1);
    this.seed = seed;
    this.reset();
  }

  reset() {
    this.grid.fill(0);
    this.stamp.fill(0);
    this.rng = this.seed >>> 0 || 1;
    this.tick = 0;
    this.emitMaterial = SAND;
    this.forcedMaterial = 0;
    this.nozzle = { x: 64, y: 120, z: 64 };
    buildWorld(this);
    this.activeNext.fill(1);
    this.dirtyMesh.fill(1);
  }

  rand() { // xorshift32 -> [0,1)
    let r = this.rng;
    r ^= r << 13; r ^= r >>> 17; r ^= r << 5;
    this.rng = r >>> 0;
    return this.rng / 4294967296;
  }

  // flag the chunk(s) containing / bordering cell (x,y,z) as active and needing a remesh
  mark(x, y, z) {
    const cx = x >> 4, cy = y >> 4, cz = z >> 4;
    const lx = x & 15, ly = y & 15, lz = z & 15;
    const x0 = lx === 0 && cx > 0 ? cx - 1 : cx, x1 = lx === 15 && cx < CN - 1 ? cx + 1 : cx;
    const y0 = ly === 0 && cy > 0 ? cy - 1 : cy, y1 = ly === 15 && cy < CN - 1 ? cy + 1 : cy;
    const z0 = lz === 0 && cz > 0 ? cz - 1 : cz, z1 = lz === 15 && cz < CN - 1 ? cz + 1 : cz;
    for (let a = y0; a <= y1; a++)
      for (let b = z0; b <= z1; b++)
        for (let c = x0; c <= x1; c++) {
          const k = c + b * CN + a * CN * CN;
          this.activeNext[k] = 1; this.dirtyMesh[k] = 1;
        }
  }

  markIdx(i) { this.mark(i & 127, i >> 14, (i >> 7) & 127); }

  set(x, y, z, m) {
    const i = idx(x, y, z);
    if (this.grid[i] !== m) { this.grid[i] = m; this.mark(x, y, z); }
  }

  materialAt(tick) {
    if (this.forcedMaterial) return this.forcedMaterial;
    const cycle = [SAND, WATER, LAVA];
    return cycle[Math.floor(tick / 180) % 3]; // 3 s per material at 60 ticks/s
  }

  emit() {
    const t = this.tick / 60;
    const ang = t * 0.55 + 0.8;
    const rad = 26 + 14 * Math.sin(t * 0.37);
    const nx = Math.round(64 + Math.cos(ang) * rad);
    const nz = Math.round(64 + Math.sin(ang) * rad);
    const ny = 118;
    this.nozzle.x = nx; this.nozzle.y = ny; this.nozzle.z = nz;
    const m = this.materialAt(this.tick);
    this.emitMaterial = m;
    const r = 2;
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r + 1) continue;
        if (this.rand() > 0.55) continue;
        const x = nx + dx, z = nz + dz;
        if (x < 1 || x > N - 2 || z < 1 || z > N - 2) continue;
        const i = idx(x, ny, z);
        if (this.grid[i] === EMPTY) { this.grid[i] = m; this.mark(x, ny, z); }
      }
  }

  step() {
    this.tick++;
    let s = this.tick & 0xffff;
    if (s === 0) { this.stamp.fill(0); s = 1; this.tick++; }
    const st = s;
    this.emit();

    const g = this.grid, stamp = this.stamp;
    const an = this.activeNow;
    an.set(this.activeNext);
    this.activeNext.fill(0);
    const flip = this.tick & 1;

    // neighbour offsets for sideways / diagonal moves (4-connected in the xz plane)
    const DX = [1, -1, 0, 0], DZ = [0, 0, 1, -1];

    for (let y = 1; y < N; y++) {
      const cy = y >> 4;
      for (let cz = 0; cz < CN; cz++) {
        for (let cxi = 0; cxi < CN; cxi++) {
          const cx = flip ? CN - 1 - cxi : cxi;
          if (!an[cx + cz * CN + cy * CN * CN]) continue;
          const zBase = cz * CS, xBase = cx * CS;
          for (let lz = 0; lz < CS; lz++) {
            const z = zBase + lz;
            for (let lxi = 0; lxi < CS; lxi++) {
              const x = xBase + (flip ? CS - 1 - lxi : lxi);
              const i = x + z * N + y * NN;
              const m = g[i];
              if (m < SAND || m === BASALT || stamp[i] === st) continue;

              if (m === LAVA) {
                // contact with water: lava hardens to basalt, water flashes to steam (removed)
                let hit = -1;
                if (g[i - NN] === WATER) hit = i - NN;
                else if (y < N - 1 && g[i + NN] === WATER) hit = i + NN;
                else if (x < N - 1 && g[i + 1] === WATER) hit = i + 1;
                else if (x > 0 && g[i - 1] === WATER) hit = i - 1;
                else if (z < N - 1 && g[i + N] === WATER) hit = i + N;
                else if (z > 0 && g[i - N] === WATER) hit = i - N;
                if (hit >= 0) {
                  g[i] = BASALT; g[hit] = EMPTY; stamp[i] = st;
                  this.mark(x, y, z); this.markIdx(hit);
                  continue;
                }
                if (this.rand() < 0.45) { this.activeNext[(x >> 4) + (z >> 4) * CN + cy * CN * CN] = 1; continue; } // viscous
              }

              const below = i - NN;
              const tb = g[below];
              // 1. straight down
              if (tb === EMPTY || (m === SAND && tb === WATER)) {
                this.swap(i, below, m, tb, st, x, y, z, x, y - 1, z);
                continue;
              }
              // 2. diagonal down
              const r0 = (this.rand() * 4) | 0;
              let moved = false;
              for (let k = 0; k < 4; k++) {
                const d = (r0 + k) & 3;
                const nx = x + DX[d], nz = z + DZ[d];
                if (nx < 0 || nx >= N || nz < 0 || nz >= N) continue;
                const j = nx + nz * N + (y - 1) * NN;
                const t = g[j];
                if (t === EMPTY || (m === SAND && t === WATER)) {
                  this.swap(i, j, m, t, st, x, y, z, nx, y - 1, nz);
                  moved = true; break;
                }
              }
              if (moved || m === SAND) continue;
              // lone resting water droplets (no water beside them) slowly evaporate so pools settle flat
              if (m === WATER && this.rand() < 0.04 &&
                  (x === 0 || g[i - 1] !== WATER) && (x === N - 1 || g[i + 1] !== WATER) &&
                  (z === 0 || g[i - N] !== WATER) && (z === N - 1 || g[i + N] !== WATER)) {
                g[i] = EMPTY; this.mark(x, y, z);
                continue;
              }
              // 3. liquids spread sideways
              for (let k = 0; k < 4; k++) {
                const d = (r0 + k) & 3;
                const nx = x + DX[d], nz = z + DZ[d];
                if (nx < 0 || nx >= N || nz < 0 || nz >= N) continue;
                const j = nx + nz * N + y * NN;
                if (g[j] === EMPTY) {
                  this.swap(i, j, m, EMPTY, st, x, y, z, nx, y, nz);
                  break;
                }
              }
            }
          }
        }
      }
    }
  }

  swap(i, j, m, t, st, x, y, z, nx, ny, nz) {
    const g = this.grid;
    g[j] = m; g[i] = t;
    this.stamp[j] = st; this.stamp[i] = st;
    this.mark(x, y, z); this.mark(nx, ny, nz);
    // wake the cell above the vacated one (may live in the chunk above)
    if (y < N - 1) this.mark(x, y + 1, z);
  }
}

// ---------- world generation: walled basin, rock tower with a spiral ledge, floating shelves ----------
function buildWorld(sim) {
  const g = sim.grid;
  const C = 63.5;
  const put = (x, y, z, m) => {
    if (x < 0 || y < 0 || z < 0 || x >= N || y >= N || z >= N) return;
    g[idx(x, y, z)] = m;
  };
  // floor + rim
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      put(x, 0, z, ROCK);
      const edge = Math.min(x, z, N - 1 - x, N - 1 - z);
      if (edge < 2) for (let y = 1; y <= 9; y++) put(x, y, z, ROCK);
    }
  // central column with a slightly flared base and a crown basin
  for (let y = 1; y <= 98; y++) {
    const rad = 8.5 + Math.max(0, (14 - y) * 0.35);
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        const d = Math.hypot(x - C, z - C);
        if (d < rad) put(x, y, z, ROCK);
        if (y >= 95 && d < 13 && (d > 11 || y === 95)) put(x, y, z, ROCK); // crown bowl
      }
  }
  // spiral ledge descending around the column (2.6 turns)
  const turns = 2.6, top = 92, bottom = 12;
  const steps = 6000;
  for (let k = 0; k <= steps; k++) {
    const s = k / steps;
    const th = s * turns * Math.PI * 2;
    const yy = Math.round(top - s * (top - bottom));
    const cs = Math.cos(th), sn = Math.sin(th);
    for (let r = 8; r <= 25; r += 0.5) {
      const x = Math.round(C + cs * r), z = Math.round(C + sn * r);
      put(x, yy, z, ROCK); put(x, yy - 1, z, ROCK);
      if (r >= 24) put(x, yy + 1, z, ROCK); // lip that holds a little material
    }
  }
  // floating shelves (square slabs with a drain hole)
  const shelves = [
    [24, 70, 30, 10], [100, 54, 34, 9], [96, 82, 98, 8], [30, 38, 96, 11], [70, 28, 106, 9], [104, 30, 66, 8],
  ];
  for (const [sx, sy, sz, h] of shelves) {
    for (let z = -h; z <= h; z++)
      for (let x = -h; x <= h; x++) {
        if (x * x + z * z < 5) continue; // drain hole
        put(sx + x, sy, sz + z, ROCK);
        if (Math.abs(x) === h || Math.abs(z) === h) put(sx + x, sy + 1, sz + z, ROCK);
      }
  }
  // shallow pool in the basin and a sand dune in one corner, so the start isn't empty
  for (let z = 2; z < N - 2; z++)
    for (let x = 2; x < N - 2; x++) {
      const dune = Math.max(0, 16 - Math.hypot(x - 22, z - 106) * 0.55) + Math.max(0, 9 - Math.hypot(x - 108, z - 20) * 0.5);
      let y = 1;
      for (; y <= Math.floor(dune); y++) if (g[idx(x, y, z)] === EMPTY) g[idx(x, y, z)] = SAND;
      for (; y <= 3; y++) if (g[idx(x, y, z)] === EMPTY) g[idx(x, y, z)] = WATER;
    }
}
