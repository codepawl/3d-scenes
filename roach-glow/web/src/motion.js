// Motion controller: owns one spring per animated joint (physics.js) and blends two target layers, idle and
// locomotion, by speed. A movement plan gives speed and how bipedal the run is at each time; distance and gait
// phase are integrated in the same fixed steps as the springs, so every frame is deterministic.
// It also logs actions (footfalls, taps, flicks, scrubs) with their times, for the sound pass.
import * as THREE from 'three';
import { UP, RIG_LAYOUT, legAxes, antennaAxes, bodyForward } from './rig.js';
import { JointSystem, STEP_SECONDS } from './physics.js';
import { IdleLayer } from './idle.js';
import { WalkLayer } from './walk.js';
import { FlightLayer } from './flight.js';

const DEGREE = Math.PI / 180;

const HEAD_SPRING = { frequency: 4.5, dampingRatio: 0.6 };
const ANTENNA_BASE_SPRING = { frequency: 7, dampingRatio: 0.45 };
const PALP_SPRING = { frequency: 16, dampingRatio: 0.4 };
const ABDOMEN_SPRING = { frequency: 2.6, dampingRatio: 0.85 };
const BODY_SPRING = { frequency: 6, dampingRatio: 0.5 };
// Hips rest softly, but track the gait almost exactly when running.
const COXA_REST_FREQUENCY = 10;
const COXA_GAIT_FREQUENCY = 34;

/** A plan that never moves: the roach idles in place. */
export const STAND_STILL = () => ({ speed: 0, bipedal: 0 });

const GROUNDED = { wingsOpen: 0, flap: 0, airborne: 0, cruiseAltitude: 0, pitch: 0, crouch: 0, compress: 0 };
// Squeeze (Jayaram & Full 2016): under a crevice the body flattens 40-60% and the legs splay sideways.
const MAX_COMPRESSION = 0.5;
// How far the head reaches ahead of the body bone, in rig units, so the squeeze starts when the head meets the gap.
const HEAD_REACH = 2.6;
// The head's fall when it comes off: launch speed and gravity in rig units per film second.
const HEAD_LAUNCH = { sideways: 2.6, forward: 1.4, up: 3.2, gravity: 30 };
const HEAD_RESTING_HEIGHT = 0.5;

export class RoachMotion {
  constructor(driver, { seed = 1, plan = STAND_STILL } = {}) {
    this.driver = driver;
    this.plan = plan;
    this.forward = bodyForward(driver);
    this.lateral = new THREE.Vector3().crossVectors(this.forward, UP).normalize();
    this.system = new JointSystem();
    this.buildJoints();
    this.idle = new IdleLayer(this, seed);
    this.walk = new WalkLayer(this);
    this.flightLayer = new FlightLayer(this);
    this.resetTravel();
  }

  resetTravel() {
    this.distance = 0;
    this.speed = 0;
    this.bipedal = 0;
    this.moving = 0;
    this.altitude = 0;
    this.flight = { ...GROUNDED };
    this.squeezeLogged = false;
    this.head = null;
    this.events = [];
    this.idle.previous.clear();
    this.walk.reset();
    this.flightLayer?.reset();
  }

