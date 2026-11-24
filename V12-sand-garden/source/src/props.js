// Voxel props: rocks, earthen wall, trees, rake (original code).
import * as THREE from 'three';
import { Volume, meshVolume } from './voxmesh.js';
import { hash2, hash3, noise2, noise3, fbm3 } from './noise.js';
import { S, B, NX, NZ, ROCKS, RAKE_HALF, xOf, zOf, lin } from './garden.js';

function setLin(vol, x, y, z, r, g, b) {
  const c = lin(Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b)));
  vol.set(x, y, z, c[0], c[1], c[2]);
}

export function buildRock(rock, garden) {
  const pad = 3;
  const R = rock.r + pad;
  const nx = R * 2, nz = R * 2, ny = B + rock.h + 4;
  const vol = new Volume(nx, ny, nz);
  const i0 = rock.i - R, j0 = rock.j - R;
  const sd = rock.seed;
  const tilt = (hash2(sd, 1, 77) - 0.5) * 0.6;
  const p = 2.6;
  const base = B - 3;
  const tone = 0.56 + hash2(sd, 2, 77) * 0.1;
  const warm = hash2(sd, 3, 77) * 0.05;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const qx = (x + 0.5 - R) / rock.r, qz = (z + 0.5 - R) / (rock.r * (0.75 + hash2(sd, 4, 77) * 0.4));
    let qy = (y + 0.5 - base) / (rock.h + 3);
    qy -= (qx * tilt);
    if (qy < -1) continue;
    const nn = fbm3(x * 0.16 + sd * 10, y * 0.16, z * 0.16, sd, 3);
    const d = Math.pow(Math.abs(qx), p) + Math.pow(Math.abs(Math.max(qy, 0)), p * 0.8) + Math.pow(Math.abs(qz), p);
    if (d > 1.0 - (nn - 0.5) * 0.9) continue;
    // granite: strata, speckle, grime near the sand, moss and lichen on top surfaces
    const strata = noise2(y * 0.35 + qx * 1.5, sd, 5);
    let v = tone + (strata - 0.5) * 0.12 + (hash3(x, y, z + sd * 999) - 0.5) * 0.1;
    let r = v + warm, g = v * 0.98, b = v * 0.94 - warm * 0.5;
    if (hash3(x + 7, y, z + sd * 31) > 0.93) { r *= 1.35; g *= 1.33; b *= 1.3; }
    if (hash3(x, y + 3, z + sd * 17) > 0.95) { r *= 0.55; g *= 0.55; b *= 0.55; }
    const grime = Math.max(0, 1 - (y - B) / 5);
    r *= 1 - grime * 0.35; g *= 1 - grime * 0.33; b *= 1 - grime * 0.3;
    vol.set(x, y, z, 0, 0, 0);
    vol.c[vol.idx(x, y, z) * 3] = r; // temp store (sRGB) until surface pass
    vol.c[vol.idx(x, y, z) * 3 + 1] = g;
    vol.c[vol.idx(x, y, z) * 3 + 2] = b;
  }
  // surface pass: moss on up-facing voxels, lichen, then convert to linear
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (!vol.get(x, y, z)) continue;
    const k = vol.idx(x, y, z) * 3;
    let r = vol.c[k], g = vol.c[k + 1], b = vol.c[k + 2];
    const open = !vol.get(x, y + 1, z);
    const mossN = noise3(x * 0.25, y * 0.25, z * 0.25, sd + 40);
    if (open && y > B + 1 && mossN > 0.6) {
      const m = 0.7 + hash3(x, y, z) * 0.5;
      r = 0.22 * m; g = 0.34 * m; b = 0.11 * m;
      if (mossN > 0.72) { r = 0.36 * m; g = 0.42 * m; b = 0.15 * m; }
    } else if (hash3(x * 3, y, z + sd) > 0.975 && y > B + 2) {
      r = 0.72; g = 0.62; b = 0.36; // lichen
    } else if (!open && y > B + 2 && mossN > 0.62) {
      r *= 0.8; g *= 0.85; b *= 0.75; // green stain running down
    }
    const c = lin(Math.min(r, 1), Math.min(g, 1), Math.min(b, 1));
    vol.c[k] = c[0]; vol.c[k + 1] = c[1]; vol.c[k + 2] = c[2];
  }
  const origin = new THREE.Vector3(xOf(i0), 0, zOf(j0));
  return meshVolume(vol, S, origin, (x, y, z) => y + 1 <= garden.H(i0 + x, j0 + z));
}

