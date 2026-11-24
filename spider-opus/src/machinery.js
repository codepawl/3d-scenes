// The spider's idle life: amber eye lamps that flicker, a head that scans in servo jerks, a rattling boiler.
import * as THREE from "three";
import { hashNoise, createSpring, stepSpring, clamp } from "./math.js";

const LAMP_COLOR = new THREE.Color("#ffa02b");

function createGlowTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255, 210, 140, 1)");
  gradient.addColorStop(0.25, "rgba(255, 150, 50, 0.45)");
  gradient.addColorStop(1, "rgba(255, 120, 20, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Halo sprites on each eye plus one warm light that throws the eye glow onto the ground ahead.
function addEyeLamps(rig) {
  const haloMaterial = new THREE.SpriteMaterial({
    map: createGlowTexture(),
    color: LAMP_COLOR,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const halos = rig.eyes.map((eye) => {
    const halo = new THREE.Sprite(haloMaterial);
    halo.scale.setScalar(0.42);
    eye.add(halo);
    return halo;
  });
  const eyeMaterials = [...new Set(rig.eyes.map((eye) => eye.material))];
  const baseIntensities = eyeMaterials.map((material) => {
    if (material.emissive && material.emissive.getHex() === 0) {
      material.emissive.copy(LAMP_COLOR);
    }
    return Math.max(material.emissiveIntensity || 0, 2.5);
  });

  const eyeCenter = new THREE.Vector3();
  for (const eye of rig.eyes) {
    eyeCenter.add(eye.getWorldPosition(new THREE.Vector3()).divideScalar(rig.eyes.length));
  }
  const lamp = new THREE.PointLight(LAMP_COLOR, 5, 6, 1.6);
  rig.head.add(lamp);
  lamp.position.copy(rig.head.worldToLocal(eyeCenter));
  lamp.position.z += 0.35;
  return { haloMaterial, eyeMaterials, baseIntensities, lamp };
}

export function createMachineryAnimator(rig) {
  const lamps = addEyeLamps(rig);
  const headRestQuaternion = rig.head.quaternion.clone();
  const boilerRestPosition = rig.boiler.position.clone();
  const headYaw = createSpring();
  const scanQuaternion = new THREE.Quaternion();
  const verticalAxis = new THREE.Vector3(0, 1, 0);
  let pressure = 0;

  // The eyes hum, and now and then a lamp browns out for a few frames.
  function lampLevel(time) {
    const hum = 0.88 + 0.12 * Math.sin(time * 2.3) * Math.sin(time * 0.7 + 1.1);
    const isBrownout = hashNoise(Math.floor(time * 12)) < 0.035;
    return isBrownout ? hum * 0.3 : hum;
  }

  // The head holds a bearing, then snaps to the next one, biased toward where the body is turning.
  function scanTarget(time, turnRate, speed) {
    const scanSlot = Math.floor(time / 1.7);
    const sweep = speed > 0.2 ? 0.16 : 0.42;
    return (hashNoise(scanSlot) * 2 - 1) * sweep + clamp(turnRate * 0.8, -0.4, 0.4);
  }

  return {
    // Each step of the gait builds pressure that rattles the boiler a little harder.
    addPressure(amount) {
      pressure = Math.min(1, pressure + amount);
    },

    update(deltaSeconds, time, walkerMotion) {
      pressure *= Math.exp(-2.5 * deltaSeconds);
      const level = lampLevel(time);
      lamps.eyeMaterials.forEach((material, materialIndex) => {
        material.emissiveIntensity = lamps.baseIntensities[materialIndex] * level;
      });
      lamps.haloMaterial.opacity = 0.85 * level;
      lamps.lamp.intensity = 5 * level;

      stepSpring(headYaw, scanTarget(time, walkerMotion.turnRate, walkerMotion.speed), 140, 17, deltaSeconds);
      scanQuaternion.setFromAxisAngle(verticalAxis, headYaw.value);
      rig.head.quaternion.copy(headRestQuaternion).multiply(scanQuaternion);

      const rattle = 0.003 + 0.01 * pressure;
      rig.boiler.position.set(
        boilerRestPosition.x + (hashNoise(time * 60) - 0.5) * rattle,
        boilerRestPosition.y + (hashNoise(time * 60 + 17) - 0.5) * rattle,
        boilerRestPosition.z,
      );
    },
  };
}
