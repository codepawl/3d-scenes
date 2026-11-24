// Tiny static server for web/. Usage: node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const port = Number(process.argv[2] ?? 5470);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' };

createServer(async (request, response) => {
  const urlPath = decodeURIComponent(new URL(request.url, 'http://x').pathname);
  const filePath = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(filePath);
    response.writeHead(200, { 'content-type': types[path.extname(filePath)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(data);
  } catch {
    response.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}/`));
