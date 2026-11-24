import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { WATER_LAYER } from './water.js';

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4( position.xy, 0.0, 1.0 );
  }
`;

const compositeShader = {
  uniforms: {
    tScene: { value: null },
    tSceneDepth: { value: null },
    tWater: { value: null },
    tWaterDepth: { value: null },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uFocus: { value: 10 },
    uNearBlur: { value: 0.5 },
    uFarBlur: { value: 0.22 },
    uMaxCoc: { value: 14 },
  },
  fragmentShader: /* glsl */ `
    uniform sampler2D tScene;
    uniform sampler2D tSceneDepth;
    uniform sampler2D tWater;
    uniform sampler2D tWaterDepth;
    uniform float uNear;
    uniform float uFar;
    uniform float uFocus;
    uniform float uNearBlur;
    uniform float uFarBlur;
    uniform float uMaxCoc;
    varying vec2 vUv;
    float viewDistance( float depth ) {
      float ndc = depth * 2.0 - 1.0;
      return 2.0 * uNear * uFar / ( uFar + uNear - ndc * ( uFar - uNear ) );
    }
    void main() {
      vec4 scene = texture2D( tScene, vUv );
      vec4 water = texture2D( tWater, vUv );
      vec3 color = scene.rgb * ( 1.0 - water.a ) + water.rgb;
      float depth = min( texture2D( tSceneDepth, vUv ).x, texture2D( tWaterDepth, vUv ).x );
      float distanceToCamera = viewDistance( depth );
      float coc = 1.0 - uFocus / distanceToCamera;
      coc = sign( coc ) * max( abs( coc ) - 0.06, 0.0 );
      coc *= coc < 0.0 ? uNearBlur : uFarBlur;
      gl_FragColor = vec4( color, clamp( coc, -1.0, 1.0 ) * uMaxCoc );
    }
  `,
};

const downsampleShader = {
  uniforms: { tColor: { value: null }, uTexel: { value: new THREE.Vector2() } },
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor;
    uniform vec2 uTexel;
    varying vec2 vUv;
    void main() {
      vec4 a = texture2D( tColor, vUv + uTexel * vec2( -0.5, -0.5 ) );
      vec4 b = texture2D( tColor, vUv + uTexel * vec2( 0.5, -0.5 ) );
      vec4 c = texture2D( tColor, vUv + uTexel * vec2( -0.5, 0.5 ) );
      vec4 d = texture2D( tColor, vUv + uTexel * vec2( 0.5, 0.5 ) );
      vec3 color = ( a.rgb + b.rgb + c.rgb + d.rgb ) * 0.25;
      float nearest = min( min( a.a, b.a ), min( c.a, d.a ) );
      float average = ( a.a + b.a + c.a + d.a ) * 0.25;
      gl_FragColor = vec4( color, nearest < 0.0 ? nearest : average );
    }
  `,
};

