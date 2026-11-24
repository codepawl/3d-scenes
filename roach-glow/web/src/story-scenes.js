// Props for the story beats that need more than the floor: the crevice slab for the squeeze.
import * as THREE from 'three';
import { SLAB_START } from './plans.js';

const SLAB_LENGTH = 30;
const SLAB_THICKNESS = 0.7;
const SLAB_WIDTH = 9;

/**
 * A dark stone slab lying over the path with a crevice under it (Jayaram & Full 2016: 3 mm, a quarter of the
 * standing height). The model's flattened body sets the gap, since its proportions are not the real animal's.
 * rigToScene converts rig units (the path) to scene units; gap is in scene units.
 * It casts no shadow, so the key light still reaches the roach crawling under it.
 */
export function buildCreviceSlab(rigToScene, gap) {
  const length = SLAB_LENGTH * rigToScene;
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(SLAB_WIDTH, SLAB_THICKNESS, length),
    new THREE.MeshStandardMaterial({ color: 0x241f1c, roughness: 0.9, metalness: 0 }),
  );
  slab.position.set(0, gap + SLAB_THICKNESS / 2, SLAB_START * rigToScene + length / 2);
  slab.castShadow = false;
  slab.receiveShadow = true;
  slab.name = 'crevice-slab';
  return slab;
}

// The radiation beat, in seconds from the start of the shot. MythBusters (2008): at the top dose the roaches died
// and flour beetles were the only insects left, so the roach flips onto its back and the beetle lights up beside it.
const RADIATION = {
  pulseAt: 1.0,
  pulseLength: 1.4,
  peakExposure: 9,
  flipAt: 2.0,
  flipLength: 0.55,
  dimTo: 0.22,
  beetleAt: 3.1,
  beetleFadeLength: 0.8,
};
// A flour beetle is about 3.5 mm to the roach's 30 mm; shown a little larger so it still reads as glyphs.
const BEETLE_LENGTH = 0.55;
const BEETLE_SPOT = new THREE.Vector3(-1.5, 0, 2.3);

/**
 * Sets up the radiation beat on a loaded roach: wraps it in a group that tumbles it onto its back and loads the
 * beetle stand-in. Returns update(time), which drives the flash, the flip and the beetle's light, and the beat's
 * sound cues. The lights stay on the mover, so they do not turn over with the roach.
 */
export async function createRadiationBeat({ roach, mover, glowPass, loader }) {
  const tumble = new THREE.Group();
  mover.add(tumble);
  tumble.add(roach);
  const restTop = new THREE.Box3().setFromObject(roach).max.y;
  const roachColours = [];
  roach.traverse((node) => {
    if (node.isMesh) roachColours.push({ material: node.material, colour: node.material.color.clone() });
  });

  const beetle = (await loader.loadAsync('./models/beetle.glb')).scene;
  const beetleBox = new THREE.Box3().setFromObject(beetle);
  const beetleSize = beetleBox.getSize(new THREE.Vector3());
  beetle.scale.setScalar(BEETLE_LENGTH / Math.max(beetleSize.x, beetleSize.z));
  beetle.updateMatrixWorld(true);
  const scaledBox = new THREE.Box3().setFromObject(beetle);
  const beetleCentre = scaledBox.getCenter(new THREE.Vector3());
  // Centre the model on a pivot so turning it does not swing it around the file's own origin.
  beetle.position.set(-beetleCentre.x, -scaledBox.min.y, -beetleCentre.z);
  const beetlePivot = new THREE.Group();
  beetlePivot.position.copy(BEETLE_SPOT);
  beetlePivot.rotation.y = -0.6;
  beetlePivot.add(beetle);
  const beetleMaterials = [];
  beetle.traverse((node) => {
    if (!node.isMesh) return;
    node.material.roughness = Math.max(node.material.roughness ?? 1, 0.7);
    node.material.metalness = 0;
    node.castShadow = true;
    beetleMaterials.push({ material: node.material, colour: node.material.color.clone() });
  });
  mover.add(beetlePivot);
  const beetleLight = new THREE.PointLight(0xfff0dc, 0, 3.5, 1.4);
  beetleLight.position.copy(BEETLE_SPOT).add(new THREE.Vector3(0.4, 1.1, 0.6));
  mover.add(beetleLight);

  // The flash is a light over the roach plus a burst of exposure and haze in the glyph pass, so the whole frame
  // whites out and fills with glyphs for a moment.
  const flashLight = new THREE.PointLight(0xffffff, 0, 14, 1.2);
  flashLight.position.set(0.3, 4, 1.2);
  mover.add(flashLight);
  const uniforms = glowPass.material.uniforms;
  const baseExposure = uniforms.uExposure.value;
  const baseHaze = uniforms.uHaze.value;
  const update = (time) => {
    const sincePulse = time - RADIATION.pulseAt;
    const flash = sincePulse < 0 ? 0 : Math.exp(-sincePulse / (RADIATION.pulseLength / 4)) * Math.min(sincePulse / 0.06, 1);
    uniforms.uExposure.value = baseExposure + (RADIATION.peakExposure - baseExposure) * flash;
    uniforms.uHaze.value = baseHaze + 1.6 * flash;
    flashLight.intensity = 260 * flash;

    const flip = smoothstep((time - RADIATION.flipAt) / RADIATION.flipLength);
    const hop = Math.sin(flip * Math.PI) * restTop * 0.35;
    tumble.rotation.z = flip * Math.PI;
    tumble.position.y = flip * restTop + hop;
    const dim = 1 - (1 - RADIATION.dimTo) * smoothstep((time - RADIATION.flipAt - RADIATION.flipLength) / 1.2);
    for (const entry of roachColours) entry.material.color.copy(entry.colour).multiplyScalar(dim);

    const reveal = smoothstep((time - RADIATION.beetleAt) / RADIATION.beetleFadeLength);
    // The glyph pass draws outlines from depth even on a black mesh, so hide the beetle until it starts to light.
    beetle.visible = reveal > 0;
    for (const entry of beetleMaterials) entry.material.color.copy(entry.colour).multiplyScalar(reveal);
    beetleLight.intensity = 14 * reveal;
  };
  const cues = [
    { type: 'radiation-pulse', time: RADIATION.pulseAt },
    { type: 'roach-flip', time: RADIATION.flipAt },
    { type: 'roach-land', time: RADIATION.flipAt + RADIATION.flipLength },
    { type: 'beetle-reveal', time: RADIATION.beetleAt },
  ];
  return { update, cues };
}

function smoothstep(value) {
  const clamped = Math.min(Math.max(value, 0), 1);
  return clamped * clamped * (3 - 2 * clamped);
}
