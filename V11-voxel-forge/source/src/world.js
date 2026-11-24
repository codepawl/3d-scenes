import { Grid } from './mesher.js';

// Linear-space colours. group: 0 matte, 1 metal, 2 emissive
const srgb = (h) => {
  const c = [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return c;
};

export const M = {
  STONE: 1, GROUT: 2, BRICK: 3, MORTAR: 4, WOOD: 5, WOODTOP: 6, STEEL: 7, FACE: 8,
  COAL: 9, EMBER: 10, HEARTH: 11, IRON: 12, HEAD: 13, HANDLE: 14, SOOT: 15, WATER: 16, BAND: 17, ASH: 18, SKY: 19, FRAME: 20,
};

export const PALETTE = [];
PALETTE[M.STONE] = { color: srgb(0x5d564f), jitter: 0.12, group: 0 };
PALETTE[M.GROUT] = { color: srgb(0x2a2622), jitter: 0.08, group: 0 };
PALETTE[M.BRICK] = { color: srgb(0x7a4130), jitter: 0.14, group: 0 };
PALETTE[M.MORTAR] = { color: srgb(0x4c4640), jitter: 0.08, group: 0 };
PALETTE[M.WOOD] = { color: srgb(0x5a3b22), jitter: 0.12, group: 0 };
PALETTE[M.WOODTOP] = { color: srgb(0x8a6440), jitter: 0.1, group: 0 };
PALETTE[M.STEEL] = { color: srgb(0x45474a), jitter: 0.1, group: 1 };
PALETTE[M.FACE] = { color: srgb(0x8a8c90), jitter: 0.05, group: 1 };
PALETTE[M.COAL] = { color: srgb(0x1a1412), jitter: 0.3, group: 0 };
PALETTE[M.EMBER] = { color: [1.0, 0.32, 0.06], jitter: 0.35, group: 2 };
PALETTE[M.HEARTH] = { color: srgb(0x48413b), jitter: 0.14, group: 0 };
PALETTE[M.IRON] = { color: srgb(0x2c2b2b), jitter: 0.06, group: 1 };
PALETTE[M.HEAD] = { color: srgb(0x55585c), jitter: 0.05, group: 1 };
PALETTE[M.HANDLE] = { color: srgb(0x9b7046), jitter: 0.08, group: 0 };
PALETTE[M.SOOT] = { color: srgb(0x2a2420), jitter: 0.14, group: 0 };
PALETTE[M.WATER] = { color: srgb(0x0f1a1e), jitter: 0.03, group: 1 };
PALETTE[M.BAND] = { color: srgb(0x26282a), jitter: 0.05, group: 1 };
PALETTE[M.ASH] = { color: srgb(0x6b625a), jitter: 0.2, group: 0 };
PALETTE[M.SKY] = { color: [0.3, 0.4, 0.55], jitter: 0.12, group: 3 };
PALETTE[M.FRAME] = { color: srgb(0x3a2a1c), jitter: 0.1, group: 0 };

// Per-voxel tints (multipliers) give the surfaces texture: per-brick variation, soot, rust and forge scale.
PALETTE[M.BRICK].tint = (x, y, z) => {
  const [bx, by] = brickId(x, y);
  const b = h2(bx * 7 + 3, by * 13 + 1);
  let c = [0.75 + 0.5 * b + 0.1 * h2(bx, by), 0.75 + 0.4 * b, 0.7 + 0.45 * b];
  const burnt = h2(bx + 91, by * 3) > 0.85; // over-fired dark bricks
  if (burnt) c = [c[0] * 0.55, c[1] * 0.5, c[2] * 0.55];
  c = mix3(c, [0.85, 0.9, 1.0], clamp01((fbm(x, y, z, 5) - 0.6) * 2) * 0.6); // efflorescence
  return mix3(c, SOOTC, soot(x, y, z) * 0.9);
};
PALETTE[M.MORTAR].tint = (x, y, z) => { const v = 0.8 + 0.4 * fbm(x, y, z, 4); return mix3([v, v, v], SOOTC, soot(x, y, z)); };
PALETTE[M.STONE].tint = (x, y, z) => {
  const t = h2(Math.floor(x / 9) * 5 + 1, Math.floor(z / 9) * 11 + 3);
  const v = 0.78 + 0.4 * t + 0.25 * (fbm(x, 0, z, 3) - 0.5);
  // charred ring of scale and ash round the anvil, soot near the forge
  const d = Math.hypot(x - 47, z - 42);
  const ring = clamp01(1 - Math.abs(d - 15) / 9) * fbm(x, 3, z, 4) * 1.1;
  const nearForge = clamp01(1 - Math.hypot(x - 18, z - 18) / 30) * 0.7;
  return mix3([v * 1.02, v, v * 0.96], [0.2, 0.18, 0.17], clamp01(ring + nearForge * fbm(x, 9, z, 6)));
};
PALETTE[M.HEARTH].tint = (x, y, z) => mix3([1, 1, 1], SOOTC, clamp01(fbm(x, y, z, 5) * 0.8 + (y > 12 ? 0.3 : 0)));
PALETTE[M.SOOT].tint = (x, y, z) => { const v = 0.7 + 0.7 * fbm(x, y, z, 4); return [v, v * 0.95, v * 0.9]; };
PALETTE[M.STEEL].tint = (x, y, z) => {
  const n = fbm(x, y, z, 5);
  let c = [1, 1, 1];
  c = mix3(c, [1.5, 0.95, 0.6], clamp01((n - 0.58) * 3));                 // rust bloom
  c = mix3(c, [0.45, 0.5, 0.62], clamp01((fbm(x + 40, y, z, 2.5) - 0.55) * 3)); // blue-black forge scale
  return c;
};
PALETTE[M.FACE].tint = (x, y, z) => {
  const wear = clamp01(1 - Math.abs(z + 0.5 - 40) / 6) * clamp01(1 - Math.abs(x - 46) / 18);
  const v = 0.65 + 0.5 * wear + 0.2 * (fbm(x, y, z, 2) - 0.5);
  return h3(x, y, z) > 0.93 ? [0.4, 0.42, 0.5] : [v, v, v * 1.03]; // scale flakes on the face
};
PALETTE[M.HEAD].tint = (x, y, z) => { const n = fbm(x, y, z, 3); return mix3([1, 1, 1], [0.5, 0.52, 0.6], clamp01((n - 0.5) * 2)); };
PALETTE[M.WOOD].tint = (x, y, z) => { const g = 0.8 + 0.35 * vn(x * 0.9, y * 0.12, z * 0.9) + 0.15 * Math.sin((x + z) * 1.3); return [g, g * 0.97, g * 0.92]; };
PALETTE[M.WOODTOP].tint = (x, y, z) => { const ch = clamp01(1 - Math.hypot(x - 47, z - 40) / 7); return mix3([1, 1, 1], [0.3, 0.25, 0.22], ch * 0.8 * fbm(x, y, z, 2)); };
PALETTE[M.HANDLE].tint = (x, y, z) => { const g = 0.85 + 0.3 * vn(x * 1.5, y * 1.5, z * 0.15); return [g, g, g]; };

function h3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
// smooth value noise (trilinear, smoothstep), 2 octaves
function vn(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => h3(xi + i, yi + j, zi + k);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), sx), L(c(0, 1, 0), c(1, 1, 0), sx), sy),
           L(L(c(0, 0, 1), c(1, 0, 1), sx), L(c(0, 1, 1), c(1, 1, 1), sx), sy), sz);
}
const fbm = (x, y, z, s) => 0.65 * vn(x / s, y / s, z / s) + 0.35 * vn(x / (s * 0.4) + 17, y / (s * 0.4) + 5, z / (s * 0.4) + 9);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// soot: heavy above the forge, creeping up the wall, patchy
function soot(x, y, z) {
  const forge = clamp01(1 - Math.abs(x - 18) / 26) * clamp01((y - 12) / 20);
  const high = clamp01((y - 34) / 30) * 0.5;
  const n = fbm(x, y, z, 9);
  return clamp01((forge * 1.2 + high) * (0.5 + n) + (n - 0.62) * 1.2);
}
const SOOTC = [0.22, 0.2, 0.19];
function brickId(x, y) { const row = Math.floor((y - 2) / 3); return [Math.floor((x + (row % 2) * 3) / 6), row]; }

