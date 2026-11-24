// 3D cellular automaton on a voxel grid. Moore neighbourhood (26 cells).
//   birth    : empty cell with exactly 5 occupied neighbours
//   survival : live cell with 4 or 5 occupied neighbours
// A live cell that fails survival does not vanish: it freezes into inert crystal.
// "Occupied" means live OR frozen, so neighbour counts never decrease; this lets the
// step be incremental (only neighbours of the previous generation's births can be born).

export const NONE = 0xffff;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class CrystalAutomaton {
  constructor(N = 128) {
    this.N = N;
    const V = N * N * N;
    this.state = new Uint8Array(V);   // 0 empty, 1 live, 2 frozen
    this.count = new Uint8Array(V);   // occupied Moore neighbours
    this.birth = new Uint16Array(V).fill(NONE);
    this.freeze = new Uint16Array(V).fill(NONE);
    this.stamp = new Uint32Array(V);
    this.stampId = 1;
    const off = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (dx || dy || dz) off.push(dx + N * (dy + N * dz));
    this.off = Int32Array.from(off);
    this.face = Int32Array.from([1, -1, N, -N, N * N, -N * N]);
  }

  idx(x, y, z) { const N = this.N; return x + N * (y + N * z); }

  reset() {
    this.state.fill(0); this.count.fill(0);
    this.birth.fill(NONE); this.freeze.fill(NONE);
    this.gen = 0; this.live = []; this.cand = []; this.occupied = []; this.ext = 0;
    this.history = []; // occupied count per generation
  }

  // Mirror-symmetric (8-fold) random seed in a small cube at the grid centre.
  seed(seedValue, size = 5, fill = 0.42) {
    this.reset();
    const rnd = mulberry32(seedValue * 9973 + 17);
    const c = this.N >> 1, h = size >> 1;
    const cells = new Set();
    for (let z = 0; z <= h; z++)
      for (let y = 0; y <= h; y++)
        for (let x = 0; x <= h; x++) {
          if (rnd() >= fill) continue;
          for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1])
            cells.add(this.idx(c + x * sx, c + y * sy, c + z * sz));
        }
    for (const i of cells) this._bear(i, 0);
    this.history.push(this.occupied.length);
  }

  _bear(i, g) {
    this.state[i] = 1; this.birth[i] = g;
    this.live.push(i); this.occupied.push(i);
    const off = this.off, cnt = this.count;
    for (let k = 0; k < 26; k++) {
      const j = i + off[k];
      cnt[j]++;
      this.cand.push(j);
    }
  }

  step() {
    const N = this.N, st = this.state, cnt = this.count, c = N >> 1;
    const g = this.gen + 1;
    // births (evaluated on the previous state)
    const sid = ++this.stampId;
    const births = [];
    for (const j of this.cand) {
      if (this.stamp[j] === sid) continue;
      this.stamp[j] = sid;
      if (st[j] === 0 && cnt[j] === 5) births.push(j);
    }
    // survival
    const keep = [];
    for (const i of this.live) {
      const k = cnt[i];
      if (k >= 4 && k <= 5) keep.push(i);
      else { st[i] = 2; this.freeze[i] = g; }
    }
    this.live = keep;
    this.cand = [];
    const lim = c - 3;
    for (const j of births) {
      const x = j % N, y = ((j / N) | 0) % N, z = (j / (N * N)) | 0;
      const e = Math.max(Math.abs(x - c), Math.abs(y - c), Math.abs(z - c));
      if (e > lim) continue; // stay inside the grid
      if (e > this.ext) this.ext = e;
      this._bear(j, g);
    }
    this.gen = g;
    this.history.push(this.occupied.length);
    return births.length;
  }

  run(maxGen) {
    while (this.gen < maxGen) { if (this.step() === 0 && this.live.length === 0) break; }
    return this;
  }

  // Pack every voxel that is ever visible: position, birth gen, freeze gen, buried gen
  // (generation at which all 6 face neighbours are occupied, so it can never be seen again).
  // `cut` removes a wedge (x > c and z > c) from the render so the age rings inside show;
  // cut cells count as empty when deciding whether a voxel is enclosed.
  pack(cut = true) {
    const N = this.N, c = N >> 1, birth = this.birth, face = this.face;
    const inCut = (i) => cut && (i % N) > c && ((i / (N * N)) | 0) > c;
    const n = this.occupied.length;
    const pos = new Float32Array(n * 3), gens = new Float32Array(n * 3);
    let m = 0;
    for (const i of this.occupied) {
      if (inCut(i)) continue;
      const b = birth[i];
      let buried = b;
      for (let k = 0; k < 6; k++) {
        const j = i + face[k], bj = birth[j];
        if (bj === NONE || inCut(j)) { buried = 1e6; break; }
        if (bj > buried) buried = bj;
      }
      if (buried <= b) continue; // born already enclosed: never visible
      const x = i % N, y = ((i / N) | 0) % N, z = (i / (N * N)) | 0;
      pos[m * 3] = x - c; pos[m * 3 + 1] = y - c; pos[m * 3 + 2] = z - c;
      gens[m * 3] = b;
      gens[m * 3 + 1] = this.freeze[i] === NONE ? 1e6 : this.freeze[i];
      gens[m * 3 + 2] = buried;
      m++;
    }
    return { count: m, pos: pos.subarray(0, m * 3), gens: gens.subarray(0, m * 3) };
  }

  // Bounding radius (Chebyshev) of the crystal at each generation, for camera framing.
  extentByGen() {
    const N = this.N, c = N >> 1, ext = new Float32Array(this.gen + 1);
    for (const i of this.occupied) {
      const x = i % N, y = ((i / N) | 0) % N, z = (i / (N * N)) | 0;
      const e = Math.max(Math.abs(x - c), Math.abs(y - c), Math.abs(z - c));
      const b = this.birth[i];
      if (e > ext[b]) ext[b] = e;
    }
    for (let g = 1; g < ext.length; g++) ext[g] = Math.max(ext[g], ext[g - 1]);
    return ext;
  }
}

// Find a seed (deterministically, starting at `start`) whose crystal keeps growing.
export function growCrystal(start, maxGen, N = 128) {
  const ca = new CrystalAutomaton(N);
  for (let s = start; s < start + 200; s++) {
    ca.seed(s);
    ca.run(maxGen);
    if (ca.gen >= maxGen && ca.ext >= Math.min(N / 2 - 4, maxGen * 0.3)) return { ca, seed: s };
  }
  return { ca, seed: start };
}
