// ─────────────────────────────────────────────────────────────────────────────
// 启动页：#boot 的进度、阶段文案、就绪淡出与 WebGL 降级提示。
// 主程序只发 progress/ready 事件，不直接操作 #boot。
// ─────────────────────────────────────────────────────────────────────────────
import { h, on, clamp, prefersReducedMotion } from './util.js';
import { icon } from './icons.js';

const ERROR_SUGGESTIONS = [
  '使用最新版的 Chrome、Edge 或 Safari 瀏覽器開啟本頁。',
  '在瀏覽器設定中開啟「硬體加速 / Hardware acceleration」，然後重新載入。',
  '更新顯示卡驅動程式；若在虛擬機或遠端桌面中，請允許軟體渲染（如 SwiftShader）。',
  '若使用公司或校園裝置，請確認瀏覽器策略未停用 WebGL。',
];

const FALLBACK_STAGES = [
  [0.12, '正在鋪陳山川…'],
  [0.28, '正在引沁芳溪水…'],
  [0.45, '正在蒔花藝樹…'],
  [0.6, '正在起樓臺亭榭…'],
  [0.76, '正在題匾額楹聯…'],
  [0.9, '正在點染晨昏…'],
  [1, '園林將成…'],
];

function detectWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const attrs = { failIfMajorPerformanceCaveat: false, antialias: false, depth: false, stencil: false };
    const gl = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
    if (!gl) return false;
    const lose = gl.getExtension && gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch {
    return false;
  }
}

function stageText(percent) {
  const ratio = clamp(percent, 0, 100) / 100;
  for (const [threshold, text] of FALLBACK_STAGES) {
    if (ratio <= threshold) return text;
  }
  return FALLBACK_STAGES[FALLBACK_STAGES.length - 1][1];
}

