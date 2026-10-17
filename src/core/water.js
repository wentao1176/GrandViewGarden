// ─────────────────────────────────────────────────────────────────────────────
// 精细动态水面 · WaterSystem（water 成员独立文件，Phase 2）
//
// 契约见 docs/phase2-api.md §4：
//   new WaterSystem({ scene, layout, mask, level, quality })
//   build() / update(time, dt) / setTimeOfDay(todName, sunDir) / dispose() / stats()
//
// 设计要点：
//   · 一份合并的 ShaderMaterial 网格绘制全部水面（每格 1 quad，≈1.1 万 quads，1 draw call）：
//     顶点属性携带「流向 / 速度 / 水深 / 离岸距离 / 类型」，片元里做多层行进波、汇流撕裂、
//     岸边与桥墩泡沫、菲涅耳天光反射、太阳高光、四时水色、雾与远景渐变；
//   · 沁芳闸与花溆石洞的白色水帘直接并入同一网格（aMeta.w=2 分支，不额外 draw call）；
//   · 水花/水雾/水面飘光用一套 GPU Points（只更新 uTime，逐帧零分配，桌面 1600 / 移动 640）；
//   · 8–15 条锦鲤用 InstancedMesh 绕池游动（1 draw call，逐帧仅写实例矩阵）。
//   · 总 draw call = 3（水 1 + 粒子 1 + 锦鲤 1）。
//
// 本文件不 import 其它场景代码；只依赖 three、layout 数据（由构造参数传入）与 water-shader.js。
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import {
  WATER_TOD, WATER_VERT, WATER_FRAG, PARTICLE_VERT, PARTICLE_FRAG,
  hexToVec3, WATER_SHADER_VERSION,
} from './water-shader.js';