  buildJoints() {
    const system = this.system;
    this.bodyRoll = system.add(BODY_SPRING);
    this.bodyPitch = system.add({ frequency: 4, dampingRatio: 0.7 });
    this.bodyBob = system.add({ frequency: 9, dampingRatio: 0.45 });
    this.bodyYaw = system.add(BODY_SPRING);
    this.bodySway = system.add(BODY_SPRING);
    this.foreWingOpen = system.add({ frequency: 5, dampingRatio: 0.7 });
    this.hindWingOpen = system.add({ frequency: 4, dampingRatio: 0.75 });
    this.headYaw = system.add({ ...HEAD_SPRING, parent: this.bodyRoll, inertia: 0.3 });
    this.headPitch = system.add({ ...HEAD_SPRING, parent: this.bodyPitch, inertia: 0.3 });
    this.abdomen = system.add(ABDOMEN_SPRING);

    this.antennae = {};
    for (const side of RIG_LAYOUT.SIDES) {
      const segments = antennaAxes(this.driver, side);
      const baseYaw = system.add({ ...ANTENNA_BASE_SPRING, parent: this.headYaw, inertia: 0.5 });
      const basePitch = system.add({ ...ANTENNA_BASE_SPRING, parent: this.headPitch, inertia: 0.5 });
      const chain = segments.map(() => ({}));
      let previousBend = basePitch;
      let previousSide = baseYaw;
      segments.forEach((segment, index) => {
        if (index === 0) return;
        // Stiffer near the base, looser toward the tip; each segment resists the swing of the ones before it.
        // Damping and inertia are kept moderate: nine light springs in a row resonate (a 220 degree tip swing
        // with 0.28 damping and 0.6 inertia); a real antenna whips once and settles.
        const frequency = 13 - index * 0.6;
        const droop = -1.4 * DEGREE * (index / segments.length);
        const segmentSpring = { frequency, dampingRatio: 0.5, inertia: 0.28 };
        chain[index].bend = system.add({ ...segmentSpring, parent: previousBend, rest: droop });
        chain[index].side = system.add({ ...segmentSpring, parent: previousSide });
        previousBend = chain[index].bend;
        previousSide = chain[index].side;
      });
      this.antennae[side] = { segments, baseYaw, basePitch, chain };
    }

    this.palps = {};
    for (const side of RIG_LAYOUT.SIDES) {
      if (!this.driver.has(`palp_${side}`)) continue;
      this.palps[side] = {
        tap: system.add({ ...PALP_SPRING, parent: this.headPitch, inertia: 0.4 }),
        sweep: system.add({ ...PALP_SPRING, frequency: 9 }),
      };
    }

    this.legs = [];
    for (const side of RIG_LAYOUT.SIDES) {
      for (const pair of RIG_LAYOUT.LEG_PAIRS) {
        const axes = legAxes(this.driver, side, pair);
        const coxaLift = system.add({ frequency: COXA_REST_FREQUENCY, dampingRatio: 0.6 });
        const coxaSwing = system.add({ frequency: COXA_REST_FREQUENCY, dampingRatio: 0.6 });
        // The outer segments hang off the coxa: they jolt when it lifts or lands, then settle.
        const femurLift = system.add({ frequency: 14, dampingRatio: 0.45, parent: coxaLift, inertia: 0.35 });
        const tibiaFlex = system.add({ frequency: 16, dampingRatio: 0.42, parent: femurLift, inertia: 0.35 });
        const tarsusFlex = system.add({ frequency: 20, dampingRatio: 0.38, parent: tibiaFlex, inertia: 0.4 });
        const hip = this.driver.restHead(axes.coxa);
        const foot = this.driver.restHead(axes.tarsus);
        const reach = Math.hypot(foot.x - hip.x, foot.z - hip.z);
        this.legs.push({ key: `${side}${pair}`, side, pair, axes, reach, coxaLift, coxaSwing, femurLift, tibiaFlex, tarsusFlex });
      }
    }
  }

  logEvent(type, time, details = {}) {
    this.events.push({ type, time: Math.round(time * 1000) / 1000, ...details });
  }

  stepTravel(time) {
    const state = this.plan(time);
    this.speed = state.speed;
    this.bipedal = state.bipedal ?? 0;
    this.distance += this.speed * STEP_SECONDS;
    this.flight = { ...GROUNDED, ...state };
    if (state.slabStart !== undefined) {
      const entering = (this.distance + HEAD_REACH - (state.slabStart - 1.5)) / 2.2;
      this.flight.compress = MAX_COMPRESSION * smoothstep(entering);
      if (this.flight.compress > 0.05 && !this.squeezeLogged) {
        this.squeezeLogged = true;
        this.logEvent('squeeze-enter', time);
      }
    }
    this.trackHead(time, state.headDetachAt);
    // In the air the legs stop stepping, whatever the forward speed.
    this.moving = Math.min(1, this.speed / 2) * (1 - this.flight.airborne);
  }

  setTargets(time) {
    this.stepTravel(time);
    this.idle.setTargets(time);
    const coxaFrequency = COXA_REST_FREQUENCY + (COXA_GAIT_FREQUENCY - COXA_REST_FREQUENCY) * this.moving;
    for (const leg of this.legs) {
      leg.coxaLift.setFrequency(coxaFrequency);
      leg.coxaSwing.setFrequency(coxaFrequency);
    }
    this.walk.setTargets(time, this.moving);
    const { crouch, pitch, airborne } = this.flight;
    this.bodyBob.target -= crouch * 0.35;
    this.bodyPitch.target += pitch * airborne;
    this.flightLayer.setTargets(time);
  }

