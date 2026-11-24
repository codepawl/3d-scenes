// The voxel grid is the source of truth: occupancy + broken bonds.
// Fracture edits the grid, then a flood fill from the ground finds every
// connected component that lost support; each becomes a rigid chunk.

export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => { // xorshift32
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise1(x, seed) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return hash2(i, seed) * (1 - u) + hash2(i + 1, seed) * u;
}

export class Grid {
  constructor(GX, GY, GZ, S) {
    this.GX = GX; this.GY = GY; this.GZ = GZ; this.S = S;
    this.ox = -GX * S / 2; this.oy = 0; this.oz = -GZ * S / 2;
    this.N = GX * GY * GZ;
    this.occ = new Uint8Array(this.N);
    this.bx = new Uint8Array(this.N); // bond (i,j,k)-(i+1,j,k) broken
    this.by = new Uint8Array(this.N);
    this.bz = new Uint8Array(this.N);
  }
  idx(i, j, k) { return i + this.GX * (j + this.GY * k); }
  center(id, out, o = 0) {
    const i = id % this.GX, j = Math.floor(id / this.GX) % this.GY, k = Math.floor(id / (this.GX * this.GY));
    out[o] = this.ox + (i + 0.5) * this.S;
    out[o + 1] = (j + 0.5) * this.S;
    out[o + 2] = this.oz + (k + 0.5) * this.S;
  }
  build() {
    const { GX, GY, GZ } = this;
    this.occ.fill(0); this.bx.fill(0); this.by.fill(0); this.bz.fill(0);
    for (let i = 0; i < GX; i++) {
      // ruined top profile: big lumps + brick-scale steps, lower toward the ends
      const edge = Math.min(i, GX - 1 - i) / GX;
      let h = GY - 2 - 6 * noise1(i * 0.07, 11) - 3 * noise1(i * 0.31, 12);
      h -= Math.max(0, 0.12 - edge) * 50;
      for (let j = 0; j < GY; j++) {
        const brick = Math.floor((i + (j & 1)) / 2);
        const hb = h + (hash2(brick, j * 7 + 3) - 0.5) * 2.5;
        if (j >= hb) continue;
        // a few missing bricks near the top
        if (j > h - 6 && hash2(brick * 13 + 5, j) < 0.08) continue;
        for (let k = 0; k < GZ; k++) this.occ[this.idx(i, j, k)] = 1;
      }
    }
    this.floodDetach(); // drop bricks that would float from the start
  }
  breakBond(i, j, k, di, dj) { // between (i,j,k) and (i+di, j+dj, k)
    if (di === 1) this.bx[this.idx(i, j, k)] = 1;
    else if (di === -1 && i > 0) this.bx[this.idx(i - 1, j, k)] = 1;
    else if (dj === 1) this.by[this.idx(i, j, k)] = 1;
    else if (dj === -1 && j > 0) this.by[this.idx(i, j - 1, k)] = 1;
  }

  // BFS from ground-row voxels; returns array of unsupported components (arrays of ids). Removes them from occ.
  floodDetach() {
    const { GX, GY, GZ, occ } = this;
    const seen = new Uint8Array(this.N);
    const queue = new Int32Array(this.N);
    let qh = 0, qt = 0;
    for (let k = 0; k < GZ; k++) for (let i = 0; i < GX; i++) {
      const id = this.idx(i, 0, k);
      if (occ[id]) { seen[id] = 1; queue[qt++] = id; }
    }
    const visit = (id, collect) => {
      const i = id % GX, j = Math.floor(id / GX) % GY, k = Math.floor(id / (GX * GY));
      const tryN = (n, broken) => { if (!broken && occ[n] && !seen[n]) { seen[n] = 1; queue[qt++] = n; } };
      if (i + 1 < GX) tryN(id + 1, this.bx[id]);
      if (i > 0) tryN(id - 1, this.bx[id - 1]);
      if (j + 1 < GY) tryN(id + GX, this.by[id]);
      if (j > 0) tryN(id - GX, this.by[id - GX]);
      if (k + 1 < GZ) tryN(id + GX * GY, this.bz[id]);
      if (k > 0) tryN(id - GX * GY, this.bz[id - GX * GY]);
    };
    while (qh < qt) visit(queue[qh++]);
    const comps = [];
    for (let id = 0; id < this.N; id++) {
      if (!occ[id] || seen[id]) continue;
      qh = qt = 0; seen[id] = 1; queue[qt++] = id;
      while (qh < qt) visit(queue[qh++]);
      const comp = Array.from(queue.subarray(0, qt));
      for (const c of comp) occ[c] = 0;
      comps.push(comp);
    }
    return comps;
  }

