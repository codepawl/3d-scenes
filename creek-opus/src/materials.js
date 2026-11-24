import * as THREE from 'three';
import { noiseGlsl } from './glsl.js';

// Uniforms every patched material shares; main.js updates the values each frame.
export function createWorldUniforms(field) {
  return {
    uTime: { value: 0 },
    uFieldMap: { value: field.createTexture() },
    uFieldTransform: { value: field.uvTransform() },
    uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    uSunLight: { value: new THREE.Color(1, 1, 1) },
    uCaustics: { value: 1 },
    uWind: { value: 1 },
    uGrassTint: { value: new THREE.Color(1, 1, 1) },
  };
}

const sharedPars = /* glsl */ `
uniform float uTime;
uniform sampler2D uFieldMap;
uniform vec4 uFieldTransform;
uniform vec3 uSunDirection;
uniform vec3 uSunLight;
uniform float uCaustics;
uniform float uWind;
uniform vec3 uGrassTint;
varying vec3 vCreekWorld;
`;

const fragmentHelpers = /* glsl */ `
${noiseGlsl}
vec4 creekField(vec2 worldXZ) {
  return texture2D(uFieldMap, worldXZ * uFieldTransform.xy + uFieldTransform.zw);
}
vec3 creekBump(vec3 surfacePosition, vec3 surfaceNormal, float height, float scale) {
  vec3 dPdx = dFdx(surfacePosition);
  vec3 dPdy = dFdy(surfacePosition);
  float dHdx = dFdx(height) * scale;
  float dHdy = dFdy(height) * scale;
  vec3 r1 = cross(dPdy, surfaceNormal);
  vec3 r2 = cross(surfaceNormal, dPdx);
  float determinant = dot(dPdx, r1);
  vec3 gradient = sign(determinant) * (dHdx * r1 + dHdy * r2);
  return normalize(abs(determinant) * surfaceNormal - gradient);
}
`;

const shadowHelper = /* glsl */ `
float creekSunShadow() {
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    DirectionalLightShadow shadowInfo = directionalLightShadows[ 0 ];
    return getShadow( directionalShadowMap[ 0 ], shadowInfo.shadowMapSize, shadowInfo.shadowIntensity,
      shadowInfo.shadowBias, shadowInfo.shadowRadius, vDirectionalShadowCoord[ 0 ] );
  #else
    return 1.0;
  #endif
}
`;

const worldPositionVertex = /* glsl */ `
  vec4 creekWorldPosition = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    creekWorldPosition = instanceMatrix * creekWorldPosition;
  #endif
  vCreekWorld = ( modelMatrix * creekWorldPosition ).xyz;
`;

// Light reaching anything below the local water level: attenuated by depth and broken
// into a moving caustic network (a modulation that roughly conserves energy).
const causticsLight = /* glsl */ `
  {
    vec4 causticField = creekField( vCreekWorld.xz );
    float depthBelow = causticField.x - vCreekWorld.y;
    float underwater = smoothstep( 0.0, 0.03, depthBelow );
    if ( underwater > 0.001 ) {
      vec2 causticUv = vCreekWorld.xz * 1.35 + vec2( 0.0, uTime * 0.35 );
      float caustic = creekCaustics( causticUv, uTime * 0.55 );
      caustic = ( caustic + 0.6 * creekCaustics( causticUv * 1.7 + 3.1, uTime * 0.45 + 2.0 ) ) / 1.6;
      float attenuation = exp( -depthBelow * 1.4 );
      float modulation = mix( 0.62, 0.42 + min( caustic, 1.4 ) * 0.95, uCaustics ) * attenuation;
      reflectedLight.directDiffuse *= mix( 1.0, modulation, underwater );
      reflectedLight.directSpecular *= mix( 1.0, 0.25, underwater );
      reflectedLight.indirectDiffuse *= mix( 1.0, 0.75, underwater );
    }
  }
`;

function insertAfter(source, anchor, code) {
  if (!source.includes(anchor)) {
    throw new Error(`Shader anchor not found: ${anchor}`);
  }
  return source.replace(anchor, `${anchor}\n${code}`);
}

function insertBefore(source, anchor, code) {
  if (!source.includes(anchor)) {
    throw new Error(`Shader anchor not found: ${anchor}`);
  }
  return source.replace(anchor, `${code}\n${anchor}`);
}

// Applies a list of [anchor, code, 'after' | 'before'] edits to the vertex and fragment shaders.
export function patchMaterial(material, key, worldUniforms, { vertexPars = '', vertex = [], fragmentPars = '', fragment = [] }) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, worldUniforms);
    shader.vertexShader = insertAfter(shader.vertexShader, '#include <common>', `${sharedPars}\n${vertexPars}`);
    shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <common>', `${sharedPars}\n${fragmentHelpers}\n${fragmentPars}`);
    shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <shadowmap_pars_fragment>', shadowHelper);
    for (const [anchor, code, where = 'after'] of vertex) {
      shader.vertexShader = where === 'after' ? insertAfter(shader.vertexShader, anchor, code) : insertBefore(shader.vertexShader, anchor, code);
    }
    for (const [anchor, code, where = 'after'] of fragment) {
      shader.fragmentShader = where === 'after' ? insertAfter(shader.fragmentShader, anchor, code) : insertBefore(shader.fragmentShader, anchor, code);
    }
  };
  material.customProgramCacheKey = () => key;
  return material;
}

