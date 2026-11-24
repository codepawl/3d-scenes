import * as THREE from 'three';
import { noiseGlsl, skyFunctionGlsl, skyUniformsGlsl } from './glsl.js';

export const WATER_LAYER = 1;

// Tileable ripple normal map: a sum of sine waves with integer wave vectors.
function createRippleTexture(size = 256) {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const waves = [];
  while (waves.length < 56) {
    const magnitude = 2 + Math.floor(Math.pow(random(), 1.7) * 30);
    const angle = random() * Math.PI * 2;
    const kx = Math.round(Math.cos(angle) * magnitude);
    const ky = Math.round(Math.sin(angle) * magnitude * 1.35);
    if (kx === 0 && ky === 0) {
      continue;
    }
    const length = Math.hypot(kx, ky);
    waves.push({ kx, ky, amplitude: 1 / Math.pow(length, 1.25), phase: random() * Math.PI * 2 });
  }
  const data = new Uint8Array(size * size * 4);
  const tau = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let slopeX = 0;
      let slopeY = 0;
      let height = 0;
      for (const wave of waves) {
        const argument = tau * (wave.kx * u + wave.ky * v) + wave.phase;
        const cosine = Math.cos(argument);
        slopeX += wave.amplitude * wave.kx * cosine;
        slopeY += wave.amplitude * wave.ky * cosine;
        height += wave.amplitude * Math.sin(argument);
      }
      const strength = 0.11;
      const normal = new THREE.Vector3(-slopeX * strength, -slopeY * strength, 1).normalize();
      const index = (y * size + x) * 4;
      data[index] = Math.round((normal.x * 0.5 + 0.5) * 255);
      data[index + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
      data[index + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
      data[index + 3] = Math.round(THREE.MathUtils.clamp(height * 0.25 + 0.5, 0, 1) * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function createRibbonGeometry(path) {
  const step = 0.25;
  const across = 22;
  const end = path.culvertS + 6.5;
  const positions = [];
  const uvs = [];
  const flows = [];
  const infos = [];
  const indices = [];
  const center = new THREE.Vector3();
  const tangent = new THREE.Vector2();
  let rows = 0;
  for (let s = 0; s <= end; s += step) {
    path.point(s, 0, center);
    path.tangent(s, tangent);
    const halfWidth = path.value(path.halfWidth, s) + 0.65;
    const level = path.value(path.waterLevel, s);
    const drop = path.value(path.waterLevel, s + step) - path.value(path.waterLevel, s - step);
    const slope = Math.max(drop / (2 * step), 0);
    const insideCulvert = THREE.MathUtils.smoothstep(s, path.culvertS - 0.6, path.culvertS + 0.2);
    for (let column = 0; column <= across; column++) {
      const lateral = (column / across * 2 - 1) * halfWidth;
      positions.push(center.x - tangent.y * lateral, level, center.z + tangent.x * lateral);
      uvs.push(lateral, s);
      flows.push(tangent.x, tangent.y);
      infos.push(slope, 1 - insideCulvert);
    }
    rows++;
  }
  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < across; column++) {
      const a = row * (across + 1) + column;
      const b = a + 1;
      const c = a + across + 1;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 2));
  geometry.setAttribute('aInfo', new THREE.Float32BufferAttribute(infos, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

const vertexShader = /* glsl */ `
  attribute vec2 aFlow;
  attribute vec2 aInfo;
  varying vec3 vWorld;
  varying vec2 vRibbon;
  varying vec2 vFlow;
  varying vec2 vInfo;
  #include <common>
  #include <fog_pars_vertex>
  #include <shadowmap_pars_vertex>
  void main() {
    vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
    vWorld = worldPosition.xyz;
    vRibbon = uv;
    vFlow = aFlow;
    vInfo = aInfo;
    vec3 transformedNormal = normalMatrix * vec3( 0.0, 1.0, 0.0 );
    #include <shadowmap_vertex>
    vec4 mvPosition = viewMatrix * worldPosition;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tSceneColor;
  uniform sampler2D tSceneDepth;
  uniform sampler2D tRipples;
  uniform vec2 uResolution;
  uniform mat4 uProjectionInverse;
  uniform mat4 uCameraWorld;
  uniform mat4 uViewProjection;
  uniform float uTime;
  uniform float uSparkle;
  uniform vec3 uSunLight;
  uniform vec3 uAmbientLight;
  uniform vec3 uWaterScatter;
  uniform vec3 uWaterAbsorb;
  varying vec3 vWorld;
  varying vec2 vRibbon;
  varying vec2 vFlow;
  varying vec2 vInfo;
  ${skyUniformsGlsl}
  #include <common>
  #include <packing>
  #include <fog_pars_fragment>
  #include <lights_pars_begin>
  #include <shadowmap_pars_fragment>
  #include <shadowmask_pars_fragment>
  ${noiseGlsl}
  ${skyFunctionGlsl}

  vec3 worldFromDepth( vec2 uv, float depth ) {
    vec4 clip = vec4( uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
    vec4 view = uProjectionInverse * clip;
    view /= view.w;
    return ( uCameraWorld * view ).xyz;
  }

  vec2 rippleSlope( vec2 coordinate ) {
    return texture2D( tRipples, coordinate ).xy * 2.0 - 1.0;
  }

  void main() {
    vec2 screenUv = gl_FragCoord.xy / uResolution;
    float sceneDepth = texture2D( tSceneDepth, screenUv ).x;
    if ( sceneDepth <= gl_FragCoord.z + 0.000002 ) discard;
    vec3 bedWorld = worldFromDepth( screenUv, sceneDepth );
    float verticalDepth = max( vWorld.y - bedWorld.y, 0.0 );
    float cascade = smoothstep( 0.02, 0.12, vInfo.x );
    float open = vInfo.y;

    // Flowing ripples: ribbon uv is (lateral metres, s metres); water runs toward lower s.
    float speed = 0.5 + cascade * 1.6;
    vec2 flowing = vRibbon + vec2( 0.0, uTime * speed );
    vec2 slope = rippleSlope( flowing * vec2( 0.42, 0.26 ) ) * 0.55;
    slope += rippleSlope( flowing * vec2( 0.9, 0.62 ) + vec2( 0.31, 0.17 ) + vec2( uTime * 0.03, uTime * 0.21 ) ) * 0.42;
    slope += rippleSlope( vRibbon * vec2( 2.3, 1.7 ) + vec2( 0.0, uTime * speed * 1.7 ) + 0.53 ) * 0.34;
    slope += rippleSlope( vRibbon * vec2( 5.1, 3.9 ) + vec2( uTime * 0.11, uTime * speed * 2.4 ) + 0.71 ) * 0.22;
    slope *= 1.0 + cascade * 2.5;
    vec3 flowTangent = vec3( vFlow.x, 0.0, vFlow.y );
    vec3 flowSide = vec3( -vFlow.y, 0.0, vFlow.x );
    vec3 normal = normalize( vec3( 0.0, 1.0, 0.0 ) + flowSide * slope.x * 0.62 + flowTangent * slope.y * 0.62 );

    vec3 toCamera = cameraPosition - vWorld;
    float viewDistance = length( toCamera );
    vec3 viewDirection = toCamera / viewDistance;
    float facing = clamp( dot( normal, viewDirection ), 0.0, 1.0 );
    float fresnel = 0.02 + 0.98 * pow( 1.0 - facing, 5.0 );
    float shadow = getShadowMask();

    // Refraction through the clear water, rejecting samples in front of the surface.
    vec2 refractUv = screenUv + normal.xz * 0.085 * clamp( verticalDepth * 3.0, 0.0, 1.0 ) * ( 2.0 / max( viewDistance, 2.0 ) );
    float refractDepth = texture2D( tSceneDepth, refractUv ).x;
    if ( refractDepth <= gl_FragCoord.z ) {
      refractUv = screenUv;
      refractDepth = sceneDepth;
    }
    vec3 refracted = texture2D( tSceneColor, refractUv ).rgb;
    vec3 refractWorld = worldFromDepth( refractUv, refractDepth );
    float pathLength = min( distance( vWorld, refractWorld ), 12.0 );
    vec3 transmittance = exp( -uWaterAbsorb * pathLength );
    vec3 lightInWater = uAmbientLight + uSunLight * 0.18 * shadow;
    vec3 scatter = uWaterScatter * lightInWater * 0.42 * open;
    vec3 body = refracted * transmittance + scatter * ( 1.0 - transmittance );

    // Reflection: a short screen-space march, falling back to the sky.
    vec3 reflected = reflect( -viewDirection, normal );
    reflected.y = abs( reflected.y );
    vec3 reflection = creekSky( reflected, false ) * open;
    float hit = 0.0;
    vec3 hitColor = vec3( 0.0 );
    for ( int stepIndex = 1; stepIndex <= 14; stepIndex++ ) {
      float travel = 0.06 * float( stepIndex * stepIndex );
      vec3 probe = vWorld + reflected * travel;
      vec4 clip = uViewProjection * vec4( probe, 1.0 );
      vec2 probeUv = clip.xy / clip.w * 0.5 + 0.5;
      if ( probeUv.x < 0.0 || probeUv.x > 1.0 || probeUv.y < 0.0 || probeUv.y > 1.0 ) break;
      float probeDepth = texture2D( tSceneDepth, probeUv ).x;
      vec3 surface = worldFromDepth( probeUv, probeDepth );
      float surfaceDistance = distance( cameraPosition, surface );
      float probeDistance = distance( cameraPosition, probe );
      if ( surfaceDistance < probeDistance && probeDistance - surfaceDistance < 0.35 + travel * 0.25 ) {
        vec2 edge = smoothstep( 0.0, 0.08, probeUv ) * smoothstep( 1.0, 0.92, probeUv );
        hit = edge.x * edge.y;
        hitColor = texture2D( tSceneColor, probeUv ).rgb;
        break;
      }
    }
    reflection = mix( reflection, hitColor, hit );

    // Sun glints: a tight lobe for sparkles and a broad sheen.
    vec3 halfVector = normalize( uSunDirection + viewDirection );
    float alignment = max( dot( normal, halfVector ), 0.0 );
    float glint = pow( alignment, 900.0 ) * 40.0 + pow( alignment, 220.0 ) * 0.08;
    vec2 glitterCoordinate = vRibbon * vec2( 56.0, 44.0 ) + vec2( 0.0, uTime * speed * 44.0 );
    vec2 glitterCell = floor( glitterCoordinate );
    float glitterSeed = creekHash12( glitterCell + floor( uTime * 7.0 ) * 0.37 );
    vec3 glitterNormal = normalize( normal + vec3( creekHash12( glitterCell + 1.3 ) - 0.5, 0.0, creekHash12( glitterCell + 7.1 ) - 0.5 ) * 1.4 );
    vec2 glitterCentre = creekHash22( glitterCell + 3.3 ) * 0.5 + 0.25;
    float glitterSpot = smoothstep( 0.22, 0.0, length( fract( glitterCoordinate ) - glitterCentre ) );
    float glitter = step( 0.72, glitterSeed ) * glitterSpot * pow( max( dot( glitterNormal, halfVector ), 0.0 ), 500.0 ) * 18.0;
    float sunUp = smoothstep( -0.05, 0.08, uSunDirection.y );
    vec3 specular = uSunLight * ( glint + glitter ) * uSparkle * shadow * open * sunUp;

    // Foam where the water is very shallow, around stones, and on the small cascades.
    float foamNoise = creekNoise2( vRibbon * vec2( 3.4, 2.2 ) + vec2( 0.0, uTime * speed * 2.6 ) );
    float foamFine = creekNoise2( vRibbon * vec2( 11.0, 7.0 ) + vec2( 0.0, uTime * speed * 4.0 ) );
    float streaks = creekNoise2( vRibbon * vec2( 9.0, 0.8 ) + vec2( 0.0, uTime * speed * 1.3 ) );
    float edgeFoam = ( 1.0 - smoothstep( 0.0, 0.028, verticalDepth ) ) * smoothstep( 0.45, 0.8, foamNoise * 0.55 + foamFine * 0.5 );
    float cascadeFoam = cascade * smoothstep( 0.5, 0.95, streaks * 0.6 + foamFine * 0.5 ) * 0.7;
    float foam = clamp( edgeFoam * 0.45 + cascadeFoam, 0.0, 1.0 );
    vec3 foamColor = vec3( 0.9, 0.95, 0.95 ) * ( uAmbientLight * 0.95 + uSunLight * 0.45 * shadow );

    vec3 color = mix( body, reflection, fresnel ) + specular * ( 1.0 - foam );
    color = mix( color, foamColor, foam * 0.85 );
    gl_FragColor = vec4( color, 1.0 );
    #include <fog_fragment>
  }
`;

export class Water {
  constructor(path, skyUniforms) {
    this.uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.lights,
      THREE.UniformsLib.fog,
      {
        tSceneColor: { value: null },
        tSceneDepth: { value: null },
        tRipples: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uProjectionInverse: { value: new THREE.Matrix4() },
        uCameraWorld: { value: new THREE.Matrix4() },
        uViewProjection: { value: new THREE.Matrix4() },
        uTime: { value: 0 },
        uSparkle: { value: 1 },
        uSunLight: { value: new THREE.Color() },
        uAmbientLight: { value: new THREE.Color() },
        uWaterScatter: { value: new THREE.Color() },
        uWaterAbsorb: { value: new THREE.Vector3(2, 0.6, 0.5) },
      },
    ]);
    Object.assign(this.uniforms, skyUniforms);
    this.uniforms.tRipples.value = createRippleTexture();
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      lights: true,
      fog: true,
    });
    this.mesh = new THREE.Mesh(createRibbonGeometry(path), this.material);
    this.mesh.receiveShadow = true;
    this.mesh.layers.set(WATER_LAYER);
  }

  update(camera, sceneTarget, time, lighting) {
    const uniforms = this.uniforms;
    uniforms.tSceneColor.value = sceneTarget.texture;
    uniforms.tSceneDepth.value = sceneTarget.depthTexture;
    uniforms.uResolution.value.set(sceneTarget.width, sceneTarget.height);
    uniforms.uProjectionInverse.value.copy(camera.projectionMatrixInverse);
    uniforms.uCameraWorld.value.copy(camera.matrixWorld);
    uniforms.uViewProjection.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    uniforms.uTime.value = time;
    uniforms.uSparkle.value = lighting.sparkle;
    uniforms.uSunLight.value.copy(lighting.sunColor).multiplyScalar(lighting.sunIntensity);
    uniforms.uAmbientLight.value.copy(lighting.skyZenith).lerp(lighting.skyHorizon, 0.5).multiplyScalar(lighting.environment);
    uniforms.uWaterScatter.value.copy(lighting.waterScatter);
    uniforms.uWaterAbsorb.value.copy(lighting.waterAbsorb);
  }
}
