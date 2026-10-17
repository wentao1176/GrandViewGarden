// 步行可达性快速检查：构建 → 进入步行 → 直接驱动 walker.update 若干秒 → 输出轨迹与截图
// usage: node tools/walk-check.mjs [--x=0 --z=-94 --heading=0 --seconds=6 --name=wc]
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const i = a.indexOf('=');
  return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)];
}));
const name = String(argv.name || 'wc');
const x0 = Number(argv.x ?? 0), z0 = Number(argv.z ?? -94), h0 = Number(argv.heading ?? 0);
const seconds = Number(argv.seconds ?? 6);
const width = Number(argv.width || 1280), height = Number(argv.height || 720);

const result = await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true, format: 'iife', target: ['es2020'], write: false, minify: false,
  define: { __DEV__: 'true', __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
});
const js = result.outputFiles[0].text;
const css = await readFile(path.join(root, 'src/styles.css'), 'utf8');
const uiHtml = await readFile(path.join(root, 'src/ui/ui.html'), 'utf8').catch(() => '');
let tpl = await readFile(path.join(root, 'src/index.template.html'), 'utf8');
tpl = tpl.replace('/*__CSS__*/', () => css).replace('<!--__UI__-->', () => uiHtml).replace('/*__BUNDLE__*/', () => js);
const outHtml = path.join(root, 'ref/preview', `${name}.html`);
await mkdir(path.dirname(outHtml), { recursive: true });
await writeFile(outHtml, tpl, 'utf8');

const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => p && existsSync(p));
const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 160)); });
  await page.goto(pathToFileURL(outHtml).href + '?shot=1&clean=1', { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction('window.__GVG_READY__ === true', { timeout: 240000 });
  const out = await page.evaluate(({ x0, z0, h0, seconds }) => {
    const app = window.GVG.app, wl = window.GVG.walker;
    app.setMode('walk');
    wl.teleport(x0, z0);
    wl.heading = h0; wl.applyCamera();
    const start = { x: wl.pos.x, y: wl.pos.y, z: wl.pos.z, blocked: wl.blocked(wl.pos.x, wl.pos.y + 0.02, wl.pos.z) };
    const log = [];
    wl.uiMove = { x: 0, z: 1, sprint: false };
    const n = Math.round(seconds / 0.05);
    for (let i = 0; i < n; i++) {
      wl.update(0.05);
      if (i % 20 === 0) log.push({ t: +(i * 0.05).toFixed(1), x: +wl.pos.x.toFixed(2), y: +wl.pos.y.toFixed(2), z: +wl.pos.z.toFixed(2), hint: wl._hint, door: wl._nearDoor?.label || null });
    }
    log.push({ t: seconds, x: +wl.pos.x.toFixed(2), y: +wl.pos.y.toFixed(2), z: +wl.pos.z.toFixed(2), hint: wl._hint, door: wl._nearDoor?.label || null });
    return { start, log, final: { x: wl.pos.x, y: wl.pos.y, z: wl.pos.z } };
  }, { x0, z0, h0, seconds });
  await page.screenshot({ path: `ref/shots/${name}.png` });
  console.log(JSON.stringify({ ...out, errors }, null, 1));
} finally {
  try { await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 4000))]); } catch {}
}
process.exit(errors.length ? 1 : 0);
