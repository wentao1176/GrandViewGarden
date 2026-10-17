// ─────────────────────────────────────────────────────────────────────────────
// 景点信息卡：名称 / 别名 / 匾额（初题→元春改题）/ 楹联 / 考据简介 / 原文引文 / 标签。
// PC 为底部居中飞入卡片；移动端为可上滑展开、下滑关闭的底部抽屉。
// 缺失字段整行隐藏，不产生空白。
// ─────────────────────────────────────────────────────────────────────────────
import { h, on, clamp } from './util.js';
import { icon } from './icons.js';
import { formatSource, groupLabel, ordinal, splitCoupletLines } from './content.js';

export function initCard(ctx) {
  const eyebrow = h('p', { class: 'c-eyebrow' });
  const name = h('h2', { class: 'c-name', attrs: { id: 'poi-card-title' } });
  const alias = h('p', { class: 'c-alias' });
  const closeBtn = h(
    'button',
    {
      class: 'c-close',
      attrs: { type: 'button', 'aria-label': '關閉景點信息', title: '關閉（Esc）' },
      on: { click: () => close() },
    },
    icon('close'),
  );
  const headMain = h('div', { class: 'c-head-main' }, eyebrow, name, alias);
  const head = h('div', { class: 'c-head' }, headMain, closeBtn);
  const body = h('div', { class: 'c-scroll', attrs: { id: 'poi-card-body' } });

  const grip = h('span', { class: 'grip', attrs: { 'aria-hidden': 'true' } });
  const handle = h(
    'button',
    {
      class: 'card-handle',
      attrs: {
        type: 'button',
        'aria-label': '調整信息卡高度：上滑展開，下滑關閉',
        'aria-expanded': 'false',
      },
    },
    grip,
    h('span', { class: 'card-handle-hint', text: '上滑展開 · 下滑關閉' }),
  );

  const card = h(
    'aside',
    {
      class: 'poi-card',
      attrs: { role: 'region', 'aria-labelledby': 'poi-card-title', 'aria-hidden': 'true' },
    },
    handle,
    head,
    body,
  );
  ctx.root.appendChild(card);

  let current = null;
  let closeTimer = 0;

  function labelNode(text) {
    return h('span', { class: 'c-label', text });
  }

  function plaqueNode(plaque) {
    const row = h('div', { class: 'c-plaque' }, labelNode('匾額'));
    const main = h('div', { class: 'cp-main' });
    const value = h('span', { class: 'cp-value' });
    if (plaque.initial && plaque.final && plaque.initial !== plaque.final) {
      value.appendChild(h('span', { class: 'cp-old', text: `初題「${plaque.initial}」` }));
      value.appendChild(icon('arrowRight', 'cp-arrow'));
      value.appendChild(h('span', { class: 'cp-new', text: `改題「${plaque.final}」` }));
      value.appendChild(h('span', { class: 'cp-note', text: '元春改題' }));
    } else {
      value.appendChild(h('span', { class: 'cp-new', text: `「${plaque.final || plaque.initial}」` }));
    }
    main.appendChild(value);
    if (plaque.note) main.appendChild(h('span', { class: 'cp-source', text: plaque.note }));
    row.appendChild(main);
    return row;
  }

  function coupletsNode(couplets) {
    const row = h('div', { class: 'c-couplets' }, labelNode('楹聯'));
    const lines = h('div', { class: 'cp-lines' });
    for (const couplet of couplets) {
      const block = h('div', { class: 'c-couplet' });
      for (const line of splitCoupletLines(couplet.text)) {
        block.appendChild(h('span', { class: 'c-line', text: line }));
      }
      if (couplet.source) block.appendChild(h('span', { class: 'c-source', text: couplet.source }));
      lines.appendChild(block);
    }
    row.appendChild(lines);
    return row;
  }

  function quoteNode(poi) {
    return h(
      'blockquote',
      { class: 'quote' },
      h('p', { class: 'q-text', text: poi.quote }),
      h('cite', { class: 'q-src', text: `—— ${formatSource(poi.source)}` }),
    );
  }

  function poemNode(poi) {
    const wrap = h('div', { class: 'c-poem' }, labelNode('題詠'));
    wrap.appendChild(h('p', { class: 'poem-text', text: poi.poem.text }));
    if (poi.poem.source) wrap.appendChild(h('span', { class: 'poem-src', text: poi.poem.source }));
    return wrap;
  }

  function render(poi) {
    const index = ctx.indexOfPoi ? ctx.indexOfPoi(poi.id) : -1;
    eyebrow.textContent = `${groupLabel(poi.group)}${index >= 0 ? ` · ${ordinal(index)}` : ''}`;
    name.textContent = poi.name;
    if (poi.alias && poi.alias.length) {
      alias.textContent = `別名 · ${poi.alias.join(' / ')}`;
      alias.hidden = false;
    } else {
      alias.textContent = '';
      alias.hidden = true;
    }

    body.replaceChildren();
    if (poi.plaque) body.appendChild(plaqueNode(poi.plaque));
    if (poi.couplets && poi.couplets.length) body.appendChild(coupletsNode(poi.couplets));
    if (poi.desc) body.appendChild(h('p', { class: 'c-desc', text: poi.desc }));
    if (poi.quote) body.appendChild(quoteNode(poi));
    if (poi.poem && poi.poem.text) body.appendChild(poemNode(poi));
    if (poi.tags && poi.tags.length) {
      body.appendChild(
        h(
          'div',
          { class: 'c-tags', attrs: { 'aria-label': '關鍵詞' } },
          poi.tags.map((tag) => h('span', { class: 'tag', text: tag })),
        ),
      );
    }
    if (!body.childNodes.length) {
      body.appendChild(h('p', { class: 'c-desc c-desc-empty', text: '此景點的考據資料正在整理中。' }));
    }
    body.scrollTop = 0;
  }

  function open(poi, opts = {}) {
    if (!poi) return;
    clearTimeout(closeTimer);
    const alreadyOpen = card.classList.contains('is-open');
    const same = current && current.id === poi.id;
    current = poi;
    render(poi);
    if (ctx.isMobile() && !same) {
      card.classList.remove('is-expanded');
      card.style.transform = '';
      handle.setAttribute('aria-expanded', 'false');
    }
    card.setAttribute('aria-hidden', 'false');
    // 强制一次 reflow，确保首次打开有飞入动效
    if (!alreadyOpen) void card.offsetWidth;
    card.classList.add('is-open');
    ctx.body.classList.add('card-open');
    if (ctx.onCardStateChange) ctx.onCardStateChange(true, poi);
    if (!same) ctx.announce(`景點信息：${poi.name}`);
    if (ctx.isMobile() && !same) {
      try { closeBtn.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
  }

  function close() {
    if (!card.classList.contains('is-open')) return;
    card.classList.remove('is-open', 'is-expanded', 'is-dragging');
    card.style.transform = '';
    card.setAttribute('aria-hidden', 'true');
    handle.setAttribute('aria-expanded', 'false');
    ctx.body.classList.remove('card-open');
    current = null;
    clearTimeout(closeTimer);
    if (ctx.onCardStateChange) ctx.onCardStateChange(false, null);
  }

  /* ── 移动端抽屉拖拽 ─────────────────────────────────────────── */
  const DRAG_CLOSE = 96;
  const DRAG_EXPAND = 44;
  let drag = null;

  function isMobileSheet() {
    return ctx.isMobile();
  }

  function setExpanded(expanded) {
    card.classList.toggle('is-expanded', expanded);
    handle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  on(handle, 'pointerdown', (event) => {
    if (!isMobileSheet() || !card.classList.contains('is-open')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    drag = {
      id: event.pointerId,
      startY: event.clientY,
      dy: 0,
      expandedAtStart: card.classList.contains('is-expanded'),
    };
    card.classList.add('is-dragging');
    try { handle.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    event.preventDefault();
  });

  on(handle, 'pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dy = event.clientY - drag.startY;
    drag.dy = dy;
    const offset = dy >= 0 ? dy : dy * 0.42;
    card.style.transform = `translateY(${clamp(offset * 0.55, -70, 260)}px)`;
    event.preventDefault();
  });

  function endDrag(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const dy = drag.dy;
    const expandedAtStart = drag.expandedAtStart;
    drag = null;
    card.classList.remove('is-dragging');
    card.style.transform = '';
    try { handle.releasePointerCapture(event.pointerId); } catch { /* ignore */ }

    if (dy > DRAG_CLOSE) {
      close();
      return;
    }
    if (dy < -DRAG_EXPAND) {
      setExpanded(true);
      return;
    }
    if (expandedAtStart && dy > 56) {
      setExpanded(false);
      return;
    }
    if (Math.abs(dy) < 6) setExpanded(!card.classList.contains('is-expanded'));
  }

  on(handle, 'pointerup', endDrag);
  on(handle, 'pointercancel', endDrag);

  on(handle, 'keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!card.classList.contains('is-open')) return;
      if (card.classList.contains('is-expanded')) close();
      else setExpanded(true);
    }
  });

  return {
    el: card,
    open,
    close,
    render,
    isOpen: () => card.classList.contains('is-open'),
    current: () => current,
    setExpanded,
  };
}
