// Local production-build check. A fresh port provides a fresh browser cache.
// Only model transfers are rate-limited; this is not a whole-network emulator.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('.vercel/output/static');
const port = Number(process.env.PREVIEW_PORT || 4327);
const mbps = Number(process.env.MODEL_MBPS || 10);
const pending = new Set();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
setInterval(() => {
  const quota = Math.max(1, Math.floor(mbps * 1e6 / 8 / 20 / Math.max(1, pending.size)));
  for (const job of pending) {
    if (job.response.destroyed) { pending.delete(job); continue; }
    if (job.response.writableNeedDrain) continue;
    const end = Math.min(job.offset + quota, job.data.length);
    job.response.write(job.data.subarray(job.offset, end)); job.offset = end;
    if (end === job.data.length) { job.response.end(); pending.delete(job); }
  }
}, 50).unref();
http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    let path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (path !== root && !path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    const data = await readFile(path);
    response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': 'no-store' });
    if (url.pathname.startsWith('/models/') && mbps > 0) pending.add({ response, data, offset: 0 });
    else response.end(data);
  } catch { response.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Preview http://127.0.0.1:${port} — model budget ${mbps} Mbps`));
