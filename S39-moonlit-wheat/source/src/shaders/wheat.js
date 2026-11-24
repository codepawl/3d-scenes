import { common } from './common.glsl.js';

export const wheatVertex = /* glsl */ `
${common}
attribute vec2 aUV;          // x: -0.5..0.5 across, y: 0..1 along blade
attribute vec4 aInst;        // xz position, height (m), random 0..1
attribute vec2 aInst2;       // yaw (rad), static lean (rad)
uniform vec3  uCamPos;
uniform float uPixelK;       // world size of one pixel at 1 m distance

varying vec3  vWorldPos;
varying vec3  vNormal;
varying vec3  vTangent;
varying vec2  vUV;
varying float vRand;
varying float vGust;
varying float vHeight;

void main() {
  vec2 base = aInst.xy;
  float H = aInst.z;
  float rnd = aInst.w;
  float t = aUV.y;

  // width profile: thin stalk, spindle-shaped ear on the top third
  float earT = smoothstep(0.64, 0.70, t);
  float earShape = pow(sin(clamp((t - 0.64) / 0.36, 0.0, 1.0) * 3.14159), 0.6);
  float width = mix(0.0075, 0.026 + 0.008 * rnd, earT * earShape);
  width = mix(width, 0.003, smoothstep(0.97, 1.0, t));

  // keep distant blades >= ~1.3 px wide to cut shimmer
  float dist = length(vec3(base.x, H * 0.8, base.y) - uCamPos);
  width = max(width, dist * uPixelK * mix(0.4, 2.2 * earShape + 0.2, earT));

  // wind
  float g = gustField(base, uTime);
  float phase = rnd * 6.2831;
  float flutter = sin(uTime * (2.2 + rnd * 1.5) + phase + dot(base, uWindDir) * 0.7) * (0.04 + 0.10 * g);
  float sway = sin(uTime * 0.9 + phase * 0.5 + dot(base, uWindDir) * 0.15) * 0.06;
  float theta = aInst2.y + 0.08 + g * 0.7 + flutter + sway;   // bend angle at the tip

  float yaw = aInst2.x;
  vec2 leanDir = vec2(cos(yaw * 1.7), sin(yaw * 1.7));
  vec2 bdir2 = normalize(uWindDir * (0.6 + g) + leanDir * 0.35);
  vec3 bdir = vec3(bdir2.x, 0.0, bdir2.y);

  // constant-curvature arc: length preserving bend
  float th = abs(theta) < 1e-3 ? 1e-3 : theta;
  float a = th * t;
  float ax = (1.0 - cos(a)) / th * H;
  float ay = sin(a) / th * H;
  vec3 spine = vec3(base.x, 0.0, base.y) + bdir * ax + vec3(0.0, ay, 0.0);
  vec3 T = normalize(bdir * sin(a) + vec3(0.0, cos(a), 0.0));

  // width axis faces the camera so ears never go edge-on, with a bit of per-plant yaw
  vec3 toCam = uCamPos - spine;
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  side = normalize(mix(side, vec3(cos(yaw), 0.0, sin(yaw)), 0.2));
  vec3 pos = spine + side * aUV.x * width;
  vec3 N = normalize(cross(side, T));
  if (dot(N, toCam) < 0.0) N = -N;
  N = normalize(N + side * aUV.x * 1.6);  // fake round cross-section

  vWorldPos = pos;
  vNormal = N;
  vTangent = T;
  vUV = vec2(aUV.x, t);
  vRand = rnd;
  vGust = g;
  vHeight = H;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

export const wheatFragment = /* glsl */ `
${common}
uniform vec3 uCamPos;
uniform vec3 uMoonColor;
varying vec3  vWorldPos;
varying vec3  vNormal;
varying vec3  vTangent;
varying vec2  vUV;
varying float vRand;
varying float vGust;
varying float vHeight;

