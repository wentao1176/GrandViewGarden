// ─────────────────────────────────────────────────────────────────────────────
// 大观园 · 精细植被底层（foliage engine · flora2 成员维护）
//
// 目标：把「1m 大方块树冠」换成「实例化叶片卡 + 低多边形枝干 + 顶点着色器风摆」。
//
// 结构：
//   · 程序化 CanvasTexture 图集（5×4 = 20 格，内联生成，无外部资源）：
//     阔叶团/竹叶/柳条/松针/花团/草叶/野花/芍药/荷叶/荷花/芦苇/芦花/芭蕉/
//     荇萍/梧桐掌叶/银杏扇叶/海棠花团 …… 全部为灰阶剪影，由实例色调制；
//     少数格（荷花、芦花）烘焙彩色（花茎/芦花本就有固定色）。
//   · 每类植被一个 InstancedBufferGeometry（基础四边形 + 每实例 16 floats），
//     桌面合计 7 个植被 draw call + 1 个枝干合并网格 draw call。
//   · 风摆由共享 uniform（uTime/uGust/uTint/uFogColor…）驱动：
//     按「叶尖权重（直立/下垂/整卡）+ 实例相位 + 空间波」做位移；
//     柳条大摆、竹叶簌簌、荷叶轻浮、草花细颤各有独立频率与幅度。
//   · 颜色全部线性空间运算，输出前走 three 的 colorspace 转换，与体素世界同一套
//     sRGB 显示；昼夜色调（uTint）由场景 fog 颜色自动匹配 renderer 的 TOD 曲线，
//     不需要 Lead 额外接线。
//
// 约定：本模块不得在模块顶层访问 document/window（node 导入自检要求），
//       CanvasTexture 只在 finalize() 里创建。
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';

// ───────────── 图集格子编号（5 列 × 4 行）─────────────
export const CELL_COLS = 5;
export const CELL_ROWS = 4;
export const CELLS = {
  leafA: 0,        // 阔叶团 A（圆叶簇）
  leafB: 1,        // 阔叶团 B（尖叶簇）
  leafC: 2,        // 阔叶团 C（稀疏小叶簇）
  bamboo: 3,       // 竹叶簇（细长叶，多叶）
  willow: 4,       // 柳条（整条垂枝 + 细叶）
  pine: 5,         // 松针扇
  bloomA: 6,       // 细碎花团 A（密）
  bloomB: 7,       // 细碎花团 B（疏 + 花苞）
  grass: 8,        // 草叶簇（细草叶，近景）
  wildflower: 9,   // 野花头（菊/小五瓣）
  peony: 10,       // 芍药/牡丹花头
  pad: 11,         // 荷叶圆盘
  lotusFlower: 12, // 荷花（烘焙粉色 + 花茎）
  reed: 13,        // 芦苇秆叶
  plume: 14,       // 芦花穗（烘焙米色）
  banana: 15,      // 芭蕉大叶
  waterleaf: 16,   // 荇菜/浮萍小叶团
  palmate: 17,     // 梧桐掌状叶
  ginkgo: 18,      // 银杏扇叶
  crabapple: 19,   // 海棠/碧桃花团（大瓣）
};

// ───────────── 色彩工具（sRGB → 线性）─────────────
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const LIN = new Array(PALETTE.length);
for (let i = 1; i < PALETTE.length; i++) {
  const p = PALETTE[i];
  if (!p) continue;
  LIN[i] = [s2l(p.r / 255), s2l(p.g / 255), s2l(p.b / 255)];
}
/** 调色板索引 → 线性 RGB（可乘亮度系数） */
export function linColor(idx, mul = 1) {
  const c = LIN[idx] || [1, 0, 1];
  return [c[0] * mul, c[1] * mul, c[2] * mul];
}
/** 任意 sRGB 0..255 → 线性 RGB */
export function linRGB(r, g, b, mul = 1) {
  return [s2l(r / 255) * mul, s2l(g / 255) * mul, s2l(b / 255) * mul];
}

// ───────────── 程序化图集 ─────────────
// 简易确定性随机（只用于绘制图集，不影响场景）
function lcg(seed) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}
const G = (t) => `rgb(${Math.round(t * 255)},${Math.round(t * 255)},${Math.round(t * 255)})`;
const GA = (t, a) => `rgba(${Math.round(t * 255)},${Math.round(t * 255)},${Math.round(t * 255)},${a})`;