  // split an arbitrary id set into 6-connected pieces (ignores bonds; ids are no longer in occ)
  static splitConnected(grid, ids) {
    const set = new Set(ids), out = [];
    const { GX, GY } = grid;
    for (const s of ids) {
      if (!set.has(s)) continue;
      set.delete(s);
      const comp = [s];
      for (let q = 0; q < comp.length; q++) {
        const id = comp[q];
        const i = id % GX, j = Math.floor(id / GX) % GY;
        const ns = [];
        if (i + 1 < GX) ns.push(id + 1);
        if (i > 0) ns.push(id - 1);
        if (j + 1 < GY) ns.push(id + GX);
        if (j > 0) ns.push(id - GX);
        ns.push(id + GX * GY, id - GX * GY);
        for (const n of ns) if (set.has(n)) { set.delete(n); comp.push(n); }
      }
      out.push(comp);
    }
    return out;
  }

  // Impact at world point (px,py) on the wall plane with ball radius R and velocity dir.
  // Returns [{ ids, kind: 'crush'|'damage'|'loose' }]
  fracture(px, py, R, rng, opts = {}) {
    const { GX, GY, GZ, S, occ } = this;
    const gx = (px - this.ox) / S, gy = py / S; // grid-space impact centre (xy)
    const crushR = (R * (opts.crush ?? 1.25)) / S, dmgR = (R * (opts.dmg ?? 2.4)) / S;
    const crushed = [], damage = [];
    const i0 = Math.max(0, Math.floor(gx - dmgR - 2)), i1 = Math.min(GX - 1, Math.ceil(gx + dmgR + 2));
    const j0 = Math.max(0, Math.floor(gy - dmgR - 2)), j1 = Math.min(GY - 1, Math.ceil(gy + dmgR + 2));
    const ns = Math.floor(rng() * 1000);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = i + 0.5 - gx, dy = j + 0.5 - gy;
      const d = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      const jag = 0.8 + 0.35 * noise1(ang * 3 + 10, ns) + 0.15 * hash2(i * 3 + ns, j);
      for (let k = 0; k < GZ; k++) {
        const id = this.idx(i, j, k);
        if (!occ[id]) continue;
        // slightly cone-shaped crater: exit side (front, k high) loses more
        const kf = 0.9 + 0.12 * (k / (GZ - 1));
        if (d < crushR * jag * kf) crushed.push(id);
        else if (d < dmgR * (0.75 + 0.45 * noise1(ang * 2.3 + 40, ns + 7))) damage.push(id);
      }
    }
    for (const id of crushed) occ[id] = 0;

    const pieces = [];
    // crushed -> small clusters (Voronoi on random seeds, ~4 voxels each)
    pieces.push(...this._voronoi(crushed, Math.max(1, Math.floor(crushed.length / 4)), rng, 'crush'));

