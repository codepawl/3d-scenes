// The flashlight: a scripted pool of light on the floor. The simulation flees from it and the scene lights it.
import * as THREE from 'three';

export const BEAM_ON_TIME = 3.9;
export const BEAM_FADE_SECONDS = 0.5;
export const BEAM_END_TIME = 10;
// Radius of the lit pool on the floor, in body lengths.
export const POOL_RADIUS = 3.5;

// Floor positions (x, z) the pool passes through, from just beyond the left frame edge, across the frame centre, to beyond the right edge.
const PATH = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-13, 0, 3),
  new THREE.Vector3(-6, 0, 1.5),
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(6, 0, -1.5),
  new THREE.Vector3(13, 0, -3),
]);

function smoothstep(from, to, value) {
  const amount = Math.min(Math.max((value - from) / (to - from), 0), 1);
  return amount * amount * (3 - 2 * amount);
}

/** Where the pool is at a film time: floor centre, how bright it is (0 to 1) and its radius. */
export function beamAt(time) {
  const progress = Math.min(Math.max((time - BEAM_ON_TIME) / (BEAM_END_TIME - BEAM_ON_TIME), 0), 1);
  // Slow at the start and the end, quicker through the middle.
  const eased = progress * 0.7 + smoothstep(0, 1, progress) * 0.3;
  const center = PATH.getPoint(eased);
  // A hand-held wobble.
  center.x += 0.25 * Math.sin(time * 2.7);
  center.z += 0.35 * Math.sin(time * 3.3 + 1);
  return {
    x: center.x,
    z: center.z,
    intensity: smoothstep(BEAM_ON_TIME, BEAM_ON_TIME + BEAM_FADE_SECONDS, time),
    radius: POOL_RADIUS,
  };
}
