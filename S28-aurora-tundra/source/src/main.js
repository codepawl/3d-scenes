import * as THREE from 'three';
import frag from './scene.frag.glsl?raw';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const FPS = 30;

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  preserveDrawingBuffer: CAPTURE,
  powerPreference: 'high-performance',
});
if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 required');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const uniforms = {
  uRes: { value: new THREE.Vector2() },
  uTime: { value: 0 },
  uCamPos: { value: new THREE.Vector3() },
  uCamRot: { value: new THREE.Matrix3() },
  uFov: { value: Math.tan(THREE.MathUtils.degToRad(58) / 2) },
  uAuroraSteps: { value: Number(params.get('steps')) || (CAPTURE ? 64 : 32) },
};

const material = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms,
  vertexShader: /* glsl */ `
    in vec3 position;
    void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: frag,
  depthTest: false,
  depthWrite: false,
});
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

// ---- sizing
function resize() {
  let w, h, pr;
  if (CAPTURE) {
    w = Number(params.get('w')) || 1280;
    h = Number(params.get('h')) || 720;
    pr = 1;
  } else {
    w = innerWidth; h = innerHeight;
    pr = Math.min(devicePixelRatio, Number(params.get('pr')) || 1);
  }
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, !CAPTURE);
  renderer.getDrawingBufferSize(uniforms.uRes.value);
}
addEventListener('resize', resize);
resize();

// ---- camera: slow drift along the shore + user look offsets
let yawOff = 0, pitchOff = 0;
const tmpM = new THREE.Matrix4();
const right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3();

function updateCamera(t) {
  const x = -10 + t * 1.6;
  const z = 90 + t * 0.6;
  const y = 1.9 + Math.sin(t * 0.21) * 0.05;
  uniforms.uCamPos.value.set(x, y, z);
  const yaw = 0.06 + Math.sin(t * 0.05) * 0.05 + yawOff;
  const pitch = 0.22 + Math.sin(t * 0.09) * 0.012 + pitchOff;
  fwd.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).normalize();
  right.crossVectors(new THREE.Vector3(0, 1, 0), fwd).normalize();
  up.crossVectors(fwd, right).normalize();
  tmpM.makeBasis(right, up, fwd);
  uniforms.uCamRot.value.setFromMatrix4(tmpM);
}

function draw(t) {
  uniforms.uTime.value = t;
  updateCamera(t);
  renderer.render(scene, camera);
}

if (CAPTURE) {
  const t0 = Number(params.get('t0')) || 0;
  window.renderFrame = (n) => new Promise((resolve) => {
    draw(t0 + n / FPS);
    const gl = renderer.getContext();
    gl.finish();
    requestAnimationFrame(() => resolve(true));
  });
  window.captureReady = true;
} else {
  // controls: drag to look, space to pause, +/- to change speed
  let dragging = false, lx = 0, ly = 0, paused = false, speed = 1, simT = 0, last = performance.now();
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; el.style.cursor = 'grabbing'; });
  addEventListener('pointerup', () => { dragging = false; el.style.cursor = 'grab'; });
  addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yawOff -= (e.clientX - lx) * 0.003;
    pitchOff = THREE.MathUtils.clamp(pitchOff - (e.clientY - ly) * 0.003, -0.35, 1.0);
    lx = e.clientX; ly = e.clientY;
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') paused = !paused;
    if (e.key === '+' || e.key === '=') speed = Math.min(speed * 2, 16);
    if (e.key === '-') speed = Math.max(speed / 2, 0.125);
    if (e.key === 'r') { yawOff = 0; pitchOff = 0; }
  });
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    if (!paused) simT += ((now - last) / 1000) * speed;
    last = now;
    draw(simT);
  });
}
