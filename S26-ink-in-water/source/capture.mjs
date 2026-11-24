// Renders render.mp4 deterministically: ?capture=1 drives time from a frame counter (1/30 s per frame).
// Usage: node capture.mjs [frames=180] [out=../render.mp4]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const frames = Number(process.argv[2] || 180);
const out = path.resolve(process.argv[3] || '../render.mp4');
const stillsDir = process.env.STILLS_DIR || '';

const server = await createServer({ logLevel: 'error', server: { port: 5199, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0] + '?capture=1';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader=false'],
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

const t0 = Date.now();
for (let i = 0; i < frames; i++) {
  const dataUrl = await page.evaluate(async (n) => {
    await window.renderFrame(n);
    return document.querySelector('canvas').toDataURL('image/png');
  }, i);
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (stillsDir && [0, Math.floor(frames / 2), frames - 1].includes(i)) {
    fs.mkdirSync(stillsDir, { recursive: true });
    fs.writeFileSync(path.join(stillsDir, `frame_${String(i).padStart(3, '0')}.png`), buf);
  }
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (i % 30 === 0) console.log(`frame ${i}/${frames}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
await server.close();
console.log('wrote', out);