    // damage ring -> medium Voronoi cells; inner ones detach, outer ones stay but get cracked boundaries
    const cells = this._voronoiAssign(damage, Math.max(3, Math.floor(damage.length / 60)), rng);
    for (const cell of cells) {
      let cx = 0, cy = 0;
      for (const id of cell) { cx += id % GX; cy += Math.floor(id / GX) % GY; }
      cx = cx / cell.length + 0.5; cy = cy / cell.length + 0.5;
      const d = Math.hypot(cx - gx, cy - gy);
      if (d < dmgR * 0.72 || rng() < 0.35) {
        for (const id of cell) occ[id] = 0;
        for (const part of Grid.splitConnected(this, cell)) pieces.push({ ids: part, kind: 'damage' });
      }
    }
    // break bonds between different Voronoi cells that stay
    const owner = new Map();
    cells.forEach((cell, ci) => cell.forEach((id) => owner.set(id, ci)));
    for (const [id, ci] of owner) {
      if (!occ[id]) continue;
      const i = id % GX, j = Math.floor(id / GX) % GY, k = Math.floor(id / (GX * GY));
      for (const [di, dj] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= GX || nj >= GY) continue;
        const o = owner.get(this.idx(ni, nj, k));
        if (o !== undefined && o !== ci) this.breakBond(i, j, k, di, dj);
      }
    }

    // radial cracks
    const nCr = opts.cracks ?? 6;
    const base = rng() * Math.PI * 2;
    const angles = [];
    for (let c = 0; c < nCr; c++) angles.push(base + (c / nCr) * Math.PI * 2 + (rng() - 0.5) * 0.5);
    for (const a0 of angles) this._crack(gx, gy, a0, crushR * 0.8, 5 + rng() * 9, rng);
    // long structural cracks: [angle, start offset along x in units of crush radius]
    for (const c of opts.upCracks ?? []) {
      const [a0, ox] = Array.isArray(c) ? c : [c, 0];
      this._crack(gx + ox * crushR, gy - (ox ? crushR * 0.3 : 0), a0, ox ? 0 : crushR * 0.8, 90, rng, ox ? 0.12 : 0.35);
    }

    // flood fill: everything no longer connected to the ground falls
    const loose = this.floodDetach();
    // shear rule: a big loose chunk resting on a thin ledge of static voxels snaps that ledge off
    for (const comp of loose.slice()) {
      if (comp.length < 60) continue;
      const inComp = new Set(comp);
      const sup = new Set();
      for (const id of comp) {
        const below = id - GX;
        if (Math.floor(id / GX) % GY > 0 && occ[below] && !inComp.has(below)) sup.add(below);
      }
      if (sup.size > 0 && sup.size <= Math.max(25, comp.length * 0.1)) {
        const ledge = [];
        for (const id of sup) {
          // take the support voxel and the one under it
          for (const t of [id, id - GX]) if (t >= 0 && occ[t]) { occ[t] = 0; ledge.push(t); }
        }
        for (const part of Grid.splitConnected(this, ledge)) pieces.push({ ids: part, kind: 'crush' });
        loose.push(...this.floodDetach());
      }
    }
    for (const comp of loose) pieces.push({ ids: comp, kind: 'loose' });
    return pieces;
  }

  _crack(gx, gy, a0, r0, len, rng, wobble = 0.35) {
    const { GX, GY, GZ } = this;
    let x = gx + Math.cos(a0) * r0, y = gy + Math.sin(a0) * r0, a = a0;
    const cells = []; // [i, j, dirx, diry]
    const key = new Set();
    let pi = Math.floor(x), pj = Math.floor(y);
    for (let t = 0; t < len; t += 0.5) {
      a += (rng() - 0.5) * wobble;
      // keep drifting back toward the original heading
      a += (a0 - a) * 0.08;
      const dx = Math.cos(a), dy = Math.sin(a);
      x += dx * 0.5; y += dy * 0.5;
      const ci = Math.floor(x), cj = Math.floor(y);
      if (ci < 0 || cj < 0 || ci >= GX || cj >= GY) break;
      const add = (i, j) => { const k = i + ',' + j; if (!key.has(k)) { key.add(k); cells.push([i, j, dx, dy]); } };
      if (ci !== pi && cj !== pj) add(ci, pj);
      add(ci, cj);
      pi = ci; pj = cj;
    }
    for (const [i, j, dx, dy] of cells) {
      const nx = -dy, ny = dx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (di * nx + dj * ny < -0.3) continue;
        if (key.has((i + di) + ',' + (j + dj))) continue;
        for (let k = 0; k < GZ; k++) this.breakBond(i, j, k, di, dj);
      }
    }
  }

  _voronoiAssign(ids, nSeeds, rng) {
    const { GX, GY } = this;
    if (!ids.length) return [];
    const seeds = [];
    for (let s = 0; s < nSeeds; s++) {
      const id = ids[Math.floor(rng() * ids.length)];
      seeds.push([id % GX + rng(), Math.floor(id / GX) % GY + rng(), Math.floor(id / (GX * GY)) * 0.3 + rng()]);
    }
    const cells = seeds.map(() => []);
    for (const id of ids) {
      const x = id % GX + 0.5, y = Math.floor(id / GX) % GY + 0.5, z = Math.floor(id / (GX * GY)) * 0.3;
      let best = 0, bd = 1e9;
      for (let s = 0; s < seeds.length; s++) {
        const dx = x - seeds[s][0], dy = (y - seeds[s][1]) * 1.3, dz = z - seeds[s][2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) { bd = d; best = s; }
      }
      cells[best].push(id);
    }
    return cells.filter((c) => c.length);
  }

  _voronoi(ids, nSeeds, rng, kind) {
    const out = [];
    for (const cell of this._voronoiAssign(ids, nSeeds, rng)) {
      for (const part of Grid.splitConnected(this, cell)) out.push({ ids: part, kind });
    }
    return out;
  }
}
