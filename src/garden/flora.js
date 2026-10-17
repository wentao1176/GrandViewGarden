// ─────────────────────────────────────────────────────────────────────────────
// 大观园 · 植物生成器 v3（flora2 成员维护 · Phase 2 精细植被）
//
// 对外 API 与 docs/engine-api.md §5 完全一致（签名/选项保持兼容）：
//   tree / pine / willow / apricot / peach / plum / pear / bamboo / crabapple /
//   banana / wutong / elm / locust / mulberry / ginkgo / shrub / grassTuft /
//   flowerPatch / reedBed / lotus / peonyBed / vine / rockCluster / moss /
//   scatterGarden
//
// 与 v2（体素树冠）的区别：
//   · 不再写 1m 体素叶球；树冠 = 实例化叶片卡（每卡 7~13 片 8~16cm 小叶），
//     由 src/garden/foliage.js 的 InstancedBufferGeometry + 风摆着色器渲染；
//   · 树干/主枝 = 低多边形圆台（硬边、逐面烘焙明暗，与体素同一套 sRGB 色调）；
//   · 竹 = 细长分节竹竿 + 竹叶簇；柳 = 上冠 + 长垂柳条（大幅摆动）；
//     松 = 层叠针叶盘；芭蕉 = 放射大叶；梧桐掌叶 / 银杏扇叶 / 榆瓶状冠 /
//     槐平展阔冠 / 桑小圆冠，冠形各不相同；
//   · 地被/水生（草叶、野花、芍药、芦苇、荷、荇、浮萍）全部实例化轻摆；
//   · 山石仍为体素（与园中山石语言一致），苔藓仍只做地表色斑。
//
// 预算（docs/phase2-api.md §8）：
//   · 叶片实例 ≤ 118k（移动端减半），草/花实例 ≤ 52k（移动端减半）；
//   · 植被 draw call = 7 个实例批次 + 1 个枝干合并网格 = 8；
//   · 全部预算在 foliage.js 内硬性截断，越界即丢弃，不会爆内存。
//
// 确定性：只从 ctx.R 取 1 个种子，其余全部用本地 mulberry32；不干扰场景随机序列。
// 避让：树位检查 ctx.isWater / isPath / isReserved + 地面实体 + 上方建筑体素；
//       水岸树自动向陆侧微移（≤6 格）；scatterGarden 幂等。
// ─────────────────────────────────────────────────────────────────────────────
import { C, GROUPS, PALETTE } from '../core/palette.js';
import { WATER_LEVEL, ZONES, PADS, PONDS, STREAMS, HILLS, POIS } from './layout.js';
import { createFoliage, CELLS } from './foliage.js';

const LIMIT = 156;                                   // 种植活动范围
const WATER_Y = Number.isFinite(WATER_LEVEL) ? WATER_LEVEL : 3.35;
const ATLAS = CELLS;

