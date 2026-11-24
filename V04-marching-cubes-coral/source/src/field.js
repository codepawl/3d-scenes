// Scalar density field derived from the voxel grid. Each solid voxel splats a small smooth kernel;
// marching cubes then extracts the iso-surface. Coral density is kept separately so the mesher can tell
// coral from rock at each vertex.
import { ROCK } from './dla.js';

export const ISO = 0.6;
const KR = 2; // kernel half-width in voxels

export class DensityField {
  constructor(grid, chunk = 16) {
    this.grid = grid;
    const { nx, ny, nz } = grid;
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.total = new Float32Array(grid.size);
    this.coral = new Float32Array(grid.size);
    this.chunk = chunk;
    this.cx = Math.ceil((nx - 1) / chunk);
    this.cy = Math.ceil((ny - 1) / chunk);
    this.cz = Math.ceil((nz - 1) / chunk);
    this.dirty = new Uint8Array(this.cx * this.cy * this.cz);
    // precomputed kernels for a few amplitudes (radius scale)
    this.kernels = [];
    for (let k = 0; k < 4; k++) this.kernels.push(makeKernel(1.55 + k * 0.28));
    this.rockKernel = makeKernel(1.9);
  }

  splatRock() {
    const g = this.grid;
    const { nx, ny, nz } = this;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = x + y * g.sy + z * g.sz;
      if (g.occ[i] !== ROCK) continue;
      // interior rock is fully surrounded: write saturated value without the kernel loop
      this.splat(x, y, z, this.rockKernel, null);
    }
    this.markAll();
  }

  // amplitude class 0..3 (3 = thickest)
  splatCoral(i, cls) {
    const g = this.grid;
    const x = i % g.nx, y = ((i / g.sy) | 0) % g.ny, z = (i / g.sz) | 0;
    this.splat(x, y, z, this.kernels[cls], this.coral);
    this.markRegion(x, y, z);
  }

  splat(x, y, z, kern, extra) {
    const { nx, ny, nz, total } = this;
    const sy = nx, sz = nx * ny;
    let k = 0;
    for (let dz = -KR; dz <= KR; dz++) {
      const zz = z + dz;
      for (let dy = -KR; dy <= KR; dy++) {
        const yy = y + dy;
        for (let dx = -KR; dx <= KR; dx++, k++) {
          const xx = x + dx;
          const w = kern[k];
          // keep the outer shell of the grid empty so the surface closes at the edges
          if (w === 0 || xx < 1 || yy < 0 || zz < 1 || xx >= nx - 1 || yy >= ny - 1 || zz >= nz - 1) continue;
          const j = xx + yy * sy + zz * sz;
          total[j] = Math.min(total[j] + w, 4);
          if (extra) extra[j] = Math.min(extra[j] + w, 4);
        }
      }
    }
  }

  markRegion(x, y, z) {
    const c = this.chunk, m = KR + 3;
    const x0 = Math.max(0, Math.floor((x - m) / c)), x1 = Math.min(this.cx - 1, Math.floor((x + m) / c));
    const y0 = Math.max(0, Math.floor((y - m) / c)), y1 = Math.min(this.cy - 1, Math.floor((y + m) / c));
    const z0 = Math.max(0, Math.floor((z - m) / c)), z1 = Math.min(this.cz - 1, Math.floor((z + m) / c));
    for (let cz = z0; cz <= z1; cz++) for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++)
      this.dirty[cx + cy * this.cx + cz * this.cx * this.cy] = 1;
  }
  markAll() { this.dirty.fill(1); }

  // trilinear sample of total density, clamped to the grid
  sample(x, y, z) {
    const { nx, ny, nz, total } = this;
    x = Math.min(Math.max(x, 0), nx - 1.001);
    y = Math.min(Math.max(y, 0), ny - 1.001);
    z = Math.min(Math.max(z, 0), nz - 1.001);
    const xi = x | 0, yi = y | 0, zi = z | 0;
    const fx = x - xi, fy = y - yi, fz = z - zi;
    const sy = nx, sz = nx * ny;
    const i = xi + yi * sy + zi * sz;
    const c00 = total[i] + (total[i + 1] - total[i]) * fx;
    const c10 = total[i + sy] + (total[i + sy + 1] - total[i + sy]) * fx;
    const c01 = total[i + sz] + (total[i + sz + 1] - total[i + sz]) * fx;
    const c11 = total[i + sy + sz] + (total[i + sy + sz + 1] - total[i + sy + sz]) * fx;
    const c0 = c00 + (c10 - c00) * fy, c1 = c01 + (c11 - c01) * fy;
    return c0 + (c1 - c0) * fz;
  }
}

function makeKernel(r) {
  const n = 2 * KR + 1;
  const k = new Float32Array(n * n * n);
  let i = 0;
  for (let dz = -KR; dz <= KR; dz++) for (let dy = -KR; dy <= KR; dy++) for (let dx = -KR; dx <= KR; dx++, i++) {
    const d2 = (dx * dx + dy * dy + dz * dz) / (r * r);
    k[i] = d2 < 1 ? (1 - d2) * (1 - d2) : 0;
  }
  return k;
}
