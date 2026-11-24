import * as THREE from 'three';

// Simple CPU dust puffs: soft billboards that expand, drift, slow down and fade.
export class Dust {
  constructor(max = 3000) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);   // remaining
    this.life0 = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.shade = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aShade = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aAlpha', this.aAlpha);
    g.setAttribute('aShade', this.aShade);
    g.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 720 }, uCol: { value: new THREE.Color().setRGB(0.62, 0.50, 0.42, THREE.SRGBColorSpace) } },
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute float aShade; uniform float uScale;
        varying float vA; varying float vS;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / -mv.z; vA = aAlpha; vS = aShade; }`,
      fragmentShader: `varying float vA; varying float vS; uniform vec3 uCol;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0;
          float a = smoothstep(1.0, 0.2, r) * vA; if (a < 0.003) discard;
          vec3 c = uCol * (0.75 + 0.35 * vS) * (0.85 + 0.25 * (0.5 - d.y));
          gl_FragColor = vec4(c, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  emit(x, y, z, count, speed, rng, spread = 1, size = 0.5, life = 2.5, dir = null) {
    for (let c = 0; c < count; c++) {
      let i = this.n < this.max ? this.n++ : Math.floor(rng() * this.max);
      const th = rng() * Math.PI * 2, ph = Math.acos(2 * rng() - 1);
      const s = speed * (0.3 + 0.7 * rng());
      let vx = Math.sin(ph) * Math.cos(th) * s, vy = Math.abs(Math.cos(ph)) * s * 0.6, vz = Math.sin(ph) * Math.sin(th) * s;
      if (dir) { vx += dir[0] * speed * rng(); vy += dir[1] * speed * rng(); vz += dir[2] * speed * rng(); }
      this.pos[i * 3] = x + (rng() - 0.5) * spread; this.pos[i * 3 + 1] = y + (rng() - 0.5) * spread * 0.5; this.pos[i * 3 + 2] = z + (rng() - 0.5) * spread;
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
      this.life0[i] = this.life[i] = life * (0.6 + 0.8 * rng());
      this.size0[i] = size * (0.6 + 0.8 * rng());
      this.shade[i] = rng();
    }
  }

  update(dt) {
    const P = this.pos, V = this.vel;
    const ap = this.aPos.array, as = this.aSize.array, aa = this.aAlpha.array, ash = this.aShade.array;
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { aa[i] = 0; continue; }
      this.life[i] -= dt;
      V[i * 3] *= drag; V[i * 3 + 1] = V[i * 3 + 1] * drag + 0.12 * dt; V[i * 3 + 2] *= drag;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      if (P[i * 3 + 1] < 0.05) { P[i * 3 + 1] = 0.05; V[i * 3 + 1] = Math.abs(V[i * 3 + 1]) * 0.2; }
      const t = 1 - this.life[i] / this.life0[i];
      ap[i * 3] = P[i * 3]; ap[i * 3 + 1] = P[i * 3 + 1]; ap[i * 3 + 2] = P[i * 3 + 2];
      as[i] = this.size0[i] * (0.4 + 2.2 * Math.sqrt(t));
      aa[i] = 0.4 * Math.min(1, t * 8) * (1 - t) * (1 - t);
      ash[i] = this.shade[i];
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = this.aShade.needsUpdate = true;
  }
}
