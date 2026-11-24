// Renders render.mp4 (6 s, 1280x720, 30 fps) from the capture mode of the scene.
// Usage: npm run capture   (from source/; set GPU_LOCK to queue through the shared-GPU lock in a wrapper)
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.resolve(root, '..', process.env.OUT || 'render.mp4');
const frames = Number(process.env.FRAMES || 180);
const tmp = process.env.FRAMES_DIR ? path.resolve(process.env.FRAMES_DIR) : path.join(os.tmpdir(), 's33-rainy-window-frames');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const server = await createServer({ root, logLevel: 'error', server: { port: 5199, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0] + '?capture=1';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
await page.goto(url);
await page.waitForFunction(() => window.captureReady === true, null, { timeout: 60000 });
const renderer = await page.evaluate(() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log('GPU:', renderer);

const ms = await page.evaluate(() => window.bench(120));
console.log(`GPU frame time at 1280x720: ${ms.toFixed(2)} ms (${(1000 / ms).toFixed(0)} fps)`);
const t0 = Date.now();
for (let n = 0; n < frames; n++) {
  const data = await page.evaluate(async (i) => {
    await window.renderFrame(i);
    return document.querySelector('canvas').toDataURL('image/png');
  }, n);
  writeFileSync(path.join(tmp, `f${String(n).padStart(4, '0')}.png`), Buffer.from(data.split(',')[1], 'base64'));
  if (n % 30 === 0) console.log(`frame ${n}/${frames}`);
}
console.log(`captured ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await browser.close();
await server.close();

await new Promise((res, rej) => {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(tmp, 'f%04d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', out],
    { stdio: 'inherit' });
  ff.on('exit', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c))));
});
if (!process.env.KEEP_FRAMES) rmSync(tmp, { recursive: true, force: true });
console.log('wrote', out);
