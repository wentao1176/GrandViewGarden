// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 · 精细建筑构件与室内陈设（ornament 成员独立文件）
// 消费 ctx.details.*（Lead 在 helpers 中 push），生成 flat-shaded、顶点着色的精细网格。
//
// 坐标约定（与体素世界一致：x 东、z 南、y 上，单位 m，1 体素≈1m）：
//   · voxel 索引 v 占据 [v, v+1)；矩形 x1..x2 含端点 → 世界范围 [x1, x2+1]
//   · 体素中心 = v + 0.5（柱、门窗、灯具等"格内构件"按中心对齐）
//   · 柱/门窗/栏杆/家俱的 spec.y = 构件底面高度（m）
//   · roof.eaveY = 檐口体素层索引（檐口瓦面顶 ≈ eaveY+1）；roof.ridgeY = 脊顶体素层
//     若 Lead 的 helpers 采用别的语义，可在 spec 里显式给 eaveTop / ridgeTop 覆盖。
//
// 输出：
//   buildDetails(ctx) -> THREE.Group
//     静态几何合并为 ≤4 个 Mesh（实体色 / 字画贴图 / 题字贴图 / 其他），
//     动态门、灯笼用 InstancedMesh（各 1–3 draw call），并注册 ctx.animators。
//   makeRoofOrnaments / makeColumn / makeLattice / makeRailing / makeDoor /
//   makeFurniture / makeLantern / makeBanner 为独立纯函数资产。
//
// 色板：全部颜色来自 src/core/palette.js；顶点色按面法线烘焙明暗（场景无灯光）。
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { PALETTE, C } from '../core/palette.js';

// ── 色彩工具（与 mesher.js 同一套 sRGB→linear + 面明暗，保证风格统一）──────────
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const SHADE = { xp: 0.9, xn: 0.74, yp: 1.0, yn: 0.5, zp: 0.95, zn: 0.8 };

function palRGB(idx) {
  const p = PALETTE[idx];
  if (!p) return [0.82, 0.82, 0.82];
  return [p.r / 255, p.g / 255, p.b / 255];
}
function rgbOf(c) {
  if (Array.isArray(c)) return c;
  return palRGB(c);
}
function shadeColor(rgb, f) {
  return [s2l(Math.min(1, rgb[0] * f)), s2l(Math.min(1, rgb[1] * f)), s2l(Math.min(1, rgb[2] * f))];
}
function mixRGB(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function mulRGB(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }

// ── 精度档位（按 ctx.quality / isMobile 降级）─────────────────────────────────
const QUAL = {
  high: { colSeg: 8, cylSeg: 10, smallSeg: 8, tileMax: 44, hipSeg: 4, ridgeStep: 0.75, beasts: true, rafters: true, carve: true, texSize: 512 },
  mid: { colSeg: 6, cylSeg: 8, smallSeg: 6, tileMax: 26, hipSeg: 3, ridgeStep: 1.1, beasts: false, rafters: false, carve: true, texSize: 384 },
  low: { colSeg: 6, cylSeg: 6, smallSeg: 5, tileMax: 14, hipSeg: 2, ridgeStep: 1.6, beasts: false, rafters: false, carve: false, texSize: 256 },
};
function qualOf(ctx) {
  const q = (ctx && ctx.quality) || 'high';
  return QUAL[q] || QUAL.high;
}

// ── 材质（惰性单例；不要每帧/每件新建）──────────────────────────────────────
let _matSolid = null;
function matSolid() {
  if (!_matSolid) {
    _matSolid = new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, fog: true, toneMapped: false,
    });
    _matSolid.name = 'orn-solid';
  }
  return _matSolid;
}
let _matGlow = null;
function matGlow() {
  if (!_matGlow) {
    _matGlow = new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, fog: true, toneMapped: false,
    });
    _matGlow.name = 'orn-glow';
  }
  return _matGlow;
}

// ═══════════════════════════════════════════════════════════════════════════
// GeoBuilder：非索引 → 合并为单个 BufferGeometry（每 quad 4 顶点、按法线烘焙明暗）
// ═══════════════════════════════════════════════════════════════════════════
export class GeoBuilder {
  constructor(textured = false) {
    this.textured = textured;
    this.pos = [];
    this.col = [];
    this.uv = [];
    this.idx = [];
    this.n = 0;
    this.quads = 0;
    this.tris = 0;
  }

  _v(x, y, z, c, u, v) {
    this.pos.push(x, y, z);
    this.col.push(c[0], c[1], c[2]);
    if (this.textured) this.uv.push(u, v);
    return this.n++;
  }

  /** 四点四边形（a,b,c,d 逆时针=外侧）；rgb=调色板索引或 [r,g,b]；opt.uv/opt.shade */
  quad(a, b, c, d, color, opt = {}) {
    const rgb = rgbOf(color);
    // 面法线（用于明暗；退化为朝上）
    let nx = 0, ny = 1, nz = 0;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const len = Math.hypot(cx, cy, cz);
    if (len > 1e-6) { nx = cx / len; ny = cy / len; nz = cz / len; }
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let f = SHADE.yp;
    if (ay >= ax && ay >= az) f = ny >= 0 ? SHADE.yp : SHADE.yn;
    else if (ax >= az) f = nx >= 0 ? SHADE.xp : SHADE.xn;
    else f = nz >= 0 ? SHADE.zp : SHADE.zn;
    if (opt.shade != null) f = opt.shade;
    const cc = opt.noShade ? shadeColor(rgb, 1) : shadeColor(rgb, f);
    const i0 = this._v(a[0], a[1], a[2], cc, 0, 0);
    const i1 = this._v(b[0], b[1], b[2], cc, 0, 0);
    const i2 = this._v(c[0], c[1], c[2], cc, 0, 0);
    const i3 = this._v(d[0], d[1], d[2], cc, 0, 0);
    this.idx.push(i0, i1, i2, i0, i2, i3);
    this.quads++;
    this.tris += 2;
  }

  /** 带 UV 的四边形（仅 textured builder 使用）；uv 可为 [u0,v0,u1,v1] 或四角 8 个分量 */
  quadUV(a, b, c, d, color, uv, opt = {}) {
    const rgb = rgbOf(color);
    const f = opt.shade != null ? opt.shade : SHADE.zp;
    const cc = opt.noShade ? shadeColor(rgb, 1) : shadeColor(rgb, f);
    let U0, V0, U1, V1, U2, V2, U3, V3;
    if (uv.length >= 8) {
      [U0, V0, U1, V1, U2, V2, U3, V3] = uv;
    } else {
      const [u0, v0, u1, v1] = uv;
      U0 = u0; V0 = v0; U1 = u1; V1 = v0; U2 = u1; V2 = v1; U3 = u0; V3 = v1;
    }
    const i0 = this._v(a[0], a[1], a[2], cc, U0, V0);
    const i1 = this._v(b[0], b[1], b[2], cc, U1, V1);
    const i2 = this._v(c[0], c[1], c[2], cc, U2, V2);
    const i3 = this._v(d[0], d[1], d[2], cc, U3, V3);
    this.idx.push(i0, i1, i2, i0, i2, i3);
    this.quads++;
    this.tris += 2;
  }

  tri(a, b, c, color, opt = {}) {
    const rgb = rgbOf(color);
    const f = opt.shade != null ? opt.shade : SHADE.yp;
    const cc = shadeColor(rgb, f);
    const i0 = this._v(a[0], a[1], a[2], cc, 0, 0);
    const i1 = this._v(b[0], b[1], b[2], cc, 0, 0);
    const i2 = this._v(c[0], c[1], c[2], cc, 0, 0);
    this.idx.push(i0, i1, i2);
    this.tris += 1;
  }

  /** 轴对齐盒；opt 可覆盖各面颜色：{top,bottom,xp,xn,zp,zn}，skip 数组省略面 */
  box(x0, y0, z0, x1, y1, z1, color, opt = {}) {
    const c = (k) => (opt[k] != null ? opt[k] : color);
    const skip = opt.skip || null;
    const has = (k) => !skip || skip.indexOf(k) < 0;
    if (x1 < x0) { const t = x0; x0 = x1; x1 = t; }
    if (y1 < y0) { const t = y0; y0 = y1; y1 = t; }
    if (z1 < z0) { const t = z0; z0 = z1; z1 = t; }
    if (has('zp')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], c('zp'));
    if (has('zn')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], c('zn'));
    if (has('xp')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], c('xp'));
    if (has('xn')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], c('xn'));
    if (has('yp')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], c('yp'));
    if (has('yn')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], c('yn'));
  }

  /** 中心 + 半径的盒（方便家具局部坐标） */
  boxC(cx, cy, cz, w, h, d, color, opt = {}) {
    this.box(cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2, color, opt);
  }

  /** 任意两点间的方梁：w=横向宽, h=竖向厚 */
  beam(a, b, w, h, color, opt = {}) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    let rx, ry, rz;
    if (Math.abs(uy) > 0.95) { rx = 1; ry = 0; rz = 0; } else { rx = -uz; ry = 0; rz = ux; }
    const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
    const qx = ry * uz - rz * uy, qy = rz * ux - rx * uz, qz = rx * uy - ry * ux;
    const hw = w / 2, hh = h / 2;
    const corner = (p, sr, sh) => [p[0] + rx * hw * sr + qx * hh * sh, p[1] + ry * hw * sr + qy * hh * sh, p[2] + rz * hw * sr + qz * hh * sh];
    const s00 = corner(a, -1, -1), s10 = corner(a, 1, -1), s11 = corner(a, 1, 1), s01 = corner(a, -1, 1);
    const e00 = corner(b, -1, -1), e10 = corner(b, 1, -1), e11 = corner(b, 1, 1), e01 = corner(b, -1, 1);
    this.quad(s00, s10, s11, s01, color, opt);
    this.quad(e00, e01, e11, e10, color, opt);
    this.quad(s01, s11, e11, e01, color, opt);
    this.quad(s10, e10, e11, s11, color, opt);
    this.quad(s00, s01, e01, e00, color, opt);
    this.quad(s00, e00, e10, s10, color, opt);
  }

  /** 车削（花瓶/香炉/宝顶/灯笼）：profile=[[y,r],...]，可选顶底封口 */
  lathe(cx, cz, baseY, profile, seg, color, opt = {}) {
    const rings = [];
    for (const [py, pr] of profile) {
      const ring = [];
      for (let i = 0; i < seg; i++) {
        const ang = (i / seg) * Math.PI * 2;
        ring.push([cx + Math.cos(ang) * pr, baseY + py, cz + Math.sin(ang) * pr]);
      }
      rings.push(ring);
    }
    for (let k = 0; k < rings.length - 1; k++) {
      const A = rings[k], B = rings[k + 1];
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        this.quad(A[i], B[i], B[j], A[j], color, opt);
      }
    }
    if (!opt.openBottom) {
      const A = rings[0];
      for (let i = 1; i < seg - 1; i++) this.tri([cx, baseY + profile[0][0], cz], A[i + 1], A[i], color, { shade: SHADE.yn });
    }
    if (!opt.openTop) {
      const B = rings[rings.length - 1];
      const ty = baseY + profile[profile.length - 1][0];
      for (let i = 1; i < seg - 1; i++) this.tri([cx, ty, cz], B[i], B[i + 1], color, { shade: SHADE.yp });
    }
  }

  /** 低模球（宝顶/柱头/香炉纽） */
  ball(cx, cy, cz, r, seg, rings, color, opt = {}) {
    for (let j = 0; j < rings; j++) {
      const v0 = j / rings, v1 = (j + 1) / rings;
      const p0 = Math.PI * v0, p1 = Math.PI * v1;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const P = (p, a) => [cx + Math.sin(p) * Math.cos(a) * r, cy + Math.cos(p) * r, cz + Math.sin(p) * Math.sin(a) * r];
        const v00 = P(p0, a0), v01 = P(p0, a1), v10 = P(p1, a0), v11 = P(p1, a1);
        if (j === 0) this.tri(v00, v01, v11, color, opt);
        else if (j === rings - 1) this.tri(v00, v01, v10, color, opt);
        else this.quad(v00, v01, v11, v10, color, opt);
      }
    }
  }

  buildGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.textured) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }

  mesh(material) {
    const m = new THREE.Mesh(this.buildGeometry(), material);
    m.frustumCulled = true;
    return m;
  }
}

// 修正 cyl 的侧面绕序：GeoBuilder.cyl 内部用统一工具方法（保持外部调用简洁）
GeoBuilder.prototype.cyl = function cyl(cx, cz, y0, y1, r0, r1, seg, color, opt = {}) {
  const a0 = opt.phase || 0;
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const ang = a0 + (i / seg) * Math.PI * 2;
    pts.push([Math.cos(ang), Math.sin(ang)]);
  }
  for (let i = 0; i < seg; i++) {
    const [c0, s0] = pts[i], [c1, s1] = pts[i + 1];
    const A = [cx + c0 * r0, y0, cz + s0 * r0];
    const B = [cx + c1 * r0, y0, cz + s1 * r0];
    const Cc = [cx + c1 * r1, y1, cz + s1 * r1];
    const D = [cx + c0 * r1, y1, cz + s0 * r1];
    this.quad(A, D, Cc, B, color, opt);
  }
  if (r0 > 1e-4 && !opt.openBottom) {
    for (let i = 1; i < seg - 1; i++) {
      const ang0 = a0, ang1 = a0 + (i / seg) * Math.PI * 2, ang2 = a0 + ((i + 1) / seg) * Math.PI * 2;
      this.tri([cx, y0, cz], [cx + Math.cos(ang2) * r0, y0, cz + Math.sin(ang2) * r0], [cx + Math.cos(ang1) * r0, y0, cz + Math.sin(ang1) * r0], color, { shade: SHADE.yn });
    }
  }
  if (r1 > 1e-4 && !opt.openTop) {
    for (let i = 1; i < seg - 1; i++) {
      const ang1 = a0 + (i / seg) * Math.PI * 2, ang2 = a0 + ((i + 1) / seg) * Math.PI * 2;
      this.tri([cx, y1, cz], [cx + Math.cos(ang1) * r1, y1, cz + Math.sin(ang1) * r1], [cx + Math.cos(ang2) * r1, y1, cz + Math.sin(ang2) * r1], color, { shade: SHADE.yp });
    }
  }
};

// ── 面法线烘焙明暗的通用小工具（供外部/其它模块使用）────────────────────────
export function addBox(buf, x, y, z, w, h, d, color, opts = {}) {
  if (buf && buf.box) { buf.box(x, y, z, x + w, y + h, z + d, color, opts); return buf; }
  // 兼容普通累加缓冲 {pos,col,idx}
  const b = new GeoBuilder(false);
  b.box(x, y, z, x + w, y + h, z + d, color, opts);
  const base = (buf.pos.length / 3) | 0;
  for (let i = 0; i < b.pos.length; i++) buf.pos.push(b.pos[i]);
  for (let i = 0; i < b.col.length; i++) buf.col.push(b.col[i]);
  for (let i = 0; i < b.idx.length; i++) buf.idx.push(b.idx[i] + base);
  return buf;
}

// ── 局部坐标变换（rotY 绕 Y 轴；rotY=0 面向 +z 南）────────────────────────────
// spec.x / spec.z 默认按"体素索引"解释（世界中心 = v+0.5）；spec.center=true 时按米坐标。
function mkXf(spec, yOff = 0) {
  const rotY = spec.rotY || 0;
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const voxel = spec.center !== true ? 0.5 : 0;
  const tx = (spec.x ?? 0) + voxel + (spec.dx || 0);
  const ty = (spec.y ?? 0) + yOff + (spec.dy || 0);
  const tz = (spec.z ?? 0) + voxel + (spec.dz || 0);
  return (x, y, z) => [tx + x * c + z * s, ty + y, tz - x * s + z * c];
}

// ═══════════════════════════════════════════════════════════════════════════
// 一、屋面细部：封檐板 / 瓦当 / 檐椽 / 飞檐角梁 / 正脊 / 鸱吻 / 垂脊 / 宝顶
// ═══════════════════════════════════════════════════════════════════════════
const ROOF_TYPES = { xieshan: 1, hip: 1, gable: 1, pyramid: 1, gableRound: 1 };

/** 解析屋面 spec → 几何参考数据（全部为世界米坐标）
 *  关键：helpers 的 H.roof 是逐层退台屋面，其 return topY 已含正脊 3 层；
 *  这里由 eaveY/ridgeY（体素层索引）反推坡面层数、逐层收进量与**真实正脊长度**，
 *  不再直接使用 helpers 传的 ridgeRun.x1/x2（那是屋身内圈，不是脊长，会导致“天线”）。
 */
