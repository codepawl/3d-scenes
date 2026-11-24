// CPU-generated tileable rock textures (original): fbm value noise + cellular cracks.
import * as THREE from 'three';
import { hash3 } from './noise.js';

const S = 256;

function tileNoise(x, y, period, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const w = (a) => ((a % period) + period) % period;
  const a = hash3(w(ix), w(iy), seed), b = hash3(w(ix + 1), w(iy), seed);
  const c = hash3(w(ix), w(iy + 1), seed), d = hash3(w(ix + 1), w(iy + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function tileFbm(x, y, basePeriod, seed, oct) {
  let s = 0, amp = 0.5, n = 0, p = basePeriod;
  for (let o = 0; o < oct; o++) {
    s += amp * tileNoise(x * p, y * p, p, seed + o * 13);
    n += amp; amp *= 0.5; p *= 2;
  }
  return s / n;
}

// F2 - F1 cellular distance on a wrapping grid -> crack lines
function cracks(x, y, cells, seed) {
  const gx = x * cells, gy = y * cells;
  const ix = Math.floor(gx), iy = Math.floor(gy);
  let f1 = 9, f2 = 9;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cx = ix + ox, cy = iy + oy;
    const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells;
    const px = cx + hash3(wx, wy, seed), py = cy + hash3(wx, wy, seed + 1);
    const d = Math.hypot(px - gx, py - gy);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return f2 - f1;
}

export function makeRockTextures(maxAniso) {
  const alb = new Uint8Array(S * S * 4);
  const rh = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = i / S, y = j / S;
    const n = tileFbm(x, y, 4, 1, 6);
    const fine = tileFbm(x, y, 32, 7, 3);
    const cr = cracks(x, y, 5, 3);
    const crSmall = cracks(x, y, 17, 9);
    const crack = Math.max(1 - Math.min(1, cr / 0.035), 0.5 * (1 - Math.min(1, crSmall / 0.025))) * (0.4 + 0.9 * tileFbm(x, y, 3, 41, 3));
    const pits = fine > 0.68 ? (fine - 0.68) * 3 : 0;
    let h = 0.55 * n + 0.25 * fine - 0.45 * crack - 0.3 * pits;
    h = Math.max(0, Math.min(1, h + 0.2));
    let lum = 0.74 + 0.55 * (n - 0.5) + 0.3 * (fine - 0.5) - 0.16 * crack - 0.2 * pits;
    const speck = hash3(i, j, 77) > 0.985 ? 0.25 : 0;
    lum = Math.max(0.05, Math.min(1, lum + speck));
    const warm = tileFbm(x, y, 2, 21, 3) - 0.5;
    const o = (j * S + i) * 4;
    alb[o] = Math.min(255, 255 * lum * (1 + 0.18 * warm));
    alb[o + 1] = Math.min(255, 255 * lum);
    alb[o + 2] = Math.min(255, 255 * lum * (1 - 0.15 * warm));
    alb[o + 3] = 255;
    const rough = 0.62 + 0.3 * (fine - 0.5) + 0.25 * crack + 0.15 * (n - 0.5);
    rh[o] = 255 * h;
    rh[o + 1] = 255 * Math.max(0.2, Math.min(1, rough));
    rh[o + 2] = 0; rh[o + 3] = 255;
  }
  const mk = (data, srgb) => {
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = maxAniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { albedo: mk(alb, true), rh: mk(rh, false) };
}
