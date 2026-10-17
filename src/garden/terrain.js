// ─────────────────────────────────────────────────────────────────────────────
// 地形、水系、道路、园墙
// 顺序：高程场 → 台地 → 水体 → 地形着色 → 道路 → 园墙 → 园外
// ─────────────────────────────────────────────────────────────────────────────
import { W, D, OX, OZ, GROUND_TOP } from '../core/world.js';
import { C, GROUPS } from '../core/palette.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

export function buildTerrain(ctx) {
  const { w, L, H, R } = ctx;
  const C_ = ctx.C || C;
  const topH = new Int16Array(W * D);
  const water = new Uint8Array(W * D);
  const path = new Uint8Array(W * D);
  const reserved = [];
  const idx = (x, z) => (x + OX) + (z + OZ) * W;

  // ── 1. 高程场：基础平地 + 山体 ─────────────────────────────────────────────
  for (let z = -OZ; z < OZ; z++) for (let x = -OX; x < OX; x++) topH[idx(x, z)] = GROUND_TOP;
  for (const hill of L.HILLS) {
    const { cx, cz, rx, rz, h } = hill;
    for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        if (x < -OX || x >= OX || z < -OZ || z >= OZ) continue;
        const nd = Math.sqrt(((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2);
        if (nd > 1) continue;
        const f = smooth(1 - nd);
        const hh = Math.round(GROUND_TOP + h * Math.pow(f, 1.15));
        const i = idx(x, z);
        if (hh > topH[i]) topH[i] = hh;
      }
    }
  }
  // 山体台阶化（避免均匀锥形，做出 2–3 层台地感）
  for (let z = -OZ; z < OZ; z++) for (let x = -OX; x < OX; x++) {
    const i = idx(x, z);
    if (topH[i] > GROUND_TOP + 5) topH[i] = GROUND_TOP + 5 + Math.floor((topH[i] - GROUND_TOP) / 3) * 3;
  }

  // ── 2. 台地（院落基面）────────────────────────────────────────────────────
  for (const pad of L.PADS) {
    const island = pad.name === 'zilingzhou';
    for (let z = pad.z1; z <= pad.z2; z++) for (let x = pad.x1; x <= pad.x2; x++) {
      if (x < -OX || x >= OX || z < -OZ || z >= OZ) continue;
      const i = idx(x, z);
      topH[i] = pad.elev;
      if (island) { topH[i] = Math.max(pad.elev, 3); }
    }
  }
  // 台地边缘做出 1 格缓坡，避免生硬悬崖（仅对低台地）
  const topHCopy = Int16Array.from(topH);
  for (let z = -OZ + 1; z < OZ - 1; z++) for (let x = -OX + 1; x < OX - 1; x++) {
    const i = idx(x, z);
    const h = topHCopy[i];
    let minN = h;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) minN = Math.min(minN, topHCopy[idx(x + dx, z + dz)]);
    if (h - minN >= 4 && h < 10) topH[i] = minN + 3; // 硬台地收一收
  }
  // 园内空地微起伏（避开台地/院落），让草地不生硬
  const inPad = (x, z) => L.PADS.some((p) => x >= p.x1 - 1 && x <= p.x2 + 1 && z >= p.z1 - 1 && z <= p.z2 + 1);
  for (let z = -146; z <= 146; z++) {
    for (let x = -146; x <= 146; x++) {
      if (inPad(x, z)) continue;
      const i = idx(x, z);
      if (topH[i] !== GROUND_TOP) continue;
      const n = Math.sin(x * 0.055 + 1.3) * Math.cos(z * 0.048 - 0.7) + Math.sin(x * 0.021 - z * 0.017) * 0.6;
      if (n > 0.72) topH[i] = GROUND_TOP + 1;
      else if (n < -0.95) topH[i] = GROUND_TOP - 1;
    }
  }

  // ── 3. 水体掩膜 ────────────────────────────────────────────────────────────
  for (const p of L.PONDS) {
    for (let z = Math.floor(p.cz - p.rz - 1); z <= Math.ceil(p.cz + p.rz + 1); z++) {
      for (let x = Math.floor(p.cx - p.rx - 1); x <= Math.ceil(p.cx + p.rx + 1); x++) {
        if (x < -OX || x >= OX || z < -OZ || z >= OZ) continue;
        const nd = Math.sqrt(((x - p.cx) / p.rx) ** 2 + ((z - p.cz) / p.rz) ** 2);
        if (nd <= 1) water[idx(x, z)] = 1;
      }
    }
  }
  for (const s of L.STREAMS) {
    const r = s.w / 2;
    for (let i = 0; i < s.pts.length - 1; i++) {
      const [ax, az] = s.pts[i], [bx, bz] = s.pts[i + 1];
      const minX = Math.floor(Math.min(ax, bx) - r - 1), maxX = Math.ceil(Math.max(ax, bx) + r + 1);
      const minZ = Math.floor(Math.min(az, bz) - r - 1), maxZ = Math.ceil(Math.max(az, bz) + r + 1);
      const vx = bx - ax, vz = bz - az;
      const len2 = vx * vx + vz * vz || 1;
      for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
        if (x < -OX || x >= OX || z < -OZ || z >= OZ) continue;
        const t = clamp(((x - ax) * vx + (z - az) * vz) / len2, 0, 1);
        const px = ax + vx * t, pz = az + vz * t;
        if ((x - px) ** 2 + (z - pz) ** 2 <= r * r) water[idx(x, z)] = 1;
      }
    }
  }
  // 紫菱洲：岛（清除水体）
  {
    const pad = L.PADS.find((p) => p.name === 'zilingzhou');
    for (let z = pad.z1; z <= pad.z2; z++) for (let x = pad.x1; x <= pad.x2; x++) {
      const i = idx(x, z);
      const edge = Math.min(x - pad.x1, pad.x2 - x, z - pad.z1, pad.z2 - z);
      if (edge > 2) water[i] = 0;
      topH[i] = Math.max(3, pad.elev);
    }
  }
  // 桥面下水体保留；陆上台地不覆盖水面

  // ── 4. 地形填筑 ────────────────────────────────────────────────────────────
  const setCol = (x, y, z, c) => w.set(x, y, z, c);
  for (let z = -OZ; z < OZ; z++) {
    for (let x = -OX; x < OX; x++) {
      const i = idx(x, z);
      const isW = water[i] === 1;
      const h = topH[i];
      // 判断是否临水（1 格内）
      let nearWater = false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const xx = x + dx, zz = z + dz;
        if (xx < -OX || xx >= OX || zz < -OZ || zz >= OZ) continue;
        if (water[idx(xx, zz)]) { nearWater = true; break; }
      }
      if (isW) {
        // 水下：0–1 层为河床，2 层起为空（水面 mesh 在 2.6）
        setCol(x, 0, z, C.waterBed2);
        setCol(x, 1, z, pickGroup(GROUPS.waterBed, x, z));
        continue;
      }
      const base = clamp(h, GROUND_TOP, 40);
      const patch = hash(x >> 2, z >> 2, 37);
      for (let y = 0; y <= base; y++) {
        let c;
        if (y === base) {
          if (base <= 4 && nearWater) c = pickMaybe([C.bankStone, C.stone, C.stoneWarm, C.grass2], 0.45, x, z);
          else if (base <= 5) {
            if (patch < 0.07) c = C.grassDry;
            else if (patch < 0.14) c = C.grass3;
            else if (patch < 0.2) c = C.mossRock;
            else c = pickGroup(nearWater ? [C.grass2, C.grass, C.grass3] : GROUPS.grass, x, z);
          } else c = pickGroup(hash(x, z, 3) > 0.55 ? [C.grass3, C.mossRock, C.grass2] : [C.grass2, C.grass, C.leafLight], x, z);
        } else if (y <= 2) {
          c = pickGroup([C.dirt, C.dirt2, C.stoneDark, C.stone], x, z);
        } else if (base > 8 && y > base - 3) {
          c = pickGroup(hash(x, z, y) > 0.5 ? [C.rock, C.rockDark, C.stoneDark] : [C.dirt, C.rockDark], x, z);
        } else {
          c = pickGroup([C.dirt, C.dirt2, C.dirt3, C.stone], x, z);
        }
        setCol(x, y, z, c);
      }
    }
  }

  // ── 5. 道路 ────────────────────────────────────────────────────────────────
  const isWater = (x, z) => (x < -OX || x >= OX || z < -OZ || z >= OZ) ? 0 : water[idx(x, z)];
  const groundTop = (x, z) => (x < -OX || x >= OX || z < -OZ || z >= OZ) ? GROUND_TOP : topH[idx(x, z)];
  const isPath = (x, z) => (x < -OX || x >= OX || z < -OZ || z >= OZ) ? 0 : path[idx(x, z)];

  for (const p of L.PATHS) {
    const r = Math.min(p.w, 5) / 2;
    for (let i = 0; i < p.pts.length - 1; i++) {
      const [ax, az] = p.pts[i], [bx, bz] = p.pts[i + 1];
      const vx = bx - ax, vz = bz - az;
      const len2 = vx * vx + vz * vz || 1;
      const minX = Math.floor(Math.min(ax, bx) - r - 1), maxX = Math.ceil(Math.max(ax, bx) + r + 1);
      const minZ = Math.floor(Math.min(az, bz) - r - 1), maxZ = Math.ceil(Math.max(az, bz) + r + 1);
      for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
        if (x < -OX || x >= OX || z < -OZ || z >= OZ) continue;
        if (isWater(x, z)) continue;
        const t = clamp(((x - ax) * vx + (z - az) * vz) / len2, 0, 1);
        const px = ax + vx * t, pz = az + vz * t;
        const dist2 = (x - px) ** 2 + (z - pz) ** 2;
        if (dist2 > r * r) continue;
        const i2 = idx(x, z);
        const gy = topH[i2];
        if (gy > 12) continue;
        const edge = dist2 > (r - 1.2) * (r - 1.2);
        let c;
        if (p.k === 'pebble') {
          c = edge ? C.stoneWarm : pickGroup([C.pebble, C.pebbleDark, C.path, C.stoneWarm], x, z);
        } else {
          c = edge ? C.stoneWarm : pickGroup(hash(x, z, 11) > 0.72 ? [C.path3, C.path2, C.stoneLight] : [C.path, C.path2, C.pebble], x, z);
        }
        w.set(x, gy, z, c);
        path[i2] = 1;
        reserved.push([x, z]);
      }
    }
  }
  // 踏跺/门前广场铺地
  const pave = (x1, z1, x2, z2, c) => {
    for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
      if (isWater(x, z)) continue;
      const gy = topH[idx(x, z)];
      if (gy > 12) continue;
      w.set(x, gy, z, hash(x, z, 5) > 0.7 ? C.path2 : c);
      path[idx(x, z)] = 1;
    }
  };
  pave(-20, 150, 20, 158, C.stoneWarm);
  pave(-24, 124, 24, 132, C.stoneLight);
  pave(-34, -112, 34, -96, C.marbleShade);
  pave(-28, -132, 28, -110, C.marbleShade);
  pave(38, 10, 82, 16, C.path2);
  pave(-126, 18, -74, 24, C.path2);

  // ── 6. 园墙 ────────────────────────────────────────────────────────────────
  const wallY = 3;
  const wallH = L.WALL.h;
  const buildWallRun = (axis, fixed, from, to, opening) => {
    // axis 'x': 沿 x 延伸，z=fixed；axis 'z': 沿 z 延伸，x=fixed
    for (let t = from; t <= to; t++) {
      const isOpen = opening && t >= opening[0] && t <= opening[1];
      if (isOpen) { w.clear(axis === 'x' ? t : fixed, wallY, axis === 'x' ? fixed : t, axis === 'x' ? t : fixed + 2, wallY + wallH - 1, axis === 'x' ? fixed + 2 : t); continue; }
      for (let y = wallY; y < wallY + wallH; y++) {
        for (let th = 0; th < 3; th++) {
          let c;
          if (y === wallY) c = C.wallBase;
          else if (y === wallY + 1) c = C.stoneDark;
          else c = (y === wallY + wallH - 1 && th === 1) ? C.whitewallShade : C.whitewall;
          if (axis === 'x') w.set(t, y, fixed + th, c);
          else w.set(fixed + th, y, t, c);
        }
      }
      // 瓦顶墙帽
      for (let th = -1; th <= 3; th++) {
        const yy = wallY + wallH;
        const cc = (th === -1 || th === 3) ? C.roofEdge : ((t & 1) ? C.roof : C.roofDark);
        if (axis === 'x') { w.set(t, yy, fixed + th, cc); w.set(t, yy + 1, fixed + 1, C.ridge); }
        else { w.set(fixed + th, yy, t, cc); w.set(fixed + 1, yy + 1, t, C.ridge); }
      }
      // 花窗（漏窗）：每隔一段
      if (!isOpen && (t % 26 === 0)) {
        if (axis === 'x') {
          for (let dy = 3; dy <= 6; dy++) for (let dt = 0; dt <= 2; dt++) {
            const c = (dy === 3 || dy === 6 || dt === 0 || dt === 2) ? C.stoneWarm : (Math.abs(dy - 4.5) < 1.2 ? C.stoneDark : C.greenPaint);
            w.set(t, wallY + 3 + dy, fixed + dt, c);
          }
        }
      }
    }
  };
  buildWallRun('x', -148, -148, 148, [-12, 12]); // 南墙（正门开口）
  buildWallRun('x', 145, -148, 148, null);       // 北墙
  buildWallRun('z', -148, -148, 145, null);      // 西墙
  buildWallRun('z', 145, -148, 145, null);       // 东墙
  // 角楼意象
  for (const [cx, cz] of [[-148, -148], [148, -148], [-148, 148], [148, 148]]) {
    for (let y = wallY; y < wallY + wallH + 3; y++) {
      for (let dx = 0; dx < 3; dx++) for (let dz = 0; dz < 3; dz++) w.set(cx + dx, y, cz + dz, C.whitewall);
    }
    for (let dx = -1; dx < 4; dx++) for (let dz = -1; dz < 4; dz++) w.set(cx + dx, wallY + wallH + 3, cz + dz, C.roof);
    w.set(cx + 1, wallY + wallH + 4, cz + 1, C.roofDark);
  }

  // ── 7. 园外 ────────────────────────────────────────────────────────────────
  // 园墙外留 12 格草坡与树（由 flora 散布）；世界边界做矮土坡收边
  for (let z = -OZ; z < OZ; z++) {
    for (let x = -OX; x < OX; x++) {
      if (x > -160 && x < 160 && z > -160 && z < 148) continue;
      const i = idx(x, z);
      if (water[i]) continue;
      const gy = topH[i];
      w.set(x, gy, z, hash(x, z, 9) > 0.5 ? C.grass2 : C.grass);
    }
  }

  return {
    topH, water, isWater, groundTop, isPath, reserved,
    reserve(x1, z1, x2, z2) { reserved.push([x1, z1, x2, z2]); },
  };
}

function hash(x, z, s = 0) {
  let h = x * 374761393 + z * 668265263 + s * 1274126177;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 1000) / 1000;
}
function pickGroup(arr, x, z) { return arr[Math.floor(hash(x, z, 17) * arr.length) % arr.length]; }
function pickMaybe(arr, chance, x, z) { return hash(x, z, 23) < chance ? arr[Math.floor(hash(x, z, 29) * arr.length) % arr.length] : arr[0]; }
