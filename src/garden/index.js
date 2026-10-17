// ─────────────────────────────────────────────────────────────────────────────
// 园林构建总编排：地形 → 场景 → 植被 → 贴片；以及小地图与景点数据。
// ─────────────────────────────────────────────────────────────────────────────
import { W, D, OX, OZ } from '../core/world.js';
import { C, GROUPS, PALETTE } from '../core/palette.js';
import { buildTerrain } from './terrain.js';
import { createHelpers } from './helpers.js';
import { createFlora } from './flora.js';
import { buildAxis } from './scenes/axis.js';
import { buildEast } from './scenes/east.js';
import { buildWest } from './scenes/west.js';
import { buildNorth } from './scenes/north.js';
import { buildWater } from './scenes/water.js';
import { POIS } from './layout.js';
import { POI_CONTENT } from '../data/poi-content.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  const rng = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (a2, b2) => a2 + rng() * (b2 - a2);
  rng.int = (a2, b2) => Math.floor(a2 + rng() * (b2 - a2 + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  rng.chance = (p) => rng() < p;
  return rng;
}

export const POIS_MERGED = POIS.map((p) => ({ ...p, ...(POI_CONTENT[p.id] || {}) }));

const tick = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export async function buildGarden(world, onProgress = () => {}, opts = {}) {
  const R = mulberry32(0x20240A17);
  const decals = [];
  const reservedMask = new Uint8Array(W * D);
  const idx = (x, z) => (x + OX) + (z + OZ) * W;
  const reserveRects = [];
  const ctx = {
    w: world,
    C,
    L: null,
    R,
    decals,
    isMobile: !!opts.isMobile,
    quality: opts.quality || 'high',
    postBuild: [],
    animators: [],
    details: {
      roofs: [], columns: [], lattices: [], railings: [], doors: [],
      furniture: [], lanterns: [], banners: [], misc: [],
    },
    reserve(x1, z1, x2, z2, margin = 2) {
      reserveRects.push([x1, z1, x2, z2]);
      const ax = Math.max(-OX, Math.round(x1) - margin), bx = Math.min(OX - 1, Math.round(x2) + margin);
      const az = Math.max(-OZ, Math.round(z1) - margin), bz = Math.min(OZ - 1, Math.round(z2) + margin);
      for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) reservedMask[idx(x, z)] = 1;
    },
  };
  const L = await import('./layout.js');
  ctx.L = L;
  const g = L.GROUND_TOP || 3;
  ctx.GROUND_TOP = g;

  onProgress({ p: 0.04, text: '掇山理水…' });
  await tick();
  const terrain = buildTerrain(ctx);
  ctx.groundY = terrain.groundTop;
  ctx.groundTop = terrain.groundTop;
  ctx.isWater = terrain.isWater;
  ctx.isPath = terrain.isPath;
  ctx.reserve = ctx.reserve;
  // 预置保留区（水面、道路、园墙、已铺装）
  for (let z = -OZ; z < OZ; z++) for (let x = -OX; x < OX; x++) {
    if (terrain.isWater(x, z) || terrain.isPath(x, z)) reservedMask[idx(x, z)] = 1;
  }
  ctx.isReserved = (x, z) => (x < -OX || x >= OX || z < -OZ || z >= OZ) ? 1 : reservedMask[idx(x, z)];

  onProgress({ p: 0.14, text: '铺陈院宇…' });
  await tick();
  ctx.H = createHelpers(ctx);
  // 并发开发期容错：植被模块可能正在重写；缺方法时降级为空操作，避免整园构建失败
  let floraObj = null;
  try { floraObj = createFlora(ctx); } catch (e) { console.error('[flora]', e); }
  const noop = () => undefined;
  ctx.F = new Proxy(floraObj && typeof floraObj === 'object' ? floraObj : {}, {
    get(t, k) {
      const v = t[k];
      if (v !== undefined) return v;
      if (k === 'scatterGarden') return noop;
      return noop;
    },
  });

  // ── 场景 ─────────────────────────────────────────────────────────────────
  onProgress({ p: 0.2, text: '雕甍绣槛…' });
  await tick();
  buildAxis(ctx);
  onProgress({ p: 0.3, text: '蓼汀花溆…' });
  await tick();
  buildNorth(ctx);
  onProgress({ p: 0.4, text: '怡红快绿…' });
  await tick();
  buildEast(ctx);
  onProgress({ p: 0.5, text: '有凤来仪…' });
  await tick();
  buildWest(ctx);
  onProgress({ p: 0.6, text: '菱藕香深…' });
  await tick();
  buildWater(ctx);

  // ── 全园补植（flora 的 scatterGarden 优先；出错时回退到本地兜底）──────────
  onProgress({ p: 0.66, text: '莳花艺树…' });
  await tick();
  try {
    if (ctx.F && typeof ctx.F.scatterGarden === 'function') ctx.F.scatterGarden();
    else scatterBackground(ctx, R);
  } catch (err) {
    console.warn('[flora] scatterGarden 失败，使用兜底补植：', err && err.message || err);
    try { scatterBackground(ctx, R); } catch (e2) { console.warn('[flora] fallback 失败', e2); }
  }

  // ── 园景细节：太湖石、花圃、石桌石凳（在补植之后、清理之前）──────────────
  await detailScatter(ctx, R);

  // ── 兜底清理：水面格内扎根的树木（防止任何场景/散植把树种进水里）────────────
  const cleaned = cleanWaterVegetation(ctx);

  // ── 题额匾联 ─────────────────────────────────────────────────────────────
  onProgress({ p: 0.7, text: '研墨题额…' });
  await tick();
  return {
    terrain, decals, reserveRects, cleaned, ctx,
    postBuild: ctx.postBuild,
    animators: ctx.animators,
    details: ctx.details,
  };

  function cleanWaterVegetation(c) {
    const plantColors = new Set([
      ...GROUPS.leaf, ...GROUPS.bamboo, ...GROUPS.pine, ...GROUPS.willow,
      ...GROUPS.apricot, ...GROUPS.peach, ...GROUPS.crabapple,
      C.plumRed, C.plumWhite, C.peony, C.peony2, C.lotusFlower, C.chrys,
      C.reed, C.reed2, C.leafLight, C.leafDark, C.mossRock, C.vegetable,
    ]);
    const trunkColors = new Set([C.wood, C.woodDark, C.woodLight]);
    let removed = 0, cols = 0;
    for (let z = -OZ; z < OZ; z++) {
      for (let x = -OX; x < OX; x++) {
        if (!c.isWater(x, z)) continue;
        const top = world.topY(x, z);
        if (top < 5) continue;
        let hasPlant = false, hasTrunk = false;
        for (let y = 4; y < Math.min(top + 1, 8); y++) {
          const cc = world.get(x, y, z);
          if (trunkColors.has(cc)) hasTrunk = true;
        }
        for (let y = 6; y <= top; y++) {
          if (plantColors.has(world.get(x, y, z))) { hasPlant = true; break; }
        }
        if (hasPlant && hasTrunk) {
          cols++;
          for (let y = 4; y <= top; y++) {
            if (world.get(x, y, z) !== 0) { world.set(x, y, z, 0); removed++; }
          }
        }
      }
    }
    if (cols) console.info(`[garden] 水面植被兜底清理：${cols} 列 / ${removed} 体素`);
    return { cols, removed };
  }
}

