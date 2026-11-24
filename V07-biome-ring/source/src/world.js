// The voxel grid: the single source of truth for terrain, features and weather collisions.
import { fbm2, vnoise2, ihash, mulberry32, smoothstep } from './noise.js';

export const SX = 160, SY = 48, SZ = 160;
export const CX = SX / 2, CZ = SZ / 2;
export const WL = 10;              // water level: water cells occupy y <= WL
export const CHUNK = 16;

export const B = {
  AIR: 0, WATER: 1, SAND: 2, SANDSTONE: 3, REDROCK: 4, CACTUS: 5, SNOW: 6, ICE: 7, STONE: 8, DIRT: 9,
  WOOD: 10, PINE: 11, MUD: 12, GRASS: 13, REED: 14, MOSS: 15, GRAVEL: 16, LEAF: 17, DRYBUSH: 18, CATTAIL: 19,
};
// Blocks that are drawn as smaller boxes and do not hide neighbouring faces.
export const SMALL = new Uint8Array(32);
SMALL[B.REED] = 1; SMALL[B.DRYBUSH] = 1; SMALL[B.CATTAIL] = 1;
export const OPAQUE = new Uint8Array(32);
for (let i = 2; i < 32; i++) OPAQUE[i] = SMALL[i] ? 0 : 1;

