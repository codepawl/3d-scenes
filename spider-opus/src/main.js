// Entry point: builds the scene, runs the fixed-step simulation and exposes `window.spider` for the
// smoke test and the recorder. Query flags: record=1 (manual clock, no UI), manual=1, script=1,
// camera=free|side|hero|orbit, pixel=1, terrain=0, model=standin.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { loadSpiderModel, createRig } from "./rig.js";
import { createWalker } from "./walker.js";
import { createWorld } from "./world.js";
import { createSteam } from "./steam.js";
import { createMachineryAnimator } from "./machinery.js";
import { createCameraDirector, CAMERA_MODES } from "./cameras.js";
import { createPixelRenderer } from "./pixel.js";
import { createTargetController, SCRIPTED_RUN } from "./controls.js";
import { createRandom } from "./math.js";

const FIXED_STEP_SECONDS = 1 / 60;
const FOG_COLOR = "#0c0e11";
// The same speed above which the gait counts the body as moving.
const WALKING_SPEED = 0.04;

const query = new URLSearchParams(window.location.search);
const isRecording = query.get("record") === "1";
const settings = {
  isManualClock: isRecording || query.get("manual") === "1",
  isPixel: query.get("pixel") === "1",
  hasTerrain: query.get("terrain") !== "0",
  cameraMode: query.get("camera") || "free",
  runsScript: query.get("script") === "1",
};

function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  return renderer;
}

function createScene(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.Fog(FOG_COLOR, 13, 40);
  const environmentGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = environmentGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;
  environmentGenerator.dispose();
  return scene;
}

