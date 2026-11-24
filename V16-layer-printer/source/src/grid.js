// Voxel grid = source of truth. Shape -> slicer (toolpath) -> time-compressed deposition.
export const NX = 36, NY = 44, NZ = 36, VS = 0.1;
export const EMPTY = 0, PLANNED = 1, PRINTED = 2;
export const SLAB = 4;
export const NSLABS = Math.ceil(NY / SLAB);
export const T_PRINT = 4.2;

export const idx = (i, j, k) => i + NX * (k + NZ * j);

const TAU = Math.PI * 2;
const wrapA = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

function outerR(j) {
  if (j < 2) return 17.3;
  if (j < 4) return 16.3;
  if (j < 5) return 15.3;
  if (j < 34) return 14.3;
  if (j < 35) return 14.9;
  return 16.2;
}

// Is cell inside the solid envelope of the part (before infill sparsification)?
function inRegion(i, j, k) {
  if (i < 0 || k < 0 || i >= NX || k >= NZ || j < 0 || j >= NY) return false;
  const x = i + 0.5 - NX / 2, z = k + 0.5 - NZ / 2;
  const r = Math.hypot(x, z), a = Math.atan2(z, x);
  const R = outerR(j);
  if (r > R) return false;
  if (j >= 38) {
    if (r < 12.4) return false;
    const sector = Math.floor(((a + Math.PI) / TAU) * 16 + 0.5) % 2;
    if (sector === 1 && j >= 40) return false;
  }
  // arched niches on the shaft
  if (j >= 13 && j <= 28 && r > R - 2.7) {
    for (let q = 0; q < 4; q++) {
      const A = Math.PI / 4 + q * Math.PI / 2;
      const d = Math.abs(wrapA(a - A)) * r;
      const w = 3.1;
      if (d < w && (j <= 24 || (j - 24) * (j - 24) + d * d < (w + 0.4) * (w + 0.4))) return false;
    }
  }
  // arrow slits between niches
  if (j >= 16 && j <= 26 && r > R - 2.7) {
    for (let q = 0; q < 4; q++) {
      const A = q * Math.PI / 2;
      if (Math.abs(wrapA(a - A)) * r < 0.75) return false;
    }
  }
  // string course groove
  if (j === 31 && r > R - 1.0) return false;
  return true;
}

function isWall(i, j, k) {
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dz * dz > 5) continue;
      if (!inRegion(i + dx, j, k + dz)) return true;
    }
  return false;
}
function isOuter(i, j, k) {
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++)
      if (!inRegion(i + dx, j, k + dz)) return true;
  return false;
}
const solidLayer = (j) => j < 4 || (j >= 33 && j < 38) || j >= 38;
const infill = (i, k) => (i + k) % 6 === 0 || (i - k + 60) % 6 === 0;

export class VoxelGrid {
  constructor() {
    const n = NX * NY * NZ;
    this.state = new Uint8Array(n);
    this.dep = new Float32Array(n);
    this.slice();
    this.reset();
  }

  // Slicer: per layer, outer perimeter loop, inner perimeter loop, then serpentine raster fill.
  slice() {
    const path = [], cost = [];
    let c = 0;
    const cx = NX / 2, cz = NZ / 2;
    for (let j = 0; j < NY; j++) {
      const outer = [], inner = [], fill = [];
      for (let k = 0; k < NZ; k++)
        for (let i = 0; i < NX; i++) {
          if (!inRegion(i, j, k)) continue;
          if (isWall(i, j, k)) (isOuter(i, j, k) ? outer : inner).push([i, k]);
          else if (solidLayer(j) || infill(i, k)) fill.push([i, k]);
        }
      if (!outer.length && !inner.length && !fill.length) continue;
      const ang = ([i, k]) => Math.atan2(k + 0.5 - cz, i + 0.5 - cx);
      const a0 = (j * 0.7) % TAU; // seam rotates per layer
      const key = (p) => wrapA(ang(p) - a0);
      outer.sort((p, q) => key(p) - key(q));
      inner.sort((p, q) => key(q) - key(p));
      const alongX = j % 2 === 0;
      fill.sort((p, q) => {
        const rp = alongX ? p[1] : p[0], rq = alongX ? q[1] : q[0];
        if (rp !== rq) return rp - rq;
        const dir = rp % 2 === 0 ? 1 : -1;
        return dir * ((alongX ? p[0] : p[1]) - (alongX ? q[0] : q[1]));
      });
      c += 24; // z-hop / layer change
      for (const list of [outer, inner, fill]) {
        c += 4;
        for (const [i, k] of list) { c += 1; path.push(idx(i, j, k)); cost.push(c); }
      }
    }
    this.path = Int32Array.from(path);
    this.depTime = new Float32Array(path.length);
    const C = c, EXP = 1.35;
    for (let n = 0; n < path.length; n++) this.depTime[n] = T_PRINT * Math.pow(cost[n] / C, 1 / EXP);
    this.count = path.length;
  }

  reset() {
    this.state.fill(EMPTY);
    this.dep.fill(1e6);
    for (let n = 0; n < this.count; n++) this.state[this.path[n]] = PLANNED;
    this.printed = 0;
    this.dirty = new Set();
    for (let s = 0; s < NSLABS; s++) this.dirty.add(s);
  }

  // Deposit every voxel whose scheduled time has passed.
  advanceTo(t) {
    while (this.printed < this.count && this.depTime[this.printed] <= t) {
      const id = this.path[this.printed];
      this.state[id] = PRINTED;
      this.dep[id] = this.depTime[this.printed];
      const j = Math.floor(id / (NX * NZ));
      const s = Math.floor(j / SLAB);
      this.dirty.add(s);
      if (j % SLAB === 0 && s > 0) this.dirty.add(s - 1);
      if (j % SLAB === SLAB - 1 && s < NSLABS - 1) this.dirty.add(s + 1);
      this.printed++;
    }
  }

  isPrinted(i, j, k) {
    if (i < 0 || j < 0 || k < 0 || i >= NX || j >= NY || k >= NZ) return false;
    return this.state[idx(i, j, k)] === PRINTED;
  }

  cellPos(id, out) {
    const j = Math.floor(id / (NX * NZ));
    const r = id - j * NX * NZ;
    const k = Math.floor(r / NX), i = r - k * NX;
    out[0] = (i + 0.5 - NX / 2) * VS; out[1] = (j + 1) * VS; out[2] = (k + 0.5 - NZ / 2) * VS;
    return out;
  }

  // Nozzle target at time t: interpolate along the toolpath between deposits.
  nozzleTarget(t, out) {
    const n = this.printed;
    if (n === 0) return this.cellPos(this.path[0], out);
    if (n >= this.count) return this.cellPos(this.path[this.count - 1], out);
    const a = this.cellPos(this.path[n - 1], [0, 0, 0]);
    const b = this.cellPos(this.path[n], [0, 0, 0]);
    const t0 = this.depTime[n - 1], t1 = this.depTime[n];
    const f = Math.min(1, Math.max(0, (t - t0) / Math.max(1e-6, t1 - t0)));
    for (let q = 0; q < 3; q++) out[q] = a[q] + (b[q] - a[q]) * f;
    return out;
  }
}
