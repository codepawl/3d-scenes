// Where the spider wants to go: the pointer on the floor, the arrow keys, or the scripted recording run.
// The target is drawn as a small amber reticle on whatever surface it sits on.
import * as THREE from "three";
import { clamp } from "./math.js";
import { TRACK } from "./world.js";

const ARENA = { minimumX: -2.8, maximumX: 7, minimumZ: -14, maximumZ: 14 };
const WAYPOINT_REACHED_DISTANCE = 0.6;

// Straight down the course, then back the way it came, turning toward the camera side.
export const SCRIPTED_RUN = {
  start: { x: 0, z: TRACK.startZ, heading: 0 },
  waypoints: [
    { x: 0, z: TRACK.endZ },
    { x: 0.7, z: -0.6 },
  ],
};

function createReticle() {
  const material = new THREE.MeshBasicMaterial({ color: "#ffad45", transparent: true, depthWrite: false });
  const reticle = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.21, 40), material);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.045, 16), material);
  ring.rotation.x = -Math.PI / 2;
  dot.rotation.x = -Math.PI / 2;
  reticle.add(ring, dot);
  reticle.renderOrder = 1;
  return { reticle, material };
}

export function createTargetController({ camera, canvas, walker, sampleGround, onWaypointReached }) {
  const raycaster = new THREE.Raycaster();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const pointer = new THREE.Vector2();
  const floorHit = new THREE.Vector3();
  const heldKeys = new Set();
  const script = { isRunning: false, waypointIndex: 0, glide: new THREE.Vector3() };
  const { reticle, material } = createReticle();

  function setClampedTarget(x, z) {
    walker.setTarget(clamp(x, ARENA.minimumX, ARENA.maximumX), clamp(z, ARENA.minimumZ, ARENA.maximumZ));
  }

  function aimAtPointer(event) {
    const bounds = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(floorPlane, floorHit)) {
      return;
    }
    script.isRunning = false;
    setClampedTarget(floorHit.x, floorHit.z);
  }

  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse" || event.buttons > 0) {
      aimAtPointer(event);
    }
  });
  canvas.addEventListener("pointerdown", aimAtPointer);
  window.addEventListener("keydown", (event) => {
    if (event.code.startsWith("Arrow")) {
      event.preventDefault();
      heldKeys.add(event.code);
      script.isRunning = false;
    }
  });
  window.addEventListener("keyup", (event) => heldKeys.delete(event.code));
  window.addEventListener("blur", () => heldKeys.clear());

  // Tank steering relative to the spider: up walks on, left and right turn, down halts.
  function steerWithKeys() {
    const position = walker.motion.position;
    if (heldKeys.has("ArrowDown")) {
      walker.setTarget(position.x, position.z);
      return;
    }
    const isWalkingOn = heldKeys.has("ArrowUp");
    const turn = (heldKeys.has("ArrowLeft") ? 1 : 0) - (heldKeys.has("ArrowRight") ? 1 : 0);
    if (!isWalkingOn && turn === 0) {
      return;
    }
    const angle = walker.motion.heading + turn * (isWalkingOn ? 0.6 : 1.5);
    const distance = isWalkingOn ? 2.4 : 1.2;
    setClampedTarget(position.x + Math.sin(angle) * distance, position.z + Math.cos(angle) * distance);
  }

  // The scripted target glides like a hand-held pointer instead of jumping between waypoints.
  function followScript(deltaSeconds) {
    const waypoint = SCRIPTED_RUN.waypoints[script.waypointIndex];
    const glideAmount = 1 - Math.exp(-2.2 * deltaSeconds);
    script.glide.x += (waypoint.x - script.glide.x) * glideAmount;
    script.glide.z += (waypoint.z - script.glide.z) * glideAmount;
    walker.setTarget(script.glide.x, script.glide.z);
    const position = walker.motion.position;
    const distance = Math.hypot(waypoint.x - position.x, waypoint.z - position.z);
    const isLastWaypoint = script.waypointIndex === SCRIPTED_RUN.waypoints.length - 1;
    if (!isLastWaypoint && distance < WAYPOINT_REACHED_DISTANCE) {
      script.waypointIndex += 1;
      onWaypointReached(script.waypointIndex);
    }
  }

  function placeReticle() {
    const target = walker.target;
    reticle.position.set(target.x, sampleGround(target.x, target.z).height + 0.015, target.z);
    material.opacity = walker.distanceToTarget() > 0.5 ? 0.85 : 0.2;
  }

  return {
    reticle,

    runScript() {
      script.isRunning = true;
      script.waypointIndex = 0;
      script.glide.copy(walker.motion.position);
    },

    scriptStage() {
      return script.isRunning ? script.waypointIndex : -1;
    },

    update(deltaSeconds) {
      if (script.isRunning) {
        followScript(deltaSeconds);
      } else {
        steerWithKeys();
      }
      placeReticle();
    },
  };
}