function makeAtlas() {
  const CELL = 128;
  const cv = document.createElement('canvas');
  cv.width = CELL * CELL_COLS;
  cv.height = CELL * CELL_ROWS;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);

  // 单叶片（局部坐标：叶柄在 (0,0)，叶尖朝上 -Y），灰阶 + 渐变 + 主脉
  const leafPath = (len, wid, bow = 0.0) => {
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(wid * (0.62 + bow), -len * 0.24, wid * (0.5 + bow), -len * 0.74, 0, -len);
    g.bezierCurveTo(-wid * (0.5 - bow), -len * 0.74, -wid * (0.62 - bow), -len * 0.24, 0, 0);
    g.closePath();
  };
  const fillLeaf = (len, wid, tone0, tone1, bow) => {
    leafPath(len, wid, bow);
    const grad = g.createLinearGradient(0, 0, 0, -len);
    grad.addColorStop(0, G(tone0));
    grad.addColorStop(0.55, G(tone1));
    grad.addColorStop(1, G(Math.min(1, tone1 * 1.02)));
    g.fillStyle = grad;
    g.fill();
    // 主脉
    g.strokeStyle = GA(0.1, 0.32);
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(0, -len * 0.06);
    g.lineTo(0, -len * 0.94);
    g.stroke();
    // 侧脉
    g.strokeStyle = GA(0.1, 0.16);
    g.lineWidth = 0.8;
    const nv = 4;
    for (let i = 1; i <= nv; i++) {
      const yy = -len * (0.16 + 0.7 * (i / nv));
      const ww = wid * (1 - Math.abs(i / nv - 0.45) * 1.1);
      g.beginPath();
      g.moveTo(0, yy);
      g.lineTo(ww * 0.8, yy - len * 0.07);
      g.moveTo(0, yy);
      g.lineTo(-ww * 0.8, yy - len * 0.07);
      g.stroke();
    }
  };
  const drawLeafAt = (x, y, len, wid, angle, tone0, tone1, bow) => {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    fillLeaf(len, wid, tone0, tone1, bow || 0);
    g.restore();
  };
  // 五瓣小花（灰阶）
  const drawFlower = (x, y, r, tone, centerTone, rot) => {
    g.save();
    g.translate(x, y);
    g.rotate(rot || 0);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.beginPath();
      g.ellipse(Math.cos(a) * r * 0.52, Math.sin(a) * r * 0.52, r * 0.52, r * 0.42, a, 0, Math.PI * 2);
      const gr = g.createRadialGradient(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, 0, 0, 0, r);
      gr.addColorStop(0, G(tone));
      gr.addColorStop(1, G(tone * 0.86));
      g.fillStyle = gr;
      g.fill();
    }
    g.beginPath();
    g.arc(0, 0, r * 0.3, 0, Math.PI * 2);
    g.fillStyle = G(centerTone);
    g.fill();
    g.restore();
  };
  const drawBlade = (x, y, len, w, angle, tone0, tone1) => {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    g.beginPath();
    g.moveTo(-w * 0.5, 0);
    g.quadraticCurveTo(-w * 0.42, -len * 0.6, 0, -len);
    g.quadraticCurveTo(w * 0.42, -len * 0.6, w * 0.5, 0);
    g.closePath();
    const gr = g.createLinearGradient(0, 0, 0, -len);
    gr.addColorStop(0, G(tone0));
    gr.addColorStop(1, G(tone1));
    g.fillStyle = gr;
    g.fill();
    g.restore();
  };

  const cellOrigin = (cell) => [(cell % CELL_COLS) * CELL, Math.floor(cell / CELL_COLS) * CELL];
  const inCell = (cell, fn) => {
    const [ox, oy] = cellOrigin(cell);
    g.save();
    g.translate(ox + 6, oy + 6);
    g.beginPath();
    g.rect(0, 0, CELL - 12, CELL - 12);
    // 不做 clip，仅靠各绘制留在格内；保持 6px 透明边距避免 mip 串色
    fn(CELL - 12);
    g.restore();
  };

  // ── 0/1/2 阔叶团 ──
  inCell(CELLS.leafA, (S) => {
    const r = lcg(11);
    const cx = S * 0.5, cy = S * 0.52;
    for (let i = 0; i < 11; i++) {
      const a = r() * Math.PI * 2;
      const d = S * (0.05 + r() * 0.26);
      drawLeafAt(cx + Math.cos(a) * d, cy + Math.sin(a) * d, S * (0.34 + r() * 0.18), S * (0.15 + r() * 0.08), a + Math.PI / 2, 0.74 + r() * 0.1, 0.9 + r() * 0.1, 0);
    }
    // 小枝
    g.strokeStyle = GA(0.25, 0.85);
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(cx, cy + S * 0.32);
    g.lineTo(cx + S * 0.04, cy);
    g.stroke();
  });
  inCell(CELLS.leafB, (S) => {
    const r = lcg(23);
    const cx = S * 0.5, cy = S * 0.55;
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2;
      const d = S * (0.07 + r() * 0.22);
      drawLeafAt(cx + Math.cos(a) * d, cy + Math.sin(a) * d, S * (0.39 + r() * 0.16), S * (0.11 + r() * 0.05), a + Math.PI / 2, 0.78, 0.96, 0.06);
    }
    g.strokeStyle = GA(0.22, 0.8);
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(cx, cy + S * 0.34);
    g.lineTo(cx, cy - S * 0.05);
    g.stroke();
  });
  inCell(CELLS.leafC, (S) => {
    const r = lcg(37);
    const cx = S * 0.5, cy = S * 0.55;
    for (let i = 0; i < 7; i++) {
      const a = r() * Math.PI * 2;
      const d = S * (0.09 + r() * 0.25);
      drawLeafAt(cx + Math.cos(a) * d, cy + Math.sin(a) * d, S * (0.24 + r() * 0.12), S * (0.12 + r() * 0.06), a + Math.PI / 2, 0.8, 0.99, 0);
    }
  });

  // ── 3 竹叶簇：细长叶，自上部垂下 ──
  inCell(CELLS.bamboo, (S) => {
    const r = lcg(53);
    for (let i = 0; i < 12; i++) {
      const a = -Math.PI * 0.5 + (r() - 0.5) * 2.4;
      const bx = S * (0.3 + r() * 0.4);
      const by = S * (0.16 + r() * 0.3);
      const len = S * (0.38 + r() * 0.2);
      g.save();
      g.translate(bx, by);
      g.rotate(a + Math.PI * 0.5);
      leafPath(len, S * (0.055 + r() * 0.025), 0.02);
      const gr = g.createLinearGradient(0, 0, 0, -len);
      gr.addColorStop(0, G(0.72));
      gr.addColorStop(1, G(0.95));
      g.fillStyle = gr;
      g.fill();
      g.restore();
    }
  });

  // ── 4 柳条：整条垂枝 + 交替细叶 ──
  inCell(CELLS.willow, (S) => {
    const r = lcg(67);
    // 主枝曲线（上端宽下端细）
    for (let s = 0; s < 2; s++) {
      const x0 = S * (0.34 + s * 0.3);
      g.strokeStyle = G(0.4 + r() * 0.08);
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(x0, 0);
      g.bezierCurveTo(x0 + (r() - 0.5) * 18, S * 0.35, x0 + (r() - 0.5) * 22, S * 0.7, x0 + (r() - 0.5) * 26, S);
      g.stroke();
      for (let i = 0; i < 20; i++) {
        const t = (i + 0.5) / 20;
        const bx = x0 + (r() - 0.5) * 16 * t + (r() - 0.5) * 8;
        const by = S * t;
        const side = i % 2 ? 1 : -1;
        g.save();
        g.translate(bx, by);
        g.rotate(side * (0.5 + r() * 0.5));
        fillLeaf(S * (0.16 + r() * 0.07), S * (0.04 + r() * 0.017), 0.78, 0.95, 0);
        g.restore();
      }
    }
  });

  // ── 5 松针扇 ──
  inCell(CELLS.pine, (S) => {
    const r = lcg(83);
    const cx = S * 0.5, cy = S * 0.82;
    for (let i = 0; i < 72; i++) {
      const a = -Math.PI * 0.5 + (r() - 0.5) * 2.15;
      const len = S * (0.38 + r() * 0.38);
      g.strokeStyle = G(0.62 + r() * 0.26);
      g.lineWidth = 2.2 + r() * 1.4;
      g.beginPath();
      g.moveTo(cx + (r() - 0.5) * 12, cy);
      g.lineTo(cx + Math.cos(a) * len + (r() - 0.5) * 8, cy + Math.sin(a) * len);
      g.stroke();
    }
    g.strokeStyle = G(0.42);
    g.lineWidth = 3.4;
    g.beginPath();
    g.moveTo(cx - S * 0.22, cy + 4);
    g.lineTo(cx + S * 0.22, cy + 4);
    g.stroke();
  });

  // ── 6/7 细碎花团 ──
  inCell(CELLS.bloomA, (S) => {
    const r = lcg(101);
    for (let i = 0; i < 17; i++) {
      const a = r() * Math.PI * 2, d = S * (0.04 + r() * 0.31);
      drawFlower(S * 0.5 + Math.cos(a) * d, S * 0.5 + Math.sin(a) * d, S * (0.09 + r() * 0.045), 0.94, 0.68, r() * 3);
    }
    for (let i = 0; i < 5; i++) {
      const a = r() * Math.PI * 2, d = S * (0.2 + r() * 0.16);
      drawLeafAt(S * 0.5 + Math.cos(a) * d, S * 0.5 + Math.sin(a) * d, S * 0.18, S * 0.07, r() * 3, 0.6, 0.72, 0);
    }
  });
  inCell(CELLS.bloomB, (S) => {
    const r = lcg(107);
    for (let i = 0; i < 11; i++) {
      const a = r() * Math.PI * 2, d = S * (0.05 + r() * 0.32);
      drawFlower(S * 0.5 + Math.cos(a) * d, S * 0.5 + Math.sin(a) * d, S * (0.085 + r() * 0.045), 0.96, 0.7, r() * 3);
    }
    for (let i = 0; i < 7; i++) {
      const a = r() * Math.PI * 2, d = S * (0.16 + r() * 0.25);
      g.beginPath();
      g.arc(S * 0.5 + Math.cos(a) * d, S * 0.5 + Math.sin(a) * d, S * 0.028, 0, Math.PI * 2);
      g.fillStyle = G(0.78);
      g.fill();
    }
  });
  // 19 海棠/大瓣花团
  inCell(CELLS.crabapple, (S) => {
    const r = lcg(113);
    for (let i = 0; i < 8; i++) {
      const a = r() * Math.PI * 2, d = S * (0.07 + r() * 0.26);
      drawFlower(S * 0.5 + Math.cos(a) * d, S * 0.5 + Math.sin(a) * d, S * (0.13 + r() * 0.055), 0.97, 0.72, r() * 3);
    }
    for (let i = 0; i < 6; i++) {
      const a = r() * Math.PI * 2, d = S * (0.18 + r() * 0.2);
      drawLeafAt(S * 0.5 + Math.cos(a) * d, S * 0.5 + Math.sin(a) * d, S * 0.2, S * 0.075, r() * 3, 0.64, 0.78, 0);
    }
  });

  // ── 8 草叶簇 ──
  inCell(CELLS.grass, (S) => {
    const r = lcg(127);
    for (let i = 0; i < 10; i++) {
      const x = S * (0.28 + r() * 0.44), y = S * 0.94;
      const a = (r() - 0.5) * 1.2;
      drawBlade(x, y, S * (0.55 + r() * 0.42), 7 + r() * 7, a, 0.45 + r() * 0.08, 0.86 + r() * 0.14);
    }
  });

  // ── 9 野花头（菊状）──
  inCell(CELLS.wildflower, (S) => {
    const r = lcg(131);
    const cx = S * 0.5, cy = S * 0.46;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + r() * 0.2;
      g.save();
      g.translate(cx, cy);
      g.rotate(a);
      g.beginPath();
      g.ellipse(0, -S * 0.17, S * 0.05, S * 0.16, 0, 0, Math.PI * 2);
      g.fillStyle = G(0.9 + r() * 0.08);
      g.fill();
      g.restore();
    }
    g.beginPath();
    g.arc(cx, cy, S * 0.1, 0, Math.PI * 2);
    g.fillStyle = G(0.66);
    g.fill();
    // 茎 + 叶
    g.strokeStyle = G(0.5);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, cy + S * 0.1);
    g.quadraticCurveTo(cx + 2, cy + S * 0.3, cx - 1, S * 0.94);
    g.stroke();
    drawLeafAt(cx - 4, S * 0.72, S * 0.2, S * 0.07, -0.5, 0.55, 0.72, 0);
    drawLeafAt(cx + 4, S * 0.62, S * 0.18, S * 0.06, 0.6, 0.55, 0.7, 0);
  });

  // ── 10 芍药/牡丹花头 ──
  inCell(CELLS.peony, (S) => {
    const r = lcg(137);
    const cx = S * 0.5, cy = S * 0.44;
    for (let ring = 0; ring < 3; ring++) {
      const n = [9, 7, 5][ring];
      const rr = S * [0.3, 0.21, 0.12][ring];
      const tone = [0.82, 0.92, 0.98][ring];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + ring * 0.5 + r() * 0.15;
        g.save();
        g.translate(cx + Math.cos(a) * rr * 0.55, cy + Math.sin(a) * rr * 0.55);
        g.rotate(a);
        g.beginPath();
        g.ellipse(0, -rr * 0.5, rr * 0.46, rr * 0.52, 0, 0, Math.PI * 2);
        g.fillStyle = G(tone);
        g.fill();
        g.restore();
      }
    }
    g.beginPath();
    g.arc(cx, cy, S * 0.05, 0, Math.PI * 2);
    g.fillStyle = G(0.72);
    g.fill();
    // 茎与叶（头顶花下另绘一张叶卡，故此处只留短茎）
    g.strokeStyle = G(0.5);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, cy + S * 0.1);
    g.lineTo(cx, S * 0.95);
    g.stroke();
  });

  // ── 11 荷叶圆盘：带缺口、放射叶脉 ──
  inCell(CELLS.pad, (S) => {
    const cx = S * 0.5, cy = S * 0.5, R = S * 0.43;
    const gap = 0.34;
    g.beginPath();
    g.arc(cx, cy, R, Math.PI * 0.5 + gap, Math.PI * 0.5 - gap + Math.PI * 2);
    g.lineTo(cx, cy);
    g.closePath();
    const gr = g.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
    gr.addColorStop(0, G(0.96));
    gr.addColorStop(0.7, G(0.86));
    gr.addColorStop(1, G(0.74));
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = GA(0.2, 0.25);
    g.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      const a = Math.PI * 0.5 + gap + (i / 10) * (Math.PI * 2 - gap * 2);
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * R * 0.93, cy + Math.sin(a) * R * 0.93);
      g.stroke();
    }
    // 边缘微皱
    g.strokeStyle = GA(0.9, 0.8);
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, R * 0.97, Math.PI * 0.5 + gap, Math.PI * 0.5 - gap + Math.PI * 2);
    g.stroke();
  });

  // ── 12 荷花（烘焙彩色：绿茎 + 粉瓣）──
  inCell(CELLS.lotusFlower, (S) => {
    const cx = S * 0.5;
    // 花茎
    g.strokeStyle = 'rgb(88,124,66)';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(cx, S * 0.98);
    g.quadraticCurveTo(cx - 3, S * 0.6, cx, S * 0.42);
    g.stroke();
    // 花托
    g.fillStyle = 'rgb(214,188,90)';
    g.beginPath();
    g.ellipse(cx, S * 0.44, S * 0.1, S * 0.05, 0, 0, Math.PI * 2);
    g.fill();
    // 花瓣：外 7 内 5
    const petal = (a, len, wid, col) => {
      g.save();
      g.translate(cx, S * 0.4);
      g.rotate(a);
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(wid, -len * 0.4, wid * 0.5, -len, 0, -len * 1.05);
      g.bezierCurveTo(-wid * 0.5, -len, -wid, -len * 0.4, 0, 0);
      g.fillStyle = col;
      g.fill();
      g.restore();
    };
    for (let i = 0; i < 8; i++) petal((i / 8) * Math.PI * 2, S * 0.34, S * 0.1, 'rgb(238,178,200)');
    for (let i = 0; i < 6; i++) petal((i / 6) * Math.PI * 2 + 0.3, S * 0.24, S * 0.075, 'rgb(246,204,220)');
    g.fillStyle = 'rgb(244,226,150)';
    g.beginPath();
    g.arc(cx, S * 0.4, S * 0.035, 0, Math.PI * 2);
    g.fill();
  });

  // ── 13 芦苇秆叶 ──
  inCell(CELLS.reed, (S) => {
    const r = lcg(149);
    for (let s = 0; s < 4; s++) {
      const x0 = S * (0.26 + s * 0.17);
      g.strokeStyle = G(0.6 + r() * 0.1);
      g.lineWidth = 3.2;
      g.beginPath();
      g.moveTo(x0, S);
      g.quadraticCurveTo(x0 + (r() - 0.5) * 12, S * 0.5, x0 + (r() - 0.5) * 20, 0);
      g.stroke();
      for (let i = 0; i < 4; i++) {
        const yy = S * (0.22 + r() * 0.6);
        drawLeafAt(x0 + (r() - 0.5) * 8, yy, S * (0.32 + r() * 0.16), S * 0.045, (r() - 0.5) * 1.6, 0.55, 0.85, 0.02);
      }
    }
  });

  // ── 14 芦花穗（烘焙米色）──
  inCell(CELLS.plume, (S) => {
    const r = lcg(151);
    g.strokeStyle = 'rgb(170,158,110)';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(S * 0.5, S);
    g.quadraticCurveTo(S * 0.5, S * 0.6, S * 0.52, S * 0.32);
    g.stroke();
    for (let i = 0; i < 26; i++) {
      const t = i / 26;
      const bx = S * (0.5 + (r() - 0.5) * 0.12);
      const by = S * (0.06 + t * 0.4);
      g.strokeStyle = `rgba(${232 - r() * 26},${224 - r() * 26},${196 - r() * 26},0.95)`;
      g.lineWidth = 2 + r() * 2.4;
      g.beginPath();
      g.moveTo(bx, by);
      g.quadraticCurveTo(bx + (r() - 0.5) * 26, by - 10 - r() * 20, bx + (r() - 0.5) * 40, by - 14 - r() * 30);
      g.stroke();
    }
  });

  // ── 15 芭蕉大叶 ──
  inCell(CELLS.banana, (S) => {
    fillLeaf(S * 0.98, S * 0.34, 0.5, 0.76, 0.02);
    // 撕裂边（芭蕉叶特征）
    g.globalCompositeOperation = 'destination-out';
    const r = lcg(157);
    for (let i = 0; i < 7; i++) {
      const yy = S * (0.25 + r() * 0.6);
      const side = i % 2 ? 1 : -1;
      g.beginPath();
      g.moveTo(side * S * 0.38, yy);
      g.lineTo(side * S * 0.02, yy + S * (0.03 + r() * 0.03));
      g.lineTo(side * S * 0.4, yy + S * 0.08);
      g.closePath();
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    // 主脉
    g.strokeStyle = GA(0.92, 0.55);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, -S * 0.04);
    g.lineTo(0, -S * 0.95);
    g.stroke();
  });

  // ── 16 荇菜/浮萍小叶团 ──
  inCell(CELLS.waterleaf, (S) => {
    const r = lcg(163);
    for (let i = 0; i < 13; i++) {
      const a = r() * Math.PI * 2, d = S * (0.03 + r() * 0.31);
      const cx = S * 0.5 + Math.cos(a) * d, cy = S * 0.5 + Math.sin(a) * d;
      const rad = S * (0.065 + r() * 0.05);
      g.beginPath();
      g.arc(cx, cy, rad, 0, Math.PI * 2);
      g.fillStyle = G(0.78 + r() * 0.2);
      g.fill();
      g.strokeStyle = GA(0.2, 0.2);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(cx - rad * 0.7, cy);
      g.lineTo(cx + rad * 0.7, cy);
      g.stroke();
    }
  });

  // ── 17 梧桐掌状叶（3 裂）──
  inCell(CELLS.palmate, (S) => {
    const cx = S * 0.5;
    const lobe = (ang, len, wid) => {
      g.save();
      g.translate(cx, S * 0.92);
      g.rotate(ang);
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(wid, -len * 0.32, wid * 0.72, -len * 0.9, 0, -len);
      g.bezierCurveTo(-wid * 0.72, -len * 0.9, -wid, -len * 0.32, 0, 0);
      const gr = g.createLinearGradient(0, 0, 0, -len);
      gr.addColorStop(0, G(0.6));
      gr.addColorStop(1, G(0.92));
      g.fillStyle = gr;
      g.fill();
      g.restore();
    };
    lobe(-0.75, S * 0.86, S * 0.19);
    lobe(0.75, S * 0.86, S * 0.19);
    lobe(0, S * 0.98, S * 0.22);
    g.strokeStyle = G(0.55);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, S * 0.98);
    g.lineTo(cx, S * 0.72);
    g.stroke();
  });

  // ── 18 银杏扇叶 ──
  inCell(CELLS.ginkgo, (S) => {
    const fan = (x, y, rad, ang) => {
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, rad, -Math.PI * 0.86, -Math.PI * 0.14);
      g.closePath();
      const gr = g.createLinearGradient(0, 0, 0, -rad);
      gr.addColorStop(0, G(0.62));
      gr.addColorStop(1, G(0.94));
      g.fillStyle = gr;
      g.fill();
      // 扇形缺口（银杏特征）
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.moveTo(0, -rad * 0.15);
      g.lineTo(0, -rad * 1.02);
      g.lineTo(rad * 0.09, -rad * 0.95);
      g.closePath();
      g.fill();
      g.globalCompositeOperation = 'source-over';
      g.restore();
    };
    fan(S * 0.34, S * 0.52, S * 0.3, -0.5);
    fan(S * 0.66, S * 0.52, S * 0.3, 0.5);
    fan(S * 0.5, S * 0.44, S * 0.32, 0);
  });

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;   // 灰阶剪影：直接在线性空间做调制
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// ───────────── 共享 uniforms 与着色器 ─────────────
const SHARED = {
  uTime: { value: 0 },
  uGust: { value: 1.0 },
  uWindDir: { value: new THREE.Vector2(0.86, 0.5) },
  uTint: { value: new THREE.Color(1, 1, 1) },
  uFogColor: { value: new THREE.Color(0.66, 0.78, 0.85) },
  uFogNear: { value: 150 },
  uFogFar: { value: 880 },
};

