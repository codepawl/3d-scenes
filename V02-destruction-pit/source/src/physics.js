// Minimal custom rigid-body solver for voxel chunks.
// Bodies are sets of voxels (cubes of edge S). Contacts:
//   chunk corners  vs ground plane y=0
//   surface voxel spheres vs static grid boxes (the wall that is still standing)
//   surface voxel spheres vs other chunks' surface voxel spheres (spatial hash)
//   ball sphere vs ground / static boxes / chunk voxels
// Solved with sequential impulses (normal + 2 friction directions, accumulated clamping).

const GRAV = 9.81;

export class Body {
  constructor() {
    this.id = 0;
    this.px = 0; this.py = 0; this.pz = 0;
    this.qx = 0; this.qy = 0; this.qz = 0; this.qw = 1;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.wx = 0; this.wy = 0; this.wz = 0;
    this.invM = 0;
    this.invIl = new Float64Array(9);
    this.invIw = new Float64Array(9);
    this.R = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    this.radius = 0;
    this.sleeping = false;
    this.sleepT = 0;
    this.age = 0;
    this.ghost = 0; // seconds after release during which static/sibling contacts are ignored (crack opening)
    this.isBall = false;
    this.ballR = 0;
    // voxel data
    this.vox = null;     // Int32Array global voxel ids
    this.local = null;   // Float32Array local centers (3 per voxel)
    this.surf = null;    // Int32Array indices into vox of surface voxels
    this.corners = null; // Float32Array local corner points
    this.wsurf = null;   // Float32Array world centers of surface voxels (cached per step)
  }

  updateR() {
    const { qx: x, qy: y, qz: z, qw: w } = this;
    const R = this.R;
    R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y - z * w); R[2] = 2 * (x * z + y * w);
    R[3] = 2 * (x * y + z * w); R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z - x * w);
    R[6] = 2 * (x * z - y * w); R[7] = 2 * (y * z + x * w); R[8] = 1 - 2 * (x * x + y * y);
    // invIw = R invIl R^T
    const A = this.invIl, o = this.invIw;
    const t = tmp9;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      t[i * 3 + j] = R[i * 3] * A[j] + R[i * 3 + 1] * A[3 + j] + R[i * 3 + 2] * A[6 + j];
    }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      o[i * 3 + j] = t[i * 3] * R[j * 3] + t[i * 3 + 1] * R[j * 3 + 1] + t[i * 3 + 2] * R[j * 3 + 2];
    }
  }

  wake() { this.sleeping = false; this.sleepT = 0; }
}
const tmp9 = new Float64Array(9);

function invert3(m, out) {
  const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const id = 1 / det;
  out[0] = A * id; out[1] = -(b * i - c * h) * id; out[2] = (b * f - c * e) * id;
  out[3] = B * id; out[4] = (a * i - c * g) * id; out[5] = -(a * f - c * d) * id;
  out[6] = C * id; out[7] = -(a * h - b * g) * id; out[8] = (a * e - b * d) * id;
}

class Contact {
  constructor() {
    this.a = null; this.b = null; this.bDyn = false;
    this.nx = 0; this.ny = 0; this.nz = 0;
    this.rax = 0; this.ray = 0; this.raz = 0;
    this.rbx = 0; this.rby = 0; this.rbz = 0;
    this.t1x = 0; this.t1y = 0; this.t1z = 0;
    this.t2x = 0; this.t2y = 0; this.t2z = 0;
    this.mN = 0; this.mT1 = 0; this.mT2 = 0;
    this.accN = 0; this.accT1 = 0; this.accT2 = 0;
    this.bias = 0; this.depth = 0; this.mu = 0.7;
  }
}

