// Deterministic frame capture: builds nothing, serves dist/ via `vite preview`,
// drives headless Chrome with Playwright, encodes with ffmpeg.
// Usage: node capture.mjs [--frames 180] [--out ../render.mp4] [--spp 6] [--stills 0,90,179] [--bench]
import { preview } from 'vite';
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const FRAMES = Number(opt('frames', 180));
const OUT = path.resolve(opt('out', '../render.mp4'));
const SPP = Number(opt('spp', 6));
const STILLS = opt('stills', null);
const BENCH = args.includes('--bench');

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const server = await preview({ root: ROOT, preview: { port: 4317, strictPort: false, open: false }, logLevel: 'warn' });
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

async function grab(n) {
  return page.evaluate(async (i) => {
    await window.renderFrame(i);
    return document.querySelector('canvas').toDataURL('image/png');
  }, n);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-frames-'));
try {
  if (BENCH) {
    await page.goto(`${url}?capture=1&spp=1`);
    await page.waitForFunction(() => window.captureReady === true);
    const ms = await page.evaluate(async () => {
      for (let i = 0; i < 10; i++) await window.renderFrame(i);
      const t0 = performance.now();
      const gl = document.querySelector('canvas').getContext('webgl2'); const px = new Uint8Array(4);
      for (let i = 0; i < 60; i++) { await window.renderFrame(i * 3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      return (performance.now() - t0) / 60;
    });
    console.log(`bench: ${ms.toFixed(2)} ms/frame at 1280x720, 1 spp (${(1000 / ms).toFixed(1)} fps)`);
  } else {
    await page.goto(`${url}?capture=1&spp=${SPP}`);
    await page.waitForFunction(() => window.captureReady === true);
    if (STILLS) {
      for (const s of STILLS.split(',').map(Number)) {
        const data = await grab(s);
        const f = path.resolve(`still_${String(s).padStart(3, '0')}.png`);
        fs.writeFileSync(f, Buffer.from(data.split(',')[1], 'base64'));
        console.log('wrote', f);
      }
    } else {
      for (let n = 0; n < FRAMES; n++) {
        const data = await grab(n);
        fs.writeFileSync(path.join(tmp, `f_${String(n).padStart(4, '0')}.png`), Buffer.from(data.split(',')[1], 'base64'));
        if (n % 30 === 0) console.log(`frame ${n}/${FRAMES}`);
      }
      const r = spawnSync('ffmpeg', [
        '-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(tmp, 'f_%04d.png'),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', OUT,
      ], { stdio: 'inherit' });
      if (r.status !== 0) throw new Error('ffmpeg failed');
      console.log('wrote', OUT);
    }
  }
} finally {
  await browser.close();
  await new Promise((res) => server.httpServer.close(res));
  fs.rmSync(tmp, { recursive: true, force: true });
}