const SPRITE_VERT = /* glsl */`
attribute vec3 aPos;
attribute vec3 aRight;
attribute vec3 aUp;
attribute vec3 aColor;
attribute vec4 aParams;   // x=phase y=amp z=cellX w=cellY(底部起算)
uniform float uTime;
uniform float uGust;
uniform vec2 uWindDir;
uniform float uMode;      // 0=整卡 1=直立(叶尖权重) 2=下垂(条梢权重)
uniform float uFreq;
uniform float uSway;
uniform float uAnchor;    // 0=以卡片底边为锚 1=以卡片中心为锚
uniform float uWater;     // 1=水面漂浮（上下轻浮）
uniform float uFlipV;     // 1=纹理纵向翻转（下垂枝条：锚点在上端）
uniform vec2 uAtlasInv;
varying vec3 vColor;
varying vec2 vUv;
varying float vFogDepth;
void main() {
  float t = uTime * uFreq;
  float y = position.y;
  float wgt;
  if (uMode < 0.5) wgt = 1.0;
  else if (uMode < 1.5) wgt = pow(max(y, 0.0), 1.35);
  else wgt = pow(max(y, 0.0), 1.25);
  float phase = aParams.x;
  float amp = aParams.y * uSway;
  float spatial = sin(t * 1.15 + phase + aPos.x * 0.06 + aPos.z * 0.045)
                + 0.35 * sin(t * 2.3 + phase * 1.7 + aPos.y * 0.13);
  vec3 off = vec3(uWindDir.x, 0.0, uWindDir.y) * (amp * wgt * spatial * uGust);
  float flut = sin(t * 3.1 + phase * 4.3 + y * 2.6) * amp * 0.30 * wgt;
  off += normalize(aRight + vec3(1e-5)) * flut;
  if (uWater > 0.5) {
    off.y += amp * 0.5 * sin(uTime * 0.9 + phase + aPos.x * 0.33 + aPos.z * 0.29);
    off.x += amp * 0.4 * sin(uTime * 0.71 + phase * 1.9);
    off.z += amp * 0.34 * cos(uTime * 0.83 + phase * 1.3);
  }
  float anchorY = mix(y, y - 0.5, uAnchor);
  vec3 wp = aPos + off + aRight * position.x + aUp * anchorY;
  vec4 mv = modelViewMatrix * vec4(wp, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
  vColor = aColor;
  vec2 lu = vec2(position.x + 0.5, position.y);
  lu.y = mix(lu.y, 1.0 - lu.y, uFlipV);
  vUv = (aParams.zw + lu) * uAtlasInv;
}
`;

