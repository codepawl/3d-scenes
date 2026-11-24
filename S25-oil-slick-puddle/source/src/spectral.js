// Spectral -> RGB weights for the thin-film shader.
// CIE 1931 colour-matching functions via the multi-lobe Gaussian fit of
// Wyman, Sloan & Shirley, "Simple Analytic Approximations to the CIE XYZ Color Matching Functions", JCGT 2013.
const g = (x, mu, s1, s2) => {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
};
const cie = (l) => [
  1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2),
  0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1),
  1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8),
];
// XYZ -> linear sRGB (D65)
const toRGB = ([x, y, z]) => [
  3.2406 * x - 1.5372 * y - 0.4986 * z,
  -0.9689 * x + 1.8758 * y + 0.0415 * z,
  0.0557 * x - 0.204 * y + 1.057 * z,
];

export function filmWeights(n, l0, l1) {
  const lambdas = [];
  const weights = [];
  const sum = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const l = l0 + ((l1 - l0) * i) / (n - 1);
    const w = toRGB(cie(l));
    lambdas.push(l);
    weights.push(w);
    for (let c = 0; c < 3; c++) sum[c] += w[c];
  }
  // normalise so a spectrally flat reflectance of 1 maps to RGB (1,1,1)
  return { lambdas, weights: weights.map((w) => w.map((v, c) => v / sum[c])) };
}
