// ─────────────────────────────────────────────────────────────────────────────
// 内联 SVG 图标（不使用 emoji / 不加载外部字体或图片）。
// 统一 24×24 视框、1.6px 线宽、currentColor 描边，随文字颜色变化。
// ─────────────────────────────────────────────────────────────────────────────
import { svgElement } from './util.js';

const SHELL_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" focusable="false"';

const PATHS = {
  chevronUp: '<path d="M6 15l6-6 6 6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  list: '<path d="M8.5 6h12M8.5 12h12M8.5 18h12"/><circle cx="4.2" cy="6" r="1.15" fill="currentColor" stroke="none"/><circle cx="4.2" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="4.2" cy="18" r="1.15" fill="currentColor" stroke="none"/>',
  eye: '<path d="M2.6 12S6.1 5.9 12 5.9 21.4 12 21.4 12 17.9 18.1 12 18.1 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="3.05"/>',
  eyeOff: '<path d="M4.2 4.2l15.6 15.6"/><path d="M9.9 5.3A10.2 10.2 0 0 1 12 5.1c5.9 0 9.4 6.9 9.4 6.9a17.6 17.6 0 0 1-2.8 3.7M6.7 7.1A17.4 17.4 0 0 0 2.6 12s3.5 6.1 9.4 6.1a9.9 9.9 0 0 0 4.1-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  play: '<path d="M8.2 5.3v13.4L19 12z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6.6" y="6.6" width="10.8" height="10.8" rx="1.5" fill="currentColor" stroke="none"/>',
  skipNext: '<path d="M5 5.6l8.4 6.4L5 18.4z" fill="currentColor" stroke="none"/><path d="M17.6 5.2v13.6"/>',
  tag: '<path d="M20.6 13.4l-7.3 7.3a1.9 1.9 0 0 1-2.7 0l-7.1-7.1a1.9 1.9 0 0 1-.56-1.34V4.2A1.2 1.2 0 0 1 4.14 3h8.04a1.9 1.9 0 0 1 1.34.56l7.1 7.1a1.9 1.9 0 0 1 0 2.74z"/><circle cx="7.6" cy="7.6" r="1.4"/>',
  fullscreen: '<path d="M4 9.5V4h5.5M14.5 4H20v5.5M20 14.5V20h-5.5M9.5 20H4v-5.5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.1a2.6 2.6 0 1 1 3.8 2.4c-.9.5-1.4 1.1-1.4 2.1v.35"/><circle cx="12" cy="17.2" r="0.95" fill="currentColor" stroke="none"/>',
  map: '<path d="M9 4.2L3.2 6.2v13.6L9 17.8l6 2 5.8-2V4.2l-5.8 2-6-2z"/><path d="M9 4.2v13.6M15 6.2v13.6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.4"/><circle cx="12" cy="7.8" r="0.95" fill="currentColor" stroke="none"/>',
  arrowRight: '<path d="M4.5 12h14M13 6.5l5.5 5.5-5.5 5.5"/>',
  arrowUp: '<path d="M12 19V5M6.5 10.5L12 5l5.5 5.5"/>',
  pin: '<path d="M12 21s6.4-5.9 6.4-10.4A6.4 6.4 0 0 0 5.6 10.6C5.6 15.1 12 21 12 21z"/><circle cx="12" cy="10.3" r="2.4"/>',
  reload: '<path d="M19.5 11.2A7.6 7.6 0 1 0 17.4 17"/><path d="M19.8 4.6v6.6h-6.6"/>',
  compass: '<circle cx="12" cy="12" r="8.6"/><path d="M15.2 8.8l-2 4.4-4.4 2 2-4.4 4.4-2z" fill="currentColor" stroke="none"/>',
  minus: '<path d="M6 12h12"/>',
  plus: '<path d="M12 6v12M6 12h12"/>',
  target: '<circle cx="12" cy="12" r="7.2"/><circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none"/><path d="M12 2.4v3.2M12 18.4v3.2M2.4 12h3.2M18.4 12h3.2"/>',
  layers: '<path d="M12 3.4l8.4 4.3L12 12 3.6 7.7z"/><path d="M3.6 12.2L12 16.5l8.4-4.3M3.6 16.4L12 20.7l8.4-4.3"/>',
  // 步行模式相关
  walk: '<circle cx="13" cy="4.6" r="2.1"/><path d="M13.1 7.3l-1.5 4.2 1.8 2.8.9 5.4M11.7 11.6l-3.1 1.5M13.3 9.5l2.7 1.9 1.1 3.6M13.4 14.3l-2.3 5.5"/>',
  orbit: '<circle cx="12" cy="12" r="2.5"/><ellipse cx="12" cy="12" rx="9" ry="3.9" transform="rotate(-24 12 12)"/><circle cx="19.2" cy="8.7" r="1.2" fill="currentColor" stroke="none"/>',
  jump: '<path d="M12 19V6.2M7 11.2l5-5 5 5"/><path d="M6 21h12"/>',
  sprint: '<path d="M4 5.8l6.4 6.2L4 18.2M12 5.8l6.4 6.2L12 18.2"/>',
  exitWalk: '<path d="M10 4.5H5v15h5"/><path d="M14.5 8l4 4-4 4M9.5 12h9"/>',
  hand: '<path d="M8.6 13V6.4a1.4 1.4 0 0 1 2.8 0v5M11.4 11.4V5.2a1.4 1.4 0 0 1 2.8 0v5.6M14.2 11.6V7.4a1.4 1.4 0 0 1 2.8 0v6.3c0 4.1-2.7 6.9-6.3 6.9-3.2 0-5.6-2.2-6.2-5.1l-.9-3.1a1.35 1.35 0 0 1 2.4-1.2l1.8 2.6"/>',
  footprint: '<path d="M8.5 9.6c1.4 0 2.3-1.4 2.3-3.4S9.9 3 8.5 3 6.2 4.4 6.2 6.3s.9 3.3 2.3 3.3zM6.6 11.1c-1.1.4-1.8 1.2-1.8 2.6 0 1.9 1.5 3.1 3.4 3.1 1.4 0 2.5-.7 2.8-1.9"/><path d="M15.5 21c1.4 0 2.3-1.4 2.3-3.4s-.9-3.2-2.3-3.2-2.3 1.4-2.3 3.2.9 3.4 2.3 3.4z"/>',
};

/** 返回图标 HTML 字符串（用于 innerHTML 场景，仅限内置静态图标）。 */
export function iconMarkup(name, className = '') {
  const body = PATHS[name];
  if (!body) return '';
  return `<svg ${SHELL_ATTRS} class="ico ${className}" aria-hidden="true">${body}</svg>`;
}

/** 返回图标 SVG 元素。 */
export function icon(name, className = '') {
  return svgElement(iconMarkup(name, className));
}

export const ICON_NAMES = Object.keys(PATHS);
