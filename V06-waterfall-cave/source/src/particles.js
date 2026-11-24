// Instanced foam voxels and mist cubes, stepped deterministically with the simulation.
import * as THREE from 'three';
import { NX, NZ, LAYER } from './world.js';

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
const tmpE = new THREE.Euler();

function cellPos(c) {
  return [c % NX, (c / LAYER) | 0, ((c / NX) | 0) % NZ];
}

export class Foam {
  constructor(count, rand) {
    this.n = count; this.rand = rand;
    this.p = new Float32Array(count * 3); this.v = new Float32Array(count * 3);
    this.life = new Float32Array(count); this.max = new Float32Array(count); this.size = new Float32Array(count);
    this.rot = new Float32Array(count * 3);
    this.cursor = 0;
    const g = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.MeshStandardMaterial({ color: 0xe8f2f2, roughness: 0.55, metalness: 0, emissive: 0x2a3436 });
    this.mesh = new THREE.InstancedMesh(g, m, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
  }
  spawn(x, y, z, vx, vy, vz, life, size) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.n;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.size[i] = size;
    const r = this.rand;
    this.rot[i * 3] = r() * 6.28; this.rot[i * 3 + 1] = r() * 6.28; this.rot[i * 3 + 2] = r() * 6.28;
  }
  step(dt, lips, impacts, mass) {
    const r = this.rand;
    // emit at lips: small cubes tumbling over the edge
    for (let k = 0; k < lips.length; k++) {
      if (r() > 0.35) continue;
      const [x, y, z] = cellPos(lips[k]);
      this.spawn(x + r(), y + 0.6 + r() * 0.5, z + r(), (r() - 0.5) * 1.2, 0.5 + r() * 1.5, (r() - 0.3) * 1.5, 0.4 + r() * 0.5, 0.18 + r() * 0.2);
    }
    // emit at impacts: splash outwards
    for (let k = 0; k < impacts.length; k++) {
      if (r() > 0.55) continue;
      const c = impacts[k];
      const [x, y, z] = cellPos(c);
      const top = y + Math.min(1, mass[c]);
      const a = r() * 6.283, sp = 1 + r() * 3.5;
      this.spawn(x + r(), top, z + r(), Math.cos(a) * sp, 2 + r() * 4, Math.sin(a) * sp, 0.35 + r() * 0.6, 0.15 + r() * 0.25);
    }
    const m = this.mesh;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { tmpM.makeScale(0, 0, 0); m.setMatrixAt(i, tmpM); continue; }
      this.life[i] -= dt;
      const o = i * 3;
      this.v[o + 1] -= 14 * dt;
      this.v[o] *= 0.98; this.v[o + 2] *= 0.98;
      this.p[o] += this.v[o] * dt; this.p[o + 1] += this.v[o + 1] * dt; this.p[o + 2] += this.v[o + 2] * dt;
      this.rot[o] += dt * 5; this.rot[o + 1] += dt * 3;
      const f = Math.max(0, this.life[i] / this.max[i]);
      const s = this.size[i] * Math.min(1, f * 2.5);
      tmpE.set(this.rot[o], this.rot[o + 1], this.rot[o + 2]);
      tmpQ.setFromEuler(tmpE);
      tmpP.set(this.p[o], this.p[o + 1], this.p[o + 2]);
      tmpS.set(s, s, s);
      tmpM.compose(tmpP, tmpQ, tmpS);
      m.setMatrixAt(i, tmpM);
    }
    m.instanceMatrix.needsUpdate = true;
  }
}

const mistVert = /* glsl */`
attribute float aAlpha;
varying float vAlpha;
varying vec3 vWPos;
varying vec3 vN;
void main(){
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const mistFrag = /* glsl */`
uniform vec3 uMist; uniform vec3 uSun; uniform vec3 uShaftO; uniform vec3 uShaftD; uniform float uShaftR;
uniform vec3 uFogColor; uniform float uFogDensity; uniform vec3 uCam;
varying float vAlpha; varying vec3 vWPos; varying vec3 vN;
void main(){
  vec3 rel = vWPos - uShaftO;
  float t = dot(rel, uShaftD);
  float d = length(rel - t * uShaftD);
  float lit = smoothstep(uShaftR, uShaftR * 0.4, d) * step(0.0, t);
  float shade = 0.75 + 0.25 * vN.y;
  vec3 col = uMist * shade + uSun * lit;
  float dist = length(vWPos - uCam);
  float a = vAlpha * smoothstep(1.5, 5.0, dist);
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, fog * 0.7);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Mist {
  constructor(count, rand, uniforms) {
    this.n = count; this.rand = rand;
    this.p = new Float32Array(count * 3); this.v = new Float32Array(count * 3);
    this.life = new Float32Array(count); this.max = new Float32Array(count); this.size = new Float32Array(count);
    this.cursor = 0;
    const g = new THREE.BoxGeometry(1, 1, 1);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.alpha.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aAlpha', this.alpha);
    const mat = new THREE.ShaderMaterial({
      vertexShader: mistVert, fragmentShader: mistFrag, uniforms,
      transparent: true, depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(g, mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }
  spawn(x, y, z, life, size, vx, vy, vz) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.n;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.size[i] = size;
  }
  step(dt, impacts, mass, time) {
    const r = this.rand;
    for (let k = 0; k < impacts.length; k++) {
      if (r() > 0.2) continue;
      const c = impacts[k];
      const [x, y, z] = cellPos(c);
      this.spawn(x + r(), y + Math.min(1, mass[c]) + 0.2, z + r(), 3 + r() * 4, 0.35 + r() * 0.5,
        (r() - 0.5) * 1.5, 0.4 + r() * 0.9, (r() - 0.3) * 1.5);
    }
    const m = this.mesh;
    const A = this.alpha.array;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { tmpM.makeScale(0, 0, 0); m.setMatrixAt(i, tmpM); A[i] = 0; continue; }
      this.life[i] -= dt;
      const o = i * 3;
      // gentle swirl + buoyancy
      const px = this.p[o], py = this.p[o + 1], pz = this.p[o + 2];
      this.v[o] += Math.sin(py * 0.7 + time * 0.9 + pz * 0.3) * 0.6 * dt;
      this.v[o + 2] += Math.cos(px * 0.6 + time * 0.7) * 0.6 * dt + 0.15 * dt;
      this.v[o + 1] += 0.1 * dt;
      this.v[o] *= 0.985; this.v[o + 1] *= 0.985; this.v[o + 2] *= 0.985;
      this.p[o] = px + this.v[o] * dt; this.p[o + 1] = py + this.v[o + 1] * dt; this.p[o + 2] = pz + this.v[o + 2] * dt;
      const f = this.life[i] / this.max[i];
      const s = this.size[i] * (1 + (1 - f) * 2.2);
      tmpP.set(this.p[o], this.p[o + 1], this.p[o + 2]);
      tmpQ.identity();
      tmpS.set(s, s, s);
      tmpM.compose(tmpP, tmpQ, tmpS);
      m.setMatrixAt(i, tmpM);
      A[i] = 0.22 * Math.min(1, (1 - f) * 6) * f;
    }
    m.instanceMatrix.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}
