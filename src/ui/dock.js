// ─────────────────────────────────────────────────────────────────────────────
// 底部控制条：时段（晨/晝/暮/夜）、自动漫游、地名标签、全屏、说明。
// 状态样式统一用 .on + aria-pressed；实际能力全部委托给 ctx（ui.js）。
// ─────────────────────────────────────────────────────────────────────────────
import { h } from './util.js';
import { icon } from './icons.js';

const TOD_ITEMS = [
  { key: 'dawn', char: '晨', label: '清晨', hint: '晨光（快捷鍵 1）' },
  { key: 'day', char: '晝', label: '白晝', hint: '白晝（快捷鍵 2）' },
  { key: 'dusk', char: '暮', label: '黃昏', hint: '黃昏（快捷鍵 3）' },
  { key: 'night', char: '夜', label: '夜晚', hint: '夜晚（快捷鍵 4）' },
];

export function initDock(ctx) {
  const todButtons = new Map();
  const todGroup = h('div', { class: 'tod-group', attrs: { role: 'group', 'aria-label': '時段' } });
  for (const item of TOD_ITEMS) {
    const button = h(
      'button',
      {
        class: 'dock-btn tod-btn',
        attrs: {
          type: 'button',
          'aria-label': item.hint,
          'aria-pressed': 'false',
          title: item.hint,
          'data-tod': item.key,
        },
        on: { click: () => ctx.setTod(item.key) },
      },
      h('span', { class: 'tod-char', text: item.char }),
    );
    todButtons.set(item.key, button);
    todGroup.appendChild(button);
  }

  const tourIcon = h('span', { class: 'dock-ico' }, icon('play'));
  const tourLabel = h('span', { class: 'lbl', text: '漫遊' });
  const tourBtn = h(
    'button',
    {
      class: 'dock-btn',
      attrs: { type: 'button', 'aria-label': '自動漫遊：依次遊覽園中景點（快捷鍵 T）', 'aria-pressed': 'false', title: '自動漫遊（T）' },
      on: { click: () => ctx.toggleTour() },
    },
    tourIcon,
    tourLabel,
  );

  const labelsBtn = h(
    'button',
    {
      class: 'dock-btn',
      attrs: { type: 'button', 'aria-label': '顯示或隱藏地名標籤（快捷鍵 L）', 'aria-pressed': 'true', title: '地名標籤（L）' },
      on: { click: () => ctx.toggleLabels() },
    },
    icon('tag'),
    h('span', { class: 'lbl', text: '標籤' }),
  );

  const fullscreenBtn = h(
    'button',
    {
      class: 'dock-btn btn-compact',
      attrs: { type: 'button', 'aria-label': '進入全螢幕', 'aria-pressed': 'false', title: '全螢幕' },
      on: { click: () => toggleFullscreen() },
    },
    icon('fullscreen'),
    h('span', { class: 'lbl', text: '全螢幕' }),
  );

  const helpBtn = h(
    'button',
    {
      class: 'dock-btn btn-compact',
      attrs: { type: 'button', 'aria-label': '遊園說明與考據來源（快捷鍵 ?）', title: '說明（?）' },
      on: { click: () => ctx.openHelp() },
    },
    icon('help'),
    h('span', { class: 'lbl', text: '說明' }),
  );

  const dock = h(
    'div',
    { class: 'dock', attrs: { role: 'toolbar', 'aria-label': '園林控制' } },
    todGroup,
    h('span', { class: 'dock-sep', attrs: { 'aria-hidden': 'true' } }),
    tourBtn,
    labelsBtn,
    h('span', { class: 'dock-sep', attrs: { 'aria-hidden': 'true' } }),
    fullscreenBtn,
    helpBtn,
  );
  ctx.root.appendChild(dock);

  function updateTod(key) {
    for (const [todKey, button] of todButtons) {
      const active = todKey === key;
      button.classList.toggle('on', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function updateTour(active) {
    tourBtn.classList.toggle('on', Boolean(active));
    tourBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    tourBtn.setAttribute('aria-label', active ? '停止自動漫遊（快捷鍵 T）' : '自動漫遊：依次遊覽園中景點（快捷鍵 T）');
    tourIcon.replaceChildren(icon(active ? 'stop' : 'play'));
    tourLabel.textContent = active ? '停止' : '漫遊';
  }

  function updateLabels(value) {
    if (typeof value === 'boolean') {
      labelsBtn.classList.toggle('on', value);
      labelsBtn.setAttribute('aria-pressed', value ? 'true' : 'false');
    } else {
      labelsBtn.classList.remove('on');
      labelsBtn.setAttribute('aria-pressed', 'false');
    }
  }

  function updateFullscreen() {
    const active = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    fullscreenBtn.classList.toggle('on', active);
    fullscreenBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    fullscreenBtn.setAttribute('aria-label', active ? '退出全螢幕' : '進入全螢幕');
  }

  function toggleFullscreen() {
    try {
      const active = document.fullscreenElement || document.webkitFullscreenElement;
      if (!active) {
        const target = document.documentElement;
        const request = target.requestFullscreen || target.webkitRequestFullscreen || target.msRequestFullscreen;
        if (!request) return;
        const result = request.call(target);
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } else {
        const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
        if (!exit) return;
        const result = exit.call(document);
        if (result && typeof result.catch === 'function') result.catch(() => {});
      }
    } catch { /* 全屏失败时静默（部分移动端浏览器不支持） */ }
  }

  document.addEventListener('fullscreenchange', updateFullscreen);
  document.addEventListener('webkitfullscreenchange', updateFullscreen);
  updateFullscreen();

  return { el: dock, updateTod, updateTour, updateLabels, updateFullscreen, toggleFullscreen };
}
