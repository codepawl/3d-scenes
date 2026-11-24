// Wing membrane: a small grid of mass points over each wing that bends like cloth. The root row is pinned to the
// thorax, each point is held by a spring that is stiff along the leading-edge vein and soft toward the trailing
// edge, neighbours pull on each other (membrane tension), and the stroke's inertia and air drag push every point
// along the wing's normal. The wing's own vertices follow the grid, so the tip lags the stroke, the trailing edge
// trails and ripples, and the wing twists at each stroke reversal without any of it being keyed.
// Stepped with the joint springs (480 Hz from time 0), so it is deterministic like the rest of the motion.
import * as THREE from 'three';
import { UP } from './rig.js';

const SPAN_POINTS = 7;
const CHORD_POINTS = 4;

/**
 * Material settings per wing kind. Frequencies are the hold-spring frequencies in Hz at the leading edge and at the
 * trailing edge; tension couples neighbours; inertia scales how much the stroke's acceleration bends the wing (the
 * membrane is light next to the air it moves); drag is quadratic air drag; maxBend caps tip travel as a share of span.
 */
export const TEGMEN = { leadingFrequency: 12, trailingFrequency: 7, tension: 700, damping: 0.3, inertia: 0.22, drag: 0.03, maxBend: 0.14 };
export const HIND_MEMBRANE = { leadingFrequency: 11, trailingFrequency: 5.5, tension: 650, damping: 0.25, inertia: 0.16, drag: 0.02, maxBend: 0.26 };

export class WingMembrane {
  constructor(meshes, driver, boneName, sideSign, settings) {
    this.meshes = meshes;
    this.settings = settings;
    this.height = new Float32Array(SPAN_POINTS * CHORD_POINTS);
    this.velocity = new Float32Array(SPAN_POINTS * CHORD_POINTS);
    this.measure(driver, boneName, sideSign);
  }

  /** Wing frame from the rest pose: span from root to the farthest vertex, normal near up, chord from the outer
   * (leading, once spread) edge to the inner (trailing) edge. */
  measure(driver, boneName, sideSign) {
    const root = driver.restHead(boneName);
    const rigPoints = this.meshes.map((mesh) => {
      mesh.updateMatrixWorld(true);
      const rigFromGeometry = new THREE.Matrix4().multiplyMatrices(driver.rootInverse, mesh.matrixWorld);
      const positions = mesh.geometry.attributes.position;
      const points = [];
      for (let index = 0; index < positions.count; index++) {
        points.push(new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(rigFromGeometry));
      }
      return { rigFromGeometry, points };
    });

    let tip = root;
    let farthest = 0;
    for (const { points } of rigPoints) {
      for (const point of points) {
        const distance = point.distanceTo(root);
        if (distance > farthest) {
          farthest = distance;
          tip = point;
        }
      }
    }
    const span = tip.clone().sub(root).normalize();
    const normal = UP.clone().addScaledVector(span, -UP.dot(span)).normalize();
    const chord = new THREE.Vector3().crossVectors(normal, span).normalize();
    // Leading edge is the outer side (+X for the left wing), so chord must point inward.
    if (chord.x * sideSign > 0) chord.negate();
    this.spanLength = farthest;

    let chordLow = Infinity;
    let chordHigh = -Infinity;
    for (const { points } of rigPoints) {
      for (const point of points) {
        const across = point.clone().sub(root).dot(chord);
        chordLow = Math.min(chordLow, across);
        chordHigh = Math.max(chordHigh, across);
      }
    }

    this.parts = this.meshes.map((mesh, meshIndex) => {
      const { rigFromGeometry, points } = rigPoints[meshIndex];
      const geometryFromRig = rigFromGeometry.clone().invert();
      // One rig unit along the wing normal, expressed in this mesh's geometry units (not normalised).
      const origin = new THREE.Vector3().applyMatrix4(geometryFromRig);
      const bendDirection = normal.clone().applyMatrix4(geometryFromRig).sub(origin);
      const coordinates = new Float32Array(points.length * 2);
      points.forEach((point, index) => {
        const offset = point.clone().sub(root);
        coordinates[index * 2] = THREE.MathUtils.clamp(offset.dot(span) / farthest, 0, 1);
        coordinates[index * 2 + 1] = THREE.MathUtils.clamp((offset.dot(chord) - chordLow) / (chordHigh - chordLow), 0, 1);
      });
      const positions = mesh.geometry.attributes.position;
      positions.setUsage(THREE.DynamicDrawUsage);
      return { mesh, coordinates, bendDirection, restPositions: Float32Array.from(positions.array) };
    });
  }

