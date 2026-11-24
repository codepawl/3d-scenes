import * as THREE from 'three';
import { BLOCK, TERRACE, buildLayout, heightAt, streamIntake } from './terrainField.js';
import { buildBasins } from './basins.js';
import { WaterSim, FIXED_STEP } from './waterSim.js';
import { loadAllTextures } from './materials.js';
import { buildTerrain } from './terrainMesh.js';
import { buildPaddySurface, buildCascades, buildIntakeItem, buildStream, buildParticles } from './waterMesh.js';
import { buildRice, buildGrassTufts } from './vegetation.js';
import { buildHouse, buildHaystack, buildGate } from './props.js';
import { loadForestModels, buildForestFromModels, buildWaterBuffalo } from './forest.js';
import { loadEnvironment, createPipeline } from './post.js';
import { createRandom, smoothstep, clamp } from './noise.js';

const MAX_TILT = THREE.MathUtils.degToRad(25);
const SEASON_NAMES = ['Mirror', 'Green', 'Golden'];

// Valley mist: a few soft sprites hovering over the forest edge, shown only in the golden season.
function buildValleyMist() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const puff = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  puff.addColorStop(0, 'rgba(255,244,228,0.55)');
  puff.addColorStop(0.45, 'rgba(255,240,222,0.2)');
  puff.addColorStop(1, 'rgba(255,240,222,0)');
  context.fillStyle = puff;
  context.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const random = createRandom(909);
  const group = new THREE.Group();
  const materials = [];
  for (let index = 0; index < 26; index += 1) {
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0, color: 0xfff1de });
    const sprite = new THREE.Sprite(material);
    const mistX = (random() * 2 - 1) * 36;
    const mistZ = -36 + random() * 10;
    sprite.position.set(mistX, heightAt(mistX, mistZ) + 1.5 + random() * 2.5, mistZ);
    const width = 26 + random() * 30;
    sprite.scale.set(width * 0.8, width * (0.2 + random() * 0.1), 1);
    sprite.renderOrder = 5;
    group.add(sprite);
    materials.push({ material, base: 0.05 + random() * 0.07 });
  }
  return { group, materials };
}

function interpolateKeys(keys, time, fallback) {
  if (!keys || keys.length === 0) return fallback;
  if (time <= keys[0][0]) return keys[0].slice(1);
  for (let index = 0; index < keys.length - 1; index += 1) {
    const [t0, ...a] = keys[index];
    const [t1, ...b] = keys[index + 1];
    if (time <= t1) {
      const t = (time - t0) / Math.max(t1 - t0, 1e-6);
      const eased = t * t * (3 - 2 * t);
      return a.map((value, component) => value + (b[component] - value) * eased);
    }
  }
  return keys[keys.length - 1].slice(1);
}

function stepKeys(keys, time, fallback) {
  if (!keys || keys.length === 0) return fallback;
  let value = keys[0][1];
  for (const [t, v] of keys) if (t <= time) value = v;
  return value;
}

