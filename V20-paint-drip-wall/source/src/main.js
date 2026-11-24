import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PaintSim, Pours, buildWall, absorb, hash3, vnoise } from './sim.js';
import { patchSurface } from './surface.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const SS = CAPTURE ? Number(params.get('ss') || 2) : Math.min(window.devicePixelRatio || 1, 1.5);

const W = 260, H = 112;
const SIM_DT = 1 / 60;
const STEPS_PER_FRAME = 2; // capture: 1/30 s per frame
const BACK = -4; // wall back face depth

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.setPixelRatio(SS);
renderer.setSize(CAPTURE ? 1280 : window.innerWidth, CAPTURE ? 720 : window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
{
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#2c3442'); gr.addColorStop(0.55, '#4a4c50'); gr.addColorStop(1, '#5a5048');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  scene.background = t;
}
scene.fog = new THREE.Fog(0x15130f, 260, 520);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(32, 16 / 9, 1, 1500);

// ---------------------------------------------------------------- lights
const sun = new THREE.DirectionalLight(0xffe2c0, 2.9);
sun.position.set(-260, 250, 140);
sun.target.position.set(0, 55, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(CAPTURE ? 4096 : 2048, CAPTURE ? 4096 : 2048);
const sc = sun.shadow.camera;
sc.left = -130; sc.right = 130; sc.top = 100; sc.bottom = -100; sc.near = 50; sc.far = 700;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.06;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0x9fb4d0, 0x30261f, 0.45));
const rim = new THREE.DirectionalLight(0x8fb0ff, 0.5);
rim.position.set(200, 40, 120);
scene.add(rim);

// ---------------------------------------------------------------- wall voxels
const wall = buildWall(W, H);
const box = new THREE.BoxGeometry(1, 1, 1);

const brickPalette = [
  [0.34, 0.11, 0.065], [0.30, 0.10, 0.06], [0.40, 0.15, 0.085], [0.25, 0.085, 0.055],
  [0.36, 0.17, 0.10], [0.28, 0.12, 0.08], [0.43, 0.19, 0.11],
];
const wallMat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
patchSurface(wallMat, { grain: 0.18, rough: 0.16 });
const wallMesh = new THREE.InstancedMesh(box, wallMat, W * H);
wallMesh.castShadow = true; wallMesh.receiveShadow = true;
{
  const mtx = new THREE.Matrix4(), col = new THREE.Color();
  const streakTop = H - wall.copingRows;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const z = wall.wallZ[i];
    const d = z - BACK;
    mtx.makeScale(1, 1, d).setPosition(x - W / 2, y, BACK + d / 2);
    wallMesh.setMatrixAt(i, mtx);
    let r, g, b;
    const k = wall.kind[i];
    if (k === 0) {
      const p = brickPalette[Math.floor(hash3(wall.brickId[i], 2, 3) * brickPalette.length)];
      const j = 0.76 + 0.4 * hash3(x, y, 31) + 0.25 * (vnoise(x, y, 4, wall.brickId[i]) - 0.5);
      r = p[0] * j; g = p[1] * j; b = p[2] * j;
      // eroded cells (below the brick's own face) expose paler, dusty clay
      if (z < Math.round((hash3(wall.brickId[i], 1, 9) - 0.5) * 3) * 0.1 - 0.05) { r = r * 0.8 + 0.09; g = g * 0.8 + 0.06; b = b * 0.8 + 0.045; }
      // fire flash: darker burnt ends on some bricks
      if (hash3(wall.brickId[i], 5, 5) > 0.8) { const f = 0.6 + 0.4 * vnoise(x, y, 3, 8); r *= f; g *= f; b *= f; }
    } else if (k === 1) {
      const j = 0.75 + 0.35 * hash3(x, y, 32);
      r = 0.30 * j; g = 0.28 * j; b = 0.25 * j;
    } else {
      const j = 0.8 + 0.25 * hash3(x, y, 33) + 0.2 * (vnoise(x, y, 5, 9) - 0.5);
      r = 0.36 * j; g = 0.34 * j; b = 0.30 * j;
    }
    // efflorescence (salt bloom), stronger low and in joints
    const eff = vnoise(x, y, 14, 50) * (k === 1 ? 1.3 : 0.9) * (1.1 - y / H);
    if (eff > 0.55) { const f = Math.min(1, (eff - 0.55) * 2.2) * 0.6; r += (0.55 - r) * f; g += (0.53 - g) * f; b += (0.49 - b) * f; }
    // rain streaks from the coping drip edge
    if (y < streakTop) {
      const sx = vnoise(x, 0, 2.2, 40);
      const st = Math.pow(Math.max(0, sx - 0.35) / 0.65, 1.5) * Math.exp(-(streakTop - y) / 45) * (0.7 + 0.6 * vnoise(x, y, 6, 41));
      const f = 1 - 0.6 * Math.min(1, st);
      r *= f; g *= f * 0.98; b *= f * 0.96;
    } else {
      // dirty coping top edge
      const f = 0.75 + 0.25 * vnoise(x, y, 3, 42);
      r *= f; g *= f; b *= f;
    }
    // ground splash grime and a little green near the base
    const low = Math.exp(-y / 14) * (0.6 + 0.6 * vnoise(x, y, 8, 43));
    r *= 1 - 0.5 * low; g *= 1 - 0.38 * low; b *= 1 - 0.5 * low;
    // soot / general dirt patches
    const dirt = vnoise(x, y, 26, 44);
    const fd = 0.8 + 0.3 * dirt;
    col.setRGB(r * fd, g * fd, b * fd, THREE.LinearSRGBColorSpace);
    wallMesh.setColorAt(i, col);
  }
  wallMesh.instanceMatrix.needsUpdate = true;
  wallMesh.instanceColor.needsUpdate = true;
}
scene.add(wallMesh);

