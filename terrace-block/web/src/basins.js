// Derives the water model's geometry from the terrain field: one basin per terrace shelf and the
// lips (bund notches, bund crests, block edges) over which a basin can spill.
import {
  BLOCK, TERRACE, classify, floorHeight, heightAt, bandDensity, downhillDirection, notchPositionX, elevationField,
} from './terrainField.js';

const SAMPLE_SPACING = 1.0;
const LIP_SPACING = 0.75;

function isShelf(info) {
  return info.kind === 'shelf';
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

function createBasin(level) {
  return {
    level,
    floorY: floorHeight(level),
    sampleX: [],
    sampleZ: [],
    sampleArea: SAMPLE_SPACING * SAMPLE_SPACING,
    centerX: 0,
    centerZ: 0,
    maximumVolume: 0,
  };
}

function collectPlanform(basins) {
  for (let x = -BLOCK.halfX + 0.9; x <= BLOCK.halfX - 0.9; x += SAMPLE_SPACING) {
    for (let z = -BLOCK.halfZ + 0.9; z <= BLOCK.halfZ - 0.9; z += SAMPLE_SPACING) {
      const info = classify(x, z);
      if (info.kind !== 'shelf' || info.k >= TERRACE.count) continue;
      const basin = basins[info.k];
      basin.sampleX.push(x);
      basin.sampleZ.push(z);
    }
  }
  for (const basin of basins) {
    const count = Math.max(basin.sampleX.length, 1);
    basin.centerX = basin.sampleX.reduce((sum, value) => sum + value, 0) / count;
    basin.centerZ = basin.sampleZ.reduce((sum, value) => sum + value, 0) / count;
    basin.sampleX = Float32Array.from(basin.sampleX, (value) => value - basin.centerX);
    basin.sampleZ = Float32Array.from(basin.sampleZ, (value) => value - basin.centerZ);
    basin.area = count * basin.sampleArea;
  }
}

function findDestination(x, z, level) {
  const direction = downhillDirection(x, z);
  const path = [];
  let px = x;
  let pz = z;
  for (let step = 0; step < 16; step += 1) {
    px += direction.x * 0.45;
    pz += direction.z * 0.45;
    const info = classify(px, pz);
    path.push({ x: px, z: pz, y: heightAt(px, pz) + 0.05 });
    if (Math.abs(px) > BLOCK.halfX || Math.abs(pz) > BLOCK.halfZ) return { destination: -1, path };
    if (info.kind !== 'forest' && info.k === level - 1 && isShelf(info)) return { destination: level - 1, path };
  }
  return { destination: level > 0 ? level - 1 : -1, path };
}

function collectBundLips(lips) {
  for (let level = 1; level < TERRACE.count; level += 1) {
    for (let x = -BLOCK.halfX + 1; x <= BLOCK.halfX - 1; x += LIP_SPACING) {
      let z = solveZForLevel(x, level + 0.02);
      const density = bandDensity(x, z);
      z = solveZForLevel(x, level + density * TERRACE.bundWidth * 0.5);
      if (Math.abs(z) > BLOCK.halfZ - 1.0) continue;
      const info = classify(x, z);
      if (info.k !== level || info.kind !== 'bund') continue;
      const crest = heightAt(x, z) - floorHeight(level);
      const route = findDestination(x, z, level);
      lips.push({
        basin: level, x, z, crest, width: LIP_SPACING, destination: route.destination,
        path: [{ x, z, y: crest + floorHeight(level) }, ...route.path], edge: null,
        isNotch: crest < TERRACE.bundHeight * 0.6,
      });
    }
  }
}

function collectEdgeLips(lips) {
  const segments = [
    { fixed: 'x', value: -BLOCK.halfX, normal: { x: -1, z: 0 } },
    { fixed: 'x', value: BLOCK.halfX, normal: { x: 1, z: 0 } },
    { fixed: 'z', value: -BLOCK.halfZ, normal: { x: 0, z: -1 } },
    { fixed: 'z', value: BLOCK.halfZ, normal: { x: 0, z: 1 } },
  ];
  for (const segment of segments) {
    const span = segment.fixed === 'x' ? BLOCK.halfZ : BLOCK.halfX;
    for (let along = -span + 0.5; along <= span - 0.5; along += LIP_SPACING) {
      const inset = 0.2;
      const x = segment.fixed === 'x' ? segment.value - segment.normal.x * inset : along;
      const z = segment.fixed === 'z' ? segment.value - segment.normal.z * inset : along;
      const info = classify(x, z);
      if (info.kind !== 'shelf' && info.kind !== 'bund') continue;
      if (info.k >= TERRACE.count) continue;
      const floorY = floorHeight(info.k);
      const crest = heightAt(x, z) - floorY;
      const edgeX = segment.fixed === 'x' ? segment.value : along;
      const edgeZ = segment.fixed === 'z' ? segment.value : along;
      lips.push({
        basin: info.k, x, z, crest, width: LIP_SPACING, destination: -1, edge: segment.normal,
        path: [
          { x, z, y: floorY + crest },
          { x: edgeX, z: edgeZ, y: floorY + crest - 0.05 },
          { x: edgeX + segment.normal.x * 0.02, z: edgeZ + segment.normal.z * 0.02, y: floorY - 3.5 },
        ],
        isNotch: false,
      });
    }
  }
}

export function buildBasins() {
  const basins = [];
  for (let level = 0; level < TERRACE.count; level += 1) basins.push(createBasin(level));
  collectPlanform(basins);
  const lips = [];
  collectBundLips(lips);
  collectEdgeLips(lips);
  return { basins, lips, notchPositions: basins.map((basin) => notchPositionX(basin.level)) };
}