export function buildWall() {
  const j0 = 24, nz = 10, ny = B + 2 + 34;
  const i0 = -24, nx = NX + 48;
  const vol = new Volume(nx, ny, nz);
  const top = B + 2 + 28;
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
    const inWall = z >= 2 && z < 8 && y < top;
    // tiled cap: base course + alternating ridge tiles
    const capBase = y >= top && y < top + 2 && z >= 0 && z < nz;
    const ridge = y === top + 2 && z >= 2 && z < 8 && (x % 4 !== 3);
    const ridge2 = y === top + 3 && z >= 3 && z < 7 && (x % 4 === 1 || x % 4 === 2);
    if (inWall) {
      // weathered clay plaster: drip streaks under the cap, splash grime at the foot, spalled patches
      const n = noise2(x * 0.06, y * 0.05, 31);
      const streak = noise2(x * 0.45, y * 0.02, 32);
      let v = 0.78 + (hash3(x, y, z) - 0.5) * 0.08 + (n - 0.5) * 0.12;
      let r = 0.80 * v, g = 0.66 * v, b = 0.48 * v;
      const drip = Math.max(0, streak - 0.6) * 1.6 * Math.max(0, (y - (top - 16)) / 16);
      r *= 1 - drip * 0.45; g *= 1 - drip * 0.45; b *= 1 - drip * 0.4;
      const foot = Math.max(0, 1 - (y - (B + 2)) / 7);
      r *= 1 - foot * 0.35; g *= 1 - foot * 0.36; b *= 1 - foot * 0.33;
      if (y > top - 2 && z >= 2) { r *= 0.85; g *= 0.85; b *= 0.85; }
      // horizontal timber band at the foot
      if (y >= B + 2 && y < B + 4) { const w = 0.28 + hash3(x, y, 2) * 0.06; r = w; g = w * 0.8; b = w * 0.62; }
      setLin(vol, x, y, z, r, g, b);
    } else if (capBase || ridge || ridge2) {
      const v = 0.26 + (hash3(x, y, z) - 0.5) * 0.05 + (noise2(x * 0.1, z, 34) - 0.5) * 0.08;
      const lichen = hash3(x, y + 1, z) > 0.96;
      if (lichen) setLin(vol, x, y, z, 0.5, 0.5, 0.36);
      else setLin(vol, x, y, z, v, v * 1.02, v * 1.08);
    }
  }
  return meshVolume(vol, S, new THREE.Vector3(xOf(i0), 0, zOf(j0)), (x, y, z, f) => f === 3 || f === 5);
}

export function buildTree(seed, kind) {
  const s = S * 2.5;
  const R = kind === 'maple' ? 15 : 12;
  const trunkH = kind === 'maple' ? 18 : 24;
  const n = R * 2 + 4, ny = trunkH + R * 2 + 4;
  const vol = new Volume(n, ny, n);
  const c = n / 2;
  for (let y = 0; y < trunkH + 4; y++) {
    const off = Math.round(Math.sin(y * 0.2 + seed) * 1.2);
    for (let a = -1; a <= 0; a++) for (let b = -1; b <= 0; b++) {
      const v = 0.22 + hash3(a, y, b + seed) * 0.08;
      setLin(vol, c + a + off, y, c + b, v, v * 0.82, v * 0.7);
    }
  }
  for (let z = 0; z < n; z++) for (let y = trunkH - 4; y < ny; y++) for (let x = 0; x < n; x++) {
    const dx = (x + 0.5 - c) / R, dy = (y + 0.5 - (trunkH + R * 0.7)) / (R * 0.8), dz = (z + 0.5 - c) / R;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const nn = fbm3(x * 0.18, y * 0.18, z * 0.18, seed, 3);
    if (d > 0.75 + (nn - 0.5) * 0.9) continue;
    if (hash3(x, y, z + seed * 101) > 0.86) continue; // gappy foliage
    const h = hash3(x + 3, y, z + seed);
    const shade = 0.7 + 0.3 * Math.min(1, Math.max(0, dy + 0.6));
    if (kind === 'maple') setLin(vol, x, y, z, (0.62 + h * 0.25) * shade, (0.18 + h * 0.18) * shade, 0.08 * shade);
    else setLin(vol, x, y, z, (0.14 + h * 0.06) * shade, (0.24 + h * 0.08) * shade, (0.12 + h * 0.03) * shade);
  }
  return { geo: meshVolume(vol, s, new THREE.Vector3(-c * s, 0, -c * s)), size: s };
}

// rake built at half-voxel resolution; local +z = travel direction, local x = lateral, pivot at tine tips
export function buildRake() {
  const s = S / 2;
  const W = RAKE_HALF * 4 + 2; // 34
  const vol = new Volume(W, 66, 76);
  const cx = W / 2; // 17
  const wood = (x, y, z, dark = 1) => {
    const g = noise2(z * 0.6 + y * 0.6, x * 2.0, 51);
    const v = (0.5 + g * 0.22 + (hash3(x, y, z) - 0.5) * 0.08) * dark;
    setLin(vol, x, y, z, v * 0.86, v * 0.64, v * 0.42);
  };
  // head bar
  for (let x = 0; x < W; x++) for (let y = 6; y < 9; y++) for (let z = 0; z < 3; z++) {
    const worn = (y === 6 ? 0.82 : 1) * (x < 2 || x >= W - 2 ? 0.8 : 1);
    wood(x, y, z, worn);
  }
  // tines (bamboo pegs) at grooves u = -6,-2,2,6 cells
  for (const u of [-6, -2, 2, 6]) {
    const tx = cx + u * 2 - 1;
    for (let y = 0; y < 6; y++) for (let a = 0; a < 2; a++) {
      const sandy = y < 2 ? 0.75 : 1;
      const v = (0.7 + hash3(tx + a, y, 9) * 0.1) * sandy;
      setLin(vol, tx + a, y, 1, v * 0.9, v * 0.8, v * 0.55);
    }
  }
  // handle: stepped voxel line rising toward travel direction
  for (let t = 0; t < 72; t++) {
    const z = 2 + t, y = 8 + Math.floor(t * 0.78);
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      if (!vol.inside(cx - 1 + a, y + b, z)) continue;
      const grip = t > 58 ? 0.7 : 1;
      wood(cx - 1 + a, y + b, z, grip);
    }
  }
  // rope binding at the joint
  for (let x = cx - 2; x <= cx + 1; x++) for (let y = 8; y < 11; y++) {
    const v = 0.35 + hash3(x, y, 3) * 0.08;
    setLin(vol, x, y, 3, v, v * 0.9, v * 0.75);
  }
  return meshVolume(vol, s, new THREE.Vector3(-cx * s, 0, -1.5 * s));
}

export { NZ };
