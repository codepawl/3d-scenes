// Voxel world: the grid is the source of truth. mat[i] = 0 air, 1 rock, 2 gravel bed.
import { noise3, fbm3, hash3 } from './noise.js';

export const NX = 48, NY = 48, NZ = 64;
export const LAYER = NX * NZ;
export const N = NX * NY * NZ;
export const idx = (x, y, z) => x + NX * z + LAYER * y;

export const F = [33, 26, 19];      // channel bed height for each terrace
export const LIP = [12, 21, 30];    // z where each terrace ends (lip edge)
export const CH = [24, 22, 25];     // channel centre x per terrace
export const POOL_LEVEL = 9;        // first air layer above pool rim
export const SKY = { x: 23.5, z: 39.5, r: 4.2 };

function terraceFloor(i, x, z) {
  const d = Math.abs(x - CH[i]);
  const half = 4.5 + 0.8 * (noise3(z * 0.3, i * 7.1, 2.0) - 0.5);
  if (d <= half) return F[i];
  return Math.floor(F[i] + 1.4 + Math.min(4, (d - half) * 0.3) + 2.0 * fbm3(x * 0.25, i * 3.3, z * 0.25, 3));
}

function poolFloor(x, z) {
  const dx = (x - 24) / 14.5, dz = (z - 39) / 12;
  const d2 = dx * dx + dz * dz;
  const n = fbm3(x * 0.2, 5.5, z * 0.2, 3);
  if (d2 < 1) return Math.floor(3 + 7.2 * d2 * d2 + 1.6 * n);
  let f = 9.2 + 2.0 * n + Math.max(0, d2 - 1.3) * 3;
  if (z > 54) f += (z - 54) * 0.3;
  return Math.floor(f);
}

// Floor height (top solid y) of the region that owns column (x,z), with undercut handling.
function floorAt(x, y, z) {
  for (let i = 0; i < 3; i++) {
    if (z < LIP[i]) {
      // undercut: two-voxel-thick lip slab, recessed riser below it
      if (z >= LIP[i] - 2 && y < F[i] - 2) {
        return i < 2 ? terraceFloor(i + 1, x, z) : poolFloor(x, z);
      }
      return terraceFloor(i, x, z);
    }
  }
  return poolFloor(x, z);
}

export function buildWorld() {
  const mat = new Uint8Array(N).fill(1);
  const sink = new Uint8Array(N);
  const sources = [];

  for (let z = 1; z < NZ - 1; z++) {
    const cx = 24 + 2.2 * Math.sin(z * 0.12);
    for (let x = 2; x < NX - 2; x++) {
      // stalactites: tapered columns hanging from the ceiling
      let st = 0;
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        const h = hash3(x + ox, 91, z + oz);
        if (h < 0.06) {
          const len = 2 + hash3(x + ox, 17, z + oz) * 9;
          st = Math.max(st, ox === 0 && oz === 0 ? len : len * 0.45);
        }
      }
      const skyD = Math.hypot(x - SKY.x, z - SKY.z);
      const skyHole = skyD < SKY.r + 1.5 * (noise3(x * 0.4, 3, z * 0.4) - 0.5);
      for (let y = 1; y < NY - 1; y++) {
        let air = false;
        if (z < 6) {
          // back tunnel the river enters through (opens to daylight at z = 0)
          const d = Math.abs(x - CH[0]);
          const half = 5.5 + 1.2 * (noise3(y * 0.3, z * 0.3, 1) - 0.5);
          const fl = d <= 4.5 ? F[0] : F[0] + 2;
          air = d < half && y > fl && y < F[0] + 9 + 2 * noise3(x * 0.3, 4, z * 0.3);
        } else {
          const wn = 2 * (fbm3(x * 0.11, y * 0.11, z * 0.11, 3) - 0.5);
          let halfW = 16.5 + 5 * wn - Math.max(0, z - 56) * 0.5;
          const fl = floorAt(x, y, z);
          let ceil = 45 - Math.pow((x - cx) / 18, 2) * 9 + 3 * (noise3(x * 0.2, 40, z * 0.2) - 0.5)
            - Math.max(0, z - 44) * 0.7 - st;
          if (z < 9) ceil = Math.min(ceil, F[0] + 10 + (z - 6) * 1.5);
          if (skyHole) ceil = NY + 5;
          air = Math.abs(x - cx) < halfW && y > fl && y < ceil;
        }
        if (air) mat[idx(x, y, z)] = 0;
      }
    }
  }
  // back tunnel open to the outside at z = 0
  for (let x = 2; x < NX - 2; x++) for (let y = 1; y < NY - 1; y++) {
    if (mat[idx(x, y, 1)] === 0) mat[idx(x, y, 0)] = 0;
  }
  // skylight: open the hole all the way through the top layer
  for (let z = 1; z < NZ - 1; z++) for (let x = 2; x < NX - 2; x++) {
    if (mat[idx(x, NY - 2, z)] === 0) mat[idx(x, NY - 1, z)] = 0;
  }
  // outflow tunnel through the right wall; water leaving the grid is removed (sink)
  for (let z = 44; z <= 48; z++) for (let x = 30; x < NX; x++) for (let y = POOL_LEVEL; y <= 12; y++) {
    if (x > 30 + (z === 44 || z === 48 ? 2 : 0)) mat[idx(x, y, z)] = 0;
    if (x >= NX - 2) sink[idx(x, y, z)] = 1;
  }
  // gravel on the pool bed
  for (let z = LIP[2] - 2; z < NZ - 1; z++) for (let x = 0; x < NX; x++) for (let y = 1; y < POOL_LEVEL; y++) {
    const i = idx(x, y, z);
    if (mat[i] === 1 && mat[i + LAYER] === 0) { mat[i] = 2; if (y > 1 && hash3(x, y, z) < 0.7) mat[i - LAYER] = 2; }
  }
  // water source: inside the back tunnel, on the channel bed
  for (let z = 0; z <= 1; z++) for (let x = CH[0] - 4; x <= CH[0] + 4; x++) for (let y = F[0] + 1; y <= F[0] + 2; y++) {
    const i = idx(x, y, z);
    if (mat[i] === 0) sources.push(i);
  }
  const bias = new Float32Array(N);
  for (let z = 0; z < LIP[2]; z++) for (let x = 0; x < NX; x++) for (let y = F[2]; y < NY - 1; y++) {
    const i = idx(x, y, z);
    if (mat[i] === 0) bias[i] = 0.12;
  }
  // level regulator: gentle surface drain over the far part of the pool (stands in for seepage)
  const drain = new Float32Array(N);
  for (let z = LIP[2] + 5; z < NZ - 1; z++) for (let x = 0; x < NX; x++) for (let y = POOL_LEVEL; y < POOL_LEVEL + 4; y++) {
    const i = idx(x, y, z);
    if (mat[i] === 0) drain[i] = y === POOL_LEVEL ? 0.02 : 0.08;
  }
  return { mat, sink, sources, bias, drain };
}

// Pre-fill the pool so warm-up is short.
export function prefill(mat, mass) {
  for (let z = LIP[2] - 3; z < NZ - 1; z++) for (let x = 0; x < NX; x++) for (let y = 1; y < POOL_LEVEL; y++) {
    const i = idx(x, y, z);
    if (mat[i] === 0) mass[i] = 1;
  }
}
