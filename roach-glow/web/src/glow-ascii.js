// Glow ASCII pass: the lit scene and a view-normal pass are rendered small (3x3 texels per character cell), then
// one full-screen shader picks a glyph per cell and colours it from a gradient by light plus rim. Empty cells get
// a faint ordered dither haze. The result goes through bloom so bright glyphs glow.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { TexturePass } from 'three/addons/postprocessing/TexturePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const FONT_FAMILY = 'AsciiMono';
// Atlas order: 0-9 brightness ramp, 10-13 edge glyphs (| / - \).
const ATLAS_GLYPHS = [' ', '.', ':', '-', '=', '+', '*', '#', '%', '@', '|', '/', '-', '\\'];
const ATLAS_CELL_WIDTH = 32;
const ATLAS_CELL_HEIGHT = 56;
const TEXELS_PER_CELL = 3;

// Gradient stops from dark to bright, in linear colour.
export const DEFAULT_PALETTE = ['#1a0638', '#5b12a0', '#d81b7a', '#ff8a3d', '#ffe9c4'];

function buildGlyphAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_CELL_WIDTH * ATLAS_GLYPHS.length;
  canvas.height = ATLAS_CELL_HEIGHT;
  const context = canvas.getContext('2d');
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#fff';
  context.font = `700 50px ${FONT_FAMILY}, Consolas, monospace`;
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  ATLAS_GLYPHS.forEach((glyph, index) => {
    context.fillText(glyph, index * ATLAS_CELL_WIDTH + ATLAS_CELL_WIDTH / 2, 42);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform sampler2D tAtlas;
uniform vec2 uScreen;
uniform vec2 uCell;
uniform vec2 uGrid;
uniform vec2 uTexelPx;
uniform float uNear;
uniform float uFar;
uniform float uExposure;
uniform float uRim;
uniform float uEdgeDepth;
uniform float uEdgeNormal;
uniform float uHaze;
uniform float uSweep;
uniform float uFloorGlow;
uniform float uFloorCutoff;
uniform vec3 uPalette[5];
varying vec2 vUv;

float linearDepth(vec2 uv) {
  float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}
vec3 normalAt(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }
float normalField(vec3 n) { return n.x + 1.3 * n.y + 0.7 * n.z; }

vec3 gradient(float t) {
  float scaled = clamp(t, 0.0, 1.0) * 4.0;
  float index = floor(min(scaled, 3.999));
  float blend = scaled - index;
  vec3 low = uPalette[0];
  vec3 high = uPalette[1];
  if (index > 2.5) { low = uPalette[3]; high = uPalette[4]; }
  else if (index > 1.5) { low = uPalette[2]; high = uPalette[3]; }
  else if (index > 0.5) { low = uPalette[1]; high = uPalette[2]; }
  return mix(low, high, blend);
}

// Ordered dither threshold: the 2x2 Bayer step applied twice gives the 4x4 matrix.
float bayer2(vec2 pixel) {
  pixel = floor(pixel);
  return fract(dot(pixel, vec2(0.5, pixel.y * 0.75)));
}
float bayer4(vec2 pixel) { return bayer2(0.5 * pixel) * 0.25 + bayer2(pixel); }

void main() {
  vec2 pixelTop = vec2(gl_FragCoord.x, uScreen.y - gl_FragCoord.y);
  vec2 cell = floor(pixelTop / uCell);
  vec2 cellUv = uCell / uScreen;
  vec2 centerUv = vec2((cell.x + 0.5) * cellUv.x, 1.0 - (cell.y + 0.5) * cellUv.y);
  vec2 inCell = pixelTop / uCell - cell;
  vec2 texelStep = cellUv / 3.0;
  vec2 screenUv = gl_FragCoord.xy / uScreen;

  // Background haze: a soft radial glow drawn as 2 px ordered dither dots in the darkest gradient colours.
  float radial = 1.0 - smoothstep(0.1, 0.85, length((screenUv - vec2(0.5, 0.45)) * vec2(uScreen.x / uScreen.y, 1.0)));
  float hazeLevel = uHaze * radial;
  float hazeDot = step(bayer4(gl_FragCoord.xy / 2.0), hazeLevel);
  vec3 background = mix(uPalette[0], uPalette[1], 0.35) * hazeDot * 0.55;

  if (cell.x >= uGrid.x || cell.y >= uGrid.y) { gl_FragColor = vec4(background, 1.0); return; }

  vec3 sum = vec3(0.0);
  vec3 peak = vec3(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec3 sampleColor = texture2D(tScene, centerUv + vec2(float(i), float(j)) * texelStep).rgb;
      sum += sampleColor;
      peak = max(peak, sampleColor);
    }
  }
  vec3 color = mix(sum / 9.0, peak, 0.35) * uExposure;
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));

  float depthCenter = linearDepth(centerUv);
  bool onSurface = depthCenter < uFar * 0.95;
  if (!onSurface) { gl_FragColor = vec4(background, 1.0); return; }

  float depthLeft = linearDepth(centerUv - vec2(texelStep.x, 0.0));
  float depthRight = linearDepth(centerUv + vec2(texelStep.x, 0.0));
  float depthUp = linearDepth(centerUv + vec2(0.0, texelStep.y));
  float depthDown = linearDepth(centerUv - vec2(0.0, texelStep.y));
  float depthEdge = max(abs(depthLeft + depthRight - 2.0 * depthCenter), abs(depthUp + depthDown - 2.0 * depthCenter)) / depthCenter;
  vec2 depthGradient = vec2(depthRight - depthLeft, depthUp - depthDown) / depthCenter;

  vec3 normalCenter = normalAt(centerUv);
  vec3 normalLeft = normalAt(centerUv - vec2(texelStep.x, 0.0));
  vec3 normalRight = normalAt(centerUv + vec2(texelStep.x, 0.0));
  vec3 normalUp = normalAt(centerUv + vec2(0.0, texelStep.y));
  vec3 normalDown = normalAt(centerUv - vec2(0.0, texelStep.y));
  float normalEdge = max(length(normalRight - normalLeft), length(normalUp - normalDown));
  vec2 normalGradient = vec2(normalField(normalRight) - normalField(normalLeft), normalField(normalUp) - normalField(normalDown));

  // The floor is tagged with alpha below 0.5 in the normal pass. It stays sparse: dots and colons that thicken
  // only where light falls, darker colours, no outline glyphs, so it never carpets the frame.
  if (texture2D(tNormal, centerUv).a < 0.5) {
    float floorLight = clamp(pow(luma, 0.8) * 1.1, 0.0, 1.0);
    if (floorLight < uFloorCutoff) { gl_FragColor = vec4(background, 1.0); return; }
    // uFloorGlow above 1 lets strongly lit floor (a flashlight pool) climb past the sparse '=' to denser glyphs.
    float lit = floorLight * uFloorGlow;
    float floorGlyph = lit < 0.2 ? 1.0 : (lit < 0.38 ? 2.0 : (lit < 0.6 ? 3.0 : 4.0));
    if (uFloorGlow > 1.0 && lit >= 0.8) floorGlyph = lit < 1.0 ? 5.0 : (lit < 1.25 ? 6.0 : 7.0);
    float floorCoverage = texture2D(tAtlas, vec2((floorGlyph + inCell.x) / 14.0, 1.0 - inCell.y)).r;
    float floorSweep = clamp(dot(screenUv, vec2(0.55, 0.45)), 0.0, 1.0);
    vec3 floorColour = gradient(clamp(0.12 + 0.45 * mix(lit, floorSweep, uSweep * 0.6), 0.0, 1.0)) * (0.25 + 0.7 * clamp(lit, 0.0, 1.3));
    gl_FragColor = vec4(max(background, floorColour * floorCoverage), 1.0);
    return;
  }

  // Rim: surfaces turned away from the camera glow brighter, which outlines the body.
  float rim = pow(1.0 - clamp(abs(normalCenter.z), 0.0, 1.0), 2.0);
  float brightness = clamp(pow(luma, 0.55) * 1.05 + rim * uRim, 0.0, 1.0);

  float depthScore = depthEdge / uEdgeDepth;
  float normalScore = normalEdge / uEdgeNormal;
  bool isEdge = max(depthScore, normalScore) > 1.0;
  float glyphIndex;
  if (isEdge) {
    vec2 slope = (depthScore >= normalScore ? depthGradient : normalGradient) / (2.0 * uTexelPx);
    vec2 along = vec2(-slope.y, slope.x);
    float angle = atan(along.y, along.x);
    if (angle < 0.0) angle += 3.14159265;
    float turn = angle / 3.14159265 * 8.0;
    if (turn < 1.0 || turn >= 7.0) glyphIndex = 12.0;
    else if (turn < 3.0) glyphIndex = 11.0;
    else if (turn < 5.0) glyphIndex = 10.0;
    else glyphIndex = 13.0;
    brightness = max(brightness, 0.6);
  } else {
    // Every surface cell carries at least a colon, so the body reads as a filled shape, not only an outline.
    brightness = max(brightness, 0.14);
    glyphIndex = 2.0 + floor(clamp(brightness, 0.0, 0.999) * 8.0);
  }

  vec2 atlasUv = vec2((glyphIndex + inCell.x) / 14.0, 1.0 - inCell.y);
  float coverage = texture2D(tAtlas, atlasUv).r;
  // Colour position mixes light with a diagonal sweep across the frame (uSweep 0 = light only). Surfaces start
  // above the darkest stop, which is kept for the haze; glyph size still follows light alone.
  float sweep = clamp(dot(screenUv, vec2(0.55, 0.45)), 0.0, 1.0);
  float colourPosition = mix(brightness, sweep * 0.85 + brightness * 0.3, uSweep);
  vec3 glyphColor = gradient(0.18 + 0.82 * colourPosition) * (0.5 + 1.0 * brightness);
  vec3 outColor = max(background * 0.4, glyphColor * coverage);
  gl_FragColor = vec4(outColor, 1.0);
}
`;

function paletteVectors(hexColors) {
  return hexColors.map((hex) => {
    const color = new THREE.Color(hex);
    return new THREE.Vector3(color.r, color.g, color.b);
  });
}

export class GlowAsciiPass {
  constructor(renderer, options = {}) {
    this.renderer = renderer;
    this.raw = false;
    this.atlas = buildGlyphAtlas();
    this.grid = new THREE.Vector2(1, 1);
    // Double-sided: thin parts like the wings are seen from both faces.
    this.normalMaterial = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
    // The floor's normal pass writes alpha 0.25 so the glyph shader can tell floor from creature.
    this.floorNormalMaterial = new THREE.ShaderMaterial({
      vertexShader: 'varying vec3 vNormal; void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec3 vNormal; void main() { gl_FragColor = vec4(normalize(vNormal) * 0.5 + 0.5, 0.25); }',
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        tScene: { value: null },
        tNormal: { value: null },
        tDepth: { value: null },
        tAtlas: { value: this.atlas },
        uScreen: { value: new THREE.Vector2(1, 1) },
        uCell: { value: new THREE.Vector2(8, 14) },
        uGrid: { value: this.grid },
        uTexelPx: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.01 },
        uFar: { value: 100 },
        uExposure: { value: options.exposure ?? 2.0 },
        uRim: { value: options.rim ?? 0.6 },
        uEdgeDepth: { value: options.edgeDepth ?? 0.08 },
        uEdgeNormal: { value: options.edgeNormal ?? 1.35 },
        uHaze: { value: options.haze ?? 0.16 },
        uSweep: { value: options.sweep ?? 0 },
        uFloorGlow: { value: options.floorGlow ?? 1 },
        uFloorCutoff: { value: 0.08 },
        uPalette: { value: paletteVectors(options.palette ?? DEFAULT_PALETTE) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quadScene = new THREE.Scene();
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.bloomStrength = options.bloomStrength ?? 0.7;
    this.defaultEdgeDepth = options.edgeDepth ?? 0.08;
  }

  resize(widthPx, heightPx, cellWidth, cellHeight) {
    this.grid.set(Math.floor(widthPx / cellWidth), Math.floor(heightPx / cellHeight));
    const targetWidth = this.grid.x * TEXELS_PER_CELL;
    const targetHeight = this.grid.y * TEXELS_PER_CELL;
    this.sceneTarget?.dispose();
    this.normalTarget?.dispose();
    this.asciiTarget?.dispose();
    this.sceneTarget = new THREE.WebGLRenderTarget(targetWidth, targetHeight, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(targetWidth, targetHeight),
    });
    this.normalTarget = new THREE.WebGLRenderTarget(targetWidth, targetHeight, { type: THREE.HalfFloatType });
    this.asciiTarget = new THREE.WebGLRenderTarget(widthPx, heightPx, { type: THREE.HalfFloatType });
    const uniforms = this.material.uniforms;
    uniforms.tScene.value = this.sceneTarget.texture;
    uniforms.tDepth.value = this.sceneTarget.depthTexture;
    uniforms.tNormal.value = this.normalTarget.texture;
    uniforms.uScreen.value.set(widthPx, heightPx);
    uniforms.uCell.value.set(cellWidth, cellHeight);
    uniforms.uTexelPx.value.set(widthPx / targetWidth, heightPx / targetHeight);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setSize(widthPx, heightPx);
    this.composer.addPass(new TexturePass(this.asciiTarget.texture));
    // Threshold above the haze and dim glyphs, so only the bright highlights and rim glow.
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(widthPx, heightPx), this.bloomStrength, 0.35, 0.55));
    this.composer.addPass(new OutputPass());
  }

  /** Draws meshes with their own normal material on top of the normal buffer, depth-tested against what is there. */
  renderDeforming(scene, camera, nodes) {
    const renderer = this.renderer;
    const hidden = [];
    scene.traverse((node) => {
      if (node.isMesh && node.visible && !nodes.includes(node)) {
        node.visible = false;
        hidden.push(node);
      }
    });
    const lit = nodes.map((node) => node.material);
    nodes.forEach((node) => { node.material = node.userData.normalMaterial; });
    scene.overrideMaterial = null;
    renderer.autoClear = false;
    renderer.render(scene, camera);
    renderer.autoClear = true;
    nodes.forEach((node, index) => { node.material = lit[index]; });
    for (const node of hidden) node.visible = true;
  }

  /** floor: optional mesh drawn as sparse floor glyphs instead of filled creature glyphs. */
  render(scene, camera, floor = null) {
    const renderer = this.renderer;
    if (this.raw) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }
    const uniforms = this.material.uniforms;
    // A scene can quiet its floor: only floor lit above this level (a flashlight pool) gets glyphs.
    uniforms.uFloorCutoff.value = scene.userData.floorCutoff ?? 0.08;
    uniforms.uEdgeDepth.value = scene.userData.edgeDepth ?? this.defaultEdgeDepth;
    uniforms.uNear.value = camera.near;
    uniforms.uFar.value = camera.far;

    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(scene, camera);

    const background = scene.background;
    scene.background = null;
    scene.overrideMaterial = this.normalMaterial;
    renderer.setRenderTarget(this.normalTarget);
    renderer.setClearColor(0x8080ff, 1);
    if (floor) floor.visible = false;
    // Meshes that deform in their own vertex shader (the swarm) carry a matching normal material and are drawn
    // after the override pass, which would flatten them to their rest pose.
    const deforming = [];
    scene.traverse((node) => {
      if (node.isMesh && node.visible && node.userData.normalMaterial) deforming.push(node);
    });
    for (const node of deforming) node.visible = false;
    renderer.render(scene, camera);
    for (const node of deforming) node.visible = true;
    if (deforming.length) this.renderDeforming(scene, camera, deforming);
    if (floor) {
      // Draw the floor on its own with its tag, depth-tested against the creature already in the target.
      floor.visible = true;
      const hidden = [];
      scene.traverse((node) => {
        if (node !== floor && node.isMesh && node.visible) {
          node.visible = false;
          hidden.push(node);
        }
      });
      scene.overrideMaterial = this.floorNormalMaterial;
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = true;
      for (const node of hidden) node.visible = true;
    }
    scene.overrideMaterial = null;
    scene.background = background;
    renderer.setClearColor(0x000000, 1);

    renderer.setRenderTarget(this.asciiTarget);
    renderer.render(this.quadScene, this.quadCamera);
    renderer.setRenderTarget(null);
    this.composer.render();
  }
}
