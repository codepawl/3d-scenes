// Quick live-mode frame-rate probe at 1280x720 (headless Chrome, GPU).
import { createServer } from 'vite';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, logLevel: 'error', server: { port: 5198, strictPort: false } });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(server.resolvedUrls.local[0]);
await page.waitForTimeout(2000);
const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); };
  requestAnimationFrame(f);
}));
console.log('fps:', fps.toFixed(1));
await browser.close(); await server.close();
