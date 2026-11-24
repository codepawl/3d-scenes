// Image pipeline: HDRI environment, a water-free colour+depth pass for the screen-space reflections, then
// scene render, GTAO, ACES tone map and a gentle split-tone grade.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Loads a Poly Haven HDRI, bakes it for image-based light and reflection, and finds where its sun is.
export async function loadEnvironment(renderer, url) {
  const loader = new RGBELoader();
  loader.setDataType(THREE.FloatType);
  const texture = await loader.loadAsync(url);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  const { data, width, height } = texture.image;
  let best = 0;
  let bestIndex = 0;
  for (let index = 0; index < width * height; index += 1) {
    const luminance = data[index * 4] + data[index * 4 + 1] + data[index * 4 + 2];
    if (luminance > best) { best = luminance; bestIndex = index; }
  }
  const column = bestIndex % width;
  const row = Math.floor(bestIndex / width);
  const generator = new THREE.PMREMGenerator(renderer);
  const environment = generator.fromEquirectangular(texture).texture;
  generator.dispose();
  texture.dispose();
  const sunAzimuth = (column / width - 0.5) * Math.PI * 2;
  const sunElevation = Math.abs(0.5 - row / height) * Math.PI;
  return { environment, sunAzimuth, sunElevation };
}

const GRADE_SHADER = {
  uniforms: { tDiffuse: { value: null }, uStrength: { value: 1.0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uStrength; varying vec2 vUv;
    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      vec3 color = source.rgb;
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, 1.1);
      vec3 shadowTint = vec3(0.95, 1.0, 1.06);
      vec3 highlightTint = vec3(1.045, 1.0, 0.93);
      color *= mix(shadowTint, highlightTint, smoothstep(0.15, 0.75, luma));
      color = mix(color, color * color * (3.0 - 2.0 * color), 0.22);
      vec2 centred = vUv - 0.5;
      color *= 1.0 - 0.18 * smoothstep(0.35, 0.85, length(centred * vec2(1.0, 1.15)));
      gl_FragColor = vec4(mix(source.rgb, color, uStrength), source.a);
    }`,
};

export function createPipeline(renderer, scene, camera, hiddenFromAo, hiddenFromReflection) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const reflectionTarget = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
  reflectionTarget.depthTexture = new THREE.DepthTexture(size.x, size.y);

  const composerTarget = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, composerTarget);
  composer.setPixelRatio(1);
  composer.setSize(size.x, size.y);
  composer.addPass(new RenderPass(scene, camera));
  const occlusion = new GTAOPass(scene, camera, size.x, size.y);
  occlusion.output = GTAOPass.OUTPUT.Default;
  occlusion.updateGtaoMaterial({ radius: 2.4, distanceExponent: 1.4, thickness: 2.2, scale: 1.35, samples: 16, distanceFallOff: 1.0 });
  occlusion.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 16 });
  occlusion.blendIntensity = 0.85;
  const renderNormals = occlusion._renderOverride.bind(occlusion);
  occlusion._renderOverride = (...args) => {
    hiddenFromAo.forEach((object) => { object.visible = false; });
    renderNormals(...args);
    hiddenFromAo.forEach((object) => { object.visible = true; });
  };
  composer.addPass(occlusion);
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass(GRADE_SHADER));

  return {
    reflectionTarget,
    resize(width, height) {
      reflectionTarget.setSize(width, height);
      composer.setSize(width, height);
    },
    render(uniforms) {
      hiddenFromReflection.forEach((object) => { object.visible = false; });
      renderer.setRenderTarget(reflectionTarget);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      hiddenFromReflection.forEach((object) => { object.visible = true; });
      uniforms.uSceneColor.value = reflectionTarget.texture;
      uniforms.uSceneDepth.value = reflectionTarget.depthTexture;
      uniforms.uProj.value.copy(camera.projectionMatrix);
      uniforms.uNearFar.value.set(camera.near, camera.far);
      composer.render();
    },
  };
}
