// ─────────────────────────────────────────────────────────────────────────────
// 景点目录：按 group 分组列出 window.GVG.pois；当前景点高亮；PC 侧栏 / 移动端抽屉。
// 点击条目调用 ctx.goTo(id)，其余状态由 ui.js 统一维护。
// ─────────────────────────────────────────────────────────────────────────────
import { h, prefersReducedMotion } from './util.js';
import { icon } from './icons.js';
import { groupOf, groupSortIndex, ordinal } from './content.js';

export function initPanel(ctx) {
  const countBadge = h('span', { class: 'poi-count', attrs: { 'aria-live': 'polite' } });
  const title = h('h2', { class: 'poi-title', text: '園中景點', attrs: { id: 'poi-panel-title' } });
  const hideBtn = h(
    'button',
    {
      class: 'poi-hide',
      attrs: { type: 'button', 'aria-label': '隱藏景點目錄', title: '隱藏景點目錄' },
      on: { click: () => close({ restoreFocus: true }) },
    },
    icon('chevronLeft'),
    h('span', { class: 'lbl', text: '隱藏' }),
  );
  const head = h('div', { class: 'poi-head' }, h('div', { class: 'poi-head-main' }, title, countBadge), hideBtn);
  const scroll = h('div', { class: 'poi-scroll', attrs: { id: 'poi-scroll' } });
  const panel = h(
    'aside',
    { class: 'poi-panel', attrs: { id: 'poi-panel', 'aria-labelledby': 'poi-panel-title' } },
    head,
    scroll,
  );
  const scrim = h('div', {
    class: 'panel-scrim',
    attrs: { 'aria-hidden': 'true' },
    on: { click: () => close({ restoreFocus: true }) },
  });
  const wrap = h('div', { class: 'panel-wrap' }, scrim, panel);
  ctx.root.appendChild(wrap);

  const itemById = new Map();
  let open = false;
  let lastFocus = null;

  function render() {
    itemById.clear();
    scroll.replaceChildren();
    const pois = Array.isArray(ctx.pois) ? ctx.pois : [];
    countBadge.textContent = pois.length ? `${pois.length} 處` : '';

    if (!pois.length) {
      scroll.appendChild(h('p', { class: 'poi-empty', text: '景點資料載入中…' }));
      return;
    }

    const buckets = new Map();
    pois.forEach((poi, index) => {
      const key = poi.group || '其他';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ poi, index });
    });
    const keys = [...buckets.keys()].sort((a, b) => groupSortIndex(a) - groupSortIndex(b));

    for (const key of keys) {
      const entries = buckets.get(key);
      const def = groupOf(key);
      const groupEl = h('section', { class: 'poi-group', attrs: { 'aria-label': def.label } });
      groupEl.style.setProperty('--gc', def.color);
      groupEl.appendChild(
        h(
          'div',
          { class: 'poi-group-head', attrs: { 'aria-hidden': 'true' } },
          h('span', { class: 'poi-gdot' }),
          h('span', { class: 'poi-gname', text: def.label }),
          h('span', { class: 'poi-gcount', text: String(entries.length).padStart(2, '0') }),
        ),
      );
      for (const { poi, index } of entries) {
        const label = poi.alias && poi.alias.length ? `${poi.name}（${poi.alias.join(' / ')}）` : poi.name;
        const btn = h(
          'button',
          {
            class: 'poi-item',
            attrs: { type: 'button', title: label, 'aria-label': `前往${label}`, 'data-poi-id': poi.id },
            on: { click: () => ctx.goTo(poi.id) },
          },
          h('span', { class: 'ord', attrs: { 'aria-hidden': 'true' }, text: ordinal(index) }),
          h('span', { class: 'zh', text: poi.name }),
        );
        itemById.set(poi.id, btn);
        groupEl.appendChild(btn);
      }
      scroll.appendChild(groupEl);
    }

    if (ctx.state.activeId) setActive(ctx.state.activeId, { scroll: false });
  }

  function setActive(id, opts = {}) {
    for (const [key, btn] of itemById) {
      const active = key === id;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    }
    if (opts.scroll && id && open) {
      const btn = itemById.get(id);
      if (btn) {
        try {
          btn.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        } catch { /* ignore */ }
      }
    }
  }

  function setOpen(value, opts = {}) {
    open = Boolean(value);
    wrap.classList.toggle('is-open', open);
    panel.toggleAttribute('inert', !open);
    hideBtn.tabIndex = open ? 0 : -1;
    if (open) {
      lastFocus = document.activeElement;
      if (ctx.isMobile() && opts.focus !== false) {
        try { hideBtn.focus({ preventScroll: true }); } catch { /* ignore */ }
      }
    } else if (opts.restoreFocus && lastFocus && lastFocus.isConnected) {
      try { lastFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
    if (ctx.onPanelStateChange) ctx.onPanelStateChange(open);
  }

  const close = (opts = {}) => setOpen(false, opts);
  const openPanel = (opts = {}) => setOpen(true, opts);
  const toggle = () => setOpen(!open);

  render();

  return {
    el: wrap,
    render,
    setActive,
    setOpen,
    open: openPanel,
    close,
    toggle,
    isOpen: () => open,
  };
}
