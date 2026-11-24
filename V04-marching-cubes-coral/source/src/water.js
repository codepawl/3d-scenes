import * as THREE from 'three';
import { GLSL_COMMON } from './material.js';

// Backdrop sphere: the same waterColor() the reef fog fades towards, plus faint light shafts.
export function makeBackdrop(shared) {
  const mat = new THREE.ShaderMaterial({
    uniforms: shared,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
        vec4 p = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position, 1.0)).xyz, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: GLSL_COMMON + /* glsl */`
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = waterColor(d);
        // soft shafts falling from the surface
        float a = atan(d.x, d.z);
        float shafts = vnoise(vec3(a * 9.0, uTime * 0.12, 0.0)) * vnoise(vec3(a * 23.0, uTime * 0.2, 4.0));
        c += uSunTint * shafts * 0.10 * smoothstep(-0.1, 0.6, d.y);
        // dither against banding
        c += (hash13(vec3(gl_FragCoord.xy, uTime * 60.0)) - 0.5) / 255.0;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}

// Drifting particulate ("marine snow"). Positions are a pure function of time so capture is deterministic.
export function makeSnow(shared, count = 2600, box = 150) {
  const geo = new THREE.BufferGeometry();
  const base = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  let s = 12345;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    base[i * 3] = (rnd() - 0.5) * box;
    base[i * 3 + 1] = rnd() * 110;
    base[i * 3 + 2] = (rnd() - 0.5) * box;
    seed[i] = rnd();
  }
  geo.setAttribute('position', new THREE.BufferAttribute(base, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uPixelRatio: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform float uTime;
      uniform float uPixelRatio;
      attribute float seed;
      varying float vFade;
      void main() {
        vec3 p = position;
        p.y = mod(p.y - uTime * (0.6 + seed * 1.2), 110.0);
        p.x += sin(uTime * 0.3 + seed * 40.0) * 1.5;
        p.z += cos(uTime * 0.25 + seed * 31.0) * 1.5;
        vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        gl_PointSize = clamp((0.6 + seed * 1.6) * 220.0 / dist, 1.0, 9.0) * uPixelRatio;
        vFade = exp(-dist * 0.012) * smoothstep(2.0, 12.0, dist) * (0.35 + 0.65 * seed);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vFade;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float a = exp(-dot(q, q) * 3.0) * vFade * 0.55;
        gl_FragColor = vec4(vec3(0.75, 0.88, 0.92) * a, a);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}
