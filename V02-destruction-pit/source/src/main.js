import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Grid, makeRng } from './wall.js';
import { World } from './physics.js';
import { Dust } from './dust.js';
import { makeVoxelMaterial, makeGroundMaterial, makeBallMaterial, makeSky } from './materials.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
if (CAPTURE) document.getElementById('hud')?.remove();

// ---------------- constants ----------------
const S = 0.18, GX = 64, GY = 40, GZ = 5;
const BALL_R = 0.62, BALL_MASS = 5400, VOX_MASS = 11;
const SUB_DT = 1 / 120;
const FPS = 30;

// ---------------- renderer / scene ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(window.devicePixelRatio, 2));
renderer.setSize(CAPTURE ? 1280 : window.innerWidth, CAPTURE ? 720 : window.innerHeight, !CAPTURE);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const fogCol = new THREE.Color().setRGB(0.80, 0.78, 0.72, THREE.SRGBColorSpace);
scene.fog = new THREE.Fog(fogCol, 28, 90);
scene.add(makeSky());

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(42, (CAPTURE ? 1280 / 720 : innerWidth / innerHeight), 0.1, 400);
const CAM_A = new THREE.Vector3(6.6, 2.3, 10.8), CAM_B = new THREE.Vector3(5.8, 2.6, 10.4);
const LOOK_A = new THREE.Vector3(-0.3, 2.5, 0.6), LOOK_B = new THREE.Vector3(0.1, 2.2, 0.9);
camera.position.copy(CAM_A);
camera.lookAt(LOOK_A);

const hemi = new THREE.HemisphereLight(new THREE.Color().setRGB(0.62, 0.70, 0.82, THREE.SRGBColorSpace),
  new THREE.Color().setRGB(0.42, 0.36, 0.30, THREE.SRGBColorSpace), 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1.0, 0.92, 0.80, THREE.SRGBColorSpace), 3.2);
sun.position.set(-7, 11, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 40 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.025;
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), makeGroundMaterial());
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// a few low rubble berms around the pit edge (static, decorative)
{
  const bermMat = makeGroundMaterial();
  const rngB = makeRng(99);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rngB() * 0.2;
    const r = 17 + rngB() * 5;
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), bermMat);
    m.position.set(Math.cos(a) * r, -0.4, Math.sin(a) * r - 3);
    m.scale.set(3 + rngB() * 3, 1.0 + rngB() * 1.4, 3 + rngB() * 3);
    m.receiveShadow = true;
    scene.add(m);
  }
}

// ---------------- voxel wall ----------------
const grid = new Grid(GX, GY, GZ, S);
grid.build();
const initialIds = [];
for (let id = 0; id < grid.N; id++) if (grid.occ[id]) initialIds.push(id);
const NV = initialIds.length;
const instOf = new Int32Array(grid.N).fill(-1);
initialIds.forEach((id, n) => { instOf[id] = n; });

const boxGeo = new THREE.BoxGeometry(S, S, S);
const aGrid = new Float32Array(NV * 3);
initialIds.forEach((id, n) => {
  aGrid[n * 3] = id % GX; aGrid[n * 3 + 1] = Math.floor(id / GX) % GY; aGrid[n * 3 + 2] = Math.floor(id / (GX * GY));
});
boxGeo.setAttribute('aGrid', new THREE.InstancedBufferAttribute(aGrid, 3));
const voxMesh = new THREE.InstancedMesh(boxGeo, makeVoxelMaterial(S, GX, GY, GZ), NV);
voxMesh.castShadow = true;
voxMesh.receiveShadow = true;
voxMesh.frustumCulled = false;
voxMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(voxMesh);
const M = voxMesh.instanceMatrix.array;
const tmpC = new Float32Array(3);

function writeStatic(id) {
  const n = instOf[id], o = n * 16;
  grid.center(id, tmpC);
  M.fill(0, o, o + 16);
  M[o] = M[o + 5] = M[o + 10] = M[o + 15] = 1;
  M[o + 12] = tmpC[0]; M[o + 13] = tmpC[1]; M[o + 14] = tmpC[2];
}

const dust = new Dust(3500);
scene.add(dust.points);

const ballGeo = new THREE.SphereGeometry(BALL_R, 64, 32);
const ballMat = makeBallMaterial();

// ---------------- simulation state ----------------
let world, rng, simTime, simFrame, events, balls;

