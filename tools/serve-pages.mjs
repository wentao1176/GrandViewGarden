// 本地模拟 GitHub Pages（项目站点子路径 /GrandViewGarden/）。
// 用法：node tools/serve-pages.mjs [--port=8099] [--base=/GrandViewGarden/]
// 说明：Pages 会把仓库根目录静态托管在 https://<user>.github.io/<repo>/，
//      本项目为单文件 index.html（资源全部内联），因此只需把仓库根目录挂到子路径即可等价验证。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const i = a.indexOf('=');
  return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)];
}));
const port = Number(argv.port || 8099);
const base = String(argv.base || '/GrandViewGarden/');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.nojekyll': 'text/plain',
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith(base)) {
      res.writeHead(302, { Location: base });
      res.end();
      return;
    }
    let rel = decodeURIComponent(url.pathname.slice(base.length));
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    const p = path.join(root, rel);
    if (!p.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
    const st = await stat(p);
    if (st.isDirectory()) { res.writeHead(302, { Location: base + rel.replace(/\/?$/, '/') }); res.end(); return; }
    const data = await readFile(p);
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found（GitHub Pages 会返回 404.html，本项目单页无需额外路由）');
  }
});
server.listen(port, '127.0.0.1', () => {
  console.log(`[Pages 本地模拟] http://127.0.0.1:${port}${base}`);
  console.log(`将仓库根目录 ${root} 挂载于子路径 ${base}`);
});