// Single-pass scatter-as-gather bokeh on a golden-angle spiral (half resolution).
const bokehShader = {
  uniforms: { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uMaxCoc: { value: 14 } },
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor;
    uniform vec2 uTexel;
    uniform float uMaxCoc;
    varying vec2 vUv;
    const float GOLDEN_ANGLE = 2.39996323;
    const float RADIUS_STEP = 0.85;
    void main() {
      vec4 centre = texture2D( tColor, vUv );
      float centreSize = abs( centre.a );
      vec3 color = centre.rgb;
      float total = 1.0;
      float nearCover = 0.0;
      float radius = RADIUS_STEP;
      float angle = 0.0;
      for ( int index = 0; index < 160; index++ ) {
        if ( radius >= uMaxCoc ) break;
        vec2 offset = vec2( cos( angle ), sin( angle ) ) * radius;
        vec4 sampleValue = texture2D( tColor, vUv + offset * uTexel );
        float sampleSize = abs( sampleValue.a );
        if ( sampleValue.a > centre.a ) {
          sampleSize = clamp( sampleSize, 0.0, centreSize * 2.0 );
        }
        float weight = smoothstep( radius - 0.5, radius + 0.5, sampleSize );
        color += mix( color / total, sampleValue.rgb, weight );
        total += 1.0;
        if ( sampleValue.a < -0.5 ) nearCover += weight;
        radius += RADIUS_STEP / radius;
        angle += GOLDEN_ANGLE;
      }
      float spread = max( centreSize, min( nearCover / total * 4.0, 1.0 ) * uMaxCoc );
      gl_FragColor = vec4( color / total, spread );
    }
  `,
};

const mergeShader = {
  uniforms: { tSharp: { value: null }, tBlur: { value: null }, uEnabled: { value: 1 } },
  fragmentShader: /* glsl */ `
    uniform sampler2D tSharp;
    uniform sampler2D tBlur;
    uniform float uEnabled;
    varying vec2 vUv;
    void main() {
      vec4 sharp = texture2D( tSharp, vUv );
      vec4 blurred = texture2D( tBlur, vUv );
      float amount = smoothstep( 0.35, 1.6, max( abs( sharp.a ), blurred.a ) ) * uEnabled;
      gl_FragColor = vec4( mix( sharp.rgb, blurred.rgb, amount ), 1.0 );
    }
  `,
};

const finalShader = {
  uniforms: {
    tColor: { value: null },
    uExposure: { value: 1 },
    uContrast: { value: 1.04 },
    uWarmth: { value: 0 },
    uSaturation: { value: 1 },
    uDslr: { value: 1 },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor;
    uniform float uExposure;
    uniform float uContrast;
    uniform float uWarmth;
    uniform float uSaturation;
    uniform float uDslr;
    uniform float uTime;
    uniform vec2 uResolution;
    varying vec2 vUv;

    // ACES filmic fit (Stephen Hill), the same curve three.js uses.
    vec3 rrtAndOdtFit( vec3 v ) {
      vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
      vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
      return a / b;
    }
    vec3 acesFilmic( vec3 color ) {
      const mat3 inputMatrix = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
      const mat3 outputMatrix = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
      color *= uExposure / 0.6;
      color = inputMatrix * color;
      color = rrtAndOdtFit( color );
      color = outputMatrix * color;
      return clamp( color, 0.0, 1.0 );
    }
    vec3 toSrgb( vec3 color ) {
      return mix( color * 12.92, 1.055 * pow( color, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, color ) );
    }
    float hash( vec2 p ) {
      vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
      p3 += dot( p3, p3.yzx + 33.33 );
      return fract( ( p3.x + p3.y ) * p3.z );
    }
    void main() {
      vec2 centred = vUv - 0.5;
      vec3 hdr;
      if ( uDslr > 0.5 ) {
        vec2 shift = centred * dot( centred, centred ) * 0.012;
        hdr.r = texture2D( tColor, vUv - shift ).r;
        hdr.g = texture2D( tColor, vUv ).g;
        hdr.b = texture2D( tColor, vUv + shift ).b;
      } else {
        hdr = texture2D( tColor, vUv ).rgb;
      }
      vec3 color = acesFilmic( hdr );
      float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
      color = max( mix( vec3( luma ), color, uSaturation ), 0.0 );
      color *= vec3( 1.0 + uWarmth, 1.0, 1.0 - uWarmth );
      color = toSrgb( clamp( color, 0.0, 1.0 ) );
      color = clamp( ( color - 0.5 ) * uContrast + 0.5, 0.0, 1.0 );
      float aspect = uResolution.x / uResolution.y;
      float edge = length( centred * vec2( aspect, 1.0 ) * 0.9 );
      float vignette = mix( 1.0, smoothstep( 1.05, 0.25, edge ), uDslr > 0.5 ? 0.42 : 0.18 );
      color *= vignette;
      if ( uDslr > 0.5 ) {
        float grain = hash( gl_FragCoord.xy + fract( uTime * 13.7 ) * 512.0 ) - 0.5;
        color += grain * 0.028 * ( 1.0 - color * 0.6 );
      }
      gl_FragColor = vec4( color, 1.0 );
    }
  `,
};

function makeQuad(shader) {
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(shader.uniforms),
    vertexShader: quadVertex,
    fragmentShader: shader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  return new FullScreenQuad(material);
}

function colorTarget(width, height) {
  return new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: false });
}

