// 交付前最终检查：file:// 直开、无外部请求、桌面/移动端、UI 与引擎状态。
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = path.resolve('.');
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const url = pathToFileURL(path.join(root, 'index.html')).href;
const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const result = { file: url, errors: [], requests: [] };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => result.errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') result.errors.push('CONSOLE ' + m.text().slice(0, 240)); });
  page.on('requestfailed', (r) => result.errors.push('REQFAIL ' + r.url().slice(0, 120) + ' ' + (r.failure()?.errorText || '')));
  page.on('request', (r) => { const u = r.url(); if (/^https?:/.test(u)) result.requests.push(u.slice(0, 120)); });
  await page.goto(url, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction('window.__GVG_READY__ === true', { timeout: 180000 });
  await new Promise((r) => setTimeout(r, 3800));
  result.desktop = await page.evaluate(() => ({
    stats: window.GVG?.stats?.(),
    build: window.GVG?.buildInfo,
    pois: window.GVG?.pois?.length,
    uiRootChildren: document.getElementById('ui-root')?.children?.length,
    bootHidden: (() => { const b = document.getElementById('boot'); if (!b) return 'removed'; const s = getComputedStyle(b); return s.visibility + '/' + s.display + '/' + s.opacity; })(),
    labels: document.querySelectorAll('.poi-label').length,
    minimap: !!document.querySelector('#minimap, canvas.minimap, .minimap-wrap canvas'),
    title: document.title,
    externalScripts: [...document.querySelectorAll('script[src], link[href], img[src]')].map((e) => e.src || e.href).filter((u) => u && !u.startsWith('data:')),
  }));
  await page.screenshot({ path: 'ref/qa/final-desktop.png' });
} finally { /* keep browser for mobile check */ }
try {
  const mobile = await browser.newPage();
  await mobile.emulate({ viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
  mobile.on('pageerror', (e) => result.errors.push('MOBILE PAGEERROR ' + e.message));
  await mobile.goto(url, { waitUntil: 'load', timeout: 180000 });
  await mobile.waitForFunction('window.__GVG_READY__ === true', { timeout: 180000 });
  await new Promise((r) => setTimeout(r, 3500));
  result.mobile = await mobile.evaluate(() => ({ stats: window.GVG?.stats?.(), uiVisible: !!document.querySelector('#ui-root')?.children?.length }));
  await mobile.screenshot({ path: 'ref/qa/final-mobile.png' });
} finally { await browser.close(); }
console.log(JSON.stringify({
  errors: result.errors,
  externalRequests: result.requests,
  desktop: result.desktop ? {
    stats: result.desktop.stats, pois: result.desktop.pois, uiRootChildren: result.desktop.uiRootChildren,
    bootHidden: result.desktop.bootHidden, labels: result.desktop.labels, minimap: result.desktop.minimap,
    title: result.desktop.title, externalInDOM: result.desktop.externalScripts,
  } : null,
  mobile: result.mobile ? { stats: result.mobile.stats, uiVisible: result.mobile.uiVisible } : null,
}, null, 2));
process.exitCode = result.errors.length ? 1 : 0;
