// The hillside as math: one elevation field, cut into terraces that follow its contours.
// Everything else (mesh, water basins, rice rows, houses) samples these functions, so they always agree.
import { fractalNoise, smoothstep, smootherstep, clamp } from './noise.js';

export const BLOCK = { halfX: 45, halfZ: 42, bottomY: -11 };
export const TERRACE = {
  count: 10,
  step: 1.75, // height of one riser in metres
  riserFraction: 0.14, // share of each contour band taken by the riser (about 1 m of run for a 1.75 m rise)
  bundHeight: 0.75,
  bundWidth: 0.9,
  notchHeight: 0.3,
  edgeRimHeight: 0.7,
};
const TOP_LEVEL_HEIGHT = TERRACE.count * TERRACE.step;
const FOREST_RISE = 1.1;

const SLOPE = 0.25;
const BOWL = 0.0028;

const STREAM = { baseX: -9, swing: 3.2, frequency: 0.11 };
export const pads = []; // flattened building platforms: { x, z, height, inner, outer }

export function elevationField(x, z) {
  const smooth = 0.55 + SLOPE * (BLOCK.halfZ - z) + BOWL * x * x;
  const wobble = 0.75 * fractalNoise(x * 0.035 + 3.1, z * 0.035, 3, 1) + 0.12 * fractalNoise(x * 0.13, z * 0.13 + 9, 2, 2);
  return Math.max(smooth + wobble, 0.05);
}

// |gradient of L| where L = elevation / step: how many contour bands fit in one metre.
export function bandDensity(x, z) {
  const delta = 0.3;
  const gradX = (elevationField(x + delta, z) - elevationField(x - delta, z)) / (2 * delta);
  const gradZ = (elevationField(x, z + delta) - elevationField(x, z - delta)) / (2 * delta);
  return Math.hypot(gradX, gradZ) / TERRACE.step;
}

export function downhillDirection(x, z) {
  const delta = 0.3;
  const gradX = (elevationField(x + delta, z) - elevationField(x - delta, z)) / (2 * delta);
  const gradZ = (elevationField(x, z + delta) - elevationField(x, z - delta)) / (2 * delta);
  const length = Math.hypot(gradX, gradZ) || 1;
  return { x: -gradX / length, z: -gradZ / length };
}

export function notchPositionX(level) {
  const reach = Math.sqrt(Math.max(((level + 1) * TERRACE.step - 0.6) / BOWL, 100));
  const sign = level % 2 === 0 ? -1 : 1;
  return sign * Math.min(reach * 0.42, 30) + (level * 1.7) % 5 - 2;
}

function notchFactor(x, level) {
  const distance = Math.abs(x - notchPositionX(level));
  const notch = smoothstep(3.0, 1.9, distance);
  const lowered = TERRACE.notchHeight / TERRACE.bundHeight;
  return 1 - (1 - lowered) * notch;
}

export function streamX(z) {
  return STREAM.baseX + STREAM.swing * Math.sin(z * STREAM.frequency);
}

function forestBase(elevation) {
  const above = Math.max(elevation - TOP_LEVEL_HEIGHT, 0);
  return TOP_LEVEL_HEIGHT + FOREST_RISE * above + 0.09 * above * above;
}

function streamBedHeight(z) {
  const smoothElevation = 0.55 + SLOPE * (BLOCK.halfZ - z) + BOWL * streamX(z) ** 2;
  return forestBase(smoothElevation) - 0.6;
}

// Returns where a point sits in the terrace system.
export function classify(x, z) {
  const elevation = elevationField(x, z);
  const level = elevation / TERRACE.step;
  if (level >= TERRACE.count) {
    return { kind: 'forest', level, k: TERRACE.count, f: 0, density: 0, distance: 0, elevation };
  }
  const k = Math.floor(level);
  const f = level - k;
  const density = bandDensity(x, z);
  const distance = f / density; // metres uphill from the bund line
  let kind = 'shelf';
  if (f >= 1 - TERRACE.riserFraction) kind = 'riser';
  else if (distance < TERRACE.bundWidth) kind = 'bund';
  return { kind, level, k, f, density, distance, elevation };
}

export function floorHeight(k) {
  return k * TERRACE.step;
}

function edgeDistance(x, z) {
  return Math.min(BLOCK.halfX - Math.abs(x), BLOCK.halfZ - Math.abs(z));
}