function reset() {
  grid.build();
  for (const id of initialIds) writeStatic(id);
  voxMesh.instanceMatrix.needsUpdate = true;
  if (balls) for (const b of balls) scene.remove(b.mesh);
  balls = [];
  rng = makeRng(20261123);
  world = new World(grid, { iterations: 10 });
  world.onBallHitWall = (b) => !b.fractured && Math.hypot(b.vx, b.vy, b.vz) > 5;
  world.onImpact = (b, x, y, z, speed) => {
    if (y > 0.25 || simTime - (b.lastDust ?? -1) < 0.25 || speed < 2.0) return;
    b.lastDust = simTime;
    const cnt = Math.min(24, Math.ceil(b.vox.length / 25 * speed * 0.4));
    dust.emit(x, 0.1, z, cnt, 0.8 + speed * 0.15, rng, 0.25 + Math.min(1, b.vox.length / 200), 0.35, 2.2);
  };
  dust.n = 0;
  simTime = 0; simFrame = 0;
  // scripted sequence: two balls from behind the wall
  events = [
    { t: 0.0, fire: { x: -1.4, y: 2.25, sx: -0.6, sy: 0.4, tf: 0.62, upCracks: [[Math.PI * 0.48, -0.7], [Math.PI * 0.52, 0.7]] } },
    { t: 2.05, fire: { x: 2.7, y: 1.05, sx: 0.8, sy: 0.6, tf: 0.5, upCracks: [Math.PI * 0.55] } },
  ];
}

function fireBall({ x, y, sx = 0, sy = 0, tf = 0.5, upCracks = null }) {
  const b = world.createBall(BALL_R, BALL_MASS);
  const tz = grid.oz - BALL_R - 0.02;
  b.px = x + sx; b.py = y + sy; b.pz = tz - 9;
  b.vx = (x - b.px) / tf;
  b.vy = (y - b.py + 0.5 * 9.81 * tf * tf) / tf;
  b.vz = (tz - b.pz) / tf;
  b.wx = -3; b.wy = 1.5;
  b.upCracks = upCracks;
  b.mesh = new THREE.Mesh(ballGeo, ballMat);
  b.mesh.castShadow = true; b.mesh.receiveShadow = true;
  scene.add(b.mesh);
  balls.push(b);
}

function onFracture(ball) {
  ball.fractured = true;
  const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
  const dx = ball.vx / speed, dy = ball.vy / speed, dz = ball.vz / speed;
  const pieces = grid.fracture(ball.px, ball.py, BALL_R, rng, { cracks: 6, upCracks: ball.upCracks });
  const dmgR = BALL_R * 2.4;
  for (const p of pieces) {
    const n = p.ids.length;
    const centers = new Float32Array(n * 3);
    p.ids.forEach((id, i) => grid.center(id, centers, i * 3));
    const body = world.createChunk(p.ids, centers, VOX_MASS);
    const rx = body.px - ball.px, ry = body.py - ball.py;
    const rl = Math.hypot(rx, ry) || 1;
    const fall = Math.max(0, 1 - rl / (dmgR * 1.3));
    const sizeK = 1 / Math.cbrt(n);
    let k, rad, spin;
    if (p.kind === 'crush') { k = speed * (0.28 + 0.3 * rng()); rad = 1.2 + 2.2 * rng(); spin = 9; }
    else if (p.kind === 'damage') { k = speed * (0.06 + 0.16 * rng()) * (0.4 + fall); rad = 0.6 + 1.2 * rng(); spin = 4; }
    else { k = 3.0 + 0.5 * rng(); rad = 0; spin = 0; }
    body.vx = dx * k + (rx / rl) * rad + (rng() - 0.5) * 0.6;
    body.vy = dy * k + (ry / rl) * rad * 0.6 + rng() * 0.8 * (p.kind === 'loose' ? 0 : 1);
    body.vz = dz * k + (rng() - 0.5) * 0.4;
    body.wx = (rng() - 0.5) * spin * sizeK * 2; body.wy = (rng() - 0.5) * spin * sizeK * 2; body.wz = (rng() - 0.5) * spin * sizeK * 2;
    if (p.kind === 'loose') { body.ghost = 0.45; body.wx = Math.sign(dz) * 0.9; body.wz = 0; body.wy = 0; } // tip over, away from the ball's side
  }
  ball.vx *= 0.38; ball.vy *= 0.38; ball.vz *= 0.38;
  const fz = grid.oz + GZ * S;
  dust.emit(ball.px, ball.py, fz + 0.2, 260, 3.2, rng, 1.2, 0.6, 3.0, [dx, dy, dz]);
  dust.emit(ball.px, ball.py, grid.oz - 0.2, 90, 1.5, rng, 1.0, 0.5, 2.5);
}

