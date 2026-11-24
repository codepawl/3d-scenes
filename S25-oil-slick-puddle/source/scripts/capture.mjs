// Deterministic frame capture: vite dev server -> headless Chrome (GPU) -> PNG frames -> ffmpeg H.264.
// Usage: node scripts/capture.mjs [--frames 180] [--out ../render.mp4] [--stills 0,90,179]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const FRAMES = parseInt(arg('frames', '180'), 10);
const OUT = path.resolve(root, arg('out', '../render.mp4'));
const STILLS = arg('stills', null);
const framesDir = path.join(root, 'frames');
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });

const server = await createServer({ root, logLevel: 'error', server: { port: 5199, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0] + '?capture=1';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl2-compute-context'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.captureReady === true, null, { timeout: 60000 });
const gpu = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log('GPU:', gpu);

const list = STILLS ? STILLS.split(',').map(Number) : [...Array(FRAMES).keys()];
const t0 = Date.now();
for (const n of list) {
  await page.evaluate((k) => window.renderFrame(k), n);
  const data = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
  const name = STILLS ? `still_${String(n).padStart(4, '0')}.png` : `f_${String(n).padStart(4, '0')}.png`;
  fs.writeFileSync(path.join(framesDir, name), Buffer.from(data.split(',')[1], 'base64'));
}
console.log(`captured ${list.length} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await browser.close();
await server.close();

if (!STILLS) {
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(framesDir, 'f_%04d.png'),
     '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', OUT],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
  console.log('wrote', OUT);
}
