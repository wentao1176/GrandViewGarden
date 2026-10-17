// UI 集成验证：真实 UI 下截图 + 点击交互。
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const file = path.resolve(process.argv[2] || 'ref/preview/ui.html');
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const base = pathToFileURL(file).href;
await page.goto(base + '?view=overview', { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction('window.__GVG_READY__ === true', { timeout: 240000 });
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: 'ref/shots/uicheck-overview.png' });
// 打开景点
const clickText = async (txt) => page.evaluate((t) => {
  const els = [...document.querySelectorAll('button, .poi-item, [role=button]')];
  const el = els.find((e) => (e.textContent || '').includes(t));
  if (el) { el.click(); return true; } return false;
}, txt);
console.log('click poi', await clickText('瀟湘館'));
await new Promise((r) => setTimeout(r, 2600));
await page.screenshot({ path: 'ref/shots/uicheck-poi.png' });
// 标签
const labels = await page.evaluate(() => window.GVG.app.toggleLabels());
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: 'ref/shots/uicheck-labels.png' });
console.log('labels', labels, 'shown', await page.evaluate(() => document.querySelectorAll('.poi-label.show').length));
// 信息状态
console.log(await page.evaluate(() => ({
  state: window.GVG.app.getState(),
  stats: window.GVG.stats(),
  bootHidden: getComputedStyle(document.getElementById('boot')).visibility,
  labelLayer: !!document.querySelector('.label-layer'),
  poiCount: window.GVG.pois.length,
})));
console.log('errors', errors);
await browser.close();
