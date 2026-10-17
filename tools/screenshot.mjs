// Headless screenshot tool. Uses locally installed Chrome/Edge via puppeteer-core.
// usage:
//   node tools/screenshot.mjs --views=v1,v2 --out=ref/shots/name [--width=1600 --height=900]
//   node tools/screenshot.mjs --url=file:///.../index.html --query="view=..." --out=...
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const i = a.indexOf('=');
  return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)];
}));

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const executablePath = chromeCandidates.find((p) => existsSync(p));
if (!executablePath) { console.error('No Chrome/Edge found'); process.exit(1); }

const width = Number(argv.width || 1600);
const height = Number(argv.height || 900);
const outBase = path.resolve(root, argv.out || 'ref/shots/shot');
const views = String(argv.views || 'default').split(',').filter(Boolean);
const extraQuery = argv.query ? String(argv.query) : '';
const target = argv.url
  ? String(argv.url)
  : pathToFileURL(path.join(root, 'dist/index.html')).href;
const waitMs = Number(argv.wait || 2500);
const mobile = argv.mobile === true || argv.mobile === '1';

await mkdir(path.dirname(outBase), { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--hide-scrollbars',
    '--mute-audio',
    '--force-device-scale-factor=1',
  ],
});
const errors = [];
try {
  const page = await browser.newPage();
  if (mobile) {
    await page.emulate({
      viewport: { width, height, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
  } else {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
  }
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

  for (const view of views) {
    const q = ['shot=1', extraQuery, `view=${encodeURIComponent(view)}`].filter(Boolean).join('&');
    const url = target + (target.includes('?') ? '&' : '?') + q;
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    try {
      await page.waitForFunction('window.__GVG_READY__ === true', { timeout: 120000 });
    } catch (e) {
      errors.push('READY_TIMEOUT ' + view);
    }
    await new Promise((r) => setTimeout(r, waitMs));
    const out = `${outBase}-${String(view).replace(/[^a-zA-Z0-9._-]+/g, '_')}.png`;
    await page.screenshot({ path: out });
    console.log('saved', path.relative(root, out));
  }
  const stats = await page.evaluate(() => (window.GVG && window.GVG.stats) ? window.GVG.stats() : null);
  if (stats) console.log('stats', JSON.stringify(stats));
} finally {
  await browser.close();
}
if (errors.length) {
  console.error('console errors:\n' + [...new Set(errors)].slice(0, 20).join('\n'));
  process.exitCode = 2;
}