// ground slab (plain voxel strip in front of the wall base)
{
  const GW = W, GD = 40;
  const gMesh = new THREE.InstancedMesh(box, wallMat, GW * GD);
  gMesh.receiveShadow = true;
  const mtx = new THREE.Matrix4(), col = new THREE.Color();
  let n = 0;
  for (let zz = 0; zz < GD; zz++) for (let x = 0; x < GW; x++) {
    const hgt = 2 + Math.round(hash3(x, zz, 61) * 1.5) * 0.1;
    mtx.makeScale(1, hgt, 1).setPosition(x - W / 2, -0.5 - hgt / 2 + 0.0, zz + 0.5 + 0.2);
    gMesh.setMatrixAt(n, mtx);
    const j = 0.12 + 0.07 * vnoise(x, zz, 5, 62) + 0.04 * hash3(x, zz, 63);
    col.setRGB(j, j * 0.96, j * 0.9, THREE.LinearSRGBColorSpace);
    gMesh.setColorAt(n++, col);
  }
  scene.add(gMesh);
}

// ---------------------------------------------------------------- paint voxels
const paintMat = new THREE.MeshPhysicalMaterial({ roughness: 0.5, metalness: 0, envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.06 });
patchSurface(paintMat, { grain: 0.06, rough: 0.1, wet: true });
const paintMesh = new THREE.InstancedMesh(box, paintMat, W * H);
paintMesh.castShadow = true; paintMesh.receiveShadow = true;
paintMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
paintMesh.setColorAt(0, new THREE.Color());
paintMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
const wetAttr = new THREE.InstancedBufferAttribute(new Float32Array(W * H), 1);
wetAttr.setUsage(THREE.DynamicDrawUsage);
box.setAttribute('aWet', wetAttr); // shared geometry; wall shader ignores it
paintMesh.frustumCulled = false;
scene.add(paintMesh);

// falling droplets (separate geometry so aWet attribute stays per-instance for paint)
const dropGeo = new THREE.BoxGeometry(1, 1, 1);
const dropWet = new THREE.InstancedBufferAttribute(new Float32Array(4000).fill(1), 1);
dropGeo.setAttribute('aWet', dropWet);
const dropMesh = new THREE.InstancedMesh(dropGeo, paintMat, 4000);
dropMesh.castShadow = true;
dropMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
dropMesh.setColorAt(0, new THREE.Color());
dropMesh.frustumCulled = false;
scene.add(dropMesh);

// ---------------------------------------------------------------- simulation
const COLORS = {
  blue: [0.02, 0.22, 0.62],
  yellow: [0.90, 0.72, 0.03],
  magenta: [0.72, 0.03, 0.30],
  white: [0.86, 0.85, 0.80],
  teal: [0.02, 0.38, 0.30],
};
const PICK = ['blue', 'yellow', 'magenta', 'white', 'teal'];

