// ─────────────────────────────────────────────────────────────────────────────
// UI 通用工具：DOM 构造、事件、数据处理。
// 本文件不在模块顶层访问 window/document，可在 Node 中安全导入（语法自检用）。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 极简 DOM 构造器。
 * h('button', { class:'btn', text:'說明', attrs:{ type:'button', 'aria-label':'說明' },
 *               on:{ click: fn } }, icon('help'))
 */
export function h(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props && typeof props === 'object') {
    const { class: cls, text, html, attrs, dataset, style, on, ...rest } = props;
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (html !== undefined && html !== null) node.innerHTML = html;
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === null || value === false) continue;
        node.setAttribute(key, value === true ? '' : String(value));
      }
    }
    if (dataset) {
      for (const [key, value] of Object.entries(dataset)) {
        if (value === undefined || value === null) continue;
        node.dataset[key] = String(value);
      }
    }
    if (style) {
      for (const [key, value] of Object.entries(style)) node.style.setProperty(key, String(value));
    }
    if (on) {
      for (const [type, fn] of Object.entries(on)) node.addEventListener(type, fn);
    }
    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) continue;
      if (key === 'type' || key === 'value' || key === 'title' || key === 'tabIndex') node[key] = value;
    }
  }
  appendChildren(node, children);
  return node;
}

/** 递归追加子节点（支持数组 / 字符串 / 数字 / null）。 */
export function appendChildren(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) {
      appendChildren(parent, child);
      continue;
    }
    if (typeof Node !== 'undefined' && child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
  return parent;
}

/** 由静态 SVG 字符串生成元素（仅用于内置图标/装饰，不接收外部数据）。 */
export function svgElement(markup) {
  const template = document.createElement('template');
  template.innerHTML = String(markup).trim();
  return template.content.firstElementChild;
}

/** 事件绑定，返回解绑函数；target 为空时静默返回 noop。 */
export function on(target, type, handler, options) {
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  target.addEventListener(type, handler, options);
  return () => {
    try { target.removeEventListener(type, handler, options); } catch { /* ignore */ }
  };
}

/** 安全调用：异常时返回 fallback（UI 永不因引擎缺 API 抛错）。 */
export function safe(fn, fallback = undefined) {
  try { return fn(); } catch { return fallback; }
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** 千分位；不依赖运行环境 locale。 */
export function thousands(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return String(Math.round(num)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 紧凑数量：1,234,567 → 1.23M；12,345 → 12.3k。 */
export function compact(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  if (Math.abs(num) >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (Math.abs(num) >= 1e4) return `${(num / 1e3).toFixed(1)}k`;
  return thousands(num);
}

export function debounce(fn, wait = 120) {
  let timer = 0;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/** 限制到每帧最多执行一次。 */
export function rafThrottle(fn) {
  let queued = false;
  let lastArgs = null;
  return function throttled(...args) {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn.apply(this, lastArgs);
    });
  };
}

export function prefersReducedMotion() {
  return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** 截断长文本（用于漫游字幕的原文一句）。 */
export function shorten(text, max = 70) {
  const str = String(text || '').replace(/\s+/g, ' ').trim();
  if (str.length <= max) return str;
  return `${str.slice(0, Math.max(1, max - 1))}…`;
}

/** 从文本中取第一句（漫游字幕在无 quote 时的降级）。 */
export function firstSentence(text, max = 70) {
  const str = String(text || '').replace(/\s+/g, ' ').trim();
  if (!str) return '';
  const match = str.match(/^.+?[。！？!?]/);
  return shorten(match ? match[0] : str, max);
}

/** 焦点是否处于可输入/可编辑元素中（快捷键应让行）。 */
export function isTypingTarget(target) {
  if (!target || target.nodeType !== 1) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true;
}

/** 取一个元素当前是否可聚焦（用于帮助弹层焦点陷阱）。 */
export function focusableWithin(container) {
  if (!container) return [];
  const selector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll(selector)).filter((node) => {
    if (node.hasAttribute('hidden')) return false;
    const style = window.getComputedStyle(node);
    return style.visibility !== 'hidden' && style.display !== 'none';
  });
}
