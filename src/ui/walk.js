// ─────────────────────────────────────────────────────────────────────────────
// 步行模式 UI：准星、状态条、PC 操作提示、触摸摇杆、疾跑/跳跃/退出按钮、
// 交互提示，以及 PC 键盘移动 / 触摸拖拽转身输入转发。
// 引擎契约（phase2-api §6）：
//   app.setMode/getMode/on('mode')、setWalkMove(x,z,sprint)、setWalkLook(dx,dy)、
//   walkJump()、walkInteract()、on('walk', {pos,yaw,pitch,footstep,hint,nearPoi})、
//   on('interact', {type,label,key})
// 所有 DOM 只在初始化时创建；walk 事件（~10Hz）仅更新缓存的文字，不重建节点。
// ─────────────────────────────────────────────────────────────────────────────
import { h, on, clamp, isTypingTarget } from './util.js';
import { icon } from './icons.js';

const KEY_VEC = {
  w: [0, 1],
  a: [-1, 0],
  s: [0, -1],
  d: [1, 0],
  arrowup: [0, 1],
  arrowleft: [-1, 0],
  arrowdown: [0, -1],
  arrowright: [1, 0],
};
const KEY_ALIAS = { arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right' };
const MOVE_INTERVAL = 100; // 保持按住时约 10Hz 心跳，兼容「读输入状态」或「每帧读」的引擎
const JOY_DEADZONE = 0.16;

function defaultInteractLabel(type) {
  switch (type) {
    case 'enter': return '推門進入';
    case 'exit': return '離開';
    case 'upstairs': return '登樓';
    case 'downstairs': return '下樓';
    case 'open': return '開門';
    default: return '互動';
  }
}

/** 引擎 hint 可能形如「怡红院 · 按 E 查看」；提示条里已有 E 键徽标，避免重复。 */
function cleanInteractLabel(label, type) {
  let text = String(label || '').trim();
  text = text.replace(/\s*[·•\-—|]?\s*按\s*E\s*[^·•|]*$/i, '').trim();
  text = text.replace(/^按\s*E\s*[:：]?\s*/i, '').trim();
  return text || defaultInteractLabel(type);
}

function cleanHint(hint, nearName) {
  let text = String(hint || '').trim();
  if (!text) return '';
  text = text.replace(/\s*[·•\-—|]?\s*按\s*E\s*[^·•|]*$/i, '').trim();
  if (nearName) text = text.split(nearName).join('').trim();
  return text.replace(/^[·•\-—:：\s]+|[·•\-—:：\s]+$/g, '');
}

export function initWalk(ctx) {
  const state = {
    active: false,
    keys: new Set(),
    sprintKey: false,
    sprintTouch: false,
    joy: { x: 0, z: 0, pointerId: null },
    moving: false,
    moveSig: '',
    moveTimer: 0,
    lastPayload: null,
    nearId: '',
    interactTimer: 0,
    lookPointerId: null,
    lastTitle: null,
    lastSub: null,
  };

  function appCall(name, ...args) {
    const fn = ctx.app && ctx.app[name];
    if (typeof fn !== 'function') return undefined;
    try { return fn.apply(ctx.app, args); } catch { return undefined; }
  }

  // 真实引擎的 Walker 自带键盘与画布指针转身（window.GVG.walker 暴露）。
  // 此时 UI 只负责摇杆/按钮/模式切换，避免键盘或触摸转身被双重处理；
  // mock / 无内置输入实现的引擎则由 UI 负责转发。
  function engineHandlesNativeWalkInput() {
    const G = window.GVG;
    return Boolean(G && G.walker && typeof G.walker.addLook === 'function');
  }

  /* ── DOM ─────────────────────────────────────────────────── */
  const crosshair = h(
    'div',
    { class: 'walk-crosshair', attrs: { 'aria-hidden': 'true' } },
    h('i', { class: 'wx' }),
    h('i', { class: 'wy' }),
    h('i', { class: 'wd' }),
  );

  const statusTitle = h('span', { class: 'ws-title', text: '步行模式' });
  const statusSub = h('span', { class: 'ws-sub' });
  const infoBtn = h(
    'button',
    {
      class: 'walk-info-btn',
      attrs: { type: 'button', 'aria-label': '查看鄰近景點信息', hidden: true },
      on: { click: () => { if (state.nearId) ctx.openPoi(state.nearId); } },
    },
    icon('info'),
  );
  const status = h(
    'div',
    { class: 'walk-status', attrs: { role: 'status', 'aria-live': 'off' } },
    h('div', { class: 'ws-main' }, statusTitle, statusSub),
    infoBtn,
  );

  const pcHint = h(
    'p',
    { class: 'walk-pc-hint' },
    h('kbd', { text: 'WASD' }),
    h('span', { text: '移動' }),
    h('kbd', { text: 'Shift' }),
    h('span', { text: '疾跑' }),
    h('kbd', { text: 'Space' }),
    h('span', { text: '跳躍' }),
    h('kbd', { text: 'E' }),
    h('span', { text: '互動' }),
    h('kbd', { text: 'V' }),
    h('span', { text: '返回遊覽' }),
  );

  const interactLabel = h('span', { class: 'wi-label' });
  const interactBtn = h(
    'button',
    {
      class: 'interact-prompt',
      attrs: { type: 'button', 'aria-label': '互動', 'aria-hidden': 'true' },
      on: { click: () => triggerInteract() },
    },
    h('kbd', { class: 'wi-key', text: 'E' }),
    interactLabel,
    h('span', { class: 'wi-icon' }, icon('hand')),
  );

  const knob = h('div', { class: 'joystick-knob', attrs: { 'aria-hidden': 'true' } }, icon('walk'));
  const joystick = h(
    'div',
    { class: 'joystick', attrs: { role: 'group', 'aria-label': '移動搖桿：按住拖動控制行走方向' } },
    h('span', { class: 'joystick-ring', attrs: { 'aria-hidden': 'true' } }),
    knob,
    h('span', { class: 'joystick-label', text: '移動' }),
  );

  const sprintBtn = h(
    'button',
    {
      class: 'walk-action walk-sprint',
      attrs: { type: 'button', 'aria-label': '疾跑：開或關', 'aria-pressed': 'false' },
      on: { click: () => { state.sprintTouch = !state.sprintTouch; updateSprintUI(); sendMove(); } },
    },
    icon('sprint'),
    h('span', { class: 'wa-lbl', text: '疾跑' }),
  );
  const jumpBtn = h(
    'button',
    {
      class: 'walk-action walk-jump',
      attrs: { type: 'button', 'aria-label': '跳躍' },
      on: { click: () => jump() },
    },
    icon('jump'),
    h('span', { class: 'wa-lbl', text: '跳躍' }),
  );
  const exitBtn = h(
    'button',
    {
      class: 'walk-action walk-exit',
      attrs: { type: 'button', 'aria-label': '退出步行模式，返回遊覽' },
      on: { click: () => ctx.setWalkMode('orbit') },
    },
    icon('exitWalk'),
    h('span', { class: 'wa-lbl', text: '遊覽' }),
  );
  const actions = h('div', { class: 'walk-actions', attrs: { role: 'group', 'aria-label': '步行控制' } }, sprintBtn, jumpBtn, exitBtn);

  const hud = h(
    'div',
    { class: 'walk-hud', attrs: { 'aria-hidden': 'true' } },
    crosshair,
    status,
    pcHint,
    interactBtn,
    joystick,
    actions,
  );
  ctx.root.appendChild(hud);

  /* ── 状态可见性 ───────────────────────────────────────────── */
  function setMode(mode) {
    const active = mode === 'walk';
    if (active === state.active) return;
    state.active = active;
    hud.setAttribute('aria-hidden', active ? 'false' : 'true');
    if (!active) {
      resetInputs();
      hideInteract();
      state.lastPayload = null;
      state.nearId = '';
      updateStatus({});
    } else {
      state.sprintTouch = false;
      updateSprintUI();
      hideInteract();
      updateStatus(state.lastPayload || {});
    }
  }

  /* ── 状态条（10Hz walk 事件只更新变化的文字） ─────────────── */
  function updateStatus(payload) {
    const near = ctx.resolvePoiPayload(payload && payload.nearPoi);
    const rawHint = payload && payload.hint ? String(payload.hint) : '';
    const hint = cleanHint(rawHint, near ? near.name : '');
    const title = near ? near.name : hint || '自由步行';
    const sub = near ? hint : '';
    if (title !== state.lastTitle) {
      statusTitle.textContent = title;
      state.lastTitle = title;
    }
    if (sub !== state.lastSub) {
      statusSub.textContent = sub;
      state.lastSub = sub;
    }
    statusSub.hidden = !sub;
    const nearId = near ? near.id : '';
    if (nearId !== state.nearId) {
      state.nearId = nearId;
      infoBtn.hidden = !nearId;
      infoBtn.setAttribute('aria-label', nearId ? `查看${near.name}景點信息` : '查看鄰近景點信息');
    }
  }

  function setWalkState(payload) {
    state.lastPayload = payload || null;
    updateStatus(payload || {});
  }

  /* ── 交互提示 ─────────────────────────────────────────────── */
  function showInteract(payload) {
    if (!payload) {
      hideInteract();
      return;
    }
    if (!state.active) return;
    const key = payload.key || 'E';
    const label = cleanInteractLabel(payload.label, payload.type);
    interactLabel.textContent = label;
    const keyNode = interactBtn.querySelector('.wi-key');
    if (keyNode) keyNode.textContent = key;
    interactBtn.setAttribute('aria-label', `${label}（按 ${key} 或點擊）`);
    interactBtn.classList.add('show');
    interactBtn.setAttribute('aria-hidden', 'false');
    clearTimeout(state.interactTimer);
    // 真实引擎在离开范围时会发 interact:null；只在无该事件的降级场景用 8s 超时
    state.interactTimer = engineHandlesNativeWalkInput()
      ? 0
      : setTimeout(hideInteract, 8000);
  }

  function hideInteract() {
    clearTimeout(state.interactTimer);
    state.interactTimer = 0;
    interactBtn.classList.remove('show');
    interactBtn.setAttribute('aria-hidden', 'true');
  }

  function triggerInteract() {
    if (!state.active) return;
    appCall('walkInteract');
    hideInteract();
  }

  /* ── 移动输入 ─────────────────────────────────────────────── */
  function keyVec() {
    let x = 0;
    let z = 0;
    for (const key of state.keys) {
      const vec = KEY_VEC[key];
      if (!vec) continue;
      x += vec[0];
      z += vec[1];
    }
    return { x: clamp(x, -1, 1), z: clamp(z, -1, 1) };
  }

  function computeInput() {
    const keys = keyVec();
    let x = keys.x + state.joy.x;
    let z = keys.z + state.joy.z;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    return { x, z, sprint: Boolean(state.sprintKey || state.sprintTouch) };
  }

  function sendMove(force = false) {
    if (!state.active) return;
    const input = computeInput();
    const sig = `${input.x.toFixed(2)}|${input.z.toFixed(2)}|${input.sprint ? 1 : 0}`;
    if (!force && sig === state.moveSig) return;
    state.moveSig = sig;
    state.moving = Math.hypot(input.x, input.z) > 0.01;
    appCall('setWalkMove', input.x, input.z, input.sprint);
    if (state.moving || input.sprint) startMoveLoop();
    else stopMoveLoop();
  }

  function startMoveLoop() {
    if (state.moveTimer) return;
    state.moveTimer = setInterval(() => {
      if (!state.active) {
        stopMoveLoop();
        return;
      }
      const input = computeInput();
      if (!input.x && !input.z && !input.sprint) {
        stopMoveLoop();
        return;
      }
      appCall('setWalkMove', input.x, input.z, input.sprint);
    }, MOVE_INTERVAL);
  }

  function stopMoveLoop() {
    if (!state.moveTimer) return;
    clearInterval(state.moveTimer);
    state.moveTimer = 0;
  }

  function updateSprintUI() {
    const active = Boolean(state.sprintKey || state.sprintTouch);
    sprintBtn.classList.toggle('on', active);
    sprintBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  function jump() {
    if (!state.active) return;
    appCall('walkJump');
    jumpBtn.classList.remove('is-pressed');
    void jumpBtn.offsetWidth;
    jumpBtn.classList.add('is-pressed');
    setTimeout(() => jumpBtn.classList.remove('is-pressed'), 260);
  }

  function blurReset() {
    state.keys.clear();
    state.sprintKey = false;
    state.joy = { x: 0, z: 0, pointerId: null };
    joystick.classList.remove('is-active');
    knob.style.transform = '';
    updateSprintUI();
    sendMove();
  }

  function resetInputs() {
    state.keys.clear();
    state.sprintKey = false;
    state.sprintTouch = false;
    state.joy = { x: 0, z: 0, pointerId: null };
    joystick.classList.remove('is-active');
    knob.style.transform = '';
    updateSprintUI();
    state.moveSig = '';
    state.moving = false;
    stopMoveLoop();
    appCall('setWalkMove', 0, 0, false);
  }

  /* ── PC 键盘 ──────────────────────────────────────────────── */
  function blocked() {
    return !state.active || ctx.state.helpOpen || isTypingTarget(document.activeElement);
  }

  on(window, 'keydown', (event) => {
    if (blocked()) return;
    if (engineHandlesNativeWalkInput()) return; // 引擎 Walker 自行处理 WASD/Shift/Space/E
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (KEY_VEC[key]) {
      event.preventDefault();
      state.keys.add(KEY_ALIAS[key] || key);
      sendMove();
      return;
    }
    if (key === 'shift') {
      state.sprintKey = true;
      updateSprintUI();
      sendMove();
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      if (!event.repeat) jump();
      return;
    }
    if (key === 'e') {
      event.preventDefault();
      if (!event.repeat) triggerInteract();
    }
  });

  on(window, 'keyup', (event) => {
    if (!state.active) return;
    if (engineHandlesNativeWalkInput()) return;
    const key = event.key.toLowerCase();
    if (KEY_VEC[key]) {
      state.keys.delete(KEY_ALIAS[key] || key);
      sendMove();
      return;
    }
    if (key === 'shift') {
      state.sprintKey = false;
      updateSprintUI();
      sendMove();
    }
  });

  on(window, 'blur', () => {
    if (state.active) blurReset();
  });

  /* ── 虚拟摇杆（触摸） ─────────────────────────────────────── */
  function joyMetrics() {
    const rect = joystick.getBoundingClientRect();
    const knobSize = knob.offsetWidth || 52;
    return { rect, radius: Math.max(20, rect.width * 0.34), max: Math.max(8, (rect.width - knobSize) / 2) };
  }

  function updateJoystick(event) {
    const { rect, radius, max } = joyMetrics();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let x = (event.clientX - cx) / radius;
    let z = -(event.clientY - cy) / radius;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    if (Math.hypot(x, z) < JOY_DEADZONE) {
      x = 0;
      z = 0;
    }
    state.joy.x = x;
    state.joy.z = z;
    knob.style.transform = `translate(${(x * max).toFixed(1)}px, ${(-z * max).toFixed(1)}px)`;
    sendMove();
  }

  on(joystick, 'pointerdown', (event) => {
    if (!state.active) return;
    event.preventDefault();
    event.stopPropagation();
    state.joy.pointerId = event.pointerId;
    joystick.classList.add('is-active');
    try { joystick.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    updateJoystick(event);
  });

  on(joystick, 'pointermove', (event) => {
    if (!state.active || state.joy.pointerId !== event.pointerId) return;
    event.preventDefault();
    updateJoystick(event);
  });

  function endJoystick(event) {
    if (state.joy.pointerId === null || (event && state.joy.pointerId !== event.pointerId)) return;
    state.joy = { x: 0, z: 0, pointerId: null };
    joystick.classList.remove('is-active');
    knob.style.transform = '';
    try { joystick.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
    sendMove();
  }

  on(joystick, 'pointerup', endJoystick);
  on(joystick, 'pointercancel', endJoystick);

  /* ── 触摸拖拽转身（仅转发 touch/pen，鼠标由引擎处理） ─────── */
  const scene = document.getElementById('scene');
  let lookX = 0;
  let lookY = 0;
  let lookDx = 0;
  let lookDy = 0;
  let lookRaf = 0;

  function flushLook() {
    lookRaf = 0;
    if (!state.active) {
      lookDx = 0;
      lookDy = 0;
      return;
    }
    if (lookDx || lookDy) {
      appCall('setWalkLook', lookDx, lookDy);
      lookDx = 0;
      lookDy = 0;
    }
  }

  if (scene) {
    on(scene, 'pointerdown', (event) => {
      if (!state.active || engineHandlesNativeWalkInput()) return;
      if (event.pointerType === 'mouse') return;
      if (event.button !== undefined && event.button !== 0) return;
      state.lookPointerId = event.pointerId;
      lookX = event.clientX;
      lookY = event.clientY;
      event.preventDefault();
    });
    on(scene, 'pointermove', (event) => {
      if (!state.active || engineHandlesNativeWalkInput()) return;
      if (state.lookPointerId !== event.pointerId) return;
      lookDx += event.clientX - lookX;
      lookDy += event.clientY - lookY;
      lookX = event.clientX;
      lookY = event.clientY;
      if (!lookRaf) lookRaf = requestAnimationFrame(flushLook);
      event.preventDefault();
    });
    const endLook = (event) => {
      if (state.lookPointerId === null) return;
      if (event && event.pointerId !== state.lookPointerId) return;
      // 保留已累计的 lookDx/lookDy，交给下一次 rAF flush 发送
      state.lookPointerId = null;
    };
    on(scene, 'pointerup', endLook);
    on(scene, 'pointercancel', endLook);
    on(scene, 'pointerleave', (event) => {
      if (event.pointerType !== 'mouse') endLook(event);
    });
  }

  /* ── 对外接口 ─────────────────────────────────────────────── */
  return {
    el: hud,
    setMode,
    setWalkState,
    showInteract,
    hideInteract,
    triggerInteract,
    reset: resetInputs,
    isActive: () => state.active,
    getState: () => ({ active: state.active, nearId: state.nearId, sprint: state.sprintKey || state.sprintTouch }),
  };
}
