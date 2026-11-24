// CPU mirrors of shader functions: terrain height (for the camera) and atmosphere (sun colour, sky ambient).
// Original work by CodePawl, 2026 (MIT).

// Integer hash, bit-exact with the GLSL version (Dave Hoskins, "Hash without Sine 2", MIT).
function hash12(x, y) {
  const qx = Math.imul(x | 0, 1597334673);
  const qy = Math.imul(y | 0, 3812015801 | 0);
  const n = Math.imul(qx ^ qy, 1597334673) >>> 0;
  return n / 4294967295;
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash12(ix, iy), b = hash12(ix + 1, iy), c = hash12(ix, iy + 1), d = hash12(ix + 1, iy + 1);
  const ab = a + (b - a) * ux, cd = c + (d - c) * ux;
  return (ab + (cd - ab) * uy) * 2 - 1;
}
function fbm3(x, y) {
  let s = 0, a = 0.5;
  for (let i = 0; i < 3; i++) {
    s += a * vnoise(x, y);
    // GLSL mat2(1.6,1.2,-1.2,1.6) is column-major: p' = (1.6x - 1.2y, 1.2x + 1.6y)
    const nx = 1.6 * x - 1.2 * y + 17, ny = 1.2 * x + 1.6 * y + 17;
    x = nx; y = ny; a *= 0.5;
  }
  return s;
}
const WX = 0.8660254, WY = 0.5;
const W2X = 0.4226183, W2Y = 0.9063078;
function profile(s) {
  const c = 0.72;
  if (s < c) { const x = s / c; return x * x * (1.6 - 0.6 * x); }
  const x = (s - c) / (1 - c);
  return (1 - x) * (1 - x);
}
const fract = (v) => v - Math.floor(v);

export function terrainHeight(px, pz) {
  const qx = px * WX + pz * WY;
  const qy = -px * WY + pz * WX;
  const ph = qx / 110 + 0.85 * vnoise(qx * 0.0035, qy * 0.009) + 0.22 * vnoise(qx * 0.021 + 4, qy * 0.021 + 4);
  const amp = 0.62 + 0.38 * vnoise(qx * 0.004 + 9, qy * 0.012 + 9);
  let h = 12.5 * amp * profile(fract(ph));
  const ph2 = (px * W2X + pz * W2Y) / 37 + 0.6 * vnoise(px * 0.027 + 7, pz * 0.027 + 7);
  h += 2.3 * (0.55 + 0.45 * vnoise(px * 0.011 + 2, pz * 0.011 + 2)) * profile(fract(ph2));
  h += 22 * fbm3(px * 0.0021 + 3, pz * 0.0021 + 3);
  return h;
}

// ------------------------------------------------------------------ atmosphere (same constants as shader)
const RP = 6371e3, RA = 6471e3;
const BR = [5.5e-6, 13.0e-6, 22.4e-6];
const BM = 21e-6, HR = 8e3, HM = 1.2e3, G = 0.76;

function sphereExit(o, d, r) {
  const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
  const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - r * r;
  const disc = b * b - c;
  return disc < 0 ? -1 : -b + Math.sqrt(disc);
}
function sphereEnter(o, d, r) {
  const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
  const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - r * r;
  const disc = b * b - c;
  return disc < 0 ? -1 : -b - Math.sqrt(disc);
}
const len = (v) => Math.hypot(v[0], v[1], v[2]);
function norm(v) { const l = len(v); return [v[0] / l, v[1] / l, v[2] / l]; }

function opticalDepth(p, d, steps) {
  const t = sphereExit(p, d, RA);
  const dl = t / steps;
  let r = 0, m = 0;
  for (let j = 0; j < steps; j++) {
    const s = dl * (j + 0.5);
    const h = len([p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s]) - RP;
    r += Math.exp(Math.min(-h / HR, 40)) * dl;
    m += Math.exp(Math.min(-h / HM, 40)) * dl;
  }
  return [r, m];
}

// transmittance from the ground toward the sun
export function sunTransmittance(sd) {
  const [r, m] = opticalDepth([0, RP + 2, 0], sd, 32);
  return BR.map((b) => Math.exp(-(b * r + BM * 1.1 * m)));
}

function atmosphere(rd, sd) {
  const ro = [0, RP + 2, 0];
  let tEnd = sphereExit(ro, rd, RA);
  const g = sphereEnter(ro, rd, RP);
  if (g > 0) tEnd = Math.min(tEnd, g);
  const N = 12, ds = tEnd / N;
  const sumR = [0, 0, 0], sumM = [0, 0, 0];
  let odR = 0, odM = 0;
  const mu = rd[0] * sd[0] + rd[1] * sd[1] + rd[2] * sd[2];
  const pR = (3 / (16 * Math.PI)) * (1 + mu * mu);
  const g2 = G * G;
  const pM = ((3 / (8 * Math.PI)) * ((1 - g2) * (1 + mu * mu))) / ((2 + g2) * Math.pow(1 + g2 - 2 * G * mu, 1.5));
  for (let i = 0; i < N; i++) {
    const s = ds * (i + 0.5);
    const p = [ro[0] + rd[0] * s, ro[1] + rd[1] * s, ro[2] + rd[2] * s];
    const h = len(p) - RP;
    const hr = Math.exp(-h / HR) * ds, hm = Math.exp(-h / HM) * ds;
    odR += hr; odM += hm;
    const [lR, lM] = opticalDepth(p, sd, 6);
    for (let k = 0; k < 3; k++) {
      const att = Math.exp(-(BR[k] * (odR + lR) + BM * 1.1 * (odM + lM)));
      sumR[k] += att * hr; sumM[k] += att * hm;
    }
  }
  return [0, 1, 2].map((k) => 22 * 2.5 * (sumR[k] * BR[k] * pR + sumM[k] * BM * pM));
}

// average sky radiance over the upper hemisphere (cosine-weighted, coarse)
export function skyRadiance(sd) {
  const acc = [0, 0, 0];
  let wsum = 0;
  const elevs = [0.08, 0.35, 0.7, 1.35];
  for (const e of elevs) {
    const az = e > 1.3 ? 1 : 6;
    for (let a = 0; a < az; a++) {
      const phi = (a / az) * Math.PI * 2;
      const d = norm([Math.cos(e) * Math.cos(phi), Math.sin(e), Math.cos(e) * Math.sin(phi)]);
      const c = atmosphere(d, sd);
      const w = Math.sin(e) * Math.cos(e) * (e > 1.3 ? 6 : 1);
      acc[0] += c[0] * w; acc[1] += c[1] * w; acc[2] += c[2] * w; wsum += w;
    }
  }
  return acc.map((v) => v / wsum);
}
