import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { meshGrid } from './mesher.js';
import { buildWorld, buildHammer, PALETTE, HAMMER_VOXEL, ANVIL_TOP, COALS } from './world.js';
import { Billet, BX, BY, BZ, BILLET_VOXEL } from './billet.js';
import { Sparks } from './sparks.js';
import { heatColor, heatIntensity, rng } from './heat.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const W = 1280, H = 720;

// ---------- timeline ----------
const LOOP = 6.0;
const DT = 1 / 120;
const STRIKE_T = [0.6, 2.1, 3.6, 5.1];
const STRIKE_X = [22, 15, 28, 18]; // billet column of each blow
const STRIKE_HW = 3;
const BILLET_ORIGIN = new THREE.Vector3(33, ANVIL_TOP, 36);

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(CAPTURE ? W : window.innerWidth, CAPTURE ? H : window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG = new THREE.Color(0.035, 0.03, 0.03);
scene.background = FOG;
scene.fog = new THREE.FogExp2(FOG, 0.0035);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.22;

const camera = new THREE.PerspectiveCamera(38, (CAPTURE ? W / H : innerWidth / innerHeight), 1, 600);
const CAM_TARGET = new THREE.Vector3(50, 33, 40);
function camPose(t, out) {
  const az = THREE.MathUtils.degToRad(-24 + 5 * Math.sin((2 * Math.PI * t) / LOOP));
  const el = THREE.MathUtils.degToRad(15 + 2 * Math.sin((2 * Math.PI * t) / LOOP + 1));
  const r = 60;
  out.set(CAM_TARGET.x + r * Math.cos(el) * Math.sin(az), CAM_TARGET.y + r * Math.sin(el), CAM_TARGET.z + r * Math.cos(el) * Math.cos(az));
  return out;
}
camPose(0, camera.position);
camera.lookAt(CAM_TARGET);

let controls = null;
if (!CAPTURE) {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(CAM_TARGET);
  controls.enableDamping = true;
  controls.minDistance = 25; controls.maxDistance = 160;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.update();
}

// ---------- static voxel world ----------
const matMatte = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0 });
const matMetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.45 });
const matEmber = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
const matSky = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
const MATS = { 0: matMatte, 1: matMetal, 2: matEmber, 3: matSky };

const worldGeo = meshGrid(buildWorld(), PALETTE, 1);
for (const g in worldGeo) {
  const mesh = new THREE.Mesh(worldGeo[g], MATS[g]);
  mesh.castShadow = g !== '2' && g !== '3';
  mesh.receiveShadow = true;
  scene.add(mesh);
}
// embers flicker: scale the emissive colour per frame
const emberBase = worldGeo[2] ? worldGeo[2].attributes.color.array.slice() : null;
const emberPhase = emberBase ? new Float32Array(emberBase.length / 12).map((_, i) => (i * 2.399) % 6.283) : null;
function flickerEmbers(t) {
  if (!emberBase) return;
  const a = worldGeo[2].attributes.color.array;
  for (let q = 0; q < emberPhase.length; q++) {
    const ph = emberPhase[q];
    const f = 1.6 + 0.9 * Math.sin(t * 3.1 + ph) * Math.sin(t * 1.7 + ph * 2.3);
    for (let k = q * 12; k < q * 12 + 12; k++) a[k] = emberBase[k] * f;
  }
  worldGeo[2].attributes.color.needsUpdate = true;
}

// ---------- hammer ----------
const hammerGeo = meshGrid(buildHammer(), PALETTE, HAMMER_VOXEL);
const hammerPivot = new THREE.Group();
const hammerBody = new THREE.Group();
// pivot sits at the handle end; head face centre at (0, -3.25, -20) relative to pivot
hammerBody.position.set(-2, -3.25, -22);
for (const g in hammerGeo) {
  const m = new THREE.Mesh(hammerGeo[g], MATS[g]);
  m.castShadow = true; m.receiveShadow = true;
  hammerBody.add(m);
}
hammerPivot.add(hammerBody);
hammerPivot.rotation.order = 'YXZ';
hammerPivot.rotation.y = Math.PI / 2; // handle points along +x
scene.add(hammerPivot);

