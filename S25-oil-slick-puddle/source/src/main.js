import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import commonGlsl from './shaders/common.glsl?raw';
import groundFrag from './shaders/ground.frag?raw';
import { filmWeights } from './spectral.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const SS = parseFloat(params.get('ss') || (CAPTURE ? '2' : '1')); // internal supersampling
const W0 = 1280, H0 = 720;
const T_OFFSET = 4.0; // seconds of "history" before frame 0 so rings and oil are already in motion

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.autoClear = true;
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(42, W0 / H0, 0.05, 60);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101012);

const rt = new THREE.WebGLRenderTarget(W0, H0, {
  type: THREE.HalfFloatType, samples: 4, depthBuffer: true,
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
});

// ---------------------------------------------------------------- ground / puddle
const { weights, lambdas } = filmWeights(16, 400, 700);
const lampPos = new THREE.Vector3(-2.2, 4.6, -5.2);
const groundMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uRain: { value: 1 },
    uCamPos: { value: new THREE.Vector3() },
    uLampPos: { value: lampPos },
    uFilmW: { value: weights.map((w) => new THREE.Vector3(...w)) },
    uLambda: { value: lambdas },
  },
  vertexShader: /* glsl */ `
    varying vec3 vWorld;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: groundFrag.replace('#include <common_noise>', commonGlsl),
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), groundMat);
scene.add(ground);

// ---------------------------------------------------------------- rain streaks
const N_RAIN = 900;
const rainGeo = new THREE.InstancedBufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3));
rainGeo.setIndex([0, 1, 2, 0, 2, 3]);
const seeds = new Float32Array(N_RAIN * 4);
let sr = 12345;
const rnd = () => ((sr = (sr * 16807) % 2147483647) / 2147483647);
for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
rainGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
rainGeo.instanceCount = N_RAIN;
const rainMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uRain: { value: 1 }, uCamPos: { value: new THREE.Vector3() }, uPxAngle: { value: 1 } },
  vertexShader: /* glsl */ `
    attribute vec4 aSeed;
    uniform float uTime, uPxAngle;
    uniform vec3 uCamPos;
    varying vec2 vUv;
    varying float vFade;
    void main() {
      float speed = 6.5 + 2.5 * aSeed.w;
      float Hh = 3.6;
      float y = Hh - mod(uTime * speed + aSeed.z * Hh, Hh);
      vec3 vel = normalize(vec3(0.7, -speed, 0.25));
      vec3 base = vec3(aSeed.x * 7.0 - 3.5, y, aSeed.y * 8.0 - 6.5) - vel * (Hh - y) * 0.0;
      base.xz += vel.xz / vel.y * -(Hh - y) * 0.0;
      float len = speed / 45.0;
      vec3 toC = uCamPos - base;
      float d = length(toC);
      vec3 side = normalize(cross(vel, toC));
      float wid = max(0.0009, d * uPxAngle * 0.9);
      vec3 pos = base + vel * len * position.y + side * wid * position.x;
      vUv = vec2(position.x, position.y);
      vFade = smoothstep(0.0, 0.05, pos.y) * smoothstep(0.25, 1.0, d) * (0.0009 / wid + 0.15);
      gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uRain;
    varying vec2 vUv;
    varying float vFade;
    void main() {
      float a = (1.0 - abs(vUv.x)) * sin(3.14159 * vUv.y);
      gl_FragColor = vec4(vec3(0.55, 0.58, 0.62) * a * vFade * 0.28 * uRain, 1.0);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
const rain = new THREE.Mesh(rainGeo, rainMat);
rain.frustumCulled = false;
scene.add(rain);

// ---------------------------------------------------------------- post (tonemap, vignette, dither)
const postScene = new THREE.Scene();
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const postMat = new THREE.ShaderMaterial({
  uniforms: { tSrc: { value: rt.texture }, uRes: { value: new THREE.Vector2(W0, H0) }, uFrame: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tSrc; uniform vec2 uRes; uniform float uFrame;
    varying vec2 vUv;
    // ACES filmic fit by Krzysztof Narkowicz (see CREDITS.md)
    vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    float h(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec3 c = texture2D(tSrc, vUv).rgb;
      c *= 1.55; // exposure
      vec2 d = vUv - 0.5;
      c *= 1.0 - 0.55 * dot(d, d) * 1.6;
      c = aces(c);
      c = mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
      vec2 fc = gl_FragCoord.xy + fract(uFrame * 0.618) * 97.0;
      c += (h(fc) + h(fc + 31.7) - 1.0) / 255.0; // triangular dither, kills banding
      gl_FragColor = vec4(c, 1.0);
    }`,
  depthTest: false, depthWrite: false,
});
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));

// ---------------------------------------------------------------- camera / controls
const target = new THREE.Vector3(0.05, 0, -0.55);
function scriptedCamera(t) {
  // slow lateral dolly + push-in across the 6 s shot
  const u = t / 6;
  camera.position.set(0.55 - 0.7 * u, 1.38 - 0.12 * u, 2.35 - 0.35 * u);
  camera.lookAt(target.x - 0.1 * u, 0, target.z);
}
let controls = null;
if (!CAPTURE) {
  scriptedCamera(0);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.minDistance = 0.6;
  controls.maxDistance = 6;
  controls.maxPolarAngle = Math.PI * 0.44;
  controls.update();
}

function resize() {
  const w = CAPTURE ? W0 : window.innerWidth;
  const h = CAPTURE ? H0 : window.innerHeight;
  renderer.setSize(w, h, !CAPTURE);
  rt.setSize(Math.round(w * SS), Math.round(h * SS));
  postMat.uniforms.uRes.value.set(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  rainMat.uniforms.uPxAngle.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / (h * SS);
}
resize();
if (!CAPTURE) window.addEventListener('resize', resize);

let frameCount = 0;
function draw(t) {
  groundMat.uniforms.uTime.value = t;
  rainMat.uniforms.uTime.value = t;
  groundMat.uniforms.uCamPos.value.copy(camera.position);
  rainMat.uniforms.uCamPos.value.copy(camera.position);
  postMat.uniforms.uFrame.value = frameCount++;
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCam);
}

if (CAPTURE) {
  window.renderFrame = (n) => {
    const t = n / 30;
    scriptedCamera(t);
    draw(t + T_OFFSET);
    renderer.getContext().finish();
    return Promise.resolve(n);
  };
  window.captureReady = true;
} else {
  let paused = false, rainOn = true, simT = T_OFFSET, last = performance.now();
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') paused = !paused;
    if (e.code === 'KeyR') rainOn = !rainOn;
    if (e.code === 'KeyC') { scriptedCamera(0); controls.target.copy(target); controls.update(); }
  });
  const loop = (now) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!paused) simT += dt;
    const k = 1 - Math.exp(-dt * 3);
    const goal = rainOn ? 1 : 0;
    groundMat.uniforms.uRain.value += (goal - groundMat.uniforms.uRain.value) * k;
    rainMat.uniforms.uRain.value = groundMat.uniforms.uRain.value;
    controls.update();
    draw(simT);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
