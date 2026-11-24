// Mass-based cellular-automaton water on the voxel grid (double buffered, order independent).
// Each step: flow down (with slight compression), spread to 4 horizontal neighbours, push pressure excess up.
import { NX, NY, NZ, LAYER, N } from './world.js';

const MAX_MASS = 1.0;
const MAX_COMPRESS = 0.02;
const MIN_MASS = 0.0005;
const MIN_FLOW = 0.005;
const MAX_SPEED = 1.0;

function stable(total) {
  if (total <= MAX_MASS) return MAX_MASS;
  if (total < 2 * MAX_MASS + MAX_COMPRESS) return (MAX_MASS * MAX_MASS + total * MAX_COMPRESS) / (MAX_MASS + MAX_COMPRESS);
  return (total + MAX_COMPRESS) / 2;
}

export class Water {
  constructor(mat, sink, sources) {
    this.mat = mat;
    this.sink = sink;
    this.sources = sources;
    this.mass = new Float32Array(N);
    this.next = new Float32Array(N);
    this.down = new Float32Array(N);   // smoothed downward flux leaving each cell
    this.horiz = new Float32Array(N);  // smoothed horizontal flux magnitude
    this.foam = new Float32Array(N);
    // list of all non-solid cells (excluding the top/bottom layers) for fast iteration
    const air = [];
    for (let i = LAYER; i < N - LAYER; i++) if (mat[i] === 0) air.push(i);
    this.air = Int32Array.from(air);
    this.steps = 0;
    // downstream bias (+z) on terraces: stands in for a sub-voxel slope of the river bed
    this.bias = new Float32Array(N);
    this.drain = new Float32Array(N);
  }

  step() {
    const { mat, mass, next, down, horiz } = this;
    next.set(mass);
    const air = this.air;
    for (let k = 0; k < air.length; k++) {
      const c = air[k];
      const m = mass[c];
      if (m <= MIN_MASS) { down[c] *= 0.9; horiz[c] *= 0.9; continue; }
      let rem = m;
      let fd = 0, fh = 0;
      // down
      const b = c - LAYER;
      if (mat[b] === 0) {
        let f = stable(rem + mass[b]) - mass[b];
        if (f > MIN_FLOW) f *= 0.5;
        f = Math.max(0, Math.min(f, MAX_SPEED, rem));
        next[c] -= f; next[b] += f; rem -= f; fd = f;
      }
      if (rem > 0) {
        const x = c % NX;
        const z = ((c / NX) | 0) % NZ;
        const r0 = rem;
        // 4 neighbours, all computed from the same r0 so there is no directional bias
        for (let d = 0; d < 4; d++) {
          let n;
          if (d === 0) { if (x === 0) continue; n = c - 1; }
          else if (d === 1) { if (x === NX - 1) continue; n = c + 1; }
          else if (d === 2) { if (z === 0) continue; n = c - NX; }
          else { if (z === NZ - 1) continue; n = c + NX; }
          if (mat[n] !== 0) continue;
          let f = (r0 - mass[n]) / 5;
          if (d === 3) f += this.bias[c] * r0; else if (d === 2) f -= this.bias[c] * r0;
          if (f > MIN_FLOW) f *= 0.5;
          f = Math.max(0, Math.min(f, rem));
          next[c] -= f; next[n] += f; rem -= f; fh += f;
        }
      }
      if (rem > 0) {
        const u = c + LAYER;
        if (mat[u] === 0) {
          let f = rem - stable(rem + mass[u]);
          if (f > MIN_FLOW) f *= 0.5;
          f = Math.max(0, Math.min(f, MAX_SPEED, rem));
          next[c] -= f; next[u] += f;
        }
      }
      down[c] = down[c] * 0.8 + fd * 0.2;
      horiz[c] = horiz[c] * 0.8 + fh * 0.2;
    }
    // swap
    this.mass = next; this.next = mass;
    const M = this.mass;
    for (let k = 0; k < air.length; k++) {
      const c = air[k];
      if (M[c] < MIN_MASS) M[c] = 0;
      if (this.sink[c]) M[c] = 0;
      else if (this.drain[c] > 0) M[c] -= M[c] * this.drain[c];
    }
    for (const s of this.sources) M[s] = 1.0;
    this.steps++;
  }

  // Foam field: impacts under falling water, lips where water starts to fall, fast sheets.
  // Also collects emitter lists for particles.
  updateFoam(lips, impacts) {
    const { mat, down, horiz, foam } = this;
    const M = this.mass;
    const air = this.air;
    lips.length = 0; impacts.length = 0;
    for (let k = 0; k < air.length; k++) {
      const c = air[k];
      const m = M[c];
      if (m < 0.02) { foam[c] *= 0.8; continue; }
      const b = c - LAYER, u = c + LAYER;
      const belowOpen = mat[b] === 0 && M[b] < 0.9;
      let t = 0;
      // impact: water arriving from above into a resting cell
      if (!belowOpen && mat[u] === 0 && down[u] > 0.04) {
        t = Math.min(1, down[u] * 4);
        if (down[u] > 0.08) impacts.push(c);
      }
      // lip: falling cell fed sideways by a resting cell
      if (belowOpen) {
        let fed = false;
        for (const n of [c - 1, c + 1, c - NX, c + NX]) {
          if (mat[n] === 0 && M[n] > 0.05 && mat[n - LAYER] !== 0) { fed = true; break; }
        }
        if (fed) { t = Math.max(t, 0.85); lips.push(c); }
        else t = Math.max(t, 0.35 + Math.min(0.5, down[c] * 2));
      }
      t = Math.max(t, Math.min(0.7, (horiz[c] - 0.03) * 6));
      // diffuse foam outward along the surface
      let nb = 0;
      for (const n of [c - 1, c + 1, c - NX, c + NX]) if (mat[n] === 0) nb = Math.max(nb, foam[n]);
      foam[c] = Math.max(t, foam[c] * 0.8 + nb * 0.15);
    }
  }
}
