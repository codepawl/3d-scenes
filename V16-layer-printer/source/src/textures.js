// Procedural canvas textures: tileable value-noise fBm, scratches, grime. All original.
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash2(x, y, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// tileable value noise, period px x py lattice cells
function vnoise(x, y, px, py, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py;
  const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(u, v, fx, fy, oct, seed) {
  let s = 0, amp = 0.5, n = 0;
  for (let o = 0; o < oct; o++) {
    const f = 1 << o;
    s += amp * vnoise(u * fx * f, v * fy * f, fx * f, fy * f, seed + o * 13);
    n += amp; amp *= 0.5;
  }
  return s / n;
}

function canvasPair(N) {
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
  return [mk(), mk()];
}
function toTex(canvas, srgb, rep = 1) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep, rep);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function fillPixels(canvas, fn) {
  const N = canvas.width, ctx = canvas.getContext('2d');
  const img = ctx.createImageData(N, N), d = img.data;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const [r, g, b] = fn(x / N, y / N, x, y);
      const o = (y * N + x) * 4;
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return ctx;
}
const c255 = (v) => Math.max(0, Math.min(255, v * 255));

function scratches(ctx, N, count, seed, color, maxLen, width) {
  const r = rng(seed);
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = r() * N, y = r() * N, a = r() * Math.PI * 2, L = (0.2 + r()) * maxLen;
    ctx.strokeStyle = color.replace('A', (0.05 + r() * 0.18).toFixed(3));
    ctx.lineWidth = width * (0.5 + r());
    ctx.beginPath(); ctx.moveTo(x, y);
    const bend = (r() - 0.5) * 0.4;
    ctx.quadraticCurveTo(x + Math.cos(a + bend) * L * 0.5, y + Math.sin(a + bend) * L * 0.5, x + Math.cos(a) * L, y + Math.sin(a) * L);
    ctx.stroke();
  }
}

// Textured PEI spring-steel sheet: bronze powder coat, speckle, polished wear patch, scratches, smudges.
export function bedTextures() {
  const N = 1024, [col, rough] = canvasPair(N);
  const R = rng(7);
  const wear = (u, v) => {
    const du = (u - 0.5) / 0.28, dv = (v - 0.5) / 0.28;
    const n = fbm(u, v, 6, 6, 4, 91);
    return Math.max(0, Math.min(1, 1.4 - Math.hypot(du, dv) + (n - 0.5) * 0.9));
  };
  const grime = (u, v) => Math.max(0, fbm(u, v, 5, 5, 5, 33) - 0.6) * 3.0;
  const cache = new Float32Array(N * N * 3);
  fillPixels(col, (u, v, x, y) => {
    const sp = R(), w = wear(u, v), g = Math.min(1, grime(u, v)), n = fbm(u, v, 24, 24, 3, 5);
    let k = 0.78 + 0.32 * sp * sp + 0.14 * (n - 0.5);
    k *= 1 + 0.12 * w;
    let r = 0.52 * k, gg = 0.38 * k, b = 0.18 * k;
    r *= 1 - 0.4 * g; gg *= 1 - 0.4 * g; b *= 1 - 0.35 * g;
    const o = (y * N + x) * 3; cache[o] = sp; cache[o + 1] = w; cache[o + 2] = g;
    return [c255(r), c255(gg), c255(b)];
  });
  const cctx = col.getContext('2d');
  scratches(cctx, N, 260, 11, 'rgba(235,215,170,A)', 90, 1.1);
  scratches(cctx, N, 90, 12, 'rgba(20,14,8,A)', 60, 1.5);
  // edge of build area: faint ghost of previous brims
  cctx.strokeStyle = 'rgba(30,22,12,0.18)'; cctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) { cctx.beginPath(); cctx.arc(N / 2 + 9 * i, N / 2 - 6 * i, 190 + i * 24, 0, Math.PI * 2); cctx.stroke(); }
  fillPixels(rough, (u, v, x, y) => {
    const o = (y * N + x) * 3, sp = cache[o], w = cache[o + 1], g = cache[o + 2];
    const r = 0.78 - 0.25 * sp - 0.3 * w + 0.15 * g;
    return [0, c255(r), 0];
  });
  scratches(rough.getContext('2d'), N, 260, 11, 'rgba(0,40,0,A)', 90, 1.1);
  return { map: toTex(col, true), roughnessMap: toTex(rough, false) };
}