  reset() {
    this.height.fill(0);
    this.velocity.fill(0);
  }

  /** strokeVelocity and strokeAcceleration are the stroke angle's rates (rad/s, rad/s^2); open fades it in. */
  step(seconds, strokeVelocity, strokeAcceleration, open) {
    const settings = this.settings;
    const length = this.spanLength;
    const height = this.height;
    const velocity = this.velocity;
    const at = (span, across) => height[span * CHORD_POINTS + across];
    for (let span = 1; span < SPAN_POINTS; span++) {
      const spanShare = span / (SPAN_POINTS - 1);
      const radius = spanShare * length;
      for (let across = 0; across < CHORD_POINTS; across++) {
        const index = span * CHORD_POINTS + across;
        const chordShare = across / (CHORD_POINTS - 1);
        const frequency = settings.leadingFrequency + (settings.trailingFrequency - settings.leadingFrequency) * chordShare;
        const omega = 2 * Math.PI * frequency;
        // Membrane tension: the Laplacian over the grid, with mirrored free edges and the pinned root at zero.
        const left = across > 0 ? at(span, across - 1) : at(span, across + 1);
        const right = across < CHORD_POINTS - 1 ? at(span, across + 1) : at(span, across - 1);
        const inner = at(span - 1, across);
        const outer = span < SPAN_POINTS - 1 ? at(span + 1, across) : at(span - 1, across);
        const tension = settings.tension * (left + right + inner + outer - 4 * height[index]);
        // Air moves past the point at the stroke's speed there; drag pushes against the relative motion.
        const airSpeed = strokeVelocity * radius + velocity[index];
        const drag = -settings.drag * airSpeed * Math.abs(airSpeed) * open;
        const inertia = -settings.inertia * strokeAcceleration * radius * open;
        const hold = -omega * omega * height[index];
        const damping = -2 * settings.damping * omega * velocity[index];
        velocity[index] += (hold + damping + tension + drag + inertia) * seconds;
      }
    }
    const limit = settings.maxBend * length;
    for (let index = CHORD_POINTS; index < height.length; index++) {
      height[index] = THREE.MathUtils.clamp(height[index] + velocity[index] * seconds, -limit, limit);
    }
  }

  /** Height of the membrane at a spot, bilinear over the grid. */
  sample(spanShare, chordShare) {
    const spanPosition = spanShare * (SPAN_POINTS - 1);
    const chordPosition = chordShare * (CHORD_POINTS - 1);
    const span = Math.min(Math.floor(spanPosition), SPAN_POINTS - 2);
    const across = Math.min(Math.floor(chordPosition), CHORD_POINTS - 2);
    const spanBlend = spanPosition - span;
    const chordBlend = chordPosition - across;
    const at = (spanIndex, acrossIndex) => this.height[spanIndex * CHORD_POINTS + acrossIndex];
    const near = at(span, across) * (1 - chordBlend) + at(span, across + 1) * chordBlend;
    const far = at(span + 1, across) * (1 - chordBlend) + at(span + 1, across + 1) * chordBlend;
    return near * (1 - spanBlend) + far * spanBlend;
  }

  /** Move every wing vertex along the wing normal by the membrane height under it. */
  apply() {
    for (const { mesh, coordinates, bendDirection, restPositions } of this.parts) {
      const positions = mesh.geometry.attributes.position;
      const array = positions.array;
      for (let index = 0; index < positions.count; index++) {
        const bend = this.sample(coordinates[index * 2], coordinates[index * 2 + 1]);
        array[index * 3] = restPositions[index * 3] + bendDirection.x * bend;
        array[index * 3 + 1] = restPositions[index * 3 + 1] + bendDirection.y * bend;
        array[index * 3 + 2] = restPositions[index * 3 + 2] + bendDirection.z * bend;
      }
      positions.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingSphere();
    }
  }

  /** Tip height at mid-chord, for plots. */
  get tipBend() {
    return this.sample(1, 0.5);
  }
}
