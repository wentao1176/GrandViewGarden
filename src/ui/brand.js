// ─────────────────────────────────────────────────────────────────────────────
// 品牌区：印章「觀」+「大觀園」+ 副題；可折叠；连点标题 3 次打开性能面板。
// ─────────────────────────────────────────────────────────────────────────────
import { h, on } from './util.js';
import { icon } from './icons.js';

export function initBrand(ctx) {
  const sealGlyph = h('span', { class: 'brand-seal-glyph', text: '觀' });
  const seal = h(
    'div',
    {
      class: 'brand-seal',
      attrs: { role: 'img', 'aria-label': '大觀園印章' },
      on: { click: () => { if (minimized) setMinimized(false); } },
    },
    sealGlyph,
  );
  const title = h('h1', { class: 'brand-title', text: '大觀園' });
  const sub = h('p', { class: 'brand-sub', text: '紅樓夢 · 三維體素復原' });
  const meta = h('p', { class: 'brand-meta', text: '依第十七、十八回遊園路徑復原' });
  const main = h('div', { class: 'brand-main', attrs: { id: 'brand-main' } }, title, sub, meta);
  const toggle = h(
    'button',
    {
      class: 'brand-toggle',
      attrs: {
        type: 'button',
        'aria-label': '收合品牌區',
        'aria-expanded': 'true',
        'aria-controls': 'brand-main',
        title: '收合 / 展開品牌區',
      },
      on: { click: () => setMinimized(!minimized) },
    },
    icon('chevronUp'),
  );
  const root = h('header', { class: 'brand' }, seal, main, toggle);
  ctx.root.appendChild(root);

  let minimized = false;

  function setMinimized(value) {
    minimized = Boolean(value);
    root.classList.toggle('is-min', minimized);
    toggle.setAttribute('aria-expanded', minimized ? 'false' : 'true');
    toggle.setAttribute('aria-label', minimized ? '展開品牌區' : '收合品牌區');
    toggle.classList.toggle('is-collapsed', minimized);
  }

  // 隐藏入口：连点标题三下开启 FPS / 性能面板
  let taps = [];
  on(title, 'click', () => {
    const now = performance.now();
    taps = taps.filter((time) => now - time < 900);
    taps.push(now);
    if (taps.length >= 3) {
      taps = [];
      ctx.togglePerf();
    }
  });

  return { el: root, setMinimized, isMinimized: () => minimized };
}
