// Renders render.mp4 (6 s, 1280x720, 30 fps) deterministically via ?capture=1 and window.renderFrame(n).
// Usage: node scripts/capture.mjs [out.mp4] [frames]
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.resolve(process.argv[2] || path.join(root, '..', 'render.mp4'));
const FRAMES = Number(process.argv[3] || 180);
const stillsArg = process.env.STILLS_DIR ? path.resolve(process.env.STILLS_DIR) : null;

const server = await createServer({ root, logLevel: 'error', server: { port: 5199, strictPort: false } });
await server.listen();
const url = `${server.resolvedUrls.local[0]}?capture=1`;

const args = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--window-size=1280,720'];
let browser;
for (const channel of ['chrome', 'msedge', 'chromium']) {
  try { browser = await chromium.launch({ channel, headless: true, args }); break; } catch (e) { /* try next */ }
}
if (!browser) throw new Error('No Chrome/Edge/Chromium found for Playwright');
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.error('[pageerror]', e));
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

const fs = await import('node:fs');
const t0 = Date.now();
for (let n = 0; n < FRAMES; n++) {
  const dataUrl = await page.evaluate(async (i) => {
    await window.renderFrame(i);
    return document.querySelector('canvas').toDataURL('image/png');
  }, n);
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  if (stillsArg && (n === 0 || n === Math.floor(FRAMES / 2) || n === FRAMES - 1)) {
    fs.mkdirSync(stillsArg, { recursive: true });
    fs.writeFileSync(path.join(stillsArg, `frame_${String(n).padStart(3, '0')}.png`), buf);
  }
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (n % 30 === 0) console.log(`frame ${n}/${FRAMES} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
ff.stdin.end();
await new Promise((r, j) => ff.on('close', (c) => (c === 0 ? r() : j(new Error('ffmpeg exit ' + c)))));
await browser.close();
await server.close();
console.log('wrote', out);