// ---------- billet (instanced voxels from the simulated grid) ----------
const billet = new Billet();
const billetMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.02, 0.018, 0.017), roughness: 0.85, metalness: 0.2, envMapIntensity: 0.3 });
billetMat.onBeforeCompile = (s) => {
  s.vertexShader = 'attribute vec3 aGlow;\nvarying vec3 vGlow;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vGlow = aGlow;');
  s.fragmentShader = 'varying vec3 vGlow;\n' + s.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vGlow;');
};
const billetMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(BILLET_VOXEL, BILLET_VOXEL, BILLET_VOXEL), billetMat, BX * BY * BZ);
const glow = new Float32Array(BX * BY * BZ * 3);
billetMesh.geometry.setAttribute('aGlow', new THREE.InstancedBufferAttribute(glow, 3));
billetMesh.geometry.attributes.aGlow.setUsage(THREE.DynamicDrawUsage);
billetMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
billetMesh.castShadow = true; billetMesh.receiveShadow = true;
billetMesh.frustumCulled = false;
scene.add(billetMesh);

function vhash(i) { let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
const tmpC = [0, 0, 0];
function updateBilletMesh() {
  const m = billetMesh.instanceMatrix.array;
  let n = 0;
  for (let z = 0; z < BZ; z++) for (let y = 0; y < BY; y++) for (let x = 0; x < BX; x++) {
    if (!billet.solid(x, y, z)) continue;
    // skip fully buried voxels
    if (billet.solid(x - 1, y, z) && billet.solid(x + 1, y, z) && billet.solid(x, y + 1, z) &&
        billet.solid(x, y, z - 1) && billet.solid(x, y, z + 1) && (y === 0 || billet.solid(x, y - 1, z))) continue;
    const i = billet.idx(x, y, z);
    const T = billet.T[i];
    const o = n * 16;
    m[o] = 1; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0;
    m[o + 4] = 0; m[o + 5] = 1; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = 1; m[o + 11] = 0;
    m[o + 12] = BILLET_ORIGIN.x + (x + 0.5) * BILLET_VOXEL;
    m[o + 13] = BILLET_ORIGIN.y + (y + 0.5) * BILLET_VOXEL;
    m[o + 14] = BILLET_ORIGIN.z + (z + 0.5) * BILLET_VOXEL;
    m[o + 15] = 1;
    heatColor(T, tmpC);
    // per-voxel variation; oxide scale flecks appear as the steel drops below ~950 C
    const hsh = vhash(i);
    let k = 0.7 + 0.55 * hsh;
    // oxide scale flecks: dark specks even when hot, spreading as the steel drops below ~950 C
    const scaleAmt = T > 950 ? 0.9 : 0.9 - 0.35 * Math.min(1, (950 - T) / 300);
    if (hsh > scaleAmt) k *= T > 950 ? 0.6 : 0.4;
    glow[n * 3] = tmpC[0] * k; glow[n * 3 + 1] = tmpC[1] * k; glow[n * 3 + 2] = tmpC[2] * k;
    n++;
  }
  billetMesh.count = n;
  billetMesh.instanceMatrix.needsUpdate = true;
  billetMesh.geometry.attributes.aGlow.needsUpdate = true;
}

// ---------- sparks ----------
let rand = rng(1234);
const sparks = new Sparks(2400, () => rand());
scene.add(sparks.mesh);

// ---------- lights ----------
// bounce fill: cool from above (window), warm from the floor (coals)
scene.add(new THREE.HemisphereLight(new THREE.Color(0.45, 0.55, 0.75), new THREE.Color(0.35, 0.2, 0.12), 0.9));
// daylight through the back-wall window: the wall shadows everything except the window opening
const windowLight = new THREE.DirectionalLight(new THREE.Color(0.62, 0.74, 1.0), 2.6);
windowLight.position.set(96, 95, -70);
windowLight.target.position.set(70, 2, 45);
windowLight.castShadow = true;
windowLight.shadow.mapSize.set(2048, 2048);
Object.assign(windowLight.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 10, far: 300 });
windowLight.shadow.bias = -0.0005;
windowLight.shadow.normalBias = 0.3;
scene.add(windowLight, windowLight.target);
// soft cool key from the open door (front right), no shadows
const doorLight = new THREE.DirectionalLight(new THREE.Color(0.55, 0.65, 0.85), 0.7);
doorLight.position.set(140, 60, 120);
doorLight.target.position.set(40, 20, 20);
scene.add(doorLight, doorLight.target);
const forgeLight = new THREE.PointLight(new THREE.Color(1.0, 0.45, 0.16), 300, 0, 1.25);
forgeLight.castShadow = true;
forgeLight.shadow.mapSize.set(512, 512);
forgeLight.shadow.camera.far = 200;
forgeLight.shadow.bias = -0.003;
forgeLight.shadow.normalBias = 0.1;
forgeLight.position.set((COALS.x0 + COALS.x1) / 2, COALS.y + 5, (COALS.z0 + COALS.z1) / 2 + 2);
scene.add(forgeLight);