function roofRef(spec) {
  const x1 = num(spec.x1, 0), x2 = num(spec.x2, 0), z1 = num(spec.z1, 0), z2 = num(spec.z2, 0);
  const X0 = Math.min(x1, x2), X1 = Math.max(x1, x2) + 1;
  const Z0 = Math.min(z1, z2), Z1 = Math.max(z1, z2) + 1;
  const type = ROOF_TYPES[spec.type] ? spec.type : 'xieshan';
  // eaveY / ridgeY 为体素层索引（该层顶面 = 索引+1）；eaveTop/ridgeTop 可传绝对高度覆盖。
  const eaveYv = num(spec.eaveY, num(spec.y, 0));
  const E = (spec.eaveTop != null && okNum(spec.eaveTop)) ? spec.eaveTop : (eaveYv + 1);
  const R = Math.max(E + 1.5, (spec.ridgeTop != null && okNum(spec.ridgeTop))
    ? spec.ridgeTop
    : ((okNum(spec.ridgeY) ? spec.ridgeY : (E + 4)) + 1));
  const midX = (X0 + X1) / 2, midZ = (Z0 + Z1) / 2;
  const spanX = X1 - X0, spanZ = Z1 - Z0;
  const halfX = spanX / 2, halfZ = spanZ / 2;
  const imperial = spec.style === 'imperial';
  const tile = spec.tile ?? C.roof;
  const edge = spec.edge ?? C.roofEdge;
  const ridge = spec.ridge ?? C.ridge;
  const dh = Math.max(2, Math.round((okNum(spec.ridgeY) ? spec.ridgeY : (E + 4)) - eaveYv)); // 层差
  // 反推 H.roof 的坡面参数（与 helpers.js roof() 的几何一致）
  let h = 3;             // 坡面层数（不含正脊 3 层）
  let hLoop = 5;         // H.roof 主循环层数 = h + 2
  let stepX = 1, stepZ = 1;
  let ridgeZ = midZ;
  let rx0 = null, rx1 = null;
  if (type === 'xieshan' || type === 'hip') {
    h = Math.max(2, Math.min(8, dh - 5));
    stepZ = Math.max(1, Math.round(halfZ / Math.max(1, h)));
    stepX = stepZ;
    hLoop = h + 2;
    let ridgeHalf = halfX - hLoop * stepX + 0.5;
    ridgeHalf = Math.max(0.5, Math.min(ridgeHalf, halfX * 0.9));
    rx0 = midX - ridgeHalf; rx1 = midX + ridgeHalf;
    if (spec.ridgeRun && okNum(spec.ridgeRun.z)) ridgeZ = spec.ridgeRun.z;
  } else if (type === 'gable') {
    h = Math.max(2, Math.min(6, Math.round(halfZ * 0.7)));
    stepZ = Math.max(1, Math.round(halfZ / Math.max(1, h)));
    stepX = 0; hLoop = h + 2;
    rx0 = X0; rx1 = X1;                      // 硬山/悬山正脊通长
  } else if (type === 'gableRound') {
    h = Math.max(2, Math.min(6, Math.round(halfZ * 0.7)));
    stepZ = Math.max(1, Math.round(halfZ / Math.max(1, h)));
    stepX = 0; hLoop = h + 2;
    rx0 = X0; rx1 = X1;
  } else { // pyramid：无正脊，仅宝顶
    h = Math.max(2, Math.min(8, dh - 3));
    stepZ = Math.max(1, Math.round(Math.min(halfX, halfZ) / Math.max(1, h)));
    stepX = stepZ; hLoop = h + 2;
    rx0 = rx1 = midX;
  }
  const big = Math.max(spanX, spanZ);
  const conservative = spec.conservative === true || big > 26;  // 大屋面保守模式：不做过长角梁/走兽
  const huge = big > 34;                                        // 特大面积：只保留封檐/瓦当/正脊(宝顶)
  return {
    X0, X1, Z0, Z1, E, R, midX, midZ, spanX, spanZ, halfX, halfZ,
    type, imperial, tile, edge, ridge,
    ridgeRun: (rx0 != null && type !== 'pyramid') ? { x1: rx0, x2: rx1, z: ridgeZ } : null,
    h, hLoop, stepX, stepZ, big, conservative, huge,
  };
}

/** 屋面细部发射器 */
function emitRoof(g, spec, q) {
  const r = roofRef(spec);
  const { X0, X1, Z0, Z1, E, R, midX, midZ, spanX, spanZ, type, imperial, edge, ridge, ridgeRun } = r;
  const hLoop = r.hLoop, stepX = r.stepX, stepZ = r.stepZ, halfZ = r.halfZ;
  const conservative = r.conservative, huge = r.huge;
  // 逐层退台角点（贴合 H.roof 台阶屋面）：sx/sz 为“向屋脊方向”的内收符号
  const hipPath = (cx, cz, sx, sz, maxI) => {
    const pts = [];
    const n = Math.max(1, Math.min(maxI, hLoop));
    const maxPts = huge ? 3 : (conservative ? 4 : q.hipSeg + 1);
    const stride = Math.max(1, Math.ceil(n / Math.max(2, maxPts)));
    for (let i = 0; i <= n; i += stride) {
      const x = cx + sx * Math.min(i * stepX, r.halfX);
      const z = cz + sz * Math.min(i * stepZ, halfZ);
      pts.push([x, E - 0.06 + i, z]);
    }
    const iLast = n;
    const xLast = cx + sx * Math.min(iLast * stepX, r.halfX);
    const zLast = cz + sz * Math.min(iLast * stepZ, halfZ);
    const last = pts[pts.length - 1];
    if (!last || Math.abs(last[0] - xLast) > 1e-3 || Math.abs(last[2] - zLast) > 1e-3) pts.push([xLast, E - 0.06 + iLast, zLast]);
    return pts;
  };
  const rim = spec.rim ?? (imperial ? C.goldDark : C.woodDark);     // 封檐板/檐下木
  const tileEnd = spec.tileEnd ?? (imperial ? C.gold : C.roofEdge); // 瓦当
  const hipC = spec.hipC ?? (imperial ? C.glazeDark : C.ridge);
  const beastC = spec.beastC ?? (imperial ? C.gold : C.ridgeLight);
  const up = spec.upturn != null ? Math.max(0, spec.upturn) : 1;

  // 1) 封檐板（四周）：贴檐口外侧，高 0.34
  const fsr = 0.045, fh = 0.32, fy0 = E - fh - 0.06;
  g.box(X0 - fsr, fy0, Z0 - 2 * fsr, X1 + fsr, fy0 + fh, Z0 - fsr, rim, { skip: ['yn', 'zn'] });
  g.box(X0 - fsr, fy0, Z1 + fsr, X1 + fsr, fy0 + fh, Z1 + 2 * fsr, rim, { skip: ['yn', 'zp'] });
  g.box(X0 - 2 * fsr, fy0, Z0 - fsr, X0 - fsr, fy0 + fh, Z1 + fsr, rim, { skip: ['yn', 'xn'] });
  g.box(X1 + fsr, fy0, Z0 - fsr, X1 + 2 * fsr, fy0 + fh, Z1 + fsr, rim, { skip: ['yn', 'xp'] });

  // 2) 瓦当（檐口圆瓦头）：沿四边均匀分布；用朝外的菱形小瓦面（2 tris/枚）控制面数
  const perim = 2 * (spanX + spanZ);
  const maxN = Math.max(8, Math.round(q.tileMax * (huge ? 0.4 : conservative ? 0.65 : 1)));
  const step = Math.max(0.5, perim / maxN);
  const tileY = E - 0.18;
  const putTileX = (x, z, sgn) => {
    // 面朝 ±z 的菱形（瓦当）
    const s = 0.1;
    const zz = z + sgn * 0.02;
    g.quad([x - s, tileY, zz], [x, tileY - s, zz], [x + s, tileY, zz], [x, tileY + s, zz], tileEnd);
  };
  const putTileZ = (x, z, sgn) => {
    const s = 0.1;
    const xx = x + sgn * 0.02;
    g.quad([xx, tileY, z - s], [xx, tileY, z + s], [xx, tileY - s, z], [xx, tileY + s, z], tileEnd);
  };
  {
    let t = 0;
    for (; t <= spanX + 1e-6; t += step) {
      putTileX(X0 + Math.min(t, spanX), Z0 - 2 * fsr - 0.1, -1);
      putTileX(X0 + Math.min(t, spanX), Z1 + 2 * fsr + 0.1, 1);
    }
    t = 0;
    for (; t <= spanZ + 1e-6; t += step) {
      putTileZ(X0 - 2 * fsr - 0.1, Z0 + Math.min(t, spanZ), -1);
      putTileZ(X1 + 2 * fsr + 0.1, Z0 + Math.min(t, spanZ), 1);
    }
  }

  // 3) 檐椽（每 ~1.6m 一根短木，仅 high；大屋面省略以省面）
  if (q.rafters && !conservative) {
    const rstep = 1.6;
    for (let x = X0 + 0.4; x <= X1 - 0.3; x += rstep) {
      for (const zt of [Z0 - 3 * fsr - 0.16, Z1 + 3 * fsr + 0.16]) {
        g.box(x - 0.05, E - 0.55, zt - 0.1, x + 0.05, E - 0.2, zt + 0.1, C.woodDark, { skip: ['yn'] });
      }
    }
    for (let z = Z0 + 0.4; z <= Z1 - 0.3; z += rstep) {
      for (const xt of [X0 - 3 * fsr - 0.16, X1 + 3 * fsr + 0.16]) {
        g.box(xt - 0.1, E - 0.55, z - 0.05, xt + 0.1, E - 0.2, z + 0.05, C.woodDark, { skip: ['yn'] });
      }
    }
  }

  // 4) 飞檐角梁 + 套兽（四角向外上起翘；大屋面保守模式收短）
  if (up > 0 && !huge) {
    const corners = [
      [X0, Z0, -1, -1], [X1, Z0, 1, -1], [X0, Z1, -1, 1], [X1, Z1, 1, 1],
    ];
    const scale = conservative ? 0.62 : 1;
    for (const [cx, cz, sx, sz] of corners) {
      const baseY = E - 0.16;
      const reach = (0.45 + 0.2 * up) * scale;
      const rise = (0.18 + 0.22 * up) * (conservative ? 0.85 : 1);
      const n = q.hipSeg >= 3 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const p0 = [cx + sx * (0.12 + reach * t0), baseY + rise * Math.pow(t0, 2.1), cz + sz * (0.12 + reach * t0)];
        const p1 = [cx + sx * (0.12 + reach * t1), baseY + rise * Math.pow(t1, 2.1), cz + sz * (0.12 + reach * t1)];
        g.beam(p0, p1, 0.16, 0.14, i === n - 1 ? edge : C.woodDark);
      }
      // 套兽 / 角兽（起翘端；大屋面不做细兽）
      const tipX = cx + sx * (0.12 + reach);
      const tipZ = cz + sz * (0.12 + reach);
      const tipY = baseY + rise;
      g.box(tipX - 0.1, tipY - 0.03, tipZ - 0.1, tipX + 0.1, tipY + 0.18, tipZ + 0.1, q.beasts && !conservative ? beastC : edge);
      if (q.beasts && !conservative) {
        g.box(tipX - 0.05, tipY + 0.18, tipZ - 0.05, tipX + 0.05, tipY + 0.3, tipZ + 0.05, beastC);
      }
    }
  }

  // 5) 正脊 + 鹗吻（歇山/硬山/庑殿）；卷棚不做正脊；攒尖做宝顶
  if (type === 'pyramid') {
    // 攒尖宝顶（垂脊贴合台阶坡面）
    const baseR = Math.max(0.18, Math.min(0.5, spanX * 0.04));
    g.cyl(midX, midZ, R - 0.35, R - 0.18, baseR * 1.5, baseR * 1.2, q.smallSeg, imperial ? C.glazeDark : C.ridge);
    g.lathe(midX, midZ, R - 0.2, [
      [0.0, baseR * 1.1], [0.14, baseR * 0.85], [0.34, baseR * 1.25], [0.5, baseR * 0.55], [0.6, baseR * 0.2],
    ], q.smallSeg, imperial ? C.gold : C.bronze);
    g.ball(midX, R + 0.16, midZ, baseR * 0.62, q.smallSeg, 3, imperial ? C.gold : C.ridgeLight);
    g.cyl(midX, midZ, R + 0.12, R + 0.62, baseR * 0.16, baseR * 0.1, 4, imperial ? C.goldDark : C.bronzeDark, { openTop: true });
    if (!huge) {
      // 垂脊：沿逐层退台角点贴坡而上（内收符号 +1/-1 指向屋脊）
      for (const [cx, cz, sx, sz] of [[X0, Z0, 1, 1], [X1, Z0, -1, 1], [X0, Z1, 1, -1], [X1, Z1, -1, -1]]) {
        const iMax = Math.max(1, Math.min(hLoop, Math.ceil(Math.min(r.halfX, r.halfZ) / Math.max(1, r.stepX))));
        const pts = hipPath(cx, cz, sx, sz, iMax);
        for (let i = 0; i < pts.length - 1; i++) {
          g.beam(pts[i], pts[i + 1], 0.16, 0.12, hipC);
          if (q.beasts && !conservative && i === pts.length - 2) {
            g.boxC(pts[i][0], pts[i][1] + 0.12, pts[i][2], 0.14, 0.18, 0.14, beastC);
          }
        }
      }
    }
    return;
  }

  if (type === 'gableRound') {
    // 卷棚：无正脊，补博风板（沿两端山面坡线）+ 檐口小瓦当已有
    for (const gx of [X0, X1]) {
      const out = gx === X0 ? -1 : 1;
      for (const side of [-1, 1]) {
        const zEdge = side < 0 ? Z0 : Z1;
        const p0 = [gx + out * 0.06, E - 0.05, zEdge];
        const p1 = [gx + out * 0.06, R - 0.18, midZ];
        g.beam(p0, p1, 0.16, 0.11, imperial ? C.goldDark : C.woodDark);
      }
    }
    // 圆脊瓦楞（罗锅脊）：沿脊线一串小瓦块
    const n = Math.max(3, Math.round((X1 - X0) / 0.8));
    for (let i = 0; i <= n; i++) {
      const x = X0 + ((X1 - X0) * i) / n;
      g.boxC(x, R - 0.08, midZ, 0.42, 0.16, 0.44, r.tile, { skip: ['yn'] });
      g.boxC(x, R + 0.02, midZ, 0.3, 0.1, 0.32, shadedTile(r.tile, 1.12), { skip: ['yn'] });
    }
    return;
  }

  // 正脊
  if (r.ridgeRun) {
    const { x1: rx0, x2: rx1, z: rz } = r.ridgeRun;
    const len = Math.max(0.6, rx1 - rx0);
    // 脊座（瓦条）
    g.box(rx0 - 0.16, R - 0.42, rz - 0.23, rx1 + 0.16, R - 0.1, rz + 0.23, shadedTile(r.tile, 0.94));
    // 脊身
    g.box(rx0 - 0.1, R - 0.12, rz - 0.16, rx1 + 0.1, R + 0.16, rz + 0.16, ridge);
    // 脊上小瓦（脊筒；大屋面降低密度）
    const n = Math.max(2, Math.round(len / (q.ridgeStep * (conservative ? 1.8 : 1))));
    for (let i = 0; i <= n; i++) {
      const x = rx0 + (len * i) / n;
      g.boxC(x, R + 0.2, rz, 0.24, 0.12, 0.36, shadedTile(r.ridge, 1.18), { skip: ['yn'] });
    }
    // 两端鹗吻（龙形卷尾）
    for (const side of [-1, 1]) {
      const ex = side < 0 ? rx0 : rx1;
      const dir = side; // 向外
      const h0 = R + 0.1;
      g.box(ex - dir * 0.18 - 0.16, h0 - 0.08, rz - 0.2, ex - dir * 0.18 + 0.16, h0 + 0.22, rz + 0.2, imperial ? C.glazeDark : C.ridge);
      g.box(ex + dir * 0.02 - 0.13, h0 + 0.16, rz - 0.16, ex + dir * 0.02 + 0.13, h0 + (conservative ? 0.34 : 0.5), rz + 0.16, imperial ? C.goldDark : C.ridge);
      const cx1 = ex + dir * 0.16;
      g.box(cx1 - 0.09, h0 + 0.4, rz - 0.12, cx1 + 0.09, h0 + (conservative ? 0.52 : 0.66), rz + 0.12, imperial ? C.gold : C.ridgeLight);
      if (!conservative) {
        // 尾向内卷 + 眼部/须（金）
        g.box(ex - dir * 0.3 - 0.07, h0 + 0.3, rz - 0.1, ex - dir * 0.3 + 0.07, h0 + 0.52, rz + 0.1, imperial ? C.gold : C.ridgeLight);
        if (q.carve) g.boxC(ex + dir * 0.02, h0 + 0.38, rz - 0.18, 0.1, 0.08, 0.06, imperial ? C.gold : C.bronze);
      }
    }
  }

  // 垂脊（歇山/庑殿：沿逐层退台角点贴坡至正脊两端；不再用长直梁跨层）
  if ((type === 'xieshan' || type === 'hip') && !huge) {
    const rx0 = r.ridgeRun ? r.ridgeRun.x1 : midX - 0.6;
    const rx1 = r.ridgeRun ? r.ridgeRun.x2 : midX + 0.6;
    const iMaxX = Math.max(1, Math.ceil((r.halfX - Math.max(0.1, (rx1 - rx0) / 2)) / Math.max(1, stepX)));
    const iMaxZ = Math.max(1, Math.ceil(r.halfZ / Math.max(1, stepZ)));
    const iMax = Math.max(1, Math.min(hLoop, Math.min(iMaxX, iMaxZ)));
    const hips = [
      [X0, Z0, 1, 1], [X1, Z0, -1, 1],
      [X0, Z1, 1, -1], [X1, Z1, -1, -1],
    ];
    for (const [cx, cz, sx, sz] of hips) {
      const pts = hipPath(cx, cz, sx, sz, iMax);
      for (let i = 0; i < pts.length - 1; i++) {
        g.beam(pts[i], pts[i + 1], 0.17, 0.13, hipC);
        if (q.beasts && !conservative && i === pts.length - 2) {
          g.boxC(pts[i][0], pts[i][1] + 0.12, pts[i][2], 0.15, 0.2, 0.15, beastC);
        }
      }
    }
  }
}

