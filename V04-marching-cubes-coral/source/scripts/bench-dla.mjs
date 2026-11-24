import { VoxelGrid } from '../src/dla.js';
const g = new VoxelGrid(128, 96, 128);
g.buildSeabed(11);
let t = performance.now();
const n = g.growDLA(1234, 24000);
console.log('dla', n, (performance.now() - t).toFixed(0), 'ms');
for (const c of g.colonies) console.log(c.x, c.y, c.z, c.reach.toFixed(1), c.weight.toFixed(2));
const hist = new Array(10).fill(0); for (const i of g.coralList) hist[Math.floor((((i / g.sy) | 0) % g.ny) / 10)]++; console.log(hist.join(' '));