const SPRITE_FRAG = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uTint;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying vec3 vColor;
varying vec2 vUv;
varying float vFogDepth;
void main() {
  vec4 tx = texture2D(uMap, vUv);
  if (tx.a < 0.15) discard;
  vec3 col = vColor * tx.rgb * uTint;
  float f = smoothstep(uFogNear, uFogFar, vFogDepth);
  col = mix(col, uFogColor, f);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const SOLID_VERT = /* glsl */`
attribute vec3 color;
varying vec3 vColor;
varying float vFogDepth;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const SOLID_FRAG = /* glsl */`
uniform vec3 uTint;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying vec3 vColor;
varying float vFogDepth;
void main() {
  vec3 col = vColor * uTint;
  float f = smoothstep(uFogNear, uFogFar, vFogDepth);
  col = mix(col, uFogColor, f);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

// ───────────── 实例批次 ─────────────
class SpriteBatch {
  constructor(name, group, cap, anchor, mode, freq, sway, water, flipV) {
    this.name = name;
    this.group = group;     // 'leaf' | 'ground'
    this.cap = Math.max(64, cap | 0);
    this.n = 0;
    this.anchor = anchor;
    this.mode = mode;
    this.freq = freq;
    this.sway = sway;
    this.water = water;
    this.flipV = flipV || 0;
    const c = this.cap;
    this.pos = new Float32Array(c * 3);
    this.right = new Float32Array(c * 3);
    this.up = new Float32Array(c * 3);
    this.color = new Float32Array(c * 3);
    this.params = new Float32Array(c * 4);
  }
  grow(need) {
    const cap = Math.max(need, Math.ceil(this.cap * 1.6));
    const p = new Float32Array(cap * 3); p.set(this.pos); this.pos = p;
    const r = new Float32Array(cap * 3); r.set(this.right); this.right = r;
    const u = new Float32Array(cap * 3); u.set(this.up); this.up = u;
    const c = new Float32Array(cap * 3); c.set(this.color); this.color = c;
    const q = new Float32Array(cap * 4); q.set(this.params); this.params = q;
    this.cap = cap;
  }
  /**
   * 添加一张叶片卡。
   * card: { x,y,z, rx,ry,rz, ux,uy,uz, r,g,b, phase, amp, cell, sub }
   *   right/up 向量自带尺寸（|right| = 卡宽，|up| = 卡高，含方向）
   */
  add(card) {
    if (this.n >= this.cap) this.grow(this.n + 1);
    const i = this.n++;
    const i3 = i * 3;
    this.pos[i3] = card.x; this.pos[i3 + 1] = card.y; this.pos[i3 + 2] = card.z;
    this.right[i3] = card.rx; this.right[i3 + 1] = card.ry; this.right[i3 + 2] = card.rz;
    this.up[i3] = card.ux; this.up[i3 + 1] = card.uy; this.up[i3 + 2] = card.uz;
    this.color[i3] = card.r; this.color[i3 + 1] = card.g; this.color[i3 + 2] = card.b;
    const i4 = i * 4;
    this.params[i4] = card.phase;
    this.params[i4 + 1] = card.amp;
    const cell = card.cell | 0;
    this.params[i4 + 2] = cell % CELL_COLS;
    this.params[i4 + 3] = CELL_ROWS - 1 - Math.floor(cell / CELL_COLS);
    return true;
  }
  build(texture) {
    const n = this.n;
    if (!n) return null;
    let bad = 0;
    for (let i = 0; i < n * 3; i++) if (!Number.isFinite(this.pos[i]) || !Number.isFinite(this.right[i]) || !Number.isFinite(this.up[i])) bad++;
    if (bad) console.warn('[flora2] 叶卡批次存在非有限坐标', this.name, bad);
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]);
    geo.setAttribute('position', new THREE.BufferAttribute(quad, 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.pos.subarray(0, n * 3), 3));
    geo.setAttribute('aRight', new THREE.InstancedBufferAttribute(this.right.subarray(0, n * 3), 3));
    geo.setAttribute('aUp', new THREE.InstancedBufferAttribute(this.up.subarray(0, n * 3), 3));
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.color.subarray(0, n * 3), 3));
    geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(this.params.subarray(0, n * 4), 4));
    geo.instanceCount = n;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 12, 0), 460);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: SHARED.uTime,
        uGust: SHARED.uGust,
        uWindDir: SHARED.uWindDir,
        uTint: SHARED.uTint,
        uFogColor: SHARED.uFogColor,
        uFogNear: SHARED.uFogNear,
        uFogFar: SHARED.uFogFar,
        uMap: { value: texture },
        uMode: { value: this.mode },
        uFreq: { value: this.freq },
        uSway: { value: this.sway },
        uAnchor: { value: this.anchor },
        uWater: { value: this.water },
        uFlipV: { value: this.flipV },
        uAtlasInv: { value: new THREE.Vector2(1 / CELL_COLS, 1 / CELL_ROWS) },
      },
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite: true,
      fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.name = 'flora-' + this.name;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