export class Pipeline {
  constructor(renderer, width, height) {
    this.renderer = renderer;
    this.width = width;
    this.height = height;
    this.sceneTarget = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: new THREE.DepthTexture(width, height),
    });
    this.waterTarget = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(width, height),
    });
    this.compositeTarget = colorTarget(width, height);
    this.halfTarget = colorTarget(Math.ceil(width / 2), Math.ceil(height / 2));
    this.bokehTarget = colorTarget(Math.ceil(width / 2), Math.ceil(height / 2));
    this.mergeTarget = colorTarget(width, height);
    this.composite = makeQuad(compositeShader);
    this.downsample = makeQuad(downsampleShader);
    this.bokeh = makeQuad(bokehShader);
    this.merge = makeQuad(mergeShader);
    this.final = makeQuad(finalShader);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.45, 0.22, 2.2);
    this.dofEnabled = true;
    this.dslrEnabled = true;
    this.focusDistance = 10;
    this.clearColor = new THREE.Color(0, 0, 0);
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.sceneTarget.setSize(width, height);
    this.waterTarget.setSize(width, height);
    this.compositeTarget.setSize(width, height);
    this.halfTarget.setSize(Math.ceil(width / 2), Math.ceil(height / 2));
    this.bokehTarget.setSize(Math.ceil(width / 2), Math.ceil(height / 2));
    this.mergeTarget.setSize(width, height);
    this.bloom.setSize(width, height);
  }

  render({ scene, camera, water, fireflies, lighting, time }) {
    const renderer = this.renderer;
    renderer.setClearColor(this.clearColor, 0);

    camera.layers.set(0);
    renderer.shadowMap.needsUpdate = true;
    renderer.setRenderTarget(this.sceneTarget);
    renderer.clear();
    renderer.render(scene, camera);

    water.update(camera, this.sceneTarget, time, lighting);
    fireflies.material.uniforms.tSceneDepth.value = this.sceneTarget.depthTexture;
    fireflies.material.uniforms.uResolution.value.set(this.width, this.height);
    camera.layers.set(WATER_LAYER);
    renderer.setRenderTarget(this.waterTarget);
    renderer.clear();
    renderer.render(scene, camera);
    camera.layers.set(0);

    const composite = this.composite.material.uniforms;
    composite.tScene.value = this.sceneTarget.texture;
    composite.tSceneDepth.value = this.sceneTarget.depthTexture;
    composite.tWater.value = this.waterTarget.texture;
    composite.tWaterDepth.value = this.waterTarget.depthTexture;
    composite.uNear.value = camera.near;
    composite.uFar.value = camera.far;
    composite.uFocus.value = this.focusDistance;
    const maxCoc = Math.round(this.height / 1080 * 13);
    composite.uMaxCoc.value = maxCoc;
    renderer.setRenderTarget(this.compositeTarget);
    this.composite.render(renderer);

    let bloomInput = this.compositeTarget;
    if (this.dofEnabled) {
      this.downsample.material.uniforms.tColor.value = this.compositeTarget.texture;
      this.downsample.material.uniforms.uTexel.value.set(1 / this.width, 1 / this.height);
      renderer.setRenderTarget(this.halfTarget);
      this.downsample.render(renderer);

      this.bokeh.material.uniforms.tColor.value = this.halfTarget.texture;
      this.bokeh.material.uniforms.uTexel.value.set(1 / this.halfTarget.width, 1 / this.halfTarget.height);
      this.bokeh.material.uniforms.uMaxCoc.value = maxCoc;
      renderer.setRenderTarget(this.bokehTarget);
      this.bokeh.render(renderer);

      this.merge.material.uniforms.tSharp.value = this.compositeTarget.texture;
      this.merge.material.uniforms.tBlur.value = this.bokehTarget.texture;
      renderer.setRenderTarget(this.mergeTarget);
      this.merge.render(renderer);
      bloomInput = this.mergeTarget;
    }

    this.bloom.strength = lighting.bloomStrength;
    this.bloom.render(renderer, null, bloomInput, 0, false);

    const final = this.final.material.uniforms;
    final.tColor.value = bloomInput.texture;
    final.uExposure.value = lighting.exposure;
    final.uContrast.value = lighting.contrast;
    final.uWarmth.value = lighting.warmth;
    final.uSaturation.value = lighting.saturation;
    final.uDslr.value = this.dslrEnabled ? 1 : 0;
    final.uTime.value = time;
    final.uResolution.value.set(this.width, this.height);
    renderer.setRenderTarget(null);
    this.final.render(renderer);
  }
}
