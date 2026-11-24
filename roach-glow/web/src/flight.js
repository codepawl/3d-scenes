// Flight layer: the tegmina (leathery forewings) lift and spread, the hind wings swing out from under them and
// unfold, both pairs beat, the roach jumps, and from then on it is carried by the wings: altitude is integrated
// from gravity and a lift that pulses with every downstroke, the path wanders and the body banks into each drift,
// and legs and antennae hang loose and get shaken by every beat. Each wing is a WingMembrane that bends like cloth.
// The real wingbeat is 25-30 Hz (reported for P. americana); the film shows it slowed to FILM_WINGBEAT_HZ so each
// stroke reads at 30 fps, and gravity is scaled by the same slow-down. Logs takeoff, wing opening and every
// downstroke for the sound pass.
import * as THREE from 'three';
import { UP } from './rig.js';
import { STEP_SECONDS, seededRandom } from './physics.js';
import { WingMembrane, TEGMEN, HIND_MEMBRANE } from './wing-membrane.js';

const DEGREE = Math.PI / 180;
export const FILM_WINGBEAT_HZ = 6;

const ACROSS = new THREE.Vector3(1, 0, 0);
const ALONG = new THREE.Vector3(0, 0, 1);

// Open pose per wing pair: spread swings the tip out about the vertical, elevation raises the trailing tip, and the
// beat rocks the spread wing up and down about the body's long axis, around a raised stroke centre.
const FORE_WING = { spread: 58 * DEGREE, elevation: 34 * DEGREE, strokeCentre: 12 * DEGREE, beat: 24 * DEGREE, beatLag: 0.08 };
const HIND_WING = { spread: 84 * DEGREE, elevation: 8 * DEGREE, strokeCentre: 24 * DEGREE, beat: 46 * DEGREE, beatLag: 0 };
// The hind wing is one rigid folded piece in the rig; widening it across its chord stands in for the fan opening.
const HIND_UNFOLD_WIDTH = 1.7;

// Vertical flight, in rig units (body about 5.3 long) and film seconds. Gravity is real gravity in body lengths,
// slowed with the wingbeat (about 4.5x), so a jump rises and sags the way it would in slow motion.
const GRAVITY = 60;
const JUMP_SPEED = 10;
const ALTITUDE_HOLD = 7;
const VERTICAL_DRAG = 2.4;
// Lift is not steady: most of it comes in the downstroke, the upstroke gives a little back.
const DOWNSTROKE_SHARE = 0.45;
const DOWNSTROKE_LIFT = 1.25;
const UPSTROKE_LIFT = -0.95;
// Sideways wander and how hard the body chases it.
const DRIFT_STIFFNESS = 10;
const DRIFT_DAMPING = 3.2;

const MEMBRANE_PARTS = {
  fore: { bone: 'fore', settings: TEGMEN, pattern: (side) => new RegExp(`^${side}_mesothorax`) },
  hind: { bone: 'hind', settings: HIND_MEMBRANE, pattern: (side) => new RegExp(`^${side}_wings?0[12]`) },
};

export class FlightLayer {
  constructor(motion) {
    this.motion = motion;
    this.buildMembranes(motion.driver);
    this.reset();
  }

  buildMembranes(driver) {
    this.membranes = [];
    const meshes = [];
    driver.root.traverse((node) => {
      if (node.isMesh) meshes.push(node);
    });
    for (const side of ['L', 'R']) {
      const sideSign = side === 'L' ? 1 : -1;
      for (const [pair, part] of Object.entries(MEMBRANE_PARTS)) {
        const boneName = `wing_${side}_${part.bone}`;
        const wingMeshes = meshes.filter((mesh) => part.pattern(side).test(mesh.name));
        if (!driver.has(boneName) || !wingMeshes.length) continue;
        this.membranes.push({ pair, membrane: new WingMembrane(wingMeshes, driver, boneName, sideSign, part.settings) });
      }
    }
  }

  reset() {
    this.beatPhase = 0;
    this.beatCount = 0;
    this.previousAirborne = 0;
    this.previousOpen = 0;
    this.altitude = 0;
    this.climbSpeed = 0;
    this.drift = 0;
    this.driftSpeed = 0;
    // The camera follows a smoothed copy of the flight, so the roach's bobbing and drifting stay visible in frame.
    this.trackAltitude = 0;
    this.trackSpeed = 0;
    this.strokes = { fore: { angle: 0, velocity: 0 }, hind: { angle: 0, velocity: 0 } };
    this.random = seededRandom(31);
    for (const { membrane } of this.membranes ?? []) membrane.reset();
    this.publish();
  }

  publish() {
    const motion = this.motion;
    motion.altitude = this.altitude;
    motion.drift = this.drift;
    motion.trackAltitude = this.trackAltitude;
  }

