// 本地开发服务器：构建后以 http://127.0.0.1:8080 提供访问（可选）。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log('building…');
const r = spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs'), '--dev'], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    p = path.join(root, decodeURIComponent(p));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(p);
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
server.listen(8080, '127.0.0.1', () => console.log('dev server: http://127.0.0.1:8080'));
