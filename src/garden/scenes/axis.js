// ─────────────────────────────────────────────────────────────────────────────
// 中轴核心区：正门 · 翠嶂 · 沁芳亭桥 · 省亲牌坊 · 顾恩思义殿 · 大观楼 · 配楼
// ─────────────────────────────────────────────────────────────────────────────
import { C } from '../../core/palette.js';

export function buildAxis(ctx) {
  const { w, H, F, L, R } = ctx;
  const gy = (x, z) => ctx.groundY(x, z);
  const deco = (x1, z1, x2, z2, c) => {
    for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
      const g = gy(x, z);
      w.set(x, g, z, c);
    }
  };
  // ── 石狮（蹲踞式，须弥座）────────────────────────────────────────────────
  function lion(x, z, facing = 1) {
    const g = gy(x, z) + 1;
    H.box(x - 2, g, z - 1, x + 2, g + 1, z + 1, C.stoneWarm);   // 须弥座
    H.box(x - 1, g + 1, z - 1, x + 1, g + 1, z + 1, C.stoneLight);
    H.box(x - 1, g + 2, z - 1, x + 1, g + 3, z + 1, C.stoneLight); // 身
    H.box(x - 1, g + 2, z + facing, x + 1, g + 3, z + facing, C.stoneLight); // 前胸
    H.box(x - 1, g + 4, z, x + 1, g + 5, z + facing, C.stoneLight); // 头
    H.box(x - 1, g + 4, z - facing, x + 1, g + 5, z - facing, C.stoneWarm); // 鬃
    H.box(x, g + 4, z + facing, x, g + 4, z + facing, C.stoneDark); // 眼
    H.box(x - 1, g + 6, z, x + 1, g + 6, z, C.stoneWarm);       // 额
    H.box(x, g + 2, z - facing, x, g + 3, z - facing, C.stoneWarm); // 尾
    H.box(x - 2, g + 2, z + facing, x - 2, g + 3, z + facing, C.stone); // 爪
    H.box(x + 2, g + 2, z + facing, x + 2, g + 3, z + facing, C.stone);
    H.box(x, g + 2, z + facing + 1, x, g + 2, z + facing + 1, C.stoneWarm); // 绣球
  }
  // ── 铜鼎（香炉）────────────────────────────────────────────────────────────
  function censer(x, z, y) {
    H.box(x - 1, y, z - 1, x + 1, y, z + 1, C.stoneWarm);
    H.box(x - 1, y + 1, z - 1, x + 1, y + 2, z + 1, C.bronze);
    H.box(x - 2, y + 2, z, x + 2, y + 2, z, C.bronzeDark);
    H.box(x, y + 3, z, x, y + 4, z, C.bronze);
    H.box(x, y + 5, z, x, y + 5, z, C.bronzeDark);
  }
  // ── 石灯 ──────────────────────────────────────────────────────────────────
  function stoneLamp(x, z) {
    const g = gy(x, z) + 1;
    H.box(x, g, z, x, g + 2, z, C.stoneLight);
    H.box(x - 1, g + 3, z - 1, x + 1, g + 3, z + 1, C.stoneWarm);
    H.box(x, g + 4, z, x, g + 4, z, C.lampWarm);
    H.box(x - 1, g + 5, z - 1, x + 1, g + 5, z + 1, C.stoneLight);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. 正门（五间门楼，筒瓦泥鳅脊，水磨砖墙，虎皮石下碱，白石台阶）
  // ══════════════════════════════════════════════════════════════════════════
  {
    const gIn = gy(0, 143);        // 园内台地顶 4
    const base = gIn + 1;          // 台基第一层 5
    // 台基（跨在园墙上，向南伸出）
    H.box(-14, base, 138, 14, base + 1, 153, C.stoneWarm);
    H.box(-13, base + 1, 139, 13, base + 1, 152, C.marbleShade);
    H.box(-14, base + 2, 139, 14, base + 2, 153, C.stoneWarm);
    H.box(-13, base + 2, 140, 13, base + 2, 152, C.marble);
    // 南面台阶
    for (let s = 0; s < 3; s++) {
      H.box(-6, base + 1 - s, 154 + s, 6, base + 1 - s, 156 + s, s === 0 ? C.marble : C.stoneWarm);
    }
    // 御道与门前广场
    for (let z = 152; z <= 159; z++) for (let x = -4; x <= 4; x++) {
      const y = z <= 156 ? base + 2 : 4;
      w.set(x, y, z, (x + z) % 6 === 0 ? C.marble : C.marbleShade);
    }
    // 门楼主体
    const floorY = base + 3;       // 8
    const wallH = 4, halfW = 11, zFront = 151, zBack = 140;
    // 台基面地坪
    H.box(-halfW + 1, floorY - 1, zBack + 1, halfW - 1, floorY - 1, zFront - 1, C.stoneWarm);
    // 侧墙
    for (let z = zBack; z <= zFront; z++) {
      for (let y = floorY; y < floorY + wallH; y++) {
        w.set(-halfW, y, z, y < floorY + 1 ? C.wallBase : C.whitewallShade);
        w.set(halfW, y, z, y < floorY + 1 ? C.wallBase : C.whitewallShade);
      }
    }
    // 后墙（园内一侧）：中央门洞 + 两侧窗
    for (let x = -halfW; x <= halfW; x++) {
      for (let y = floorY; y < floorY + wallH; y++) {
        w.set(x, y, zBack, y < floorY + 1 ? C.wallBase : C.whitewallShade);
      }
    }
    // 前墙与三门
    for (let x = -halfW; x <= halfW; x++) {
      for (let y = floorY; y < floorY + wallH; y++) {
        const ax = Math.abs(x);
        const inDoor = ax <= 2 || (ax >= 6 && ax <= 8);
        if (!inDoor) w.set(x, y, zFront, y < floorY + 1 ? C.wallBase : C.whitewallShade);
      }
    }
    // 贯通门洞（南北）
    for (const [cx, cw] of [[0, 2], [-7, 1], [7, 1]]) {
      const x0 = Math.round(cx - cw), x1 = Math.round(cx + cw);
      for (let x = x0; x <= x1; x++) {
        for (let z = zBack; z <= zFront; z++) {
          for (let y = floorY; y < floorY + wallH - 1; y++) w.set(x, y, z, 0);
        }
      }
      // 门框与门楣
      for (let y = floorY; y < floorY + wallH - 1; y++) {
        w.set(x0 - 1, y, zFront, C.stoneWarm); w.set(x1 + 1, y, zFront, C.stoneWarm);
        w.set(x0 - 1, y, zBack, C.stoneWarm); w.set(x1 + 1, y, zBack, C.stoneWarm);
      }
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        w.set(x, floorY + wallH - 1, zFront, C.woodDark);
        w.set(x, floorY + wallH - 1, zBack, C.woodDark);
      }
    }
    // 板门（半掩，靠两侧）
    for (const s of [-1, 1]) {
      for (let x = s === -1 ? -2 : 2; x <= (s === -1 ? -1 : 3); x++) {
        for (let y = floorY; y < floorY + wallH - 1; y++) w.set(x, y, zFront - 1, C.woodDark);
      }
    }
    // 门柱（无朱粉，深木）
    for (const px of [-halfW, -7, -2, 2, 7, halfW]) {
      for (let y = floorY; y < floorY + wallH; y++) {
        w.set(px, y, zFront, C.woodDark);
        w.set(px, y, zBack, C.woodDark);
      }
    }
    // 额枋
    for (let x = -halfW; x <= halfW; x++) {
      w.set(x, floorY + wallH, zFront, C.woodDark);
      w.set(x, floorY + wallH, zBack, C.woodDark);
    }
    // 屋顶（筒瓦泥鳅脊）
    H.roof({
      x1: -halfW - 1, z1: zBack - 2, x2: halfW + 1, z2: zFront + 2,
      y: floorY + wallH + 1, h: 3, type: 'gableRound', tile: C.roof, overhang: 2, upturn: 1,
    });
    // 匾额（前后面各一）
    H.plaque({ x: 0, y: floorY + wallH - 2, z: zFront + 1, dir: 'south', text: '大觀園', w: 8, h: 2 });
    H.plaque({ x: 0, y: floorY + wallH - 2, z: zBack - 1, dir: 'north', text: '大觀園', w: 8, h: 2 });
    // 檐下灯笼
    H.lantern({ x: -7, y: floorY + wallH - 1, z: zFront + 2, red: true });
    H.lantern({ x: 7, y: floorY + wallH - 1, z: zFront + 2, red: true });
    // 八字墙
    for (const s of [-1, 1]) {
      for (let k = 0; k < 9; k++) {
        const x = s * (13 + k);
        const z = 152 + Math.floor(k * 0.6);
        for (let y = 3; y < 8; y++) w.set(x, y, z, y < 4 ? C.wallBase : C.whitewall);
        for (let zz = -1; zz <= 1; zz++) w.set(x, 8, z + zz, C.roof);
        w.set(x, 9, z, C.ridge);
      }
    }
    // 石狮、石灯
    lion(-19, 156, 1); lion(19, 156, 1);
    stoneLamp(-10, 155); stoneLamp(10, 155);
    // 门前两株古槐
    F.elm(-26, 156); F.elm(26, 156);
    ctx.reserve(-34, 134, 34, 160);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. 翠嶂 · 曲径通幽（横挡正门内侧的大假山，石洞穿山）
  // ══════════════════════════════════════════════════════════════════════════
  {
    const g = gy(0, 124);
    // 主山横亘，三峰崚嶒，中藏石洞（翠嶂只作障景，不宜过高）
    H.rockery({
      x1: -46, z1: 112, x2: 32, z2: 132, h: 10, seed: 11,
      cave: true,
      passage: [[0, 136], [1, 131], [-2, 126], [1, 121], [-1, 116], [0, 110]],
      y: 4,
      peaks: [
        { x: -20, z: 122, h: 14, r: 13 },
        { x: 12, z: 120, h: 12, r: 11 },
        { x: -2, z: 114, h: 15, r: 8 },
      ],
    });
    // 穿山石径铺石
    H.line(0, 136, 0, 132, (x, z) => w.set(x, g, z, C.stoneWarm));
    H.line(0, 132, 0, 110, (x, z) => {
      for (let dx = -2; dx <= 2; dx++) w.set(x + dx, g, z, (x + z) % 5 === 0 ? C.stone : C.stoneWarm);
      w.set(x, g, z, C.path2);
    });
    // 洞额题刻「曲径通幽」
    H.plaque({ x: 0, y: g + 8, z: 135, dir: 'south', text: '曲径通幽', w: 9, h: 2, boardColor: C.rockDark, textColor: C.goldText });
    // 石洞两侧题石与石灯
    for (const s of [-1, 1]) {
      H.rock({ x: s * 5, z: 133, size: 2, h: 3, y: g });
      H.box(s * 4, g, 132, s * 4, g + 1, 132, C.stoneWarm);
    }
    stoneLamp(-7, 129); stoneLamp(7, 129); stoneLamp(-7, 118); stoneLamp(7, 118);
    // 山石、苔藓、薜荔
    for (let i = 0; i < 26; i++) {
      const x = -46 + Math.floor(R() * 78);
      const z = 108 + Math.floor(R() * 27);
      if (Math.abs(x) < 6 && z > 110 && z < 136) continue;
      H.rock({ x, z, size: 2 + Math.floor(R() * 3), h: 2 + Math.floor(R() * 5) });
    }
    F.moss(-46, 108, 32, 134);
    F.vine({ x1: -34, z1: 111, x2: -10, z2: 118, y: g + 10, topC: C.woodDark, leafC: C.leafDark });
    F.vine({ x1: 4, z1: 112, x2: 26, z2: 118, y: g + 9, topC: C.woodDark, leafC: C.leaf });
    F.vine({ x1: -8, z1: 120, x2: -2, z2: 127, y: g + 12, topC: C.woodDark, leafC: C.leafDark });
    // 山脚与入口古松
    for (const [tx, tz] of [[-50, 114], [38, 114], [-42, 132], [32, 133], [-52, 128], [40, 126], [-14, 138], [14, 138]]) {
      F.pine(tx, tz, { h: 12 + Math.floor(R() * 4) });
    }
    // 入口前庭花木
    F.flowerPatch(-16, 136, -8, 144, { count: 26, colors: [C.chrys, C.peony2, C.plumWhite] });
    F.flowerPatch(8, 136, 16, 144, { count: 26, colors: [C.chrys, C.lotusFlower, C.plumWhite] });
    ctx.reserve(-54, 106, 42, 146);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. 沁芳亭 · 沁芳桥（三孔石拱桥，桥上有亭；白石为栏，兽面衔吐）
  // ══════════════════════════════════════════════════════════════════════════
  {
    const x = 0, z = 54;
    const deckY = 4, halfL = 18, halfW = 7;
    const liftOf = (dx) => Math.round(2 * (1 - (dx / halfL) ** 2));
    const deckTop = (dx) => deckY + liftOf(dx) + 1; // 桥面顶层实体之上
    // 桥面（两格厚，微拱）
    for (let dx = -halfL; dx <= halfL; dx++) {
      const lift = liftOf(dx);
      for (let dz = -halfW; dz <= halfW; dz++) {
        const top = (Math.abs(dx) % 4 === 0 || Math.abs(dz) === halfW) ? C.stone : C.stoneLight;
        w.set(x + dx, deckY + lift, z + dz, top);
        w.set(x + dx, deckY + lift - 1, z + dz, Math.abs(dz) === halfW ? C.stoneWarm : C.stone);
      }
    }
    // 桥墩 + 三孔拱券
    const openings = [{ c: -11, hw: 4 }, { c: 0, hw: 4 }, { c: 11, hw: 4 }];
    for (let dx = -halfL; dx <= halfL; dx++) {
      const bottom = deckY + liftOf(dx) - 2;
      const op = openings.find((o) => Math.abs(dx - o.c) <= o.hw);
      for (let dz = -halfW; dz <= halfW; dz++) {
        if (op) {
          const local = Math.abs(dx - op.c) / op.hw;
          const archTop = 1 + Math.round(3 * (1 - local * local));
          for (let y = archTop + 1; y <= bottom; y++) {
            w.set(x + dx, y, z + dz, (y === archTop + 1 && Math.abs(dz) === halfW) ? C.stoneWarm : C.stone);
          }
        } else {
          for (let y = 0; y <= bottom; y++) {
            w.set(x + dx, y, z + dz, y < 2 ? C.stoneDark : C.stone);
          }
        }
      }
    }
    // 白石栏杆（望柱+栏板，随桥面起伏）
    for (const side of [-1, 1]) {
      const zz = z + side * (halfW + 1);
      for (let dx = -halfL; dx <= halfL; dx++) {
        const top = deckTop(dx);
        w.set(x + dx, top, zz, C.marble);
        w.set(x + dx, top + 1, zz, (dx % 3 === 0) ? C.marble : C.marbleShade);
        if (dx % 4 === 0) {
          w.set(x + dx, top + 2, zz, C.marble);
          w.set(x + dx, top + 3, zz, C.stoneWarm);
        }
      }
    }
    // 兽面衔吐（桥墩出水处）
    for (const o of openings) {
      for (const side of [-1, 1]) {
        const zz = z + side * (halfW + 1);
        w.set(x + o.c, 2, zz, C.stoneWarm);
        w.set(x + o.c - 1, 1, zz, C.stoneWarm);
        w.set(x + o.c + 1, 1, zz, C.stoneWarm);
        w.set(x + o.c, 1, zz, C.stoneDark);
      }
    }
    // 桥上亭（四柱攒尖，白石栏，红柱）
    const pav = H.pavilion({
      x, z, size: 8, y: deckY + 3, plinthH: 1, columnH: 3, roofH: 3,
      roof: 'pyramid', tile: C.roofLight, railStyle: 'stone', railC: C.marble,
      plaque: '沁芳',
    });
    H.couplet({ x: -5, y: pav.floorY + 1, z: z + 5, dir: 'south', text: '繞堤柳借三篙翠', w: 1, h: 4 });
    H.couplet({ x: 5, y: pav.floorY + 1, z: z + 5, dir: 'south', text: '隔岸花分一脈香', w: 1, h: 4 });
    // 两岸点景：垂柳、碧桃、山石，留出桥头视线
    for (const [tx, tz] of [[-26, 42], [28, 42], [-30, 68], [32, 68], [-42, 54], [44, 54]]) {
      if (!ctx.isWater(tx, tz)) F.willow(tx, tz, { h: 10 + Math.floor(R() * 4) });
    }
    for (const [tx, tz] of [[-20, 40], [22, 40], [-18, 70], [20, 70]]) {
      if (!ctx.isWater(tx, tz)) F.peach(tx, tz);
    }
    F.lotus(-14, 55, 10, 5, { count: 22 });
    F.lotus(14, 52, 10, 5, { count: 18 });
    for (let i = 0; i < 8; i++) {
      const xx = -34 + Math.floor(R() * 68), zz = 40 + Math.floor(R() * 6);
      if (!ctx.isWater(xx, zz) && Math.abs(xx) > 20) H.rock({ x: xx, z: zz, size: 2, h: 2 });
      const xx2 = -34 + Math.floor(R() * 68), zz2 = 64 + Math.floor(R() * 6);
      if (!ctx.isWater(xx2, zz2) && Math.abs(xx2) > 20) H.rock({ x: xx2, z: zz2, size: 2, h: 2 });
    }
    ctx.reserve(-56, 32, 56, 80);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. 省亲别墅牌坊
  // ══════════════════════════════════════════════════════════════════════════
  {
    const x = 0, z = -100;
    const y = gy(x, z) + 1;
    H.archway({ x, z, dir: 'x', span: 20, h: 12, c: C.marble, plaque: '省親別墅' });
    // 牌坊前御路石雕
    deco(-5, -99, 5, -94, C.marbleShade);
    for (let i = -4; i <= 4; i++) w.set(i, gy(i, -97), -97, C.marble);
    // 汉白玉栏杆夹道
    for (const side of [-1, 1]) {
      for (let zz = -94; zz <= -86; zz += 2) {
        const xx = x + side * 12;
        if (ctx.isWater(xx, zz)) continue;
        w.set(xx, gy(xx, zz) + 1, zz, C.marble);
        w.set(xx, gy(xx, zz) + 2, zz, C.marble);
      }
    }
    // 石灯四座、铜鼎
    stoneLamp(-10, -94); stoneLamp(10, -94);
    censer(-8, -88, gy(-8, -88) + 1); censer(8, -88, gy(8, -88) + 1);
    ctx.reserve(-24, -104, 24, -84);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. 顾恩思义殿（正殿，重檐歇山金琉璃，七间，月台）
  // ══════════════════════════════════════════════════════════════════════════
  {
    const x = 0, z = -118;
    const y = gy(x, z) + 1; // 6
    const res = H.hall({
      x, z, bays: 7, bayW: 4, depth: 16, y,
      plinthH: 2, plinthC: C.marbleShade, plinthTop: C.marble,
      wallH: 5, columnH: 6, roof: 'xieshan', tile: C.glaze, roofH: 4,
      columns: C.redPillar, wall: C.red, doorC: C.woodRed,
      plaque: '顧恩思義',
      couplets: ['天地啟宏慈', '古今垂曠典'],
      stepDir: 'south',
    });
    // 月台（前出平台）
    const platY = y + 1;
    for (let px = -17; px <= 17; px++) {
      for (let pz = -108; pz <= -99; pz++) {
        w.set(px, platY, pz, C.marble);
        w.set(px, platY - 1, pz, C.marbleShade);
      }
    }
    // 月台栏杆
    for (let px = -17; px <= 17; px += 2) {
      w.set(px, platY + 1, -99, C.marble);
      w.set(px, platY + 2, -99, C.marble);
    }
    for (let pz = -108; pz <= -99; pz += 2) {
      w.set(-17, platY + 1, pz, C.marble);
      w.set(17, platY + 1, pz, C.marble);
    }
    // 三面踏跺
    for (let s = 0; s < 2; s++) {
      for (let px = -6; px <= 6; px++) w.set(px, platY - 1 - s, -98 + s, C.marbleShade);
    }
    // 月台铜鼎、日晷
    censer(-12, -103, platY + 1);
    censer(12, -103, platY + 1);
    H.box(-2, platY, -104, 2, platY + 1, -101, C.marbleShade);
    H.box(-1, platY + 2, -103, 1, platY + 2, -102, C.bronze);
    // 殿前松与玉兰
    for (const [tx, tz] of [[-30, -108], [30, -108], [-34, -116], [34, -116], [-28, -98], [28, -98]]) {
      if (!ctx.isWater(tx, tz)) F.pine(tx, tz, { h: 12 + Math.floor(R() * 4) });
    }
    for (const [tx, tz] of [[-22, -96], [22, -96], [-16, -110], [16, -110]]) {
      if (!ctx.isWater(tx, tz)) F.plum(tx, tz, { red: false });
    }
    ctx.reserve(-36, -132, 36, -94);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. 东西配殿（体仁沐德 / 含芳、缀锦阁前院）
  // ══════════════════════════════════════════════════════════════════════════
  for (const side of [-1, 1]) {
    const x = side * 32, z = -110;
    const y = gy(x, z) + 1;
    H.hall({
      x, z, bays: 3, bayW: 4, depth: 9, y, plinthH: 1,
      wallH: 4, columnH: 4, roof: 'gable', tile: C.roof, roofH: 3,
      columns: C.redPillar, wall: C.whitewall, doorC: C.woodDark,
      plaque: side < 0 ? '體仁沐德' : '含芳', stepDir: 'south',
      couplets: null,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. 大观楼（二层重檐，金琉璃）与东西飞楼（含芳阁 / 缀锦阁）
  // ══════════════════════════════════════════════════════════════════════════
  {
    const x = 0, z = -137;
    const y = gy(x, z) + 1; // 6
    const halfW = 10, halfD = 6;
    const levels = [
      { y0: y + 2, wallH: 3, colH: 4, roofH: 0, tile: C.glaze },      // 一层
      { y0: y + 11, wallH: 3, colH: 4, roofH: 4, tile: C.glaze },     // 二层
    ];
    // 台基
    H.plinth({ x, z, w: halfW + 3, d: halfD + 3, y, h: 2, c: C.marbleShade, top: C.marble, step: 6, stepTo: 'south' });
    const floorY1 = y + 2;
    // 一层：柱、墙、门窗
    for (let b = -2; b <= 2; b++) {
      for (const zz of [z - halfD, z + halfD]) H.column(x + b * 4, zz, floorY1, 4, C.redPillar);
    }
    for (let zz = z - halfD + 1; zz <= z + halfD - 1; zz++) {
      for (let yy = floorY1; yy < floorY1 + 3; yy++) {
        w.set(x - halfW, yy, zz, C.red);
        w.set(x + halfW, yy, zz, C.red);
      }
    }
    for (let xx = x - halfW; xx <= x + halfW; xx++) {
      for (let yy = floorY1; yy < floorY1 + 3; yy++) {
        if (yy === floorY1) w.set(xx, yy, z + halfD, C.wallBase);
        else w.set(xx, yy, z + halfD, ((xx + yy) & 3) === 0 ? C.windowGlow : C.windowGreen);
      }
    }
    // 一层门
    for (let xx = -3; xx <= 3; xx++) for (let yy = floorY1; yy < floorY1 + 3; yy++) w.set(xx, yy, z + halfD, 0);
    H.door({ x: -3, y: floorY1, z: z + halfD, axis: 'x', w: 7, h: 3, c: C.woodRed, studs: true });
    // 一层腰檐（重檐下层，仅做檐口与两层坡面，不做正脊）
    H.eaveBand({ x1: x - halfW, z1: z - halfD, x2: x + halfW, z2: z + halfD, y: floorY1 + 3 });
    {
      const skY = floorY1 + 4;
      for (let k = 0; k < 3; k++) {
        const ox = halfW + 3 - k, oz = halfD + 4 - k;
        for (let xx = x - ox; xx <= x + ox; xx++) {
          for (const zz of [z - oz, z + oz]) {
            w.set(xx, skY + k, zz, k === 2 ? C.glaze : (xx & 1 ? C.glazeDark : C.glazeLight));
          }
        }
        for (let zz = z - oz + 1; zz < z + oz; zz++) {
          for (const xx of [x - ox, x + ox]) w.set(xx, skY + k, zz, k === 2 ? C.glaze : C.glazeDark);
        }
      }
      // 翼角
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        w.set(x + sx * (halfW + 4), skY + 1, z + sz * (halfD + 5), C.glazeDark);
        w.set(x + sx * (halfW + 4), skY + 2, z + sz * (halfD + 5), C.glazeLight);
        w.set(x + sx * (halfW + 3), skY + 1, z + sz * (halfD + 4), C.glaze);
      }
      // 腰檐下金色斗拱带
      for (let xx = x - halfW; xx <= x + halfW; xx += 2) {
        w.set(xx, floorY1 + 3, z + halfD + 1, C.gold);
        w.set(xx, floorY1 + 3, z - halfD - 1, C.gold);
      }
    }
    // 平座（二层回廊）
    const balconyY = floorY1 + 6;
    for (let xx = x - halfW - 1; xx <= x + halfW + 1; xx++) {
      for (let zz = z - halfD - 1; zz <= z + halfD + 1; zz++) {
        w.set(xx, balconyY, zz, C.wood);
      }
    }
    // 平座栏杆
    for (let xx = x - halfW - 1; xx <= x + halfW + 1; xx += 2) {
      w.set(xx, balconyY + 1, z - halfD - 1, C.redRail);
      w.set(xx, balconyY + 2, z - halfD - 1, C.redRail);
      w.set(xx, balconyY + 1, z + halfD + 1, C.redRail);
      w.set(xx, balconyY + 2, z + halfD + 1, C.redRail);
    }
    for (let zz = z - halfD - 1; zz <= z + halfD + 1; zz += 2) {
      w.set(x - halfW - 1, balconyY + 1, zz, C.redRail);
      w.set(x - halfW - 1, balconyY + 2, zz, C.redRail);
      w.set(x + halfW + 1, balconyY + 1, zz, C.redRail);
      w.set(x + halfW + 1, balconyY + 2, zz, C.redRail);
    }
    // 二层
    const floorY2 = balconyY + 1;
    for (let b = -2; b <= 2; b++) {
      for (const zz of [z - halfD, z + halfD]) H.column(x + b * 4, zz, floorY2, 4, C.redPillar);
    }
    for (let zz = z - halfD + 1; zz <= z + halfD - 1; zz++) {
      for (let yy = floorY2; yy < floorY2 + 3; yy++) {
        w.set(x - halfW, yy, zz, C.red);
        w.set(x + halfW, yy, zz, C.red);
      }
    }
    for (let xx = x - halfW; xx <= x + halfW; xx++) {
      for (let yy = floorY2; yy < floorY2 + 3; yy++) {
        w.set(xx, yy, z + halfD, ((xx + yy) & 1) === 0 ? C.windowGlow : C.windowGreen);
        w.set(xx, yy, z - halfD, ((xx + yy) & 1) === 0 ? C.windowGlow : C.windowGreen);
      }
    }
    H.eaveBand({ x1: x - halfW, z1: z - halfD, x2: x + halfW, z2: z + halfD, y: floorY2 + 3 });
    H.roof({ x1: x - halfW - 1, z1: z - halfD - 1, x2: x + halfW + 1, z2: z + halfD + 1, y: floorY2 + 4, h: 4, type: 'xieshan', tile: C.glaze, overhang: 3, upturn: 2 });
    // 匾额与楹联（二层南面）
    H.plaque({ x, y: floorY2 + 3, z: z + halfD + 2, dir: 'south', text: '大觀樓', w: 8, h: 2 });
    H.couplet({ x: -6, y: floorY2 - 2, z: z + halfD + 2, dir: 'south', text: '天地啟宏慈', w: 1, h: 4 });
    H.couplet({ x: 6, y: floorY2 - 2, z: z + halfD + 2, dir: 'south', text: '九州被恩榮', w: 1, h: 4 });
    // 楼前松、玉兰
    for (const [tx, tz] of [[-16, -128], [16, -128], [-20, -136], [20, -136], [-12, -146], [12, -146]]) {
      if (!ctx.isWater(tx, tz)) F.pine(tx, tz, { h: 12 + Math.floor(R() * 5) });
    }
    for (const [tx, tz] of [[-8, -126], [8, -126], [-24, -130], [24, -130]]) {
      if (!ctx.isWater(tx, tz)) F.plum(tx, tz, { red: false });
    }

    // 东西飞楼：含芳阁（西）/ 缀锦阁（东）
    for (const side of [-1, 1]) {
      const fx = side * 30, fz = -134;
      const fy = gy(fx, fz) + 1;
      const fBays = 3, fHalfW = 7, fHalfD = 5;
      H.plinth({ x: fx, z: fz, w: fHalfW + 2, d: fHalfD + 2, y: fy, h: 1, c: C.marbleShade, top: C.marble, step: 3, stepTo: 'south' });
      const f1 = fy + 1;
      for (let b = -1; b <= 1; b++) {
        H.column(fx + b * 5, fz - fHalfD, f1, 4, C.redPillar);
        H.column(fx + b * 5, fz + fHalfD, f1, 4, C.redPillar);
      }
      for (let zz = fz - fHalfD + 1; zz <= fz + fHalfD - 1; zz++) {
        for (let yy = f1; yy < f1 + 3; yy++) { w.set(fx - fHalfW, yy, zz, C.red); w.set(fx + fHalfW, yy, zz, C.red); }
      }
      for (let xx = fx - fHalfW; xx <= fx + fHalfW; xx++) {
        for (let yy = f1; yy < f1 + 3; yy++) w.set(xx, yy, fz + fHalfD, ((xx + yy) & 1) === 0 ? C.windowGlow : C.windowGreen);
      }
      H.eaveBand({ x1: fx - fHalfW, z1: fz - fHalfD, x2: fx + fHalfW, z2: fz + fHalfD, y: f1 + 3 });
      H.roof({ x1: fx - fHalfW - 1, z1: fz - fHalfD - 1, x2: fx + fHalfW + 1, z2: fz + fHalfD + 1, y: f1 + 4, h: 2, type: 'hip', tile: C.glazeGreen, overhang: 2, upturn: 1 });
      const fBalcony = f1 + 6;
      for (let xx = fx - fHalfW - 1; xx <= fx + fHalfW + 1; xx++) for (let zz = fz - fHalfD - 1; zz <= fz + fHalfD + 1; zz++) w.set(xx, fBalcony, zz, C.wood);
      for (let xx = fx - fHalfW - 1; xx <= fx + fHalfW + 1; xx += 2) { w.set(xx, fBalcony + 1, fz - fHalfD - 1, C.redRail); w.set(xx, fBalcony + 1, fz + fHalfD + 1, C.redRail); }
      const f2 = fBalcony + 1;
      for (let b = -1; b <= 1; b++) { H.column(fx + b * 5, fz - fHalfD, f2, 3, C.redPillar); H.column(fx + b * 5, fz + fHalfD, f2, 3, C.redPillar); }
      for (let xx = fx - fHalfW; xx <= fx + fHalfW; xx++) {
        for (let yy = f2; yy < f2 + 3; yy++) w.set(xx, yy, fz + fHalfD, ((xx + yy) & 1) === 0 ? C.windowGlow : C.windowGreen);
      }
      H.eaveBand({ x1: fx - fHalfW, z1: fz - fHalfD, x2: fx + fHalfW, z2: fz + fHalfD, y: f2 + 3 });
      H.roof({ x1: fx - fHalfW - 1, z1: fz - fHalfD - 1, x2: fx + fHalfW + 1, z2: fz + fHalfD + 1, y: f2 + 4, h: 3, type: 'xieshan', tile: C.glazeGreen, overhang: 2, upturn: 1 });
      H.plaque({ x: fx, y: f2 + 2, z: fz + fHalfD + 1, dir: 'south', text: side < 0 ? '含芳閣' : '綴錦閣', w: 6, h: 2 });
      // 复道（连接主楼与飞楼）
      const startX = side * (halfW + 2), endX = side * (fHalfW + 2);
      for (let xx = Math.min(startX, endX); xx <= Math.max(startX, endX); xx++) {
        for (let zz = fz - 2; zz <= fz + 2; zz++) {
          w.set(xx, balconyY, zz, C.wood);
        }
      }
      for (let xx = Math.min(startX, endX) + 1; xx <= Math.max(startX, endX) - 1; xx += 3) {
        H.column(xx, fz - 2, balconyY + 1, 3, C.redPillar);
        H.column(xx, fz + 2, balconyY + 1, 3, C.redPillar);
      }
      for (let xx = Math.min(startX, endX); xx <= Math.max(startX, endX); xx++) {
        for (let zz = fz - 3; zz <= fz + 3; zz++) {
          const edge = zz === fz - 3 || zz === fz + 3;
          if (edge) w.set(xx, balconyY + 3 + (Math.abs(xx - fz) % 2), zz, C.roofEdge);
          else w.set(xx, balconyY + 3, zz, C.roof);
        }
      }
    }
    ctx.reserve(-44, -148, 44, -124);
  }

  // ── 中轴补植：甬道两侧松柏、玉兰、海棠 ──────────────────────────────────
  for (const [tz, tx] of [[-86, -30], [-80, 30], [-74, -36], [-68, 36], [-60, -28], [-56, 28]]) {
    if (!ctx.isWater(tx, tz)) F.pine(tx, tz, { h: 10 + Math.floor(R() * 4) });
  }
  for (const side of [-1, 1]) {
    for (let zz = -92; zz <= -30; zz += 10) {
      const tx = side * (15 + Math.floor(R() * 6));
      if (!ctx.isWater(tx, zz)) {
        if (R() < 0.5) F.apricot(tx, zz, { h: 8 + Math.floor(R() * 3) });
        else F.willow(tx, zz, { h: 10 + Math.floor(R() * 3) });
      }
    }
  }
}