/** 园景细节：山石、花圃、石桌凳，点缀空旷草地与路径转角 */
async function detailScatter(ctx, R) {
  const { w, F, H } = ctx;
  const ok = (x, z, margin = 1) => {
    if (Math.abs(x) > 143 || Math.abs(z) > 143) return false;
    const g = ctx.groundY(x, z);
    if (g < 3 || g > 12) return false;
    if (w.topY(x, z) !== g) return false;
    if (ctx.isWater(x, z) || ctx.isPath(x, z) || ctx.isReserved(x, z)) return false;
    for (let dz = -margin; dz <= margin; dz++) for (let dx = -margin; dx <= margin; dx++) {
      if (ctx.isWater(x + dx, z + dz) && margin > 0) { /* 临水石可 */ }
    }
    return true;
  };
  // 太湖石小景：沿水岸与路径转角
  let placed = 0;
  for (let i = 0; i < 900 && placed < 34; i++) {
    const x = Math.floor(R() * 280) - 140;
    const z = Math.floor(R() * 280) - 140;
    if (!ok(x, z, 2)) continue;
    const nearWater = ctx.isWater(x + 2, z) || ctx.isWater(x - 2, z) || ctx.isWater(x, z + 2) || ctx.isWater(x, z - 2);
    const nearPath = ctx.isPath(x + 3, z) || ctx.isPath(x - 3, z) || ctx.isPath(x, z + 3) || ctx.isPath(x, z - 3);
    if (!(nearWater || nearPath) || R() > 0.5) continue;
    H.rockClusterH ? H.rockClusterH(x, z) : H.rock({ x, z, size: 2 + Math.floor(R() * 3), h: 2 + Math.floor(R() * 4) });
    ctx.reserve(x - 2, z - 2, x + 2, z + 2, 1);
    placed++;
  }
  // 花圃（院外空地）
  for (const [x1, z1, x2, z2, colors] of [
    [-40, 30, -24, 44, [C.chrys, C.plumWhite]],
    [26, 66, 40, 78, [C.chrys, C.peony2]],
    [-70, 10, -56, 22, [C.chrys, C.lotusFlower]],
    [50, -10, 62, 2, [C.peony2, C.chrys]],
    [-30, -86, -16, -76, [C.chrys, C.plumWhite]],
    [64, 30, 76, 42, [C.peony2, C.chrys]],
  ]) {
    F.flowerPatch(x1, z1, x2, z2, { count: 26, colors });
  }
  // 石桌石凳（几处观景点）
  for (const [x, z] of [[-46, 62], [36, 68], [-84, 12], [70, 8], [-12, -74], [86, -30]]) {
    if (ctx.isWater(x, z) || ctx.isPath(x, z) || ctx.isReserved(x, z)) continue;
    const g = ctx.groundY(x, z);
    if (g < 3 || g > 8) continue;
    H.tableSet({ x, z, y: g + 1, size: 2 });
    ctx.reserve(x - 4, z - 4, x + 4, z + 4, 1);
  }
  await tick();
}