// ───────────── 低多边形枝干/木构 ─────────────
const SHADE = { xp: 0.84, xn: 0.71, yp: 1.0, yn: 0.42, zp: 0.9, zn: 0.76 };
function shadeN(nx, ny, nz) {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  if (ax >= ay && ax >= az) return nx > 0 ? SHADE.xp : SHADE.xn;
  if (ay >= az) return ny > 0 ? SHADE.yp : SHADE.yn;
  return nz > 0 ? SHADE.zp : SHADE.zn;
}
class WoodBuilder {
  constructor() {
    this.vcap = 8192;                    // 顶点容量
    this.pos = new Float32Array(this.vcap * 3);
    this.col = new Float32Array(this.vcap * 3);
    this.nv = 0;
    this.icap = 16384;
    this.idx = new Uint32Array(this.icap);
    this.ni = 0;
    this.quads = 0;
  }
  _growV(need) {
    let cap = this.vcap;
    while (this.nv + need > cap) cap = Math.ceil(cap * 1.7);
    const p = new Float32Array(cap * 3); p.set(this.pos.subarray(0, this.nv * 3)); this.pos = p;
    const c = new Float32Array(cap * 3); c.set(this.col.subarray(0, this.nv * 3)); this.col = c;
    this.vcap = cap;
  }
  _growI(need) {
    let cap = this.icap;
    while (this.ni + need > cap) cap = Math.ceil(cap * 1.7);
    const a = new Uint32Array(cap); a.set(this.idx.subarray(0, this.ni)); this.idx = a;
    this.icap = cap;
  }
  /** 写一个顶点，返回索引（颜色为线性 RGB） */
  _v(x, y, z, c) {
    if (this.nv + 1 > this.vcap) this._growV(1);
    const i = this.nv++;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.col[i3] = c[0]; this.col[i3 + 1] = c[1]; this.col[i3 + 2] = c[2];
    return i;
  }
  _pushIdx(a, b, c) {
    if (this.ni + 3 > this.icap) this._growI(3);
    const j = this.ni;
    this.idx[j] = a; this.idx[j + 1] = b; this.idx[j + 2] = c;
    this.ni += 3;
  }
  addTri(a, b, c, color, mul = 1) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const sh = shadeN(nx, ny, nz) * mul;
    const cc = [color[0] * sh, color[1] * sh, color[2] * sh];
    const i0 = this._v(a[0], a[1], a[2], cc);
    const i1 = this._v(b[0], b[1], b[2], cc);
    const i2 = this._v(c[0], c[1], c[2], cc);
    this._pushIdx(i0, i1, i2);
  }
  addQuad(a, b, c, d, color, mul = 1) {
    // a-b-c-d 逆时针/顺时针均可；法线取 (b-a)x(d-a)
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const sh = shadeN(nx, ny, nz) * mul;
    const cr = color[0] * sh, cg = color[1] * sh, cb = color[2] * sh;
    if (this.nv + 4 > this.vcap) this._growV(4);
    if (this.ni + 6 > this.icap) this._growI(6);
    const i0 = this._v(a[0], a[1], a[2], [cr, cg, cb]);
    const i1 = this._v(b[0], b[1], b[2], [cr, cg, cb]);
    const i2 = this._v(c[0], c[1], c[2], [cr, cg, cb]);
    const i3 = this._v(d[0], d[1], d[2], [cr, cg, cb]);
    const j = this.ni;
    this.idx[j] = i0; this.idx[j + 1] = i1; this.idx[j + 2] = i2;
    this.idx[j + 3] = i0; this.idx[j + 4] = i2; this.idx[j + 5] = i3;
    this.ni += 6;
    this.quads++;
  }
  /**
   * 低多边形椭球壳（树冠实心核：远景仍有明确绿色团块，避免叶片卡在远处 mip 消失）。
   * opts: { lon, lat, jitter, mul }
   */
  addEllipsoid(cx, cy, cz, rx, ry, rz, color, opts = {}) {
    const lon = Math.max(5, opts.lon || 7);
    const lat = Math.max(3, opts.lat || 3);
    const jitter = opts.jitter == null ? 0.2 : opts.jitter;
    const mul = opts.mul == null ? 1 : opts.mul;
    const hsh = (n) => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
    const rings = [];
    for (let i = 0; i <= lat; i++) {
      const v = i / lat;
      const phi = -Math.PI * 0.5 + Math.PI * v;
      const ring = [];
      const cn = Math.cos(phi), sn = Math.sin(phi);
      for (let j = 0; j < lon; j++) {
        const th = (j / lon) * Math.PI * 2 + (i * 0.7);
        const rj = 1 + (hsh(i * 7.3 + j * 3.1 + cx * 0.13 + cz * 0.17) - 0.5) * jitter;
        ring.push([
          cx + Math.cos(th) * cn * rx * rj,
          cy + sn * ry * rj,
          cz + Math.sin(th) * cn * rz * rj,
        ]);
      }
      rings.push(ring);
    }
    if (Math.abs(cx) > 250 || Math.abs(cz) > 250 || Math.abs(cy) > 200 || rx > 60 || ry > 60 || rz > 60) {
      console.warn('[flora2] 异常冠核参数', cx, cy, cz, rx, ry, rz);
      return;
    }
    for (let i = 0; i < lat; i++) {
      const band = 0.62 + 0.55 * ((i + 0.5) / lat);          // 下暗上亮
      for (let j = 0; j < lon; j++) {
        const j2 = (j + 1) % lon;
        const jm = 0.82 + hsh(i * 11.7 + j * 5.3 + cy) * 0.32;
        this.addQuad(rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j], color, mul * band * jm);
      }
    }
  }
  /** 圆锥/圆台段：a→b，半径 r0→r1，sides 边 */
  prism(ax, ay, az, bx, by, bz, r0, r1, sides, color, opts = {}) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    let hx = 0, hy = 1, hz = 0;
    if (Math.abs(uy) > 0.92) { hx = 1; hy = 0; hz = 0; }
    let px = hy * uz - hz * uy, py = hz * ux - hx * uz, pz = hx * uy - hy * ux;
    let pl = Math.hypot(px, py, pz) || 1;
    px /= pl; py /= pl; pz /= pl;
    let qx = uy * pz - uz * py, qy = uz * px - ux * pz, qz = ux * py - uy * px;
    const mul = opts.mul == null ? 1 : opts.mul;
    const n = Math.max(3, sides | 0);
    const ring0 = [], ring1 = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      ring0.push([ax + (px * ca + qx * sa) * r0, ay + (py * ca + qy * sa) * r0, az + (pz * ca + qz * sa) * r0]);
      ring1.push([bx + (px * ca + qx * sa) * r1, by + (py * ca + qy * sa) * r1, bz + (pz * ca + qz * sa) * r1]);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.addQuad(ring0[i], ring0[j], ring1[j], ring1[i], color, mul);
    }
    if (opts.capTop !== false && r1 > 0.02) {
      const apex = [bx, by, bz];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        this.addTri(apex, ring1[i], ring1[j], color, mul);
      }
    }
  }
  /** 折线管（树干/枝）：pts=[[x,y,z],...]，半径从 r0 收到 r1，按段色表取色 */
  polyline(pts, r0, r1, sides, colors, opts = {}) {
    if (!pts || pts.length < 2) return;
    const total = pts.length - 1;
    for (let i = 0; i < total; i++) {
      const t0 = i / total, t1 = (i + 1) / total;
      const ra = r0 + (r1 - r0) * t0;
      const rb = r0 + (r1 - r0) * t1;
      const c = colors[Math.min(colors.length - 1, Math.floor(i / total * colors.length))] || colors[0];
      const p0 = pts[i], p1 = pts[i + 1];
      this.prism(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], ra, rb, sides, c, { ...opts, capTop: i === total - 1 });
    }
  }
  build() {
    if (!this.nv) return null;
    let bad = 0;
    for (let i = 0; i < this.nv * 3; i++) if (!Number.isFinite(this.pos[i])) bad++;
    if (bad) console.warn('[flora2] wood 网格存在非有限坐标', bad);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos.subarray(0, this.nv * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col.subarray(0, this.nv * 3), 3));
    geo.setIndex(new THREE.BufferAttribute(this.idx.subarray(0, this.ni), 1));
    geo.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTint: SHARED.uTint,
        uFogColor: SHARED.uFogColor,
        uFogNear: SHARED.uFogNear,
        uFogFar: SHARED.uFogFar,
      },
      vertexShader: SOLID_VERT,
      fragmentShader: SOLID_FRAG,
      side: THREE.DoubleSide,
      transparent: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.name = 'flora-wood';
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

