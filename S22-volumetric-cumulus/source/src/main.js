import * as THREE from 'three';
import common from './shaders/common.glsl?raw';
import cloudsFrag from './shaders/clouds.frag?raw';
import compositeFrag from './shaders/composite.frag?raw';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const FPS = 30;
const DURATION = 6;                 // seconds of the golden-hour descent (one capture)
const LOOP = 36;                    // real-time: descent + rise loop length (s)

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: CAPTURE,
});
if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 required');
renderer.setPixelRatio(1);
document.body.appendChild(renderer.domElement);

const W = CAPTURE ? 1280 : window.innerWidth;
const H = CAPTURE ? 720 : window.innerHeight;
renderer.setSize(W, H);

// quality presets: real time renders clouds at half res; capture renders full res, more steps
const Q = CAPTURE
  ? { scale: 1.0, steps: 128, light: 7, rays: 40 }
  : { scale: 0.5, steps: 64, light: 6, rays: 24 };

const vert = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const shared = {
  uRes: { value: new THREE.Vector2(W, H) },
  uCamPos: { value: new THREE.Vector3(0, 0.035, 0) },
  uCamRight: { value: new THREE.Vector3() },
  uCamUp: { value: new THREE.Vector3() },
  uCamFwd: { value: new THREE.Vector3() },
  uTanHalf: { value: Math.tan(THREE.MathUtils.degToRad(27)) },
  uAspect: { value: W / H },
  uSunDir: { value: new THREE.Vector3() },
  uTime: { value: 0 },
  uOffset: { value: new THREE.Vector2() },
  uFrame: { value: 0 },
};

let cloudRT;
function makeTargets(w, h) {
  if (cloudRT) cloudRT.dispose();
  cloudRT = new THREE.WebGLRenderTarget(Math.ceil(w * Q.scale), Math.ceil(h * Q.scale), {
    count: 2,
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
}
makeTargets(W, H);

const cloudMat = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: vert,
  fragmentShader: common + '\n' + cloudsFrag,
  uniforms: {
    ...shared,
    uSteps: { value: Q.steps },
    uLightSteps: { value: Q.light },
    uRaySteps: { value: Q.rays },
  },
  depthTest: false,
  depthWrite: false,
});
const compMat = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: vert,
  fragmentShader: common + '\n' + compositeFrag,
  uniforms: {
    ...shared,
    tCloud: { value: cloudRT.textures[0] },
    tShaft: { value: cloudRT.textures[1] },
    uCloudRes: { value: new THREE.Vector2(cloudRT.width, cloudRT.height) },
    uExposure: { value: 1.0 },
    uDebug: { value: Number(params.get('debug') || 0) },
  },
  depthTest: false,
  depthWrite: false,
});

const quadGeo = new THREE.BufferGeometry();
quadGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
const cloudScene = new THREE.Scene();
const compScene = new THREE.Scene();
const cloudMesh = new THREE.Mesh(quadGeo, cloudMat);
const compMesh = new THREE.Mesh(quadGeo, compMat);
cloudMesh.frustumCulled = compMesh.frustumCulled = false;
cloudScene.add(cloudMesh);
compScene.add(compMesh);
const dummyCam = new THREE.Camera();

// ---------------------------------------------------------------- animation
const look = { yaw: 0, pitch: 0 };      // user offsets (radians)
let sunBias = 0;                        // user offset on the descent phase
const SUN_AZ = THREE.MathUtils.degToRad(14);

function descentPhase(t) {
  if (CAPTURE) return t / DURATION;
  const u = (t % LOOP) / LOOP;          // 0..1, ease down then back up
  return u < 0.8 ? u / 0.8 : 1 - (u - 0.8) / 0.2;
}

function update(t, frame) {
  const s = THREE.MathUtils.clamp(descentPhase(t) + sunBias, 0, 1);
  const k = s * s * (3 - 2 * s) * 0.6 + s * 0.4;
  const elev = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(15, 3.2, k));
  shared.uSunDir.value.set(Math.sin(SUN_AZ) * Math.cos(elev), Math.sin(elev), -Math.cos(SUN_AZ) * Math.cos(elev));

  // camera glides forward (toward -z) under the clouds; the world drifts instead of the camera
  shared.uOffset.value.set(-4.0 + t * 0.02, -9.0 - t * 0.16);
  shared.uTime.value = t;
  shared.uFrame.value = frame % 64;

  const yaw = THREE.MathUtils.degToRad(4) + Math.sin(t * 0.11) * 0.01 + look.yaw;
  const pitch = THREE.MathUtils.degToRad(Number(params.get('pitch') ?? 7.5)) + look.pitch;
  const fwd = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  shared.uCamFwd.value.copy(fwd);
  shared.uCamRight.value.copy(right);
  shared.uCamUp.value.copy(up);
  // exposure eases up as the light drops, like an auto-exposure camera
  compMat.uniforms.uExposure.value = THREE.MathUtils.lerp(0.4, 0.95, k);
}

function draw() {
  renderer.setRenderTarget(cloudRT);
  renderer.render(cloudScene, dummyCam);
  renderer.setRenderTarget(null);
  renderer.render(compScene, dummyCam);
}

// ---------------------------------------------------------------- capture mode
if (CAPTURE) {
  document.getElementById('hud').remove();
  window.renderFrame = (n) =>
    new Promise((resolve) => {
      update(n / FPS, n);
      draw();
      const gl = renderer.getContext();
      const px = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // forces GPU completion
      requestAnimationFrame(() => resolve(n));
    });
  window.captureReady = true;
} else {
  // ------------------------------------------------------------ interactive
  const hud = document.getElementById('hud');
  let paused = false, t = 0, last = performance.now(), frame = 0;
  let fpsAcc = 0, fpsN = 0, fps = 0, showHud = true;
  let drag = null;

  addEventListener('resize', () => {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h);
    shared.uRes.value.set(w, h);
    shared.uAspect.value = w / h;
    makeTargets(w, h);
    compMat.uniforms.tCloud.value = cloudRT.textures[0];
    compMat.uniforms.tShaft.value = cloudRT.textures[1];
    compMat.uniforms.uCloudRes.value.set(cloudRT.width, cloudRT.height);
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') paused = !paused;
    if (e.key === 'h' || e.key === 'H') { showHud = !showHud; hud.style.display = showHud ? '' : 'none'; }
    if (e.key === '[') sunBias -= 0.05;
    if (e.key === ']') sunBias += 0.05;
    if (e.key === 'r' || e.key === 'R') { look.yaw = look.pitch = 0; sunBias = 0; }
  });
  renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, ...look }; });
  addEventListener('pointerup', () => { drag = null; });
  addEventListener('pointermove', (e) => {
    if (!drag) return;
    look.yaw = drag.yaw + (e.clientX - drag.x) * 0.003;
    look.pitch = THREE.MathUtils.clamp(drag.pitch - (e.clientY - drag.y) * 0.003, -0.25, 0.9);
  });

  const loop = (now) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!paused) t += dt;
    update(t, frame++);
    draw();
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
    if (showHud) {
      const el = THREE.MathUtils.radToDeg(Math.asin(shared.uSunDir.value.y)).toFixed(1);
      hud.textContent = `${fps.toFixed(0)} fps  sun ${el}°  | drag: look  [ ]: sun  space: pause  r: reset  h: hide`;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
