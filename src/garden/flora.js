// ─────────────────────────────────────────────────────────────────────────────
// 大观园 · 植物与山石生成器（精细版 v2 · flora 成员维护）
//
// 对外 API（docs/engine-api.md §5，签名保持不变）：
//   tree / pine / willow / apricot / peach / plum / pear / bamboo / crabapple /
//   banana / wutong / elm / locust / mulberry / ginkgo / shrub / grassTuft /
//   flowerPatch / reedBed / lotus / peonyBed / vine / rockCluster / moss
//
// 设计要点：
//   · 一切落点由 ctx.groundY(x,z)（兼容 ctx.groundTop）决定，避开 isWater/isPath/reserve；
//   · 全部使用 w.setIfEmpty，不破坏已有建筑/场景体素；越界 ±156 直接放弃；
//   · 树 = 主干 + 可见分枝 + 3~4 层球状渐变树冠（内部深、外层浅、外缘留 6~10% 空隙与碎点）；
//   · 花树满冠繁花、夹 10% 左右新叶；竹成丛、节间色差、顶部细叶；柳有下垂柳条；
//   · 花圃成畦（地面色差 + 植株 + 花头），非随机噪点；
//   · 荷/苇严格贴水面/岸线；山石为太湖石式块面堆叠、留孔洞、可长苔。
//   · 所有随机数来自 ctx.R（确定性）；色差优先用「坐标哈希 + 分层」而非纯随机，兼顾观感与网格合并率。
// ─────────────────────────────────────────────────────────────────────────────
import { C, GROUPS, PALETTE } from '../core/palette.js';
import { WATER_LEVEL, ZONES, PADS, PONDS, STREAMS, HILLS } from './layout.js';

const LIMIT = 156;                                   // 种植活动范围
const WATER_Y = Number.isFinite(WATER_LEVEL) ? Math.ceil(WATER_LEVEL) : 3; // 荷叶所在体素层（水面 2.6 → y=3）

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
const lum = (idx) => {
  const p = PALETTE[idx];
  return p ? p.r * 0.3 + p.g * 0.59 + p.b * 0.11 : 0;
};

// 植被/土壤类颜色（用于「地面之上已有植物则不算结构阻挡」的软判断）
const SOFT = new Set();
for (const g of [GROUPS.leaf, GROUPS.bamboo, GROUPS.pine, GROUPS.willow, GROUPS.grass, GROUPS.reed, GROUPS.apricot, GROUPS.peach, GROUPS.crabapple]) {
  for (const c of g) SOFT.add(c);
}
for (const c of [
  C.bambooStalk, C.bambooNode, C.plumRed, C.plumWhite, C.peony, C.peony2, C.lotusFlower, C.chrys,
  C.vegetable, C.rice, C.leafYellow, C.mossRock, C.dirt, C.dirt2, C.dirt3, C.soil, C.soilDark,
  C.farm, C.lotusPad, C.lotusPad2, C.lotusPad3, C.waterBed, C.waterBed2, C.waterBed3,
]) if (c) SOFT.add(c);

// 是否位于建筑/铺装台地（PADS）内；散植兜底不种进院子
function inPad(x, z, margin = 0) {
  for (let i = 0; i < PADS.length; i++) {
    const p = PADS[i];
    if (x >= p.x1 - margin && x <= p.x2 + margin && z >= p.z1 - margin && z <= p.z2 + margin) return true;
  }
  return false;
}
// 同一世界只做一次全园兜底散植（幂等保护：重复调用不重复种植）
const SCATTERED = new WeakSet();

