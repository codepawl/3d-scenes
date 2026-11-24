// Deterministic frame capture: builds nothing itself; serves dist/ with `vite preview`,
// drives ?capture=1 in headless Chromium (GPU flags), pipes PNG frames into ffmpeg.
// Usage: node scripts/capture.mjs [out.mp4] [frames]   (run `npm run build` first)
import { preview } from 'vite';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import os from 'node:os';

const out = resolve(process.argv[2] || '../render.mp4');
const frames = parseInt(process.argv[3] || '180', 10);
const aa = process.env.CAPTURE_AA || '3';

// Find a Chromium: CHROME_PATH, else the newest Playwright-managed build.
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),
    join(os.homedir(), '.cache', 'ms-playwright'),
    join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
  ].filter(Boolean);
  const rels = [
    ['chrome-win64', 'chrome.exe'], ['chrome-win', 'chrome.exe'], ['chrome-linux64', 'chrome'], ['chrome-linux', 'chrome'],
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ];
  for (const r of roots) {
    if (!existsSync(r)) continue;
    const dirs = readdirSync(r).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => +b.split('-')[1] - +a.split('-')[1]);
    for (const d of dirs) for (const rel of rels) {
      const p = join(r, d, ...rel);
      if (existsSync(p)) return p;
    }
  }
  return undefined; // let playwright try its default
}

const server = await preview({ preview: { port: 4179, strictPort: false, open: false } });
const url = server.resolvedUrls.local[0];
const launchArgs = { headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] };
// Prefer an installed Google Chrome; fall back to CHROME_PATH / a Playwright-managed Chromium.
let browser;
try {
  browser = process.env.CHROME_PATH
    ? await chromium.launch({ ...launchArgs, executablePath: process.env.CHROME_PATH })
    : await chromium.launch({ ...launchArgs, channel: 'chrome' });
} catch (e) {
  console.warn('system Chrome not usable, trying Playwright Chromium:', String(e.message).slice(0, 200));
  browser = await chromium.launch({ ...launchArgs, executablePath: findChrome() });
}
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => console.log('[page]', m.text()));
await page.goto(`${url}?capture=1&aa=${aa}`);
await page.waitForFunction(() => window.__captureReady === true);

if (process.env.BENCH) {
  await page.evaluate(() => window.benchFrames(5));
  console.log('ms/frame at aa=' + aa + ':', (await page.evaluate(() => window.benchFrames(60))).toFixed(2));
}
if (process.env.STILLS) {
  // quick look: STILLS=0,90,179 writes PNGs next to the output path instead of a video
  const { writeFileSync } = await import('node:fs');
  for (const n of process.env.STILLS.split(',').map(Number)) {
    const t = Date.now();
    const d = await page.evaluate(async (i) => { await window.renderFrame(i); return document.querySelector('canvas').toDataURL('image/png'); }, n);
    writeFileSync(`${out}.${n}.png`, Buffer.from(d.split(',')[1], 'base64'));
    console.log('still', n, Date.now() - t, 'ms');
  }
  await browser.close(); server.httpServer.close(); process.exit(0);
}

const ff = spawn('ffmpeg', [
  '-y', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', '-',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-r', '30', '-movflags', '+faststart', out,
], { stdio: ['pipe', 'inherit', 'inherit'] });

const t0 = Date.now();
for (let n = 0; n < frames; n++) {
  const dataUrl = await page.evaluate(async (i) => {
    await window.renderFrame(i);
    return document.querySelector('canvas').toDataURL('image/png');
  }, n);
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (n % 30 === 0) console.log(`frame ${n}/${frames} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
server.httpServer.close();
console.log('wrote', out);