const sim = new PaintSim(W, H, wall);
const pours = new Pours(sim);

function oldHistory() {
  // older pours, run and baked into a faded dry layer
  const old = [
    [-85, [0.55, 0.20, 0.05], 0.55], [-48, [0.10, 0.30, 0.32], 0.6], [22, [0.75, 0.72, 0.62], 0.5],
    [55, [0.25, 0.25, 0.26], 0.4], [80, [0.60, 0.42, 0.08], 0.6], [-2, [0.30, 0.10, 0.10], 0.5],
  ];
  for (let pass = 0; pass < old.length; pass++) {
    const [x0, c, fade] = old[pass];
    const A = absorb(c);
    const y0 = H - 1;
    for (let s = 0; s < 300; s++) {
      if (s < 60) sim.deposit(x0 + W / 2 + Math.sin(s * 0.13 + pass) * 5, y0, 0.45, A, 1);
      sim.step();
    }
    sim.bakeDry(fade);
  }
}
oldHistory();

// pour schedule (seconds of sim time)
const events = [
  // three pairs that sweep towards each other on the coping, so their drips meet and mix
  { c: 'blue', x: -70, vx: 2.6, t0: -2.1, t1: 7.0, rate: 28, salt: 1 },
  { c: 'yellow', x: -50, vx: -2.6, t0: -1.8, t1: 7.0, rate: 28, salt: 2 },
  { c: 'yellow', x: -22, vx: 2.4, t0: -1.6, t1: 7.0, rate: 28, salt: 3 },
  { c: 'magenta', x: -4, vx: -2.4, t0: -1.3, t1: 7.0, rate: 28, salt: 4 },
  { c: 'magenta', x: 22, vx: 2.4, t0: -1.9, t1: 7.0, rate: 28, salt: 5 },
  { c: 'blue', x: 40, vx: -2.4, t0: -1.0, t1: 7.0, rate: 28, salt: 6 },
];
const absCache = {};
for (const k in COLORS) absCache[k] = absorb(COLORS[k]);

let simTime = -2.2;
function simStep() {
  const s = sim.stepN;
  for (const e of events) {
    if (simTime < e.t0 || simTime >= e.t1) continue;
    pours.spawnStream(e.x + e.vx * (simTime - e.t0), absCache[e.c], COLORS[e.c], e.rate, s, SIM_DT, e.salt);
  }
  for (const u of userPours) {
    if (u.left-- > 0) pours.spawnStream(u.x, absCache[u.c], COLORS[u.c], 34, s, SIM_DT, u.salt);
  }
  pours.update(SIM_DT);
  sim.step();
  sim.step(); // two automaton steps per tick: drips run ~1 m/s at this scale
  simTime += SIM_DT;
}
const userPours = [];
// pre-roll so the first stream is already falling at frame 0
while (simTime < 0) simStep();