async function start() {
  const canvas = document.querySelector('#view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const sky = await loadEnvironment(renderer, 'hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr');
  scene.environment = sky.environment;
  scene.environmentIntensity = 0.95;

  const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 1, 900);
  const view = { azimuth: 0.55, elevation: 0.6, distance: 235, target: new THREE.Vector3(2, 8, 0), fov: 30 };

  // Low afternoon sun from the left: warm key with soft shadows, cool fill from the right, a little warm rim behind.
  const sunElevation = THREE.MathUtils.degToRad(27);
  const sunAzimuth = Math.atan2(0.28, -0.8);
  scene.environmentRotation.y = sky.sunAzimuth - sunAzimuth;
  const sunDirection = new THREE.Vector3(Math.cos(sunAzimuth) * Math.cos(sunElevation), Math.sin(sunElevation), Math.sin(sunAzimuth) * Math.cos(sunElevation));
  const keyLight = new THREE.DirectionalLight(0xffdfb4, 4.6);
  keyLight.position.copy(sunDirection).multiplyScalar(170).add(new THREE.Vector3(0, 8, 0));
  keyLight.target.position.set(0, 8, 0);
  scene.add(keyLight.target);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(6144, 6144);
  keyLight.shadow.camera.left = -78;
  keyLight.shadow.camera.right = 78;
  keyLight.shadow.camera.top = 78;
  keyLight.shadow.camera.bottom = -78;
  keyLight.shadow.camera.near = 20;
  keyLight.shadow.camera.far = 340;
  keyLight.shadow.bias = -0.00025;
  keyLight.shadow.normalBias = 0.07;
  keyLight.shadow.radius = 3.2;
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x9db8ff, 0.9);
  fillLight.position.set(90, 45, 95);
  scene.add(fillLight);
  const rimLight = new THREE.DirectionalLight(0xff9a55, 1.3);
  rimLight.position.set(70, 30, -95);
  scene.add(rimLight);

  const textures = await loadAllTextures(renderer);
  const layout = buildLayout();
  const model = buildBasins();
  const sim = new WaterSim(model);

  const block = new THREE.Group();
  scene.add(block);
  const terrain = buildTerrain(textures);
  block.add(terrain.group);

  const hayPositions = layout.haystacks.map((hay) => ({ x: hay.x, z: hay.z }));
  const rice = buildRice(hayPositions);
  block.add(rice.mesh);
  const grass = buildGrassTufts();
  block.add(grass.mesh);
  const models = await loadForestModels();
  const forest = buildForestFromModels(models);
  block.add(forest.group);
  const mist = buildValleyMist();
  block.add(mist.group);

  layout.houses.forEach((house, index) => {
    const mesh = buildHouse(textures, index);
    mesh.position.set(house.x, house.height, house.z);
    mesh.rotation.y = (index - 1) * 0.35;
    mesh.scale.setScalar(1.5);
    block.add(mesh);
  });

  const buffalo = buildWaterBuffalo(models.cow);
  buffalo.position.set(layout.buffalo.x, heightAt(layout.buffalo.x, layout.buffalo.z), layout.buffalo.z);
  buffalo.rotation.y = -0.5;
  block.add(buffalo);

  const haystacks = layout.haystacks.map((hay, index) => {
    const stack = buildHaystack(index + 3);
    stack.position.set(hay.x, heightAt(hay.x, hay.z) - 0.05, hay.z);
    block.add(stack);
    return stack;
  });

  const gate = buildGate(textures);
  block.add(gate.group);

  const paddies = buildPaddySurface(model.basins, scene.environment, terrain.surface);
  block.add(paddies.mesh);
  const intakeItem = buildIntakeItem();
  const cascades = buildCascades(model.lips, intakeItem);
  block.add(cascades.mesh);
  const stream = buildStream();
  block.add(stream.mesh);
  const particles = buildParticles();
  scene.add(particles.points);
  const pipeline = createPipeline(renderer, scene, camera, [paddies.mesh, cascades.mesh, stream.mesh, particles.points, mist.group], [paddies.mesh, particles.points]);

  const app = {
    tiltX: 0, tiltZ: 0, tiltVelocityX: 0, tiltVelocityZ: 0, targetTiltX: 0, targetTiltZ: 0,
    season: 2, seasonBlend: 2, channelOpen: false,
    filmMode: false, accumulator: 0, lastFrame: performance.now(), replayKey: null,
  };

  function applyVisuals() {
    block.rotation.set(app.tiltX, 0, app.tiltZ);
    const blend = app.seasonBlend;
    rice.uniforms.uSeason.value = blend;
    rice.uniforms.uTime.value = sim.time;
    grass.uniforms.uTime.value = sim.time;
    grass.uniforms.uDry.value = smoothstep(1.2, 2.0, blend);
    terrain.uniforms.uDry.value = smoothstep(1.2, 2.0, blend);
    terrain.uniforms.uWet.value = 1 - smoothstep(0.8, 2.0, blend) * 0.9;
    const hayScale = smoothstep(1.5, 1.95, blend);
    haystacks.forEach((stack) => {
      stack.visible = hayScale > 0.01;
      stack.scale.setScalar(Math.max(hayScale, 0.001) * 1.8);
    });
    model.basins.forEach((basin, index) => {
      const constant = basin.floorY + sim.planeOffset[index] - sim.slopeX[index] * basin.centerX - sim.slopeZ[index] * basin.centerZ;
      paddies.planes[index].set(constant, sim.slopeX[index], sim.slopeZ[index], sim.agitation[index]);
    });
    paddies.uniforms.uTime.value = sim.time;
    const inflowVisual = sim.inflow / 12.6;
    cascades.update(sim.lipFlow, inflowVisual * 1.6, sim.time);
    stream.update(sim.streamExtent(), sim.time);
    gate.update(sim.channelFront);
    const pixelScale = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(view.fov) / 2));
    particles.update(sim.particles, pixelScale, renderer.getDrawingBufferSize(new THREE.Vector2()));
    mist.materials.forEach((entry) => { entry.material.opacity = entry.base * smoothstep(1.5, 1.95, blend); });
  }

  function placeCamera() {
    const horizontal = Math.cos(view.elevation) * view.distance;
    camera.position.set(
      view.target.x + Math.sin(view.azimuth) * horizontal,
      view.target.y + Math.sin(view.elevation) * view.distance,
      view.target.z + Math.cos(view.azimuth) * horizontal,
    );
    camera.fov = view.fov;
    camera.lookAt(view.target);
    camera.updateProjectionMatrix();
  }

  // Live framing: pull back on narrow windows and lift the picture so the dock never sits over the block.
  const BASE_DISTANCE = 235;
  function fitFraming() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.clearViewOffset();
    if (!app.userZoomed) view.distance = BASE_DISTANCE * Math.max(1, Math.pow(1.4 / camera.aspect, 0.8));
    placeCamera();
    camera.updateMatrixWorld();
    let blockBottom = -1e9;
    for (const x of [-BLOCK.halfX, BLOCK.halfX]) {
      for (const z of [-BLOCK.halfZ, BLOCK.halfZ]) {
        const projected = new THREE.Vector3(x, -6, z).project(camera);
        blockBottom = Math.max(blockBottom, (-projected.y * 0.5 + 0.5) * height);
      }
    }
    const dockTop = dock.getBoundingClientRect().top;
    const shift = Math.max(0, blockBottom - (dockTop - 10));
    if (shift > 0) camera.setViewOffset(width, height, 0, shift, width, height);
  }

  function render() {
    applyVisuals();
    placeCamera();
    pipeline.render(paddies.uniforms);
  }

  function liveStep() {
    const stiffness = 38;
    const damping = 7.5;
    const springX = stiffness * (app.targetTiltX - app.tiltX) - damping * app.tiltVelocityX;
    const springZ = stiffness * (app.targetTiltZ - app.tiltZ) - damping * app.tiltVelocityZ;
    app.tiltVelocityX += springX * FIXED_STEP;
    app.tiltVelocityZ += springZ * FIXED_STEP;
    app.tiltX += app.tiltVelocityX * FIXED_STEP;
    app.tiltZ += app.tiltVelocityZ * FIXED_STEP;
    app.seasonBlend += clamp(app.season - app.seasonBlend, -1.2 * FIXED_STEP, 1.2 * FIXED_STEP);
    sim.step(FIXED_STEP, { tiltX: app.tiltX, tiltZ: app.tiltZ, season: Math.round(app.season), channelOpen: app.channelOpen });
  }

  function frame(now) {
    if (app.filmMode) return;
    const elapsed = Math.min((now - app.lastFrame) / 1000, 0.1);
    app.lastFrame = now;
    app.accumulator += elapsed;
    while (app.accumulator >= FIXED_STEP) {
      liveStep();
      app.accumulator -= FIXED_STEP;
    }
    render();
    requestAnimationFrame(frame);
  }

  // Deterministic frame for a recorder: every value is a function of (seconds, state).
  function renderAt(seconds, state = {}) {
    simulateTo(seconds, state);
    if (state.camera) setCamera(typeof state.camera === 'function' ? state.camera(seconds) : state.camera);
    render();
  }

  // The simulation half of renderAt, with no drawing: the recorder uses it to find beat times before rendering.
  function simulateTo(seconds, state = {}) {
    if (!app.filmMode) camera.clearViewOffset();
    app.filmMode = true;
    const initial = state.initial ?? { fill: 'empty', season: 2, channelOpen: false };
    if (app.replayKey !== state || seconds < sim.time - 1e-9) {
      sim.reset(initial);
      app.seasonBlend = initial.season;
      app.replayKey = state;
    }
    while (sim.time < seconds - 1e-9) {
      const [tiltX, tiltZ] = interpolateKeys(state.tilt, sim.time, [0, 0]);
      const season = stepKeys(state.seasons, sim.time, initial.season);
      const channelOpen = stepKeys(state.channel, sim.time, initial.channelOpen);
      app.seasonBlend += clamp(season - app.seasonBlend, -1.2 * FIXED_STEP, 1.2 * FIXED_STEP);
      app.tiltX = tiltX;
      app.tiltZ = tiltZ;
      sim.step(FIXED_STEP, { tiltX, tiltZ, season: Math.round(season), channelOpen, paddyFill: state.paddyFill, sloshDamping: state.sloshDamping ? state.sloshDamping(sim.time) : undefined });
    }
    return { tiltX: app.tiltX, tiltZ: app.tiltZ, seasonBlend: app.seasonBlend };
  }

  function setCamera(options) {
    if (options.azimuth !== undefined) view.azimuth = options.azimuth;
    if (options.elevation !== undefined) view.elevation = options.elevation;
    if (options.distance !== undefined) view.distance = options.distance;
    if (options.fov !== undefined) view.fov = options.fov;
    if (options.target) view.target.set(options.target[0], options.target[1], options.target[2]);
  }

  function setSeason(index) {
    app.season = index;
    updateDock();
  }

  function setChannel(open) {
    app.channelOpen = open;
    updateDock();
  }

  // ---- Dock ----
  const dock = document.querySelector('#dock');
  const seasonButtons = SEASON_NAMES.map((name, index) => {
    const button = document.createElement('button');
    button.textContent = name;
    button.addEventListener('click', () => setSeason(index));
    dock.appendChild(button);
    return button;
  });
  const channelButton = document.createElement('button');
  channelButton.className = 'channel';
  channelButton.addEventListener('click', () => setChannel(!app.channelOpen));
  dock.appendChild(channelButton);
  function updateDock() {
    seasonButtons.forEach((button, index) => button.classList.toggle('active', index === app.season));
    channelButton.classList.toggle('active', app.channelOpen);
    channelButton.innerHTML = `${app.channelOpen
      ? '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 1.5C8 1.5 3 7 3 10a5 5 0 0010 0c0-3-5-8.5-5-8.5z" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 1.5C8 1.5 3 7 3 10a5 5 0 0010 0c0-3-5-8.5-5-8.5z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>'}<span>Channel ${app.channelOpen ? 'open' : 'closed'}</span>`;
  }
  updateDock();

  // ---- Pointer controls ----
  let dragMode = null;
  let dragStart = { x: 0, y: 0 };
  let dragOrbitStart = { azimuth: 0, elevation: 0 };
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    dragStart = { x: event.clientX, y: event.clientY };
    dragOrbitStart = { azimuth: view.azimuth, elevation: view.elevation };
    const wantsOrbit = event.button === 2 || event.shiftKey || event.ctrlKey || event.altKey;
    dragMode = wantsOrbit ? 'orbit' : 'tilt';
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragMode) return;
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    if (dragMode === 'orbit') {
      view.azimuth = dragOrbitStart.azimuth - dx * 0.006;
      view.elevation = clamp(dragOrbitStart.elevation + dy * 0.005, 0.08, 1.45);
      return;
    }
    const magnitude = Math.min(Math.hypot(dx, dy) / 320, 1) * MAX_TILT;
    const length = Math.hypot(dx, dy) || 1;
    const right = { x: Math.cos(view.azimuth), z: -Math.sin(view.azimuth) };
    const towardCamera = { x: Math.sin(view.azimuth), z: Math.cos(view.azimuth) };
    const downhillX = (right.x * dx + towardCamera.x * dy) / length;
    const downhillZ = (right.z * dx + towardCamera.z * dy) / length;
    app.targetTiltX = downhillZ * magnitude;
    app.targetTiltZ = -downhillX * magnitude;
  });
  const endDrag = () => {
    dragMode = null;
    app.targetTiltX = 0;
    app.targetTiltZ = 0;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    app.userZoomed = true;
    view.distance = clamp(view.distance * Math.exp(event.deltaY * 0.0012), 14, 700);
  }, { passive: false });

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
    pipeline.resize(buffer.x, buffer.y);
    if (!app.filmMode) fitFraming();
  });
  fitFraming();

  const params = new URLSearchParams(location.search);
  if (params.has('season')) setSeason(Number(params.get('season')));
  if (params.get('channel') === '1') setChannel(true);
  if (params.get('fill') === 'full') sim.reset({ fill: 'full', season: app.season, channelOpen: app.channelOpen });
  app.seasonBlend = app.season;

  window.__app = {
    renderAt, simulateTo, setCamera, setSeason, setChannel, sim, view, THREE, block, scene, renderer, camera,
    stats: { rice: rice.count, grass: grass.count, trees: forest.count, lips: model.lips.length },
    setTilt(tiltX, tiltZ) { app.tiltX = tiltX; app.tiltZ = tiltZ; },
    freeze() { app.filmMode = true; },
    intake: streamIntake(), BLOCK, TERRACE, model, layout,
  };
  window.__ready = true;
  document.querySelector('#loading')?.remove();
  requestAnimationFrame(frame);
}

start().catch((error) => {
  console.error(error);
  window.__error = String(error?.stack ?? error);
});
