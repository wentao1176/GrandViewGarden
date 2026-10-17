// 精细门扇：把 helpers 记录的 ctx.details.doors 生成一个合并网格。
// 门扇常开约 68°，玩家可直接步入室内；体素门已 hide，仅保留碰撞。
import * as THREE from 'three';
import { C, rgbOf } from './palette.js';

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const SHADE = { top: 1.0, bottom: 0.55, xp: 0.9, xn: 0.78, zp: 0.95, zn: 0.82 };

function makeBuf() { return { pos: [], col: [], idx: [] }; }

function addBox(B, x0, y0, z0, w, h, d, colorIdx, shadeMul = 1, rot = null) {
  const rgb = rgbOf(colorIdx);
  const hexx = s2l(rgb[0]), hexg = s2l(rgb[1]), hexb = s2l(rgb[2]);
  const x1 = x0 + w, y1 = y0 + h, z1 = z0 + d;
  const P = [
    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
    [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
  ];
  if (rot) {
    const cs = Math.cos(rot.a), sn = Math.sin(rot.a);
    for (const p of P) {
      const dx = p[0] - rot.hx, dz = p[2] - rot.hz;
      p[0] = rot.hx + dx * cs + dz * sn;
      p[2] = rot.hz - dx * sn + dz * cs;
    }
  }
  const faces = [
    [[4, 5, 6, 7], SHADE.top], [[0, 3, 2, 1], SHADE.bottom],
    [[1, 2, 6, 5], SHADE.xp], [[0, 4, 7, 3], SHADE.xn],
    [[3, 7, 6, 2], SHADE.zp], [[0, 1, 5, 4], SHADE.zn],
  ];
  for (const [f, sh] of faces) {
    const base = B.pos.length / 3;
    const k = shadeMul * sh;
    for (const vi of f) {
      B.pos.push(P[vi][0], P[vi][1], P[vi][2]);
      B.col.push(Math.min(1, hexx * k), Math.min(1, hexg * k), Math.min(1, hexb * k));
    }
    B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/** 生成整园门扇 + 门框合并网格 */
export function buildDoors(ctx) {
  const specs = (ctx && ctx.details && ctx.details.doors) || [];
  if (!specs.length) return null;
  const B = makeBuf();
  const ANG = 1.18; // ≈68° 常开

  for (const d of specs) {
    const w = d.w | 0, h = d.h | 0;
    const x = d.x, y = d.y, z = d.z;
    const isX = d.axis !== 'z';
    const wood = d.leafColor ?? C.woodRed;
    const frameC = C.woodDark;
    const leafW = w / 2;
    const thick = 0.1;
    const toward = d.openTowards ?? 1;

    if (isX) {
      // 门框：门楣 / 槛 / 立颊
      addBox(B, x - 0.45, y + h, z - 0.13, w + 0.9, 0.36, 0.26, frameC, 1);
      addBox(B, x - 0.34, y + h + 0.36, z - 0.19, w + 0.68, 0.12, 0.38, C.roof, 1);
      addBox(B, x - 0.42, y, z - 0.15, 0.42, h, 0.3, frameC, 1);
      addBox(B, x + w, y, z - 0.15, 0.42, h, 0.3, frameC, 1);
      addBox(B, x, y - 0.06, z - 0.13, w, 0.1, 0.26, C.stoneWarm, 1);
      for (let leaf = 0; leaf < 2; leaf++) {
        const hx = leaf === 0 ? x : x + w;
        const dir = leaf === 0 ? 1 : -1;
        const rot = { hx, hz: z + 0.16, a: -ANG * dir * toward };
        const x0 = dir > 0 ? hx : hx - leafW;
        const z0 = z + 0.16;
        addBox(B, x0, y + 0.03, z0, leafW, h - 0.06, thick, wood, 1, rot);
        addBox(B, x0 + 0.08, y + h * 0.56, z0 + thick * 0.6, leafW - 0.16, 0.1, 0.05, C.woodDark, 1, rot);
        addBox(B, x0 + 0.08, y + h * 0.24, z0 + thick * 0.6, leafW - 0.16, 0.1, 0.05, C.woodDark, 1, rot);
        for (let sx = 0; sx < 3; sx++) for (let sy = 0; sy < 2; sy++) {
          addBox(B, x0 + leafW * (0.18 + sx * 0.32) - 0.05, y + h * (0.34 + sy * 0.32), z0 + thick * 0.52, 0.1, 0.1, 0.06, C.gold, 1, rot);
        }
      }
    } else {
      addBox(B, x - 0.13, y + h, z - 0.45, 0.26, 0.36, w + 0.9, frameC, 1);
      addBox(B, x - 0.19, y + h + 0.36, z - 0.34, 0.38, 0.12, w + 0.68, C.roof, 1);
      addBox(B, x - 0.15, y, z - 0.42, 0.3, h, 0.42, frameC, 1);
      addBox(B, x - 0.15, y, z + w, 0.3, h, 0.42, frameC, 1);
      addBox(B, x - 0.13, y - 0.06, z, 0.26, 0.1, w, C.stoneWarm, 1);
      for (let leaf = 0; leaf < 2; leaf++) {
        const hz = leaf === 0 ? z : z + w;
        const dir = leaf === 0 ? 1 : -1;
        const rot = { hx: x + 0.16, hz, a: ANG * dir * toward };
        const z0 = dir > 0 ? hz : hz - leafW;
        const x0 = x + 0.16;
        addBox(B, x0, y + 0.03, z0, thick, h - 0.06, leafW, wood, 1, rot);
        addBox(B, x0 + thick * 0.6, y + h * 0.56, z0 + 0.08, 0.05, 0.1, leafW - 0.16, C.woodDark, 1, rot);
        addBox(B, x0 + thick * 0.6, y + h * 0.24, z0 + 0.08, 0.05, 0.1, leafW - 0.16, C.woodDark, 1, rot);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
  geo.setIndex(B.idx);
  geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false, fog: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'doors';
  mesh.renderOrder = 2;
  return mesh;
}
