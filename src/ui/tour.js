// ─────────────────────────────────────────────────────────────────────────────
// 漫游字幕：app.on('tour', {poi,index,total}) 时在底部显示景点名 + 原文一句，
// 淡入淡出；提供「跳過」「停止」。
// ─────────────────────────────────────────────────────────────────────────────
import { h, shorten, firstSentence } from './util.js';
import { icon } from './icons.js';
import { ordinal, formatSource } from './content.js';

export function initTour(ctx) {
  const indexLabel = h('span', { class: 't-idx' });
  const meta = h('p', { class: 't-meta' }, h('span', { class: 't-tag', text: '漫遊' }), indexLabel);
  const name = h('h3', { class: 't-name', attrs: { id: 'tour-name' } });
  const quote = h('p', { class: 't-q' });
  const source = h('p', { class: 't-src' });

  const skipBtn = h(
    'button',
    {
      class: 'btn btn-xs',
      attrs: { type: 'button', 'aria-label': '跳過當前景點，前往下一處', title: '跳過' },
      on: { click: () => skip() },
    },
    icon('skipNext'),
    h('span', { class: 'lbl', text: '跳過' }),
  );
  const stopBtn = h(
    'button',
    {
      class: 'btn btn-xs',
      attrs: { type: 'button', 'aria-label': '停止自動漫遊', title: '停止漫遊' },
      on: { click: () => stop() },
    },
    icon('stop'),
    h('span', { class: 'lbl', text: '停止' }),
  );
  const actions = h('div', { class: 't-actions' }, skipBtn, stopBtn);

  const cap = h(
    'div',
    {
      class: 'tour-cap',
      attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
    },
    meta,
    name,
    quote,
    source,
    actions,
  );
  ctx.root.appendChild(cap);

  function show(payload) {
    const poi = ctx.resolvePoiPayload(payload && payload.poi ? payload.poi : payload);
    if (!poi) return;
    const list = ctx.pois || [];
    const foundIndex = list.findIndex((item) => item.id === poi.id);
    const total = list.length || Number(payload && payload.total) || 0;
    const index = foundIndex >= 0 ? foundIndex : Number(payload && payload.index);
    indexLabel.textContent = Number.isFinite(index) && total ? `${ordinal(index)} / ${String(total).padStart(2, '0')}` : '';
    name.textContent = poi.name || '';
    const text = poi.quote ? poi.quote : firstSentence(poi.desc, 66);
    quote.textContent = text ? shorten(text, 72) : '';
    quote.hidden = !text;
    const src = poi.source ? formatSource(poi.source) : '';
    source.textContent = src ? `—— ${src}` : '';
    source.hidden = !src;
    cap.classList.add('show');
    ctx.body.classList.add('tour-on');
  }

  function hide() {
    cap.classList.remove('show');
    ctx.body.classList.remove('tour-on');
  }

  function skip() {
    const app = ctx.app;
    if (typeof app.tourNext === 'function') {
      try { app.tourNext(); return; } catch { /* fall through */ }
    }
    stop();
  }

  function stop() {
    ctx.stopTour();
  }

  return { el: cap, show, hide, skip, stop };
}
