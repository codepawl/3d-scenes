// Billet: a small voxel grid that is the source of truth for shape and heat.
// Occupancy + per-voxel temperature (deg C). Strikes edit the grid; heat diffuses
// between occupied neighbours and is lost through exposed faces and the anvil.

export const BX = 48, BY = 8, BZ = 16;
export const BILLET_VOXEL = 0.5;

const T_AMBIENT = 25;
const T_ANVIL = 60;
const K_COND = 9.0;      // conduction between neighbours, 1/s
const C_RAD = 5.3;      // radiative loss per exposed face
const C_ANVIL = 0.35;     // contact loss into the anvil, 1/s
const MIN_H = 2;         // a column never gets thinner than this

export const T_START = 1420;

export class Billet {
  constructor() {
    this.n = BX * BY * BZ;
    this.occ = new Uint8Array(this.n);
    this.T = new Float32Array(this.n);
    this.T2 = new Float32Array(this.n);
    this.reset();
  }

  idx(x, y, z) { return x + BX * (y + BY * z); }
  solid(x, y, z) {
    if (x < 0 || y < 0 || z < 0 || x >= BX || y >= BY || z >= BZ) return false;
    return this.occ[this.idx(x, y, z)] === 1;
  }

  reset() {
    this.occ.fill(0);
    this.T.fill(T_AMBIENT);
    // initial bar: 28 long, 4 high, 4 wide, with slightly rounded long edges
    for (let x = 6; x < 34; x++)
      for (let y = 0; y < 4; y++)
        for (let z = 6; z < 10; z++) {
          const edgeY = y === 3, edgeZ = z === 6 || z === 9;
          const endX = x === 6 || x === 33;
          if (edgeY && edgeZ && endX) continue;
          const i = this.idx(x, y, z);
          this.occ[i] = 1;
          // core hotter than skin, far (tong) end a little cooler
          const tong = Math.max(0, (14 - x) / 8);
          this.T[i] = T_START - 40 * tong - (edgeY || edgeZ ? 20 : 0);
        }
  }

  height(x, z) {
    let h = 0;
    while (h < BY && this.solid(x, h, z)) h++;
    return h;
  }

  topY(x0, x1) {
    let h = 0;
    for (let x = x0; x <= x1; x++) for (let z = 0; z < BZ; z++) h = Math.max(h, this.height(x, z));
    return h;
  }

  // Hammer blow centred on column xc with half-width hw: the top voxel of every
  // column thicker than MIN_H is removed and pushed out to the nearest side of
  // its row (spreading the bar), carrying its temperature. Returns new top height.
  strike(xc, hw) {
    const moves = [];
    for (let x = xc - hw; x <= xc + hw; x++) {
      if (x < 0 || x >= BX) continue;
      let zmin = BZ, zmax = -1;
      for (let z = 0; z < BZ; z++) if (this.height(x, z) > 0) { zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
      if (zmax < 0) continue;
      const zc = (zmin + zmax) / 2;
      for (let z = zmin; z <= zmax; z++) {
        const h = this.height(x, z);
        if (h <= MIN_H) continue;
        const i = this.idx(x, h - 1, z);
        moves.push({ x, side: z < zc ? -1 : z > zc ? 1 : (x & 1 ? 1 : -1), t: this.T[i] });
        this.occ[i] = 0;
        this.T[i] = T_AMBIENT;
      }
    }
    for (const m of moves) {
      // walk outward from the row centre to the first column lower than its inner neighbour
      let zmin = BZ, zmax = -1;
      for (let z = 0; z < BZ; z++) if (this.height(m.x, z) > 0) { zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
      let target = m.side < 0 ? zmin - 1 : zmax + 1;
      // prefer stacking on the edge column if it is still low
      const edge = m.side < 0 ? zmin : zmax;
      if (this.height(m.x, edge) < MIN_H) target = edge;
      if (target < 0 || target >= BZ) {
        // no room sideways: lengthen the bar instead
        const xt = m.x < BX / 2 ? this.findEndX(-1) : this.findEndX(1);
        if (xt < 0 || xt >= BX) continue;
        target = Math.round((zmin + zmax) / 2);
        const h = this.height(xt, target);
        if (h < BY) { const i = this.idx(xt, h, target); this.occ[i] = 1; this.T[i] = m.t; }
        continue;
      }
      const h = this.height(m.x, target);
      if (h >= BY) continue;
      const i = this.idx(m.x, h, target);
      this.occ[i] = 1;
      this.T[i] = m.t + 15; // a little deformation heat
    }
    // the blow itself heats the struck zone slightly
    for (let x = xc - hw; x <= xc + hw; x++) for (let z = 0; z < BZ; z++) for (let y = 0; y < BY; y++) {
      if (!this.solid(x, y, z)) continue;
      this.T[this.idx(x, y, z)] += 10;
    }
    return this.topY(xc - hw, xc + hw);
  }

  findEndX(dir) {
    let lo = BX, hi = -1;
    for (let x = 0; x < BX; x++) for (let z = 0; z < BZ; z++) if (this.solid(x, 0, z)) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    return dir < 0 ? lo - 1 : hi + 1;
  }

  // One explicit heat step.
  step(dt, hammerZone) {
    const { occ, T, T2 } = this;
    for (let z = 0; z < BZ; z++)
      for (let y = 0; y < BY; y++)
        for (let x = 0; x < BX; x++) {
          const i = x + BX * (y + BY * z);
          if (!occ[i]) { T2[i] = T[i]; continue; }
          const t = T[i];
          let lap = 0, exposed = 0;
          // 6 neighbours
          if (x > 0 && occ[i - 1]) lap += T[i - 1] - t; else exposed++;
          if (x < BX - 1 && occ[i + 1]) lap += T[i + 1] - t; else exposed++;
          if (z > 0 && occ[i - BX * BY]) lap += T[i - BX * BY] - t; else exposed++;
          if (z < BZ - 1 && occ[i + BX * BY]) lap += T[i + BX * BY] - t; else exposed++;
          if (y < BY - 1 && occ[i + BX]) lap += T[i + BX] - t; else exposed++;
          let anvil = 0;
          if (y > 0) { if (occ[i - BX]) lap += T[i - BX] - t; else exposed++; }
          else anvil = C_ANVIL * (t - T_ANVIL);
          const u = (t + 273) / 1000, ua = (T_AMBIENT + 273) / 1000;
          const rad = C_RAD * exposed * (u * u * u * u - ua * ua * ua * ua);
          let hammer = 0;
          if (hammerZone && x >= hammerZone[0] && x <= hammerZone[1] && (y + 1 >= BY || !occ[i + BX])) hammer = 0.5 * (t - 200);
          T2[i] = t + dt * (K_COND * lap - rad - anvil - hammer);
        }
    this.T = T2; this.T2 = T;
  }

  meanT() {
    let s = 0, c = 0;
    for (let i = 0; i < this.n; i++) if (this.occ[i]) { s += this.T[i]; c++; }
    return c ? s / c : T_AMBIENT;
  }

  meanSurfaceT() {
    let s = 0, c = 0;
    for (let z = 0; z < BZ; z++) for (let x = 0; x < BX; x++) {
      const h = this.height(x, z);
      if (h > 0) { s += this.T[this.idx(x, h - 1, z)]; c++; }
    }
    return c ? s / c : T_AMBIENT;
  }
}
