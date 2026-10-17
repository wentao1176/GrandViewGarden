// 第一人称步行控制器：碰撞/台阶/重力/开门/水域限制/POI 传送。
// 约定：heading 弧度 0=正北(-z)，顺时针为正；脚底坐标为世界米；眼高 1.65m。
import * as THREE from 'three';
import { W, H, D, OX, OZ } from './world.js';
import { WATER_LEVEL } from '../garden/layout.js';

const EYE = 1.65;
const RADIUS = 0.34;
const BODY = 1.74;
const STEP = 2.4;   // 允许自动登上月台/假山台阶（体素台阶多为 1–2m）
const GRAVITY = 22;
const JUMP_V = 6.4;
const WALK_SPEED = 2.9;
const RUN_SPEED = 5.6;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const EPS = 1e-4;

export class Walker {
  constructor({ world, terrain, camera, canvas, layout, details, onEvent }) {
    this.world = world;
    this.terrain = terrain;   // { isWater(x,z), groundTop(x,z) }
    this.camera = camera;
    this.canvas = canvas;
    this.layout = layout;
    this.details = details || {};
    this.onEvent = onEvent || (() => {});
    this.enabled = false;
    this.paused = false;
    this.pos = new THREE.Vector3(0, 4, 138);
    this.heading = 0;
    this.pitch = -0.06;
    this.vy = 0;
    this.onGround = true;
    this.move = { x: 0, z: 0, sprint: false };
    this.lookDelta = { x: 0, y: 0 };
    this._lastEmit = 0;
    this._keys = new Set();
    this._lastPos = new THREE.Vector3();
    this._walkEmitAcc = 0;
    this._nearDoor = null;
    this._nearPoi = null;
    this._hint = '';
    this._bind();
  }

