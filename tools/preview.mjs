// 团队成员预览工具：构建到独立文件并截图，避免并发覆盖共享产物。
// usage: node tools/preview.mjs --name=east --views=overview,yihong-overview [--width=1280 --height=720] [--mobile]
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
const name = String(argv.name || 'preview');
const width = Number(argv.width || 1280);
const height = Number(argv.height || 720);
const mobile = argv.mobile === true || argv.mobile === '1';
const views = String(argv.views || 'overview').split(';').flatMap((s) => s.split('|')).filter(Boolean);
const clean = argv.clean === true || argv.clean === '1';
const waitMs = Number(argv.wait || 2600);

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
].filter(Boolean);
const executablePath = chromeCandidates.find((p) => existsSync(p));
const browser = await puppeteer.launch({
  executablePath, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const errors = [];
try {
  const page = await browser.newPage();
  if (mobile) await page.emulate({ viewport: { width, height, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
  else await page.setViewport({ width, height, deviceScaleFactor: 1 });
  page.on('console', async (m) => {
    if (m.type() !== 'error') return;
    try {
      const args = await Promise.all(m.args().map(async (a) => {
        try { return await a.evaluate((o) => (o instanceof Error ? (o.stack || o.message) : (typeof o === 'string' ? o : JSON.stringify(o)))); }
        catch { return String(a); }
      }));
      errors.push(args.join(' '));
    } catch { errors.push(m.text()); }
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  const base = pathToFileURL(outHtml).href;
  const extra = argv.query ? String(argv.query) : '';
  for (const view of views) {
    const url = base + `?shot=1&view=${encodeURIComponent(view)}` + (extra ? `&${extra}` : '');
    await page.goto(url, { waitUntil: 'load', timeout: 180000 });
    try { await page.waitForFunction('window.__GVG_READY__ === true', { timeout: 180000 }); }
    catch { errors.push('READY_TIMEOUT ' + view); }
    if (clean) {
      await page.evaluate(() => {
        document.getElementById('boot')?.remove();
        document.body.classList.add('ui-hidden');
      });
    }
    await new Promise((r) => setTimeout(r, waitMs));
    const out = path.join(root, 'ref/shots', `${name}-${String(view).replace(/[^a-zA-Z0-9._-]+/g, '_')}.png`);
    await page.screenshot({ path: out });
    console.log('saved', path.relative(root, out));
  }
  const stats = await page.evaluate(() => (window.GVG?.buildInfo || window.GVG?.stats?.()) || null);
  if (stats) console.log('buildInfo', JSON.stringify(stats));
} finally { await browser.close(); }
if (errors.length) { console.error('console errors:\n' + [...new Set(errors)].slice(0, 15).join('\n')); process.exitCode = 2; }
