// Procedural city written into a voxel grid. The grid is the single source of truth;
// everything on screen is meshed from it.

export const NX = 192, NY = 96, NZ = 192;

// Block types (0 = air)
export const T = {
  AIR: 0,
  ASPHALT: 1,
  SIDEWALK: 2,
  MARKING: 3,
  GRASS: 4,
  LEAVES: 5,
  TRUNK: 6,
  ROOF: 7,
  METAL: 8,
  WINDOW: 9,
  LAMP: 10,
  BEACON: 11,
  TANK: 12,
  CURB: 13,
  WALL0: 32, // 32.. 32+WALL_COUNT-1 : facade colours
};
export const WALL_COUNT = 12;

// sRGB palette (converted to linear in the mesher)
export const PALETTE = new Map([
  [T.ASPHALT, 0x2b2c31],
  [T.SIDEWALK, 0x8a8580],
  [T.CURB, 0x9d9890],
  [T.MARKING, 0xd8c87a],
  [T.GRASS, 0x4f6b35],
  [T.LEAVES, 0x3d6a33],
  [T.TRUNK, 0x5a4030],
  [T.ROOF, 0x55524f],
  [T.METAL, 0x8d9399],
  [T.WINDOW, 0x27323f],
  [T.LAMP, 0xfff1c9],
  [T.BEACON, 0xff3020],
  [T.TANK, 0x6e5440],
]);
const WALLS = [
  0xb9a890, 0x9e8f7e, 0xc8bfae, 0x8f7768, 0xa3655a, 0x7f8790,
  0xd2c6b2, 0x6f6a66, 0xb48c6c, 0x94a0a8, 0xc9b79a, 0x85715f,
];
WALLS.forEach((c, i) => PALETTE.set(T.WALL0 + i, c));

// emissive "kind" per block type, consumed by the shader
export function kindOf(t) {
  if (t === T.WINDOW) return 1;
  if (t === T.LAMP) return 2;
  if (t === T.BEACON) return 3;
  return 0;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Grid {
  constructor() {
    this.data = new Uint8Array(NX * NY * NZ);
  }
  idx(x, y, z) { return x + NX * (z + NZ * y); }
  get(x, y, z) {
    if (x < 0 || y < 0 || z < 0 || x >= NX || y >= NY || z >= NZ) return 0;
    return this.data[x + NX * (z + NZ * y)];
  }
  set(x, y, z, t) {
    if (x < 0 || y < 0 || z < 0 || x >= NX || y >= NY || z >= NZ) return;
    this.data[x + NX * (z + NZ * y)] = t;
  }
  box(x0, y0, z0, x1, y1, z1, t) { // inclusive
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) this.set(x, y, z, t);
  }
}

const PITCH = 24;   // block pitch
const ROAD = 6;     // asphalt width
const WALK = 2;     // sidewalk ring inside each block

export function generateCity(seed = 7) {
  const rnd = mulberry32(seed);
  const g = new Grid();
  const cx = NX / 2, cz = NZ / 2;

  // --- ground: asphalt everywhere, raised sidewalk / lot surface inside blocks
  g.box(0, 0, 0, NX - 1, 0, NZ - 1, T.ASPHALT);
  const nb = Math.ceil(NX / PITCH);
  for (let bz = 0; bz < nb; bz++) {
    for (let bx = 0; bx < nb; bx++) {
      const x0 = bx * PITCH + ROAD / 2, z0 = bz * PITCH + ROAD / 2;
      const x1 = x0 + PITCH - ROAD - 1, z1 = z0 + PITCH - ROAD - 1;
      g.box(x0, 1, z0, x1, 1, z1, T.SIDEWALK);
      // curb ring
      for (let x = x0; x <= x1; x++) { g.set(x, 1, z0, T.CURB); g.set(x, 1, z1, T.CURB); }
      for (let z = z0; z <= z1; z++) { g.set(x0, 1, z, T.CURB); g.set(x1, 1, z, T.CURB); }
      buildBlock(g, rnd, x0, z0, x1, z1, cx, cz);
    }
  }
  // dashed centre lines
  for (let k = 0; k <= nb; k++) {
    const c = k * PITCH - 1; // road centre (roads straddle multiples of PITCH)
    for (let i = 0; i < NX; i++) {
      if ((i >> 1) % 3 !== 0) continue;
      for (const o of [0, 1]) {
        if (g.get(i, 1, c + o) === 0 && g.get(i, 0, c + o) === T.ASPHALT && !onCrossing(i)) g.set(i, 0, c + o, T.MARKING);
        if (g.get(c + o, 1, i) === 0 && g.get(c + o, 0, i) === T.ASPHALT && !onCrossing(i)) g.set(c + o, 0, i, T.MARKING);
      }
    }
  }
  return g;
}