// Brushed aluminium (grey, multiplied by material colour for anodised parts).
export function brushedTextures() {
  const N = 512, [col, rough] = canvasPair(N);
  const R = rng(3);
  const cache = new Float32Array(N * N);
  fillPixels(col, (u, v, x, y) => {
    const s = fbm(u, v, 2, 96, 3, 21), n = fbm(u, v, 4, 4, 4, 8), sp = R();
    const smudge = Math.max(0, fbm(u, v, 3, 3, 4, 44) - 0.55) * 3;
    const k = (0.72 + 0.3 * s + 0.1 * (n - 0.5) + 0.04 * sp) * (1 - 0.35 * smudge);
    cache[y * N + x] = s * 0.6 + smudge * 0.6;
    return [c255(k), c255(k), c255(k * 1.02)];
  });
  scratches(col.getContext('2d'), N, 120, 4, 'rgba(255,255,255,A)', 50, 0.8);
  fillPixels(rough, (u, v, x, y) => [0, c255(0.3 + 0.35 * cache[y * N + x]), 0]);
  return { map: toTex(col, true), roughnessMap: toTex(rough, false) };
}

// Worn workbench top: sealed concrete/MDF mix with stains, chips, filament dust.
export function benchTextures() {
  const N = 1024, [col, rough] = canvasPair(N);
  const R = rng(19);
  const cache = new Float32Array(N * N);
  fillPixels(col, (u, v, x, y) => {
    const n = fbm(u, v, 4, 4, 6, 2), st = Math.max(0, fbm(u, v, 3, 3, 5, 77) - 0.5) * 2.5;
    const sp = R(), pore = sp > 0.985 ? 0.55 : 1;
    const k = (0.36 + 0.22 * n) * pore * (1 - 0.45 * st);
    cache[y * N + x] = st;
    return [c255(k * 0.93), c255(k * 0.95), c255(k)];
  });
  const ctx = col.getContext('2d');
  scratches(ctx, N, 300, 5, 'rgba(200,200,190,A)', 120, 1.2);
  // stray filament scraps
  const r = rng(55);
  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = ['rgba(201,86,28,0.55)', 'rgba(220,220,215,0.5)', 'rgba(30,90,140,0.5)'][i % 3];
    ctx.lineWidth = 2.2;
    const x = r() * N, y = r() * N;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + (r() - 0.5) * 80, y + (r() - 0.5) * 80, x + (r() - 0.5) * 80, y + (r() - 0.5) * 80, x + (r() - 0.5) * 60, y + (r() - 0.5) * 60);
    ctx.stroke();
  }
  fillPixels(rough, (u, v, x, y) => [0, c255(0.85 - 0.35 * cache[y * N + x]), 0]);
  return { map: toTex(col, true, 3), roughnessMap: toTex(rough, false, 3) };
}

// Fine grain for moulded plastic parts.
export function grainTextures() {
  const N = 256, [col, rough] = canvasPair(N);
  const R = rng(81);
  const cache = new Float32Array(N * N);
  fillPixels(col, (u, v, x, y) => {
    const n = fbm(u, v, 8, 8, 4, 61), sp = R();
    const k = 0.8 + 0.2 * n + 0.08 * (sp - 0.5);
    cache[y * N + x] = n;
    return [c255(k), c255(k), c255(k)];
  });
  fillPixels(rough, (u, v, x, y) => [0, c255(0.55 + 0.3 * cache[y * N + x]), 0]);
  return { map: toTex(col, true), roughnessMap: toTex(rough, false) };
}