export const DESERT = 0, TUNDRA = 1, WETLAND = 2;
// Sector centres (radians, atan2(z, x) around the ring centre).
export const BIOME_ANGLE = [-0.35, -0.35 + (2 * Math.PI) / 3, -0.35 - (2 * Math.PI) / 3];
export const RING_MID = 46;

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export class World {
  constructor(seed = 7) {
    this.seed = seed;
    this.grid = new Uint8Array(SX * SY * SZ);
    this.height = new Int16Array(SX * SZ);       // terrain surface y (top solid cell) after generation
    this.biome = new Uint8Array(SX * SZ);        // dominant biome per column
    this.weights = new Float32Array(SX * SZ * 3);
    this.ringT = new Float32Array(SX * SZ);       // 1 on ring centre line, 0 at shore, <0 at sea
    this.snowAdded = new Uint8Array(SX * SZ);
    this.dirty = new Set();
    this.generate();
    this.pristine = this.grid.slice();
  }

  idx(x, y, z) { return x + SX * (z + SZ * y); }
  inside(x, y, z) { return x >= 0 && x < SX && z >= 0 && z < SZ && y >= 0 && y < SY; }
  get(x, y, z) {
    if (y < 0) return B.STONE;
    if (x < 0 || x >= SX || z < 0 || z >= SZ || y >= SY) return B.AIR;
    return this.grid[x + SX * (z + SZ * y)];
  }
  setRaw(x, y, z, b) { if (this.inside(x, y, z)) this.grid[this.idx(x, y, z)] = b; }
  // Edit the grid at runtime and flag the chunk(s) whose mesh depends on this cell.
  set(x, y, z, b) {
    if (!this.inside(x, y, z)) return;
    this.grid[this.idx(x, y, z)] = b;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    const nx = SX / CHUNK;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === -1 && lx > 0) continue; if (dx === 1 && lx < CHUNK - 1) continue;
      if (dz === -1 && lz > 0) continue; if (dz === 1 && lz < CHUNK - 1) continue;
      const kx = cx + dx, kz = cz + dz;
      if (kx >= 0 && kz >= 0 && kx < nx && kz < SZ / CHUNK) this.dirty.add(kx + kz * nx);
    }
  }
  reset() {
    this.grid.set(this.pristine);
    this.snowAdded.fill(0);
    for (let i = 0; i < (SX / CHUNK) * (SZ / CHUNK); i++) this.dirty.add(i);
  }
  topSolid(x, z) {
    for (let y = SY - 1; y >= 0; y--) { const b = this.get(x, y, z); if (b !== B.AIR && !SMALL[b]) return y; }
    return -1;
  }

  generate() {
    const s = this.seed;
    const H = new Float32Array(SX * SZ);
    const mesa = new Uint8Array(SX * SZ);
    // ---- pass 1: heights and biome weights per column
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
      const i = x + z * SX;
      const dx = x + 0.5 - CX, dz = z + 0.5 - CZ;
      const r = Math.hypot(dx, dz), th = Math.atan2(dz, dx);
      const warp = (fbm2(x * 0.028, z * 0.028, 3, s + 1) - 0.5) * 1.1;
      const thw = th + warp;
      let wsum = 0, best = 0, bestW = -1;
      const w = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const d = angDiff(thw, BIOME_ANGLE[k]);
        w[k] = Math.exp(-(d * d) / (0.62 * 0.62));
        wsum += w[k];
      }
      for (let k = 0; k < 3; k++) {
        w[k] /= wsum; this.weights[i * 3 + k] = w[k];
        if (w[k] > bestW) { bestW = w[k]; best = k; }
      }
      this.biome[i] = best;

      const rn = fbm2(Math.cos(th) * 1.7 + 9, Math.sin(th) * 1.7 + 9, 3, s + 2);
      const halfW = 18 + (rn - 0.5) * 10;
      let t = 1 - Math.abs(r - RING_MID) / halfW;
      t += (fbm2(x * 0.07, z * 0.07, 3, s + 3) - 0.5) * 0.45;
      this.ringT[i] = t;
      const sh = smoothstep(0.0, 0.45, t);
      const base = WL - 5 + 6 * sh;

      // desert: transverse dunes + flat pan
      const dw = fbm2(x * 0.05, z * 0.05, 3, s + 4);
      const u = (dx * 0.8 - dz * 0.6) * 0.33 + dw * 5;
      const hd = Math.pow(0.5 + 0.5 * Math.sin(u), 2.2) * 4.5 + fbm2(x * 0.09, z * 0.09, 2, s + 5) * 2.5;
      // tundra: rolling hills with ridged peaks
      const n1 = fbm2(x * 0.045, z * 0.045, 4, s + 6);
      const rid = 1 - Math.abs(2 * fbm2(x * 0.035, z * 0.035, 3, s + 7) - 1);
      let ht = 1 + n1 * 6 + Math.pow(rid, 3) * 8;
      // wetland: low hummocks broken by pools
      const p = fbm2(x * 0.085, z * 0.085, 3, s + 8);
      let hw = -0.3 + fbm2(x * 0.13, z * 0.13, 2, s + 9) * 2.6;
      if (p < 0.4) hw -= (0.4 - p) * 18;

      let h = base + sh * (w[0] * hd + w[1] * ht + w[2] * Math.max(hw, -3.5));
      // banded mesas inside the desert
      const m = fbm2(x * 0.075 + 50, z * 0.075, 3, s + 10);
      if (w[0] > 0.72 && sh > 0.85 && m > 0.67) {
        const top = WL + 8 + Math.floor(fbm2(x * 0.2, z * 0.2, 2, s + 11) * 2.0) + (m > 0.72 ? 3 : 0);
        h = Math.max(h, top); mesa[i] = 1;
      }
      H[i] = h;
    }
    for (let i = 0; i < SX * SZ; i++) this.height[i] = Math.max(1, Math.min(SY - 14, Math.floor(H[i])));

    // ---- pass 2: fill columns
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
      const i = x + z * SX;
      const h = this.height[i];
      const bio = this.biome[i];
      let slope = 0;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = Math.min(SX - 1, Math.max(0, x + ox)), zz = Math.min(SZ - 1, Math.max(0, z + oz));
        slope = Math.max(slope, Math.abs(this.height[xx + zz * SX] - h));
      }
      const pn = vnoise2(x * 0.25, z * 0.25, s + 12);
      for (let y = 0; y <= h; y++) {
        const d = h - y;
        let b = B.STONE;
        if (bio === DESERT) {
          if (mesa[i]) b = (d === 0 && pn > 0.72) ? B.SAND : (((y + Math.floor(pn * 2)) % 5) < 2 ? B.REDROCK : B.SANDSTONE);
          else b = d < 3 ? B.SAND : (d < 9 ? B.SANDSTONE : B.STONE);
        } else if (bio === TUNDRA) {
          if (d === 0) {
            if (slope >= 3) b = B.STONE;
            else if (h <= WL) b = B.GRAVEL;
            else if (h <= WL + 1) b = pn > 0.45 ? B.SNOW : B.GRAVEL;
            else b = (slope === 2 && pn > 0.6) ? B.STONE : B.SNOW;
          } else if (d < 3) b = slope >= 3 ? B.STONE : B.DIRT;
          else b = B.STONE;
        } else {
          if (d === 0) {
            if (h <= WL - 1) b = B.MUD;
            else if (h <= WL + 1) b = pn > 0.55 ? B.MOSS : B.MUD;
            else b = pn > 0.62 ? B.MOSS : B.GRASS;
          } else if (d < 4) b = d < 2 && h <= WL + 1 ? B.MUD : B.DIRT;
          else b = B.STONE;
        }
        this.grid[this.idx(x, y, z)] = b;
      }
      for (let y = h + 1; y <= WL; y++) {
        let b = B.WATER;
        if (y === WL && bio === TUNDRA && this.weights[i * 3 + 1] > 0.6) {
          const ice = fbm2(x * 0.12, z * 0.12, 3, s + 13) + this.ringT[i] * 0.5;
          if (ice > 0.42) b = B.ICE;
        }
        this.grid[this.idx(x, y, z)] = b;
      }
    }
    this.placeFeatures();
  }

  placeFeatures() {
    const rng = mulberry32(this.seed * 977 + 13);
    const g = (x, y, z) => this.get(x, y, z);
    const put = (x, y, z, b, onlyAir = true) => {
      if (!this.inside(x, y, z)) return;
      if (onlyAir && g(x, y, z) !== B.AIR) return;
      this.setRaw(x, y, z, b);
    };
    const clearAround = (x, y, z, r, hgt) => {
      for (let yy = y; yy < y + hgt; yy++) for (let zz = z - r; zz <= z + r; zz++) for (let xx = x - r; xx <= x + r; xx++)
        if (g(xx, yy, zz) !== B.AIR) return false;
      return true;
    };
    for (let z = 2; z < SZ - 2; z++) for (let x = 2; x < SX - 2; x++) {
      const i = x + z * SX;
      const h = this.height[i];
      const top = g(x, h, z);
      const bio = this.biome[i];
      const rr = rng();
      if (h <= WL - 1) continue;
      if (bio === DESERT && top === B.SAND && h > WL) {
        if (rr < 0.0045 && clearAround(x, h + 1, z, 2, 7)) this.cactus(x, h + 1, z, rng, put);
        else if (rr < 0.016) put(x, h + 1, z, B.DRYBUSH);
        else if (rr < 0.0185 && clearAround(x, h + 1, z, 1, 2)) {
          for (let k = 0; k < 4; k++) put(x + (k & 1), h + 1, z + (k >> 1), B.REDROCK);
          if (rng() < 0.5) put(x, h + 2, z, B.REDROCK);
        }
      } else if (bio === TUNDRA && (top === B.SNOW || top === B.GRAVEL) && h > WL) {
        if (rr < 0.022 && clearAround(x, h + 1, z, 2, 9)) this.pine(x, h + 1, z, rng, put);
        else if (rr < 0.026) this.boulder(x, h, z, rng);
      } else if (bio === WETLAND) {
        const nearWater = g(x + 1, WL, z) === B.WATER || g(x - 1, WL, z) === B.WATER || g(x, WL, z + 1) === B.WATER || g(x, WL, z - 1) === B.WATER;
        if ((top === B.GRASS || top === B.MOSS) && rr < 0.0065 && h > WL + 1 && clearAround(x, h + 1, z, 3, 8)) this.willow(x, h + 1, z, rng, put);
        else if ((top === B.MUD || top === B.MOSS) && h <= WL + 1 && nearWater && rr < 0.5) {
          const n = 1 + Math.floor(rng() * 3);
          for (let k = 0; k < n; k++) put(x, h + 1 + k, z, B.REED);
          if (n >= 2 && rng() < 0.6) put(x, h + 1 + n, z, B.CATTAIL);
        } else if (top === B.GRASS && rr < 0.03) put(x, h + 1, z, B.REED);
      }
    }
  }

  cactus(x, y, z, rng, put) {
    const hgt = 4 + Math.floor(rng() * 3);
    for (let k = 0; k < hgt; k++) put(x, y + k, z, B.CACTUS);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const arms = 1 + Math.floor(rng() * 2);
    for (let a = 0; a < arms; a++) {
      const [ox, oz] = dirs[Math.floor(rng() * 4)];
      const ay = y + 1 + Math.floor(rng() * 2) + a;
      put(x + ox, ay, z + oz, B.CACTUS);
      const up = 1 + Math.floor(rng() * 2);
      for (let k = 1; k <= up; k++) put(x + ox, ay + k, z + oz, B.CACTUS);
    }
  }

  pine(x, y, z, rng, put) {
    const trunk = 2 + Math.floor(rng() * 2);
    const tiers = [3, 2, 2, 1, 2, 1, 1, 0];
    const L = tiers.length - Math.floor(rng() * 2);
    for (let k = 0; k < trunk + L - 1; k++) put(x, y + k, z, B.WOOD);
    for (let t = 0; t < L; t++) {
      const yy = y + trunk + t;
      let R = tiers[t] - (t > 3 && rng() < 0.3 ? 1 : 0);
      R = Math.max(0, R);
      for (let oz = -R; oz <= R; oz++) for (let ox = -R; ox <= R; ox++) {
        const d = Math.hypot(ox, oz);
        if (d > R + 0.35) continue;
        if (d > R - 0.5 && R > 1 && rng() < 0.25) continue;
        put(x + ox, yy, z + oz, B.PINE, !(ox === 0 && oz === 0));
        if (ox === 0 && oz === 0) this.setRaw(x, yy, z, t === L - 1 ? B.PINE : B.WOOD);
      }
    }
    put(x, y + trunk + L, z, B.SNOW);
    // snow dusting on upward-facing needles
    for (let t = 0; t < L; t++) {
      const yy = y + trunk + t;
      for (let oz = -3; oz <= 3; oz++) for (let ox = -3; ox <= 3; ox++) {
        if (this.get(x + ox, yy, z + oz) === B.PINE && this.get(x + ox, yy + 1, z + oz) === B.AIR && rng() < 0.55)
          this.setRaw(x + ox, yy, z + oz, B.SNOW);
      }
    }
  }

  boulder(x, h, z, rng) {
    const R = 1.2 + rng() * 1.4;
    const ry = R * (0.6 + rng() * 0.3);
    const n = Math.ceil(R);
    for (let oy = 0; oy <= n; oy++) for (let oz = -n; oz <= n; oz++) for (let ox = -n; ox <= n; ox++) {
      const q = (ox * ox + oz * oz) / (R * R) + (oy * oy) / (ry * ry);
      if (q > 1 + (ihash(x + ox, oy, z + oz, 5) - 0.5) * 0.4) continue;
      const xx = x + ox, yy = h + oy, zz = z + oz;
      if (this.get(xx, yy, zz) === B.AIR || oy === 0) this.setRaw(xx, yy, zz, B.STONE);
    }
    for (let oz = -n; oz <= n; oz++) for (let ox = -n; ox <= n; ox++) {
      for (let oy = n; oy >= 0; oy--) {
        if (this.get(x + ox, h + oy, z + oz) === B.STONE) {
          if (rng() < 0.6) this.setRaw(x + ox, h + oy, z + oz, B.SNOW);
          break;
        }
      }
    }
  }

  willow(x, y, z, rng, put) {
    const trunk = 4 + Math.floor(rng() * 2);
    const lx = rng() < 0.5 ? 1 : 0;
    for (let k = 0; k < trunk; k++) put(x + (k > 2 ? lx : 0), y + k, z, B.WOOD);
    const cx = x + lx, cy = y + trunk, cz = z;
    const R = 3.2 + rng() * 0.8;
    for (let oy = -1; oy <= 2; oy++) for (let oz = -4; oz <= 4; oz++) for (let ox = -4; ox <= 4; ox++) {
      const q = (ox * ox + oz * oz) / (R * R) + ((oy - 0.3) * (oy - 0.3)) / 4;
      if (q > 1 || rng() < 0.12) continue;
      put(cx + ox, cy + oy, cz + oz, B.LEAF);
    }
    // drooping strands from the crown rim
    for (let oz = -4; oz <= 4; oz++) for (let ox = -4; ox <= 4; ox++) {
      const d = Math.hypot(ox, oz);
      if (d < R - 1.2 || d > R + 0.2 || rng() < 0.45) continue;
      const len = 1 + Math.floor(rng() * 4);
      for (let k = 2; k <= len + 1; k++) put(cx + ox, cy - k, cz + oz, B.LEAF);
    }
    put(cx, cy, cz, B.WOOD, false);
  }
}