  setTargets(time) {
    const motion = this.motion;
    const { wingsOpen, flap, airborne, cruiseAltitude = 0 } = motion.flight;
    motion.foreWingOpen.target = wingsOpen;
    motion.hindWingOpen.target = smoothstep((wingsOpen - 0.25) / 0.75);

    if (wingsOpen > 0.05 && this.previousOpen <= 0.05) motion.logEvent('tegmina-open', time);
    if (wingsOpen > 0.6 && this.previousOpen <= 0.6) motion.logEvent('wings-unfold', time);
    this.previousOpen = wingsOpen;
    const tookOff = airborne > 0.02 && this.previousAirborne <= 0.02;
    if (tookOff) {
      motion.logEvent('takeoff', time);
      this.climbSpeed = JUMP_SPEED;
    }
    this.previousAirborne = airborne;

    const beatBefore = this.beatPhase;
    if (flap > 0) this.beatPhase += FILM_WINGBEAT_HZ * STEP_SECONDS;
    const newBeat = flap > 0.2 && Math.floor(this.beatPhase) > Math.floor(beatBefore);
    if (newBeat) {
      this.beatCount += 1;
      motion.logEvent('wingbeat', time, { strength: Math.round(flap * 100) / 100 });
    }

    this.stepStrokes(flap);
    this.stepBody(time, flap, airborne, cruiseAltitude, newBeat);
    this.publish();
    if (airborne <= 0) return;
    this.looseLimbs(airborne, flap, newBeat);
  }

  /** Stroke angle of each wing pair and its rates; the membranes bend from these. */
  stepStrokes(flap) {
    const motion = this.motion;
    const opens = { fore: motion.foreWingOpen.angle, hind: motion.hindWingOpen.angle };
    const poses = { fore: FORE_WING, hind: HIND_WING };
    const rates = {};
    for (const pair of ['fore', 'hind']) {
      const stroke = this.strokes[pair];
      const pose = poses[pair];
      const angle = pose.strokeCentre * opens[pair] + pose.beat * flap * this.beatAngle(pose.beatLag);
      const velocity = (angle - stroke.angle) / STEP_SECONDS;
      const acceleration = (velocity - stroke.velocity) / STEP_SECONDS;
      stroke.angle = angle;
      stroke.velocity = velocity;
      rates[pair] = { velocity, acceleration, open: Math.max(0, Math.min(1, opens[pair])) };
    }
    for (const { pair, membrane } of this.membranes) {
      const rate = rates[pair];
      membrane.step(STEP_SECONDS, rate.velocity, rate.acceleration, rate.open);
    }
  }

  /** Altitude from gravity and pulsed lift; sideways wander with banking; a nose dip on every downstroke. */
  stepBody(time, flap, airborne, cruiseAltitude, newBeat) {
    const motion = this.motion;
    if (airborne > 0) {
      const cycle = this.beatPhase - Math.floor(this.beatPhase);
      const pulse = cycle < DOWNSTROKE_SHARE ? DOWNSTROKE_LIFT : UPSTROKE_LIFT;
      const wander = Math.sin(time * 1.1 + 1) * 0.5 + Math.sin(time * 2.7) * 0.2;
      const hold = GRAVITY + ALTITUDE_HOLD * (cruiseAltitude + wander - this.altitude) - VERTICAL_DRAG * this.climbSpeed;
      const lift = flap * Math.max(0, hold) * (1 + pulse * 0.6);
      this.climbSpeed += (lift - GRAVITY * airborne) * STEP_SECONDS;
      this.altitude += this.climbSpeed * STEP_SECONDS;
      if (this.altitude < 0) {
        this.altitude = 0;
        this.climbSpeed = Math.max(0, this.climbSpeed);
      }
      const driftTarget = (Math.sin(time * 0.8 + 0.3) * 0.9 + Math.sin(time * 2.1) * 0.35) * airborne;
      const driftAcceleration = DRIFT_STIFFNESS * (driftTarget - this.drift) - DRIFT_DAMPING * this.driftSpeed;
      this.driftSpeed += driftAcceleration * STEP_SECONDS;
      this.drift += this.driftSpeed * STEP_SECONDS;
      // Bank into the sideways push and point the nose a little along the drift, like a light flyer in air.
      const bank = THREE.MathUtils.clamp(driftAcceleration / GRAVITY, -0.5, 0.5);
      motion.bodyRoll.target = mix(motion.bodyRoll.target, -bank * 2.4, airborne);
      motion.bodyYaw.target = mix(motion.bodyYaw.target, Math.atan2(this.driftSpeed, Math.max(motion.speed, 1)), airborne);
      if (newBeat) motion.bodyPitch.velocity -= 1.1 * flap;
    }
    // Camera track: a critically damped follow at about 1 Hz.
    const trackOmega = 2 * Math.PI * 0.9;
    const trackAcceleration = trackOmega * trackOmega * (this.altitude - this.trackAltitude) - 2 * trackOmega * this.trackSpeed;
    this.trackSpeed += trackAcceleration * STEP_SECONDS;
    this.trackAltitude += this.trackSpeed * STEP_SECONDS;
  }

