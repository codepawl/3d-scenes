import { common } from './common.glsl.js';

export const groundVertex = /* glsl */ `
${common}
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const groundFragment = /* glsl */ `
${common}
uniform vec3 uCamPos;
uniform vec3 uMoonColor;
varying vec3 vWorldPos;
void main() {
  vec2 p = vWorldPos.xz;
  vec3 V = normalize(uCamPos - vWorldPos);
  float d = length(vWorldPos - uCamPos);

  // soil: clods, damp patches, straw litter
  float clods = fbm5(p * 3.0);
  float damp = smoothstep(0.45, 0.7, fbm3(p * 0.25 + 3.0));
  vec3 soil = mix(vec3(0.16, 0.12, 0.085), vec3(0.24, 0.19, 0.13), clods);
  soil = mix(soil, soil * 0.55, damp);
  float litter = smoothstep(0.72, 0.9, vnoise(vec2(p.x * 30.0, p.y * 4.0) + vnoise(p * 5.0) * 3.0));
  soil = mix(soil, vec3(0.45, 0.37, 0.22), litter * 0.6);

  // far away the ground stands in for the canopy tops so gaps between blades never read as holes
  vec3 canopy = vec3(0.60, 0.48, 0.28) * (0.8 + 0.4 * fbm3(p * 0.15));
  float g = gustField(p, uTime);
  float farMix = smoothstep(15.0, 60.0, d);
  float cloud = smoothstep(0.35, 0.75, fbm3(p * 0.018 - uWindDir * uTime * 0.6 + 5.0));
  float shadow = mix(1.0, 0.55, cloud);

  // under the crop: moonlight filtered through the canopy as dapples, plus sky ambient and warm bounce off the straw
  float dapple = smoothstep(0.35, 0.75, vnoise(p * 3.5 + uWindDir * uTime * 0.8)) * 0.6 + 0.4 * vnoise(p * 11.0);
  // stalk bases and their small contact shadows: dark dots on a jittered grid
  vec2 cell = floor(p * 9.0);
  vec2 cp = fract(p * 9.0) - 0.5 - (vec2(hash12(cell), hash12(cell + 7.1)) - 0.5) * 0.7;
  float stalk = smoothstep(0.16, 0.05, length(cp));
  float contact = smoothstep(0.45, 0.1, length(cp));
  soil = mix(soil, vec3(0.30, 0.25, 0.16), stalk * 0.7);           // pale cut-straw base
  float occl = 1.0 - contact * 0.35;
  vec3 nearCol = soil * (uMoonColor * (0.2 + 0.45 * dapple) + vec3(0.08, 0.09, 0.12) + vec3(0.07, 0.055, 0.03)) * occl * 1.3;
  vec3 farCol = canopy * (uMoonColor * 0.5 * (0.3 + 0.7 * smoothstep(0.05, 1.0, g)) * 0.7 + vec3(0.04, 0.05, 0.08));
  vec3 col = mix(nearCol, farCol, farMix) * shadow;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, lum * vec3(0.78, 0.9, 1.15), 0.08);

  float fog = 1.0 - exp(-d * 0.015);
  fog = fog * fog * (3.0 - 2.0 * fog) * 0.92;
  vec3 fogCol = skyBase(-V);
  // beyond the field: dark distant land that meets the treeline silhouette
  fogCol = mix(fogCol, skyBase(vec3(-V.x, 0.0, -V.z)) * 0.5, smoothstep(160.0, 320.0, d));
  col = mix(col, fogCol, max(fog, smoothstep(160.0, 320.0, d)));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += dither(gl_FragCoord.xy, uTime);
}
`;
