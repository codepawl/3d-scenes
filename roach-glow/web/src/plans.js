// Movement plans: speed (rig units per film second) and how bipedal the run is, as functions of film time.
// The film runs slowed down: real roach strides are too fast to read at 30 fps, so speeds here are film speeds.

function smoothstep(from, to, value) {
  const amount = Math.min(Math.max((value - from) / (to - from), 0), 1);
  return amount * amount * (3 - 2 * amount);
}

const WALK_SPEED = 9;
const SPRINT_SPEED = 20;
const DEGREE = Math.PI / 180;
const TAKEOFF_TIME = 2.0;
// Rig units: the body is about 5.3 long, so the climb levels off a little over one body length up.
const FLIGHT_ALTITUDE = 7;
const FLIGHT_SPEED = 11;
// Rig units along the path where the crevice begins; the body reaches it a little after 2.5 s at this speed.
export const SLAB_START = 12;
const SQUEEZE_SPEED = 6;
const HEAD_DETACH_TIME = 1.6;
const HEADLESS_WALK_SPEED = 4;
const APPROACH_SPEED = 9;

export const PLANS = {
  idle: () => ({ speed: 0, bipedal: 0 }),
  // The ending: walks out of the dark toward the lens and stops right in front of it.
  approach: (time) => ({
    speed: APPROACH_SPEED * (smoothstep(0.3, 0.8, time) - smoothstep(1.7, 2.3, time)),
    bipedal: 0,
  }),
  // Stands idle; the flash, the flip onto its back and the beetle are scripted in story-scenes.js.
  radiation: () => ({ speed: 0, bipedal: 0 }),
  // Rest, start walking, hold a steady tripod walk, then speed up until it runs on two legs.
  walk: (time) => {
    const walking = smoothstep(1.0, 1.6, time);
    const sprinting = smoothstep(5.0, 6.4, time);
    return {
      speed: WALK_SPEED * walking + (SPRINT_SPEED - WALK_SPEED) * sprinting,
      bipedal: smoothstep(5.4, 6.6, time),
    };
  },
  // Walk up to a low slab and crawl under it flattened (the crevice is built in story-scenes.js at the same spot).
  squeeze: (time) => ({
    speed: SQUEEZE_SPEED * smoothstep(0.8, 1.4, time),
    bipedal: 0,
    slabStart: SLAB_START,
  }),
  // Standing still, the head comes off and lands on the floor; the body stands, then walks away from it.
  headless: (time) => ({
    speed: HEADLESS_WALK_SPEED * smoothstep(3.4, 4.0, time),
    bipedal: 0,
    headDetachAt: HEAD_DETACH_TIME,
  }),
  // Rest, crouch, open the wings and start beating, push off, climb away nose-up, then cruise level.
  fly: (time) => {
    return {
      speed: FLIGHT_SPEED * smoothstep(TAKEOFF_TIME, TAKEOFF_TIME + 1.2, time),
      bipedal: 0,
      crouch: smoothstep(1.0, 1.4, time) - smoothstep(1.85, 2.05, time),
      wingsOpen: smoothstep(1.2, 1.8, time),
      flap: smoothstep(1.65, 1.95, time),
      airborne: smoothstep(TAKEOFF_TIME, TAKEOFF_TIME + 0.4, time),
      // The height the wings aim for; the actual altitude comes from the flight physics (flight.js).
      cruiseAltitude: FLIGHT_ALTITUDE * smoothstep(TAKEOFF_TIME, TAKEOFF_TIME + 2.5, time),
      pitch: (5 + 9 * (1 - smoothstep(3.2, 5.2, time))) * DEGREE,
    };
  },
};
