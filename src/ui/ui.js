// ─────────────────────────────────────────────────────────────────────────────
// 大观园 UI 入口：initUI(app)
// 组装启动页、品牌区、景点目录、信息卡、小地图、底部控制条、漫游字幕、帮助弹层、
// 性能面板、赏景模式与快捷键。所有能力对 app 缺失的 API 做静默降级。
// ─────────────────────────────────────────────────────────────────────────────
import { initBoot } from './boot.js';
import { initBrand } from './brand.js';
import { initTools } from './tools.js';
import { initPanel } from './panel.js';
import { initCard } from './card.js';
import { initMinimap } from './minimap.js';
import { initDock } from './dock.js';
import { initTour } from './tour.js';
import { initHelp } from './help.js';
import { initPerf } from './perf.js';
import { normalizePoi } from './content.js';
import { h, on, safe, isTypingTarget } from './util.js';

const TOD_KEYS = ['dawn', 'day', 'dusk', 'night'];
const TOD_LONG = { dawn: '清晨', day: '白晝', dusk: '黃昏', night: '夜晚' };
const MOBILE_QUERY = '(max-width: 820px)';

export function initUI(app) {
  if (typeof window === 'undefined') return null;
  if (window.__GVG_UI__) return window.__GVG_UI__;

  const root = document.getElementById('ui-root') || document.body;
  const appRef = app || (window.GVG && window.GVG.app) || {};
  const mq = window.matchMedia(MOBILE_QUERY);
  const body = document.body;
  const params = new URLSearchParams(window.location.search);
  const isShot = params.has('shot');
  const listenOff = [];
  let pendingPoiId = null;
  let welcomeEl = null;
  let welcomeTimer = 0;

  const ctx = {
    app: appRef,
    root,
    body,
    pois: [],
    byId: new Map(),
    indexById: new Map(),
    ui: {},
    state: {
      tod: 'day',
      tour: false,
      labels: true,
      labelsKnown: false,
      zen: false,
      ready: false,
      panelOpen: false,
      cardOpen: false,
      helpOpen: false,
      perfOpen: false,
      cardPoi: null,
      activeId: '',
    },
    isMobile: () => mq.matches,
  };

  /* ── 与主程序通信的薄封装（全部可缺省） ───────────────────── */
  function hasFn(name) {
    return typeof appRef[name] === 'function';
  }

  function callApp(name, ...args) {
    if (!hasFn(name)) return undefined;
    return safe(() => appRef[name](...args), undefined);
  }

  ctx.onApp = function onApp(name, handler) {
    if (typeof appRef.on !== 'function') return () => {};
    const wrapped = (payload) => {
      try {
        handler(payload);
      } catch (error) {
        // 引擎事件里抛错不应打断主循环；只提示，不抛到 error 级
        if (window.console && console.warn) console.warn('[ui] event handler failed:', name, error);
      }
    };
    const off = safe(() => appRef.on(name, wrapped), null);
    if (typeof off === 'function') listenOff.push(off);
    return typeof off === 'function' ? off : () => {};
  };

  ctx.readAppState = function readAppState() {
    const raw = safe(() => (typeof appRef.getState === 'function' ? appRef.getState() : null), null);
    const fromGetter = raw && typeof raw === 'object' ? raw : {};
    const pick = (key) => (fromGetter[key] !== undefined ? fromGetter[key] : appRef[key]);
    return {
      tod: pick('tod'),
      tour: pick('tour'),
      labels: pick('labels'),
      hidden: pick('hidden'),
      ready: pick('ready') !== undefined ? pick('ready') : window.GVG && window.GVG.ready,
    };
  };

  // 无障碍播报区域
  const live = h('div', { class: 'sr-only', attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' } });
  root.appendChild(live);
  ctx.announce = function announce(text) {
    const message = String(text || '');
    live.textContent = '';
    setTimeout(() => { live.textContent = message; }, 30);
  };

  // 轻微暗角，让界面文字在明亮场景上仍可读
  const vignette = h('div', { class: 'vignette', attrs: { 'aria-hidden': 'true' } });
  root.insertBefore(vignette, root.firstChild);

  ctx.resolvePoiPayload = function resolvePoiPayload(payload) {
    if (!payload) return null;
    if (typeof payload === 'string') return ctx.byId.get(payload) || null;
    if (typeof payload === 'object') {
      if (payload.poi) return resolvePoiPayload(payload.poi);
      if (payload.id && ctx.byId.has(payload.id)) return ctx.byId.get(payload.id);
      if (payload.id || payload.name) return normalizePoi(payload);
    }
    return null;
  };
  ctx.getPoi = (id) => ctx.byId.get(id) || null;
  ctx.indexOfPoi = (id) => (ctx.indexById.has(id) ? ctx.indexById.get(id) : -1);

  /* ── 景点数据 ─────────────────────────────────────────────── */
  function refreshPois() {
    const source = window.GVG && window.GVG.pois;
    if (!Array.isArray(source) || !source.length) return false;
    const normalized = source.map(normalizePoi).filter((poi) => poi.id);
    const sameOrder =
      normalized.length === ctx.pois.length &&
      normalized.every((poi, index) => ctx.pois[index] && ctx.pois[index].id === poi.id);
    ctx.pois = normalized;
    ctx.byId = new Map();
    ctx.indexById = new Map();
    normalized.forEach((poi, index) => {
      ctx.byId.set(poi.id, poi);
      ctx.indexById.set(poi.id, index);
    });
    ctx.ui.panel?.render();
    ctx.ui.minimap?.refresh();
    if (!sameOrder && ctx.state.cardPoi) {
      const current = ctx.byId.get(ctx.state.cardPoi.id);
      if (current) {
        ctx.state.cardPoi = current;
        ctx.ui.card?.render(current);
      }
    }
    if (pendingPoiId) {
      const id = pendingPoiId;
      pendingPoiId = null;
      goTo(id);
    }
    return true;
  }
  ctx.refreshPois = refreshPois;

  /* ── 各模块初始化 ─────────────────────────────────────────── */
  ctx.ui.boot = initBoot(ctx);
  ctx.ui.brand = initBrand(ctx);
  ctx.ui.tools = initTools(ctx);
  ctx.ui.panel = initPanel(ctx);
  ctx.ui.card = initCard(ctx);
  ctx.ui.minimap = initMinimap(ctx);
  ctx.ui.dock = initDock(ctx);
  ctx.ui.tour = initTour(ctx);
  ctx.ui.help = initHelp(ctx);
  ctx.ui.perf = initPerf(ctx);

  /* ── 模块状态回调 ─────────────────────────────────────────── */
  ctx.onPanelStateChange = (open) => {
    ctx.state.panelOpen = Boolean(open);
    ctx.ui.tools?.setPanelOpen(open);
  };
  ctx.onCardStateChange = (open, poi) => {
    ctx.state.cardOpen = Boolean(open);
    ctx.state.cardPoi = open ? poi : null;
  };
  ctx.onHelpStateChange = (open) => {
    ctx.state.helpOpen = Boolean(open);
  };
  ctx.onPerfStateChange = (open) => {
    ctx.state.perfOpen = Boolean(open);
  };

  /* ── 行为：时段 / 标签 / 漫游 / 赏景 / 面板 ───────────────── */
  function setTod(key) {
    if (!TOD_KEYS.includes(key)) return;
    ctx.state.tod = key;
    ctx.ui.dock?.updateTod(key);
    callApp('setTod', key);
    ctx.announce(`時段：${TOD_LONG[key]}`);
  }

  function toggleLabels() {
    let next;
    const result = callApp('toggleLabels');
    if (typeof result === 'boolean') next = result;
    if (typeof next !== 'boolean') next = !ctx.state.labels;
    ctx.state.labels = next;
    ctx.state.labelsKnown = true;
    ctx.ui.dock?.updateLabels(next);
    ctx.announce(next ? '顯示地名標籤' : '隱藏地名標籤');
  }

  function startTour() {
    if (!hasFn('toggleTour')) return;
    hideWelcomeHint();
    ctx.state.tour = true;
    callApp('toggleTour');
    ctx.ui.dock?.updateTour(true);
    closeCard();
    if (ctx.isMobile() && ctx.state.panelOpen) ctx.ui.panel?.setOpen(false, { restoreFocus: false });
    ctx.announce('開始自動漫遊');
  }

  function stopTour() {
    if (ctx.state.tour && hasFn('toggleTour')) callApp('toggleTour');
    ctx.state.tour = false;
    ctx.ui.dock?.updateTour(false);
    ctx.ui.tour?.hide();
    ctx.announce('停止漫遊');
  }

  function toggleTour() {
    if (ctx.state.tour) stopTour();
    else startTour();
  }

  function applyZen(value, options = {}) {
    const active = Boolean(value);
    ctx.state.zen = active;
    body.classList.toggle('zen', active);
    ctx.ui.tools?.setZen(active);
    if (active) {
      if (document.activeElement && root.contains(document.activeElement) && document.activeElement.blur) {
        document.activeElement.blur();
      }
    }
    if (!options.silent) {
      if (active) {
        closeHelp();
        closeCard();
        ctx.announce('賞景模式：按 H 或點擊右下角按鈕返回');
      } else {
        ctx.announce('已顯示介面');
      }
    }
  }

  function setZen(value) {
    const active = Boolean(value);
    if (active === ctx.state.zen) return;
    applyZen(active);
    callApp('hideUI', active);
  }

  function openPoi(input, options = {}) {
    const poi = typeof input === 'string' ? ctx.byId.get(input) : input;
    if (!poi) {
      if (typeof input === 'string') pendingPoiId = input;
      return;
    }
    if (ctx.state.tour && options.manual) stopTour();
    ctx.state.activeId = poi.id;
    ctx.state.cardPoi = poi;
    ctx.ui.card?.open(poi, options);
    ctx.ui.panel?.setActive(poi.id, { scroll: options.scrollPanel !== false });
    if (ctx.isMobile() && ctx.state.panelOpen) ctx.ui.panel?.setOpen(false, { restoreFocus: false });
  }

  function closeCard() {
    ctx.ui.card?.close();
  }

  function goTo(id) {
    const poi = ctx.byId.get(id);
    if (!poi) {
      if (typeof id === 'string') pendingPoiId = id;
      callApp('goTo', id);
      return;
    }
    if (ctx.state.tour) stopTour();
    ctx.state.activeId = poi.id;
    callApp('goTo', id);
    openPoi(poi, { manual: true });
  }

  function flyToGround(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    if (hasFn('flyToGround')) callApp('flyToGround', x, z);
  }

  function togglePanel() {
    if (!ctx.ui.panel) return;
    ctx.ui.panel.setOpen(!ctx.state.panelOpen, { restoreFocus: false });
  }

  function openHelp() {
    ctx.ui.help?.open();
  }

  function closeHelp() {
    ctx.ui.help?.close();
  }

  function togglePerf() {
    ctx.ui.perf?.toggle();
  }

  Object.assign(ctx, {
    setTod,
    toggleLabels,
    startTour,
    stopTour,
    toggleTour,
    setZen,
    openPoi,
    closeCard,
    goTo,
    flyToGround,
    togglePanel,
    openHelp,
    closeHelp,
    togglePerf,
  });

  /* ── 主程序事件 ───────────────────────────────────────────── */
  ctx.onApp('ready', () => {
    ctx.state.ready = true;
    ctx.ui.boot?.finish();
    refreshPois();
    syncFromApp();
    scheduleWelcomeHint(900);
  });

  ctx.onApp('poi', (payload) => {
    refreshPois();
    const poi = ctx.resolvePoiPayload(payload);
    if (!poi) return;
    ctx.state.activeId = poi.id;
    ctx.ui.panel?.setActive(poi.id, { scroll: true });
    // 漫游过程中由字幕接管，不弹信息卡
    if (ctx.state.tour) return;
    openPoi(poi, { manual: false });
  });

  ctx.onApp('tour', (payload) => {
    refreshPois();
    ctx.state.tour = true;
    ctx.ui.dock?.updateTour(true);
    const toured = ctx.resolvePoiPayload(payload);
    if (toured) {
      ctx.state.activeId = toured.id;
      ctx.ui.panel?.setActive(toured.id, { scroll: false });
    }
    ctx.state.cardOpen = false;
    ctx.state.cardPoi = null;
    ctx.ui.card?.close();
    if (ctx.isMobile() && ctx.state.panelOpen) ctx.ui.panel?.setOpen(false, { restoreFocus: false });
    ctx.ui.tour?.show(payload);
  });

  ctx.onApp('tourstop', () => {
    ctx.state.tour = false;
    ctx.ui.dock?.updateTour(false);
    ctx.ui.tour?.hide();
  });

  ctx.onApp('tod', (name) => {
    if (!TOD_KEYS.includes(name)) return;
    ctx.state.tod = name;
    ctx.ui.dock?.updateTod(name);
  });

  ctx.onApp('labels', (value) => {
    if (typeof value !== 'boolean') return;
    ctx.state.labels = value;
    ctx.state.labelsKnown = true;
    ctx.ui.dock?.updateLabels(value);
  });

  ctx.onApp('tourstate', (value) => {
    if (typeof value !== 'boolean') return;
    ctx.state.tour = value;
    ctx.ui.dock?.updateTour(value);
    if (!value) ctx.ui.tour?.hide();
  });

  ctx.onApp('uihidden', (value) => {
    if (typeof value !== 'boolean') return;
    if (value !== ctx.state.zen) applyZen(value, { silent: true });
  });

  /* ── 状态同步 ─────────────────────────────────────────────── */
  function applyStateToUI() {
    ctx.ui.dock?.updateTod(ctx.state.tod);
    ctx.ui.dock?.updateTour(ctx.state.tour);
    ctx.ui.dock?.updateLabels(ctx.state.labelsKnown ? ctx.state.labels : null);
    ctx.ui.tools?.setPanelOpen(ctx.state.panelOpen);
    ctx.ui.tools?.setZen(ctx.state.zen);
    body.classList.toggle('zen', ctx.state.zen);
  }

  function syncFromApp() {
    const state = ctx.readAppState();
    if (TOD_KEYS.includes(state.tod)) ctx.state.tod = state.tod;
    if (typeof state.tour === 'boolean') ctx.state.tour = state.tour;
    if (typeof state.labels === 'boolean') {
      ctx.state.labels = state.labels;
      ctx.state.labelsKnown = true;
    }
    if (typeof state.ready === 'boolean') ctx.state.ready = state.ready;
    if (typeof state.hidden === 'boolean' && state.hidden !== ctx.state.zen) {
      applyZen(state.hidden, { silent: true });
    }
    applyStateToUI();
  }

  /* ── 首次进入提示 ─────────────────────────────────────────── */
  function hideWelcomeHint() {
    if (!welcomeEl) return;
    welcomeEl.classList.remove('show');
    clearTimeout(welcomeTimer);
    const node = welcomeEl;
    welcomeEl = null;
    setTimeout(() => { node.remove(); }, 500);
  }

  function scheduleWelcomeHint(delay) {
    if (welcomeEl) return;
    // 截图模式保持画面整洁；正常游览时才给首次提示
    if (isShot) return;
    setTimeout(() => {
      if (ctx.state.zen || welcomeEl) return;
      const text = ctx.isMobile()
        ? '單指旋轉 · 雙指縮放平移 · 點選景點開始遊園'
        : '按住拖曳即可環視 · 滾輪縮放 · 點選景點開始遊園';
      welcomeEl = h('div', { class: 'welcome-hint', attrs: { role: 'status' } }, h('span', { class: 'wh-text', text }));
      root.appendChild(welcomeEl);
      requestAnimationFrame(() => welcomeEl && welcomeEl.classList.add('show'));
      welcomeTimer = setTimeout(hideWelcomeHint, 6200);
    }, delay);
  }

  on(window, 'pointerdown', hideWelcomeHint, { capture: true, passive: true });
  on(window, 'keydown', hideWelcomeHint, { capture: true });

  /* ── 快捷键 ───────────────────────────────────────────────── */
  const closeOnEscape = () => {
    if (ctx.state.helpOpen) {
      ctx.ui.help?.close();
      return true;
    }
    if (ctx.state.cardOpen) {
      closeCard();
      return true;
    }
    if (ctx.state.zen) {
      setZen(false);
      return true;
    }
    if (ctx.isMobile() && ctx.state.panelOpen) {
      ctx.ui.panel?.setOpen(false, { restoreFocus: true });
      return true;
    }
    if (ctx.state.perfOpen) {
      ctx.ui.perf?.stop();
      return true;
    }
    return false;
  };

  on(window, 'keydown', (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;

    if (ctx.state.helpOpen) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeOnEscape();
      }
      return;
    }

    if (ctx.state.zen) {
      if (event.key === 'h' || event.key === 'H' || event.key === 'Escape') {
        event.preventDefault();
        setZen(false);
      }
      return;
    }

    switch (event.key) {
      case '1':
      case '2':
      case '3':
      case '4':
        event.preventDefault();
        setTod(TOD_KEYS[Number(event.key) - 1]);
        break;
      case 't':
      case 'T':
        event.preventDefault();
        toggleTour();
        break;
      case 'l':
      case 'L':
        event.preventDefault();
        toggleLabels();
        break;
      case 'h':
      case 'H':
        event.preventDefault();
        setZen(true);
        break;
      case '?':
      case 'F1':
        event.preventDefault();
        openHelp();
        break;
      case 'Escape':
        if (closeOnEscape()) event.preventDefault();
        break;
      default:
        break;
    }
  });

  /* ── 断点切换：PC 展开目录，移动端收起为抽屉 ─────────────── */
  const onViewportModeChange = (event) => {
    const mobile = Boolean(event.matches);
    body.classList.toggle('is-mobile', mobile);
    ctx.ui.panel?.setOpen(!mobile, { focus: false, restoreFocus: false });
    ctx.ui.minimap?.refresh();
    if (mobile) hideWelcomeHint();
  };
  try {
    mq.addEventListener('change', onViewportModeChange);
    listenOff.push(() => mq.removeEventListener('change', onViewportModeChange));
  } catch {
    try {
      mq.addListener(onViewportModeChange);
      listenOff.push(() => mq.removeListener(onViewportModeChange));
    } catch { /* ignore */ }
  }

  /* ── 初始状态 ─────────────────────────────────────────────── */
  body.classList.toggle('is-mobile', mq.matches);
  refreshPois();
  syncFromApp();
  ctx.ui.panel?.setOpen(!mq.matches, { focus: false, restoreFocus: false });
  ctx.ui.dock?.updateLabels(ctx.state.labelsKnown ? ctx.state.labels : true);
  ctx.ui.dock?.updateTour(false);
  ctx.ui.dock?.updateTod(ctx.state.tod);
  ctx.ui.tools?.setPanelOpen(ctx.state.panelOpen);

  // 兼容：主程序可能稍后才挂 window.GVG.pois（正常流程在 initUI 之前已就绪）
  if (!ctx.pois.length) {
    setTimeout(() => { if (!ctx.pois.length) refreshPois(); }, 400);
    setTimeout(() => { if (!ctx.pois.length) refreshPois(); }, 1400);
  }
  if (ctx.state.ready || (window.GVG && window.GVG.ready === true)) scheduleWelcomeHint(1200);
  if (!isShot && !ctx.state.ready) {
    // 正常模式：ready 事件里会再次调度；此处兜底窗口生命周期内未收到事件的情况
    setTimeout(() => { if (!welcomeEl && !ctx.state.zen) scheduleWelcomeHint(400); }, 6000);
  }

  /* ── 对外接口（供主程序与截图脚本使用） ─────────────────── */
  const api = {
    ctx,
    refresh: refreshPois,
    openPoi: (id) => {
      const poi = typeof id === 'string' ? ctx.byId.get(id) : id;
      if (poi) openPoi(poi, { manual: true });
    },
    goTo,
    closeCard,
    setTod,
    toggleTour,
    startTour,
    stopTour,
    toggleLabels,
    setZen,
    toggleZen: () => setZen(!ctx.state.zen),
    openPanel: () => ctx.ui.panel?.setOpen(true),
    closePanel: () => ctx.ui.panel?.setOpen(false),
    togglePanel,
    openHelp,
    closeHelp,
    togglePerf,
    flyToGround,
    get state() { return ctx.state; },
  };
  window.__GVG_UI__ = api;
  window.__UI__ = api;
  return api;
}
