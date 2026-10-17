// ─────────────────────────────────────────────────────────────────────────────
// 北区：蘅芜苑 · 栊翠庵 · 凸碧山庄 · 凹晶溪馆 · 花溆·萝港 · 沁芳闸
// 依据：docs/research.md §3.2/§3.4/§3.5/§四.1/§五/§六 与 layout.ZONES/PADS/POIS。
// 座标：x 东(+)/西(-)，z 南(+)/北(-)，y 上；1 体素≈1m。地面顶面 y=ctx.groundTop()。
// 结构均依地形落脚（support 向下填至地表/水床），不悬空、不种进水面。
// ─────────────────────────────────────────────────────────────────────────────
import { C } from '../../core/palette.js';

export function buildNorth(ctx) {
  const { w, H, F, L, R } = ctx;

  // ═══════════════════════════════════════════════════════════════════════════
  // 0. 通用工具
  // ═══════════════════════════════════════════════════════════════════════════
  const gtop = (x, z) => {
    const g = typeof ctx.groundTop === 'function' ? ctx.groundTop(x, z) : ctx.groundY(x, z);
    return Number.isFinite(g) ? Math.round(g) : -1;
  };
  const water = (x, z) => !!ctx.isWater(x, z);
  const onPath = (x, z) => !!ctx.isPath(x, z);
  const inB = (x, z) => x > -157 && x < 157 && z > -157 && z < 157;
  const pick = (a) => a[Math.floor(R() * a.length) % a.length];
  const chance = (p) => R() < p;

  /** 自 yTop 起向下填到地表（水面则填到水床 y=1），作台阶/石柱/挡土落脚 */
  function support(x, z, yTop, cTop, cSide) {
    if (!inB(x, z)) return;
    const g = water(x, z) ? 1 : gtop(x, z);
    if (g < 0 || yTop <= g) return;
    for (let y = yTop; y > g; y--) w.set(x, y, z, y === yTop ? cTop : (cSide || cTop));
  }
  /** 只改地表顶面颜色（不增高体素，便于随后栽植） */
  function pave(x, z, c) {
    if (!inB(x, z) || water(x, z)) return;
    const g = gtop(x, z);
    if (g < 0) return;
    w.set(x, g, z, c);
  }
  function paveRect(x1, z1, x2, z2, c, altC) {
    for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
      if (altC && ((x * 3 + z) & 3) === 0) pave(x, z, altC); else pave(x, z, c);
    }
  }
  function paveLine(pts, wid, c, altC) {
    const r = Math.max(0, Math.floor(wid / 2));
    for (let i = 0; i < pts.length - 1; i++) {
      H.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], (x, z) => {
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dz * dz > r * r + 0.9) continue;
          if (altC && ((x + dx + z + dz) & 3) === 0) pave(x + dx, z + dz, altC);
          else pave(x + dx, z + dz, c);
        }
      });
    }
  }

  /** 直线石阶：沿 (x1,z1)->(x2,z2) 由 y0 升/降到 y1（y 为顶面体素索引），treads=每级踏面格数 */
  function stairRun(x1, z1, x2, z2, y0, y1, wid, treads, o = {}) {
    const cells = [];
    const seen = new Set();
    H.line(x1, z1, x2, z2, (x, z) => {
      const k = x + ',' + z;
      if (!seen.has(k)) { seen.add(k); cells.push([x, z]); }
    });
    const n = cells.length;
    if (n < 2) return;
    const steps = Math.max(1, Math.abs(y1 - y0));
    const dir = y1 >= y0 ? 1 : -1;
    const vertical = Math.abs(z2 - z1) > Math.abs(x2 - x1);
    const half = Math.max(0, Math.floor(wid / 2));
    const topC = o.topC ?? C.stoneLight;
    const top2 = o.top2 ?? C.stoneWarm;
    const sideC = o.sideC ?? C.stone;
    for (let i = 0; i < n; i++) {
      const [x, z] = cells[i];
      const lvl = Math.min(steps, Math.floor((i * steps) / Math.max(1, n - 1)));
      const y = y0 + dir * lvl;
      for (let d = -half; d <= half; d++) {
        const px = vertical ? x + d : x;
        const pz = vertical ? z : z + d;
        support(px, pz, y, ((i + d) & 1) ? topC : top2, sideC);
      }
    }
  }

  /** 随地形起伏的院墙：th 向 +x/+z 加厚 */
  function wallRun(x1, z1, x2, z2, o = {}) {
    const h = o.h ?? 4, th = o.th ?? 1, c = o.c ?? C.whitewall, cap = o.cap ?? C.roof;
    const vertical = x1 === x2;
    const n = vertical ? Math.abs(z2 - z1) : Math.abs(x2 - x1);
    const sx = Math.sign(x2 - x1), sz = Math.sign(z2 - z1);
    const gates = o.gates || [];
    for (let i = 0; i <= n; i++) {
      const x = vertical ? x1 : x1 + sx * i;
      const z = vertical ? z1 : z1 + sz * i;
      if (gates.some((gt) => (vertical ? z >= gt.a && z <= gt.b : x >= gt.a && x <= gt.b))) continue;
      const g = gtop(x, z);
      if (g < 0) continue;
      for (let k = 1; k <= h; k++) {
        const col = k === 1 ? (o.base ?? C.wallBase) : (k === h && o.shadeTop ? C.whitewallShade : c);
        for (let t = 0; t < th; t++) {
          if (vertical) w.set(x + t, g + k, z, col);
          else w.set(x, g + k, z + t, col);
        }
      }
      const cy = g + h + 1;
      if (vertical) {
        for (let t = -1; t <= th; t++) w.set(x + t, cy, z, (t === -1 || t === th) ? C.roofEdge : C.roof);
        w.set(x + ((th - 1) >> 1), cy + 1, z, C.ridge);
      } else {
        for (let t = -1; t <= th; t++) w.set(x, cy, z + t, (t === -1 || t === th) ? C.roofEdge : C.roof);
        w.set(x, cy + 1, z + ((th - 1) >> 1), C.ridge);
      }
    }
  }

  /** 藤蔓垂挂（自 yTop 向下 len 格，可带侧枝） */
  function drape(x, z, yTop, len, cols, seed = 0) {
    const arr = Array.isArray(cols) ? cols : [cols];
    for (let k = 0; k < len; k++) {
      const y = yTop - k;
      if (y < 2) break;
      if (w.get(x, y, z) === 0) w.set(x, y, z, arr[(k + seed) % arr.length]);
      if (k > 0 && ((x * 7 + z * 11 + k * 5 + seed) % 6 === 0)) {
        const dx = ((x + k + seed) & 1) ? 1 : -1;
        if (w.get(x + dx, y, z) === 0) w.set(x + dx, y, z, C.leafDark);
      }
    }
  }
  function drapeRun(x1, z1, x2, z2, yTop, len, cols, seed = 0) {
    H.line(x1, z1, x2, z2, (x, z) => {
      if (((x * 3 + z * 5 + seed) & 1) === 0) drape(x, z, yTop, len + (((x + z) & 1) ? 2 : 0), cols, seed);
    });
  }

  /** 木桥（折带，红栏），pts 折线，y=面板顶面索引 */
  function polyBridge(pts, y, wid, o = {}) {
    const deckC = o.deck ?? C.wood;
    const deck2 = o.deck2 ?? C.woodDark;
    const railC = o.rail ?? C.redRail;
    const half = Math.max(1, Math.floor(wid / 2));
    const cells = [];
    const seen = new Set();
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
      const nxp = Math.round(-dz / len), nzp = Math.round(dx / len);
      H.line(ax, az, bx, bz, (x, z) => {
        const k = x + ',' + z;
        if (seen.has(k)) return;
        seen.add(k);
        cells.push([x, z, nxp || 1, nzp]);
      });
    }
    let idx = 0;
    for (const [x, z, nxp, nzp] of cells) {
      for (let d = -half; d <= half; d++) {
        const px = x + nxp * d, pz = z + nzp * d;
        w.set(px, y, pz, (idx & 1) ? deckC : deck2);
        if (Math.abs(d) === half) {
          w.set(px, y + 1, pz, railC);
          w.set(px, y + 2, pz, railC);
          if (idx % 4 === 0) w.set(px, y + 3, pz, C.redDark);
        }
      }
      if (idx % 6 === 0) {
        w.set(x, y + 1, z, C.woodDark);
        support(x, z, y - 1, C.woodDark, C.woodDark);
      }
      idx++;
    }
  }

  /** 抹掉一段旧路（重铺为草地/苔），用于北径绕行 */
  function erasePath(x1, z1, x2, z2) {
    for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
      if (!onPath(x, z) || water(x, z)) continue;
      pave(x, z, pick([C.grass2, C.grass, C.grass3, C.mossRock]));
    }
  }
  /** 画石板径：跨台地边缘自动形成一级级石阶（逐格落差≤1） */
  function paintPath(pts, wid, o = {}) {
    const r = Math.max(0, Math.floor(wid / 2));
    const c1 = o.c ?? C.path;
    const c2 = o.c2 ?? C.path2;
    const stepC = o.stepC ?? C.stoneWarm;
    let walk = -999;
    for (let i = 0; i < pts.length - 1; i++) {
      const cells = [];
      H.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], (x, z) => cells.push([x, z]));
      for (const [x, z] of cells) {
        const g = gtop(x, z);
        if (g < 0 || water(x, z)) continue;
        let tread;
        if (walk < -900) tread = g;
        else if (g >= walk) tread = g;
        else tread = Math.max(g, walk - 1);
        walk = tread;
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dz * dz > r * r + 0.9) continue;
          const px = x + dx, pz = z + dz;
          const gg = gtop(px, pz);
          if (gg < 0 || water(px, pz)) continue;
          if (tread > gg) support(px, pz, tread, ((px + pz) & 3) === 0 ? stepC : c1, C.stone);
          pave(px, pz, ((px * 3 + pz) & 3) === 0 ? c2 : c1);
        }
      }
    }
  }

  /** 水岸落台（贴水石台 + 石柱） */
  function waterDeck(x1, z1, x2, z2, topIdx, o = {}) {
    for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
      if (!inB(x, z)) continue;
      const edge = x === x1 || x === x2 || z === z1 || z === z2;
      w.set(x, topIdx, z, edge ? (o.edgeC ?? C.stoneWarm) : ((x + z) & 1 ? C.stoneLight : C.stoneWarm));
      if (edge || ((x % 3 === x1 % 3) && (z % 3 === z1 % 3))) support(x, z, topIdx - 1, C.stone, C.stone);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. 北径改线：旧路横穿蘅芜苑台地，改绕台地北侧山脚（石板 + 石阶）
  // ═══════════════════════════════════════════════════════════════════════════
  {
    erasePath(17, -122, 90, -107);
    paintPath([[16, -112], [22, -116], [28, -120], [36, -123], [46, -124], [56, -123], [66, -121], [76, -121], [82, -122], [90, -126]], 4);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. 蘅芜苑（台地 elev8，北倚山、南临花溆；大玲珑山石遮屋，一株花木也无）
  // ═══════════════════════════════════════════════════════════════════════════
  {
    // ── 2.1 院墙（水磨砖墙，随地形起伏；南山墙开月洞门）──
    const WH = 5, WT = 1;
    wallRun(33, -117, 33, -97, { h: WH, th: WT });              // 西墙
    wallRun(60, -117, 60, -97, { h: WH, th: WT });              // 东墙（兼挡土墙，内侧显矮）
    wallRun(33, -117, 59, -117, { h: WH, th: WT });             // 北墙（嵌入山石）
    wallRun(33, -97, 59, -97, { h: WH, th: WT, gates: [{ a: 39, b: 45 }] }); // 南墙·留门洞
    // 月洞门（x=42, z=-97）：在南山墙上开洞 + 白石圈
    H.moonGate({ x: 42, z: -97, axis: 'x', y: 9, r: 2, th: 1 });
    // 门内外石阶
    support(42, -97 - 1, 9, C.marbleShade, C.stoneWarm);
    // 墙帽上的瓦垄已由 wallRun 完成

    // ── 2.2 五间清厦 · 卷棚 · 四面出廊（HD：檐高+1、柱高+1）──
    const hall = H.hall({
      x: 47, z: -108, bays: 5, bayW: 4, depth: 11, y: 9,
      plinthH: 2, plinthC: C.stone, plinthTop: C.stoneWarm,
      wallH: 5, columnH: 5, roof: 'gableRound', tile: C.roof, roofH: 3,
      columns: C.woodDark, wall: C.whitewall, doorC: C.woodDark,
      plaque: '蘅芷清芬',
      couplets: ['吟成豆蔻詩猶艷', '睡足荼蘼夢也香'],
      stepDir: 'south', interior: true,
    });
    // 四面出廊：沿台基外缘加一圈檐柱（支住出檐，随主体加高）
    const pTop = 10; // 台基顶面体素索引
    for (const px of [35, 59]) {
      for (let pz = -114; pz <= -102; pz += 4) H.column(px, pz, pTop + 1, 5, C.woodDark);
    }
    for (const pz of [-115, -101]) {
      for (let px = 37; px <= 57; px += 4) H.column(px, pz, pTop + 1, 5, C.woodDark);
    }
    // 廊下矮栏（东西两侧）
    H.railing({ x1: 36, z1: -114, x2: 36, z2: -102, y: pTop + 1, h: 1, style: 'wood', c: C.redRail });
    H.railing({ x1: 58, z1: -114, x2: 58, z2: -102, y: pTop + 1, h: 1, style: 'wood', c: C.redRail });
    // 卷棚绿窗油壁：前檐两侧加绿色帘幕意象（让开月洞门/正门通道）
    for (const px of [38, 41, 53, 56]) {
      for (let yy = 12; yy <= 13; yy++) w.setIfEmpty(px, yy, hall.z2 + 1, C.windowGreen);
    }

    // ── 2.3 大玲珑山石群：南山前左右夹峙（最高 8–10 格，遮去大半屋宇）──
    // 底层厚石（临水石矶，自水床拔起）
    H.rockery({ x1: 32, z1: -97, x2: 40, z2: -86, h: 9, y: 2, seed: 61 });
    H.rockery({ x1: 45, z1: -97, x2: 59, z2: -86, h: 9, y: 2, seed: 63 });
    // 上层主峰（收窄收高，做“插天玲珑”之势）
    H.rockery({ x1: 33, z1: -96, x2: 39, z2: -89, h: 7, y: 10, seed: 62 });
    H.rockery({ x1: 47, z1: -96, x2: 55, z2: -89, h: 7, y: 10, seed: 64 });
    H.rockery({ x1: 49, z1: -95, x2: 53, z2: -91, h: 5, y: 16, seed: 69 });
    // 西侧山石穿墙
    H.rockery({ x1: 33, z1: -112, x2: 36, z2: -104, h: 7, y: 8, seed: 65 });
    // 东墙外山石（自低地拔起）
    H.rockery({ x1: 61, z1: -111, x2: 64, z2: -101, h: 8, y: 2, seed: 66 });
    // 北墙后主山余脉（大主山分脉穿墙）
    H.rockery({ x1: 33, z1: -121, x2: 59, z2: -117, h: 10, y: 4, seed: 67 });
    H.rockery({ x1: 40, z1: -124, x2: 56, z2: -120, h: 6, y: 3, seed: 68 });
    // 院内点石与小玲珑
    H.rock({ x: 36, z: -99, size: 2, h: 5 });
    H.rock({ x: 57, z: -99, size: 2, h: 4 });
    H.rock({ x: 35, z: -103, size: 1, h: 3 });
    H.rock({ x: 43, z: -99, size: 1, h: 3 });
    H.rock({ x: 51, z: -99, size: 1, h: 2 });

    // ── 2.4 云步石梯：自花溆水岸直上台地（穿于两峰之间，12 级踏面）──
    // 台地南缘 z=-96（面高 9）→ 水中落台 z=-87（面高 4）
    const stepCells = [
      { z: -95, y: 8 }, { z: -94, y: 8 },
      { z: -93, y: 7 }, { z: -92, y: 7 },
      { z: -91, y: 6 }, { z: -90, y: 6 },
      { z: -89, y: 5 }, { z: -88, y: 5 },
      { z: -87, y: 4 },
    ];
    for (const s of stepCells) {
      for (let x = 40; x <= 44; x++) support(x, s.z, s.y, ((x + s.z) & 1) ? C.stoneLight : C.stoneWarm, C.stone);
    }
    // 梯口与台地衔接
    for (let x = 40; x <= 44; x++) support(x, -96, 8, C.stoneWarm, C.stone);
    // 水中落台（石矶码头）
    waterDeck(39, -88, 45, -86, 3, { edgeC: C.stone });
    // 落台两侧矮石栏
    for (let x = 39; x <= 45; x += 2) { w.set(x, 4, -86, C.stoneWarm); w.set(x, 5, -86, C.stoneLight); }
    // 台地边缘矮石栏（梯口两侧）
    for (let x = 36; x <= 39; x++) { w.set(x, 9, -96, C.stoneWarm); w.set(x, 10, -96, C.marbleShade); }
    for (let x = 45; x <= 48; x++) { w.set(x, 9, -96, C.stoneWarm); w.set(x, 10, -96, C.marbleShade); }

    // ── 2.5 藤萝薜荔香草（一株花木也无）──
    // 峰顶垂藤
    drapeRun(34, -96, 39, -95, 11, 6, [C.leafDark, C.leaf, C.leafYellow], 1);
    drapeRun(46, -96, 58, -95, 10, 5, [C.leafDark, C.leaf], 2);
    drapeRun(33, -111, 36, -111, 13, 4, [C.leafDark, C.leafLight], 3);
    drapeRun(40, -120, 56, -119, 12, 4, [C.leafDark, C.leafYellow], 4);
    // 花溆岸边石壁倒垂萝薜
    for (let x = 34; x <= 59; x += 3) {
      const ty = w.topY(x, -96);
      if (ty > 4) drape(x, -96, ty, 4 + ((x & 1) ? 2 : 0), [C.leafDark, C.leaf, C.leafYellow], x);
    }
    // 石峰南面垂藤（遮去白石，露冷翠之意）
    for (let x = 33; x <= 40; x += 2) {
      const ty = w.topY(x, -86);
      if (ty > 8) drape(x, -85, ty + 1, 3 + ((x & 1) ? 2 : 0), [C.leafDark, C.leaf, C.leafYellow], x + 3);
    }
    for (let x = 46; x <= 58; x += 2) {
      const ty = w.topY(x, -86);
      if (ty > 8) drape(x, -85, ty + 1, 3 + ((x & 1) ? 1 : 0), [C.leafDark, C.leaf, C.leafYellow], x + 5);
    }
    // 墙头藤萝架（F.vine 铺顶、垂藤；随院墙加高上移）
    F.vine({ x1: 34, z1: -97, x2: 58, z2: -97, y: 16, leafC: C.leafDark, topC: [C.leafYellow, C.leaf] });
    F.vine({ x1: 34, z1: -117, x2: 58, z2: -117, y: 16, leafC: C.leaf, topC: [C.leafDark, C.leafYellow] });
    F.vine({ x1: 34, z1: -101, x2: 34, z2: -113, y: 15, leafC: C.leafDark, topC: [C.leafLight] });
    // 墙脚、阶畔香草（杜若、蘅芜、茝兰之意）
    for (const [hx, hz] of [[36, -96], [39, -96], [47, -96], [52, -96], [56, -96], [34, -114], [34, -108], [58, -114], [58, -108], [38, -100], [56, -100]]) {
      if (!water(hx, hz)) F.shrub(hx, hz, { r: 1 + ((hx + hz) & 1), c: [C.leafLight, C.leaf, C.vegetable, C.leafYellow] });
    }
    // 苔痕（石上、墙阴）
    F.moss(33, -118, 59, -96, { density: 0.5 });
    F.moss(34, -96, 59, -88, { density: 0.35 });
    for (let i = 0; i < 28; i++) {
      const x = 33 + Math.floor(R() * 27), z = -117 + Math.floor(R() * 21);
      if (w.get(x, 9, z) !== 0 || water(x, z)) continue;
      w.setIfEmpty(x, 9, z, pick([C.mossRock, C.leafDark, C.leafYellow, C.grass3]));
    }

    // ── 2.6 折带朱栏板桥（跨花溆水，接西岸与东岸）──
    polyBridge([[3, -82], [10, -84], [17, -82], [24, -83]], 4, 5, { rail: C.redRail });
    // 桥东石径接落台
    paintPath([[24, -83], [29, -84], [34, -85], [38, -86], [40, -86]], 3, { c: C.path3, c2: C.path2 });
    // 桥西接池东岸径
    paintPath([[4, -82], [2, -86], [4, -90]], 3, { c: C.path3, c2: C.path2 });
    // 桥头石
    H.rock({ x: 25, z: -85, size: 1, h: 3 });
    H.rock({ x: 2, z: -81, size: 1, h: 2 });
    ctx.reserve(31, -125, 68, -78);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. 花溆 · 萝港（石港、石洞、萝薜倒垂、落花浮荡、题字石）
  // ═══════════════════════════════════════════════════════════════════════════
  {
    // ── 3.1 石洞：跨港石拱（北墩接蘅芜苑崖、南墩落南岸）──
    H.rockery({ x1: 32, z1: -98, x2: 39, z2: -94, h: 13, y: 7, seed: 71 });
    H.rockery({ x1: 32, z1: -88, x2: 41, z2: -83, h: 12, y: 2, seed: 72 });
    // 洞顶石梁（下留 6 格净空；HD：拱背加厚抬高）
    for (let z = -93; z <= -87; z++) {
      for (let x = 32; x <= 40; x++) {
        const nd = Math.abs(z + 90) / 4;
        const top = 15 - Math.round(nd * 2) + ((x * 3 + z) % 3 === 0 ? 1 : 0);
        for (let yy = 10; yy <= top; yy++) w.set(x, yy, z, yy === 10 ? C.rockDark : pick([C.rock, C.rockDark, C.rockLight]));
      }
    }
    // 洞内暗色石壁
    for (let z = -92; z <= -88; z++) {
      for (let x = 32; x <= 33; x++) w.set(x, 8, z, C.rockDark);
    }
    // 萝薜倒垂（洞顶与南墩）
    drapeRun(34, -92, 39, -92, 10, 7, [C.leafDark, C.leaf, C.leafYellow], 5);
    drapeRun(34, -91, 39, -91, 10, 6, [C.leafDark, C.leaf], 6);
    drapeRun(34, -86, 40, -86, 13, 6, [C.leafDark, C.leafYellow, C.leaf], 7);
    // 藤萝垂挂（F.vine 于洞顶）
    F.vine({ x1: 33, z1: -89, x2: 40, z2: -89, y: 17, leafC: C.leafDark, topC: [C.leafYellow, C.leafLight] });
    F.vine({ x1: 33, z1: -85, x2: 40, z2: -85, y: 16, leafC: C.leaf, topC: [C.leafDark] });

    // ── 3.2 题字石「蓼汀花溆」（南墩石壁，实砌落地，外凸一格题字）──
    for (let x = 33; x <= 41; x++) support(x, -82, 11, C.rock, C.rockDark);
    for (let x = 33; x <= 41; x++) for (let y = 6; y <= 11; y++) w.setIfEmpty(x, y, -82, pick([C.rock, C.rockLight, C.rockDark]));
    for (let x = 34; x <= 40; x++) support(x, -81, 10, C.rockLight, C.rockDark);
    H.plaque({ x: 37, y: 8, z: -80, dir: 'south', text: '蓼汀花溆', w: 8, h: 2, boardColor: C.rockDark, textColor: C.goldText });
    // 石壁顶垂藤
    for (let x = 34; x <= 40; x += 2) drape(x, -82, 12, 3, [C.leafDark, C.leaf], x);

    // ── 3.3 落花浮荡：港面粉色花点（以体素贴水）──
    let petals = 0;
    for (let i = 0; i < 2200 && petals < 190; i++) {
      const x = -2 + Math.floor(R() * 40), z = -103 + Math.floor(R() * 23);
      if (!water(x, z)) continue;
      if (w.get(x, 3, z) !== 0) continue;
      w.set(x, 3, z, pick([C.apricot2, C.peach, C.plumWhite, C.crabapple]));
      petals++;
    }
    // 港中荷叶点缀（不铺满）
    F.lotus(16, -92, 9, 4, { count: 16 });
    F.lotus(9, -86, 6, 3, { count: 8 });

    // ── 3.4 港岸芦苇、桃杏垂柳 ──
    F.reedBed(10, -103, 30, -100, { count: 6 });
    F.reedBed(4, -80, 14, -77, { count: 5 });
    F.reedBed(24, -80, 31, -78, { count: 4 });
    F.peach(24, -102); F.peach(28, -104);
    F.apricot(18, -104); F.apricot(12, -104);
    F.peach(26, -78); F.peach(30, -80);
    F.apricot(20, -78);
    F.willow(30, -104, { h: 11 }); F.willow(24, -78, { h: 12 });
    F.willow(2, -84, { h: 12 });
    F.shrub(14, -102, { r: 2, c: [C.reed, C.reed2, C.leafLight] });
    F.moss(2, -104, 32, -82, { density: 0.4 });

    // ── 3.5 花溆港两岸山石夹峙 ──
    H.rockery({ x1: 4, z1: -105, x2: 16, z2: -101, h: 6, y: 3, seed: 73 });
    H.rockery({ x1: 18, z1: -106, x2: 30, z2: -102, h: 7, y: 3, seed: 74 });
    H.rockery({ x1: -2, z1: -93, x2: 3, z2: -84, h: 6, y: 2, seed: 75 });
    for (const [rx, rz, rw, rh] of [[6, -102, 3, 4], [30, -99, 2, 3], [12, -79, 2, 3], [22, -76, 2, 2], [4, -91, 2, 2]]) {
      if (water(rx, rz)) continue;
      H.rock({ x: rx, z: rz, size: rw, h: rh });
    }
    ctx.reserve(-4, -106, 44, -72);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. 栊翠庵（东北山环台地 elev9：山门 · 大殿 · 东禅堂 · 红梅）
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const CY = 10; // 台地 elev9 → 台基第一层 y=10
    // ── 4.1 院墙（白墙灰瓦，HD 加高一格）──
    wallRun(78, -142, 78, -116, { h: 5, th: 2, gates: [{ a: -127, b: -122 }] });  // 西墙（北径来处留侧门）
    wallRun(106, -142, 106, -117, { h: 5, th: 2 });                              // 东墙（贴东山）
    wallRun(78, -142, 106, -142, { h: 5, th: 2 });                               // 北墙（嵌山）
    wallRun(78, -116, 103, -116, { h: 5, th: 2, gates: [{ a: 84, b: 92 }] });    // 南墙·留山门

    // ── 4.2 山门（一间小门楼，匾「苦海慈航」）──
    {
      const gx = 88, gz = -118;
      H.plinth({ x: gx, z: gz, w: 6, d: 3, y: CY, h: 1, c: C.stone, top: C.stoneWarm, step: 0 });
      const fY = CY + 1; // 11
      // 柱
      for (const px of [gx - 5, gx, gx + 5]) for (const pz of [-121, -115]) H.column(px, pz, fY, 4, C.redPillar);
      // 后墙、侧墙
      for (let x = gx - 5; x <= gx + 5; x++) for (let y = fY; y <= fY + 3; y++) {
        w.set(x, y, -121, y === fY ? C.wallBase : C.whitewall);
      }
      for (const px of [gx - 5, gx + 5]) for (let z = -120; z <= -116; z++) for (let y = fY; y <= fY + 3; y++) {
        w.set(px, y, z, y === fY ? C.wallBase : C.whitewall);
      }
      // 前墙 + 板门（H.door：隐藏体素→可开合精细门扇 + 步行碰撞）
      for (let x = gx - 5; x <= gx + 5; x++) for (let y = fY; y <= fY + 3; y++) {
        if (x >= gx - 2 && x <= gx + 2 && y <= fY + 2) continue;
        w.set(x, y, -115, y === fY ? C.wallBase : C.whitewall);
      }
      H.door({ x: gx - 2, y: fY, z: -115, axis: 'x', w: 5, h: 3, c: C.woodRed, studs: true, label: '栊翠庵山门' });
      // 门簪、门额
      w.set(gx - 3, fY + 3, -115, C.woodDark); w.set(gx + 3, fY + 3, -115, C.woodDark);
      H.eaveBand({ x1: gx - 5, z1: -121, x2: gx + 5, z2: -115, y: fY + 4 });
      H.roof({ x1: gx - 5, z1: -121, x2: gx + 5, z2: -115, y: fY + 5, h: 2, type: 'gable', tile: C.roof, overhang: 2, upturn: 1 });
      H.plaque({ x: gx, y: fY + 3, z: -114, dir: 'south', text: '苦海慈航', w: 6, h: 2 });
      // 门外石阶（台地→山脚）
      for (let i = 0; i < 6; i++) {
        const zz = -114 + i;
        const ty = 9 - i;
        for (let x = gx - 3; x <= gx + 3; x++) support(x, zz, ty, i & 1 ? C.stoneWarm : C.stoneLight, C.stone);
      }
      // 门外石槽、石灯
      for (let x = gx - 8; x <= gx - 6; x++) { support(x, -113, 5, C.stoneWarm, C.stone); w.set(x, 5, -113, C.stoneDark); }
      support(gx - 9, -113, 5, C.stoneLight, C.stone); support(gx - 9, -114, 5, C.stoneLight, C.stone);
      support(gx + 9, -113, 5, C.stoneLight, C.stone); support(gx + 9, -114, 5, C.stoneLight, C.stone);
    }

    // ── 4.3 大殿三间（歇山，灰瓦朱柱，殿内佛龛；HD：台基+1、檐柱+1）──
    const main = H.hall({
      x: 91, z: -134, bays: 3, bayW: 6, depth: 10, y: CY, name: '栊翠庵大殿',
      plinthH: 2, plinthC: C.stone, plinthTop: C.stoneWarm,
      wallH: 5, columnH: 6, roof: 'xieshan', tile: C.roof, roofH: 4,
      columns: C.redPillar, wall: C.whitewall, doorC: C.woodRed,
      stepDir: 'south', interior: false,
    });
    // 佛龛（须弥座 + 金身 + 背光；供桌/香炉交给 H.furnish 精细陈设）
    const bz = -138;
    H.box(87, 13, bz - 1, 95, 14, bz + 1, C.woodDark);
    H.box(88, 15, bz, 94, 15, bz, C.wood);
    H.box(90, 15, bz, 92, 17, bz, C.gold);
    w.set(91, 18, bz, C.goldDark);
    H.box(89, 16, bz, 89, 17, bz, C.goldDark);
    H.box(93, 16, bz, 93, 17, bz, C.goldDark);
    for (const cx2 of [88, 94]) { w.set(cx2, 16, bz, C.lampWarm); w.set(cx2, 15, bz, C.lampWarm); }
    w.set(91, 13, -134, C.cushion);
    // 殿内精细陈设：佛殿以佛龛为背景，撤去本次新增的屏风/挂画/地毯，保留香案香炉、灯笼、瓶花
    {
      const DETF = ctx.details && ctx.details.furniture;
      const n0 = DETF ? DETF.length : 0;
      H.furnish({ x: 91, z: -134, y: main.floorY, w: 15, d: 7, h: 5, style: 'hall' });
      if (DETF) {
        for (let i = DETF.length - 1; i >= n0; i--) {
          const k = DETF[i].kind;
          if (k === 'screen' || k === 'painting' || k === 'rug') DETF.splice(i, 1);
        }
      }
    }
    // 殿前石灯、香炉
    for (const px of [84, 98]) {
      support(px, -124, 11, C.stoneWarm, C.stone);
      w.set(px, 12, -124, C.stoneLight); w.set(px, 13, -124, C.stoneLight);
      w.set(px, 14, -124, C.stoneWarm); w.set(px, 14, -124, C.lampWarm);
      w.set(px, 15, -124, C.stoneLight);
    }
    support(91, -122, 11, C.bronzeDark, C.bronze);
    w.set(91, 12, -122, C.bronze); w.set(91, 13, -122, C.bronzeDark);

    // ── 4.4 东禅堂三间（院内东侧，面西）──
    {
      const tx = 100, tz = -122;
      // 台基
      H.plinth({ x: tx, z: tz, w: 5, d: 3, y: CY, h: 1, c: C.stone, top: C.stoneWarm, step: 0 });
      const fY = CY + 1;
      // 角柱（HD 加高）
      for (const px of [tx - 4, tx, tx + 4]) for (const pz of [tz - 3, tz + 3]) H.column(px, pz, fY, 5, C.redPillar);
      // 东墙（背墙）白墙 + 花窗
      for (let ppz = tz - 3; ppz <= tz + 3; ppz++) for (let y = fY; y <= fY + 4; y++) w.set(tx + 4, y, ppz, y === fY ? C.wallBase : C.whitewall);
      H.latticeWindow({ x: tx + 4, y: fY + 1, z: tz - 1, axis: 'z', w: 3, h: 2, cFrame: C.stoneWarm, cLattice: C.windowGreen });
      // 南北墙
      for (const pz of [tz - 3, tz + 3]) for (let x = tx - 4; x <= tx + 4; x++) for (let y = fY; y <= fY + 4; y++) {
        w.set(x, y, pz, y === fY ? C.wallBase : C.whitewall);
      }
      // 西面（面向大殿）：槛窗 + 门（H.door 可开合）
      for (let ppz = tz - 3; ppz <= tz + 3; ppz++) for (let y = fY; y <= fY + 4; y++) {
        const inDoor = ppz >= tz - 1 && ppz <= tz + 1 && y <= fY + 2;
        if (inDoor) continue;
        const win = y >= fY + 1 && y <= fY + 3;
        w.set(tx - 4, y, ppz, win ? (((tx + ppz + y) & 1) ? C.windowGreen : C.windowGlow) : (y === fY ? C.wallBase : C.whitewall));
      }
      H.door({ x: tx - 4, y: fY, z: tz - 1, axis: 'z', w: 3, h: 3, c: C.woodRed, label: '东禅堂' });
      H.eaveBand({ x1: tx - 4, z1: tz - 3, x2: tx + 4, z2: tz + 3, y: fY + 4 });
      H.roof({ x1: tx - 4, z1: tz - 3, x2: tx + 4, z2: tz + 3, y: fY + 5, h: 3, type: 'xieshan', tile: C.roof, overhang: 2, upturn: 1 });
      // 禅堂前石阶
      for (let ppz = tz - 1; ppz <= tz + 1; ppz++) support(tx - 5, ppz, CY, C.stoneWarm, C.stone);
      // 禅堂室内陈设
      H.furnish({ x: tx, z: tz, y: fY, w: 7, d: 5, h: 4, style: 'hall' });
    }

    // ── 4.5 院中石径、香炉 ──
    paveLine([[81, -120], [85, -124], [91, -127]], 3, C.path2, C.stoneWarm);
    paveLine([[91, -121], [96, -121], [99, -121]], 2, C.path2, C.stoneWarm);
    // 院中红梅（院内 4 株）
    for (const [px, pz] of [[81, -124], [83, -120], [82, -118], [95, -125]]) F.plum(px, pz, { red: true, h: 7 });
    // ── 4.6 墙外红梅成林（南坡 8 株）──
    for (const [px, pz] of [[84, -110], [88, -108], [92, -107], [82, -106], [86, -105], [90, -104], [78, -112], [80, -108]]) {
      F.plum(px, pz, { red: true, h: 7 + ((px & 1) ? 1 : 0) });
    }
    // ── 4.7 墙外松柏与山石 ──
    for (const [px, pz] of [[75, -119], [74, -126], [76, -132], [84, -145], [96, -146], [108, -140], [110, -134]]) {
      F.pine(px, pz, { h: 11 + ((px + pz) & 3) });
    }
    for (const [rx, rz, rw, rh] of [[74, -114, 3, 4], [109, -128, 2, 4], [110, -120, 2, 3], [74, -138, 3, 5], [100, -145, 4, 5]]) {
      if (!water(rx, rz)) H.rock({ x: rx, z: rz, size: rw, h: rh });
    }
    // 庵后山石嵌入北墙
    H.rockery({ x1: 82, z1: -146, x2: 102, z2: -142, h: 12, y: 14, seed: 81 });
    for (let x = 80; x <= 104; x += 4) drape(x, -142, 16, 4, [C.pine, C.leafDark, C.mossRock], x);
    ctx.reserve(74, -148, 112, -104);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. 凸碧山庄（山脊 elev14：敞厅方亭、三面矮栏、登山蹬道）
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const GY = 15; // elev14 → 台基 y=15
    // ── 5.1 敞厅方亭（歇山，三面开敞，南面可眺全园；HD：檐柱+1、举高加大）──
    const pav = H.pavilion({
      x: 118, z: -96, size: 12, y: GY, plinthH: 1, columnH: 5, roof: 'xieshan',
      tile: C.roof, roofH: 7, rail: false, step: 3,
      plaque: '凸碧山莊',
    });
    const fl = pav.floorY; // 16
    // 三面矮栏（东、西、南，单层约 1m 高，可凭可坐）
    for (let x = 112; x <= 124; x++) {
      if (x >= 116 && x <= 120) continue; // 南面中间留出入口
      w.set(x, fl, -90, C.marbleShade);
    }
    for (const px of [112, 124]) {
      for (let z = -101; z <= -91; z++) w.set(px, fl, z, C.marbleShade);
    }
    // 亭中石桌石凳交由 H.pavilion 自动精细陈设（方桌+绣墩），此处不再放体素桌
    // 亭后山石（压顶为屏，随亭加高而上抬）
    H.rockery({ x1: 112, z1: -105, x2: 124, z2: -102, h: 7, y: 15, seed: 91 });
    H.rockery({ x1: 108, z1: -100, x2: 110, z2: -93, h: 6, y: 15, seed: 92 });
    H.rock({ x: 127, z: -92, size: 2, h: 6 });
    H.rock({ x: 109, z: -88, size: 2, h: 5 });
    H.rock({ x: 126, z: -102, size: 1, h: 4 });

    // ── 5.2 登山蹬道：自凹晶溪馆东岸至山脊（20 级踏面，贴崖西折而上）──
    // 山脚 (106,-86) 面高 4 → 台地 (106,-105) 面高 15
    stairRun(106, -86, 106, -105, 4, 14, 3, 2, { topC: C.stoneLight, top2: C.stoneWarm, sideC: C.stone });
    // 顶部石台与山脊衔接
    for (let x = 105; x <= 108; x++) for (let z = -107; z <= -104; z++) support(x, z, 14, C.stoneWarm, C.stone);
    // 蹬道外侧矮石栏
    for (let z = -88; z >= -104; z -= 3) {
      const y = 4 + Math.round((-z - 86) * 10 / 19);
      w.setIfEmpty(104, y, z, C.stoneWarm); w.setIfEmpty(104, y + 1, z, C.stoneLight);
    }
    // 山脚蹬道起点石台、山石
    for (let x = 103; x <= 109; x++) for (let z = -88; z <= -84; z++) support(x, z, 3, C.stoneWarm, C.stone);
    H.rockery({ x1: 100, z1: -95, x2: 104, z2: -87, h: 8, y: 2, seed: 93 });
    H.rockery({ x1: 101, z1: -104, x2: 105, z2: -98, h: 9, y: 2, seed: 94 });
    // 山脊松（避南向观景视线，只置亭后与东坡）
    for (const [px, pz] of [[112, -104], [124, -104], [131, -92], [131, -102], [107, -106], [133, -96]]) {
      F.pine(px, pz, { h: 10 + ((px + pz) & 3), r: 4 });
    }
    // 崖畔苔草
    F.moss(108, -106, 128, -86, { density: 0.45 });
    ctx.reserve(100, -110, 134, -76);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. 凹晶溪馆（山脚近水：贴水挑台 + 卷棚敞轩，临水一面开敞）
  // ═══════════════════════════════════════════════════════════════════════════
  {
    // ── 6.1 贴水石台（石柱挑台）──
    waterDeck(88, -81, 99, -74, 4, { edgeC: C.stoneWarm });
    // 台缘石栏（东、西侧；南侧为敞轩后墙，中间留门）
    for (const x of [88, 89, 98, 99]) { w.set(x, 5, -74, C.stoneWarm); w.set(x, 6, -74, C.marbleShade); }
    for (let z = -80; z <= -75; z++) { w.set(88, 5, z, C.stoneWarm); w.set(88, 6, z, C.marbleShade); }
    // 南岸登台石阶
    paintPath([[95, -72], [95, -75]], 3, { c: C.path2, c2: C.path });
    support(92, -74, 5, C.stoneWarm, C.stone); support(97, -74, 5, C.stoneWarm, C.stone);

    // ── 6.2 卷棚敞轩（三间，北面朝水开敞；HD：檐柱+1、屋面举高）──
    const hx = 94, hz = -77;
    // 台座
    for (let x = hx - 4; x <= hx + 4; x++) for (let z = hz - 3; z <= hz + 3; z++) support(x, z, 5, C.stoneWarm, C.stone);
    const fY = 6;
    // 柱（三间，加高）
    for (const px of [hx - 4, hx, hx + 4]) for (const pz of [hz - 3, hz + 3]) H.column(px, pz, fY, 5, C.redPillar);
    // 南面（背水）白墙 + 槛窗 + 后门（H.door 可开合）
    for (let x = hx - 4; x <= hx + 4; x++) for (let y = fY; y <= fY + 4; y++) {
      const inDoor = x >= hx - 1 && x <= hx + 1 && y <= fY + 2;
      if (inDoor) continue;
      const win = y >= fY + 2 && y <= fY + 3;
      w.set(x, y, hz + 3, win ? (((x + y) & 3) === 0 ? C.windowGreen : C.windowGlow) : (y === fY ? C.wallBase : C.whitewall));
    }
    H.door({ x: hx - 1, y: fY, z: hz + 3, axis: 'x', w: 3, h: 3, c: C.woodRed, label: '凹晶溪館' });
    // 东西山墙
    for (const px of [hx - 4, hx + 4]) for (let z = hz - 2; z <= hz + 2; z++) for (let y = fY; y <= fY + 4; y++) {
      w.set(px, y, z, y === fY ? C.wallBase : C.whitewall);
    }
    // 北面开敞：仅额枋 + 矮栏
    for (let x = hx - 4; x <= hx + 4; x++) w.set(x, fY + 4, hz - 3, C.woodDark);
    for (let x = hx - 3; x <= hx + 3; x++) { w.set(x, fY, hz - 3, C.stoneWarm); w.set(x, fY + 1, hz - 3, C.stoneLight); }
    // 檐下彩画带与卷棚顶
    H.eaveBand({ x1: hx - 4, z1: hz - 3, x2: hx + 4, z2: hz + 3, y: fY + 4 });
    H.roof({ x1: hx - 4, z1: hz - 3, x2: hx + 4, z2: hz + 3, y: fY + 5, h: 3, type: 'gableRound', tile: C.roof, overhang: 2, upturn: 1 });
    // 匾「凹晶溪館」（悬于北面额枋下，面向水面；外移一格避免贴片与体素共面）
    H.plaque({ x: hx, y: fY + 3, z: hz - 4, dir: 'north', text: '凹晶溪館', w: 7, h: 2 });
    // 轩内精细陈设（临水一面开敞，家具少而雅）
    H.furnish({ x: hx, z: hz, y: fY, w: 7, d: 5, h: 4.5, style: 'hall' });
    // 临水石阶（下至水面，置舟处）
    for (let i = 0; i < 3; i++) {
      const zz = hz - 4 - i;
      for (let x = hx - 2; x <= hx + 2; x++) support(x, zz, 4 - i, C.stoneWarm, C.stone);
    }

    // ── 6.3 凹晶湾：荷、苇、垂柳、桂 ──
    F.lotus(84, -83, 9, 5, { count: 22, flowers: 3 });
    F.reedBed(84, -74, 92, -72, { count: 4 });
    F.reedBed(97, -80, 102, -76, { count: 4 });
    F.willow(84, -73, { h: 12 });
    F.willow(105, -71, { h: 11 });
    F.plum(82, -72, { red: false, h: 7 });
    // 与凸碧的蹬道相连：石径东行至登山道脚
    paintPath([[99, -78], [104, -76], [106, -80], [106, -84]], 3, { c: C.path3, c2: C.path2 });
    H.rock({ x: 87, z: -72, size: 2, h: 4 });
    H.rock({ x: 99, z: -84, size: 1, h: 3 });
    F.grassTuft(96, -73); F.grassTuft(98, -72);
    F.moss(82, -90, 104, -72, { density: 0.45 });
    ctx.reserve(78, -96, 112, -64);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. 沁芳闸（园东北角水口：石闸 + 闸桥 + 跌水 + 桃花林）
  // ═══════════════════════════════════════════════════════════════════════════
  {
    // ── 7.1 石闸：横跨水口，闸板半启，上架石桥（HD：闸墩/闸框加高）──
    const gx = 129, gz = -136; // 闸桥中心（跨水口）
    // 两侧闸墩（砌石塔）
    for (const px of [121, 137]) {
      for (let x = px - 1; x <= px + 1; x++) {
        for (let y = 7; y <= 15; y++) w.set(x, y, gz, y === 15 ? C.stoneLight : C.stone);
      }
      w.set(px, 16, gz, C.stoneWarm);
    }
    // 闸门石框（下游侧 z=-139）
    for (const px of [128, 138]) {
      support(px, -139, 15, C.stone, C.stoneDark);
      w.set(px, 15, -139, C.stoneLight);
    }
    for (let x = 128; x <= 138; x++) { w.set(x, 14, -139, C.stoneLight); w.set(x, 15, -139, C.stoneWarm); }
    // 木闸板（半启，悬于水口）
    for (let x = 130; x <= 136; x++) for (let y = 6; y <= 12; y++) {
      w.setIfEmpty(x, y, -138, ((x + y) & 1) ? C.woodDark : C.wood);
    }
    // 绞关石
    for (const px of [132, 134]) { w.set(px, 16, -139, C.bronzeDark); w.set(px, 17, -139, C.bronze); }
    // 闸桥（石桥，白玉栏）
    H.bridge({ x: gx, z: gz, len: 17, wid: 7, dir: 'x', type: 'stone1', y: 6 });
    // 桥面与闸墩衔接石阶
    for (let z = gz - 3; z <= gz + 3; z++) support(121, z, 6, C.stoneWarm, C.stone);
    for (let z = gz - 3; z <= gz + 3; z++) support(137, z, 6, C.stoneWarm, C.stone);
    // 匾「沁芳閘」（悬于闸门石框上，面向园内；外移一格避免贴片共面）
    H.plaque({ x: 133, y: 12, z: -137, dir: 'south', text: '沁芳閘', w: 6, h: 2 });

    // ── 7.2 跌水：水口下层白色水体素 / 晶帘意象 ──
    for (let i = 0; i < 130; i++) {
      const x = 131 + Math.floor(R() * 6), z = -145 + Math.floor(R() * 7);
      if (!water(x, z)) continue;
      if (w.get(x, 3, z) !== 0) continue;
      w.set(x, 3, z, pick([C.stoneLight, C.whitewall, C.marble, C.plumWhite, C.stoneWarm]));
    }
    // 跌水口石槛、两侧石壁
    for (let x = 131; x <= 137; x++) { w.set(x, 2, -140, C.stoneDark); w.set(x, 2, -141, C.stone); }
    for (let z = -141; z >= -145; z--) { w.setIfEmpty(130, 3, z, C.stone); w.setIfEmpty(138, 3, z, C.stone); }
    // 石梁桥面下白色水帘（自闸板下泻，随闸门加高而拉长）
    for (let x = 131; x <= 137; x += 2) {
      for (let y = 3; y <= 7; y++) w.setIfEmpty(x, y, -139, y === 3 ? C.whitewall : C.plumWhite);
    }

    // ── 7.3 两岸石径（接旧路）──
    paintPath([[120, -136], [120, -130], [118, -126], [116, -122]], 3, { c: C.path3, c2: C.path2 });
    paintPath([[137, -136], [140, -130], [142, -124]], 3, { c: C.path3, c2: C.path2 });
    H.rock({ x: 120, z: -139, size: 2, h: 4 });
    H.rock({ x: 140, z: -140, size: 2, h: 4 });

    // ── 7.4 桃花林（10–12 株，沁芳闸桥那边桃花树下）──
    const peachSpots = [
      [122, -118], [126, -118], [130, -119], [134, -120], [136, -117],
      [128, -116], [132, -116], [124, -122], [138, -123], [141, -127],
      [143, -132], [140, -136],
    ];
    for (const [px, pz] of peachSpots) F.peach(px, pz);
    // 桃林间石凳
    H.tableSet({ x: 130, z: -119, y: 4, size: 1 });
    // 岸石、草花
    F.shrub(120, -122, { r: 2, c: [C.leafLight, C.leaf] });
    F.shrub(142, -128, { r: 2, c: [C.leaf, C.leafYellow] });
    F.moss(114, -146, 144, -114, { density: 0.4 });
    ctx.reserve(114, -148, 147, -112);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. 收尾：苔草、杂石（只补空地，flora.scatterGarden 随后兜底）
  // ═══════════════════════════════════════════════════════════════════════════
  for (let i = 0; i < 90; i++) {
    const x = 26 + Math.floor(R() * 120), z = -148 + Math.floor(R() * 76);
    if (x < 70 && z > -92) continue; // 让出花溆水面
    if (water(x, z) || onPath(x, z)) continue;
    const g = gtop(x, z);
    if (g < 3) continue;
    if (w.get(x, g + 1, z) !== 0) continue;
    if (R() < 0.55) F.grassTuft(x, z);
    else if (R() < 0.3) H.rock({ x, z, size: 1, h: 1 + Math.floor(R() * 2) });
  }
}