function shadedTile(color, k) {
  // 屋面瓦作微差：返回调色板混合色（同色系略亮/略暗），最终仍以索引形式参与 rgbOf
  const rgb = palRGB(color);
  return mulRGB(rgb, k);
}

/** 纯函数：屋面细部 */
export function makeRoofOrnaments(spec) {
  const g = new GeoBuilder(false);
  emitRoof(g, spec || {}, QUAL.high);
  return [g.mesh(matSolid())];
}

// ═══════════════════════════════════════════════════════════════════════════
// 二、柱与柱础 / 斗拱
// ═══════════════════════════════════════════════════════════════════════════
function emitColumn(g, spec, q) {
  const cx = (spec.x ?? 0) + 0.5, cz = (spec.z ?? 0) + 0.5;
  const y0 = spec.y ?? 0, h = spec.h ?? 4;
  const r = spec.r ?? 0.22;
  const shaft = spec.color ?? C.redPillar;
  const baseC = spec.base ?? C.stone;
  const style0 = spec.style || 'wood';
  const capC = spec.cap ?? (style0 === 'imperial' ? C.gold : C.woodDark);
  const seg = q.colSeg;
  // 柱础：方座 + 覆盆
  const baseH = Math.min(0.22, h * 0.06);
  g.box(cx - r * 1.8, y0, cz - r * 1.8, cx + r * 1.8, y0 + baseH * 0.5, cz + r * 1.8, baseC);
  g.cyl(cx, cz, y0 + baseH * 0.5, y0 + baseH, r * 1.5, r * 1.15, q.smallSeg, baseC);
  // 柱身
  const top = y0 + h - 0.12;
  g.cyl(cx, cz, y0 + baseH, top, r, r * 0.95, seg, shaft, { openTop: true });
  // 柱头/斗拱（简化：小斗 + 十字拱臂 + 栌斗）
  g.boxC(cx, top + 0.04, cz, r * 2.2, 0.1, r * 2.2, capC);
  const armL = r * 1.55, armT = 0.07;
  g.box(cx - armL, top + 0.09, cz - armT / 2, cx + armL, top + 0.17, cz + armT / 2, capC, { skip: ['yn'] });
  g.box(cx - armT / 2, top + 0.09, cz - armL, cx + armT / 2, top + 0.17, cz + armL, capC, { skip: ['yn'] });
  g.boxC(cx, top + 0.23, cz, r * 1.25, 0.1, r * 1.25, shadedTile(capC, 1.1));
  if (style0 === 'imperial') {
    g.boxC(cx, top + 0.32, cz, r * 0.9, 0.08, r * 0.9, C.gold);
  }
}

export function makeColumn(spec) {
  const g = new GeoBuilder(false);
  emitColumn(g, spec || {}, QUAL.high);
  return g.mesh(matSolid());
}

// ═══════════════════════════════════════════════════════════════════════════
// 三、门窗棂：步步锦 / 冰裂纹 / 回纹 / 直棂
// ═══════════════════════════════════════════════════════════════════════════
const PI_ = Math.PI;

function latticeBarRect(g, x0, y0, z0, x1, y1, z1, color) {
  g.box(x0, y0, z0, x1, y1, z1, color, { skip: ['yn'] });
}

/**
 * 在局部 XY 平面（厚度沿 Z）上造棂格；origin = 面板左下角
 * 由调用者通过 P 变换到世界坐标（这里用 emitLatticeLocal 以 (x,y,z) 局部坐标发射）
 */
function emitLattice(g, spec, q, P) {
  const w = spec.w ?? 1.4, h = spec.h ?? 1.6;
  const frame = spec.frame ?? C.woodDark;
  const lat = spec.lattice ?? C.windowGreen;
  const style = spec.style || 'step';
  const depth = spec.depth ?? 0.1;
  const fw = 0.07;                                       // 边框宽
  const t = 0.05;                                        // 棂条厚
  const half = depth / 2;
  const y0 = spec.y ?? 0;
  // 竖向放置：XY 平面，厚度 z∈[-depth/2, depth/2]
  const p = (x, y, z) => P(x, y0 + y, z);
  // 外框
  const F = (x0, yy0, x1, yy1, z0, z1, c) => {
    const A = p(x0, yy0, z0), B = p(x1, yy0, z0), C = p(x1, yy1, z0), D = p(x0, yy1, z0);
    const E = p(x0, yy0, z1), G = p(x1, yy0, z1), H = p(x1, yy1, z1), I = p(x0, yy1, z1);
    g.quad(A, B, C, D, c); g.quad(E, G, H, I, c);
    g.quad(A, E, H, D, c); g.quad(B, G, I, C, c);
    g.quad(D, H, I, C, c); g.quad(A, B, G, E, c);
  };
  F(-w / 2, 0, w / 2, fw, -half, half, frame);
  F(-w / 2, h - fw, w / 2, h, -half, half, frame);
  F(-w / 2, 0, -w / 2 + fw, h, -half, half, frame);
  F(w / 2 - fw, 0, w / 2, h, -half, half, frame);
  // 棂条：在框内区域
  const ix0 = -w / 2 + fw, ix1 = w / 2 - fw, iy0 = fw, iy1 = h - fw;
  const iw = ix1 - ix0, ih = iy1 - iy0;
  const triStart = g.tris;
  const over = () => g.tris - triStart > 230;   // 单件门窗棂 ≤300 tris（含框）
  // 双面薄棂条：segBar 在局部 XY 平面上沿任意方向（各 2 quads = 4 tris）
  const zf = t / 2 + 0.004, zb = -t / 2 - 0.004;
  const segBar = (x0, yy0, x1, yy1, ww, c = lat) => {
    if (over()) return;
    const dx = x1 - x0, dy = yy1 - yy0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return;
    const nx = (-dy / len) * (ww / 2), ny = (dx / len) * (ww / 2);
    const A = [x0 + nx, yy0 + ny], B = [x0 - nx, yy0 - ny], C = [x1 - nx, yy1 - ny], D = [x1 + nx, yy1 + ny];
    g.quad(p(A[0], A[1], zf), p(B[0], B[1], zf), p(C[0], C[1], zf), p(D[0], D[1], zf), c);
    g.quad(p(B[0], B[1], zb), p(A[0], A[1], zb), p(D[0], D[1], zb), p(C[0], C[1], zb), c);
  };
  const bar = (x0, yy0, x1, yy1, c = lat) => segBar(x0, yy0, x1, yy1, t * 1.3, c);
  if (style === 'straight') {
    // 直棂：竖条 + 上下横档
    const n = Math.max(3, Math.round(iw / 0.22));
    for (let i = 1; i < n && !over(); i++) {
      const x = ix0 + (iw * i) / n;
      bar(x, iy0, x, iy1);
    }
    bar(ix0, iy0 + ih * 0.5, ix1, iy0 + ih * 0.5);
  } else if (style === 'step') {
    // 步步锦：纵横格 + 隔格内套小方
    const cellsX = Math.max(2, Math.min(3, Math.round(iw / 0.5)));
    const cellsY = Math.max(2, Math.min(3, Math.round(ih / 0.5)));
    for (let i = 1; i < cellsX && !over(); i++) bar(ix0 + (iw * i) / cellsX, iy0, ix0 + (iw * i) / cellsX, iy1);
    for (let j = 1; j < cellsY && !over(); j++) bar(ix0, iy0 + (ih * j) / cellsY, ix1, iy0 + (ih * j) / cellsY);
    for (let i = 0; i < cellsX && !over(); i++) {
      for (let j = 0; j < cellsY && !over(); j++) {
        if (((i + j) & 1) === 0) continue;
        const x0 = ix0 + (iw * i) / cellsX + t * 2, x1 = ix0 + (iw * (i + 1)) / cellsX - t * 2;
        const yy0 = iy0 + (ih * j) / cellsY + t * 2, yy1 = iy0 + (ih * (j + 1)) / cellsY - t * 2;
        if (x1 - x0 < 0.12 || yy1 - yy0 < 0.12) continue;
        bar(x0, yy0, x1, yy0); bar(x0, yy1, x1, yy1);
        bar(x0, yy0 + 0.02, x0, yy1 - 0.02); bar(x1, yy0 + 0.02, x1, yy1 - 0.02);
      }
    }
  } else if (style === 'hui') {
    // 回纹：格 + 每格回字（三边 + 内钩）
    const cellsX = Math.max(1, Math.min(2, Math.round(iw / 0.6)));
    const cellsY = Math.max(1, Math.min(2, Math.round(ih / 0.6)));
    for (let i = 1; i < cellsX && !over(); i++) bar(ix0 + (iw * i) / cellsX, iy0, ix0 + (iw * i) / cellsX, iy1);
    for (let j = 1; j < cellsY && !over(); j++) bar(ix0, iy0 + (ih * j) / cellsY, ix1, iy0 + (ih * j) / cellsY);
    for (let i = 0; i < cellsX && !over(); i++) {
      for (let j = 0; j < cellsY && !over(); j++) {
        const x0 = ix0 + (iw * i) / cellsX + t * 2.2, x1 = ix0 + (iw * (i + 1)) / cellsX - t * 2.2;
        const yy0 = iy0 + (ih * j) / cellsY + t * 2.2, yy1 = iy0 + (ih * (j + 1)) / cellsY - t * 2.2;
        if (x1 - x0 < 0.2 || yy1 - yy0 < 0.2) continue;
        const m = Math.min(x1 - x0, yy1 - yy0) * 0.28;
        bar(x0, yy0, x1 - m, yy0);
        bar(x0, yy0, x0, yy1 - m);
        bar(x0 + m, yy1, x1, yy1);
        bar(x1, yy0 + m, x1, yy1);
        bar(x0 + m, yy0 + m, x0 + m, yy1 - m);
      }
    }
  } else {
    // 冰裂纹：中心 + 8 向放射节点连成不规则冰纹网
    const seed = (spec.seed ?? 0) | 0;
    const rnd = (() => { let a = (seed * 2654435761 + 97) >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
    const cxx = 0, cyy = (iy0 + iy1) / 2;
    const R0 = Math.min(iw, ih) * 0.3;
    const innerN = 6;
    const inner = [];
    for (let i = 0; i < innerN; i++) {
      const ang = (i / innerN) * Math.PI * 2 + rnd() * 0.5;
      const rr = R0 * (0.7 + rnd() * 0.55);
      inner.push([cxx + Math.cos(ang) * rr * 1.25, cyy + Math.sin(ang) * rr]);
    }
    const edge = [
      [ix0 + iw * (0.1 + rnd() * 0.14), iy0 + ih * (0.06 + rnd() * 0.12)],
      [ix0 + iw * (0.5 + rnd() * 0.1), iy0 + ih * 0.04],
      [ix0 + iw * (0.78 + rnd() * 0.16), iy0 + ih * (0.08 + rnd() * 0.14)],
      [ix0 + iw * 0.96, iy0 + ih * (0.4 + rnd() * 0.16)],
      [ix0 + iw * (0.72 + rnd() * 0.16), iy0 + ih * (0.84 + rnd() * 0.12)],
      [ix0 + iw * (0.42 + rnd() * 0.12), iy0 + ih * 0.96],
      [ix0 + iw * (0.1 + rnd() * 0.14), iy0 + ih * (0.8 + rnd() * 0.12)],
      [ix0 + iw * 0.04, iy0 + ih * (0.36 + rnd() * 0.14)],
    ];
    for (let i = 0; i < innerN && !over(); i++) {
      segBar(cxx, cyy, inner[i][0], inner[i][1], t * 1.5);
    }
    for (let i = 0; i < innerN && !over(); i++) {
      const e = edge[i % edge.length];
      segBar(inner[i][0], inner[i][1], e[0], e[1], t * 1.35);
      // 相邻枝杈（短）
      const e2 = edge[(i + 3) % edge.length];
      segBar(inner[i][0], inner[i][1], (inner[i][0] + e2[0]) / 2, (inner[i][1] + e2[1]) / 2, t * 1.05);
    }
    for (let i = 0; i < innerN && !over(); i += 2) {
      const j = (i + 1) % innerN;
      segBar(inner[i][0], inner[i][1], inner[j][0], inner[j][1], t * 1.2);
    }
  }
  // 糊纸/透光背板（双面薄片，若 spec.paper!==false）
  if (spec.paper !== false) {
    const pc = spec.paperColor ?? C.paper;
    const zpf = 0.008, zpb = -0.008;
    g.quad(p(ix0, iy0, zpf), p(ix1, iy0, zpf), p(ix1, iy1, zpf), p(ix0, iy1, zpf), pc, { shade: SHADE.yp });
    g.quad(p(ix1, iy0, zpb), p(ix0, iy0, zpb), p(ix0, iy1, zpb), p(ix1, iy1, zpb), pc, { shade: SHADE.yp });
  }
}

/** 把面向 +z 的门窗棂变换到世界。
 *  helpers 的 lattice spec：x/z 为体素索引，w=体素列数；axis:'x' 时窗横向占 x..x+w。
 */
function latticeXf(spec) {
  const cy = spec.y ?? 0;
  const w = spec.w ?? 3;
  if ((spec.axis || 'x') === 'z') {
    // 绕 Y 旋转 90°：局部 x → 世界 z，局部 z → 世界 -x
    const c = Math.cos(PI_ / 2), s = Math.sin(PI_ / 2);
    const cz = (spec.z ?? 0) + w / 2;
    return (x, y, z) => [(spec.x ?? 0) + 0.5 + (x * c + z * s), cy + y, cz + (-x * s + z * c)];
  }
  const cx = (spec.x ?? 0) + w / 2;
  return (x, y, z) => [cx + x, cy + y, (spec.z ?? 0) + 0.5 + z];
}

export function makeLattice(spec) {
  const g = new GeoBuilder(false);
  emitLattice(g, spec || {}, QUAL.high, latticeXf(spec || {}));
  return g.mesh(matSolid());
}

// ═══════════════════════════════════════════════════════════════════════════
// 四、栏杆：望柱 + 扶手 + 栏板（木/竹/石）
// ═══════════════════════════════════════════════════════════════════════════
function emitRailing(g, spec, q) {
  // 兼容两种 spec：lab 用 pts:[[x,z],...]；helpers 用 {x1,z1,x2,z2}
  let pts = Array.isArray(spec.pts) ? spec.pts : null;
  if (!pts && okNum(spec.x1) && okNum(spec.z1) && okNum(spec.x2) && okNum(spec.z2)) {
    pts = [[spec.x1, spec.z1], [spec.x2, spec.z2]];
  }
  if (!pts || pts.length < 2) return;
  const y = num(spec.y, 0);
  const style = spec.style || 'wood';
  const isStone = style === 'stone';
  const isBamboo = style === 'bamboo';
  const col = spec.color ?? (isStone ? C.marble : isBamboo ? C.bambooStalk : C.redRail);
  const postC = spec.postColor ?? (isStone ? C.marbleShade : isBamboo ? C.bambooNode : col);
  const railC = spec.railColor ?? (isStone ? C.marble : isBamboo ? C.bambooStalk : col);
  const panelC = spec.panelColor ?? (isStone ? C.marbleShade : isBamboo ? C.bambooStalk : C.wood);
  // helpers 的 h 是体素柱高（常见 2），细网格映射到真实栏杆高约 1.05–1.2m
  const H = spec.h != null ? Math.min(1.3, Math.max(0.85, spec.h * 0.58)) : (isStone ? 1.05 : 1.0);
  const railH = isStone ? 0.14 : isBamboo ? 0.08 : 0.09;
  const postW = isStone ? 0.16 : 0.11;
  const panelTop = y + H - railH - 0.06;
  const panelBot = y + 0.22;
  // 沿折线累计长度
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const ax = (a[0] ?? 0) + 0.5, az = (a[1] ?? a[0]) + 0.5;
    const bx = (b[0] ?? 0) + 0.5, bz = (b[1] ?? b[0]) + 0.5;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-4) continue;
    segs.push({ ax, az, bx, bz, len, start: total });
    total += len;
  }
  if (!segs.length) return;
  const postStep = isStone ? 1.35 : 1.4;
  const nPost = Math.max(2, Math.round(total / postStep) + 1);
  // 望柱（按弧长等距）
  for (let i = 0; i < nPost; i++) {
    const s = (total * i) / (nPost - 1);
    let seg = segs[segs.length - 1];
    for (const sg of segs) { if (s <= sg.start + sg.len + 1e-6) { seg = sg; break; } }
    const t = Math.min(1, (s - seg.start) / seg.len);
    const x = seg.ax + (seg.bx - seg.ax) * t;
    const z = seg.az + (seg.bz - seg.az) * t;
    g.box(x - postW / 2, y, z - postW / 2, x + postW / 2, y + H, z + postW / 2, postC);
    if (isStone) {
      g.boxC(x, y + H + 0.07, z, postW * 1.5, 0.14, postW * 1.5, C.marble);
    } else {
      // 柱头（简化莲苞/竹节，盒式省面）
      g.boxC(x, y + H + 0.05, z, postW * 1.25, 0.11, postW * 1.25, isBamboo ? C.bambooNode : C.gold);
    }
  }
  // 栏板竖棂（双面薄片，省面）
  const flatSlat = (x, z, yy0, yy1, alongX, alongZ, wAlong, c) => {
    const hw = wAlong / 2;
    const A = [x - alongX * hw, yy0, z - alongZ * hw];
    const B = [x + alongX * hw, yy0, z + alongZ * hw];
    const Cc = [B[0], yy1, B[2]];
    const D = [A[0], yy1, A[2]];
    const nx = -alongZ * 0.02, nz = alongX * 0.02;
    g.quad([A[0] + nx, A[1], A[2] + nz], [B[0] + nx, B[1], B[2] + nz], [Cc[0] + nx, Cc[1], Cc[2] + nz], [D[0] + nx, D[1], D[2] + nz], c);
    g.quad([B[0] - nx, B[1], B[2] - nz], [A[0] - nx, A[1], A[2] - nz], [D[0] - nx, D[1], D[2] - nz], [Cc[0] - nx, Cc[1], Cc[2] - nz], c);
  };
  // 扶手 + 栏板
  for (const sg of segs) {
    const dirx = (sg.bx - sg.ax) / sg.len, dirz = (sg.bz - sg.az) / sg.len;
    const nx = -dirz, nz = dirx;
    const ao = [sg.ax, y + H - railH, sg.az], bo = [sg.bx, y + H - railH, sg.bz];
    // 扶手（略出挑）
    const thick = isStone ? 0.15 : 0.1;
    const w = isStone ? 0.22 : 0.11;
    g.beam([ao[0] - nx * 0, ao[1], ao[2] - nz * 0], [bo[0], bo[1], bo[2]], w, thick, railC);
    if (!isStone && !isBamboo) {
      // 木栏板：上下横枋 + 竖棂 + 中横档
      const midY = (panelTop + panelBot) / 2;
      const sub = Math.max(2, Math.round(sg.len / 0.55));
      // 下枋
      g.beam([ao[0], y + 0.18, ao[2]], [bo[0], y + 0.18, bo[2]], 0.07, 0.07, panelC);
      // 上枋
      g.beam([ao[0], panelTop, ao[2]], [bo[0], panelTop, bo[2]], 0.07, 0.07, panelC);
      for (let i = 1; i < sub; i++) {
        const t = i / sub;
        const x = sg.ax + (sg.bx - sg.ax) * t, z = sg.az + (sg.bz - sg.az) * t;
        flatSlat(x, z, panelBot, panelTop, dirx, dirz, 0.055, panelC);
      }
      // 中横档
      g.boxC((sg.ax + sg.bx) / 2, midY, (sg.az + sg.bz) / 2, sg.len, 0.055, 0.055, panelC);
    } else if (isStone) {
      // 石栏板：整块薄板（内凹雕刻线用细条代）
      const n = new GeoBuilder(false);
      void n;
      const cx2 = (sg.ax + sg.bx) / 2, cz2 = (sg.az + sg.bz) / 2;
      // 用 beam 做整块石板
      g.beam([ao[0], panelBot, ao[2]], [bo[0], panelBot, bo[2]], 0.06, panelTop - panelBot, C.marbleShade);
      if (q.carve) {
        g.beam([ao[0], (panelTop + panelBot) / 2 - 0.03, ao[2]], [bo[0], (panelTop + panelBot) / 2 - 0.03, bo[2]], 0.02, 0.05, C.marble);
      }
      void cx2; void cz2;
    } else if (isBamboo) {
      // 竹栏：两道竹管 + 短竹棂
      g.beam([ao[0], y + 0.42, ao[2]], [bo[0], y + 0.42, bo[2]], 0.075, 0.075, panelC ?? railC);
      g.beam([ao[0], y + 0.72, ao[2]], [bo[0], y + 0.72, bo[2]], 0.075, 0.075, panelC ?? railC);
      const sub = Math.max(2, Math.round(sg.len / 0.62));
      for (let i = 1; i < sub; i++) {
        const t = i / sub;
        const x = sg.ax + (sg.bx - sg.ax) * t, z = sg.az + (sg.bz - sg.az) * t;
        flatSlat(x, z, y + 0.42, y + 0.72, dirx, dirz, 0.05, C.bambooNode);
      }
    }
  }
}

