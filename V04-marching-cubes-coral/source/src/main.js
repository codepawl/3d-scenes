import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VoxelGrid } from './dla.js';
import { DensityField } from './field.js';
import { ChunkMesher } from './mesher.js';
import { makeReefMaterial } from './material.js';
import { makeBackdrop, makeSnow } from './water.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const FPS = 30;

const NX = 128, NY = 96, NZ = 128;
const CORAL_TARGET = 24000;
const GROW_SECONDS = 26;        // live: time for the reef to reach full size
const CAPTURE_T0 = 12.5;        // capture starts part-way through growth

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(window.devicePixelRatio, 2));
if (CAPTURE) renderer.setSize(1280, 720, false); else renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.45;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
if (CAPTURE) Object.assign(renderer.domElement.style, { width: '1280px', height: '720px' });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, CAPTURE ? 1280 / 720 : innerWidth / innerHeight, 0.5, 1200);

const sunDir = new THREE.Vector3(0.35, 1.0, 0.25).normalize();
const shared = {
  uTime: { value: 0 },
  uSunDir: { value: sunDir },
  uWaterDeep: { value: new THREE.Color(0.016, 0.075, 0.130) },
  uWaterShallow: { value: new THREE.Color(0.120, 0.400, 0.500) },
  uSunTint: { value: new THREE.Color(0.55, 0.80, 0.85) },
  uTopY: { value: 80 },
  uFloorY: { value: 4 },
  uAbsorb: { value: new THREE.Vector3(0.0050, 0.0020, 0.0012) },
  uFogDensity: { value: 0.0048 },
  uCamPos: { value: camera.position },
};

// ---------------------------------------------------------------- lights
const sun = new THREE.DirectionalLight(0xfff1dc, 4.2);
sun.position.copy(sunDir).multiplyScalar(160);
sun.target.position.set(0, 20, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -85; sc.right = 85; sc.top = 85; sc.bottom = -85; sc.near = 40; sc.far = 330;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.6;
sun.shadow.radius = 3;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0x6cc4d4, 0x1c2a30, 1.9));

// ---------------------------------------------------------------- voxel grid + DLA (source of truth)
const grid = new VoxelGrid(NX, NY, NZ);
grid.buildSeabed(11);
const total = grid.growDLA(params.has('seed') ? +params.get('seed') : 1234, CORAL_TARGET);
const field = new DensityField(grid);
field.splatRock();
let revealed = 0;

const mesher = new ChunkMesher(field);
const reefMat = makeReefMaterial(shared);
reefMat.dithering = true;
const chunkMeshes = new Map();
const reef = new THREE.Group();
scene.add(reef);

function remeshChunk(ci) {
  const cx = ci % field.cx, cy = Math.floor(ci / field.cx) % field.cy, cz = Math.floor(ci / (field.cx * field.cy));
  const r = mesher.build(cx, cy, cz);
  let m = chunkMeshes.get(ci);
  if (!r) { if (m) { reef.remove(m); m.geometry.dispose(); chunkMeshes.delete(ci); } return; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(r.normals, 3));
  g.setAttribute('aux', new THREE.BufferAttribute(r.aux, 2));
  g.setIndex(new THREE.BufferAttribute(r.index, 1));
  g.computeBoundingSphere();
  if (m) { m.geometry.dispose(); m.geometry = g; }
  else {
    m = new THREE.Mesh(g, reefMat);
    m.castShadow = true; m.receiveShadow = true;
    chunkMeshes.set(ci, m); reef.add(m);
  }
}

// remesh dirty chunks; budgetMs = Infinity means all of them
function flushDirty(budgetMs) {
  const t0 = performance.now();
  const d = field.dirty;
  for (let i = 0; i < d.length; i++) {
    if (!d[i]) continue;
    d[i] = 0;
    remeshChunk(i);
    if (performance.now() - t0 > budgetMs) break;
  }
}