export class World {
  constructor(grid, opts = {}) {
    this.grid = grid; // { S, GX, GY, GZ, ox, oy, oz, occ }
    this.bodies = [];
    this.contacts = [];
    this.nContacts = 0;
    this.maxContacts = 24000;
    this.iterations = opts.iterations ?? 10;
    this.onImpact = null;   // (body, x,y,z, speed) for dust
    this.onBallHitWall = null; // (ball) -> bool (fractured)
    this.r = grid.S * 0.47;
    // spatial hash
    this.hashSize = 1 << 15;
    this.head = new Int32Array(this.hashSize);
    this.cap = 8192;
    this.next = new Int32Array(this.cap);
    this.eBody = new Int32Array(this.cap);
    this.ePos = new Float32Array(this.cap * 3);
    this.nextId = 1;
    this.pendingHits = [];
  }

  // ---------- body creation ----------
  createChunk(voxIds, centers, voxMass) {
    // centers: Float32Array world centers (3 per voxel), q = identity
    const S = this.grid.S;
    const n = voxIds.length;
    const b = new Body();
    b.id = this.nextId++;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += centers[i * 3]; cy += centers[i * 3 + 1]; cz += centers[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    b.px = cx; b.py = cy; b.pz = cz;
    const local = new Float32Array(n * 3);
    let I = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const m = voxMass;
    const i0 = m * S * S / 6;
    let rad = 0;
    for (let i = 0; i < n; i++) {
      const x = centers[i * 3] - cx, y = centers[i * 3 + 1] - cy, z = centers[i * 3 + 2] - cz;
      local[i * 3] = x; local[i * 3 + 1] = y; local[i * 3 + 2] = z;
      const r2 = x * x + y * y + z * z;
      rad = Math.max(rad, Math.sqrt(r2));
      I[0] += i0 + m * (r2 - x * x); I[4] += i0 + m * (r2 - y * y); I[8] += i0 + m * (r2 - z * z);
      I[1] -= m * x * y; I[2] -= m * x * z; I[5] -= m * y * z;
    }
    I[3] = I[1]; I[6] = I[2]; I[7] = I[5];
    invert3(I, b.invIl);
    b.invM = 1 / (m * n);
    b.radius = rad + S * 0.9;
    b.vox = Int32Array.from(voxIds);
    b.local = local;

    // surface voxels + corners (keys in doubled grid space relative to com)
    const key = (x, y, z) => `${Math.round(x / S * 2)},${Math.round(y / S * 2)},${Math.round(z / S * 2)}`;
    const set = new Set();
    for (let i = 0; i < n; i++) set.add(key(local[i * 3], local[i * 3 + 1], local[i * 3 + 2]));
    const surf = [];
    const cornerMap = new Map();
    const h = S * 0.5;
    for (let i = 0; i < n; i++) {
      const x = local[i * 3], y = local[i * 3 + 1], z = local[i * 3 + 2];
      if (!set.has(key(x + S, y, z)) || !set.has(key(x - S, y, z)) || !set.has(key(x, y + S, z)) ||
          !set.has(key(x, y - S, z)) || !set.has(key(x, y, z + S)) || !set.has(key(x, y, z - S))) {
        surf.push(i);
        for (let c = 0; c < 8; c++) {
          const px = x + ((c & 1) ? h : -h), py = y + ((c & 2) ? h : -h), pz = z + ((c & 4) ? h : -h);
          const k = key(px, py, pz);
          if (!cornerMap.has(k)) cornerMap.set(k, [px, py, pz]);
        }
      }
    }
    b.surf = Int32Array.from(surf);
    const cs = [...cornerMap.values()];
    b.corners = new Float32Array(cs.length * 3);
    cs.forEach((p, i) => { b.corners[i * 3] = p[0]; b.corners[i * 3 + 1] = p[1]; b.corners[i * 3 + 2] = p[2]; });
    b.wsurf = new Float32Array(surf.length * 3);
    b.updateR();
    this.bodies.push(b);
    return b;
  }

  createBall(radius, mass) {
    const b = new Body();
    b.id = this.nextId++;
    b.isBall = true;
    b.ballR = radius;
    b.radius = radius;
    b.invM = 1 / mass;
    const ii = 1 / (0.4 * mass * radius * radius);
    b.invIl.set([ii, 0, 0, 0, ii, 0, 0, 0, ii]);
    b.updateR();
    this.bodies.push(b);
    return b;
  }

  // ---------- contacts ----------
  _contact(a, b, bDyn, nx, ny, nz, px, py, pz, depth, dt, mu) {
    if (this.nContacts >= this.maxContacts) return;
    let c = this.contacts[this.nContacts];
    if (!c) { c = new Contact(); this.contacts[this.nContacts] = c; }
    this.nContacts++;
    c.a = a; c.b = b; c.bDyn = bDyn;
    c.nx = nx; c.ny = ny; c.nz = nz;
    c.rax = px - a.px; c.ray = py - a.py; c.raz = pz - a.pz;
    if (b) { c.rbx = px - b.px; c.rby = py - b.py; c.rbz = pz - b.pz; } else { c.rbx = c.rby = c.rbz = 0; }
    // tangents
    if (Math.abs(nx) < 0.9) { // t1 = n x X
      let tx = 0, ty = nz, tz = -ny; const l = Math.hypot(ty, tz); c.t1x = tx; c.t1y = ty / l; c.t1z = tz / l;
    } else {
      let tx = -nz, ty = 0, tz = nx; const l = Math.hypot(tx, tz); c.t1x = tx / l; c.t1y = ty; c.t1z = tz / l;
    }
    c.t2x = ny * c.t1z - nz * c.t1y; c.t2y = nz * c.t1x - nx * c.t1z; c.t2z = nx * c.t1y - ny * c.t1x;
    c.mN = 1 / this._k(c, nx, ny, nz);
    c.mT1 = 1 / this._k(c, c.t1x, c.t1y, c.t1z);
    c.mT2 = 1 / this._k(c, c.t2x, c.t2y, c.t2z);
    c.accN = 0; c.accT1 = 0; c.accT2 = 0;
    c.depth = depth;
    c.mu = mu;
    // restitution + penetration bias
    const vn = this._relVel(c, nx, ny, nz);
    const slop = 0.004;
    let bias = Math.min(Math.max(0, depth - slop) * 0.25 / dt, 2.0);
    if (vn < -1.2) bias = Math.max(bias, -vn * 0.12);
    c.bias = bias;
    if (vn < -1.0 && this.onImpact && !a.isBall) this.onImpact(a, px, py, pz, -vn);
    if (b && !bDyn && vn < -1.5) b.wake();
  }

  _k(c, dx, dy, dz) {
    const a = c.a;
    let k = a.invM + angTerm(a.invIw, c.rax, c.ray, c.raz, dx, dy, dz);
    if (c.b && c.bDyn) k += c.b.invM + angTerm(c.b.invIw, c.rbx, c.rby, c.rbz, dx, dy, dz);
    return k;
  }

  _relVel(c, dx, dy, dz) {
    const a = c.a;
    let vx = a.vx + a.wy * c.raz - a.wz * c.ray;
    let vy = a.vy + a.wz * c.rax - a.wx * c.raz;
    let vz = a.vz + a.wx * c.ray - a.wy * c.rax;
    if (c.b && c.bDyn) {
      const b = c.b;
      vx -= b.vx + b.wy * c.rbz - b.wz * c.rby;
      vy -= b.vy + b.wz * c.rbx - b.wx * c.rbz;
      vz -= b.vz + b.wx * c.rby - b.wy * c.rbx;
    }
    return vx * dx + vy * dy + vz * dz;
  }

  _apply(c, dx, dy, dz, l) {
    applyImp(c.a, dx * l, dy * l, dz * l, c.rax, c.ray, c.raz);
    if (c.b && c.bDyn) applyImp(c.b, -dx * l, -dy * l, -dz * l, c.rbx, c.rby, c.rbz);
  }

  _hashInsert(n, bodyIdx, x, y, z) {
    if (n >= this.cap) {
      this.cap *= 2;
      const nn = new Int32Array(this.cap); nn.set(this.next); this.next = nn;
      const nb = new Int32Array(this.cap); nb.set(this.eBody); this.eBody = nb;
      const np = new Float32Array(this.cap * 3); np.set(this.ePos); this.ePos = np;
    }
    const inv = 1 / (this.grid.S * 1.05);
    const h = cellHash(Math.floor(x * inv), Math.floor(y * inv), Math.floor(z * inv)) & (this.hashSize - 1);
    this.eBody[n] = bodyIdx;
    this.ePos[n * 3] = x; this.ePos[n * 3 + 1] = y; this.ePos[n * 3 + 2] = z;
    this.next[n] = this.head[h];
    this.head[h] = n;
  }

  generateContacts(dt) {
    this.nContacts = 0;
    const g = this.grid, S = g.S, r = this.r;
    const bodies = this.bodies;
    const wallMinX = g.ox, wallMaxX = g.ox + g.GX * S;
    const wallMinY = 0, wallMaxY = g.GY * S;
    const wallMinZ = g.oz, wallMaxZ = g.oz + g.GZ * S;

    // world positions of surface voxels
    for (const b of bodies) {
      if (b.isBall || b.sleeping) continue;
      const R = b.R, L = b.local, W = b.wsurf, sf = b.surf;
      for (let s = 0; s < sf.length; s++) {
        const i = sf[s] * 3;
        const x = L[i], y = L[i + 1], z = L[i + 2];
        W[s * 3] = R[0] * x + R[1] * y + R[2] * z + b.px;
        W[s * 3 + 1] = R[3] * x + R[4] * y + R[5] * z + b.py;
        W[s * 3 + 2] = R[6] * x + R[7] * y + R[8] * z + b.pz;
      }
    }

    // ground + static grid
    for (const b of bodies) {
      if (b.sleeping) continue;
      if (b.isBall) {
        const R0 = b.ballR;
        if (b.py < R0) this._contact(b, null, false, 0, 1, 0, b.px, b.py - R0, b.pz, R0 - b.py, dt, 0.6);
        // ball vs static boxes
        if (b.px + R0 > wallMinX && b.px - R0 < wallMaxX && b.py - R0 < wallMaxY && b.pz + R0 > wallMinZ && b.pz - R0 < wallMaxZ) {
          let hit = false;
          const i0 = Math.max(0, Math.floor((b.px - R0 - g.ox) / S)), i1 = Math.min(g.GX - 1, Math.floor((b.px + R0 - g.ox) / S));
          const j0 = Math.max(0, Math.floor((b.py - R0) / S)), j1 = Math.min(g.GY - 1, Math.floor((b.py + R0) / S));
          const k0 = Math.max(0, Math.floor((b.pz - R0 - g.oz) / S)), k1 = Math.min(g.GZ - 1, Math.floor((b.pz + R0 - g.oz) / S));
          for (let k = k0; k <= k1 && !hit; k++) for (let j = j0; j <= j1 && !hit; j++) for (let i = i0; i <= i1; i++) {
            if (!g.occ[i + g.GX * (j + g.GY * k)]) continue;
            const d = sphereBox(b.px, b.py, b.pz, R0, g.ox + i * S, j * S, g.oz + k * S, S);
            if (d) { hit = true; break; }
          }
          if (hit && this.onBallHitWall && this.onBallHitWall(b)) { this.pendingHits.push(b); }
          else if (hit) {
            for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
              if (!g.occ[i + g.GX * (j + g.GY * k)]) continue;
              const d = sphereBox(b.px, b.py, b.pz, R0, g.ox + i * S, j * S, g.oz + k * S, S);
              if (d) this._contact(b, null, false, d[0], d[1], d[2], d[3], d[4], d[5], d[6], dt, 0.5);
            }
          }
        }
        continue;
      }
      // chunk corners vs ground
      if (b.py - b.radius < 0.01) {
        const R = b.R, C = b.corners;
        for (let i = 0; i < C.length; i += 3) {
          const x = C[i], y = C[i + 1], z = C[i + 2];
          const wy = R[3] * x + R[4] * y + R[5] * z + b.py;
          if (wy < 0) {
            const wx = R[0] * x + R[1] * y + R[2] * z + b.px;
            const wz = R[6] * x + R[7] * y + R[8] * z + b.pz;
            this._contact(b, null, false, 0, 1, 0, wx, wy, wz, -wy, dt, 0.75);
          }
        }
      }
      // surface voxels vs static grid
      if (b.age >= b.ghost && b.px + b.radius > wallMinX && b.px - b.radius < wallMaxX && b.py - b.radius < wallMaxY &&
          b.pz + b.radius > wallMinZ && b.pz - b.radius < wallMaxZ) {
        const W = b.wsurf;
        for (let s = 0; s < b.surf.length; s++) {
          const x = W[s * 3], y = W[s * 3 + 1], z = W[s * 3 + 2];
          const ci = Math.floor((x - g.ox) / S), cj = Math.floor(y / S), ck = Math.floor((z - g.oz) / S);
          if (ci < -1 || ci > g.GX || cj < -1 || cj > g.GY || ck < -1 || ck > g.GZ) continue;
          for (let dk = -1; dk <= 1; dk++) {
            const k = ck + dk; if (k < 0 || k >= g.GZ) continue;
            for (let dj = -1; dj <= 1; dj++) {
              const j = cj + dj; if (j < 0 || j >= g.GY) continue;
              for (let di = -1; di <= 1; di++) {
                const i = ci + di; if (i < 0 || i >= g.GX) continue;
                if (!g.occ[i + g.GX * (j + g.GY * k)]) continue;
                const d = sphereBox(x, y, z, r, g.ox + i * S, j * S, g.oz + k * S, S);
                if (d) this._contact(b, null, false, d[0], d[1], d[2], d[3], d[4], d[5], d[6], dt, 0.4);
              }
            }
          }
        }
      }
    }

    // chunk vs chunk via spatial hash
    this.head.fill(-1);
    let n = 0;
    const entryStart = [];
    for (let bi = 0; bi < bodies.length; bi++) {
      const b = bodies[bi];
      entryStart.push(n);
      if (b.isBall) continue;
      const W = b.wsurf;
      for (let s = 0; s < b.surf.length; s++) { this._hashInsert(n, bi, W[s * 3], W[s * 3 + 1], W[s * 3 + 2]); n++; }
    }
    const inv = 1 / (S * 1.05);
    const d2max = (2 * r) * (2 * r);
    const next = this.next, eB = this.eBody, eP = this.ePos, head = this.head, hm = this.hashSize - 1;
    for (let e = 0; e < n; e++) {
      const a = bodies[eB[e]];
      if (a.sleeping) continue;
      const x = eP[e * 3], y = eP[e * 3 + 1], z = eP[e * 3 + 2];
      const cx = Math.floor(x * inv), cy = Math.floor(y * inv), cz = Math.floor(z * inv);
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        let o = head[cellHash(cx + dx, cy + dy, cz + dz) & hm];
        while (o !== -1) {
          const ob = eB[o];
          if (ob !== eB[e]) {
            const b = bodies[ob];
            if (!(o < e && !b.sleeping) && !(a.age < a.ghost && b.age < b.ghost)) {
              const ddx = x - eP[o * 3], ddy = y - eP[o * 3 + 1], ddz = z - eP[o * 3 + 2];
              const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
              if (d2 < d2max && d2 > 1e-10) {
                const d = Math.sqrt(d2);
                this._contact(a, b, !b.sleeping, ddx / d, ddy / d, ddz / d,
                  x - ddx * 0.5, y - ddy * 0.5, z - ddz * 0.5, 2 * r - d, dt, 0.65);
              }
            }
          }
          o = next[o];
        }
      }
    }

