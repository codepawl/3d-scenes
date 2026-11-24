import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { VoxelGrid, NSLABS, T_PRINT, VS, NY } from './grid.js';
import { meshSlab, makePlaMaterial } from './mesher.js';
import { buildPrinter } from './printer.js';
import { bedTextures, brushedTextures, benchTextures, grainTextures } from './textures.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const W = 1280, H = 720, FPS = 30;
const CYCLE = 7.6;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
if (CAPTURE) { renderer.setPixelRatio(1); renderer.setSize(W, H); document.getElementById('hint')?.remove(); }
else { renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight); }
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15171b);
scene.fog = new THREE.Fog(0x15171b, 16, 34);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(34, CAPTURE ? W / H : innerWidth / innerHeight, 0.1, 80);

// lights
const key = new THREE.DirectionalLight(0xffe2c4, 2.6);
key.position.set(-9, 9, 3.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -6, right: 6, top: 7, bottom: -5, near: 1, far: 30 });
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
scene.add(key);
const rim = new THREE.DirectionalLight(0x9fc0ff, 1.1); rim.position.set(7, 6, -8); scene.add(rim);
scene.add(new THREE.HemisphereLight(0x8090a0, 0x2a2420, 0.35));
// back wall so the frame has something behind it
const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 24), new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.95, dithering: true }));
wall.position.set(0, 8, -14); wall.receiveShadow = true; scene.add(wall);

// textures + printer
const T = { bed: bedTextures(), brushed: brushedTextures(), bench: benchTextures(), grain: grainTextures() };
T.bench.map.repeat.set(4, 4); T.bench.roughnessMap.repeat.set(4, 4);
wall.material.map = T.bench.map.clone(); wall.material.map.repeat.set(6, 2.4);
wall.material.color.set(0x505258);

const printer = buildPrinter(T);
scene.add(printer.root);

// voxel part
const grid = new VoxelGrid();
const uniforms = { uTime: { value: 0 } };
const plaMat = makePlaMaterial(uniforms);
const partPivot = new THREE.Group(); // pivot at the back edge for the peel
partPivot.position.set(0, 0, -1.75);
const part = new THREE.Group(); part.position.z = 1.75;
partPivot.add(part); scene.add(partPivot);
const slabs = [];
for (let s = 0; s < NSLABS; s++) {
  const m = new THREE.Mesh(new THREE.BufferGeometry(), plaMat);
  m.castShadow = m.receiveShadow = true; m.frustumCulled = false;
  part.add(m); slabs.push(m);
}
function remesh() {
  for (const s of grid.dirty) { slabs[s].geometry.dispose(); slabs[s].geometry = meshSlab(grid, s); }
  grid.dirty.clear();
}

// simulation state (fixed substeps -> deterministic for capture)
const DT = 1 / 240;
const sim = { t: 0, p: [0, 0.1, 0], v: [0, 0, 0] };
const tmp = [0, 0, 0];
const PART_TOP = NY * VS;
const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

function resetSim() {
  grid.reset();
  sim.t = 0;
  grid.nozzleTarget(0, tmp);
  sim.p = [tmp[0], tmp[1], tmp[2]]; sim.v = [0, 0, 0];
}
function step(dt) {
  sim.t += dt;
  const t = sim.t;
  grid.advanceTo(t);
  let w;
  if (t < T_PRINT + 0.05) { grid.nozzleTarget(t, tmp); w = 70; }
  else { tmp[0] = -2.4; tmp[1] = PART_TOP + 0.4; tmp[2] = -2.6; w = 7; }
  for (let q = 0; q < 3; q++) {
    const a = w * w * (tmp[q] - sim.p[q]) - 2 * w * sim.v[q];
    sim.v[q] += a * dt; sim.p[q] += sim.v[q] * dt;
  }
}
function advanceTo(t) {
  if (t < sim.t - 1e-9) resetSim();
  while (sim.t + DT <= t + 1e-9) step(DT);
}

function applyFrame(t) {
  uniforms.uTime.value = t;
  remesh();
  const printing = t < T_PRINT;
  printer.update(sim.p[0], sim.p[1], sim.p[2], printing ? 0.6 : Math.max(0, 0.6 - (t - T_PRINT) * 1.5));
  // peel + lift
  const lt = t - T_PRINT;
  const peel = ease((lt - 0.35) / 0.4) * (1 - ease((lt - 1.0) / 0.6));
  const rise = ease((lt - 0.55) / 1.3);
  partPivot.rotation.x = -0.075 * peel;
  partPivot.position.y = 0.02 * ease((lt - 0.35) / 0.3) + 1.0 * rise;
  part.rotation.y = 0.5 * ease((lt - 0.7) / 1.5);
  // cinematic camera
  const u = Math.min(t, 6.0) / 6.0;
  const az = -0.28 + 0.5 * u, el = 0.36 - 0.06 * u, dist = 11.6 - 0.8 * ease(u);
  const ty = 1.9 + 0.75 * rise;
  if (cinematic) {
    camera.position.set(Math.sin(az) * Math.cos(el) * dist, ty + Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
    camera.lookAt(0, ty, 0);
    controls.target.set(0, ty, 0);
  }
}

// controls
let cinematic = true, paused = false, playT = 0;
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enabled = !CAPTURE;
controls.addEventListener('start', () => { cinematic = false; });
addEventListener('keydown', (e) => {
  if (e.code === 'KeyC') cinematic = true;
  if (e.code === 'Space') paused = !paused;
  if (e.code === 'KeyR') { playT = 0; resetSim(); }
});
addEventListener('resize', () => {
  if (CAPTURE) return;
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

resetSim();

if (CAPTURE) {
  window.renderFrame = async (n) => {
    const t = n / FPS;
    advanceTo(t);
    applyFrame(t);
    renderer.render(scene, camera);
    renderer.getContext().finish();
    return true;
  };
  window.captureReady = true;
} else {
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!paused) playT += dt;
    if (playT >= CYCLE) { playT = 0; resetSim(); }
    advanceTo(playT);
    applyFrame(playT);
    if (!cinematic) controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
