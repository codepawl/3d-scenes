import * as THREE from 'three';
import { noiseGlsl, skyFunctionGlsl, skyUniformsGlsl } from './glsl.js';

// Uniforms shared by the sky dome, the environment capture and the water reflections.
export function createSkyUniforms() {
  return {
    uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uSkyZenith: { value: new THREE.Color() },
    uSkyHorizon: { value: new THREE.Color() },
    uSkyGround: { value: new THREE.Color() },
    uSkyGlow: { value: new THREE.Color() },
    uSunGlow: { value: 0 },
    uSunDisc: { value: 0 },
    uStars: { value: 0 },
    uMoon: { value: 0 },
    uClouds: { value: 0 },
    uSkyTime: { value: 0 },
  };
}

export function applyLightingToSky(uniforms, lighting) {
  uniforms.uSunDirection.value.copy(lighting.sunDirection);
  uniforms.uSunColor.value.copy(lighting.sunColor);
  uniforms.uSkyZenith.value.copy(lighting.skyZenith);
  uniforms.uSkyHorizon.value.copy(lighting.skyHorizon);
  uniforms.uSkyGround.value.copy(lighting.skyGround);
  uniforms.uSkyGlow.value.copy(lighting.skyGlow);
  uniforms.uSunGlow.value = lighting.sunGlow;
  uniforms.uSunDisc.value = lighting.sunDisc;
  uniforms.uStars.value = lighting.stars;
  uniforms.uMoon.value = lighting.moon;
  uniforms.uClouds.value = lighting.clouds;
}

function createSkyMaterial(uniforms, detailed) {
  return new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${skyUniformsGlsl}
      ${noiseGlsl}
      ${skyFunctionGlsl}
      varying vec3 vDirection;
      void main() {
        gl_FragColor = vec4(creekSky(vDirection, ${detailed ? 'true' : 'false'}), 1.0);
      }
    `,
  });
}

export class Sky {
  constructor(renderer, uniforms) {
    this.renderer = renderer;
    this.uniforms = uniforms;
    const geometry = new THREE.SphereGeometry(1, 48, 24);
    this.mesh = new THREE.Mesh(geometry, createSkyMaterial(uniforms, true));
    this.mesh.scale.setScalar(900);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;

    this.captureScene = new THREE.Scene();
    const captureMesh = new THREE.Mesh(geometry, createSkyMaterial(uniforms, false));
    captureMesh.scale.setScalar(50);
    this.captureScene.add(captureMesh);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.environment = null;
  }

  follow(camera) {
    this.mesh.position.copy(camera.position);
  }

  // Re-captures the sky into a prefiltered environment map for image-based lighting.
  updateEnvironment() {
    const target = this.pmrem.fromScene(this.captureScene, 0, 0.1, 200);
    if (this.environment) {
      this.environment.dispose();
    }
    this.environment = target;
    return target.texture;
  }
}
