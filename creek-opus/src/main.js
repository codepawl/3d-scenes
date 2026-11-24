import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CreekControls } from './controls.js';
import { createFireflies, createFloatingLeaves } from './effects.js';
import { CreekPath, Field } from './field.js';
import { createGrass } from './grass.js';
import {
  createBarkMaterial,
  createLeafDepthMaterial,
  createLeafMaterial,
  createStoneMaterial,
  createTerrainMaterial,
  createWorldUniforms,
} from './materials.js';
import { Pipeline } from './post.js';
import { blendLighting, cloneLighting, createLightingState, PRESETS, resolvedPreset } from './presets.js';
import { applyLightingToSky, createSkyUniforms, Sky } from './sky.js';
import { setupInterface } from './ui.js';
import { Water } from './water.js';

const params = new URLSearchParams(window.location.search);
const CAPTURE = params.has('capture');
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const TRANSITION_SECONDS = 1.8;
const ASSET_FILES = ['terrain', 'rocks', 'culvert', 'cabin', 'trees'];

async function fetchWithProgress(url, onChunk) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url} (${response.status})`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    received += value.length;
    onChunk(value.length);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
}

function instanceMesh(geometry, material, rows, { castShadow = true, receiveShadow = true } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, rows.length);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  rows.forEach((row, index) => {
    position.set(row[0], row[1], row[2]);
    quaternion.set(row[3], row[4], row[5], row[6]);
    scale.set(row[7], row[8], row[9]);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, color.setRGB(row[10], row[11], row[12]));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.computeBoundingSphere();
  return mesh;
}

class CreekApp {
  constructor(canvas) {
    this.canvas = canvas;
    this.presetName = 'afternoon';
    this.toggles = { dslr: true, dof: true };
    this.transition = null;
    this.time = 12;
    this.environmentDirty = true;
    this.framesSinceEnvironment = 0;
    this.fps = 0;
    this.frameTimes = [];
  }

  async init(ui) {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: CAPTURE,
    });
    renderer.setPixelRatio(CAPTURE ? 1 : Math.min(window.devicePixelRatio, 1.25));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = true;
    this.renderer = renderer;

    const totalBytes = { loaded: 0, expected: 11.5e6 };
    const progress = (bytes) => {
      totalBytes.loaded += bytes;
      ui.progress(Math.min(totalBytes.loaded / totalBytes.expected, 0.98));
    };
    const [layoutBuffer, fieldBuffer, ...glbBuffers] = await Promise.all([
      fetchWithProgress('./assets/layout.json', progress),
      fetchWithProgress('./assets/field.bin', progress),
      ...ASSET_FILES.map((name) => fetchWithProgress(`./assets/${name}.glb`, progress)),
    ]);
    const layout = JSON.parse(new TextDecoder().decode(layoutBuffer));
    const loader = new GLTFLoader();
    const gltfs = await Promise.all(glbBuffers.map((buffer) => loader.parseAsync(buffer, './assets/')));
    const assets = Object.fromEntries(ASSET_FILES.map((name, index) => [name, gltfs[index].scene]));

    this.layout = layout;
    this.field = new Field(layout.field, fieldBuffer);
    this.path = new CreekPath(layout.creek);
    this.buildScene(assets);
    this.pipeline = new Pipeline(renderer, renderer.domElement.width, renderer.domElement.height);
    this.controls = new CreekControls(this.camera, this.canvas, this.field, this.path);
    this.controls.handheld = this.toggles.dslr && !REDUCED_MOTION;
    this.controls.placeAlongCreek(this.path.sAtZ(-6), 0.2, { pitch: -0.1 });
    this.applyLighting(this.lighting);
    this.compileAndWarm();
    window.addEventListener('resize', () => this.resize());
  }

  buildScene(assets) {
    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.08, 1200);
    this.worldUniforms = createWorldUniforms(this.field);
    this.skyUniforms = createSkyUniforms();
    this.lighting = createLightingState(this.presetName);
    scene.fog = new THREE.FogExp2(0xffffff, 0.01);

    this.sky = new Sky(this.renderer, this.skyUniforms);
    scene.add(this.sky.mesh);

    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 260;
    sun.shadow.camera.left = -42;
    sun.shadow.camera.right = 42;
    sun.shadow.camera.top = 42;
    sun.shadow.camera.bottom = -42;
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 3;
    sun.layers.enableAll();
    scene.add(sun, sun.target);
    this.sun = sun;

    const terrainMaterial = createTerrainMaterial(this.worldUniforms);
    assets.terrain.traverse((child) => {
      if (child.isMesh) {
        child.material = terrainMaterial;
        child.receiveShadow = true;
        child.castShadow = child.name === 'terrain';
      }
    });
    scene.add(assets.terrain);

    const meshByName = new Map();
    for (const name of ['rocks', 'trees']) {
      assets[name].traverse((child) => {
        if (child.isMesh) {
          meshByName.set(child.name, child);
        }
      });
    }
    const stoneMaterial = createStoneMaterial(this.worldUniforms, { roughness: 0.8, key: 'boulder' });
    stoneMaterial.color.setRGB(0.86, 0.79, 0.64);
    const wallMaterial = createStoneMaterial(this.worldUniforms, { roughness: 0.9, detailScale: 2.2, key: 'wall' });
    const pebbleMaterial = createStoneMaterial(this.worldUniforms, { roughness: 0.62, detailScale: 1.5, key: 'pebble' });
    const barkMaterial = createBarkMaterial(this.worldUniforms);
    const leafMap = meshByName.get('tree_0_leaves').material.map;
    leafMap.anisotropy = 8;
    const leafMaterial = createLeafMaterial(this.worldUniforms, leafMap);
    const leafDepthMaterial = createLeafDepthMaterial(this.worldUniforms, leafMap);

    const props = new THREE.Group();
    props.name = 'props';
    for (const [name, rows] of Object.entries(this.layout.instances)) {
      if (name.startsWith('stone_')) {
        props.add(instanceMesh(meshByName.get(name).geometry, stoneMaterial, rows));
      } else if (name.startsWith('wallstone_')) {
        props.add(instanceMesh(meshByName.get(name).geometry, wallMaterial, rows));
      } else if (name.startsWith('pebble_')) {
        props.add(instanceMesh(meshByName.get(name).geometry, pebbleMaterial, rows, { castShadow: false }));
      } else if (name.startsWith('tree_') || name.startsWith('bush_')) {
        props.add(instanceMesh(meshByName.get(`${name}_bark`).geometry, barkMaterial, rows));
        const leaves = instanceMesh(meshByName.get(`${name}_leaves`).geometry, leafMaterial, rows);
        leaves.customDepthMaterial = leafDepthMaterial;
        props.add(leaves);
      }
    }
    scene.add(props);

    const culvert = assets.culvert;
    const culvertPlacement = this.layout.objects.culvert;
    culvert.position.fromArray(culvertPlacement.position);
    culvert.rotation.y = culvertPlacement.yaw;
    const culvertMaterial = createStoneMaterial(this.worldUniforms, { roughness: 0.9, detailScale: 1.6, key: 'culvert', side: THREE.DoubleSide });
    culvert.traverse((child) => {
      if (child.isMesh) {
        child.material = culvertMaterial;
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    scene.add(culvert);

    const cabin = assets.cabin;
    const cabinPlacement = this.layout.objects.cabin;
    cabin.position.fromArray(cabinPlacement.position);
    cabin.rotation.y = cabinPlacement.yaw;
    const cabinBody = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
    const cabinStone = createStoneMaterial(this.worldUniforms, { roughness: 0.88, detailScale: 1.6, key: 'cabin-stone' });
    this.windowMaterial = new THREE.MeshStandardMaterial({ color: 0x0c0f12, roughness: 0.06, metalness: 0, emissive: 0xffa458, emissiveIntensity: 0 });
    this.lampMaterial = new THREE.MeshStandardMaterial({ color: 0x8a6a3c, roughness: 0.4, metalness: 0, emissive: 0xffa04a, emissiveIntensity: 0 });
    cabin.traverse((child) => {
      if (!child.isMesh) {
        return;
      }
      const sourceName = child.material.name;
      if (sourceName === 'window_glow') {
        child.material = this.windowMaterial;
      } else if (sourceName === 'lamp_glow') {
        child.material = this.lampMaterial;
      } else if (sourceName === 'cabin_stone') {
        child.material = cabinStone;
      } else {
        child.material = cabinBody;
      }
      child.castShadow = true;
      child.receiveShadow = true;
    });
    scene.add(cabin);
    cabin.updateMatrixWorld(true);
    this.cabinLight = new THREE.PointLight(0xffa860, 0, 16, 2);
    this.cabinLight.position.copy(cabin.localToWorld(new THREE.Vector3(0, 2.4, 3.2)));
    this.cabinLight.layers.enableAll();
    scene.add(this.cabinLight);

    const grass = createGrass(this.field, this.path, this.worldUniforms, {
      bladeCount: Number(params.get('grass') ?? 320000),
    });
    this.grassStats = { blades: grass.bladeCount, flowers: grass.flowerCount };
    scene.add(grass.group);

    this.water = new Water(this.path, this.skyUniforms);
    scene.add(this.water.mesh);
    scene.add(createFloatingLeaves(this.path, this.worldUniforms));
    this.fireflies = createFireflies(this.path, this.field);
    scene.add(this.fireflies);
  }

  compileAndWarm() {
    this.renderer.compile(this.scene, this.camera);
    this.updateEnvironment();
  }

  updateEnvironment() {
    this.scene.environment = this.sky.updateEnvironment();
    this.framesSinceEnvironment = 0;
    this.environmentDirty = false;
  }

  applyLighting(lighting) {
    applyLightingToSky(this.skyUniforms, lighting);
    this.worldUniforms.uSunDirection.value.copy(lighting.sunDirection);
    this.worldUniforms.uSunLight.value.copy(lighting.sunColor).multiplyScalar(lighting.sunIntensity);
    this.worldUniforms.uCaustics.value = lighting.caustics;
    this.worldUniforms.uGrassTint.value.copy(lighting.grassTint);
    this.sun.color.copy(lighting.sunColor);
    this.sun.intensity = lighting.sunIntensity;
    this.sun.shadow.intensity = lighting.shadowStrength;
    this.scene.fog.color.copy(lighting.fogColor);
    this.scene.fog.density = lighting.fogDensity;
    this.scene.environmentIntensity = lighting.environment;
    this.windowMaterial.emissiveIntensity = lighting.windowGlow;
    this.lampMaterial.emissiveIntensity = lighting.lampGlow;
    this.cabinLight.intensity = lighting.cabinLight * 9;
    this.fireflies.material.uniforms.uIntensity.value = lighting.fireflies;
  }

  setPreset(name, { instant = false } = {}) {
    if (!PRESETS[name]) {
      return;
    }
    if (instant || !this.transition && name === this.presetName) {
      this.transition = null;
      this.presetName = name;
      this.lighting = createLightingState(name);
      this.applyLighting(this.lighting);
      this.environmentDirty = true;
      return;
    }
    this.transition = { from: cloneLighting(this.lighting), to: resolvedPreset(name), elapsed: 0, progress: 0 };
    this.presetName = name;
  }

  setToggle(name, value) {
    this.toggles[name] = value;
    if (name === 'dslr') {
      this.controls.handheld = value && !REDUCED_MOTION;
    }
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.pipeline.setSize(this.renderer.domElement.width, this.renderer.domElement.height);
  }

  updateShadowFrustum() {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const focus = this.camera.position.clone().addScaledVector(forward, 24);
    focus.y = this.field.height(focus.x, focus.z);
    const direction = this.lighting.sunDirection;
    const up = Math.abs(direction.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, direction).normalize();
    const lightUp = new THREE.Vector3().crossVectors(direction, right).normalize();
    const texel = (this.sun.shadow.camera.right - this.sun.shadow.camera.left) / this.sun.shadow.mapSize.x;
    const along = focus.dot(direction);
    const x = Math.round(focus.dot(right) / texel) * texel;
    const y = Math.round(focus.dot(lightUp) / texel) * texel;
    const snapped = right.multiplyScalar(x).addScaledVector(lightUp, y).addScaledVector(direction, along);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(direction, 120);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  advance(deltaTime) {
    this.time += deltaTime;
    if (this.transition) {
      this.transition.elapsed += deltaTime;
      this.transition.progress = Math.min(this.transition.elapsed / TRANSITION_SECONDS, 1);
      blendLighting(this.lighting, this.transition.from, this.transition.to, this.transition.progress);
      this.applyLighting(this.lighting);
      if (this.transition.progress >= 1) {
        this.transition = null;
        this.environmentDirty = true;
      } else if (this.framesSinceEnvironment >= 3) {
        this.environmentDirty = true;
      }
    }
    if (this.environmentDirty) {
      this.updateEnvironment();
    }
    this.framesSinceEnvironment++;

    this.controls.update(deltaTime, this.time);
    this.sky.follow(this.camera);
    this.skyUniforms.uSkyTime.value = this.time;
    this.worldUniforms.uTime.value = this.time;
    this.fireflies.material.uniforms.uTime.value = this.time;
    this.fireflies.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    this.updateShadowFrustum();

    const view = new THREE.Vector3();
    this.camera.getWorldDirection(view);
    const focusTarget = THREE.MathUtils.clamp(this.controls.focusDistance(view), 1.2, 60);
    const focusBlend = this.focusDistance === undefined ? 1 : 1 - Math.exp(-deltaTime * 3.5);
    this.focusDistance = this.focusDistance === undefined ? focusTarget : this.focusDistance + (focusTarget - this.focusDistance) * focusBlend;

    this.pipeline.dofEnabled = this.toggles.dof;
    this.pipeline.dslrEnabled = this.toggles.dslr;
    this.pipeline.focusDistance = this.focusDistance;
    this.pipeline.render({
      scene: this.scene,
      camera: this.camera,
      water: this.water,
      fireflies: this.fireflies,
      lighting: this.lighting,
      time: this.time,
    });
  }

  start() {
    let last = performance.now();
    const loop = (now) => {
      const deltaTime = Math.min((now - last) / 1000, 1 / 20);
      last = now;
      this.frameTimes.push(deltaTime);
      if (this.frameTimes.length > 60) {
        this.frameTimes.shift();
      }
      this.fps = this.frameTimes.length / this.frameTimes.reduce((sum, value) => sum + value, 0);
      this.advance(deltaTime);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

async function main() {
  const app = new CreekApp(document.getElementById('scene'));
  const ui = setupInterface(app);
  const api = {
    app,
    ready: false,
    setPreset: (name, instant = true) => {
      app.setPreset(name, { instant });
      ui.sync();
    },
    setToggle: (name, value) => {
      app.setToggle(name, value);
      ui.sync();
    },
    placeAlongCreek: (z, lateral = 0, options = {}) => app.controls.placeAlongCreek(app.path.sAtZ(z), lateral, options),
    setView: (view) => app.controls.setView(view),
    step: (deltaTime = 1 / 30, count = 1) => {
      for (let index = 0; index < count; index++) {
        app.advance(deltaTime);
      }
    },
    stats: () => ({
      fps: app.fps,
      renderer: app.renderer.info.render,
      memory: app.renderer.info.memory,
      grass: app.grassStats,
      camera: app.camera.position.toArray(),
      focus: app.focusDistance,
    }),
  };
  window.creek = api;
  try {
    await app.init(ui);
  } catch (error) {
    console.error(error);
    ui.fail(`Could not start the scene: ${error.message}`);
    return;
  }
  ui.progress(1);
  app.advance(1 / 60);
  if (CAPTURE) {
    document.body.classList.add('is-capturing');
  }
  ui.done();
  if (!CAPTURE) {
    app.start();
  }
  api.ready = true;
}

main();
