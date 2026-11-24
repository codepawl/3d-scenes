// S21 desert dunes — host code. Original work by CodePawl, 2026 (MIT).
import * as THREE from 'three';
import fragSrc from './dunes.frag.glsl?raw';
import { terrainHeight, sunTransmittance, skyRadiance } from './cpu.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const SS = CAPTURE ? Math.max(1, parseFloat(params.get('ss') || '2')) : 1;
const SCALE = parseFloat(params.get('scale') || '1');
const FPS = 30;
const CAPTURE_FRAMES = 180;
const DAY_PERIOD = 75; // seconds per full cycle in live mode

if (CAPTURE) document.body.classList.add('capture');

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  alpha: false,
  preserveDrawingBuffer: CAPTURE,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(1);
document.body.appendChild(renderer.domElement);

const uniforms = {
  uRes: { value: new THREE.Vector2() },
  uTime: { value: 0 },
  uCamPos: { value: new THREE.Vector3() },
  uCamMat: { value: new THREE.Matrix3() },
  uTanHalfFov: { value: Math.tan(THREE.MathUtils.degToRad(46) / 2) },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
  uKeyCol: { value: new THREE.Vector3(1, 1, 1) },
  uSkyAmb: { value: new THREE.Vector3(0.1, 0.1, 0.1) },
  uExposure: { value: 1 },
  uNight: { value: 0 },
  uFrame: { value: 0 },
};