export function initBoot(ctx) {
  const boot = document.getElementById('boot');
  if (!boot) return { progress() {}, finish() {}, fail() {}, isDone: () => true };

  const inner = boot.querySelector('.boot-inner') || boot;
  const existingBar = boot.querySelector('.boot-bar');
  const barFill = boot.querySelector('.boot-bar i');
  const status = boot.querySelector('#boot-status') || boot.querySelector('.boot-status');

  const bar = existingBar || h('div', { class: 'boot-bar' }, h('i'));
  const fill = barFill || bar.querySelector('i') || h('i');
  if (!existingBar) inner.appendChild(bar);
  if (!fill.parentNode) bar.appendChild(fill);
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', '0');
  bar.removeAttribute('aria-hidden');

  const pct = h('span', { class: 'boot-pct', attrs: { 'aria-hidden': 'true' }, text: '0%' });
  const stageLabel = status || h('p', { class: 'boot-status', attrs: { id: 'boot-status' } });
  if (!status) inner.appendChild(stageLabel);
  stageLabel.classList.add('boot-status');
  stageLabel.setAttribute('aria-live', 'polite');
  stageLabel.setAttribute('aria-atomic', 'true');

  const line = h('div', { class: 'boot-line' }, stageLabel, pct);
  if (stageLabel.parentNode === inner && stageLabel.nextSibling) inner.insertBefore(line, stageLabel);
  else inner.appendChild(line);
  if (stageLabel.parentNode !== line) line.insertBefore(stageLabel, pct);

  // 底部提示与慢速重载入口
  const tipText = h('span', {
    class: 'boot-tip-text',
    text: '建議以 Chrome / Edge 開啟並啟用硬體加速 · 首次營造需稍候',
  });
  const retry = h(
    'button',
    {
      class: 'boot-retry',
      attrs: { type: 'button', 'aria-label': '重新載入頁面' },
      on: { click: () => safeReload() },
    },
    icon('reload'),
    h('span', { text: '重新載入' }),
  );
  const tip = inner.querySelector('.boot-tip') || h('p', { class: 'boot-tip' }, tipText, retry);
  if (!tip.parentNode) boot.appendChild(tip);
  if (!tip.querySelector('.boot-tip-text')) tip.prepend(tipText);
  if (!tip.querySelector('.boot-retry')) tip.appendChild(retry);

  // WebGL 错误面板
  const errorTitle = h('h2', { class: 'boot-error-title', text: '此裝置無法啟動 WebGL' });
  const errorDesc = h('p', {
    class: 'boot-error-desc',
    text: '本園以 WebGL 即時繪製體素園林。目前瀏覽器未能建立三維繪圖環境，因此無法進入園中。',
  });
  const errorList = h(
    'ul',
    { class: 'boot-error-list' },
    ERROR_SUGGESTIONS.map((text) => h('li', { text })),
  );
  const errorDetail = h('p', { class: 'boot-error-detail', text: '' });
  const errorActions = h(
    'div',
    { class: 'boot-error-actions' },
    h(
      'button',
      {
        class: 'btn btn-primary',
        attrs: { type: 'button', 'aria-label': '重新載入頁面' },
        on: { click: () => safeReload() },
      },
      icon('reload'),
      h('span', { text: '重新載入' }),
    ),
  );
  const errorPanel = h(
    'div',
    { class: 'boot-error', attrs: { role: 'alert' } },
    errorTitle,
    errorDesc,
    errorList,
    errorDetail,
    errorActions,
  );
  inner.appendChild(errorPanel);

  let target = 0;
  let done = false;
  let failed = false;
  let lastProgressAt = 0;
  const timers = [];
  const later = (fn, ms) => {
    const id = setTimeout(fn, ms);
    timers.push(id);
    return id;
  };
  const clearTimers = () => {
    while (timers.length) clearTimeout(timers.pop());
  };

  function renderProgress(percent) {
    const value = clamp(percent, 0, 100);
    target = Math.max(target, value);
    fill.style.width = `${target.toFixed(2)}%`;
    pct.textContent = `${Math.round(target)}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(target)));
  }

  function setStatus(text) {
    if (!text) return;
    stageLabel.textContent = text;
  }

  function progress(data) {
    if (done || failed) return;
    const payload = data && typeof data === 'object' ? data : {};
    lastProgressAt = Date.now();
    boot.classList.add('is-loading');
    if (typeof payload.p === 'number' && Number.isFinite(payload.p)) {
      const percent = payload.p <= 1 ? payload.p * 100 : payload.p;
      renderProgress(percent);
      if (!payload.text) setStatus(stageText(percent));
    }
    if (payload.text) setStatus(String(payload.text));
  }

  function finish() {
    if (done || failed) return;
    done = true;
    clearTimers();
    renderProgress(100);
    setStatus('園林已就緒');
    bar.classList.add('is-full');
    boot.classList.add('is-ready');
    const reduced = prefersReducedMotion();
    later(() => {
      boot.classList.add('is-done');
      boot.setAttribute('aria-hidden', 'true');
    }, reduced ? 80 : 380);
    later(() => {
      // 保留节点，避免主程序后续引用 #boot 时报错；彻底隐藏并停止拦截事件。
      boot.style.visibility = 'hidden';
      boot.style.pointerEvents = 'none';
      boot.style.display = 'none';
    }, reduced ? 200 : 1500);
  }

  function fail(reason, detail, options = {}) {
    if (done || failed) return;
    failed = true;
    clearTimers();
    boot.classList.remove('is-loading');
    boot.classList.add('has-error');
    bar.classList.add('is-error');
    bar.setAttribute('aria-valuenow', '0');
    if (reason) errorTitle.textContent = String(reason);
    if (detail) errorDetail.textContent = String(detail);
    else errorDetail.textContent = 'WebGL 2.0 / 1.0 均無法建立，或顯卡驅動被瀏覽器停用。';
    if (options.build) {
      errorDesc.textContent = '三維園林在建構過程中發生錯誤。可先重新載入；若問題持續，請查看瀏覽器控制台的錯誤詳情並回報。';
      errorList.hidden = true;
    }
    setStatus(options.build ? '園林營造失敗' : '無法啟動三維渲染');
    pct.textContent = '';
    boot.classList.remove('is-slow');
  }

  if (!detectWebGL()) {
    later(() => fail('此裝置無法啟動 WebGL', '偵測結果：瀏覽器未提供可用的 WebGL 繪圖環境。'), 180);
  }

  // 引擎若已有状态可即时收尾（initUI 晚于 ready 的情况）
  const alreadyReady = () => {
    const state = ctx.readAppState ? ctx.readAppState() : null;
    return Boolean((state && state.ready === true) || window.__GVG_READY__ === true || ctx.app?.ready === true);
  };
  if (alreadyReady()) {
    later(finish, 420);
  } else {
    later(() => { if (alreadyReady()) finish(); }, 1200);
    later(() => { if (alreadyReady()) finish(); }, 2600);
    // 没有任何 ready 事件但引擎已就绪时的兜底轮询（最多约 90 秒）
    let polls = 0;
    const poll = setInterval(() => {
      if (done || failed) {
        clearInterval(poll);
        return;
      }
      polls += 1;
      if (alreadyReady()) {
        clearInterval(poll);
        finish();
      } else if (polls > 45) {
        clearInterval(poll);
      }
    }, 2000);
    timers.push(poll);
  }

  // 慢速提示：20s 起显示重载入口，不覆盖阶段文案
  later(() => {
    if (done || failed) return;
    boot.classList.add('is-slow');
    tipText.textContent = '營造時間較長：若一直停留於此，可能是裝置不支援 WebGL，或瀏覽器停用了硬體加速。';
  }, 20000);

  // 运行中上下文丢失也给出可读提示
  const scene = document.getElementById('scene');
  if (scene) {
    on(scene, 'webglcontextlost', () => {
      if (done || failed) return;
      fail('三維繪圖環境已中斷', '顯示卡的繪圖資源被系統回收或驅動重置，請重新載入頁面以繼續遊園。');
    });
  }

  ctx.onApp('progress', progress);
  ctx.onApp('ready', finish);
  ctx.onApp('error', (payload) => {
    const message = payload && payload.message ? String(payload.message) : '';
    fail('園林營造失敗', message || '三維園林在建構過程中發生錯誤，請重新載入頁面再試。', { build: true });
  });

  // 若进度长期不动，阶段文案轻微更新（不制造报错）
  on(document, 'visibilitychange', () => {
    if (document.visibilityState === 'visible' && !done && !failed && Date.now() - lastProgressAt > 30000) {
      setStatus('仍在營造園林…');
    }
  });

  return { progress, finish, fail, isDone: () => done || failed };
}

function safeReload() {
  try { window.location.reload(); } catch { /* ignore */ }
}
