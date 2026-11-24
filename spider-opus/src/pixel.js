// Pixel mode: render the scene small, then blow it up with nearest-neighbour sampling, a gentle grade
// and a posterized palette, so the frame reads as pixel art even when shrunk onto a phone.
import * as THREE from "three";

// About this many pixels across the short side of the screen.
const PIXEL_ROWS = 150;
const COLOR_LEVELS = 8;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D sceneTexture;
  uniform vec2 lowResolution;
  uniform float colorLevels;
  varying vec2 vUv;

  void main() {
    vec2 cell = floor(vUv * lowResolution);
    gl_FragColor = texture2D(sceneTexture, (cell + 0.5) / lowResolution);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // Lift the shadows a touch so the dark scene keeps more than two palette steps.
    vec3 graded = pow(clamp(gl_FragColor.rgb, 0.0, 1.0), vec3(0.88)) * 1.05;
    // Flat posterized bands, no dither: dithering turned the dark wall into a checkerboard.
    vec3 quantized = floor(graded * (colorLevels - 1.0) + 0.5) / (colorLevels - 1.0);
    gl_FragColor = vec4(clamp(quantized, 0.0, 1.0), 1.0);
  }
`;

export function createPixelRenderer(renderer) {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    type: THREE.HalfFloatType,
    depthBuffer: true,
  });
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      sceneTexture: { value: target.texture },
      lowResolution: { value: new THREE.Vector2(1, 1) },
      colorLevels: { value: COLOR_LEVELS },
    },
    depthTest: false,
    depthWrite: false,
  });
  const screenQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  screenQuad.frustumCulled = false;
  const screenScene = new THREE.Scene();
  screenScene.add(screenQuad);
  const screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  return {
    // Width and height in drawing-buffer pixels; each art pixel covers a whole number of them.
    setSize(width, height) {
      const scale = Math.max(2, Math.round(Math.min(width, height) / PIXEL_ROWS));
      const lowWidth = Math.ceil(width / scale);
      const lowHeight = Math.ceil(height / scale);
      target.setSize(lowWidth, lowHeight);
      material.uniforms.lowResolution.value.set(lowWidth, lowHeight);
    },

    render(scene, camera) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(screenScene, screenCamera);
    },
  };
}
