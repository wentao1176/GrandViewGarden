// ─────────────────────────────────────────────────────────────────────────────
// 东区：怡红院（A）· 秋爽斋/晓翠堂（B）· 蓼风轩·暖香坞（C）· 滴翠亭（D）
// 依据：docs/research.md §3.2 / §3.5 / §3.7 / §6；坐标：layout.ZONES
// 尺度：1 体素≈1m。台地 y=ctx.groundY；建筑 y=台地顶层+1。
// 说明：本文件为场景自有构件（屋面/门楼/铺地/台地驳岸）自绘，通用件用 H.*，
//       植物一律用 F.*；每院先种植、后 ctx.reserve（reserve 会阻止 flora 落在院内）。
// ─────────────────────────────────────────────────────────────────────────────
import { C } from '../../core/palette.js';

export function buildEast(ctx) {
  const { w, H, F } = ctx;
  const set = (x, y, z, c) => w.set(x, y, z, c);
  const gy = (x, z) => ctx.groundY(x, z);
  const water = (x, z) => ctx.isWater(x, z);
  const pathCell = (x, z) => ctx.isPath(x, z);
  const rnd = () => ctx.R();
  const chance = (p) => ctx.R() < p;

  // ── 确定性坐标哈希（色差用，兼顾网格合并）───────────────────────────────────
  function hash2(x, z, s = 0) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 通用构件
  // ═══════════════════════════════════════════════════════════════════════════

  /** 屋面起翘（四角飞檐） */
  function upturn(ax, az, bx, bz, y, up, edgeC, tileC) {
    const midX = (ax + bx) / 2, midZ = (az + bz) / 2;
    for (const [cx, cz] of [[ax, az], [bx, az], [ax, bz], [bx, bz]]) {
      const sx = cx < midX ? -1 : 1, sz = cz < midZ ? -1 : 1;
      for (let k = 1; k <= up; k++) {
        set(cx + sx * k, y + k - 1, cz, edgeC);
        set(cx, y + k - 1, cz + sz * k, edgeC);
        set(cx + sx * k, y + k - 1, cz + sz * k, tileC);
      }
      set(cx + sx, y + up, cz + sz, edgeC);
    }
  }

  function eaveRing(ax, az, bx, bz, y, edgeC, tileC) {
    for (let x = ax; x <= bx; x++) { set(x, y, az, edgeC); set(x, y, bz, edgeC); }
    for (let z = az + 1; z < bz; z++) { set(ax, y, z, edgeC); set(bx, y, z, edgeC); }
    // 檐下一圈瓦口/椽头
    for (let x = ax + 1; x < bx; x++) { set(x, y, az + 1, (x & 1) ? tileC : edgeC); set(x, y, bz - 1, (x & 1) ? tileC : edgeC); }
    for (let z = az + 1; z < bz; z++) { set(ax + 1, y, z, (z & 1) ? tileC : edgeC); set(bx - 1, y, z, (z & 1) ? tileC : edgeC); }
  }

  /** 屋面举折：低檐平缓、近脊陡峻；返回逐层水平收进量 */
  function slopeProfile(half, h) {
    const lim = Math.max(1, Math.floor(half));
    const out = [];
    for (let i = 1; i <= h; i++) {
      let v = i >= h ? lim : Math.round(half * Math.pow(i / h, 0.72));
      if (out.length && v <= out[out.length - 1]) v = out[out.length - 1] + 1;
      out.push(Math.min(v, lim));
    }
    out[out.length - 1] = lim;
    return out;
  }
  function stepCount(half) { return Math.max(2, Math.min(6, Math.round(half * 0.7))); }

  /**
   * 歇山顶（正脊沿 x）：四坡下段 + 两坡上段 + 山花 + 正脊
   * x1..x2 / z1..z2 = 檐口内圈（墙体轮廓），y = 檐口层
   */
  function roofXieshan(x1, z1, x2, z2, y, o = {}) {
    const ovX = o.overhangX ?? 2, ovZ = o.overhang ?? 2, up = o.upturn ?? 1;
    const tile = o.tile ?? C.roof, tileD = o.tileDark ?? C.roofDark, tileL = o.tileLight ?? C.roofLight;
    const edge = o.edge ?? C.roofEdge, ridgeC = o.ridge ?? C.ridge, ridgeL = o.ridgeLight ?? C.ridgeLight;
    const ax = x1 - ovX, bx = x2 + ovX, az = z1 - ovZ, bz = z2 + ovZ;
    eaveRing(ax, az, bx, bz, y, edge, tileD);
    upturn(ax, az, bx, bz, y, up, edge, tile);
    const halfZ = (bz - az) / 2, xHalf = (bx - ax) / 2;
    const h = o.h ?? stepCount(halfZ);
    const prof = slopeProfile(halfZ, h);
    const hip = o.hip ?? Math.max(1, Math.round(h * 0.6));
    const ridgeIns = Math.round(xHalf * (o.ridgeRatio ?? 0.62));
    let topY = y, rx1 = ax, rx2 = bx, rz = Math.round((az + bz) / 2);
    for (let i = 1; i <= h; i++) {
      const iz = prof[i - 1];
      const ix = Math.round(Math.min(i, hip) * (ridgeIns / hip));
      const ax2 = ax + ix, bx2 = bx - ix, az2 = az + iz, bz2 = bz - iz;
      if (az2 > bz2 || ax2 > bx2) break;
      for (let x = ax2; x <= bx2; x++) {
        for (let z = az2; z <= bz2; z++) {
          let c;
          if (i > hip && (x === ax2 || x === bx2)) c = o.gableC ?? C.whitewall;   // 山花
          else {
            c = (((x - ax) >> 1) & 1) ? tile : tileD;
            if (hash2(x, z, 7) < 0.07) c = tileL;
          }
          set(x, y + i, z, c);
        }
      }
      topY = y + i; rx1 = ax2; rx2 = bx2; rz = Math.round((az2 + bz2) / 2);
      if (az2 >= bz2) break;
    }
    // 正脊 + 两端起翘
    for (let x = rx1 - 1; x <= rx2 + 1; x++) set(x, topY + 1, rz, ridgeC);
    for (let x = rx1; x <= rx2; x++) set(x, topY + 2, rz, ridgeL);
    set(rx1 - 2, topY + 2, rz, ridgeC);
    set(rx2 + 2, topY + 2, rz, ridgeC);
    return topY + 1;
  }

  /** 卷棚顶（圆脊沿 x，两端山墙、前后出檐） */
  function roofRound(x1, z1, x2, z2, y, o = {}) {
    const ovX = o.overhangX ?? 0, ovZ = o.overhang ?? 2, up = o.upturn ?? 1;
    const tile = o.tile ?? C.roof, tileD = o.tileDark ?? C.roofDark, tileL = o.tileLight ?? C.roofLight;
    const edge = o.edge ?? C.roofEdge, ridgeC = o.ridge ?? C.roofLight;
    const ax = x1 - ovX, bx = x2 + ovX, az = z1 - ovZ, bz = z2 + ovZ;
    eaveRing(ax, az, bx, bz, y, edge, tileD);
    upturn(ax, az, bx, bz, y, up, edge, tile);
    const halfZ = (bz - az) / 2;
    const h = o.h ?? stepCount(halfZ);
    const prof = slopeProfile(halfZ, h);
    const gableC = o.gableC ?? C.whitewall;
    let topY = y, topZ = Math.round((az + bz) / 2);
    for (let i = 1; i <= h; i++) {
      const iz = prof[i - 1];
      const az2 = az + iz, bz2 = bz - iz;
      if (az2 > bz2) break;
      for (let x = ax; x <= bx; x++) {
        const end = x === ax || x === bx;
        for (let z = az2; z <= bz2; z++) {
          let c;
          if (end) c = gableC;                                           // 山墙
          else {
            c = (((x - ax) >> 1) & 1) ? tile : tileD;
            if (hash2(x, z, 3) < 0.07) c = tileL;
          }
          set(x, y + i, z, c);
        }
      }
      topY = y + i; topZ = Math.round((az2 + bz2) / 2);
      if (az2 >= bz2) break;
    }
    // 圆脊：一路瓦楞 + 中段压顶（卷棚无正脊）
    for (let x = ax + 1; x <= bx - 1; x++) set(x, topY + 1, topZ, (x & 1) ? tileL : ridgeC);
    for (let x = ax + 2; x <= bx - 2; x++) set(x, topY + 2, topZ, tileD);
    return topY + 2;
  }

  /** 攒尖顶（方亭：四坡攒尖 + 宝顶） */
  function roofPyramid(cx, cz, half, y, o = {}) {
    const up = o.upturn ?? 2;
    const tile = o.tile ?? C.roof, tileD = o.tileDark ?? C.roofDark, tileL = o.tileLight ?? C.roofLight;
    const edge = o.edge ?? C.roofEdge, ridgeC = o.ridge ?? C.ridge;
    const ax = cx - half, bx = cx + half, az = cz - half, bz = cz + half;
    eaveRing(ax, az, bx, bz, y, edge, tileD);
    upturn(ax, az, bx, bz, y, up, edge, tile);
    const h = o.h ?? stepCount(half);
    const prof = slopeProfile(half, h);
    let topY = y;
    for (let i = 1; i <= h; i++) {
      const ins = prof[i - 1];
      const ax2 = cx - (half - ins), bx2 = cx + (half - ins);
      const az2 = cz - (half - ins), bz2 = cz + (half - ins);
      if (ax2 > bx2 || az2 > bz2) break;
      for (let x = ax2; x <= bx2; x++) {
        for (let z = az2; z <= bz2; z++) {
          let c = (((x - ax) >> 1) & 1) ? tile : tileD;
          if (x === ax2 || x === bx2 || z === az2 || z === bz2) c = ((x + z) & 1) ? tile : edge;
          if (hash2(x, z, 11) < 0.07) c = tileL;
          set(x, y + i, z, c);
        }
      }
      topY = y + i;
      if (ax2 === bx2 || az2 === bz2) break;
    }
    // 宝顶（宝珠 + 刹杆）
    set(cx, topY + 1, cz, ridgeC);
    set(cx, topY + 2, cz, (o.finial ?? C.gold));
    set(cx, topY + 3, cz, C.goldDark);
    return topY + 3;
  }

  /** 铺地：只覆盖地形顶层；避开地形既有石板路（保留 lead 的园路） */
  function pave(x1, z1, x2, z2, y, cMain = C.path2, cAlt = C.path3, cEdge = C.stoneWarm, o = {}) {
    const ax = Math.min(x1, x2), bx = Math.max(x1, x2), az = Math.min(z1, z2), bz = Math.max(z1, z2);
    for (let x = ax; x <= bx; x++) {
      for (let z = az; z <= bz; z++) {
        if (water(x, z)) continue;
        if (pathCell(x, z) && !o.overwritePath) continue;
        if (w.get(x, y, z) === 0) continue;                 // 只铺在实心顶层上
        const border = x === ax || x === bx || z === az || z === bz;
        let c;
        if (border) c = cEdge;
        else {
          const h = hash2(x, z, 5);
          c = h < 0.1 ? cAlt : cMain;
          if ((x + z) % 7 === 0) c = cAlt;
        }
        set(x, y, z, c);
      }
    }
  }

  /** 沿折线的窄石径（画在地形表面） */
  function trail(pts, wid = 3, y = null, c = C.path2) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      const n = Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1));
      for (let t = 0; t <= n; t++) {
        const x = Math.round(x1 + ((x2 - x1) * t) / Math.max(1, n));
        const z = Math.round(z1 + ((z2 - z1) * t) / Math.max(1, n));
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > wid - 2) continue;
          if (water(x + dx, z + dz)) continue;
          const g = y ?? gy(x + dx, z + dz);
          if (w.get(x + dx, g, z + dz) === 0) continue;
          set(x + dx, g, z + dz, (hash2(x + dx, z + dz, 9) < 0.2) ? C.path3 : c);
        }
      }
    }
  }

  /** 台地边缘做石砌驳岸（只改暴露的侧壁颜色） */
  function terraceFace(x, z, y0, y1) {
    if (water(x, z)) return;
    const g = gy(x, z);
    if (g <= y0) return;
    for (let y = Math.min(y1, g); y >= y0; y--) {
      if (w.get(x, y, z) === 0) break;
      set(x, y, z, (y === Math.min(y1, g)) ? C.stoneWarm : (y & 1 ? C.stone : C.stoneDark));
    }
  }

  /** 院墙漏窗：外墙皮在 zOut（墙沿 x 走） */
  function windowX(xc, zOut, y, len = 4, h = 2) {
    const half = Math.floor(len / 2);
    w.clear(xc - half, y, zOut - 1, xc + half, y + h, zOut);
    for (let i = -half; i <= half; i++) {
      for (let j = 0; j <= h; j++) {
        const frame = i === -half || i === half || j === 0 || j === h;
        set(xc + i, y + j, zOut, frame ? C.ink : (((i + j) & 1) ? C.windowGreen : C.windowGlow));
      }
    }
    // 窗下粉墙压边
    for (let i = -half; i <= half; i++) set(xc + i, y - 1, zOut, C.stoneWarm);
  }
  /** 院墙漏窗：外墙皮在 xOut（墙沿 z 走） */
  function windowZ(zc, xOut, y, len = 4, h = 2) {
    const half = Math.floor(len / 2);
    w.clear(xOut, y, zc - half, xOut + 1, y + h, zc + half);
    for (let i = -half; i <= half; i++) {
      for (let j = 0; j <= h; j++) {
        const frame = i === -half || i === half || j === 0 || j === h;
        set(xOut, y + j, zc + i, frame ? C.ink : (((i + j) & 1) ? C.windowGreen : C.windowGlow));
      }
    }
    for (let i = -half; i <= half; i++) set(xOut, y - 1, zc + i, C.stoneWarm);
  }

  // ── 厅堂（自绘屋面，满足卷棚/歇山与檐高尺度）────────────────────────────────
  function buildHall(o) {
    const bays = o.bays ?? 3, bayW = o.bayW ?? 4, depth = o.depth ?? 8;
    const x = o.x, z = o.z, y = o.y;
    const halfW = Math.round((bays * bayW) / 2), halfD = Math.round(depth / 2);
    const plinthH = o.plinthH ?? 1;
    const wallH = o.wallH ?? 4, columnH = o.columnH ?? 4;
    const wallC = o.wallC ?? C.whitewall, colC = o.columns ?? C.redPillar;
    const porch = o.porch ?? 0;
    // 台基 + 踏跺
    H.plinth({
      x, z, w: halfW + 2, d: halfD + 2, y, h: plinthH,
      c: o.plinthC ?? C.stone, top: o.plinthTop ?? C.stoneLight,
      step: o.step ?? Math.min(6, bayW), stepTo: 'south',
    });
    const floorY = y + plinthH;
    const frontZ = z + halfD - 1, backZ = z - halfD + 1;
    const colFrontZ = frontZ - porch;
    // 室内地面
    H.box(x - halfW + 1, floorY - 1, z - halfD + 1, x + halfW - 1, floorY - 1, z + halfD - 1, o.floorC ?? C.stoneWarm);
    // 柱网
    for (let b = 0; b <= bays; b++) {
      const px = x - halfW + Math.round(b * bayW);
      H.column(px, backZ, floorY, columnH, colC);
      H.column(px, colFrontZ, floorY, columnH, colC);
      if (porch > 0) H.column(px, frontZ, floorY, columnH, colC);
    }
    // 山墙（两侧）
    for (let zz = backZ; zz <= frontZ; zz++) {
      for (let yy = floorY; yy < floorY + wallH; yy++) {
        const cc = yy < floorY + 1 ? C.wallBase : wallC;
        set(x - halfW, yy, zz, cc);
        set(x + halfW, yy, zz, cc);
      }
    }
    // 后墙
    for (let xx = x - halfW; xx <= x + halfW; xx++) {
      for (let yy = floorY; yy < floorY + wallH; yy++) set(xx, yy, backZ, yy < floorY + 1 ? C.wallBase : wallC);
    }
    // 前檐：通间（开敞）或隔扇门窗
    if (o.openFront) {
      // 挂落：每间柱间上部一皮雕花
      for (let b = 0; b < bays; b++) {
        const xa = x - halfW + Math.round(b * bayW) + 1, xb = x - halfW + Math.round((b + 1) * bayW) - 1;
        for (let xx = xa; xx <= xb; xx++) {
          set(xx, floorY + wallH - 1, frontZ, ((xx & 1) ? C.windowGreen : C.windowGlow));
        }
      }
      // 后墙侧窗
      for (let b = 0; b < bays; b += 2) {
        const xa = x - halfW + Math.round(b * bayW) + 2;
        H.latticeWindow({ x: xa, y: floorY + 1, z: backZ, axis: 'x', w: Math.max(2, bayW - 3), h: 2, cFrame: C.woodDark, cLattice: C.windowGreen });
      }
    } else {
      for (let xx = x - halfW; xx <= x + halfW; xx++) {
        for (let yy = floorY; yy < floorY + wallH; yy++) {
          const local = xx - (x - halfW);
          if (local % bayW === 0) continue;                            // 柱位
          const bayIdx = Math.min(bays - 1, Math.floor(local / bayW));
          const mid = Math.floor(bays / 2);
          const j = yy - floorY;
          if (bayIdx === mid) continue;                                 // 明间留门
          if (j >= 1 && j <= 2) set(xx, yy, frontZ, ((xx + yy) & 3) === 0 ? C.windowGlow : C.windowGreen);
          else set(xx, yy, frontZ, yy < floorY + 1 ? C.wallBase : wallC);
        }
      }
      const doorW = Math.max(3, bayW - 1);
      H.door({ x: x - Math.floor(doorW / 2), y: floorY, z: frontZ, axis: 'x', w: doorW, h: Math.max(2, wallH - 1), c: o.doorC ?? C.woodRed, studs: bays >= 5 });
      // 两次间槛窗棂格
      for (let d = -1; d <= 1; d += 2) {
        const wx = x + d * bayW - Math.floor((bayW - 2) / 2);
        H.latticeWindow({ x: wx, y: floorY + 1, z: frontZ, axis: 'x', w: bayW - 2, h: 2, cFrame: C.woodDark, cLattice: C.windowGreen });
      }
    }
    // 檐下彩画带
    H.eaveBand({ x1: x - halfW, z1: colFrontZ, x2: x + halfW, z2: backZ, y: floorY + wallH });
    // 屋面
    const roofY = floorY + columnH;
    const rz2 = frontZ + (porch > 0 ? 1 : 0);
    let topY;
    if (o.roof === 'round') {
      topY = roofRound(x - halfW, backZ - 1, x + halfW, rz2, roofY, {
        h: o.roofH ?? 5, overhang: o.overhang ?? 2, overhangX: o.overhangX ?? 0,
        upturn: o.upturn ?? 1, tile: o.tile ?? C.roof,
      });
    } else {
      topY = roofXieshan(x - halfW, backZ - 1, x + halfW, rz2, roofY, {
        h: o.roofH ?? 5, overhang: o.overhang ?? 2, overhangX: o.overhangX ?? 2,
        upturn: o.upturn ?? 2, tile: o.tile ?? C.roof,
      });
    }
    return { x1: x - halfW, x2: x + halfW, z1: backZ, z2: frontZ, colFrontZ, floorY, topY };
  }

  /** 院门/随墙门：门楼小屋顶（卷棚），门柱自动落地 */
  function gateHouse(o) {
    const { x, z, y, width = 8, depth = 5, colH = 5 } = o;
    const halfW = Math.round(width / 2);
    const wallC = o.wallC ?? C.redPillar;
    const zBack = z - Math.floor(depth / 2), zFront = z + Math.ceil(depth / 2);
    // 门柱（落到当地地面，避免悬空）
    for (const sx of [-1, 1]) {
      for (const zz of [zBack, zFront]) {
        const px = x + sx * (halfW - 1);
        const g = gy(px, zz);
        for (let yy = g + 1; yy < y; yy++) set(px, yy, zz, C.stone);
        H.column(px, zz, y, colH, wallC);
      }
    }
    // 额枋（前后两道）
    for (let xx = x - halfW + 1; xx <= x + halfW - 1; xx++) {
      for (const zz of [zBack, zFront]) {
        set(xx, y + colH - 1, zz, C.woodDark);
        set(xx, y + colH - 2, zz, ((xx & 3) === 0) ? C.gold : C.woodDark);
      }
    }
    // 垂莲柱（悬于前檐枋下，垂花意象）
    if (o.hanging) {
      for (const sx of [-1, 1]) {
        const hx = x + sx * 2;
        for (let yy = y + colH - 2; yy >= y + 2; yy--) set(hx, yy, zFront, yy === y + 2 ? C.gold : C.redPillar);
      }
    }
    // 卷棚门顶
    const topY = roofRound(x - halfW, zBack, x + halfW, zFront, y + colH, {
      h: 3, overhang: 2, overhangX: 1, upturn: 2, tile: o.tile ?? C.roof, gableC: C.woodDark,
    });
    if (o.plaque) {
      H.plaque({ x, y: y + colH - 3, z: zFront + 1, dir: 'south', text: o.plaque, w: Math.min(7, width - 1), h: 2 });
    }
    return { topY };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // A. 怡红院（x36–82, z12–54, 台地 elev 4） 核心院落，富丽
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const E = 4;                     // 台地顶层 y
    const Y = E + 1;                 // 建筑/院墙 y
    // ── 院墙（粉垣环护）：x36..81 / z12..53，th=2 ────────────────────────────
    H.wallRect({ x1: 36, z1: 12, x2: 81, z2: 53, y: Y, h: 5, th: 2, c: C.whitewall, cap: C.roof });
    // 南面垂花门（明间开门洞）
    w.clear(56, Y, 52, 62, Y + 6, 54);
    // 西墙月洞门（竹篱花障编就 → 粉垣月洞）
    H.moonGate({ x: 36, z: 50, axis: 'z', y: Y, r: 2, th: 1 });
    // 东角门（通往秋爽斋的园径）
    w.clear(80, Y, 24, 83, Y + 6, 29);
    // 北后角门（通往北面石径）
    w.clear(39, Y, 11, 43, Y + 6, 14);
    // 月洞门外的石板台阶（台地降一级）
    for (let zz = 46; zz <= 54; zz++) for (let xx = 34; xx <= 35; xx++) if (!water(xx, zz)) set(xx, 4, zz, C.stoneLight);
    // 院墙漏窗（南墙、西墙）
    windowX(44, 54, Y + 1, 3, 2);
    windowX(74, 54, Y + 1, 3, 2);
    windowZ(20, 36, Y + 1, 3, 2);
    windowZ(34, 36, Y + 1, 3, 2);
    // 南门外台阶（台地降一级）
    for (let xx = 54; xx <= 64; xx++) set(xx, 4, 55, C.stoneWarm);
    // 南垂花门门楼
    gateHouse({ x: 59, z: 53, y: Y, width: 10, depth: 5, colH: 5, hanging: true, plaque: '怡紅院' });
    // 门楼两侧红灯
    H.lantern({ x: 53, y: Y + 2, z: 55, red: true });
    H.lantern({ x: 65, y: Y + 2, z: 55, red: true });
    // 东角门门楼（小而简）
    gateHouse({ x: 81, z: 26, y: Y, width: 6, depth: 5, colH: 4 });
    // 北后角门门罩（在墙帽之上）
    for (let xx = 38; xx <= 44; xx++) { set(xx, Y + 6, 11, C.roofEdge); set(xx, Y + 6, 14, C.roofEdge); }
    for (let zz = 11; zz <= 14; zz++) { set(38, Y + 6, zz, C.roofEdge); set(44, Y + 6, zz, C.roofEdge); }
    for (let xx = 39; xx <= 43; xx++) for (let zz = 12; zz <= 13; zz++) set(xx, Y + 7, zz, C.roofDark);
    H.door({ x: 40, y: Y, z: 14, axis: 'x', w: 3, h: 4, c: C.woodDark });

    // ── 正房五间（歇山，灰瓦红柱白墙）x=59,z=26 ──────────────────────────────
    const hall = buildHall({
      x: 59, z: 26, y: Y, bays: 5, bayW: 4, depth: 11,
      wallH: 4, columnH: 4, roof: 'xieshan', tile: C.roof, roofH: 5,
      overhang: 3, overhangX: 3, upturn: 2,
      wallC: C.whitewall, columns: C.redPillar, plinthC: C.stone, plinthTop: C.stoneLight,
      plaque: '怡紅快綠',
    });
    // 匾（檐下金匾）
    H.plaque({ x: 59, y: hall.floorY + 3, z: hall.z2 + 1, dir: 'south', text: '怡紅快綠', w: 7, h: 2, boardColor: C.plaqueBoard, textColor: C.goldText });
    // 室内玻璃镜意象（背屏）：浅蓝玻璃 + 墨框
    for (let xx = 54; xx <= 64; xx++) for (let yy = hall.floorY; yy < hall.floorY + 3; yy++) {
      set(xx, yy, hall.z1 + 1, (xx === 54 || xx === 64 || yy === hall.floorY) ? C.ink : C.stoneBlue);
    }
    for (let xx = 55; xx <= 63; xx += 2) set(xx, hall.floorY + 1, hall.z1 + 1, C.paper);
    // 门前月台铺石
    pave(50, 34, 68, 39, E, C.stoneLight, C.stone, C.stoneWarm);
    // 明间甬路（南门 → 阶下）
    pave(56, 36, 62, 52, E, C.path2, C.path3, C.stoneWarm);
    // 西侧横向甬路（月洞门 → 甬路）
    pave(38, 48, 56, 51, E, C.path2, C.path3, C.stoneWarm);

    // ── 抄手游廊（沿院墙两侧，连接垂花门与正房）──────────────────────────────
    H.corridor({ pts: [[56, 50], [44, 50], [44, 46], [40, 46], [40, 37]], y: E, w: 3, roofC: C.roof, columnsC: C.greenPillar });
    H.corridor({ pts: [[62, 50], [74, 50], [74, 46], [78, 46], [78, 37]], y: E, w: 3, roofC: C.roof, columnsC: C.greenPillar });

    // ── 后院：井、石桌、蔷薇架（院中满架蔷薇）────────────────────────────────
    // 土井（石井栏 + 辘轳）
    for (let xx = 41; xx <= 45; xx++) for (let zz = 14; zz <= 16; zz++) {
      set(xx, Y, zz, C.stoneWarm);
      set(xx, Y + 1, zz, (xx === 41 || xx === 45 || zz === 14 || zz === 16) ? C.stone : C.waterBed);
    }
    set(43, Y + 2, 14, C.wood); set(43, Y + 3, 14, C.wood); set(43, Y + 4, 14, C.woodDark);
    for (let xx = 42; xx <= 44; xx++) set(xx, Y + 4, 14, C.woodDark);
    set(43, Y + 2, 13, C.bronze);
    // 后院石桌
    H.tableSet({ x: 76, z: 16, y: Y, size: 2 });
    // 后院蔷薇架
    F.vine({ x1: 48, z1: 14, x2: 72, z2: 16, y: Y + 3, topC: [C.crabapple, C.peony2], leafC: C.leafLight });
    // 西侧院内蔷薇架（满架蔷薇意象）
    F.vine({ x1: 39, z1: 22, x2: 45, z2: 30, y: Y + 3, topC: [C.peony2, C.crabapple], leafC: C.leaf });
    // 玻璃镜屏（院中陈设，C.stoneBlue + C.ink 小面积点缀）
    for (let xx = 72; xx <= 76; xx++) {
      for (let yy = Y; yy <= Y + 4; yy++) {
        let c = C.stoneBlue;
        if (yy === Y || yy === Y + 4 || xx === 72 || xx === 76) c = C.ink;
        if ((xx === 73 || xx === 75) && (yy === Y + 2)) c = C.goldDark;
        set(xx, yy, 37, c);
      }
    }
    set(74, Y + 5, 37, C.roof);
    // ── 院中山石、花木（西府海棠 + 芭蕉数本）─────────────────────────────────
    H.rock({ x: 45, z: 38, size: 3, h: 3 });
    H.rock({ x: 65, z: 48, size: 3, h: 4 });
    H.rock({ x: 78, z: 35, size: 2, h: 3 });
    H.rock({ x: 47, z: 49, size: 2, h: 2 });
    F.rockCluster(53, 46, { w: 3, h: 3, seed: 31 });
    F.rockCluster(46, 36, { w: 2, h: 2, seed: 12 });
    // 西府海棠（移栽院西近墙，冠幅收小，不压中轴）
    F.crabapple(45, 43, { h: 8, r: 3.4 });
    // 芭蕉数本（东侧，低矮不遮檐）
    F.banana(67, 45, { h: 5 });
    F.banana(72, 47, { h: 5 });
    F.banana(76, 49, { h: 5 });
    // 院内灌木/苔（少量，避免杂乱）
    F.shrub(43, 32, { r: 2, c: [C.leaf, C.leafLight] });
    F.shrub(77, 43, { r: 2.5, c: [C.leafLight, C.leaf] });
    F.moss(42, 20, 48, 34);
    F.moss(70, 40, 79, 51);
    // ── 院外花木：绿柳周垂、碧桃绕门 ─────────────────────────────────────────
    for (const [tx, tz] of [[31, 22], [31, 38], [86, 20], [86, 38]]) {
      if (!water(tx, tz)) F.willow(tx, tz, { h: 13 + Math.floor(rnd() * 2) });
    }
    F.peach(29, 45);
    F.peach(36, 58, { h: 8 });
    F.peach(82, 58, { h: 8 });
    F.plum(30, 56, { red: false, h: 7, r: 2.6 });
    F.banana(84, 25, {});
    F.shrub(44, 66, { r: 2 });
    F.shrub(76, 63, { r: 2 });
    // 竹篱花障（院外小园：绕碧桃、穿竹篱之意）
    H.fence({ pts: [[45, 57], [38, 60], [33, 57]], w: 1, h: 3, c: C.bambooStalk });
    H.fence({ pts: [[73, 57], [80, 60], [86, 56]], w: 1, h: 3, c: C.bambooStalk });
    // 院外曲径（南门 → 西南接园路）
    trail([[59, 55], [55, 60], [47, 62], [40, 58], [35, 52]], 3);
    trail([[59, 55], [65, 59], [74, 59], [82, 51]], 3);
    // 外园叠石点缀
    H.rock({ x: 34, z: 24, size: 3, h: 4 });
    H.rock({ x: 88, z: 38, size: 2, h: 3 });
    H.rock({ x: 40, z: 64, size: 2, h: 3 });
    H.rock({ x: 78, z: 63, size: 2, h: 2 });
    F.rockCluster(66, 38, { w: 2, h: 2, seed: 19 });
    F.moss(46, 56, 72, 68);
    // 登记保留区（院墙外扩 2 格，含游廊、甬路与外园）
    ctx.reserve(30, 8, 92, 68);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // B. 秋爽斋 · 晓翠堂（x72–112, z-48–-4, 台地 elev 5）阔朗大院
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const E = 5, Y = E + 1;
    // ── 院墙：x72..111 / z-47..-5 ────────────────────────────────────────────
    H.wallRect({ x1: 72, z1: -47, x2: 111, z2: -5, y: Y, h: 5, th: 2, c: C.whitewall, cap: C.roof });
    // 南门（正门）
    w.clear(92, Y, -7, 100, Y + 6, -4);
    // 北后门（通往暖香坞）
    w.clear(84, Y, -48, 88, Y + 6, -45);
    // 南门外台阶（台地降两级）
    for (let xx = 92; xx <= 100; xx++) { set(xx, 4, -3, C.stoneWarm); }
    // 南门门楼（垂花门，体量收小以免遮挡正房）
    gateHouse({ x: 96, z: -5, y: Y, width: 10, depth: 4, colH: 4, hanging: true, plaque: '秋爽齋' });
    H.lantern({ x: 90, y: Y + 2, z: -3, red: true });
    H.lantern({ x: 102, y: Y + 2, z: -3, red: true });
    // 院墙漏窗
    windowX(80, -4, Y + 1, 3, 2);
    windowX(106, -4, Y + 1, 3, 2);
    windowZ(-38, 72, Y + 1, 3, 2);
    windowZ(-14, 72, Y + 1, 3, 2);

    // ── 正房三间通间（卷棚，前出廊，室内不隔断）x=94,z=-33 ───────────────────
    const hall = buildHall({
      x: 94, z: -33, y: Y, bays: 3, bayW: 5, depth: 10,
      wallH: 4, columnH: 4, roof: 'round', tile: C.roof, roofH: 6,
      overhang: 3, upturn: 2,
      openFront: true, porch: 3,
      wallC: C.whitewall, columns: C.redPillar,
      plinthC: C.stone, plinthTop: C.stoneLight,
    });
    // 室内陈设：花梨大理石大案、书架、佛手盘、比目磬（通间可见）
    const fy = hall.floorY;
    H.box(94 - 4, fy, -38 + 2, 94 + 4, fy, -38 + 3, C.woodDark);
    H.box(94 - 4, fy + 1, -38 + 2, 94 + 4, fy + 1, -38 + 3, C.marbleShade);
    H.box(94 - 5, fy, -38 + 2, 94 - 5, fy + 2, -38 + 2, C.wood);
    H.box(94 + 5, fy, -38 + 2, 94 + 5, fy + 2, -38 + 2, C.wood);
    for (let k = 0; k < 3; k++) {
      const bx = 94 - 7 + k * 2;
      H.box(bx, fy, -38 + 1, bx + 1, fy + 3, -38 + 1, k % 2 ? C.woodDark : C.wood);
      H.box(bx, fy + 3, -38 + 1, bx + 1, fy + 3, -38 + 1, C.ink);
    }
    // 佛手盘（金）、比目磬（青玉）
    H.box(94 + 4, fy, -37, 94 + 5, fy, -37, C.wood);
    set(94 + 4, fy + 1, -37, C.gold);
    set(95, fy + 1, -37, C.chrys);
    set(94 - 4, fy + 1, -37, C.teal);
    set(94 - 5, fy + 1, -37, C.bronzeDark);
    // 匾「曉翠堂」与颜鲁公联
    H.plaque({ x: 94, y: fy + 3, z: hall.colFrontZ + 1, dir: 'south', text: '曉翠堂', w: 7, h: 2, boardColor: C.plaqueBoard, textColor: C.goldText });
    H.couplet({ x: 94 - 7, y: fy, z: hall.colFrontZ + 1, dir: 'south', text: '煙霞閑骨格', w: 1, h: 4.6 });
    H.couplet({ x: 94 + 7, y: fy, z: hall.colFrontZ + 1, dir: 'south', text: '泉石野生涯', w: 1, h: 4.6 });
    // 前廊柱间挂落（卷棚出廊）
    for (let xx = 94 - 7; xx <= 94 + 7; xx++) {
      if (xx === 94 - 7 || xx === 94 + 7) continue;
      if ((xx - (94 - 7)) % 5 === 0) continue;
      set(xx, fy + 3, hall.colFrontZ, ((xx & 1) ? C.windowGreen : C.windowGlow));
    }
    // ── 阔朗大院：全院石板铺地 ────────────────────────────────────────────────
    pave(74, -23, 110, -6, E, C.path2, C.path3, C.stoneWarm, { overwritePath: true });
    pave(78, -45, 108, -24, E, C.path2, C.path3, C.stoneWarm, { overwritePath: true });
    // 中轴甬路（南门 → 阶前）
    pave(92, -23, 100, -6, E, C.stoneLight, C.stoneWarm, C.stone, { overwritePath: true });
    // 院中石桌石凳
    H.tableSet({ x: 94, z: -14, y: E, size: 3 });
    H.tableSet({ x: 78, z: -12, y: E, size: 2 });
    // 后廊（后檐廊）+ 三株梧桐（后廊檐下，控制体量）
    H.corridor({ pts: [[84, -43], [104, -43]], y: E, w: 3, roofC: C.roof, columnsC: C.greenPillar });
    F.wutong(82, -45, { h: 9, r: 2.5 });
    F.wutong(94, -45, { h: 9, r: 2.6 });
    F.wutong(106, -45, { h: 9, r: 2.5 });
    // 芭蕉二本（院东西两侧，低矮）
    F.banana(80, -20, { h: 5 });
    F.banana(108, -18, { h: 5 });
    // 山石点缀
    H.rock({ x: 77, z: -9, size: 3, h: 4 });
    H.rock({ x: 107, z: -8, size: 3, h: 3 });
    F.rockCluster(76, -27, { w: 3, h: 3, seed: 41 });
    H.rock({ x: 108, z: -28, size: 2, h: 2 });
    // 院外：白梅、竹、山石
    F.plum(114, -8, { red: false, h: 8 });
    F.plum(114, -30, { red: false, h: 8 });
    F.bamboo(68, -30, { count: 8, h: 11 });
    F.bamboo(68, -14, { count: 7, h: 10 });
    F.bamboo(66, 2, { count: 6, h: 9 });
    F.pine(116, -20, { h: 13 });
    F.pine(116, -36, { h: 12 });
    H.rock({ x: 68, z: -40, size: 3, h: 4 });
    terraceFace(72, -30, 3, E);
    ctx.reserve(68, -50, 114, 4);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // C. 蓼风轩 · 暖香坞（x42–80, z-96–-62, 台地 elev 6）依山小院 · 夹道拾级
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const E = 6, Y = E + 1;
    // ── 院墙：x45..69 / z-84..-63 ────────────────────────────────────────────
    H.wallRect({ x1: 45, z1: -84, x2: 69, z2: -63, y: Y, h: 5, th: 2, c: C.whitewall, cap: C.roof });
    // 东门（正门，接秋爽斋来径）
    w.clear(67, Y, -76, 70, Y + 6, -72);
    // 西门（夹道出口，通藕香榭方向）
    w.clear(44, Y, -72, 47, Y + 6, -68);
    // 南面月洞门（观赏入口，接南缘石阶）
    H.moonGate({ x: 56, z: -63, axis: 'x', y: Y, r: 2, th: 1 });
    // 院墙漏窗
    windowX(50, -62, Y + 1, 3, 2);
    windowX(63, -62, Y + 1, 3, 2);
    windowZ(-79, 45, Y + 1, 3, 2);
    windowZ(-66, 45, Y + 1, 3, 2);
    // 东门门罩（随墙门：瓦顶小披檐 + 门匾）
    for (let xx = 66; xx <= 71; xx++) { set(xx, Y + 4, -77, C.roofEdge); set(xx, Y + 4, -71, C.roofEdge); }
    for (let zz = -77; zz <= -71; zz++) { set(66, Y + 4, zz, C.roofEdge); set(71, Y + 4, zz, C.roofEdge); }
    for (let zz = -76; zz <= -72; zz++) for (let xx = 66; xx <= 71; xx++) set(xx, Y + 5, zz, ((xx + zz) & 1) ? C.roof : C.roofDark);
    for (let zz = -75; zz <= -73; zz++) set(68, Y + 6, zz, C.ridge);
    H.plaque({ x: 72, y: Y + 2, z: -74, dir: 'east', text: '蓼風軒', w: 5, h: 2, boardColor: C.plaqueBoard, textColor: C.goldText });
    H.lantern({ x: 72, y: Y + 2, z: -77, red: true });
    H.lantern({ x: 72, y: Y + 2, z: -71, red: true });
    // 西门门罩
    for (let xx = 44; xx <= 47; xx++) { set(xx, Y + 4, -73, C.roofEdge); set(xx, Y + 4, -67, C.roofEdge); }
    for (let zz = -73; zz <= -67; zz++) { set(44, Y + 4, zz, C.roofEdge); set(47, Y + 4, zz, C.roofEdge); }
    for (let xx = 44; xx <= 47; xx++) for (let zz = -72; zz <= -68; zz++) set(xx, Y + 5, zz, ((xx + zz) & 1) ? C.roof : C.roofDark);

    // ── 正房三间（卷棚，前出廊）x=55,z=-77 ──────────────────────────────────
    const hall = buildHall({
      x: 55, z: -77, y: Y, bays: 3, bayW: 4, depth: 6,
      wallH: 4, columnH: 4, roof: 'round', tile: C.roof, roofH: 4,
      overhang: 2, upturn: 2, porch: 0, wallC: C.whitewall, columns: C.redPillar,
      plinthC: C.stone, plinthTop: C.stoneLight,
    });
    H.plaque({ x: 55, y: hall.floorY + 3, z: hall.z2 + 1, dir: 'south', text: '蓼風軒', w: 6, h: 2, boardColor: C.plaqueBoard, textColor: C.goldText });
    // ── 暖香坞（东侧卧房之门斗，题匾）───────────────────────────────────────
    {
      // 门斗：贴正房东端前廊，门朝南；台基与正房台基同高（y=Y 一层）
      H.box(61, Y, -72, 67, Y, -69, C.stone);
      H.box(61, Y, -70, 67, Y, -69, C.stoneLight);
      // 台基外沿
      for (let xx = 61; xx <= 67; xx++) set(xx, Y, -68, C.stoneWarm);
      // 山墙（东西）与后墙
      for (const xx of [61, 67]) {
        for (let zz = -72; zz <= -69; zz++) {
          for (let yy = Y + 1; yy <= Y + 3; yy++) set(xx, yy, zz, C.whitewall);
        }
      }
      for (let xx = 61; xx <= 67; xx++) for (let yy = Y + 1; yy <= Y + 3; yy++) set(xx, yy, -72, C.whitewall);
      // 前檐：门洞 + 两侧槛窗
      for (let xx = 61; xx <= 67; xx++) {
        for (let yy = Y + 1; yy <= Y + 3; yy++) {
          if (xx >= 63 && xx <= 65) continue;
          set(xx, yy, -69, yy === Y + 1 ? C.wallBase : (((xx + yy) & 1) ? C.windowGreen : C.windowGlow));
        }
      }
      for (let xx = 63; xx <= 65; xx++) for (let yy = Y + 1; yy <= Y + 3; yy++) set(xx, yy, -69, 0);
      H.door({ x: 63, y: Y + 1, z: -69, axis: 'x', w: 3, h: 3, c: C.woodRed });
      // 门斗屋顶（小卷棚，略低于正房）
      roofRound(61, -72, 67, -69, Y + 4, { h: 2, overhang: 1, upturn: 1, tile: C.roof });
      // 「暖香塢」匾（门斗门楣上，朝南）
      H.plaque({ x: 64, y: Y + 2, z: -68, dir: 'south', text: '暖香塢', w: 5, h: 2, boardColor: C.plaqueBoard, textColor: C.goldText });
      // 门斗与正房之间的连廊小段（石阶）
      for (let xx = 61; xx <= 67; xx++) set(xx, Y, -71, C.path2);
      H.lantern({ x: 61, y: Y + 1, z: -68, red: false });
    }
    // ── 铺地：院内石板 + 甬路 ────────────────────────────────────────────────
    pave(47, -69, 67, -64, E, C.path2, C.path3, C.stoneWarm, { overwritePath: true });
    pave(64, -82, 67, -70, E, C.path2, C.path3, C.stoneWarm, { overwritePath: true });
    pave(47, -71, 67, -69, E, C.stoneLight, C.stone, C.stoneWarm, { overwritePath: true });
    // ── 曲折游廊（沿南墙 → 西墙，接夹道西门）────────────────────────────────
    H.corridor({ pts: [[65, -66], [49, -66], [49, -70]], y: E, w: 3, roofC: C.roof, columnsC: C.greenPillar });
    H.corridor({ pts: [[65, -66], [65, -70]], y: E, w: 3, roofC: C.roof, columnsC: C.greenPillar });
    // ── 夹道·石阶（台地降三级，引向西南藕香榭方向）───────────────────────────
    // 西墙外平台（x42..44 仍在台地上）
    for (let zz = -73; zz <= -67; zz++) for (let xx = 42; xx <= 44; xx++) if (!water(xx, zz)) set(xx, E, zz, C.path2);
    // 台阶：x44(台地 面7) → x43(面6) → x42(面5) → x41(地面 面4)
    for (let zz = -73; zz <= -67; zz++) {
      set(43, 6, zz, 0); set(43, 5, zz, C.stoneLight);
      set(42, 6, zz, 0); set(42, 5, zz, 0); set(42, 4, zz, C.stoneLight);
    }
    // 夹道石板小径（出西门折向西南，只做园内段）
    trail([[41, -70], [38, -68], [35, -65], [31, -63]], 3);
    // ── 台地驳岸：西、南两面石砌 ──────────────────────────────────────────────
    for (let zz = -86; zz <= -62; zz++) { terraceFace(42, zz, 4, E); }
    for (let xx = 42; xx <= 69; xx++) { terraceFace(xx, -62, 4, E); }
    // 南缘石阶（月洞门外，台地降三级）
    for (let xx = 52; xx <= 60; xx++) { set(xx, 4, -61, C.stone); set(xx, 5, -61, C.stoneLight); }
    for (let xx = 52; xx <= 60; xx++) set(xx, 4, -60, C.stoneLight);
    H.rock({ x: 48, z: -59, size: 2, h: 3 });
    H.rock({ x: 64, z: -59, size: 2, h: 2 });
    // ── 花木：竹、梅、松（周围；院内只留低矮点缀）────────────────────────────
    F.bamboo(66, -80, { count: 5, h: 8, spread: 2 });
    F.bamboo(39, -80, { count: 8, h: 10 });
    F.bamboo(37, -70, { count: 7, h: 9 });
    F.bamboo(38, -58, { count: 6, h: 9 });
    F.plum(34, -64, { red: false, h: 8 });
    F.plum(31, -74, { red: false, h: 7 });
    F.plum(66, -58, { red: false, h: 8 });
    F.pine(34, -86, { h: 12 });
    F.pine(30, -68, { h: 11 });
    F.pine(73, -80, { h: 11 });
    F.shrub(31, -56, { r: 2 });
    F.shrub(42, -60, { r: 1.5 });
    // 院内点缀：芭蕉一本（低矮）+ 山石
    F.banana(48, -68, { h: 5 });
    F.shrub(60, -66, { r: 1.5 });
    H.rock({ x: 66, z: -66, size: 2, h: 3 });
    H.rock({ x: 46, z: -65, size: 2, h: 2 });
    F.rockCluster(43, -74, { w: 2, h: 2, seed: 53 });
    F.moss(47, -69, 60, -64);
    // 夹道端石景
    H.rock({ x: 32, z: -62, size: 3, h: 4 });
    F.rockCluster(30, -70, { w: 2, h: 2, seed: 57 });
    ctx.reserve(24, -92, 78, -50);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // D. 滴翠亭（x-38–-18, z6–26）：跨水石台 + 攒尖方亭，三面槅子、东面门
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const cx = -25, cz = 13;
    // ── 石台（架于水上：石柱从水底起）────────────────────────────────────────
    const x1 = cx - 6, x2 = cx + 6, z1 = cz - 6, z2 = cz + 6;   // 13×13
    // 水中石柱（y=1 河床 → 3 台面下）
    for (let px = x1 + 1; px <= x2 - 1; px += 3) {
      for (let pz = z1 + 1; pz <= z2 - 1; pz += 3) {
        if (!water(px, pz)) continue;
        for (let yy = 1; yy <= 3; yy++) set(px, yy, pz, yy === 1 ? C.stoneDark : C.stone);
      }
    }
    // 台面（y=4，高出水面一层），外圈石枋
    for (let xx = x1; xx <= x2; xx++) for (let zz = z1; zz <= z2; zz++) {
      const edge = xx === x1 || xx === x2 || zz === z1 || zz === z2;
      set(xx, 4, zz, edge ? C.stoneWarm : (((xx + zz) % 9 === 0) ? C.stone : C.stoneLight));
      if (edge) set(xx, 3, zz, C.stoneDark);
    }
    // 西侧石板桥接岸（H.bridge）
    H.bridge({ x: -34, z: cz, len: 7, wid: 4, dir: 'x', type: 'stone1', y: 4, rail: null });
    // 东侧踏跺（东面为门，接东岸）
    for (let zz = cz - 2; zz <= cz + 2; zz++) {
      set(x2 + 1, 3, zz, C.stoneWarm);
      set(x2 + 2, 3, zz, C.stoneLight);
    }
    // ── 亭身：8×8 四柱（近 size10 亭式）+ 四面游廊（台深 2）──────────────────
    const hh = 4;                      // 亭柱半距
    const colY = 5, colH = 4;
    const eaveY = colY + colH;         // 9
    const cols = [[cx - hh, cz - hh], [cx + hh, cz - hh], [cx - hh, cz + hh], [cx + hh, cz + hh]];
    for (const [px, pz] of cols) H.column(px, pz, colY, colH, C.redPillar);
    // 四面阑额（檐下）
    for (let xx = cx - hh; xx <= cx + hh; xx++) {
      for (const zz of [cz - hh, cz + hh]) set(xx, eaveY - 1, zz, C.woodDark);
    }
    for (let zz = cz - hh; zz <= cz + hh; zz++) {
      for (const xx of [cx - hh, cx + hh]) set(xx, eaveY - 1, zz, C.woodDark);
    }
    // 槅子（北/西/南三面：下槛 + 雕镂棂格 + 糊纸透光）
    const panel = (x1p, z1p, x2p, z2p) => {
      const alongX = x1p !== x2p;
      const n = Math.abs(alongX ? x2p - x1p : z2p - z1p);
      for (let i = 1; i <= n - 1; i++) {
        const x = alongX ? x1p + i : x1p;
        const z = alongX ? z1p : z1p + i;
        for (let yy = colY + 1; yy <= colY + 2; yy++) {
          const frame = (i === 1 || i === n - 1 || yy === colY + 1);
          set(x, yy, z, frame ? C.latticeDark : (((i + yy) & 1) ? C.windowGreen : C.windowGlow));
        }
      }
    };
    panel(cx - hh, cz - hh, cx + hh, cz - hh);       // 北
    panel(cx - hh, cz - hh, cx - hh, cz + hh);       // 西
    panel(cx - hh, cz + hh, cx + hh, cz + hh);       // 南
    // 四面游廊：外圈柱 + 通透矮栏（美人靠）+ 檐下挂落
    const rx1 = x1 + 1, rx2 = x2 - 1, rz1 = z1 + 1, rz2 = z2 - 1;
    for (const [px, pz] of [[rx1, rz1], [rx2, rz1], [rx1, rz2], [rx2, rz2], [cx, rz1], [cx, rz2], [rx1, cz]]) {
      H.column(px, pz, colY, colH, C.redPillar);
    }
    // 外缘挂落（在檐下）
    for (let xx = rx1; xx <= rx2; xx++) {
      set(xx, eaveY - 2, rz1, ((xx & 1) ? C.windowGreen : C.windowGlow));
      set(xx, eaveY - 2, rz2, ((xx & 1) ? C.windowGreen : C.windowGlow));
    }
    for (let zz = rz1; zz <= rz2; zz++) {
      set(rx1, eaveY - 2, zz, ((zz & 1) ? C.windowGreen : C.windowGlow));
      if (zz < cz - 2 || zz > cz + 2) set(rx2, eaveY - 2, zz, ((zz & 1) ? C.windowGreen : C.windowGlow));
    }
    // 矮栏（扶手 + 立柱，透空不挡槅子）
    const railRun = (ax, az, bx, bz) => {
      const alongX = ax !== bx;
      const n = Math.abs(alongX ? bx - ax : bz - az);
      for (let i = 0; i <= n; i++) {
        const x = alongX ? ax + i : ax;
        const z = alongX ? az : az + i;
        set(x, colY, z, (i % 3 === 0) ? C.redPillar : C.wood);
      }
    };
    railRun(rx1, rz1, rx2, rz1);
    railRun(rx1, rz2, rx2, rz2);
    railRun(rx1, rz1, rx1, rz2);
    // 东面门两侧短栏
    for (const zz of [cz - 3, cz + 3]) { set(rx2, colY, zz, C.redPillar); set(rx2, colY + 1, zz, C.redRail); }
    // ── 攒尖顶（绿琉璃 + 宝顶，大出檐覆四面游廊）──────────────────────────────
    roofPyramid(cx, cz, 6, eaveY, {
      h: 4, upturn: 2, tile: C.glazeGreen, tileDark: C.pineDark,
      tileLight: C.glazeGreenLight, edge: C.glazeGreenLight, ridge: C.greenPillar, finial: C.gold,
    });
    // 匾「滴翠亭」（南面朝园路，另于东门上方题小匾）
    H.plaque({ x: cx, y: eaveY - 3, z: cz + hh + 1, dir: 'south', text: '滴翠亭', w: 6, h: 2, boardColor: C.plaqueBoard, textColor: C.goldText });
    H.plaque({ x: -18, y: eaveY - 3, z: cz, dir: 'east', text: '滴翠亭', w: 5, h: 2, boardColor: C.plaqueBoard, textColor: C.goldText });
    // ── 亭周荷叶、岸上垂柳与山石（亭周 4 格内清空树石，留出桥/踏步视线）──────
    F.lotus(cx, 2, 8, 3, { count: 20, flowers: 2 });
    F.lotus(cx + 1, 24, 8, 3, { count: 18, flowers: 2 });
    F.lotus(-33, 12, 2, 3, { count: 6, flowers: 1 });
    // 岸柳退至亭周 5 格以外
    for (const [tx, tz] of [[-38, 24], [-13, 27]]) {
      if (!water(tx, tz)) F.willow(tx, tz, { h: 10 + Math.floor(rnd() * 2) });
    }
    F.peach(-39, 36, { h: 8 });
    F.plum(-38, 32, { red: false, h: 7, r: 2.4 });
    F.shrub(-14, 32, { r: 2 });
    F.shrub(-39, 28, { r: 1.5 });
    H.rock({ x: -36, z: 6, size: 2, h: 3 });
    H.rock({ x: -37, z: 25, size: 2, h: 3 });
    H.rock({ x: -14, z: 10, size: 2, h: 2 });
    F.rockCluster(-36, 22, { w: 2, h: 3, seed: 61 });
    F.moss(-38, 6, -33, 24);
    F.shrub(-34, 48, { r: 2 });
    F.shrub(-8, 46, { r: 2 });
    F.shrub(-14, 40, { r: 1.5 });
    ctx.reserve(-42, 2, -6, 58);
  }
}