/** 无 flora.scatterGarden 时的全园基础植被：以绿荫为主，花树按景点集中 */
function scatterBackground(ctx, R) {
  const { w, F } = ctx;
  const placed = new Uint8Array(W * D);
  const idx = (x, z) => (x + OX) + (z + OZ) * W;
  const isNearWater = (x, z, r = 3) => {
    for (let dz = -r; dz <= r; dz += 2) for (let dx = -r; dx <= r; dx += 2) if (ctx.isWater(x + dx, z + dz)) return true;
    return false;
  };
  const canPlant = (x, z, gap = 2) => {
    if (Math.abs(x) > 146 || Math.abs(z) > 146) return false;
    const g = ctx.groundY(x, z);
    if (g < 3 || g > 22) return false;
    if (ctx.isWater(x, z) || ctx.isPath(x, z) || ctx.isReserved(x, z)) return false;
    if (w.topY(x, z) !== g) return false;
    for (let dz = -gap; dz <= gap; dz++) for (let dx = -gap; dx <= gap; dx++) {
      const xx = x + dx, zz = z + dz;
      if (xx > -OX && xx < OX && zz > -OZ && zz < OZ && placed[idx(xx, zz)]) return false;
    }
    return true;
  };
  const occupy = (x, z) => {
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, zz = z + dz;
      if (xx > -OX && xx < OX && zz > -OZ && zz < OZ) placed[idx(xx, zz)] = 1;
    }
  };
  function plant(x, z, kind) {
    if (!canPlant(x, z)) return;
    const g = ctx.groundY(x, z);
    const nearW = isNearWater(x, z, 3);
    switch (kind) {
      case 'pine': F.pine(x, z, { h: 9 + Math.floor(R() * 5) }); break;
      case 'willow': F.willow(x, z, { h: 9 + Math.floor(R() * 4) }); break;
      case 'apricot': F.apricot(x, z, { h: 7 + Math.floor(R() * 3) }); break;
      case 'peach': F.peach(x, z); break;
      case 'pear': F.pear(x, z); break;
      case 'plum': F.plum(x, z, { red: true }); break;
      case 'plumW': F.plum(x, z, { red: false }); break;
      case 'crabapple': F.crabapple(x, z); break;
      case 'elm': F.elm(x, z); break;
      case 'locust': F.locust(x, z); break;
      case 'mulberry': F.mulberry(x, z); break;
      case 'wutong': F.wutong(x, z); break;
      case 'ginkgo': F.ginkgo(x, z); break;
      case 'bamboo': F.bamboo(x, z, { count: 5 + Math.floor(R() * 4), h: 8 + Math.floor(R() * 4) }); break;
      case 'shrub': F.shrub(x, z, { r: 1 + Math.floor(R() * 2) }); break;
      case 'reed':
        if (nearW) F.reedBed(x - 2, z - 2, x + 2, z + 2, { count: 8 });
        break;
      default: break;
    }
    occupy(x, z);
  }
  // 1) 林缘/山坡：松柏为主
  for (let z = -142; z <= 142; z += 5) {
    for (let x = -142; x <= 142; x += 5) {
      const jx = x + Math.floor(R() * 4) - 2, jz = z + Math.floor(R() * 4) - 2;
      const g = ctx.groundY(jx, jz);
      if (g < 8) continue;
      if (R() < 0.5) plant(jx, jz, R() < 0.72 ? 'pine' : R() < 0.5 ? 'bamboo' : 'plumW');
    }
  }
  // 2) 水岸：垂柳、芦苇、少量桃杏
  for (let z = -140; z <= 140; z += 4) {
    for (let x = -140; x <= 140; x += 4) {
      const jx = x + Math.floor(R() * 3) - 1, jz = z + Math.floor(R() * 3) - 1;
      if (ctx.isWater(jx, jz)) continue;
      if (!isNearWater(jx, jz, 4)) continue;
      if (R() < 0.62) plant(jx, jz, R() < 0.72 ? 'willow' : R() < 0.5 ? 'peach' : 'reed');
    }
  }
  // 3) 院落周边与空地：绿荫为主，花树按景点集中
  for (let z = -142; z <= 142; z += 5) {
    for (let x = -142; x <= 142; x += 5) {
      const jx = x + Math.floor(R() * 4) - 2, jz = z + Math.floor(R() * 4) - 2;
      if (R() > 0.62) continue;
      let kind;
      if (jx < -86 && jz > -106 && jz < -50) kind = R() < 0.42 ? 'apricot' : R() < 0.5 ? 'mulberry' : 'elm'; // 稻香村杏林
      else if (jx > 98 && jz < -100) kind = R() < 0.4 ? 'peach' : R() < 0.6 ? 'pine' : 'plum'; // 沁芳闸桃花
      else if (jz < -108 && jx > 64) kind = R() < 0.4 ? 'plum' : 'pine'; // 栊翠庵红梅/松
      else if (jx < -70 && jz > 16 && jz < 70) kind = R() < 0.55 ? 'bamboo' : R() < 0.6 ? 'pear' : 'willow'; // 潇湘馆竹林外
      else if (jx > 34 && jx < 90 && jz > 6 && jz < 60) kind = R() < 0.45 ? 'willow' : R() < 0.5 ? 'crabapple' : 'peach'; // 怡红院外
      else if (jx > 60 && jz < -20 && jz > -60) kind = R() < 0.5 ? 'wutong' : 'plumW'; // 秋爽斋梧桐
      else if (jx < -84 && jz > -60 && jz < -14) kind = R() < 0.3 ? 'peach' : 'elm'; // 红香圃外围
      else {
        const r = R();
        kind = r < 0.28 ? 'willow' : r < 0.5 ? 'elm' : r < 0.66 ? 'locust' : r < 0.76 ? 'ginkgo' : r < 0.86 ? 'bamboo' : r < 0.93 ? 'wutong' : 'peach';
      }
      plant(jx, jz, kind);
    }
  }
  // 4) 院墙外一圈密林（园外北/东/西三面 + 南面两翼），形成「园居林中」的景深
  for (let z = -156; z <= 156; z += 4) {
    for (let x = -156; x <= 156; x += 4) {
      const insideX = Math.abs(x) <= 146, insideZ = Math.abs(z) <= 146;
      if (insideX && insideZ) continue;
      if (z > 140 && Math.abs(x) < 30) continue; // 正门前留空
      if (R() < 0.55) plant(x + Math.floor(R() * 3) - 1, z + Math.floor(R() * 3) - 1, R() < 0.5 ? 'pine' : R() < 0.5 ? 'elm' : 'locust');
    }
  }
  // 5) 草地/花点
  for (let i = 0; i < 3800; i++) {
    const x = Math.floor(R() * 284) - 142, z = Math.floor(R() * 284) - 142;
    if (ctx.isWater(x, z) || ctx.isPath(x, z) || ctx.isReserved(x, z)) continue;
    const g = ctx.groundY(x, z);
    if (w.topY(x, z) !== g) continue;
    if (R() < 0.8) F.grassTuft(x, z);
    else F.flowerPatch(x, z, x, z, { count: 2, colors: [C.chrys, C.peony2, C.lotusFlower] });
  }
  // 6) 池中荷
  for (const [cx, cz, rx, rz, n] of [[-8, -40, 32, 22, 120], [-20, -60, 8, 5, 30], [-22, -16, 12, 8, 40], [20, -50, 12, 10, 36], [4, -30, 10, 8, 26]]) {
    F.lotus(cx, cz, rx, rz, { count: n });
  }
  // 7) 芦苇
  for (const [x1, z1, x2, z2] of [[-84, -94, -58, -84], [-94, -74, -78, -66], [18, -98, 32, -88], [92, -90, 102, -80], [-40, -20, -26, -10]]) {
    F.reedBed(x1, z1, x2, z2, { count: 70 });
  }
}