// ───────────── 确定性工具 ─────────────
function mulberry32(a) {
  a = a >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash3(x, y, z, salt) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1013904223) ^ Math.imul(salt | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
// 调色板 → 线性 RGB 缓存（避免每张卡片分配数组）
const LIN = new Array(PALETTE.length);
for (let i = 1; i < PALETTE.length; i++) {
  const p = PALETTE[i];
  if (p) LIN[i] = [s2l(p.r / 255), s2l(p.g / 255), s2l(p.b / 255)];
}
const linOf = (idx) => LIN[idx] || [0, 0, 0];

// ───────────── 物种色表 ─────────────
const LEAF_PAL = {
  generic: [C.leaf, C.leafDark, C.leafLight, C.leafYellow],
  wutong: [C.leaf, C.leafLight, C.leafYellow],
  locust: [C.leafYellow, C.leafLight, C.leaf],
  elm: [C.leaf, C.leafDark, C.leafLight],
  ginkgo: [C.leafYellow, C.chrys, C.leafLight, C.leaf],
  mulberry: [C.leaf, C.leafLight, C.leafDark],
  willow: [C.willow, C.willow2, C.leafLight],
  pine: [C.pine, C.pineLight, C.pineDark],
  bamboo: [C.bambooLeaf, C.bambooLeaf2, C.bambooLeaf3],
  banana: [C.leaf, C.leafLight, C.leafDark],
  shrub: GROUPS.leaf,
  lotus: [C.lotusPad, C.lotusPad2, C.lotusPad3],
  grass: [C.grass3, C.leafLight, C.grass, C.vegetable, C.grass2, C.grassDry, C.bambooLeaf2],
  reed: [C.reed, C.reed2, C.leafYellow, C.leafLight],
};
// 花树花色（内层深、中层主色、外缘浅）——沿用 v2 考据配色，保持克制
const BLOOM = {
  apricot: { inner: [C.crabapple], base: [C.apricot2, C.crabapple], edge: [C.apricot, C.apricot2, C.plumWhite] },
  peach: { inner: [C.crabapple, C.peony2, C.plumWhite], base: [C.peach, C.crabapple], edge: [C.apricot2, C.peach, C.plumWhite] },
  pear: { inner: [C.apricot2], base: [C.plumWhite, C.apricot2], edge: [C.plumWhite] },
  plumRed: { inner: [C.redDark, C.plumRed], base: [C.plumRed, C.plumRed, C.crabapple], edge: [C.crabapple, C.plumRed] },
  plumWhite: { inner: [C.apricot2, C.crabapple], base: [C.plumWhite, C.apricot], edge: [C.plumWhite] },
  crabapple: { inner: [C.plumRed], base: [C.crabapple, C.crabapple, C.peony2], edge: [C.peony2, C.crabapple] },
};
const BLOOM_FLOWER = new Set([C.apricot, C.apricot2, C.peach, C.crabapple, C.plumRed, C.plumWhite, C.peony, C.peony2, C.lotusFlower, C.chrys]);
const isBloomColor = (idx) => BLOOM_FLOWER.has(idx);

// 是否为「草皮类」地表（地表色斑只改草皮，不碰铺装/石头）
const isGrassColor = (c) => c === C.grass || c === C.grass2 || c === C.grass3 || c === C.grassDry;

// ───────────── 系统入口 ─────────────
export function createFlora(ctx) {
  const w = ctx.w;
  // 只从 ctx.R 取一个种子，其余随机全部本地化（不扰动其它场景的随机序列）
  const seed = (typeof ctx.R === 'function') ? (Math.floor(ctx.R() * 4294967296) >>> 0) : 0x20260a17;
  const rnd = mulberry32(seed);
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const rf = (a, b) => a + rnd() * (b - a);
  const chance = (p) => rnd() < p;
  const pick = (arr) => (arr && arr.length ? arr[Math.floor(rnd() * arr.length) % arr.length] : 0);
  const pickAt = (arr, x, y, z, salt = 0) => {
    if (!arr || !arr.length) return 0;
    if (arr.length === 1) return arr[0];
    return arr[(hash3(x, y, z, salt) >>> 7) % arr.length];
  };

  // 植被系统（实例化 + 风摆；postBuild/animators 由本模块挂接）
  const fol = createFoliage(ctx);
  const lowQ = fol.budget.low;
  const densityScale = fol.scale;     // 单株叶片数量缩放（移动端 ~0.56）

  // 统计（兼容旧 stats 字段）
  let vCount = 0;
  let plantCount = 0;
  const bumpPlant = () => { plantCount++; };

  // ── 世界查询（兼容旧 ctx 字段；整园 320×320 一次性缓存水/路/地表高度，避免逐点回调）──
  const MIDX = (x, z) => (x + 160) + (z + 160) * 320;
  const inWorld = (x, z) => x >= -160 && x < 160 && z >= -160 && z < 160;
  let _waterM = null, _pathM = null, _topM = null;
  const rawTerrainTop = (x, z) => {
    let g;
    if (typeof ctx.groundY === 'function') g = ctx.groundY(x, z);
    else if (typeof ctx.groundTop === 'function') g = ctx.groundTop(x, z);
    else g = w.topY(x, z);
    if (!Number.isFinite(g)) return -1;
    g = Math.round(g);
    return g >= 0 && g < 92 ? g : -1;
  };
  const rawTopColor = (x, z) => {
    const g = rawTerrainTop(x, z);
    return g >= 0 ? w.get(x, g, z) : 0;
  };
  const rawIsWater = (x, z) => {
    if (typeof ctx.isWater === 'function') return !!ctx.isWater(x, z);
    const c = rawTopColor(x, z);
    return c === 0 || c === C.waterBed || c === C.waterBed2 || c === C.waterBed3;
  };
  const rawIsPath = (x, z) => {
    if (typeof ctx.isPath === 'function') return !!ctx.isPath(x, z);
    const c = rawTopColor(x, z);
    return c === C.path || c === C.path2 || c === C.path3 || c === C.pebble || c === C.pebbleDark;
  };
  function buildQueryMasks() {
    _waterM = new Uint8Array(320 * 320);
    _pathM = new Uint8Array(320 * 320);
    _topM = new Int16Array(320 * 320);
    for (let z = -160; z < 160; z++) {
      for (let x = -160; x < 160; x++) {
        const i = MIDX(x, z);
        _waterM[i] = rawIsWater(x, z) ? 1 : 0;
        _pathM[i] = rawIsPath(x, z) ? 1 : 0;
        _topM[i] = rawTerrainTop(x, z);
      }
    }
  }
  const terrainTop = (x, z) => {
    if (_topM) {
      const xi = Math.round(x), zi = Math.round(z);
      if (inWorld(xi, zi)) return _topM[MIDX(xi, zi)];
    }
    return rawTerrainTop(x, z);
  };
  const isWater = (x, z) => {
    if (!_waterM) buildQueryMasks();
    const xi = Math.round(x), zi = Math.round(z);
    if (inWorld(xi, zi)) return _waterM[MIDX(xi, zi)] === 1;
    return rawIsWater(x, z);
  };
  const isPath = (x, z) => {
    if (!_pathM) buildQueryMasks();
    const xi = Math.round(x), zi = Math.round(z);
    if (inWorld(xi, zi)) return _pathM[MIDX(xi, zi)] === 1;
    return rawIsPath(x, z);
  };
  const topColorAt = (x, z) => {
    const g = terrainTop(x, z);
    return g >= 0 ? w.get(x, g, z) : 0;
  };
  const reservedAt = (x, z) => {
    if (typeof ctx.isReserved === 'function') return !!ctx.isReserved(x, z);
    return false;
  };
  // 是否位于建筑/铺装台地（PADS）内
  function inPad(x, z, margin = 0) {
    for (let i = 0; i < PADS.length; i++) {
      const p = PADS[i];
      if (x >= p.x1 - margin && x <= p.x2 + margin && z >= p.z1 - margin && z <= p.z2 + margin) return true;
    }
    return false;
  }
  const nearWater = (x, z, rad) => {
    const r = Math.max(1, Math.round(rad));
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (isWater(x + dx, z + dz)) return [dx, dz];
    }
    return null;
  };
  // 离水太近时向陆侧微移（最多 tries 格；避免树冠压水/树根入水）
  function dryShift(x, z, rad, tries = 6) {
    x = Math.round(x); z = Math.round(z);
    const w0 = nearWater(x, z, rad);
    if (!w0) return [x, z];
    const len = Math.hypot(w0[0], w0[1]) || 1;
    const ux = -w0[0] / len, uz = -w0[1] / len;
    for (let k = 1; k <= tries; k++) {
      const nx = Math.round(x + ux * k), nz = Math.round(z + uz * k);
      if (!nearWater(nx, nz, rad)) return [nx, nz];
    }
    return [x, z];
  }
  // 站点：返回地表体素 y（其顶面 = g+1）；不可放置返回 -1
  function site(x, z, opt = {}) {
    x = Math.round(x); z = Math.round(z);
    if (Math.abs(x) > LIMIT || Math.abs(z) > LIMIT) return -1;
    const g = terrainTop(x, z);
    if (g < 0 || w.get(x, g, z) === 0) return -1;
    if (!opt.allowWater && isWater(x, z)) return -1;
    if (!opt.allowPath && isPath(x, z)) return -1;
    const clear = opt.clear == null ? 1 : opt.clear;
    for (let h = 1; h <= clear; h++) {
      const above = w.get(x, g + h, z);
      if (above !== 0) return -1;   // 植被已不再写体素，此处只避让建筑/场景实体
    }
    return g;
  }
  const groundSite = (x, z) => {
    x = Math.round(x); z = Math.round(z);
    if (Math.abs(x) > LIMIT || Math.abs(z) > LIMIT) return -1;
    const g = terrainTop(x, z);
    if (g < 0 || w.get(x, g, z) === 0) return -1;
    if (isWater(x, z)) return -1;
    return g;
  };
  const openBed = (x, z) => {
    const g = groundSite(x, z);
    if (g < 0 || isPath(x, z)) return -1;
    if (w.get(x, g + 1, z) !== 0) return -1;
    return g;
  };
  // POI 机位（layout.POIS[].cam）附近不种树，避免镜头贴近/穿进冠核或大卡
  const CAM_PTS = [];
  for (const p of POIS) {
    if (p && Array.isArray(p.cam) && p.cam.length >= 3) CAM_PTS.push([p.cam[0], p.cam[2]]);
  }
  function nearCam(x, z, rad) {
    const r = 6 + rad;
    for (let i = 0; i < CAM_PTS.length; i++) {
      const dx = x - CAM_PTS[i][0], dz = z - CAM_PTS[i][1];
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }
  // 树位：避水微移 + 站点检查
  function treeSite(x, z, rad) {
    let px = Math.round(x), pz = Math.round(z);
    const sh = dryShift(px, pz, Math.min(7, Math.round(rad) + 1));
    px = sh[0]; pz = sh[1];
    let g = site(px, pz, { clear: 1 });
    if (g < 0) { px = Math.round(x); pz = Math.round(z); g = site(px, pz, { clear: 1 }); }
    if (g < 0) return null;
    if (nearCam(px, pz, rad)) return null;
    return { x: px, z: pz, g };
  }
  // 地表色斑（只改草皮顶层）
  function tintGround(x, z, c, onlyGrass = true) {
    const g = terrainTop(x, z);
    if (g < 0) return false;
    const cur = w.get(x, g, z);
    if (cur === 0) return false;
    if (onlyGrass && !isGrassColor(cur)) return false;
    w.set(x, g, z, c);
    return true;
  }

  // ── 卡片写入（复用同一个对象，零分配）──────────────────────────────────
  const _card = {
    x: 0, y: 0, z: 0,
    rx: 0, ry: 0, rz: 0,
    ux: 0, uy: 0, uz: 0,
    r: 0, g: 0, b: 0,
    phase: 0, amp: 0, cell: 0,
  };
  /**
   * 随机卡片姿态：right/up 正交，|right|=w、|up|=h。
   * yaw 绕世界 Y；tilt 绕 right（0=竖直叶面，π/2=水平叶面）；roll 绕 up。
   */
  function setBasis(yaw, tilt, roll, ww, hh) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    // right1 = (cy, 0, -sy)，up1 = (0,1,0)，normal1 = (sy, 0, cy)
    // 绕 right1 转 tilt：up2 / normal2
    const ux0 = sy * st, uy0 = ct, uz0 = cy * st;
    const nx = sy * ct, ny = -st, nz = cy * ct;
    // 绕 up2 转 roll：right2 = right1*cr + normal2*sr
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const rx0 = cy * cr + nx * sr;
    const ry0 = ny * sr;
    const rz0 = -sy * cr + nz * sr;
    _card.rx = rx0 * ww; _card.ry = ry0 * ww; _card.rz = rz0 * ww;
    _card.ux = ux0 * hh; _card.uy = uy0 * hh; _card.uz = uz0 * hh;
  }
  /** 写入一张卡片（颜色 = 调色板索引 × 亮度） */
  function leaf(group, x, y, z, ww, hh, yaw, tilt, roll, idx, mul, phase, amp, cell) {
    // 硬上限：任何单张卡 ≤ 2.2m，避免极端参数放大成「巨型绿板」
    if (!(ww > 0) || !(hh > 0)) return false;
    if (ww > 2.2) ww = 2.2;
    if (hh > 2.2) hh = 2.2;
    const c = linOf(idx);
    _card.x = x; _card.y = y; _card.z = z;
    _card.r = c[0] * mul; _card.g = c[1] * mul; _card.b = c[2] * mul;
    _card.phase = phase;
    _card.amp = amp;
    _card.cell = cell;
    setBasis(yaw, tilt, roll, ww, hh);
    return fol.addCard(group, _card);
  }
  /** 水平/近水平卡片（荷叶、松针盘、藤架顶叶等） */
  function flatLeaf(group, x, y, z, ww, hh, yaw, tilt, roll, idx, mul, phase, amp, cell) {
    return leaf(group, x, y, z, ww, hh, yaw, Math.PI * 0.5 + tilt, roll, idx, mul, phase, amp, cell);
  }
  /** 下垂卡片（柳条/垂藤）：aPos 为上端锚点 */
  function hangLeaf(group, x, y, z, ww, len, yaw, idx, mul, phase, amp, cell) {
    if (!(ww > 0) || !(len > 0)) return false;
    if (ww > 1.3) ww = 1.3;
    if (len > 4.2) len = 4.2;
    const c = linOf(idx);
    _card.x = x; _card.y = y; _card.z = z;
    _card.r = c[0] * mul; _card.g = c[1] * mul; _card.b = c[2] * mul;
    _card.phase = phase;
    _card.amp = amp;
    _card.cell = cell;
    const ca = Math.cos(yaw), sa = Math.sin(yaw);
    _card.rx = ca * ww; _card.ry = 0; _card.rz = sa * ww;
    // 略微外倾，让柳条不只是纯竖直平面
    _card.ux = ca * len * 0.16; _card.uy = -len; _card.uz = sa * len * 0.16;
    return fol.addCard(group, _card);
  }

  // ── 低模枝干 ────────────────────────────────────────────────────────────
  const woodCols = (...idx) => idx.map((i) => linOf(i));
  /**
   * 树干：基部 → 顶部（可倾斜/弯曲），返回折线用于挂枝。
   * o: { lean, leanAngle, r0, taper, sides, colors }
   */
  function addTrunk(x0, g, z0, h, o = {}) {
    const leanA = o.leanAngle == null ? rnd() * Math.PI * 2 : o.leanAngle;
    const lean = o.lean == null ? rf(-0.7, 0.7) : o.lean;
    const segs = o.segs || 3;
    const r0 = o.r0 == null ? 0.24 : o.r0;
    const r1 = r0 * (o.taper == null ? 0.45 : o.taper);
    const y0 = g + 1;
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const k = Math.pow(t, 1.55);
      pts.push([x0 + Math.cos(leanA) * lean * k, y0 + h * t, z0 + Math.sin(leanA) * lean * k]);
    }
    const cols = o.colors || woodCols(C.woodDark, C.wood, C.woodDark);
    fol.wood.polyline(pts, r0, r1, o.sides || 5, cols, { capTop: true });
    // 根部盘结（3 条短根棱，贴地外扩）
    const roots = o.roots == null ? 3 : o.roots;
    for (let i = 0; i < roots; i++) {
      const a = (i / roots) * Math.PI * 2 + rf(0, 0.7);
      const len = r0 * rf(2.2, 4.0);
      fol.wood.prism(
        x0 + Math.cos(a) * r0 * 0.6, y0 + 0.04, z0 + Math.sin(a) * r0 * 0.6,
        x0 + Math.cos(a) * len, y0 + rf(0.05, 0.18), z0 + Math.sin(a) * len,
        r0 * 0.55, r0 * 0.16, 4, linOf(C.woodDark), { mul: 0.92 },
      );
    }
    return { pts, y0, top: pts[pts.length - 1], leanA };
  }
  /** 主枝：折线圆台（两点间加一个上扬中点，读得出「枝」的走势） */
  function addBranch(from, to, r0, r1, sides = 4) {
    const mx = (from[0] + to[0]) * 0.5, my = (from[1] + to[1]) * 0.5, mz = (from[2] + to[2]) * 0.5;
    const pts = [from, [mx, my + rf(0.1, 0.6), mz], to];
    fol.wood.polyline(pts, r0, r1, sides, woodCols(C.woodDark, C.wood), { capTop: true });
  }
  const anyShade = (base, lo = 0.52, hi = 1.18) => base * rf(lo, hi);

  // ── 植被统计（树/竹/柳/灌木株数）─────────────
  const plantStats = { trees: 0, farTrees: 0, bamboo: 0, willows: 0, shrubs: 0 };
  let defaultTreeLod = 'near';   // scatterGarden 内按区段切换 near/mid/far

  // ── 树冠实心核（远景绿量）───────────────────────────────────────────────
  /**
   * 在树冠内放低多边形椭球核：叶片卡在远处受 mip/像素尺寸限制会变稀，
   * 实心核保证 100m 外树冠仍是明确的绿色（或粉色）团块，近景则成为冠内暗部。
   */
  function canopyCore(cx, cy, cz, rx, ry, rz, idx, mul = 0.75, opts = {}) {
    if (!(rx > 0.4) || !(ry > 0.4) || !Number.isFinite(cx + cy + cz)) return;
    // 硬上限：冠核任何方向半径 ≤2.4m（远看体积靠多片卡 + 多核叠置，不允许单块巨物）
    const capR = opts.maxR == null ? 2.4 : opts.maxR;
    rx = Math.min(rx, capR); rz = Math.min(rz, capR); ry = Math.min(ry, Math.min(2.0, capR));
    // 两团叠置（不同色/不同偏移）→ 轮廓不规则，避免「光溜溜的绿气球」
    const idx2 = opts.idx2 != null ? opts.idx2 : idx;
    const lon = opts.lon || 8;
    const lat = opts.lat || 3;
    const jit = opts.jitter == null ? 0.5 : opts.jitter;
    const halves = opts.halves == null ? 2 : opts.halves;
    for (let i = 0; i < halves; i++) {
      const t = halves === 1 ? 0 : i / (halves - 1);
      const ox = (t - 0.5) * rx * 0.55;
      const oz = (((i * 7) % 5) / 5 - 0.5) * rz * 0.5;
      const rr = i === 1 ? 1 : 0.78;
      fol.wood.addEllipsoid(cx + ox, cy + (i === 1 ? 0 : ry * 0.18), cz + oz,
        rx * rr, ry * rr, rz * rr, linOf(i === 1 ? idx : idx2), {
          lon, lat, jitter: jit, mul: mul * (i === 1 ? 1 : 0.94),
        });
    }
  }

  // ── 树冠叶片分布 ────────────────────────────────────────────────────────
  /**
   * 在一个椭球树冠范围里铺实例化叶片卡。
   * o: { n, phase, amp, cell, cells, pal, size, mulLo, mulHi, inner, tilt }
   */
  function foliageBlob(cx, cy, cz, rx, ry, rz, o = {}) {
    const n = Math.max(0, Math.round(o.n || 0));
    if (!n) return 0;
    const pal = o.pal || LEAF_PAL.generic;
    const cells = o.cells || [ATLAS.leafA, ATLAS.leafB, ATLAS.leafC];
    const baseSize = o.size == null ? 0.72 : o.size;
    const phase0 = o.phase || 0;
    const amp0 = o.amp == null ? 0.12 : o.amp;
    const inner = o.inner == null ? 0.18 : o.inner;
    const maxSz = o.maxSize == null ? 2.0 : o.maxSize;   // 单张卡世界尺寸硬上限
    const tiltAmp = o.tilt == null ? 1.35 : o.tilt;
    let placed = 0;
    for (let i = 0; i < n; i++) {
      const isInner = i < n * inner;
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const sxy = Math.sqrt(Math.max(0, 1 - u * u));
      let rr;
      if (isInner) rr = 0.15 + 0.62 * Math.cbrt(rnd());
      else if (rnd() < 0.84) rr = 0.76 + 0.28 * Math.pow(rnd(), 0.5);
      else rr = 0.3 + 0.5 * rnd();
      const px = cx + sxy * Math.cos(th) * rx * rr + rf(-0.12, 0.12);
      const py = cy + u * ry * rr + rf(-0.1, 0.14);
      const pz = cz + sxy * Math.sin(th) * rz * rr + rf(-0.12, 0.12);
      const hN = (py - (cy - ry)) / Math.max(0.001, ry * 2);
      const big = !isInner && chance(0.42);         // 大团卡：中远景补轮廓
      let mul;
      if (isInner) {
        mul = (o.innerMul == null ? 0.52 : o.innerMul) * rf(0.8, 1.05);
      } else {
        mul = (o.mulLo == null ? 0.7 : o.mulLo)
          + (o.mulHi == null ? 0.42 : o.mulHi) * (hN * 0.72 + 0.28 * Math.min(1, rr))
          + rf(-0.05, 0.08);
      }
      const idx = pick(pal);
      const sz = Math.min(maxSz, baseSize * (big ? rf(1.35, 1.75) : (isInner ? rf(1.0, 1.4) : rf(0.9, 1.32))));
      leaf('canopy', px, py, pz, sz, sz * rf(0.85, 1.2),
        rnd() * Math.PI * 2, rf(-tiltAmp, tiltAmp), rnd() * Math.PI * 2,
        idx, mul, phase0 + rf(-0.5, 0.5), amp0 * rf(0.7, 1.35), pick(cells));
      placed++;
    }
    return placed;
  }

  // ── 花树树冠：细碎花团 + 少量嫩叶 ───────────────────────────────────────
  function blossomBlob(cx, cy, cz, rx, ry, rz, bloom, o = {}) {
    const n = Math.max(0, Math.round(o.n || 0));
    if (!n) return 0;
    const phase0 = o.phase || 0;
    const amp0 = o.amp == null ? 0.13 : o.amp;
    const baseSize = o.size == null ? 0.62 : o.size;
    const cells = o.cells || [ATLAS.bloomA, ATLAS.bloomB, ATLAS.crabapple];
    const sparse = !!o.sparse;
    const maxSz = o.maxSize == null ? 2.0 : o.maxSize;
    let placed = 0;
    for (let i = 0; i < n; i++) {
      const isInner = i < n * 0.18;
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const sxy = Math.sqrt(Math.max(0, 1 - u * u));
      let rr;
      if (isInner) rr = 0.18 + 0.6 * Math.cbrt(rnd());
      else if (rnd() < 0.8) rr = 0.74 + 0.3 * Math.pow(rnd(), 0.5);
      else rr = 0.3 + 0.5 * rnd();
      const px = cx + sxy * Math.cos(th) * rx * rr + rf(-0.1, 0.1);
      const py = cy + u * ry * rr + rf(-0.1, 0.1);
      const pz = cz + sxy * Math.sin(th) * rz * rr + rf(-0.1, 0.1);
      const hN = (py - (cy - ry)) / Math.max(0.001, ry * 2);
      const big = !isInner && !sparse && chance(0.4);       // 大花云卡
      let mul = 0.76 + 0.4 * hN + rf(-0.05, 0.08);
      if (isInner) mul = 0.58 * rf(0.85, 1.05);
      const roll = rnd();
      let idx;
      if (roll < 0.08) idx = pick(LEAF_PAL.generic);          // 少量嫩叶
      else if (roll < 0.22) idx = pick(bloom.inner);
      else if (roll < 0.72) idx = pick(bloom.base);
      else idx = pick(bloom.edge);
      const isLeaf = roll < 0.08;
      const sz = Math.min(maxSz, baseSize * (big ? rf(1.4, 1.9) : (isInner ? rf(1.0, 1.35) : rf(0.92, 1.35))));
      leaf('canopy', px, py, pz, sz, sz * rf(0.85, 1.15),
        rnd() * Math.PI * 2, rf(-1.35, 1.35), rnd() * Math.PI * 2,
        idx, mul, phase0 + rf(-0.5, 0.5), amp0 * rf(0.7, 1.35),
        isLeaf ? pick([ATLAS.leafC, ATLAS.leafB]) : pick(cells));
      placed++;
    }
    return placed;
  }

  // ── 冠形布局：把若干椭球拼成可辨识的树冠 ────────────────────────────────
  /** 返回 [{cx,cy,cz,rx,ry,rz,w}]，w 为叶片数权重 */
  function blobLayout(shape, tx, topY, tz, r, h) {
    const B = [];
    const add = (cy, rx, ry, rz, w, ox = 0, oz = 0) => B.push({ cx: tx + ox, cy, cz: tz + oz, rx, ry, rz, w });
    if (shape === 'flat') {
      // 梧桐/槐：宽而扁，两层大冠 + 顶冠 + 侧翼
      add(topY - r * 1.02, r * 1.12, r * 0.44, r * 1.12, 0.42);
      add(topY - r * 0.6, r * 1.2, r * 0.42, r * 1.2, 0.28);
      add(topY - r * 0.2, r * 0.66, r * 0.32, r * 0.66, 0.16);
      for (let i = 0; i < 2; i++) {
        const a = rnd() * Math.PI * 2;
        add(topY - r * (0.62 + rnd() * 0.35), r * 0.55, r * 0.3, r * 0.55, 0.07,
          Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
      }
    } else if (shape === 'vase') {
      // 榆：下窄上阔（花瓶冠）
      add(topY - r * 2.05, r * 0.66, r * 0.46, r * 0.66, 0.2);
      add(topY - r * 1.32, r * 0.92, r * 0.5, r * 0.92, 0.3);
      add(topY - r * 0.58, r * 1.12, r * 0.54, r * 1.12, 0.34);
      add(topY + r * 0.02, r * 0.5, r * 0.3, r * 0.5, 0.08);
      const a = rnd() * Math.PI * 2;
      add(topY - r * 1.0, r * 0.5, r * 0.3, r * 0.5, 0.08, Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
    } else if (shape === 'conical') {
      // 银杏：圆锥，自下而上收分
      add(topY - r * 0.3, r * 1.0, r * 0.54, r * 1.0, 0.3);
      add(topY - r * 1.0, r * 0.8, r * 0.5, r * 0.8, 0.26);
      add(topY - r * 1.7, r * 0.58, r * 0.44, r * 0.58, 0.22);
      add(topY - r * 2.3, r * 0.34, r * 0.3, r * 0.34, 0.14);
      add(topY - r * 2.7, r * 0.2, r * 0.2, r * 0.2, 0.08);
    } else if (shape === 'small') {
      // 桑/小乔木：小圆冠
      add(topY - r * 0.9, r * 1.0, r * 0.68, r * 1.0, 0.6);
      add(topY - r * 0.28, r * 0.58, r * 0.4, r * 0.58, 0.28);
      const a = rnd() * Math.PI * 2;
      add(topY - r * 0.62, r * 0.5, r * 0.34, r * 0.5, 0.12, Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75);
    } else {
      // 圆形乔木：下宽上收 3 层 + 2 侧翼
      add(topY - r * 0.98, r * 1.1, r * 0.58, r * 1.1, 0.38);
      add(topY - r * 0.55, r * 0.92, r * 0.52, r * 0.92, 0.26);
      add(topY - r * 0.16, r * 0.62, r * 0.4, r * 0.62, 0.14);
      for (let i = 0; i < 2; i++) {
        const a = rnd() * Math.PI * 2;
        add(topY - r * (0.5 + rnd() * 0.4), r * 0.56, r * 0.34, r * 0.56, 0.11,
          Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86);
      }
    }
    return B;
  }

  // ── 通用阔叶树 ──────────────────────────────────────────────────────────
  /**
   * o: { h, r, shape, pal, cells, leaves, trunkColors, trunkR, lean, lod }
   */
  function buildBroadleaf(x, z, o = {}) {
    const lod = o.lod || 'near';
    const h = Math.max(6, Math.round(o.h || (lod === 'far' ? 9 : 11)));
    const r = Math.max(1.8, o.r || (h * (lod === 'far' ? 0.46 : 0.4)));
    const st = treeSite(x, z, r);
    if (!st) return false;
    const g = st.g;
    const avail = fol.room('canopy');
    if (avail < (lod === 'far' ? 240 : (lod === 'mid' ? 500 : 900))) return false;
    const need = lod === 'far' ? 11000 : (lod === 'mid' ? 20000 : 32000);
    const dens = Math.min(1, Math.max(0.38, avail / need));
    const sizeBoost = dens < 0.85 ? Math.min(1.35, 1 + (0.85 - dens) * 1.1) : 1;
    const sizeF = Math.min(1.4, Math.max(0.72, h / 11));
    const baseN = o.leaves || (lod === 'far' ? 105 : (lod === 'mid' ? 205 : 335));
    const n = Math.max(24, Math.round(baseN * dens * sizeF * densityScale));
    const shape = o.shape || 'round';
    const trunkH = Math.max(3.2, h * (o.trunkRatio || 0.44));
    const trunkR = o.trunkR == null ? (h >= 11 ? 0.58 : 0.42) : o.trunkR;
    const tr = addTrunk(st.x, g, st.z, trunkH, {
      r0: trunkR,
      lean: o.lean == null ? rf(-0.9, 0.9) : o.lean,
      colors: o.trunkColors || woodCols(C.woodDark, C.wood, C.woodDark),
      sides: 5,
    });
    const top = tr.top;
    const topY = g + 1 + h;
    const blobs = blobLayout(shape, top[0], topY, top[2], r, h);
    const totalW = blobs.reduce((s, b) => s + b.w, 0) || 1;
    const phase = rnd() * Math.PI * 2;
    const pal = o.pal || LEAF_PAL.generic;
    const coreIdx = o.corePal || C.leafDark;
    const coreMul = o.coreMul == null ? (lod === 'far' ? 0.95 : 0.9) : o.coreMul;
    const coreScale = lod === 'far' ? 0.76 : (lod === 'mid' ? 0.5 : 0.46);
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      const from = tr.pts[Math.min(tr.pts.length - 1, i === 0 ? tr.pts.length - 2 : tr.pts.length - 1)];
      addBranch(from, [b.cx, b.cy + b.ry * 0.15, b.cz], Math.max(0.06, trunkR * 0.4), 0.03, 4);
      if (i < 3 || b.rx > r * 0.5) {
        canopyCore(b.cx, b.cy, b.cz, Math.min(2.4, b.rx * coreScale), Math.min(2.0, b.ry * 1.0), Math.min(2.4, b.rz * coreScale), coreIdx, coreMul, { jitter: 0.42, idx2: pal[1] || C.leaf });
      }
    }
    const leafSize = (o.leafSize == null ? (lod === 'far' ? 1.35 : (lod === 'mid' ? 1.12 : 1.02)) : o.leafSize) * sizeBoost;
    const cells = o.cells || [ATLAS.leafA, ATLAS.leafB, ATLAS.leafC];
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      const bn = Math.max(2, Math.round((b.w / totalW) * n));
      foliageBlob(b.cx, b.cy, b.cz, b.rx, b.ry, b.rz, {
        n: bn, pal, cells, phase,
        amp: o.amp == null ? 0.16 : o.amp,
        size: leafSize,
        inner: lod === 'far' ? 0.1 : 0.18,
        maxSize: lod === 'far' ? 2.0 : (lod === 'mid' ? 1.8 : 1.4),
        mulLo: o.mulLo, mulHi: o.mulHi,
      });
    }
    plantStats.trees++;
    if (lod === 'far') plantStats.farTrees++;
    bumpPlant();
    return true;
  }

  // ── 花树（杏/桃/梨/梅/海棠）─────────────────────────────────────────────
  function buildBlossom(x, z, bloom, o = {}) {
    const lod = o.lod || 'near';
    const h = Math.max(6, Math.round(o.h || 10));
    const r = Math.max(1.8, o.r || h * 0.42);
    const st = treeSite(x, z, r);
    if (!st) return false;
    const g = st.g;
    const avail = fol.room('canopy');
    if (avail < (lod === 'far' ? 240 : (lod === 'mid' ? 500 : 900))) return false;
    const need = lod === 'far' ? 11000 : (lod === 'mid' ? 20000 : 32000);
    const dens = Math.min(1, Math.max(0.38, avail / need));
    const sizeBoost = dens < 0.85 ? Math.min(1.35, 1 + (0.85 - dens) * 1.1) : 1;
    const sizeF = Math.min(1.4, Math.max(0.72, h / 10));
    const sparse = !!o.sparse;
    const baseN = o.leaves || (lod === 'far' ? 115 : (lod === 'mid' ? 235 : (sparse ? 330 : 445)));
    const n = Math.max(28, Math.round(baseN * dens * sizeF * densityScale));
    const trunkH = Math.max(3.0, h * (o.trunkRatio || 0.42));
    const trunkR = o.trunkR == null ? (sparse ? 0.28 : 0.42) : o.trunkR;
    const tr = addTrunk(st.x, g, st.z, trunkH, {
      r0: trunkR,
      lean: o.lean == null ? rf(-1.1, 1.1) : o.lean,
      colors: woodCols(C.woodDark, C.wood, C.woodDark),
      sides: 4,
    });
    const top = tr.top;
    const topY = g + 1 + h;
    const blobs = blobLayout(sparse ? 'round' : (o.shape || 'round'), top[0], topY, top[2], r, h);
    if (sparse) for (const b of blobs) { b.rx *= 0.86; b.ry *= 0.94; b.rz *= 0.86; }
    const totalW = blobs.reduce((s, b) => s + b.w, 0) || 1;
    const phase = rnd() * Math.PI * 2;
    const coreIdx = bloom.base[0];
    // 花冠实心核用花色内层 → 远景是粉色云团
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      const from = tr.pts[Math.min(tr.pts.length - 1, i === 0 ? tr.pts.length - 2 : tr.pts.length - 1)];
      addBranch(from, [b.cx, b.cy + b.ry * 0.15, b.cz], Math.max(0.05, trunkR * 0.42), 0.025, 4);
      if (i < 3 || b.rx > r * 0.5) {
        canopyCore(b.cx, b.cy, b.cz, Math.min(2.4, b.rx * (lod === 'far' ? 0.78 : 0.44)), Math.min(2.0, b.ry * (lod === 'far' ? 0.92 : 0.6)), Math.min(2.4, b.rz * (lod === 'far' ? 0.78 : 0.44)),
          bloom.inner[0], lod === 'far' ? 1.0 : (lod === 'mid' ? 0.96 : 0.94),
          { jitter: 0.46, idx2: bloom.base[0] || bloom.inner[0] });
      }
    }
    // 梅：横斜细枝 + 枝梢花团
    if (sparse || chance(0.65)) {
      const nb = sparse ? ri(4, 6) : ri(2, 4);
      for (let i = 0; i < nb; i++) {
        const a = rnd() * Math.PI * 2 + i * 1.3;
        const len = r * rf(0.8, 1.5);
        const from = tr.pts[Math.max(0, tr.pts.length - 2)];
        const ex = from[0] + Math.cos(a) * len;
        const ez = from[2] + Math.sin(a) * len;
        const ey = from[1] + rf(0.4, 1.4) * len * 0.4;
        addBranch(from, [ex, ey, ez], 0.05, 0.02, 3);
        bloomTip(ex, ey, ez, bloom, phase, sparse, lod);
      }
    }
    const cells = o.cells || [ATLAS.bloomA, ATLAS.bloomB, ATLAS.crabapple];
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      const bn = Math.max(2, Math.round((b.w / totalW) * n));
      blossomBlob(b.cx, b.cy, b.cz, b.rx, b.ry, b.rz, bloom, {
        n: bn, phase, amp: o.amp == null ? 0.19 : o.amp,
        size: (sparse ? 0.68 : (lod === 'far' ? 1.3 : (lod === 'mid' ? 1.08 : 0.98))) * sizeBoost,
        maxSize: lod === 'far' ? 2.0 : (lod === 'mid' ? 1.8 : 1.4),
        cells, sparse,
      });
    }
    plantStats.trees++;
    if (lod === 'far') plantStats.farTrees++;
    bumpPlant();
    return true;
  }
  /** 枝梢花团（碎花外缘，让花树「满冠繁花」而不成球） */
  function bloomTip(ex, ey, ez, bloom, phase, sparse, lod) {
    const nn = lod === 'far' ? 2 : (sparse ? ri(4, 7) : ri(6, 11));
    for (let k = 0; k < nn; k++) {
      const a = rnd() * Math.PI * 2;
      const d = rf(0.05, sparse ? 0.6 : 0.85);
      const idx = pick(chance(0.5) ? bloom.base : bloom.edge);
      leaf('canopy', ex + Math.cos(a) * d, ey + rf(-0.18, 0.35), ez + Math.sin(a) * d,
        rf(0.34, 0.58), rf(0.34, 0.58), rnd() * Math.PI * 2, rf(-1.2, 1.2), rnd() * Math.PI * 2,
        idx, rf(0.8, 1.12), phase + rf(-0.6, 0.6), 0.15, pick([ATLAS.bloomA, ATLAS.bloomB, ATLAS.crabapple]));
    }
  }

  // ── 松（层叠平展针叶盘）────────────────────────────────────────────────
  function buildPine(x, z, o = {}) {
    const lod = o.lod || 'near';
    const h = Math.max(7, Math.round(o.h || (lod === 'far' ? 11 : 14)));
    const r = Math.max(2, o.r || (h * (lod === 'far' ? 0.38 : 0.34)));
    const st = treeSite(x, z, r);
    if (!st) return false;
    const g = st.g;
    const avail = fol.room('canopy');
    if (avail < (lod === 'far' ? 240 : (lod === 'mid' ? 500 : 900))) return false;
    const dens = Math.min(1, Math.max(0.38, avail / (lod === 'far' ? 11000 : (lod === 'mid' ? 20000 : 32000))));
    const sizeBoost = dens < 0.85 ? 1 + (0.85 - dens) * 1.1 : 1;
    const phase = rnd() * Math.PI * 2;
    const leanA = rnd() * Math.PI * 2;
    const lean = o.lean == null ? rf(-1.6, 1.6) : o.lean;
    const y0 = g + 1;
    const pts = [];
    const segs = 5;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const k = Math.sin(t * Math.PI * 0.85);
      pts.push([
        st.x + Math.cos(leanA) * lean * k + Math.cos(leanA + 1.4) * Math.sin(t * 5.2) * r * 0.14,
        y0 + h * 0.94 * t,
        st.z + Math.sin(leanA) * lean * k + Math.sin(leanA + 1.4) * Math.sin(t * 5.2) * r * 0.14,
      ]);
    }
    fol.wood.polyline(pts, o.trunkR == null ? 0.5 : o.trunkR, 0.11, 5, woodCols(C.woodDark, C.wood, C.woodDark));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + rf(0, 0.8);
      const len = rf(0.6, 1.2);
      fol.wood.prism(st.x + Math.cos(a) * 0.4, y0 + 0.05, st.z + Math.sin(a) * 0.4,
        st.x + Math.cos(a) * len, y0 + 0.1, st.z + Math.sin(a) * len, 0.2, 0.06, 4, linOf(C.woodDark), { mul: 0.9 });
    }
    const levels = h >= 14 ? 6 : 5;
    const totalN = Math.max(40, Math.round((o.leaves || (lod === 'far' ? 105 : (lod === 'mid' ? 190 : 300))) * dens * densityScale * Math.min(1.3, h / 13)));
    const needleSize = (lod === 'far' ? 1.7 : (lod === 'mid' ? 1.4 : 1.24)) * sizeBoost;
    for (let i = 0; i < levels; i++) {
      const f = levels === 1 ? 0.6 : i / (levels - 1);
      const py = y0 + h * (0.3 + 0.62 * f);
      const pr = Math.max(1.4, r * (1.0 - 0.62 * Math.abs(f - 0.48)));
      const a = rnd() * Math.PI * 2;
      const off = (1 - f) * r * 0.5;
      const pi = Math.min(segs, Math.round(f * segs));
      const cx = pts[pi][0] + Math.cos(a) * off;
      const cz = pts[pi][2] + Math.sin(a) * off;
      const rx = Math.max(1.3, pr * (1 + 0.28 * (i % 2 ? 1 : -1)));
      const rz = Math.max(1.2, pr * (1 - 0.15 * (i % 2 ? 1 : -1)));
      addBranch(pts[pi], [cx, py - 0.1, cz], 0.09, 0.03, 3);
      // 针叶盘实心核：拆成 3 块 ≤2m 小核（避免大扁盘渲染成巨型平面）
      for (let k = 0; k < 3; k++) {
        const ka = (k / 3) * Math.PI * 2 + i * 0.9;
        canopyCore(cx + Math.cos(ka) * rx * 0.4, py - 0.15 + (k === 1 ? 0.25 : 0),
          cz + Math.sin(ka) * rz * 0.4, Math.min(2.0, rx * 0.62), Math.max(0.4, Math.min(1.1, r * 0.14)),
          Math.min(2.0, rz * 0.62), pick([C.pineDark, C.pine]), 0.9, { lat: 3, lon: 8, jitter: 0.34 });
      }
      const pn = Math.max(4, Math.round(totalN * (1 - f * 0.3) / levels));
      for (let k = 0; k < pn; k++) {
        const aa = rnd() * Math.PI * 2;
        const dd = Math.sqrt(rnd()) * 0.96;
        const px = cx + Math.cos(aa) * rx * dd;
        const pz = cz + Math.sin(aa) * rz * dd;
        const pyy = py - dd * 0.2 + rf(-0.12, 0.12);
        const idx = pick(LEAF_PAL.pine);
        const mul = 0.62 + 0.34 * (1 - dd) + rf(-0.04, 0.08);
        leaf('canopy', px, pyy, pz, needleSize * rf(0.8, 1.2), needleSize * rf(0.78, 1.1),
          rnd() * Math.PI * 2, Math.PI * 0.5 + rf(-0.55, 0.55), rnd() * Math.PI * 2,
          idx, mul, phase + rf(-0.5, 0.5), 0.1, ATLAS.pine);
      }
    }
    const topP = pts[segs];
    for (let k = 0; k < Math.max(4, Math.round(16 * dens * densityScale)); k++) {
      const a = rnd() * Math.PI * 2;
      const dd = Math.sqrt(rnd()) * r * 0.3;
      leaf('canopy', topP[0] + Math.cos(a) * dd, topP[1] + rf(0, 0.55), topP[2] + Math.sin(a) * dd,
        needleSize * rf(0.7, 0.95), needleSize * rf(0.7, 0.95), rnd() * Math.PI * 2, Math.PI * 0.5 + rf(-0.4, 0.4), rnd() * Math.PI * 2,
        pick(LEAF_PAL.pine), rf(0.9, 1.14), phase + rf(-0.4, 0.4), 0.1, ATLAS.pine);
    }
    plantStats.trees++;
    if (lod === 'far') plantStats.farTrees++;
    bumpPlant();
    return true;
  }

  // ── 垂柳（上冠 + 长垂柳条：大幅摆动、远看绿帘）────────────────────────
  function buildWillow(x, z, o = {}) {
    const lod = o.lod || 'near';
    const h = Math.max(7, Math.round(o.h || 13));
    const r = Math.max(1.9, o.r || h * 0.34);
    const st = treeSite(x, z, r);
    if (!st) return false;
    const g = st.g;
    const avail = fol.room('canopy');
    if (avail < (lod === 'far' ? 240 : (lod === 'mid' ? 500 : 900))) return false;
    const dens = Math.min(1, Math.max(0.4, avail / (lod === 'far' ? 11000 : (lod === 'mid' ? 20000 : 32000))));
    const sizeBoost = dens < 0.85 ? 1 + (0.85 - dens) * 1.1 : 1;
    const phase = rnd() * Math.PI * 2;
    let wet = null;
    outer: for (let d = 1; d <= 4; d++) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if (isWater(st.x + dx * d, st.z + dz * d)) { wet = [dx * d, dz * d]; break outer; }
      }
    }
    const leanA = wet ? Math.atan2(wet[1], wet[0]) : rnd() * Math.PI * 2;
    const trunkH = Math.max(3.4, h * 0.52);
    const tr = addTrunk(st.x, g, st.z, trunkH, {
      r0: o.trunkR == null ? 0.46 : o.trunkR,
      lean: wet ? 1.4 : rf(-0.8, 0.8),
      leanAngle: leanA,
      colors: woodCols(C.wood, C.woodDark, C.wood),
      sides: 5,
    });
    const top = tr.top;
    const topY = g + 1 + h;
    const tips = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rf(0, 0.8) + leanA;
      const len = r * rf(0.7, 1.05);
      const to = [top[0] + Math.cos(a) * len, topY - r * rf(0.35, 0.75), top[2] + Math.sin(a) * len];
      addBranch(top, to, 0.12, 0.03, 4);
      tips.push(to);
    }
    // 实心核 + 上冠
    canopyCore(top[0], topY - r * 0.72, top[2], Math.min(2.4, r * 0.62), Math.min(1.8, r * 0.4), Math.min(2.4, r * 0.62), C.willow, lod === 'far' ? 1.0 : 0.92, { jitter: 0.42, idx2: C.leafLight });
    canopyCore(top[0], topY - r * 1.3, top[2], r * 0.46, r * 0.32, r * 0.46, C.willow2, 0.9, { jitter: 0.42, idx2: C.willow });
    canopyCore(top[0], topY - r * 2.0, top[2], r * 0.4, r * 0.42, r * 0.4, C.willow, 0.85, { jitter: 0.45 });
    const blobN = Math.max(20, Math.round((lod === 'far' ? 70 : (lod === 'mid' ? 135 : 225)) * dens * densityScale));
    foliageBlob(top[0], topY - r * 0.72, top[2], r, r * 0.56, r, {
      n: blobN, pal: LEAF_PAL.willow, cells: [ATLAS.leafB, ATLAS.leafA, ATLAS.leafC],
      phase, amp: 0.24, size: Math.min(lod === 'far' ? 2.0 : 1.35, (lod === 'far' ? 1.35 : 0.95) * sizeBoost), mulLo: 0.72, mulHi: 0.44, inner: 0.15,
    });
    foliageBlob(top[0], topY - r * 1.2, top[2], r * 0.7, r * 0.42, r * 0.7, {
      n: Math.max(6, Math.round((lod === 'far' ? 18 : 45) * dens * densityScale)), pal: LEAF_PAL.willow,
      cells: [ATLAS.leafB, ATLAS.leafA], phase, amp: 0.24, size: (lod === 'far' ? 1.1 : 0.72) * sizeBoost,
    });
    // 柳条：长垂、宽卡、大摆；另加大幅「绿帘」长卡保证远景
    const strands = Math.max(10, Math.round((o.strands || (lod === 'far' ? 66 : (lod === 'mid' ? 130 : 180))) * dens * densityScale));
    const bottom = g + 1 + 0.6;
    for (let i = 0; i < strands; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = r * rf(0.42, 1.02);
      const ax = top[0] + Math.cos(a) * rr;
      const az = top[2] + Math.sin(a) * rr;
      const topDrop = topY - r * rf(0.05, 1.0);
      const len = Math.max(1.0, Math.min(topDrop - bottom, rf(2.0, 4.2)));
      if (len < 0.8) continue;
      const idx = pick(LEAF_PAL.willow);
      hangLeaf('hang', ax, topDrop, az, Math.min(0.9, rf(0.55, 0.85) * sizeBoost), Math.min(3.0, len), a + Math.PI * 0.5,
        idx, rf(0.82, 1.12), phase + rf(-1.2, 1.2), rf(0.95, 1.4), ATLAS.willow);
    }
    for (let i = 0; i < (lod === 'far' ? 18 : 44); i++) {
      const a = rnd() * Math.PI * 2;
      const rr = r * rf(0.72, 1.02);
      const topDrop = topY - r * rf(0.05, 0.5);
      const len = Math.max(1.0, Math.min(topDrop - bottom, rf(1.4, 2.7)));
      hangLeaf('hang', top[0] + Math.cos(a) * rr, topDrop, top[2] + Math.sin(a) * rr,
        rf(0.7, 1.05) * sizeBoost, len, a + Math.PI * 0.5,
        pick(LEAF_PAL.willow), rf(0.85, 1.1), phase + rf(-1, 1), rf(1.05, 1.45), ATLAS.willow);
    }
    plantStats.trees++;
    plantStats.willows++;
    if (lod === 'far') plantStats.farTrees++;
    bumpPlant();
    return true;
  }

  // ── 竹（细长分节竹竿 + 竹叶成片）────────────────────────────────────────
  function buildBamboo(x, z, o = {}) {
    const lod = o.lod || 'near';
    const spread = o.spread == null ? 3.6 : Math.max(1, o.spread);
    const st0 = treeSite(x, z, spread + 2);
    if (!st0) return false;
    if (fol.room('bamboo') < 300) return false;
    const nCulm = Math.max(6, Math.min(40, Math.round((o.count || 9) * 2.4)));
    const baseH = Math.max(5, Math.round(o.h || (lod === 'far' ? 10 : 12)));
    const avail = fol.room('bamboo');
    const dens = Math.min(1, Math.max(0.4, avail / (lod === 'far' ? 9000 : 22000)));
    const sizeBoost = dens < 0.85 ? Math.min(1.3, 1 + (0.85 - dens) * 0.9) : 1;
    const phase = rnd() * Math.PI * 2;
    // 竹丛实心核：两根细高柱（不可用圆球，否则像修剪灌木）
    const clumpY = st0.g + 1;
    for (let i = 0; i < 2; i++) {
      const a = (i / 2) * Math.PI * 2 + rnd();
      canopyCore(st0.x + Math.cos(a) * spread * 0.4, clumpY + baseH * 0.5,
        st0.z + Math.sin(a) * spread * 0.4, spread * 0.3, Math.min(1.8, baseH * 0.2), spread * 0.3,
        pick([C.bambooLeaf3, C.leafDark]), lod === 'far' ? 0.95 : 0.85, { jitter: 0.45, lon: 7, lat: 3 });
    }
    let placedCulms = 0;
    for (let i = 0; i < nCulm; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * spread;
      const cx = st0.x + Math.round(Math.cos(a) * rr);
      const cz = st0.z + Math.round(Math.sin(a) * rr);
      const g = site(cx, cz, { clear: 1 });
      if (g < 0) continue;
      const hh = Math.max(4.5, baseH + rf(-1.5, 2.8));
      const leanA = rnd() * Math.PI * 2;
      const lean = rf(0.2, 2.0);
      const y0 = g + 1;
      const r0 = rf(0.05, 0.1);
      const nodes = Math.max(4, Math.round(hh / rf(1.5, 2.2)));
      const pts = [];
      for (let k = 0; k <= nodes; k++) {
        const t = k / nodes;
        const kk = Math.pow(t, 1.35);
        pts.push([cx + Math.cos(leanA) * lean * kk, y0 + hh * t, cz + Math.sin(leanA) * lean * kk]);
      }
      const stalk = linOf(C.bambooStalk);
      const node = linOf(C.bambooNode);
      for (let k = 0; k < nodes; k++) {
        const p0 = pts[k], p1 = pts[k + 1];
        const rr0 = r0 * (1 - 0.3 * (k / nodes));
        const rr1 = r0 * (1 - 0.3 * ((k + 1) / nodes));
        fol.wood.prism(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], rr0, rr1 * 0.94, 3,
          k % 2 ? node : stalk, { mul: 0.95 + 0.1 * rnd(), capTop: false });
        // 节点只用颜色带表达（省面数，远景看不出几何节环）
        if (k % 3 === 2) fol.wood.prism(p1[0], p1[1] - 0.02, p1[2], p1[0], p1[1] + 0.02, p1[2], rr1 * 1.22, rr1 * 1.22, 3, node, { capTop: false });
      }
      // 竹叶：上部多处叶簇（成片）
      const sprays = Math.max(1, Math.round((lod === 'far' ? 2 : 3) * dens));
      for (let s = 0; s < sprays; s++) {
        const t = 0.55 + 0.45 * (s / Math.max(1, sprays - 1));
        const base = pts[Math.min(nodes, Math.round(nodes * t))];
        const sa = rnd() * Math.PI * 2;
        const sd = rf(0.3, 1.5);
        const bx = base[0] + Math.cos(sa) * sd;
        const bz = base[2] + Math.sin(sa) * sd;
        const by = base[1] + rf(-0.2, 0.5);
        const per = Math.max(3, Math.round((lod === 'far' ? 5 : 12) * dens));
        for (let q = 0; q < per; q++) {
          const aa = sa + rf(-1.2, 1.2);
          const sz = Math.min(lod === 'far' ? 1.7 : 1.35, (lod === 'far' ? rf(1.1, 1.6) : rf(0.78, 1.22)) * sizeBoost);
          leaf('bamboo', bx + Math.cos(aa) * rf(0, 1.3), by + rf(-0.55, 0.55), bz + Math.sin(aa) * rf(0, 1.3),
            sz, sz * rf(0.7, 1.0), rnd() * Math.PI * 2, rf(-1.15, 1.15), rnd() * Math.PI * 2,
            pick(LEAF_PAL.bamboo), rf(0.72, 1.15), phase + rf(-0.8, 0.8), rf(0.16, 0.32), ATLAS.bamboo);
        }
      }
      for (let q = 0; q < 16; q++) {
        const sz = Math.min(lod === 'far' ? 1.6 : 1.3, (lod === 'far' ? rf(1.0, 1.45) : rf(0.72, 1.1)) * sizeBoost);
        leaf('bamboo', pts[nodes][0] + rf(-0.4, 0.4), pts[nodes][1] + rf(-0.1, 0.5), pts[nodes][2] + rf(-0.4, 0.4),
          sz, sz, rnd() * Math.PI * 2, rf(-1.0, 1.0), rnd() * Math.PI * 2,
          pick(LEAF_PAL.bamboo), rf(0.85, 1.15), phase + rf(-0.5, 0.5), 0.18, ATLAS.bamboo);
      }
      placedCulms++;
    }
    if (placedCulms) {
      plantStats.bamboo++;
      bumpPlant();
    }
    return placedCulms > 0;
  }

  // ── 芭蕉（假茎 + 放射大叶）──────────────────────────────────────────────
  function buildBanana(x, z, o = {}) {
    const st = treeSite(x, z, 2.8);
    if (!st) return false;
    const g = st.g;
    const stemH = Math.max(1.6, o.h || rf(2.2, 3.2));
    const phase = rnd() * Math.PI * 2;
    fol.wood.polyline([[st.x, g + 1, st.z], [st.x + rf(-0.1, 0.1), g + 1 + stemH * 0.55, st.z + rf(-0.1, 0.1)], [st.x, g + 1 + stemH, st.z]],
      rf(0.2, 0.3), 0.12, 4, woodCols(C.leafDark, C.leaf), { capTop: true });
    const nL = Math.max(6, Math.round(o.leaves || ri(8, 12)));
    const topY = g + 1 + stemH;
    // 冠心实心核（小）
    canopyCore(st.x, topY + 0.4, st.z, 0.9, 0.7, 0.9, C.leafDark, 0.75, { lon: 6, lat: 2 });
    for (let i = 0; i < nL; i++) {
      const a = (i / nL) * Math.PI * 2 + rf(0, 0.5);
      const elev = rf(-0.4, 0.7);
      const len = rf(1.5, 2.8);
      const wid = rf(0.65, 1.05);
      const ca = Math.cos(a), sa = Math.sin(a);
      const ce = Math.cos(elev), se = Math.sin(elev);
      _card.x = st.x; _card.y = topY - rf(0, 0.3); _card.z = st.z;
      const idx = pick(LEAF_PAL.banana);
      const c = linOf(idx);
      const mul = rf(0.8, 1.12);
      _card.r = c[0] * mul; _card.g = c[1] * mul; _card.b = c[2] * mul;
      _card.phase = phase + rf(-0.6, 0.6);
      _card.amp = 0.2;
      _card.cell = ATLAS.banana;
      _card.rx = -sa * wid; _card.ry = 0; _card.rz = ca * wid;
      _card.ux = ca * ce * len; _card.uy = se * len; _card.uz = sa * ce * len;
      fol.addCard('canopy', _card);
    }
    for (let i = 0; i < 3; i++) {
      leaf('canopy', st.x + rf(-0.2, 0.2), topY - 0.15, st.z + rf(-0.2, 0.2), 0.45, 1.25,
        rnd() * Math.PI * 2, rf(0.1, 0.45), 0, C.leafLight, 1.05, phase, 0.18, ATLAS.banana);
    }
    plantStats.trees++;
    bumpPlant();
    return true;
  }

  // ── 灌木 ────────────────────────────────────────────────────────────────
  function buildShrub(x, z, o = {}) {
    const r = Math.max(1, o.r || 2.4);
    const st = treeSite(x, z, r + 0.6);
    if (!st) return false;
    const g = st.g;
    const avail = fol.room('canopy');
    if (avail < 500) return false;
    const colors = o.c ? (Array.isArray(o.c) ? o.c : [o.c]) : LEAF_PAL.shrub;
    const bloomCols = colors.filter(isBloomColor);
    const greener = colors.filter((c) => !isBloomColor(c));
    const pal = greener.length ? greener : LEAF_PAL.shrub;
    const phase = rnd() * Math.PI * 2;
    const twigs = ri(2, 3);
    for (let i = 0; i < twigs; i++) {
      const a = (i / twigs) * Math.PI * 2 + rf(0, 0.9);
      const len = r * rf(0.5, 0.9);
      fol.wood.prism(st.x, g + 1, st.z,
        st.x + Math.cos(a) * len, g + 1 + r * rf(0.5, 0.95), st.z + Math.sin(a) * len,
        0.07, 0.025, 3, linOf(C.woodDark), { mul: 0.95 });
    }
    const cy = g + 1 + r * 0.66;
    canopyCore(st.x, cy, st.z, r * 0.3, r * 0.26, r * 0.3,
      bloomCols.length && chance(0.5) ? bloomCols[0] : pick([C.leafDark, C.leaf]), 0.88, { jitter: 0.55 });
    const n = Math.max(16, Math.round((o.leaves || (135 + r * 42)) * Math.min(1, avail / 12000) * densityScale));
    const size = (o.size || 0.98) * (avail < 8000 ? 1.2 : 1);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const sxy = Math.sqrt(Math.max(0, 1 - u * u));
      const rr = 0.42 + 0.62 * Math.pow(rnd(), 0.4);
      const px = st.x + sxy * Math.cos(th) * r * rr;
      const pz = st.z + sxy * Math.sin(th) * r * rr;
      const py = cy + u * r * 0.8 * rr;
      const isB = bloomCols.length && chance(0.28);
      const cs = isB ? bloomCols : pal;
      const cell = isB ? pick([ATLAS.bloomB, ATLAS.crabapple, ATLAS.bloomA]) : pick([ATLAS.leafA, ATLAS.leafC, ATLAS.leafB]);
      const mul = 0.74 + 0.34 * (u * 0.5 + 0.5) + rf(-0.05, 0.08);
      leaf('canopy', px, py, pz, size * rf(0.85, 1.2), size * rf(0.85, 1.2),
        rnd() * Math.PI * 2, rf(-1.3, 1.3), rnd() * Math.PI * 2,
        pick(cs), mul, phase + rf(-0.5, 0.5), 0.09, cell);
    }
    plantStats.shrubs++;
    bumpPlant();
    return true;
  }

  // ── 乔木物种入口（冠形/色表各不相同；h/r 可由场景覆盖）─────────────────
  function tree(x, z, o = {}) {
    return buildBroadleaf(x, z, {
      lod: o.lod || defaultTreeLod,
      h: 12, r: 4.6, shape: 'round',
      pal: o.colors ? (Array.isArray(o.colors) ? o.colors : [o.colors]) : LEAF_PAL.generic,
      ...o,
    });
  }
  function wutong(x, z, o = {}) {
    return buildBroadleaf(x, z, {
      lod: o.lod || defaultTreeLod,
      h: 14, r: 5.8, shape: 'flat', pal: LEAF_PAL.wutong,
      cells: [ATLAS.palmate, ATLAS.leafA, ATLAS.palmate], trunkColors: woodCols(C.woodLight, C.wood, C.woodLight),
      trunkR: 0.36, leafSize: 0.9, ...o,
    });
  }
  function elm(x, z, o = {}) {
    return buildBroadleaf(x, z, {
      lod: o.lod || defaultTreeLod, h: 13, r: 5.0, shape: 'vase', pal: LEAF_PAL.elm, leafSize: 0.82, ...o });
  }
  function locust(x, z, o = {}) {
    return buildBroadleaf(x, z, {
      lod: o.lod || defaultTreeLod, h: 12, r: 5.2, shape: 'flat', pal: LEAF_PAL.locust, leafSize: 0.8, ...o });
  }
  function mulberry(x, z, o = {}) {
    return buildBroadleaf(x, z, {
      lod: o.lod || defaultTreeLod, h: 9, r: 3.8, shape: 'small', pal: LEAF_PAL.mulberry, leafSize: 0.72, ...o });
  }
  function ginkgo(x, z, o = {}) {
    return buildBroadleaf(x, z, {
      lod: o.lod || defaultTreeLod,
      h: 13, r: 4.2, shape: 'conical', pal: LEAF_PAL.ginkgo,
      cells: [ATLAS.ginkgo, ATLAS.ginkgo, ATLAS.leafC], trunkColors: woodCols(C.woodLight, C.wood),
      leafSize: 0.72, ...o,
    });
  }
  function apricot(x, z, o = {}) {
    if (o.bloom === false) return buildBroadleaf(x, z, { h: 10, r: 4.2, pal: LEAF_PAL.generic, lod: o.lod || defaultTreeLod, ...o });
    return buildBlossom(x, z, BLOOM.apricot, {
      lod: o.lod || defaultTreeLod, h: 10, r: 4.2, trunkRatio: 0.45, ...o });
  }
  function peach(x, z, o = {}) {
    return buildBlossom(x, z, BLOOM.peach, {
      lod: o.lod || defaultTreeLod, h: 9.5, r: 3.9, trunkRatio: 0.45, ...o });
  }
  function plum(x, z, o = {}) {
    return buildBlossom(x, z, o.red ? BLOOM.plumRed : BLOOM.plumWhite, {
      h: o.h || 9, r: o.red ? 3.2 : 3.7, trunkRatio: 0.45, sparse: !!o.red, ...o,
    });
  }
  function pear(x, z, o = {}) {
    return buildBlossom(x, z, BLOOM.pear, {
      lod: o.lod || defaultTreeLod, h: 10, r: 4.0, trunkRatio: 0.45, ...o });
  }
  function crabapple(x, z, o = {}) {
    return buildBlossom(x, z, BLOOM.crabapple, {
      lod: o.lod || defaultTreeLod,
      h: 11, r: 4.8, cells: [ATLAS.crabapple, ATLAS.bloomA, ATLAS.crabapple], ...o,
    });
  }
  function pine(x, z, o = {}) {
    return buildPine(x, z, { lod: o.lod || defaultTreeLod, ...o });
  }
  function willow(x, z, o = {}) {
    return buildWillow(x, z, { lod: o.lod || defaultTreeLod, ...o });
  }
  function bamboo(x, z, o = {}) {
    return buildBamboo(x, z, { lod: o.lod || defaultTreeLod, ...o });
  }
  function banana(x, z, o = {}) {
    return buildBanana(x, z, o);
  }
  function shrub(x, z, o = {}) {
    return buildShrub(x, z, o);
  }

  // ───────────── 地被 · 草叶 ─────────────
  /** 细草叶簇（近景可见、随风轻颤） */
  function grassTuft(x, z, o = {}) {
    if (fol.groundRoom() < 30) return false;
    x = Math.round(x); z = Math.round(z);
    const g = groundSite(x, z);
    if (g < 0 || isPath(x, z) || reservedAt(x, z)) return false;
    const cols = o.c ? (Array.isArray(o.c) ? o.c : [o.c]) : LEAF_PAL.grass;
    const y0 = g + 1;
    // 大草垫卡：斜铺在地面，远景形成连续草色微起伏
    if (chance(o.mat != null ? o.mat : 0.8)) {
      const ma = rnd() * Math.PI * 2;
      leaf('ground', x + rf(-0.6, 0.6), y0 - 0.03, z + rf(-0.6, 0.6), rf(1.2, 1.8), rf(0.8, 1.15),
        ma, rf(1.3, 1.52), rf(-0.5, 0.5),
        pick(cols), rf(0.95, 1.25), rnd() * 6.283, rf(0.03, 0.07), ATLAS.grass);
    }
    const n = o.n || (lowQ ? 2 : 3 + (rnd() < 0.6 ? 1 : 0));
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const dx = Math.cos(a) * rf(0, 0.38), dz = Math.sin(a) * rf(0, 0.38);
      const hh = rf(0.42, 0.9);
      leaf('ground', x + dx, y0 - 0.02, z + dz, rf(0.62, 1.08), hh,
        a, rf(-0.25, 0.25), rf(-0.35, 0.35),
        pick(cols), rf(0.9, 1.28), rnd() * 6.283, rf(0.03, 0.1), ATLAS.grass);
    }
    return true;
  }

  // 花色 → 花卡格子（粉/桃色用花团，黄白用野花头）
  function cellForFlower(idx) {
    const p = PALETTE[idx];
    if (!p) return ATLAS.wildflower;
    if (p.r > 195 && p.g < 200 && p.r - p.g > 20) return ATLAS.bloomA;
    return ATLAS.wildflower;
  }
  const CROP_NAMES = new Set(['vegetable', 'rice', 'leaf', 'leafLight', 'leafDark', 'leafYellow', 'grass', 'grass2', 'grass3', 'grassDry', 'bambooLeaf', 'bambooLeaf2', 'bambooLeaf3']);
  const isCropColor = (idx) => { const p = PALETTE[idx]; return !!p && CROP_NAMES.has(p.name); };

  // ───────────── 花圃（成畦：茎 + 花头；菜畦为细叶丛）─────────────
  function flowerPatch(x1, z1, x2, z2, o = {}) {
    if (fol.groundRoom() < 120) return 0;
    const ax1 = Math.round(Math.min(x1, x2)), ax2 = Math.round(Math.max(x1, x2));
    const az1 = Math.round(Math.min(z1, z2)), az2 = Math.round(Math.max(z1, z2));
    const colors = o.colors || [C.chrys, C.peony, C.lotusFlower, C.plumWhite];
    const count = Math.max(4, Math.round((o.count || 60) * 1.6));
    const crop = o.crop != null ? !!o.crop : colors.every(isCropColor);
    const alongX = (ax2 - ax1) >= (az2 - az1);
    const rowGap = Math.max(1, o.rowGap || 3);
    const plantGap = Math.max(1, o.plantGap || 2);
    const bedC = o.bedC || (chance(0.5) ? C.soilDark : C.farm);
    let placed = 0;
    const oMin = alongX ? az1 : ax1, oMax = alongX ? az2 : ax2;
    const iMin = alongX ? ax1 : az1, iMax = alongX ? ax2 : az2;
    const density = Math.min(1, Math.max(0.4, fol.groundRoom() / 12000));
    for (let a = oMin + 1; a <= oMax - 1 && placed < count; a += rowGap) {
      for (let b = iMin + 1; b <= iMax - 1 && placed < count; b += plantGap) {
        const px = alongX ? b : a;
        const pz = alongX ? a : b;
        if (Math.abs(px) > LIMIT || Math.abs(pz) > LIMIT) continue;
        const g = openBed(px, pz);
        if (g < 0) continue;
        tintGround(px, pz, bedC, true);
        const y0 = g + 1;
        if (crop) {
          // 菜畦/稻茎：细叶丛
          for (let k = 0; k < 4; k++) {
            const ca = rnd() * Math.PI * 2;
            leaf('ground', px + Math.cos(ca) * 0.25, y0 - 0.02, pz + Math.sin(ca) * 0.25,
              rf(0.3, 0.46), rf(0.38, 0.75), ca, rf(-0.2, 0.2), rf(-0.3, 0.3),
              pick(colors), rf(0.85, 1.1), rnd() * 6.283, rf(0.04, 0.09), ATLAS.grass);
          }
        } else {
          const stemH = rf(0.38, 0.78);
          const stemIdx = pick([C.leafDark, C.leaf, C.vegetable]);
          leaf('ground', px, y0 - 0.02, pz, rf(0.13, 0.2), stemH,
            rnd() * Math.PI * 2, rf(-0.15, 0.15), 0, stemIdx, rf(0.85, 1.05),
            rnd() * 6.283, rf(0.04, 0.08), ATLAS.grass);
          // 花头
          const heads = chance(0.45) ? 2 : 1;
          for (let k = 0; k < heads; k++) {
            const idx = pick(colors);
            const ca = rnd() * Math.PI * 2;
            const ox = Math.cos(ca) * rf(0, 0.18), oz = Math.sin(ca) * rf(0, 0.18);
            leaf('flower', px + ox, y0 + stemH * rf(0.75, 0.98), pz + oz,
              rf(0.34, 0.56), rf(0.32, 0.54), ca, rf(-0.35, 0.35), rnd() * Math.PI * 2,
              idx, rf(0.85, 1.12), rnd() * 6.283, rf(0.05, 0.1), cellForFlower(idx));
          }
        }
        placed++;
        if (density < 0.75 && chance(0.4)) continue;
      }
    }
    if (placed) bumpPlant();
    return placed;
  }

  // ───────────── 芍药/牡丹圃 ─────────────
  function peonyBed(x1, z1, x2, z2, o = {}) {
    if (fol.groundRoom() < 200) return 0;
    const ax1 = Math.round(Math.min(x1, x2)), ax2 = Math.round(Math.max(x1, x2));
    const az1 = Math.round(Math.min(z1, z2)), az2 = Math.round(Math.max(z1, z2));
    const colors = o.colors || [C.peony, C.peony2, C.plumWhite];
    const area = Math.max(1, (ax2 - ax1 + 1) * (az2 - az1 + 1));
    const count = Math.max(6, Math.round((o.count || Math.min(160, area / 8)) * 1.35));
    const alongX = (ax2 - ax1) >= (az2 - az1);
    const rowGap = Math.max(2, o.rowGap || 3);
    const plantGap = Math.max(2, o.plantGap || 3);
    const bedC = o.bedC || C.soilDark;
    const density = Math.min(1, Math.max(0.4, fol.groundRoom() / 14000));
    let placed = 0;
    const oMin = alongX ? az1 : ax1, oMax = alongX ? az2 : ax2;
    const iMin = alongX ? ax1 : az1, iMax = alongX ? ax2 : az2;
    for (let a = oMin + 1; a <= oMax - 1 && placed < count; a += rowGap) {
      for (let b = iMin + 1; b <= iMax - 1 && placed < count; b += plantGap) {
        const px = alongX ? b : a;
        const pz = alongX ? a : b;
        if (Math.abs(px) > LIMIT || Math.abs(pz) > LIMIT) continue;
        const g = openBed(px, pz);
        if (g < 0) continue;
        tintGround(px, pz, bedC, true);
        const y0 = g + 1;
        // 叶丛（低矮、外倾）
        for (let k = 0; k < 4; k++) {
          const la = (k / 3) * Math.PI * 2 + rf(0, 0.6);
          leaf('ground', px + Math.cos(la) * 0.22, y0 + rf(0.02, 0.12), pz + Math.sin(la) * 0.22,
            rf(0.26, 0.4), rf(0.26, 0.4), la + Math.PI * 0.5, rf(0.7, 1.2), rnd() * Math.PI * 2,
            pick([C.leafDark, C.leaf]), rf(0.72, 0.98), rnd() * 6.283, rf(0.04, 0.08),
            pick([ATLAS.leafC, ATLAS.leafB]));
        }
        // 茎 + 花头（牡丹大、芍药稍小）
        const big = chance(0.35);
        const stemH = big ? rf(0.6, 0.95) : rf(0.42, 0.72);
        leaf('ground', px, y0 - 0.02, pz, rf(0.14, 0.2), stemH, rnd() * Math.PI * 2, rf(-0.12, 0.12), 0,
          C.leafDark, 0.9, rnd() * 6.283, rf(0.04, 0.08), ATLAS.grass);
        const heads = chance(0.22) ? 2 : 1;
        for (let k = 0; k < heads; k++) {
          const idx = pick(colors);
          const ca = rnd() * Math.PI * 2;
          leaf('flower', px + Math.cos(ca) * 0.16, y0 + stemH * rf(0.82, 1.0), pz + Math.sin(ca) * 0.16,
            rf(0.46, 0.78), rf(0.44, 0.72), ca, rf(-0.3, 0.25), rnd() * Math.PI * 2,
            idx, rf(0.86, 1.12), rnd() * 6.283, rf(0.06, 0.12), ATLAS.peony);
        }
        placed++;
        if (density < 0.75 && chance(0.35)) continue;
      }
    }
    if (placed) bumpPlant();
    return placed;
  }

  // ───────────── 芦苇丛（细秆 + 芦花穗，摆动明显）─────────────
  function reedBed(x1, z1, x2, z2, o = {}) {
    if (fol.room('reed') < 120) return 0;
    const ax1 = Math.round(Math.min(x1, x2)), ax2 = Math.round(Math.max(x1, x2));
    const az1 = Math.round(Math.min(z1, z2)), az2 = Math.round(Math.max(z1, z2));
    const area = Math.max(1, (ax2 - ax1 + 1) * (az2 - az1 + 1));
    const clumpCap = o.count != null ? Math.min(o.count, 26) : Math.max(4, Math.min(26, Math.round(area / 10)));
    const clumps = Math.max(2, Math.round(clumpCap));
    const density = Math.min(1, Math.max(0.4, fol.room('reed') / 8000));
    let placed = 0;
    for (let c = 0; c < clumps; c++) {
      const cx = ri(ax1, ax2), cz = ri(az1, az2);
      const g = groundSite(cx, cz);
      if (g < 0 || isPath(cx, cz)) continue;
      const y0 = g + 1;
      const stems = Math.max(5, Math.round((o.stems || 14) * density * rf(0.7, 1.35)));
      for (let s = 0; s < stems; s++) {
        const px = cx + rf(-1.7, 1.7), pz = cz + rf(-1.7, 1.7);
        const g2 = groundSite(px, pz);
        if (g2 < 0 || isPath(px, pz)) continue;
        const hh = rf(1.6, 3.3);
        const y = g2 + 1;
        const a = rnd() * Math.PI * 2;
        const idx = pick(LEAF_PAL.reed);
        leaf('reed', px, y - 0.03, pz, Math.min(1.1, rf(0.42, 0.72)), hh, a, rf(-0.14, 0.14), rf(-0.3, 0.3),
          idx, rf(0.8, 1.12), rnd() * 6.283, rf(0.32, 0.65), ATLAS.reed);
        // 芦花穗
        if (chance(0.55)) {
          leaf('reed', px, y + hh * rf(0.8, 0.98), pz, Math.min(1.1, rf(0.52, 0.86)), rf(0.55, 1.05),
            a, rf(-0.2, 0.2), rf(-0.2, 0.2), C.plumWhite, 1.0,
            rnd() * 6.283, rf(0.15, 0.3), ATLAS.plume);
        }
        placed++;
      }
    }
    if (placed) bumpPlant();
    return placed;
  }

  // ───────────── 荷（圆盘 + 荷花；严格水面）─────────────
  const wetFree = (x, z) => isWater(x, z) && w.get(x, 3, z) === 0 && w.get(x, 4, z) === 0;
  function lotus(cx, cz, rx, rz, o = {}) {
    if (fol.room('water') < 60) return 0;
    cx = Math.round(cx); cz = Math.round(cz);
    rx = Math.max(1, Math.round(rx)); rz = Math.max(1, Math.round(rz));
    const count = Math.max(4, Math.round(o.count || 50));
    const density = Math.min(1, Math.max(0.4, fol.room('water') / 5000));
    const target = Math.max(2, Math.round(count * density));
    let pads = 0;
    for (let i = 0; i < count * 4 && pads < target; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd());
      const x = Math.round(cx + Math.cos(a) * rx * rr);
      const z = Math.round(cz + Math.sin(a) * rz * rr);
      if (!wetFree(x, z)) continue;
      const d = rf(0.9, 1.75);
      const y = WATER_Y + 0.05 + rf(0, 0.03);
      const idx = pick(LEAF_PAL.lotus);
      const mul = rf(0.78, 1.08);
      flatLeaf('water', x + rf(-0.2, 0.2), y, z + rf(-0.2, 0.2), d, d * rf(0.82, 1.0),
        rnd() * Math.PI * 2, rf(-0.09, 0.09), rnd() * Math.PI * 2,
        idx, mul, rnd() * 6.283, rf(0.02, 0.05), ATLAS.pad);
      pads++;
      // 少量荷钱/浮萍点缀
      if (chance(0.06) && fol.room('water') > 100) {
        flatLeaf('water', x + rf(-1.4, 1.4), y + 0.01, z + rf(-1.4, 1.4), rf(0.24, 0.44), rf(0.24, 0.4),
          rnd() * Math.PI * 2, rf(-0.1, 0.1), rnd() * Math.PI * 2,
          pick([C.leafLight, C.lotusPad2]), rf(0.85, 1.1), rnd() * 6.283, 0.025, ATLAS.waterleaf);
      }
    }
    // 荷花
    const flowers = Math.max(1, Math.round(o.flowers != null ? o.flowers * 1.4 : target * 0.12));
    let fl = 0;
    for (let i = 0; i < flowers * 6 && fl < flowers; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd());
      const x = Math.round(cx + Math.cos(a) * rx * rr);
      const z = Math.round(cz + Math.sin(a) * rz * rr);
      if (!wetFree(x, z)) continue;
      const hh = rf(0.7, 1.15);
      leaf('water', x, WATER_Y + hh * 0.5, z, rf(0.46, 0.68), hh,
        rnd() * Math.PI * 2, rf(-0.18, 0.18), 0, C.plumWhite, rf(0.92, 1.06),
        rnd() * 6.283, rf(0.02, 0.05), ATLAS.lotusFlower);
      fl++;
    }
    bumpPlant();
    return pads;
  }

  /** 荇菜/浮萍小片（水面点缀，scatter 使用） */
  function floatPatch(x, z, o = {}) {
    if (fol.room('water') < 20) return false;
    x = Math.round(x); z = Math.round(z);
    if (!wetFree(x, z)) return false;
    const n = o.n || ri(2, 5);
    for (let i = 0; i < n; i++) {
      const px = x + rf(-1.2, 1.2), pz = z + rf(-1.2, 1.2);
      flatLeaf('water', px, WATER_Y + 0.04, pz, rf(0.2, 0.46), rf(0.2, 0.42),
        rnd() * Math.PI * 2, rf(-0.08, 0.08), rnd() * Math.PI * 2,
        pick([C.leafLight, C.lotusPad2, C.leaf]), rf(0.8, 1.1), rnd() * 6.283, rf(0.01, 0.03), ATLAS.waterleaf);
    }
    return true;
  }

  // ───────────── 藤萝/蔷薇/荼蘼棚架 ─────────────
  function vine(a, b, c, d, e) {
    let o;
    if (a && typeof a === 'object') o = a;
    else o = { x1: a, z1: b, x2: c, z2: d, ...(e || {}) };
    const xa = Math.round(o.x1 ?? 0), za = Math.round(o.z1 ?? 0);
    const xb = Math.round(o.x2 ?? xa + 4), zb = Math.round(o.z2 ?? za + 2);
    const x1 = Math.min(xa, xb), x2 = Math.max(xa, xb);
    const z1 = Math.min(za, zb), z2 = Math.max(za, zb);
    if (Math.abs(x1) > LIMIT || Math.abs(x2) > LIMIT || Math.abs(z1) > LIMIT || Math.abs(z2) > LIMIT) return;
    if (fol.room('canopy') < 60) return;
    const leafC = o.leafC || C.leafLight;
    const leafs = Array.isArray(o.leafs) ? o.leafs : [leafC, C.leaf, C.leafLight];
    const topArr = o.topC ? (Array.isArray(o.topC) ? o.topC : [o.topC]) : null;
    const W = Math.max(1, x2 - x1), D = Math.max(1, z2 - z1);
    // 棚顶高度
    let y = o.y;
    if (!Number.isFinite(y)) {
      let g0 = terrainTop(x1, z1);
      for (const [px, pz] of [[x2, z2], [x1, z2], [x2, z1]]) { const gg = terrainTop(px, pz); if (gg > g0) g0 = gg; }
      y = (g0 >= 0 ? g0 : 3) + 5;
    }
    y = Math.round(y);
    const H = Math.max(2, y - (terrainTop(x1, z1) + 1));
    // 立柱（沿两条长边每 ~4m 一根）
    const longX = W >= D;
    const step = 4;
    const pts = [];
    if (longX) {
      for (let x = x1; x <= x2; x += step) { pts.push([x, z1], [x, z2]); }
      pts.push([x2, z1], [x2, z2]);
    } else {
      for (let z = z1; z <= z2; z += step) { pts.push([x1, z], [x2, z]); }
      pts.push([x1, z2], [x2, z2]);
    }
    const seen = new Set();
    for (const [px, pz] of pts) {
      const k = px + ',' + pz;
      if (seen.has(k)) continue;
      seen.add(k);
      const g = terrainTop(px, pz);
      if (g < 0) continue;
      const rr = (px === x1 || px === x2) && (pz === z1 || pz === z2) ? 0.13 : 0.1;
      fol.wood.prism(px, g + 1, pz, px, y, pz, rr, rr * 0.8, 5, linOf(C.wood), { mul: rf(0.92, 1.05) });
    }
    // 顶架：两长边梁 + 横撑
    const beamC = linOf(C.woodDark);
    fol.wood.prism(x1, y, z1, x2, y, z1, 0.09, 0.09, 4, beamC);
    fol.wood.prism(x1, y, z2, x2, y, z2, 0.09, 0.09, 4, beamC);
    fol.wood.prism(x1, y, z1, x1, y, z2, 0.09, 0.09, 4, beamC);
    fol.wood.prism(x2, y, z1, x2, y, z2, 0.09, 0.09, 4, beamC);
    if (longX) {
      for (let x = x1 + 2; x < x2; x += 2) fol.wood.prism(x, y, z1, x, y, z2, 0.05, 0.05, 3, beamC);
    } else {
      for (let z = z1 + 2; z < z2; z += 2) fol.wood.prism(x1, y, z, x2, y, z, 0.05, 0.05, 3, beamC);
    }
    const phase = rnd() * Math.PI * 2;
    // 顶面实心绿核：沿棚架跨度切成 ≤4m 的小片（单块半径 ≤2m，绝不允许跨十几米的大平面）
    const slabStep = 4;
    for (let sx = x1; sx <= x2; sx += slabStep) {
      for (let sz = z1; sz <= z2; sz += slabStep) {
        const cx = Math.min(x2 - 0.4, sx + slabStep * 0.5);
        const cz = Math.min(z2 - 0.4, sz + slabStep * 0.5);
        const rx = Math.min(2.0, slabStep * 0.5 + 0.6);
        const rz = Math.min(2.0, slabStep * 0.5 + 0.6);
        canopyCore(cx, y + 0.32, cz, rx * 0.9, 0.4, rz * 0.9,
          C.leaf, 0.85, { lat: 2, lon: 7, jitter: 0.22 });
      }
    }
    // 顶面藤叶（密铺，留缝）
    const covN = Math.min(190, Math.max(16, Math.round((W + 2) * (D + 2) * 3.6)));
    for (let i = 0; i < covN; i++) {
      const px = rf(x1 - 0.2, x2 + 0.2), pz = rf(z1 - 0.2, z2 + 0.2);
      const py = y + rf(0.18, 0.62);
      const idx = challengePick(topArr, leafs);
      flatLeaf('canopy', px, py, pz, rf(0.66, 1.02), rf(0.62, 0.96),
        rnd() * Math.PI * 2, rf(-0.5, 0.5), rnd() * Math.PI * 2,
        idx, rf(0.7, 1.15), phase + rf(-0.6, 0.6), rf(0.04, 0.09),
        topArr && chance(0.2) ? pick([ATLAS.bloomA, ATLAS.bloomB]) : pick([ATLAS.leafA, ATLAS.leafB, ATLAS.leafC]));
    }
    // 垂藤（棚缘 + 内部垂挂，梢头带花）
    const perim = 2 * (W + D);
    const drops = Math.min(46, Math.max(8, Math.round(perim * 0.9 * densityScale)));
    for (let i = 0; i < drops; i++) {
      let dx, dz;
      if (chance(0.7)) {
        if (longX) { dx = ri(x1, x2); dz = chance(0.5) ? z1 : z2; }
        else { dz = ri(z1, z2); dx = chance(0.5) ? x1 : x2; }
      } else { dx = rf(x1, x2); dz = rf(z1, z2); }
      const len = rf(0.5, 1.7);
      const idx = challengePick(topArr, leafs);
      hangLeaf('hang', dx, y + 0.1, dz, rf(0.2, 0.34), len, rnd() * Math.PI * 2,
        idx, rf(0.85, 1.1), phase + rf(-1, 1), rf(0.15, 0.35), ATLAS.leafC);
    }
    bumpPlant();
  }
  function challengePick(a, b) {
    if (a && a.length && chance(0.3)) return pick(a);
    return pick(b);
  }

  // ───────────── 山石（体素：与园中山石语言一致）─────────────
  function put(x, y, z, c) {
    if (!c) return false;
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    if (Math.abs(x) > 158 || Math.abs(z) > 158 || y < 1 || y > 90) return false;
    if (w.setIfEmpty(x, y, z, c)) { vCount++; return true; }
    return false;
  }
  function rockCluster(x, z, o = {}) {
    x = Math.round(x); z = Math.round(z);
    const g0 = site(x, z, { clear: 1 });
    if (g0 < 0) return;
    const W = Math.max(2, Math.round(o.w || 5));
    const H = Math.max(2, Math.round(o.h || 4));
    const seed = o.seed == null ? hash3(x, 7, z, 91) : (o.seed | 0);
    const rr = mulberry32((seed ^ Math.imul(x, 73856093) ^ Math.imul(z, 19349663)) >>> 0);
    const lobes = [];
    const lobN = 2 + Math.floor(rr() * 3);
    for (let i = 0; i < lobN; i++) {
      const a = rr() * Math.PI * 2;
      const dist = rr() * W * 0.3;
      lobes.push({
        cx: x + Math.round(Math.cos(a) * dist),
        cz: z + Math.round(Math.sin(a) * dist),
        rx: W * (0.2 + rr() * 0.18),
        rz: W * (0.2 + rr() * 0.18),
        ry: H * (0.35 + rr() * 0.35),
        cy: g0 + 1 + Math.round(rr() * H * 0.3),
      });
    }
    lobes.push({ cx: x, cz: z, rx: W * 0.3, rz: W * 0.3, ry: H * 0.62, cy: g0 + 1 + Math.round(H * 0.32) });
    const holes = [];
    for (let i = 0; i < 2 + Math.floor(rr() * 3); i++) {
      holes.push({
        x: x + (rr() - 0.5) * W * 0.9,
        y: g0 + 1 + rr() * H * 0.85,
        z: z + (rr() - 0.5) * W * 0.9,
        r: 1 + rr() * 1.2,
      });
    }
    const topMap = new Map();
    const place = (px, py, pz, c) => {
      px = Math.round(px); py = Math.round(py); pz = Math.round(pz);
      if (py < g0 + 1) return false;
      if (Math.abs(px) > 158 || Math.abs(pz) > 158) return false;
      if (py === g0 + 1 && (isWater(px, pz) || isPath(px, pz))) return false;
      if (w.setIfEmpty(px, py, pz, c)) {
        vCount++;
        const k = px + ',' + pz;
        if (!topMap.has(k) || py > topMap.get(k)) topMap.set(k, py);
        return true;
      }
      return false;
    };
    for (const L of lobes) {
      const bx = Math.ceil(L.rx), by = Math.ceil(L.ry), bz = Math.ceil(L.rz);
      for (let dy = -by; dy <= by; dy++) {
        for (let dx = -bx; dx <= bx; dx++) {
          for (let dz = -bz; dz <= bz; dz++) {
            const q2 = (dx / L.rx) ** 2 + (dy / L.ry) ** 2 + (dz / L.rz) ** 2;
            const px = L.cx + dx, py = L.cy + dy, pz = L.cz + dz;
            if (q2 > 1) {
              if (q2 < 1.28 && rr() < 0.1) place(px, py, pz, rr() < 0.5 ? C.rock : C.rockDark);
              continue;
            }
            let inHole = false;
            for (const hh of holes) {
              if ((px - hh.x) ** 2 + (py - hh.y) ** 2 + (pz - hh.z) ** 2 <= hh.r * hh.r) { inHole = true; break; }
            }
            if (inHole) continue;
            const q = Math.sqrt(q2);
            if (q < 0.62 && rr() < 0.5) continue;
            const topness = dy / L.ry;
            let c;
            if (topness > 0.45) c = rr() < 0.5 ? C.rockLight : C.taihu;
            else if (topness < -0.15) c = rr() < 0.6 ? C.rockDark : C.rock;
            else c = rr() < 0.46 ? C.rock : (rr() < 0.4 ? C.taihu : C.rockDark);
            place(px, py, pz, c);
          }
        }
      }
    }
    // 基座（沿地面一圈，接地不悬空）
    for (let dx = -W; dx <= W; dx++) {
      for (let dz = -W; dz <= W; dz++) {
        const q = Math.hypot(dx, dz) / (W * 0.9);
        if (q > 1 || rr() < 0.4) continue;
        const px = x + dx, pz = z + dz;
        if (Math.abs(px) > LIMIT || Math.abs(pz) > LIMIT) continue;
        if (isWater(px, pz) || isPath(px, pz)) continue;
        const gg = groundSite(px, pz);
        if (gg < 0) continue;
        place(px, gg + 1, pz, rr() < 0.5 ? C.rockDark : C.bankStone);
        if (rr() < 0.25) place(px, gg + 2, pz, C.rock);
      }
    }
    // 长苔（石顶）
    for (const [k, ty] of topMap) {
      if (rr() < 0.34) {
        const [px, pz] = k.split(',').map(Number);
        if (w.get(px, ty + 1, pz) === 0 && w.get(px, ty, pz) !== 0) {
          w.set(px, ty, pz, rr() < 0.6 ? C.mossRock : C.grass3);
          if (rr() < 0.2) w.setIfEmpty(px, ty + 1, pz, C.mossRock);
        }
      }
    }
    bumpPlant();
  }

  // ───────────── 苔藓地面点缀（体素地表色斑）─────────────
  function moss(x1, z1, x2, z2, o = {}) {
    const ax1 = Math.round(Math.min(x1, x2)), ax2 = Math.round(Math.max(x1, x2));
    const az1 = Math.round(Math.min(z1, z2)), az2 = Math.round(Math.max(z1, z2));
    const density = o.density == null ? 0.6 : o.density;
    for (let x = Math.max(-LIMIT, ax1); x <= Math.min(LIMIT, ax2); x++) {
      for (let z = Math.max(-LIMIT, az1); z <= Math.min(LIMIT, az2); z++) {
        const g = groundSite(x, z);
        if (g < 0 || isPath(x, z)) continue;
        const c = w.get(x, g, z);
        if (!isGrassColor(c) && c !== C.dirt && c !== C.soil && c !== C.farm) continue;
        const n1 = (hash3(x >> 1, 0, z >> 1, 17) & 1023) / 1023;
        const n2 = (hash3(x, 0, z, 23) & 255) / 255;
        if (n1 * 0.65 + n2 * 0.35 > density) continue;
        if (n2 < 0.18) w.set(x, g, z, C.mossRock);
        else if (n2 < 0.34) w.set(x, g, z, C.grass2);
        else if (n1 < 0.3) w.set(x, g, z, C.mossRock);
      }
    }
    bumpPlant();
  }

  // ───────────── 全园兜底散植（幂等）──────────────────────────────────────
  function scatterGarden(opts = {}) {
    const _ts = (typeof performance !== 'undefined' ? performance.now() : 0);
    if (!opts.force) {
      if (SCATTERED.has(w)) return;
      SCATTERED.add(w);
    }
    const only = opts.only ? String(opts.only) : null;
    const want = (k) => !only || only.split(',').indexOf(k) >= 0;
    const Z = (name) => (ZONES ? ZONES[name] : null);
    // 可落点：地形实体、非水非路非保留、不在台地院落内、无建筑体素
    const free = (x, z, padMargin = 0) => {
      x = Math.round(x); z = Math.round(z);
      if (Math.abs(x) > 150 || Math.abs(z) > 150) return -1;
      if (inPad(x, z, padMargin)) return -1;
      const g = groundSite(x, z);
      if (g < 0) return -1;
      if (isPath(x, z) || reservedAt(x, z)) return -1;
      if (w.get(x, g + 1, z) !== 0) return -1;
      return g;
    };
    const baseFree = (x, z) => {
      const g = terrainTop(x, z);
      return g >= 0 && w.get(x, g + 1, z) === 0;
    };
    // 树木间距 + 数量上限
    const treeList = [];
    const TREE_CAP = opts.maxTrees != null ? opts.maxTrees : Math.round((lowQ ? 110 : 225) * densityScale);
    const treeFree = (x, z, minD) => {
      if (treeList.length >= TREE_CAP) return false;
      for (let i = 0; i < treeList.length; i++) {
        const t = treeList[i];
        const dx = t[0] - x, dz = t[1] - z;
        if (dx * dx + dz * dz < minD * minD) return false;
      }
      return true;
    };
    const leafLeft = () => fol.leafRoom() + fol.room('bamboo') + fol.room('hang');
    const canBigTree = () => leafLeft() > (lowQ ? 9000 : 18000);
    /** 尝试在 (x,z) 种一株；返回是否成功 */
    const plantAt = (fn, x, z, minD = 0, needBig = true) => {
      if (!baseFree(x, z)) return 0;
      if (needBig && !canBigTree()) return 0;
      if (minD > 0 && !treeFree(x, z, minD)) return 0;
      const before = plantCount;
      try { fn(x, z); } catch (e) { return 0; }
      if (plantCount <= before) return 0;
      if (minD > 0) treeList.push([Math.round(x), Math.round(z)]);
      return 1;
    };
    // 沿 zone 外扩 band 环带取点（避开台地内部）
    const ringPts = (zn, band, n) => {
      const pts = [];
      if (!zn) return pts;
      for (let i = 0; i < n * 14 && pts.length < n; i++) {
        const x = ri(zn.x1 - band, zn.x2 + band);
        const z = ri(zn.z1 - band, zn.z2 + band);
        if (x > zn.x1 && x < zn.x2 && z > zn.z1 && z < zn.z2) continue;
        if (Math.abs(x) > 150 || Math.abs(z) > 150) continue;
        if (inPad(x, z, 0)) continue;
        pts.push([x, z]);
      }
      return pts;
    };
    const plantRing = (zn, band, n, fn, minD = 0, needBig = true) => {
      const pts = ringPts(zn, band, n);
      let c = 0;
      for (const [x, z] of pts) c += plantAt(fn, x, z, minD, needBig);
      return c;
    };

    // ── 1. 荷（沁芳池/藕香池/花溆潭/沁芳亭潭；严格水面）──
    if (want('lotus')) {
      for (const p of PONDS) {
        if (!/沁芳池|藕香池|沁芳亭潭|花溆潭/.test(p.name)) continue;
        const count = Math.max(14, Math.min(90, Math.round(p.rx * p.rz * 0.1)));
        lotus(p.cx, p.cz, p.rx * 0.62, p.rz * 0.62, { count, flowers: Math.max(2, Math.round(count * 0.08)) });
      }
      // 荇菜/浮萍：沿池岸与水湾
      for (const p of PONDS) {
        const n = Math.max(3, Math.min(12, Math.round((p.rx + p.rz) * 0.12)));
        for (let i = 0; i < n * 12 && i < 200; i++) {
          const a = rnd() * Math.PI * 2;
          const k = rf(0.45, 0.98);
          const x = Math.round(p.cx + Math.cos(a) * p.rx * k);
          const z = Math.round(p.cz + Math.sin(a) * p.rz * k);
          if (floatPatch(x, z, { n: ri(2, 4) }) && chance(0.5)) break;
        }
      }
    }

    // ── 2. 芦（芦雪汀四岸 + 柳叶渚/芦雪汀支流）──
    if (want('reed')) {
      for (const p of PONDS) {
        if (!/芦雪汀/.test(p.name)) continue;
        reedBed(p.cx - p.rx - 3, p.cz - p.rz - 5, p.cx + p.rx + 3, p.cz - p.rz + 1, { count: 5 });
        reedBed(p.cx - p.rx - 3, p.cz + p.rz - 1, p.cx + p.rx + 3, p.cz + p.rz + 5, { count: 5 });
        reedBed(p.cx - p.rx - 5, p.cz - p.rz - 2, p.cx - p.rx + 1, p.cz + p.rz + 2, { count: 4 });
        reedBed(p.cx + p.rx - 1, p.cz - p.rz - 2, p.cx + p.rx + 5, p.cz + p.rz + 2, { count: 4 });
      }
      for (const st of STREAMS) {
        if (!/芦雪汀|柳叶渚/.test(st.name)) continue;
        for (let i = 1; i < st.pts.length; i++) {
          const [xa, za] = st.pts[i - 1], [xb, zb] = st.pts[i];
          const len = Math.hypot(xb - xa, zb - za) || 1;
          const nx = -(zb - za) / len, nz = (xb - xa) / len;
          const steps = Math.max(1, Math.floor(len / 12));
          for (let s = 0; s < steps; s++) {
            if (!chance(0.7)) continue;
            const t = (s + 0.5) / steps;
            const side = chance(0.5) ? 1 : -1;
            const off = st.w * 0.5 + 1 + rnd() * 3;
            const x = Math.round(xa + (xb - xa) * t + nx * off * side);
            const z = Math.round(za + (zb - za) * t + nz * off * side);
            if (free(x, z) < 0) continue;
            reedBed(x - 3, z - 3, x + 3, z + 3, { count: 3 });
          }
        }
      }
      // 紫菱洲：蓼花（粉红穗）+ 苇叶
      const zz = Z('zilingzhou');
      if (zz) {
        flowerPatch(zz.x1 - 2, zz.z2 + 1, zz.x2 + 2, zz.z2 + 9, { colors: [C.peony, C.peony2, C.plumWhite], count: 14, bedC: C.dirt });
        flowerPatch(zz.x1 - 9, zz.z1 - 2, zz.x1 - 2, zz.z2 + 2, { colors: [C.peony2, C.lotusFlower], count: 10, bedC: C.dirt });
      }
    }

    // ── 2.5 池岸草丛/苇丛（岸线不空）──
    if (want('reed')) {
      for (const p of PONDS) {
        const n = Math.max(3, Math.min(10, Math.round((p.rx + p.rz) * 0.1)));
        for (let i = 0; i < n * 8 && i < 120; i++) {
          const a = rnd() * Math.PI * 2;
          const k = 1.0 + rnd() * 0.1;
          const x = Math.round(p.cx + Math.cos(a) * p.rx * k + rf(-1, 1));
          const z = Math.round(p.cz + Math.sin(a) * p.rz * k + rf(-1, 1));
          if (free(x, z) < 0) continue;
          if (chance(0.5)) reedBed(x - 2, z - 2, x + 2, z + 2, { count: 2, stems: 8 });
          else grassTuft(x, z, { mat: 1, n: 4 });
        }
      }
    }

    // ── 3. 柳（沿池岸一圈 + 溪岸；柳叶渚成堤）──
    if (want('willow')) {
      const willowAt = (x, z) => {
        if (free(x, z) < 0) return 0;
        if (!nearWater(x, z, 4)) return 0;
        return plantAt((xx, zz) => willow(xx, zz, { h: 11 + ri(0, 3) }), x, z, 5);
      };
      let nW = 0;
      for (let i = 0; i < 460 && nW < 24; i++) {
        const p = pick(PONDS);
        const a = rnd() * Math.PI * 2;
        const k = 1.02 + rnd() * 0.16;
        const x = Math.round(p.cx + Math.cos(a) * p.rx * k + (rnd() - 0.5) * 4);
        const z = Math.round(p.cz + Math.sin(a) * p.rz * k + (rnd() - 0.5) * 4);
        if (!chance(0.5)) continue;
        nW += willowAt(x, z);
      }
      for (const st of STREAMS) {
        for (let i = 1; i < st.pts.length && nW < 26; i++) {
          const [xa, za] = st.pts[i - 1], [xb, zb] = st.pts[i];
          const len = Math.hypot(xb - xa, zb - za) || 1;
          const dirx = (xb - xa) / len, dirz = (zb - za) / len;
          const nx = -dirz, nz = dirx;
          const steps = Math.max(1, Math.floor(len / 14));
          for (let s = 0; s < steps && nW < 26; s++) {
            if (!chance(0.6)) continue;
            const t = (s + 0.5) / steps;
            const side = chance(0.5) ? 1 : -1;
            const off = st.w * 0.5 + 2 + ri(0, 3);
            nW += willowAt(Math.round(xa + (xb - xa) * t + nx * off * side), Math.round(za + (zb - za) * t + nz * off * side));
          }
        }
      }
    }

    // ── 3.5 园墙内侧 / 山丘 / 园外 连续树墙（远景绿量：大卡 + 实心冠核）──
    if (want('trees')) {
      const forestFree = (x, z) => {
        if (Math.abs(x) > 156 || Math.abs(z) > 156) return -1;
        const gg = groundSite(x, z);
        if (gg < 0) return -1;
        if (isWater(x, z) || isPath(x, z) || reservedAt(x, z)) return -1;
        if (w.get(x, gg + 1, z) !== 0) return -1;
        return gg;
      };
      const forestKeys = new Set();
      let forestN = 0;
      const FOREST_MAX = Math.round((lowQ ? 100 : 190) * densityScale);
      const tryForest = (x, z, lod = 'far') => {
        if (forestN >= FOREST_MAX) return 0;
        x = Math.round(x); z = Math.round(z);
        const k = Math.floor(x / 5) + ',' + Math.floor(z / 5);
        if (forestKeys.has(k)) return 0;
        const gg = forestFree(x, z);
        if (gg < 0) return 0;
        const before = plantCount;
        try {
          if (nearWater(x, z, 3)) willow(x, z, { h: 10 + ri(0, 4), lod });
          else if (gg > 7) pine(x, z, { h: 10 + ri(0, 5), lod });
          else pick([elm, locust, tree, wutong, mulberry])(x, z, { h: 9 + ri(0, 4), lod });
        } catch (e) { return 0; }
        if (plantCount <= before) return 0;
        forestKeys.add(k);
        forestN++;
        return 1;
      };
      // (1) 园墙内侧一圈（136~146，留出环路）
      for (let i = 0; i < 900 && forestN < Math.round(FOREST_MAX * 0.36); i++) {
        let x, z;
        if (rnd() < 0.5) { x = rnd() < 0.5 ? ri(134, 146) : ri(-146, -134); z = ri(-146, 146); }
        else { z = rnd() < 0.5 ? ri(134, 146) : ri(-146, -134); x = ri(-146, 146); }
        tryForest(x, z, 'mid');
      }
      // (2) 山丘树墙
      for (const h of HILLS) {
        const n = Math.max(3, Math.min(14, Math.round((h.rx * h.rz) / 300)));
        for (let i = 0, c = 0; i < n * 10 && c < n; i++) {
          const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * 0.95;
          c += tryForest(h.cx + Math.cos(a) * h.rx * rr, h.cz + Math.sin(a) * h.rz * rr);
        }
      }
      // (3) 园外一圈（墙外，园居林中的景深）
      for (let i = 0; i < 1400 && forestN < FOREST_MAX; i++) {
        let x, z;
        if (rnd() < 0.5) { x = rnd() < 0.5 ? ri(150, 156) : ri(-156, -150); z = ri(-156, 156); }
        else { z = rnd() < 0.5 ? ri(150, 156) : ri(-156, -150); x = ri(-156, 156); }
        if (z > 140 && Math.abs(x) < 28) continue;   // 正门前留空
        tryForest(x, z);
      }
    }

    // ── 4. 景点考据花木（院内由各场景种植；此处只在院外环带补少量点缀，留出视线）──
    if (want('trees')) {
      defaultTreeLod = 'mid';
      // 潇湘馆：馆外翠竹成丛 + 芭蕉、梨花
      plantRing(Z('xiaoxiang'), 9, 8, (x, z) => bamboo(x, z, { count: 7 + ri(0, 5), h: 9 + ri(0, 4) }), 4);
      plantRing(Z('xiaoxiang'), 6, 2, (x, z) => banana(x, z, {}), 3);
      plantRing(Z('xiaoxiang'), 8, 1, (x, z) => pear(x, z, { h: 9 }), 6);
      // 稻香村：杏花 + 桑榆槐
      plantRing(Z('daoxiang'), 9, 7, (x, z) => (chance(0.75) ? apricot(x, z, { h: 9 + ri(0, 3) }) : pear(x, z)), 6);
      plantRing(Z('daoxiang'), 12, 5, (x, z) => pick([elm, locust, mulberry])(x, z, { h: 9 + ri(0, 3) }), 7);
      // 栊翠庵：红梅绕寺
      plantRing(Z('longcui'), 10, 8, (x, z) => plum(x, z, { red: true, h: 8 + ri(0, 2) }), 7);
      // 怡红院：碧桃、西府海棠、芭蕉
      plantRing(Z('yihong'), 8, 4, (x, z) => (chance(0.55) ? peach(x, z) : crabapple(x, z)), 7);
      plantRing(Z('yihong'), 6, 2, (x, z) => banana(x, z, {}), 3);
      // 秋爽斋：梧桐 + 芭蕉
      plantRing(Z('qiushuang'), 9, 4, (x, z) => (chance(0.6) ? wutong(x, z) : banana(x, z)), 7);
      // 芭蕉坞：芭蕉点景
      plantRing(Z('bajiaowu'), 9, 5, (x, z) => banana(x, z, {}), 3);
      // 沁芳闸：桃花
      plantRing(Z('qinfangzha'), 9, 6, (x, z) => peach(x, z), 7);
      // 花溆：桃杏垂柳
      plantRing(Z('huaxu'), 8, 5, (x, z) => (chance(0.45) ? peach(x, z) : (chance(0.5) ? apricot(x, z) : willow(x, z))), 7);
      // 柳叶渚：垂柳堤
      plantRing(Z('liuyezhu'), 9, 5, (x, z) => willow(x, z, { h: 12 + ri(0, 2) }), 6);
      // 蘅芜苑：只垂藤香草山石，无花木
      plantRing(Z('hengwu'), 7, 3, (x, z) => {
        const g = groundSite(x, z);
        if (g < 0) return;
        vine({ x1: x - 2, z1: z, x2: x + 2, z2: z + 2, y: g + 4, topC: [C.plumWhite, C.chrys], leafC: C.leaf });
      }, 0, false);
      plantRing(Z('hengwu'), 6, 3, (x, z) => rockCluster(x, z, { w: 4 + ri(0, 2), h: 3 + ri(0, 3) }), 0, false);
      plantRing(Z('hengwu'), 6, 6, (x, z) => shrub(x, z, { r: 2 + ri(0, 1), c: [C.leafLight, C.leaf, C.vegetable] }), 2, false);
      // 蔷薇院 / 荼蘼架：棚架垂藤
      plantRing(Z('qiangweiyuan'), 6, 1, (x, z) => {
        const g = groundSite(x, z);
        if (g < 0) return;
        vine({ x1: x - 2, z1: z, x2: x + 2, z2: z, y: g + 4, topC: [C.crabapple, C.peony2], leafC: C.leaf });
      }, 0, false);
      plantRing(Z('tumijia'), 6, 1, (x, z) => {
        const g = groundSite(x, z);
        if (g < 0) return;
        vine({ x1: x - 2, z1: z, x2: x + 2, z2: z, y: g + 4, topC: [C.plumWhite, C.chrys], leafC: C.leafLight });
      }, 0, false);
      // 大观楼/正殿：青松、玉兰
      plantRing(Z('daguanlou'), 9, 4, (x, z) => pine(x, z, { h: 13 + ri(0, 4) }), 7);
      plantRing(Z('zhengdian'), 7, 2, (x, z) => pine(x, z, { h: 12 + ri(0, 4) }), 7);
      plantRing(Z('daguanlou'), 7, 2, (x, z) => plum(x, z, { red: false, h: 9 }), 6);
      // 凸碧山松
      plantRing(Z('gubishan'), 10, 3, (x, z) => pine(x, z, { h: 12 + ri(0, 4) }), 7);
      // 桂（藕香榭/凹晶/荇叶渚）：绿叶小乔木 + 金花
      const osmanthus = (x, z) => {
        const st = treeSite(x, z, 3);
        if (!st) return 0;
        const ok = buildBlossom(st.x, st.z, { inner: [C.leafDark], base: [C.leaf, C.leafLight], edge: [C.leafLight] },
          { h: 7, r: 3, trunkRatio: 0.36, leaves: 170, lod: 'mid' });
        if (!ok) return 0;
        const phase = rnd() * 6.283;
        const g = st.g;
        for (let i = 0; i < 18; i++) {
          const a = rnd() * Math.PI * 2;
          const d = rf(0.6, 2.6);
          leaf('canopy', st.x + Math.cos(a) * d, g + 1 + rf(4.2, 6.8), st.z + Math.sin(a) * d,
            rf(0.26, 0.4), rf(0.26, 0.4), rnd() * Math.PI * 2, rf(-1.2, 1.2), rnd() * Math.PI * 2,
            C.chrys, rf(0.95, 1.15), phase + rf(-0.5, 0.5), 0.07, ATLAS.bloomB);
        }
        return 1;
      };
      plantRing(Z('ouxiangxie'), 8, 2, osmanthus, 6);
      plantRing(Z('aojing'), 8, 2, osmanthus, 6);
      plantRing(Z('xingyezhu'), 7, 2, osmanthus, 6);
      // 山丘松林（大主山/东北山环/南北丘）
      defaultTreeLod = 'far';
      let pines = 0;
      for (const h of HILLS) {
        const n = Math.max(1, Math.min(5, Math.round((h.rx * h.rz) / 800)));
        for (let i = 0; i < n * 10 && pines < 16; i++) {
          const a = rnd() * Math.PI * 2;
          const rr = Math.sqrt(rnd()) * 0.9;
          const x = Math.round(h.cx + Math.cos(a) * h.rx * rr);
          const z = Math.round(h.cz + Math.sin(a) * h.rz * rr);
          const g = free(x, z);
          if (g < 0 || g < 6) continue;
          if (!chance(0.55)) continue;
          pines += plantAt((xx, zz) => pine(xx, zz, { h: 12 + ri(0, 5), r: 4 + ri(0, 2), lod: 'far' }), x, z, 7);
        }
      }
    }

    defaultTreeLod = 'near';

    // ── 5. 花圃/药圃（避院落；红香圃/牡丹亭外围）──
    if (want('beds')) {
      const patches = [
        [-42, -4, -26, 8, [C.chrys, C.peony], 24],
        [56, -64, 72, -50, [C.chrys, C.plumWhite], 24],
        [96, -112, 110, -98, [C.chrys, C.peony2], 20],
        [64, -96, 78, -84, [C.lotusFlower, C.peony], 20],
        [26, -62, 38, -50, [C.peony, C.chrys], 18],
        [-14, 4, 0, 14, [C.peony2, C.chrys], 18],
        [-60, -4, -46, 8, [C.plumWhite, C.chrys], 16],
      ];
      for (const [x1, z1, x2, z2, colors, count] of patches) {
        const cx = Math.round((x1 + x2) / 2), cz = Math.round((z1 + z2) / 2);
        if (free(cx, cz, 1) < 0) continue;
        flowerPatch(x1, z1, x2, z2, { colors, count });
      }
      // 红香圃芍药：院外南坡成畦
      const hp = Z('hongxiangpu');
      if (hp) peonyBed(hp.x1 - 2, hp.z2 + 1, hp.x2 + 2, hp.z2 + 9, { count: 24 });
      const md = Z('mudanting');
      if (md) peonyBed(md.x2 + 1, md.z1 - 2, md.x2 + 7, md.z2 + 2, { count: 16, colors: [C.peony, C.peony2, C.plumWhite] });
    }

    // ── 5.6 草色大尺度斑块：深绿/黄绿渐变（只改草皮顶层色）──
    if (want('moss')) {
      for (let z = -148; z <= 148; z++) {
        for (let x = -148; x <= 148; x++) {
          const g = groundSite(x, z);
          if (g < 0 || isPath(x, z)) continue;
          const cur = w.get(x, g, z);
          if (!isGrassColor(cur)) continue;
          const n1 = (hash3(x >> 4, 0, z >> 4, 71) & 1023) / 1023;
          const n2 = (hash3(x >> 2, 7, z >> 2, 73) & 255) / 255;
          const v = n1 * 0.62 + n2 * 0.38;
          if (v < 0.2) w.set(x, g, z, C.grass2);
          else if (v < 0.3) w.set(x, g, z, C.grass3);
          else if (v > 0.84) w.set(x, g, z, C.grassDry);
        }
      }
    }

    // ── 6. 苔（阴暗处地面）──
    if (want('moss')) {
      moss(-126, 20, -74, 64);
      moss(18, -118, 62, -90);
      moss(-90, -100, -56, -78);
      moss(-20, -72, -8, -50);
      moss(-40, 108, 34, 132);
      moss(-144, -140, -118, -112);
    }

    // ── 7. 全园零星杂树/灌木（花树只保留上面考据景点的分布）──
    if (want('grass')) {
      const n = opts.counts || {};
      const maxTrees = n.trees == null ? Math.round((lowQ ? 36 : 72) * densityScale) : n.trees;
      const maxShrubs = n.shrubs == null ? (lowQ ? 60 : 120) : n.shrubs;
      const GREEN = [elm, locust, wutong, mulberry, tree, tree, ginkgo];
      let trees = 0, shrubs = 0;
      for (let i = 0; i < 4200 && (trees < maxTrees || shrubs < maxShrubs); i++) {
        const x = ri(-148, 148), z = ri(-148, 148);
        const g = free(x, z);
        if (g < 0) continue;
        const noise = (hash3(x >> 2, 0, z >> 2, 9) & 255) / 255;
        if (g > 7 && trees < maxTrees && chance(0.5)) {
          trees += plantAt((xx, zz) => pine(xx, zz, { h: 10 + ri(0, 5), r: 4 + ri(0, 1), lod: 'far' }), x, z, 6);
        } else if (nearWater(x, z, 2) && trees < maxTrees && chance(0.4)) {
          trees += plantAt((xx, zz) => willow(xx, zz, { h: 10 + ri(0, 3), lod: 'far' }), x, z, 5);
        } else if (noise < 0.2 && trees < maxTrees) {
          if (chance(0.16)) {
            trees += plantAt((xx, zz) => bamboo(xx, zz, { count: 4 + ri(0, 4), h: 8 + ri(0, 3), lod: 'far' }), x, z, 4);
          } else {
            const fn = pick(GREEN);
            trees += plantAt((xx, zz) => fn(xx, zz, { h: 9 + ri(0, 4), lod: 'far' }), x, z, 6);
          }
        } else if (noise < 0.34 && shrubs < maxShrubs) {
          shrubs += plantAt((xx, zz) => shrub(xx, zz, { r: 2 + ri(0, 2) }), x, z, 2, false);
        }
      }
      // ── 8. 近景草地：沿 POI / 路径加密（草叶 + 野花；分区密度）──
      const perTuft = lowQ ? 3.2 : 4.3;
      const flowerReserve = lowQ ? 3000 : 7000;    // 先给野花/花圃留预算
      const room = Math.max(0, fol.groundRoom() - flowerReserve);
      const maxTufts = Math.min(lowQ ? 5600 : 14000, Math.floor(room / perTuft));
      let placed = 0, tries = 0;
      const poi = POIS && POIS.length ? POIS : null;
      while (placed < maxTufts && tries < maxTufts * 7) {
        tries++;
        let x, z;
        if (poi && rnd() < 0.62) {
          const p = poi[Math.floor(rnd() * poi.length)];
          const a = rnd() * Math.PI * 2;
          const d = 2 + Math.pow(rnd(), 0.85) * 26;
          x = Math.round(p.x + Math.cos(a) * d);
          z = Math.round(p.z + Math.sin(a) * d);
        } else {
          x = ri(-148, 148); z = ri(-148, 148);
        }
        const g = free(x, z);
        if (g < 0) continue;
        const c = w.get(x, g, z);
        if (!isGrassColor(c) && c !== C.dirt && c !== C.soil) continue;
        if (grassTuft(x, z)) placed++;
      }
      // 野花小片（近 POI / 水岸 / 草地边缘）
      const fRoom = Math.max(0, fol.groundRoom());
      const maxFlowers = Math.min(lowQ ? 1200 : 3600, Math.floor(fRoom / 2.2));
      const PATCH_COLORS = [
        [C.chrys, C.plumWhite], [C.peony2, C.chrys], [C.lotusFlower, C.plumWhite],
        [C.chrys, C.peony], [C.plumWhite, C.lotusFlower], [C.peony, C.peony2],
      ];
      let fc = 0;
      for (let i = 0; i < maxFlowers * 4 && fc < maxFlowers; i++) {
        let x, z;
        if (poi && chance(0.62)) {
          const p = poi[Math.floor(rnd() * poi.length)];
          const a = rnd() * Math.PI * 2;
          const d = 3 + Math.pow(rnd(), 0.8) * 28;
          x = Math.round(p.x + Math.cos(a) * d);
          z = Math.round(p.z + Math.sin(a) * d);
        } else if (chance(0.4)) {
          const p = pick(PONDS);
          const a = rnd() * Math.PI * 2;
          x = Math.round(p.cx + Math.cos(a) * (p.rx + rf(1, 6)));
          z = Math.round(p.cz + Math.sin(a) * (p.rz + rf(1, 6)));
        } else {
          x = ri(-148, 148); z = ri(-148, 148);
        }
        if (free(x, z) < 0) continue;
        const g2 = terrainTop(x, z);
        const c = w.get(x, g2, z);
        if (!isGrassColor(c) && c !== C.dirt && c !== C.soil) continue;
        const colors = pick(PATCH_COLORS);
        const k = flowerPatch(x - 1, z - 1, x + 1, z + 1, { count: ri(2, 5), colors, bedC: pick([C.grass2, C.soilDark, C.dirt]) });
        if (k) fc += k;
      }
    }

    plantStats.scatterMs = Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - _ts);

    // ── 9. 翠嶂山脚、花溆石港、山坡散石（山石小景）──
    if (want('rocks')) {
      const rockSpots = [
        [10, 116, 3], [24, 120, 4], [-14, 118, 3], [-24, 124, 4],
        [8, -88, 3], [26, -96, 3], [-58, -84, 3], [-88, -16, 3],
      ];
      for (const [x, z, w2] of rockSpots) {
        if (free(x, z, 1) < 0) continue;
        rockCluster(x, z, { w: w2, h: 3 + ri(0, 3) });
      }
    }
  }

  // ───────────── 汇总导出 ─────────────
  const F = {
    stats: () => {
      const fs = fol.stats();
      return {
        voxels: vCount,
        plants: plantCount,
        instances: (fs.leafInstances || 0) + (fs.groundInstances || 0),
        leafInstances: fs.leafInstances || 0,
        groundInstances: fs.groundInstances || 0,
        tris: fs.tris || 0,
        calls: fs.calls || 0,
        quality: lowQ ? 'mid' : 'high',
        trees: plantStats.trees,
        farTrees: plantStats.farTrees,
        bambooClumps: plantStats.bamboo,
        willows: plantStats.willows,
        shrubs: plantStats.shrubs,
        buildMs: fs.buildMs || 0,
        finalizeMs: fs.finalizeMs || 0,
        scatterMs: plantStats.scatterMs || 0,
      };
    },
    tree,
    pine,
    willow,
    apricot,
    peach,
    plum,
    pear,
    crabapple,
    bamboo,
    banana,
    wutong,
    elm,
    locust,
    mulberry,
    ginkgo,
    shrub,
    grassTuft,
    flowerPatch,
    reedBed,
    lotus,
    peonyBed,
    vine,
    rockCluster,
    moss,
    scatterGarden,
    /** 精细植被系统（供 Lead 调试/查询；postBuild 已自动接入） */
    foliage: fol,
    /** 手动取 THREE.Group（若 ctx.postBuild 未提供时可用） */
    getObject3D: () => fol.finalize(),
  };
  // 若没有 postBuild 钩子，把 group 兜底暴露出来（不主动 add，避免与 Lead 撞车）
  if (!Array.isArray(ctx.postBuild) && typeof window !== 'undefined') {
    window.__FLORA2_GROUP__ = null;
    const f0 = F.getObject3D;
    F.getObject3D = () => {
      const g = f0();
      window.__FLORA2_GROUP__ = g;
      return g;
    };
  }
  return F;
}

// 幂等保护：同一世界只散植一次
const SCATTERED = new WeakSet();

// 可选导出：与 `createFlora(ctx).scatterGarden()` 等价，供 main 直接调用。
export function scatterGarden(ctx, opts = {}) {
  const F = createFlora(ctx);
  F.scatterGarden(opts);
  return F.stats();
}