function h2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Static forge world, 1 world unit per voxel.
export const WORLD = { NX: 140, NY: 64, NZ: 76 };
export const ANVIL_TOP = 29;
export const ANVIL_FACE = { x0: 26, x1: 64, z0: 35, z1: 45 };
export const FLOOR_Y = 2;
export const COALS = { x0: 9, x1: 27, z0: 7, z1: 19, y: 15 };

export function buildWorld() {
  const g = new Grid(WORLD.NX, WORLD.NY, WORLD.NZ);
  const { NX, NY, NZ } = WORLD;

  // floor: 9x9 flagstones with recessed grout
  for (let z = 0; z < NZ; z++)
    for (let x = 0; x < NX; x++) {
      const grout = x % 9 === 0 || z % 9 === 0;
      g.set(x, 0, z, M.GROUT);
      if (!grout) g.set(x, 1, z, M.STONE);
    }

  // back wall with recessed mortar, running bond
  for (let y = 2; y < NY; y++)
    for (let x = 0; x < NX; x++) {
      const row = Math.floor((y - 2) / 3);
      const mortarRow = (y - 2) % 3 === 2;
      const mortarCol = (x + (row % 2) * 3) % 6 === 5;
      for (let z = 0; z < 5; z++) {
        if (mortarRow || mortarCol) { if (z < 4) g.set(x, y, z, M.MORTAR); }
        else g.set(x, y, z, M.BRICK);
      }
      if (!mortarRow && !mortarCol) {
        const [bx, by] = brickId(x, y);
        if (h2(bx * 3 + 11, by * 7 + 2) < 0.1) g.set(x, y, 5, M.BRICK);      // proud brick
        if (h3(x, y, 4) < 0.07) g.set(x, y, 4, 0);                           // chipped face
      }
    }

  // forge hearth (left back) + coal bed + hood
  g.box(5, 2, 4, 31, 15, 23, M.HEARTH);
  g.box(COALS.x0, 13, COALS.z0, COALS.x1, 15, COALS.z1, 0); // bowl
  for (let z = COALS.z0; z < COALS.z1; z++)
    for (let x = COALS.x0; x < COALS.x1; x++) {
      const cx = (x - 18) / 9, cz = (z - 13) / 6;
      const r = Math.sqrt(cx * cx + cz * cz);
      const hot = h2(x, z) > 0.35 + r * 0.45;
      g.set(x, 13, z, M.COAL);
      g.set(x, 14, z, hot ? M.EMBER : M.COAL);
      if (h2(x + 7, z * 3) > 0.55 + r * 0.3) g.set(x, 15, z, hot && h2(z, x) > 0.4 ? M.EMBER : M.COAL);
    }
  // hearth lip
  g.box(5, 15, 4, 31, 16, 7, M.HEARTH);
  g.box(5, 15, 20, 31, 16, 23, M.HEARTH);
  // hood: tapering soot-black brick stack
  for (let y = 32; y < NY; y++) {
    const k = Math.min(1, (y - 32) / 14);
    const x0 = Math.round(4 + 7 * k), x1 = Math.round(32 - 7 * k);
    const z1 = Math.round(24 - 9 * k);
    for (let z = 4; z < z1; z++) for (let x = x0; x < x1; x++) {
      const edge = x === x0 || x === x1 - 1 || z === z1 - 1;
      if (edge || y === 32) g.set(x, y, z, (y % 3 === 0) ? M.MORTAR : M.SOOT);
    }
  }
  // soot staining on the wall above the coals
  for (let y = 16; y < 32; y++) for (let x = 5; x < 31; x++) if (g.get(x, y, 4) === M.BRICK && h2(x, y) < 0.6) g.set(x, y, 4, M.SOOT);

  // window (cool daylight) in the back wall, upper right
  const W0 = 72, W1 = 92, WY0 = 30, WY1 = 50;
  g.box(W0, WY0, 0, W1, WY1, 6, 0);
  for (let y = WY0; y < WY1; y++) for (let x = W0; x < W1; x++) {
    const frame = x === W0 || x === W1 - 1 || y === WY0 || y === WY1 - 1;
    const mull = x === (W0 + W1) / 2 || y === Math.floor((WY0 + WY1) / 2);
    if (frame || mull) { g.set(x, y, 1, M.FRAME); g.set(x, y, 2, M.FRAME); }
    else g.set(x, y, 0, M.SKY);
  }
  g.box(W0 - 1, WY0 - 1, 1, W1 + 1, WY0, 7, M.FRAME); // sill

  // tool rack on the wall: rail plus hanging tongs, hammers and a file
  g.box(36, 44, 5, 68, 46, 7, M.FRAME);
  const pegs = [39, 45, 51, 57, 63];
  pegs.forEach((px, i) => {
    g.set(px, 43, 6, M.IRON);
    if (i % 2 === 0) { // tongs: two reins + jaws
      g.box(px - 1, 26, 6, px, 43, 7, M.IRON); g.box(px + 1, 26, 6, px + 2, 43, 7, M.IRON);
      g.box(px - 1, 40, 6, px + 2, 42, 7, M.IRON);
    } else if (i === 1) { // hammer hanging head-down
      g.box(px, 30, 6, px + 1, 43, 7, M.HANDLE); g.box(px - 2, 26, 5, px + 3, 30, 8, M.HEAD);
    } else { // flatter / file
      g.box(px, 36, 6, px + 1, 43, 7, M.HANDLE); g.box(px - 1, 27, 6, px + 2, 36, 7, M.IRON);
    }
  });

  // stump
  const sx = 47, sz = 40;
  for (let y = 2; y < 15; y++)
    for (let z = sz - 11; z <= sz + 11; z++)
      for (let x = sx - 11; x <= sx + 11; x++) {
        const dx = x + 0.5 - sx, dz = z + 0.5 - sz;
        const r = Math.sqrt(dx * dx + dz * dz);
        const R = 10.2 + (y < 4 ? 0.8 : 0) + Math.sin(Math.atan2(dz, dx) * 5) * 0.4;
        if (r > R) continue;
        if (y === 14) g.set(x, y, z, Math.floor(r) % 3 === 0 ? M.WOOD : M.WOODTOP);
        else g.set(x, y, z, M.WOOD);
      }

  // anvil
  for (let z = 33; z < 47; z++) for (let x = 37; x < 59; x++) {
    const cz = z === 33 || z === 46, cx = x === 37 || x === 58;
    if (cz && cx) continue;
    g.set(x, 15, z, M.STEEL); g.set(x, 16, z, M.STEEL);
    if (!cz && !cx) g.set(x, 17, z, M.STEEL);
  }
  g.box(40, 18, 36, 56, 20, 44, M.STEEL);
  g.box(42, 20, 37, 54, 23, 43, M.STEEL);
  g.box(32, 23, 35, 64, 28, 45, M.STEEL);
  g.box(35, 22, 36, 61, 23, 44, M.STEEL);
  g.box(31, 28, 35, 64, 29, 45, M.FACE); g.box(30, 28, 35, 31, 29, 45, M.STEEL);      // hardened face plate
  g.box(26, 25, 36, 32, 28, 44, M.STEEL);      // heel
  g.box(26, 28, 36, 30, 29, 44, M.STEEL);
  g.box(32, 28, 39, 34, 29, 41, 0);            // hardy hole
  g.box(32, 27, 39, 34, 28, 41, 0);
  for (let x = 64; x < 80; x++) {              // horn
    const r = 4.6 * (1 - (x - 64) / 16) + 0.4;
    for (let y = 18; y < 29; y++) for (let z = 33; z < 47; z++) {
      const dy = y + 0.5 - 24.5, dz = z + 0.5 - 40;
      if (dy * dy + dz * dz < r * r && y + 0.5 < 29) g.set(x, y, z, M.STEEL);
    }
  }

  // quench barrel (right)
  const bx = 82, bz = 30;
  for (let y = 2; y < 16; y++) for (let z = bz - 8; z <= bz + 8; z++) for (let x = bx - 8; x <= bx + 8; x++) {
    const r = Math.hypot(x + 0.5 - bx, z + 0.5 - bz);
    if (r > 7.5) continue;
    if (r > 6.2) g.set(x, y, z, (y === 4 || y === 12) ? M.BAND : M.WOOD);
    else if (y === 14) g.set(x, y, z, M.WATER);
    else if (y < 14) g.set(x, y, z, M.WOOD);
  }

  // ash and scale scattered on the floor near the anvil
  for (let z = 20; z < 70; z++) for (let x = 20; x < 80; x++) {
    const d = Math.hypot(x - 47, z - 40);
    if (d < 12 || g.get(x, 2, z)) continue;
    if (h2(x * 3, z * 5) > 0.985 - Math.max(0, 0.04 - d * 0.001)) g.set(x, 2, z, M.ASH);
  }
  return g;
}

// Hammer: 0.5 world units per voxel.
export const HAMMER_VOXEL = 0.5;
export function buildHammer() {
  const g = new Grid(8, 12, 44);
  for (let y = 0; y < 12; y++) for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
    const ex = x === 0 || x === 7, ez = z === 0 || z === 7;
    if (ex && ez) continue;
    const band = y === 9;
    if (y === 11 && (ex || ez)) continue;
    g.set(x, y, z, band ? M.BAND : (y === 0 ? M.FACE : M.HEAD));
  }
  g.box(3, 5, 8, 5, 8, 44, M.HANDLE);
  g.box(3, 4, 8, 5, 5, 10, M.BAND); // wedge collar
  return g;
}
