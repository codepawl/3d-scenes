import * as THREE from 'three';
import fragmentShader from './ferrofluid.frag?raw';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const AA = Math.max(1, Math.min(4, parseInt(params.get('aa') || (CAPTURE ? '3' : '1'), 10)));
const DURATION = 6.0; // seconds of the authored pass (capture length)

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  preserveDrawingBuffer: CAPTURE,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(window.devicePixelRatio, 1.0));
document.body.appendChild(renderer.domElement);
if (CAPTURE) document.getElementById('hud').style.display = 'none';

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const uniforms = {
  uRes: { value: new THREE.Vector2(1, 1) },
  uTime: { value: 0 },
  uMag: { value: new THREE.Vector2(0, 0) }, // x: magnet now, y: lagged magnet driving the fluid
  uCamPos: { value: new THREE.Vector3() },
  uCamTgt: { value: new THREE.Vector3() },
  uSeed: { value: 0 },
};

const material = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms,
  vertexShader: /* glsl */ `
    in vec3 position;
    void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader,
  depthTest: false,
  depthWrite: false,
});
const quad = new THREE.PlaneGeometry(2, 2);
scene.add(new THREE.Mesh(quad, material));

// Capture supersampling: render at AA x resolution into a target, then box-filter down.
let ssTarget = null;
const downScene = new THREE.Scene();
const downMat = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: { uSrc: { value: null }, uAA: { value: AA } },
  vertexShader: /* glsl */ `in vec3 position; void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D uSrc; uniform int uAA;
    out vec4 o;
    void main() {
      ivec2 b = ivec2(gl_FragCoord.xy) * uAA;
      vec3 c = vec3(0.0);
      for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++)
        if (i < uAA && j < uAA) c += texelFetch(uSrc, b + ivec2(i, j), 0).rgb;
      o = vec4(c / float(uAA * uAA), 1.0);
    }`,
  depthTest: false,
  depthWrite: false,
});
downScene.add(new THREE.Mesh(quad, downMat));

// ---- motion -------------------------------------------------------------
// Magnet sweeps left -> right, slowing over the puddle so the spikes have time to stand.
function magnetX(t) {
  const u = THREE.MathUtils.clamp(t / DURATION, 0, 1) * 2 - 1;
  return 1.25 * (0.4 * u + 0.6 * u * u * u);
}
// Live mode ping-pongs the authored pass.
function liveTime(t) {
  const p = t % (2 * DURATION);
  return p < DURATION ? p : 2 * DURATION - p;
}

const orbit = { az: 0, el: 0.5, dist: 3.0 };
const LAG = 0.28;

function setFrame(t, magOverride) {
  let mx, mxl;
  if (magOverride !== undefined) {
    mx = magOverride.now;
    mxl = magOverride.lag;
  } else if (CAPTURE) {
    mx = magnetX(t);
    mxl = magnetX(t - LAG);
  } else {
    const lt = liveTime(t);
    const dir = t % (2 * DURATION) < DURATION ? 1 : -1;
    mx = magnetX(lt);
    mxl = magnetX(lt - dir * LAG);
  }
  uniforms.uTime.value = t;
  uniforms.uMag.value.set(mx, mxl);

  const az = CAPTURE ? -0.32 + 0.64 * (t / DURATION) : orbit.az;
  const el = CAPTURE ? 0.52 - 0.06 * (t / DURATION) : orbit.el;
  const dist = CAPTURE ? 3.0 - 0.25 * (t / DURATION) : orbit.dist;
  const tgt = new THREE.Vector3(0, 0.06, 0);
  uniforms.uCamTgt.value.copy(tgt);
  uniforms.uCamPos.value.set(
    tgt.x + dist * Math.cos(el) * Math.sin(az),
    tgt.y + dist * Math.sin(el),
    tgt.z + dist * Math.cos(el) * Math.cos(az),
  );
}

function resize() {
  const w = CAPTURE ? 1280 : window.innerWidth;
  const h = CAPTURE ? 720 : window.innerHeight;
  renderer.setSize(w, h, !CAPTURE);
  const v = new THREE.Vector2();
  renderer.getDrawingBufferSize(v);
  uniforms.uRes.value.copy(v);
  if (CAPTURE && AA > 1) {
    ssTarget?.dispose();
    ssTarget = new THREE.WebGLRenderTarget(v.x * AA, v.y * AA, { type: THREE.UnsignedByteType, depthBuffer: false });
    uniforms.uRes.value.set(v.x * AA, v.y * AA);
    downMat.uniforms.uSrc.value = ssTarget.texture;
  }
}
function draw() {
  if (ssTarget) {
    renderer.setRenderTarget(ssTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(downScene, camera);
  } else {
    renderer.render(scene, camera);
  }
}
resize();

if (CAPTURE) {
  window.renderFrame = (n) =>
    new Promise((resolve) => {
      const t = n / 30;
      uniforms.uSeed.value = n % 64;
      setFrame(t);
      draw();
      renderer.getContext().finish();
      resolve(true);
    });
  // GPU time per frame (no readback), for the perf note in the README
  window.benchFrames = (count) => {
    const gl = renderer.getContext();
    const t0 = performance.now();
    for (let i = 0; i < count; i++) { setFrame(3 + i / 30); renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); }
    return (performance.now() - t0) / count;
  };
  window.__captureReady = true;
} else {
  window.addEventListener('resize', resize);

  // orbit controls (tiny, no dependency)
  let dragging = false, lx = 0, ly = 0, manual = false, mouseX = 0;
  const manualMag = { now: 0, lag: 0 };
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointerup', () => { dragging = false; });
  el.addEventListener('pointermove', (e) => {
    mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    if (!dragging) return;
    orbit.az -= (e.clientX - lx) * 0.005;
    orbit.el = THREE.MathUtils.clamp(orbit.el + (e.clientY - ly) * 0.004, 0.12, 1.45);
    lx = e.clientX; ly = e.clientY;
  });
  el.addEventListener('wheel', (e) => {
    orbit.dist = THREE.MathUtils.clamp(orbit.dist * Math.exp(e.deltaY * 0.001), 1.6, 6.0);
    e.preventDefault();
  }, { passive: false });

  let paused = false, simT = 0, last = performance.now(), frame = 0;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') paused = !paused;
    if (e.code === 'KeyM') manual = !manual;
    if (e.code === 'KeyH') { const h = document.getElementById('hud'); h.style.display = h.style.display === 'none' ? '' : 'none'; }
  });

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused) simT += dt;
    if (manual) {
      manualMag.now = mouseX * 1.6;
      manualMag.lag += (manualMag.now - manualMag.lag) * (1 - Math.exp(-dt / 0.2));
      setFrame(simT, manualMag);
    } else {
      setFrame(simT);
      manualMag.now = manualMag.lag = uniforms.uMag.value.x;
    }
    uniforms.uSeed.value = frame++ % 64;
    renderer.render(scene, camera);
  });
}
