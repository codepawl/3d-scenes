import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { growCrystal } from './automaton.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const FPS = 30;
const MAX_GEN = 120;
const GRID = 128;
if (CAPTURE) document.body.classList.add('capture');

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(window.devicePixelRatio, 2));
const W = () => (CAPTURE ? 1280 : window.innerWidth);
const H = () => (CAPTURE ? 720 : window.innerHeight);
renderer.setSize(W(), H());
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// dark gradient dome: navy horizon fading to near-black overhead; fog matches the horizon
const HORIZON = new THREE.Color(0x0c1222);
scene.background = new THREE.Color(0x020306);
scene.fog = new THREE.Fog(HORIZON, 150, 330);
const dome = new THREE.Mesh(
  new THREE.SphereGeometry(800, 48, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uHorizon: { value: HORIZON }, uTop: { value: new THREE.Color(0x020306) },
      uGlow: { value: new THREE.Color(0x1a2a4a) } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uHorizon, uTop, uGlow; varying vec3 vDir;
      void main(){ float h = vDir.y;
        vec3 c = mix(uHorizon, uTop, smoothstep(-0.05, 0.55, h));
        c += uGlow * 0.25 * exp(-abs(h) * 10.0);   // faint band of light at the horizon
        gl_FragColor = vec4(c, 1.0); }`,
  })
);
dome.renderOrder = -1;
scene.add(dome);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(38, W() / H(), 0.5, 1000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enabled = !CAPTURE;

// key: a soft-edged spotlight from above, so the plinth sits in a pool of light that fades into the dark floor.
// (The old blue rim DirectionalLight was removed: its grazing specular on the floor made a hard blue patch.)
const key = new THREE.SpotLight(0xfff1e0, 3.0, 0, 0.34, 0.9, 0);
key.position.set(70, 210, 55);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 60; key.shadow.camera.far = 420;
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.5;
scene.add(key, key.target);
scene.add(new THREE.HemisphereLight(0x3a4f78, 0x05060a, 0.3));

// plinth + floor: matte, barely reflective, receive the crystal's shadow
const stage = new THREE.Group();
const stoneMat = new THREE.MeshStandardMaterial({ color: 0x151a26, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.25 });
const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.04, 1, 96, 1), stoneMat);
plinth.receiveShadow = true; plinth.castShadow = true;
const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.004, 8, 160),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.7, 0.9), fog: true }));
ring.rotation.x = -Math.PI / 2;
const floor = new THREE.Mesh(new THREE.CircleGeometry(700, 96),
  new THREE.MeshStandardMaterial({ color: 0x080a12, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.1 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
stage.add(plinth, ring, floor);
scene.add(stage);

function placeStage(ext) {
  const top = -ext - 2.5, h = 5, rad = ext * 1.08 + 4;
  plinth.scale.set(rad, h, rad);
  plinth.position.y = top - h / 2;
  ring.scale.setScalar(rad + 0.05);
  ring.position.y = top + 0.02;
  floor.position.y = top - h;
  key.target.position.set(0, top, 0);
}

// ---------------------------------------------------------------- voxel mesh
const uniforms = { uGen: { value: 0 } };

const vertexHead = /* glsl */`
  attribute vec3 aPos;
  attribute vec3 aGen;   // birth, freeze, buried
  uniform float uGen;
  varying float vAge;
  varying float vLive;
  varying vec3 vLocal;
`;
// grow-in scale from birth; collapse to nothing once buried (invisible from outside anyway)
const vertexBody = /* glsl */`
  float born = clamp((uGen - aGen.x) * 1.6, 0.0, 1.0);
  float s = born * (1.0 - step(aGen.z + 1.0, uGen));
  s = s * s * (3.0 - 2.0 * s);
  vec3 transformed = position * s + aPos;
`;

function injectVertex(shader) {
  shader.uniforms.uGen = uniforms.uGen;
  shader.vertexShader = vertexHead + shader.vertexShader.replace('#include <begin_vertex>', vertexBody +
    `vAge = max(uGen - aGen.x, 0.0);
     vLive = 1.0 - smoothstep(aGen.y - 0.5, aGen.y + 2.5, uGen);
     vLocal = position;`);
}

const voxelMat = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.15 });
voxelMat.onBeforeCompile = (shader) => {
  injectVertex(shader);
  shader.fragmentShader = /* glsl */`
    varying float vAge;
    varying float vLive;
    varying vec3 vLocal;
    vec3 agePalette(float a) {
      // newborn ice-white -> aqua -> cobalt -> violet -> deep plum
      vec3 c0 = vec3(0.45, 0.86, 1.00);
      vec3 c1 = vec3(0.10, 0.80, 0.85);
      vec3 c2 = vec3(0.10, 0.28, 0.90);
      vec3 c3 = vec3(0.42, 0.12, 0.78);
      vec3 c4 = vec3(0.30, 0.04, 0.22);
      vec3 c = mix(c0, c1, smoothstep(0.0, 6.0, a));
      c = mix(c, c2, smoothstep(6.0, 26.0, a));
      c = mix(c, c3, smoothstep(26.0, 60.0, a));
      c = mix(c, c4, smoothstep(60.0, 110.0, a));
      return c;
    }
  ` + shader.fragmentShader
    .replace('vec4 diffuseColor = vec4( diffuse, opacity );', /* glsl */`
      vec3 q = abs(vLocal);
      float edgeD = q.x + q.y + q.z - max(q.x, max(q.y, q.z)) - min(q.x, min(q.y, q.z));
      float fw = fwidth(edgeD) * 1.5;
      float edge = smoothstep(0.43 - fw, 0.5 - fw * 0.25, edgeD);
      edge *= 1.0 - smoothstep(0.06, 0.16, fw); // fade lines when voxels get small (moire)
      vec3 base = agePalette(vAge);
      vec4 diffuseColor = vec4(base * (1.0 - 0.55 * edge), opacity);
    `)
    .replace('vec3 totalEmissiveRadiance = emissive;', /* glsl */`
      vec3 glow = vec3(0.35, 0.85, 1.0) * (vLive * 0.3) + base * 0.06 * exp(-vAge * 0.15);
      vec3 totalEmissiveRadiance = glow * (1.0 - 0.6 * edge);
    `);
};
const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
depthMat.onBeforeCompile = injectVertex;

let voxels = null;
let extent = null;
let seedValue = Number(params.get('seed') || 1);
let cutOn = params.get('cut') !== '0';

function buildCrystal(startSeed) {
  const t0 = performance.now();
  const { ca, seed } = growCrystal(startSeed, MAX_GEN, GRID);
  seedValue = seed;
  const packed = ca.pack(cutOn);
  extent = ca.extentByGen();
  // sort by buried generation (latest first) so voxels that are already enclosed can be
  // dropped from the draw simply by lowering instanceCount
  const n = packed.count;
  const order = new Uint32Array(n).map((_, i) => i);
  order.sort((a, b) => packed.gens[b * 3 + 2] - packed.gens[a * 3 + 2]);
  const pos = new Float32Array(n * 3), gens = new Float32Array(n * 3);
  const buriedSorted = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const i = order[k];
    pos.set(packed.pos.subarray(i * 3, i * 3 + 3), k * 3);
    gens.set(packed.gens.subarray(i * 3, i * 3 + 3), k * 3);
    buriedSorted[k] = packed.gens[i * 3 + 2];
  }
  const geo = new THREE.InstancedBufferGeometry().copy(new THREE.BoxGeometry(1, 1, 1));
  geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3));
  geo.setAttribute('aGen', new THREE.InstancedBufferAttribute(gens, 3));
  geo.instanceCount = n;
  if (voxels) { scene.remove(voxels); voxels.geometry.dispose(); }
  voxels = new THREE.Mesh(geo, voxelMat);
  voxels.customDepthMaterial = depthMat;
  voxels.castShadow = true;
  voxels.receiveShadow = true;
  voxels.frustumCulled = false;
  voxels.userData = { buriedSorted, n, finalExt: ca.ext, gen: ca.gen, occupied: ca.occupied.length,
    ms: performance.now() - t0 };
  placeStage(ca.ext);
  scene.add(voxels);
}

function visibleCount(gen) {
  // binary search: number of voxels with buried + 1 > gen (array sorted descending)
  const b = voxels.userData.buriedSorted;
  let lo = 0, hi = b.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (b[m] + 1.0 > gen) lo = m + 1; else hi = m; }
  return lo;
}

function extAt(gen) {
  const g = Math.min(Math.max(gen, 0), extent.length - 1);
  const g0 = Math.floor(g), g1 = Math.min(g0 + 1, extent.length - 1);
  return THREE.MathUtils.lerp(extent[g0], extent[g1], g - g0);
}

buildCrystal(seedValue);

// ---------------------------------------------------------------- post
const rt = new THREE.WebGLRenderTarget(W(), H(), { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(W(), H());
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.06, 0.05, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// final dither to hide 8-bit banding in the dark gradients
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      float n = (h(gl_FragCoord.xy) + h(gl_FragCoord.xy + 17.17) - 1.0) / 255.0;
      gl_FragColor = vec4(c.rgb + n, 1.0); }`,
}));