    // ball vs chunk voxels
    for (const ball of bodies) {
      if (!ball.isBall) continue;
      const R0 = ball.ballR;
      for (const b of bodies) {
        if (b.isBall) continue;
        const dxb = b.px - ball.px, dyb = b.py - ball.py, dzb = b.pz - ball.pz;
        const rr = b.radius + R0;
        if (dxb * dxb + dyb * dyb + dzb * dzb > rr * rr) continue;
        if (ball.sleeping && b.sleeping) continue;
        const W = b.wsurf;
        if (b.sleeping) { // refresh cached positions
          const R = b.R, L = b.local;
          for (let s = 0; s < b.surf.length; s++) {
            const i = b.surf[s] * 3, x = L[i], y = L[i + 1], z = L[i + 2];
            W[s * 3] = R[0] * x + R[1] * y + R[2] * z + b.px;
            W[s * 3 + 1] = R[3] * x + R[4] * y + R[5] * z + b.py;
            W[s * 3 + 2] = R[6] * x + R[7] * y + R[8] * z + b.pz;
          }
        }
        const lim = (R0 + r) * (R0 + r);
        for (let s = 0; s < b.surf.length; s++) {
          const ddx = ball.px - W[s * 3], ddy = ball.py - W[s * 3 + 1], ddz = ball.pz - W[s * 3 + 2];
          const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d2 < lim && d2 > 1e-10) {
            const d = Math.sqrt(d2);
            const nx = ddx / d, ny = ddy / d, nz = ddz / d;
            if (ball.sleeping) {
              this._contact(b, ball, false, -nx, -ny, -nz, ball.px - nx * R0, ball.py - ny * R0, ball.pz - nz * R0, R0 + r - d, dt, 0.5);
            } else {
              this._contact(ball, b, !b.sleeping, nx, ny, nz, ball.px - nx * R0, ball.py - ny * R0, ball.pz - nz * R0, R0 + r - d, dt, 0.5);
            }
          }
        }
      }
    }
  }

  step(dt) {
    const bodies = this.bodies;
    // gravity + damping
    for (const b of bodies) {
      if (b.sleeping) continue;
      b.age += dt;
      b.vy -= GRAV * dt;
      const ld = Math.max(0, 1 - 0.02 * dt), ad = Math.max(0, 1 - (b.isBall ? 0.3 : 0.6) * dt);
      b.vx *= ld; b.vy *= ld; b.vz *= ld;
      b.wx *= ad; b.wy *= ad; b.wz *= ad;
    }
    this.generateContacts(dt);
    const cs = this.contacts, nc = this.nContacts;
    for (let it = 0; it < this.iterations; it++) {
      for (let i = 0; i < nc; i++) {
        const c = cs[i];
        // normal
        const vn = this._relVel(c, c.nx, c.ny, c.nz);
        let l = c.mN * (c.bias - vn);
        const old = c.accN;
        c.accN = Math.max(0, old + l);
        l = c.accN - old;
        if (l !== 0) this._apply(c, c.nx, c.ny, c.nz, l);
        // friction
        const maxF = c.mu * c.accN;
        let vt = this._relVel(c, c.t1x, c.t1y, c.t1z);
        let lt = -c.mT1 * vt;
        let o1 = c.accT1;
        c.accT1 = Math.max(-maxF, Math.min(maxF, o1 + lt));
        lt = c.accT1 - o1;
        if (lt !== 0) this._apply(c, c.t1x, c.t1y, c.t1z, lt);
        vt = this._relVel(c, c.t2x, c.t2y, c.t2z);
        lt = -c.mT2 * vt;
        o1 = c.accT2;
        c.accT2 = Math.max(-maxF, Math.min(maxF, o1 + lt));
        lt = c.accT2 - o1;
        if (lt !== 0) this._apply(c, c.t2x, c.t2y, c.t2z, lt);
      }
    }
    // integrate
    for (const b of bodies) {
      if (b.sleeping) continue;
      b.px += b.vx * dt; b.py += b.vy * dt; b.pz += b.vz * dt;
      const { wx, wy, wz } = b;
      const { qx, qy, qz, qw } = b;
      const h = 0.5 * dt;
      b.qx += h * (wx * qw + wy * qz - wz * qy);
      b.qy += h * (wy * qw + wz * qx - wx * qz);
      b.qz += h * (wz * qw + wx * qy - wy * qx);
      b.qw += h * (-wx * qx - wy * qy - wz * qz);
      const ql = 1 / Math.hypot(b.qx, b.qy, b.qz, b.qw);
      b.qx *= ql; b.qy *= ql; b.qz *= ql; b.qw *= ql;
      b.updateR();
      // sleep test
      const v2 = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz;
      const w2 = b.wx * b.wx + b.wy * b.wy + b.wz * b.wz;
      const vth = b.isBall ? 0.02 : 0.03, wth = b.isBall ? 0.02 : 0.06;
      if (v2 < vth && w2 < wth && b.age > 0.3) {
        b.sleepT += dt;
        if (b.sleepT > 0.35) {
          b.sleeping = true;
          b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
        }
      } else b.sleepT = 0;
      if (b.py < -5) { b.sleeping = true; }
    }
  }
}

