// ─────────────────────────────────────────────────────────────────────────────
// 入口：加载 → 建园 → 渲染 → 交互 → UI
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { World } from './core/world.js';
import { WATER_LEVEL, POIS } from './garden/layout.js';
import * as LAYOUT from './garden/layout.js';
import { buildVoxelGeometry } from './core/mesher.js';
import { GardenView, TOD } from './core/renderer.js';
import { GardenControls } from './core/controls.js';
import { Walker } from './core/walker.js';
import { buildDoors } from './core/doors.js';
import { buildDetails } from './garden/ornaments.js';
import { WaterSystem } from './core/water.js';
import { buildGarden, makeMinimap, POIS_MERGED } from './garden/index.js';
import { buildDecalGroup } from './core/decals.js';
import { initUI } from './ui/ui.js';

const params = new URLSearchParams(location.search);
const isMobile = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent) || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
const quality = params.get('quality') || (isMobile ? 'mid' : 'high');
const canvas = document.getElementById('scene');
const tick = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// ── 事件总线 ────────────────────────────────────────────────────────────────
function makeApp() {
  const listeners = new Map();
  const app = {
    isMobile,
    quality,
    ready: false,
    tod: 'day',
    mode: 'orbit',
    tour: false,
    labels: false,
    hidden: false,
    _errors: [],
    on(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, new Set());
      listeners.get(evt).add(fn);
      return () => app.off(evt, fn);
    },
    off(evt, fn) { listeners.get(evt)?.delete(fn); },
    emit(evt, payload) {
      for (const fn of [...(listeners.get(evt) || [])]) {
        try { fn(payload); } catch (e) { console.error('[UI]', evt, e); }
      }
    },
    getState() {
      return {
        tod: app.tod, mode, tour: app.tour, labels: app.labels, hidden: app.hidden, ready: app.ready,
        poi: app.currentPoi || null, view: app.getView(),
      };
    },
    progress(p, text) { app.emit('progress', { p, text }); },
  };
  return app;
}

const app = makeApp();
let view, controls, world, minimapImage, walker, terrainData, waterSystem;
let mode = 'orbit';
let tourTimer = null, tourIndex = 0, tourDwell = null;
// 漫游路线：依《红楼梦》第十七回游园顺序，随后省亲别墅与园中诸景
const tourList = ['main_gate', 'cuzhang', 'qinfangting', 'xiaoxiang', 'daoxiang', 'hengwu', 'yihong', 'shengqin', 'longcui', 'gubishan', 'aojing', 'huaxu', 'qinfangzha', 'ouxiangxie', 'zilingzhou', 'luxuean', 'hongxiangpu'];

// 迁移的相机预设
const VIEWS = {
  overview: { target: [0, 8, -4], theta: -0.58, phi: 0.94, radius: 255 },
  overview2: { target: [0, 6, 0], theta: 0.66, phi: 0.99, radius: 240 },
  top: { target: [0, 0, -4], theta: 0, phi: 0.18, radius: 340 },
  gate: { target: [0, 10, 140], theta: 0.03, phi: 1.29, radius: 88 },
  pond: { target: [-6, 3, -34], theta: 0.5, phi: 0.86, radius: 92 },
};