function baseHeight(x, z) {
  const info = classify(x, z);
  if (info.kind === 'forest') {
    const above = Math.max(info.elevation - TOP_LEVEL_HEIGHT, 0);
    const ridge = 1.5 * fractalNoise(x * 0.06, z * 0.06 + 20, 3, 5) * smoothstep(0, 3, above);
    const rough = 0.4 * fractalNoise(x * 0.25, z * 0.25, 2, 6) * smoothstep(0, 2, above);
    let height = forestBase(info.elevation) + ridge + rough;
    const lateral = Math.abs(x - streamX(z));
    if (lateral < 4 && z < streamIntake().z + 1.5) {
      const bank = 1.4 * smoothstep(0.9, 3.4, lateral);
      height = Math.min(height, streamBedHeight(z) + bank);
    }
    return height;
  }
  const base = info.k * TERRACE.step;
  const riserStart = 1 - TERRACE.riserFraction;
  let rise = 0;
  if (info.f > riserStart) rise = smootherstep((info.f - riserStart) / TERRACE.riserFraction) * TERRACE.step;
  let height = base + rise;
  if (info.kind === 'bund' && info.k > 0) {
    const along = info.distance / TERRACE.bundWidth;
    const profile = smoothstep(0, 0.3, along) * smoothstep(1, 0.7, along);
    height += TERRACE.bundHeight * notchFactor(x, info.k) * profile;
  }
  if (info.f < riserStart) {
    const edge = edgeDistance(x, z);
    height += TERRACE.edgeRimHeight * smoothstep(0.7, 0.15, edge) * (info.k > 0 || info.f > 0.05 ? 1 : 0);
  }
  height += 0.03 * fractalNoise(x * 0.9, z * 0.9, 2, 8);
  return height;
}

export function heightAt(x, z) {
  let height = baseHeight(x, z);
  for (const pad of pads) {
    const distance = Math.hypot(x - pad.x, z - pad.z);
    if (distance < pad.outer) height += (pad.height - height) * smoothstep(pad.outer, pad.inner, distance);
  }
  return height;
}

let cachedIntake = null;
export function streamIntake() {
  if (cachedIntake) return cachedIntake;
  let low = -BLOCK.halfZ;
  let high = BLOCK.halfZ;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const mid = (low + high) / 2;
    const level = elevationField(streamX(mid), mid) / TERRACE.step;
    if (level > TERRACE.count) low = mid;
    else high = mid;
  }
  const z = (low + high) / 2;
  cachedIntake = { x: streamX(z), z };
  return cachedIntake;
}

// Streams: points of the water ribbon from the back edge to the intake. Heights are the bed plus a thin film.
export function streamPath() {
  const intake = streamIntake();
  const points = [];
  const startZ = -BLOCK.halfZ + 0.2;
  const count = 90;
  for (let index = 0; index <= count; index += 1) {
    const z = startZ + ((intake.z - startZ) * index) / count;
    points.push({ x: streamX(z), z, y: streamBedHeight(z) + 0.18 });
  }
  return points;
}

function solveZForLevel(x, targetLevel) {
  let low = -BLOCK.halfZ - 20;
  let high = BLOCK.halfZ + 20;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const mid = (low + high) / 2;
    const level = elevationField(x, mid) / TERRACE.step;
    if (level > targetLevel) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

// Find the z where the contour band k has the given fraction f at this x (null if outside the block).
export function pointOnBand(x, k, f) {
  let z = solveZForLevel(x, k + f);
  for (let refine = 0; refine < 2; refine += 1) {
    z = solveZForLevel(x, k + f * 1);
  }
  if (Math.abs(z) > BLOCK.halfZ - 0.6 || Math.abs(x) > BLOCK.halfX - 0.6) return null;
  return { x, z };
}

export function buildLayout() {
  const layout = { houses: [], haystacks: [], buffalo: null };
  const houseColumns = [-33, 14, 34];
  for (const x of houseColumns) {
    let z = solveZForLevel(x, TERRACE.count + 0.9);
    z = clamp(z, -34, 34);
    const info = classify(x, z);
    const height = baseHeight(x, z);
    layout.houses.push({ x, z, height, forest: info.kind === 'forest' });
    pads.push({ x, z, height, inner: 5.2, outer: 8.4 });
  }
  const buffaloZ = solveZForLevel(6, 5.45);
  layout.buffalo = { x: 6, z: buffaloZ, level: 5 };
  const hayLevels = [1, 2, 3, 4, 5, 6, 7, 8, 8, 7, 6, 5, 4, 3, 2, 1];
  hayLevels.forEach((level, index) => {
    const reach = Math.sqrt(Math.max(((level + 1) * TERRACE.step - 0.6) / BOWL, 100));
    const x = clamp((((index * 37) % 17) / 16 - 0.5) * 1.5 * reach, -reach * 0.8, reach * 0.8);
    const z = solveZForLevel(x, level + 0.5);
    const info = classify(x, z);
    if (info.kind === 'shelf' && edgeDistance(x, z) > 2.5 && Math.hypot(x - 6, z - buffaloZ) > 4) {
      layout.haystacks.push({ x, z, level });
    }
  });
  return layout;
}
