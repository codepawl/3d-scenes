// shoot.mjs ROOT OUTDIR W H name1=query1 name2=query2 ...
// Serves ROOT statically, opens ROOT/viewer/index.html?<query> in Chrome (GPU) and saves OUTDIR/<name>.png
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const [root, outdir, W, H, ...shots] = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
  const p = path.join(path.resolve(root), decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(path.resolve(root)) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;
fs.mkdirSync(outdir, { recursive: true });
const browser = await puppeteer.launch({ channel: 'chrome', headless: 'new', protocolTimeout: 900000,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader=false'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: +W, height: +H, deviceScaleFactor: 1 });
  page.on('console', m => console.error('[page]', m.type(), m.text())); page.on('requestfailed', r => console.error('[reqfail]', r.url())); page.on('response', r => { if (r.status() >= 400) console.error('[http]', r.status(), r.url()); });
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  for (const s of shots) {
    const i = s.indexOf('='); const name = s.slice(0, i), query = s.slice(i + 1);
    const t0 = Date.now();
    await page.goto(query.startsWith("/") ? `http://127.0.0.1:${port}${query}` : `http://127.0.0.1:${port}/viewer/index.html?${query}`);
    await page.waitForFunction('window.__ready === true', { timeout: +(process.env.SHOT_TIMEOUT || 600000) });
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(outdir, name + '.png') });
    const gpu = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; });
    console.log(name, `${Date.now() - t0} ms`, gpu);
  }
} finally { await browser.close(); server.close(); }