  /** In the air the legs fold but hang on soft springs, and every downstroke shakes them and the antennae. */
  looseLimbs(airborne, flap, newBeat) {
    const motion = this.motion;
    const softness = 1 - 0.6 * airborne;
    motion.legs.forEach((leg, legIndex) => {
      const tuck = airborne;
      const trailing = leg.pair === 3 ? -18 * DEGREE : leg.pair === 1 ? 12 * DEGREE : 0;
      leg.coxaLift.setFrequency(mix(34, 6, airborne));
      leg.coxaSwing.setFrequency(mix(34, 5, airborne));
      leg.femurLift.setFrequency(14 * softness);
      leg.tibiaFlex.setFrequency(16 * softness);
      leg.tarsusFlex.setFrequency(20 * softness);
      leg.coxaLift.target = mix(leg.coxaLift.target, 30 * DEGREE, tuck);
      leg.coxaSwing.target = mix(leg.coxaSwing.target, trailing, tuck);
      leg.femurLift.target = mix(leg.femurLift.target, 12 * DEGREE, tuck);
      leg.tibiaFlex.target = mix(leg.tibiaFlex.target, 40 * DEGREE, tuck);
      leg.tarsusFlex.target = mix(leg.tarsusFlex.target, 16 * DEGREE, tuck);
      if (newBeat) {
        const shake = Math.sin(legIndex * 1.7 + this.beatCount * 0.9) * flap;
        leg.coxaLift.velocity += 1.6 * shake;
        leg.tibiaFlex.velocity += 3.2 * Math.cos(legIndex * 2.3 + this.beatCount * 1.3) * flap;
      }
    });
    for (const [side, antenna] of Object.entries(motion.antennae)) {
      const sideSign = side === 'L' ? 1 : -1;
      antenna.baseYaw.target = mix(antenna.baseYaw.target, sideSign * 8 * DEGREE, airborne);
      antenna.basePitch.target = mix(antenna.basePitch.target, 10 * DEGREE, airborne);
      if (newBeat) {
        antenna.basePitch.velocity += (this.random() - 0.5) * 1.4 * flap;
        antenna.baseYaw.velocity += (this.random() - 0.5) * 1.0 * flap;
      }
    }
  }

  /** Beat angle now: a downstroke faster than the upstroke, as in flapping insects. */
  beatAngle(lag) {
    const cycle = (this.beatPhase - lag) - Math.floor(this.beatPhase - lag);
    return cycle < DOWNSTROKE_SHARE
      ? Math.cos(Math.PI * cycle / DOWNSTROKE_SHARE)
      : -Math.cos(Math.PI * (cycle - DOWNSTROKE_SHARE) / (1 - DOWNSTROKE_SHARE));
  }

  apply(driver) {
    const motion = this.motion;
    const flap = motion.flight.flap;
    for (const side of ['L', 'R']) {
      const sideSign = side === 'L' ? 1 : -1;
      this.poseWing(driver, `wing_${side}_fore`, sideSign, motion.foreWingOpen.angle, FORE_WING, flap);
      this.poseWing(driver, `wing_${side}_hind`, sideSign, motion.hindWingOpen.angle, HIND_WING, flap);
      const unfold = 1 + (HIND_UNFOLD_WIDTH - 1) * Math.max(0, motion.hindWingOpen.angle);
      driver.scale(`wing_${side}_hind`, unfold, 1, 1);
    }
    for (const { membrane } of this.membranes) membrane.apply();
  }

  poseWing(driver, name, sideSign, open, pose, flap) {
    if (!driver.has(name) || open <= 0.001) return;
    // Order matters: each rotation is applied outside the ones before it.
    driver.rotate(name, ACROSS, pose.elevation * open);
    driver.rotate(name, UP, -sideSign * pose.spread * open);
    // The stroke swings about a raised centre, so the downstroke ends level with the body, not under it.
    const stroke = pose.strokeCentre * open + pose.beat * flap * this.beatAngle(pose.beatLag);
    driver.rotate(name, ALONG, sideSign * stroke);
  }
}

function smoothstep(value) {
  const clamped = Math.min(Math.max(value, 0), 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function mix(from, to, amount) {
  return from + (to - from) * amount;
}
