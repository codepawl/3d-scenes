// Deterministic capture: Vite dev server + headless Chrome (GPU) + ffmpeg.
// usage: node scripts/capture.mjs [out.mp4] [frames] [stillsDir]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.resolve(process.argv[2] || path.join(root, '..', 'render.mp4'));
const FRAMES = parseInt(process.argv[3] || '180', 10);
const stillsDir = process.argv[4] ? path.resolve(process.argv[4]) : null;
const STILLS = { 3: 'start', 90: 'middle', 172: 'end' };

const server = await createServer({ root, logLevel: 'warn', server: { port: 5199, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0] + '?capture=1';

const launchOpts = { headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] };
let browser;
try { browser = await chromium.launch({ ...launchOpts, channel: 'chrome' }); }
catch { browser = await chromium.launch(launchOpts); }
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.captureReady === true, null, { timeout: 120000 });
console.log('renderer:', await page.evaluate(() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
}));

const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', '-',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-r', '30', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });

if (stillsDir) fs.mkdirSync(stillsDir, { recursive: true });
const t0 = Date.now();
for (let n = 0; n < FRAMES; n++) {
  const b64 = await page.evaluate(async (i) => { await window.renderFrame(i); return document.querySelector('canvas').toDataURL('image/png'); }, n);
  const buf = Buffer.from(b64.split(',')[1], 'base64');
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (stillsDir && STILLS[n]) fs.writeFileSync(path.join(stillsDir, `${STILLS[n]}.png`), buf);
  if (n % 30 === 0) console.log(`frame ${n}/${FRAMES}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
ff.stdin.end();
const code = await new Promise((r) => ff.on('close', r));
await browser.close();
await server.close();
console.log(code === 0 ? `wrote ${out}` : `ffmpeg failed (${code})`);
process.exit(code === 0 ? 0 : 1);
