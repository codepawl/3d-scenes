import * as THREE from 'three';

// Each preset relights the whole scene. Colours are sRGB hex; numbers interpolate linearly.
export const PRESETS = {
  afternoon: {
    label: 'Afternoon',
    sunElevation: 58,
    sunAzimuth: 162,
    sunColor: '#fff3df',
    sunIntensity: 3.1,
    skyZenith: '#4f8bd6',
    skyHorizon: '#c7dcec',
    skyGlow: '#f4ead8',
    skyGround: '#4c5a33',
    sunGlow: 0.55,
    sunDisc: 22,
    clouds: 0.55,
    stars: 0,
    moon: 0,
    fogColor: '#c6d6dc',
    fogDensity: 0.0055,
    environment: 0.85,
    exposure: 0.95,
    shadowStrength: 1.0,
    windowGlow: 0.0,
    lampGlow: 0.0,
    cabinLight: 0.0,
    sparkle: 1.0,
    waterScatter: '#27a08c',
    waterAbsorb: [2.1, 0.52, 0.5],
    caustics: 1.0,
    fireflies: 0.0,
    bloomStrength: 0.4,
    grassTint: '#ffffff',
    contrast: 1.04,
    warmth: 0.0,
    saturation: 1.12,
  },
  golden: {
    label: 'Golden',
    sunElevation: 9,
    sunAzimuth: 158,
    sunColor: '#ffb066',
    sunIntensity: 3.0,
    skyZenith: '#6d8fbf',
    skyHorizon: '#f2c99a',
    skyGlow: '#ffae6b',
    skyGround: '#4a4428',
    sunGlow: 1.2,
    sunDisc: 18,
    clouds: 0.5,
    stars: 0,
    moon: 0,
    fogColor: '#e8c49c',
    fogDensity: 0.0075,
    environment: 0.7,
    exposure: 1.05,
    shadowStrength: 1.0,
    windowGlow: 0.8,
    lampGlow: 0.4,
    cabinLight: 0.4,
    sparkle: 1.35,
    waterScatter: '#2f8a6c',
    waterAbsorb: [2.1, 0.7, 0.62],
    caustics: 0.8,
    fireflies: 0.0,
    bloomStrength: 0.55,
    grassTint: '#ffe2b8',
    contrast: 1.06,
    warmth: 0.06,
    saturation: 1.1,
  },
  blue: {
    label: 'Blue',
    sunElevation: 58,
    sunAzimuth: 210,
    sunColor: '#8fa9ff',
    sunIntensity: 0.4,
    skyZenith: '#1d3a73',
    skyHorizon: '#7c95c4',
    skyGlow: '#c7a4b8',
    skyGround: '#1b2430',
    sunGlow: 0.0,
    sunDisc: 0,
    clouds: 0.25,
    stars: 0.15,
    moon: 0,
    fogColor: '#5d7299',
    fogDensity: 0.009,
    environment: 0.9,
    exposure: 1.55,
    shadowStrength: 0.55,
    windowGlow: 3.2,
    lampGlow: 5,
    cabinLight: 2.2,
    sparkle: 0.8,
    waterScatter: '#2b6f86',
    waterAbsorb: [2.6, 0.8, 0.5],
    caustics: 0.0,
    fireflies: 0.45,
    bloomStrength: 0.6,
    grassTint: '#b9cdf0',
    contrast: 1.04,
    warmth: -0.04,
    saturation: 1.05,
  },
  night: {
    label: 'Night',
    sunElevation: 52,
    sunAzimuth: 205,
    sunColor: '#9db8ff',
    sunIntensity: 0.75,
    skyZenith: '#060c1c',
    skyHorizon: '#1d2c4c',
    skyGlow: '#2b3a5c',
    skyGround: '#080b10',
    sunGlow: 0.25,
    sunDisc: 0,
    clouds: 0.15,
    stars: 1.0,
    moon: 1.0,
    fogColor: '#162238',
    fogDensity: 0.01,
    environment: 1.3,
    exposure: 2.4,
    shadowStrength: 0.85,
    windowGlow: 4.5,
    lampGlow: 7,
    cabinLight: 3.5,
    sparkle: 0.75,
    waterScatter: '#1d4f6e',
    waterAbsorb: [2.8, 0.9, 0.55],
    caustics: 0.0,
    fireflies: 1.0,
    bloomStrength: 0.45,
    grassTint: '#93a9d6',
    contrast: 1.05,
    warmth: -0.02,
    saturation: 1,
  },
};

export const PRESET_ORDER = ['afternoon', 'golden', 'blue', 'night'];

const COLOR_KEYS = [
  'sunColor', 'skyZenith', 'skyHorizon', 'skyGlow', 'skyGround', 'fogColor', 'waterScatter', 'grassTint',
];

// Converts a preset into linear colours and vectors once, so blending is cheap per frame.
function resolve(preset) {
  const state = { ...preset };
  for (const key of COLOR_KEYS) {
    state[key] = new THREE.Color(preset[key]);
  }
  state.waterAbsorb = new THREE.Vector3(...preset.waterAbsorb);
  return state;
}

const RESOLVED = Object.fromEntries(Object.entries(PRESETS).map(([name, preset]) => [name, resolve(preset)]));

export function createLightingState(name = 'afternoon') {
  const state = resolve(PRESETS[name]);
  state.sunDirection = new THREE.Vector3();
  updateSunDirection(state);
  return state;
}

// Deep copy of a lighting state, used as the start point of a transition.
export function cloneLighting(state) {
  const copy = {};
  for (const [key, value] of Object.entries(state)) {
    copy[key] = value && typeof value.clone === 'function' ? value.clone() : value;
  }
  return copy;
}

export function resolvedPreset(name) {
  return RESOLVED[name];
}

export function blendLighting(target, from, to, amount) {
  const t = THREE.MathUtils.smootherstep(amount, 0, 1);
  for (const key of Object.keys(to)) {
    const start = from[key];
    const end = to[key];
    if (typeof end === 'number') {
      target[key] = start + (end - start) * t;
    } else if (end && end.isColor) {
      target[key].copy(start).lerp(end, t);
    } else if (end && end.isVector3) {
      target[key].copy(start).lerp(end, t);
    }
  }
  updateSunDirection(target);
  return target;
}

function updateSunDirection(state) {
  const elevation = THREE.MathUtils.degToRad(state.sunElevation);
  const azimuth = THREE.MathUtils.degToRad(state.sunAzimuth);
  // Azimuth 180 points up the creek (toward -z); larger values swing to the right (+x).
  state.sunDirection.set(
    -Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  ).normalize();
}
