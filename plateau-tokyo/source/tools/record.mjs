// record.mjs OUTDIR W H MB FMT (all | t1,t2,... ) [fps] [from] [to]
//   all        -> every frame 0..END at fps into OUTDIR/f_00000.FMT
//   t1,t2,...  -> stills OUTDIR/t_<t>.FMT
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const [outdir, W, H, MB, FMT, which, fpsArg, fromArg, toArg] = process.argv.slice(2);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
fs.mkdirSync(outdir, { recursive: true });
const log = fs.createWriteStream(path.join(outdir, 'record.log'), { flags: 'a' });
const say = s => { log.write(s + '\n'); console.log(s); };
const browser = await puppeteer.launch({ channel: 'chrome', headless: 'new', protocolTimeout: 1800000,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: +W, height: +H, deviceScaleFactor: 1 });
  page.on('console', m => { const t = m.text(); if (!/GPU stall/.test(t)) say('[page] ' + t); });
  page.on('pageerror', e => { say('[pageerror] ' + e.message); page.evaluate('window.__failed = true').catch(() => {}); });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${server.address().port}/film/index.html?w=${W}&h=${H}&mb=${MB}`);
  await page.waitForFunction('window.__ready === true || window.__failed === true', { timeout: 300000, polling: 1000 });
  if (await page.evaluate('window.__failed === true')) throw new Error('page error before ready');
  say(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${JSON.stringify(await page.evaluate('window.__info'))}`);
  const shot = async (t, file) => {
    await page.evaluate(t => window.renderAt(t), t);
    await page.screenshot({ path: file, type: FMT === 'png' ? 'png' : 'jpeg', ...(FMT === 'png' ? {} : { quality: 92 }) });
  };
  if (which === 'all') {
    const fps = +(fpsArg || 30), END = 48;
    const n = Math.round(END * fps), a = +(fromArg || 0), b = Math.min(+(toArg || n), n);
    const ts = Date.now();
    for (let i = a; i < b; i++) {
      await shot(i / fps, path.join(outdir, `f_${String(i).padStart(5, '0')}.${FMT}`));
      if (i % 30 === 0) say(`frame ${i}/${n}  ${((Date.now() - ts) / (i - a + 1)).toFixed(0)} ms/frame`);
    }
    say(`done ${b - a} frames in ${((Date.now() - ts) / 1000).toFixed(0)} s`);
  } else {
    for (const t of which.split(',').map(Number)) await shot(t, path.join(outdir, `t_${t.toFixed(2)}.${FMT}`));
    say('stills done');
  }
} finally { await browser.close(); server.close(); log.end(); }
