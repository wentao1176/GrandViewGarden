// ─────────────────────────────────────────────────────────────────────────────
// 顶右工具区（景點目錄开关、赏景模式）与赏景模式的返回按钮。
// 返回按钮挂在 <body> 上，避免引擎 hideUI 隐藏 #ui-root 后无法退出。
// ─────────────────────────────────────────────────────────────────────────────
import { h } from './util.js';
import { icon } from './icons.js';

export function initTools(ctx) {
  const poiBtn = h(
    'button',
    {
      class: 'btn tool-poi',
      attrs: {
        type: 'button',
        'aria-label': '顯示或隱藏景點目錄',
        'aria-expanded': 'false',
        'aria-controls': 'poi-panel',
        title: '景點目錄（目錄可收起）',
      },
      on: { click: () => ctx.togglePanel() },
    },
    icon('list'),
    h('span', { class: 'lbl', text: '景點' }),
  );

  const zenBtn = h(
    'button',
    {
      class: 'btn tool-zen',
      attrs: {
        type: 'button',
        'aria-label': '賞景模式：隱藏全部介面（快捷鍵 H）',
        'aria-pressed': 'false',
        title: '賞景模式（H）',
      },
      on: { click: () => ctx.setZen(true) },
    },
    icon('eye'),
    h('span', { class: 'lbl', text: '賞景' }),
  );

  const tools = h('div', { class: 'tools' }, poiBtn, zenBtn);
  ctx.root.appendChild(tools);

  const exitText = h('span', { class: 'zex-text', text: '賞景模式 · 按 H 或點此返回' });
  const zenExit = h(
    'button',
    {
      class: 'zen-exit',
      attrs: { type: 'button', 'aria-label': '退出賞景模式（快捷鍵 H）' },
      on: { click: () => ctx.setZen(false) },
    },
    icon('eyeOff'),
    exitText,
  );
  document.body.appendChild(zenExit);

  function setPanelOpen(open) {
    poiBtn.classList.toggle('on', Boolean(open));
    poiBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setZen(on) {
    zenBtn.classList.toggle('on', Boolean(on));
    zenBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) {
      // 重新触发一次淡出动画，让返回按钮先清晰可见再变淡
      zenExit.classList.remove('is-pulsing');
      void zenExit.offsetWidth;
      zenExit.classList.add('is-pulsing');
    }
  }

  return { el: tools, poiBtn, zenBtn, zenExit, setPanelOpen, setZen };
}
