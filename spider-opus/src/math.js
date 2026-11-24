// Small numeric helpers shared by the walker, the effects and the cameras.

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

export function smoothstep(edgeStart, edgeEnd, value) {
  const amount = clamp((value - edgeStart) / (edgeEnd - edgeStart), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

export function moveToward(current, goal, maximumChange) {
  if (Math.abs(goal - current) <= maximumChange) {
    return goal;
  }
  return current + Math.sign(goal - current) * maximumChange;
}

export function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

// Repeatable pseudo-noise in [0, 1) for a given number, so idle jitter replays identically.
export function hashNoise(value) {
  const scaled = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return scaled - Math.floor(scaled);
}

// Seeded generator (mulberry32): every run of the page produces the same particles.
export function createRandom(seed) {
  let state = seed >>> 0;
  return function nextRandom() {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSpring(value = 0) {
  return { value, velocity: 0 };
}

// Damped spring integrated with semi-implicit Euler; stable at the 1/60 s fixed step.
export function stepSpring(spring, goal, stiffness, damping, deltaSeconds) {
  const acceleration = (goal - spring.value) * stiffness - spring.velocity * damping;
  spring.velocity += acceleration * deltaSeconds;
  spring.value += spring.velocity * deltaSeconds;
}

// Constant speed with short ramps at both ends, like a geared motor rather than a muscle.
export function servoEase(amount) {
  const ramp = 0.22;
  const cruiseSpan = 1 - ramp;
  if (amount <= 0) {
    return 0;
  }
  if (amount >= 1) {
    return 1;
  }
  if (amount < ramp) {
    return (amount * amount) / (2 * ramp * cruiseSpan);
  }
  if (amount > 1 - ramp) {
    const remaining = 1 - amount;
    return 1 - (remaining * remaining) / (2 * ramp * cruiseSpan);
  }
  return (amount - ramp / 2) / cruiseSpan;
}