  // ── 体素查询 ─────────────────────────────────────────────────────────────
  solid(x, y, z) {
    return this.world.solid(Math.floor(x), Math.floor(y), Math.floor(z)) ? 1 : 0;
  }
  isDoorCell(x, y, z) {
    const cells = this._doorCells;
    if (!cells || !cells.size) return null;
    const k = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    return cells.has(k) ? cells.get(k) : null;
  }
  /** 该位置是否可通行（门开启时其格可通行） */
  passable(px, py, pz) {
    const x = Math.floor(px), y = Math.floor(py), z = Math.floor(pz);
    if (x < -OX || x >= OX || z < -OZ || z >= OZ || y < 0) return true;
    if (y >= 96) return true;
    // 门格优先：按开合状态决定是否可通行（门扇体素已清空）
    const door = this.isDoorCell(px, py, pz);
    if (door) return door.open > 0.55;
    const v = this.world.get(x, y, z);
    if (!v) return true;
    // 被精细网格替换的体素（栏杆/柱/窗棂等）不再作为碰撞
    if (this.world.isHidden(x, y, z)) return true;
    return false;
  }
  /** 身体 AABB 是否与实体相交（脚底 py，半径 r） */
  blocked(px, py, pz, r = RADIUS) {
    const x0 = Math.floor(px - r), x1 = Math.floor(px + r);
    const z0 = Math.floor(pz - r), z1 = Math.floor(pz + r);
    const y0 = Math.floor(py + 0.08), y1 = Math.floor(py + BODY);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        if (!this.passable(x + 0.5, y + 0.5, z + 0.5)) return true;
      }
    }
    return false;
  }
  /** 脚下支撑面高度（脚底 y），找不到返回 -Infinity */
  supportY(px, pz, fromY) {
    const x0 = Math.floor(px - RADIUS * 0.7), x1 = Math.floor(px + RADIUS * 0.7);
    const z0 = Math.floor(pz - RADIUS * 0.7), z1 = Math.floor(pz + RADIUS * 0.7);
    for (let y = Math.floor(fromY + 0.25); y >= Math.floor(fromY - 3.2); y--) {
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        if (this.solid(x + 0.5, y + 0.5, z + 0.5)) return y + 1;
      }
    }
    return -Infinity;
  }
  isWaterAt(px, pz) {
    return this.terrain && this.terrain.isWater(Math.floor(px), Math.floor(pz));
  }
  /** 该脚底位置是否站在水上（无桥） */
  waterBlocked(px, py, pz) {
    if (!this.isWaterAt(px, pz)) return false;
    const sy = this.supportY(px, pz, py);
    // 桥面/石矶高于水面时允许；否则不可下水
    return !(sy > WATER_LEVEL + 0.4 && Math.abs(sy - py) < 1.4);
  }

  // ── 输入 ─────────────────────────────────────────────────────────────────
  _bind() {
    this._kd = (e) => {
      if (!this.enabled) return;
      const k = e.code;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space'].includes(k)) {
        this._keys.add(k);
        if (k === 'Space') { this.jump(); e.preventDefault(); }
        if (!e.repeat) this._syncKeys();
      }
      if (k === 'KeyE') this.interact();
    };
    this._ku = (e) => {
      if (!this.enabled) return;
      this._keys.delete(e.code);
      this._syncKeys();
    };
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
    window.addEventListener('blur', () => { this._keys.clear(); this._syncKeys(); });

    this._down = null;
    const d = this.canvas;
    this._pd = (e) => {
      if (!this.enabled) return;
      this._down = { id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType };
      d.setPointerCapture?.(e.pointerId);
    };
    this._pm = (e) => {
      if (!this.enabled || !this._down || this._down.id !== e.pointerId) return;
      const dx = e.clientX - this._down.x, dy = e.clientY - this._down.y;
      this._down.x = e.clientX; this._down.y = e.clientY;
      this.addLook(dx, dy);
    };
    this._pu = (e) => { if (this._down && this._down.id === e.pointerId) this._down = null; };
    d.addEventListener('pointerdown', this._pd);
    d.addEventListener('pointermove', this._pm);
    window.addEventListener('pointerup', this._pu);
    window.addEventListener('pointercancel', this._pu);
  }
  _syncKeys() {
    const k = this._keys;
    let x = 0, z = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) z += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) z -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    this.walkKeys = { x, z, sprint: k.has('ShiftLeft') || k.has('ShiftRight') };
  }
  setMove(x, z, sprint = false) { this.uiMove = { x: clamp(x, -1, 1), z: clamp(z, -1, 1), sprint: !!sprint }; }
  addLook(dx, dy) { this.lookDelta.x += dx; this.lookDelta.y += dy; }
  jump() {
    if (!this.enabled) return;
    if (this.onGround) { this.vy = JUMP_V; this.onGround = false; }
  }
  interact() {
    if (!this.enabled) return;
    const d = this._nearDoor;
    if (d) { this.toggleDoor(d); return; }
    if (this._nearPoi) this.onEvent({ type: 'poi', id: this._nearPoi });
  }
  toggleDoor(d) {
    if (!d) return;
    d.manual = true;
    d.target = ((d.open ?? 1) > 0.5) ? 0 : 1;
    this.onEvent({ type: 'door', label: d.label || '', open: d.target === 1 });
  }

  // ── 模式切换 ─────────────────────────────────────────────────────────────
  setDetails(details) {
    this.details = details || {};
    this._doorCells = new Map();
    for (const door of this.details.doors || []) {
      door.open = door.open || 0;
      door.target = door.open || 0;
      for (const c of door.cells || []) this._doorCells.set(`${c[0]},${c[1]},${c[2]}`, door);
    }
  }
  enter(x, z, heading) {
    this.enabled = true;
    this._keys.clear(); this._syncKeys();
    this.uiMove = { x: 0, z: 0, sprint: false };
    if (Number.isFinite(x) && Number.isFinite(z)) this.teleport(x, z);
    else {
      const t = this._orbitTarget || [0, 138];
      this.teleport(t[0], t[1]);
    }
    if (Number.isFinite(heading)) this.heading = heading;
    this.applyCamera();
  }
  exit() { this.enabled = false; this._keys.clear(); this._syncKeys(); }
  getState() {
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z, heading: this.heading, pitch: this.pitch };
  }

  /** 该列最低的可站立地面（要求头顶 3 格净空，避免落在月台/桥下）；找不到返回 -Infinity */
  floorAt(px, pz) {
    const x = Math.floor(px), z = Math.floor(pz);
    for (let y = 2; y < 92; y++) {
      if (this.solid(x + 0.5, y + 0.5, z + 0.5)
        && !this.solid(x + 0.5, y + 1.5, z + 0.5)
        && !this.solid(x + 0.5, y + 2.5, z + 0.5)
        && !this.solid(x + 0.5, y + 3.5, z + 0.5)) return y + 1;
    }
    return -Infinity;
  }

  /** 传送到 (x,z) 附近最近可行走点 */
  teleport(x, z) {
    const water = this.isWaterAt(x, z);
    let best = null;
    for (let r = 0; r <= 20 && !best; r++) {
      for (let dz = -r; dz <= r && !best; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const px = Math.floor(x) + dx + 0.5, pz = Math.floor(z) + dz + 0.5;
        if (px < -140 || px > 140 || pz < -140 || pz > 146) continue;
        if (this.isWaterAt(px, pz)) continue;
        const fy = this.floorAt(px, pz);
        if (!Number.isFinite(fy)) continue;
        if (this.blocked(px, fy + 0.02, pz)) continue;
        best = { x: px, z: pz, y: fy };
        break;
      }
    }
    if (!best) {
      const fy = this.floorAt(x, z);
      best = { x, z, y: Number.isFinite(fy) ? fy : Math.max(4, this.supportY(x, z, 30) || 4) };
    }
    this.pos.set(best.x, best.y, best.z);
    this.vy = 0; this.onGround = true;
    this.applyCamera();
    return !water;
  }

  // ── 每帧 ─────────────────────────────────────────────────────────────────
  applyCamera() {
    const c = this.camera;
    c.position.set(this.pos.x, this.pos.y + EYE, this.pos.z);
    c.rotation.set(this.pitch, -this.heading, 0, 'YXZ');
    c.updateMatrixWorld();
  }

  update(dt) {
    if (!this.enabled) return;
    if (this.paused) { this.applyCamera(); return; }
    dt = Math.min(dt, 0.05);
    // 视角
    if (this.lookDelta.x || this.lookDelta.y) {
      this.heading += this.lookDelta.x * 0.0026;
      this.pitch = clamp(this.pitch - this.lookDelta.y * 0.0022, -1.32, 1.32);
      this.lookDelta.x = 0; this.lookDelta.y = 0;
    }
    // 移动输入（键盘 + UI 摇杆）
    const k = this.walkKeys || { x: 0, z: 0, sprint: false };
    const ux = this.uiMove ? this.uiMove.x : 0, uz = this.uiMove ? this.uiMove.z : 0;
    let mx = clamp(k.x + ux, -1, 1), mz = clamp(k.z + uz, -1, 1);
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const sprint = k.sprint || (this.uiMove && this.uiMove.sprint);
    const speed = sprint ? RUN_SPEED : WALK_SPEED;
    const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    // heading 0 = -z；右 = +x
    const vx = (mz * sin + mx * cos) * speed;
    const vz = (-mz * cos + mx * sin) * speed;

    // 分轴碰撞 + 台阶
    const stepMove = (axis, amount) => {
      if (!amount) return;
      const nx = this.pos.x + (axis === 'x' ? amount : 0);
      const nz = this.pos.z + (axis === 'z' ? amount : 0);
      if (this.waterBlocked(nx, this.pos.y, nz)) return;
      if (!this.blocked(nx, this.pos.y + 0.02, nz)) {
        this.pos.x = nx; this.pos.z = nz; return;
      }
      // 自动上台阶
      for (let h = 0.25; h <= STEP; h += 0.25) {
        const ny = this.pos.y + h;
        if (this.isWaterAt(nx, nz) && this.supportY(nx, nz, ny) <= WATER_LEVEL) continue;
        if (!this.blocked(nx, ny + 0.02, nz) && !this.blocked(this.pos.x, ny, this.pos.z)) {
          this.pos.x = nx; this.pos.z = nz; this.pos.y = ny; this.onGround = true; return;
        }
      }
    };
    stepMove('x', vx * dt);
    stepMove('z', vz * dt);

    // 重力与支撑
    const sy = this.supportY(this.pos.x, this.pos.z, this.pos.y + 0.3);
    if (this.onGround && sy > -Infinity && Math.abs(sy - this.pos.y) < 0.3) {
      this.pos.y = sy;
    }
    if (sy === -Infinity || this.pos.y > sy + 0.05) {
      this.onGround = false;
      this.vy -= GRAVITY * dt;
      this.pos.y += this.vy * dt;
      const sy2 = this.supportY(this.pos.x, this.pos.z, this.pos.y + 0.1);
      if (sy2 > -Infinity && this.pos.y <= sy2) { this.pos.y = sy2; this.vy = 0; this.onGround = true; }
      if (this.pos.y < WATER_LEVEL - 0.3) { // 落水：回到最近岸边
        this.pos.y = WATER_LEVEL + 0.3;
        const before = this.pos.clone();
        this.teleport(this.pos.x, this.pos.z + 2);
        if (this.pos.y < WATER_LEVEL) this.pos.copy(before);
      }
    } else if (sy > -Infinity) {
      this.pos.y = sy; this.onGround = true;
    }

    // 门附近自动开合 + 提示
    this._updateDoors(dt);
    this._updateIndoor();
    this.applyCamera();

    // 事件 ~10Hz
    this._walkEmitAcc += dt;
    if (this._walkEmitAcc > 0.1) {
      this._walkEmitAcc = 0;
      this.onEvent({
        type: 'walk',
        pos: [this.pos.x, this.pos.y, this.pos.z],
        yaw: this.heading,
        pitch: this.pitch,
        hint: this._hint,
        nearPoi: this._nearPoi,
      });
    }
  }

  _updateIndoor() {
    // 头顶 9m 内有实心体素即视为室内/檐下；供渲染亮度与 UI 使用
    let indoor = false;
    const x = Math.floor(this.pos.x), z = Math.floor(this.pos.z);
    for (let y = Math.floor(this.pos.y) + 2; y <= Math.floor(this.pos.y) + 9; y++) {
      if (this.world.solid(x, y, z)) { indoor = true; break; }
    }
    if (this.indoors !== indoor) {
      this.indoors = indoor;
      this.onEvent({ type: 'indoor', indoor });
    }
  }

  _updateDoors(dt) {
    let near = null, nearD = 2.9;
    const dx = Math.sin(this.heading), dz = -Math.cos(this.heading);
    const ax = this.pos.x + dx * 0.9, az = this.pos.z + dz * 0.9;
    for (const door of this.details.doors || []) {
      const cells = door.cells || [];
      for (const c of cells) {
        const d = Math.hypot(c[0] + 0.5 - ax, c[2] + 0.5 - az);
        if (d < nearD && Math.abs(c[1] - this.pos.y) < 3.2) { nearD = d; near = door; }
      }
    }
    this._nearDoor = near;
    // 默认门常开（便于入内）；玩家按 E 可开关，手动状态优先
    for (const door of this.details.doors || []) {
      if (door.manual) {
        const target = door.target ?? 1;
        door.open = (door.open ?? 1) + (target - (door.open ?? 1)) * Math.min(1, dt * 8);
      } else {
        door.open = 1;
        door.target = 1;
      }
    }
    // 交互提示：门 / 景点
    let hint = '';
    if (near && nearD < 2.4) {
      const closed = (near.open ?? 1) < 0.4;
      hint = near.label ? `${closed ? '开门' : '关门'}：${near.label}` : (closed ? '开门' : '关门');
    }
    const poi = this._nearestPoi();
    this._nearPoi = poi ? poi.id : null;
    if (!hint && poi) {
      const d = Math.hypot(poi.x - this.pos.x, poi.z - this.pos.z);
      if (d < 10) hint = `${poi.name} · 按 E 查看`;
    }
    this._hint = hint;
  }

  _nearestPoi() {
    const list = this.layout?.POIS || [];
    let best = null, bd = 26;
    for (const p of list) {
      const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
}
