// Rough GPU timing at 1280x720 with ss=1 (interactive settings): node scripts/bench.mjs
import { chromium } from 'playwright';
import { preview } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await preview({ root, logLevel: 'warn', preview: { port: 4318, open: false } });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(server.resolvedUrls.local[0] + '?capture=1&ss=1');
await page.waitForFunction(() => window.__ready === true);
const ms = await page.evaluate(async () => {
  for (let i = 0; i < 10; i++) await window.renderFrame(i);
  const t0 = performance.now();
  for (let i = 0; i < 120; i++) await window.renderFrame(i);
  return (performance.now() - t0) / 120;
});
console.log('avg frame (render + finish + rAF wait):', ms.toFixed(2), 'ms');
await browser.close();
await new Promise((r) => server.httpServer.close(r));
