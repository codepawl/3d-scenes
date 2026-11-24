// Rig driver: poses the cockroach skeleton from rotations given in rig space, so the motion code never depends on
// each bone's exported local axes. Every frame: reset() to the rest pose, add rotations, then commit().
import * as THREE from 'three';

const SIDES = ['L', 'R'];
const LEG_PAIRS = [1, 2, 3];
const LEG_SEGMENTS = ['coxa', 'femur', 'tibia', 'tarsus'];
export const ANTENNA_SEGMENTS = 10;

export const UP = new THREE.Vector3(0, 1, 0);

export class RigDriver {
  constructor(modelRoot) {
    this.root = modelRoot;
    this.bones = new Map();
    modelRoot.traverse((node) => {
      if (node.isBone) this.bones.set(node.name, node);
    });
    if (!this.bones.has('body')) throw new Error('rig: no "body" bone; is this the rigged model?');
    modelRoot.updateMatrixWorld(true);
    this.rootInverse = new THREE.Matrix4().copy(modelRoot.matrixWorld).invert();
    this.rest = new Map();
    for (const [name, bone] of this.bones) {
      const parentRotation = new THREE.Quaternion();
      if (bone.parent) this.rigRotationOf(bone.parent, parentRotation);
      this.rest.set(name, {
        quaternion: bone.quaternion.clone(),
        position: bone.position.clone(),
        scale: bone.scale.clone(),
        parentRotationInverse: parentRotation.invert(),
        head: this.rigPositionOf(bone),
      });
    }
    this.pending = new Map();
  }

  rigRotationOf(object, target) {
    const world = new THREE.Quaternion();
    object.getWorldQuaternion(world);
    const rootRotation = new THREE.Quaternion();
    this.root.getWorldQuaternion(rootRotation);
    return target.copy(rootRotation.invert().multiply(world));
  }

  rigPositionOf(object) {
    return object.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.rootInverse);
  }

  has(name) {
    return this.bones.has(name);
  }

  /** Rest head position of a bone in rig space. */
  restHead(name) {
    return this.rest.get(name).head;
  }

  /** Unit vector from a bone's rest head to another bone's rest head, in rig space. */
  restDirection(fromName, toName) {
    return this.restHead(toName).clone().sub(this.restHead(fromName)).normalize();
  }

  reset() {
    for (const [name, bone] of this.bones) {
      const rest = this.rest.get(name);
      bone.position.copy(rest.position);
      bone.scale.copy(rest.scale);
    }
    this.pending.clear();
  }

  /** Rotate a bone by angle (radians) about an axis given in rig space at rest. Rotations accumulate. */
  rotate(name, rigAxis, angle) {
    const rest = this.rest.get(name);
    if (!rest || angle === 0) return;
    const parentAxis = rigAxis.clone().applyQuaternion(rest.parentRotationInverse).normalize();
    const delta = new THREE.Quaternion().setFromAxisAngle(parentAxis, angle);
    const accumulated = this.pending.get(name) ?? new THREE.Quaternion();
    this.pending.set(name, delta.multiply(accumulated));
  }

  /** Move a bone by an offset given in rig space (rig units), relative to its rest position. */
  translate(name, rigOffset) {
    const bone = this.bones.get(name);
    const rest = this.rest.get(name);
    if (!bone) return;
    const parentOffset = rigOffset.clone().applyQuaternion(rest.parentRotationInverse);
    bone.position.copy(rest.position).add(parentOffset);
  }

  scale(name, x, y, z) {
    const bone = this.bones.get(name);
    const rest = this.rest.get(name);
    if (!bone) return;
    bone.scale.set(rest.scale.x * x, rest.scale.y * y, rest.scale.z * z);
  }

  commit() {
    for (const [name, bone] of this.bones) {
      const rest = this.rest.get(name);
      const delta = this.pending.get(name);
      bone.quaternion.copy(rest.quaternion);
      if (delta) bone.quaternion.premultiply(delta);
    }
    this.root.updateMatrixWorld(true);
  }
}

export function legBoneName(side, pair, segment) {
  return `leg_${side}${pair}_${segment}`;
}

export function antennaBoneName(side, index) {
  return `antenna_${side}_${index}`;
}

/** Per-leg axes from the rest pose: swing about up, lift about the horizontal axis across the leg, and knee flex. */
export function legAxes(driver, side, pair) {
  const coxa = legBoneName(side, pair, 'coxa');
  const femur = legBoneName(side, pair, 'femur');
  const tibia = legBoneName(side, pair, 'tibia');
  const tarsus = legBoneName(side, pair, 'tarsus');
  const outward = driver.restDirection(coxa, tarsus);
  outward.y = 0;
  outward.normalize();
  const lift = new THREE.Vector3().crossVectors(outward, UP).normalize();
  const femurDirection = driver.restDirection(femur, tibia);
  const tibiaDirection = driver.restDirection(tibia, tarsus);
  const knee = new THREE.Vector3().crossVectors(femurDirection, tibiaDirection);
  if (knee.lengthSq() < 1e-6) knee.copy(lift);
  knee.normalize();
  // A positive turn about UP moves the foot along UP x outward; flip it per side so positive swing is forward.
  const forward = bodyForward(driver);
  const swingSign = Math.sign(new THREE.Vector3().crossVectors(UP, outward).dot(forward)) || 1;
  return { coxa, femur, tibia, tarsus, outward, lift, knee, swingSign };
}

/** Horizontal unit vector from the body bone toward the head, in rig space. */
export function bodyForward(driver) {
  const forward = driver.restDirection('body', 'head');
  forward.y = 0;
  return forward.normalize();
}

/** Axes for one antenna: yaw about UP and a pitch axis across the base, plus a bend axis per segment. */
export function antennaAxes(driver, side) {
  const segments = [];
  for (let index = 0; index < ANTENNA_SEGMENTS; index++) {
    const name = antennaBoneName(side, index);
    if (!driver.has(name)) break;
    const nextName = antennaBoneName(side, index + 1);
    const direction = driver.has(nextName)
      ? driver.restDirection(name, nextName)
      : driver.restDirection(antennaBoneName(side, index - 1), name);
    let bend = new THREE.Vector3().crossVectors(direction, UP);
    if (bend.lengthSq() < 1e-6) bend = new THREE.Vector3(1, 0, 0);
    segments.push({ name, direction, bend: bend.normalize() });
  }
  return segments;
}

export const RIG_LAYOUT = { SIDES, LEG_PAIRS, LEG_SEGMENTS };