export function createTerrainMaterial(worldUniforms) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  return patchMaterial(material, 'creek-terrain', worldUniforms, {
    vertexPars: 'attribute vec3 _mask;\nvarying vec3 vMask;',
    vertex: [['#include <project_vertex>', `${worldPositionVertex}\n  vMask = _mask;`]],
    fragmentPars: 'varying vec3 vMask;\nfloat creekWet;\nfloat creekBumpHeight;',
    fragment: [
      ['#include <color_fragment>', /* glsl */ `
        vec4 terrainField = creekField( vCreekWorld.xz );
        float grassAmount = clamp( vMask.x, 0.0, 1.0 );
        vec3 terrainWorldNormal = inverseTransformDirection( normalize( vNormal ), viewMatrix );
        float steep = ( 1.0 - smoothstep( 0.3, 0.65, terrainWorldNormal.y ) ) * ( 1.0 - grassAmount );
        float bedAmount = clamp( vMask.y, 0.0, 1.0 ) * ( 1.0 - steep );
        float dirtAmount = clamp( vMask.z, 0.0, 1.0 );
        vec2 xz = vCreekWorld.xz;
        float broad = creekFbm2( xz * 0.6 );
        float grassDetail = creekNoise2( xz * 9.0 ) * 0.6 + creekNoise2( xz * 31.0 ) * 0.4;
        vec3 grassShade = vec3( 0.8 + 0.35 * broad ) * ( 0.84 + 0.3 * grassDetail );
        grassShade *= mix( vec3( 1.0 ), vec3( 1.08, 1.04, 0.82 ), smoothstep( 0.55, 0.8, broad ) );
        diffuseColor.rgb *= mix( vec3( 1.0 ), grassShade * uGrassTint, grassAmount );

        vec2 cellId;
        vec3 pebbles = creekVoronoi( xz * 9.0, cellId );
        float pebbleTone = creekHash12( cellId );
        float pebbleGap = smoothstep( 0.02, 0.16, pebbles.z );
        vec2 gravelId;
        vec3 gravel = creekVoronoi( xz * 23.0 + 4.0, gravelId );
        float gravelTone = creekHash12( gravelId );
        float pebblePattern = mix( 0.74, 0.84 + 0.42 * pebbleTone, pebbleGap );
        pebblePattern *= mix( 0.8, 1.0 + 0.2 * gravelTone, smoothstep( 0.02, 0.09, gravel.z ) );
        vec3 pebbleHue = mix( vec3( 1.0 ), vec3( 1.12, 1.0, 0.82 ), step( 0.78, creekHash12( cellId + 3.7 ) ) );
        pebbleHue = mix( pebbleHue, vec3( 0.85, 1.05, 0.9 ), step( 0.85, creekHash12( cellId + 9.1 ) ) );
        float algae = smoothstep( 0.45, 0.8, creekFbm2( xz * 0.7 + 3.0 ) );
        pebbleHue *= mix( vec3( 1.0 ), vec3( 0.78, 1.0, 0.72 ), algae * 0.8 );
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * pebblePattern * pebbleHue * 1.3, bedAmount );
        diffuseColor.rgb *= mix( 1.0, 0.85 + 0.3 * creekNoise2( xz * 7.0 ), dirtAmount );
        vec3 earthFace = vec3( 0.05, 0.043, 0.032 ) * ( 0.75 + 0.5 * creekNoise2( xz * 4.0 + vCreekWorld.y * 6.0 ) );
        diffuseColor.rgb = mix( diffuseColor.rgb, earthFace, steep );

        creekWet = smoothstep( terrainField.x + 0.16, terrainField.x - 0.01, vCreekWorld.y ) * ( 1.0 - grassAmount * 0.7 );
        diffuseColor.rgb *= mix( 1.0, 0.58, creekWet );
        creekBumpHeight = bedAmount * pebbleGap * ( 1.0 - pebbles.x ) * 0.035 + dirtAmount * creekNoise2( xz * 6.0 ) * 0.02;
      `],
      ['#include <roughnessmap_fragment>', 'roughnessFactor = mix( roughnessFactor, 0.32, creekWet );'],
      ['#include <normal_fragment_maps>', 'normal = creekBump( -vViewPosition, normal, creekBumpHeight, 1.0 );'],
      ['#include <lights_fragment_end>', causticsLight],
    ],
  });
}