const material = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms,
  vertexShader: /* glsl */ `
    in vec3 position;
    void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: fragSrc,
  depthTest: false,
  depthWrite: false,
});
const tri = new THREE.BufferGeometry();
tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
const mesh = new THREE.Mesh(tri, material);
mesh.frustumCulled = false;
const scene = new THREE.Scene();
scene.add(mesh);
const camera = new THREE.Camera();

function resize() {
  let w, h;
  if (CAPTURE) { w = 1280 * SS; h = 720 * SS; }
  else { w = Math.round(innerWidth * SCALE); h = Math.round(innerHeight * SCALE); }
  renderer.setSize(w, h, false);
  uniforms.uRes.value.set(w, h);
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ sun / sky state
const TILT = THREE.MathUtils.degToRad(42);
const A0 = -0.1, A1 = Math.PI + 0.42;
// u in [0,1): pre-dawn -> noon -> dusk -> night. Eased so dawn/dusk linger and noon passes quickly.
function sunAngle(u) {
  const k = 0.55;
  return A0 + (A1 - A0) * (u - (k * Math.sin(2 * Math.PI * u)) / (2 * Math.PI));
}
function sunDirFromAngle(a) {
  // rises at +x (east), culminates toward +z (south), sets at -x
  return new THREE.Vector3(Math.cos(a), Math.sin(a) * Math.sin(TILT), Math.sin(a) * Math.cos(TILT)).normalize();
}
const MOON_DIR = new THREE.Vector3(-0.45, 0.62, 0.64).normalize();

function updateSky(u) {
  const sd = sunDirFromAngle(sunAngle(u));
  uniforms.uSunDir.value.copy(sd);
  const T = sunTransmittance([sd.x, sd.y, sd.z]);           // rgb
  const sunVis = THREE.MathUtils.smoothstep(sd.y, -0.03, 0.02);
  const sunCol = T.map((v) => v * 22 * sunVis);
  const amb = skyRadiance([sd.x, sd.y, sd.z]);                // rgb, average sky radiance
  const night = THREE.MathUtils.smoothstep(-sd.y, 0.02, 0.2);
  // moonlight (cool, dim) and starlight take over as the sun goes down
  const moon = [0.009, 0.013, 0.028].map((v) => v * night);
  const useMoon = sd.y < -0.02;
  const key = useMoon ? moon : sunCol;
  uniforms.uKeyDir.value.copy(useMoon ? MOON_DIR : sd);
  uniforms.uKeyCol.value.set(key[0], key[1], key[2]);
  uniforms.uSkyAmb.value.set(amb[0] + 0.0012 * night, amb[1] + 0.0016 * night, amb[2] + 0.003 * night);
  uniforms.uNight.value = night;
  // auto exposure from scene key luminance
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const keyLum = lum(key) * Math.max(useMoon ? MOON_DIR.y : sd.y, 0.08) / Math.PI + lum([amb[0], amb[1], amb[2]]) + 0.0025;
  uniforms.uExposure.value = THREE.MathUtils.clamp(0.3 / keyLum, 0.01, 30);
}

// ------------------------------------------------------------------ camera
const EYE = 2.2;
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
function groundAt(x, z) {
  // max over a small neighbourhood so the low camera never dips into a crest
  let h = -1e9;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) h = Math.max(h, terrainHeight(x + i * 2.5, z + j * 2.5));
  return h;
}
function setCamera(x, y, z, yaw, pitch) {
  uniforms.uCamPos.value.set(x, y, z);
  _f.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  _r.crossVectors(_f, new THREE.Vector3(0, 1, 0)).normalize();
  _u.crossVectors(_r, _f).normalize();
  // shader: rd = M * (uv.x, uv.y, 1) with uv.x to the right
  uniforms.uCamMat.value.set(
    _r.x, _u.x, _f.x,
    _r.y, _u.y, _f.y,
    _r.z, _u.z, _f.z,
  );
}

// Path used by the capture and by the live auto-cruise
const START = { x: 140, z: -60 };
const PATH_DIR = new THREE.Vector2(0.15, 1).normalize();
const SPEED = 5.5;
const camSmooth = { y: null };

function pathCamera(time, u, smooth) {
  const x = START.x + PATH_DIR.x * SPEED * time;
  const z = START.z + PATH_DIR.y * SPEED * time;
  let y = groundAt(x, z) + EYE;
  // look-ahead keeps the camera from bobbing into the next crest
  y = Math.max(y, groundAt(x + PATH_DIR.x * 6, z + PATH_DIR.y * 6) + EYE * 0.6);
  if (smooth) {
    camSmooth.y = camSmooth.y === null ? y : camSmooth.y + (y - camSmooth.y) * 0.08;
    y = Math.max(camSmooth.y, y - 0.6);
  }
  // pan with the sun: look toward the sunrise early, toward the sunset late
  const s = THREE.MathUtils.smootherstep(u, 0.05, 0.9);
  const yaw = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(34, -36, s));
  const pitch = THREE.MathUtils.degToRad(3.5);
  return { x, y, z, yaw, pitch };
}

// ------------------------------------------------------------------ capture mode
if (CAPTURE) {
  window.renderFrame = (n) =>
    new Promise((resolve) => {
      const time = n / FPS;
      const u = n / (CAPTURE_FRAMES - 1);
      updateSky(u);
      // camera height is smoothed analytically over the path for determinism
      let ySum = 0;
      const c = pathCamera(time, u, false);
      for (let k = -4; k <= 4; k++) ySum += Math.max(pathCamera(time + k * 0.15, u, false).y, c.y - 0.4);
      setCamera(c.x, Math.max(ySum / 9, c.y - 0.3), c.z, c.yaw, c.pitch);
      uniforms.uTime.value = time;
      uniforms.uFrame.value = n;
      renderer.render(scene, camera);
      renderer.getContext().finish();
      requestAnimationFrame(() => resolve(n));
    });
  const px = new Uint8Array(4);
  window.renderFrameSync = (n) => { uniforms.uFrame.value = n; renderer.render(scene, camera); const gl = renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  window.captureInfo = { frames: CAPTURE_FRAMES, fps: FPS, width: 1280 * SS, height: 720 * SS };
  window.captureReady = true;
} else {
  // ---------------------------------------------------------------- live mode
  const hud = document.getElementById('hud');
  const state = {
    u: 0.02, paused: false, cruise: true, travel: 0, yawOff: 0, pitchOff: 0,
    free: null, keys: new Set(), showHud: true,
  };
  let dragging = false, lx = 0, ly = 0;
  addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
  addEventListener('pointerup', () => { dragging = false; });
  addEventListener('pointermove', (e) => {
    if (!dragging) return;
    state.yawOff -= (e.clientX - lx) * 0.004;
    state.pitchOff = THREE.MathUtils.clamp(state.pitchOff - (e.clientY - ly) * 0.004, -0.6, 0.9);
    lx = e.clientX; ly = e.clientY;
  });
  addEventListener('keydown', (e) => {
    state.keys.add(e.code);
    if (e.code === 'Space') state.paused = !state.paused;
    if (e.code === 'KeyC') state.cruise = !state.cruise;
    if (e.code === 'KeyH') { state.showHud = !state.showHud; hud.style.display = state.showHud ? '' : 'none'; }
    if (e.code === 'KeyR') { state.yawOff = 0; state.pitchOff = 0; }
    if (e.code >= 'Digit1' && e.code <= 'Digit5') state.u = [0.03, 0.18, 0.5, 0.8, 0.95][+e.code.slice(5) - 1];
  });
  addEventListener('keyup', (e) => state.keys.delete(e.code));

  let last = performance.now(), frames = 0, fpsT = last, fps = 0, frameNo = 0;
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!state.paused) state.u = (state.u + dt / DAY_PERIOD) % 1;
    if (state.keys.has('BracketRight')) state.u = (state.u + dt * 0.08) % 1;
    if (state.keys.has('BracketLeft')) state.u = (state.u - dt * 0.08 + 1) % 1;
    let v = state.cruise ? 1 : 0;
    if (state.keys.has('KeyW') || state.keys.has('ArrowUp')) v = 3;
    if (state.keys.has('KeyS') || state.keys.has('ArrowDown')) v = -1;
    state.travel += v * dt;

    updateSky(state.u);
    const c = pathCamera(state.travel, state.u, true);
    state.yawS = state.yawS === undefined ? c.yaw : state.yawS + (c.yaw - state.yawS) * Math.min(1, dt * 0.6);
    setCamera(c.x, c.y, c.z, state.yawS + state.yawOff, c.pitch + state.pitchOff);
    uniforms.uTime.value = now / 1000;
    uniforms.uFrame.value = frameNo++;
    renderer.render(scene, camera);

    frames++;
    if (now - fpsT > 500) { fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }
    if (state.showHud) {
      const elev = THREE.MathUtils.radToDeg(Math.asin(uniforms.uSunDir.value.y)).toFixed(1);
      hud.textContent = `${fps.toFixed(0)} fps  sun ${elev}°  ${state.paused ? '[paused]' : ''}\n` +
        'drag look · W/S move · C cruise · space pause · [ ] scrub time · 1-5 presets · R reset view · H hide';
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