export function makeRailing(spec) {
  const g = new GeoBuilder(false);
  emitRailing(g, spec || {}, QUAL.high);
  return g.mesh(matSolid());
}

// ═══════════════════════════════════════════════════════════════════════════
// 五、门（可开合）：板门 / 隔扇门；makeDoor 返回 {group, leaf}
// ═══════════════════════════════════════════════════════════════════════════
function emitDoorFrame(g, spec, q) {
  const axis = spec.axis || 'x';
  const w = spec.w ?? 1.6, h = spec.h ?? 2.4;
  const x = spec.x ?? 0, y = spec.y ?? 0, z = spec.z ?? 0;
  const frameC = spec.frameColor ?? C.woodDark;
  const th = 0.12;
  const P = mkXf({ x: x + 0.5, y, z: z + 0.5, rotY: axis === 'z' ? PI_ / 2 : 0 });
  const halfW = (w + th) / 2;
  const fw = 0.09;
  // 门框（两侧立柱 + 上槛 + 下槛）
  const F = (x0, yy0, x1, yy1, z0, z1, c) => g.box(...P(x0, yy0, z0).concat([]), 0, 0, 0, c);
  // 直接按世界坐标盒会更麻烦，这里用 beam 构造四边
  const A = P(-halfW, 0, 0), B = P(halfW, 0, 0), Cc = P(halfW, h + fw, 0), D = P(-halfW, h + fw, 0);
  void F; void A; void B; void Cc; void D;
  // 侧框
  const side = (sx) => {
    const p0 = P(sx * halfW, 0, 0), p1 = P(sx * halfW, h + fw, 0);
    const pp0 = P(sx * halfW - fw / 2, 0, -th / 2), pp1 = P(sx * halfW + fw / 2, h + fw, -th / 2);
    const q0 = P(sx * halfW - fw / 2, 0, th / 2), q1 = P(sx * halfW + fw / 2, h + fw, th / 2);
    g.quad(pp0, pp1, P(sx * halfW + fw / 2, h + fw, th / 2), P(sx * halfW - fw / 2, h + fw, th / 2), frameC);
    g.quad(P(sx * halfW - fw / 2, 0, th / 2), P(sx * halfW + fw / 2, 0, th / 2), P(sx * halfW + fw / 2, h + fw, th / 2), P(sx * halfW - fw / 2, h + fw, th / 2), frameC);
    const px = sx * halfW;
    g.box(px - fw / 2, y, z + (axis === 'z' ? -th / 2 : 0) + 0.5 - th / 2, px + fw / 2, y + h + fw, z + (axis === 'z' ? 0 : 0) + 0.5 + th / 2, frameC);
    void p0; void p1; void q0; void q1;
  };
  // 简化：用盒构建边框（轴对齐；axis:'z' 时交换 x/z 尺寸）
  const bx = axis === 'z' ? th : w + th * 2;
  const bz = axis === 'z' ? w + th * 2 : th;
  const cx = x + 0.5, cz = z + 0.5;
  g.box(cx - bx / 2, y, cz - bz / 2, cx + bx / 2, y + fw * 1.1, cz + bz / 2, frameC);       // 下槛
  g.box(cx - bx / 2, y + h + fw, cz - bz / 2, cx + bx / 2, y + h + fw * 2.1, cz + bz / 2, frameC); // 上槛
  if (axis === 'z') {
    g.box(cx - bx / 2 - fw / 2, y, cz - bz / 2, cx - bx / 2 + fw / 2, y + h + fw, cz + bz / 2, frameC);
    g.box(cx + bx / 2 - fw / 2, y, cz - bz / 2, cx + bx / 2 + fw / 2, y + h + fw, cz + bz / 2, frameC);
  } else {
    g.box(cx - bx / 2 - fw / 2, y, cz - bz / 2, cx - bx / 2 + fw / 2, y + h + fw, cz + bz / 2, frameC);
    g.box(cx + bx / 2 - fw / 2, y, cz - bz / 2, cx + bx / 2 + fw / 2, y + h + fw, cz + bz / 2, frameC);
  }
  void side;
}

/** 构建单位门扇几何（宽 1、高 1，铰链在 x=0，法线沿 ±z） */
function buildDoorLeafGeometry(color, style, q) {
  const g = new GeoBuilder(false);
  const c = color;
  const dark = mulRGB(rgbOf(C.woodDark), 1);
  const gold = C.gold;
  const th = 0.055;
  // 门扇：宽 1、高 1、厚 th（z 居中）
  g.box(0, 0, -th / 2, 1, 1, th / 2, c);
  // 边框（四边略深色）
  const b = 0.06;
  g.box(0, 0, -th / 2 - 0.006, 1, b, th / 2 + 0.006, rgbOf(dark));
  g.box(0, 1 - b, -th / 2 - 0.006, 1, 1, th / 2 + 0.006, rgbOf(dark));
  g.box(0, 0, -th / 2 - 0.006, b, 1, th / 2 + 0.006, rgbOf(dark));
  g.box(1 - b, 0, -th / 2 - 0.006, 1, 1, th / 2 + 0.006, rgbOf(dark));
  if (style === 'lattice') {
    // 隔扇门：上 2/3 棂格
    const top = 0.34;
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const x0 = 0.1 + i * 0.4, y0 = top + j * 0.3;
        g.box(x0, y0, -th / 2 - 0.02, x0 + 0.3, y0 + 0.22, th / 2 + 0.02, C.windowGreen);
        g.box(x0 + 0.02, y0 + 0.02, -th / 2 - 0.03, x0 + 0.28, y0 + 0.2, th / 2 + 0.03, C.windowGlow);
      }
    }
    // 下部裙板
    g.box(0.08, 0.06, -th / 2 - 0.02, 0.92, 0.28, th / 2 + 0.02, rgbOf(mulRGB(rgbOf(c), 0.82)));
  } else {
    // 板门：门钉 + 铺首
    const studs = q.carve ? 3 : 2;
    for (let ix = 0; ix < studs; ix++) {
      for (let iy = 0; iy < studs; iy++) {
        const sx = 0.18 + (ix * 0.64) / Math.max(1, studs - 1);
        const sy = 0.2 + (iy * 0.6) / Math.max(1, studs - 1);
        g.boxC(sx, sy, -th / 2 - 0.02, 0.07, 0.07, 0.04, gold);
      }
    }
    if (q.carve) {
      // 铺首衔环
      g.boxC(0.72, 0.5, -th / 2 - 0.03, 0.16, 0.16, 0.04, C.bronze);
      g.cyl(0.72, -th / 2 - 0.02, 0.42, 0.42, 0.001, 0.001, 4, C.bronzeDark, { openTop: true, openBottom: true });
    }
    // 中槛横带
    g.box(0.06, 0.72, -th / 2 - 0.02, 0.94, 0.76, th / 2 + 0.02, rgbOf(mulRGB(rgbOf(c), 1.18)));
  }
  return g.buildGeometry();
}

const _doorGeomCache = new Map();
function doorUnitGeom(colorIdx, style, q) {
  const key = `door_${colorIdx}_${style}_${q.colSeg}`;
  let ge = _doorGeomCache.get(key);
  if (!ge) { ge = buildDoorLeafGeometry(colorIdx, style, q); _doorGeomCache.set(key, ge); }
  return ge;
}

/** 纯函数：单扇门（Group 的铰链在原点；leaf.rotation.y 即开合角） */
export function makeDoor(spec) {
  const s = spec || {};
  const q = QUAL.high;
  const axis = s.axis || 'x';
  const w = s.w ?? 1.6, h = s.h ?? 2.4;
  const hingeSign = (s.hinge || 'left') === 'right' ? -1 : 1;
  const leaves = s.leaves ?? (w > 2.1 ? 2 : 1);
  const leafW = w / leaves;
  const style = s.style || ((s.leafColor === C.woodRed || s.leafColor === C.redPillar) ? 'panel' : 'lattice');
  const colorIdx = s.leafColor ?? C.woodRed;
  const group = new THREE.Group();
  group.position.set((s.x ?? 0) + 0.5, s.y ?? 0, (s.z ?? 0) + 0.5);
  group.rotation.y = axis === 'z' ? -PI_ / 2 : 0;
  const leaf = new THREE.Mesh(doorUnitGeom(colorIdx, style, q), matSolid());
  const side = hingeSign;
  leaf.scale.set(leafW * side, h, 1);
  // 铰链：侧边；单扇时铰链在门宽一侧
  leaf.position.set(side > 0 ? -w / 2 : w / 2, 0, 0);
  group.add(leaf);
  group.userData = {
    kind: 'door', leaf, axis, side, leafW, leafH: h, openAngle: 0,
    maxAngle: s.maxAngle ?? 1.55, openTowards: s.openTowards ?? 1,
    setOpen(open) { this.openAngle = open ? this.maxAngle : 0; leaf.rotation.y = this.openAngle; },
  };
  return { group, leaf };
}

