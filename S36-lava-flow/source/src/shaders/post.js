import { NOISE } from './common.js';
import { SKY_FN } from './terrain.js';

export const skyVert = /* glsl */ `
varying vec3 vDir;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w * 0.99999; // far plane
}
`;

export const skyFrag = /* glsl */ `
${NOISE}
${SKY_FN}
uniform float uTime;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  vec3 col = skyColor(d);
  // high streaky clouds, lit from below by the set sun, plus a dark volcanic gas plume drifting over
  if (d.y > -0.05){
    vec2 uv = d.xz / (d.y + 0.18);
    float c = fbm(uv * vec2(1.2, 3.0) + vec2(uTime * 0.01, 0.0), 5);
    c = smoothstep(0.05, 0.75, c) * smoothstep(-0.05, 0.12, d.y);
    float s = max(dot(d, uSunDir), 0.0);
    vec3 lit = mix(vec3(0.05, 0.045, 0.06), vec3(0.75, 0.32, 0.17), pow(s, 3.0) * 0.9 + 0.1);
    col = mix(col, lit * 0.6, c * 0.7);
    float plume = smoothstep(0.1, 0.8, fbm(uv * 0.8 + vec2(-uTime * 0.02, 4.0), 4) + 0.4 - abs(d.x + 0.25) * 2.0);
    col = mix(col, vec3(0.02, 0.018, 0.02) + vec3(0.25, 0.07, 0.02) * smoothstep(0.25, 0.0, d.y) * 0.35, plume * 0.55);
  }
  gl_FragColor = vec4(col, 0.0);
}
`;

export const fsVert = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// 13-tap downsample (Jimenez, "Next generation post processing in Call of Duty: AW"), Karis average on first level
export const downFrag = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uFirst;
varying vec2 vUv;
vec3 s(vec2 o){ return texture2D(tSrc, vUv + o * uTexel).rgb; }
float kw(vec3 c){ return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
void main(){
  vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
  vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
  vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
  vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
  vec3 g0 = (j + k + l + m) * 0.25, g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25;
  vec3 g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
  vec3 o;
  if (uFirst > 0.5){
    float w0 = kw(g0) * 0.5, w1 = kw(g1) * 0.125, w2 = kw(g2) * 0.125, w3 = kw(g3) * 0.125, w4 = kw(g4) * 0.125;
    o = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    o = g0 * 0.5 + (g1 + g2 + g3 + g4) * 0.125;
  }
  gl_FragColor = vec4(o, 1.0);
}
`;

export const upFrag = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel;
varying vec2 vUv;
vec3 s(vec2 o){ return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main(){
  vec3 o = s(vec2(0, 0)) * 4.0;
  o += (s(vec2(-1, 0)) + s(vec2(1, 0)) + s(vec2(0, -1)) + s(vec2(0, 1))) * 2.0;
  o += s(vec2(-1, -1)) + s(vec2(1, -1)) + s(vec2(-1, 1)) + s(vec2(1, 1));
  gl_FragColor = vec4(o / 16.0, 1.0);
}
`;

export const compositeFrag = /* glsl */ `
${NOISE}
uniform sampler2D tScene, tBloom;
uniform float uTime, uBloom, uExposure, uFrame;
uniform vec2 uRes;
varying vec2 vUv;

// ACES filmic fit (Krzysztof Narkowicz)
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

void main(){
  vec2 uv = vUv;
  // heat shimmer: hot air rises, so a pixel is disturbed by heat *below* it on screen
  float h = texture2D(tScene, uv).a * 0.5;
  float wsum = 0.5;
  for (int i = 1; i <= 7; i++){
    float fi = float(i);
    float w = 1.0 - fi / 8.0;
    h += texture2D(tScene, uv - vec2(0.0, fi * 0.016)).a * w;
    wsum += w;
  }
  h = smoothstep(0.05, 0.75, h / wsum);
  float asp = uRes.x / uRes.y;
  vec2 nuv = vec2(uv.x * asp, uv.y);
  vec2 off = vec2(snoise(nuv * vec2(16.0, 9.0) + vec2(0.0, -uTime * 1.9)),
                  snoise(nuv * vec2(13.0, 7.0) + vec2(5.3, -uTime * 1.5)));
  off += 0.5 * vec2(snoise(nuv * vec2(37.0, 21.0) + vec2(2.1, -uTime * 3.3)),
                    snoise(nuv * vec2(31.0, 18.0) + vec2(8.7, -uTime * 2.9)));
  vec2 duv = off * h * vec2(0.0022, 0.0032);
  vec3 col = texture2D(tScene, uv + duv).rgb;
  vec3 bloom = texture2D(tBloom, uv + duv).rgb;
  col += bloom * uBloom;

  // mild lens falloff
  vec2 vc = uv - 0.5;
  col *= 1.0 - 0.35 * dot(vc, vc) * 1.6;

  col = aces(col * uExposure);
  col = toSRGB(col);
  // grain + triangular dither (kills banding in the dark sky gradient)
  vec2 fc = gl_FragCoord.xy + uFrame * vec2(37.0, 17.0);
  float n1 = hash12(fc), n2 = hash12(fc + 71.3);
  col += (n1 + n2 - 1.0) / 255.0;
  col += (hash12(fc * 1.37 + 3.1) - 0.5) * 0.018 * (1.0 - col);
  gl_FragColor = vec4(col, 1.0);
}
`;
