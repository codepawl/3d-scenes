// Joint physics: every animated joint angle is a damped spring chasing a target, so motion overshoots and
// settles instead of gliding. Joints can sit in chains: a child feels its parent's angular acceleration
// (inertia), so light outer segments lag and whip after a heavy inner one turns.
// Stepped at a fixed rate from time 0, so the pose at any time is the same however it is reached.

export const STEP_SECONDS = 1 / 480;

export class SpringJoint {
  /**
   * frequency: natural frequency in Hz (stiffness); dampingRatio: below 1 overshoots;
   * parent: the joint this one hangs from; inertia: how much of the parent's acceleration it resists (0..1).
   */
  constructor({ frequency, dampingRatio, parent = null, inertia = 0, rest = 0 }) {
    this.omega = 2 * Math.PI * frequency;
    this.dampingRatio = dampingRatio;
    this.parent = parent;
    this.inertia = inertia;
    this.rest = rest;
    this.target = rest;
    this.reset();
  }

  /** Change stiffness on the fly, e.g. a hip that tracks a fast gait but rests softly. */
  setFrequency(frequency) {
    this.omega = 2 * Math.PI * frequency;
  }

  reset() {
    this.angle = this.rest;
    this.velocity = 0;
    this.acceleration = 0;
    this.target = this.rest;
  }

  /** Absolute angular acceleration down the chain (this joint plus every parent). */
  get chainAcceleration() {
    return this.acceleration + (this.parent ? this.parent.chainAcceleration : 0);
  }

  step(seconds) {
    const springForce = this.omega * this.omega * (this.target - this.angle);
    const dampingForce = 2 * this.dampingRatio * this.omega * this.velocity;
    const inheritedForce = this.parent ? -this.inertia * this.parent.chainAcceleration : 0;
    this.acceleration = springForce - dampingForce + inheritedForce;
    this.velocity += this.acceleration * seconds;
    this.angle += this.velocity * seconds;
  }
}

export class JointSystem {
  constructor() {
    this.joints = [];
    this.time = 0;
  }

  add(options) {
    const joint = new SpringJoint(options);
    this.joints.push(joint);
    return joint;
  }

  reset() {
    for (const joint of this.joints) joint.reset();
    this.time = 0;
  }

  /**
   * Advance to a time. setTargets(time) is called before each step. Going back in time restarts from 0,
   * so a frame always gets the same pose.
   */
  advanceTo(time, setTargets) {
    if (time < this.time - 1e-9) this.reset();
    // Parents step before children because they were added first, so children read this step's acceleration.
    while (this.time + STEP_SECONDS <= time + 1e-9) {
      this.time += STEP_SECONDS;
      setTargets(this.time);
      for (const joint of this.joints) joint.step(STEP_SECONDS);
    }
  }
}

// Seeded random numbers and an event schedule of targets that jump (dart) and then hold.
export function seededRandom(seed) {
  let state = (Math.floor(seed * 9973) ^ 0x9e3779b9) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Times and values of darts: gaps between minGap and maxGap seconds, values from pick(random). */
export function dartSchedule(seed, duration, minGap, maxGap, pick) {
  const random = seededRandom(seed);
  const events = [{ time: 0, value: pick(random) }];
  let time = minGap * random();
  while (time < duration) {
    time += minGap + (maxGap - minGap) * random();
    events.push({ time, value: pick(random) });
  }
  return events;
}

/** Value of the last event at or before time (a held target). */
export function heldValue(events, time) {
  let low = 0;
  let high = events.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (events[middle].time <= time) low = middle;
    else high = middle - 1;
  }
  return events[low].value;
}