// ---------------------------------------------------------------- sync grid -> instances
const pArr = paintMesh.instanceMatrix.array;
const pCol = paintMesh.instanceColor.array;
const wArr = wetAttr.array;
function syncPaint() {
  const { m, dry, ar, ag, ab, dr, dg, db } = sim;
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const wet = m[i], d = dry[i];
    if (wet + d < 0.03) continue;
    let t = 0.07 + 0.42 * d + 0.6 * wet;
    if (t > 1.7) t = 1.7;
    t = Math.ceil(t * 8) / 8;
    const z = wall.wallZ[i] + t / 2 + 0.004;
    const o = n * 16;
    pArr[o] = 1; pArr[o + 1] = 0; pArr[o + 2] = 0; pArr[o + 3] = 0;
    pArr[o + 4] = 0; pArr[o + 5] = 1; pArr[o + 6] = 0; pArr[o + 7] = 0;
    pArr[o + 8] = 0; pArr[o + 9] = 0; pArr[o + 10] = t; pArr[o + 11] = 0;
    pArr[o + 12] = x - W / 2; pArr[o + 13] = y; pArr[o + 14] = z; pArr[o + 15] = 1;
    let r = Math.exp(-ar[i]), g = Math.exp(-ag[i]), b = Math.exp(-ab[i]);
    if (d > 0) {
      const w = wet / (wet + 0.05);
      r = dr[i] + (r - dr[i]) * w; g = dg[i] + (g - dg[i]) * w; b = db[i] + (b - db[i]) * w;
    }
    pCol[n * 3] = r; pCol[n * 3 + 1] = g; pCol[n * 3 + 2] = b;
    wArr[n] = Math.min(1, wet * 3.5);
    n++;
  }
  paintMesh.count = n;
  paintMesh.instanceMatrix.needsUpdate = true;
  paintMesh.instanceColor.needsUpdate = true;
  wetAttr.needsUpdate = true;

  const dArr = dropMesh.instanceMatrix.array, dCol = dropMesh.instanceColor.array;
  let k = 0;
  for (const p of pours.drops) {
    if (k >= 4000) break;
    const sp = Math.hypot(p.vx, p.vy, p.vz);
    const len = Math.max(0.9, Math.min(6, sp / 75));
    const o = k * 16;
    // stretch along the dominant (vertical) motion only: keep it voxel-aligned
    const sx = 0.9, sy = Math.abs(p.vy) > Math.abs(p.vz) ? len : 0.9, sz = Math.abs(p.vy) > Math.abs(p.vz) ? 0.9 : len;
    dArr.set([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, Math.round(p.x * 2) / 2, p.y + sy / 2, p.z, 1], o);
    dCol[k * 3] = p.col[0]; dCol[k * 3 + 1] = p.col[1]; dCol[k * 3 + 2] = p.col[2];
    k++;
  }
  dropMesh.count = k;
  dropMesh.instanceMatrix.needsUpdate = true;
  dropMesh.instanceColor.needsUpdate = true;
}

// ---------------------------------------------------------------- camera path
const CAP_FRAMES = 180;
function cameraAt(t) {
  const u = t / 6;
  const e = u * u * (3 - 2 * u);
  const pos = new THREE.Vector3(-78 + 22 * e, 98, 180 - 6 * e);
  const look = new THREE.Vector3(-20 + 8 * e, 71, 0);
  camera.position.copy(pos);
  camera.lookAt(look);
  return look;
}

// ---------------------------------------------------------------- main
const hud = document.getElementById('hud');
if (CAPTURE) {
  hud.remove();
  let frame = 0;
  syncPaint();
  window.captureInfo = { frames: CAP_FRAMES, fps: 30 };
  window.renderFrame = async (n) => {
    while (frame < n) { for (let k = 0; k < STEPS_PER_FRAME; k++) simStep(); frame++; }
    syncPaint();
    cameraAt(n / 30);
    renderer.render(scene, camera);
    return true;
  };
  window.renderFrameSync = window.renderFrame;
  window.captureReady = true;
} else {
  let colorIdx = 0, paused = false;
  const setHud = () => {
    hud.innerHTML = `click wall: pour <b>${PICK[colorIdx]}</b> · 1–5 colour · space ${paused ? 'resume' : 'pause'} · R reset · drag orbit`;
  };
  setHud();
  const look = cameraAt(2.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(look);
  controls.enableDamping = true;
  controls.update();

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (ev) => { downAt = [ev.clientX, ev.clientY]; });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (!downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 5) return;
    ndc.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const p = new THREE.Vector3();
    if (ray.ray.intersectPlane(plane, p) && Math.abs(p.x) < W / 2 - 2) {
      userPours.push({ x: p.x, c: PICK[colorIdx], left: 90, salt: Math.floor(Math.random() * 1e6) });
    }
  });
  addEventListener('keydown', (ev) => {
    if (ev.key >= '1' && ev.key <= '5') colorIdx = Number(ev.key) - 1;
    else if (ev.code === 'Space') paused = !paused;
    else if (ev.key === 'r' || ev.key === 'R') { sim.reset(); pours.drops.length = 0; simTime = -2.2; }
    setHud();
  });
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();

  let acc = 0, last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    let n = 0;
    while (!paused && acc >= SIM_DT && n < 4) { simStep(); acc -= SIM_DT; n++; }
    if (paused || n === 4) acc = 0;
    // loop the scripted pours: after they finish, let it run a while, then wash and restart
    if (simTime > 14) { sim.reset(); pours.drops.length = 0; simTime = -2.2; }
    syncPaint();
    controls.update();
    renderer.render(scene, camera);
  });
}
