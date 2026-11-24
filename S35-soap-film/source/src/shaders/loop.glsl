// hand-bent loop radius; must match loopRadius() in main.js
float loopR(float th) {
  return 1.0 + 0.022 * sin(3.0 * th + 0.7) + 0.014 * sin(5.0 * th + 2.1) + 0.01 * sin(2.0 * th - 0.4);
}
// breeze strength, 0..~1
float gust(float t) {
  return 0.55 + 0.22 * sin(0.95 * t + 0.3) + 0.13 * sin(2.3 * t + 1.0) + 0.07 * sin(4.7 * t + 2.0);
}
// out-of-plane displacement of the film at local (x,y)
float filmDisp(vec2 p, float t) {
  float th = atan(p.y, p.x);
  float u = length(p) / loopR(th);
  float m = max(1.0 - u * u, 0.0);
  float g = gust(t);
  // uniform-pressure membrane = paraboloid; breeze is lopsided so add a tilt term
  float w = 0.26 * g * m * (1.0 + 0.22 * p.x * sin(0.6 * t) - 0.12 * p.y);
  // travelling ripples from turbulence in the breeze
  w += m * g * (0.016 * sin(5.5 * p.x + 2.5 * p.y - 6.0 * t) + 0.010 * sin(-3.5 * p.x + 7.5 * p.y - 4.3 * t + 1.0));
  w += m * m * 0.012 * sin(9.0 * length(p - vec2(0.3, -0.2)) - 8.0 * t);
  return w;
}