// Shared by boulders, wall stones, pebbles, the culvert and the cabin plinth.
export function createStoneMaterial(worldUniforms, { roughness = 0.82, detailScale = 1.0, key = 'stone', side = THREE.FrontSide } = {}) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0, side });
  return patchMaterial(material, `creek-${key}`, worldUniforms, {
    vertexPars: 'varying vec3 vStoneLocal;',
    vertex: [['#include <project_vertex>', `${worldPositionVertex}\n  vStoneLocal = position * ${detailScale.toFixed(3)};`]],
    fragmentPars: 'varying vec3 vStoneLocal;\nfloat creekWet;\nfloat creekBumpHeight;',
    fragment: [
      ['#include <color_fragment>', /* glsl */ `
        vec4 stoneField = creekField( vCreekWorld.xz );
        float blotches = creekFbm3( vStoneLocal * 3.2 );
        float speckle = creekNoise3( vStoneLocal * 30.0 );
        float pits = smoothstep( 0.8, 0.95, creekNoise3( vStoneLocal * 13.0 + 5.0 ) );
        diffuseColor.rgb *= ( 0.9 + 0.22 * blotches ) * ( 0.97 + 0.06 * speckle ) * ( 1.0 - 0.14 * pits );
        float waterline = stoneField.x;
        creekWet = smoothstep( waterline + 0.07, waterline - 0.015, vCreekWorld.y );
        diffuseColor.rgb *= mix( 1.0, 0.56, creekWet );
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.85, 0.95, 0.75 ), creekWet * smoothstep( waterline - 0.03, waterline - 0.25, vCreekWorld.y ) );
        creekBumpHeight = blotches * 0.035;
      `],
      ['#include <roughnessmap_fragment>', 'roughnessFactor = mix( roughnessFactor, 0.22, creekWet );'],
      ['#include <normal_fragment_maps>', 'normal = creekBump( -vViewPosition, normal, creekBumpHeight, 1.0 );'],
      ['#include <lights_fragment_end>', causticsLight],
    ],
  });
}

export function createBarkMaterial(worldUniforms) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  return patchMaterial(material, 'creek-bark', worldUniforms, {
    vertexPars: 'varying vec3 vBarkLocal;',
    vertex: [['#include <project_vertex>', `${worldPositionVertex}\n  vBarkLocal = position;`]],
    fragmentPars: 'varying vec3 vBarkLocal;\nfloat creekBumpHeight;',
    fragment: [
      ['#include <color_fragment>', /* glsl */ `
        float ridges = creekNoise3( vBarkLocal * vec3( 22.0, 2.5, 22.0 ) );
        float patches = creekFbm3( vBarkLocal * 2.0 );
        diffuseColor.rgb *= ( 0.72 + 0.4 * ridges ) * ( 0.85 + 0.3 * patches );
        creekBumpHeight = ridges * 0.02;
      `],
      ['#include <normal_fragment_maps>', 'normal = creekBump( -vViewPosition, normal, creekBumpHeight, 1.0 );'],
    ],
  });
}

const leafWind = /* glsl */ `
  {
    vec3 instanceOrigin = vec3( 0.0 );
    #ifdef USE_INSTANCING
      instanceOrigin = instanceMatrix[ 3 ].xyz;
    #endif
    float reach = length( transformed.xz ) * 0.07 + max( transformed.y - 1.0, 0.0 ) * 0.035;
    float phase = dot( instanceOrigin.xz, vec2( 0.21, 0.17 ) );
    vec3 sway = vec3( sin( uTime * 1.25 + phase ), 0.0, cos( uTime * 1.05 + phase * 1.3 ) ) * 0.45 * reach;
    float flutter = sin( uTime * 4.1 + dot( transformed, vec3( 3.1, 2.3, 2.7 ) ) + phase );
    transformed += ( sway + vec3( 0.6, 0.35, 0.5 ) * flutter * 0.025 ) * uWind;
  }
`;

export function createLeafMaterial(worldUniforms, map) {
  const material = new THREE.MeshStandardMaterial({
    map,
    vertexColors: true,
    alphaTest: 0.45,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    roughness: 0.62,
    metalness: 0,
  });
  return patchMaterial(material, 'creek-leaves', worldUniforms, {
    vertex: [
      ['#include <begin_vertex>', leafWind],
      ['#include <project_vertex>', worldPositionVertex],
    ],
    fragment: [
      ['#include <normal_fragment_begin>', 'normal = normalize( vNormal );'],
      ['#include <lights_fragment_end>', /* glsl */ `
        {
          vec3 viewToFragment = normalize( vCreekWorld - cameraPosition );
          float forward = pow( clamp( dot( viewToFragment, uSunDirection ), 0.0, 1.0 ), 4.0 );
          float shadow = creekSunShadow();
          vec3 transmitted = diffuseColor.rgb * vec3( 1.05, 1.15, 0.6 ) * uSunLight * ( 0.12 + forward * 0.85 ) * shadow;
          reflectedLight.directDiffuse += transmitted;
        }
      `],
    ],
  });
}

export function createLeafDepthMaterial(worldUniforms, map) {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.45, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, worldUniforms);
    shader.vertexShader = insertAfter(shader.vertexShader, '#include <common>', 'uniform float uTime;\nuniform float uWind;');
    shader.vertexShader = insertAfter(shader.vertexShader, '#include <begin_vertex>', leafWind);
  };
  material.customProgramCacheKey = () => 'creek-leaf-depth';
  return material;
}