function onCrossing(i) {
  const m = ((i % PITCH) + PITCH) % PITCH;
  return m < ROAD / 2 || m >= PITCH - ROAD / 2;
}

function buildBlock(g, rnd, x0, z0, x1, z1, cx, cz) {
  // street lamps on the sidewalk corners/edges
  const lamp = (x, z, dx, dz) => {
    for (let y = 2; y <= 6; y++) g.set(x, y, z, T.METAL);
    g.set(x + dx, 7, z + dz, T.LAMP);
    g.set(x, 7, z, T.METAL);
  };
  for (let x = x0 + 3; x <= x1 - 3; x += 8) { lamp(x, z0, 0, -1); lamp(x, z1, 0, 1); }
  for (let z = z0 + 7; z <= z1 - 7; z += 8) { lamp(x0, z, -1, 0); lamp(x1, z, 1, 0); }

  const ix0 = x0 + WALK, iz0 = z0 + WALK, ix1 = x1 - WALK, iz1 = z1 - WALK;
  const bxm = (x0 + x1) / 2, bzm = (z0 + z1) / 2;
  const d = Math.hypot(bxm - cx, bzm - cz) / (NX * 0.5);
  const centrality = Math.max(0, 1 - d);

  if (rnd() < 0.1 && centrality < 0.85) {
    park(g, rnd, ix0, iz0, ix1, iz1);
    return;
  }

  // subdivide lot into parcels
  const parcels = [];
  const split = rnd();
  const mx = Math.floor((ix0 + ix1) / 2), mz = Math.floor((iz0 + iz1) / 2);
  if (split < 0.25) parcels.push([ix0, iz0, ix1, iz1]);
  else if (split < 0.5) { parcels.push([ix0, iz0, mx - 1, iz1], [mx + 1, iz0, ix1, iz1]); }
  else if (split < 0.65) { parcels.push([ix0, iz0, ix1, mz - 1], [ix0, mz + 1, ix1, iz1]); }
  else {
    parcels.push([ix0, iz0, mx - 1, mz - 1], [mx + 1, iz0, ix1, mz - 1],
      [ix0, mz + 1, mx - 1, iz1], [mx + 1, mz + 1, ix1, iz1]);
  }
  for (const [a, b, c, e] of parcels) {
    const tall = Math.pow(centrality, 1.6);
    let h = 6 + Math.floor(rnd() * 9 + tall * (20 + rnd() * 60));
    if (rnd() < 0.08) h += 18; // occasional tower outside the core
    h = Math.min(h, NY - 12);
    building(g, rnd, a, b, c, e, h);
  }
}

function park(g, rnd, x0, z0, x1, z1) {
  g.box(x0, 1, z0, x1, 1, z1, T.GRASS);
  const n = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const x = x0 + 2 + Math.floor(rnd() * (x1 - x0 - 3));
    const z = z0 + 2 + Math.floor(rnd() * (z1 - z0 - 3));
    const th = 3 + Math.floor(rnd() * 3);
    for (let y = 2; y < 2 + th; y++) g.set(x, y, z, T.TRUNK);
    const r = 2 + rnd() * 0.8, cy = 2 + th + 1;
    for (let dy = -2; dy <= 3; dy++)
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) {
          const q = (dx * dx + dz * dz) / (r * r) + (dy * dy) / ((r + 0.4) * (r + 0.4));
          if (q < 1 && g.get(x + dx, cy + dy, z + dz) === 0) g.set(x + dx, cy + dy, z + dz, T.LEAVES);
        }
  }
}

// window pattern predicates: (col along facade, row above ground floor) -> window?
const STYLES = [
  (c, r) => (c % 2 === 1) && (r % 3 !== 0),          // punched windows, 2 tall
  (c, r) => (r % 3 === 1),                            // ribbon windows
  (c, r) => (c % 3 !== 0) && (r % 4 !== 0),           // grid curtain wall
  (c, r) => (c % 4 === 1 || c % 4 === 2) && (r % 3 === 1), // paired windows
];

