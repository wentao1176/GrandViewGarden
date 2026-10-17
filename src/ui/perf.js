// ─────────────────────────────────────────────────────────────────────────────
// 性能 / 调试面板：隐藏入口为连点品牌标题 3 次。FPS 用 requestAnimationFrame 统计，
// 几何数据优先读 window.GVG.stats()。仅用于开发调试，不参与正式游览流程。
// ─────────────────────────────────────────────────────────────────────────────
import { h, safe, compact } from './util.js';
import { icon } from './icons.js';
const TOD_LABEL = { dawn: '晨', day: '晝', dusk: '暮', night: '夜' };

export function initPerf(ctx) {
  const closeBtn = h(
    'button',
    {
      class: 'p-close',
      attrs: { type: 'button', 'aria-label': '關閉性能面板', title: '關閉' },
    },
    icon('close'),
  );
  const title = h('p', { class: 'p-title', text: '性能 · 偵錯' });
  const rows = new Map();
  const list = h('div', { class: 'p-rows' });
  const rowDefs = [
    ['fps', 'FPS'],
    ['frame', '幀耗'],
    ['tris', '三角面'],
    ['calls', '繪製呼叫'],
    ['voxels', '體素'],
    ['camera', '相機'],
    ['viewport', '視窗'],
    ['tod', '時段'],
    ['mode', '模式'],
  ];
  for (const [key, label] of rowDefs) {
    const value = h('span', { class: 'p-v', text: '—' });
    rows.set(key, value);
    list.appendChild(h('div', { class: 'p-row' }, h('span', { class: 'p-k', text: label }), value));
  }
  const box = h('div', { class: 'perf', attrs: { role: 'group', 'aria-label': '性能與偵錯資訊' } }, closeBtn, title, list);
  ctx.root.appendChild(box);

  let opened = false;
  let raf = 0;
  let frames = 0;
  let windowStart = 0;
  let fps = 0;

  function set(key, text) {
    const node = rows.get(key);
    if (node) node.textContent = text;
  }

  function render() {
    const stats = safe(() => (window.GVG && typeof window.GVG.stats === 'function' ? window.GVG.stats() : null), null) || {};
    set('fps', fps ? String(fps) : '—');
    set('frame', fps ? `${(1000 / fps).toFixed(1)} ms` : '—');
    set('tris', Number.isFinite(stats.tris) ? compact(stats.tris) : '—');
    set('calls', Number.isFinite(stats.calls) ? compact(stats.calls) : '—');
    set('voxels', Number.isFinite(stats.voxels) ? compact(stats.voxels) : '—');

    let camera = '—';
    const cam = window.GVG && window.GVG.view && window.GVG.view.camera;
    if (cam && cam.position) {
      camera = `${cam.position.x.toFixed(0)}, ${cam.position.y.toFixed(0)}, ${cam.position.z.toFixed(0)}`;
    } else if (ctx.app && typeof ctx.app.getView === 'function') {
      const view = safe(() => ctx.app.getView(), null);
      if (view) camera = `${Number(view.x).toFixed(0)}, ${Number(view.y ?? 0).toFixed(0)}, ${Number(view.z).toFixed(0)}`;
    }
    set('camera', camera);
    const dpr = window.devicePixelRatio ? ` @${window.devicePixelRatio.toFixed(1)}x` : '';
    set('viewport', `${window.innerWidth}×${window.innerHeight}${dpr}`);
    set('tod', TOD_LABEL[ctx.state.tod] || ctx.state.tod || '—');
    const modes = [];
    if (ctx.state.zen) modes.push('賞景');
    if (ctx.state.tour) modes.push('漫遊');
    if (!modes.length) modes.push('自由');
    set('mode', modes.join(' / '));
  }

  function loop(time) {
    if (!opened) return;
    if (!windowStart) windowStart = time;
    frames += 1;
    if (time - windowStart >= 500) {
      fps = Math.round((frames * 1000) / (time - windowStart));
      frames = 0;
      windowStart = time;
      render();
    }
    raf = requestAnimationFrame(loop);
  }

  function start() {
    if (opened) return;
    opened = true;
    box.classList.add('show');
    frames = 0;
    windowStart = 0;
    fps = 0;
    render();
    raf = requestAnimationFrame(loop);
    if (ctx.onPerfStateChange) ctx.onPerfStateChange(true);
  }

  function stop() {
    if (!opened) return;
    opened = false;
    box.classList.remove('show');
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (ctx.onPerfStateChange) ctx.onPerfStateChange(false);
  }

  function toggle(force) {
    const next = typeof force === 'boolean' ? force : !opened;
    if (next) start();
    else stop();
  }

  closeBtn.addEventListener('click', () => stop());

  return { el: box, toggle, start, stop, isOpen: () => opened };
}
