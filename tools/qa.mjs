// 全量视觉审查：构建独立 HTML，批量截图所有景点/总览/移动端/昼夜，并收集错误与性能数据。
// usage: node tools/qa.mjs [--only=poi|all] [--width=1440 --height=900] [--wait=2200]
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
const waitMs = Number(argv.wait || 2200);
const W = Number(argv.width || 1440);
const H = Number(argv.height || 900);
const outDir = path.join(root, 'ref/qa');
await mkdir(outDir, { recursive: true });

// 构建独立 HTML
const result = await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true, format: 'iife', target: ['es2020'], write: false, minify: true,
  define: { __DEV__: 'false', __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
});
const js = result.outputFiles[0].text;
const css = await readFile(path.join(root, 'src/styles.css'), 'utf8');
const uiHtml = await readFile(path.join(root, 'src/ui/ui.html'), 'utf8').catch(() => '');
let tpl = await readFile(path.join(root, 'src/index.template.html'), 'utf8');
tpl = tpl.replace('/*__CSS__*/', () => css).replace('<!--__UI__-->', () => uiHtml).replace('/*__BUNDLE__*/', () => js);
const outHtml = path.join(outDir, 'index.html');
await writeFile(outHtml, tpl, 'utf8');

const { POIS } = await import(pathToFileURL(path.join(root, 'src/garden/layout.js')).href);
const views = [
  ['overview', 'overview', ''],
  ['gate', 'gate', ''],
  ['pond', 'pond', ''],
  ['top', 'top', ''],
  ['dusk', 'overview', 'tod=dusk'],
  ['night', 'gate', 'tod=night'],
  ...POIS.map((p) => [p.id, 'poi:' + p.id, '']),
];
const only = argv.only;
const filtered = only === 'poi' ? views.filter((v) => v[1].startsWith('poi:')) : views;

const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const errors = [];
const report = { views: [], buildStats: null };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('console', async (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    try {
      const args = await Promise.all(m.args().map(async (a) => {
        try { return await a.evaluate((o) => (o instanceof Error ? (o.stack || o.message) : typeof o === 'string' ? o : JSON.stringify(o))); }
        catch { return String(a); }
      }));
      if (m.type() === 'error') errors.push(args.join(' '));
    } catch { errors.push(m.text()); }
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  const base = pathToFileURL(outHtml).href;
  for (const [name, view, extra] of filtered) {
    const url = `${base}?shot=1&view=${encodeURIComponent(view)}${extra ? '&' + extra : ''}`;
    await page.goto(url, { waitUntil: 'load', timeout: 240000 });
    await page.waitForFunction('window.__GVG_READY__ === true', { timeout: 240000 });
    await page.evaluate(() => { document.getElementById('boot')?.remove(); document.body.classList.add('ui-hidden'); });
    await new Promise((r) => setTimeout(r, waitMs));
    const file = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    const info = await page.evaluate(() => ({ stats: window.GVG?.stats?.(), build: window.GVG?.buildInfo }));
    report.views.push({ name, view, extra, ...info });
    if (!report.buildStats && info.build) report.buildStats = info.build;
    console.log('saved', path.relative(root, file), info.stats ? `tris=${info.stats.tris} calls=${info.stats.calls}` : '');
  }
  // 移动端
  const m = await browser.newPage();
  await m.emulate({ viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
  m.on('pageerror', (e) => errors.push('MOBILE PAGEERROR ' + e.message));
  await m.goto(`${base}?view=overview`, { waitUntil: 'load', timeout: 240000 });
  await m.waitForFunction('window.__GVG_READY__ === true', { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 2600));
  await m.screenshot({ path: path.join(outDir, 'mobile-overview.png') });
  await m.goto(`${base}?view=poi:yihong`, { waitUntil: 'load', timeout: 240000 });
  await m.waitForFunction('window.__GVG_READY__ === true', { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 2400));
  await m.screenshot({ path: path.join(outDir, 'mobile-poi.png') });
  console.log('saved mobile screenshots');
  report.mobile = await m.evaluate(() => ({ stats: window.GVG?.stats?.() }));
} finally {
  await browser.close();
}
report.errors = [...new Set(errors)];
await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log('errors:', report.errors.length);
if (report.errors.length) console.log(report.errors.slice(0, 10).join('\n'));
console.log('report:', path.relative(root, path.join(outDir, 'report.json')));
process.exitCode = report.errors.length ? 2 : 0;