function stepSim(dt) {
  while (events.length && events[0].t <= simTime) { const e = events.shift(); if (e.fire) fireBall(e.fire); }
  world.step(dt);
  if (world.pendingHits.length) {
    for (const b of world.pendingHits) onFracture(b);
    world.pendingHits.length = 0;
  }
  simTime += dt;
}

function syncRender() {
  let dirty = false;
  for (const b of world.bodies) {
    if (b.isBall) {
      b.mesh.position.set(b.px, b.py, b.pz);
      b.mesh.quaternion.set(b.qx, b.qy, b.qz, b.qw);
      continue;
    }
    if (b.sleeping && b.drawnAsleep) continue;
    b.drawnAsleep = b.sleeping;
    dirty = true;
    const R = b.R, L = b.local;
    for (let i = 0; i < b.vox.length; i++) {
      const o = instOf[b.vox[i]] * 16;
      const x = L[i * 3], y = L[i * 3 + 1], z = L[i * 3 + 2];
      M[o] = R[0]; M[o + 1] = R[3]; M[o + 2] = R[6]; M[o + 3] = 0;
      M[o + 4] = R[1]; M[o + 5] = R[4]; M[o + 6] = R[7]; M[o + 7] = 0;
      M[o + 8] = R[2]; M[o + 9] = R[5]; M[o + 10] = R[8]; M[o + 11] = 0;
      M[o + 12] = R[0] * x + R[1] * y + R[2] * z + b.px;
      M[o + 13] = R[3] * x + R[4] * y + R[5] * z + b.py;
      M[o + 14] = R[6] * x + R[7] * y + R[8] * z + b.pz;
      M[o + 15] = 1;
    }
  }
  if (dirty) voxMesh.instanceMatrix.needsUpdate = true;
}

const ease = (t) => t * t * (3 - 2 * t);
function captureCamera(t) {
  const u = ease(Math.min(1, t / 6));
  camera.position.lerpVectors(CAM_A, CAM_B, u);
  // tiny shake right after each impact
  const sh = (tt) => (tt > 0 && tt < 0.5 ? (1 - tt / 0.5) * 0.03 : 0);
  const s = sh(t - 0.62) + sh(t - 2.55);
  camera.position.x += Math.sin(t * 71) * s; camera.position.y += Math.sin(t * 53 + 1) * s;
  const look = new THREE.Vector3().lerpVectors(LOOK_A, LOOK_B, u);
  camera.lookAt(look);
}

reset();

// ---------------- capture mode ----------------
if (CAPTURE) {
  const substeps = Math.round(1 / FPS / SUB_DT);
  window.renderFrame = async (n) => {
    if (n < simFrame) reset();
    while (simFrame < n) {
      const t0 = performance.now();
      for (let s = 0; s < substeps; s++) stepSim(SUB_DT);
      const ms = performance.now() - t0;
      window.simStats = window.simStats || { max: 0, sum: 0, n: 0 };
      window.simStats.max = Math.max(window.simStats.max, ms / 2); window.simStats.sum += ms / 2; window.simStats.n++;
      dust.update(1 / FPS);
      simFrame++;
    }
    syncRender();
    captureCamera(n / FPS);
    renderer.render(scene, camera);
    return true;
  };
  window.captureReady = true;
} else {
  // ---------------- interactive ----------------
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(LOOK_A);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 3; controls.maxDistance = 40;
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  addEventListener('keydown', (e) => { if (e.key === 'r' || e.key === 'R') reset(); });
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(voxMesh)[0];
    if (hit && Math.abs(hit.point.z) < 1.0) fireBall({ x: hit.point.x, y: hit.point.y, sy: 0.3, tf: 0.5 });
  });
  let last = performance.now(), acc = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    let n = 0;
    while (acc >= SUB_DT && n < 4) { stepSim(SUB_DT); acc -= SUB_DT; n++; }
    if (n === 4) acc = 0;
    dust.update(n * SUB_DT);
    syncRender();
    controls.update();
    renderer.render(scene, camera);
  });
}