// ───────────── 昼夜色调（与 renderer.TOD 对齐）─────────────
// fog 颜色用于识别当前时段（renderer 在雾色中插值），tint 与体素 solidMat 的 tint 一致。
const TODC = [
  { fog: new THREE.Color(0xe8d6c9), tint: new THREE.Color(0xffd9c6) }, // dawn
  { fog: new THREE.Color(0xd4e4ec), tint: new THREE.Color(0xf7f3e9) }, // day
  { fog: new THREE.Color(0xdcae8e), tint: new THREE.Color(0xffd6ae) }, // dusk
  { fog: new THREE.Color(0x2c3c58), tint: new THREE.Color(0x9fb2d8) }, // night
];
const _tmpC = new THREE.Color();
function todTintFromFog(fogColor, out) {
  let wsum = 1e-6;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < TODC.length; i++) {
    const c = TODC[i].fog;
    const dr = fogColor.r - c.r, dg = fogColor.g - c.g, db = fogColor.b - c.b;
    const w = 1 / (dr * dr + dg * dg + db * db + 0.0016);
    const t = TODC[i].tint;
    r += t.r * w; g += t.g * w; b += t.b * w;
    wsum += w;
  }
  out.setRGB(r / wsum, g / wsum, b / wsum);
  return out;
}

