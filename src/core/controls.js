// 自研轨道控制器：PC 鼠标 + 移动端单指旋转 / 双指缩放平移，带阻尼与飞行动画。
import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class GardenControls {
  constructor(camera, dom, opts = {}) {
    this.camera = camera;
    this.dom = dom;
    this.target = new THREE.Vector3(0, 12, 0);
    this.theta = opts.theta ?? 0.32;
    this.phi = opts.phi ?? 1.05;
    this.radius = opts.radius ?? 300;
    this.minRadius = opts.minRadius ?? 12;
    this.maxRadius = opts.maxRadius ?? 460;
    this.minPhi = 0.12;
    this.maxPhi = 1.44;
    this.damping = 0.11;
    this._tTheta = this.theta;
    this._tPhi = this.phi;
    this._tRadius = this.radius;
    this._tTarget = this.target.clone();
    this.bounds = opts.bounds || { x: 178, z: 178, y: 70 };
    this.enabled = true;
    this._pointers = new Map();
    this._mode = null;
    this._last = { x: 0, y: 0 };
    this._pinch = 0;
    this._panCenter = { x: 0, y: 0 };
    this.fly = null;
    this.userInteracted = false;
    this._bind();
    this.update(0);
  }

  _bind() {
    const d = this.dom;
    this._onDown = (e) => {
      if (!this.enabled) return;
      this.userInteracted = true;
      this.fly = null;
      d.setPointerCapture?.(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size === 1) {
        if (e.pointerType === 'mouse' && (e.button === 2 || e.button === 1)) {
          this._mode = 'pan';
        } else {
          this._mode = 'rotate';
        }
        this._last = { x: e.clientX, y: e.clientY };
      } else if (this._pointers.size === 2) {
        const pts = [...this._pointers.values()];
        this._pinch = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        this._panCenter = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        this._mode = 'pinch';
      }
      e.preventDefault();
    };
    this._onMove = (e) => {
      if (!this.enabled || !this._pointers.has(e.pointerId)) return;
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._mode === 'rotate') {
        const dx = e.clientX - this._last.x;
        const dy = e.clientY - this._last.y;
        this._last = { x: e.clientX, y: e.clientY };
        const k = 0.0052;
        this._tTheta -= dx * k;
        this._tPhi = clamp(this._tPhi - dy * k, this.minPhi, this.maxPhi);
      } else if (this._mode === 'pan') {
        const dx = e.clientX - this._last.x;
        const dy = e.clientY - this._last.y;
        this._last = { x: e.clientX, y: e.clientY };
        this._pan(dx, dy, 1);
      } else if (this._mode === 'pinch' && this._pointers.size >= 2) {
        const pts = [...this._pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const cx = (pts[0].x + pts[1].x) / 2;
        const cy = (pts[0].y + pts[1].y) / 2;
        if (this._pinch > 0) {
          const ratio = this._pinch / Math.max(1, dist);
          this._tRadius = clamp(this._tRadius * ratio, this.minRadius, this.maxRadius);
          this._pan(cx - this._panCenter.x, cy - this._panCenter.y, 1.15);
        }
        this._pinch = dist;
        this._panCenter = { x: cx, y: cy };
      }
      e.preventDefault();
    };
    this._onUp = (e) => {
      this._pointers.delete(e.pointerId);
      if (this._pointers.size === 0) this._mode = null;
      else if (this._pointers.size === 1) {
        this._mode = 'rotate';
        const p = [...this._pointers.values()][0];
        this._last = { x: p.x, y: p.y };
      }
      e.preventDefault();
    };
    this._onWheel = (e) => {
      if (!this.enabled) return;
      this.userInteracted = true;
      this.fly = null;
      const k = Math.exp(clamp(e.deltaY, -120, 120) * 0.0012);
      this._tRadius = clamp(this._tRadius * k, this.minRadius, this.maxRadius);
      e.preventDefault();
    };
    this._onContext = (e) => e.preventDefault();
    d.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove, { passive: false });
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onUp);
    d.addEventListener('wheel', this._onWheel, { passive: false });
    d.addEventListener('contextmenu', this._onContext);
  }

  _pan(dx, dy, mul) {
    const scale = this._tRadius * 0.0016 * mul;
    const theta = this._tTheta;
    // 屏幕右方向（世界）
    const right = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta));
    // 屏幕上方向在地面的投影（远离相机方向）
    const fwd = new THREE.Vector3(-Math.sin(theta), 0, -Math.cos(theta));
    this._tTarget.addScaledVector(right, -dx * scale);
    this._tTarget.addScaledVector(fwd, dy * scale);
    this._tTarget.x = clamp(this._tTarget.x, -this.bounds.x, this.bounds.x);
    this._tTarget.z = clamp(this._tTarget.z, -this.bounds.z, this.bounds.z);
    this._tTarget.y = clamp(this._tTarget.y, 0, this.bounds.y);
  }

  setLimits(phi, radius) {
    if (phi) { this.minPhi = phi[0]; this.maxPhi = phi[1]; }
    if (radius) { this.minRadius = radius[0]; this.maxRadius = radius[1]; }
  }

  setView({ target, theta, phi, radius }, instant = true) {
    this.fly = null;
    if (target) this._tTarget.set(target[0], target[1], target[2]);
    if (theta !== undefined) this._tTheta = theta;
    if (phi !== undefined) this._tPhi = clamp(phi, this.minPhi, this.maxPhi);
    if (radius !== undefined) this._tRadius = clamp(radius, this.minRadius, this.maxRadius);
    if (instant) {
      this.target.copy(this._tTarget);
      this.theta = this._tTheta;
      this.phi = this._tPhi;
      this.radius = this._tRadius;
      this.update(0);
    }
  }

  flyTo({ target, theta, phi, radius }, duration = 1700) {
    const start = {
      target: this._tTarget.clone(),
      theta: this._tTheta,
      phi: this._tPhi,
      radius: this._tRadius,
    };
    // 选择最短角度路径
    let dTheta = theta - start.theta;
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;
    this.fly = {
      t: 0, duration,
      from: start,
      to: {
        target: new THREE.Vector3(target[0], target[1], target[2]),
        theta: start.theta + dTheta,
        phi: clamp(phi, this.minPhi, this.maxPhi),
        radius: clamp(radius, this.minRadius, this.maxRadius),
      },
    };
    this.userInteracted = false;
  }

  update(dt) {
    if (this.fly) {
      this.fly.t += dt;
      const k = Math.min(1, this.fly.t / this.fly.duration);
      const e = easeInOutCubic(k);
      this._tTarget.lerpVectors(this.fly.from.target, this.fly.to.target, e);
      this._tTheta = this.fly.from.theta + (this.fly.to.theta - this.fly.from.theta) * e;
      this._tPhi = this.fly.from.phi + (this.fly.to.phi - this.fly.from.phi) * e;
      this._tRadius = this.fly.from.radius + (this.fly.to.radius - this.fly.from.radius) * e;
      if (k >= 1) this.fly = null;
    }
    const damp = this.damping;
    this.theta += (this._tTheta - this.theta) * damp;
    this.phi += (this._tPhi - this.phi) * damp;
    this.radius += (this._tRadius - this.radius) * damp;
    this.target.lerp(this._tTarget, damp);
    const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sp * Math.sin(this.theta),
      this.target.y + this.radius * cp,
      this.target.z + this.radius * sp * Math.cos(this.theta),
    );
    if (this.camera.position.y < 2.2) this.camera.position.y = 2.2;
    this.camera.lookAt(this.target);
  }

  dispose() {
    const d = this.dom;
    d.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onUp);
    d.removeEventListener('wheel', this._onWheel);
    d.removeEventListener('contextmenu', this._onContext);
  }
}
