// Small deterministic noise and random helpers shared by every module.

function hashInteger(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function smoothCurve(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Value noise in [-1, 1].
export function valueNoise(x, y, seed = 0) {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const fracX = smoothCurve(x - cellX);
  const fracY = smoothCurve(y - cellY);
  const a = hashInteger(cellX, cellY, seed);
  const b = hashInteger(cellX + 1, cellY, seed);
  const c = hashInteger(cellX, cellY + 1, seed);
  const d = hashInteger(cellX + 1, cellY + 1, seed);
  const top = a + (b - a) * fracX;
  const bottom = c + (d - c) * fracX;
  return (top + (bottom - top) * fracY) * 2 - 1;
}

export function fractalNoise(x, y, octaves = 4, seed = 0) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise(x * frequency, y * frequency, seed + octave * 17) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / norm;
}

export function smoothstep(edge0, edge1, value) {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

export function smootherstep(value) {
  const t = Math.min(Math.max(value, 0), 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

// Mulberry32: tiny seeded generator, state is one integer so it can live inside the simulation.
export function createRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
