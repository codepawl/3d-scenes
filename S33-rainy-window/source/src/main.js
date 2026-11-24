import * as THREE from 'three';
import common from './shaders/common.glsl?raw';
import vert from './shaders/fullscreen.vert?raw';
import streetFrag from './shaders/street.frag?raw';
import blurFrag from './shaders/blur.frag?raw';
import glassFrag from './shaders/glass.frag?raw';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const NL = 64;

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  preserveDrawingBuffer: CAPTURE,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(window.devicePixelRatio, 1.5));
document.body.appendChild(renderer.domElement);

const inc = (src) => src.replace('#include <common>', common);
const quad = new THREE.BufferGeometry();
quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
const camera = new THREE.Camera();

function pass(frag, uniforms) {
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: vert,
    fragmentShader: inc(frag),
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(quad, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { scene, mat, u: uniforms };
}

const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
const rt = {
  bg: new THREE.WebGLRenderTarget(2, 2, rtOpts),
  a1: new THREE.WebGLRenderTarget(2, 2, rtOpts),
  b1: new THREE.WebGLRenderTarget(2, 2, rtOpts),
  a2: new THREE.WebGLRenderTarget(2, 2, rtOpts),
  b2: new THREE.WebGLRenderTarget(2, 2, rtOpts),
};

const lightPos = Array.from({ length: NL }, () => new THREE.Vector4());
const lightCol = Array.from({ length: NL }, () => new THREE.Vector4());

const street = pass(streetFrag, {
  uRes: { value: new THREE.Vector2() },
  uTime: { value: 0 },
  uSway: { value: new THREE.Vector2() },
  uLightPos: { value: lightPos },
  uLightCol: { value: lightCol },
  uCount: { value: 0 },
});
const blur = pass(blurFrag, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
const glass = pass(glassFrag, {
  uRes: { value: new THREE.Vector2() },
  uTime: { value: 0 },
  uSway: { value: new THREE.Vector2() },
  tBg: { value: rt.bg.texture },
  tBlur1: { value: rt.b1.texture },
  tBlur2: { value: rt.b2.texture },
});

// ---- the street's lights (aspect space: x in about [-0.89, 0.89], y in [-0.5, 0.5])
function rand(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
const SODIUM = [1.0, 0.52, 0.16];
function updateLights(t) {
  let n = 0;
  const add = (x, y, r, I, c, refl = 1) => {
    if (n >= NL) return;
    lightPos[n].set(x, y, r, I);
    lightCol[n].set(c[0], c[1], c[2], refl);
    n++;
  };
  // street lamps receding to the right
  for (let i = 0; i < 7; i++) {
    const k = i / 6;
    const x = -0.55 + 1.25 * Math.pow(k, 0.8);
    const y = 0.30 - 0.27 * k;
    add(x, y, 0.085 - 0.04 * k, 1.0 - 0.3 * k, SODIUM);
  }
  // a second row across the street, smaller, cooler LED heads
  for (let i = 0; i < 5; i++) {
    const k = i / 4;
    add(-0.85 + 0.9 * k, 0.12 - 0.08 * k, 0.05 - 0.015 * k, 0.6, [0.75, 0.85, 1.0]);
  }
  // traffic signal: red / green / amber cycle
  const ph = (t % 9) / 9;
  const sig = ph < 0.45 ? [1.0, 0.08, 0.04] : ph < 0.9 ? [0.15, 1.0, 0.45] : [1.0, 0.6, 0.05];
  const sy = ph < 0.45 ? 0.05 : ph < 0.9 ? 0.01 : 0.03;
  add(-0.28, sy, 0.05, 1.4, sig);
  add(0.42, sy - 0.03, 0.035, 1.1, sig);
  // neon: pink sign flickers, cyan one steady
  const flick = 0.75 + 0.25 * Math.sin(t * 23.0) * Math.sin(t * 3.1) + (Math.sin(t * 1.7) > 0.97 ? -0.6 : 0);
  for (let i = 0; i < 4; i++) add(0.50 + i * 0.045, 0.14 + 0.01 * Math.sin(i), 0.03, 0.8 * flick, [1.0, 0.18, 0.55]);
  for (let i = 0; i < 3; i++) add(-0.70 + i * 0.05, 0.20, 0.032, 0.7, [0.2, 0.9, 1.0]);
  // cars, right-bound headlights (near lane) and left-bound tail lights (far lane)
  for (let i = 0; i < 4; i++) {
    const span = 2.6;
    const x = ((t * 0.32 + i * 0.71 + rand(i) * 0.3) % span) - 1.3;
    const c = [1.0, 0.92, 0.78];
    add(x, -0.13, 0.065, 1.0, c);
    add(x + 0.09, -0.13, 0.065, 1.0, c);
  }
  for (let i = 0; i < 3; i++) {
    const span = 2.6;
    const x = 1.3 - ((t * 0.18 + i * 0.93 + rand(i + 9) * 0.4) % span);
    add(x, -0.09, 0.045, 0.9, [1.0, 0.06, 0.03]);
    add(x + 0.055, -0.09, 0.045, 0.9, [1.0, 0.06, 0.03]);
  }
  // far scattered window lights
  for (let i = 0; i < 12; i++) {
    const x = -0.85 + 1.7 * rand(i + 40);
    const y = 0.0 + 0.35 * rand(i + 80);
    const warm = rand(i + 120) > 0.3;
    add(x, y, 0.025 + 0.02 * rand(i + 160), 0.25 + 0.3 * rand(i + 200), warm ? [1.0, 0.7, 0.4] : [0.6, 0.75, 1.0], 0);
  }
  street.u.uCount.value = n;
}

let W = 0, H = 0;
function resize() {
  W = CAPTURE ? 1280 : window.innerWidth;
  H = CAPTURE ? 720 : window.innerHeight;
  renderer.setSize(W, H, !CAPTURE);
  const pr = renderer.getPixelRatio();
  const fw = Math.floor(W * pr), fh = Math.floor(H * pr);
  rt.bg.setSize(Math.ceil(fw / 2), Math.ceil(fh / 2));
  rt.a1.setSize(Math.ceil(fw / 4), Math.ceil(fh / 4));
  rt.b1.setSize(Math.ceil(fw / 4), Math.ceil(fh / 4));
  rt.a2.setSize(Math.ceil(fw / 8), Math.ceil(fh / 8));
  rt.b2.setSize(Math.ceil(fw / 8), Math.ceil(fh / 8));
  street.u.uRes.value.set(rt.bg.width, rt.bg.height);
  glass.u.uRes.value.set(fw, fh);
}
window.addEventListener('resize', resize);
resize();

function blurInto(src, tmp, dst, radius) {
  blur.u.tSrc.value = src.texture;
  blur.u.uDir.value.set(radius / tmp.width, 0);
  renderer.setRenderTarget(tmp);
  renderer.render(blur.scene, camera);
  blur.u.tSrc.value = tmp.texture;
  blur.u.uDir.value.set(0, radius / dst.height);
  renderer.setRenderTarget(dst);
  renderer.render(blur.scene, camera);
}

let paused = false, speed = 1, swayOn = true;
const mouse = new THREE.Vector2();
function draw(t) {
  const sway = new THREE.Vector2(
    0.012 * Math.sin(t * 0.21) + 0.006 * Math.sin(t * 0.53),
    0.006 * Math.sin(t * 0.17 + 1.0),
  );
  if (!swayOn) sway.set(0, 0);
  sway.addScaledVector(mouse, 0.03);
  updateLights(t);
  street.u.uTime.value = t;
  street.u.uSway.value.copy(sway);
  glass.u.uTime.value = t;
  glass.u.uSway.value.copy(sway);

  renderer.setRenderTarget(rt.bg);
  renderer.render(street.scene, camera);
  blurInto(rt.bg, rt.a1, rt.b1, 1.0);
  blurInto(rt.b1, rt.a2, rt.b2, 1.0);
  blurInto(rt.b2, rt.a2, rt.b2, 1.6);
  renderer.setRenderTarget(null);
  renderer.render(glass.scene, camera);
}

if (CAPTURE) {
  window.renderFrame = (n) => {
    draw(2.0 + n / 30);
    renderer.getContext().finish();
    return new Promise((res) => requestAnimationFrame(() => res(true)));
  };
  // GPU timing helper: average ms per full frame (all passes), forced to completion
  window.bench = (n = 120) => {
    const gl = renderer.getContext();
    const px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    draw(0); sync();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { draw(i / 30); sync(); }
    return (performance.now() - t0) / n;
  };
  window.captureReady = true;
} else {
  let t = 2.0, last = performance.now();
  const fpsEl = document.getElementById('fps');
  let frames = 0, acc = 0;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') paused = !paused;
    if (e.key === 'f') fpsEl.hidden = !fpsEl.hidden;
    if (e.key === 's') swayOn = !swayOn;
    if (e.key === '[') speed = Math.max(0.25, speed / 2);
    if (e.key === ']') speed = Math.min(4, speed * 2);
  });
  window.addEventListener('pointermove', (e) => {
    mouse.set(e.clientX / window.innerWidth - 0.5, 0.5 - e.clientY / window.innerHeight);
  });
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!paused) t += dt * speed;
    draw(t);
    frames++; acc += dt;
    if (acc > 0.5) { fpsEl.textContent = `${Math.round(frames / acc)} fps`; frames = 0; acc = 0; }
  });
}