/** 门框合并进静态几何 + 收集门扇实例 */
function collectDoor(spec, q, staticG, doors) {
  const axis = spec.axis || 'x';
  const w = spec.w ?? 1.6, h = spec.h ?? 2.4;
  // helpers 的 door spec：axis:'x' 时 x 是起始体素列、w 为体素列数（世界跨度 w 米）；
  // 门中心 = x + w/2；axis:'z' 同理沿 z。
  const cx = axis === 'z' ? ((spec.x ?? 0) + 0.5) : ((spec.x ?? 0) + w / 2);
  const cz = axis === 'z' ? ((spec.z ?? 0) + w / 2) : ((spec.z ?? 0) + 0.5);
  const y = spec.y ?? 0;
  const fc = spec.frameColor ?? C.woodDark;
  const jt = 0.09;      // 框厚
  const etx = w / 2 + jt; // 含框外沿
  if (axis === 'z') {
    staticG.box(cx - jt, y, cz - etx, cx + jt, y + 0.1, cz + etx, fc);                 // 下槛
    staticG.box(cx - jt, y + h, cz - etx, cx + jt, y + h + 0.16, cz + etx, fc);        // 上槛
    staticG.box(cx - jt, y, cz - etx, cx + jt, y + h, cz - w / 2, fc);                 // 框（北）
    staticG.box(cx - jt, y, cz + w / 2, cx + jt, y + h, cz + etx, fc);                 // 框（南）
  } else {
    staticG.box(cx - etx, y, cz - jt, cx + etx, y + 0.1, cz + jt, fc);
    staticG.box(cx - etx, y + h, cz - jt, cx + etx, y + h + 0.16, cz + jt, fc);
    staticG.box(cx - etx, y, cz - jt, cx - w / 2, y + h, cz + jt, fc);
    staticG.box(cx + w / 2, y, cz - jt, cx + etx, y + h, cz + jt, fc);
  }
  // 门扇数量：宽 > 2.1 → 双扇
  const leaves = spec.leaves ?? (w > 2.1 ? 2 : 1);
  const leafW = w / leaves;
  const style = spec.style || ((spec.leafColor === C.woodRed || spec.leafColor === C.redPillar) ? 'panel' : 'lattice');
  const colorIdx = spec.leafColor ?? C.woodRed;
  const openTowards = spec.openTowards ?? 1;
  for (let i = 0; i < leaves; i++) {
    const side = leaves === 1 ? 1 : (i === 0 ? 1 : -1);
    doors.push({
      spec, axis, cx, cz, y, w, h, leafW, style, colorIdx, side, openTowards,
      angle: spec.open ? (spec.maxAngle ?? 1.55) : 0,
      target: spec.open ? (spec.maxAngle ?? 1.55) : 0,
      maxAngle: spec.maxAngle ?? 1.55,
      index: doors.length,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 六、室内家具与陈设
// ═══════════════════════════════════════════════════════════════════════════
const FURN = {
  altar: { w: 2.2, d: 0.58, h: 1.0 },
  table: { w: 1.42, d: 0.66, h: 0.82 },
  squareTable: { w: 1.1, d: 1.1, h: 0.82 },
  desk: { w: 1.8, d: 0.78, h: 0.82 },
  chair: { w: 0.66, d: 0.62, h: 1.14 },
  bed: { w: 2.2, d: 1.55, h: 2.25 },
  bookshelf: { w: 1.2, d: 0.44, h: 2.0 },
  screen: { w: 2.6, d: 0.42, h: 2.2 },
  cabinet: { w: 1.1, d: 0.55, h: 1.2 },
  rug: { w: 2.6, d: 1.8, h: 0.03 },
};
const WOOD = C.wood, WOODD = C.woodDark, WOODL = C.woodLight;

/** 发射一件家具：kind + spec，P=局部→世界 */
function emitFurniture(g, tex, spec, P, q) {
  const kind = spec.kind || 'table';
  const W = spec.w ?? (FURN[kind] ? FURN[kind].w : 1.2);
  const D = spec.d ?? (FURN[kind] ? FURN[kind].d : 0.6);
  const Hh = spec.h ?? (FURN[kind] ? FURN[kind].h : 0.8);
  const woodC = spec.color ?? WOOD;
  const darkC = spec.dark ?? WOODD;
  const goldC = C.gold;
  const marbleC = spec.marble ?? C.marble;
  // 8 顶点变换后的六面体（支持 rotY 任意角度）
  const polyBox = (x0, y0, z0, x1, y1, z1, c, opt = {}) => {
    const v = (x, y, z) => P(x, y, z);
    const A = v(x0, y0, z1), Bv = v(x1, y0, z1), Cv = v(x1, y1, z1), Dv = v(x0, y1, z1);
    const E = v(x1, y0, z0), Fv = v(x0, y0, z0), Gv = v(x0, y1, z0), Hv = v(x1, y1, z0);
    const skip = opt.skip || [];
    const has = (k) => skip.indexOf(k) < 0;
    if (has('zp')) g.quad(A, Bv, Cv, Dv, c);
    if (has('zn')) g.quad(E, Fv, Gv, Hv, c);
    if (has('xp')) g.quad(Bv, E, Hv, Cv, c);
    if (has('xn')) g.quad(Fv, A, Dv, Gv, c);
    if (has('yp')) g.quad(Dv, Cv, Hv, Gv, c);
    if (has('yn')) g.quad(Fv, E, Bv, A, c);
  };
  const cyl = (cx, cy, cz, r, h, seg, c, opt = {}) => {
    // 旋转圆柱：取局部上下圆心
    const a = P(cx, cy, cz);
    g.cyl(a[0], a[2], a[1], a[1] + h, r, opt.r1 ?? r, seg, c, opt);
  };
  const ball = (cx, cy, cz, r, c) => {
    const a = P(cx, cy, cz);
    g.ball(a[0], a[1], a[2], r, q.smallSeg, 3, c);
  };
  // 暖光十字面片（低成本“自发光”观感：高亮色 + 不参与烘焙阴影）
  const glowCross = (cx, cy, cz, r, c) => {
    const gc = c ?? (C.lampWarm ?? C.candle ?? C.paper);
    const A = P(cx, cy, cz);
    const x0 = A[0] - r, x1 = A[0] + r, y0 = A[1] - r, y1 = A[1] + r;
    const z0 = A[2] - r, z1 = A[2] + r;
    g.quad([x0, y0, A[2]], [x1, y0, A[2]], [x1, y1, A[2]], [x0, y1, A[2]], gc, { noShade: true, shade: 1.3 });
    g.quad([x1, y0, A[2]], [x0, y0, A[2]], [x0, y1, A[2]], [x1, y1, A[2]], gc, { noShade: true, shade: 1.3 });
    g.quad([A[0], y0, z0], [A[0], y0, z1], [A[0], y1, z1], [A[0], y1, z0], gc, { noShade: true, shade: 1.3 });
    g.quad([A[0], y0, z1], [A[0], y0, z0], [A[0], y1, z0], [A[0], y1, z1], gc, { noShade: true, shade: 1.3 });
  };

  switch (kind) {
    // 条案 / 香案
    case 'altar': {
      const topT = 0.08;
      polyBox(-W / 2, Hh - topT, -D / 2, W / 2, Hh, D / 2, woodC, { skip: ['yn'] });
      polyBox(-W / 2, Hh - topT - 0.06, -D / 2 + 0.04, W / 2, Hh - topT, D / 2 - 0.04, darkC);
      // 两端板足 + 翘头
      for (const s of [-1, 1]) {
        polyBox(s * W / 2 - 0.1, 0, -D / 2 + 0.05, s * W / 2 + 0.1, Hh - topT, D / 2 - 0.05, darkC);
        polyBox(s * W / 2 - 0.14, Hh, -D / 2 - 0.03, s * W / 2 + 0.14, Hh + 0.08, D / 2 + 0.03, woodC);
      }
      // 前后横枨
      polyBox(-W / 2 + 0.15, 0.16, -D / 2 + 0.06, W / 2 - 0.15, 0.22, -D / 2 + 0.12, darkC);
      polyBox(-W / 2 + 0.15, 0.16, D / 2 - 0.12, W / 2 - 0.15, 0.22, D / 2 - 0.06, darkC);
      // 烛台 + 暖光（室内可观赏性，低成本）
      for (const s of [-1, 1]) {
        polyBox(s * W * 0.3 - 0.035, Hh, -0.05, s * W * 0.3 + 0.035, Hh + 0.3, 0.05, C.goldDark);
        polyBox(s * W * 0.3 - 0.028, Hh + 0.3, -0.028, s * W * 0.3 + 0.028, Hh + 0.44, 0.028, C.candle ?? C.paper);
        glowCross(s * W * 0.3, Hh + 0.5, 0, 0.13);
      }
      break;
    }
    // 琴桌 / 条桌 / 方桌 / 书案
    case 'table':
    case 'squareTable':
    case 'desk': {
      const topT = kind === 'desk' ? 0.09 : 0.07;
      polyBox(-W / 2, Hh - topT, -D / 2, W / 2, Hh, D / 2, woodC, { skip: ['yn'] });
      polyBox(-W / 2, Hh - topT - 0.05, -D / 2 + (kind === 'desk' ? 0.02 : 0.04), W / 2, Hh - topT, D / 2 - 0.04, darkC);
      // 桌腿
      if (kind === 'desk') {
        for (const sx of [-1, 1]) {
          polyBox(sx * W / 2 - 0.12, 0, -D / 2 + 0.04, sx * W / 2 - 0.02, Hh - topT, D / 2 - 0.04, darkC);
        }
        // 抽屉/挡板
        polyBox(-W / 2 + 0.14, Hh - topT - 0.3, -D / 2 + 0.04, W / 2 - 0.14, Hh - topT - 0.05, -D / 2 + 0.1, woodC);
        polyBox(-W / 2 + 0.14, Hh - topT - 0.3, D / 2 - 0.1, W / 2 - 0.14, Hh - topT - 0.05, D / 2 - 0.04, woodC);
        for (const s of [-1, 1]) polyBox(s * 0.12 - 0.05, Hh - topT - 0.26, -D / 2 + 0.06, s * 0.12 + 0.05, Hh - topT - 0.08, -D / 2 + 0.12, goldC);
      } else {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          polyBox(sx * W / 2 - 0.14, 0, sz * D / 2 - 0.14, sx * W / 2 - 0.04, Hh - topT, sz * D / 2 - 0.04, darkC);
        }
        // 牙板
        polyBox(-W / 2 + 0.12, Hh - topT - 0.12, -D / 2 + 0.02, W / 2 - 0.12, Hh - topT, -D / 2 + 0.06, woodC);
        polyBox(-W / 2 + 0.12, Hh - topT - 0.12, D / 2 - 0.06, W / 2 - 0.12, Hh - topT, D / 2 - 0.02, woodC);
      }
      if (kind === 'squareTable' && q.carve) {
        // 桌面石心
        polyBox(-W / 2 + 0.1, Hh - topT + 0.01, -D / 2 + 0.1, W / 2 - 0.1, Hh + 0.02, D / 2 - 0.1, marbleC, { skip: ['yn'] });
      } else if (kind !== 'squareTable') {
        // 书案/条桌：烛台暖光
        polyBox(W * 0.22 - 0.03, Hh, -0.04, W * 0.22 + 0.03, Hh + 0.26, 0.04, C.goldDark);
        polyBox(W * 0.22 - 0.024, Hh + 0.26, -0.024, W * 0.22 + 0.024, Hh + 0.4, 0.024, C.candle ?? C.paper);
        glowCross(W * 0.22, Hh + 0.46, 0, 0.12);
      }
      break;
    }
    // 太师椅 / 圈椅
    case 'chair': {
      const seatH = spec.seatH ?? 0.46;
      polyBox(-W / 2, seatH - 0.06, -D / 2, W / 2, seatH, D / 2, woodC, { skip: ['yn'] });
      // 四腿
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        polyBox(sx * W / 2 - 0.1, 0, sz * D / 2 - 0.1, sx * W / 2 - 0.02, seatH - 0.06, sz * D / 2 - 0.02, darkC);
      }
      // 靠背（两立柱 + 背板）
      polyBox(-W / 2 + 0.02, seatH, -D / 2, -W / 2 + 0.1, Hh, -D / 2 + 0.08, darkC);
      polyBox(W / 2 - 0.1, seatH, -D / 2, W / 2 - 0.02, Hh, -D / 2 + 0.08, darkC);
      polyBox(-W / 2 + 0.12, seatH + 0.24, -D / 2 + 0.02, W / 2 - 0.12, Hh - 0.08, -D / 2 + 0.07, woodC);
      if (q.carve) polyBox(-W / 2 + 0.2, seatH + 0.34, -D / 2 + 0.01, W / 2 - 0.2, Hh - 0.2, -D / 2 + 0.03, goldC);
      // 扶手
      for (const sx of [-1, 1]) {
        polyBox(sx * W / 2 - 0.1, seatH + 0.24, -D / 2 + 0.06, sx * W / 2 - 0.04, seatH + 0.3, D / 2 - 0.06, woodC);
        // 联帮棍
        polyBox(sx * W / 2 - 0.08, seatH, D / 2 - 0.14, sx * W / 2 - 0.05, seatH + 0.26, D / 2 - 0.1, darkC);
      }
      // 座垫
      polyBox(-W / 2 + 0.08, seatH, -D / 2 + 0.06, W / 2 - 0.08, seatH + 0.05, D / 2 - 0.06, C.cushion ?? C.red);
      break;
    }
    // 架子床
    case 'bed': {
      const baseH = 0.45;
      polyBox(-W / 2, 0, -D / 2, W / 2, baseH, D / 2, woodC);
      polyBox(-W / 2 - 0.06, baseH - 0.04, -D / 2 - 0.06, W / 2 + 0.06, baseH + 0.02, D / 2 + 0.06, darkC, { skip: ['yn'] });
      // 床垫/被褥
      polyBox(-W / 2 + 0.1, baseH + 0.02, -D / 2 + 0.1, W / 2 - 0.1, baseH + 0.22, D / 2 - 0.1, C.curtain ?? C.silkPink, { skip: ['yn'] });
      // 四柱 + 顶架
      const postT = 0.09;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        polyBox(sx * W / 2 - postT, baseH, sz * D / 2 - postT, sx * W / 2, Hh, sz * D / 2, darkC);
      }
      polyBox(-W / 2 - 0.04, Hh - 0.1, -D / 2 - 0.04, W / 2 + 0.04, Hh, D / 2 + 0.04, woodC);
      polyBox(-W / 2 - 0.1, Hh, -D / 2 - 0.1, W / 2 + 0.1, Hh + 0.08, D / 2 + 0.1, darkC);
      // 挂落/床额
      polyBox(-W / 2, Hh - 0.35, -D / 2 - 0.05, W / 2, Hh - 0.1, -D / 2 - 0.01, woodC);
      // 帷幔（三面薄片，波浪省略）
      polyBox(-W / 2 - 0.03, baseH + 0.5, -D / 2 - 0.03, -W / 2 - 0.01, Hh - 0.12, D / 2 - 0.2, C.silkPink ?? C.curtain);
      polyBox(W / 2 - 0.01, baseH + 0.5, -D / 2 - 0.03, W / 2 + 0.03, Hh - 0.12, D / 2 - 0.2, C.silkPink ?? C.curtain);
      polyBox(-W / 2, baseH + 0.5, -D / 2 - 0.05, W / 2, Hh - 0.12, -D / 2 - 0.01, C.silkPink ?? C.curtain);
      break;
    }
    // 书架 / 多宝格
    case 'bookshelf': {
      const d = 0.14;
      polyBox(-W / 2, 0, -D / 2, -W / 2 + d, Hh, D / 2, darkC);
      polyBox(W / 2 - d, 0, -D / 2, W / 2, Hh, D / 2, darkC);
      polyBox(-W / 2, 0, -D / 2, W / 2, Hh, -D / 2 + d, woodC);
      polyBox(-W / 2, Hh - 0.1, -D / 2, W / 2, Hh, D / 2, woodC);
      const shelves = 4;
      for (let i = 1; i < shelves; i++) {
        const yy = (Hh * i) / shelves;
        polyBox(-W / 2 + d, yy - 0.04, -D / 2 + d, W / 2 - d, yy, D / 2, woodC);
        // 书/器
        if (q.carve) {
          const nBook = 3;
          for (let k = 0; k < nBook; k++) {
            const bx = -W / 2 + d + 0.08 + k * ((W - 2 * d - 0.1) / nBook);
            polyBox(bx, yy, -D / 2 + d + 0.02, bx + 0.1, yy + 0.2 + 0.03 * (k % 3), -D / 2 + d + 0.1, k % 3 === 0 ? C.ink : k % 3 === 1 ? C.paper : C.redDark);
          }
        }
      }
      break;
    }
    // 屏风（3 扇，中扇正、两侧微折；两面均裱画）
    case 'screen': {
      const panels = spec.panels ?? 3;
      const pw = W / panels;
      const foldA = spec.fold ?? 0.22;
      for (let i = 0; i < panels; i++) {
        const pcx = -W / 2 + (i + 0.5) * pw;
        const ang = (i === 0 ? foldA : i === panels - 1 ? -foldA : 0);
        const ca = Math.cos(ang), sa = Math.sin(ang);
        // 面板局部坐标（以该扇中心为原点）
        const Q = (x, y, z) => P(pcx + x * ca + z * sa, y, -x * sa + z * ca);
        const th2 = 0.09;   // 面板厚
        const hw = pw / 2 - 0.02;
        // 画框：外框四条 + 背板
        const frameW = 0.055;
        const qb = (x0, y0, z0, x1, y1, z1, c) => {
          const v = (x, y, z) => Q(x, y, z);
          const A = v(x0, y0, z1), B = v(x1, y0, z1), Cc = v(x1, y1, z1), D = v(x0, y1, z1);
          const E = v(x1, y0, z0), F2 = v(x0, y0, z0), G = v(x0, y1, z0), H2 = v(x1, y1, z0);
          g.quad(A, B, Cc, D, c); g.quad(E, F2, G, H2, c);
          g.quad(B, E, H2, Cc, c); g.quad(F2, A, D, G, c);
          g.quad(D, Cc, H2, G, c); g.quad(F2, E, B, A, c);
        };
        // 外框（浅色木 + 金线；屏风整体提亮）
        qb(-hw, 0.12, -th2 / 2, hw, 0.12 + frameW, th2 / 2, C.woodLight);
        qb(-hw, Hh - frameW, -th2 / 2, hw, Hh, th2 / 2, C.woodLight);
        qb(-hw, 0.12, -th2 / 2, -hw + frameW, Hh, th2 / 2, C.woodLight);
        qb(hw - frameW, 0.12, -th2 / 2, hw, Hh, th2 / 2, C.woodLight);
        // 金色内缘
        qb(-hw + frameW - 0.02, 0.12 + frameW - 0.02, -th2 / 2 - 0.002, hw - frameW + 0.02, 0.12 + frameW, th2 / 2 + 0.002, C.goldDark);
        qb(-hw + frameW - 0.02, Hh - frameW, -th2 / 2 - 0.002, hw - frameW + 0.02, Hh - frameW + 0.02, th2 / 2 + 0.002, C.goldDark);
        // 背板：亮纸色（保证室内即使无贴图也是浅色画心；两面）
        qb(-hw + frameW, 0.12 + frameW, -th2 / 2 + 0.004, hw - frameW, Hh - frameW, -th2 / 2 + 0.014, C.paper);
        qb(-hw + frameW, 0.12 + frameW, th2 / 2 - 0.014, hw - frameW, Hh - frameW, th2 / 2 - 0.004, C.paper);
        // 画面（贴图批 / 素纸）——两面
        const ix0 = -hw + frameW + 0.02, ix1 = hw - frameW - 0.02;
        const iy0 = 0.12 + frameW + 0.02, iy1 = Hh - frameW - 0.02;
        const cell = tex && tex.cellUV ? (i % 4) : 0;
        const drawFace = (zf, rev) => {
          const A = Q(ix0, iy0, zf), B = Q(ix1, iy0, zf), Cc = Q(ix1, iy1, zf), D = Q(ix0, iy1, zf);
          if (tex) {
            const uv = tex.cellUV(cell);
            if (rev) tex.quadUV(D, Cc, B, A, 0xffffff, uv);
            else tex.quadUV(A, B, Cc, D, 0xffffff, uv);
          } else {
            if (rev) g.quad(D, Cc, B, A, C.paper);
            else g.quad(A, B, Cc, D, C.paper);
          }
        };
        drawFace(-th2 / 2 - 0.006, false);
        drawFace(th2 / 2 + 0.006, true);
        // 底座（须弥座式小座）
        qb(-hw - 0.03, 0, -th2 / 2 - 0.02, hw + 0.03, 0.12, th2 / 2 + 0.02, darkC);
      }
      break;
    }
    // 柜格（万历柜）
    case 'cabinet': {
      polyBox(-W / 2, 0, -D / 2, W / 2, Hh * 0.55, D / 2, woodC);
      polyBox(-W / 2, Hh * 0.55, -D / 2, W / 2, Hh, D / 2, darkC);
      for (const s of [-1, 1]) {
        polyBox(s * 0.12 - 0.14, Hh * 0.62, -D / 2 - 0.01, s * 0.12 + 0.14, Hh - 0.08, -D / 2 + 0.02, goldC);
      }
      break;
    }
    // 地毯
    case 'rug': {
      polyBox(-W / 2, 0, -D / 2, W / 2, Hh, D / 2, spec.color ?? C.redDark, { skip: ['yn'] });
      polyBox(-W / 2 + 0.12, Hh, -D / 2 + 0.12, W / 2 - 0.12, Hh + 0.004, D / 2 - 0.12, spec.outer ?? C.goldDark, { skip: ['yn'] });
      polyBox(-W / 2 + 0.3, Hh + 0.004, -D / 2 + 0.3, W / 2 - 0.3, Hh + 0.008, D / 2 - 0.3, spec.inner ?? C.redDark, { skip: ['yn'] });
      break;
    }
    // 字画 / 挂屏 / 楹联贴片
    case 'painting':
    case 'scroll': {
      const pw = spec.w ?? 0.9, ph = spec.h ?? 1.6;
      const cell = spec.cell ?? 0;
      if (tex) {
        const a = P(-pw / 2, 0.16, 0), b = P(pw / 2, 0.16, 0);
        const c = P(pw / 2, 0.16 + ph, 0), d = P(-pw / 2, 0.16 + ph, 0);
        tex.quadUV(a, b, c, d, 0xffffff, tex.cellUV(cell % 4));
      } else {
        g.quad(P(-pw / 2, 0.16, 0), P(pw / 2, 0.16, 0), P(pw / 2, 0.16 + ph, 0), P(-pw / 2, 0.16 + ph, 0), C.paper);
      }
      // 画卷轴
      polyBox(-pw / 2 - 0.04, 0.1, -0.02, pw / 2 + 0.04, 0.14, 0.02, goldC);
      polyBox(-pw / 2 - 0.04, 0.14 + ph, -0.02, pw / 2 + 0.04, 0.18 + ph, 0.02, goldC);
      break;
    }
    // 花瓶（瓷/铜）
    case 'vase': {
      const r = spec.r ?? 0.16;
      const hh = spec.h ?? 0.55;
      const c = spec.color ?? C.paper;
      g.lathe(P(0, 0, 0)[0], P(0, 0, 0)[2], P(0, 0, 0)[1], [
        [0, r * 0.55], [0.04, r * 0.62], [0.16, r * 1.0], [0.3, r * 1.05], [0.44, r * 0.6], [hh - 0.04, r * 0.5], [hh, r * 0.62],
      ], q.smallSeg, c, {});
      if (q.carve) g.lathe(P(0, 0, 0)[0], P(0, 0, 0)[2], P(0, 0, 0)[1] + hh * 0.3, [[0, r * 1.06], [0.03, r * 1.06]], q.smallSeg, C.stoneBlue ?? C.windowGreen);
      break;
    }
    // 香炉
    case 'incense': {
      const r = spec.r ?? 0.22;
      const legs = 3;
      for (let i = 0; i < legs; i++) {
        const ang = (i / legs) * PI_ * 2;
        g.beam(P(Math.cos(ang) * r * 0.5, 0, Math.sin(ang) * r * 0.5), P(Math.cos(ang) * r * 0.55, 0.14, Math.sin(ang) * r * 0.55), 0.06, 0.06, C.bronzeDark);
      }
      g.lathe(P(0, 0, 0)[0], P(0, 0, 0)[2], P(0, 0, 0)[1] + 0.12, [[0, r * 0.55], [0.06, r], [0.24, r * 0.92], [0.3, r * 0.62], [0.34, r * 0.8]], q.smallSeg, spec.color ?? C.bronze);
      // 双耳
      for (const s of [-1, 1]) {
        polyBox(s * r * 0.85 - 0.04, 0.3, -0.04, s * r * 0.85 + 0.04, 0.42, 0.04, C.bronzeDark);
      }
      // 盖钮
      g.ball(P(0, 0, 0)[0], P(0, 0, 0)[1] + 0.48, P(0, 0, 0)[2], r * 0.2, q.smallSeg, 3, C.bronzeDark);
      break;
    }
    // 盆栽
    case 'pottedPlant': {
      const pr = spec.r ?? 0.24, ph = spec.h ?? 0.9;
      g.lathe(P(0, 0, 0)[0], P(0, 0, 0)[2], P(0, 0, 0)[1], [[0, pr * 0.7], [0.05, pr * 0.85], [0.3, pr], [0.34, pr * 0.92]], q.smallSeg, spec.color ?? C.stoneWarm);
      // 茎
      g.beam(P(0, 0.32, 0), P(0, 0.32 + ph * 0.5, 0), 0.05, 0.05, C.woodDark);
      // 叶（8 片三角）
      const nLeaf = 8;
      for (let i = 0; i < nLeaf; i++) {
        const ang = (i / nLeaf) * PI_ * 2 + 0.3;
        const y0 = 0.4 + (i % 4) * 0.1;
        const len = 0.28 + (i % 3) * 0.06;
        const a = P(0, y0, 0);
        const b = P(Math.cos(ang) * len, y0 + 0.12, Math.sin(ang) * len);
        const c = P(Math.cos(ang + 0.5) * len * 0.7, y0 + 0.26, Math.sin(ang + 0.5) * len * 0.7);
        g.tri(a, b, c, spec.leaf ?? C.leaf, { shade: SHADE.yp });
      }
      break;
    }
    // 琴（古琴）
    case 'qin': {
      polyBox(-W / 2, 0.6, -0.14, W / 2, 0.7, 0.14, spec.color ?? C.ink);
      polyBox(-W / 2 + 0.06, 0.7, -0.11, W / 2 - 0.06, 0.72, 0.11, C.woodDark);
      // 岳山/龙龈
      polyBox(W / 2 - 0.12, 0.72, -0.1, W / 2 - 0.06, 0.78, 0.1, C.wood);
      polyBox(-W / 2 + 0.06, 0.72, -0.1, -W / 2 + 0.12, 0.76, 0.1, C.wood);
      // 七弦（3 条可见）
      for (let i = 0; i < 3; i++) {
        const z = -0.08 + i * 0.08;
        g.beam(P(-W / 2 + 0.1, 0.76, z), P(W / 2 - 0.1, 0.76, z), 0.012, 0.012, C.paper);
      }
      // 琴桌（矮）
      polyBox(-W / 2, 0, -0.22, W / 2, 0.6, 0.22, spec.tableColor ?? C.woodDark);
      break;
    }
    // 茶具
    case 'teaset': {
      polyBox(-0.42, 0, -0.28, 0.42, 0.05, 0.28, C.woodDark);
      // 茶壶
      g.lathe(P(-0.1, 0, 0)[0], P(-0.1, 0, 0)[2], 0.05, [[0, 0.06], [0.05, 0.11], [0.13, 0.1], [0.16, 0.05]], q.smallSeg, spec.color ?? C.paper);
      polyBox(-0.16, 0.2, -0.02, -0.04, 0.22, 0.02, spec.color ?? C.paper);
      // 三杯
      for (let i = 0; i < 3; i++) {
        const cx2 = 0.08 + i * 0.12;
        g.cyl(P(cx2, 0, 0.06)[0], P(cx2, 0, 0.06)[2], 0.05, 0.11, 0.035, 0.028, q.smallSeg, C.paper, { openTop: true });
      }
      break;
    }
    // 灯台 / 烛台
    case 'lamp': {
      g.lathe(P(0, 0, 0)[0], P(0, 0, 0)[2], P(0, 0, 0)[1], [[0, 0.16], [0.03, 0.18], [0.08, 0.05], [0.5, 0.04], [0.55, 0.09]], q.smallSeg, C.goldDark);
      g.cyl(P(0, 0, 0)[0], P(0, 0, 0)[2], P(0, 0, 0)[1] + 0.55, P(0, 0, 0)[1] + 0.72, 0.04, 0.03, q.smallSeg, C.candle ?? C.paper);
      g.ball(P(0, 0, 0)[0], P(0, 0, 0)[1] + 0.78, P(0, 0, 0)[2], 0.035, q.smallSeg, 3, C.lampWarm ?? C.gold);
      glowCross(0, 0.86, 0, 0.16);
      break;
    }
    // 帷幔（悬挂薄布，wave 占位）
    case 'curtain': {
      const pw = spec.w ?? 1.6, ph = spec.h ?? 2.0;
      const segs = q.carve ? 6 : 3;
      const c = spec.color ?? C.silkPink ?? C.curtain;
      for (let i = 0; i < segs; i++) {
        const x0 = -pw / 2 + (pw * i) / segs, x1 = -pw / 2 + (pw * (i + 1)) / segs;
        const z0 = (i % 2) * 0.05;
        polyBox(x0, 0, z0 - 0.012, x1, ph, z0 + 0.012, c, { skip: ['yn', 'yp'] });
      }
      // 幔杆
      polyBox(-pw / 2 - 0.08, ph, -0.04, pw / 2 + 0.08, ph + 0.06, 0.04, C.woodDark);
      break;
    }
    // 室内挂灯（暖光；helpers 的 H.hall / H.furnish 会推 kind:'lantern'）
    case 'lantern': {
      const r = Math.max(0.18, Math.min(0.55, (spec.w ?? 0.5) * 0.5));
      const o = P(0, 0, 0);
      // 吊绳 + 顶盖
      polyBox(-0.018, 0.2, -0.018, 0.018, 0.95, 0.018, C.woodDark);
      polyBox(-r * 0.5, 0.16, -r * 0.5, r * 0.5, 0.25, r * 0.5, C.goldDark);
      // 灯身（鼓形）
      g.lathe(o[0], o[2], o[1] + 0.16, [
        [0, r * 0.55], [-0.05, r * 0.85], [-0.16, r], [-0.3, r * 0.92], [-0.42, r * 0.55], [-0.46, r * 0.35],
      ], q.smallSeg, C.lampRed);
      // 上下金箍
      g.cyl(o[0], o[2], o[1] + 0.1, o[1] + 0.13, r * 0.9, r * 0.75, q.smallSeg, C.gold, { openTop: true });
      g.cyl(o[0], o[2], o[1] - 0.44, o[1] - 0.4, r * 0.55, r * 0.7, q.smallSeg, C.goldDark, { openTop: true });
      // 宝珠 + 流苏
      g.ball(o[0], o[1] - 0.47, o[2], r * 0.16, q.smallSeg, 2, C.gold);
      polyBox(-0.015, -0.62, -0.015, 0.015, -0.5, 0.015, C.redDark);
      // 暖光十字面片（自发光观感：高亮色 + 不烘焙阴影）
      const gr = r * 1.15, gy0 = o[1] - 0.4, gy1 = o[1] + 0.18;
      const glowC = C.lampWarm ?? C.candle ?? C.paper;
      g.quad([o[0] - gr, gy0, o[2]], [o[0] + gr, gy0, o[2]], [o[0] + gr, gy1, o[2]], [o[0] - gr, gy1, o[2]], glowC, { noShade: true, shade: 1.25 });
      g.quad([o[0] + gr, gy0, o[2]], [o[0] - gr, gy0, o[2]], [o[0] - gr, gy1, o[2]], [o[0] + gr, gy1, o[2]], glowC, { noShade: true, shade: 1.25 });
      g.quad([o[0], gy0, o[2] - gr], [o[0], gy0, o[2] + gr], [o[0], gy1, o[2] + gr], [o[0], gy1, o[2] - gr], glowC, { noShade: true, shade: 1.25 });
      g.quad([o[0], gy0, o[2] + gr], [o[0], gy0, o[2] - gr], [o[0], gy1, o[2] - gr], [o[0], gy1, o[2] + gr], glowC, { noShade: true, shade: 1.25 });
      break;
    }
    // 圆凳 / 方凳
    case 'stool': {
      const r = Math.max(0.16, Math.min(0.45, (spec.w ?? 0.42) / 2));
      const seatH = spec.seatH ?? 0.42;
      polyBox(-r, seatH - 0.06, -r, r, seatH, r, woodC, { skip: ['yn'] });
      g.cyl(P(0, 0, 0)[0], P(0, 0, 0)[2], P(0, 0, 0)[1] + seatH - 0.1, P(0, 0, 0)[1] + seatH - 0.06, r * 0.95, r * 0.8, q.smallSeg, darkC, { openTop: true });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        polyBox(sx * r - 0.05, 0, sz * r - 0.05, sx * r, seatH - 0.06, sz * r, darkC);
      }
      polyBox(-r + 0.05, 0.12, -0.02, r - 0.05, 0.17, 0.02, darkC);
      break;
    }
    default: {
      // 未知类型：占位矮几
      polyBox(-0.4, 0, -0.3, 0.4, 0.5, 0.3, woodC);
      break;
    }
  }
}

