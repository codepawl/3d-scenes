// Small deterministic integer-hash value noise (original). Used for terrain generation and textures.

export function hash3(x, y, z) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1440670441)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);

export function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
  const l = (a, b, t) => a + (b - a) * t;
  const c000 = hash3(ix, iy, iz), c100 = hash3(ix + 1, iy, iz);
  const c010 = hash3(ix, iy + 1, iz), c110 = hash3(ix + 1, iy + 1, iz);
  const c001 = hash3(ix, iy, iz + 1), c101 = hash3(ix + 1, iy, iz + 1);
  const c011 = hash3(ix, iy + 1, iz + 1), c111 = hash3(ix + 1, iy + 1, iz + 1);
  return l(l(l(c000, c100, fx), l(c010, c110, fx), fy), l(l(c001, c101, fx), l(c011, c111, fx), fy), fz);
}

export function fbm3(x, y, z, oct = 4) {
  let a = 0.5, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise3(x, y, z);
    n += a;
    x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5;
  }
  return s / n;
}

// Seeded PRNG (mulberry32 style mixing).
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