function angTerm(I, rx, ry, rz, dx, dy, dz) {
  // d . ((I (r x d)) x r)
  const cx = ry * dz - rz * dy, cy = rz * dx - rx * dz, cz = rx * dy - ry * dx;
  const tx = I[0] * cx + I[1] * cy + I[2] * cz;
  const ty = I[3] * cx + I[4] * cy + I[5] * cz;
  const tz = I[6] * cx + I[7] * cy + I[8] * cz;
  const ux = ty * rz - tz * ry, uy = tz * rx - tx * rz, uz = tx * ry - ty * rx;
  return ux * dx + uy * dy + uz * dz;
}

function applyImp(b, ix, iy, iz, rx, ry, rz) {
  b.vx += ix * b.invM; b.vy += iy * b.invM; b.vz += iz * b.invM;
  const cx = ry * iz - rz * iy, cy = rz * ix - rx * iz, cz = rx * iy - ry * ix;
  const I = b.invIw;
  b.wx += I[0] * cx + I[1] * cy + I[2] * cz;
  b.wy += I[3] * cx + I[4] * cy + I[5] * cz;
  b.wz += I[6] * cx + I[7] * cy + I[8] * cz;
}

function cellHash(x, y, z) {
  return Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
}

const sbOut = [0, 0, 0, 0, 0, 0, 0];
// sphere (c, r) vs axis-aligned box [m, m+S]; returns [nx,ny,nz, px,py,pz, depth] or null
function sphereBox(cx, cy, cz, r, mx, my, mz, S) {
  const qx = Math.max(mx, Math.min(cx, mx + S));
  const qy = Math.max(my, Math.min(cy, my + S));
  const qz = Math.max(mz, Math.min(cz, mz + S));
  let dx = cx - qx, dy = cy - qy, dz = cz - qz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    sbOut[0] = dx / d; sbOut[1] = dy / d; sbOut[2] = dz / d;
    sbOut[3] = qx; sbOut[4] = qy; sbOut[5] = qz; sbOut[6] = r - d;
    return sbOut;
  }
  // center inside box: push out along the axis of least penetration
  const h = S * 0.5;
  const lx = cx - (mx + h), ly = cy - (my + h), lz = cz - (mz + h);
  const ax = h - Math.abs(lx), ay = h - Math.abs(ly), az = h - Math.abs(lz);
  sbOut[0] = sbOut[1] = sbOut[2] = 0;
  if (ax <= ay && ax <= az) { sbOut[0] = Math.sign(lx) || 1; sbOut[6] = ax + r; }
  else if (ay <= az) { sbOut[1] = Math.sign(ly) || 1; sbOut[6] = ay + r; }
  else { sbOut[2] = Math.sign(lz) || 1; sbOut[6] = az + r; }
  sbOut[3] = cx; sbOut[4] = cy; sbOut[5] = cz;
  return sbOut;
}
