import * as THREE from 'three';

// Gradient dusk sky dome with sun glow and stars that fade in with dusk progress.
export function createSky() {
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 0.1, -1) },
    uP: { value: 0 },
    uTime: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // at far plane
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir; uniform float uP; uniform float uTime;
      varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      ${skyColorGLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = skyColor(d, uSunDir, uP);
        // stars
        if (d.y > 0.05) {
          vec3 q = d * 260.0;
          vec3 cell = floor(q);
          float h = hash(cell);
          if (h > 0.9975) {
            vec3 c = cell + 0.5;
            float dist = length(q - c);
            float tw = 0.7 + 0.3 * sin(uTime * 3.0 + h * 1000.0);
            col += vec3(0.9, 0.95, 1.0) * smoothstep(0.5, 0.0, dist) * tw * smoothstep(0.35, 0.9, uP) * smoothstep(0.05, 0.3, d.y) * 1.2;
          }
        }
        // dither against banding in 8-bit output
        col += (hash(vec3(gl_FragCoord.xy, uTime)) - 0.5) * 0.006;
        gl_FragColor = vec4(max(col, 0.0), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;

  const fogColor = new THREE.Color();
  return {
    mesh,
    fogColor,
    update(sunDir, p, time) {
      uniforms.uSunDir.value.copy(sunDir);
      uniforms.uP.value = p;
      uniforms.uTime.value = time;
      // fog = horizon colour averaged towards the sun side (computed on the CPU with the same formula)
      const h = horizon(p);
      fogColor.setRGB(h[0], h[1], h[2]);
    },
  };
}

// keep CPU fog in sync with the GLSL horizon colour
function mix(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }
function horizon(p) {
  const warm = mix([0.95, 0.42, 0.2], [0.32, 0.12, 0.14], p);
  const cool = mix([0.42, 0.3, 0.42], [0.07, 0.06, 0.13], p);
  return mix(cool, warm, 0.35);
}

const skyColorGLSL = /* glsl */`
vec3 skyColor(vec3 d, vec3 sunDir, float p) {
  float h = d.y;
  vec2 sd = normalize(sunDir.xz);
  float az = dot(normalize(d.xz + 1e-5), sd) * 0.5 + 0.5;      // 1 facing the sun
  vec3 warm = mix(vec3(0.95, 0.42, 0.2), vec3(0.32, 0.12, 0.14), p);
  vec3 cool = mix(vec3(0.42, 0.3, 0.42), vec3(0.07, 0.06, 0.13), p);
  vec3 horizon = mix(cool, warm, az * az);
  vec3 mid = mix(vec3(0.38, 0.3, 0.5), vec3(0.06, 0.06, 0.16), p);
  vec3 zenith = mix(vec3(0.12, 0.17, 0.38), vec3(0.012, 0.018, 0.06), p);
  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
  col = mix(col, zenith, smoothstep(0.15, 0.7, h));
  float s = max(dot(d, normalize(sunDir)), 0.0);
  col += vec3(1.0, 0.45, 0.18) * pow(s, 6.0) * 0.6 * (1.0 - 0.75 * p);
  col += vec3(1.0, 0.75, 0.45) * pow(s, 900.0) * 6.0 * (1.0 - p);
  if (h < 0.0) col = mix(col, cool * 0.6, smoothstep(0.0, -0.1, h));
  return col;
}`;
