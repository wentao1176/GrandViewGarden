// ─────────────────────────────────────────────────────────────────────────────
// 体素世界：320 × 96 × 320 稠密网格（约 983 万格，Uint16）。
// 坐标：x 东(+)/西(-)，z 南(+)/北(-)，y 上。世界坐标原点在园林中心。
// ─────────────────────────────────────────────────────────────────────────────
import { PALETTE } from './palette.js';

export const W = 320;
export const H = 96;
export const D = 320;
export const OX = W >> 1;   // 160
export const OZ = D >> 1;   // 160
const SIZE = W * H * D;

export const GROUND_TOP = 3;     // 园内地面最后一层实体的 y（地表 y=3，空气从 4 起）
export const WATER_Y = 2.2;      // 水面高度（世界单位）

export const CH = 16;
export const NCX = W / CH, NCY = H / CH, NCZ = D / CH;
const NCHUNK = NCX * NCY * NCZ;

export class World {
  constructor() {
    this.data = new Uint16Array(SIZE);
    this.hidden = new Uint8Array(SIZE);   // 1 = 仅碰撞/占位，不进入体素网格（被精细网格替换）
    this.chunks = new Uint8Array(NCHUNK);
    this.count = 0;
    this.minX = W; this.maxX = -1;
    this.minY = H; this.maxY = -1;
    this.minZ = D; this.maxZ = -1;
    this._topH = null;
    this._shadow = null;
  }
  idx(x, y, z) { return (x + OX) + (z + OZ) * W + y * W * D; }
  inBounds(x, y, z) { return x >= -OX && x < OX && z >= -OZ && z < OZ && y >= 0 && y < H; }
  get(x, y, z) {
    x |= 0; y |= 0; z |= 0;
    if (y < 0) return 0;
    if (x < -OX || x >= OX || z < -OZ || z >= OZ || y >= H) return 0;
    return this.data[(x + OX) + (z + OZ) * W + y * W * D];
  }
  solid(x, y, z) { return this.get(x, y, z) !== 0; }
  set(x, y, z, c) {
    x |= 0; y |= 0; z |= 0;
    if (x < -OX || x >= OX || z < -OZ || z >= OZ || y < 0 || y >= H) return false;
    const i = (x + OX) + (z + OZ) * W + y * W * D;
    const old = this.data[i];
    if (old === c) return false;
    if (old === 0 && c !== 0) this.count++;
    else if (old !== 0 && c === 0) this.count--;
    this.data[i] = c;
    this.hidden[i] = 0;
    if (c !== 0) {
      const cx = (x + OX) >> 4, cy = y >> 4, cz = (z + OZ) >> 4;
      this.chunks[cx + cz * NCX + cy * NCX * NCZ] = 1;
      if (x < this.minX) this.minX = x; if (x > this.maxX) this.maxX = x;
      if (y < this.minY) this.minY = y; if (y > this.maxY) this.maxY = y;
      if (z < this.minZ) this.minZ = z; if (z > this.maxZ) this.maxZ = z;
    }
    return true;
  }
  /** 只在空位放置 */
  setIfEmpty(x, y, z, c) { if (this.get(x, y, z) === 0) { this.set(x, y, z, c); return true; } return false; }
  /** 标记该体素不再进入体素网格（保留 solid/get 语义，供碰撞与场景逻辑使用） */
  hide(x, y, z) {
    x |= 0; y |= 0; z |= 0;
    if (x < -OX || x >= OX || z < -OZ || z >= OZ || y < 0 || y >= H) return false;
    this.hidden[(x + OX) + (z + OZ) * W + y * W * D] = 1;
    return true;
  }
  isHidden(x, y, z) {
    x |= 0; y |= 0; z |= 0;
    if (x < -OX || x >= OX || z < -OZ || z >= OZ || y < 0 || y >= H) return 0;
    return this.hidden[(x + OX) + (z + OZ) * W + y * W * D];
  }
  /** 体素网格用可见性：被 hide 的体素视为空气 */
  visible(x, y, z) {
    x |= 0; y |= 0; z |= 0;
    if (y < 0) return 0;
    if (x < -OX || x >= OX || z < -OZ || z >= OZ || y >= H) return 0;
    const i = (x + OX) + (z + OZ) * W + y * W * D;
    const v = this.data[i];
    return v !== 0 && this.hidden[i] === 0 ? v : 0;
  }
  /** 覆盖式填充长方体（含端点） */
  fill(x1, y1, z1, x2, y2, z2, c) {
    const ax = Math.min(x1, x2) | 0, bx = Math.max(x1, x2) | 0;
    const ay = Math.min(y1, y2) | 0, by = Math.max(y1, y2) | 0;
    const az = Math.min(z1, z2) | 0, bz = Math.max(z1, z2) | 0;
    for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) this.set(x, y, z, c);
  }
  /** 空位填充（不破坏已有结构） */
  fillEmpty(x1, y1, z1, x2, y2, z2, c) {
    const ax = Math.min(x1, x2) | 0, bx = Math.max(x1, x2) | 0;
    const ay = Math.min(y1, y2) | 0, by = Math.max(y1, y2) | 0;
    const az = Math.min(z1, z2) | 0, bz = Math.max(z1, z2) | 0;
    for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) if (this.get(x, y, z) === 0) this.set(x, y, z, c);
  }
  clear(x1, y1, z1, x2, y2, z2) {
    const ax = Math.min(x1, x2) | 0, bx = Math.max(x1, x2) | 0;
    const ay = Math.max(0, Math.min(y1, y2) | 0), by = Math.min(H - 1, Math.max(y1, y2) | 0);
    const az = Math.min(z1, z2) | 0, bz = Math.max(z1, z2) | 0;
    for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) this.set(x, y, z, 0);
  }
  /** 竖直柱 */
  column(x, z, y0, y1, c) { for (let y = y0; y <= y1; y++) this.set(x, y, z, c); }
  /** 中空盒（墙） */
  boxShell(x1, y1, z1, x2, y2, z2, c) {
    const ax = Math.min(x1, x2), bx = Math.max(x1, x2);
    const az = Math.min(z1, z2), bz = Math.max(z1, z2);
    const ay = Math.min(y1, y2), by = Math.max(y1, y2);
    for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) {
      if (x === ax || x === bx || z === az || z === bz) this.set(x, y, z, c);
    }
    this.fill(ax, ay, az, bx, ay, bz, c);
    this.fill(ax, by, az, bx, by, bz, c);
  }
  /** 该列最高实体 y（无则 -1） */
  topY(x, z) {
    x |= 0; z |= 0;
    if (x < -OX || x >= OX || z < -OZ || z >= OZ) return -1;
    const base = (x + OX) + (z + OZ) * W;
    for (let y = H - 1; y >= 0; y--) if (this.data[base + y * W * D] !== 0) return y;
    return -1;
  }
  /** 计算每列最高点与地表阴影（烘焙一次） */
  bakeLighting(sunDir = { x: 0.62, y: 0.72, z: 0.48 }) {
    const top = new Uint8Array(W * D);
    for (let z = -OZ; z < OZ; z++) {
      for (let x = -OX; x < OX; x++) {
        let y = H - 1;
        const base = (x + OX) + (z + OZ) * W;
        while (y >= 0 && this.data[base + y * W * D] === 0) y--;
        top[(x + OX) + (z + OZ) * W] = y < 0 ? 0 : y;
      }
    }
    // 太阳方位：东南高空。沿光线水平投影（朝太阳）步进，若地形高过光线则处于阴影。
    const hx = sunDir.x, hz = sunDir.z;
    const hl = Math.hypot(hx, hz) || 1;
    const sx = hx / hl, sz = hz / hl;
    const tanElev = sunDir.y / hl; // 每水平 1 单位，光线上升量
    const shadow = new Uint8Array(W * D);
    const STEPS = 46;
    for (let z = -OZ; z < OZ; z++) {
      for (let x = -OX; x < OX; x++) {
        const i = (x + OX) + (z + OZ) * W;
        const h0 = top[i];
        let sh = 0;
        for (let k = 1; k < STEPS; k++) {
          const px = Math.round(x + sx * k), pz = Math.round(z + sz * k);
          if (px < -OX || px >= OX || pz < -OZ || pz >= OZ) break;
          const j = (px + OX) + (pz + OZ) * W;
          if (top[j] >= h0 + k * tanElev + 0.5) { sh = 1; break; }
        }
        shadow[i] = sh;
      }
    }
    this._topH = top;
    this._shadow = shadow;
    return { top, shadow };
  }
  topHeightAt(x, z) {
    x |= 0; z |= 0;
    if (!this._topH || x < -OX || x >= OX || z < -OZ || z >= OZ) return -1;
    return this._topH[(x + OX) + (z + OZ) * W];
  }
  shadowAt(x, z) {
    x |= 0; z |= 0;
    if (!this._shadow || x < -OX || x >= OX || z < -OZ || z >= OZ) return 0;
    return this._shadow[(x + OX) + (z + OZ) * W];
  }
  colorAt(x, y, z) { return PALETTE[this.get(x, y, z)] || null; }
}