export function makeFurniture(spec) {
  const s = spec || {};
  const g = new GeoBuilder(false);
  const tg = new GeoBuilder(true);
  const info = atlasPaintings(QUAL.high.texSize);
  const patch = info
    ? {
      quadUV: (a, b, c, d, color, uv) => tg.quadUV(a, b, c, d, 0xffffff, uv),
      cellUV: (cell) => info.cellUV(cell),
    }
    : null;
  const P = mkXf({ ...s, center: true }, 0);
  emitFurniture(g, patch, s, P, QUAL.high);
  const out = [g.mesh(matSolid())];
  if (tg.tris > 0) out.push(tg.mesh(matAtlasA()));
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// 七、灯笼 / 匾额 / 帷幔贴片
// ═══════════════════════════════════════════════════════════════════════════
function lanternGeometry(style, q) {
  const g = new GeoBuilder(false);
  const seg = Math.max(6, q.smallSeg);
  const body = style === 'red' ? C.lampRed : style === 'warm' ? C.lampWarm : C.paper;
  const glow = style === 'red' ? C.lamp : style === 'warm' ? C.candle : C.paper;
  const trim = style === 'paper' ? C.woodDark : C.gold;
  const trimD = style === 'paper' ? C.wood : C.goldDark;
  // 单位：顶部吊点在 y=0，向下悬挂；半径≈0.45
  // 吊环 + 顶盖
  g.boxC(0, 0.02, 0, 0.08, 0.06, 0.08, trimD);
  g.cyl(0, 0, -0.08, 0.0, 0.34, 0.1, seg, trim);
  g.cyl(0, 0, -0.1, -0.07, 0.36, 0.3, seg, trimD, { openTop: true });
  // 六/八棱灯身（鼓形）
  g.lathe(0, 0, 0, [
    [-0.5, 0.22], [-0.44, 0.34], [-0.3, 0.42], [-0.14, 0.4], [-0.08, 0.3],
  ], seg, body);
  // 内芯（夜色自发光感的亮色带，用亮色片代替：四向小窗）
  const faint = shadeColor(rgbOf(glow), 1.0);
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * PI_ * 2 + PI_ / 8;
    const r = 0.425;
    const cx1 = Math.cos(ang) * r, cz1 = Math.sin(ang) * r;
    const tnx = -Math.sin(ang), tnz = Math.cos(ang);
    const half = 0.09;
    const y0 = -0.34, y1 = -0.18;
    const a = [cx1 - tnx * half, y0, cz1 - tnz * half];
    const b = [cx1 + tnx * half, y0, cz1 + tnz * half];
    const c = [cx1 + tnx * half, y1, cz1 + tnz * half];
    const d = [cx1 - tnx * half, y1, cz1 - tnz * half];
    g.quad(a, b, c, d, faint, { noShade: true });
  }
  // 竖棱骨架（4 条，薄片双面）
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * PI_ * 2;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const segsY = [[-0.09, 0.3], [-0.18, 0.41], [-0.34, 0.42], [-0.44, 0.34], [-0.5, 0.22]];
    for (let k = 0; k < segsY.length - 1; k++) {
      const [ya, ra] = segsY[k], [yb, rb] = segsY[k + 1];
      const w = 0.02;
      const p0 = [(ca * ra), ya, sa * ra];
      const p1 = [(ca * rb), yb, sa * rb];
      const tx = -sa * w, tz = ca * w;
      g.quad([p0[0] - tx, p0[1], p0[2] - tz], [p0[0] + tx, p0[1], p0[2] + tz], [p1[0] + tx, p1[1], p1[2] + tz], [p1[0] - tx, p1[1], p1[2] - tz], trim);
    }
  }
  // 底箍 + 底盖
  g.cyl(0, 0, -0.53, -0.5, 0.24, 0.2, seg, trimD, { openTop: true });
  g.boxC(0, -0.55, 0, 0.16, 0.05, 0.16, trim);
  // 宝珠 + 流苏（红/金）
  g.ball(0, -0.58, 0, 0.05, q.smallSeg, 2, trim);
  const tasselC = style === 'red' ? C.redDark : trimD;
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * PI_ * 2;
    g.beam([Math.cos(ang) * 0.03, -0.6, Math.sin(ang) * 0.03], [Math.cos(ang) * 0.07, -0.76, Math.sin(ang) * 0.07], 0.02, 0.02, tasselC);
  }
  return g.buildGeometry();
}

