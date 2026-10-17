// ─────────────────────────────────────────────────────────────────────────────
// 小地图：以 window.GVG.minimapImage（320×320 dataURL）为底图，叠加景点点位、
// 当前相机位置与朝向扇形。点击空白调用 app.flyToGround(x,z)，点击点位调用 goTo(id)。
// 无底图时用 window.GVG.layout 生成降级平面图；相机位置优先读 view.camera + controls.target。
// ─────────────────────────────────────────────────────────────────────────────
import { h, on, clamp, safe } from './util.js';
import { icon } from './icons.js';
import { groupColor } from './content.js';

const TAU = Math.PI * 2;
const FOV_HALF = 0.5; // 视角扇形半角（约 57°）

function wrapAngle(value) {
  let angle = value;
  while (angle > Math.PI) angle -= TAU;
  while (angle < -Math.PI) angle += TAU;
  return angle;
}

export function initMinimap(ctx) {
  const title = h('h2', { class: 'mm-title', text: '園圖' });
  const hint = h('span', { class: 'mm-hint', text: '上北下南' });
  const collapseBtn = h(
    'button',
    {
      class: 'mm-collapse',
      attrs: { type: 'button', 'aria-label': '收合小地圖', 'aria-expanded': 'true', title: '收合 / 展開小地圖' },
    },
    icon('chevronDown'),
  );
  const head = h('div', { class: 'mm-head' }, title, hint, collapseBtn);
  const canvas = h('canvas', {
    class: 'mm-canvas',
    attrs: {
      role: 'img',
      'aria-label': '大觀園平面圖：點擊景點圓點前往該景點，點擊其他位置飛至該處',
    },
  });
  const north = h('span', { class: 'mm-north', attrs: { 'aria-hidden': 'true' }, text: '北' });
  const tip = h('div', { class: 'mm-tip', attrs: { 'aria-hidden': 'true' } });
  const body = h('div', { class: 'mm-body' }, canvas, north, tip);
  const wrap = h('div', { class: 'minimap-wrap' }, head, body);
  ctx.root.appendChild(wrap);

  const g = canvas.getContext('2d');
  if (!g) return { el: wrap, refresh() {}, setCollapsed() {}, isCollapsed: () => false };

  const metrics = { w: 0, h: 0, dpr: 1 };
  let baseCanvas = null;
  let baseStamp = -1;
  let baseVersion = 0;
  let image = null;
  let imageSrc = '';
  let collapsed = false;
  let raf = 0;
  let lastDraw = 0;
  let hoverId = null;
  // 引擎 getView().heading = atan2(dirX, dirZ)，0 = 朝北、向东为正；
  // 画布角 0 = 正东、顺时针为南。初始按 -90° 换算，之后若同时读到相机与 heading 会自动标定。
  let headingOffset = -Math.PI / 2;
  let calibrated = false;
  const poiPoints = [];

  function extent() {
    const meta = window.GVG && window.GVG.minimapMeta;
    const value = meta && Number(meta.extent);
    if (Number.isFinite(value) && value > 20) return value;
    return 160;
  }

  function mapX(worldX, width) {
    const ext = extent();
    return ((worldX + ext) / (ext * 2)) * width;
  }

  function mapY(worldZ, height) {
    const ext = extent();
    return ((worldZ + ext) / (ext * 2)) * height;
  }

  function loadImage() {
    const src = window.GVG && window.GVG.minimapImage;
    if (typeof src !== 'string' || !src || src === imageSrc) return;
    imageSrc = src;
    const img = new Image();
    img.onload = () => {
      image = img;
      baseVersion += 1;
      schedule();
    };
    img.onerror = () => {
      image = null;
      baseVersion += 1;
      schedule();
    };
    img.src = src;
  }

  function drawFallback(bg, w, h) {
    bg.fillStyle = '#15201a';
    bg.fillRect(0, 0, w, h);
    const layout = window.GVG && window.GVG.layout;
    if (!layout) {
      bg.strokeStyle = 'rgba(216,182,75,0.10)';
      bg.lineWidth = 1;
      for (let i = 1; i < 8; i += 1) {
        const x = (w / 8) * i;
        const y = (h / 8) * i;
        bg.beginPath();
        bg.moveTo(x, 0);
        bg.lineTo(x, h);
        bg.moveTo(0, y);
        bg.lineTo(w, y);
        bg.stroke();
      }
      return;
    }
    const ext = extent();
    const line = (pts, width, color) => {
      if (!pts || !pts.length) return;
      bg.beginPath();
      pts.forEach(([x, z], index) => {
        const px = mapX(x, w);
        const py = mapY(z, h);
        if (index === 0) bg.moveTo(px, py);
        else bg.lineTo(px, py);
      });
      bg.lineWidth = Math.max(0.6, (width / (ext * 2)) * w);
      bg.strokeStyle = color;
      bg.lineCap = 'round';
      bg.lineJoin = 'round';
      bg.stroke();
    };

    for (const pond of layout.PONDS || []) {
      bg.beginPath();
      bg.ellipse(
        mapX(pond.cx, w),
        mapY(pond.cz, h),
        Math.max(0.5, (pond.rx / (ext * 2)) * w),
        Math.max(0.5, (pond.rz / (ext * 2)) * h),
        0,
        0,
        TAU,
      );
      bg.fillStyle = '#284542';
      bg.fill();
    }
    for (const stream of layout.STREAMS || []) line(stream.pts, stream.w || 4, '#2a4a46');
    for (const path of layout.PATHS || []) line(path.pts, path.w || 4, 'rgba(210,188,132,0.13)');
    for (const zone of Object.values(layout.ZONES || {})) {
      const x = mapX(zone.x1, w);
      const y = mapY(zone.z1, h);
      const zw = mapX(zone.x2, w) - x;
      const zh = mapY(zone.z2, h) - y;
      bg.fillStyle = 'rgba(122,146,116,0.16)';
      bg.fillRect(x, y, zw, zh);
    }
    const wall = layout.WALL || { x1: -148, x2: 148, z1: -148, z2: 148 };
    bg.strokeStyle = 'rgba(216,182,75,0.24)';
    bg.lineWidth = 1;
    bg.strokeRect(mapX(wall.x1, w), mapY(wall.z1, h), mapX(wall.x2, w) - mapX(wall.x1, w), mapY(wall.z2, h) - mapY(wall.z1, h));
  }

  function ensureBase(w, h, dpr) {
    if (baseCanvas && baseCanvas.width === Math.round(w * dpr) && baseCanvas.height === Math.round(h * dpr) && baseStamp === baseVersion) {
      return;
    }
    const canvasBase = document.createElement('canvas');
    canvasBase.width = Math.max(1, Math.round(w * dpr));
    canvasBase.height = Math.max(1, Math.round(h * dpr));
    const bg = canvasBase.getContext('2d');
    if (!bg) return;
    bg.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (image && image.complete && image.naturalWidth > 0) {
      bg.drawImage(image, 0, 0, w, h);
      bg.fillStyle = 'rgba(10,18,14,0.08)';
      bg.fillRect(0, 0, w, h);
    } else {
      drawFallback(bg, w, h);
    }
    const vignette = bg.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.max(w, h) * 0.72);
    vignette.addColorStop(0, 'rgba(6,10,8,0)');
    vignette.addColorStop(1, 'rgba(6,10,8,0.46)');
    bg.fillStyle = vignette;
    bg.fillRect(0, 0, w, h);
    bg.strokeStyle = 'rgba(216,182,75,0.16)';
    bg.lineWidth = 1;
    bg.strokeRect(0.5, 0.5, w - 1, h - 1);
    baseCanvas = canvasBase;
    baseStamp = baseVersion;
  }

  function readCamera() {
    const G = window.GVG || {};
    const cam = G.view && G.view.camera;
    const controls = G.controls;
    let x;
    let z;
    let angle;
    if (cam && cam.position && Number.isFinite(cam.position.x) && Number.isFinite(cam.position.z)) {
      x = cam.position.x;
      z = cam.position.z;
      let fx;
      let fz;
      if (controls && controls.target) {
        fx = controls.target.x - x;
        fz = controls.target.z - z;
      }
      if ((fx === undefined || fz === undefined) && typeof cam.getWorldDirection === 'function') {
        try {
          const dir = cam.getWorldDirection({ x: 0, y: 0, z: 0, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } });
          fx = dir.x;
          fz = dir.z;
        } catch { /* ignore */ }
      }
      if (fx !== undefined && Math.hypot(fx, fz) > 1e-5) angle = Math.atan2(fz, fx);
    }

    const getView = ctx.app && typeof ctx.app.getView === 'function' ? ctx.app.getView : null;
    if (x === undefined && getView) {
      const view = safe(() => getView.call(ctx.app));
      if (view && Number.isFinite(view.x) && Number.isFinite(view.z)) {
        x = view.x;
        z = view.z;
      }
    }
    if (angle === undefined && getView) {
      const view = safe(() => getView.call(ctx.app));
      if (view && Number.isFinite(view.heading)) {
        angle = view.heading + headingOffset;
      }
    }

    // 首次同时可读相机与 getView 时标定 heading → 画布角偏移（应对引擎的 heading 约定）
    if (!calibrated && getView && cam && controls && controls.target && Number.isFinite(cam.position.x)) {
      const view = safe(() => getView.call(ctx.app));
      if (view && Number.isFinite(view.heading)) {
        const fx = controls.target.x - cam.position.x;
        const fz = controls.target.z - cam.position.z;
        if (Math.hypot(fx, fz) > 1e-5) {
          headingOffset = wrapAngle(Math.atan2(fz, fx) - view.heading);
          calibrated = true;
          angle = Math.atan2(fz, fx);
        }
      }
    }

    if (x === undefined || !Number.isFinite(x) || angle === undefined || !Number.isFinite(angle)) return null;
    return { x, z, angle };
  }

  function drawPois(w, h) {
    poiPoints.length = 0;
    const activeId = ctx.state && ctx.state.activeId ? ctx.state.activeId : '';
    for (const poi of ctx.pois || []) {
      if (!Number.isFinite(poi.x) || !Number.isFinite(poi.z)) continue;
      const px = mapX(poi.x, w);
      const py = mapY(poi.z, h);
      if (px < -6 || py < -6 || px > w + 6 || py > h + 6) continue;
      poiPoints.push({ poi, px, py });
      const active = poi.id === activeId;
      const hover = poi.id === hoverId;
      const radius = active ? 3.9 : hover ? 3.1 : 2.2;
      // 暗色外圈 + 细亮描边：在浅色园景底图上保持辨识度，又不过分抢眼
      g.beginPath();
      g.arc(px, py, radius + 0.9, 0, TAU);
      g.fillStyle = 'rgba(8, 12, 10, 0.5)';
      g.fill();
      g.beginPath();
      g.arc(px, py, radius, 0, TAU);
      g.fillStyle = active ? '#f4dd9b' : groupColor(poi.group);
      g.globalAlpha = active ? 1 : 0.92;
      g.fill();
      g.globalAlpha = 1;
      g.lineWidth = 0.7;
      g.strokeStyle = 'rgba(247, 236, 201, 0.38)';
      g.stroke();
      if (active || hover) {
        g.beginPath();
        g.arc(px, py, radius + 2.3, 0, TAU);
        g.strokeStyle = active ? 'rgba(247, 231, 183, 0.95)' : 'rgba(247, 231, 183, 0.62)';
        g.lineWidth = 1.1;
        g.stroke();
      }
      if (active) {
        g.beginPath();
        g.arc(px, py, 1.05, 0, TAU);
        g.fillStyle = 'rgba(28, 24, 16, 0.9)';
        g.fill();
      }
    }
  }

  function drawCamera(w, h) {
    const camera = readCamera();
    if (!camera) return;
    const ext = extent();
    const px = mapX(clamp(camera.x, -ext * 0.985, ext * 0.985), w);
    const py = mapY(clamp(camera.z, -ext * 0.985, ext * 0.985), h);
    const radius = Math.max(15, Math.min(w, h) * 0.15);
    const angle = camera.angle;
    g.beginPath();
    g.moveTo(px, py);
    g.arc(px, py, radius, angle - FOV_HALF, angle + FOV_HALF);
    g.closePath();
    g.fillStyle = 'rgba(240,217,138,0.16)';
    g.fill();
    g.strokeStyle = 'rgba(240,217,138,0.42)';
    g.lineWidth = 1;
    g.stroke();

    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px + Math.cos(angle) * radius * 0.72, py + Math.sin(angle) * radius * 0.72);
    g.strokeStyle = 'rgba(247,231,183,0.62)';
    g.lineWidth = 1.1;
    g.stroke();

    g.beginPath();
    g.arc(px, py, 2.9, 0, TAU);
    g.fillStyle = '#f7ecc9';
    g.fill();
    g.strokeStyle = 'rgba(16,22,18,0.9)';
    g.lineWidth = 1.1;
    g.stroke();
  }

  function draw() {
    const { w, h, dpr } = metrics;
    if (!w || !h) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    ensureBase(w, h, dpr);
    if (baseCanvas) g.drawImage(baseCanvas, 0, 0, w, h);
    drawPois(w, h);
    drawCamera(w, h);
  }

  function measure() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const pixelW = Math.max(1, Math.round(w * dpr));
    const pixelH = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
      baseVersion += 1;
    }
    metrics.w = w;
    metrics.h = h;
    metrics.dpr = dpr;
  }

  function schedule() {
    if (raf || collapsed) return;
    raf = requestAnimationFrame(tick);
  }

  function tick(time) {
    raf = 0;
    if (collapsed || document.hidden) return;
    measure();
    if (!(ctx.state && ctx.state.zen) && time - lastDraw >= 100) {
      lastDraw = time;
      draw();
    }
    schedule();
  }

  /* ── 交互 ─────────────────────────────────────────────────── */
  let pointerDown = null;

  function pointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      px: ((event.clientX - rect.left) / rect.width) * metrics.w,
      py: ((event.clientY - rect.top) / rect.height) * metrics.h,
    };
  }

  function nearestPoi(px, py) {
    let best = null;
    let bestDist = 13;
    for (const point of poiPoints) {
      const dist = Math.hypot(point.px - px, point.py - py);
      if (dist < bestDist) {
        bestDist = dist;
        best = point;
      }
    }
    return best;
  }

  function updateHover(event) {
    if (event.pointerType !== 'mouse') return;
    const point = pointFromEvent(event);
    if (!point) return;
    const nearest = nearestPoi(point.px, point.py);
    hoverId = nearest ? nearest.poi.id : null;
    if (nearest) {
      tip.textContent = nearest.poi.name;
      tip.style.left = `${clamp(point.px, 24, metrics.w - 24)}px`;
      tip.style.top = `${clamp(point.py - 4, 16, metrics.h - 4)}px`;
      tip.classList.add('show');
      canvas.style.cursor = 'pointer';
    } else {
      tip.classList.remove('show');
      canvas.style.cursor = 'crosshair';
    }
    schedule();
  }

  on(canvas, 'pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerDown = { id: event.pointerId, x: event.clientX, y: event.clientY };
    try { canvas.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    event.stopPropagation();
    event.preventDefault();
  });

  on(canvas, 'pointerup', (event) => {
    if (!pointerDown || event.pointerId !== pointerDown.id) return;
    const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
    pointerDown = null;
    event.preventDefault();
    event.stopPropagation();
    if (moved > 8) return;
    const point = pointFromEvent(event);
    if (!point) return;
    const nearest = nearestPoi(point.px, point.py);
    if (nearest) {
      ctx.goTo(nearest.poi.id);
      return;
    }
    const ext = extent();
    if (!metrics.w || !metrics.h) return;
    const worldX = (point.px / metrics.w) * ext * 2 - ext;
    const worldZ = (point.py / metrics.h) * ext * 2 - ext;
    ctx.flyToGround(worldX, worldZ);
  });

  on(canvas, 'pointercancel', () => { pointerDown = null; });
  on(canvas, 'pointermove', updateHover);
  on(canvas, 'pointerleave', () => {
    hoverId = null;
    tip.classList.remove('show');
    canvas.style.cursor = 'crosshair';
    schedule();
  });

  function setCollapsed(value) {
    collapsed = Boolean(value);
    wrap.classList.toggle('is-collapsed', collapsed);
    collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    collapseBtn.setAttribute('aria-label', collapsed ? '展開小地圖' : '收合小地圖');
    collapseBtn.replaceChildren(icon(collapsed ? 'chevronUp' : 'chevronDown'));
    if (!collapsed) {
      measure();
      baseVersion += 1;
      schedule();
    }
  }

  collapseBtn.addEventListener('click', () => setCollapsed(!collapsed));

  function refresh() {
    loadImage();
    if (collapsed) return;
    measure();
    baseVersion += 1;
    schedule();
  }

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      if (collapsed) return;
      measure();
      baseVersion += 1;
      schedule();
    });
    observer.observe(body);
  } else {
    on(window, 'resize', () => {
      measure();
      baseVersion += 1;
      schedule();
    });
  }
  on(document, 'visibilitychange', () => {
    if (!document.hidden) schedule();
  });
  on(window, 'resize', () => {
    measure();
    baseVersion += 1;
    schedule();
  });

  measure();
  refresh();
  setTimeout(() => {
    measure();
    baseVersion += 1;
    schedule();
  }, 120);

  return {
    el: wrap,
    refresh,
    setCollapsed,
    isCollapsed: () => collapsed,
  };
}
