// The swarm shot: bakes the swarm roach, runs the simulation and places the flashlight and the camera.
// Shots: swarm-top (straight down) and swarm-low (low three-quarter from the arena's near side).
import * as THREE from 'three';
import { bakeSwarmRoach } from './swarm-bake.js';
import { SwarmSimulation } from './swarm-sim.js';
import { createSwarmMesh, uploadInstances } from './swarm-render.js';
import { beamAt, POOL_RADIUS } from './swarm-beam.js';

const DEFAULT_COUNT = 7000;
// Illuminance the flashlight puts on the floor at the centre of the pool; the candela follows from the distance.
const POOL_ILLUMINANCE = 3.4;
const FLASHLIGHT_OFFSET = new THREE.Vector3(-3.5, 8, 4.5);
// Floor lit below this level draws no glyphs, so only the flashlight pool shows the floor.
const FLOOR_CUTOFF = 0.3;
const TILE_SHRINK = 2.8;
// How much of the pool's half angle the cone adds beyond the radius, for a soft edge.
const CONE_MARGIN = 1.12;

// Camera per shot; `at(time)` lets a shot move. Fog distances keep the far roaches in the dark.
const SHOTS = {
  'swarm-top': {
    fov: 40,
    far: 80,
    fog: [90, 160],
    edgeDepth: 0.008,
    // Straight down, 13 body lengths across: a roach is about 12 cells long.
    at: () => ({ position: new THREE.Vector3(0, 22, 0.001), target: new THREE.Vector3(0, 0, 0) }),
  },
  'swarm-low': {
    fov: 40,
    far: 90,
    fog: [16, 58],
    edgeDepth: 0.03,
    // Tilted down about 20 degrees so the top of the frame is the far end of the swarm fading into fog, not sky.
    at: (time) => ({ position: new THREE.Vector3(0, 5, 15 - 0.15 * time), target: new THREE.Vector3(0, 0, 0.3) }),
  },
};

function dimLights(lights) {
  lights.keyLight.intensity = 1.3;
  lights.keyLight.castShadow = false;
  lights.rimLight.intensity = 0.9;
  lights.fillLight.intensity = 1.1;
  lights.cameraFill.intensity = 0.5;
}

export async function createSwarmShot({ scene, camera, parameters, lights }) {
  const baked = await bakeSwarmRoach();
  const count = Number(parameters.get('n') ?? DEFAULT_COUNT);
  const simulation = new SwarmSimulation(count, {
    seed: Number(parameters.get('seed') ?? 7),
    strides: { walk: baked.walk.groundStride, sprint: baked.sprint.groundStride },
  });
  const mesh = createSwarmMesh(baked, count);
  scene.add(mesh);
  dimLights(lights);

  const halfAngle = Math.atan((POOL_RADIUS * CONE_MARGIN) / FLASHLIGHT_OFFSET.length());
  const flashlight = new THREE.SpotLight(0xfff0dc, 0, 0, halfAngle, 0.45, 2);
  flashlight.castShadow = true;
  flashlight.shadow.mapSize.set(1024, 1024);
  flashlight.shadow.camera.near = 2;
  flashlight.shadow.camera.far = 24;
  flashlight.shadow.bias = -0.002;
  scene.add(flashlight, flashlight.target);
  scene.userData.floorCutoff = FLOOR_CUTOFF;
  // Tiles about as big as a roach, so the grout reads as a floor and not as a window frame.
  scene.getObjectByName('floor')?.material.map.repeat.multiplyScalar(TILE_SHRINK);
  const fullCandela = POOL_ILLUMINANCE * FLASHLIGHT_OFFSET.lengthSq();

  let shot = SHOTS[parameters.get('shot')] ?? SHOTS['swarm-top'];
  const frame = (name) => {
    shot = SHOTS[name] ?? SHOTS['swarm-top'];
    camera.fov = shot.fov;
    camera.far = shot.far;
    // Roaches are low and thin, so their outline needs a lower depth-edge threshold than the single roach did.
    scene.userData.edgeDepth = shot.edgeDepth;
    camera.updateProjectionMatrix();
    if (scene.fog) {
      scene.fog.near = shot.fog[0];
      scene.fog.far = shot.fog[1];
    }
  };

  const update = (time) => {
    simulation.advanceTo(time);
    uploadInstances(mesh, simulation);
    const beam = beamAt(time);
    flashlight.target.position.set(beam.x, 0, beam.z);
    flashlight.position.set(beam.x, 0, beam.z).add(FLASHLIGHT_OFFSET);
    flashlight.intensity = fullCandela * beam.intensity;
    const view = shot.at(time);
    camera.position.copy(view.position);
    camera.lookAt(view.target);
  };

  return {
    frame,
    update,
    simulation,
    baked,
    eventsUntil: (time) => simulation.eventsUntil(time),
  };
}
