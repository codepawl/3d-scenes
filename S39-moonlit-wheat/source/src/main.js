import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { wheatVertex, wheatFragment } from './shaders/wheat.js';
import { groundVertex, groundFragment } from './shaders/ground.js';
import { skyVertex, skyFragment } from './shaders/sky.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const FPS = 30;

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(window.devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.05, 2000);

// ---------- shared uniforms ----------
const moonDir = new THREE.Vector3(-0.30, 0.17, -1).normalize();
const uniforms = {
  uTime: { value: 0 },
  uMoonDir: { value: moonDir },
  uMoonColor: { value: new THREE.Color(0.50, 0.62, 0.92).multiplyScalar(0.9) },
  uWindDir: { value: new THREE.Vector2(0.25, 1).normalize() },
  uWindStrength: { value: 1.0 },
  uCamPos: { value: new THREE.Vector3() },
  uPixelK: { value: 0.001 },
};

// ---------- sky ----------
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1000, 64, 32),
  new THREE.ShaderMaterial({ uniforms, vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false })
);
sky.renderOrder = -1;
sky.frustumCulled = false;
scene.add(sky);

// ---------- ground ----------
const groundGeo = new THREE.PlaneGeometry(2000, 2000, 1, 1).rotateX(-Math.PI / 2);
const ground = new THREE.Mesh(groundGeo, new THREE.ShaderMaterial({ uniforms, vertexShader: groundVertex, fragmentShader: groundFragment }));
scene.add(ground);

// ---------- wheat ----------
function bladeGeometry(rows) {
  const uv = [];
  const idx = [];
  for (let i = 0; i <= rows; i++) {
    // denser rows on the ear
    const s = i / rows;
    const t = s < 0.4 ? s / 0.4 * 0.64 : 0.64 + (s - 0.4) / 0.6 * 0.36;
    uv.push(-0.5, t, 0.5, t);
    if (i < rows) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  return { uv: new Float32Array(uv), idx };
}

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIELD_CENTER = new THREE.Vector2(0, 16); // near the camera path
function scatter(count, rMin, rMax, halfAngle, uniformArea, rng) {
  const inst = new Float32Array(count * 4);
  const inst2 = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const u = rng();
    const r = uniformArea ? Math.sqrt(rMin * rMin + u * (rMax * rMax - rMin * rMin)) : rMin + u * (rMax - rMin);
    const ang = (rng() * 2 - 1) * halfAngle - Math.PI / 2; // centred on -z
    const x = FIELD_CENTER.x + Math.cos(ang) * r;
    const z = FIELD_CENTER.y + Math.sin(ang) * r;
    // slow variation of crop height across the field
    const hVar = 0.5 + 0.5 * Math.sin(x * 0.07 + 1.3) * Math.cos(z * 0.05);
    const h = 0.85 + 0.25 * hVar + (rng() - 0.5) * 0.18;
    inst.set([x, z, h, rng()], i * 4);
    inst2.set([rng() * Math.PI * 2, (rng() - 0.3) * 0.25], i * 2);
  }
  return { inst, inst2 };
}

const wheatMat = new THREE.ShaderMaterial({ uniforms, vertexShader: wheatVertex, fragmentShader: wheatFragment, side: THREE.DoubleSide });

function wheatMesh(rows, count, rMin, rMax, halfAngle, uniformArea, seed) {
  const { uv, idx } = bladeGeometry(rows);
  const { inst, inst2 } = scatter(count, rMin, rMax, halfAngle, uniformArea, makeRng(seed));
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('aUV', new THREE.BufferAttribute(uv, 2));
  // three needs a 'position' attribute to compute draw range; aUV doubles as it
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(uv.length / 2 * 3), 3));
  g.setIndex(idx);
  g.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 4));
  g.setAttribute('aInst2', new THREE.InstancedBufferAttribute(inst2, 2));
  g.instanceCount = count;
  const m = new THREE.Mesh(g, wheatMat);
  m.frustumCulled = false;
  return m;
}

// near: full detail, all around the camera; mid/far: fewer segments in the viewing sector
scene.add(wheatMesh(14, 60000, 0, 9, Math.PI, true, 1));
scene.add(wheatMesh(10, 70000, 9, 30, Math.PI * 0.42, false, 2));
scene.add(wheatMesh(5, 110000, 30, 150, Math.PI * 0.36, false, 3));

// ---------- camera path ----------
function cameraAt(t, cam) {
  // slow push through the field towards the moon with gentle hand-held drift
  const z = 16 - t * 0.45;
  const x = 0.4 + Math.sin(t * 0.21) * 0.6;
  const y = 2.1 + Math.sin(t * 0.37) * 0.04;
  cam.position.set(x, y, z);
  const tx = -8 + Math.sin(t * 0.15) * 3.0;
  cam.lookAt(tx, 1.2, z - 40);
}

let controls = null;
let autoCam = true;
if (!CAPTURE) {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.53;
  controls.minDistance = 0.5;
  controls.maxDistance = 30;
  controls.addEventListener('start', () => {
    if (autoCam) {
      autoCam = false;
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      controls.target.copy(camera.position).addScaledVector(dir, 6);
    }
  });
}

function resize() {
  const w = CAPTURE ? 1280 : window.innerWidth;
  const h = CAPTURE ? 720 : window.innerHeight;
  renderer.setSize(w, h, !CAPTURE);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  uniforms.uPixelK.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / (h * renderer.getPixelRatio());
}
window.addEventListener('resize', resize);
resize();

function draw(t) {
  uniforms.uTime.value = t;
  if (autoCam) cameraAt(t, camera);
  else controls.update();
  uniforms.uCamPos.value.copy(camera.position);
  renderer.render(scene, camera);
}

if (CAPTURE) {
  window.renderFrame = async (n) => {
    draw(n / FPS);
    const gl = renderer.getContext();
    gl.finish();
    return renderer.domElement.toDataURL('image/png');
  };
  draw(0);
  window.captureReady = true;
} else {
  let paused = false;
  let simTime = 0;
  let last = performance.now();
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') paused = !paused;
    if (e.code === 'KeyC') autoCam = true;
    if (e.code === 'BracketRight') uniforms.uWindStrength.value = Math.min(1.6, uniforms.uWindStrength.value + 0.1);
    if (e.code === 'BracketLeft') uniforms.uWindStrength.value = Math.max(0.0, uniforms.uWindStrength.value - 0.1);
  });
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!paused) simTime += dt;
    draw(simTime);
  });
}
