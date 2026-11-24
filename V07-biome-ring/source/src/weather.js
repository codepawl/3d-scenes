// Weather as moving voxels. Every particle collides against the voxel grid; snow and sand can write back into it.
import * as THREE from 'three';
import { B, SMALL, OPAQUE, SX, SY, SZ, CX, CZ, WL, DESERT, TUNDRA, WETLAND, BIOME_ANGLE, RING_MID } from './world.js';
import { mulberry32 } from './noise.js';

const SPAWN_Y = 34;

function instanced(geo, mat, count) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  return m;
}

export class Weather {
  constructor(world, scene, seed = 3) {
    this.world = world;
    this.rng = mulberry32(seed);
    this.time = 0;
    // candidate spawn columns per biome (land plus a little shore)
    this.cols = [[], [], []];
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
      const i = x + z * SX;
      if (world.ringT[i] < -0.25) continue;
      const k = world.biome[i];
      if (world.weights[i * 3 + k] < 0.55) continue;
      this.cols[k].push(i);
    }

    this.sys = [];
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, emissive: 0xb4c2d6, emissiveIntensity: 0.35 });
    const rainMat = new THREE.MeshStandardMaterial({ color: 0xd6e4ee, roughness: 0.2, transparent: true, opacity: 0.58, emissive: 0x7890a4, emissiveIntensity: 0.35, depthWrite: false });
    const sandMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    this.buildClouds(scene);
    this.snow = this.makeSys(TUNDRA, 8000, new THREE.BoxGeometry(0.28, 0.28, 0.28), snowMat, scene);
    this.rain = this.makeSys(WETLAND, 7000, new THREE.BoxGeometry(0.14, 1.5, 0.14), rainMat, scene);
    this.sand = this.makeSys(DESERT, 7500, new THREE.BoxGeometry(0.22, 0.22, 0.22), sandMat, scene);
    this.splash = this.makeSys(WETLAND, 3000, new THREE.BoxGeometry(0.13, 0.13, 0.13), rainMat, scene);
    // two-tone sand so grains read against the dunes: dark ochre grains and pale dust
    const ca = new THREE.Color(0x9a6530), cb = new THREE.Color(0xf0dcb4), tmp = new THREE.Color();
    for (let i = 0; i < this.sand.count; i++) this.sand.mesh.setColorAt(i, tmp.copy(ca).lerp(cb, this.rng() < 0.6 ? this.rng() * 0.25 : 0.75 + this.rng() * 0.25));
    this.splash.life.fill(0);
    this.splashNext = 0;
    for (const s of [this.snow, this.rain, this.sand]) for (let i = 0; i < s.count; i++) this.spawn(s, i, true);
    for (let i = 0; i < this.splash.count; i++) this.hide(this.splash, i);
  }

  // a random point under one of this biome's visible cloud puffs (rain/snow shafts), or null
  underCloud(biome) {
    const grp = this.puffs.find((g) => g.list[0].biome === biome);
    const pf = grp.list[Math.floor(this.rng() * grp.list.length)];
    if (pf.sc < 0.6) return null;
    const a = this.rng() * Math.PI * 2, rr = Math.sqrt(this.rng()) * pf.R * 1.4;
    const x = pf.cx + Math.cos(a) * rr, z = pf.cz + Math.sin(a) * rr;
    if (x < 0 || z < 0 || x >= SX || z >= SZ) return null;
    return [x, z, pf.y];
  }

  makeSys(biome, count, geo, mat, scene) {
    const mesh = instanced(geo, mat, count);
    const arr = mesh.instanceMatrix.array;
    for (let i = 0; i < count; i++) { arr[i * 16] = 1; arr[i * 16 + 5] = 1; arr[i * 16 + 10] = 1; arr[i * 16 + 15] = 1; }
    scene.add(mesh);
    const s = { biome, count, mesh, pos: new Float32Array(count * 3), vel: new Float32Array(count * 3), life: new Float32Array(count), seed: new Float32Array(count) };
    for (let i = 0; i < count; i++) s.seed[i] = this.rng() * 100;
    return s;
  }

  hide(s, i) { s.pos[i * 3 + 1] = -1000; s.life[i] = 0; }

  spawn(s, i, initial) {
    const r = this.rng;
    const list = this.cols[s.biome];
    const ci = list[Math.floor(r() * list.length)];
    const x = (ci % SX) + r(), z = Math.floor(ci / SX) + r();
    const p = s.pos, v = s.vel, o = i * 3;
    p[o] = x; p[o + 2] = z;
    const ground = this.world.height[ci];
    if (s === this.snow || s === this.rain) {
      // most precipitation falls in shafts below the cloud puffs, the rest is spread over the sector
      const uc = r() < (s === this.rain ? 0.3 : 0.45) ? this.underCloud(s.biome) : null;
      let top = SPAWN_Y - 4;
      if (uc) { p[o] = uc[0]; p[o + 2] = uc[1]; top = uc[2]; }
      const gy = uc ? Math.max(WL, this.world.height[Math.floor(uc[0]) + Math.floor(uc[1]) * SX]) : ground;
      p[o + 1] = initial ? gy + 1 + r() * (top - gy) : top - r() * 1.5;
      if (s === this.snow) { v[o] = 0.6; v[o + 1] = -(1.6 + r() * 1.2); v[o + 2] = 0; }
      else { v[o] = 1.2; v[o + 1] = -(17 + r() * 5); v[o + 2] = 0.6; }
    } else {
      const high = r() < 0.4;
      p[o + 1] = Math.max(ground, WL) + 1.05 + (high ? 1.5 + r() * 7 : r() * 1.5);
      const dx = x - CX, dz = z - CZ, rr = Math.hypot(dx, dz) || 1;
      const sp = 7 + r() * 5;
      // wind blows along the ring (counter-clockwise) with a slight outward component
      v[o] = (-dz / rr) * sp + (dx / rr) * 0.8; v[o + 2] = (dx / rr) * sp + (dz / rr) * 0.8;
      v[o + 1] = high ? (r() - 0.5) : 1 + r() * 2;
      s.life[i] = (high ? 2 : 1) + r() * 3;
      s.seed[i] = high ? 1 : 0;
    }
  }

  blocked(b) { return b !== B.AIR && !SMALL[b]; }

  step(dt) {
    this.time += dt;
    const w = this.world, r = this.rng, t = this.time;
    // ---- snow
    {
      const s = this.snow, p = s.pos, v = s.vel;
      for (let i = 0; i < s.count; i++) {
        const o = i * 3, sd = s.seed[i];
        p[o] += (v[o] + Math.sin(t * 0.9 + sd) * 1.3) * dt;
        p[o + 1] += v[o + 1] * dt;
        p[o + 2] += (Math.cos(t * 0.7 + sd * 1.3) * 1.3) * dt;
        const ix = Math.floor(p[o]), iy = Math.floor(p[o + 1]), iz = Math.floor(p[o + 2]);
        if (ix < 0 || iz < 0 || ix >= SX || iz >= SZ || iy < 0) { this.spawn(s, i, false); continue; }
        if (iy >= SY) continue;
        if (w.ringT[ix + iz * SX] < -0.45) { this.spawn(s, i, false); continue; }
        const b = w.grid[ix + SX * (iz + SZ * iy)];
        if (!this.blocked(b)) continue;
        this.depositSnow(ix, iy, iz, b);
        this.spawn(s, i, false);
      }
    }
    // ---- rain
    {
      const s = this.rain, p = s.pos, v = s.vel;
      for (let i = 0; i < s.count; i++) {
        const o = i * 3;
        p[o] += v[o] * dt; p[o + 1] += v[o + 1] * dt; p[o + 2] += v[o + 2] * dt;
        const ix = Math.floor(p[o]), iy = Math.floor(p[o + 1] - 0.35), iz = Math.floor(p[o + 2]);
        if (ix < 0 || iz < 0 || ix >= SX || iz >= SZ || iy < 0) { this.spawn(s, i, false); continue; }
        if (iy >= SY) continue;
        const b = w.grid[ix + SX * (iz + SZ * iy)];
        if (!this.blocked(b)) continue;
        const surf = b === B.WATER ? iy + 0.86 : iy + 1.0;
        if (r() < 0.6) this.emitSplash(p[o], surf, p[o + 2], 2);
        this.spawn(s, i, false);
      }
      const q = this.splash, qp = q.pos, qv = q.vel;
      for (let i = 0; i < q.count; i++) {
        if (q.life[i] <= 0) continue;
        const o = i * 3;
        q.life[i] -= dt;
        qv[o + 1] -= 22 * dt;
        qp[o] += qv[o] * dt; qp[o + 1] += qv[o + 1] * dt; qp[o + 2] += qv[o + 2] * dt;
        if (q.life[i] <= 0) this.hide(q, i);
      }
    }
    // ---- sand: saltating grains + suspended dust
    {
      const s = this.sand, p = s.pos, v = s.vel;
      for (let i = 0; i < s.count; i++) {
        const o = i * 3, high = s.seed[i] === 1;
        s.life[i] -= dt;
        if (high) v[o + 1] = Math.sin(t * 1.7 + i) * 0.6;
        else v[o + 1] -= 9 * dt;
        const nx = p[o] + v[o] * dt, ny = p[o + 1] + v[o + 1] * dt, nz = p[o + 2] + v[o + 2] * dt;
        const ix = Math.floor(nx), iy = Math.floor(ny), iz = Math.floor(nz);
        if (s.life[i] <= 0 || ix < 0 || iz < 0 || ix >= SX || iz >= SZ || iy < 0 || iy >= SY) { this.spawn(s, i, false); continue; }
        const ci = ix + iz * SX;
        if (w.weights[ci * 3 + DESERT] < 0.35 || w.ringT[ci] < -0.12) { this.spawn(s, i, false); continue; }
        const b = w.grid[ix + SX * (iz + SZ * iy)];
        if (this.blocked(b)) {
          // landed or hit an obstacle: maybe pile up against rock, then hop again
          const fy = Math.floor(p[o + 1]);
          if (iy < fy || b === B.WATER) {
            if (b !== B.WATER && b !== B.SAND && b !== B.CACTUS && r() < 0.004) this.depositSand(ix, iy, iz);
            v[o + 1] = 1.5 + r() * 2.5;
            p[o] = nx; p[o + 2] = nz; p[o + 1] = iy + 1.02;
            if (b === B.WATER) { this.spawn(s, i, false); }
          } else {
            // hit a wall sideways: deflect upward and slow down
            v[o] *= -0.3; v[o + 2] *= -0.3; v[o + 1] = 3;
            if (r() < 0.01) this.depositSand(Math.floor(p[o]), Math.floor(p[o + 1]) - 1, Math.floor(p[o + 2]));
          }
          continue;
        }
        p[o] = nx; p[o + 1] = ny; p[o + 2] = nz;
        // re-accelerate towards the wind
        const dx = nx - CX, dz = nz - CZ, rr = Math.hypot(dx, dz) || 1;
        const tx = -dz / rr * 9, tz = dx / rr * 9;
        v[o] += (tx - v[o]) * 1.5 * dt; v[o + 2] += (tz - v[o + 2]) * 1.5 * dt;
      }
    }
    this.stepClouds(dt);
  }

  emitSplash(x, y, z, n) {
    const q = this.splash, r = this.rng;
    for (let k = 0; k < n; k++) {
      const i = this.splashNext; this.splashNext = (this.splashNext + 1) % q.count;
      const o = i * 3;
      q.pos[o] = x; q.pos[o + 1] = y + 0.05; q.pos[o + 2] = z;
      const a = r() * Math.PI * 2, sp = 0.6 + r() * 1.2;
      q.vel[o] = Math.cos(a) * sp; q.vel[o + 1] = 2.2 + r() * 2.2; q.vel[o + 2] = Math.sin(a) * sp;
      q.life[i] = 0.18 + r() * 0.2;
    }
  }

  // Snow lands in the air cell above the hit cell. It whitens exposed rock, wood and needles first,
  // then (rarely) thickens existing snow, at most two cells per column.
  depositSnow(ix, iy, iz, hit) {
    const w = this.world, y = iy + 1;
    if (y >= SY || w.get(ix, y, iz) !== B.AIR) return;
    const ci = ix + iz * SX;
    if (w.weights[ci * 3 + TUNDRA] < 0.5) return;
    let p = 0;
    if (hit === B.STONE || hit === B.GRAVEL || hit === B.DIRT || hit === B.ICE) p = 0.09;
    else if (hit === B.PINE || hit === B.WOOD) p = 0.12;
    else if (hit === B.SNOW) p = 0.006;
    if (p === 0 || w.snowAdded[ci] >= 2 || this.rng() > p) return;
    w.snowAdded[ci]++;
    w.set(ix, y, iz, B.SNOW);
  }

  depositSand(ix, iy, iz) {
    const w = this.world, y = iy + 1;
    if (y >= SY || w.get(ix, y, iz) !== B.AIR) return;
    const ci = ix + iz * SX;
    if (w.snowAdded[ci] >= 2 || !OPAQUE[w.get(ix, iy, iz)]) return;
    w.snowAdded[ci]++;
    w.set(ix, y, iz, B.SAND);
  }

  // ---- voxel cloud puffs drifting along each wet/cold sector
  buildClouds(scene) {
    const r = this.rng;
    this.puffs = [];
    const offsets = [];
    const defs = [[TUNDRA, 5, 0xe8ecf0, -0.98, 0.98], [WETLAND, 4, 0x8a9096, -1.0, 0.1]];
    for (const [biome, n, color, lo, hi] of defs) {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 1.0, emissive: color, emissiveIntensity: 0.12 });
      const list = [];
      let total = 0;
      for (let k = 0; k < n; k++) {
        const cells = [];
        const R = 2.6 + r() * 1.6, Rz = 1.8 + r() * 1.0;
        for (let j = 0; j < 2; j++) for (let c = -5; c <= 5; c++) for (let a = -5; a <= 5; a++) {
          const sj = j === 0 ? 1 : 0.6;
          const q = (a * a) / (R * R * sj * sj) + (c * c) / (Rz * Rz * sj * sj);
          if (q < 1 - r() * 0.3) cells.push(a, j, c);
        }
        list.push({ biome, cells, lo, hi, R: R * 1.5, sc: 1, cx: 0, cz: 0, th: BIOME_ANGLE[biome] + lo + ((k + 0.5) / n) * (hi - lo) + (r() - 0.5) * 0.1, rad: RING_MID + (r() - 0.5) * 12, y: SPAWN_Y - 7 + r() * 2, sp: 0.04 + r() * 0.015 });
        total += cells.length / 3;
      }
      const mesh = instanced(new THREE.BoxGeometry(1.5, 1.5, 1.5), mat, total);
      mesh.castShadow = true;
      scene.add(mesh);
      this.puffs.push({ mesh, list });
    }
    this.stepClouds(0);
  }

  stepClouds(dt) {
    for (const grp of this.puffs) {
      const arr = grp.mesh.instanceMatrix.array;
      let n = 0;
      for (const pf of grp.list) {
        pf.th += pf.sp * dt;
        const c0 = BIOME_ANGLE[pf.biome];
        let d = pf.th - c0;
        if (d > pf.hi) { pf.th -= pf.hi - pf.lo; d -= pf.hi - pf.lo; }
        const sc = Math.min(1, Math.max(0, Math.min(pf.hi - d, d - pf.lo) / 0.25));
        const cx = CX + Math.cos(pf.th) * pf.rad, cz = CZ + Math.sin(pf.th) * pf.rad;
        pf.cx = cx; pf.cz = cz; pf.sc = sc;
        const ca = Math.cos(pf.th), sa = Math.sin(pf.th);
        for (let k = 0; k < pf.cells.length; k += 3) {
          const a = pf.cells[k] * 1.5, j = pf.cells[k + 1] * 1.5, c = pf.cells[k + 2] * 1.5;
          // long axis along the tangent
          const lx = -sa * a + ca * c, lz = ca * a + sa * c;
          const o = n * 16;
          arr[o] = sc; arr[o + 5] = sc; arr[o + 10] = sc; arr[o + 15] = 1;
          arr[o + 12] = cx + lx * sc; arr[o + 13] = sc > 0 ? pf.y + j * sc : -1000; arr[o + 14] = cz + lz * sc;
          n++;
        }
      }
      grp.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // write particle positions into the instance matrices
  sync() {
    for (const s of [this.snow, this.rain, this.sand, this.splash]) {
      const arr = s.mesh.instanceMatrix.array, p = s.pos;
      for (let i = 0; i < s.count; i++) {
        const o = i * 16, q = i * 3;
        arr[o + 12] = p[q]; arr[o + 13] = p[q + 1]; arr[o + 14] = p[q + 2];
      }
      s.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