const GW = 320;
const GH = 320;
const GOX = 160;
const GOZ = 160;
const MASK_LEN = GW * GH;
const MAX_PIERS = 24;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, t) => {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const maskIdx = (x, z) => (x + GOX) + (z + GOZ) * GW;

/** 简易鱼形几何：扁平菱形鱼身 + 尾鳍，朝 +x（后续按速度方向旋转 Y） */
function buildFishGeometry() {
  const pos = new Float32Array([
    0.62, 0, 0,      // 0 鱼头
    0.06, 0, 0.26,   // 1 左胸
    -0.32, 0, 0,     // 2 尾根
    0.06, 0, -0.26,  // 3 右胸
    -0.64, 0, 0.19,  // 4 左尾鳍
    -0.64, 0, -0.19, // 5 右尾鳍
  ]);
  const idx = new Uint16Array([
    0, 1, 2, 0, 2, 3, // 鱼身
    2, 4, 5,          // 尾鳍
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

export class WaterSystem {
  /**
   * @param {object} opts
   * @param {THREE.Object3D} opts.scene  水面挂载的 scene/group
   * @param {object} opts.layout         layout.js 模块（PONDS/STREAMS/BRIDGES）
   * @param {Uint8Array} opts.mask       320×320 水面掩膜，1=水
   * @param {number} [opts.level]        水面世界 y（默认 layout.WATER_LEVEL）
   * @param {'high'|'mid'|'low'} [opts.quality]
   * @param {number} [opts.pixelScale]   粒子点尺寸像素系数（默认 700；Lead 可按视口高度传）
   */
  constructor(opts = {}) {
    const { scene, layout, mask, level, quality } = opts;
    if (!scene || typeof scene.add !== 'function') throw new Error('[WaterSystem] opts.scene is required');
    if (!layout || !Array.isArray(layout.PONDS) || !Array.isArray(layout.STREAMS)) {
      throw new Error('[WaterSystem] opts.layout (layout.js module) is required');
    }
    if (!(mask instanceof Uint8Array) || mask.length !== MASK_LEN) {
      throw new Error(`[WaterSystem] opts.mask must be Uint8Array(${MASK_LEN})`);
    }
    this.scene = scene;
    this.layout = layout;
    this.mask = mask;
    this.level = Number.isFinite(level) ? level : (Number.isFinite(layout.WATER_LEVEL) ? layout.WATER_LEVEL : 3.35);
    this.quality = quality || 'high';
    this.isMobile = this.quality !== 'high';
    this.pixelScale = Number.isFinite(opts.pixelScale) ? opts.pixelScale : 700;

    this._rng = mulberry32(0x2026_1018);
    this._built = false;
    this._disposed = false;
    this._meshes = [];

    this._calls = 0;
    this._quads = 0;
    this._fishCount = 0;
    this._particleCount = 0;
    this._waterCells = 0;

    this._fishData = [];
    this._sunTarget = new THREE.Vector3(0.6, 0.72, 0.5);
    this._todName = 'day';
    this._todTarget = WATER_TOD.day;
    this._todTargetColors = null;

    // 逐帧复用对象，避免 GC
    this._m4 = new THREE.Matrix4();
    this._quat = new THREE.Quaternion();
    this._pos = new THREE.Vector3();
    this._scale = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0);

    this._buildUniforms();
    this._applyTod(WATER_TOD.day, true);
  }

  // ── uniforms ──────────────────────────────────────────────────────────────
  _buildUniforms() {
    const day = WATER_TOD.day;
    const v3 = (hex) => new THREE.Vector3(...hexToVec3(hex));
    const piers = [];
    for (let i = 0; i < MAX_PIERS; i++) piers.push(new THREE.Vector2(0, 0));
    this.uniforms = {
      uTime: { value: 0 },
      uDeep: { value: v3(day.deep) },
      uShallow: { value: v3(day.shallow) },
      uSky: { value: v3(day.sky) },
      uSun: { value: v3(day.sun) },
      uFoam: { value: v3(day.foam) },
      uPetal: { value: v3(day.petal) },
      uFogColor: { value: v3(day.fog) },
      uFogNear: { value: day.fogNear },
      uFogFar: { value: day.fogFar },
      uSunI: { value: day.sunI },
      uNight: { value: day.night },
      uSunDir: { value: new THREE.Vector3(0.6, 0.72, 0.5) },
      uLevel: { value: this.level },
      uFall0: { value: new THREE.Vector2(130.5, -132.3) },
      uFall1: { value: new THREE.Vector2(30.5, -90.5) },
      uPiers: { value: piers },
      uPierCount: { value: 0 },
      uDetail: { value: this.quality === 'high' ? 1.0 : this.quality === 'mid' ? 0.85 : 0.7 },
    };
    this._particleUniforms = {
      uTime: { value: 0 },
      uPixelScale: { value: this.pixelScale },
      uFoam: { value: v3(day.foam).clone() },
      uSky: { value: v3(day.sky).clone() },
      uSun: { value: v3(day.sun).clone() },
    };
  }

  /** 由 layout 生成桥墩泡沫点（每桥 3 点，最多 24） */
  _collectPiers() {
    const b = this.layout.BRIDGES || {};
    const pts = [];
    for (const key of Object.keys(b)) {
      const br = b[key];
      if (!br || !Number.isFinite(br.x) || !Number.isFinite(br.z)) continue;
      const len = Number.isFinite(br.len) ? br.len : 12;
      const dirX = (br.dir || 'x') === 'x';
      const off = Math.max(2, Math.round(len * 0.3));
      const raw = dirX
        ? [[br.x - off, br.z], [br.x, br.z], [br.x + off, br.z]]
        : [[br.x, br.z - off], [br.x, br.z], [br.x, br.z + off]];
      for (const p of raw) {
        if (pts.length >= MAX_PIERS) break;
        pts.push(p);
      }
      if (pts.length >= MAX_PIERS) break;
    }
    const arr = this.uniforms.uPiers.value;
    for (let i = 0; i < MAX_PIERS; i++) {
      if (i < pts.length) arr[i].set(pts[i][0], pts[i][1]);
      else arr[i].set(0, 0);
    }
    this.uniforms.uPierCount.value = pts.length;
    this._piers = pts;
  }

  // ── 主构建 ────────────────────────────────────────────────────────────────
  build() {
    if (this._built || this._disposed) return this;
    this._built = true;

    const { mask, layout, level } = this;
    const rng = this._rng;
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    // 1) 水面格 + 离岸距离（BFS 距离变换）
    const shore = new Int16Array(MASK_LEN);
    const queue = new Int32Array(MASK_LEN);
    const waterCells = [];
    let qh = 0, qt = 0;
    const isWater = (x, z) => {
      if (x < -GOX || x >= GOX || z < -GOZ || z >= GOZ) return 0;
      return mask[maskIdx(x, z)];
    };
    for (let z = -GOZ; z < GOZ; z++) {
      for (let x = -GOX; x < GOX; x++) {
        const i = maskIdx(x, z);
        if (!mask[i]) continue;
        waterCells.push(i);
        if (!isWater(x + 1, z) || !isWater(x - 1, z) || !isWater(x, z + 1) || !isWater(x, z - 1)) {
          shore[i] = 1;
          queue[qt++] = i;
        }
      }
    }
    const nbr = [-1, 1, -GW, GW];
    while (qh < qt) {
      const i = queue[qh++];
      const d = shore[i];
      if (d >= 48) continue;
      for (let k = 0; k < 4; k++) {
        const j = i + nbr[k];
        if (j < 0 || j >= MASK_LEN) continue;
        if (!mask[j] || shore[j]) continue;
        shore[j] = d + 1;
        queue[qt++] = j;
      }
    }
    this._waterCells = waterCells.length;

    // 2) 溪流线段（方向沿 pts 顺序；w 为河宽）
    const segs = [];
    for (const s of layout.STREAMS) {
      const pts = s.pts || [];
      for (let i = 0; i < pts.length - 1; i++) {
        const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
        const vx = bx - ax, vz = bz - az;
        const len = Math.hypot(vx, vz) || 1;
        segs.push({ ax, az, bx, bz, dx: vx / len, dz: vz / len, w: s.w || 6, name: s.name || '' });
      }
    }

    // 3) 池面漩涡
    const ponds = layout.PONDS.map((p, i) => ({
      cx: p.cx, cz: p.cz, rx: Math.max(1, p.rx), rz: Math.max(1, p.rz),
      sign: i % 2 === 0 ? 1 : -1, name: p.name || '',
    }));

    // 4) 瀑布（跌水）位置：沁芳闸闸口下泻入池、花溆石洞水口
    //    坐标按全园真实体素剖面对齐（闸桥南缘 z≈-133、石拱西口 x≈32..40）
    const FALLS = [
      { x: 130.5, z: -132.3, r: 11.0, dx: -0.16, dz: 1 },   // 沁芳闸跌水（白水帘落在闸桥南面）
      { x: 30.5, z: -90.5, r: 12.0, dx: -1, dz: 0.15 },     // 花溆石洞水口（拱口向池）
    ];
    this._falls = FALLS;

    // 5) 逐格计算流场 → 邻域平滑（消除 1 格台阶）→ 生成水面几何
    const pos = [];
    const flowAttr = [];
    const metaAttr = [];
    const index = [];
    const fX = new Float32Array(MASK_LEN), fZ = new Float32Array(MASK_LEN);
    const spd = new Float32Array(MASK_LEN);
    const dep = new Float32Array(MASK_LEN);
    const shor = new Float32Array(MASK_LEN);
    const knd = new Float32Array(MASK_LEN);

    for (let w = 0; w < waterCells.length; w++) {
      const i = waterCells[w];
      const x = (i % GW) - GOX;
      const z = ((i / GW) | 0) - GOZ;

      // 溪流影响（方向 = 线段方向的加权合成）
      let wsum = 0, dx = 0, dz = 0, sSpd = 0;
      for (let s = 0; s < segs.length; s++) {
        const sg = segs[s];
        const vx = x - sg.ax, vz = z - sg.az;
        const wx = sg.bx - sg.ax, wz = sg.bz - sg.az;
        const len2 = wx * wx + wz * wz || 1;
        const t = clamp((vx * wx + vz * wz) / len2, 0, 1);
        const px = sg.ax + wx * t, pz = sg.az + wz * t;
        const d = Math.hypot(x - px, z - pz);
        const infl = 1 - d / (sg.w * 0.5 + 4.5);
        if (infl <= 0) continue;
        const ww = infl * infl;
        wsum += ww;
        dx += sg.dx * ww;
        dz += sg.dz * ww;
        sSpd += ww * (0.9 + 0.35 * ((sg.w < 6) ? 0.4 : 0.0));
      }

      // 池面环流
      let pfX = 0, pfZ = 0, pSpd = 0, pE = 9;
      for (let p = 0; p < ponds.length; p++) {
        const pd = ponds[p];
        const ex = (x - pd.cx) / pd.rx, ez = (z - pd.cz) / pd.rz;
        const e2 = ex * ex + ez * ez;
        if (e2 >= pE) continue;
        pE = e2;
        const e = Math.sqrt(e2);
        const gx = 2 * ex / pd.rx, gz = 2 * ez / pd.rz;
        let tx = -gz, tz = gx;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl; tz /= tl;
        const wgt = clamp(1.1 - e, 0, 1) * 0.55;
        pfX = tx * pd.sign * wgt;
        pfZ = tz * pd.sign * wgt;
        pSpd = 0.16 + 0.16 * clamp(1 - e, 0, 1);
      }
      const sw = clamp(wsum, 0, 1.5);
      let fx = dx + pfX * (1 - clamp(sw * 0.8, 0, 1));
      let fz = dz + pfZ * (1 - clamp(sw * 0.8, 0, 1));
      let flen = Math.hypot(fx, fz);
      if (flen < 1e-4) { fx = 0.18; fz = 0.08; flen = 1; }
      fx /= flen; fz /= flen;
      let sp = clamp(0.22 + sSpd * 0.55 + pSpd * 0.5 + sw * 0.22, 0.14, 1.55);

      // 跌水附近：流向指向池心 + 提速
      for (let f = 0; f < FALLS.length; f++) {
        const fl = FALLS[f];
        const d = Math.hypot(x - fl.x, z - fl.z);
        if (d >= fl.r) continue;
        const k = 1 - d / fl.r;
        fx = fx * (1 - k) + fl.dx * k;
        fz = fz * (1 - k) + fl.dz * k;
        flen = Math.hypot(fx, fz) || 1;
        fx /= flen; fz /= flen;
        sp += k * 0.55;
      }

      fX[i] = fx; fZ[i] = fz; spd[i] = sp;
      dep[i] = clamp((shore[i] - 1) / 17, 0, 1);
      shor[i] = clamp((shore[i] - 1) / 13, 0, 1);
      let kind = 0;
      // 闸口：只标记闸桥南侧的下泻白浪区（桥下石块区不必再叠白）
      if (Math.hypot(x - FALLS[0].x, z - FALLS[0].z) < 7.4 && z > -133.2) kind = 1;
      // 花溆石洞：拱口外池面白浪
      if (Math.hypot(x - FALLS[1].x, z - FALLS[1].z) < 6.8) kind = 1;
      knd[i] = kind;
    }

    // 流场邻域平滑：2 遍 4 邻域平均（只在同样有水的格之间），去掉 1 格量化条纹
    const tX = new Float32Array(MASK_LEN);
    const tZ = new Float32Array(MASK_LEN);
    const tS = new Float32Array(MASK_LEN);
    for (let pass = 0; pass < 2; pass++) {
      for (let w = 0; w < waterCells.length; w++) {
        const i = waterCells[w];
        let ax = fX[i], az = fZ[i], as = spd[i], n = 1;
        if (i % GW < GW - 1 && mask[i + 1]) { ax += fX[i + 1]; az += fZ[i + 1]; as += spd[i + 1]; n++; }
        if (i % GW > 0 && mask[i - 1]) { ax += fX[i - 1]; az += fZ[i - 1]; as += spd[i - 1]; n++; }
        if (i + GW < MASK_LEN && mask[i + GW]) { ax += fX[i + GW]; az += fZ[i + GW]; as += spd[i + GW]; n++; }
        if (i - GW >= 0 && mask[i - GW]) { ax += fX[i - GW]; az += fZ[i - GW]; as += spd[i - GW]; n++; }
        tX[i] = ax / n; tZ[i] = az / n; tS[i] = as / n;
      }
      for (let w = 0; w < waterCells.length; w++) {
        const i = waterCells[w];
        const l = Math.hypot(tX[i], tZ[i]) || 1;
        fX[i] = tX[i] / l; fZ[i] = tZ[i] / l; spd[i] = tS[i];
      }
    }

    // 角点属性网格（相邻格共享同一角点值 → 跨格属性连续，消除 1m 棋盘接缝）
    const CW = GW + 1;
    const cFX = new Float32Array(CW * CW), cFZ = new Float32Array(CW * CW);
    const cSpd = new Float32Array(CW * CW), cDep = new Float32Array(CW * CW), cShor = new Float32Array(CW * CW);
    const cIdx = (cx, cz) => (cx + GOX) + (cz + GOZ) * CW;
    for (let cz = -GOZ; cz <= GOZ; cz++) {
      for (let cx = -GOX; cx <= GOX; cx++) {
        let ax = 0, az = 0, asp = 0, adp = 0, ash = 0, n = 0;
        for (let dz = -1; dz <= 0; dz++) {
          for (let dx = -1; dx <= 0; dx++) {
            const x = cx + dx, z = cz + dz;
            if (x < -GOX || x >= GOX || z < -GOZ || z >= GOZ) continue;
            const ii = maskIdx(x, z);
            if (!mask[ii]) continue;
            ax += fX[ii]; az += fZ[ii]; asp += spd[ii]; adp += dep[ii]; ash += shor[ii]; n++;
          }
        }
        const k = cIdx(cx, cz);
        if (n) { ax /= n; az /= n; asp /= n; adp /= n; ash /= n; }
        cFX[k] = ax; cFZ[k] = az; cSpd[k] = asp; cDep[k] = adp; cShor[k] = ash;
      }
    }
    // 每个角点写入一套 aFlow/aMeta；一格的 4 个角分别取各自角点值
    const pushCorner = (k, kind) => {
      let fx = cFX[k], fz = cFZ[k];
      const l = Math.hypot(fx, fz);
      if (l < 1e-4) { fx = 0.18; fz = 0.08; } else { fx /= l; fz /= l; }
      flowAttr.push(fx, fz);
      metaAttr.push(cSpd[k], cDep[k], cShor[k], kind);
    };
    for (let w = 0; w < waterCells.length; w++) {
      const i = waterCells[w];
      const x = (i % GW) - GOX;
      const z = ((i / GW) | 0) - GOZ;
      const kind = knd[i];
      const base = pos.length / 3;
      pos.push(x, level, z, x, level, z + 1, x + 1, level, z + 1, x + 1, level, z);
      pushCorner(cIdx(x, z), kind);
      pushCorner(cIdx(x, z + 1), kind);
      pushCorner(cIdx(x + 1, z + 1), kind);
      pushCorner(cIdx(x + 1, z), kind);
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      this._quads++;
    }

    // 6) 白色水帘（并入同一几何；aMeta.w=2 → 片元走竖直流线分支）
    const pushCurtain = (x0, z0, x1, z1, y0, y1, fx, fz, sp) => {
      const base = pos.length / 3;
      // 底边 → 顶边（双面材质，无需纠结朝向）
      pos.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0);
      for (let k = 0; k < 4; k++) {
        flowAttr.push(fx, fz);
        metaAttr.push(sp, 0.8, 0.55, 2.0);
      }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      this._quads++;
    };
    // 沁芳闸：闸桥南面大瀑布（自桥面下泻入池，正对 poi:qinfangzha 视线的南向白水帘）
    pushCurtain(124.8, -132.9, 136.2, -132.9, level - 0.3, level + 3.05, 0, 1, 1.1);
    pushCurtain(126.0, -132.25, 135.0, -132.25, level - 0.25, level + 2.1, 0, 1, 0.9);
    pushCurtain(128.0, -131.7, 133.2, -131.7, level - 0.2, level + 1.25, 0, 1, 0.8);
    // 闸口下游（北面）一条较窄水帘，保证从园外/背面看也有白水
    pushCurtain(127.4, -139.7, 134.8, -139.7, level - 0.2, level + 2.1, 0.1, -1, 0.9);
    // 花溆石洞：拱口斜向大水帘（西口朝池，面向西南；高至洞顶下方）
    pushCurtain(32.6, -94.2, 38.6, -87.2, level - 0.25, level + 6.0, -0.7, 0.7, 1.15);
    pushCurtain(28.6, -92.8, 34.4, -86.8, level - 0.2, level + 4.1, -0.7, 0.7, 0.95);
    pushCurtain(30.4, -91.6, 31.6, -90.4, level - 0.15, level + 2.2, -0.7, 0.7, 1.2);

    // 7) 装配几何
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flowAttr, 2));
    geo.setAttribute('aMeta', new THREE.Float32BufferAttribute(metaAttr, 4));
    const vertCount = pos.length / 3;
    geo.setIndex(new THREE.BufferAttribute(vertCount > 65535 ? new Uint32Array(index) : new Uint16Array(index), 1));
    geo.computeBoundingSphere();

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'HDWaterSurface';
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this._waterMesh = mesh;
    this._meshes.push(mesh);
    this._calls++;

    // 8) 桥墩泡沫点
    this._collectPiers();

    // 9) GPU 粒子：跌水水花/水雾 + 水面漂浮光点
    this._buildParticles(waterCells, rng);

    // 10) 锦鲤
    this._buildFish(rng);

    this._buildMs = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);
    return this;
  }

  // ── 粒子 ──────────────────────────────────────────────────────────────────
  _buildParticles(waterCells, rng) {
    const q = this.quality;
    const count = q === 'high' ? 1600 : q === 'mid' ? 800 : 600; // 桌面 ≤2000 / 移动 ≤800
    const aOrigin = new Float32Array(count * 3);
    const aVel = new Float32Array(count * 3);
    const aPhase = new Float32Array(count);
    const aLife = new Float32Array(count);
    const aSize = new Float32Array(count);
    const aKind = new Float32Array(count);

    let i = 0;
    const setP = (origin, vel, life, size, kind) => {
      if (i >= count) return;
      aOrigin[i * 3] = origin[0]; aOrigin[i * 3 + 1] = origin[1]; aOrigin[i * 3 + 2] = origin[2];
      aVel[i * 3] = vel[0]; aVel[i * 3 + 1] = vel[1]; aVel[i * 3 + 2] = vel[2];
      aPhase[i] = rng();
      aLife[i] = life[0] + rng() * (life[1] - life[0]);
      aSize[i] = size[0] + rng() * (size[1] - size[0]);
      aKind[i] = kind;
      i++;
    };

    // 沁芳闸：闸桥南面大瀑布的水花（24%）+ 水雾（12%）
    const gateSpray = Math.round(count * 0.24);
    for (let k = 0; k < gateSpray; k++) {
      const ox = 126.5 + rng() * 8.5, oz = -133.4 + rng() * 2.6, oy = this.level + 0.1 + rng() * 2.2;
      setP([ox, oy, oz], [-0.55 + rng() * 1.1, 0.7 + rng() * 2.4, 0.5 + rng() * 1.7], [0.7, 1.5], [0.10, 0.30], 0);
    }
    const gateMist = Math.round(count * 0.15);
    for (let k = 0; k < gateMist; k++) {
      const ox = 126.0 + rng() * 9.0, oz = -133.2 + rng() * 3.4, oy = this.level + 0.4 + rng() * 2.6;
      setP([ox, oy, oz], [-0.18 + rng() * 0.36, 0.16 + rng() * 0.38, 0.05 + rng() * 0.4], [2.2, 4.6], [0.6, 1.25], 1);
    }
    // 花溆石洞：拱口大水帘的水花（28%）+ 水雾（14%）
    const caveSpray = Math.round(count * 0.28);
    for (let k = 0; k < caveSpray; k++) {
      const ox = 28.5 + rng() * 9.5, oz = -94.0 + rng() * 7.0, oy = this.level + 0.1 + rng() * 3.0;
      setP([ox, oy, oz], [-1.6 + rng() * 1.0, 0.9 + rng() * 2.4, 0.2 + rng() * 1.0], [0.7, 1.6], [0.10, 0.28], 0);
    }
    const caveMist = Math.round(count * 0.16);
    for (let k = 0; k < caveMist; k++) {
      const ox = 27.5 + rng() * 11.0, oz = -94.5 + rng() * 8.0, oy = this.level + 0.5 + rng() * 4.0;
      setP([ox, oy, oz], [-0.35 + rng() * 0.3, 0.18 + rng() * 0.42, 0.0 + rng() * 0.3], [2.4, 5.0], [0.6, 1.3], 1);
    }
    // 水面漂浮光点（剩余）
    while (i < count) {
      const wi = waterCells[(rng() * waterCells.length) | 0];
      const x = (wi % GW) - GOX + rng();
      const z = ((wi / GW) | 0) - GOZ + rng();
      setP([x, this.level + 0.03, z], [0.02 + rng() * 0.05, 0, 0.02 + rng() * 0.05], [3, 6], [0.08, 0.20], 2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(aOrigin.slice(), 3)); // 占位（shader 用 aOrigin）
    geo.setAttribute('aOrigin', new THREE.BufferAttribute(aOrigin, 3));
    geo.setAttribute('aVel', new THREE.BufferAttribute(aVel, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(aLife, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
    geo.setAttribute('aKind', new THREE.BufferAttribute(aKind, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 4, 0), 320);
    const mat = new THREE.ShaderMaterial({
      uniforms: this._particleUniforms,
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    });
    const points = new THREE.Points(geo, mat);
    points.name = 'HDWaterParticles';
    points.renderOrder = 3;
    points.frustumCulled = false;
    this.scene.add(points);
    this._particles = points;
    this._meshes.push(points);
    this._calls++;
    this._particleCount = count;
  }

  // ── 锦鲤 ──────────────────────────────────────────────────────────────────
  _buildFish(rng) {
    const ponds = this.layout.PONDS.filter((p) => /沁芳池|藕香池|花溆潭/.test(p.name || ''));
    const list = ponds.length ? ponds : this.layout.PONDS;
    const q = this.quality;
    const count = q === 'high' ? 14 : q === 'mid' ? 11 : 8;
    const geo = buildFishGeometry();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffa060, transparent: true, opacity: 0.92, side: THREE.DoubleSide,
      depthWrite: false, fog: true, toneMapped: false,
    });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.name = 'HDWaterKoi';
    inst.renderOrder = 1;
    inst.frustumCulled = false;
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const palette = [0xff8a4a, 0xe85f2e, 0xf0a03a, 0xd9482a, 0xffb35e];
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const pond = list[i % list.length];
      const rf = 0.38 + rng() * 0.34;
      const data = {
        cx: pond.cx, cz: pond.cz, rx: Math.max(1, pond.rx), rz: Math.max(1, pond.rz),
        rf,
        dir: rng() < 0.5 ? 1 : -1,
        angSpeed: (0.09 + rng() * 0.15),
        phase: rng() * Math.PI * 2,
        yOff: 0.22 + rng() * 0.34,
        size: 1.1 + rng() * 0.5,
        wobble: rng() * Math.PI * 2,
      };
      this._fishData.push(data);
      col.setHex(palette[i % palette.length]);
      inst.setColorAt(i, col);
    }
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.scene.add(inst);
    this._fish = inst;
    this._meshes.push(inst);
    this._calls++;
    this._fishCount = count;
    this._updateFish(0);
  }

  _updateFish(time) {
    const inst = this._fish;
    if (!inst) return;
    const data = this._fishData;
    const m4 = this._m4, q = this._quat, p = this._pos, s = this._scale;
    const lvl = this.level;
    for (let i = 0; i < data.length; i++) {
      const f = data[i];
      const a = f.phase + time * f.angSpeed * f.dir;
      const x = f.cx + Math.cos(a) * f.rx * f.rf;
      const z = f.cz + Math.sin(a) * f.rz * f.rf;
      const y = lvl - f.yOff - 0.12 * Math.sin(time * 0.7 + f.wobble);
      // 切线方向（游动方向）
      const dx = -Math.sin(a) * f.rx * f.rf * f.dir;
      const dz = Math.cos(a) * f.rz * f.rf * f.dir;
      const yaw = Math.atan2(-dz, dx);
      q.setFromAxisAngle(this._up, yaw);
      p.set(x, y, z);
      const sc = f.size * (1 + 0.06 * Math.sin(time * 6 + i));
      s.set(sc, 1, sc);
      m4.compose(p, q, s);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
  }

  // ── 昼夜 ──────────────────────────────────────────────────────────────────
  setTimeOfDay(todName, sunDir, instant = false) {
    const t = WATER_TOD[todName] || WATER_TOD.day;
    this._todName = WATER_TOD[todName] ? todName : 'day';
    this._todTarget = t;
    const v3 = (hex) => new THREE.Vector3(...hexToVec3(hex));
    this._todTargetColors = {
      deep: v3(t.deep), shallow: v3(t.shallow), sky: v3(t.sky), sun: v3(t.sun),
      foam: v3(t.foam), petal: v3(t.petal), fog: v3(t.fog),
    };
    if (sunDir) {
      const sx = Array.isArray(sunDir) ? sunDir[0] : sunDir.x;
      const sy = Array.isArray(sunDir) ? sunDir[1] : sunDir.y;
      const sz = Array.isArray(sunDir) ? sunDir[2] : sunDir.z;
      if (Number.isFinite(sx) && Number.isFinite(sy) && Number.isFinite(sz)) {
        this._sunTarget.set(sx, sy, sz).normalize();
      }
    } else {
      this._sunTarget.set(t.sunDir[0], t.sunDir[1], t.sunDir[2]).normalize();
    }
    if (instant) this._applyTod(t, true);
    return this;
  }

  _applyTod(t, instant = false) {
    const u = this.uniforms;
    const c = instant ? null : this._todTargetColors;
    const set3 = (uniform, hex, vec) => {
      if (vec) uniform.value.copy(vec);
      else uniform.value.set(...hexToVec3(hex));
    };
    if (instant || !c) {
      set3(u.uDeep, t.deep);
      set3(u.uShallow, t.shallow);
      set3(u.uSky, t.sky);
      set3(u.uSun, t.sun);
      set3(u.uFoam, t.foam);
      set3(u.uPetal, t.petal);
      set3(u.uFogColor, t.fog);
      u.uFogNear.value = t.fogNear;
      u.uFogFar.value = t.fogFar;
      u.uSunI.value = t.sunI;
      u.uNight.value = t.night;
      this._sunTarget.set(t.sunDir[0], t.sunDir[1], t.sunDir[2]).normalize();
      u.uSunDir.value.copy(this._sunTarget);
      const pu = this._particleUniforms;
      if (pu) {
        pu.uFoam.value.copy(u.uFoam.value);
        pu.uSky.value.copy(u.uSky.value);
        pu.uSun.value.copy(u.uSun.value);
      }
    }
  }

  // ── 每帧 ──────────────────────────────────────────────────────────────────
  update(time, dt) {
    if (!this._built || this._disposed) return;
    const u = this.uniforms;
    u.uTime.value = time;
    this._particleUniforms.uTime.value = time;

    // 昼夜渐变（无逐帧分配）
    const tc = this._todTargetColors;
    if (tc) {
      const k = clamp((dt || 0.016) * 3.0, 0, 1);
      const lerp3 = (uniform, target) => { uniform.value.lerp(target, k); };
      lerp3(u.uDeep, tc.deep);
      lerp3(u.uShallow, tc.shallow);
      lerp3(u.uSky, tc.sky);
      lerp3(u.uSun, tc.sun);
      lerp3(u.uFoam, tc.foam);
      lerp3(u.uPetal, tc.petal);
      lerp3(u.uFogColor, tc.fog);
      const t = this._todTarget;
      u.uFogNear.value += (t.fogNear - u.uFogNear.value) * k;
      u.uFogFar.value += (t.fogFar - u.uFogFar.value) * k;
      u.uSunI.value += (t.sunI - u.uSunI.value) * k;
      u.uNight.value += (t.night - u.uNight.value) * k;
      u.uSunDir.value.lerp(this._sunTarget, k).normalize();
      const pu = this._particleUniforms;
      pu.uFoam.value.lerp(tc.foam, k);
      pu.uSky.value.lerp(tc.sky, k);
      pu.uSun.value.lerp(tc.sun, k);
    }

    if (this._fish) this._updateFish(time);
  }

  /** Lead 可选用：按视口高度（物理像素）校准粒子点大小；不调用则用构造参数 pixelScale */
  setPixelScale(px) {
    if (!Number.isFinite(px) || px <= 0) return this;
    this.pixelScale = px;
    this._particleUniforms.uPixelScale.value = px;
    return this;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const obj of this._meshes) {
      if (!obj) continue;
      if (obj.parent) obj.parent.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    }
    this._meshes.length = 0;
    this._waterMesh = null;
    this._particles = null;
    this._fish = null;
    this._fishData.length = 0;
  }

  stats() {
    return {
      calls: this._calls,
      quads: this._quads,
      instances: this._particleCount + this._fishCount,
      particles: this._particleCount,
      fish: this._fishCount,
      waterCells: this._waterCells,
      buildMs: this._buildMs || 0,
      shader: WATER_SHADER_VERSION,
      level: this.level,
    };
  }
}

export default WaterSystem;
