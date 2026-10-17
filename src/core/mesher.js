// ─────────────────────────────────────────────────────────────────────────────
// 贪心网格化（Greedy Meshing）+ 体素 AO + 烘焙日照阴影。
// 输出两个 BufferGeometry：实体（受光）与自发光。整园合并为极少的 draw call。
// ─────────────────────────────────────────────────────────────────────────────
import { PALETTE } from './palette.js';
import { CH, NCX, NCY, NCZ, OX, OZ } from './world.js';

const AO_FACTOR = [0.55, 0.75, 0.89, 1.0];
const SHADE = { xp: 0.84, xn: 0.71, yp: 1.0, yn: 0.42, zp: 0.9, zn: 0.76 };
const SHADOW_MUL = 0.64;
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

const AX = [
  { d: 0, u: 1, v: 2 }, // x 轴：u=y, v=z
  { d: 1, u: 0, v: 2 }, // y 轴：u=x, v=z
  { d: 2, u: 0, v: 1 }, // z 轴：u=x, v=y
];

function gather(world) {
  const solid = { pos: [], col: [], idx: [], mat: [], face: [] };
  const glow = { pos: [], col: [], idx: [], mat: [], face: [] };
  let quads = 0, glowQuads = 0;
  const mask = new Int32Array(CH * CH);
  const used = new Uint8Array(CH * CH);
  const wmask = new Int32Array(CH * CH);

  const emit = (target, d, sign, plane, u0, v0, ww, hh, key) => {
    const colorIdx = key & 0xfff;
    const isGlow = (key >> 12) & 1;
    const shadowed = (key >> 13) & 1;
    const ao = [(key >> 14) & 3, (key >> 16) & 3, (key >> 18) & 3, (key >> 20) & 3];
    const pal = PALETTE[colorIdx];
    if (!pal) return;
    const faceId = d * 2 + (sign > 0 ? 0 : 1);
    const shade = d === 0 ? (sign > 0 ? SHADE.xp : SHADE.xn)
      : d === 1 ? (sign > 0 ? SHADE.yp : SHADE.yn)
        : (sign > 0 ? SHADE.zp : SHADE.zn);
    const sm = shadowed ? SHADOW_MUL : 1;
    const baseR = pal.r / 255, baseG = pal.g / 255, baseB = pal.b / 255;
    const P = target.pos, Cl = target.col;
    const baseIndex = P.length / 3;
    // 四个角在 (u,v) 平面上的偏移
    const us = [u0, u0 + ww, u0 + ww, u0];
    const vs = [v0, v0, v0 + hh, v0 + hh];
    const vtx = [0, 0, 0];
    for (let c = 0; c < 4; c++) {
      const uu = us[c], vv = vs[c];
      if (d === 0) { vtx[0] = plane; vtx[1] = uu; vtx[2] = vv; }
      else if (d === 1) { vtx[0] = uu; vtx[1] = plane; vtx[2] = vv; }
      else { vtx[0] = uu; vtx[1] = vv; vtx[2] = plane; }
      P.push(vtx[0], vtx[1], vtx[2]);
      target.mat.push(pal.mat || 0);
      target.face.push(faceId);
      if (isGlow) {
        // 自发光：明亮、无 AO/阴影
        Cl.push(Math.min(1, s2l(Math.min(1, baseR * 1.28)) * 1.15),
          Math.min(1, s2l(Math.min(1, baseG * 1.22)) * 1.1),
          Math.min(1, s2l(Math.min(1, baseB * 1.05)) * 1.05));
      } else {
        const f = shade * AO_FACTOR[ao[c]] * sm;
        Cl.push(s2l(baseR * f), s2l(baseG * f), s2l(baseB * f));
      }
    }
    const I = target.idx;
    I.push(baseIndex, baseIndex + 2, baseIndex + 1, baseIndex, baseIndex + 3, baseIndex + 2);
  };

  // 轴空间 → 世界坐标采样（隐藏体素视为空气，供网格化与 AO 使用）
  const solidAt = (d, dd, uu, vv) => {
    if (d === 0) return world.visible(dd, uu, vv) ? 1 : 0;
    if (d === 1) return world.visible(uu, dd, vv) ? 1 : 0;
    return world.visible(uu, vv, dd) ? 1 : 0;
  };

  const aoFor = (d, airD, u, v) => {
    const res = [0, 0, 0, 0];
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const du = i ? 1 : -1, dv = j ? 1 : -1;
        const s1 = solidAt(d, airD, u + du, v);
        const s2 = solidAt(d, airD, u, v + dv);
        const cc = solidAt(d, airD, u + du, v + dv);
        const a = (s1 && s2) ? 0 : 3 - (s1 + s2 + cc);
        const ci = i + (j ? 2 : 0); // 0:(0,0) 1:(1,0) 2:(0,1) 3:(1,1)
        res[ci === 0 ? 0 : ci === 1 ? 1 : ci === 2 ? 3 : 2] = a;
      }
    }
    return res; // 顺序: (0,0),(1,0),(1,1),(0,1)
  };

  for (let cy = 0; cy < NCY; cy++) {
    for (let cz = 0; cz < NCZ; cz++) {
      for (let cx = 0; cx < NCX; cx++) {
        if (!world.chunks[cx + cz * NCX + cy * NCX * NCZ]) continue;
        for (let ai = 0; ai < 3; ai++) {
          const { d, u: uAxis, v: vAxis } = AX[ai];
          const baseD = d === 0 ? cx * CH - OX : d === 1 ? cy * CH : cz * CH - OZ;
          const baseU = uAxis === 0 ? cx * CH - OX : uAxis === 1 ? cy * CH : cz * CH - OZ;
          const baseV = vAxis === 0 ? cx * CH - OX : vAxis === 1 ? cy * CH : cz * CH - OZ;
          for (let s = 0; s < CH; s++) {
            const d0 = baseD + s;
            let any = false;
            for (let vi = 0; vi < CH; vi++) {
              for (let ui = 0; ui < CH; ui++) {
                const u = baseU + ui, v = baseV + vi;
                let c1, c2;
                if (d === 0) { c1 = world.visible(d0, u, v); c2 = world.visible(d0 + 1, u, v); }
                else if (d === 1) { c1 = world.visible(u, d0, v); c2 = world.visible(u, d0 + 1, v); }
                else { c1 = world.visible(u, v, d0); c2 = world.visible(u, v, d0 + 1); }
                let key = 0;
                if (c1 && !c2) {
                  const pal = PALETTE[c1];
                  const ao = aoFor(d, d0 + 1, u, v);
                  let sh = 0;
                  if (d === 1) {
                    if (world.topHeightAt(u, v) === d0 && world.shadowAt(u, v)) sh = 1;
                  }
                  key = c1 | ((pal.glow ? 1 : 0) << 12) | (sh << 13)
                    | (ao[0] << 14) | (ao[1] << 16) | (ao[2] << 18) | (ao[3] << 20) | (1 << 22);
                } else if (!c1 && c2) {
                  const pal = PALETTE[c2];
                  const ao = aoFor(d, d0, u, v);
                  let sh = 0;
                  if (d === 1) {
                    if (world.topHeightAt(u, v) === d0 + 1 && world.shadowAt(u, v)) sh = 1;
                  }
                  key = c2 | ((pal.glow ? 1 : 0) << 12) | (sh << 13)
                    | (ao[0] << 14) | (ao[1] << 16) | (ao[2] << 18) | (ao[3] << 20);
                }
                mask[ui + vi * CH] = key;
                if (key) any = true;
              }
            }
            if (!any) continue;
            // 贪心合并
            used.fill(0);
            const plane = d0 + 1;
            for (let vi = 0; vi < CH; vi++) {
              for (let ui = 0; ui < CH; ui++) {
                const p = ui + vi * CH;
                const k = mask[p];
                if (!k || used[p]) continue;
                let ww = 1;
                while (ui + ww < CH) {
                  const q = ui + ww + vi * CH;
                  if (mask[q] !== k || used[q]) break;
                  ww++;
                }
                let hh = 1;
                outer: while (vi + hh < CH) {
                  for (let t = 0; t < ww; t++) {
                    const q = ui + t + (vi + hh) * CH;
                    if (mask[q] !== k || used[q]) break outer;
                  }
                  hh++;
                }
                for (let jj = 0; jj < hh; jj++) for (let ii = 0; ii < ww; ii++) used[ui + ii + (vi + jj) * CH] = 1;
                const sign = (k >> 22) & 1 ? 1 : -1;
                const isGlow = (k >> 12) & 1;
                const target = isGlow ? glow : solid;
                emit(target, d, sign, plane, baseU + ui, baseV + vi, ww, hh, k);
                if (isGlow) glowQuads++; else quads++;
              }
            }
            // 清空本切片 mask（只用过 CH*CH 区域）
            for (let vi = 0; vi < CH; vi++) for (let ui = 0; ui < CH; ui++) mask[ui + vi * CH] = 0;
          }
        }
      }
    }
  }
  return { solid, glow, quads, glowQuads };
}

function toGeometry(t) {
  return {
    position: new Float32Array(t.pos),
    color: new Float32Array(t.col),
    mat: new Uint8Array(t.mat),
    face: new Uint8Array(t.face),
    index: new Uint32Array(t.idx),
    quads: t.idx.length / 6,
  };
}

export function buildVoxelGeometry(world) {
  world.bakeLighting();
  const t0 = performance.now();
  const g = gather(world);
  const t1 = performance.now();
  const solid = toGeometry(g.solid);
  const glow = g.glow.pos.length ? toGeometry(g.glow) : null;
  return {
    solid, glow,
    stats: {
      solidQuads: solid.quads,
      glowQuads: glow ? glow.quads : 0,
      vertices: Math.round((solid.position.length + (glow ? glow.position.length : 0)) / 3),
      ms: Math.round(t1 - t0),
    },
  };
}
