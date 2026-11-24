import * as THREE from 'three';
import { patchMaterial } from './materials.js';
import { WATER_LAYER } from './water.js';

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Small yellow leaves drifting downstream; positions come from the creek path texture on the GPU.
export function createFloatingLeaves(path, worldUniforms, count = 230) {
  const random = seededRandom(99);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  const sStart = path.sAtZ(56);
  const sEnd = path.culvertS - 0.5;
  const leaves = new Float32Array(count * 4);
  const tones = new Float32Array(count * 2);
  for (let index = 0; index < count; index++) {
    leaves.set([sStart + random() * (sEnd - sStart), (random() * 2 - 1) * 0.85, 0.25 + random() * 0.35, 0.06 + random() * 0.05], index * 4);
    tones.set([random(), random() * 2 - 1], index * 2);
  }
  geometry.setAttribute('aLeaf', new THREE.InstancedBufferAttribute(leaves, 4));
  geometry.setAttribute('aLeafTone', new THREE.InstancedBufferAttribute(tones, 2));
  geometry.instanceCount = count;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 400);

  const uniforms = {
    uCreekPath: { value: path.createTexture() },
    uCreekCount: { value: path.count },
    uCreekSpacing: { value: path.spacing },
    uDriftStart: { value: sStart },
    uDriftLength: { value: sEnd - sStart },
  };
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.55, alphaTest: 0.5 });
  patchMaterial(material, 'creek-floating-leaves', { ...worldUniforms, ...uniforms }, {
    vertexPars: /* glsl */ `
      attribute vec4 aLeaf;
      attribute vec2 aLeafTone;
      uniform sampler2D uCreekPath;
      uniform float uCreekCount;
      uniform float uCreekSpacing;
      uniform float uDriftStart;
      uniform float uDriftLength;
      varying vec2 vLeafUv;
      varying float vLeafHue;
      vec4 creekSample( float s ) {
        float index = clamp( s / uCreekSpacing, 0.0, uCreekCount - 2.0 );
        float base = floor( index );
        vec4 first = texture2D( uCreekPath, vec2( ( base + 0.5 ) / uCreekCount, 0.5 ) );
        vec4 second = texture2D( uCreekPath, vec2( ( base + 1.5 ) / uCreekCount, 0.5 ) );
        return mix( first, second, index - base );
      }
    `,
    vertex: [
      ['#include <beginnormal_vertex>', 'objectNormal = vec3( 0.0, 1.0, 0.0 );'],
      ['#include <begin_vertex>', /* glsl */ `
        float drift = mod( aLeaf.x - uDriftStart - uTime * aLeaf.z, uDriftLength );
        float s = uDriftStart + drift;
        vec4 here = creekSample( s );
        vec4 ahead = creekSample( s + uCreekSpacing * 2.0 );
        vec2 tangent = normalize( ahead.xy - here.xy + vec2( 1e-5 ) );
        vec2 side = vec2( -tangent.y, tangent.x );
        float wobble = sin( uTime * 0.7 + aLeafTone.y * 9.0 ) * 0.12;
        vec2 centre = here.xy + side * ( aLeaf.y * here.w + wobble );
        float spin = aLeafTone.y * 6.2831 + uTime * aLeafTone.y * 0.4;
        vec2 shape = vec2( position.x * 1.0, position.z * 0.55 ) * aLeaf.w;
        vec2 rotated = vec2( shape.x * cos( spin ) - shape.y * sin( spin ), shape.x * sin( spin ) + shape.y * cos( spin ) );
        float bob = sin( uTime * 2.2 + aLeafTone.x * 20.0 ) * 0.004;
        transformed = vec3( centre.x + rotated.x, here.z + 0.014 + bob + length( position.xz ) * 0.006, centre.y + rotated.y );
        vLeafUv = uv;
        vLeafHue = aLeafTone.x;
      `],
      ['#include <project_vertex>', 'vCreekWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;'],
    ],
    fragmentPars: 'varying vec2 vLeafUv;\nvarying float vLeafHue;',
    fragment: [
      ['#include <color_fragment>', /* glsl */ `
        vec2 leafPoint = vLeafUv * 2.0 - 1.0;
        float leafProfile = pow( max( 1.0 - leafPoint.x * leafPoint.x, 0.0 ), 0.7 );
        diffuseColor.a = step( abs( leafPoint.y ), leafProfile );
        vec3 yellow = mix( vec3( 0.95, 0.62, 0.06 ), vec3( 0.85, 0.8, 0.12 ), vLeafHue );
        diffuseColor.rgb = mix( yellow, vec3( 0.75, 0.32, 0.05 ), step( 0.85, vLeafHue ) ) * ( 0.85 + 0.15 * ( 1.0 - abs( leafPoint.y ) ) );
      `],
      ['#include <normal_fragment_begin>', 'normal = normalize( vNormal );'],
    ],
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return mesh;
}

// Glowing fireflies drawn in the translucent pass, depth-tested by hand against the opaque scene.
export function createFireflies(path, field, count = 240) {
  const random = seededRandom(5);
  const bases = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const point = new THREE.Vector3();
  const sStart = path.sAtZ(48);
  const sEnd = path.culvertS - 2;
  for (let index = 0; index < count; index++) {
    const s = sStart + random() * (sEnd - sStart);
    const halfWidth = path.value(path.halfWidth, s);
    const lateral = (random() < 0.5 ? -1 : 1) * (halfWidth * random() * 1.1 + random() * 5);
    path.point(s, lateral, point);
    const ground = Math.max(field.height(point.x, point.z), field.water(point.x, point.z));
    bases.set([point.x, ground + 0.35 + random() * 1.7, point.z], index * 3);
    phases[index] = random() * 100;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(bases, 3));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uPixelRatio: { value: 1 },
      tSceneDepth: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vGlow;
      void main() {
        vec3 drift = vec3( sin( uTime * 0.31 + aPhase ) * 0.7, sin( uTime * 0.53 + aPhase * 1.7 ) * 0.35, cos( uTime * 0.27 + aPhase * 0.6 ) * 0.7 );
        vec4 viewPosition = modelViewMatrix * vec4( position + drift, 1.0 );
        gl_Position = projectionMatrix * viewPosition;
        float blink = pow( max( sin( uTime * 1.4 + aPhase * 5.0 ), 0.0 ), 3.0 );
        vGlow = 0.15 + blink;
        gl_PointSize = clamp( 16.0 * uPixelRatio / -viewPosition.z, 1.5, 9.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      uniform sampler2D tSceneDepth;
      uniform vec2 uResolution;
      varying float vGlow;
      void main() {
        float sceneDepth = texture2D( tSceneDepth, gl_FragCoord.xy / uResolution ).x;
        if ( sceneDepth < gl_FragCoord.z ) discard;
        float radius = length( gl_PointCoord - 0.5 ) * 2.0;
        float core = exp( -radius * radius * 6.0 ) * smoothstep( 1.0, 0.55, radius );
        vec3 color = vec3( 1.0, 0.86, 0.38 ) * core * vGlow * uIntensity * 9.0;
        gl_FragColor = vec4( color, 0.0 );
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.layers.set(WATER_LAYER);
  return points;
}
