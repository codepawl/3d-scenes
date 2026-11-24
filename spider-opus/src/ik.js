// Analytic inverse kinematics for one leg: coxa (yaw) > femur > tibia > tarsus (all pitch).
//
// The chain has one joint more than a point target needs. The spare freedom is spent on the tarsus:
// it is held close to vertical, leaning outward by `tarsusLean` radians, which fixes the ankle. The femur
// and tibia then reach the ankle as a two-bone problem, always taking the knee-up solution.
import * as THREE from "three";
import { clamp } from "./math.js";

const VERTICAL_AXIS = new THREE.Vector3(0, 1, 0);
const BEND_AXIS = new THREE.Vector3(1, 0, 0);
const REACH_MARGIN = 0.001;

// `hip` and `target` are in the coxa's parent space. Returns local joint rotations in radians.
export function solveLegAngles(hip, target, lengths, tarsusLean) {
  const offsetX = target.x - hip.x;
  const offsetY = target.y - hip.y;
  const offsetZ = target.z - hip.z;
  const yaw = Math.atan2(offsetX, offsetZ);

  // From here the problem is flat: `reach` runs outward along the leg, `height` runs up.
  const reach = Math.hypot(offsetX, offsetZ) - lengths.coxa;
  const ankleReach = reach - Math.sin(tarsusLean) * lengths.tarsus;
  const ankleHeight = offsetY + Math.cos(tarsusLean) * lengths.tarsus;

  const shortestSpan = Math.abs(lengths.femur - lengths.tibia) + REACH_MARGIN;
  const longestSpan = lengths.femur + lengths.tibia - REACH_MARGIN;
  const ankleDistance = clamp(Math.hypot(ankleReach, ankleHeight), shortestSpan, longestSpan);
  const aimElevation = Math.atan2(ankleHeight, ankleReach);

  const femurCosine =
    (lengths.femur * lengths.femur + ankleDistance * ankleDistance - lengths.tibia * lengths.tibia) /
    (2 * lengths.femur * ankleDistance);
  const kneeCosine =
    (lengths.femur * lengths.femur + lengths.tibia * lengths.tibia - ankleDistance * ankleDistance) /
    (2 * lengths.femur * lengths.tibia);
  const femurElevation = aimElevation + Math.acos(clamp(femurCosine, -1, 1));
  const kneeInterior = Math.acos(clamp(kneeCosine, -1, 1));
  const tibiaElevation = femurElevation - (Math.PI - kneeInterior);
  const tarsusElevation = tarsusLean - Math.PI / 2;

  // A positive rotation about local +X tips the segment's +Z axis downward, so pitch is minus elevation.
  return {
    yaw,
    femur: -femurElevation,
    tibia: femurElevation - tibiaElevation,
    tarsus: tibiaElevation - tarsusElevation,
  };
}

export function applyLegAngles(leg, angles) {
  leg.coxa.quaternion.setFromAxisAngle(VERTICAL_AXIS, angles.yaw);
  leg.femur.quaternion.setFromAxisAngle(BEND_AXIS, angles.femur);
  leg.tibia.quaternion.setFromAxisAngle(BEND_AXIS, angles.tibia);
  leg.tarsus.quaternion.setFromAxisAngle(BEND_AXIS, angles.tarsus);
}