// A dim warm key that casts the shadows, a cold rim from behind the spider, and a low fill.
function createLights(scene) {
  const fill = new THREE.HemisphereLight("#6b7890", "#16120f", 0.5);
  const key = new THREE.DirectionalLight("#ffe2c4", 1.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  const rim = new THREE.DirectionalLight("#78b6ff", 2.4);
  scene.add(fill, key, key.target, rim, rim.target);
  return {
    follow(focus) {
      key.position.set(focus.x + 5, 9, focus.z + 3);
      key.target.position.copy(focus);
      rim.position.set(focus.x - 6, 5, focus.z - 4);
      rim.target.position.copy(focus);
    },
  };
}

// Distance between the outermost left and right resting feet; the orbit shot frames the spider in these units.
function legSpanOf(rig) {
  const restingFootSides = rig.legs.map((leg) => leg.homeOffset.x);
  return Math.max(...restingFootSides) - Math.min(...restingFootSides);
}

function enableShadows(root) {
  root.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
}

async function start() {
  const canvas = document.getElementById("scene");
  const renderer = createRenderer(canvas);
  const scene = createScene(renderer);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
  const lights = createLights(scene);
  const world = createWorld(scene);
  const model = await loadSpiderModel();
  enableShadows(model.root);
  const rig = createRig(model.root);
  const walker = createWalker({ rig, sampleGround: world.sampleGround });
  scene.add(walker.root);
  const machinery = createMachineryAnimator(rig);
  const steam = createSteam(scene, createRandom(7));
  const director = createCameraDirector(camera, {
    span: legSpanOf(rig),
    bodyRestHeight: rig.bodyRestHeight,
    body: rig.body,
    head: rig.head,
  });
  const pixelRenderer = createPixelRenderer(renderer);
  const controller = createTargetController({
    camera,
    canvas,
    walker,
    sampleGround: world.sampleGround,
    onWaypointReached: () => ventSteam(),
  });
  scene.add(controller.reticle);

  const clock = { time: 0, pendingSeconds: 0 };
  const state = { isPixel: false, hasTerrain: true, isWalking: false, frames: 0, lastFrameTime: undefined };
  const bodyVelocity = new THREE.Vector3();
  const terrainButton = document.getElementById("terrain-toggle");
  const pixelButton = document.getElementById("pixel-toggle");

  // Timed events for the recorder's sound track. Only kept on the manual clock, where the recorder
  // drains them; live play would let the list grow for as long as the page stays open.
  const eventLog = [];
  function logEvent(type, details) {
    if (settings.isManualClock) {
      eventLog.push({ time: clock.time, type, ...details });
    }
  }

  function ventSteam() {
    steam.startBurst();
    logEvent("steam");
  }

  function handleWalkerEvents(events) {
    for (const event of events) {
      if (event.type === "groupLift") {
        steam.puff(rig.vents[event.group % rig.vents.length], bodyVelocity);
        machinery.addPressure(0.5);
      } else if (event.type === "lift") {
        logEvent("lift", { leg: event.legName });
      } else if (event.type === "plant") {
        steam.footStrike(event.position);
        director.addShake(0.006);
        logEvent("plant", { leg: event.legName, dropHeight: event.dropHeight });
      }
    }
  }

  function logWalkingChange(motion) {
    const isWalking = Math.abs(motion.speed) > WALKING_SPEED;
    if (isWalking !== state.isWalking) {
      state.isWalking = isWalking;
      logEvent(isWalking ? "walkStart" : "walkStop");
    }
  }

  function simulate(deltaSeconds, time) {
    controller.update(deltaSeconds);
    walker.update(deltaSeconds, time);
    const motion = walker.motion;
    bodyVelocity.set(Math.sin(motion.heading) * motion.speed, 0, Math.cos(motion.heading) * motion.speed);
    handleWalkerEvents(walker.drainEvents());
    logWalkingChange(motion);
    machinery.update(deltaSeconds, time, motion);
    steam.update(deltaSeconds, rig.vents, bodyVelocity);
    world.update(time);
    director.update(deltaSeconds, time, motion.position);
    lights.follow(director.focus);
  }

  // Every motion reads this one clock. It only moves in fixed steps, so live play and frame-stepped
  // recording integrate the same way, and two recordings of the script match frame for frame.
  function advanceClock(seconds) {
    clock.pendingSeconds += seconds;
    while (clock.pendingSeconds >= FIXED_STEP_SECONDS - 0.000001) {
      clock.pendingSeconds -= FIXED_STEP_SECONDS;
      clock.time += FIXED_STEP_SECONDS;
      simulate(FIXED_STEP_SECONDS, clock.time);
    }
  }

  function renderFrame() {
    if (state.isPixel) {
      pixelRenderer.render(scene, camera);
    } else {
      renderer.render(scene, camera);
    }
  }

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const drawingBufferSize = renderer.getDrawingBufferSize(new THREE.Vector2());
    pixelRenderer.setSize(drawingBufferSize.x, drawingBufferSize.y);
    renderFrame();
  }

  function setPixel(isPixel) {
    state.isPixel = isPixel;
    world.setPixelLook(isPixel);
    pixelButton.setAttribute("aria-pressed", String(isPixel));
  }

  function setTerrain(hasTerrain) {
    state.hasTerrain = hasTerrain;
    world.setObstaclesVisible(hasTerrain);
    walker.settleOnGround();
    terrainButton.setAttribute("aria-pressed", String(hasTerrain));
  }

  function setCamera(mode) {
    director.setMode(mode);
    director.jumpTo(walker.motion.position);
  }

  function startScriptedRun() {
    const start = SCRIPTED_RUN.start;
    walker.placeAt(start.x, start.z, start.heading);
    director.jumpTo(walker.motion.position);
    controller.runScript();
    ventSteam();
  }

  function walkCourse() {
    const courseEnd = SCRIPTED_RUN.waypoints[0];
    walker.setTarget(courseEnd.x, courseEnd.z);
  }

  function halt() {
    walker.setTarget(walker.motion.position.x, walker.motion.position.z);
  }

  function cycleCamera() {
    const nextIndex = (CAMERA_MODES.indexOf(director.mode) + 1) % CAMERA_MODES.length;
    setCamera(CAMERA_MODES[nextIndex]);
  }

  const keyActions = {
    Space: ventSteam,
    KeyP: () => setPixel(!state.isPixel),
    KeyT: () => setTerrain(!state.hasTerrain),
    KeyH: () => document.body.classList.toggle("chrome-hidden"),
    KeyC: cycleCamera,
    KeyR: startScriptedRun,
  };

  function bindInterface() {
    for (const button of [terrainButton, pixelButton]) {
      // A mouse click should not leave focus behind, or Space would toggle the button instead of venting.
      button.addEventListener("click", (event) => {
        if (event.detail > 0) {
          button.blur();
        }
      });
    }
    terrainButton.addEventListener("click", () => setTerrain(!state.hasTerrain));
    pixelButton.addEventListener("click", () => setPixel(!state.isPixel));
    window.addEventListener("keydown", (event) => {
      const action = keyActions[event.code];
      const isOnButton = event.target instanceof HTMLButtonElement;
      if (!action || event.repeat || (isOnButton && event.code === "Space")) {
        return;
      }
      event.preventDefault();
      action();
    });
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        director.zoomBy(event.deltaY > 0 ? 1.08 : 1 / 1.08);
      },
      { passive: false },
    );
    window.addEventListener("resize", resize);
  }

  function onAnimationFrame(now) {
    requestAnimationFrame(onAnimationFrame);
    state.frames += 1;
    if (settings.isManualClock) {
      return;
    }
    const elapsedSeconds = state.lastFrameTime === undefined ? 0 : Math.min((now - state.lastFrameTime) / 1000, 0.1);
    state.lastFrameTime = now;
    advanceClock(elapsedSeconds);
    renderFrame();
  }

  document.body.classList.toggle("is-recording", isRecording);
  bindInterface();
  walker.placeAt(SCRIPTED_RUN.start.x, SCRIPTED_RUN.start.z, SCRIPTED_RUN.start.heading);
  setCamera(settings.cameraMode);
  setTerrain(settings.hasTerrain);
  setPixel(settings.isPixel);
  if (settings.runsScript) {
    startScriptedRun();
  }
  advanceClock(FIXED_STEP_SECONDS);
  resize();
  requestAnimationFrame(onAnimationFrame);

  window.spider = {
    ready: true,
    model: model.source,
    legSpan: legSpanOf(rig),
    advance(seconds) {
      advanceClock(seconds);
      renderFrame();
    },
    snapshot() {
      return {
        time: clock.time,
        model: model.source,
        camera: director.mode,
        isPixel: state.isPixel,
        hasTerrain: state.hasTerrain,
        scriptStage: controller.scriptStage(),
        ...walker.snapshot(),
      };
    },
    frameCount: () => state.frames,
    // Read straight after `advance` in the same task, while the drawing buffer still holds the frame.
    captureFrame: () => canvas.toDataURL("image/jpeg", 0.95),
    setCamera,
    setPixel,
    setTerrain,
    setTarget: (x, z) => walker.setTarget(x, z),
    placeAt: (x, z, heading) => walker.placeAt(x, z, heading),
    ventSteam,
    runScript: startScriptedRun,
    walkCourse,
    halt,
    drainEventLog: () => eventLog.splice(0),
  };
}

start();