// ---------------------------------------------------------------- timeline
// capture: seed cluster visible at t=0, crystal finishes growing at ~5.3 s, holds to 6 s
const genAtCaptureTime = (t) => Math.min(MAX_GEN, 3 + t * 20 + t * t * 0.4);
let gen = 0;
let speed = 18; // generations per second (interactive)
let paused = false;
let holdTimer = 0;
let autoFrame = true;
let orbit = 0.6;
const smoothExt = { v: 4 };

function frameCamera(t, dt, ext, snap) {
  const target = snap ? ext : smoothExt.v + (ext - smoothExt.v) * Math.min(1, dt * 2.5);
  smoothExt.v = target;
  const r = target * 3.35 + 14;
  const elev = 0.42 - 0.08 * Math.sin(t * 0.3);
  // the cut wedge opens towards +x/+z, so the camera sweeps an arc in front of it
  orbit = CAPTURE ? Math.PI / 4 - 0.5 + t * 0.15 : Math.PI / 4 + 0.6 * Math.sin(t * 0.18);
  camera.position.set(Math.cos(orbit) * Math.cos(elev) * r, Math.sin(elev) * r, Math.sin(orbit) * Math.cos(elev) * r);
  controls.target.set(0, -target * 0.08, 0);
  camera.lookAt(controls.target);
}

