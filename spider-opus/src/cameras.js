// Camera framings. `free` is the interactive view, `side` is the pure profile used for the comparison
// recordings, `hero` is a low three-quarter dolly, `orbit` circles the spider for the battle video.
// All of them track a smoothed focus on the spider.
import * as THREE from "three";
import { clamp } from "./math.js";
import { orbitCameraAt, orbitCameraOffset, BODY_LOOK_HEIGHT_IN_SPANS, TRACKING_RATE } from "./orbit-storyboard.mjs";

// The keyboard cycles through these; `orbit` is a recording shot and is only reached by the query flag.
export const CAMERA_MODES = ["free", "side", "hero"];

const FRAMING = {
  free: { fieldOfView: 36, shakeScale: 0.4 },
  side: { fieldOfView: 24, shakeScale: 0 },
  hero: { fieldOfView: 30, shakeScale: 1 },
  orbit: { fieldOfView: 24, shakeScale: 0 },
};

// `subject` is what the orbit shot frames: { span, bodyRestHeight, body, head }, the last two scene nodes.
export function createCameraDirector(camera, subject) {
  const focus = new THREE.Vector3();
  const lookPoint = new THREE.Vector3();
  const orbit = {
    startTime: undefined,
    groundUnderBody: new THREE.Vector3(),
    trackedGround: new THREE.Vector3(),
    bodyPosition: new THREE.Vector3(),
    headPosition: new THREE.Vector3(),
  };
  let mode = "free";
  let zoom = 1;
  let shake = 0;

  // The point on the ground under the body; it rises with the body as the spider climbs.
  function readGroundUnderBody(spiderPosition) {
    subject.body.getWorldPosition(orbit.bodyPosition);
    const groundHeight = orbit.bodyPosition.y - subject.bodyRestHeight;
    return orbit.groundUnderBody.set(spiderPosition.x, groundHeight, spiderPosition.z);
  }

  function placeOrbit(deltaSeconds, time, spiderPosition) {
    const groundUnderBody = readGroundUnderBody(spiderPosition);
    if (orbit.startTime === undefined) {
      orbit.startTime = time;
      orbit.trackedGround.copy(groundUnderBody);
    }
    orbit.trackedGround.lerp(groundUnderBody, 1 - Math.exp(-TRACKING_RATE * deltaSeconds));
    const pose = orbitCameraAt(time - orbit.startTime);
    lookPoint.copy(orbit.trackedGround);
    lookPoint.y += BODY_LOOK_HEIGHT_IN_SPANS * subject.span;
    lookPoint.lerp(subject.head.getWorldPosition(orbit.headPosition), pose.headWeight);
    const visibleHeight = pose.visibleHeightInSpans * subject.span;
    const distance = visibleHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    const offset = orbitCameraOffset(pose, distance);
    camera.position.set(lookPoint.x + offset.x, lookPoint.y + offset.y, lookPoint.z + offset.z);
  }

  function placeFree() {
    // Portrait screens sit further back so the whole leg span fits across.
    const distanceScale = zoom * (camera.aspect < 1 ? 1.9 : 1);
    camera.position.set(focus.x + 5.6 * distanceScale, 2.3 * distanceScale, focus.z + 4.8 * distanceScale);
    lookPoint.set(focus.x, 1.15, focus.z);
  }

  // Low and close, looking slightly up, so the machine towers over the course.
  function placeSide() {
    camera.position.set(11.5, 1.3, focus.z);
    lookPoint.set(0, 1.55, focus.z);
  }

  function placeHero(time) {
    // Starts ahead of the spider and slowly lets it walk past.
    const leadDistance = clamp(4.4 - time * 0.24, -0.6, 4.4);
    camera.position.set(focus.x + 4.3, 0.42, focus.z + leadDistance);
    lookPoint.set(focus.x * 0.5, 1.3, focus.z + 0.3);
  }

  function applyShake(time) {
    const amount = shake * FRAMING[mode].shakeScale;
    camera.position.x += Math.sin(time * 53) * amount;
    camera.position.y += Math.sin(time * 71 + 1.3) * amount;
  }

  return {
    get mode() {
      return mode;
    },

    setMode(nextMode) {
      mode = Object.hasOwn(FRAMING, nextMode) ? nextMode : "free";
      orbit.startTime = undefined;
      camera.fov = FRAMING[mode].fieldOfView;
      camera.updateProjectionMatrix();
    },

    zoomBy(factor) {
      zoom = clamp(zoom * factor, 0.55, 1.8);
    },

    jumpTo(position) {
      focus.copy(position);
    },

    addShake(amount) {
      shake = Math.min(0.05, shake + amount);
    },

    update(deltaSeconds, time, spiderPosition) {
      focus.lerp(spiderPosition, 1 - Math.exp(-2.6 * deltaSeconds));
      shake *= Math.exp(-7 * deltaSeconds);
      if (mode === "orbit") {
        placeOrbit(deltaSeconds, time, spiderPosition);
      } else if (mode === "side") {
        placeSide();
      } else if (mode === "hero") {
        placeHero(time);
      } else {
        placeFree();
      }
      applyShake(time);
      camera.lookAt(lookPoint);
    },

    focus,
  };
}
