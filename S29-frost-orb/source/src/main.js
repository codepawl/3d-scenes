import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import traceFrag from './trace.frag.glsl?raw';
import displayFrag from './display.frag.glsl?raw';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const FPS = 30;
const CAPTURE_SUBFRAMES = Number(params.get('sub') || 12); // jittered sub-frames averaged per video frame
const CAPTURE_SPP = 6;                                       // samples per pixel per sub-frame
const LIVE_SPP = 3;

const W = CAPTURE ? 1280 : innerWidth;
const H = CAPTURE ? 720 : innerHeight;

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  alpha: false,
  preserveDrawingBuffer: CAPTURE,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(1);
renderer.setSize(W, H, !CAPTURE);
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);
if (CAPTURE) {
  document.getElementById('hud').style.display = 'none';
  renderer.domElement.style.width = W + 'px';
  renderer.domElement.style.height = H + 'px';
}

// ---------------------------------------------------------------- camera
const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 100);
const TARGET = new THREE.Vector3(0, 0.92, 0);
camera.position.set(0.9, 1.75, 4.6);
camera.lookAt(TARGET);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(TARGET);
controls.enableDamping = true;
controls.minDistance = 2.4;
controls.maxDistance = 9;
controls.maxPolarAngle = Math.PI * 0.49;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;
controls.enabled = !CAPTURE;

// ---------------------------------------------------------------- targets
function makeRT(w, h) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
  });
  return rt;
}
let rtA = makeRT(W, H);
let rtB = makeRT(W, H);

// seed direction for the frost: upper-left of the orb, facing the camera
const seedDir = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();

const traceMat = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: /* glsl */ `
    in vec3 position;
    out vec2 vUv;
    void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: traceFrag,
  uniforms: {
    uPrev: { value: null },
    uAlpha: { value: 1 },
    uRes: { value: new THREE.Vector2(W, H) },
    uJitter: { value: new THREE.Vector2() },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uPixelAngle: { value: 0.001 },
    uFrame: { value: 0 },
    uSpp: { value: LIVE_SPP },
    uFront: { value: 0 },
    uCover: { value: 0 },
    uSeed: { value: seedDir },
    uTime: { value: 0 },
  },
  depthTest: false,
  depthWrite: false,
});

const displayMat = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: traceMat.vertexShader,
  fragmentShader: displayFrag,
  uniforms: {
    uTex: { value: null },
    uRes: { value: new THREE.Vector2(W, H) },
    uFrame: { value: 0 },
    uExposure: { value: 1.0 },
  },
  depthTest: false,
  depthWrite: false,
});

const quadGeo = new THREE.BufferGeometry();
quadGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
const traceMesh = new THREE.Mesh(quadGeo, traceMat);
const displayMesh = new THREE.Mesh(quadGeo, displayMat);
traceMesh.frustumCulled = displayMesh.frustumCulled = false;
const traceScene = new THREE.Scene().add(traceMesh);
const displayScene = new THREE.Scene().add(displayMesh);
const dummyCam = new THREE.Camera();

// ---------------------------------------------------------------- frost growth timeline
// front = geodesic angle (radians) of the growth front around the seed point.
function frontAt(t, loop) {
  if (loop) {
    const period = 16;
    const u = (t % period);
    if (u < 12) return 0.04 + 3.2 * Math.pow(u / 12, 0.85);
    return 3.24 * (1 - smooth((u - 12) / 4)); // melt back
  }
  // capture: 6 s, starts as a few nuclei, ends with most of the visible face frosted
  return 0.22 + 1.95 * Math.pow(t / 6, 0.9);
}
function smooth(x) { x = Math.min(Math.max(x, 0), 1); return x * x * (3 - 2 * x); }

// ---------------------------------------------------------------- camera path for capture
function captureCamera(t) {
  const u = t / 6;
  const az = THREE.MathUtils.degToRad(12 + 22 * u);      // slow orbit
  const el = THREE.MathUtils.degToRad(17 - 3 * u);
  const dist = 4.85 - 0.4 * smooth(u);                     // gentle dolly-in
  camera.position.set(
    TARGET.x + dist * Math.cos(el) * Math.sin(az),
    TARGET.y + dist * Math.sin(el),
    TARGET.z + dist * Math.cos(el) * Math.cos(az));
  camera.lookAt(TARGET);
}

let frameCounter = 0;
function updateCameraUniforms() {
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const u = traceMat.uniforms;
  u.uInvProj.value.copy(camera.projectionMatrixInverse);
  u.uCamWorld.value.copy(camera.matrixWorld);
  u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
  u.uPixelAngle.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / traceMat.uniforms.uRes.value.y;
}

// Halton for subpixel jitter
function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }

function traceInto(alpha, jitterIndex, spp) {
  const u = traceMat.uniforms;
  u.uPrev.value = rtA.texture;
  u.uAlpha.value = alpha;
  u.uSpp.value = spp;
  u.uFrame.value = frameCounter++;
  u.uJitter.value.set(halton(jitterIndex + 1, 2) - 0.5, halton(jitterIndex + 1, 3) - 0.5);
  renderer.setRenderTarget(rtB);
  renderer.render(traceScene, dummyCam);
  const t = rtA; rtA = rtB; rtB = t;
}

function present() {
  displayMat.uniforms.uTex.value = rtA.texture;
  displayMat.uniforms.uFrame.value = frameCounter;
  renderer.setRenderTarget(null);
  renderer.render(displayScene, dummyCam);
}

function setTime(t, loop) {
  const front = frontAt(t, loop);
  traceMat.uniforms.uFront.value = front;
  traceMat.uniforms.uCover.value = smooth(front / 3.0);
  traceMat.uniforms.uTime.value = t;
}

// ---------------------------------------------------------------- capture mode
if (CAPTURE) {
  window.renderFrame = async (n) => {
    const t = n / FPS;
    captureCamera(t);
    setTime(t, false);
    updateCameraUniforms();
    for (let s = 0; s < CAPTURE_SUBFRAMES; s++) traceInto(1 / (s + 1), n * CAPTURE_SUBFRAMES + s, CAPTURE_SPP);
    present();
    await new Promise((r) => requestAnimationFrame(() => r()));
    return true;
  };
  window.captureReady = true;
} else {
  // ---------------------------------------------------------------- live mode
  let growTime = 0, paused = false, last = performance.now(), hudOn = true, jit = 0;
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') paused = !paused;
    if (e.code === 'KeyR') growTime = 0;
    if (e.code === 'KeyH') { hudOn = !hudOn; document.getElementById('hud').style.display = hudOn ? '' : 'none'; }
  });
  addEventListener('resize', () => {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    rtA.dispose(); rtB.dispose(); rtA = makeRT(w, h); rtB = makeRT(w, h);
    traceMat.uniforms.uRes.value.set(w, h);
    displayMat.uniforms.uRes.value.set(w, h);
  });
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    if (!paused) growTime += dt;
    controls.update(dt);
    camera.aspect = renderer.domElement.width / renderer.domElement.height;
    setTime(growTime, true);
    updateCameraUniforms();
    // exponential moving average across frames (temporal denoise of the stochastic transmission)
    traceInto(jit === 0 ? 1 : 0.34, jit++ % 16, LIVE_SPP);
    present();
  });
}