const _lanternCache = new Map();
function lanternUnitGeom(style, q) {
  const key = `lantern_${style}_${q.smallSeg}`;
  let ge = _lanternCache.get(key);
  if (!ge) { ge = lanternGeometry(style, q); _lanternCache.set(key, ge); }
  return ge;
}

export function makeLantern(spec) {
  const s = spec || {};
  const q = QUAL.high;
  const style = s.style || 'red';
  const group = new THREE.Group();
  group.position.set((s.x ?? 0) + 0.5, s.y ?? 0, (s.z ?? 0) + 0.5);
  const r = s.r ?? 0.35;
  const hang = s.hang ?? 0.6;
  const body = new THREE.Mesh(lanternUnitGeom(style, q), matSolid());
  body.scale.set(r * 2, r * 2, r * 2);
  body.position.y = -hang;
  group.add(body);
  // 吊索
  const ropeG = new GeoBuilder(false);
  ropeG.box(-0.02, 0, -0.02, 0.02, hang, 0.02, C.woodDark);
  const rope = ropeG.mesh(matSolid());
  group.add(rope);
  group.userData = { kind: 'lantern', body, phase: s.phase ?? ((s.x ?? 0) * 0.7 + (s.z ?? 0) * 0.3), amp: s.amp ?? 0.08 };
  return group;
}

/** 纯函数：匾额/酒旗类贴片（素面旗帜 + 上下卷轴；文字由 buildDetails 的题字贴图批负责） */
export function makeBanner(spec) {
  const s = spec || {};
  const g = new GeoBuilder(false);
  const w = s.w ?? 0.6, h = s.h ?? 2.0;
  const P = mkXf(s, 0);
  // 素面旗/幡
  const a = P(-w / 2, 0, 0), b = P(w / 2, 0, 0), c = P(w / 2, h, 0), d = P(-w / 2, h, 0);
  g.quad(a, b, c, d, C.ink);
  // 上下卷轴（金）
  const top = P(0, h + 0.02, 0), bot = P(0, 0.02, 0);
  g.box(top[0] - w / 2 - 0.05, top[1] - 0.03, top[2] - 0.04, top[0] + w / 2 + 0.05, top[1] + 0.06, top[2] + 0.04, C.gold);
  g.box(bot[0] - w / 2 - 0.03, bot[1] - 0.05, bot[2] - 0.04, bot[0] + w / 2 + 0.03, bot[1] + 0.02, bot[2] + 0.04, C.goldDark);
  return g.mesh(matSolid());
}

// ═══════════════════════════════════════════════════════════════════════════
// 八、贴图材质（字画 / 题字）：内联 CanvasTexture，无外部资源
// ═══════════════════════════════════════════════════════════════════════════
const INK = '#2b2b2b', INK2 = '#4a4640', PAPER = '#efe9da', PAPER2 = '#e6ddc8';

function canvas2d(w, h) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return cv;
}

