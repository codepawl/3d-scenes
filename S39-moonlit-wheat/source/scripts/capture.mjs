// Deterministic frame capture: starts a Vite preview server, drives ?capture=1 in headless Chrome,
// pipes PNG frames into ffmpeg (H.264, yuv420p, crf 18).
// Usage (from source/): npm run build && node scripts/capture.mjs [frames] [out.mp4] [--stills dir]
import { chromium } from 'playwright';
import { preview } from 'vite';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const stillsIdx = args.indexOf('--stills');
const stillsDir = stillsIdx >= 0 ? args.splice(stillsIdx, 2)[1] : null;
const frames = parseInt(args[0] || '180', 10);
const out = path.resolve(args[1] || '../render.mp4');

const server = await preview({ preview: { port: 4179, strictPort: false } });
const url = server.resolvedUrls.local[0] + '?capture=1';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.error('[pageerror]', e));
await page.goto(url);
await page.waitForFunction(() => window.captureReady === true, null, { timeout: 60000 });
const gpu = await page.evaluate(() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log('GPU:', gpu);

const ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', '30', '-i', '-', '-c:v', 'libx264',
  '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-r', '30', out], { stdio: ['pipe', 'inherit', 'inherit'] });

if (stillsDir) mkdirSync(stillsDir, { recursive: true });
const t0 = Date.now();
for (let n = 0; n < frames; n++) {
  const dataUrl = await page.evaluate((i) => window.renderFrame(i), n);
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (stillsDir && (n === 0 || n === Math.floor(frames / 2) || n === frames - 1)) {
    writeFileSync(path.join(stillsDir, `frame_${String(n).padStart(3, '0')}.png`), buf);
  }
  if (n % 30 === 0) console.log(`frame ${n}/${frames} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
server.httpServer.close();
console.log('wrote', out);
