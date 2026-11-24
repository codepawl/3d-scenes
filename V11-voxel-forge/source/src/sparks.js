import * as THREE from 'three';
import { heatColor } from './heat.js';
import { ANVIL_TOP, ANVIL_FACE, FLOOR_Y } from './world.js';

const TRAIL = 3; // voxels per spark: head + 2 trailing
const G = 130;

// Pooled spark particles, drawn as instanced voxel cubes.
export class Sparks {
  constructor(max, rand) {
    this.max = max;
    this.rand = rand;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.T = new Float32Array(max);
    this.life = new Float32Array(max);
    this.size = new Float32Array(max);
    this.kind = new Uint8Array(max); // 0 impact spark, 1 rising ember
    this.alive = 0;

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, max * TRAIL);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.colors = new Float32Array(max * TRAIL * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(this.colors, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.tmp = [0, 0, 0];
  }

  clear() { this.alive = 0; }

  spawn(x, y, z, vx, vy, vz, T, life, size, kind = 0) {
    if (this.alive >= this.max) return;
    const i = this.alive++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.T[i] = T; this.life[i] = life; this.size[i] = size; this.kind[i] = kind;
  }

  burst(x, y, z, n, heat) {
    const r = this.rand;
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2;
      const s = 18 + Math.pow(r(), 1.6) * 75;
      const up = 8 + r() * 45;
      const ox = (r() - 0.5) * 4, oz = (r() - 0.5) * 4;
      this.spawn(x + ox, y + r() * 0.5, z + oz, Math.cos(a) * s, up, Math.sin(a) * s,
        Math.min(1380, heat - 80 + r() * 260), 0.5 + r() * 1.1, 0.18 + r() * 0.2, 0);
    }
  }

  step(dt) {
    const { p, v, T, life, size, kind } = this;
    for (let i = 0; i < this.alive; i++) {
      const j = i * 3;
      const k = kind[i];
      const drag = k ? 1.5 : 0.9;
      v[j] -= v[j] * drag * dt; v[j + 2] -= v[j + 2] * drag * dt;
      v[j + 1] += (k ? 9 - v[j + 1] * 1.2 : -G - v[j + 1] * drag * 0.4) * dt;
      if (k) { v[j] += (this.rand() - 0.5) * 30 * dt; v[j + 2] += (this.rand() - 0.5) * 30 * dt; }
      const py0 = p[j + 1];
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      // bounce on the anvil face and the floor
      const onFace = p[j] > ANVIL_FACE.x0 && p[j] < ANVIL_FACE.x1 && p[j + 2] > ANVIL_FACE.z0 && p[j + 2] < ANVIL_FACE.z1;
      const floor = onFace && py0 >= ANVIL_TOP ? ANVIL_TOP : FLOOR_Y;
      if (p[j + 1] < floor + size[i] * 0.5) {
        p[j + 1] = floor + size[i] * 0.5;
        v[j + 1] = -v[j + 1] * 0.3; v[j] *= 0.55; v[j + 2] *= 0.55;
        life[i] -= 0.1;
        // some sparks split on impact
        if (!k && T[i] > 900 && this.rand() < 0.25 && Math.abs(v[j + 1]) > 6) {
          this.spawn(p[j], p[j + 1], p[j + 2], -v[j + 2] * 0.8, Math.abs(v[j + 1]) * 1.2, v[j] * 0.8, T[i] - 50, 0.3, size[i] * 0.7, 0);
        }
      }
      T[i] -= (k ? 0.35 : 1.1) * (T[i] - 300) * dt;
      life[i] -= dt;
      if (life[i] <= 0 || T[i] < 470) {
        // swap-remove
        const last = --this.alive;
        if (i !== last) {
          p[j] = p[last * 3]; p[j + 1] = p[last * 3 + 1]; p[j + 2] = p[last * 3 + 2];
          v[j] = v[last * 3]; v[j + 1] = v[last * 3 + 1]; v[j + 2] = v[last * 3 + 2];
          T[i] = T[last]; life[i] = life[last]; size[i] = size[last]; kind[i] = kind[last];
          i--;
        }
      }
    }
  }

  // Write instance buffers: each spark is a head voxel plus trailing voxels along -velocity.
  updateMesh() {
    const m = this.mesh.instanceMatrix.array, c = this.colors, tmp = this.tmp;
    let n = 0;
    for (let i = 0; i < this.alive; i++) {
      const j = i * 3;
      heatColor(this.T[i], tmp);
      const fade = Math.min(1, this.life[i] * 4);
      const sp = Math.hypot(this.v[j], this.v[j + 1], this.v[j + 2]);
      const step = Math.min(1.2, sp * 0.012) / Math.max(sp, 1e-3);
      for (let t = 0; t < TRAIL; t++) {
        const s = this.size[i] * (1 - t * 0.28);
        const o = n * 16;
        m[o] = s; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0;
        m[o + 4] = 0; m[o + 5] = s; m[o + 6] = 0; m[o + 7] = 0;
        m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = s; m[o + 11] = 0;
        m[o + 12] = this.p[j] - this.v[j] * step * t;
        m[o + 13] = this.p[j + 1] - this.v[j + 1] * step * t;
        m[o + 14] = this.p[j + 2] - this.v[j + 2] * step * t;
        m[o + 15] = 1;
        const f = fade * Math.pow(0.55, t) * 9.0;
        c[n * 3] = tmp[0] * f; c[n * 3 + 1] = tmp[1] * f; c[n * 3 + 2] = tmp[2] * f;
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