function building(g, rnd, x0, z0, x1, z1, h) {
  // random inset so neighbours don't fuse
  if (x1 - x0 > 5 && rnd() < 0.5) { x0 += 1; }
  if (z1 - z0 > 5 && rnd() < 0.5) { z1 -= 1; }
  const wall = T.WALL0 + Math.floor(rnd() * WALL_COUNT);
  const style = STYLES[Math.floor(rnd() * STYLES.length)];
  const base = 2;
  const tiers = h > 40 ? 3 : h > 22 ? 2 : 1;
  let top = base + h;
  let bx0 = x0, bz0 = z0, bx1 = x1, bz1 = z1;
  let yStart = base;
  for (let t = 0; t < tiers; t++) {
    const yEnd = t === tiers - 1 ? top : yStart + Math.floor((top - yStart) * (0.55 + rnd() * 0.15));
    for (let y = yStart; y < yEnd; y++) {
      const r = y - base;
      for (let z = bz0; z <= bz1; z++)
        for (let x = bx0; x <= bx1; x++) {
          const edgeX = x === bx0 || x === bx1, edgeZ = z === bz0 || z === bz1;
          let tt = wall;
          if ((edgeX || edgeZ) && !(edgeX && edgeZ) && r >= 2) {
            const c = edgeX ? z - bz0 : x - bx0;
            if (style(c, r)) tt = T.WINDOW;
          } else if ((edgeX || edgeZ) && !(edgeX && edgeZ) && r < 2) {
            // storefront band on ground floor
            const c = edgeX ? z - bz0 : x - bx0;
            if (r === 1 && c % 3 !== 0) tt = T.WINDOW;
          }
          g.set(x, y, z, tt);
        }
    }
    // roof of this tier + parapet
    g.box(bx0, yEnd, bz0, bx1, yEnd, bz1, T.ROOF);
    for (let x = bx0; x <= bx1; x++) { g.set(x, yEnd, bz0, wall); g.set(x, yEnd, bz1, wall); }
    for (let z = bz0; z <= bz1; z++) { g.set(bx0, yEnd, z, wall); g.set(bx1, yEnd, z, wall); }
    if (t < tiers - 1) {
      const inset = 1 + Math.floor(rnd() * 2);
      if (bx1 - bx0 - 2 * inset < 3 || bz1 - bz0 - 2 * inset < 3) { top = yEnd; break; }
      bx0 += inset; bz0 += inset; bx1 -= inset; bz1 -= inset;
      yStart = yEnd + 1;
    } else top = yEnd;
  }
  // rooftop clutter on the last tier
  const w = bx1 - bx0, dpt = bz1 - bz0;
  const nAC = Math.floor(rnd() * 3);
  for (let i = 0; i < nAC && w > 4 && dpt > 4; i++) {
    const ax = bx0 + 1 + Math.floor(rnd() * (w - 3)), az = bz0 + 1 + Math.floor(rnd() * (dpt - 3));
    g.box(ax, top + 1, az, ax + 1, top + 1, az + 1, T.METAL);
  }
  if (rnd() < 0.3 && w > 5 && dpt > 5 && h < 50) {
    // water tower
    const tx = bx0 + 2 + Math.floor(rnd() * (w - 4)), tz = bz0 + 2 + Math.floor(rnd() * (dpt - 4));
    g.set(tx - 1, top + 1, tz - 1, T.METAL); g.set(tx + 1, top + 1, tz - 1, T.METAL);
    g.set(tx - 1, top + 1, tz + 1, T.METAL); g.set(tx + 1, top + 1, tz + 1, T.METAL);
    for (let y = top + 2; y <= top + 4; y++)
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) g.set(tx + dx, y, tz + dz, T.TANK);
    g.set(tx, top + 5, tz, T.TANK);
  }
  if (h > 55) {
    const ax = Math.floor((bx0 + bx1) / 2), az = Math.floor((bz0 + bz1) / 2);
    const ah = 4 + Math.floor(rnd() * 5);
    for (let y = top + 1; y < top + 1 + ah; y++) g.set(ax, y, az, T.METAL);
    g.set(ax, top + 1 + ah, az, T.BEACON);
  }
}