export function createFlora(ctx) {
  const w = ctx.w;
  const R = typeof ctx.R === 'function' ? ctx.R : Math.random;

  // ── 上下文随机（只用 R()，其余派生，保证与 lead 的 seeded R 完全一致）──
  const rnd = () => R();
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const rf = (a, b) => a + rnd() * (b - a);
  const chance = (p) => rnd() < p;
  const pick = (arr) => (arr && arr.length ? arr[Math.floor(rnd() * arr.length) % arr.length] : 0);
  const pickAt = (arr, x, y, z, salt = 0) => {
    if (!arr || !arr.length) return 0;
    if (arr.length === 1) return arr[0];
    return arr[(hash3(x, y, z, salt) >>> 7) % arr.length];
  };

  // ── 统计（供 lead 估算体素量，不影响接口）──
  let vCount = 0;
  let plantCount = 0;
  const bumpPlant = () => { plantCount++; };

  // ── 世界查询 ────────────────────────────────────────────────────────────
  const terrainTop = (x, z) => {
    let g;
    if (typeof ctx.groundY === 'function') g = ctx.groundY(x, z);
    else if (typeof ctx.groundTop === 'function') g = ctx.groundTop(x, z);
    else g = w.topY(x, z);
    if (!Number.isFinite(g)) return -1;
    g = Math.round(g);
    return g >= 0 && g < 92 ? g : -1;
  };

  const topColorAt = (x, z) => {
    const g = terrainTop(x, z);
    return g >= 0 ? w.get(x, g, z) : 0;
  };
  const isWater = (x, z) => {
    if (typeof ctx.isWater === 'function') return !!ctx.isWater(x, z);
    const c = topColorAt(x, z);
    return c === 0 || c === C.waterBed || c === C.waterBed2 || c === C.waterBed3;
  };
  const isPath = (x, z) => {
    if (typeof ctx.isPath === 'function') return !!ctx.isPath(x, z);
    const c = topColorAt(x, z);
    return c === C.path || c === C.path2 || c === C.path3 || c === C.pebble || c === C.pebbleDark;
  };
  const reservedAt = (x, z) => {
    if (typeof ctx.isReserved === 'function') return !!ctx.isReserved(x, z);
    const rv = ctx.reserve;
    if (!rv) return false;
    if (typeof rv === 'function') {
      if (typeof rv.isReserved === 'function') return !!rv.isReserved(x, z);
      if (typeof rv.has === 'function') return !!rv.has(x, z);
      return false; // 声明式函数，不做查询
    }
    if (typeof rv === 'object') {
      if (typeof rv.isReserved === 'function') return !!rv.isReserved(x, z);
      if (typeof rv.has === 'function') return !!rv.has(x, z);
      const list = Array.isArray(rv) ? rv : (rv.rects || rv.list || null);
      if (Array.isArray(list)) {
        for (const r of list) {
          if (!r) continue;
          const x1 = Array.isArray(r) ? r[0] : (r.x1 ?? r[0]);
          const z1 = Array.isArray(r) ? r[1] : (r.z1 ?? r[1]);
          const x2 = Array.isArray(r) ? r[2] : (r.x2 ?? r[2]);
          const z2 = Array.isArray(r) ? r[3] : (r.z2 ?? r[3]);
          if (x >= Math.min(x1, x2) && x <= Math.max(x1, x2) && z >= Math.min(z1, z2) && z <= Math.max(z1, z2)) return true;
        }
      }
    }
    return false;
  };

  // ── 放置原语 ────────────────────────────────────────────────────────────
  // putDry：陆地专用（水面格一律不落树/灌木/花/藤的体素；水面只许 lotus/reedBed 特殊处理）
  // 说明：水面 y=2.6，树冠/枝干若跨到水面格会形成「树长水里」的观感，故严格裁掉。
  function putDry(x, y, z, c) {
    if (!c) return false;
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    if (Math.abs(x) > 158 || Math.abs(z) > 158) return false;
    if (isWater(x, z)) return false;
    if (w.setIfEmpty(x, y, z, c)) { vCount++; return true; }
    return false;
  }
  // putWater：允许落到水面格（仅荷叶/荷花等水生植物使用）
  function putWater(x, y, z, c) {
    if (!c) return false;
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    if (Math.abs(x) > 158 || Math.abs(z) > 158) return false;
    if (w.setIfEmpty(x, y, z, c)) { vCount++; return true; }
    return false;
  }
  // 陆地植物默认走 putDry；水生植物显式用 putWater
  const put = putDry;

  // 地表（只改造草皮顶层，不碰石头/路径/建筑）：用于花畦色差、苔藓
  const isGrassColor = (c) => c === C.grass || c === C.grass2 || c === C.grass3 || c === C.grassDry;
  function tintGround(x, z, c, onlyGrass = true) {
    const g = terrainTop(x, z);
    if (g < 0) return false;
    const cur = w.get(x, g, z);
    if (cur === 0) return false;
    if (onlyGrass && !isGrassColor(cur)) return false;
    w.set(x, g, z, c);
    return true;
  }

  // 站点：返回地面顶层 y；不可放置返回 -1
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
      if (above !== 0) {
        if (opt.softAbove && !SOFT.has(above)) return -1;
      }
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
    if (w.get(x, g + 1, z) !== 0 && !SOFT.has(w.get(x, g + 1, z))) return -1;
    return g;
  };

  // ── 颜色组 ──────────────────────────────────────────────────────────────
  // 把任意颜色数组变成「内部深 / 中层 / 外缘浅」三档（供球形渐变树冠）
  function leafSpec(colors) {
    if (colors && colors.base && colors.edge) {
      return {
        inner: colors.inner && colors.inner.length ? colors.inner : colors.base,
        base: colors.base,
        edge: colors.edge,
      };
    }
    let arr = colors ? (Array.isArray(colors) ? colors.slice() : [colors]) : GROUPS.leaf.slice();
    arr = arr.filter((c) => c);
    if (!arr.length) arr = GROUPS.leaf.slice();
    if (arr.length === 1) return { inner: arr, base: arr, edge: arr };
    arr.sort((a, b) => lum(a) - lum(b));
    const edge = arr.slice(Math.max(1, arr.length - 2));
    const inner = [arr[0]];
    let base = arr.slice(1, Math.max(1, arr.length - 1));
    if (!base.length) base = [arr[0]];
    return { inner, base, edge };
  }

  // 花色克制：内层偏深（crabapple/peony2）、中层花主色、外缘浅但不整片白，另混叶点缀
  const BLOOM = {
    apricot: { inner: [C.crabapple], base: [C.apricot2, C.crabapple], edge: [C.apricot, C.apricot2] },
    peach: { inner: [C.crabapple, C.peony2], base: [C.peach, C.crabapple], edge: [C.apricot2, C.peach] },
    pear: { inner: [C.apricot2], base: [C.plumWhite, C.apricot2], edge: [C.plumWhite] },
    plumRed: { inner: [C.redDark], base: [C.plumRed, C.plumRed, C.crabapple], edge: [C.crabapple] },
    plumWhite: { inner: [C.apricot2, C.crabapple], base: [C.plumWhite, C.apricot], edge: [C.plumWhite] },
    crabapple: { inner: [C.plumRed], base: [C.crabapple, C.crabapple, C.peony2], edge: [C.peony2] },
  };
  const SPEC = {
    pine: { inner: [C.pineDark, C.pine], base: [C.pine, C.pineDark], edge: [C.pineLight, C.pine] },
    willow: { inner: [C.leafDark, C.willow], base: [C.willow, C.willow2, C.leafLight], edge: [C.willow2, C.leafLight, C.willow] },
    leaf: leafSpec(GROUPS.leaf),
    darkLeaf: leafSpec([C.leaf, C.leafDark, C.leafLight]),
  };

  // ── 水陆边界工具 ────────────────────────────────────────────────────────
  // 返回 rad 范围内最近的水面方向；无水面返回 null
  function waterNear(x, z, rad) {
    const r = Math.max(1, Math.round(rad));
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) if (isWater(x + dx, z + dz)) return [dx, dz];
    }
    return null;
  }
  // 离水太近时把落点向陆侧微移（最多 tries 格，符合 §5「允许 2–3 格微偏移」），避免树冠被水面裁剪
  function dryShift(x, z, rad, tries = 5) {
    x = Math.round(x); z = Math.round(z);
    const w0 = waterNear(x, z, rad);
    if (!w0) return [x, z];
    const len = Math.hypot(w0[0], w0[1]) || 1;
    const ux = -w0[0] / len, uz = -w0[1] / len;
    for (let k = 1; k <= tries; k++) {
      const nx = Math.round(x + ux * k), nz = Math.round(z + uz * k);
      if (!waterNear(nx, nz, rad)) return [nx, nz];
    }
    return [x, z];
  }

  // ── 树冠积木 ────────────────────────────────────────────────────────────
  // 球状渐变 blob：内部深、中层基色、外缘浅且留 6~10% 空隙 + 少量碎点
  function blob(cx, cy, cz, rx, ry, rz, spec, o = {}) {
    rx = Math.max(1, rx); ry = Math.max(1, ry); rz = Math.max(1, rz);
    const edgeThr = o.edgeThr == null ? 0.78 : o.edgeThr;
    const holes = o.holes == null ? 0.08 : o.holes;
    const innerHoles = o.innerHoles == null ? 0.06 : o.innerHoles;
    const leafAccent = o.leafAccent || null;
    const salt = o.salt || 0;
    const bx = Math.ceil(rx), by = Math.ceil(ry), bz = Math.ceil(rz);
    for (let dy = -by; dy <= by; dy++) {
      const ny = dy / ry;
      for (let dx = -bx; dx <= bx; dx++) {
        const nx = dx / rx;
        for (let dz = -bz; dz <= bz; dz++) {
          const nz = dz / rz;
          const q2 = nx * nx + ny * ny + nz * nz;
          const px = cx + dx, py = cy + dy, pz = cz + dz;
          if (q2 > 1) {
            if (q2 < 1.32 && chance(0.09)) put(px, py, pz, pickAt(spec.edge, px, py, pz, salt));
            continue;
          }
          const q = Math.sqrt(q2);
          if (q > edgeThr && chance(holes)) continue;
          if (q <= edgeThr && chance(innerHoles)) continue;
          let arr;
          if (q > edgeThr) arr = spec.edge;
          else if (ny > 0.45 && q > 0.5) arr = spec.edge;
          else if (q < 0.42 || ny < -0.4) arr = spec.inner;
          else arr = spec.base;
          // 叶面杂色：打破贪心合并的大色块，让冠面有碎叶质感
          if (q > 0.42) {
            const hd = (hash3(px, py, pz, salt + 99) >>> 4) & 255;
            if (hd < 40) arr = (arr === spec.edge ? spec.base : spec.edge);
            else if (hd < 64) arr = spec.inner;
          }
          if (leafAccent && q > 0.5 && chance(0.12)) arr = leafAccent;
          put(px, py, pz, pickAt(arr, px, py, pz, salt));
          // 外缘蓬松小叶团：向法向鼓出一格（连通，不产生悬浮碎点）
          if (q > 0.8 && chance(o.fluff == null ? 0.05 : o.fluff)) {
            const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
            let tx = px, ty = py, tz = pz;
            if (ax >= az && ax >= ay) tx += nx > 0 ? 1 : -1;
            else if (az >= ay) tz += nz > 0 ? 1 : -1;
            else ty += ny > 0 ? 1 : -1;
            if (chance(0.35)) ty += ny > 0 ? 1 : -1;
            put(tx, ty, tz, pickAt(spec.edge, tx, ty, tz, salt + 3));
          }
        }
      }
    }
  }

  // 圆冠（3~4 层叠置 + 侧翼 + 顶部碎叶；每层略微错位，读出层次）
  function crownRound(x, topY, z, r, spec, o = {}) {
    r = Math.max(2, Math.round(r));
    const wide = o.wide || 1;
    const tall = o.tall || 1;
    const salt = o.salt || 0;
    const leafAccent = o.leafAccent || null;
    const fluff = o.fluff == null ? 0.07 : o.fluff;
    const tiers = o.tiers || 4;
    for (let i = 0; i < tiers; i++) {
      // f: 0 底层 → 1 顶层；整体冠高约 1.4r，保证主干与分枝可见
      const f = tiers === 1 ? 0.5 : i / (tiers - 1);
      const cy = topY - Math.round(r * (1.16 - 0.98 * f));
      const tr = Math.round(r * (0.86 + 0.16 * Math.sin(f * Math.PI)) * (1 - 0.32 * f) * wide);
      const jr = Math.round(r * 0.2);
      const jx = i === 0 || i === tiers - 1 ? 0 : Math.round((rnd() - 0.5) * 2 * jr);
      const jz = i === 0 || i === tiers - 1 ? 0 : Math.round((rnd() - 0.5) * 2 * jr);
      blob(x + jx, cy, z + jz, Math.max(2, tr), Math.max(2, Math.round(r * 0.33 * tall)), Math.max(2, tr), spec, {
        ...o, leafAccent, fluff, holes: i === 0 ? 0.1 : 0.09, salt: salt + i + 1,
      });
    }
    const flanks = o.flanks == null ? 2 : o.flanks;
    for (let i = 0; i < flanks; i++) {
      const a = rnd() * Math.PI * 2;
      const d = r * (0.55 + rnd() * 0.35);
      const sx = Math.round(Math.cos(a) * d), sz = Math.round(Math.sin(a) * d);
      const fr = Math.max(2, Math.round(r * 0.5));
      blob(x + sx, topY - Math.round(r * (0.68 + rnd() * 0.28)), z + sz, fr, Math.max(2, Math.round(r * 0.3)), fr, spec, {
        ...o, leafAccent, fluff, holes: 0.14, salt: salt + 10 + i,
      });
    }
    // 顶部零星叶（碎外形）
    for (let i = 0; i < 5; i++) {
      put(x + ri(-r, r), topY + ri(0, 1), z + ri(-r, r), pickAt(spec.edge, x, topY + i, z, salt + 40));
    }
  }

  // 圆锥冠（银杏、青松式纵向）
  function crownConical(x, topY, z, r, spec, o = {}) {
    r = Math.max(2, Math.round(r));
    const layers = 4;
    for (let i = 0; i < layers; i++) {
      const f = i / (layers - 1);
      const cr = r * (1.0 - 0.62 * f);
      const cy = topY - Math.round(r * (0.3 + 1.9 * (1 - f)));
      blob(x, cy, z, Math.round(cr), Math.max(2, Math.round(r * 0.42)), Math.round(cr), spec, { ...o, holes: 0.1, salt: 30 + i });
    }
  }

  // 花瓶冠（榆树：下窄上阔）
  function crownVase(x, topY, z, r, spec, o = {}) {
    r = Math.max(2, Math.round(r));
    const ry = Math.max(2, Math.round(r * 0.5));
    blob(x, topY - Math.round(r * 1.9), z, Math.round(r * 0.58), ry, Math.round(r * 0.58), spec, { ...o, salt: 50 });
    blob(x, topY - Math.round(r * 1.15), z, Math.round(r * 0.82), ry, Math.round(r * 0.82), spec, { ...o, salt: 51 });
    blob(x, topY - Math.round(r * 0.42), z, Math.round(r * 1.0), Math.round(ry * 1.05), Math.round(r * 1.0), spec, { ...o, salt: 52 });
    for (let i = 0; i < 2; i++) {
      const a = rnd() * Math.PI * 2;
      blob(x + Math.round(Math.cos(a) * r * 0.7), topY - Math.round(r * 0.9), z + Math.round(Math.sin(a) * r * 0.7), Math.round(r * 0.5), ry, Math.round(r * 0.5), spec, { ...o, salt: 55 + i });
    }
  }

  // 平展阔冠（槐、梧桐：宽而扁）
  function crownFlat(x, topY, z, r, spec, o = {}) {
    r = Math.max(2, Math.round(r));
    const ry = Math.max(2, Math.round(r * 0.44));
    blob(x, topY - Math.round(r * 1.35), z, Math.round(r * 0.92), Math.round(ry * 0.9), Math.round(r * 0.92), spec, { ...o, salt: 60 });
    blob(x, topY - Math.round(r * 0.62), z, Math.round(r * 1.08), ry, Math.round(r * 1.08), spec, { ...o, salt: 61 });
    blob(x, topY - Math.round(r * 0.1), z, Math.round(r * 0.8), Math.round(ry * 0.7), Math.round(r * 0.8), spec, { ...o, salt: 62 });
    const flanks = o.flanks == null ? 3 : o.flanks;
    for (let i = 0; i < flanks; i++) {
      const a = (i / flanks) * Math.PI * 2 + rnd() * 0.6;
      blob(x + Math.round(Math.cos(a) * r * 0.8), topY - Math.round(r * 0.85), z + Math.round(Math.sin(a) * r * 0.8), Math.max(2, Math.round(r * 0.5)), Math.max(2, Math.round(ry * 0.8)), Math.max(2, Math.round(r * 0.5)), spec, { ...o, salt: 65 + i });
    }
  }

  // ── 树干 / 枝条 ─────────────────────────────────────────────────────────
  function trunkLean(x, z, y0, y1, c, opt = {}) {
    const thick = opt.thick || 1;
    const c2 = opt.c2 || C.woodDark;
    const lean = opt.lean || 0;
    const la = opt.leanAngle == null ? rnd() * Math.PI * 2 : opt.leanAngle;
    const lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;
    const H = Math.max(1, y1 - y0);
    let tipX = x, tipZ = z;
    for (let i = 0; i <= H; i++) {
      const t = i / H;
      const k = t * t;
      const cx = x + Math.round(lx * k), cz = z + Math.round(lz * k);
      const wide = thick >= 2 && t < 0.55 ? 2 : 1;
      for (let ix = 0; ix < wide; ix++) {
        for (let iz = 0; iz < wide; iz++) {
          put(cx + ix, y0 + i, cz + iz, (i & 3) === 0 ? c2 : c);
        }
      }
      tipX = cx; tipZ = cz;
    }
    return { x: tipX, z: tipZ, top: y1 };
  }

  function branch(x, y, z, ang, len, rise, c, opt = {}) {
    const dx = Math.cos(ang), dz = Math.sin(ang);
    let ex = x, ey = y, ez = z;
    for (let i = 1; i <= len; i++) {
      const t = i / len;
      const nx = Math.round(x + dx * len * t);
      const nz = Math.round(z + dz * len * t);
      const ny = Math.round(y + rise * Math.pow(t, 1.2));
      put(nx, ny, nz, c);
      if (opt.thick && i < len * 0.6) put(nx, ny + 1, nz, c);
      ex = nx; ey = ny; ez = nz;
    }
    return { x: ex, y: ey, z: ez };
  }

  // 冠外零星碎叶/花枝
  function crumbs(cx, cy, cz, rx, ry, rz, n, arr, salt = 31) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const b = Math.acos(rf(-1, 1));
      const d = 0.82 + rnd() * 0.45;
      const px = cx + Math.round(Math.cos(a) * Math.sin(b) * rx * d);
      const py = cy + Math.round(Math.cos(b) * ry * d);
      const pz = cz + Math.round(Math.sin(a) * Math.sin(b) * rz * d);
      put(px, py, pz, pickAt(arr, px, py, pz, salt));
    }
  }

  // ── 通用阔叶树 ──────────────────────────────────────────────────────────
  function makeTree(x, z, o = {}) {
    const hEst = Math.max(6, Math.round(o.h || 10));
    const rEst = Math.max(2, Math.round(o.r || hEst * 0.3));
    const sh = dryShift(x, z, rEst + 1);
    let g = site(sh[0], sh[1], { softAbove: true, clear: 1 });
    if (g < 0) { sh[0] = Math.round(x); sh[1] = Math.round(z); g = site(sh[0], sh[1], { softAbove: true, clear: 1 }); }
    if (g < 0) return;
    x = sh[0]; z = sh[1];
    const h = hEst;
    const r = Math.max(2, Math.round(o.r || h * 0.3));
    const spec = o.spec || leafSpec(o.colors);
    const trunkC = o.trunk || C.wood;
    const trunkC2 = o.trunkDark || C.woodDark;
    const trunkH = Math.max(3, Math.round(h * (o.trunkRatio || 0.44)));
    const lean = o.lean == null ? (chance(0.5) ? ri(-1, 1) : 0) : o.lean;
    const la = rnd() * Math.PI * 2;
    const t = trunkLean(x, z, g + 1, g + trunkH, trunkC, {
      lean, leanAngle: la, thick: o.thick == null ? (h >= 11 ? 2 : 1) : o.thick, c2: trunkC2,
    });
    // 露根
    for (let i = 0; i < 3; i++) {
      const a = rnd() * Math.PI * 2;
      put(x + Math.round(Math.cos(a)), g + 1, z + Math.round(Math.sin(a)), trunkC2);
    }
    // 主枝
    const nb = o.branches || (h >= 11 ? 4 : 3);
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * Math.PI * 2 + rnd() * 0.8;
      const by = g + Math.round(trunkH * (0.52 + 0.48 * (i / Math.max(1, nb - 1))));
      const len = Math.max(2, Math.round(h * (0.15 + rnd() * 0.1)));
      branch(t.x, by, t.z, a, len, Math.round(h * 0.18), trunkC2, { thick: false });
    }
    const topY = g + h;
    const shape = o.shape || 'round';
    if (shape === 'conical') crownConical(t.x, topY, t.z, r, spec, o);
    else if (shape === 'vase') crownVase(t.x, topY, t.z, r, spec, o);
    else if (shape === 'flat') crownFlat(t.x, topY, t.z, r, spec, o);
    else crownRound(t.x, topY, t.z, r, spec, o);
    bumpPlant();
  }

  // ── 花树（杏/桃/梨/梅/海棠）：满冠繁花 + 少量嫩叶，枝干透出 ───────────────
  function makeBlossomTree(x, z, bloom, o = {}) {
    const hEst = Math.max(6, Math.round(o.h || 9));
    const rEst = Math.max(2, Math.round(o.r || hEst * 0.4));
    const sh = dryShift(x, z, rEst + 1);
    let g = site(sh[0], sh[1], { softAbove: true, clear: 1 });
    if (g < 0) { sh[0] = Math.round(x); sh[1] = Math.round(z); g = site(sh[0], sh[1], { softAbove: true, clear: 1 }); }
    if (g < 0) return;
    x = sh[0]; z = sh[1];
    const h = hEst;
    const r = Math.max(2, Math.round(o.r || h * 0.4));
    const trunkH = Math.max(3, Math.round(h * (o.trunkRatio || 0.4)));
    const lean = o.lean == null ? ri(-1, 1) : o.lean;
    const la = rnd() * Math.PI * 2;
    const wood = C.woodDark;
    const t = trunkLean(x, z, g + 1, g + trunkH, wood, { lean, leanAngle: la, thick: h >= 9 ? 2 : 1, c2: C.wood });
    // 主枝（枝干透出花冠，梅枝尤其横斜）
    const nb = o.branches || (o.sparse ? 5 : (h >= 9 ? 4 : 3));
    const tips = [];
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * Math.PI * 2 + rnd() * 1.0;
      const by = g + trunkH - ri(0, 2);
      const len = Math.max(2, Math.round(h * ((o.sparse ? 0.3 : 0.24) + rnd() * 0.18)));
      tips.push(branch(t.x, by, t.z, a, len, Math.round(h * ((o.sparse ? 0.3 : 0.26) + rnd() * 0.16)), wood, { thick: chance(0.55) }));
    }
    const topY = g + h;
    crownRound(t.x, topY, t.z, r, bloom, {
      holes: o.sparse ? 0.3 : 0.17,
      flanks: o.flanks == null ? (o.sparse ? 1 : 3) : o.flanks,
      salt: 21,
      leafAccent: C.leafLight,
      fluff: 0.07,
      tiers: o.sparse ? 3 : 4,
    });
    // 冠外花枝：枝梢伸出一截 + 花团，形成「满冠繁花」的碎边
    for (let i = 0; i < tips.length; i++) {
      const tp = tips[i];
      const a2 = rnd() * Math.PI * 2;
      const len2 = ri(2, 4);
      for (let k = 1; k <= len2; k++) {
        const ex = tp.x + Math.round(Math.cos(a2) * k);
        const ez = tp.z + Math.round(Math.sin(a2) * k);
        const ey = tp.y + Math.round(k * 0.45);
        put(ex, ey, ez, wood);
        if (k >= len2 - 1 || chance(0.45)) {
          put(ex, ey + 1, ez, pickAt(bloom.edge, ex, ey + 1, ez, 41));
          put(ex + (chance(0.5) ? 1 : -1), ey, ez, pickAt(bloom.base, ex, ey, ez, 42));
          if (chance(0.4)) put(ex, ey, ez + (chance(0.5) ? 1 : -1), pickAt(bloom.base, ex, ey, ez, 43));
        }
      }
    }
    // 冠面零星嫩叶 + 少量深色花（层次）
    for (let i = 0; i < Math.round(r * 2.2); i++) {
      const a = rnd() * Math.PI * 2;
      const d = r * (0.55 + rnd() * 0.55);
      const ex = t.x + Math.round(Math.cos(a) * d);
      const ez = t.z + Math.round(Math.sin(a) * d);
      const ey = topY - Math.round(rf(0.1, 1.7) * r);
      if (chance(0.55)) put(ex, ey, ez, pickAt(GROUPS.leaf, ex, ey, ez, 44));
      else put(ex, ey, ez, pickAt(bloom.edge, ex, ey, ez, 45));
    }
    bumpPlant();
  }

  // ── 松（黄山松意象：层叠平展枝盘）───────────────────────────────────────
  function pinePad(cx, cy, cz, rx, rz, spec, salt) {
    for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
      for (let dz = -Math.ceil(rz); dz <= Math.ceil(rz); dz++) {
        const q = Math.sqrt((dx / rx) * (dx / rx) + (dz / rz) * (dz / rz));
        const px = cx + dx, pz = cz + dz;
        if (q > 1) {
          if (q < 1.25 && chance(0.1)) put(px, cy, pz, pickAt(spec.edge, px, cy, pz, salt));
          continue;
        }
        if (q > 0.82 && chance(0.16)) continue;
        const c = q > 0.62 ? pickAt(spec.edge, px, cy, pz, salt) : (q < 0.4 ? C.pineDark : pickAt(spec.base, px, cy, pz, salt));
        put(px, cy, pz, c);
        if (q < 0.45 && chance(0.55)) put(px, cy + 1, pz, pickAt(spec.edge, px, cy + 1, pz, salt));
        if (q > 0.6 && q < 0.92 && chance(0.2)) put(px, cy - 1, pz, C.pineDark);
      }
    }
  }

  function pine(x, z, o = {}) {
    const hEst = Math.max(8, Math.round(o.h || 15));
    const rEst = Math.max(2, Math.round(o.r || 5));
    const sh = dryShift(x, z, rEst + 1);
    let g = site(sh[0], sh[1], { softAbove: true, clear: 1 });
    if (g < 0) { sh[0] = Math.round(x); sh[1] = Math.round(z); g = site(sh[0], sh[1], { softAbove: true, clear: 1 }); }
    if (g < 0) return;
    x = sh[0]; z = sh[1];
    const h = hEst;
    const r = rEst;
    const lean = o.lean == null ? (chance(0.65) ? ri(-2, 2) : 0) : o.lean;
    const la = rnd() * Math.PI * 2;
    const trunkTop = g + Math.round(h * 0.92);
    const t = trunkLean(x, z, g + 1, trunkTop, C.woodDark, { lean, leanAngle: la, thick: 2, c2: C.wood });
    // 根部盘结
    for (let i = 0; i < 4; i++) {
      const a = rnd() * Math.PI * 2;
      put(x + Math.round(Math.cos(a) * 1.4), g + 1, z + Math.round(Math.sin(a) * 1.4), C.woodDark);
    }
    const spec = SPEC.pine;
    const levels = h >= 15 ? 6 : 5;
    for (let i = 0; i < levels; i++) {
      const f = i / (levels - 1);
      const py = g + Math.round(h * (0.3 + 0.62 * f));
      // 中层最宽
      const pr = Math.max(1.6, r * (1.0 - 0.72 * Math.abs(f - 0.5)));
      const a = rnd() * Math.PI * 2;
      const off = Math.round((1 - f) * r * 0.5);
      const px = t.x + Math.round(Math.cos(a) * off);
      const pz = t.z + Math.round(Math.sin(a) * off);
      const rx = Math.max(1.6, pr * (1 + 0.35 * (i % 2 ? 1 : -1)));
      const rz = Math.max(1.4, pr * (1 - 0.18 * (i % 2 ? 1 : -1)));
      // 枝：树干 → 枝盘
      branch(t.x, py - 1, t.z, a, Math.max(2, Math.round(Math.hypot(px - t.x, pz - t.z)) + 1), 0, C.woodDark, {});
      pinePad(px, py, pz, rx, rz, spec, 70 + i);
    }
    // 顶稍
    pinePad(t.x, g + h, t.z, Math.max(1.2, r * 0.3), Math.max(1.2, r * 0.3), spec, 88);
    for (let i = 0; i < 3; i++) put(t.x + ri(-1, 1), g + h + 1, t.z + ri(-1, 1), C.pineLight);
    bumpPlant();
  }

  // ── 垂柳（柳条 3~6 格下垂；近水自动向水倾）──────────────────────────────
  function willow(x, z, o = {}) {
    const hEst = Math.max(8, Math.round(o.h || 13));
    const rEst = Math.max(2, Math.round(o.r || hEst * 0.31));
    const sh = dryShift(x, z, rEst + 1);
    let g = site(sh[0], sh[1], { softAbove: true, clear: 1 });
    if (g < 0) { sh[0] = Math.round(x); sh[1] = Math.round(z); g = site(sh[0], sh[1], { softAbove: true, clear: 1 }); }
    if (g < 0) return;
    x = sh[0]; z = sh[1];
    const h = hEst;
    const r = rEst;
    // 探水：临岸柳向陆侧倾斜（水面格不再允许枝干/树冠，避免「树长水里」）
    let wet = null;
    outer: for (let d = 1; d <= 4; d++) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if (isWater(x + dx * d, z + dz * d)) { wet = [dx * d, dz * d]; break outer; }
      }
    }
    const lean = wet ? ri(1, 2) : ri(-1, 1);
    const la = wet ? Math.atan2(-wet[1], -wet[0]) : rnd() * Math.PI * 2;
    const trunkH = Math.max(4, Math.round(h * 0.5));
    const t = trunkLean(x, z, g + 1, g + trunkH, C.wood, { lean: Math.max(-3, Math.min(3, lean)), leanAngle: la, thick: 2, c2: C.woodDark });
    // 分枝（上扬）
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rnd() * 0.8;
      branch(t.x, g + trunkH - ri(0, 1), t.z, a, Math.max(2, Math.round(r * 0.9)), Math.round(r * 0.7), C.woodDark, {});
    }
    const spec = SPEC.willow;
    const topY = g + h;
    // 上层柳冠（半球）
    blob(t.x, topY - Math.round(r * 0.85), t.z, r, Math.max(2, Math.round(r * 0.62)), r, spec, { holes: 0.11, salt: 5 });
    blob(t.x, topY - Math.round(r * 1.5), t.z, Math.round(r * 0.72), Math.max(2, Math.round(r * 0.45)), Math.round(r * 0.72), spec, { holes: 0.13, salt: 6 });
    // 柳条：从冠缘下垂 4~7 格（明显长垂枝），左右微摆
    const strands = o.strands || ri(12, 16);
    for (let s = 0; s < strands; s++) {
      const a = rnd() * Math.PI * 2;
      const rr = r * (0.65 + rnd() * 0.45);
      let sx = t.x + Math.round(Math.cos(a) * rr);
      let sz = t.z + Math.round(Math.sin(a) * rr);
      let sy = topY - Math.round(r * (0.35 + rnd() * 0.5));
      const len = Math.min(ri(4, 7), Math.max(2, sy - (g + 1)));
      for (let k = 0; k < len; k++) {
        put(sx, sy - k, sz, (k % 3 === 0) ? C.willow2 : ((k % 3 === 1) ? C.willow : C.leafLight));
        if (chance(0.3)) put(sx + (chance(0.5) ? 1 : -1), sy - k, sz, C.willow2);
        if (k > 0 && k % 2 === 0 && chance(0.5)) { sx += Math.round(Math.cos(a)); sz += Math.round(Math.sin(a)); }
      }
      // 条梢叶片
      if (sy - len > g + 1) {
        put(sx, sy - len, sz, C.willow2);
        if (chance(0.5)) put(sx, sy - len - 1, sz, C.willow2);
      }
    }
    bumpPlant();
  }

  // ── 竹（成丛：多竿、竹节色差、顶部细叶）─────────────────────────────────
  function bamboo(x, z, o = {}) {
    const spread = o.spread == null ? 3 : o.spread;
    const sh = dryShift(x, z, spread + 2);
    let g0 = site(sh[0], sh[1], { softAbove: true, clear: 1 });
    if (g0 < 0) { sh[0] = Math.round(x); sh[1] = Math.round(z); g0 = site(sh[0], sh[1], { softAbove: true, clear: 1 }); }
    if (g0 < 0) return;
    x = sh[0]; z = sh[1];
    const n = Math.max(3, Math.min(16, Math.round(o.count || 9)));
    const baseH = Math.max(6, Math.round(o.h || 10));
    let placedCulms = 0;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * spread;
      const cx = x + Math.round(Math.cos(a) * rr);
      const cz = z + Math.round(Math.sin(a) * rr);
      const g = site(cx, cz, { softAbove: true, clear: 1 });
      if (g < 0) continue;
      const hh = Math.max(5, baseH + ri(-2, 3));
      const leanA = rnd() * Math.PI * 2;
      const lean = rf(0, 1.6);
      let ex = cx, ez = cz;
      for (let y = 0; y < hh; y++) {
        const k = Math.pow(y / hh, 1.5);
        ex = cx + Math.round(Math.cos(leanA) * lean * k);
        ez = cz + Math.round(Math.sin(leanA) * lean * k);
        const col = (y % 3 === 0) ? C.bambooNode : C.bambooStalk;
        put(ex, g + 1 + y, ez, col);
      }
      // 顶部细叶：多簇、横向铺开、梢头略下垂
      const sprays = ri(5, 8);
      for (let s2 = 0; s2 < sprays; s2++) {
        const sa = (s2 / sprays) * Math.PI * 2 + rnd() * 0.9;
        const sd = 1 + rnd() * 2.6;
        const lx = ex + Math.round(Math.cos(sa) * sd);
        const lz = ez + Math.round(Math.sin(sa) * sd);
        const ly = g + 1 + hh + ri(-1, 1);
        // 每簇 3~4 片细叶，叶色有明暗层次
        const leafC = pickAt(GROUPS.bamboo, lx, ly, lz, 11);
        put(lx, ly, lz, leafC);
        put(lx + (chance(0.5) ? 1 : -1), ly + (chance(0.6) ? 1 : 0), lz, pickAt(GROUPS.bamboo, lx, ly + 1, lz, 12));
        if (chance(0.6)) put(lx, ly, lz + (chance(0.5) ? 1 : -1), C.bambooLeaf2);
        if (chance(0.5)) put(lx, ly - 1, lz, chance(0.5) ? C.bambooLeaf3 : leafC); // 下垂细叶
        if (chance(0.25)) put(lx + (chance(0.5) ? 1 : -1), ly - 1, lz, C.bambooLeaf2);
      }
      // 竿顶叶
      put(ex, g + 1 + hh + 1, ez, C.bambooLeaf2);
      put(ex, g + 1 + hh + 2, ez, C.bambooLeaf);
      placedCulms++;
    }
    if (placedCulms) bumpPlant();
  }

  // ── 芭蕉（宽叶放射）─────────────────────────────────────────────────────
  function banana(x, z, o = {}) {
    const sh = dryShift(x, z, 3);
    let g = site(sh[0], sh[1], { softAbove: true, clear: 1 });
    if (g < 0) { sh[0] = Math.round(x); sh[1] = Math.round(z); g = site(sh[0], sh[1], { softAbove: true, clear: 1 }); }
    if (g < 0) return;
    x = sh[0]; z = sh[1];
    const stemH = Math.max(3, Math.round(o.h || 6));
    const x0 = x, z0 = z;
    // 假茎（叶鞘）
    for (let y = 0; y < stemH; y++) {
      put(x0, g + 1 + y, z0, (y % 2) ? C.leafDark : C.leaf);
      if (y < 2) { put(x0 + 1, g + 1 + y, z0, C.leafDark); put(x0, g + 1 + y, z0 + 1, C.leafDark); }
    }
    // 放射宽叶：先上扬后外展微垂，叶宽 2~3 格（蕉叶意象）
    const leaves = Math.max(5, Math.round(o.leaves || ri(6, 8)));
    for (let i = 0; i < leaves; i++) {
      const a = (i / leaves) * Math.PI * 2 + rnd() * 0.5;
      const dx = Math.cos(a), dz = Math.sin(a);
      const px = -dz, pz = dx; // 垂直方向（叶宽）
      for (let t = 1; t <= 3; t++) {
        const lx = x0 + Math.round(dx * t);
        const lz = z0 + Math.round(dz * t);
        const ly = g + stemH + (t === 1 ? 0 : (t === 2 ? 1 : 2));
        put(lx, ly, lz, t <= 1 ? C.leaf : C.leafLight);
        if (t >= 2) {
          const y2 = t === 3 ? ly - 1 : ly; // 叶尖微垂
          put(lx + Math.round(px), y2, lz + Math.round(pz), C.leaf);
          put(lx - Math.round(px), y2, lz - Math.round(pz), C.leafDark);
          if (t === 3) {
            put(lx, y2, lz, C.leafLight);
            put(lx + Math.round(px * 2), y2, lz + Math.round(pz * 2), C.leaf);
            put(lx - Math.round(px * 2), y2, lz - Math.round(pz * 2), C.leafDark);
          }
        }
      }
    }
    // 中央嫩叶直立
    put(x0, g + stemH + 1, z0, C.leafLight);
    put(x0, g + stemH + 2, z0, C.leaf);
    // 幼芽
    if (chance(0.65)) {
      const sx = x0 + (chance(0.5) ? 2 : -2), sz = z0 + ri(-1, 1);
      const g2 = site(sx, sz, { softAbove: true, clear: 1 });
      if (g2 >= 0) {
        const h2 = Math.max(2, stemH - 2);
        for (let y = 0; y < h2; y++) put(sx, g2 + 1 + y, sz, C.leafDark);
        for (let i = 0; i < 4; i++) {
          const a = rnd() * Math.PI * 2;
          put(sx + Math.round(Math.cos(a) * 2), g2 + h2 + ri(0, 1), sz + Math.round(Math.sin(a) * 2), C.leafLight);
        }
      }
    }
    bumpPlant();
  }

  // ── 其它阔叶树（冠形各异）──────────────────────────────────────────────
  function wutong(x, z, o = {}) {
    makeTree(x, z, {
      h: 13, r: 5, trunk: C.woodLight, shape: 'flat', wide: 1.1,
      colors: [C.leaf, C.leafDark, C.leafYellow], ...o,
    });
  }
  function elm(x, z, o = {}) {
    makeTree(x, z, {
      h: 13, r: 4, trunk: C.wood, shape: 'vase',
      colors: GROUPS.leaf, ...o,
    });
  }
  function locust(x, z, o = {}) {
    makeTree(x, z, {
      h: 12, r: 4.5, trunk: C.woodDark, shape: 'flat',
      colors: [C.leafYellow, C.leafLight, C.leaf], ...o,
    });
  }
  function mulberry(x, z, o = {}) {
    makeTree(x, z, {
      h: 8, r: 3, trunk: C.wood, colors: [C.leaf, C.leafLight, C.leafDark], wide: 1.15, ...o,
    });
  }
  function ginkgo(x, z, o = {}) {
    makeTree(x, z, {
      h: 12, r: 3.6, trunk: C.woodLight, shape: 'conical', wide: 1,
      colors: [C.leafYellow, C.chrys, C.leafLight, C.leaf], ...o,
    });
  }
  function tree(x, z, o = {}) {
    makeTree(x, z, o);
  }
  // 花树物种（局部函数：F.* 与 scatterGarden 共用，避免裸引用未绑定）
  function apricot(x, z, o = {}) {
    if (o.bloom === false) makeTree(x, z, { h: 10, r: 4, colors: GROUPS.leaf, ...o });
    else makeBlossomTree(x, z, BLOOM.apricot, { h: 10, r: 3.7, trunkRatio: 0.45, ...o });
  }
  function peach(x, z, o = {}) {
    makeBlossomTree(x, z, BLOOM.peach, { h: 9, r: 3.4, trunkRatio: 0.45, ...o });
  }
  function plum(x, z, o = {}) {
    // 红梅：疏影横斜（高一点、冠小、枝多、留大空隙）；白梅/玉兰树冠稍满
    makeBlossomTree(x, z, o.red ? BLOOM.plumRed : BLOOM.plumWhite, {
      h: o.red ? 9 : 9, r: o.red ? 2.9 : 3.2, trunkRatio: 0.45, sparse: !!o.red, ...o,
    });
  }
  function pear(x, z, o = {}) {
    makeBlossomTree(x, z, BLOOM.pear, { h: 10, r: 3.6, trunkRatio: 0.45, ...o });
  }
  function crabapple(x, z, o = {}) {
    makeBlossomTree(x, z, BLOOM.crabapple, { h: 11, r: 4.6, ...o });
  }

  // ── 灌木 ────────────────────────────────────────────────────────────────
  function shrub(x, z, o = {}) {
    const rEst = Math.max(1, Math.round(o.r || 3));
    const sh = dryShift(x, z, rEst + 1);
    let g = site(sh[0], sh[1], { softAbove: true, clear: 1 });
    if (g < 0) { sh[0] = Math.round(x); sh[1] = Math.round(z); g = site(sh[0], sh[1], { softAbove: true, clear: 1 }); }
    if (g < 0) return;
    x = sh[0]; z = sh[1];
    const r = rEst;
    const colors = o.c ? (Array.isArray(o.c) ? o.c : [o.c]) : GROUPS.leaf;
    const spec = leafSpec(colors);
    blob(x, g + 1 + Math.round(r * 0.45), z, r, Math.max(1, Math.round(r * 0.8)), r, spec, { holes: 0.1, salt: 7 });
    // 顶部小枝 + 底部叶
    for (let i = 0; i < 3; i++) put(x + ri(-1, 1), g + 2 + Math.round(r * 0.8) + ri(0, 1), z + ri(-1, 1), C.leafDark);
    for (let i = 0; i < 3; i++) {
      const a = rnd() * Math.PI * 2;
      put(x + Math.round(Math.cos(a) * r), g + 1, z + Math.round(Math.sin(a) * r), pick(GROUPS.leaf));
    }
    bumpPlant();
  }

  // ── 草丛 ────────────────────────────────────────────────────────────────
  function grassTuft(x, z, o = {}) {
    const g = groundSite(x, z);
    if (g < 0 || isPath(x, z)) return;
    const cols = o.c ? (Array.isArray(o.c) ? o.c : [o.c]) : [C.grass3, C.leafLight, C.vegetable, C.grass2];
    const n = ri(2, 4);
    for (let i = 0; i < n; i++) {
      const px = x + ri(-1, 1), pz = z + ri(-1, 1);
      const c = pick(cols);
      put(px, g + 1, pz, c);
      if (chance(0.28)) put(px, g + 2, pz, (c === C.vegetable ? C.leaf : pick(cols)));
    }
  }

  // ── 花圃（成畦：植株 + 花头 + 地面色差）─────────────────────────────────
  function flowerPatch(x1, z1, x2, z2, o = {}) {
    const ax1 = Math.round(Math.min(x1, x2)), ax2 = Math.round(Math.max(x1, x2));
    const az1 = Math.round(Math.min(z1, z2)), az2 = Math.round(Math.max(z1, z2));
    const colors = o.colors || [C.chrys, C.peony, C.lotusFlower, C.plumWhite];
    const count = Math.max(6, Math.round(o.count || 60));
    const alongX = (ax2 - ax1) >= (az2 - az1);
    const rowGap = Math.max(2, o.rowGap || 3);
    const plantGap = Math.max(2, o.plantGap || 2);
    const bedC = o.bedC || (chance(0.5) ? C.soilDark : C.farm);
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
        // 花畦地面色差（只改草皮）
        tintGround(px, pz, bedC, true);
        const stemC = pick([C.vegetable, C.leafDark, C.leaf]);
        put(px, g + 1, pz, stemC);
        const tall = chance(0.35) ? 2 : 1;
        if (tall === 2) put(px, g + 2, pz, C.leafDark);
        put(px, g + 1 + tall, pz, pick(colors));
        if (chance(0.28)) put(px + (chance(0.5) ? 1 : -1), g + 1 + tall, pz, pick(colors));
        if (chance(0.18)) put(px, g + 2 + tall, pz, pick(colors));
        placed++;
      }
    }
    if (placed) bumpPlant();
  }

  // ── 芍药/牡丹圃（成畦、大花头、叶丛）────────────────────────────────────
  function peonyBed(x1, z1, x2, z2, o = {}) {
    const ax1 = Math.round(Math.min(x1, x2)), ax2 = Math.round(Math.max(x1, x2));
    const az1 = Math.round(Math.min(z1, z2)), az2 = Math.round(Math.max(z1, z2));
    const colors = o.colors || [C.peony, C.peony2, C.plumWhite];
    const area = Math.max(1, (ax2 - ax1) * (az2 - az1));
    const count = Math.max(8, Math.round(o.count || Math.min(180, area / 9)));
    const alongX = (ax2 - ax1) >= (az2 - az1);
    const rowGap = Math.max(3, o.rowGap || 4);
    const plantGap = Math.max(2, o.plantGap || 3);
    const bedC = o.bedC || C.soilDark;
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
        // 叶丛
        for (const [ex, ez] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (chance(0.7)) put(px + ex, g + 1, pz + ez, chance(0.5) ? C.leafDark : C.leaf);
        }
        // 茎 + 花头（2~4 格高，牡丹更大）
        put(px, g + 1, pz, C.leafDark);
        put(px, g + 2, pz, C.leafDark);
        const big = chance(0.4);
        if (big) put(px, g + 3, pz, C.leafDark);
        const hy = g + 3 + (big ? 1 : 0);
        put(px, hy, pz, pick(colors));
        const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]][ri(0, 3)];
        put(px + dir[0], hy, pz + dir[1], pick(colors));
        if (big) { put(px + (chance(0.5) ? 1 : -1), hy, pz + (chance(0.5) ? 1 : -1), pick([C.peony2, C.plumWhite])); }
        if (chance(0.15)) put(px, hy + 1, pz, C.plumWhite);
        placed++;
      }
    }
    if (placed) bumpPlant();
  }

  // ── 芦苇丛（贴岸；不用落水）────────────────────────────────────────────
  function reedBed(x1, z1, x2, z2, o = {}) {
    const ax1 = Math.round(Math.min(x1, x2)), ax2 = Math.round(Math.max(x1, x2));
    const az1 = Math.round(Math.min(z1, z2)), az2 = Math.round(Math.max(z1, z2));
    const area = Math.max(1, (ax2 - ax1) * (az2 - az1));
    const clumps = Math.max(3, Math.min(16, Math.round(o.count != null ? Math.min(o.count, 16) : Math.max(3, area / 18))));
    const cols = [C.reed, C.reed2, C.straw];
    let placed = 0;
    for (let c = 0; c < clumps; c++) {
      const cx = ri(ax1, ax2), cz = ri(az1, az2);
      const g = groundSite(cx, cz);
      if (g < 0 || isPath(cx, cz)) continue;
      const stems = ri(4, 8);
      for (let s = 0; s < stems; s++) {
        const px = cx + ri(-2, 2), pz = cz + ri(-2, 2);
        const g2 = groundSite(px, pz);
        if (g2 < 0 || isPath(px, pz)) continue;
        const hh = ri(2, 4);
        const leanA = rnd() * Math.PI * 2;
        for (let y = 0; y < hh; y++) {
          const ox = Math.round(Math.cos(leanA) * (y / Math.max(1, hh)) * 0.9);
          const oz = Math.round(Math.sin(leanA) * (y / Math.max(1, hh)) * 0.9);
          put(px + ox, g2 + 1 + y, pz + oz, y === 0 ? C.reed2 : (y < hh - 1 ? C.reed : C.straw));
        }
        // 芦花穗
        put(px, g2 + 1 + hh, pz, C.straw);
        if (chance(0.6)) put(px + (chance(0.5) ? 1 : -1), g2 + 1 + hh, pz, C.straw);
        if (chance(0.35)) put(px, g2 + 2 + hh, pz, C.reed);
        // 斜出的苇叶
        if (chance(0.4)) {
          const a = rnd() * Math.PI * 2;
          put(px + Math.round(Math.cos(a)), g2 + 1 + Math.floor(hh / 2), pz + Math.round(Math.sin(a)), C.reed2);
        }
      }
      placed++;
    }
    if (placed) bumpPlant();
  }

  // ── 荷（严格水面；叶片在 y=3 层）──────────────────────────────────────
  function lotus(cx, cz, rx, rz, o = {}) {
    cx = Math.round(cx); cz = Math.round(cz);
    rx = Math.max(1, Math.round(rx)); rz = Math.max(1, Math.round(rz));
    const count = Math.max(6, Math.round(o.count || 60));
    const padCols = [C.lotusPad, C.lotusPad2, C.lotusPad3];
    const allWet = (x, z) => isWater(x, z) && w.get(x, WATER_Y, z) === 0;
    let pads = 0;
    for (let i = 0; i < count * 3 && pads < count; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd());
      const x = Math.round(cx + Math.cos(a) * rx * rr);
      const z = Math.round(cz + Math.sin(a) * rz * rr);
      if (!allWet(x, z)) continue;
      const c = pickAt(padCols, x, WATER_Y, z, 11);
      const kind = ri(0, 2);
      if (kind === 0) {
        if (putWater(x, WATER_Y, z, c)) pads++;
      } else if (kind === 1) {
        if (!allWet(x + 1, z) || !allWet(x, z + 1) || !allWet(x + 1, z + 1)) continue;
        const c2 = pickAt(padCols, x + 1, WATER_Y, z, 12);
        putWater(x, WATER_Y, z, c); putWater(x + 1, WATER_Y, z, c);
        putWater(x, WATER_Y, z + 1, c2); putWater(x + 1, WATER_Y, z + 1, c2);
        pads++;
      } else {
        if (!allWet(x + 1, z) || !allWet(x - 1, z) || !allWet(x, z + 1) || !allWet(x, z - 1)) continue;
        const c2 = pickAt(padCols, x, WATER_Y, z + 1, 13);
        putWater(x, WATER_Y, z, c2); putWater(x + 1, WATER_Y, z, c); putWater(x - 1, WATER_Y, z, c);
        putWater(x, WATER_Y, z + 1, c2); putWater(x, WATER_Y, z - 1, c);
        if (chance(0.4)) putWater(x, WATER_Y + 1, z, c); // 中心微翘
        pads++;
      }
    }
    // 荷花/莲蓬（少量）
    const flowers = Math.max(1, Math.round(o.flowers != null ? o.flowers : count * 0.07));
    let fl = 0;
    for (let i = 0; i < flowers * 5 && fl < flowers; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd());
      const x = Math.round(cx + Math.cos(a) * rx * rr);
      const z = Math.round(cz + Math.sin(a) * rz * rr);
      if (!allWet(x, z)) continue;
      putWater(x, WATER_Y, z, C.lotusPad3);                            // 承花叶
      putWater(x, WATER_Y + 1, z, pick([C.lotusFlower, C.peony2]));    // 花
      if (chance(0.45)) putWater(x, WATER_Y + 2, z, C.lotusFlower);
      if (chance(0.5)) putWater(x + 1, WATER_Y + 1, z, C.lotusFlower);  // 侧瓣
      if (chance(0.3)) putWater(x, WATER_Y + 1, z + 1, C.peony2);
      fl++;
    }
    bumpPlant();
  }

  // ── 藤萝/蔷薇/荼蘼棚架（有顶、有垂藤）──────────────────────────────────
  function vine(a, b, c, d, e) {
    let o;
    if (a && typeof a === 'object') o = a;
    else o = { x1: a, z1: b, x2: c, z2: d, ...(e || {}) };
    const xa = Math.round(o.x1 ?? 0), za = Math.round(o.z1 ?? 0);
    const xb = Math.round(o.x2 ?? xa + 4), zb = Math.round(o.z2 ?? za + 2);
    const x1 = Math.min(xa, xb), x2 = Math.max(xa, xb);
    const z1 = Math.min(za, zb), z2 = Math.max(za, zb);
    if (x2 - x1 < 1 || z2 - z1 < 0) return;
    if (Math.abs(x1) > LIMIT || Math.abs(x2) > LIMIT || Math.abs(z1) > LIMIT || Math.abs(z2) > LIMIT) return;
    const leafC = o.leafC || C.leafLight;
    const leafArr = Array.isArray(o.leafs) ? o.leafs : [leafC, C.leaf, C.leafLight];
    const topArr = o.topC ? (Array.isArray(o.topC) ? o.topC : [o.topC]) : null;
    // 棚顶高度
    let y = o.y;
    if (!Number.isFinite(y)) {
      const g0 = Math.max(terrainTop(x1, z1), terrainTop(x2, z2), terrainTop(x1, z2), terrainTop(x2, z1));
      y = (g0 >= 0 ? g0 : 3) + 5;
    }
    y = Math.round(y);
    const alongX = (x2 - x1) >= (z2 - z1);
    // 立柱
    const posts = [];
    const stepL = 5;
    if (alongX) {
      for (let x = x1; x <= x2; x += stepL) { posts.push([x, z1], [x, z2]); }
      posts.push([x2, z1], [x2, z2]);
    } else {
      for (let z = z1; z <= z2; z += stepL) { posts.push([x1, z], [x2, z]); }
      posts.push([x1, z2], [x2, z2]);
    }
    const seen = new Set();
    for (const [px, pz] of posts) {
      const k = px + ',' + pz;
      if (seen.has(k)) continue;
      seen.add(k);
      const g = terrainTop(px, pz);
      if (g < 0) continue;
      const thick = (px === x1 || px === x2) && (pz === z1 || pz === z2);
      for (let yy = g + 1; yy < y; yy++) {
        put(px, yy, pz, (yy % 4 === 0) ? C.woodDark : C.wood);
        if (thick && yy < g + 3) put(px + (px === x1 ? 1 : -1), yy, pz, C.woodDark);
      }
    }
    // 顶架
    for (let x = x1; x <= x2; x++) { put(x, y, z1, C.woodDark); put(x, y, z2, C.woodDark); }
    for (let z = z1; z <= z2; z++) { put(x1, y, z, C.woodDark); put(x2, y, z, C.woodDark); }
    for (let x = x1; x <= x2; x += 3) for (let z = z1 + 1; z < z2; z++) put(x, y, z, C.wood);
    for (let z = z1; z <= z2; z += 3) for (let x = x1 + 1; x < x2; x++) put(x, y, z, C.wood);
    // 顶面藤叶（留空隙）
    for (let x = x1; x <= x2; x++) {
      for (let z = z1; z <= z2; z++) {
        if (chance(0.12)) continue;
        const cc = pickAt(leafArr, x, y + 1, z, 3);
        put(x, y + 1, z, cc);
        if (topArr && chance(0.16)) put(x, y + 2, z, pickAt(topArr, x, y + 2, z, 5));
        if (chance(0.22)) put(x, y + 2, z, pickAt(leafArr, x, y + 2, z, 4));
      }
    }
    // 垂藤（棚缘 + 内部，2~4 格下垂，花在梢头）
    const drops = Math.max(6, Math.round((x2 - x1 + z2 - z1) * 0.9));
    for (let i = 0; i < drops; i++) {
      let dx, dz;
      if (chance(0.65)) {
        if (alongX) { dx = ri(x1, x2); dz = chance(0.5) ? z1 : z2; }
        else { dz = ri(z1, z2); dx = chance(0.5) ? x1 : x2; }
      } else {
        dx = ri(x1, x2); dz = ri(z1, z2);
      }
      const len = ri(2, 4);
      for (let k = 0; k < len; k++) {
        const yy = y + 1 - k;
        if (yy <= 1) break;
        put(dx, yy, dz, k === 0 ? leafC : pickAt(leafArr, dx, yy, dz, 6));
        if (k > 0 && chance(0.35)) put(dx + (chance(0.5) ? 1 : -1), yy, dz, C.leaf);
        if (topArr && k === len - 1 && chance(0.55)) {
          put(dx, yy, dz, pickAt(topArr, dx, yy, dz, 7));
          if (chance(0.4)) put(dx, yy - 1, dz, pickAt(topArr, dx, yy - 1, dz, 8));
        }
      }
    }
    bumpPlant();
  }

  // ── 山石（太湖石/青石驳岸：块面凹凸、留孔洞、可长苔）────────────────────
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
    // 主峰
    lobes.push({ cx: x, cz: z, rx: W * 0.3, rz: W * 0.3, ry: H * 0.62, cy: g0 + 1 + Math.round(H * 0.32) });
    // 透孔中心
    const holes = [];
    for (let i = 0; i < 2 + Math.floor(rr() * 3); i++) {
      holes.push({
        x: x + (rr() - 0.5) * W * 0.9,
        y: g0 + 1 + rr() * H * 0.85,
        z: z + (rr() - 0.5) * W * 0.9,
        r: 1 + rr() * 1.2,
      });
    }
    const topMap = new Map(); // x,z -> 该列最高石体 y
    const place = (px, py, pz, c) => {
      px = Math.round(px); py = Math.round(py); pz = Math.round(pz);
      if (py < g0 + 1) return false;
      if (Math.abs(px) > 158 || Math.abs(pz) > 158) return false;
      // 石脚不落在水面/路面
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
            // 孔洞
            let inHole = false;
            for (const hh of holes) {
              if ((px - hh.x) ** 2 + (py - hh.y) ** 2 + (pz - hh.z) ** 2 <= hh.r * hh.r) { inHole = true; break; }
            }
            if (inHole) continue;
            const q = Math.sqrt(q2);
            // 块面凹凸：内部挖空一部分（壳感），外缘近乎实
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
    // 基座（沿地面一圈，土石交错，接地不悬空）
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

  // ── 苔藓地面点缀 ────────────────────────────────────────────────────────
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
        // 双尺度噪声成片（避免椒盐噪点）
        const n1 = (hash3(x >> 1, 0, z >> 1, 17) & 1023) / 1023;
        const n2 = (hash3(x, 0, z, 23) & 255) / 255;
        if (n1 * 0.65 + n2 * 0.35 > density) continue;
        if (n2 < 0.18) w.set(x, g, z, C.darkMoss || C.mossRock);
        else if (n2 < 0.34) w.set(x, g, z, C.grass2);
        else if (n1 < 0.3) w.set(x, g, z, C.mossRock);
        if (chance(0.06) && w.get(x, g + 1, z) === 0) put(x, g + 1, z, chance(0.6) ? C.mossRock : C.grass3);
      }
    }
    bumpPlant();
  }

  // ── 全园兜底散植（可选；main 在场景生成之后调用一次）──────────────────────
  //   · 只在空地补种，避开 PADS（不种进院子）、水面、道路、保留区；
  //   · 只写空体素 + 只给草皮改色，不覆盖已有建筑/场景体素；
  //   · 幂等安全：第二次调用时绝大多数落点已被占用而自动跳过；
  //   · opts.only: 逗号分隔的类别（lotus,reed,willow,trees,beds,moss,grass）
  function scatterGarden(opts = {}) {
    // 幂等：同一个世界只散植一次（main 会调用一次；重复调用直接跳过）
    if (!opts.force) {
      if (SCATTERED.has(w)) return;
      SCATTERED.add(w);
    }
    const only = opts.only ? String(opts.only) : null;
    const want = (k) => !only || only.split(',').indexOf(k) >= 0;
    const nearWater = (x, z, rad) => {
      for (let d = 1; d <= rad; d++) {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const dx = Math.round(Math.cos(a) * d), dz = Math.round(Math.sin(a) * d);
          if (isWater(x + dx, z + dz)) return true;
        }
      }
      return false;
    };
    // 可落点：地形实体、非水非路非保留、不在台地院落内、基底一格为空（幂等）
    const free = (x, z, padMargin = 0) => {
      x = Math.round(x); z = Math.round(z);
      if (Math.abs(x) > 152 || Math.abs(z) > 152) return -1;
      if (inPad(x, z, padMargin)) return -1;
      const g = groundSite(x, z);
      if (g < 0) return -1;
      if (isPath(x, z) || reservedAt(x, z)) return -1;
      if (w.get(x, g + 1, z) !== 0) return -1;
      return g;
    };
    const Z = (name) => (ZONES ? ZONES[name] : null);
    // 沿 zone 外扩 band 环带取点（避开台地内部）
    const ringPts = (zn, band, n) => {
      const pts = [];
      if (!zn) return pts;
      for (let i = 0; i < n * 12 && pts.length < n; i++) {
        const x = ri(zn.x1 - band, zn.x2 + band);
        const z = ri(zn.z1 - band, zn.z2 + band);
        if (x > zn.x1 && x < zn.x2 && z > zn.z1 && z < zn.z2) continue;
        if (Math.abs(x) > 152 || Math.abs(z) > 152) continue;
        if (inPad(x, z, 0)) continue;
        pts.push([x, z]);
      }
      return pts;
    };
    // 树木间距（≥4 格）+ 全园候选树数量上限（~340），避免密集成团、保留林下草地与路径视线
    const treeList = [];
    const TREE_CAP = opts.maxTrees != null ? opts.maxTrees : 340;
    const treeFree = (x, z, minD) => {
      if (treeList.length >= TREE_CAP) return false;
      for (let i = 0; i < treeList.length; i++) {
        const t = treeList[i];
        const dx = t[0] - x, dz = t[1] - z;
        if (dx * dx + dz * dz < minD * minD) return false;
      }
      return true;
    };
    // 该格地面之上是否已有东西（避免重复种植/压到场景已种花木）
    const baseFree = (x, z) => {
      const g = terrainTop(x, z);
      return g >= 0 && w.get(x, g + 1, z) === 0;
    };
    const plantAt = (fn, x, z, minD = 0) => {
      if (!baseFree(x, z)) return 0;
      if (minD > 0 && !treeFree(x, z, minD)) return 0;
      const before = plantCount;
      fn(x, z);
      if (plantCount <= before) return 0;
      if (minD > 0) treeList.push([Math.round(x), Math.round(z)]);
      return 1;
    };
    const plantRing = (zn, band, n, fn, minD = 0) => {
      const pts = ringPts(zn, band, n);
      let c = 0;
      for (const [x, z] of pts) c += plantAt(fn, x, z, minD);
      return c;
    };

    // ── 1. 荷（沁芳池/藕香池/花溆潭/沁芳亭潭；严格水面 y=3）──
    if (want('lotus')) {
      for (const p of PONDS) {
        if (!/沁芳池|藕香池|沁芳亭潭|花溆潭/.test(p.name)) continue;
        const count = Math.max(16, Math.min(90, Math.round(p.rx * p.rz * 0.1)));
        lotus(p.cx, p.cz, p.rx * 0.62, p.rz * 0.62, { count, flowers: Math.max(2, Math.round(count * 0.08)) });
      }
    }

    // ── 2. 芦（芦雪汀四周贴岸成丛；芦雪庵/柳叶渚溪岸）──
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
      // 紫菱洲：蓼花（粉红穗）+ 苇
      const zz = Z('zilingzhou');
      if (zz) {
        flowerPatch(zz.x1 - 2, zz.z2 + 1, zz.x2 + 2, zz.z2 + 9, { colors: [C.peony, C.peony2, C.plumWhite], count: 14, bedC: C.dirt });
        flowerPatch(zz.x1 - 9, zz.z1 - 2, zz.x1 - 2, zz.z2 + 2, { colors: [C.peony2, C.lotusFlower], count: 10, bedC: C.dirt });
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
      for (let i = 0; i < 420 && nW < 24; i++) {
        const p = pick(PONDS);
        const a = rnd() * Math.PI * 2;
        const k = 1.02 + rnd() * 0.16;
        const x = Math.round(p.cx + Math.cos(a) * p.rx * k + (rnd() - 0.5) * 4);
        const z = Math.round(p.cz + Math.sin(a) * p.rz * k + (rnd() - 0.5) * 4);
        if (!chance(0.5)) continue;
        nW += willowAt(x, z);
      }
      for (const st of STREAMS) {
        for (let i = 1; i < st.pts.length && nW < 30; i++) {
          const [xa, za] = st.pts[i - 1], [xb, zb] = st.pts[i];
          const len = Math.hypot(xb - xa, zb - za) || 1;
          const dirx = (xb - xa) / len, dirz = (zb - za) / len;
          const nx = -dirz, nz = dirx;
          const steps = Math.max(1, Math.floor(len / 14));
          for (let s = 0; s < steps && nW < 30; s++) {
            if (!chance(0.6)) continue;
            const t = (s + 0.5) / steps;
            const side = chance(0.5) ? 1 : -1;
            const off = st.w * 0.5 + 2 + ri(0, 3);
            nW += willowAt(Math.round(xa + (xb - xa) * t + nx * off * side), Math.round(za + (zb - za) * t + nz * off * side));
          }
        }
      }
    }

    // ── 4. 景点考据花木（院内由各场景种植；此处只在院外环带补少量点缀，留出视线）──
    if (want('trees')) {
      // 潇湘馆：馆外翠竹成丛 + 芭蕉、梨花
      plantRing(Z('xiaoxiang'), 9, 8, (x, z) => bamboo(x, z, { count: 7 + ri(0, 5), h: 9 + ri(0, 4) }), 4);
      plantRing(Z('xiaoxiang'), 6, 2, (x, z) => banana(x, z, {}), 3);
      plantRing(Z('xiaoxiang'), 8, 1, (x, z) => pear(x, z, { h: 9 }), 6);
      // 稻香村：杏花 + 桑榆槐
      plantRing(Z('daoxiang'), 9, 8, (x, z) => (chance(0.75) ? apricot(x, z, { h: 9 + ri(0, 3) }) : pear(x, z)), 6);
      plantRing(Z('daoxiang'), 12, 6, (x, z) => pick([elm, locust, mulberry])(x, z, { h: 9 + ri(0, 3) }), 7);
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
      });
      plantRing(Z('hengwu'), 6, 3, (x, z) => rockCluster(x, z, { w: 4 + ri(0, 2), h: 3 + ri(0, 3) }));
      plantRing(Z('hengwu'), 6, 6, (x, z) => shrub(x, z, { r: 2 + ri(0, 1), c: [C.leafLight, C.leaf, C.vegetable] }), 2);
      // 蔷薇院 / 荼蘼架：棚架垂藤
      plantRing(Z('qiangweiyuan'), 6, 1, (x, z) => {
        const g = groundSite(x, z);
        if (g < 0) return;
        vine({ x1: x - 2, z1: z, x2: x + 2, z2: z, y: g + 4, topC: [C.crabapple, C.peony2], leafC: C.leaf });
      });
      plantRing(Z('tumijia'), 6, 1, (x, z) => {
        const g = groundSite(x, z);
        if (g < 0) return;
        vine({ x1: x - 2, z1: z, x2: x + 2, z2: z, y: g + 4, topC: [C.plumWhite, C.chrys], leafC: C.leafLight });
      });
      // 大观楼/正殿：青松、玉兰
      plantRing(Z('daguanlou'), 9, 4, (x, z) => pine(x, z, { h: 13 + ri(0, 4) }), 7);
      plantRing(Z('zhengdian'), 7, 2, (x, z) => pine(x, z, { h: 12 + ri(0, 4) }), 7);
      plantRing(Z('daguanlou'), 7, 2, (x, z) => plum(x, z, { red: false, h: 9 }), 6);
      // 凸碧山松
      plantRing(Z('gubishan'), 10, 3, (x, z) => pine(x, z, { h: 12 + ri(0, 4) }), 7);
      // 桂（藕香榭/凹晶/荇叶渚）
      const osmanthus = (x, z) => {
        const g = site(x, z, { softAbove: true, clear: 1 });
        if (g < 0) return;
        makeBlossomTree(x, z, { inner: [C.leafDark], base: [C.leaf, C.leafLight], edge: [C.leafLight, C.leaf] }, { h: 7, r: 3, trunkRatio: 0.35 });
        crumbs(x, g + 5, z, 3.4, 2.6, 3.4, 9, [C.chrys, C.gold], 77);
      };
      plantRing(Z('ouxiangxie'), 8, 2, osmanthus, 6);
      plantRing(Z('aojing'), 8, 2, osmanthus, 6);
      plantRing(Z('xingyezhu'), 7, 2, osmanthus, 6);
      // 山丘松林（大主山/东北山环/南北丘）
      let pines = 0;
      for (const h of HILLS) {
        const n = Math.max(1, Math.min(5, Math.round((h.rx * h.rz) / 800)));
        for (let i = 0; i < n * 10 && pines < 18; i++) {
          const a = rnd() * Math.PI * 2;
          const rr = Math.sqrt(rnd()) * 0.9;
          const x = Math.round(h.cx + Math.cos(a) * h.rx * rr);
          const z = Math.round(h.cz + Math.sin(a) * h.rz * rr);
          const g = free(x, z);
          if (g < 0 || g < 6) continue;
          if (!chance(0.55)) continue;
          pines += plantAt((xx, zz) => pine(xx, zz, { h: 12 + ri(0, 5), r: 4 + ri(0, 2) }), x, z, 7);
        }
      }
    }

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

    // ── 6. 苔（阴暗处地面）──
    if (want('moss')) {
      moss(-126, 20, -74, 64);
      moss(18, -118, 62, -90);
      moss(-90, -100, -56, -78);
      moss(-20, -72, -8, -50);
      moss(-40, 108, 34, 132);
      moss(-144, -140, -118, -112);
    }

    // ── 7. 全园零星杂树/灌木/草丛（绿荫为主；花树只在上面的考据景点出现）──
    if (want('grass')) {
      const n = opts.counts || {};
      const maxTrees = n.trees == null ? 46 : n.trees;
      const maxShrubs = n.shrubs == null ? 58 : n.shrubs;
      const maxGrass = n.grass == null ? 340 : n.grass;
      const GREEN = [elm, locust, wutong, mulberry, tree, tree, ginkgo];
      let trees = 0, shrubs = 0, grassN = 0;
      for (let i = 0; i < 5200 && (trees < maxTrees || shrubs < maxShrubs || grassN < maxGrass); i++) {
        const x = ri(-148, 148), z = ri(-148, 148);
        const g = free(x, z);
        if (g < 0) continue;
        const noise = (hash3(x >> 2, 0, z >> 2, 9) & 255) / 255;
        if (g > 7 && trees < maxTrees && chance(0.5)) {
          // 山麓补松
          trees += plantAt((xx, zz) => pine(xx, zz, { h: 10 + ri(0, 5), r: 4 + ri(0, 1) }), x, z, 6);
        } else if (nearWater(x, z, 2) && trees < maxTrees && chance(0.4)) {
          trees += plantAt((xx, zz) => willow(xx, zz, { h: 10 + ri(0, 3) }), x, z, 5);
        } else if (noise < 0.2 && trees < maxTrees) {
          if (chance(0.13)) {
            trees += plantAt((xx, zz) => bamboo(xx, zz, { count: 4 + ri(0, 4), h: 8 + ri(0, 3) }), x, z, 4);
          } else {
            const fn = pick(GREEN);
            trees += plantAt((xx, zz) => fn(xx, zz, { h: 9 + ri(0, 4) }), x, z, 6);
          }
        } else if (noise < 0.34 && shrubs < maxShrubs) {
          shrubs += plantAt((xx, zz) => shrub(xx, zz, { r: 2 + ri(0, 2) }), x, z, 2);
        } else if (noise < 0.58 && grassN < maxGrass) {
          grassTuft(x, z);
          grassN++;
        }
      }
    }

    // ── 8. 翠嶂山脚、花溆石港、山坡散石（山石小景）──
    if (want('rocks')) {
      const rockSpots = [
        [10, 116, 3], [24, 120, 4], [-14, 118, 3], [-24, 124, 4],
        [8, -88, 3], [26, -96, 3], [-58, -84, 3], [-88, -16, 3],
      ];
      for (const [x, z, w] of rockSpots) {
        if (free(x, z, 1) < 0) continue;
        rockCluster(x, z, { w, h: 3 + ri(0, 3) });
      }
    }
  }

  const F = {
    stats: () => ({ voxels: vCount, plants: plantCount }),

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
  };
  return F;
}

// 可选导出：与 `createFlora(ctx).scatterGarden()` 等价，供 main 直接调用。
// 例：import { scatterGarden } from './garden/flora.js'; scatterGarden(ctx);
export function scatterGarden(ctx, opts = {}) {
  const F = createFlora(ctx);
  F.scatterGarden(opts);
  return F.stats();
}