function growthCount(t) {
  const x = Math.min(1, Math.max(0, t / GROW_SECONDS));
  const e = 1 - Math.pow(1 - x, 1.6);           // fast start, slow finish
  return Math.floor(total * (0.04 + 0.96 * e));
}
function revealTo(n) {
  const list = grid.coralList;
  n = Math.min(n, list.length);
  for (; revealed < n; revealed++) {
    // older voxels splat a wider kernel: trunks end up thicker than tips
    const age = revealed / total;
    const cls = age < 0.12 ? 3 : age < 0.35 ? 2 : age < 0.7 ? 1 : 0;
    field.splatCoral(list[revealed], cls);
  }
}

// outer seabed beyond the grid so the voxel block never shows an edge
function makeOuterFloor() {
  const geo = new THREE.PlaneGeometry(1000, 1000, 220, 220);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  const aux = new Float32Array(p.count * 2);
  const half = (NX - 1) / 2;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const gx = Math.min(NX - 4, Math.max(3, Math.round(x + half)));
    const gz = Math.min(NZ - 4, Math.max(3, Math.round(z + half)));
    // match the iso-surface height of the voxel rock just inside the border
    let edgeH = 3;
    for (let y = 12; y > 0; y -= 0.1) { if (field.sample(gx, y, gz) >= 0.6) { edgeH = y + 0.45; break; } }
    const out = Math.max(Math.abs(x), Math.abs(z)) - half;
    const far = 2.6 + Math.sin(x * 0.05) * Math.cos(z * 0.043) * 1.6 + Math.sin(x * 0.013 + z * 0.021) * 3.0;
    const w = THREE.MathUtils.smoothstep(out, 0, 30);
    let y = out < -0.5 ? edgeH - 1.6 : edgeH * (1 - w) + far * w;
    p.setY(i, y);
    aux[i * 2] = 0; aux[i * 2 + 1] = 0.85;
  }
  geo.setAttribute('aux', new THREE.BufferAttribute(aux, 2));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, reefMat);
  m.receiveShadow = true;
  return m;
}
scene.add(makeOuterFloor());
scene.add(makeBackdrop(shared));
const snow = makeSnow(shared);
snow.material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
scene.add(snow);

// ---------------------------------------------------------------- camera
const target = new THREE.Vector3(0, 33, 0);
function cameraAt(t) {
  // slow orbit, gently descending towards the reef
  const a = 0.6 + t * 0.07;
  const r = (params.has('r') ? +params.get('r') : 168) - t * 2.4;
  const h = (params.has('h') ? +params.get('h') : 70) - t * 1.5;
  camera.position.set(Math.cos(a) * r, h, Math.sin(a) * r);
  camera.lookAt(target.x, target.y - t * 0.3, target.z);
}

let controls = null;
if (!CAPTURE) {
  controls = new OrbitControls(camera, renderer.domElement);
  cameraAt(CAPTURE_T0);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 20; controls.maxDistance = 260;
  controls.update();
}

// ---------------------------------------------------------------- loop
function setTime(t) {
  shared.uTime.value = t;
}

if (CAPTURE) {
  revealTo(growthCount(CAPTURE_T0));
  flushDirty(Infinity);
  window.renderFrame = (n) => new Promise((resolve) => {
    const t = CAPTURE_T0 + n / FPS;
    setTime(t);
    revealTo(growthCount(t));
    flushDirty(Infinity);
    cameraAt(t - CAPTURE_T0);
    renderer.render(scene, camera);
    requestAnimationFrame(() => resolve(true));
  });
  window.renderOnly = () => renderer.render(scene, camera); // timing hook
  window.captureReady = true;
} else {
  let simT = 0, paused = false, last = performance.now();
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') paused = !paused;
    if (e.code === 'KeyR') { // regrow from scratch
      field.total.fill(0); field.coral.fill(0); field.splatRock(); revealed = 0; simT = 0;
    }
    if (e.code === 'KeyF') { simT = GROW_SECONDS; }
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  revealTo(growthCount(0));
  flushDirty(Infinity);
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!paused) simT += dt;
    setTime(now / 1000);
    revealTo(growthCount(simT));
    flushDirty(6);
    controls.update();
    renderer.render(scene, camera);
  });
}
