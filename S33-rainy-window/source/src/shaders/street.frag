// Defocused night street seen far behind the glass. Everything is analytic: no textures.
precision highp float;

#define NL 64
uniform vec2 uRes;          // render-target resolution (px)
uniform float uTime;
uniform vec2 uSway;         // camera sway (parallax)
uniform vec4 uLightPos[NL]; // xy centre (aspect space), z radius, w intensity
uniform vec4 uLightCol[NL]; // rgb colour, w: >0.5 casts a road reflection
uniform int uCount;

in vec2 vUv;
out vec4 fragColor;

#include <common>

const float PI = 3.14159265;
const float HORIZON = -0.07;

// rounded-hexagon aperture with brighter rim, faint onion rings and lens dust
float aperture(vec2 d, float r, float rot, float seed, float px) {
  float ang = atan(d.y, d.x) + rot;
  float seg = mod(ang, PI / 3.0) - PI / 6.0;
  float hex = 0.8660254 / cos(seg);
  float rr = r * mix(1.0, hex, 0.28);
  float l = length(d);
  float m = smoothstep(rr + px, rr - px, l);
  float x = l / rr;
  float rim = smoothstep(0.55, 1.0, x);
  float rings = 0.5 + 0.5 * sin(x * 38.0 + seed * 6.0);
  float dust = vnoise(d / r * 7.0 + seed * 31.0);
  float dust2 = smoothstep(0.78, 0.9, vnoise(d / r * 15.0 + seed * 7.0));
  return m * (0.72 + 0.55 * rim * rim + 0.05 * rings + 0.12 * (dust - 0.5) - 0.18 * dust2);
}

vec3 skyAndCity(vec2 p) {
  // sky: navy to sodium-polluted glow at the horizon
  float h = p.y - HORIZON;
  vec3 sky = mix(vec3(0.050, 0.035, 0.050), vec3(0.008, 0.012, 0.030), smoothstep(0.0, 0.45, h));
  sky += vec3(0.10, 0.045, 0.02) * exp(-max(h, 0.0) * 9.0);
  // drifting low cloud lit from below
  float cl = fbm(vec2(p.x * 2.0 + uTime * 0.01, p.y * 5.0));
  sky *= 0.75 + 0.6 * cl;

  // soft building masses (already defocused), parallax-free far layer
  float bx = p.x * 5.0 + 1.3;
  float id = floor(bx);
  float bh = 0.08 + 0.32 * hash11(id) ;
  float edge = smoothstep(0.0, 0.25, fract(bx)) * smoothstep(1.0, 0.75, fract(bx));
  float bmask = smoothstep(bh + 0.04, bh - 0.04, h) * step(0.0, h + 0.2);
  vec3 bcol = vec3(0.012, 0.012, 0.018) * (0.7 + 0.6 * hash11(id + 4.0));
  // lit windows: soft rectangles
  vec2 w = vec2(fract(bx) * 6.0, h * 34.0);
  vec2 wi = floor(w) + id * 13.0;
  vec3 wh = hash32(wi);
  float lit = step(0.62, wh.x) * edge;
  vec2 wf = fract(w) - 0.5 - (wh.yz - 0.5) * 0.2;
  float wbox = exp(-dot(wf * vec2(3.0, 4.0), wf * vec2(3.0, 4.0)) * (1.5 + 2.0 * wh.y));
  vec3 wcol = mix(vec3(1.0, 0.62, 0.30), vec3(0.55, 0.75, 1.0), step(0.8, wh.y));
  bcol += wcol * wbox * lit * (0.05 + 0.12 * wh.z) * smoothstep(bh, bh - 0.05, h);
  vec3 col = mix(sky, bcol, bmask * step(-0.01, h));

  // wet road / pavement below the horizon
  if (h < 0.0) {
    float dd = -h;
    vec3 road = vec3(0.010, 0.010, 0.013) + vec3(0.06, 0.035, 0.02) * exp(-dd * 12.0);
    float puddle = smoothstep(0.45, 0.65, fbm(vec2(p.x * 3.0, p.y * 14.0)));
    road *= 0.7 + 0.5 * puddle;
    // kerb line
    road += vec3(0.05, 0.04, 0.03) * smoothstep(0.012, 0.0, abs(dd - 0.07));
    col = road;
  }
  // shop window glow, lower left and right
  col += vec3(0.30, 0.18, 0.09) * smoothstep(0.09, 0.0, abs(p.x + 0.62) - 0.12) *
         smoothstep(0.06, 0.0, abs(p.y - HORIZON - 0.06) - 0.04);
  col += vec3(0.10, 0.20, 0.26) * smoothstep(0.08, 0.0, abs(p.x - 0.70) - 0.10) *
         smoothstep(0.05, 0.0, abs(p.y - HORIZON - 0.05) - 0.03);
  return col;
}

void main() {
  float aspect = uRes.x / uRes.y;
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0) + uSway * 0.22;
  float px = 1.5 / uRes.y;

  vec3 col = skyAndCity(p);

  for (int i = 0; i < NL; i++) {
    if (i >= uCount) break;
    vec4 L = uLightPos[i];
    vec4 C = uLightCol[i];
    float r = L.z;
    vec2 d = p - L.xy;
    float seed = float(i) * 1.618;
    // road reflection: vertical smear under the light, rippled by wet tarmac
    if (C.w > 0.5) {
      float below = HORIZON - p.y;
      if (below > 0.0) {
        float ry = (HORIZON - (L.y - HORIZON) * 0.6);
        float rip = 0.010 * sin(p.y * 160.0 + uTime * 2.0 + seed) * smoothstep(0.0, 0.2, below);
        float sx = (p.x - L.x + rip) / (r * 0.75);
        float sy = (p.y - ry) / (r * 3.5);
        float s = exp(-sx * sx * 2.0) * exp(-sy * sy) * (0.6 + 0.4 * vnoise(vec2(p.x * 40.0, p.y * 9.0)));
        col += C.rgb * L.w * s * 0.10;
      }
    }
    // early out
    if (dot(d, d) > r * r * 1.7) continue;
    float rot = seed;
    float I = L.w * 0.0085 / (r * r + 0.002);
    // cat-eye vignetting: clip by a second, offset circle towards the frame edge
    vec2 ce = L.xy * 0.55;
    float cat = smoothstep(r * 1.18 + px, r * 1.18 - px, length(d + ce * r));
    vec3 a = vec3(aperture(d, r * 1.012, rot, seed, px),
                  aperture(d, r, rot, seed, px),
                  aperture(d, r * 0.985, rot, seed, px));
    col += C.rgb * a * cat * I;
  }
  fragColor = vec4(col, 1.0);
}