// ───────────── 系统 ─────────────
/**
 * 创建植被系统。ctx 需提供 isMobile/quality（可缺省）。
 * 返回值：
 *   addCard(group, card)  加入一张卡片；预算/容量不足返回 false
 *   room(group)           该组剩余容量
 *   leafRoom()/groundRoom()
 *   wood                  低模枝干构建器
 *   finalize()            生成 THREE.Group（只执行一次）
 *   update(t, dt)         每帧更新 uniform
 *   stats()               实例/三角面/draw call 统计
 */
export function createFoliage(ctx) {
  const _t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
  const c = ctx || {};
  const low = !!(c.isMobile || (c.quality && c.quality !== 'high'));
  const leafCap = low ? 60000 : 120000;
  const groundCap = low ? 29000 : 58000;
  const s = low ? 0.5 : 1;

  // 组配置：kind 预算类别、cap 本组容量、anchor/mode/freq/sway/water 决定风摆手感
  const batches = {
    canopy: new SpriteBatch('canopy', 'leaf', Math.round(88000 * s), 1, 0.0, 0.9, 1.0, 0),
    bamboo: new SpriteBatch('bamboo', 'leaf', Math.round(26000 * s), 1, 0.0, 1.9, 0.75, 0),
    hang: new SpriteBatch('hang', 'leaf', Math.round(16000 * s), 0, 2.0, 1.15, 1.25, 0, 1),
    water: new SpriteBatch('water', 'leaf', Math.round(14000 * s), 1, 0.0, 0.8, 0.9, 1),
    reed: new SpriteBatch('reed', 'leaf', Math.round(12000 * s), 0, 1.0, 0.95, 1.45, 0),
    ground: new SpriteBatch('ground', 'ground', Math.round(56000 * s), 0, 1.0, 1.2, 1.0, 0),
    flower: new SpriteBatch('flower', 'ground', Math.round(14000 * s), 0, 1.0, 1.05, 0.9, 0),
  };
  let leafUsed = 0, groundUsed = 0;
  let group = null;
  let texture = null;
  let meshes = [];
  let scene = null;
  let animatorAttached = false;
  let lastTodT = -1;
  const wood = new WoodBuilder();
  const stats = {
    leafInstances: 0, groundInstances: 0, woodQuads: 0,
    tris: 0, calls: 0, leafCap, groundCap, lowQuality: low,
    groups: {},
  };

  function addCard(gname, card) {
    const b = batches[gname];
    if (!b) return false;
    if (b.group === 'leaf') {
      if (leafUsed >= leafCap || b.n >= b.cap) return false;
      leafUsed++;
    } else {
      if (groundUsed >= groundCap || b.n >= b.cap) return false;
      groundUsed++;
    }
    return b.add(card);
  }

  function room(gname) {
    const b = batches[gname];
    if (!b) return 0;
    if (b.group === 'leaf') return Math.min(b.cap - b.n, leafCap - leafUsed);
    return Math.min(b.cap - b.n, groundCap - groundUsed);
  }

  function findScene() {
    let o = group;
    while (o) {
      if (o.isScene) return o;
      o = o.parent;
    }
    return null;
  }

  function updateShared(elapsed, dt) {
    SHARED.uTime.value = elapsed;
    // 阵风：双频叠加 + 缓慢转向
    SHARED.uGust.value = 0.62 + 0.30 * Math.sin(elapsed * 0.17) + 0.16 * Math.sin(elapsed * 0.53 + 1.7);
    const wa = 0.32 + 0.30 * Math.sin(elapsed * 0.045 + 0.8);
    SHARED.uWindDir.value.set(Math.cos(wa), Math.sin(wa));
    // 雾/昼夜色调：从 scene.fog 自动匹配
    if (!scene) scene = findScene();
    if (scene) {
      const fog = scene.fog;
      if (fog && fog.isFog) {
        SHARED.uFogColor.value.copy(fog.color);
        SHARED.uFogNear.value = fog.near;
        SHARED.uFogFar.value = fog.far;
        if (elapsed - lastTodT > 0.15) {
          lastTodT = elapsed;
          todTintFromFog(fog.color, _tmpC);
          SHARED.uTint.value.copy(_tmpC);
        }
      }
    }
  }

  function finalize() {
    if (group) return group;
    const _tf = (typeof performance !== 'undefined' ? performance.now() : 0);
    texture = makeAtlas();
    group = new THREE.Group();
    group.name = 'flora2';
    meshes = [];
    for (const key of Object.keys(batches)) {
      const mesh = batches[key].build(texture);
      if (mesh) {
        group.add(mesh);
        meshes.push(mesh);
        stats.groups[key] = batches[key].n;
      }
    }
    const woodMesh = wood.build();
    if (woodMesh) {
      group.add(woodMesh);
      meshes.push(woodMesh);
    }
    // 统计
    stats.leafInstances = batches.canopy.n + batches.bamboo.n + batches.hang.n + batches.water.n + batches.reed.n;
    stats.groundInstances = batches.ground.n + batches.flower.n;
    stats.woodQuads = wood.quads;
    let tris = 0;
    for (const m of meshes) {
      const geo = m.geometry;
      if (geo.isInstancedBufferGeometry) tris += geo.instanceCount * 2;
      else if (geo.index) tris += geo.index.count / 3;
    }
    stats.tris = Math.round(tris);
    stats.calls = meshes.length;
    stats.buildMs = Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - _t0);
    stats.finalizeMs = Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - _tf);
    // userData：供 Lead 查询/调试（不影响渲染）
    group.userData.flora2 = {
      stats: liveStats,
      setTint: (hexOrColor) => {
        if (hexOrColor && hexOrColor.isColor) SHARED.uTint.value.copy(hexOrColor);
        else if (typeof hexOrColor === 'number') SHARED.uTint.value.set(hexOrColor);
      },
      uniforms: SHARED,
    };
    if (typeof window !== 'undefined') window.__FLORA_STATS__ = liveStats();
    return group;
  }

  const update = (elapsed, dt) => updateShared(elapsed || 0, dt || 0);

  /** 实时统计（finalize 前后均可用） */
  function liveStats() {
    const groups = {};
    let leaf = 0, ground = 0;
    for (const k of Object.keys(batches)) {
      const b = batches[k];
      groups[k] = b.n;
      if (b.group === 'leaf') leaf += b.n; else ground += b.n;
    }
    return {
      leafInstances: leaf, groundInstances: ground,
      leafCap, groundCap, lowQuality: low,
      groups, woodQuads: wood.quads,
      tris: stats.tris || 0, calls: stats.calls || 0,
      buildMs: stats.buildMs || 0, finalizeMs: stats.finalizeMs || 0,
    };
  }

  // Lead 会通过 ctx.animators 驱动；若暂时没有该数组，则自己挂一个 RAF 兜底
  if (Array.isArray(c.animators)) {
    c.animators.push(update);
    animatorAttached = true;
  }
  if (Array.isArray(c.postBuild)) {
    c.postBuild.push(() => finalize());
  }

  const api = {
    addCard,
    room,
    leafRoom: () => Math.min(leafCap - leafUsed, batches.canopy.cap - batches.canopy.n),
    groundRoom: () => groundCap - groundUsed,
    leafUsed: () => leafUsed,
    groundUsed: () => groundUsed,
    budget: { leafCap, groundCap, low },
    scale: low ? 0.56 : 1,         // 单株叶片数量缩放
    quality: low ? 'mid' : 'high',
    wood,
    finalize,
    update,
    stats: liveStats,
    /** 若 Lead 未提供 animators，用于自行驱动（只应调用一次） */
    startSelfAnimator() {
      if (animatorAttached || typeof requestAnimationFrame !== 'function') return;
      animatorAttached = true;
      let prev = 0;
      const loop = (ts) => {
        requestAnimationFrame(loop);
        const t = ts / 1000;
        update(t, Math.min(0.05, t - prev));
        prev = t;
      };
      requestAnimationFrame(loop);
    },
    hasAnimator: () => animatorAttached,
  };
  // 若调用方既没 postBuild 也没 animators（例如旧版 main.js），暴露给 Lead 手动接线
  if (!Array.isArray(c.postBuild) && typeof window !== 'undefined') {
    window.__FLORA2__ = api;
  }
  return api;
}

export default createFoliage;
