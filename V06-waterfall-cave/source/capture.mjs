// Deterministic frame capture: builds, serves dist/, drives window.renderFrame(n) in headless Chrome, encodes with ffmpeg.
// Usage: node capture.mjs [--frames 180] [--out ../render.mp4] [--stills 0,90,179]
import { chromium } from 'playwright';
import { preview, build } from 'vite';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FRAMES = parseInt(opt('--frames', '180'), 10);
const OUT = path.resolve(here, opt('--out', '../render.mp4'));
const STILLS = opt('--stills', null);
const framesDir = path.join(here, '.frames');

await build({ root: here, logLevel: 'warn' });
const server = await preview({ root: here, preview: { port: 4183, strictPort: false }, logLevel: 'warn' });
const url = server.resolvedUrls.local[0] + '?capture=1' + (opt('--cam', null) ? '&cam=' + opt('--cam', null) : '');

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.captureReady === true, null, { timeout: 180000 });
console.log('renderer:', await page.evaluate(() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
}));

fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });
const list = STILLS ? STILLS.split(',').map(Number) : [...Array(FRAMES).keys()];
const t0 = Date.now();
for (const n of list) {
  const data = await page.evaluate(async (n) => {
    await window.renderFrame(n);
    return document.querySelector('canvas').toDataURL('image/png');
  }, n);
  fs.writeFileSync(path.join(framesDir, `f${String(n).padStart(4, '0')}.png`), Buffer.from(data.split(',')[1], 'base64'));
  if (n % 30 === 0) console.log(`frame ${n} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
if (args.includes('--perf')) {
  console.log('perf ms/frame (sim+mesh+render):', await page.evaluate(async () => {
    const t = performance.now(); for (let i = 0; i < 120; i++) await window.renderFrame(1000 + i);
    document.querySelector('canvas').getContext('webgl2').finish(); return (performance.now() - t) / 120; }));
}
await browser.close();
await server.close();

if (!STILLS) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(framesDir, 'f%04d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', OUT], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(1);
  console.log('wrote', OUT);
} else {
  console.log('stills in', framesDir);
}