let _texA = null, _matA = null;
/** 字画图集：2×2 四格（山水/墨竹/书法/花鸟），返回 {tex, cellUV} */
function atlasPaintings(size) {
  if (_texA) return _texA;
  const W = size * 2, Hh = size * 2;
  const cv = canvas2d(W, Hh);
  if (!cv) return null;
  const ctx = cv.getContext('2d');
  const cells = 4;
  const cw = size, ch = Hh / 2;
  const drawCell = (i, fn) => {
    const ox = (i % 2) * cw, oy = Math.floor(i / 2) * ch;
    ctx.save(); ctx.translate(ox, oy); ctx.beginPath(); ctx.rect(0, 0, cw, ch); ctx.clip();
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, cw, ch);
    // 裱边
    ctx.strokeStyle = '#5a5140'; ctx.lineWidth = Math.max(3, cw * 0.02); ctx.strokeRect(cw * 0.02, ch * 0.02, cw * 0.96, ch * 0.96);
    fn(cw, ch);
    ctx.restore();
  };
  // 0 山水
  drawCell(0, (w, h) => {
    ctx.fillStyle = '#cfc9b8'; ctx.fillRect(w * 0.1, h * 0.62, w * 0.8, h * 0.3);
    ctx.fillStyle = INK2;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.moveTo(w * (0.12 + k * 0.22), h * 0.72);
      ctx.lineTo(w * (0.26 + k * 0.22), h * (0.36 + k * 0.06));
      ctx.lineTo(w * (0.4 + k * 0.22), h * 0.72);
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(2, w * 0.012);
    ctx.beginPath(); ctx.moveTo(w * 0.08, h * 0.66); ctx.bezierCurveTo(w * 0.3, h * 0.6, w * 0.6, h * 0.7, w * 0.94, h * 0.62); ctx.stroke();
    ctx.fillStyle = INK; ctx.globalAlpha = 0.75;
    ctx.beginPath(); ctx.arc(w * 0.78, h * 0.2, w * 0.045, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  });
  // 1 墨竹
  drawCell(1, (w, h) => {
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(3, w * 0.014);
    for (let s = 0; s < 3; s++) {
      const x0 = w * (0.25 + s * 0.22);
      ctx.beginPath(); ctx.moveTo(x0, h * 0.9); ctx.lineTo(w * (0.3 + s * 0.22), h * 0.12); ctx.stroke();
      ctx.fillStyle = INK2;
      for (let k = 0; k < 5; k++) {
        const yy = h * (0.2 + k * 0.13);
        const dir = (k % 2) ? 1 : -1;
        ctx.beginPath();
        ctx.ellipse(x0 + dir * w * 0.07, yy, w * 0.08, h * 0.015, dir * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = '#7a4038'; ctx.fillRect(w * 0.85, h * 0.3, w * 0.05, h * 0.06);
  });
  // 2 书法
  drawCell(2, (w, h) => {
    const chars = ['春', '雨', '潤', '石', '竹', '風', '清'];
    ctx.fillStyle = INK;
    ctx.font = `${Math.floor(h * 0.11)}px KaiTi, STKaiti, serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < 7; i++) {
      ctx.fillText(chars[i], w * (0.72 - Math.floor(i / 3) * 0.16), h * (0.14 + (i % 3) * 0.13 + 0.02));
    }
    ctx.fillStyle = '#9b3a32'; ctx.fillRect(w * 0.2, h * 0.12, w * 0.07, h * 0.07);
  });
  // 3 花鸟
  drawCell(3, (w, h) => {
    ctx.strokeStyle = INK2; ctx.lineWidth = Math.max(2, w * 0.01);
    ctx.beginPath(); ctx.moveTo(w * 0.16, h * 0.85); ctx.bezierCurveTo(w * 0.3, h * 0.6, w * 0.44, h * 0.5, w * 0.62, h * 0.24); ctx.stroke();
    ctx.fillStyle = '#c96a80';
    for (let i = 0; i < 7; i++) {
      const px = w * (0.3 + (i * 0.09) % 0.36), py = h * (0.28 + ((i * 0.13) % 0.4));
      ctx.beginPath(); ctx.arc(px, py, w * 0.035, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.ellipse(w * 0.68, h * 0.3, w * 0.05, h * 0.018, -0.5, 0, Math.PI * 2); ctx.fill();
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _texA = { tex, cellUV: (i) => {
    const col = i % 2, row = Math.floor(i / 2) % 2;
    const s = 0.02;
    return [col / 2 + s, 0.5 + row / 2 + s * 0.5, col / 2 + 0.5 - s, row / 2 + s * 0.5];
  } };
  return _texA;
}

let _texB = null, _texBCtx = null, _texBNext = 0;
const TEXB_W = 512, TEXB_H = 2048, TEXB_CELLS = 8;
/** 题字图集（竖排文字）：每种题字占一格，最多 8 种 */
function atlasText(text) {
  if (typeof document === 'undefined') return null;
  if (!_texB) {
    const cv = canvas2d(TEXB_W, TEXB_H);
    if (!cv) return null;
    _texBCtx = cv.getContext('2d');
    _texBCtx.fillStyle = PAPER; _texBCtx.fillRect(0, 0, TEXB_W, TEXB_H);
    _texB = { cv, tex: new THREE.CanvasTexture(cv), idx: new Map() };
    _texB.tex.colorSpace = THREE.SRGBColorSpace;
    _texB.tex.anisotropy = 4;
  }
  if (!text) return null;
  let slot = _texB.idx.get(text);
  if (slot == null) {
    if (_texBNext >= TEXB_CELLS) return { slot: 0, uv: [0, 0, 1, 1 / TEXB_CELLS], idx: 0 };
    slot = _texBNext++;
    _texB.idx.set(text, slot);
    const ctx = _texBCtx;
    const cw = TEXB_W, ch = TEXB_H / TEXB_CELLS;
    const oy = slot * ch;
    ctx.save(); ctx.translate(0, oy);
    ctx.fillStyle = '#2a221a'; ctx.fillRect(0, 0, cw, ch);
    ctx.strokeStyle = '#b08a34'; ctx.lineWidth = 6; ctx.strokeRect(6, 6, cw - 12, ch - 12);
    ctx.fillStyle = '#e8cf8c';
    const chars = [...String(text)];
    const fs = Math.min(ch * 0.62, (ch - 30) / Math.max(1, chars.length) * 1.5);
    ctx.font = `${Math.floor(fs)}px KaiTi, STKaiti, serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i], cw / 2, 24 + (ch - 48) * ((i + 0.5) / chars.length));
    }
    ctx.restore();
    _texB.tex.needsUpdate = true;
  }
  const v0 = 1 - (slot + 1) / TEXB_CELLS, v1 = 1 - slot / TEXB_CELLS;
  return { slot, uv: [0.02, v0 + 0.001, 0.98, v1 - 0.001], idx: slot };
}

function matAtlasA() {
  const a = atlasPaintings(QUAL.high.texSize);
  if (!a) return matSolid();
  if (!_matA) {
    _matA = new THREE.MeshBasicMaterial({ map: a.tex, vertexColors: false, side: THREE.DoubleSide, fog: true, toneMapped: false });
    _matA.name = 'orn-paintings';
  }
  return _matA;
}
let _matB = null;
function matAtlasB() {
  if (!_texB) return matSolid();
  if (!_matB) {
    _matB = new THREE.MeshBasicMaterial({ map: _texB.tex, vertexColors: true, side: THREE.DoubleSide, fog: true, toneMapped: false });
    _matB.name = 'orn-text';
  }
  return _matB;
}

// ═══════════════════════════════════════════════════════════════════════════
// 九、spec 清洗（防 NaN 顶点）：所有数值字段做 Number.isFinite 兜底
// ═══════════════════════════════════════════════════════════════════════════
const NUM_DEFAULTS = {
  x: 0, z: 0, y: 0, dx: 0, dy: 0, dz: 0, rotY: 0,
  x1: 0, x2: 0, z1: 0, z2: 0, eaveY: 0, ridgeY: 0, eaveTop: 0, ridgeTop: 0,
  w: 1.0, h: 1.0, d: 0.8, r: 0.2, size: 10, span: 10, len: 4, wid: 4,
  hang: 0.6, amp: 0.07, phase: 0, maxAngle: 1.55, openTowards: 1, upturn: 1,
  wAlong: 1, leafW: 1, cell: 0, panels: 3, fold: 0.2, seed: 0, depth: 0.1,
  seatH: 0.46, baseH: 0.2, plinthH: 1, colH: 4, wallH: 4, columnH: 4, roofH: 3,
};
function num(v, d) {
  return (typeof v === 'number' && Number.isFinite(v)) ? v : (d != null ? d : 0);
}
/** 深拷贝并清洗 spec：非有限数字 → 默认值；返回干净对象（不改 Lead 的原始 spec） */
function sanitizeSpec(src, depth = 0) {
  if (src == null || typeof src !== 'object' || depth > 4) return src;
  if (Array.isArray(src)) return src.map((v) => sanitizeSpec(v, depth + 1));
  const out = {};
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (typeof v === 'number') {
      out[k] = Number.isFinite(v) ? v : (NUM_DEFAULTS[k] != null ? NUM_DEFAULTS[k] : 0);
    } else if (v && typeof v === 'object') {
      out[k] = sanitizeSpec(v, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}
/** 数值是否有效（用于整体跳过坏 spec） */
function okNum(v) { return typeof v === 'number' && Number.isFinite(v); }

// ═══════════════════════════════════════════════════════════════════════════
// 十、buildDetails：消费 ctx.details.* → THREE.Group
// ═══════════════════════════════════════════════════════════════════════════
export function buildDetails(ctx = {}) {
  const q = qualOf(ctx);
  const d = ctx.details || {};
  const group = new THREE.Group();
  group.name = 'ornaments';

  const solid = new GeoBuilder(false);           // 静态实体
  const texA = new GeoBuilder(true);             // 字画图集
  const texB = new GeoBuilder(true);             // 题字图集
  const texAInfo = atlasPaintings(q.texSize);
  const paintBatch = texAInfo ? texA : null;
  const textBatch = typeof document !== 'undefined' ? texB : null;
  const skipped = { roofs: 0, railings: 0, lattices: 0, furniture: 0, columns: 0, doors: 0, banners: 0, lanterns: 0 };
  const samples = [];   // 坏 spec 样本（供 dev 报告）

  // 1) 屋面细部（eaveY/ridgeY 非有限的坏 spec 直接跳过，避免在地面/高空生成残留）
  const roofs = d.roofs || [];
  for (let i = 0; i < roofs.length; i++) {
    const raw = roofs[i];
    if (!raw || !okNum(raw.x1) || !okNum(raw.x2) || !okNum(raw.z1) || !okNum(raw.z2)
      || !okNum(raw.eaveY) || !okNum(raw.ridgeY)) {
      skipped.roofs++;
      if (samples.length < 8) samples.push({ cat: 'roofs', i, spec: raw });
      continue;
    }
    emitRoof(solid, sanitizeSpec(raw), q);
  }

  // 2) 柱
  const columns = d.columns || [];
  for (let i = 0; i < columns.length; i++) {
    const raw = columns[i];
    if (!raw || !okNum(raw.x) || !okNum(raw.z) || !okNum(raw.y) || !okNum(raw.h)) { skipped.columns++; continue; }
    emitColumn(solid, sanitizeSpec(raw), q);
  }

  // 3) 门窗棂（合法性校验：园内坐标 / y∈[0,50] / 不超长）
  const lattices = d.lattices || [];
  for (let i = 0; i < lattices.length; i++) {
    const raw = lattices[i];
    if (!raw || !okNum(raw.x) || !okNum(raw.y) || !okNum(raw.z) || !okNum(raw.w) || !okNum(raw.h)) { skipped.lattices++; continue; }
    const okPos = Math.abs(raw.x) <= 150 && Math.abs(raw.z) <= 150 && raw.y >= 0 && raw.y <= 50;
    if (!okPos || raw.w > 12 || raw.h > 8) { skipped.lattices++; continue; }
    const spec = sanitizeSpec(raw);
    spec.w = Math.max(0.2, Math.min(12, spec.w));
    spec.h = Math.max(0.2, Math.min(8, spec.h));
    emitLattice(solid, spec, q, latticeXf(spec));
  }

  // 4) 栏杆（兼容 pts 折线与 helpers 的 {x1,z1,x2,z2} 直线两种 spec）
  const railings = d.railings || [];
  for (let i = 0; i < railings.length; i++) {
    const raw = railings[i];
    let valid = false, len = 0;
    if (raw) {
      if (Array.isArray(raw.pts) && raw.pts.length >= 2) {
        valid = raw.pts.every((p) => p && okNum(p[0]) && okNum(p[1]));
        if (valid) for (let k = 0; k < raw.pts.length - 1; k++) len += Math.hypot(raw.pts[k + 1][0] - raw.pts[k][0], raw.pts[k + 1][1] - raw.pts[k][1]);
      } else if (okNum(raw.x1) && okNum(raw.z1) && okNum(raw.x2) && okNum(raw.z2)) {
        valid = true;
        len = Math.hypot(raw.x2 - raw.x1, raw.z2 - raw.z1);
      }
    }
    if (!raw || !valid || !okNum(raw.y)) { skipped.railings++; continue; }
    const okPos = Math.abs(raw.x1 ?? 0) <= 150 && Math.abs(raw.z1 ?? 0) <= 150
      && Math.abs(raw.x2 ?? 0) <= 150 && Math.abs(raw.z2 ?? 0) <= 150
      && raw.y >= 0 && raw.y <= 50 && len <= 25;
    if (!okPos) { skipped.railings++; continue; }
    emitRailing(solid, sanitizeSpec(raw), q);
  }

  // 5) 门（静态门框合并；门扇实例化）
  const doors = [];
  for (let i = 0; i < (d.doors || []).length; i++) {
    const raw = d.doors[i];
    if (!raw || !okNum(raw.x) || !okNum(raw.y) || !okNum(raw.z) || !okNum(raw.w) || !okNum(raw.h)) { skipped.doors++; continue; }
    collectDoor(sanitizeSpec(raw), q, solid, doors);
  }

  // 6) 家具陈设
  for (let i = 0; i < (d.furniture || []).length; i++) {
    const raw = d.furniture[i];
    if (!raw || !okNum(raw.x) || !okNum(raw.y) || !okNum(raw.z)) { skipped.furniture++; continue; }
    const spec = sanitizeSpec(raw);
    if (spec.w != null) spec.w = Math.max(0.15, Math.min(12, spec.w));
    if (spec.d != null) spec.d = Math.max(0.15, Math.min(12, spec.d));
    if (spec.h != null) spec.h = Math.max(0.03, Math.min(6, spec.h));
    // helpers/H.furnish 的家具 spec 坐标是“米/世界中心”（不是体素索引）→ 不再 +0.5
    const P = mkXf({ ...spec, center: true }, 0);
    const patch = {
      quadUV: (a, b, c, dd, color, uv) => {
        if (!paintBatch) return;
        texA.quadUV(a, b, c, dd, 0xffffff, uv, { noShade: false });
      },
      cellUV: (cell) => (texAInfo ? texAInfo.cellUV(cell) : [0, 0, 1, 1]),
    };
    emitFurniture(solid, paintBatch ? patch : null, spec, P, q);
  }

  // 7) 灯笼（吊绳静态；灯体实例化摆动）
  const lanterns = [];
  for (let i = 0; i < (d.lanterns || []).length; i++) {
    const raw = d.lanterns[i];
    if (!raw || !okNum(raw.x) || !okNum(raw.y) || !okNum(raw.z)) { skipped.lanterns++; continue; }
    const spec = sanitizeSpec(raw);
    const x = spec.x + 0.5, z = spec.z + 0.5, y = spec.y;
    const hang = Math.max(0.1, Math.min(4, spec.hang ?? 0.6));
    solid.box(x - 0.025, y - hang - 0.02, z - 0.025, x + 0.025, y, z + 0.025, C.woodDark);
    solid.boxC(x, y - 0.02, z, 0.16, 0.06, 0.16, C.woodDark);
    lanterns.push({ spec, x, y, z, hang, phase: spec.phase ?? (x * 0.7 + z * 0.3), amp: spec.amp ?? 0.07, style: spec.style || 'red', r: Math.max(0.1, Math.min(2, spec.r ?? 0.35)) });
  }

  // 8) 匾额/幡旗（贴图批 + 实木/布底板）
  const banners = [];
  for (let i = 0; i < (d.banners || []).length; i++) {
    const raw = d.banners[i];
    if (!raw || !okNum(raw.x) || !okNum(raw.y) || !okNum(raw.z)) { skipped.banners++; continue; }
    const spec = sanitizeSpec(raw);
    spec.w = Math.max(0.2, Math.min(12, spec.w ?? 0.6));
    spec.h = Math.max(0.2, Math.min(8, spec.h ?? 2.0));
    banners.push(spec);
    const w = spec.w, h = spec.h;
    const P = mkXf(spec, 0);
    // 底板（匾/幡实体，双面薄板）
    const bc = spec.boardColor ?? C.plaqueBoard;
    solid.quad(P(-w / 2, 0, -0.025), P(w / 2, 0, -0.025), P(w / 2, h, -0.025), P(-w / 2, h, -0.025), bc);
    solid.quad(P(w / 2, 0, 0.025), P(-w / 2, 0, 0.025), P(-w / 2, h, 0.025), P(w / 2, h, 0.025), bc);
    if (!textBatch) continue;
    const info = atlasText(spec.text || '');
    if (!info) continue;
    const a = P(-w / 2, 0, 0.032), b = P(w / 2, 0, 0.032), c = P(w / 2, h, 0.032), d2 = P(-w / 2, h, 0.032);
    texB.quadUV(a, b, c, d2, 0xffffff, info.uv);
    const a2 = P(w / 2, 0, -0.032), b2 = P(-w / 2, 0, -0.032), c2 = P(-w / 2, h, -0.032), d3 = P(w / 2, h, -0.032);
    texB.quadUV(a2, b2, c2, d3, 0xffffff, info.uv);
    const top = P(0, h + 0.04, 0), bot = P(0, 0.02, 0);
    solid.box(top[0] - w / 2 - 0.06, top[1] - 0.04, top[2] - 0.05, top[0] + w / 2 + 0.06, top[1] + 0.06, top[2] + 0.05, C.gold);
    solid.box(bot[0] - w / 2 - 0.04, bot[1] - 0.06, bot[2] - 0.05, bot[0] + w / 2 + 0.04, bot[1] + 0.02, bot[2] + 0.05, C.goldDark);
  }

  // 9) misc（未知类型的轻量占位：由 spec.kind 分派）
  for (let i = 0; i < (d.misc || []).length; i++) {
    const raw0 = d.misc[i];
    if (!raw0 || !okNum(raw0.x) || !okNum(raw0.y) || !okNum(raw0.z)) continue;
    const spec = sanitizeSpec(raw0);
    const P = mkXf(spec, 0);
    if (spec.kind === 'lantern') {
      const x = spec.x + 0.5, z = spec.z + 0.5, y = spec.y;
      const ge = lanternUnitGeom(spec.style || 'red', q);
      const m = new THREE.Mesh(ge, matSolid());
      const r = Math.max(0.1, Math.min(2, spec.r ?? 0.35));
      m.scale.set(r * 2, r * 2, r * 2);
      const p = P(0, 0, 0);
      m.position.set(p[0], p[1] - Math.max(0.1, spec.hang ?? 0.6), p[2]);
      group.add(m);
      continue;
    }
    if (spec.kind === 'rock' || spec.kind === 'stone') {
      const P2 = mkXf(spec, 0);
      const s = Math.max(0.1, Math.min(3, spec.r ?? 0.3));
      const g2 = new GeoBuilder(false);
      const y0 = spec.y;
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        const b = P2(Math.cos(a) * s * 0.5, 0.1 + (k % 3) * 0.12, Math.sin(a) * s * 0.5);
        g2.boxC(b[0], b[1], b[2], s * 0.5, s * 0.4, s * 0.5, k % 2 ? C.rock : C.rockDark);
      }
      const pm = P2(0, y0, 0);
      g2.boxC(pm[0], pm[1] + 0.08, pm[2], s * 0.7, s * 0.5, s * 0.7, C.rock);
      group.add(g2.mesh(matSolid()));
      continue;
    }
    const p = P(0, 0, 0);
    solid.box(p[0] - 0.4, p[1], p[2] - 0.3, p[0] + 0.4, p[1] + 0.5, p[2] + 0.3, C.wood);
  }

  // ── 静态网格 ────────────────────────────────────────────────────────────
  let staticMesh = null;
  if (solid.tris > 0) {
    staticMesh = solid.mesh(matSolid());
    staticMesh.name = 'orn-static';
    group.add(staticMesh);
  }
  let paintMesh = null;
  if (paintBatch && paintBatch.tris > 0) {
    paintMesh = paintBatch.mesh(matAtlasA());
    paintMesh.name = 'orn-paintings';
    group.add(paintMesh);
  }
  let textMesh = null;
  if (textBatch && texB.tris > 0) {
    textMesh = texB.mesh(matAtlasB());
    textMesh.name = 'orn-text';
    group.add(textMesh);
  }

  // ── 动态门扇（按 (style,color) 分组 InstancedMesh）────────────────────────
  const doorGroups = new Map();
  for (const dspec of doors) {
    const key = `${dspec.style}_${dspec.colorIdx}`;
    if (!doorGroups.has(key)) doorGroups.set(key, { style: dspec.style, color: dspec.colorIdx, items: [] });
    doorGroups.get(key).items.push(dspec);
  }
  const doorMeshes = [];
  for (const grp of doorGroups.values()) {
    const ge = doorUnitGeom(grp.color, grp.style, q);
    const inst = new THREE.InstancedMesh(ge, matSolid(), grp.items.length);
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.name = `orn-doors-${grp.style}`;
    inst.frustumCulled = false;
    group.add(inst);
    doorMeshes.push({ inst, items: grp.items });
  }

  // ── 动态灯笼（按 style 分组 InstancedMesh）────────────────────────────────
  const lanternGroups = new Map();
  for (const l of lanterns) {
    if (!lanternGroups.has(l.style)) lanternGroups.set(l.style, []);
    lanternGroups.get(l.style).push(l);
  }
  const lanternMeshes = [];
  for (const [style, items] of lanternGroups) {
    const ge = lanternUnitGeom(style, q);
    const inst = new THREE.InstancedMesh(ge, matSolid(), items.length);
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.name = `orn-lanterns-${style}`;
    inst.frustumCulled = false;
    group.add(inst);
    lanternMeshes.push({ inst, items });
  }

  // ── 动态更新（门开合 / 灯笼摆）───────────────────────────────────────────
  const m4 = new THREE.Matrix4();
  const q4 = new THREE.Quaternion();
  const vS = new THREE.Vector3();
  const vP = new THREE.Vector3();
  const euler = new THREE.Euler();
  function updateDoors(dt) {
    for (const { inst, items } of doorMeshes) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        // 弹簧趋近目标角
        if (dt > 0) it.angle += (it.target - it.angle) * Math.min(1, dt * 9);
        const halfW = it.w / 2;
        const axis = it.axis;
        // 铰链位置（门洞边缘）与旋转方向：openTowards=+1 表示朝 +axis 法向开
        let hingeX, hingeZ, baseYaw;
        if (axis === 'x') {
          hingeX = it.cx + (it.side > 0 ? -halfW : halfW);
          hingeZ = it.cz;
          baseYaw = 0;
          // side>0：局部 +x，绕 Y 负角 → 朝 +z；side<0：镜像，正角 → 朝 +z
          const yaw = -it.side * it.openTowards * it.angle;
          euler.set(0, baseYaw + yaw, 0);
        } else {
          hingeX = it.cx;
          hingeZ = it.cz + (it.side > 0 ? -halfW : halfW);
          euler.set(0, -Math.PI / 2 + it.side * it.openTowards * it.angle, 0);
        }
        q4.setFromEuler(euler);
        vS.set(it.leafW * it.side, it.h, 1);
        vP.set(hingeX, it.y, hingeZ);
        m4.compose(vP, q4, vS);
        inst.setMatrixAt(i, m4);
      }
      inst.instanceMatrix.needsUpdate = true;
    }
  }
  function updateLanterns(t) {
    for (const { inst, items } of lanternMeshes) {
      for (let i = 0; i < items.length; i++) {
        const l = items[i];
        const ang = Math.sin(t * 0.9 + l.phase) * l.amp;
        euler.set(ang * 0.8, 0, ang);
        q4.setFromEuler(euler);
        vS.set(l.r * 2, l.r * 2, l.r * 2);
        vP.set(l.x, l.y, l.z);
        m4.compose(vP, q4, vS);
        inst.setMatrixAt(i, m4);
      }
      inst.instanceMatrix.needsUpdate = true;
    }
  }
  updateDoors(0);
  updateLanterns(0);

  const api = {
    setDoorOpen(index, open, immediate) {
      let i = 0;
      for (const { items } of doorMeshes) {
        for (const it of items) {
          if (i === index) {
            it.target = open ? it.maxAngle : 0;
            if (immediate) { it.angle = it.target; updateDoors(0.05); }
            return true;
          }
          i++;
        }
      }
      return false;
    },
    openDoorNear(px, pz, radius = 2.5) {
      let best = -1, bd = Infinity, idx = 0;
      for (const { items } of doorMeshes) {
        for (const it of items) {
          const d2 = (it.cx - px) ** 2 + (it.cz - pz) ** 2;
          if (d2 < bd) { bd = d2; best = idx; }
          idx++;
        }
      }
      if (best >= 0 && bd <= radius * radius) { this.setDoorOpen(best, true); return best; }
      return -1;
    },
    closeAllDoors() {
      for (const { items } of doorMeshes) for (const it of items) it.target = 0;
    },
    doorCount: doors.length,
    update(t, dt = 0.016) { updateDoors(dt); updateLanterns(t); },
  };
  group.userData = api;

  // ── 动画注册（Lead 的 ctx.animators 若存在则每帧调用）─────────────────────
  if (Array.isArray(ctx.animators)) {
    let last = 0;
    ctx.animators.push((t, dt) => {
      const dd = dt != null ? dt : Math.max(0, Math.min(0.1, t - last));
      last = t;
      updateDoors(dd);
      updateLanterns(t);
    });
  }

  const stats = {
    tris: (staticMesh ? staticMesh.geometry.index.count / 3 : 0)
      + (paintMesh ? paintMesh.geometry.index.count / 3 : 0)
      + (textMesh ? textMesh.geometry.index.count / 3 : 0)
      + doors.length * (doorUnitGeom(doors[0] ? doors[0].colorIdx : C.woodRed, doors[0] ? doors[0].style : 'panel', q).index.count / 3)
      + lanterns.length * (lanternUnitGeom('red', q).index.count / 3),
    staticTris: solid.tris,
    paintTris: paintBatch ? paintBatch.tris : 0,
    textTris: textBatch ? texB.tris : 0,
    roofCount: roofs.length, columnCount: columns.length, latticeCount: lattices.length,
    railingCount: railings.length, doorCount: doors.length, lanternCount: lanterns.length,
    furnitureCount: (d.furniture || []).length,
    skipped,
    drawCalls: (staticMesh ? 1 : 0) + (paintMesh ? 1 : 0) + (textMesh ? 1 : 0) + doorMeshes.length + lanternMeshes.length,
  };
  group.userData.stats = stats;
  group.userData.skipped = skipped;
  group.userData.badSpecSamples = samples;
  if (ctx.log && (skipped.roofs + skipped.columns + skipped.lattices + skipped.railings + skipped.doors + skipped.furniture + skipped.banners + skipped.lanterns) > 0) {
    try { ctx.log('[ornaments] skipped bad specs:', JSON.stringify(skipped), samples.slice(0, 3).map((s) => s.cat + '[' + s.i + ']').join(',')); } catch (e) { /* ignore */ }
  }
  // 供 Lead 接线时统一调色（TOD tint / 夜间自发光）与资源回收
  const uniqueMats = [];
  for (const m of [matSolid(), _matA, _matB]) if (m && uniqueMats.indexOf(m) < 0) uniqueMats.push(m);
  group.userData.materials = uniqueMats;
  group.userData.dispose = () => {
    group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    for (const m of uniqueMats) m.dispose();
  };
  return group;
}

// 默认导出（供 Lead 直接 import default）
export default buildDetails;