/** 生成 320×320 小地图（dataURL）。北=−z 对应画布上方。 */
export function makeMinimap(world, terrain) {
  const size = W;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const c = cv.getContext('2d');
  const img = c.createImageData(size, size);
  const d = img.data;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = px - OX, z = py - OZ;
      const i = (x + OX) + (z + OZ) * W;
      let r, g2, b, a = 235;
      if (terrain.isWater(x, z)) {
        r = 58; g2 = 96; b = 104;
        const ripple = ((px + py) % 7 === 0) ? 12 : 0;
        r += ripple; g2 += ripple; b += ripple;
      } else {
        const y = world.topY(x, z);
        const col = PALETTE[world.get(x, y, z)] || { r: 90, g: 90, b: 90 };
        const h = Math.max(0, y);
        const shade = 0.72 + Math.min(0.5, h / 70);
        r = Math.min(255, col.r * shade);
        g2 = Math.min(255, col.g * shade);
        b = Math.min(255, col.b * shade);
        if (x < -146 || x > 146 || z < -146 || z > 146) { r *= 0.62; g2 *= 0.62; b *= 0.62; }
      }
      const o = (px + py * size) * 4;
      d[o] = r; d[o + 1] = g2; d[o + 2] = b; d[o + 3] = a;
    }
  }
  c.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}