// ── 地名标签层（DOM 投影，跟随相机）────────────────────────────────────────
let labelLayer = null;
let labelEls = [];
let labelAccum = 0;
const _labelVec = new THREE.Vector3();
function initLabels() {
  const root = document.getElementById('ui-root') || document.body;
  labelLayer = document.createElement('div');
  labelLayer.className = 'label-layer gvg-labels';
  labelLayer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:6;';
  root.appendChild(labelLayer);
  labelEls = POIS_MERGED.map((poi) => {
    const el = document.createElement('div');
    el.className = 'poi-label';
    el.style.pointerEvents = 'none';
    el.textContent = poi.name;
    labelLayer.appendChild(el);
    return { el, poi };
  });
  labelLayer.style.display = app.labels ? 'block' : 'none';
}
function updateLabels(dt) {
  if (!labelLayer || !app.labels || !view) return;
  labelAccum += dt;
  if (labelAccum < 0.05) return;
  labelAccum = 0;
  const w = window.innerWidth, h = window.innerHeight;
  const camPos = view.camera.position;
  for (let i = 0; i < labelEls.length; i++) {
    const { el, poi } = labelEls[i];
    _labelVec.set(poi.x, (poi.y || 6) + 7, poi.z);
    const dist = camPos.distanceTo(_labelVec);
    if (dist > 300 || dist < 8) { el.classList.remove('show'); continue; }
    _labelVec.project(view.camera);
    if (_labelVec.z > 1 || _labelVec.z < -1) { el.classList.remove('show'); continue; }
    const x = (_labelVec.x * 0.5 + 0.5) * w;
    const y = (-_labelVec.y * 0.5 + 0.5) * h;
    if (x < -60 || x > w + 60 || y < -30 || y > h + 30) { el.classList.remove('show'); continue; }
    el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, -100%)`;
    el.style.opacity = String(Math.max(0.35, 1 - dist / 340));
    el.classList.add('show');
  }
}

function applyViewSpec(spec, instant = true) {
  if (!spec || !controls) return;
  controls.setView(spec, instant);
}

function poiView(poi) {
  const y = (poi.look && poi.look[1] != null) ? poi.look[1] : poi.y + 4;
  const target = [poi.x, y, poi.z];
  if (poi.cam) {
    const sph = new THREE.Spherical().setFromVector3(new THREE.Vector3(poi.cam[0] - target[0], poi.cam[1] - target[1], poi.cam[2] - target[2]));
    return {
      target,
      radius: Math.max(14, sph.radius),
      theta: Math.atan2(poi.cam[0] - target[0], poi.cam[2] - target[2]),
      phi: Math.acos(Math.max(-1, Math.min(1, (poi.cam[1] - target[1]) / Math.max(0.001, sph.radius)))),
    };
  }
  return { target, theta: poi.theta ?? 0.2, phi: poi.phi ?? 1.2, radius: poi.radius ?? 50 };
}

if (!canvas) throw new Error('missing canvas');

// 启动上下文尽快挂载，UI 初始化后即可显示启动页
window.GVG = {
  app,
  pois: POIS_MERGED,
  minimapMeta: { extent: 160, size: 320 },
};
try { initUI(app); } catch (e) { console.error('[UI init]', e); }

const setProgress = (p, text) => app.progress(p, text);

async function boot() {
  try {
    setProgress(0.01, '缘起…');
    await tick();
    world = new World();
    const t0 = performance.now();
    const { terrain, decals, cleaned, postBuild, animators, ctx } = await buildGarden(
      world,
      ({ p, text }) => setProgress(0.02 + p * 0.62, text || ''),
      { isMobile, quality },
    );
    setProgress(0.66, '研墨题额…');
    await tick();
    minimapImage = makeMinimap(world, terrain);
    window.GVG.minimapImage = minimapImage;
    window.GVG.terrain = terrain;

    setProgress(0.7, '雕甍绣槛…');
    await tick();
    const geo = buildVoxelGeometry(world);
    setProgress(0.82, '张灯结彩…');
    await tick();
    view = new GardenView(canvas, { quality, mobile: isMobile, preserveDrawingBuffer: params.has('shot') });
    view.setVoxels(geo);
    // 精细动态水系（自管水色/粒子/锦鲤/水帘）
    try {
      waterSystem = new WaterSystem({ scene: view.scene, layout: LAYOUT, mask: terrain.water, level: WATER_LEVEL, quality });
      waterSystem.build();
      view.onFrame((dt) => { if (!view.paused) waterSystem.update(view.time, dt); });
      window.GVG.water = waterSystem;
    } catch (e) { console.error('[water]', e); view.setWater(terrain.water, WATER_LEVEL); }
    const decalGroup = buildDecalGroup(decals);
    view.group.add(decalGroup);
    view.setDecalGroup(decalGroup);
    // ── 精细构造/植被等后处理对象（postBuild，由各模块注册）────────────────
    const detailGroup = new THREE.Group();
    detailGroup.name = 'details';
    for (const fn of postBuild || []) {
      try {
        const obj = fn(ctx);
        if (!obj) continue;
        for (const o of Array.isArray(obj) ? obj : [obj]) if (o) detailGroup.add(o);
      } catch (e) { console.error('[postBuild]', e); }
    }
    view.group.add(detailGroup);
    // 精细建筑构件 / 门窗 / 家具陈设（ornaments），失败时退回 Lead 的简易门扇
    try {
      const orn = buildDetails(ctx);
      if (orn) { detailGroup.add(orn); window.GVG.orn = orn; }
      else throw new Error('buildDetails returned empty');
    } catch (e) {
      console.error('[ornaments]', e);
      try {
        const doorMesh = buildDoors(ctx);
        if (doorMesh) detailGroup.add(doorMesh);
      } catch (e2) { console.error('[doors]', e2); }
    }
    window.GVG.ctx = ctx;
    window.GVG.details = ctx && ctx.details;
    window.GVG.detailGroup = detailGroup;
    if (animators && animators.length) view.onFrame((dt) => {
      const t = view.time;
      for (const fn of animators) { try { fn(t, dt); } catch (e) { console.error('[animator]', e); } }
    });
    controls = new GardenControls(view.camera, canvas, { radius: 120, theta: 0.04, phi: 1.28, target: [0, 12, 138] });
    controls.setLimits([0.1, 1.42], [14, 520]);
    view.start(controls);
    // ── 第一人称步行控制器 ────────────────────────────────────────────────
    terrainData = terrain;
    let lastHint = '';
    walker = new Walker({
      world, terrain, camera: view.camera, canvas,
      layout: { POIS },
      details: ctx && ctx.details,
      onEvent: (e) => {
        if (e.type === 'walk') {
          app.emit('walk', e);
          const hint = e.hint || '';
          if (hint !== lastHint) {
            lastHint = hint;
            app.emit('interact', hint ? { type: hint.startsWith('开门') ? 'door' : 'poi', label: hint, key: 'E' } : null);
          }
        } else if (e.type === 'poi') {
          const poi = POIS_MERGED.find((p) => p.id === e.id);
          if (poi) { app.currentPoi = poi.id; app.emit('poi', poi); }
        } else if (e.type === 'indoor') {
          // 室内略提亮加暖，弥补体素无光照；退出室内恢复
          canvas.style.filter = e.indoor ? 'brightness(1.28) contrast(1.04) saturate(1.06) sepia(0.05)' : '';
          app.indoors = !!e.indoor;
          app.emit('indoor', { indoor: !!e.indoor });
        }
      },
    });
    walker.setDetails(ctx && ctx.details);
    view.preUpdate = (dt) => { walker.update(dt); if (app.tour && mode === 'walk') stopTour(); };
    window.GVG.walker = walker;
    initLabels();
    view.onFrame((dt) => updateLabels(dt));
    setProgress(0.94, '开园…');
    // 背景音乐式氛围：默认时段
    const tod = params.get('tod') || 'day';
    view.setTimeOfDay(tod, true);
    app.tod = tod;
    try { if (waterSystem) waterSystem.setTimeOfDay(tod, TOD[tod]?.sunDir, true); } catch (e) { console.error('[water tod]', e); }

    // 相机／视角参数
    const v = params.get('view') || '';
    if (v.startsWith('poi:')) {
      const poi = POIS_MERGED.find((p) => p.id === v.slice(4));
      if (poi) applyViewSpec(poiView(poi), true);
    } else if (VIEWS[v]) {
      applyViewSpec(VIEWS[v], true);
    } else if (v.includes(',')) {
      const [x, y, z, tx, ty, tz] = v.split(',').map(Number);
      if ([x, y, z, tx, ty, tz].every((n) => Number.isFinite(n))) {
        const sph = new THREE.Spherical().setFromVector3(new THREE.Vector3(x - tx, y - ty, z - tz));
        controls.setView({ target: [tx, ty, tz], radius: sph.radius, theta: Math.atan2(x - tx, z - tz), phi: Math.acos(Math.max(-1, Math.min(1, (y - ty) / sph.radius))) }, true);
      }
    } else if (!params.has('shot')) {
      // 默认开场：南门外远望正门，随后缓慢推进（电影感入场）
      controls.setView({ target: [0, 10, 138], theta: 0.02, phi: 1.27, radius: 132 }, true);
      if (params.get('intro') !== '0') {
        setTimeout(() => {
          if (!controls || controls.userInteracted) return;
          controls.flyTo({ target: [0, 10, 140], theta: 0.03, phi: 1.3, radius: 84 }, 6500);
        }, 1400);
      }
    }
    if (params.get('ui') === '0') document.body.classList.add('ui-hidden');

    setProgress(1, '就绪');
    app.ready = true;
    if (params.has('shot')) {
      const boot = document.getElementById('boot');
      if (boot) { boot.style.transition = 'none'; boot.style.display = 'none'; }
    }
    app.emit('ready', { buildMs: Math.round(performance.now() - t0), stats: view.stats() });
    window.GVG.view = view;
    window.GVG.controls = controls;
    window.GVG.world = world;
    window.GVG.buildInfo = { buildMs: Math.round(performance.now() - t0), cleaned, stats: view.stats() };
    window.GVG.stats = () => view.stats();
    window.GVG.layout = (await import('./garden/layout.js'));
    requestAnimationFrame(() => { window.__GVG_READY__ = true; });
  } catch (err) {
    console.error(err);
    app._errors.push(String(err && err.stack || err));
    app.emit('error', { message: '园林营造失败：' + (err && err.message || err) });
    window.__GVG_READY__ = true;
  }
}

// ── app 能力 ────────────────────────────────────────────────────────────────
/** 景点的步行落点：优先 layout.POIS[].walk = [x,z,yaw]；否则取景点附近最近的园路格 */
function walkPosFor(poi) {
  if (Array.isArray(poi.walk)) {
    const [x, z, yaw] = poi.walk;
    return { x, z, yaw: Number.isFinite(yaw) ? yaw : Math.atan2(poi.x - x, -(poi.z - z)) };
  }
  if (terrainData && terrainData.isPath && terrainData.isWater) {
    let best = null, bestScore = 1e9;
    const cx = Math.round(poi.x), cz = Math.round(poi.z);
    for (let r = 2; r <= 34; r += 1) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx + dx, z = cz + dz;
        if (x < -140 || x > 140 || z < -140 || z > 146) continue;
        if (!terrainData.isPath(x, z) || terrainData.isWater(x, z)) continue;
        // 优先建筑南侧 8–18m、中轴线附近的园路（多数景点入口朝南）
        const south = dz > 4;
        const score = Math.abs(dx) * (south ? 2.2 : 6) + Math.abs(dz - (south ? 13 : -13)) * 1.4;
        if (score < bestScore) { bestScore = score; best = { x: x + 0.5, z: z + 0.5 }; }
      }
      if (best && r > 20) break;
    }
    if (best) return { ...best, yaw: Math.atan2(poi.x - best.x, -(poi.z - best.z)) };
  }
  const x = poi.x + 0.5, z = poi.z + 12.5;
  return { x, z, yaw: 0 };
}
function facePoi(poi, wx, wz) {
  return Math.atan2(poi.x - wx, -(poi.z - wz));
}
function setMode(next) {
  if (next !== 'walk' && next !== 'orbit') return mode;
  if (!view || !walker || !controls) return mode;
  if (next === mode) return mode;
  if (next === 'walk') {
    if (app.tour) stopTour();
    // 若轨道视点正落在建筑内部/遮挡处，则从正门外御道开始步行
    let sx = controls.target.x, sz = controls.target.z;
    const gy = (terrainData && terrainData.groundTop ? terrainData.groundTop(Math.round(sx), Math.round(sz)) : 3) + 1;
    let roofed = false;
    for (let y = gy + 2; y <= gy + 11 && world; y++) {
      if (world.solid(Math.floor(sx), y, Math.floor(sz))) { roofed = true; break; }
    }
    if (roofed) { sx = 0; sz = 152; }
    controls.enabled = false;
    view.controls = null;
    walker.enter(sx, sz, roofed ? 0 : Math.atan2(controls.target.x - sx, -(controls.target.z - sz)));
    mode = 'walk';
  } else {
    walker.exit();
    view.controls = controls;
    controls.enabled = true;
    const s = walker.getState();
    controls.setView({ target: [s.x, Math.max(s.y + 1.6, s.y + 2), s.z], theta: -s.heading, phi: 1.2, radius: 36 }, true);
    mode = 'orbit';
  }
  app.mode = mode;
  app.emit('mode', { mode });
  return mode;
}
app.setMode = (m) => setMode(m);
app.getMode = () => mode;
app.setWalkMove = (x, z, sprint) => { walker?.setMove(x, z, sprint); };
app.setWalkLook = (dx, dy) => { walker?.addLook(dx, dy); };
app.walkJump = () => walker?.jump();
app.setWalkPaused = (v) => { if (walker) walker.paused = !!v; };
app.isWalkPaused = () => !!(walker && walker.paused);
app.walkInteract = () => walker?.interact();
app.walkTeleport = (x, z) => {
  if (!walker) return false;
  if (mode !== 'walk') setMode('walk');
  return walker.teleport(x, z);
};
app.goTo = (id, opts = {}) => {
  const poi = POIS_MERGED.find((p) => p.id === id);
  if (!poi || !controls) return false;
  app.currentPoi = id;
  if (mode === 'walk') {
    const wp = walkPosFor(poi);
    walker.teleport(wp.x, wp.z);
    walker.heading = facePoi(poi, walker.pos.x, walker.pos.z);
    walker.applyCamera();
    app.emit('poi', poi);
    return true;
  }
  applyViewSpec(poiView(poi), false);
  app.emit('poi', poi);
  return true;
};
app.flyToGround = (x, z) => {
  if (mode === 'walk') return app.walkTeleport(x, z);
  if (!controls || !world) return false;
  const y = (world.topY(Math.round(x), Math.round(z)) + 4);
  controls.setView({ target: [x, y, z], radius: Math.max(30, controls.radius * 0.6) }, false);
  return true;
};
app.setTod = (name) => {
  if (!TOD[name]) return;
  view?.setTimeOfDay(name, false);
  try { if (waterSystem) waterSystem.setTimeOfDay(name, TOD[name]?.sunDir, false); } catch (e) { console.error('[water tod]', e); }
  app.tod = name;
  app.emit('tod', name);
};
app.getView = () => {
  if (mode === 'walk' && walker) {
    const s = walker.getState();
    return { x: s.x, y: s.y, z: s.z, heading: s.heading, pitch: s.pitch, mode: 'walk' };
  }
  if (!view || !controls) return null;
  const cam = view.camera.position;
  const t = controls.target;
  const dx = t.x - cam.x, dz = t.z - cam.z;
  const heading = Math.atan2(dx, -dz);
  return { x: cam.x, y: cam.y, z: cam.z, target: [t.x, t.y, t.z], theta: controls.theta, phi: controls.phi, radius: controls.radius, heading, mode: 'orbit' };
};
app.toggleLabels = () => {
  app.labels = !app.labels;
  if (labelLayer) {
    labelLayer.style.display = app.labels ? 'block' : 'none';
    if (!app.labels) for (const { el } of labelEls) el.classList.remove('show');
  }
  app.emit('labels', app.labels);
  return app.labels;
};
app.hideUI = (hide) => {
  app.hidden = hide === undefined ? !app.hidden : !!hide;
  document.body.classList.toggle('ui-hidden', app.hidden);
  app.emit('uihidden', app.hidden);
  return app.hidden;
};
app.toggleTour = () => {
  if (app.tour) { stopTour(); return false; }
  startTour();
  return true;
};
app.tourNext = () => { if (app.tour) { clearTimeout(tourDwell); advanceTour(); } };

function startTour() {
  if (!controls) return;
  app.tour = true;
  tourIndex = 0;
  app.emit('tourstate', true);
  advanceTour();
}
function stopTour() {
  app.tour = false;
  if (tourDwell) clearTimeout(tourDwell);
  tourDwell = null;
  app.emit('tourstop');
  app.emit('tourstate', false);
}
function advanceTour() {
  if (!app.tour) return;
  if (tourIndex >= tourList.length) { stopTour(); return; }
  const id = tourList[tourIndex];
  const poi = POIS_MERGED.find((p) => p.id === id);
  tourIndex++;
  if (!poi) { advanceTour(); return; }
  app.currentPoi = id;
  app.emit('tour', { poi, index: tourIndex, total: tourList.length });
  applyViewSpec(poiView(poi), false);
  tourDwell = setTimeout(() => { if (app.tour) advanceTour(); }, 6200);
}

// 用户交互时中断漫游
window.addEventListener('pointerdown', () => { if (app.tour && !document.body.classList.contains('ui-hidden')) { /* 由 UI 控制，不自动停 */ } }, { passive: true });

boot();
