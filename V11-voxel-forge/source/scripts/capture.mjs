// Deterministic capture: serves the project with Vite, drives ?capture=1 in headless Chromium,
// pulls each frame with canvas.toDataURL and pipes PNGs into ffmpeg (H.264, yuv420p, crf 18).
// Usage: node scripts/capture.mjs [out.mp4] [frames] [--stills]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, '..', 'render.mp4'));
const FRAMES = parseInt(process.argv[3] || '180', 10);
const stillsDir = process.argv.includes('--stills') ? path.join(path.dirname(out), 'stills') : null;

const server = await createServer({ root, logLevel: 'error', server: { port: 5199, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0] + '?capture=1';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-vsync'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.captureReady === true, null, { timeout: 60000 });
console.log('renderer:', await page.evaluate(() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
}));

const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', '-',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-r', '30', '-movflags', '+faststart', out],
  { stdio: ['pipe', 'inherit', 'inherit'] });

if (stillsDir) fs.mkdirSync(stillsDir, { recursive: true });
const t0 = Date.now();
for (let n = 0; n < FRAMES; n++) {
  const data = await page.evaluate(async (n) => {
    await window.renderFrame(n);
    return document.querySelector('canvas').toDataURL('image/png');
  }, n);
  const buf = Buffer.from(data.split(',')[1], 'base64');
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (stillsDir && (n === 0 || n === Math.floor(FRAMES / 2) || n === FRAMES - 1 || process.argv.includes('--all')))
    fs.writeFileSync(path.join(stillsDir, `frame_${String(n).padStart(3, '0')}.png`), buf);
  if (n % 30 === 0) console.log(`frame ${n}/${FRAMES}`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
await server.close();
console.log(`wrote ${out} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
