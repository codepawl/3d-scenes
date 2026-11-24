import * as THREE from 'three';
import { POOL, poolShader, surfaceShader, postShader } from './shaders.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const FPS = 30;

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: CAPTURE,
});
if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 required');
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(window.devicePixelRatio, 1.5));
document.body.appendChild(renderer.domElement);

const hud = document.getElementById('hud');
if (CAPTURE) hud.style.display = 'none';

// --- sun: 58 deg elevation in air, refracted into water (Snell) ---
const sunAir = new THREE.Vector3(0.5, 0.866, 0.15).normalize().negate(); // pointing down
const sunW = (() => {
  const n = new THREE.Vector3(0, 1, 0);
  const eta = 1 / 1.333;
  const cosi = -n.dot(sunAir);
  const k = 1 - eta * eta * (1 - cosi * cosi);
  return sunAir.clone().multiplyScalar(eta).add(n.clone().multiplyScalar(eta * cosi - Math.sqrt(k))).normalize();
})();

const uniforms = {
  uTime: { value: 0 },
  uSunW: { value: sunW },
  uCamPos: { value: new THREE.Vector3() },
};

// --- scene ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.05, 60);

const { HX, HZ, SURF, TOP } = POOL;
const shellMat = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: poolShader.vertexShader,
  fragmentShader: poolShader.fragmentShader,
  side: THREE.FrontSide,
});
// Interior of a box: floor + 4 walls facing inward (no lid).
function plane(w, h, pos, rotX, rotY) {
  const g = new THREE.PlaneGeometry(w, h, 1, 1);
  const m = new THREE.Mesh(g, shellMat);
  m.rotation.order = 'YXZ';
  m.rotation.y = rotY;
  m.rotation.x = rotX;
  m.position.copy(pos);
  scene.add(m);
}
plane(2 * HX, 2 * HZ, new THREE.Vector3(0, 0, 0), -Math.PI / 2, 0); // floor
plane(2 * HZ, TOP, new THREE.Vector3(-HX, TOP / 2, 0), 0, Math.PI / 2); // x- wall faces +x
plane(2 * HZ, TOP, new THREE.Vector3(HX, TOP / 2, 0), 0, -Math.PI / 2); // x+ wall faces -x
plane(2 * HX, TOP, new THREE.Vector3(0, TOP / 2, -HZ), 0, 0); // z- wall faces +z
plane(2 * HX, TOP, new THREE.Vector3(0, TOP / 2, HZ), 0, Math.PI); // z+ wall faces -z

const surfMat = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: surfaceShader.vertexShader,
  fragmentShader: surfaceShader.fragmentShader,
  side: THREE.DoubleSide,
});
const surf = new THREE.Mesh(new THREE.PlaneGeometry(2 * HX, 2 * HZ), surfMat);
surf.rotation.x = Math.PI / 2; // normal faces down
surf.position.y = SURF;
scene.add(surf);

// --- HDR target + post ---
const rt = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  samples: 4,
  depthBuffer: true,
});
const postMat = new THREE.ShaderMaterial({
  uniforms: {
    tColor: { value: rt.texture },
    uRes: { value: new THREE.Vector2() },
    uFrame: { value: 0 },
    uExposure: { value: 0.72 },
  },
  vertexShader: postShader.vertexShader,
  fragmentShader: postShader.fragmentShader,
  depthTest: false,
  depthWrite: false,
});
const postScene = new THREE.Scene();
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));

function resize() {
  const w = CAPTURE ? 1280 : window.innerWidth;
  const h = CAPTURE ? 720 : window.innerHeight;
  renderer.setSize(w, h, !CAPTURE);
  if (CAPTURE) {
    renderer.domElement.style.width = '1280px';
    renderer.domElement.style.height = '720px';
  }
  const pr = renderer.getPixelRatio();
  rt.setSize(Math.floor(w * pr), Math.floor(h * pr));
  postMat.uniforms.uRes.value.set(w * pr, h * pr);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// --- camera: slow underwater dolly along the pool ---
const look = { yaw: 0, pitch: 0 };
let speed = 1;
let paused = false;
function cameraAt(t) {
  // ping-pong dolly over 8 m at ~0.28 m/s, gentle bob and drift
  const span = 8.0;
  const v = 0.28;
  const u = (t * v) % (2 * span);
  const s = u < span ? u : 2 * span - u;
  const e = s / span;
  const x = -5.6 + span * (e * e * (3 - 2 * e) * 0.15 + e * 0.85);
  const y = 0.95 + 0.06 * Math.sin(t * 0.7) + 0.03 * Math.sin(t * 1.9);
  const z = -0.95 + 0.25 * Math.sin(t * 0.13);
  camera.position.set(x, y, z);
  const yaw = 0.16 + 0.05 * Math.sin(t * 0.21) + look.yaw;
  const pitch = -0.2 + 0.02 * Math.sin(t * 0.5) + look.pitch;
  const dir = new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));
  camera.lookAt(camera.position.clone().add(dir));
  camera.rotateZ(0.012 * Math.sin(t * 0.4));
}

let frameNo = 0;
function draw(t) {
  uniforms.uTime.value = t;
  cameraAt(t);
  uniforms.uCamPos.value.copy(camera.position);
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  postMat.uniforms.uFrame.value = frameNo++ % 64;
  renderer.render(postScene, postCam);
}

if (CAPTURE) {
  const T0 = 3.0; // start offset into the dolly
  window.renderFrame = (n) =>
    new Promise((resolve) => {
      draw(T0 + n / FPS);
      renderer.getContext().finish();
      requestAnimationFrame(() => resolve(true));
    });
  window.captureReady = true;
} else {
  // interaction
  let drag = null;
  renderer.domElement.addEventListener('pointerdown', (e) => (drag = { x: e.clientX, y: e.clientY, ...look }));
  window.addEventListener('pointerup', () => (drag = null));
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    look.yaw = drag.yaw + (e.clientX - drag.x) * 0.004;
    look.pitch = THREE.MathUtils.clamp(drag.pitch - (e.clientY - drag.y) * 0.004, -0.9, 0.9);
  });
  window.addEventListener('wheel', (e) => {
    speed = THREE.MathUtils.clamp(speed * (e.deltaY > 0 ? 0.85 : 1.18), 0, 6);
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') paused = !paused;
    if (e.code === 'KeyH') hud.style.display = hud.style.display === 'none' ? '' : 'none';
  });
  const clock = new THREE.Clock();
  let t = 3.0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!paused) t += dt * speed;
    draw(t);
  });
}