void main() {
  float t = clamp(vUV.y, 0.0, 1.0);
  float side = clamp(vUV.x * 2.0, -1.0, 1.0);  // MSAA can extrapolate varyings outside thin blades
  float ear = smoothstep(0.64, 0.70, t);
  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 N = normalize(vNormal);
  vec3 T = normalize(vTangent);
  vec3 L = uMoonDir;

  // ---- albedo: straw with per-plant ripeness, fibres, blotches, grime ----
  float r2 = hash12(vec2(vRand * 91.3, 4.1));
  vec3 straw = mix(vec3(0.62, 0.50, 0.30), vec3(0.48, 0.46, 0.27), r2);
  straw = mix(straw, vec3(0.72, 0.60, 0.38), smoothstep(0.8, 1.0, vRand));
  vec3 earCol = mix(vec3(0.74, 0.59, 0.33), vec3(0.58, 0.44, 0.23), r2);
  vec3 alb = mix(straw, earCol, ear);
  // per-blade tint: a few still greenish, some ruddy/over-ripe, brightness jitter
  float r3 = hash12(vec2(vRand * 17.7, 9.3));
  float r4 = hash12(vec2(vRand * 53.1, 2.7));
  vec3 tint = r3 < 0.18 ? vec3(0.9, 1.0, 0.86) : (r3 > 0.82 ? vec3(1.07, 0.95, 0.86) : vec3(1.0));
  alb *= tint * (0.8 + 0.4 * r4);
  float patchy = fbm3(vWorldPos.xz * 0.06 + 2.0);              // field-scale ripeness / lodging patches
  alb *= 0.7 + 0.55 * patchy;

  vec2 bp = vec2(side * 3.0 + vRand * 37.0, t * vHeight * 22.0);
  float fibre = vnoise(vec2(side * 20.0 + vRand * 13.0, t * 3.0));
  alb *= mix(0.97, 0.82 + 0.3 * fibre, 1.0 - smoothstep(12.0, 45.0, length(vWorldPos - uCamPos)));
  float blotch = smoothstep(0.62, 0.8, fbm3(bp * 0.9 + 11.0));
  alb = mix(alb, vec3(0.22, 0.17, 0.11), blotch * 0.65);
  float grime = 1.0 - smoothstep(0.0, 0.35, t);
  alb *= mix(1.0, 0.6 + 0.25 * vnoise(bp * 2.0), grime);
  float spk = 0.5 + 0.5 * sin(t * vHeight * 260.0 + sign(side) * 1.57);
  float nearDetail = 1.0 - smoothstep(12.0, 45.0, length(vWorldPos - uCamPos));
  alb *= mix(1.0, 0.78 + 0.32 * spk, ear * nearDetail);
  float rough = mix(0.55, 0.85, vnoise(bp * 1.3)) + blotch * 0.2;
  float node = smoothstep(0.015, 0.0, abs(fract(t * 3.2 + vRand) - 0.5) - 0.48);
  alb *= 1.0 - node * 0.25 * (1.0 - ear);

  // ---- lighting ----
  // gradual darkening toward the ground: bases sit in canopy shade but still get bounce + sky light
  float ao = mix(0.22, 1.0, pow(smoothstep(0.0, 0.88, t), 1.3));
  float cloud = smoothstep(0.35, 0.75, fbm3(vWorldPos.xz * 0.018 - uWindDir * uTime * 0.6 + 5.0));
  float shadow = mix(1.0, 0.55, cloud);

  float dcam = length(vWorldPos - uCamPos);
  float ndl = dot(N, L);
  float diff = clamp((ndl + 0.8) / 1.8, 0.0, 1.0);
  // backlit: light through the thin blade + silvery rim on the edges of the ears
  float back = pow(clamp(dot(-V, L) * 0.5 + 0.5, 0.0, 1.0), 4.0);
  float thin = mix(0.45, 1.0, ear) * (1.0 - abs(side) * 0.5);
  float trans = back * thin * mix(1.0, 0.35, smoothstep(25.0, 110.0, length(vWorldPos - uCamPos)));
  // moonlit edges: thin blade margins transmit/catch the light, strongest when backlit
  float edge = smoothstep(0.55, 1.0, abs(side));
  float rim = edge * (0.1 + back * back * 1.4) * mix(0.5, 1.0, ear);
  // anisotropic sheen along the fibres (Kajiya-Kay style)
  vec3 Hh = normalize(L + V);
  float tdh = dot(T, Hh);
  float sinTH = sqrt(max(1.0 - tdh * tdh, 0.0));
  float spec = pow(sinTH, mix(90.0, 25.0, rough)) * (1.0 - rough * 0.7);
  spec *= smoothstep(-0.2, 0.3, ndl) * (1.0 - 0.8 * smoothstep(25.0, 80.0, dcam));
  // gust: bent stalks tilt their ears up into the moonlight -> rolling bright waves
  float gs = smoothstep(0.05, 1.0, vGust);
  float gustLift = mix(0.75 + 0.3 * gs, (0.3 + 0.7 * gs) * 1.15, ear);  // gusts mostly lift the ears

  vec3 moon = uMoonColor * shadow;
  vec3 col = alb * moon * diff * ao * gustLift * 0.8;
  col += alb * vec3(1.0, 0.92, 0.75) * moon * trans * 1.0 * ao * gustLift;
  float rimFade = 1.0 - smoothstep(15.0, 50.0, dcam);   // keep the far field calm
  col += mix(vec3(0.85, 0.92, 1.0), alb * vec3(1.7, 1.45, 1.0), 0.65) * moon * rim * 0.5 * ao * (0.6 + 0.5 * gs) * rimFade;
  col += moon * spec * 0.35 * ao * gustLift;
  vec3 skyAmb = mix(vec3(0.012, 0.010, 0.008), vec3(0.030, 0.040, 0.070), N.y * 0.5 + 0.5);
  col += alb * skyAmb * ao * 2.6;
  // canopy fill: moonlight scattered down through the crop + warm bounce, reaches the lower stalks
  col += alb * (uMoonColor * 0.10 + vec3(0.035, 0.035, 0.04)) * shadow * sqrt(ao) * (1.0 - ear * 0.5);
  // scotopic shift: night vision loses saturation and leans blue
  // far blades converge on the same canopy colour the ground uses there (kills per-blade sparkle)
  vec3 canopy = vec3(0.60, 0.48, 0.28) * (0.8 + 0.4 * fbm3(vWorldPos.xz * 0.15));
  canopy *= (uMoonColor * 0.5 * (0.3 + 0.7 * gs) * 0.7 + vec3(0.04, 0.05, 0.08)) * shadow;
  col = mix(col, canopy, smoothstep(30.0, 85.0, dcam) * 0.85);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, lum * vec3(0.78, 0.9, 1.15), 0.08);

  float d = length(vWorldPos - uCamPos);
  float fog = 1.0 - exp(-d * 0.015);
  fog = fog * fog * (3.0 - 2.0 * fog) * 0.92;
  col = mix(col, skyBase(-V), fog);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += dither(gl_FragCoord.xy, uTime);
}
`;