function updateScene(g) {
  uniforms.uGen.value = g;
  voxels.geometry.instanceCount = visibleCount(g);
}

const hud = document.getElementById('hud');
let hudOn = true;
let fpsAcc = 0, fpsN = 0, fps = 0;

function updateHud() {
  if (!hudOn || CAPTURE) { hud.textContent = ''; return; }
  const u = voxels.userData;
  hud.innerHTML =
    `3D CA  S4-5 / B5 / Moore  ·  seed ${seedValue}  ·  gen ${Math.floor(gen)}/${u.gen}  ·  ` +
    `voxels drawn ${voxels.geometry.instanceCount.toLocaleString()}  ·  ${fps.toFixed(0)} fps<br>` +
    `drag orbit · wheel zoom · space pause · R new seed · ←/→ scrub · +/- speed · C cutaway · F auto-frame · H hud`;
}

window.addEventListener('keydown', (e) => {
  if (CAPTURE) return;
  if (e.code === 'Space') paused = !paused;
  else if (e.key === 'r' || e.key === 'R') { buildCrystal(seedValue + 1); gen = 0; holdTimer = 0; smoothExt.v = 4; }
  else if (e.key === '+' || e.key === '=') speed = Math.min(60, speed * 1.4);
  else if (e.key === '-') speed = Math.max(2, speed / 1.4);
  else if (e.key === 'ArrowRight') gen = Math.min(MAX_GEN, gen + 2);
  else if (e.key === 'ArrowLeft') gen = Math.max(0, gen - 2);
  else if (e.key === 'f' || e.key === 'F') autoFrame = true;
  else if (e.key === 'c' || e.key === 'C') { cutOn = !cutOn; const g = gen; buildCrystal(seedValue); gen = g; }
  else if (e.key === 'h' || e.key === 'H') { hudOn = !hudOn; updateHud(); }
});
renderer.domElement.addEventListener('pointerdown', () => { autoFrame = false; });
renderer.domElement.addEventListener('wheel', () => { autoFrame = false; }, { passive: true });

function onResize() {
  if (CAPTURE) return;
  camera.aspect = W() / H();
  camera.updateProjectionMatrix();
  renderer.setSize(W(), H());
  composer.setSize(W(), H());
}
window.addEventListener('resize', onResize);

if (CAPTURE) {
  window.renderFrame = (n) => {
    const t = n / FPS;
    gen = genAtCaptureTime(t);
    updateScene(gen);
    frameCamera(t, 1 / FPS, extAt(gen + 4), true); // stateless: frame n depends only on n
    composer.render(1 / FPS);
    return new Promise((resolve) => requestAnimationFrame(() => resolve(n)));
  };
  window.captureReady = true;
} else {
  const clock = new THREE.Clock();
  let tAll = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    tAll += dt;
    if (!paused) {
      if (gen < MAX_GEN) gen = Math.min(MAX_GEN, gen + dt * speed);
      else if ((holdTimer += dt) > 5) { buildCrystal(seedValue + 1); gen = 0; holdTimer = 0; }
    }
    updateScene(gen);
    if (autoFrame) frameCamera(tAll, dt, extAt(gen + 4), false);
    controls.update();
    composer.render(dt);
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; updateHud(); }
  });
}
