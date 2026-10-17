// ─────────────────────────────────────────────────────────────────────────────
// 西区（arch-west）：潇湘馆 · 稻香村 · 芦雪庵 · 红香圃·芍药栏 · 柳叶渚·蜂腰桥 ·
//                    园西小景群（芭蕉坞 / 牡丹亭 / 蔷薇院 / 荼蘼架·木香棚）
// 依据：docs/research.md 3.2 / 3.5 / 3.6 / 第五节植物 / 第六节匾联；坐标依 layout.js。
// 体例：1 体素≈1m；地面顶层 y=ctx.groundY，建筑 y 参数 = groundY+1。
// ─────────────────────────────────────────────────────────────────────────────
import { C } from '../../core/palette.js';

export function buildWest(ctx) {
  const { w, H, F, L } = ctx;
  const R = ctx.R || (() => 0.5);
  const gy = (x, z) => Math.round(ctx.groundY(x, z));
  const rnd = (a, b) => a + Math.floor(R() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(R() * arr.length) % arr.length];
  const hash = (x, z, s = 0) => {
    let h = Math.imul((x | 0) + s * 131, 374761393) ^ Math.imul((z | 0) + s * 197, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const reserves = [];
  const reserve = (...r) => reserves.push(r);

  // ── 地表改色（只改地形顶层颜色，不产生悬空体素）────────────────────────────
  function setGround(x, z, c) {
    if (ctx.isWater(x, z)) return false;
    const g = gy(x, z);
    if (!w.get(x, g, z)) return false;
    w.set(x, g, z, c);
    return true;
  }
  function groundRect(x1, z1, x2, z2, colors, opt = {}) {
    const ax1 = Math.min(x1, x2) | 0, ax2 = Math.max(x1, x2) | 0;
    const az1 = Math.min(z1, z2) | 0, az2 = Math.max(z1, z2) | 0;
    const salt = opt.salt || 0;
    for (let z = az1; z <= az2; z++) for (let x = ax1; x <= ax2; x++) {
      if (ctx.isWater(x, z)) continue;
      const g = gy(x, z);
      const cur = w.get(x, g, z);
      if (!cur) continue;
      if (opt.grassOnly && cur !== C.grass && cur !== C.grass2 && cur !== C.grass3 && cur !== C.grassDry) continue;
      const i = ((x * 73856093) ^ (z * 19349663) ^ (salt * 83492791)) >>> 0;
      w.set(x, g, z, colors[i % colors.length]);
    }
  }
  const PEB = [C.pebble, C.pebbleDark, C.path, C.stoneWarm];
  const PATH_ST = [C.path, C.path2, C.path3, C.pebble];
  function groundPath(pts, width, colors = PEB) {
    const half = width / 2;
    const r = Math.ceil(half);
    const cells = new Set();
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const steps = Math.max(1, Math.ceil(len * 2));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
        for (let oz = -r; oz <= r; oz++) for (let ox = -r; ox <= r; ox++) {
          if (ox * ox + oz * oz > half * half + 0.45) continue;
          cells.add((Math.round(cx) + ox) + ',' + (Math.round(cz) + oz));
        }
      }
    }
    for (const k of cells) {
      const [x, z] = k.split(',').map(Number);
      setGround(x, z, PEB[(((x * 7 + z * 13) >>> 0) % PEB.length)]);
    }
  }
  function paveRect(x1, z1, x2, z2, colors = PATH_ST) {
    for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++)
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
        const i = (((x + 3) * 374761393) ^ ((z + 5) * 668265263)) >>> 0;
        setGround(x, z, colors[i % colors.length]);
      }
  }
  // 把范围内普通灰瓦替换为草顶 / 稻茎顶（同时把官式檐下彩画改作素木）
  function strawRoof(x1, x2, z1, z2, y0, y1) {
    const map = {
      [C.roof]: C.thatch, [C.roofDark]: C.thatchDark, [C.roofLight]: C.straw,
      [C.roofEdge]: C.thatchDark, [C.ridge]: C.thatchDark, [C.ridgeLight]: C.straw,
      [C.teal]: C.woodDark, [C.blue]: C.woodDark, [C.gold]: C.thatchDark, [C.goldDark]: C.woodDark,
    };
    for (let y = y0; y <= y1; y++) for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
      const c = w.get(x, y, z);
      if (map[c]) w.set(x, y, z, map[c]);
    }
  }
  // 墙帽瓦→稻茎（黄泥墙专用）
  function strawCap(x1, z1, x2, z2, yCap) {
    for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) for (let y = yCap; y <= yCap + 1; y++) {
      const c = w.get(x, y, z);
      if (!c) continue;
      if (c === C.roof || c === C.roofLight) w.set(x, y, z, hash(x, z, y) > 0.5 ? C.straw : C.thatch);
      else if (c === C.roofDark || c === C.ridge || c === C.roofEdge) w.set(x, y, z, C.thatchDark);
    }
    for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
      if (hash(x, z, 7) > 0.62) w.setIfEmpty(x, yCap + 2, z, hash(x, z, 3) > 0.5 ? C.straw : C.thatchDark);
    }
  }
  // 草顶茅屋：山花白墙改土墙（悬山山墙用黄泥）
  function dirtGable(x1, x2, z1, z2, y0, y1) {
    for (let y = y0; y <= y1; y++) for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
      if (w.get(x, y, z) === C.whitewall) w.set(x, y, z, hash(x, y, z) > 0.5 ? C.dirt : C.dirt2);
    }
  }
  // 草顶脊（补一道正脊，给 gable h 不足的茅屋）
  function thatchRidge(x, y, z, halfW, c = C.thatchDark) {
    H.box(x - halfW, y, z, x + halfW, y, z, c);
    H.box(x - halfW - 1, y + 1, z, x - halfW, y + 1, z, C.straw);
    H.box(x + halfW, y + 1, z, x + halfW + 1, y + 1, z, C.straw);
  }
  function stoneBench(x, z, y, len = 3, dir = 'x') {
    if (dir === 'x') H.box(x - len, y, z, x + len, y, z, C.stoneLight);
    else H.box(x, y, z - len, x, y, z + len, C.stoneLight);
    H.box(x - len + 1, y - 1, z, x + len - 1, y - 1, z, C.stone);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // A. 潇湘馆 —— 粉垣 · 曲折游廊 · 三间卷棚 · 后院引泉 · 千百竿翠竹
  //    x -124..-80 / z 25..63；正房 (-102,42)；东面院门接「西行」石径
  // ══════════════════════════════════════════════════════════════════════════
  {
    const X1 = -124, X2 = -80, Z1 = 25, Z2 = 63;
    const g = gy(-102, 44);          // 台地顶 4
    const y = g + 1;                 // 墙/台基底 5
    const WH = 6, TH = 2;
    const HX = -102, HZ = 42;
    const wallOpt = { y, h: WH, th: TH, c: C.whitewall, base: C.wallBase, cap: C.roof };

    // ── 院墙（粉垣灰瓦帽）──
    H.wall({ ...wallOpt, x1: X1, z1: Z1, x2: X2, z2: Z1 });              // 北
    H.wall({ ...wallOpt, x1: X1, z1: Z2 - TH + 1, x2: X2, z2: Z2 - TH + 1 }); // 南
    H.wall({ ...wallOpt, x1: X1, z1: Z1, x2: X1, z2: Z2 });              // 西
    H.wall({ ...wallOpt, x1: X2 - TH + 1, z1: Z1, x2: X2 - TH + 1, z2: Z2 }); // 东
    // 东院门（随墙门，接西行石径）
    const gz1 = 44, gz2 = 50;
    w.clear(X2 - TH + 1, y, gz1, X2, y + WH - 1, gz2);
    w.clear(X2 - TH + 1, y + WH, gz1, X2, y + WH + 1, gz2);
    paveRect(X2 - TH + 1, gz1, X2, gz2, [C.stoneLight, C.stoneWarm]);
    for (const zz of [gz1, gz2]) {
      H.box(X2 - TH, y, zz, X2, y + WH + 1, zz, C.stone);
    }
    H.box(X2 - TH, y + WH, gz1, X2, y + WH + 1, gz2, C.stoneWarm);          // 门额
    H.roof({ x1: X2 - 4, z1: gz1 - 2, x2: X2 + 1, z2: gz2 + 2, y: y + WH + 2, h: 2, type: 'hip', tile: C.roof, overhang: 1, upturn: 1 });
    H.lantern({ x: X2 - 1, y: y + WH - 1, z: gz1 - 1, red: true });

    // 北墙引泉小隙（后院墙下开一隙）
    w.clear(-114, y, Z1, -112, y + 1, Z1 + TH - 1);
    H.box(-115, y + 2, Z1, -111, y + 2, Z1 + TH - 1, C.stoneWarm);
    H.box(-115, y, Z1, -115, y + 1, Z1 + TH - 1, C.stone);
    H.box(-111, y, Z1, -111, y + 1, Z1 + TH - 1, C.stone);

    // ── 正房：小小三间 · 卷棚 · 前出廊（HD：台基+1、屋顶加高加陡、出檐加大）──
    const res = H.hall({
      x: HX, z: HZ, bays: 3, bayW: 4, depth: 8, y,
      plinthH: 2, plinthC: C.stone, plinthTop: C.stoneLight,
      wallH: 4, columnH: 3, roof: 'gableRound', roofH: 7,
      columns: C.greenPillar, wall: C.whitewall, doorC: C.woodRed,
      stepDir: 'south', interior: false, overhang: 3, upturn: 2,
    });
    const frontZ = res.z2, floorY = res.floorY;
    // 室内陈设规格交给精细网格（书斋：案、书架、琴）
    H.furnish({ x: HX, z: HZ, y: floorY, w: 10, d: 6, h: 3.6, style: 'study' });
    // 前出廊：廊柱 + 廊下彩画枋
    for (const px of [HX - 6, HX - 2, HX + 2, HX + 6]) H.column(px, frontZ + 2, floorY, 3, C.greenPillar);
    H.eaveBand({ x1: HX - 6, z1: frontZ + 2, x2: HX + 6, z2: frontZ + 2, y: floorY + 3 });
    H.box(HX - 6, floorY + 3, frontZ + 1, HX + 6, floorY + 3, frontZ + 1, C.woodDark);
    // 匾「瀟湘館」与联「寶鼎茶閑煙尚綠 / 幽窗棋罷指猶涼」
    // 挂在前廊柱外（z=frontZ+3），从南面/高空机位看不会被廊柱与竹梢遮住
    const plqY = floorY;
    H.plaque({ x: HX, y: plqY, z: frontZ + 3, dir: 'south', text: '瀟湘館', w: 4, h: 2 });
    H.couplet({ x: HX - 4, y: floorY - 0.1, z: frontZ + 3, dir: 'south', text: '寶鼎茶閑煙尚綠', w: 1, h: 3 });
    H.couplet({ x: HX + 4, y: floorY - 0.1, z: frontZ + 3, dir: 'south', text: '幽窗棋罷指猶涼', w: 1, h: 3 });
    // 银红窗纱（霞影纱）糊窗
    H.latticeWindow({ x: HX - 7, y: floorY + 1, z: frontZ, axis: 'x', w: 3, h: 2, cFrame: C.woodDark, cLattice: C.curtain, cGlow: C.curtain });
    H.latticeWindow({ x: HX + 5, y: floorY + 1, z: frontZ, axis: 'x', w: 3, h: 2, cFrame: C.woodDark, cLattice: C.curtain, cGlow: C.curtain });
    H.latticeWindow({ x: res.x1, y: floorY + 1, z: HZ - 3, axis: 'z', w: 3, h: 2, cFrame: C.woodDark, cLattice: C.curtain, cGlow: C.curtain });
    // 台基加高后踏步前沿补一格垫石（防 1 格悬挑）
    for (let xx = HX - 4; xx <= HX + 4; xx++) w.setIfEmpty(xx, y, HZ + 7, C.stoneWarm);
    // 里间小门通后园
    w.clear(HX - 1, floorY, res.z1, HX + 1, floorY + 1, res.z1);
    H.door({ x: HX - 1, y: floorY, z: res.z1, axis: 'x', w: 3, h: 2, c: C.woodDark });

    // ── 曲折游廊（折三段，接东院门至正房前）──
    H.corridor({
      pts: [[-79, 47], [-88, 47], [-88, 52], [-93, 52]], y,
      w: 3, rail: C.redRail, roofC: C.roof, columnsC: C.greenPillar,
    });

    // ── 后院引泉：墙隙 → 石渠绕阶缘屋 → 前院竹下 ──
    const chan = new Set();
    const addChan = (x, z) => chan.add(x + ',' + z);
    for (let z = Z1; z <= 50; z++) for (let x = -114; x <= -113; x++) addChan(x, z);
    for (let x = -114; x <= -94; x++) for (let z = 50; z <= 51; z++) addChan(x, z);
    for (let z = 51; z <= 57; z++) for (let x = -94; x <= -93; x++) addChan(x, z);
    for (let x = -94; x <= -91; x++) for (let z = 56; z <= 58; z++) addChan(x, z);
    for (const k of chan) {
      const [x, z] = k.split(',').map(Number);
      if (ctx.isWater(x, z)) continue;
      w.set(x, g, z, pick([C.waterBed, C.waterBed2, C.waterBed3]));
    }
    // 石渠压边（不压正房台基）
    for (const k of chan) {
      const [x, z] = k.split(',').map(Number);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const kk = (x + dx) + ',' + (z + dz);
        if (chan.has(kk)) continue;
        w.setIfEmpty(x + dx, g + 1, z + dz, hash(x + dx, z + dz, 2) > 0.6 ? C.stoneLight : C.stoneWarm);
      }
    }
    H.box(-95, g, 57, -92, g, 59, C.stoneDark); // 出水石潭
    H.rock({ x: -96, z: 60, size: 2, h: 2 });
    H.rock({ x: -88, z: 57, size: 2, h: 2 });

    // ── 石子甬路 ──
    groundPath([[-78, 46], [-88, 46], [-88, 52], [-96, 52]], 3);
    groundPath([[HX, 51], [HX, 56], [-97, 58], [-90, 59], [-84, 57]], 3);
    groundPath([[HX - 2, 55], [-110, 57], [-116, 55]], 3);
    groundPath([[HX, 38], [-104, 34], [-109, 31], [-113, 30]], 2);
    groundPath([[-80, 43], [-82, 37], [-83, 31]], 2, [C.path3, C.pebble, C.path2]);

    // ── 苔藓（土地苍苔布满）──
    F.moss(X1 + 2, Z1 + 2, X2 - 2, Z2 - 2, { density: 0.72 });

    // ── 花木：梨花一株、芭蕉三本、千百竿翠竹 ──
    F.pear(-108, 30, { h: 11 });
    F.banana(-118, 30, { h: 6 });
    F.banana(-96, 31, { h: 5 });
    F.banana(-112, 57, { h: 6 });
    const bambooSpots = [
      // 院内：后院 / 东西两侧（正房前 8 格中央留 4–5 格视线缺口，只两侧密竹）
      [-120, 32], [-118, 28], [-97, 30], [-89, 30],
      [-84, 34], [-84, 40], [-84, 48],
      [-120, 44], [-120, 52], [-121, 58], [-119, 56],
      [-84, 59],
      // 院外：东墙外（竹遮映） / 西墙外 / 南墙外西段
      [-76, 36], [-74, 43], [-76, 56], [-73, 60],
      [-126, 34], [-127, 44], [-126, 56],
      [-113, 67], [-104, 68], [-96, 66],
    ];
    for (const [bx, bz] of bambooSpots) {
      // 中央正前方与馆前南侧压低（竹高≤6）；两侧与馆外其余保持高竹
      const low = (bx > -112 && bx < -88 && bz > 50 && bz < 63) || (bz >= 64 && bx > -118);
      F.bamboo(bx, bz, { count: rnd(7, 10), h: low ? 4 : rnd(8, 11), spread: low ? 2 : 3 });
    }
    // 竹下石桌石凳
    H.tableSet({ x: -91, z: 58, y: g + 1, size: 2 });
    H.rock({ x: -87, z: 54, size: 3, h: 2 });
    // 馆前草坪：低草闲花，疏朗而不遮望
    for (let i = 0; i < 90; i++) {
      const lx = -120 + Math.floor(R() * 54), lz = 66 + Math.floor(R() * 18);
      F.grassTuft(lx, lz);
    }
    F.flowerPatch(-118, 69, -100, 80, { colors: [C.chrys, C.plumWhite, C.peony2], count: 16, bedC: C.grass2, rowGap: 3, plantGap: 3 });
    F.flowerPatch(-92, 72, -78, 82, { colors: [C.plumWhite, C.chrys], count: 10, bedC: C.grass2, rowGap: 3, plantGap: 3 });
    // 视线保留：馆前草坪留白（既合「石子漫成甬路」的疏朗，也让 POI 视角不被树冠遮挡）
    reserve(-114, 64, -70, 86);

    reserve(X1, Z1, X2, Z2);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // B. 稻香村 —— 黄泥矮墙覆稻茎 · 茅屋三间 · 杏林喷火蒸霞 · 青篱 · 井桔槔 · 菜畦
  //    x -136..-88 / z -102..-58；院 x -130..-104 / z -98..-76
  // ══════════════════════════════════════════════════════════════════════════
  {
    const X1 = -130, Z1 = -98, X2 = -104, Z2 = -76;
    const g = gy(-116, -88);         // 台地顶 6
    const y = g + 1;                 // 7
    const WH = 5, TH = 2;
    const HX = -117, HZ = -89;
    const wallOpt = { y, h: WH, th: TH, c: C.soil, base: C.soilDark, cap: C.roof };

    // ── 黄泥矮墙（墙头覆稻茎）──
    H.wall({ ...wallOpt, x1: X1, z1: Z1, x2: X2, z2: Z1 });
    H.wall({ ...wallOpt, x1: X1, z1: Z2 - TH + 1, x2: X2, z2: Z2 - TH + 1 });
    H.wall({ ...wallOpt, x1: X1, z1: Z1, x2: X1, z2: Z2 });
    H.wall({ ...wallOpt, x1: X2 - TH + 1, z1: Z1, x2: X2 - TH + 1, z2: Z2 });
    strawCap(X1 - 1, Z1 - 1, X2 + 1, Z1 + TH, y + WH);
    strawCap(X1 - 1, Z2 - TH, X2 + 1, Z2 + 1, y + WH);
    strawCap(X1 - 1, Z1, X1 + TH, Z2, y + WH);
    strawCap(X2 - TH, Z1, X2 + 1, Z2, y + WH);
    // 东院门（正对稻香村径）
    const gz1 = -87, gz2 = -81;
    w.clear(X2 - TH + 1, y, gz1, X2, y + WH - 1, gz2);
    w.clear(X2 - TH + 1, y + WH, gz1, X2, y + WH + 1, gz2);
    paveRect(X2 - TH + 1, gz1, X2, gz2, [C.dirt3, C.path3]);
    for (const zz of [gz1, gz2]) H.box(X2 - TH, y, zz, X2, y + WH + 1, zz, C.woodDark);
    H.box(X2 - TH, y + WH, gz1, X2, y + WH + 1, gz2, C.woodDark);
    H.roof({ x1: X2 - 4, z1: gz1 - 2, x2: X2 + 1, z2: gz2 + 2, y: y + WH + 2, h: 2, type: 'hip', tile: C.thatch, overhang: 1, upturn: 1 });
    strawRoof(X2 - 5, X2 + 2, gz1 - 3, gz2 + 3, y + WH + 1, y + WH + 5);

    // ── 茅屋三间（悬山草顶，黄泥墙；HD：台基+1、草顶加高加厚、出檐加大）──
    const res = H.hall({
      x: HX, z: HZ, bays: 3, bayW: 4, depth: 8, y,
      plinthH: 2, plinthC: C.soilDark, plinthTop: C.stoneWarm,
      wallH: 4, columnH: 3, roof: 'gable', roofH: 3,
      columns: C.woodDark, wall: C.dirt, doorC: C.woodDark,
      stepDir: 'south', interior: false, overhang: 2, upturn: 2,
    });
    const frontZ = res.z2, floorY = res.floorY;
    // 室内陈设规格交给精细网格（农舍厅堂）
    H.furnish({ x: HX, z: HZ, y: floorY, w: 10, d: 6, h: 3.6, style: 'hall' });
    strawRoof(res.x1 - 3, res.x2 + 3, res.z1 - 4, res.z2 + 4, floorY + 4, floorY + 14);
    // 山墙草披（悬山博风）
    for (const xx of [res.x1 - 1, res.x2 + 1]) {
      for (let z = res.z1 - 2; z <= res.z2 + 2; z++) {
        if (hash(xx, z, 5) > 0.4) w.setIfEmpty(xx, floorY + 4, z, C.thatchDark);
      }
    }
    dirtGable(res.x1 - 2, res.x2 + 2, res.z1 - 3, res.z2 + 3, floorY + 4, floorY + 14);
    // 稻香村匾、联（新涨绿添浣葛处 / 好云香护采芹人）
    H.plaque({ x: HX, y: floorY + 1, z: frontZ + 1, dir: 'south', text: '稻香村', w: 5, h: 2 });
    H.couplet({ x: HX - 4, y: floorY + 0.2, z: frontZ + 1, dir: 'south', text: '新漲綠添浣葛處', w: 1, h: 2.8 });
    H.couplet({ x: HX + 4, y: floorY + 0.2, z: frontZ + 1, dir: 'south', text: '好雲香護采芹人', w: 1, h: 2.8 });
    // 踏步前沿垫石
    for (let xx = HX - 4; xx <= HX + 4; xx++) w.setIfEmpty(xx, y, HZ + 7, C.stoneWarm);

    // ── 石碣「杏簾在望」（院门东侧，HD 加高）──
    H.box(-101, y, -90, -100, y + 2, -89, C.stone);
    H.box(-101, y + 2, -90, -100, y + 5, -89, C.rock);
    H.box(-102, y, -91, -99, y, -88, C.stoneWarm);
    H.plaque({ x: -99, y: y + 2, z: -89.5, dir: 'east', text: '杏簾在望', w: 4, h: 2, boardColor: C.rockDark });

    // ── 酒旗（篱外村店，杏帘在望；HD 加高）──
    {
      const bx = -99, bz = -73;
      H.column(bx, bz, y, 10, C.woodDark);
      H.box(bx, y + 10, bz, bx + 3, y + 10, bz, C.woodDark);
      H.banner({ x: bx + 2, y: y + 2, z: bz, h: 8, text: '杏簾在望' });
      H.box(bx, y, bz, bx, y + 9, bz, C.wood);
    }

    // ── 土井 + 桔槔 ──
    {
      const wx = -98, wz = -75;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) { w.set(wx, y, wz, C.waterBed2); w.set(wx, y - 1, wz, C.waterBed); continue; }
        w.set(wx + dx, y, wz + dz, C.stoneWarm);
        w.set(wx + dx, y + 1, wz + dz, C.stone);
      }
      // 桔槔：立柱 + 斜杆 + 配重石 + 汲桶
      H.column(wx - 3, wz - 2, y, 5, C.wood);
      const lever = [[-104, y + 6], [-102, y + 6], [-100, y + 5], [-98, y + 5], [-96, y + 4], [-94, y + 4]];
      for (const [lx, ly] of lever) H.box(lx, ly, wz - 2, lx, ly + 1, wz - 2, C.woodDark);
      H.box(-104, y + 3, wz - 2, -103, y + 5, wz - 2, C.rock);   // 配重
      H.box(-94, y + 2, wz - 2, -94, y + 3, wz - 2, C.wood);      // 桶
      H.box(-95, y + 2, wz - 2, -95, y + 2, wz - 2, C.woodDark);
    }

    // ── 青篱（两溜，曲折围合）──
    H.fence({
      pts: [[-133, -74], [-128, -73], [-122, -75], [-117, -73], [-111, -74], [-105, -72], [-99, -74]],
      w: 2, h: 4, c: C.leafDark,
    });
    H.fence({
      pts: [[-132, -58], [-126, -60], [-120, -58], [-114, -60], [-108, -58], [-102, -60]],
      w: 2, h: 4, c: C.leafDark,
    });
    H.fence({ pts: [[-133, -90], [-134, -82], [-133, -75]], w: 2, h: 4, c: C.leafDark });

    // ── 菜畦（八条，稻香村南坡）──
    const rowZ = [-72, -70, -68, -66, -64, -62, -60, -58];
    const plotC = [C.farm, C.soilDark, C.farm, C.soil, C.farm, C.soilDark, C.soil, C.farm];
    rowZ.forEach((rz, ri) => {
      const x1 = -132, x2 = -105;
      for (let x = x1; x <= x2; x++) {
        // 田埂
        if (x === -123 || x === -114 || x === x1 || x === x2) {
          setGround(x, rz, hash(x, rz, 3) > 0.5 ? C.stoneWarm : C.dirt3);
          H.setIfEmpty(x, g + 1, rz, C.dirt2);
          continue;
        }
        setGround(x, rz, plotC[(ri + Math.floor((x + 132) / 9)) % plotC.length]);
        if (hash(x, rz, 9) < 0.72) {
          const yieldC = hash(x, rz, 11) < 0.2 ? C.chrys : (hash(x, rz, 13) < 0.55 ? C.vegetable : C.rice);
          w.setIfEmpty(x, g + 1, rz, yieldC);
          if (hash(x, rz + 1, 5) < 0.35) w.setIfEmpty(x, g + 2, rz, hash(x, rz, 5) < 0.5 ? C.vegetable : C.leafLight);
        }
      }
      // 畦间浅沟
      if (rz < -59) for (let x = x1; x <= x2; x++) setGround(x, rz + 1, hash(x, rz, 17) > 0.5 ? C.dirt2 : C.soilDark);
    });

    // ── 杏林（喷火蒸霞，集中成林）＋ 桑榆槿柘 ──
    // 石碣/酒旗前 5 格留空：不在碣前、旗下点杏树
    const apricots = [
      [-134, -96], [-134, -88], [-133, -81], [-132, -100],
      [-104, -101], [-96, -100], [-89, -99],
      [-93, -93], [-92, -70], [-103, -62], [-103, -83],
    ];
    for (const [ax, az] of apricots) {
      // 东侧近芭蕉坞一带压低一档，露出坞门（其余保持「喷火蒸霞」）
      const lowAp = az > -102 && az < -90 && ax > -110;
      F.apricot(ax, az, { h: lowAp ? rnd(7, 8) : rnd(9, 12), r: 4 });
    }
    F.elm(-136, -91, { h: 12 });
    F.locust(-129, -84, { h: 11 });
    F.mulberry(-89, -87, { h: 9 });
    F.mulberry(-112, -68, { h: 8 });
    F.shrub(-121, -71, { r: 2, c: [C.leaf, C.crabapple] });
    F.shrub(-102, -81, { r: 2, c: [C.leafLight, C.peony2] });

    // 门前石径接稻香村径 + 院内环廊小径（门 → 南院 → 东廊 → 院门）
    groundPath([[-103, -84], [-98, -86], [-93, -84]], 3);
    groundPath([[-104, -78], [-98, -76], [-94, -77]], 2, [C.dirt3, C.path3, C.pebble]);
    groundPath([[-117, -78], [-111, -78], [-107, -80], [-107, -86], [-103, -86]], 2);
    F.moss(-133, -97, -105, -81, { density: 0.35 });

    reserve(-136, -102, -96, -57);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // C. 芦雪庵 —— 傍山临水 · 茅檐土壁 · 槿篱竹牖 · 推窗垂钓 · 芦苇掩覆
  //    x -90..-56 / z -100..-86；茅屋 (-73,-94)；南面临芦雪汀
  // ══════════════════════════════════════════════════════════════════════════
  {
    const g = gy(-73, -94);            // 4
    const y = g + 1;                   // 5
    const HX = -73, HZ = -94;
    const res = H.hall({
      x: HX, z: HZ, bays: 3, bayW: 4, depth: 8, y,
      plinthH: 2, plinthC: C.stoneWarm, plinthTop: C.stoneWarm,
      wallH: 4, columnH: 3, roof: 'gable', roofH: 3,
      columns: C.woodDark, wall: C.dirt, doorC: C.wood,
      stepDir: 'south', interior: false, overhang: 2, upturn: 2,
    });
    const frontZ = res.z2, floorY = res.floorY;
    // 室内陈设规格交给精细网格（庵堂简朴厅堂）
    H.furnish({ x: HX, z: HZ, y: floorY, w: 10, d: 6, h: 3.6, style: 'hall' });
    strawRoof(HX - 11, HX + 11, HZ - 11, HZ + 11, floorY + 4, floorY + 14);
    for (const xx of [res.x1 - 1, res.x2 + 1]) {
      for (let z = res.z1 - 2; z <= res.z2 + 2; z++) if (hash(xx, z, 5) > 0.45) w.setIfEmpty(xx, floorY + 4, z, C.thatchDark);
    }
    dirtGable(HX - 10, HX + 10, HZ - 10, HZ + 10, floorY + 4, floorY + 14);
    // 竹牖（竹框窗，HD 加高）
    H.latticeWindow({ x: HX - 5, y: floorY + 1, z: frontZ, axis: 'x', w: 3, h: 2, cFrame: C.bambooStalk, cLattice: C.bambooLeaf });
    H.latticeWindow({ x: HX + 3, y: floorY + 1, z: frontZ, axis: 'x', w: 3, h: 2, cFrame: C.bambooStalk, cLattice: C.bambooLeaf });
    H.latticeWindow({ x: res.x1, y: floorY + 1, z: HZ + 2, axis: 'z', w: 3, h: 2, cFrame: C.bambooStalk, cLattice: C.bambooLeaf });
    // 匾「荻蘆夜雪」（元春题）
    H.plaque({ x: HX, y: floorY + 1, z: frontZ + 1, dir: 'south', text: '荻蘆夜雪', w: 6, h: 2 });
    // 室内简朴（木榻、粗木案）
    H.box(HX - 2, floorY, HZ + 1, HX + 2, floorY, HZ + 2, C.wood);
    H.box(HX - 2, floorY, HZ + 1, HX - 2, floorY + 1, HZ + 2, C.woodDark);
    H.box(HX + 2, floorY, HZ + 1, HX + 2, floorY + 1, HZ + 2, C.woodDark);
    H.box(HX - 4, floorY, HZ - 2, HX + 4, floorY, HZ - 1, C.woodDark);
    // 台阶落在挑台上：补齐踏步下的垫石（防悬挑）
    for (let xx = HX - 4; xx <= HX + 4; xx++) for (let zz = HZ + 7; zz <= HZ + 8; zz++) w.setIfEmpty(xx, y, zz, C.stoneWarm);

    // ── 槿篱（enclosure，只在陆地一侧；HD 加高）──
    H.fence({ pts: [[-83, -98], [-83, -94], [-82, -90]], w: 2, h: 4, c: C.leaf });
    H.fence({ pts: [[-63, -98], [-61, -94]], w: 2, h: 4, c: C.leaf });
    H.fence({ pts: [[-84, -97], [-79, -98]], w: 2, h: 3, c: C.leafDark });

    // ── 临水挑台（推窗垂钓）──
    const dX1 = -78, dX2 = -68, dZ1 = -87, dZ2 = -83;
    for (let z = dZ1; z <= dZ2; z++) for (let x = dX1; x <= dX2; x++) {
      w.set(x, g, z, ((x + z) & 3) === 0 ? C.woodDark : C.wood);
    }
    for (const px of [dX1, -73, dX2]) for (const pz of [dZ1, dZ2]) {
      for (let yy = 2; yy < g; yy++) w.set(px, yy, pz, C.woodDark);
    }
    H.railing({ x1: dX1, z1: dZ2, x2: dX2, z2: dZ2, y: g + 1, style: 'bamboo', h: 2 });
    H.railing({ x1: dX1, z1: dZ1 + 1, x2: dX1, z2: dZ2 - 1, y: g + 1, style: 'bamboo', h: 2 });
    H.railing({ x1: dX2, z1: dZ1 + 1, x2: dX2, z2: dZ2 - 1, y: g + 1, style: 'bamboo', h: 2 });
    // 竹栏柱头去红，改竹色
    for (let z = dZ1 - 1; z <= dZ2 + 1; z++) for (let x = dX1 - 1; x <= dX2 + 1; x++) {
      for (let y = g; y <= g + 4; y++) if (w.get(x, y, z) === C.redDark) w.set(x, y, z, C.bambooNode);
    }
    // 下水的两级石阶
    w.set(-73, g - 1, -82, C.stoneWarm); w.set(-72, g - 1, -82, C.stoneWarm);
    w.set(-73, g - 2, -81, C.stoneLight); w.set(-72, g - 2, -81, C.stoneLight);

    // ── 芦苇掩覆（成片 200+ 株）──
    const reeds = [
      [-84, -90, -78, -86, 8], [-80, -87, -75, -85, 8], [-72, -86, -64, -84, 10],
      [-62, -87, -57, -82, 10], [-58, -82, -53, -74, 10], [-60, -74, -54, -68, 8],
      [-70, -71, -60, -67, 10], [-82, -76, -76, -70, 8], [-86, -97, -80, -91, 6],
      [-66, -97, -58, -92, 6], [-78, -100, -68, -97, 6], [-60, -90, -57, -86, 6],
    ];
    for (const [x1, z1, x2, z2, n] of reeds) F.reedBed(x1, z1, x2, z2, { count: n });
    F.reedBed(-62, -78, -56, -72, { count: 8 });
    // 门前扫开一小片芦苇，让「荻蘆夜雪」匾与推窗垂钓的路径露出（不碰 y≥10 的屋檐）
    for (let z = -91; z <= -87; z++) for (let x = -79; x <= -67; x++) for (let y = 6; y <= 9; y++) {
      const c = w.get(x, y, z);
      if (c === C.reed || c === C.reed2 || c === C.straw) w.set(x, y, z, 0);
    }
    // 挑台与门口前 2m 空地：清掉长到木台面上的芦苇
    for (let z = -88; z <= -82; z++) for (let x = -79; x <= -67; x++) for (let y = 5; y <= 9; y++) {
      const c = w.get(x, y, z);
      if (c === C.reed || c === C.reed2) w.set(x, y, z, 0);
    }
    F.rockCluster(-62, -88, { w: 3, h: 3 });
    F.rockCluster(-80, -89, { w: 3, h: 2 });

    // ── 小径穿芦度苇，西南接芦雪庵径 ──
    groundPath([[-73, -89], [-73, -86], [-76, -85], [-79, -84]], 2);
    groundPath([[-67, -88], [-64, -90], [-62, -93], [-64, -96]], 2);
    F.moss(-84, -99, -64, -88, { density: 0.3 });

    reserve(-86, -100, -56, -66);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // D. 红香圃 · 芍药栏 —— 三间小敞厅 · 芍药成畦 · 石桌石凳 · 湘云醉眠
  //    x -128..-84 / z -56..-16；敞厅 (-108,-26)；醉眠处 (-124,-51)
  // ══════════════════════════════════════════════════════════════════════════
  {
    const g = gy(-108, -26);           // 4
    const y = g + 1;                   // 5
    const HX = -108, HZ = -26;

    // ── 湘云醉眠：石凳 + 山石（先放，芍药环绕）──
    stoneBench(-124, -51, g + 1, 2, 'x');
    H.rock({ x: -127, z: -53, size: 3, h: 3 });
    H.rock({ x: -121, z: -54, size: 2, h: 2 });
    F.rockCluster(-123, -49, { w: 3, h: 2 });

    // ── 三间小敞厅（卷棚，四面开敞；HD：台基+1、柱加高、屋顶加陡、出檐加大）──
    const halfW = 6, halfD = 4, bays = 3, bayW = 4;
    H.plinth({ x: HX, z: HZ, w: halfW + 2, d: halfD + 2, y, h: 2, c: C.stone, top: C.stoneLight, step: 4, stepTo: 'south' });
    const floorY = y + 2;
    const backZ = HZ - halfD + 1, frontZ = HZ + halfD - 1;
    for (let b = 0; b <= bays; b++) {
      const px = HX - halfW + Math.round(b * bayW);
      H.column(px, backZ, floorY, 3, C.redPillar);
      H.column(px, frontZ, floorY, 3, C.redPillar);
    }
    const midZ = Math.round((backZ + frontZ) / 2);
    H.column(HX - halfW, midZ, floorY, 3, C.redPillar);
    H.column(HX + halfW, midZ, floorY, 3, C.redPillar);
    H.eaveBand({ x1: HX - halfW, z1: backZ, x2: HX + halfW, z2: frontZ, y: floorY + 3 });
    const topY = H.roof({ x1: HX - halfW, z1: backZ, x2: HX + halfW, z2: frontZ, y: floorY + 3, h: 7, type: 'gableRound', tile: C.roof, overhang: 3, upturn: 2 });
    // 山花改木博风（敞厅无山墙）
    for (let yy = floorY + 3; yy <= topY; yy++) for (let z = backZ - 3; z <= frontZ + 3; z++) for (let x = HX - halfW - 3; x <= HX + halfW + 3; x++) {
      if (w.get(x, yy, z) === C.whitewall) w.set(x, yy, z, C.woodDark);
    }
    // 坐凳栏杆（三面）
    H.railing({ x1: HX - halfW + 1, z1: backZ, x2: HX + halfW - 1, z2: backZ, y: floorY, style: 'wood', h: 1 });
    H.railing({ x1: HX - halfW, z1: backZ + 1, x2: HX - halfW, z2: frontZ - 1, y: floorY, style: 'wood', h: 1 });
    H.railing({ x1: HX + halfW, z1: backZ + 1, x2: HX + halfW, z2: frontZ - 1, y: floorY, style: 'wood', h: 1 });
    H.plaque({ x: HX, y: floorY, z: frontZ + 1, dir: 'south', text: '紅香圃', w: 5, h: 2 });
    // 室内陈设规格交给精细网格（宴集敞厅）
    H.furnish({ x: HX, z: HZ, y: floorY, w: halfW * 2, d: halfD * 2, h: 3.2, style: 'dining' });
    // 踏步前沿垫石
    for (let xx = HX - 4; xx <= HX + 4; xx++) w.setIfEmpty(xx, y, HZ + 7, C.stoneWarm);

    // ── 芍药成畦（粉白相间，200+）；敞厅南侧留 6–8 格空场 ──
    const beds = [
      [-128, -56, -118, -46, 26], [-116, -56, -104, -47, 28], [-102, -56, -90, -48, 26],
      [-128, -30, -118, -18, 26], [-98, -28, -89, -23, 20],
    ];
    for (const [x1, z1, x2, z2, n] of beds) {
      F.peonyBed(x1, z1, x2, z2, { count: n, rowGap: 2, plantGap: 2, colors: [C.peony, C.peony2, C.plumWhite] });
    }
    F.flowerPatch(-128, -46, -104, -36, { count: 64, rowGap: 2, plantGap: 2, colors: [C.peony, C.peony2, C.plumWhite], bedC: C.soilDark });
    F.flowerPatch(-120, -36, -90, -28, { count: 52, rowGap: 2, plantGap: 2, colors: [C.peony2, C.plumWhite, C.peony], bedC: C.soilDark });
    // 芍药栏（木栏）
    H.railing({ x1: -128, z1: -56, x2: -118, z2: -56, y: g, style: 'bamboo', h: 1 });
    H.railing({ x1: -128, z1: -56, x2: -128, z2: -46, y: g, style: 'bamboo', h: 1 });
    H.railing({ x1: -128, z1: -30, x2: -118, z2: -30, y: g, style: 'bamboo', h: 1 });
    // 醉眠处落英（花瓣沾衣）
    for (let i = 0; i < 56; i++) {
      const px = -124 + rnd(-6, 6), pz = -51 + rnd(-5, 5);
      if (ctx.isWater(px, pz)) continue;
      if (w.get(px, gy(px, pz) + 1, pz) === 0) w.set(px, gy(px, pz) + 1, pz, hash(px, pz, 3) > 0.5 ? C.peony : C.peony2);
    }
    // 院径旁几块山石
    F.rockCluster(-104, -48, { w: 3, h: 2 });
    F.rockCluster(-92, -33, { w: 2, h: 2 });
    // 敞厅南侧留 6–8 格空场（只低草 + 西侧石桌石凳，不种高花、不堵门径），给高空相机让位
    for (let i = 0; i < 40; i++) {
      const cx2 = -118 + Math.floor(R() * 22), cz2 = -21 + Math.floor(R() * 10);
      F.grassTuft(cx2, cz2);
    }
    H.tableSet({ x: -120, z: -13, y: g + 1, size: 2 });
    F.moss(-119, -21, -95, -11, { density: 0.28 });
    reserve(-120, -21, -94, -8);
    F.moss(-126, -55, -88, -18, { density: 0.25 });

    reserve(-128, -56, -86, -16);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // E. 柳叶渚 · 蜂腰桥 —— 池西柳堤 · 垂柳依依 · 苇叶蓼花 · 汀步 · 石桥
  //    x -72..-46 / z -58..-34；蜂腰桥移就东岸实际水口（两端落地）
  // ══════════════════════════════════════════════════════════════════════════
  {
    // ── 垂柳（沙洲与南岸）──
    const willows = [
      [-70, -54], [-67, -50], [-70, -52], [-65, -48], [-71, -42],
      [-70, -38], [-67, -36], [-71, -56], [-66, -55], [-71, -40], [-73, -57],
    ];
    for (const [x, z] of willows) F.willow(x, z, { h: rnd(11, 14) });
    // ── 苇叶、蓼花 ──
    F.reedBed(-72, -60, -66, -56, { count: 8 });
    F.reedBed(-66, -44, -61, -40, { count: 8 });
    F.reedBed(-70, -40, -64, -36, { count: 8 });
    F.reedBed(-74, -56, -69, -50, { count: 6 });
    F.flowerPatch(-72, -58, -66, -55, { colors: [C.peony2, C.lotusFlower, C.plumWhite], count: 12, bedC: C.dirt });
    F.flowerPatch(-70, -41, -64, -38, { colors: [C.peony, C.peony2, C.plumWhite], count: 12, bedC: C.dirt });

    // ── 汀步（支流浅濑，接北岸沙洲）──
    for (const sx of [-82, -80, -78]) {
      w.set(sx, 3, -51, C.stoneLight);
      w.set(sx, 2, -51, C.stoneDark);
    }
    // ── 柳堤小径 ──
    groundPath([[-83, -51], [-76, -51], [-70, -54], [-67, -49]], 2, [C.pebble, C.path3, C.pebbleDark]);
    groundPath([[-70, -44], [-68, -40], [-67, -36]], 2, [C.pebble, C.path3]);

    // ── 石碣「柳葉渚」（HD 略加高）──
    H.box(-66, gy(-66, -45) + 1, -45, -65, gy(-66, -45) + 5, -45, C.rock);
    H.plaque({ x: -64, y: gy(-66, -45) + 2, z: -45, dir: 'east', text: '柳葉渚', w: 3, h: 2, boardColor: C.rockDark });

    // ── 蜂腰桥（青石单孔，中段收窄，两端落地）──
    {
      const cx = -72, cz = -45, deckY = 3;
      for (let i = -4; i <= 4; i++) {
        const x = cx + i;
        const t = Math.abs(i) / 4;
        const lift = Math.round((1 - t * t) * 1);
        const hw = Math.abs(i) >= 3 ? 2 : 1;         // 桥端宽五、蜂腰宽三
        const yy = deckY + lift;
        for (let dz = -hw; dz <= hw; dz++) {
          w.set(x, yy, cz + dz, ((i + dz) & 1) ? C.stoneLight : C.stone);
          w.set(x, yy - 1, cz + dz, C.stoneDark);
        }
        for (const s of [-1, 1]) {
          w.set(x, yy + 1, cz + s * hw, C.marble);
          w.set(x, yy + 2, cz + s * hw, C.marble);
          if (i % 3 === 0) w.set(x, yy + 3, cz + s * hw, C.marbleShade);
        }
      }
      for (const ex of [-4, 0, 4]) {
        for (let yy = 1; yy <= deckY; yy++) for (let dz = -2; dz <= 2; dz++) w.set(cx + ex, yy, cz + dz, C.stone);
      }
      F.rockCluster(cx - 9, cz - 1, { w: 3, h: 2 });
      F.rockCluster(cx + 8, cz + 1, { w: 3, h: 2 });
    }

    F.moss(-72, -58, -60, -34, { density: 0.3 });
    reserve(-80, -60, -58, -33);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // F. 园西小景群：芭蕉坞 · 牡丹亭 · 蔷薇院 · 荼蘼架·木香棚
  // ══════════════════════════════════════════════════════════════════════════

  // F1. 芭蕉坞 —— 低洼坞地，石坞门南向，芭蕉十数本
  {
    const g = gy(-116, -110);          // 5
    const y = g + 1;                   // 6
    // 坞门石墙（南面，x -126..-108，z -104..-103；HD 加高）
    for (let x = -126; x <= -108; x++) {
      for (let t = 0; t < 2; t++) {
        for (let k = 0; k < 5; k++) {
          const c = k === 0 ? C.rockDark : (hash(x, -103 + t, k) > 0.55 ? C.rock : (k > 1 ? C.rockLight : C.rock));
          w.set(x, y + k, -104 + t, c);
        }
      }
    }
    // 门洞
    w.clear(-118, y, -104, -112, y + 4, -103);
    for (const px of [-118, -112]) for (let k = 0; k <= 5; k++) for (let t = 0; t < 2; t++) w.set(px, y + k, -104 + t, C.stoneWarm);
    for (let x = -118; x <= -112; x++) for (let t = 0; t < 2; t++) w.set(x, y + 5, -104 + t, C.stoneWarm);
    // 墙帽
    for (let x = -127; x <= -107; x++) for (let t = -1; t < 3; t++) w.set(x, y + 5, -104 + t, (t === -1 || t === 2) ? C.stoneDark : C.stoneWarm);
    // 匾「芭蕉塢」
    H.plaque({ x: -115, y: y + 2, z: -102, dir: 'south', text: '芭蕉塢', w: 4, h: 2, boardColor: C.rockDark });
    // 坞内石径
    groundPath([[-115, -103], [-115, -108], [-119, -113], [-122, -116]], 2, [C.pebble, C.path3, C.stoneWarm]);
    // 芭蕉十数本（坞地阴湿）
    const bananas = [
      [-125, -118], [-119, -117], [-113, -118], [-108, -114], [-123, -112],
      [-116, -111], [-110, -108], [-125, -107], [-120, -105], [-113, -105],
      [-124, -114], [-118, -108],
    ];
    for (const [x, z] of bananas) F.banana(x, z, { h: rnd(5, 7) });
    // 坞地山石与苔
    F.rockCluster(-108, -110, { w: 3, h: 3 });
    F.rockCluster(-124, -104, { w: 3, h: 2 });
    F.rockCluster(-110, -117, { w: 2, h: 2 });
    F.moss(-126, -119, -108, -105, { density: 0.55 });
    F.shrub(-112, -112, { r: 2, c: [C.leaf, C.leafDark] });
    reserve(-128, -120, -106, -102);
  }

  // F2. 牡丹亭 —— 小型方亭攒尖，四周牡丹/芍药圃
  {
    const px = -134, pz = -64;
    const g = gy(px, pz);              // 4
    const pav = H.pavilion({
      x: px, z: pz, size: 6, y: g + 1, plinthH: 2, columnH: 3, roofH: 4,
      roof: 'pyramid', tile: C.roof, rail: 'wood', railC: C.redRail, overhang: 3,
    });
    // 收短宝顶
    {
      const ty = w.topY(px, pz);
      for (let y = ty; y > ty - 2; y--) w.set(px, y, pz, 0);
    }
    H.plaque({ x: px, y: pav.floorY + 1, z: pz + 4, dir: 'south', text: '牡丹亭', w: 4, h: 2 });
    H.plaque({ x: px, y: pav.floorY + 1, z: pz - 3, dir: 'north', text: '牡丹亭', w: 4, h: 2 });
    // 亭基四周一圈石牙子，把花圃与台基隔开（避免花埋亭体）
    for (let x = px - 6; x <= px + 6; x++) { w.setIfEmpty(x, g + 1, pz - 6, C.stoneWarm); w.setIfEmpty(x, g + 1, pz + 6, C.stoneWarm); }
    for (let z = pz - 6; z <= pz + 6; z++) { w.setIfEmpty(px - 6, g + 1, z, C.stoneWarm); w.setIfEmpty(px + 6, g + 1, z, C.stoneWarm); }
    // 南面留出入口：拆一段栏杆，铺 2–3 格宽汀石小径（可从庭院走进去）
    for (let xx = px - 1; xx <= px + 1; xx++) {
      for (let y = pav.floorY; y <= pav.floorY + 3; y++) w.set(xx, y, pz + 3, 0);
      for (let zz = pz + 6; zz <= pz + 9; zz++) w.setIfEmpty(xx, g + 1, zz, C.stoneWarm);
    }
    // 四周花圃（隔石牙子 1–2 格，不埋亭体）
    F.peonyBed(-142, -70, -140, -57, { count: 10, rowGap: 3, plantGap: 2, colors: [C.peony, C.peony2, C.plumWhite] });
    F.peonyBed(-128, -70, -126, -57, { count: 10, rowGap: 3, plantGap: 2, colors: [C.peony2, C.plumWhite, C.peony] });
    F.peonyBed(-141, -58, -128, -55, { count: 12, rowGap: 2, plantGap: 3, colors: [C.peony, C.plumWhite, C.peony2] });
    F.rockCluster(-140, -67, { w: 2, h: 2 });
    F.rockCluster(-129, -61, { w: 2, h: 2 });
    F.moss(-142, -70, -126, -54, { density: 0.3 });
    reserve(-142, -70, -126, -54);
  }

  // F3. 蔷薇院 —— 矮墙小院，蔷薇攀架
  {
    const X1 = -143, Z1 = -51, X2 = -129, Z2 = -35;
    const g = gy(-136, -43);           // 4
    const y = g + 1;                   // 5
    const WH = 4, TH = 2;
    const wallOpt = { y, h: WH, th: TH, c: C.whitewall, base: C.wallBase, cap: C.roof };
    H.wall({ ...wallOpt, x1: X1, z1: Z1, x2: X2, z2: Z1 });
    H.wall({ ...wallOpt, x1: X1, z1: Z2 - TH + 1, x2: X2, z2: Z2 - TH + 1 });
    H.wall({ ...wallOpt, x1: X1, z1: Z1, x2: X1, z2: Z2 });
    H.wall({ ...wallOpt, x1: X2 - TH + 1, z1: Z1, x2: X2 - TH + 1, z2: Z2 });
    // 南院门
    w.clear(-138, y, Z2 - TH + 1, -132, y + WH - 1, Z2);
    for (const px of [-138, -132]) for (let k = 0; k <= WH + 2; k++) for (let t = 0; t < TH; t++) w.set(px, y + k, Z2 - TH + 1 + t, C.stoneWarm);
    for (let x = -138; x <= -132; x++) for (let t = 0; t < TH; t++) w.set(x, y + WH + 2, Z2 - TH + 1 + t, C.stoneWarm);
    H.plaque({ x: -135, y: y + WH, z: Z2 + 1, dir: 'south', text: '薔薇院', w: 4, h: 2 });
    // 蔷薇攀架（两座）＋墙头垂蔓（HD 加高，高出墙帽可见）
    F.vine({ x1: -141, z1: -48, x2: -133, z2: -45, y: g + 6, topC: [C.crabapple, C.peony2], leafC: C.leaf });
    F.vine({ x1: -141, z1: -42, x2: -133, z2: -39, y: g + 6, topC: [C.peony2, C.plumWhite], leafC: C.leaf });
    F.vine({ x1: -142, z1: -50, x2: -134, z2: -49, y: g + 6, topC: [C.crabapple, C.plumWhite], leafC: C.leafLight });
    F.shrub(-130, -40, { r: 2, c: [C.crabapple, C.leaf] });
    F.shrub(-141, -37, { r: 2, c: [C.peony2, C.leafLight] });
    F.moss(-142, -50, -130, -36, { density: 0.3 });
    reserve(-144, -52, -128, -34);
  }

  // F4. 荼蘼架 · 木香棚 —— 藤架两座（白花/黄花覆顶）
  {
    const g = gy(-137, -74);           // 4
    F.vine({ x1: -143, z1: -79, x2: -134, z2: -76, y: g + 6, topC: [C.plumWhite, C.chrys], leafC: C.leafLight });
    F.vine({ x1: -143, z1: -73, x2: -134, z2: -70, y: g + 6, topC: [C.chrys, C.plumWhite], leafC: C.leaf });
    H.plaque({ x: -135.5, y: 8, z: -75, dir: 'south', text: '荼蘼架', w: 4, h: 2 });
    H.plaque({ x: -135.5, y: 8, z: -69, dir: 'south', text: '木香棚', w: 4, h: 2 });
    F.flowerPatch(-143, -80, -134, -68, { count: 18, rowGap: 3, plantGap: 3, colors: [C.plumWhite, C.chrys, C.leafLight], bedC: C.grass2 });
    F.moss(-144, -81, -132, -67, { density: 0.35 });
    reserve(-144, -81, -130, -67);
  }

  // ── 收尾：统一登记保留区（供全园补植避让）──────────────────────────────────
  for (const r of reserves) ctx.reserve(...r);
}
