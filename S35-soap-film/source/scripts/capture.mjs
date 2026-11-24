// Deterministic capture: build, serve dist, drive ?capture=1 in headless Chrome, pipe PNG frames to ffmpeg.
// usage: node scripts/capture.mjs [out.mp4] [frames] [startFrame]
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, process.argv[2] || '../render.mp4');
const frames = Number(process.argv[3] || 180);
const start = Number(process.argv[4] || 0); // preview helpers: first frame and stride
const step = Number(process.argv[5] || 1);

await build({ root, logLevel: 'warn' });
const server = await preview({ root, preview: { port: 4179, strictPort: false }, logLevel: 'warn' });
const url = server.resolvedUrls.local[0] + '?capture=1';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.captureReady === true, null, { timeout: 60000 });
console.log('renderer:', await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
}));

const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', '-',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-r', '30', '-movflags', '+faststart', out],
  { stdio: ['pipe', 'inherit', 'inherit'] });

const t0 = Date.now();
for (let n = 0; n < frames; n++) {
  const dataUrl = await page.evaluate(async (i) => {
    await window.renderFrame(i);
    return document.querySelector('canvas').toDataURL('image/png');
  }, start + n * step);
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (n % 30 === 0) console.log('frame', n);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
await new Promise((r) => server.httpServer.close(r));
console.log(`wrote ${out} (${frames} frames, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
