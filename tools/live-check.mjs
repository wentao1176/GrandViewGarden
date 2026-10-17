// 线上部署验证：加载自定义域名，等待就绪，检查控制台/外部请求并截图
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const url = process.argv[2] || 'https://grandviewgarden.xuanwentao.cn/';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const errors = [];
const external = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 200)); });
  page.on('request', (r) => { const u = r.url(); if (/^https?:/.test(u) && !u.includes('grandviewgarden.xuanwentao.cn')) external.push(u.slice(0, 120)); });
  await page.goto(url, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction('window.__GVG_READY__ === true', { timeout: 180000 });
  await new Promise((r) => setTimeout(r, 4500));
  const info = await page.evaluate(() => ({
    title: document.title,
    stats: window.GVG?.stats?.(),
    pois: window.GVG?.pois?.length,
    hasWalker: !!window.GVG?.walker,
    hasWater: !!window.GVG?.water,
    orn: !!window.GVG?.orn,
    mode: window.GVG?.app?.getMode?.(),
    hasCNAME: !!document.querySelector('link[rel="canonical"]'),
  }));
  await page.screenshot({ path: 'ref/qa/live-deploy.png' });
  console.log(JSON.stringify({ url, info, external, errors }, null, 2));
} finally {
  try { await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 4000))]); } catch {}
}
process.exit(errors.length ? 1 : 0);
