// Renders the scene frame by frame in headless Chrome (?capture=1) and encodes render.mp4 with ffmpeg.
// Usage: node scripts/capture.mjs [frames=180] [out=../render.mp4]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frames = Number(process.argv[2] ?? 180);
const out = resolve(root, process.argv[3] ?? '../render.mp4');
const only = process.env.CAPTURE_STILLS; // e.g. "0,90,179" -> write PNGs only
const frameDir = join(tmpdir(), `v02-frames-${process.pid}`);
mkdirSync(frameDir, { recursive: true });

const server = await createServer({ root, logLevel: 'error', server: { port: 5199, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0] + '?capture=1';

const browser = await chromium.launch({
  channel: process.env.CHROME_CHANNEL ?? 'chrome',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.captureReady === true, null, { timeout: 60000 });
const gpu = await page.evaluate(() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log('renderer:', gpu);

const list = only ? only.split(',').map(Number) : [...Array(frames).keys()];
const t0 = Date.now();
for (const n of list) {
  const data = await page.evaluate(async (f) => {
    await window.renderFrame(f);
    return document.querySelector('canvas').toDataURL('image/png');
  }, n);
  const file = only ? resolve(root, `../still_${String(n).padStart(3, '0')}.png`) : join(frameDir, `f${String(n).padStart(4, '0')}.png`);
  writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
  if (n % 30 === 0) console.log(`frame ${n} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
const st = await page.evaluate(() => window.simStats);
if (st) console.log(`physics per 60 Hz frame: avg ${(st.sum / st.n).toFixed(2)} ms, max ${st.max.toFixed(2)} ms`);
await browser.close();
await server.close();

if (!only) {
  await new Promise((res, rej) => {
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', join(frameDir, 'f%04d.png'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-r', '30', out], { stdio: 'inherit' });
    ff.on('exit', (c) => (c === 0 ? res() : rej(new Error('ffmpeg failed ' + c))));
  });
  console.log('wrote', out);
}
rmSync(frameDir, { recursive: true, force: true });
