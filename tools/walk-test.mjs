// 步行模式 E2E：构建预览页 → 进入步行 → 传送到景点 → 截图 + 错误收集。
// usage: node tools/walk-test.mjs [--name=walk] [--poi=yihong] [--width=1280 --height=720]
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
const name = String(argv.name || 'walk');
const poi = String(argv.poi || 'yihong');
const width = Number(argv.width || 1280);
const height = Number(argv.height || 720);
const mobile = argv.mobile === true || argv.mobile === '1';

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

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = chromeCandidates.find((p) => p && existsSync(p));
if (!executablePath) { console.error('no chrome'); process.exit(1); }
const browser = await puppeteer.launch({
  executablePath, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=' + width + ',' + height],
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 200)); });
  const url = pathToFileURL(outHtml).href + '?shot=1&clean=1';
  await page.goto(url, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction('window.__GVG_READY__ === true', { timeout: 180000 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: `ref/shots/${name}-0-orbit.png` });
  // 进入步行
  const mode = await page.evaluate(() => window.GVG.app.setMode('walk'));
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: `ref/shots/${name}-1-walk.png` });
  // 传送到景点
  await page.evaluate((id) => window.GVG.app.goTo(id), poi);
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `ref/shots/${name}-2-poi.png` });
  // 键盘向前走（模拟真实操作；引擎会叠加 UI 摇杆状态）
  await page.keyboard.down('KeyW');
  await new Promise((r) => setTimeout(r, 2600));
  await page.keyboard.up('KeyW');
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: `ref/shots/${name}-3-move.png` });
  const state = await page.evaluate(() => ({
    mode: window.GVG.app.getMode(),
    view: window.GVG.app.getView(),
    stats: window.GVG.stats?.(),
    doors: (window.GVG.details?.doors || []).length,
    hint: window.GVG.walker?._hint,
    pos: window.GVG.walker?.pos,
  }));
  console.log(JSON.stringify({ mode, state, errors }, null, 2));
} finally { await browser.close(); }
process.exitCode = errors.length ? 1 : 0;