  apply(time) {
    if (time < this.system.time - 1e-9) this.resetTravel();
    this.system.advanceTo(time, (stepTime) => this.setTargets(stepTime));
    const driver = this.driver;
    driver.reset();

    // Pitch pivots on the hind hips, not the body bone, so the rear stays down when the front rears up.
    const hindHip = driver.restHead('leg_L3_coxa').clone().sub(driver.restHead('body'));
    hindHip.x = 0;
    const pitched = hindHip.clone().applyAxisAngle(this.lateral, this.bodyPitch.angle);
    const pivotShift = hindHip.sub(pitched);
    const sway = this.lateral.clone().multiplyScalar(this.bodySway.angle);
    // Flattening scales the body bone (and everything on it) about the thorax, so lower it to keep the feet down.
    const compress = this.flight.compress;
    const flatten = new THREE.Vector3(0, -driver.restHead('body').y * compress, 0);
    driver.translate('body', new THREE.Vector3(0, this.bodyBob.angle, 0).add(pivotShift).add(sway).add(flatten));
    if (compress > 0) driver.scale('body', 1, 1, 1 - compress);
    this.poseDetachedHead(driver);
    driver.rotate('body', UP, this.bodyYaw.angle);
    driver.rotate('body', this.forward, this.bodyRoll.angle);
    driver.rotate('body', this.lateral, this.bodyPitch.angle);
    driver.rotate('head', UP, this.headYaw.angle);
    driver.rotate('head', this.lateral, this.headPitch.angle);

    for (const antenna of Object.values(this.antennae)) {
      const { segments, baseYaw, basePitch, chain } = antenna;
      if (!segments.length) continue;
      driver.rotate(segments[0].name, UP, baseYaw.angle);
      driver.rotate(segments[0].name, segments[0].bend, basePitch.angle);
      segments.forEach((segment, index) => {
        if (index === 0) return;
        driver.rotate(segment.name, segment.bend, chain[index].bend.angle);
        driver.rotate(segment.name, UP, chain[index].side.angle);
      });
    }

    for (const [side, palp] of Object.entries(this.palps)) {
      driver.rotate(`palp_${side}`, this.lateral, palp.tap.angle);
      driver.rotate(`palp_${side}`, UP, palp.sweep.angle);
    }

    const pump = this.abdomen.angle;
    driver.scale('abdomen', 1 + pump * 0.06, 1 - pump * 0.02, 1 + pump * 0.06);

    for (const leg of this.legs) {
      const { axes } = leg;
      driver.rotate(axes.coxa, axes.lift, leg.coxaLift.angle);
      driver.rotate(axes.coxa, UP, axes.swingSign * leg.coxaSwing.angle);
      driver.rotate(axes.femur, axes.lift, leg.femurLift.angle);
      driver.rotate(axes.tibia, axes.knee, leg.tibiaFlex.angle);
      driver.rotate(axes.tarsus, axes.knee, leg.tarsusFlex.angle);
    }
    this.flightLayer.apply(driver);
    driver.commit();
  }

  /** The head comes off at headDetachAt, flies in an arc and lands on the floor, where it stays while the body
   * walks on. Its antennae keep moving, since they still run on the idle springs (Kunkel: the lone head waves its
   * antennae for hours). */
  trackHead(time, detachAt) {
    if (detachAt === undefined || time < detachAt) return;
    if (!this.head) {
      this.head = { distanceAtDetach: this.distance, landed: false };
      this.logEvent('head-detach', time);
    }
    const head = this.head;
    const flightTime = time - detachAt;
    const restHeight = this.driver.restHead('head').y;
    const drop = restHeight - HEAD_RESTING_HEIGHT;
    // Time for the arc to come back down to the floor: solve up*t - gravity*t^2/2 = -drop.
    const landingTime = (HEAD_LAUNCH.up + Math.sqrt(HEAD_LAUNCH.up ** 2 + 2 * HEAD_LAUNCH.gravity * drop)) / HEAD_LAUNCH.gravity;
    const airTime = Math.min(flightTime, landingTime);
    if (flightTime >= landingTime && !head.landed) {
      head.landed = true;
      this.logEvent('head-land', time);
    }
    const height = HEAD_LAUNCH.up * airTime - 0.5 * HEAD_LAUNCH.gravity * airTime * airTime;
    // The head stays where it fell while the body walks on, so undo the body's travel since the detach.
    const travelled = this.distance - head.distanceAtDetach;
    head.offset = new THREE.Vector3(HEAD_LAUNCH.sideways * airTime, Math.max(height, -drop), HEAD_LAUNCH.forward * airTime - travelled);
    head.roll = Math.min(airTime / landingTime, 1) * 100 * DEGREE;
  }

  poseDetachedHead(driver) {
    if (!this.head?.offset) return;
    driver.translate('head', this.head.offset);
    driver.rotate('head', this.forward, this.head.roll);
  }

  /** Actions logged up to a time, for the sound pass. Replays from 0 so the log is complete. */
  eventsUntil(time) {
    this.resetTravel();
    this.system.reset();
    this.apply(time);
    return this.events.slice();
  }
}

function smoothstep(value) {
  const clamped = Math.min(Math.max(value, 0), 1);
  return clamped * clamped * (3 - 2 * clamped);
}
