// ─────────────────────────────────────────────────────────────────────────────
// 中国古典园林建筑体素生成器
// 取法：清式官式建筑（歇山/硬山/卷棚/攒尖）、江南园林粉墙黛瓦、飞檐起翘、瓦垄、
// 檐下彩画、白石栏杆、抄手游廊、月洞门、花窗、牌坊、水榭、石拱桥。
// 尺度：1 体素≈1 米，并按园林观感适度夸张（檐高 3–6、脊高 6–22）。
// 全部函数由 createHelpers(ctx) 提供，ctx = { w, C, R, decals, groundTop }
// ─────────────────────────────────────────────────────────────────────────────
import { C, GROUPS } from '../core/palette.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createHelpers(ctx) {
  const w = ctx.w;
  const R = ctx.R || (() => 0.5);
  const decals = ctx.decals || (ctx.decals = []);
  const pick = (arr) => arr[Math.floor(R() * arr.length) % arr.length];
  const DET = ctx.details || (ctx.details = { roofs: [], columns: [], lattices: [], railings: [], doors: [], furniture: [], lanterns: [], banners: [], misc: [] });
  for (const k of ['roofs', 'columns', 'lattices', 'railings', 'doors', 'furniture', 'lanterns', 'banners', 'misc']) if (!DET[k]) DET[k] = [];

  // ── 基础体素操作 ────────────────────────────────────────────────────────────
  const box = (x1, y1, z1, x2, y2, z2, c) => w.fill(x1, y1, z1, x2, y2, z2, c);
  const set = (x, y, z, c) => w.set(x, y, z, c);
  const setIfEmpty = (x, y, z, c) => w.setIfEmpty(x, y, z, c);
  const column = (x, z, y, h, c = C.redPillar) => { for (let i = 0; i < h; i++) set(x, y + i, z, c); };

  /** 沿线段逐格回调 */
  function line(x1, z1, x2, z2, cb) {
    x1 |= 0; z1 |= 0; x2 |= 0; z2 |= 0;
    let dx = Math.abs(x2 - x1), dz = Math.abs(z2 - z1);
    const sx = x1 < x2 ? 1 : -1, sz = z1 < z2 ? 1 : -1;
    let err = dx - dz;
    let x = x1, z = z1;
    for (let guard = 0; guard < 3000; guard++) {
      cb(x, z);
      if (x === x2 && z === z2) break;
      const e2 = 2 * err;
      if (e2 > -dz) { err -= dz; x += sx; }
      if (e2 < dx) { err += dx; z += sz; }
    }
  }

  /** 矩形环（体素线） */
  function rectRing(x1, z1, x2, z2, y, c) {
    for (let x = x1; x <= x2; x++) { set(x, y, z1, c); set(x, y, z2, c); }
    for (let z = z1 + 1; z < z2; z++) { set(x1, y, z, c); set(x2, y, z, c); }
  }

  function speckle(x1, y1, z1, x2, y2, z2, colors, chance = 0.5) {
    for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
      set(x, y, z, R() < chance ? pick(colors) : colors[0]);
    }
  }

  // ── 台基与踏跺 ──────────────────────────────────────────────────────────────
  function plinth(o) {
    const { x, z, w: pw = 10, d = 10, y, h = 1 } = o;
    const cSide = o.c ?? C.stone;
    const cTop = o.top ?? C.marble;
    const x1 = x - pw, x2 = x + pw, z1 = z - d, z2 = z + d;
    for (let i = 0; i < h; i++) box(x1, y + i, z1, x2, y + i, z2, cSide);
    if (o.paved !== false) box(x1 + 1, y + h - 1, z1 + 1, x2 - 1, y + h - 1, z2 - 1, cTop);
    rectRing(x1, z1, x2, z2, y + h - 1, o.edge ?? C.stoneWarm);
    const stepW = o.step ?? 4;
    if (stepW > 0) {
      const dir = o.stepTo || 'south';
      const len = h + 2;
      for (let i = 0; i < len; i++) {
        const yy = y + h - 1 - i;
        if (yy < y) break;
        const cc = i === 0 ? cTop : cSide;
        if (dir === 'south') box(x - stepW, yy, z2 + 1 + i, x + stepW, yy, z2 + 2 + i, cc);
        else if (dir === 'north') box(x - stepW, yy, z1 - 2 - i, x + stepW, yy, z1 - 1 - i, cc);
        else if (dir === 'east') box(x2 + 1 + i, yy, z - stepW, x2 + 2 + i, yy, z + stepW, cc);
        else box(x1 - 2 - i, yy, z - stepW, x1 - 1 - i, yy, z + stepW, cc);
      }
    }
    return { x1, z1, x2, z2, top: y + h - 1 };
  }

  // ── 屋顶 ────────────────────────────────────────────────────────────────────
  function roofOld(o) {
    const type = o.type || 'xieshan';
    const h = o.h || 3;
    const ov = o.overhang ?? 2;
    const up = o.upturn ?? 1;
    const tile = o.tile ?? C.roof;
    const isGlaze = tile === C.glaze || tile === C.glazeGreen;
    const tileDark = o.tileDark ?? (tile === C.glaze ? C.glazeDark : tile === C.glazeGreen ? C.glazeGreen : C.roofDark);
    const tileLight = o.tileLight ?? (tile === C.glaze ? C.glazeLight : C.roofLight);
    const ridgeC = o.ridge ?? (isGlaze ? C.glazeDark : C.ridge);
    const edgeC = o.edge ?? (isGlaze ? C.glazeDark : C.roofEdge);
    const x1 = o.x1 - ov, x2 = o.x2 + ov, z1 = o.z1 - ov, z2 = o.z2 + ov;
    const midX = Math.round((x1 + x2) / 2), midZ = Math.round((z1 + z2) / 2);
    const eaveY = o.y;

    rectRing(x1, z1, x2, z2, eaveY, edgeC);
    for (const [cx, cz] of [[x1, z1], [x2, z1], [x1, z2], [x2, z2]]) {
      const sx = cx < midX ? -1 : 1, sz = cz < midZ ? -1 : 1;
      for (let k = 1; k <= up; k++) {
        set(cx + sx * k, eaveY + k - 1, cz, edgeC);
        set(cx, eaveY + k - 1, cz + sz * k, edgeC);
        set(cx + sx * k, eaveY + k - 1, cz + sz * k, tile);
      }
      set(cx + sx, eaveY + up, cz + sz, edgeC);
    }
    // 檐下椽头/斗拱意象（由 hall/pavilion 的 eaveBand 负责，此处不再覆盖）
    let topY = eaveY;
    if (type === 'pyramid') {
      for (let i = 1; i <= h; i++) {
        const inset = Math.round((i * Math.min(x2 - x1, z2 - z1)) / (2 * (h + 1)));
        if (x1 + inset >= x2 - inset || z1 + inset >= z2 - inset || i === h) {
          set(midX, eaveY + i, midZ, ridgeC);
          set(midX, eaveY + i + 1, midZ, isGlaze ? C.gold : C.ridgeLight);
          set(midX, eaveY + i + 2, midZ, isGlaze ? C.gold : C.bronze);
          topY = eaveY + i + 2;
          break;
        }
        fillRoofLayer(x1 + inset, z1 + inset, x2 - inset, z2 - inset, eaveY + i, tile, tileDark, tileLight, edgeC, ridgeC, true, null);
        topY = eaveY + i;
      }
    } else if (type === 'gable' || type === 'gableRound') {
      for (let i = 1; i <= h; i++) {
        const inset = Math.round((i * ((z2 - z1) / 2)) / (h + 1));
        const az = z1 + inset, bz = z2 - inset;
        if (bz - az <= 1) {
          for (let x = x1 - 1; x <= x2 + 1; x++) set(x, eaveY + i, midZ, type === 'gableRound' ? tile : ridgeC);
          if (type === 'gable') {
            for (let x = x1 - 1; x <= x2 + 1; x++) set(x, eaveY + i + 1, midZ, ridgeC);
            for (const ex of [x1 - 1, x2 + 1]) {
              set(ex, eaveY + i + 1, midZ, ridgeC);
              set(ex, eaveY + i + 2, midZ, isGlaze ? C.gold : C.ridgeLight);
            }
            topY = eaveY + i + 2;
          } else { topY = eaveY + i; }
          break;
        }
        for (let x = x1; x <= x2; x++) {
          const stripe = ((x - x1) >> 1) % 2 === 0;
          const c = stripe ? tile : (R() < 0.18 ? tileLight : tileDark);
          set(x, eaveY + i, az, c);
          set(x, eaveY + i, bz, c);
        }
        for (const gx of [x1, x2]) {
          for (let z = az; z <= bz; z++) set(gx, eaveY + i, z, C.whitewall);
        }
        topY = eaveY + i;
      }
    } else {
      for (let i = 1; i <= h; i++) {
        const inset = Math.round((i * Math.min(x2 - x1, z2 - z1) * 0.5) / (h + 1));
        const ax = x1 + inset, bx = x2 - inset, az = z1 + inset, bz = z2 - inset;
        if (bx - ax <= 1 || bz - az <= 1) break;
        const isHip = type === 'hip';
        fillRoofLayer(ax, az, bx, bz, eaveY + i, tile, tileDark, tileLight, edgeC, ridgeC, false, { ax, bx, az, bz, isHip, i, h });
        topY = eaveY + i;
      }
      let rx1 = x1 + Math.round(h * 0.5), rx2 = x2 - Math.round(h * 0.5);
      let rz1 = z1 + Math.round(h * 0.5);
      if (rx2 <= rx1) { rx1 = midX - 2; rx2 = midX + 2; }
      if (rz1 > midZ) rz1 = midZ;
      if (type === 'xieshan') {
        for (let x = rx1 - 1; x <= rx2 + 1; x++) set(x, topY + 1, rz1, ridgeC);
        for (let x = rx1 - 1; x <= rx2 + 1; x++) if (x < rx1 + 1 || x > rx2 - 1) set(x, topY + 2, rz1, isGlaze ? C.gold : C.ridgeLight);
        set(rx1 - 1, topY + 2, rz1, ridgeC); set(rx2 + 1, topY + 2, rz1, ridgeC);
        topY += 2;
      } else {
        for (let x = rx1; x <= rx2; x++) set(x, topY + 1, rz1, ridgeC);
        topY += 1;
      }
    }
    return topY;
  }

  // ── 新屋顶：逐层退台 1–2 格，形成平缓坡面；山墙/山花、正脊、鸱吻、飞檐 ──────
  function roof(o) {
    const type = o.type || 'xieshan';
    const ov = o.overhang ?? 2;
    const up = o.upturn ?? 1;
    const tile = o.tile ?? C.roof;
    const isGlaze = tile === C.glaze || tile === C.glazeGreen;
    const tileDark = o.tileDark ?? (tile === C.glaze || tile === C.glazeGreen ? C.glazeDark : C.roofDark);
    const tileLight = o.tileLight ?? (tile === C.glaze ? C.glazeLight : C.roofLight);
    const ridgeC = o.ridge ?? (isGlaze ? C.glazeDark : C.ridge);
    const edgeC = o.edge ?? (isGlaze ? C.glazeDark : C.roofEdge);
    const x1 = o.x1 - ov, x2 = o.x2 + ov, z1 = o.z1 - ov, z2 = o.z2 + ov;
    const midX = Math.round((x1 + x2) / 2), midZ = Math.round((z1 + z2) / 2);
    const halfX = (x2 - x1) / 2, halfZ = (z2 - z1) / 2;
    const eaveY = o.y;
    const isGable = type === 'gable' || type === 'gableRound';
    const isPyr = type === 'pyramid';
    const drawTileRow = (ax, bx, y, z, edgeFlag) => {
      for (let x = ax; x <= bx; x++) {
        const edge = edgeFlag || x === ax || x === bx;
        let c;
        if (edge) c = ((x + z) & 3) === 0 ? tile : edgeC;
        else {
          const mod = ((x - ax) % 4 + 4) % 4;
          c = mod === 0 ? tileDark : (mod === 2 && isGlaze ? tileLight : tile);
        }
        set(x, y, z, c);
      }
    };
    const fillLayer = (ax, az, bx, bz, y) => {
      for (let z = az; z <= bz; z++) drawTileRow(ax, bx, y, z, z === az || z === bz);
      // 四角戗脊
      for (const [cx, cz] of [[ax, az], [bx, az], [ax, bz], [bx, bz]]) set(cx, y, cz, ridgeC);
    };
    // 檐口与飞檐
    for (let x = x1; x <= x2; x++) { set(x, eaveY, z1, (x & 1) ? edgeC : tile); set(x, eaveY, z2, (x & 1) ? edgeC : tile); }
    for (let z = z1 + 1; z < z2; z++) { set(x1, eaveY, z, edgeC); set(x2, eaveY, z, edgeC); }
    for (const [cx, cz] of [[x1, z1], [x2, z1], [x1, z2], [x2, z2]]) {
      const sx = cx < midX ? -1 : 1, sz = cz < midZ ? -1 : 1;
      for (let k = 1; k <= up; k++) {
        set(cx + sx * k, eaveY + k - 1, cz, edgeC);
        set(cx, eaveY + k - 1, cz + sz * k, edgeC);
        set(cx + sx * k, eaveY + k - 1, cz + sz * k, tile);
      }
      set(cx + sx, eaveY + up, cz + sz, edgeC);
      set(cx + sx * 2, eaveY + up, cz + sz * 2, edgeC);
    }
    const hBase = isGable ? halfZ : Math.min(halfX, halfZ);
    let h;
    if (isPyr) h = Math.max(2, Math.min(8, o.h ?? Math.round(hBase * 0.55)));
    else h = Math.max(2, Math.min(8, Math.max(o.h ?? 3, Math.round(hBase * 0.7))));
    const stepZ = Math.max(1, Math.round(halfZ / h));
    const stepX = isGable ? 0 : Math.max(1, Math.round(halfZ / h));
    let ax = x1, bx = x2, az = z1, bz = z2;
    let topY = eaveY;
    for (let i = 1; i <= h + 2; i++) {
      az = z1 + i * stepZ; bz = z2 - i * stepZ;
      if (!isGable) { ax = x1 + i * stepX; bx = x2 - i * stepX; }
      if (bz < az) { az = bz = midZ; }
      if (bx < ax) { ax = bx = midX; }
      const y = eaveY + i;
      fillLayer(ax, az, bx, bz, y);
      if (isGable) {
        for (let z = az; z <= bz; z++) { set(ax, y, z, C.whitewall); set(bx, y, z, C.whitewall); }
      }
      topY = y;
      if (az === bz && (isGable || isPyr || ax === bx)) break;
      if (ax === bx && az === bz) break;
    }
    // 正脊/宝顶
    if (isPyr) {
      set(midX, topY + 1, midZ, ridgeC);
      set(midX, topY + 2, midZ, isGlaze ? C.gold : C.ridgeLight);
      set(midX, topY + 3, midZ, isGlaze ? C.gold : C.bronze);
      topY += 3;
    } else if (type === 'gableRound') {
      for (let x = x1 - 1; x <= x2 + 1; x++) set(x, topY + 1, midZ, tileDark);
      topY += 1;
    } else if (type === 'gable') {
      for (let x = x1 - 1; x <= x2 + 1; x++) set(x, topY + 1, midZ, ridgeC);
      for (let x = x1; x <= x2; x++) set(x, topY + 2, midZ, ridgeC);
      for (const ex of [x1 - 1, x2 + 1]) {
        set(ex, topY + 1, midZ, ridgeC);
        set(ex, topY + 2, midZ, isGlaze ? C.gold : C.ridgeLight);
        set(ex, topY + 3, midZ, isGlaze ? C.gold : C.ridgeLight);
      }
      topY += 3;
    } else {
      const rx1 = Math.min(ax, bx), rx2 = Math.max(ax, bx);
      for (let x = rx1 - 1; x <= rx2 + 1; x++) set(x, topY + 1, midZ, ridgeC);
      for (let x = rx1; x <= rx2; x++) set(x, topY + 2, midZ, isGlaze ? C.glazeLight : C.ridgeLight);
      for (const ex of [rx1 - 1, rx2 + 1]) {
        set(ex, topY + 1, midZ, ridgeC);
        set(ex, topY + 2, midZ, isGlaze ? C.gold : C.ridge);
        set(ex, topY + 3, midZ, isGlaze ? C.gold : C.ridgeLight);
      }
      topY += 3;
    }
    if (DET.roofs) DET.roofs.push({
      x1, z1, x2, z2, eaveY, ridgeY: topY, type,
      tile, edge: edgeC, ridge: ridgeC, upturn: up,
      style: isGlaze ? 'imperial' : 'residential',
      ridgeAxis: 'x',
      ridgeRun: { x1: Math.min(o.x1, o.x2), x2: Math.max(o.x1, o.x2), z: Math.round((z1 + z2) / 2) },
    });
    return topY;
  }

  function fillRoofLayer(ax, az, bx, bz, y, tile, tileDark, tileLight, edgeC, ridgeC, pyramid, meta) {
    if (bx < ax || bz < az) return;
    for (let z = az; z <= bz; z++) {
      for (let x = ax; x <= bx; x++) {
        const edge = x === ax || x === bx || z === az || z === bz;
        let c;
        if (edge) c = ((x + z) & 3) === 0 ? tile : edgeC;
        else if (meta && !meta.isHip && meta.i > meta.h * 0.5 && (x === ax + 1 || x === bx - 1)) c = C.whitewall;
        else {
          const stripe = ((x - ax) >> 1) % 2 === 0;
          c = stripe ? tile : tileDark;
          if (R() < 0.1) c = tileLight;
        }
        set(x, y, z, c);
      }
    }
    for (const [cx, cz] of [[ax, az], [bx, az], [ax, bz], [bx, bz]]) set(cx, y, cz, ridgeC);
  }

  // ── 墙体 ────────────────────────────────────────────────────────────────────
  function wall(o) {
    const th = o.th || 1;
    const h = o.h || 5;
    const c = o.c ?? C.whitewall;
    const cap = o.cap ?? C.roof;
    const x1 = Math.min(o.x1, o.x2), x2 = Math.max(o.x1, o.x2);
    const z1 = Math.min(o.z1, o.z2), z2 = Math.max(o.z1, o.z2);
    for (let i = 0; i < h; i++) {
      const y = o.y + i;
      const cc = i < 1 ? (o.base ?? C.wallBase) : c;
      if (x1 === x2) box(x1, y, z1, x1 + th - 1, y, z2, cc);
      else if (z1 === z2) box(x1, y, z1, x2, y, z1 + th - 1, cc);
      else box(x1, y, z1, x2, y, z2, cc);
    }
    if (z1 === z2) {
      box(x1 - 1, o.y + h, z1 - 1, x2 + 1, o.y + h, z1 + th, cap);
      box(x1 - 1, o.y + h + 1, z1 + Math.floor(th / 2), x2 + 1, o.y + h + 1, z1 + Math.floor(th / 2), C.roofDark);
    } else if (x1 === x2) {
      box(x1 - 1, o.y + h, z1 - 1, x1 + th, o.y + h, z2 + 1, cap);
      box(x1 + Math.floor(th / 2), o.y + h + 1, z1 - 1, x1 + Math.floor(th / 2), o.y + h + 1, z2 + 1, C.roofDark);
    }
    return o.y + h;
  }

  function wallRect(o) {
    const { x1, z1, x2, z2 } = o;
    const h = o.h || 5, th = o.th || 2, c = o.c ?? C.whitewall;
    const y = o.y;
    wall({ x1, z1, x2, z2: z1, y, h, th, c });
    wall({ x1, z1: z2, x2, z2, y, h, th, c });
    wall({ x1, z1, x2: x1, z2, y, h, th, c });
    wall({ x1: x2, z1, x2, z2, y, h, th, c });
    const gates = o.gates || [];
    for (const g of gates) {
      if (g.side === 'south' || !g.side) {
        const gx = x1 + 1 + Math.round((g.at ?? 0.5) * (x2 - x1 - 2));
        const gw = g.w || 5;
        w.clear(gx - gw, y, z2 - th, gx + gw, y + h - 1, z2 + 1);
        box(gx - gw, y, z2 - 1, gx - gw, y + h - 1, z2, C.stone);
        box(gx + gw, y, z2 - 1, gx + gw, y + h - 1, z2, C.stone);
        box(gx - gw, y + h, z2 - 1, gx + gw, y + h, z2, C.roof);
        const cells = [];
        for (let x = gx - gw + 1; x <= gx + gw - 1; x++) {
          for (let yy = y; yy < y + h - 1; yy++) { set(x, yy, z2, C.woodRed); cells.push([x, yy, z2]); }
        }
        for (let x = gx - gw + 2; x <= gx + gw - 2; x += 2) {
          for (let yy = y + 1; yy < y + h - 2; yy += 2) set(x, yy, z2, C.gold);
        }
        for (const [cx, cy, cz] of cells) w.set(cx, cy, cz, 0);
        DET.doors.push({
          x: gx - gw + 1, y, z: z2, axis: 'x', w: 2 * gw - 1, h: h - 1,
          leafColor: C.woodRed, hinge: 'left', openTowards: 1, label: '院门',
          cells, open: 1, target: 1,
        });
      }
    }
    if (o.windows !== false) {
      for (const s of (o.windowSpots || [])) {
        latticeWindow({ x: s.x, y: y + 2, z: s.z, axis: s.axis || 'x', w: 3, h: 2, cFrame: C.stoneWarm, cLattice: C.windowGreen });
      }
    }
    return y + h + 1;
  }

  function moonGate(o) {
    const axis = o.axis || 'z';
    const r = o.r || 2;
    const y = o.y;
    const th = o.th || 2;
    const x = o.x, z = o.z;
    for (let dy = 0; dy <= r * 2; dy++) {
      for (let dt = -r; dt <= r; dt++) {
        const yy = y + dy;
        if ((dt * dt) / (r * r) + Math.pow((dy - r) / r, 2) <= 1) {
          if (axis === 'z') { for (let t = 0; t < th + 1; t++) w.set(x + t, yy, z + dt, 0); }
          else { for (let t = 0; t < th + 1; t++) w.set(x + dt, yy, z + t, 0); }
        }
      }
    }
    for (let a = 0; a < 48; a++) {
      const ang = (a / 48) * Math.PI * 2;
      const dt = Math.round(Math.cos(ang) * (r + 0.8));
      const yy = y + r + Math.round(Math.sin(ang) * (r + 0.8));
      if (axis === 'z') set(x, yy, z + dt, C.marble);
      else set(x + dt, yy, z, C.marble);
    }
  }

  function latticeWindow(o) {
    const axis = o.axis || 'x';
    const ww = o.w || 3, hh = o.h || 2;
    const cF = o.cFrame ?? C.woodRed, cL = o.cLattice ?? C.windowGreen;
    for (let i = 0; i < ww; i++) {
      for (let j = 0; j < hh; j++) {
        const c = (i === 0 || i === ww - 1 || j === 0 || j === hh - 1) ? cF
          : ((i + j) % 2 === 0 ? cL : C.windowGlow);
        if (axis === 'x') set(o.x + i, o.y + j, o.z, c);
        else set(o.x, o.y + j, o.z + i, c);
      }
    }
    if (DET.lattices) DET.lattices.push({
      x: o.x, y: o.y, z: o.z, axis, w: ww, h: hh,
      frame: cF, lattice: cL, style: o.style || 'step',
    });
    for (let i = 0; i < ww; i++) for (let j = 0; j < hh; j++) {
      if (axis === 'x') w.hide(o.x + i, o.y + j, o.z);
      else w.hide(o.x, o.y + j, o.z + i);
    }
  }

  function door(o) {
    const axis = o.axis || 'x';
    const ww = o.w || 4, hh = o.h || 3;
    const c = o.c ?? C.woodRed;
    const cells = [];
    for (let i = 0; i < ww; i++) {
      for (let j = 0; j < hh; j++) {
        const frame = i === 0 || i === ww - 1;
        const c2 = frame ? C.woodDark : c;
        const px = axis === 'x' ? o.x + i : o.x;
        const pz = axis === 'x' ? o.z : o.z + i;
        set(px, o.y + j, pz, c2);
        cells.push([px, o.y + j, pz]);
      }
    }
    if (o.studs) {
      for (let i = 1; i < ww - 1; i += 2) for (let j = 1; j < hh - 1; j += 2) {
        if (axis === 'x') set(o.x + i, o.y + j, o.z, C.gold);
        else set(o.x, o.y + j, o.z + i, C.gold);
      }
    }
    // 门扇交给精细网格（可开合）；体素清空（仅保留门格记录供步行碰撞/开合状态）
    for (const [x, y, z] of cells) w.set(x, y, z, 0);
    DET.doors.push({
      x: o.x, y: o.y, z: o.z, axis, w: ww, h: hh, leafColor: c,
      hinge: o.hinge || 'left', openTowards: o.openTowards ?? 1,
      label: o.label || '', cells, open: 1, target: 1,
    });
  }

  // ── 栏杆 ────────────────────────────────────────────────────────────────────
  function railing(o) {
    const style = o.style || 'wood';
    const c = o.c ?? (style === 'stone' ? C.marble : style === 'bamboo' ? C.bambooStalk : C.redRail);
    const h = o.h ?? 2;
    const postC = style === 'stone' ? C.marbleShade : c;
    const pts = [];
    line(o.x1, o.z1, o.x2, o.z2, (x, z) => pts.push([x, z]));
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i];
      if (i % 4 === 0) {
        for (let k = 0; k < h + 1; k++) set(x, o.y + k, z, postC);
        set(x, o.y + h + 1, z, style === 'stone' ? C.marbleShade : C.redDark);
      } else {
        set(x, o.y + h, z, c);
        if (style !== 'stone') set(x, o.y + 1, z, c);
      }
    }
    if (DET.railings) DET.railings.push({
      x1: o.x1, z1: o.z1, x2: o.x2, z2: o.z2, y: o.y,
      style, color: c, h: o.h ?? 2,
    });
    // 体素栏杆由精细栏杆网格替换（不进入体素网格；仍保留碰撞意义）
    for (const [x, z] of pts) {
      for (let k = 0; k <= h + 1; k++) w.hide(x, o.y + k, z);
    }
  }

  // ── 亭 ──────────────────────────────────────────────────────────────────────
  function pavilion(o) {
    const size = o.size || 8;
    const y = o.y;
    const half = Math.floor(size / 2);
    const x = o.x, z = o.z;
    const plinthH = o.plinthH ?? 1;
    plinth({ x, z, w: half + 2, d: half + 2, y, h: plinthH, c: C.stone, top: C.stoneLight, step: o.step ?? 3 });
    const floorY = y + plinthH;
    const columnH = o.columnH ?? 4;
    const postC = o.columns ?? C.redPillar;
    const pts = [];
    if (o.shape === 'hex') {
      const r = half + 1;
      for (let a = 0; a < 6; a++) {
        const ang = (a / 6) * Math.PI * 2 + Math.PI / 6;
        pts.push([Math.round(x + Math.cos(ang) * r), Math.round(z + Math.sin(ang) * r)]);
      }
    } else {
      pts.push([x - half, z - half], [x + half, z - half], [x - half, z + half], [x + half, z + half]);
      if (size >= 10) pts.push([x, z - half], [x, z + half], [x - half, z], [x + half, z]);
    }
    for (const [px, pz] of pts) {
      column(px, pz, floorY, columnH + 1, postC);
      for (let i = 0; i < columnH + 1; i++) w.hide(px, floorY + i, pz);
    }
    if (DET.columns) for (const [px, pz] of pts) DET.columns.push({
      x: px, z: pz, y: floorY, h: columnH + 1, r: 0.22, color: postC,
      base: C.stoneWarm, cap: C.gold, style: 'wood',
    });
    if (o.rail !== false) {
      const rInset = 1;
      railing({ x1: x - half + rInset, z1: z - half, x2: x + half - rInset, z2: z - half, y: floorY, style: o.railStyle || 'wood', c: o.railC ?? C.redRail });
      railing({ x1: x - half + rInset, z1: z + half, x2: x + half - rInset, z2: z + half, y: floorY, style: o.railStyle || 'wood', c: o.railC ?? C.redRail });
      railing({ x1: x - half, z1: z - half + rInset, x2: x - half, z2: z + half - rInset, y: floorY, style: o.railStyle || 'wood', c: o.railC ?? C.redRail });
      railing({ x1: x + half, z1: z - half + rInset, x2: x + half, z2: z + half - rInset, y: floorY, style: o.railStyle || 'wood', c: o.railC ?? C.redRail });
    }
    eaveBand({ x1: x - half, z1: z - half, x2: x + half, z2: z + half, y: floorY + columnH - 1 });
    const roofY = floorY + columnH;
    const tile = o.tile || C.roof;
    const topY = roof({ x1: x - half - 1, z1: z - half - 1, x2: x + half + 1, z2: z + half + 1, y: roofY, h: o.roofH ?? 3, type: o.roof || 'pyramid', tile, overhang: o.overhang ?? 2, upturn: o.upturn ?? 2 });
    if (o.plaque) plaque({ x, y: floorY + columnH - 1, z: z + half + 1, dir: 'south', text: o.plaque, w: Math.min(7, size - 1), h: 2 });
    if (DET.furniture) {
      DET.furniture.push(
        { kind: 'squareTable', x: x + 0.5, y: floorY, z: z + 0.5, rotY: 0, size: Math.min(3.2, half * 0.8) },
        { kind: 'stool', x: x - 1.6, y: floorY, z: z + 0.5, rotY: 0 },
        { kind: 'stool', x: x + 2.6, y: floorY, z: z + 0.5, rotY: 0 },
        { kind: 'stool', x: x + 0.5, y: floorY, z: z - 1.1, rotY: 0 },
        { kind: 'stool', x: x + 0.5, y: floorY, z: z + 2.1, rotY: 0 },
      );
    }
    return { topY, floorY };
  }

  // ── 檐下彩画带 ──────────────────────────────────────────────────────────────
  function eaveBand(o) {
    const y = o.y;
    let idx = 0;
    const draw = (x, z) => {
      const c = idx % 5 === 0 ? C.gold : idx % 2 === 0 ? C.teal : C.greenPaint;
      set(x, y, z, c);
      idx++;
    };
    for (let x = o.x1; x <= o.x2; x++) { draw(x, o.z1); draw(x, o.z2); }
    for (let z = o.z1 + 1; z < o.z2; z++) { draw(o.x1, z); draw(o.x2, z); }
  }

  // ── 厅堂 ────────────────────────────────────────────────────────────────────
  function hall(o) {
    const bays = o.bays || 3;
    const bayW = o.bayW || 4;
    const depth = o.depth || 9;
    const x = o.x, z = o.z, y = o.y;
    const halfW = Math.round((bays * bayW) / 2);
    const halfD = Math.round(depth / 2);
    const plinthH = o.plinthH ?? 1;
    plinth({ x, z, w: halfW + 2, d: halfD + 2, y, h: plinthH, c: o.plinthC ?? C.stone, top: o.plinthTop ?? C.stoneLight, step: Math.min(6, bayW), stepTo: o.stepDir || 'south' });
    const floorY = y + plinthH;
    const wallH = o.wallH ?? 4;
    const columnH = o.columnH ?? wallH;
    box(x - halfW + 1, floorY - 1, z - halfD + 1, x + halfW - 1, floorY - 1, z + halfD - 1, o.floorC ?? C.stoneWarm);
    const colC = o.columns ?? C.redPillar;
    const wallC = o.wall ?? C.whitewall;
    const frontZ = z + halfD - 1, backZ = z - halfD + 1;
    const porch = o.porch ?? 0;
    const colFrontZ = frontZ + porch;
    for (let b = 0; b <= bays; b++) {
      const px = x - halfW + Math.round(b * bayW);
      column(px, colFrontZ, floorY, columnH, colC);
      column(px, backZ, floorY, columnH, colC);
      for (const pz of [colFrontZ, backZ]) for (let i = 0; i < columnH; i++) w.hide(px, floorY + i, pz);
    }
    if (DET.columns) for (let b = 0; b <= bays; b++) {
      const px = x - halfW + Math.round(b * bayW);
      for (const pz of [colFrontZ, backZ]) DET.columns.push({
        x: px, z: pz, y: floorY, h: columnH, r: 0.22, color: colC,
        base: C.stoneWarm, cap: C.gold, style: 'wood',
      });
    }
    for (let zz = backZ; zz <= frontZ; zz++) {
      for (let yy = floorY; yy < floorY + wallH; yy++) {
        set(x - halfW, yy, zz, yy < floorY + 1 ? C.wallBase : wallC);
        set(x + halfW, yy, zz, yy < floorY + 1 ? C.wallBase : wallC);
      }
    }
    for (let xx = x - halfW; xx <= x + halfW; xx++) {
      for (let yy = floorY; yy < floorY + wallH; yy++) set(xx, yy, backZ, yy < floorY + 1 ? C.wallBase : wallC);
    }
    for (let xx = x - halfW; xx <= x + halfW; xx++) {
      for (let yy = floorY; yy < floorY + wallH; yy++) {
        const local = xx - (x - halfW);
        if (local % bayW === 0) continue;
        const bayIdx = Math.min(bays - 1, Math.floor(local / bayW));
        const mid = Math.floor(bays / 2);
        const isDoorBay = bayIdx === mid && Math.abs(local - Math.round((mid + 0.5) * bayW)) < Math.max(2, bayW - 1);
        if (isDoorBay) continue;
        const winJ = yy - floorY;
        if (winJ >= 1 && winJ <= 2) {
          set(xx, yy, frontZ, ((xx + yy) & 3) === 0 ? C.windowGreen : C.windowGlow);
        } else {
          set(xx, yy, frontZ, yy < floorY + 1 ? C.wallBase : wallC);
        }
      }
    }
    const doorW = Math.max(3, bayW - 1);
    door({ x: x - Math.floor(doorW / 2), y: floorY, z: frontZ, axis: 'x', w: doorW, h: Math.max(2, wallH - 1), c: o.doorC ?? C.woodRed, studs: bays >= 5, label: o.plaque || o.name || '' });
    eaveBand({ x1: x - halfW, z1: colFrontZ, x2: x + halfW, z2: backZ, y: floorY + wallH - 1 });
    if (o.interior !== false) {
      const roomW = halfW * 2 - 3;
      const roomD = Math.max(3, (frontZ - backZ) - 2);
      const cz = z;
      const f = DET.furniture;
      if (f) {
        f.push({ kind: 'screen', x: x + 0.5, y: floorY, z: backZ + 1.15, rotY: 0, w: Math.min(roomW, 7.5), h: Math.min(4.2, wallH - 0.6) });
        f.push({ kind: 'painting', x: x + 0.5, y: floorY + 2.35, z: backZ + 1.08, rotY: 0, w: 1.5, h: 2.2 });
        f.push({ kind: 'altar', x: x + 0.5, y: floorY, z: backZ + 2.4, rotY: 0, w: Math.min(3.6, roomW * 0.5) });
        f.push({ kind: 'vase', x: x - Math.min(2.2, roomW * 0.32), y: floorY, z: backZ + 2.3, rotY: 0 });
        f.push({ kind: 'incense', x: x + Math.min(2.2, roomW * 0.32), y: floorY, z: backZ + 2.3, rotY: 0 });
        f.push({ kind: 'chair', x: x - 1.4, y: floorY, z: backZ + 3.6, rotY: Math.PI });
        f.push({ kind: 'chair', x: x + 1.4, y: floorY, z: backZ + 3.6, rotY: Math.PI });
        f.push({ kind: 'table', x: x + 0.5, y: floorY, z: Math.min(cz, backZ + 4.8), rotY: 0, w: Math.min(2.4, roomW * 0.4) });
        f.push({ kind: 'chair', x: x - 1.9, y: floorY, z: Math.min(cz + 0.8, frontZ - 2), rotY: Math.PI / 2 });
        f.push({ kind: 'chair', x: x + 2.9, y: floorY, z: Math.min(cz + 0.8, frontZ - 2), rotY: -Math.PI / 2 });
        f.push({ kind: 'rug', x: x + 0.5, y: floorY, z: cz, rotY: 0, w: Math.max(2.5, roomW - 2), d: Math.max(2.5, roomD - 1) });
        for (const lx of [x - halfW + 1.2, x + halfW - 0.2]) {
          f.push({ kind: 'lantern', x: lx, y: floorY + Math.min(3.1, columnH - 0.6), z: frontZ - 1.2, rotY: 0 });
        }
        for (const sx of [x - halfW + 1.6, x + halfW - 0.6]) {
          f.push({ kind: 'pottedPlant', x: sx, y: floorY, z: backZ + 1.5, rotY: 0 });
        }
      }
      // 室内陈设由精细网格承担（屏风/家具/灯烛）；不再放体素底衬，避免挡住画心
    }
    const roofY = floorY + columnH;
    const topY = roof({
      x1: x - halfW, z1: backZ - 1, x2: x + halfW, z2: frontZ + porch + 1,
      y: roofY, h: o.roofH ?? Math.max(2, Math.round(depth * 0.3)),
      type: o.roof ?? 'xieshan', tile: o.tile ?? C.roof, overhang: o.overhang ?? 2, upturn: o.upturn ?? 1,
    });
    if (o.plaque) plaque({ x, y: floorY + wallH - 1, z: frontZ + 1, dir: 'south', text: o.plaque, w: Math.min(8, bayW + 3), h: 2 });
    if (o.couplets && o.couplets.length) {
      const left = o.couplets[0], right = o.couplets[1] || '';
      couplet({ x: x - halfW + 1, y: floorY + 1, z: frontZ + 1, dir: 'south', text: left, w: 1, h: 5 });
      if (right) couplet({ x: x + halfW - 1, y: floorY + 1, z: frontZ + 1, dir: 'south', text: right, w: 1, h: 5 });
    }
    return { x1: x - halfW, x2: x + halfW, z1: backZ, z2: frontZ, floorY, topY };
  }

  // ── 游廊 ────────────────────────────────────────────────────────────────────
  function corridor(o) {
    const pts = o.pts || [];
    const wdt = o.w || 3;
    const y = o.y;
    const colC = o.columnsC ?? C.greenPillar;
    const roofC = o.roofC ?? C.roof;
    const railC = o.railC ?? C.redRail;
    if (pts.length < 2) return;
    const half = Math.floor(wdt / 2);
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      line(x1, z1, x2, z2, (x, z) => {
        for (let dx = -half; dx <= half; dx++) for (let dz = -half; dz <= half; dz++) {
          set(x + dx, y, z + dz, (x + dx + z + dz) % 5 === 0 ? C.path2 : (o.floorC ?? C.path3));
        }
      });
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      const alongZ = Math.abs(z2 - z1) > Math.abs(x2 - x1);
      let n = 0;
      line(x1, z1, x2, z2, (x, z) => {
        if (n % 4 === 0) {
          if (alongZ) { column(x - half, z, y + 1, 3, colC); column(x + half, z, y + 1, 3, colC); }
          else { column(x, z - half, y + 1, 3, colC); column(x, z + half, y + 1, 3, colC); }
        }
        if (alongZ) { set(x - half, y + 2, z, railC); set(x + half, y + 2, z, railC); }
        else { set(x, y + 2, z - half, railC); set(x, y + 2, z + half, railC); }
        n++;
      });
      if (alongZ) {
        for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) {
          for (let k = 0; k <= 2; k++) {
            const ins = k;
            box(x1 - half + ins, y + 4 + k, z, x1 + half - ins, y + 4 + k, z, k === 0 ? C.roofEdge : (k === 1 ? roofC : C.roofDark));
          }
          set(x1, y + 6, z, C.ridge);
        }
      } else {
        for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
          for (let k = 0; k <= 2; k++) {
            const ins = k;
            box(x, y + 4 + k, z1 - half + ins, x, y + 4 + k, z1 + half - ins, k === 0 ? C.roofEdge : (k === 1 ? roofC : C.roofDark));
          }
          set(x, y + 6, z1, C.ridge);
        }
      }
    }
  }

  // ── 桥 ──────────────────────────────────────────────────────────────────────
  function bridge(o) {
    const len = o.len || 20, wid = o.wid || 6;
    const dirX = (o.dir || 'x') === 'x';
    const y = o.y ?? 4;
    const x = o.x, z = o.z;
    const halfLen = Math.floor(len / 2), halfWid = Math.floor(wid / 2);
    const type = o.type || 'stone1';
    const railC = o.rail ?? (type === 'wood' || type === 'bamboo' ? C.redRail : C.marble);
    const deckC = type === 'wood' ? C.wood : type === 'bamboo' ? C.bambooStalk : C.stoneLight;
    const isBamboo = type === 'bamboo';
    for (let i = -halfLen; i <= halfLen; i++) {
      const t = i / halfLen;
      const lift = type === 'stone3' ? Math.round((1 - t * t) * 2) : type === 'stone1' ? Math.round((1 - t * t) * 1) : isBamboo ? Math.round((1 - t * t) * 1) : 0;
      const yy = y + lift;
      for (let j = -halfWid; j <= halfWid; j++) {
        const px = dirX ? x + i : x + j;
        const pz = dirX ? z + j : z + i;
        set(px, yy, pz, (i & 1) === 0 ? deckC : (type === 'wood' ? C.woodDark : C.stone));
        if (Math.abs(j) === halfWid) {
          set(px, yy + 1, pz, railC);
          set(px, yy + 2, pz, railC);
          if (i % 4 === 0) set(px, yy + 3, pz, type.startsWith('stone') ? C.marbleShade : railC);
        }
      }
      if (type.startsWith('stone') && (i === -Math.round(halfLen * 0.5) || i === 0 || i === Math.round(halfLen * 0.5))) {
        for (let dy = -4; dy < 0; dy++) {
          for (let j = -halfWid + 1; j <= halfWid - 1; j++) {
            const px = dirX ? x + i : x + j;
            const pz = dirX ? z + j : z + i;
            set(px, yy + dy, pz, C.stone);
          }
        }
      }
    }
    return { deckY: y };
  }

  // ── 牌坊 ────────────────────────────────────────────────────────────────────
  function archway(o) {
    const x = o.x, z = o.z, y = o.y;
    const dirX = (o.dir || 'x') === 'x';
    const h = o.h || 10;
    const c = o.c ?? C.marble;
    const span = o.span || 16;
    const pts = [-span, -Math.round(span / 3), Math.round(span / 3), span].map((p) => dirX ? [x + p, z] : [x, z + p]);
    for (const [px, pz] of pts) {
      for (let k = 0; k < h; k++) set(px, y + k, pz, k < 2 ? C.stoneWarm : c);
      set(px, y + h, pz, C.marbleShade);
    }
    for (const level of [Math.round(h * 0.55), Math.round(h * 0.7)]) {
      for (let i = -span; i <= span; i++) {
        const px = dirX ? x + i : x;
        const pz = dirX ? z : z + i;
        set(px, y + level, pz, level === Math.round(h * 0.55) ? C.marbleShade : c);
      }
    }
    if (o.plaque) plaque({ x, y: y + Math.round(h * 0.46), z: dirX ? z - 1 : z, dir: 'south', text: o.plaque, w: Math.min(10, Math.round(span * 0.7)), h: 2, boardColor: C.marble, textColor: C.stoneDark });
    for (const cx of [0, -Math.round(span * 0.66), Math.round(span * 0.66)]) {
      const cw = Math.round(span / 3);
      const left = Math.round(cx - cw), right = Math.round(cx + cw);
      if (dirX) roof({ x1: x + left, z1: z - 2, x2: x + right, z2: z + 2, y: y + Math.round(h * 0.78), h: 2, type: 'gable', tile: o.tile ?? C.glazeGreen, overhang: 1, upturn: 1 });
      else roof({ x1: x - 2, z1: z + left, x2: x + 2, z2: z + right, y: y + Math.round(h * 0.78), h: 2, type: 'gable', tile: o.tile ?? C.glazeGreen, overhang: 1, upturn: 1 });
    }
    return { topY: y + h + 3 };
  }

  // ── 篱笆 ────────────────────────────────────────────────────────────────────
  function fence(o) {
    const pts = o.pts || [];
    const h = o.h || 3;
    const c = o.c ?? C.bambooStalk;
    for (let i = 0; i < pts.length - 1; i++) {
      line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], (x, z) => {
        const gy = ctx.groundY ? ctx.groundY(x, z) : w.topY(x, z);
        for (let k = 0; k < h; k++) setIfEmpty(x, gy + 1 + k, z, k === 0 || k === h - 1 ? C.bambooNode : c);
      });
    }
  }

  // ── 贴片 ────────────────────────────────────────────────────────────────────
  function plaque(o) {
    decals.push({
      kind: 'plaque', text: o.text || '', x: o.x, y: o.y, z: o.z, dir: o.dir || 'south',
      w: o.w || 8, h: o.h || 3, board: o.boardColor ?? C.plaqueBoard, ink: o.textColor ?? C.goldText, frame: o.frameColor ?? C.gold,
    });
    // 匾额两侧短托（深木色），不做整条金框
    if (o.dir === 'south' || o.dir === 'north') {
      const half = Math.round((o.w || 8) / 2);
      set(o.x - half - 1, o.y + 1, o.z, C.woodDark);
      set(o.x + half + 1, o.y + 1, o.z, C.woodDark);
    }
  }
  function couplet(o) {
    decals.push({
      kind: 'couplet', text: o.text || '', x: o.x, y: o.y, z: o.z, dir: o.dir || 'south',
      w: o.w || 1, h: o.h || 6, board: o.boardColor ?? C.plaqueBoard, ink: o.textColor ?? C.goldText, frame: o.frameColor ?? C.gold,
    });
  }
  function banner(o) {
    decals.push({ kind: 'banner', text: o.text || '杏帘在望', x: o.x, y: o.y, z: o.z, dir: o.dir || 'south', w: 2, h: 7, board: C.plaqueBoard, ink: C.goldText, frame: C.gold });
  }

  function lantern(o) {
    const { x, y, z } = o;
    const body = o.red ? C.lampRed : C.lamp;
    // 挂钩与灯绳
    set(x, y + 4, z, C.woodDark);
    set(x, y + 3, z, C.ink);
    // 灯身（2×2×2 鼓形）
    for (let dy = 1; dy <= 2; dy++) {
      for (let dx = 0; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) set(x + dx, y + dy, z + dz, body);
    }
    // 上下金盖
    for (let dx = 0; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) {
      set(x + dx, y + 3, z + dz, C.goldDark);
      set(x + dx, y, z + dz, C.goldDark);
    }
    set(x, y - 1, z, C.gold);
  }
  function stoneLampStand(x, z) {
    const g = (ctx.groundY ? ctx.groundY(x, z) : w.topY(x, z)) + 1;
    for (let k = 0; k < 2; k++) rectRing(x - 1, z - 1, x + 1, z + 1, g + k, C.stoneWarm);
    set(x, g + 2, z, C.stoneLight);
    set(x, g + 3, z, C.stoneLight);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (Math.abs(dx) + Math.abs(dz) < 2) set(x + dx, g + 4, z + dz, C.stoneLight);
      w.set(x + dx, g + 4, z + dz, C.lampWarm);
    }
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) set(x + dx, g + 5, z + dz, C.stoneWarm);
    set(x, g + 6, z, C.stoneLight);
  }
  function tableSet(o) {
    const { x, z, y } = o;
    const s = o.size || 2;
    box(x - s, y, z - s, x + s, y, z + s, C.stoneLight);
    box(x - 1, y + 1, z - 1, x + 1, y + 1, z + 1, C.stone);
    for (const [dx, dz] of [[-s - 2, 0], [s + 2, 0], [0, -s - 2], [0, s + 2]]) {
      box(x + dx, y, z + dz, x + dx, y + 1, z + dz, C.stone);
    }
  }
  function pot(o) {
    const { x, z, y } = o;
    for (let k = 0; k < 2; k++) rectRing(x - 1, z - 1, x + 1, z + 1, y + k, C.stoneWarm);
    set(x, y + 2, z, C.leafLight);
    set(x + 1, y + 2, z, C.leaf);
  }

  // ── 山石 ────────────────────────────────────────────────────────────────────
  function rock(o) {
    const s = o.size || 4;
    const h = o.h || 3;
    const gy = o.y ?? (ctx.groundY ? ctx.groundY(o.x, o.z) + 1 : w.topY(o.x, o.z) + 1);
    for (let i = 0; i < s * 3; i++) {
      const dx = Math.round((R() - 0.5) * s * 2);
      const dz = Math.round((R() - 0.5) * s * 2);
      const hh = 1 + Math.round(R() * h);
      for (let k = 0; k < hh; k++) {
        if (R() < 0.9) setIfEmpty(o.x + dx, gy + k, o.z + dz, k === hh - 1 ? pick([C.rockLight, C.mossRock, C.taihu]) : pick([C.rock, C.rockDark, C.taihu]));
      }
    }
  }

  function rockery(o) {
    const x1 = o.x1, z1 = o.z1, x2 = o.x2, z2 = o.z2;
    const h = o.h || 10;
    const baseY = o.y ?? (ctx.groundY ? ctx.groundY(Math.round((x1 + x2) / 2), Math.round((z1 + z2) / 2)) + 1 : 4);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const rx = Math.max(2, (x2 - x1) / 2), rz = Math.max(2, (z2 - z1) / 2);
    const seed = o.seed || 7;
    const peaks = o.peaks || [];
    const ridge = (x, z) => {
      const a = Math.sin(x * 0.31 + seed * 1.7) * Math.cos(z * 0.27 - seed * 0.9);
      const b = Math.sin(x * 0.11 - z * 0.13 + seed * 2.3) * 0.7;
      const c = Math.sin(x * 0.62 + z * 0.55 + seed) * 0.28;
      return (a + b + c + 1.9) / 3.8; // 0..1
    };
    const heightAt = (x, z) => {
      const nd = Math.sqrt(((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2);
      if (nd > 1.02) return 0;
      let hh = h * Math.pow(Math.max(0, 1 - nd * nd), 0.72) * (0.55 + 0.55 * ridge(x, z));
      for (const p of peaks) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < (p.r || 10)) hh = Math.max(hh, p.h * Math.pow(1 - d / (p.r || 10), 1.25));
      }
      // 叠石台层
      let r = Math.round(hh);
      if (r > 2 && r % 4 === 0) r = Math.max(2, r - 1);
      return r;
    };
    const rockCols = [C.rockDark, C.rock, C.rock, C.rockLight, C.taihu, C.rockGarden, C.stoneDark];
    for (let z = z1; z <= z2; z++) {
      for (let x = x1; x <= x2; x++) {
        let hh = heightAt(x, z);
        if (hh < 1) continue;
        for (let k = 0; k < hh; k++) {
          const exposed = k === hh - 1;
          let c;
          if (exposed) {
            const n = ridge(x * 1.7, z * 1.7);
            c = n < 0.28 ? C.mossRock : n < 0.5 ? C.grassDry : (n < 0.72 ? C.rockLight : C.taihu);
          } else if (k < 2) {
            c = (x * 3 + z * 5 + k) % 3 === 0 ? C.rockDark : C.stoneDark;
          } else {
            // 按 3×3 区块取石色，形成整块石面而不是噪点
            const bi = ((Math.floor(x / 3) * 73856093) ^ (Math.floor(z / 3) * 19349663) ^ (Math.floor(k / 2) * 83492791)) >>> 0;
            c = rockCols[bi % rockCols.length];
            // 层缝
            if (k % 3 === 0) c = C.rockDark;
          }
          set(x, baseY + k, z, c);
        }
      }
    }
    // 山石苔草与藤萝点缀（贴山顶）
    for (let z = z1; z <= z2; z += 2) {
      for (let x = x1; x <= x2; x += 2) {
        const top = w.topY(x, z);
        if (top <= baseY) continue;
        const n = ridge(x * 0.9, z * 0.9);
        if (n < 0.45) setIfEmpty(x, top + 1, z, pick([C.mossRock, C.grass3, C.grass2]));
        else if (n > 0.9) setIfEmpty(x, top + 1, z, pick([C.leafDark, C.leaf]));
      }
    }
    // 石洞（沿给定路径掏空）
    if (o.cave && o.passage) {
      const pts = o.passage;
      for (let i = 0; i < pts.length - 1; i++) {
        line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], (x, z) => {
          const ty = w.topY(x, z);
          if (ty > baseY + 1) {
            for (let y = baseY; y < baseY + 4; y++) {
              for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
                if (Math.hypot(dx, dz) <= 2.4) w.set(x + dx, y, z + dz, 0);
              }
            }
          }
        });
      }
      for (let i = 0; i < pts.length - 1; i++) {
        line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], (x, z) => {
          w.set(x, baseY - 1, z, C.stoneWarm);
          w.set(x, baseY, z, C.stoneWarm);
        });
      }
    }
  }

  // ── 室内陈设（供 custom 厅堂/配房调用；一次布置一室）─────────────────────
  function furnish(o) {
    const f = DET.furniture;
    if (!f) return;
    const x = o.x, z = o.z, y = o.y;
    const ww = o.w || 8, dd = o.d || 6;
    const style = o.style || 'hall';
    const hh = o.h || 4.5;
    const backZ = z - dd / 2 + 1.0;
    const frontZ = z + dd / 2 - 1.2;
    const halfW = ww / 2 - 1.0;
    f.push({ kind: 'screen', x: x + 0.5, y, z: backZ, rotY: 0, w: Math.min(ww - 2, 7.5), h: Math.min(4.2, hh - 0.4) });
    f.push({ kind: 'painting', x: x + 0.5, y: y + 2.35, z: backZ - 0.08, rotY: 0, w: 1.5, h: 2.2 });
    f.push({ kind: 'altar', x: x + 0.5, y, z: backZ + 1.2, rotY: 0, w: Math.min(3.6, ww * 0.5) });
    f.push({ kind: 'vase', x: x - Math.min(2.2, halfW * 0.7), y, z: backZ + 1.1, rotY: 0 });
    f.push({ kind: 'incense', x: x + Math.min(2.2, halfW * 0.7), y, z: backZ + 1.1, rotY: 0 });
    f.push({ kind: 'chair', x: x - 1.4, y, z: backZ + 2.4, rotY: Math.PI });
    f.push({ kind: 'chair', x: x + 1.4, y, z: backZ + 2.4, rotY: Math.PI });
    f.push({ kind: 'rug', x: x + 0.5, y, z: z + 0.4, rotY: 0, w: Math.max(2.5, ww - 2.5), d: Math.max(2.5, dd - 2) });
    for (const lx of [x - halfW + 0.6, x + halfW + 0.4]) f.push({ kind: 'lantern', x: lx, y: y + Math.min(3.1, hh - 0.8), z: frontZ, rotY: 0 });
    if (style === 'study') {
      f.push({ kind: 'desk', x: x + 0.5, y, z: z + 1.8, rotY: 0, w: 2.2 });
      f.push({ kind: 'chair', x: x + 0.5, y, z: z + 0.9, rotY: Math.PI });
      f.push({ kind: 'bookshelf', x: x - halfW + 0.9, y, z: backZ + 0.8, rotY: Math.PI / 2 });
      f.push({ kind: 'qin', x: x + Math.min(1.8, halfW - 1), y, z: z + 2.6, rotY: 0 });
    } else if (style === 'bedroom') {
      f.push({ kind: 'bed', x: x + 0.5, y, z: backZ + 2.0, rotY: 0, w: 2.2, d: 1.9 });
      f.push({ kind: 'curtain', x: x + 0.5, y: y + 1.6, z: backZ + 2.0, rotY: 0, w: 2.6, h: 1.8 });
      f.push({ kind: 'table', x: x + 2.6, y, z: z + 1.0, rotY: 0, w: 1.2 });
    } else if (style === 'dining') {
      f.push({ kind: 'table', x: x + 0.5, y, z: z + 0.6, rotY: 0, w: 2.2, d: 1.2 });
      f.push({ kind: 'chair', x: x - 1.4, y, z: z + 0.6, rotY: Math.PI / 2 });
      f.push({ kind: 'chair', x: x + 2.0, y, z: z + 0.6, rotY: -Math.PI / 2 });
      f.push({ kind: 'chair', x: x + 0.5, y, z: z - 0.8, rotY: 0 });
      f.push({ kind: 'teaset', x: x + 0.5, y: y + 0.72, z: z + 0.6, rotY: 0 });
    }
    for (const sx of [x - halfW + 0.7, x + halfW + 0.5]) f.push({ kind: 'pottedPlant', x: sx, y, z: z - dd / 2 + 1.8, rotY: 0 });
  }

  function parapet(o) {
    const { x1, z1, x2, z2, y } = o;
    rectRing(x1, z1, x2, z2, y, C.whitewall);
    rectRing(x1, z1, x2, z2, y + 1, C.whitewall);
    rectRing(x1, z1, x2, z2, y + 2, C.roof);
  }

  return {
    box, set, setIfEmpty, line, rectRing, speckle, plinth, roof, wall, wallRect, moonGate,
    latticeWindow, door, railing, column, pavilion, eaveBand, hall, corridor, bridge, archway,
    fence, plaque, couplet, banner, lantern, tableSet, pot, rock, rockery, parapet, stoneLampStand, furnish,
  };
}
