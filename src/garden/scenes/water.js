// ─────────────────────────────────────────────────────────────────────────────
// 水系洲渚：藕香榭（池中水榭）· 紫菱洲/缀锦楼 · 荇叶渚（码头·棠木舫）· 诸桥 · 水面点缀
// 由 arch-water 实现。水面由 terrain.js 依 layout.PONDS/STREAMS 生成，本文件只做体素修饰：
//   · 建筑/平台一律从水底(y=1)或岸顶起石柱/石矶，不悬空；
//   · 桥均以体素桥台/石矶或真实岸线收头（锚点微调见交付说明）。
// 坐标依据：layout.js（PONDS / STREAMS / BRIDGES / ZONES / POIS）。
// ─────────────────────────────────────────────────────────────────────────────
import { C } from '../../core/palette.js';

export function buildWater(ctx) {
  const { w, H, F, L, R } = ctx;
  const isW = (x, z) => !!(ctx.isWater && ctx.isWater(x, z));
  const gy = (x, z) => Math.round((ctx.groundTop || ctx.groundY)(x, z));
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const chance = (p) => R() < p;
  const pick = (arr) => arr[Math.floor(R() * arr.length) % arr.length];
  const hash = (x, z, s = 0) => {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177) ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  };
  const set = (x, y, z, c) => w.set(x, y, z, c);
  const put = (x, y, z, c) => w.setIfEmpty(x, y, z, c);
  const fill = (x1, y1, z1, x2, y2, z2, c) => w.fill(x1, y1, z1, x2, y2, z2, c);
  const ring = (x1, z1, x2, z2, y, c) => H.rectRing(x1, z1, x2, z2, y, c);
  const eaveBand = (x1, z1, x2, z2, y) => H.eaveBand({ x1, z1, x2, z2, y });
  const nearWater = (x, z, r = 1) => {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dz === 0) continue;
      if (isW(x + dx, z + dz)) return true;
    }
    return false;
  };
  const rockC = () => pick([C.rock, C.rockDark, C.stone, C.rockDark]);
  const rockTopC = () => pick([C.mossRock, C.rock, C.rockDark]);
  const wetRockC = () => pick([C.rockDark, C.stoneDark, C.rock, C.mossRock]);

  // ── 通用：竹桥面重铺（H.bridge 的竹桥面是「竹色/石色」交替，这里统一成竹色+朱栏）──
  function bambooDeck(x, z, len, wid, dir, y) {
    const halfLen = Math.floor(len / 2), halfWid = Math.floor(wid / 2);
    const dirX = dir === 'x';
    for (let i = -halfLen; i <= halfLen; i++) {
      const t = i / halfLen, lift = Math.round((1 - t * t) * 1), yy = y + lift;
      for (let j = -halfWid; j <= halfWid; j++) {
        const px = dirX ? x + i : x + j, pz = dirX ? z + j : z + i;
        set(px, yy, pz, ((i + j) & 1) === 0 ? C.bambooStalk : C.bambooNode);
        if (Math.abs(j) === halfWid) {
          if (i % 3 === 0) {
            set(px, yy + 1, pz, C.woodDark);
            set(px, yy + 2, pz, C.woodDark);
            set(px, yy + 3, pz, C.redRail);
          } else {
            set(px, yy + 1, pz, C.woodDark);
            set(px, yy + 3, pz, C.redRail);
          }
        }
      }
    }
  }

  // ── 通用：山石（水陆自适应落脚，绝无悬空）────────────────────────────────────
  // 陆地：自地表起；水中：自河床 y=1 起（石矶/驳岸出水，顶面略高出水面 3.35）
  function rockCluster(cx, cz, size = 2, hgt = 2) {
    const n = Math.max(4, size * 4);
    for (let i = 0; i < n; i++) {
      const dx = ri(-size, size), dz = ri(-size, size);
      if (Math.abs(dx) + Math.abs(dz) > size * 1.6) continue;
      const px = cx + dx, pz = cz + dz;
      if (Math.abs(px) > 150 || Math.abs(pz) > 150) continue;
      const water = isW(px, pz);
      if (water && chance(0.35)) continue;
      const base = water ? 1 : gy(px, pz) + 1;
      // 水中石矶顶到 y=4（水面 3.35 之上露出一线），陆上 1–3 层
      const hh = water ? 2 + Math.floor(R() * Math.max(1, hgt)) : 1 + Math.floor(R() * hgt);
      for (let k = 0; k < hh; k++) {
        if (water) put(px, base + k, pz, k === hh - 1 ? (chance(0.35) ? C.mossRock : wetRockC()) : wetRockC());
        else put(px, base + k, pz, k === hh - 1 ? rockTopC() : rockC());
      }
    }
  }
  // 沿水岸收边（山石/石矶）
  function borderRocks(x1, z1, x2, z2, density = 0.5, size = 1) {
    for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
      if (isW(x, z)) continue;
      if (!nearWater(x, z, 1)) continue;
      if (hash(x, z, 41) > density) continue;
      rockCluster(x, z, size, 2);
    }
  }

  // ── 通用：通透栏杆（望柱每 3 格一根带柱头 + 上下两道细扶手，中间镂空）───────────
  function railLine(x1, z1, x2, z2, y, o = {}) {
    const style = o.style || 'wood';
    const postC = style === 'stone' ? C.marbleShade : style === 'bamboo' ? C.bambooNode : C.woodDark;
    const capC = style === 'stone' ? C.marble : style === 'bamboo' ? C.bambooStalk : C.redRail;
    const lowC = style === 'stone' ? C.stoneWarm : style === 'bamboo' ? C.bambooNode : C.woodDark;
    let i = 0;
    H.line(x1, z1, x2, z2, (x, z) => {
      if (o.skip && o.skip(x, z)) { i++; return; }
      if (i % 3 === 0) {
        set(x, y, z, postC);        // 望柱
        set(x, y + 1, z, postC);
        set(x, y + 2, z, capC);     // 柱头
      } else {
        set(x, y, z, lowC);         // 下扶手
        set(x, y + 2, z, capC);     // 上扶手（y+1 镂空）
      }
      i++;
    });
  }

  // ── 通用：石矶平台（自水底砌起，边缘深色压边+苔藓）────────────────────────────
  function stonePlatform(x1, z1, x2, z2, topY, o = {}) {
    const topC = o.top ?? C.stoneWarm, edgeC = o.edgeC ?? C.rockDark;
    for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
      const edge = x === x1 || x === x2 || z === z1 || z === z2;
      const inner = x === x1 + 1 || x === x2 - 1 || z === z1 + 1 || z === z2 - 1;
      for (let y = 1; y < topY; y++) set(x, y, z, edge ? C.stoneDark : (hash(x, z, y) > 0.6 ? C.stone : C.stoneDark));
      let tc;
      if (edge) tc = edgeC;
      else if (inner) tc = C.stoneWarm;
      else tc = hash(x, z, 17) > 0.82 ? C.mossRock : (hash(x, z, 19) > 0.45 ? C.stone : topC);
      set(x, topY, z, tc);
    }
    // 苔藓/杂草点缀在平台边缘
    for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
      const edge = x === x1 || x === x2 || z === z1 || z === z2;
      if (!edge || hash(x, z, 21) < 0.7) continue;
      put(x, topY + 1, z, chance(0.5) ? C.mossRock : C.grass3);
    }
    if (o.rocks !== false) {
      for (let z = z1 - 1; z <= z2 + 1; z++) for (let x = x1 - 1; x <= x2 + 1; x++) {
        if (x > x1 && x < x2 && z > z1 && z < z2) continue;
        if (!isW(x, z) || hash(x, z, 53) > 0.5) continue;
        const hh = 2 + Math.floor(hash(x, z, 57) * 2);
        for (let k = 0; k < hh; k++) put(x, 1 + k, z, k === hh - 1 ? (chance(0.4) ? C.mossRock : wetRockC()) : wetRockC());
      }
    }
  }

  // ── 通用：水下石柱 ─────────────────────────────────────────────────────────
  function underPiers(x1, z1, x2, z2, topY, step = 3) {
    for (let z = z1; z <= z2; z += step) for (let x = x1; x <= x2; x += step) {
      if (!isW(x, z)) continue;
      for (let y = 1; y < topY; y++) put(x, y, z, y === topY - 1 ? C.stoneDark : C.stone);
    }
  }

  // ── 通用：两坡廊顶（替代 H.corridor 的三层屋顶）──────────────────────────────
  function waterCorridor(pts, o = {}) {
    const y = o.y ?? 4;
    const wdt = o.w ?? 3;
    const half = Math.floor(wdt / 2);
    // 水中石柱
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
      const alongX = Math.abs(bx - ax) >= Math.abs(bz - az);
      let n = 0;
      H.line(ax, az, bx, bz, (x, z) => {
        if (n % 3 === 0) {
          for (const p of [-half, half]) {
            const px = alongX ? x : x + p, pz = alongX ? z + p : z;
            if (isW(px, pz)) for (let yy = 1; yy <= y - 1; yy++) put(px, yy, pz, yy === y - 1 ? C.stoneDark : C.stone);
          }
        }
        n++;
      });
    }
    H.corridor({ pts, y, w: wdt, railC: C.redRail, columnsC: C.greenPillar, roofC: C.roof, floorC: C.stoneWarm });
    // 重做廊顶与栏杆：檐口-坡面-脊；栏杆改为「望柱+上下细扶手，中空」
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
      const alongX = Math.abs(bx - ax) >= Math.abs(bz - az);
      let n = 0;
      H.line(ax, az, bx, bz, (x, z) => {
        for (let p = -half; p <= half; p++) {
          const px = alongX ? x : x + p, pz = alongX ? z + p : z;
          w.clear(px, y + 4, pz, px, y + 6, pz);
          set(px, y + 4, pz, Math.abs(p) === half ? C.roofEdge : C.roof);
          if (Math.abs(p) <= half - 1) set(px, y + 5, pz, C.roofDark);
        }
        set(x, y + 6, z, C.ridge);
        // 栏杆：望柱（H.corridor 每 4 格的立柱）间加两道细扶手
        if (n % 4 !== 0) {
          for (const p of [-half, half]) {
            const px = alongX ? x : x + p, pz = alongX ? z + p : z;
            w.set(px, y + 2, pz, 0);
            set(px, y + 1, pz, C.woodDark);
            set(px, y + 3, pz, C.redRail);
          }
        }
        n++;
      });
    }
  }

  // ── 通用：折线桥（九曲石桥 / 木桥，桥面石+栏杆+桥墩）────────────────────────
  function polyBridge(pts, o = {}) {
    const wid = o.wid ?? 4;
    const y = o.y ?? 4;
    const half = Math.floor(wid / 2);
    const deckC = o.deckC ?? C.stoneLight;
    const deck2 = o.deck2 ?? C.stone;
    const edgeC = o.edgeC ?? C.stoneWarm;
    const style = o.style || 'stone';
    const railC = o.railC ?? (style === 'stone' ? C.marbleShade : C.redRail);
    const postC = style === 'stone' ? C.stoneLight : C.redRail;
    let n = 0;
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
      const alongX = Math.abs(bx - ax) >= Math.abs(bz - az);
      let i = 0;
      const len = Math.max(1, Math.abs(bx - ax) + Math.abs(bz - az));
      H.line(ax, az, bx, bz, (x, z) => {
        const t = i / len;
        const lift = o.arch ? Math.round((o.arch ?? 1) * Math.sin(Math.PI * t)) : 0;
        const yy = y + lift;
        for (let p = -half; p <= half; p++) {
          const px = alongX ? x : x + p, pz = alongX ? z + p : z;
          if (isW(px, pz)) {
            set(px, yy, pz, Math.abs(p) === half ? edgeC : (p % 2 === 0 ? deckC : deck2));
            for (let q = 1; q < yy; q++) set(px, q, pz, q === yy - 1 ? C.stoneDark : C.stone);
          } else {
            put(px, yy, pz, Math.abs(p) === half ? edgeC : deckC);
          }
        }
        // 通透朱栏：望柱每 3 格一根带柱头，上下两道细扶手，中间镂空
        for (const p of [-half, half]) {
          const px = alongX ? x : x + p, pz = alongX ? z + p : z;
          if (n % 3 === 0) {
            set(px, yy + 1, pz, C.woodDark);
            set(px, yy + 2, pz, C.woodDark);
            set(px, yy + 3, pz, C.redRail);
          } else {
            set(px, yy + 1, pz, C.woodDark);
            set(px, yy + 3, pz, C.redRail);
          }
        }
        n++; i++;
      });
    }
  }

  // ── 通用：直桥通透朱栏（覆写 H.bridge 的连续红栏）─────────────────────────────
  function straightBridgeRails(x, z, len, wid, dir, y, type = 'wood') {
    const halfLen = Math.floor(len / 2), halfWid = Math.floor(wid / 2);
    const dirX = dir === 'x';
    const liftAt = (i) => {
      const t = i / halfLen;
      if (type === 'stone3') return Math.round((1 - t * t) * 2);
      if (type === 'stone1') return Math.round((1 - t * t) * 1);
      if (type === 'bamboo') return Math.round((1 - t * t) * 1);
      return 0;
    };
    for (let i = -halfLen; i <= halfLen; i++) {
      const yy = y + liftAt(i);
      for (const j of [-halfWid, halfWid]) {
        const px = dirX ? x + i : x + j, pz = dirX ? z + j : z + i;
        for (let k = 1; k <= 3; k++) w.set(px, yy + k, pz, 0);
        if (i % 3 === 0) {
          set(px, yy + 1, pz, C.woodDark);
          set(px, yy + 2, pz, C.woodDark);
          set(px, yy + 3, pz, C.redRail);
        } else {
          set(px, yy + 1, pz, C.woodDark);
          set(px, yy + 3, pz, C.redRail);
        }
      }
    }
  }

  // ── 通用：四坡/歇山屋顶（轴线正脊居中，比 helpers 的 xieshan 更可靠）─────────
  function hipRoof(o) {
    const tile = o.tile ?? C.roof, dark = o.tileDark ?? C.roofDark, light = o.tileLight ?? C.roofLight;
    const edge = o.edge ?? C.roofEdge, ridgeC = o.ridgeC ?? C.ridge;
    const ov = o.overhang ?? 2, up = o.upturn ?? 1, y = o.y, h = o.h ?? 2;
    const ax1 = o.x1 - ov, ax2 = o.x2 + ov, az1 = o.z1 - ov, az2 = o.z2 + ov;
    const midX = Math.round((ax1 + ax2) / 2), midZ = Math.round((az1 + az2) / 2);
    ring(ax1, az1, ax2, az2, y, edge);
    for (const [cx, cz] of [[ax1, az1], [ax2, az1], [ax1, az2], [ax2, az2]]) {
      const sx = cx < midX ? -1 : 1, sz = cz < midZ ? -1 : 1;
      for (let k = 1; k <= up; k++) {
        set(cx + sx * k, y + k - 1, cz, edge);
        set(cx, y + k - 1, cz + sz * k, edge);
        set(cx + sx * k, y + k - 1, cz + sz * k, tile === C.glaze ? C.glaze : tile);
      }
      set(cx + sx, y + up, cz + sz, edge);
    }
    ring(ax1 + 1, az1 + 1, ax2 - 1, az2 - 1, y - 1, C.woodDark);
    const W = ax2 - ax1, D = az2 - az1;
    let topY = y;
    for (let i = 1; i <= h; i++) {
      const ix = Math.round((i * (W / 2)) / (h + 1));
      const iz = Math.round((i * (D / 2)) / (h + 1));
      const bx1 = ax1 + ix, bx2 = ax2 - ix, bz1 = az1 + iz, bz2 = az2 - iz;
      if (bx2 - bx1 < 2 || bz2 - bz1 < 1) break;
      for (let z = bz1; z <= bz2; z++) for (let x = bx1; x <= bx2; x++) {
        const stripe = ((x - ax1) >> 1) % 2 === 0;
        let c = stripe ? tile : dark;
        if (hash(x, z, 91) < 0.1) c = light;
        if (x === bx1 || x === bx2 || z === bz1 || z === bz2) c = ((x + z) & 1) ? edge : c;
        set(x, y + i, z, c);
      }
      topY = y + i;
    }
    if (o.ridge) {
      const rx1 = ax1 + Math.round(W * 0.16), rx2 = ax2 - Math.round(W * 0.16);
      for (let x = rx1; x <= rx2; x++) set(x, topY + 1, midZ, ridgeC);
      for (const xx of [rx1 - 1, rx2 + 1]) { set(xx, topY + 1, midZ, ridgeC); set(xx, topY + 2, midZ, ridgeC); }
      topY += 2;
    }
    return topY;
  }

  // ── 通用：棠木舫 ────────────────────────────────────────────────────────────
  function tangBoat(cx, cz, o = {}) {
    const len = o.len ?? 15, wid = o.wid ?? 4;
    const x1 = cx - Math.floor(len / 2), x2 = x1 + len - 1;
    const z1 = cz - Math.floor(wid / 2), z2 = z1 + wid - 1;
    for (let z = z1 - 1; z <= z2 + 1; z++) for (let x = x1 - 1; x <= x2 + 1; x++) {
      if (!isW(x, z)) return false;
    }
    for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
      set(x, 1, z, C.woodDark);
      set(x, 2, z, (x + z) % 3 === 0 ? C.woodDark : C.wood);
    }
    for (let z = z1 + 1; z <= z2 - 1; z++) for (let x = x1 + 1; x <= x2 - 1; x++) {
      set(x, 3, z, (x % 3 === 0) ? C.wood : C.woodLight);
    }
    for (let x = x1; x <= x2; x++) {
      for (const z of [z1, z2]) {
        set(x, 3, z, C.wood);
        set(x, 4, z, x % 3 === 0 ? C.redRail : C.woodDark);
      }
    }
    // 头尾起翘
    for (let i = 0; i < 2; i++) {
      for (let z = z1; z <= z2; z++) {
        set(x1 + i, 4, z, C.wood);
        set(x2 - i, 4, z, C.wood);
      }
      set(x1 + i, 5, cz, C.woodDark);
      set(x2 - i, 5, cz, C.woodDark);
    }
    // 中段卷篷
    const mx1 = x1 + Math.round(len * 0.3), mx2 = x2 - Math.round(len * 0.3);
    for (let x = mx1; x <= mx2; x++) {
      for (const z of [z1, z2]) { set(x, 5, z, C.woodDark); set(x, 6, z, C.straw); set(x, 7, z, C.thatch); }
      set(x, 6, z1 + 1, C.straw); set(x, 6, z2 - 1, C.straw);
      set(x, 7, z1 + 1, C.thatch); set(x, 7, z2 - 1, C.thatch);
      set(x, 8, z1 + 1, C.thatchDark); set(x, 8, z2 - 1, C.thatchDark);
    }
    set(mx1, 8, cz, C.thatchDark); set(mx2, 8, cz, C.thatchDark);
    // 撑篙
    const sx = x2 - 2;
    for (let k = 0; k < 5; k++) set(sx - (k > 2 ? 1 : 0), 5 + k, cz, C.woodDark);
    // 船灯
    set(x1 + 2, 5, cz, C.lampRed);
    set(x1 + 1, 5, cz + (wid > 3 ? 1 : 0), C.goldDark);
    return { x1, z1, x2, z2 };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. 藕香榭（盖在池中，四面槅子，攒尖顶，左右回廊跨水接岸，后折竹桥）
  // ══════════════════════════════════════════════════════════════════════════
  const PX = -20, PZ = -60;
  const pX1 = -26, pX2 = -14, pZ1 = -65, pZ2 = -55, deckY = 4;
  {
    // 水下石柱 + 边梁 + 台面
    for (const px of [-26, -22, -18, -14]) {
      for (const pz of [-65, -60, -55]) {
        for (let y = 1; y < deckY; y++) put(px, y, pz, y === deckY - 1 ? C.stoneDark : C.stone);
      }
    }
    fill(pX1, 3, pZ1, pX2, 3, pZ1, C.stoneDark);
    fill(pX1, 3, pZ2, pX2, 3, pZ2, C.stoneDark);
    fill(pX1, 3, pZ1, pX1, 3, pZ2, C.stoneDark);
    fill(pX2, 3, pZ1, pX2, 3, pZ2, C.stoneDark);
    fill(pX1, 3, -60, pX2, 3, -60, C.stoneDark);
    fill(pX1, deckY, pZ1, pX2, deckY, pZ2, C.stoneWarm);
    ring(pX1, pZ1, pX2, pZ2, deckY, C.stoneLight);
    // 水面石矶（台基四周乱石出水）
    for (let z = pZ1 - 1; z <= pZ2 + 1; z++) for (let x = pX1 - 1; x <= pX2 + 1; x++) {
      if (x > pX1 && x < pX2 && z > pZ1 && z < pZ2) continue;
      if (!isW(x, z) || hash(x, z, 61) > 0.55) continue;
      const hh = 1 + Math.floor(hash(x, z, 63) * 3);
      for (let k = 0; k < hh; k++) put(x, 1 + k, z, k === hh - 1 ? rockTopC() : rockC());
    }
    // 南面三级石阶入水
    for (let i = 0; i < 3; i++) {
      const zz = pZ2 + 1 + i, yy = deckY - 1 - i;
      for (let x = -23; x <= -17; x++) set(x, yy, zz, i === 0 ? C.stoneLight : C.stone);
    }
    // 榭身：木地板 + 八柱
    const bX1 = -24, bX2 = -16, bZ1 = -63, bZ2 = -57;
    fill(bX1 + 1, deckY, bZ1 + 1, bX2 - 1, deckY, bZ2 - 1, C.woodLight);
    for (const px of [-24, -20, -16]) { H.column(px, -63, 5, 5, C.redPillar); H.column(px, -57, 5, 5, C.redPillar); }
    H.column(-24, -60, 5, 5, C.redPillar); H.column(-16, -60, 5, 5, C.redPillar);
    // 座槛（四面留门洞）
    const seat = (x1, z1, x2, z2, skip) => {
      H.line(x1, z1, x2, z2, (x, z) => { if (!skip || !skip(x, z)) set(x, 5, z, C.woodDark); });
    };
    seat(-24, -57, -16, -57, (x) => x >= -21 && x <= -19);
    seat(-24, -63, -16, -63, (x) => x >= -21 && x <= -19);
    seat(-24, -60, -24, -57, (z) => z >= -61 && z <= -59);
    seat(-16, -60, -16, -57, (z) => z >= -61 && z <= -59);
    // 四面槅子花窗
    for (const zz of [-57, -63]) {
      H.latticeWindow({ x: -23, y: 6, z: zz, axis: 'x', w: 3, h: 3, cFrame: C.woodRed, cLattice: C.windowGlow });
      H.latticeWindow({ x: -18, y: 6, z: zz, axis: 'x', w: 3, h: 3, cFrame: C.woodRed, cLattice: C.windowGlow });
    }
    for (const xx of [-16]) {
      H.latticeWindow({ x: xx, y: 6, z: -62, axis: 'z', w: 3, h: 3, cFrame: C.woodRed, cLattice: C.windowGlow });
      H.latticeWindow({ x: xx, y: 6, z: -59, axis: 'z', w: 3, h: 3, cFrame: C.woodRed, cLattice: C.windowGlow });
    }
    // 西侧（接竹桥）棂窗改为两窄扇，给中缝留门位；门扇交给 H.door（可开合+步行碰撞）
    H.latticeWindow({ x: -24, y: 6, z: -62, axis: 'z', w: 1, h: 3, cFrame: C.woodRed, cLattice: C.windowGlow });
    H.latticeWindow({ x: -24, y: 6, z: -58, axis: 'z', w: 1, h: 3, cFrame: C.woodRed, cLattice: C.windowGlow });
    H.door({ x: -24, y: 5, z: -61, axis: 'z', w: 3, h: 3, c: C.woodRed, studs: true, hinge: 'left', openTowards: 1, label: '藕香榭' });
    // 门常开：清掉门扇体素与旧窗框的碰撞占位（精细门扇由 ornaments 渲染），保证步行可入
    for (let z = -62; z <= -58; z++) for (let y = 5; y <= 8; y++) w.set(-24, y, z, 0);
    // 室内陈设（螃蟹宴条桌——第 38 回藕香榭赏桂吃蟹）
    H.furnish({ x: -20, z: -60, y: 5, w: 6, d: 5, h: 4, style: 'dining' });
    eaveBand(bX1, bZ1, bX2, bZ2, 10);
    // 攒尖顶（出檐 2、起翘 2）
    H.roof({ x1: bX1, z1: bZ1, x2: bX2, z2: bZ2, y: 11, h: 3, type: 'pyramid', tile: C.roof, ridge: C.ridge, overhang: 2, upturn: 2 });
    // 金宝顶
    set(-20, 14, -60, C.goldDark);
    set(-20, 15, -60, C.gold);
    set(-20, 16, -60, C.ridge);
    // 台面栏杆（四处入口留空，通透朱栏）
    const skipPlat = (x, z) => {
      if (z === pZ2 && x >= -23 && x <= -17) return true;
      if (x === pX2 && z >= -61 && z <= -59) return true;
      if (x === pX1 && ((z >= -65 && z <= -63) || (z >= -60 && z <= -56))) return true;
      return false;
    };
    railLine(pX1, pZ2, pX2, pZ2, 5, { skip: skipPlat });
    railLine(pX1, pZ1, pX2, pZ1, 5, { skip: skipPlat });
    railLine(pX1, pZ1, pX1, pZ2, 5, { skip: skipPlat });
    railLine(pX2, pZ1, pX2, pZ2, 5, { skip: skipPlat });
    // 匾额与楹联（南面）
    H.plaque({ x: PX, y: 7.8, z: pZ2 - 1, dir: 'south', text: '藕香榭', w: 7, h: 2.2 });
    H.couplet({ x: -23, y: 4.8, z: pZ2 - 1, dir: 'south', text: '芙蓉影破歸蘭槳', w: 1, h: 6 });
    H.couplet({ x: -17, y: 4.8, z: pZ2 - 1, dir: 'south', text: '菱藕香深寫竹橋', w: 1, h: 6 });

    // ── 西回廊 + 西石矶 ──
    waterCorridor([[-27, -64], [-32, -64]], { y: 4, w: 3 });
    stonePlatform(-41, -70, -31, -62, 4, { paved: false, top: C.stoneWarm });
    rockCluster(-42, -64, 1, 2);
    rockCluster(-32, -70, 1, 2);
    for (let k = 0; k < 3; k++) set(-36, 5 + k, -69, C.stone);
    set(-36, 8, -69, C.lampWarm);
    fill(-37, 9, -70, -35, 9, -68, C.stoneLight);
    // ── 东回廊 + 东石矶（兼木桥桥台）──
    waterCorridor([[-13, -60], [-10, -60]], { y: 4, w: 3 });
    stonePlatform(-9, -66, 1, -54, 4, { paved: false, top: C.stoneWarm });
    rockCluster(-10, -58, 1, 2);
    rockCluster(1, -64, 1, 2);
    // 东石矶上的石灯
    for (let k = 0; k < 3; k++) set(0, 5 + k, -64, C.stoneLight);
    set(0, 8, -64, C.lampWarm);
    fill(-1, 9, -65, 1, 9, -63, C.stoneLight);

    // ── 后「曲折竹桥」zhuqiao：自榭西跨水折向北岸 ──
    const zq = L.BRIDGES.zhuqiao; // 中心 (-34,-58) len16 wid4 dir x
    H.bridge({ x: zq.x, z: zq.z, len: zq.len, wid: zq.wid, dir: 'x', type: 'bamboo', y: 4, rail: C.bambooNode });
    bambooDeck(zq.x, zq.z, zq.len, zq.wid, 'x', 4);
    // 竹桥下桥墩
    for (let i = -8; i <= 8; i += 3) {
      const t = i / 8, lift = Math.round((1 - t * t) * 1);
      const px = zq.x + i;
      for (let z = zq.z - 2; z <= zq.z + 2; z++) {
        if (!isW(px, z)) continue;
        for (let y = 1; y < 4 + lift - (Math.abs(z - zq.z) === 2 ? 1 : 0); y++) put(px, y, z, y === 3 ? C.stoneDark : C.stone);
      }
    }
    // 折角平台（连接第一段与北折段）
    fill(-46, 4, -60, -41, 4, -56, C.wood);
    ring(-46, -60, -41, -56, 4, C.woodDark);
    for (const [px, pz] of [[-46, -60], [-41, -60], [-46, -56], [-41, -56]]) {
      for (let y = 1; y <= 3; y++) set(px, y, pz, y === 3 ? C.stoneDark : C.stone);
    }
    // 北折段：沿 z 跨水至北岸
    H.bridge({ x: -46, z: -66, len: 18, wid: 4, dir: 'z', type: 'bamboo', y: 4, rail: C.bambooNode });
    bambooDeck(-46, -66, 18, 4, 'z', 4);
    for (let i = -9; i <= 9; i += 3) {
      const t = i / 9, lift = Math.round((1 - t * t) * 1);
      const pz = -66 + i;
      for (let x = -48; x <= -44; x++) {
        if (!isW(x, pz)) continue;
        for (let y = 1; y < 4 + lift - (Math.abs(x + 46) === 2 ? 1 : 0); y++) put(x, y, pz, y === 3 ? C.stoneDark : C.stone);
      }
    }
    // 北岸落桥石阶
    for (let i = 0; i < 2; i++) {
      for (let x = -48; x <= -44; x++) set(x, 3 + (1 - i), -75 - i, i === 0 ? C.stoneLight : C.stone);
    }
    rockCluster(-49, -74, 1, 2);
    rockCluster(-41, -75, 1, 2);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. 紫菱洲 · 缀锦楼（岛 elev4，二层，歇山/卷棚，脊高约 15–16）
  // ══════════════════════════════════════════════════════════════════════════
  const ZX = 8, ZZ = -28;
  const islX1 = -5, islX2 = 23, islZ1 = -39, islZ2 = -17;
  {
    // 岛岸石矶收边（岛面 elev4；灰石+苔，避免刺眼白石）
    for (let z = islZ1; z <= islZ2; z++) for (let x = islX1; x <= islX2; x++) {
      if (isW(x, z) || gy(x, z) < 4) continue;
      if (!nearWater(x, z, 1)) continue;
      if (hash(x, z, 23) < 0.7) set(x, 4, z, hash(x, z, 27) > 0.5 ? C.bankStone : C.rockDark);
      if (hash(x, z, 29) > 0.82) put(x, 5, z, chance(0.5) ? C.mossRock : C.rock);
    }
    borderRocks(islX1, islZ1, islX2, islZ2, 0.22, 1);
    // 沿岸山石（H.rock 落于岸内 2 格处，不悬水）
    for (const [rx, rz] of [[-4, -23], [21, -31], [17, -38], [6, -38]]) {
      if (!isW(rx, rz)) H.rock({ x: rx, z: rz, y: 5, size: 1, h: 2, seed: 7 });
    }

    // 台基（岛面 4 → 台面 6）
    const plX1 = -2, plX2 = 18, plZ1 = -37, plZ2 = -19, platY = 5;
    fill(plX1, platY, plZ1, plX2, platY, plZ2, C.stoneWarm);
    ring(plX1, plZ1, plX2, plZ2, platY, C.stoneWarm);
    for (let z = plZ1 + 1; z <= plZ2 - 1; z++) for (let x = plX1 + 1; x <= plX2 - 1; x++) {
      if (w.get(x, platY, z) === C.stoneWarm) set(x, platY, z, hash(x, z, 31) > 0.72 ? C.stoneLight : C.stoneWarm);
    }
    // 南面踏跺（两级）
    for (let x = 5; x <= 11; x++) { set(x, 5, -18, C.stoneLight); set(x, 4, -17, C.stoneLight); }
    // 台面石栏（南面留踏跺口）
    const skipSt = (x, z) => z === plZ2 && x >= 4 && x <= 12;
    railLine(plX1, plZ2, plX2, plZ2, 6, { style: 'stone', skip: skipSt });
    railLine(plX1, plZ1, plX2, plZ1, 6, { style: 'stone' });
    railLine(plX1, plZ1, plX1, plZ2, 6, { style: 'stone' });
    railLine(plX2, plZ1, plX2, plZ2, 6, { style: 'stone' });

    // ── 一层（三间，粉墙灰瓦，前檐槅子窗）──
    const b1X1 = 1, b1X2 = 15, b1Z1 = -34, b1Z2 = -24;
    fill(b1X1 + 1, platY, b1Z1 + 1, b1X2 - 1, platY, b1Z2 - 1, C.wood); // 一层地栿/木地板
    for (const px of [1, 6, 11, 15]) {
      H.column(px, b1Z1, 6, 4, C.redPillar);
      H.column(px, b1Z2, 6, 4, C.redPillar);
    }
    // 东西山墙 / 后墙
    for (let z = b1Z1 + 1; z <= b1Z2 - 1; z++) {
      for (let y = 6; y <= 8; y++) {
        set(1, y, z, y === 6 ? C.wallBase : C.plaster);
        set(15, y, z, y === 6 ? C.wallBase : C.plaster);
      }
    }
    for (let x = 2; x <= 14; x++) {
      for (let y = 6; y <= 8; y++) set(x, y, b1Z1, y === 6 ? C.wallBase : C.plaster);
    }
    // 南面前檐：板门居中，两侧槅子窗
    for (let x = 2; x <= 14; x++) for (let y = 6; y <= 8; y++) set(x, y, b1Z2, y === 6 ? C.wallBase : C.plaster);
    for (let x = 6; x <= 10; x++) for (let y = 6; y <= 8; y++) w.set(x, y, b1Z2, 0);
    H.door({ x: 6, y: 6, z: b1Z2, axis: 'x', w: 5, h: 3, c: C.woodRed, studs: true, hinge: 'left', openTowards: 1, label: '綴錦樓' });
    // 门常开：清掉门扇体素的碰撞占位（精细门扇由 ornaments 渲染），保证步行可入
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) w.set(6 + i, 6 + j, b1Z2, 0);
    // 室内陈设（一层明间：迎春起居厅堂）
    H.furnish({ x: 8, z: -29, y: 6, w: 12, d: 8, h: 3.4, style: 'hall' });
    H.latticeWindow({ x: 2, y: 7, z: b1Z2, axis: 'x', w: 3, h: 2, cFrame: C.woodRed, cLattice: C.windowGlow });
    H.latticeWindow({ x: 12, y: 7, z: b1Z2, axis: 'x', w: 3, h: 2, cFrame: C.woodRed, cLattice: C.windowGlow });
    H.latticeWindow({ x: 1, y: 7, z: -33, axis: 'z', w: 3, h: 2, cFrame: C.woodRed, cLattice: C.windowGlow });
    H.latticeWindow({ x: 15, y: 7, z: -33, axis: 'z', w: 3, h: 2, cFrame: C.woodRed, cLattice: C.windowGlow });
    H.latticeWindow({ x: 3, y: 7, z: b1Z1, axis: 'x', w: 3, h: 2, cFrame: C.woodRed, cLattice: C.windowGlow });
    H.latticeWindow({ x: 9, y: 7, z: b1Z1, axis: 'x', w: 3, h: 2, cFrame: C.woodRed, cLattice: C.windowGlow });
    eaveBand(b1X1, b1Z1, b1X2, b1Z2, 9);
    // 腰檐：外挑两格薄檐（自一层柱头出挑）
    fill(b1X1 - 2, 10, b1Z1 - 2, b1X2 + 2, 10, b1Z2 + 2, C.roof);
    ring(b1X1 - 2, b1Z1 - 2, b1X2 + 2, b1Z2 + 2, 10, C.roofEdge);
    fill(b1X1 - 1, 11, b1Z1 - 1, b1X2 + 1, 11, b1Z2 + 1, C.roofDark);
    ring(b1X1 - 1, b1Z1 - 1, b1X2 + 1, b1Z2 + 1, 11, C.roofEdge);
    for (const [cx, cz] of [[b1X1 - 2, b1Z1 - 2], [b1X2 + 2, b1Z1 - 2], [b1X1 - 2, b1Z2 + 2], [b1X2 + 2, b1Z2 + 2]]) {
      set(cx, 11, cz, C.roofDark);
      set(cx + (cx < b1X1 ? 1 : -1), 11, cz + (cz < b1Z1 ? 1 : -1), C.roofEdge);
    }
    // ── 平座（二层回廊 + 朱栏）──
    const balY = 12;
    fill(b1X1 - 1, balY, b1Z1 - 1, b1X2 + 1, balY, b1Z2 + 1, C.wood);
    ring(b1X1 - 1, b1Z1 - 1, b1X2 + 1, b1Z2 + 1, balY, C.woodDark);
    railLine(b1X1 - 1, b1Z1 - 1, b1X2 + 1, b1Z1 - 1, balY + 1, { style: 'wood' });
    railLine(b1X1 - 1, b1Z2 + 1, b1X2 + 1, b1Z2 + 1, balY + 1, { style: 'wood' });
    railLine(b1X1 - 1, b1Z1 - 1, b1X1 - 1, b1Z2 + 1, balY + 1, { style: 'wood' });
    railLine(b1X2 + 1, b1Z1 - 1, b1X2 + 1, b1Z2 + 1, balY + 1, { style: 'wood' });
    // ── 二层（三间，四面槅子，歇山顶）──
    const b2X1 = 2, b2X2 = 14, b2Z1 = -33, b2Z2 = -25;
    for (const px of [2, 8, 14]) { H.column(px, b2Z1, 13, 3, C.redPillar); H.column(px, b2Z2, 13, 3, C.redPillar); }
    for (let z = b2Z1 + 1; z <= b2Z2 - 1; z++) for (let y = 13; y <= 15; y++) {
      set(2, y, z, y === 13 ? C.wallBase : C.plaster);
      set(14, y, z, y === 13 ? C.wallBase : C.plaster);
    }
    for (let x = 3; x <= 13; x++) for (let y = 13; y <= 15; y++) {
      set(x, y, b2Z1, y === 13 ? C.wallBase : C.plaster);
      set(x, y, b2Z2, y === 13 ? C.wallBase : C.plaster);
    }
    // 四面槅子花窗
    for (const zz of [b2Z1, b2Z2]) {
      H.latticeWindow({ x: 4, y: 13, z: zz, axis: 'x', w: 3, h: 2, cFrame: C.woodRed, cLattice: C.windowGlow });
      H.latticeWindow({ x: 10, y: 13, z: zz, axis: 'x', w: 3, h: 2, cFrame: C.woodRed, cLattice: C.windowGlow });
    }
    for (const xx of [b2X1, b2X2]) {
      H.latticeWindow({ x: xx, y: 13, z: -31, axis: 'z', w: 3, h: 2, cFrame: C.woodRed, cLattice: C.windowGlow });
      H.latticeWindow({ x: xx, y: 13, z: -27, axis: 'z', w: 3, h: 2, cFrame: C.woodRed, cLattice: C.windowGlow });
    }
    eaveBand(b2X1, b2Z1, b2X2, b2Z2, 15);
    hipRoof({ x1: b2X1, z1: b2Z1, x2: b2X2, z2: b2Z2, y: 16, h: 3, overhang: 2, upturn: 2, tile: C.roof, ridge: true, ridgeC: C.ridgeLight });
    // 匾额「綴錦樓」
    H.plaque({ x: ZX, y: 14, z: b2Z2 + 1, dir: 'south', text: '綴錦樓', w: 6, h: 2 });
    // 一层檐下灯笼
    H.lantern({ x: b1X1 - 1, y: 6, z: b1Z2 + 1, h: 2, red: true });
    H.lantern({ x: b1X2 + 1, y: 6, z: b1Z2 + 1, h: 2, red: true });
    // 岛南石碣「紫菱洲」
    fill(17, 4, -18, 19, 4, -18, C.rockDark);
    for (let y = 5; y <= 6; y++) fill(17, y, -18, 19, y, -18, y === 6 ? C.rockDark : C.rock);
    set(18, 7, -18, C.mossRock);
    ctx.decals.push({ kind: 'plaque', text: '紫菱洲', x: 18, y: 5, z: -18, dir: 'south', w: 3, h: 1.5, board: C.rockDark, ink: C.goldText, frame: C.stoneWarm });

    // ── 九曲石桥 ziling：岛南岸 → 池南岸（接岸）──
    polyBridge([[0, -17], [0, -13], [5, -13], [5, -9], [1, -9], [1, -4], [0, -4], [0, 0]], {
      wid: 4, y: 4, arch: 0, deckC: C.stoneLight, deck2: C.stone, edgeC: C.stoneWarm, style: 'stone',
    });
    // 桥南岸落桥石阶
    for (let x = -2; x <= 2; x++) { set(x, 3, 1, C.stoneWarm); set(x, 4, 0, C.stoneLight); }

    // 岛岸垂柳（四角，避开楼身视线）
    F.willow(-4, -21, { h: 9, r: 2.6 });
    F.willow(22, -20, { h: 9, r: 2.6 });
    F.willow(22, -36, { h: 8, r: 2.4 });
    F.willow(5, -38, { h: 8, r: 2.4 });
    // 苇叶成片
    F.reedBed(-5, -38, -4, -20, { count: 10 });
    F.reedBed(20, -38, 23, -22, { count: 10 });
    F.reedBed(-5, -18, 2, -16, { count: 6 });
    F.reedBed(15, -18, 20, -16, { count: 6 });
    // 蓼花 20 丛（粉红花穗，自建）
    let liao = 0, guard = 0;
    while (liao < 20 && guard < 500) {
      guard++;
      const x = ri(islX1, islX2), z = ri(islZ1, islZ2);
      if (isW(x, z) || gy(x, z) < 4) continue;
      if (!nearWater(x, z, 2)) continue;
      if (x >= plX1 && x <= plX2 && z >= plZ1 && z <= plZ2) continue;
      if (z >= -18 && z <= -16 && x >= -6 && x <= 4) continue;
      if (z >= -19 && z <= -16 && x >= 14 && x <= 20) continue;
      if (z >= -19 && z <= -15 && x >= 3 && x <= 14) continue; // 綴錦樓南门前 2m 留空
      if (w.get(x, 5, z) !== 0) continue;
      const n = 1 + (hash(x, z, 31) > 0.55 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const px = x + ri(-1, 1), pz = z + ri(-1, 1);
        if (isW(px, pz) || w.get(px, 5, pz) !== 0) continue;
        const hh = 2 + (hash(px, pz, 7) > 0.5 ? 1 : 0);
        for (let k = 0; k < hh; k++) set(px, 5 + k, pz, k === 0 ? C.leaf : C.leafLight);
        set(px, 5 + hh, pz, pick([C.peony2, C.lotusFlower, C.peony]));
        if (chance(0.5)) set(px + (chance(0.5) ? 1 : -1), 5 + hh, pz, pick([C.peony2, C.lotusFlower]));
        if (chance(0.3)) set(px, 5 + hh + 1, pz, C.peony2);
      }
      liao++;
    }
    // 岛上小径与草花
    for (let z = -18; z <= -17; z++) for (let x = 4; x <= 12; x++) if (!isW(x, z)) set(x, 4, z, hash(x, z, 5) > 0.5 ? C.path3 : C.path2);
    F.grassTuft(20, -20); F.grassTuft(20, -35); F.grassTuft(-4, -18);
    // 门洞前 2m 空地：清掉踏跺与平台前的山石/花草（保留台阶本体），保证步行可入
    for (let z = -18; z <= -16; z++) {
      for (let x = 3; x <= 13; x++) {
        if (isW(x, z)) continue;
        if (z === -18 && x >= 5 && x <= 11) continue; // 保留踏步
        for (let y = 5; y <= 7; y++) if (w.get(x, y, z) !== 0) w.set(x, y, z, 0);
      }
    }
    for (let z = -17; z <= -16; z++) for (let x = 4; x <= 12; x++) if (!isW(x, z)) set(x, 4, z, C.path2);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. 荇叶渚（石矶洲渚、石阶码头、系船桩、棠木舫两只）+ 荇叶渚桥
  // ══════════════════════════════════════════════════════════════════════════
  const XYC = { x: -14, z: -9, rx: 11, rz: 7 };
  {
    const { x: cx, z: cz, rx, rz } = XYC;
    const topY = 4;
    const inside = (x, z) => {
      const dx = (x - cx) / rx, dz = (z - cz) / rz;
      return dx * dx + dz * dz <= 1 + (hash(x, z, 71) - 0.5) * 0.2;
    };
    // 洲渚本体（自河床砌起，高水面 1.6）
    for (let z = cz - rz - 1; z <= cz + rz + 1; z++) {
      for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
        if (!inside(x, z)) continue;
        const edge = !inside(x + 1, z) || !inside(x - 1, z) || !inside(x, z + 1) || !inside(x, z - 1);
        for (let y = 1; y < topY; y++) set(x, y, z, edge ? C.stoneDark : (hash(x, z, y) > 0.6 ? C.stone : C.stoneDark));
        let topC;
        if (edge) topC = hash(x, z, 5) > 0.45 ? C.bankStone : C.stoneWarm;
        else {
          const onPath = (z >= -10 && z <= -9) || (x >= -15 && x <= -14);
          topC = onPath ? (hash(x, z, 9) > 0.6 ? C.path3 : C.path) : (hash(x, z, 11) > 0.4 ? C.grass2 : C.grass);
        }
        set(x, topY, z, topC);
      }
    }
    // 北面三级石阶入水 + 系船石桩
    for (let i = 0; i < 3; i++) {
      const zz = cz - rz - i;
      const yy = topY - i;
      for (let x = cx - 2; x <= cx + 2; x++) set(x, yy, zz, i === 0 ? C.stoneLight : C.stone);
    }
    for (const sx of [cx - 5, cx + 4]) {
      for (let y = 1; y <= 5; y++) set(sx, y, cz - rz - 1, y === 5 ? C.stoneLight : C.stoneWarm);
    }
    // 洲岸石矶/芦苇（低密度，灰石为主）
    for (let z = cz - rz; z <= cz + rz; z++) for (let x = cx - rx; x <= cx + rx; x++) {
      if (isW(x, z) || !inside(x, z)) continue;
      if (!nearWater(x, z, 1)) continue;
      if (hash(x, z, 33) > 0.93) {
        const hh = 1 + Math.floor(hash(x, z, 37) * 2);
        for (let k = 0; k < hh; k++) put(x, topY + 1 + k, z, k === hh - 1 ? (chance(0.5) ? C.mossRock : wetRockC()) : wetRockC());
      } else if (hash(x, z, 39) > 0.9) {
        for (let k = 0; k < 3; k++) put(x, topY + 1 + k, z, k === 2 ? C.straw : (k === 0 ? C.reed2 : C.reed));
      }
    }
    // 洲岸一圈高出的驳岸石（少量，仅点缀）
    for (let z = cz - rz - 1; z <= cz + rz + 1; z++) for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
      if (isW(x, z) || !inside(x, z)) continue;
      if (!nearWater(x, z, 1)) continue;
      if (hash(x, z, 43) < 0.12) put(x, topY, z, C.stone);
    }
    // 石碣「荇葉渚」
    const stX = -12, stZ = -5;
    fill(stX - 1, topY, stZ, stX + 1, topY, stZ, C.rockDark);
    for (let y = topY + 1; y <= topY + 4; y++) fill(stX - 1, y, stZ, stX + 1, y, stZ, y === topY + 4 ? C.rockLight : C.rockDark);
    set(stX, topY + 5, stZ, C.mossRock);
    ctx.decals.push({ kind: 'plaque', text: '荇葉渚', x: stX, y: topY + 1.2, z: stZ, dir: 'south', w: 3.2, h: 2.2, board: C.rockDark, ink: C.goldText, frame: C.stoneWarm });
    // 渚上石凳、苇丛
    for (const [bx, bz] of [[cx + 5, cz + 1], [cx + 2, cz + 3]]) {
      if (isW(bx, bz)) continue;
      put(bx, topY + 1, bz, C.stoneLight);
      put(bx + 1, topY + 1, bz, C.stone);
    }
    for (const [rx2, rz2] of [[cx - 7, cz + 2], [cx + 7, cz - 1], [cx - 2, cz + 4]]) {
      if (!isW(rx2, rz2)) for (let k = 0; k < 3; k++) put(rx2, topY + 1 + k, rz2, k === 2 ? C.straw : (k === 0 ? C.reed2 : C.reed));
    }

    // ── 荇叶渚桥 xingye：渚西岸 → 池西岸（折桥，接岸）──
    polyBridge([[-24, -10], [-28, -10], [-28, -8], [-36, -8]], {
      wid: 4, y: 4, arch: 0, deckC: C.stoneLight, deck2: C.stone, edgeC: C.stoneWarm, style: 'stone',
    });
    // 西岸落桥石台与踏跺
    for (let x = -39; x <= -34; x++) for (let z = -11; z <= -6; z++) {
      if (!isW(x, z)) set(x, gy(x, z), z, hash(x, z, 3) > 0.6 ? C.path3 : C.stoneWarm);
    }
    for (let x = -39; x <= -34; x++) set(x, 3, -7, C.stoneLight);

    // ── 池南码头（岸 elev3：三级石阶入水、系船石桩、灯笼）──
    for (let x = -2; x <= 3; x++) for (let z = 0; z <= 3; z++) if (!isW(x, z)) set(x, gy(x, z), z, hash(x, z, 13) > 0.5 ? C.path3 : C.stoneWarm);
    for (let i = 0; i < 3; i++) {
      set(-3 - i, 3 - i, 0 - i, i === 0 ? C.stoneLight : C.stone);
      set(-2 - i, 3 - i, 0 - i, i === 0 ? C.stoneLight : C.stone);
      set(-4 - i, 3 - i, 0 - i, i === 0 ? C.stoneLight : C.stone);
    }
    for (const [mx, mz] of [[0, -1], [-5, -2]]) {
      for (let y = 1; y <= 3; y++) set(mx, y, mz, y === 3 ? C.stoneLight : C.stoneWarm);
    }
    for (let k = 0; k < 2; k++) set(2, 4 + k, 2, C.woodDark);
    set(2, 6, 2, C.lampWarm);

    // ── 棠木舫两只：一靠渚岸，一游弋池中 ──
    tangBoat(-16, -21, { len: 15, wid: 4 });
    tangBoat(-31, -38, { len: 15, wid: 4 });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. 藕苑木桥 ouyuan：东石矶 → 紫菱洲南岸（接岸）
  // ══════════════════════════════════════════════════════════════════════════
  {
    H.bridge({ x: -4, z: -46, len: 16, wid: 4, dir: 'z', type: 'wood', y: 4, rail: C.redRail });
    straightBridgeRails(-4, -46, 16, 4, 'z', 4, 'wood');
    for (let i = -8; i <= 8; i += 3) {
      const px = -4, pz = -46 + i;
      for (let x = -6; x <= -2; x++) {
        if (!isW(x, pz)) continue;
        for (let y = 1; y <= 3; y++) put(x, y, pz, y === 3 ? C.stoneDark : C.stone);
      }
      if (isW(px, pz)) for (let y = 1; y < 4; y++) put(px, y, pz, y === 3 ? C.woodDark : C.wood);
    }
    // 南端与岛岸衔接：石阶/铺地
    for (let x = -6; x <= -2; x++) for (let z = -39; z <= -37; z++) {
      if (!isW(x, z)) set(x, 4, z, hash(x, z, 7) > 0.5 ? C.stoneLight : C.wood);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. 预留区（先于植被；岛面窄，紫菱洲只外扩 0–1 格）
  // ══════════════════════════════════════════════════════════════════════════
  ctx.reserve(-27, -66, -13, -54);           // 藕香榭台基（外扩 2）
  ctx.reserve(-47, -70, -8, -54);            // 回廊/石矶/竹桥（水面）
  ctx.reserve(-49, -77, -41, -55, 1);        // 竹桥北折段（压北岸少量）
  ctx.reserve(-2, -37, 18, -19, 0);          // 缀锦楼台基
  ctx.reserve(-26, -18, -2, -1, 0);          // 荇叶渚
  ctx.reserve(-5, -1, 4, 4, 0);              // 池南码头
  ctx.reserve(-40, -13, -32, -5, 0);         // 荇叶渚桥西岸落台
  ctx.reserve(-6, -2, 1, 2, 0);              // 九曲桥南岸落台

  // ══════════════════════════════════════════════════════════════════════════
  // 6. 花木：金桂、垂柳、荷、苇、荇菱
  // ══════════════════════════════════════════════════════════════════════════
  {
    // 藕香榭北岸（竹桥落岸处）两株金桂
    F.tree(-45, -81, { h: 10, r: 3.4, colors: [C.chrys, C.leafYellow, C.leaf, C.leafLight] });
    F.tree(-37, -82, { h: 9, r: 3.2, colors: [C.leafYellow, C.chrys, C.leafLight] });
    // 北岸芦苇、野花
    F.reedBed(-56, -81, -48, -75, { count: 12 });
    F.reedBed(-42, -84, -32, -79, { count: 10 });
    F.flowerPatch(-58, -80, -50, -76, { colors: [C.chrys, C.lotusFlower], count: 18 });
    // 荇叶渚西岸落桥处垂柳
    F.willow(-40, -4, { h: 11 });
    F.willow(-36, -14, { h: 10 });
    // 藕香榭四周荷叶
    F.lotus(-22, -49, 8, 3, { count: 34 });
    F.lotus(7, -45, 6, 4, { count: 28 });
    F.lotus(-36, -50, 5, 4, { count: 24 });
    F.lotus(-8, -70, 7, 3, { count: 26 });
    F.lotus(-20, -28, 6, 3, { count: 22 });
    F.lotus(-28, -18, 5, 3, { count: 20 });
    F.lotus(-10, -3, 4, 2, { count: 18 });
    F.lotus(-14, -34, 5, 3, { count: 22 });
    F.lotus(12, -58, 5, 3, { count: 24 });
    F.lotus(-30, -66, 4, 3, { count: 18 });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. 水面点缀：浮荇/菱叶、锦鲤意象
  // ══════════════════════════════════════════════════════════════════════════
  {
    // 浮荇（荇叶渚一带小片贴水，水面 3.35 → 贴水层 y=4）
    const pads = [C.lotusPad, C.lotusPad2, C.lotusPad3];
    let n = 0, guard = 0;
    while (n < 70 && guard < 700) {
      guard++;
      const x = ri(-34, 2), z = ri(-22, 1);
      if (!isW(x, z) || w.get(x, 4, z) !== 0) continue;
      set(x, 4, z, pads[(hash(x, z, 11) * 3) | 0]);
      if (hash(x, z, 13) > 0.7) set(x + 1, 4, z, pads[(hash(x, z, 17) * 3) | 0]);
      n++;
    }
    // 荷叶间零散花
    for (let i = 0; i < 12; i++) {
      const x = ri(-36, 10), z = ri(-52, -30);
      if (!isW(x, z) || w.get(x, 4, z) !== 0) continue;
      set(x, 4, z, C.lotusPad3);
      set(x, 5, z, pick([C.lotusFlower, C.peony2]));
    }
    // 锦鲤意象（少量）
    let fish = 0; guard = 0;
    while (fish < 12 && guard < 400) {
      guard++;
      const x = ri(-40, 8), z = ri(-66, -6);
      if (!isW(x, z) || w.get(x, 2, z) !== 0) continue;
      set(x, 2, z, chance(0.7) ? C.lampRed : C.lamp);
      fish++;
    }
  }
}
