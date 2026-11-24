// Incandescence ramp for hot steel, deg C -> linear RGB (already multiplied by intensity).
// Hand-tuned to the blacksmith colour chart: dull red ~600, cherry ~750, orange ~1000, yellow ~1150, white ~1350+.
const STOPS = [
  [450, 0.0, 0.0, 0.0],
  [520, 0.5, 0.03, 0.0],
  [650, 0.85, 0.07, 0.01],
  [800, 1.0, 0.18, 0.03],
  [950, 1.0, 0.33, 0.06],
  [1100, 1.0, 0.46, 0.1],
  [1250, 1.0, 0.6, 0.18],
  [1400, 1.0, 0.72, 0.32],
  [1600, 1.0, 0.85, 0.55],
];

// Kept moderate at the top end so white-hot steel stays yellow-white with detail instead of clipping.
export function heatIntensity(T) {
  if (T <= 450) return 0;
  const k = Math.min(1.2, (T - 450) / 950);
  const fadeIn = Math.min(1, (T - 450) / 60);
  return fadeIn * (0.2 + 0.5 * Math.pow(k, 1.4));
}

export function heatColor(T, out) {
  let r = 0, g = 0, b = 0;
  if (T > STOPS[0][0]) {
    let i = 1;
    while (i < STOPS.length - 1 && T > STOPS[i][0]) i++;
    const a = STOPS[i - 1], c = STOPS[i];
    const t = Math.min(1, (T - a[0]) / (c[0] - a[0]));
    r = a[1] + (c[1] - a[1]) * t; g = a[2] + (c[2] - a[2]) * t; b = a[3] + (c[3] - a[3]) * t;
  }
  const I = heatIntensity(T);
  out[0] = r * I; out[1] = g * I; out[2] = b * I;
  return out;
}

// Small seeded PRNG (mulberry32) so capture runs are deterministic.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
