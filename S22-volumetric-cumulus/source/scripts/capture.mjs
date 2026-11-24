// Renders render.mp4 (6 s, 1280x720, 30 fps) from ?capture=1 using headless Chrome + ffmpeg.
// Usage: node scripts/capture.mjs [outFile] [frames]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, '..', 'render.mp4'));
const FRAMES = Number(process.argv[3] || 180);
const START = Number(process.argv[4] || 0);

const server = await createServer({ root, logLevel: 'error', server: { port: 5199, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0] + '?capture=1';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.captureReady === true, null, { timeout: 60000 });
console.log('GPU:', await page.evaluate(() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
}));

const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-i', '-',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-r', '30', out], { stdio: ['pipe', 'inherit', 'inherit'] });

const t0 = Date.now();
for (let n = START; n < START + FRAMES; n++) {
  const dataUrl = await page.evaluate(async (i) => {
    await window.renderFrame(i);
    return document.querySelector('canvas').toDataURL('image/png');
  }, n);
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (n % 30 === 0) console.log(`frame ${n}/${START + FRAMES} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
await server.close();
console.log('wrote', out);