const billetLight = new THREE.PointLight(0xffffff, 0, 0, 1.6);
billetLight.castShadow = true;
billetLight.shadow.mapSize.set(1024, 1024);
billetLight.shadow.camera.near = 0.5;
billetLight.shadow.camera.far = 160;
billetLight.shadow.bias = -0.002;
billetLight.shadow.normalBias = 0.06;
scene.add(billetLight);

// ---------- post ----------
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.4, 0.4, 0.5);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const dither = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uFrame: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uFrame; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uFrame*0.618) * 43758.5453); }
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = vUv - 0.5; float vig = 1.0 - dot(q,q)*0.35;
      c.rgb *= vig;
      c.rgb += (h(gl_FragCoord.xy) + h(gl_FragCoord.xy + 17.3) - 1.0) / 255.0;
      gl_FragColor = c; }`,
});
composer.addPass(dither);

function resize() {
  const w = CAPTURE ? W : innerWidth, h = CAPTURE ? H : innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
resize();
if (!CAPTURE) addEventListener('resize', resize);

// ---------- simulation ----------
// Pre-run the blows on a scratch billet to know where the hammer face lands.
const topAfter = (() => {
  const b = new Billet();
  const init = b.topY(0, BX - 1);
  const out = STRIKE_X.map((x) => b.strike(x, STRIKE_HW));
  return { init, out };
})();
const strikeWorldX = (k) => BILLET_ORIGIN.x + (STRIKE_X[k] + 0.5) * BILLET_VOXEL;

let simT = 0, nextStrike = 0, flash = 0, shake = 0, prevLoopT = 0;
function resetSim() {
  simT = 0; nextStrike = 0; flash = 0; shake = 0; prevLoopT = 0;
  rand = rng(1234);
  billet.reset();
  sparks.clear();
}

function hammerState(lt) {
  let k = -1;
  for (let i = 0; i < STRIKE_T.length; i++) if (lt >= STRIKE_T[i]) k = i;
  const u = k >= 0 ? lt - STRIKE_T[k] : lt + (LOOP - STRIKE_T[3]);
  const prevK = k >= 0 ? k : 3;
  const nextK = (k + 1) % 4;
  const prevTop = k >= 0 ? topAfter.out[k] : topAfter.init;
  const nextTop = topAfter.out[nextK];
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  let th;
  if (u < 0.3) th = 0.1 * Math.sin((Math.PI * u) / 0.3);
  else if (u < 0.45) th = 0;
  else if (u < 1.05) th = 1.0 * smooth(0.45, 1.05, u);
  else if (u < 1.25) th = 1.0 + 0.08 * smooth(1.05, 1.25, u);
  else { const s = (u - 1.25) / 0.25; th = 1.08 * (1 - s * s); }
  const m = smooth(0.45, 1.05, u);
  const x = THREE.MathUtils.lerp(strikeWorldX(prevK), strikeWorldX(nextK), m);
  const top = THREE.MathUtils.lerp(prevTop, nextTop, m);
  return { th, x, top, contact: u < 0.3, k: prevK };
}

function stepSim() {
  simT += DT;
  const lt = simT % LOOP;
  if (lt < prevLoopT) { billet.reset(); nextStrike = 0; }
  prevLoopT = lt;
  if (nextStrike < STRIKE_T.length && lt >= STRIKE_T[nextStrike]) {
    const k = nextStrike++;
    billet.strike(STRIKE_X[k], STRIKE_HW);
    const heat = billet.meanSurfaceT();
    const top = ANVIL_TOP + topAfter.out[k] * BILLET_VOXEL;
    sparks.burst(strikeWorldX(k), top + 0.3, 40, Math.round(50 + Math.max(0, heat - 600) * 0.12), heat);
    flash = 1; shake = 1;
  }
  const hs = hammerState(lt);
  const zone = hs.contact ? [STRIKE_X[hs.k] - STRIKE_HW, STRIKE_X[hs.k] + STRIKE_HW] : null;
  billet.step(DT, zone);
  // hot scale flaking off the billet, embers rising from the coals
  const heat = billet.meanSurfaceT();
  if (rand() < (heat - 700) / 3000) {
    const x = BILLET_ORIGIN.x + (8 + rand() * 24) * BILLET_VOXEL;
    sparks.spawn(x, ANVIL_TOP + 2.2, 39 + rand() * 2, (rand() - 0.5) * 20, 10 + rand() * 25, (rand() - 0.5) * 20, heat + 80, 0.4 + rand() * 0.5, 0.18, 0);
  }
  if (rand() < 0.05) {
    sparks.spawn(COALS.x0 + rand() * (COALS.x1 - COALS.x0), COALS.y + 1, COALS.z0 + rand() * (COALS.z1 - COALS.z0),
      (rand() - 0.5) * 4, 4 + rand() * 6, (rand() - 0.5) * 4, 1000 + rand() * 250, 1.5 + rand() * 2, 0.2 + rand() * 0.12, 1);
  }
  sparks.step(DT);
  flash = Math.max(0, flash - DT / 0.12);
  shake = Math.max(0, shake - DT / 0.25);
}

function simulateTo(t) {
  if (t < simT - 1e-6) resetSim();
  while (simT + DT <= t + 1e-6) stepSim();
}

// ---------- per-frame draw ----------
const lightCol = [0, 0, 0];
const camTmp = new THREE.Vector3();
function draw(t, frameNo) {
  const lt = simT % LOOP;
  const hs = hammerState(lt);
  hammerPivot.position.set(hs.x + 20, ANVIL_TOP + hs.top * BILLET_VOXEL + 3.25, 40);
  hammerPivot.rotation.x = hs.th;

  updateBilletMesh();
  sparks.updateMesh();
  flickerEmbers(t);

  const sT = billet.meanSurfaceT();
  heatColor(sT, lightCol);
  const I = heatIntensity(sT);
  const n = Math.max(1e-4, Math.max(lightCol[0], lightCol[1], lightCol[2]));
  billetLight.color.setRGB(lightCol[0] / n, lightCol[1] / n, lightCol[2] / n);
  billetLight.intensity = 450 * I + 220 * flash;
  billetLight.position.set(BILLET_ORIGIN.x + 10, ANVIL_TOP + 5, 50);
  forgeLight.intensity = 220 + 50 * Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1.0);

  if (CAPTURE) {
    camPose(t, camera.position);
    camTmp.set(Math.sin(t * 90), Math.cos(t * 77), 0).multiplyScalar(0.18 * shake * shake);
    camera.position.add(camTmp);
    camera.lookAt(CAM_TARGET);
  } else {
    controls.update();
  }
  dither.uniforms.uFrame.value = frameNo % 64;
  composer.render();
}

// ---------- drive ----------
const hud = document.getElementById('hud');
if (CAPTURE) {
  if (hud) hud.remove();
  window.renderFrame = (n) => new Promise((resolve) => {
    const t = n / 30;
    simulateTo(t);
    draw(t, n);
    requestAnimationFrame(() => resolve(true));
  });
  window.captureReady = true;
} else {
  let paused = false, last = performance.now(), wall = 0, frames = 0, fpsT = 0, frameNo = 0;
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') paused = !paused;
    if (e.code === 'KeyH' && hud) hud.style.display = hud.style.display === 'none' ? '' : 'none';
    if (e.code === 'KeyR') { resetSim(); wall = 0; }
  });
  const loop = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!paused) { wall += dt; simulateTo(wall); }
    draw(wall, frameNo++);
    frames++; fpsT += dt;
    if (fpsT > 0.5 && hud) { hud.textContent = `${Math.round(frames / fpsT)} fps  ·  drag orbit · scroll zoom · space pause · R restart · H hide`; frames = 0; fpsT = 0; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
