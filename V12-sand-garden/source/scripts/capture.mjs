// Deterministic frame capture: vite dev server + headless Chrome (playwright-core) + ffmpeg.
// Usage: node scripts/capture.mjs [out.mp4] [frames] [stillsDir]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.resolve(process.argv[2] || path.join(root, '..', 'render.mp4'));
const frames = parseInt(process.argv[3] || '180', 10);
const stills = process.argv[4] ? path.resolve(process.argv[4]) : null;

const server = await createServer({ root, logLevel: 'error', server: { port: 5199, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0] + '?capture=1';

const args = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
let browser;
for (const opt of [{ channel: 'chrome' }, {}, { channel: 'msedge' }]) {
  try { browser = await chromium.launch({ headless: true, args, ...opt }); break; } catch { /* try next */ }
}
if (!browser) throw new Error('No Chrome/Chromium/Edge found for playwright-core');
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('[page]', m.text()); });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.captureReady === true, null, { timeout: 180000 });
console.log('renderer:', await page.evaluate(() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
}));

const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', '-',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-r', '30', '-movflags', '+faststart', out],
  { stdio: ['pipe', 'inherit', 'inherit'] });

const t0 = Date.now();
for (let n = 0; n < frames; n++) {
  await page.evaluate((i) => window.renderFrame(i), n);
  const data = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
  const buf = Buffer.from(data.split(',')[1], 'base64');
  if (stills && (n === 0 || n === Math.floor(frames / 2) || n === frames - 1)) {
    fs.mkdirSync(stills, { recursive: true });
    fs.writeFileSync(path.join(stills, `frame_${String(n).padStart(3, '0')}.png`), buf);
  }
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (n % 30 === 0) console.log('frame', n, ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
await server.close();
console.log('wrote', out);
