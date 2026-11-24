// Measures GPU-synchronised frame time at 1920x1080 in headless Chromium.
// Usage: node tools/perf.mjs [--url http://localhost:5199] [--frames 90]
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const baseUrl = option('url', 'http://localhost:5199');
const frames = Number(option('frames', 90));

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(`${baseUrl}/?capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.creek?.ready, null, { timeout: 120000 });

const results = await page.evaluate(async (frameCount) => {
  const creek = window.creek;
  const gl = creek.app.renderer.getContext();
  const pixel = new Uint8Array(4);
  const measure = (label, setup) => {
    setup();
    creek.step(1 / 60, 10);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const started = performance.now();
    for (let index = 0; index < frameCount; index++) {
      creek.step(1 / 60);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    }
    const milliseconds = (performance.now() - started) / frameCount;
    return { label, milliseconds: Number(milliseconds.toFixed(2)), fps: Number((1000 / milliseconds).toFixed(1)) };
  };
  return [
    measure('afternoon dof', () => { creek.setPreset('afternoon'); creek.setToggle('dof', true); creek.placeAlongCreek(-6, 0.2, { pitch: -0.1 }); }),
    measure('afternoon no dof', () => { creek.setToggle('dof', false); }),
    measure('night dof', () => { creek.setPreset('night'); creek.setToggle('dof', true); }),
    measure('downstream dof', () => { creek.setPreset('afternoon'); creek.placeAlongCreek(30, 0, { pitch: -0.1 }); }),
  ];
}, frames);
const info = await page.evaluate(() => window.creek.stats());
console.log(JSON.stringify(results, null, 1));
console.log('draw calls', info.renderer.calls, 'triangles', info.renderer.triangles);
await browser.close();
