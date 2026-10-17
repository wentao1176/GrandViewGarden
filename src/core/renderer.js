// ─────────────────────────────────────────────────────────────────────────────
// 渲染层：天空、日月光、远山、云、体素网格、水面、落花、飞鸟、昼夜调色。
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { W, D, OX, OZ } from './world.js';

const rawColor = (hex) => { // 不做色彩空间转换，供自定义 shader 直接输出 sRGB
  return new THREE.Color(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
};
const linColor = (hex) => new THREE.Color(hex);
const lerp = (a, b, t) => a + (b - a) * t;

export const TOD = {
  dawn: {
    label: '晨', skyTop: 0x6f8bc0, skyMid: 0xd6b4b2, horizon: 0xf6dcc6, fog: 0xe8d6c9,
    sun: 0xffe6c0, sunDir: [-0.55, 0.16, 0.82], tint: 0xffd9c6, fogNear: 150, fogFar: 900,
    waterDeep: 0x3d6b78, waterShallow: 0x8fb0ac, waterSky: 0xe6c9b8, glow: 1.5,
    cloud: 0xf7d9c9, mountain: 0x9aa6b8, ambient: 0.94,
  },
  day: {
    label: '昼', skyTop: 0x3f7fc4, skyMid: 0x9cc4e6, horizon: 0xe0edf4, fog: 0xd4e4ec,
    sun: 0xfff7da, sunDir: [0.6, 0.72, 0.5], tint: 0xf7f3e9, fogNear: 150, fogFar: 880,
    waterDeep: 0x2f7083, waterShallow: 0x7aaeb8, waterSky: 0xd2e9ee, glow: 1.0,
    cloud: 0xffffff, mountain: 0x8fa3b5, ambient: 1.0,
  },
  dusk: {
    label: '暮', skyTop: 0x33406f, skyMid: 0xc3765a, horizon: 0xf4b271, fog: 0xdcae8e,
    sun: 0xffca8a, sunDir: [-0.66, 0.28, 0.34], tint: 0xffd6ae, fogNear: 130, fogFar: 820,
    waterDeep: 0x334a5e, waterShallow: 0x8a8a80, waterSky: 0xeab890, glow: 1.8,
    cloud: 0xf0b58f, mountain: 0x8d7f92, ambient: 0.85,
  },
  night: {
    label: '夜', skyTop: 0x0b1430, skyMid: 0x1b2a4e, horizon: 0x3a4f77, fog: 0x2c3c58,
    sun: 0xe8f0ff, sunDir: [-0.32, 0.55, -0.55], tint: 0x9fb2d8, fogNear: 150, fogFar: 900,
    waterDeep: 0x16334a, waterShallow: 0x3b5c74, waterSky: 0x4a688c, glow: 2.6,
    cloud: 0x4a5a78, mountain: 0x3f4e6a, ambient: 0.55,
  },
};

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uTop, uMid, uHorizon, uSunColor;
uniform vec3 uSunDir;
uniform float uNight;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.28, h));
  col = mix(col, uTop, smoothstep(0.18, 0.85, h));
  // 地平线暖光
  col += uSunColor * pow(max(0.0, 1.0 - abs(h) * 5.5), 3.0) * 0.10 * (1.0 - uNight * 0.6);
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * pow(sd, 900.0) * 3.2;      // 日/月轮
  col += uSunColor * pow(sd, 22.0) * 0.20;      // 光晕
  col += uSunColor * pow(sd, 5.0) * 0.05;
  gl_FragColor = vec4(col, 1.0);
}`;

const WATER_VERT = /* glsl */`
varying vec3 vWorld;
void main() {
  vWorld = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;const WATER_FRAG = /* glsl */`
uniform float uTime;
uniform vec3 uDeep, uShallow, uSky, uSun, uFogColor;
uniform vec3 uSunDir;
uniform float uFogNear, uFogFar;
varying vec3 vWorld;
void main() {
  vec2 p = vWorld.xz;
  float t = uTime;
  float w1 = sin(p.x * 0.42 + t * 0.85) * cos(p.y * 0.37 - t * 0.62);
  float w2 = sin((p.x * 0.9 + p.y * 0.7) - t * 1.35);
  float w3 = sin((p.x * 1.9 - p.y * 2.2) + t * 2.1);
  float ripple = w1 * 0.55 + w2 * 0.3 + w3 * 0.15;
  vec3 n = normalize(vec3(ripple * 0.22, 1.0, ripple * 0.16));
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
  vec3 col = mix(uDeep, uShallow, 0.32 + 0.22 * ripple);
  col = mix(col, uSky, 0.22 + 0.5 * fres);
  float spec = pow(max(dot(reflect(-normalize(uSunDir), n), viewDir), 0.0), 110.0);
  col += uSun * spec * 1.1;
  float glint = smoothstep(0.72, 1.0, sin(p.x * 2.6 + t * 1.9) * sin(p.y * 2.9 - t * 1.5));
  col += uSun * glint * 0.06;
  float dist = length(cameraPosition - vWorld);
  float fogF = smoothstep(uFogNear, uFogFar, dist);
  col = mix(col, uFogColor, fogF);
  float alpha = mix(0.74 + 0.22 * fres, 1.0, fogF * 0.75);
  gl_FragColor = vec4(col, alpha);
}`;

// ── 体素材质着色器：程序化瓦垄/粉墙/石纹/木纹/铺地/草地 + 每体素倒角 ────────────
const VOXEL_VERT = /* glsl */`
attribute vec3 color;
attribute float aMat;
attribute float aFace;
varying vec3 vColor;
varying float vMat;
varying float vFace;
varying vec3 vWorld;
varying float vFogDepth;
void main() {
  vColor = color;
  vMat = aMat;
  vFace = aFace;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const VOXEL_FRAG = /* glsl */`
precision highp float;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTime;
uniform float uDetail;
uniform float uGlow;
varying vec3 vColor;
varying float vMat;
varying float vFace;
varying vec3 vWorld;
varying float vFogDepth;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec3 faceNormal(float f) {
  if (f < 0.5) return vec3(1.0, 0.0, 0.0);
  if (f < 1.5) return vec3(-1.0, 0.0, 0.0);
  if (f < 2.5) return vec3(0.0, 1.0, 0.0);
  if (f < 3.5) return vec3(0.0, -1.0, 0.0);
  if (f < 4.5) return vec3(0.0, 0.0, 1.0);
  return vec3(0.0, 0.0, -1.0);
}
vec3 lin2srgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(1.055 * pow(c, vec3(0.41666)) - 0.055, c * 12.92, step(c, vec3(0.0031308)));
}
void main() {
  vec3 n = faceNormal(vFace);
  vec3 base = vColor;
  vec3 wp = vWorld;
  float det = uDetail;
  float distFade = clamp(1.0 - vFogDepth / 260.0, 0.0, 1.0);
  // 木纹
  if (vMat > 4.5 && vMat < 5.5) {
    float grain = noise2(vec2(wp.y * 6.0, (wp.x + wp.z) * 2.0));
    base *= 0.94 + 0.12 * grain;
    float streak = smoothstep(0.42, 0.5, abs(fract(wp.y * 0.9 + grain * 1.4) - 0.5));
    base *= 1.0 - 0.12 * streak * det * distFade;
  }
  // 瓦面：瓦垄 + 瓦排
  if (vMat > 3.5 && vMat < 4.5) {
    float along = abs(n.x) > 0.5 ? wp.z : wp.x;
    float tile = abs(fract(along / 0.34) - 0.5);
    base *= 1.0 - 0.16 * smoothstep(0.42, 0.5, tile) * det * distFade;
    float rowc = wp.y + along * 0.12;
    base *= 1.0 - 0.08 * smoothstep(0.43, 0.5, abs(fract(rowc / 0.42) - 0.5)) * det * distFade;
    base *= 0.95 + 0.1 * hash21(floor(vec2(along * 3.0, rowc * 3.0)));
  }
  // 粉墙
  if (vMat > 2.5 && vMat < 3.5) {
    float plaster = noise2(wp.xz * 2.4 + wp.y * 0.8);
    base *= 0.965 + 0.07 * plaster;
    base *= 1.0 + 0.02 * sin((wp.y + wp.x) * 9.0) * det * distFade;
  }
  // 石材
  if (vMat > 5.5 && vMat < 6.5) {
    float sp = hash21(floor(wp.xz * 9.0) + floor(wp.y * 7.0));
    base *= 0.94 + 0.12 * sp;
    float crack = smoothstep(0.03, 0.0, abs(noise2(wp.xz * 1.7 + 4.0) - 0.5));
    base *= 1.0 - 0.10 * crack * det * distFade;
  }
  // 铺地石缝
  if (vMat > 1.5 && vMat < 2.5) {
    float jx = abs(fract(wp.x / 0.72) - 0.5);
    float jz = abs(fract(wp.z / 0.72) - 0.5);
    float joint = smoothstep(0.44, 0.5, max(jx, jz));
    base *= 1.0 - 0.22 * joint * det * distFade;
    base *= 0.95 + 0.10 * hash21(floor(wp.xz * 2.0));
  }
  // 草地
  if (vMat > 0.5 && vMat < 1.5) {
    float macro = noise2(wp.xz * 0.085 + 3.0);
    base *= 0.84 + 0.26 * macro;
    base.g *= 1.035;
    base.r *= 0.95;
    float g1 = noise2(wp.xz * 3.2);
    float g2 = noise2(wp.xz * 12.0 + 7.0);
    base *= 0.9 + 0.18 * g1;
    base *= 0.96 + 0.08 * g2;
    base += 0.012 * smoothstep(0.75, 1.0, g2) * vec3(0.2, 0.38, 0.1);
  }
  if (vMat > 8.5 && vMat < 9.5) {
    base *= 0.92 + 0.16 * noise2(wp.xz * 5.0);
  }
  if (vMat > 7.5 && vMat < 8.5) {
    base *= 0.9 + 0.1 * noise2(wp.xz * 0.7);
  }
  // 每体素倒角：边缘压暗 + 极细高光（弱化大方块观感）
  vec3 f3 = fract(wp);
  float e1, e2;
  if (abs(n.y) > 0.5) { e1 = min(f3.x, 1.0 - f3.x); e2 = min(f3.z, 1.0 - f3.z); }
  else if (abs(n.x) > 0.5) { e1 = min(f3.y, 1.0 - f3.y); e2 = min(f3.z, 1.0 - f3.z); }
  else { e1 = min(f3.x, 1.0 - f3.x); e2 = min(f3.y, 1.0 - f3.y); }
  float edge = min(e1, e2);
  float inside = smoothstep(0.0, 0.10, edge);
  float organic = (vMat > 0.5 && vMat < 1.5) ? 0.30 : (vMat > 8.5 && vMat < 9.5 ? 0.55 : 1.0);
  base *= mix(1.0 - 0.20 * organic, 1.0, inside);
  base += (1.0 - inside) * vec3(0.010) * organic;
  // 细噪声
  base *= 0.985 + 0.03 * hash21(wp.xz * 37.0 + wp.y);
  // 雾
  float fog = smoothstep(uFogNear, uFogFar, vFogDepth);
  vec3 col = mix(base, uFogColor, fog);
  gl_FragColor = vec4(lin2srgb(col), 1.0);
}`;

const GLOW_FRAG = /* glsl */`
precision highp float;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTime;
uniform float uDetail;
uniform float uGlow;
varying vec3 vColor;
varying float vMat;
varying float vFace;
varying vec3 vWorld;
varying float vFogDepth;
vec3 lin2srgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(1.055 * pow(c, vec3(0.41666)) - 0.055, c * 12.92, step(c, vec3(0.0031308)));
}
void main() {
  float flicker = 0.94 + 0.06 * sin(uTime * 2.7 + vWorld.x * 0.9 + vWorld.y * 0.6);
  vec3 col = vColor * flicker * uGlow;
  float fog = smoothstep(uFogNear, uFogFar, vFogDepth);
  col = mix(col, uFogColor, fog * 0.6);
  gl_FragColor = vec4(lin2srgb(col), 1.0);
}`;

function radialTexture(inner, outer, size = 128) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.25, inner);
  g.addColorStop(0.55, outer);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class GardenView {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.quality = opts.quality || 'high';
    this.mobile = !!opts.mobile;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.quality !== 'low',
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.maxPixelRatio = this.quality === 'high' ? 2 : this.quality === 'mid' ? 1.6 : 1.25;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.4, 3000);
    this.scene.fog = new THREE.Fog(0xd8e7ee, 170, 980);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.tod = TOD.day;
    this.todName = 'day';
    this.clock = new THREE.Clock();
    this.time = 0;
    this.paused = false;
    this._callbacks = [];
    this._petals = null;
    this._birds = null;
    this._clouds = [];
    this._stars = null;
    this._waterUniforms = null;
    this._waterMesh = null;
    this._solidMat = null;
    this._glowMat = null;
    this.fps = 60;
    this._fpsAcc = 0;
    this._fpsN = 0;
    this._buildSky();
    this._buildBackdrop();
    this._buildSun();
    this._buildPetals();
    this._buildBirds();
    this._buildClouds();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(1400, 40, 24);
    this._skyUniforms = {
      uTop: { value: rawColor(TOD.day.skyTop) },
      uMid: { value: rawColor(TOD.day.skyMid) },
      uHorizon: { value: rawColor(TOD.day.horizon) },
      uSunColor: { value: rawColor(TOD.day.sun) },
      uSunDir: { value: new THREE.Vector3(0.6, 0.72, 0.5) },
      uNight: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this._skyUniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // 星空
    const n = this.quality === 'low' ? 260 : 700;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.random() * 0.85 + 0.08;
      const r = 1200;
      const x = Math.cos(u) * Math.cos(v) * r;
      const y = Math.sin(v) * r;
      const z = Math.sin(u) * Math.cos(v) * r;
      pos.set([x, y, z], i * 3);
      const b = 0.5 + Math.random() * 0.5;
      col.set([b, b, Math.min(1, b * 1.05)], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const sm = new THREE.PointsMaterial({ size: 2.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this._stars = new THREE.Points(sg, sm);
    this._stars.frustumCulled = false;
    this._stars.renderOrder = -9;
    this.scene.add(this._stars);
  }

  _buildSun() {
    const tex = radialTexture('rgba(255,250,235,1)', 'rgba(255,236,190,0.55)');
    this._sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, fog: false, toneMapped: false,
    }));
    this._sunSprite.scale.set(150, 150, 1);
    this._sunSprite.renderOrder = -8;
    this.scene.add(this._sunSprite);
  }

  _buildBackdrop() {
    // 远山：两圈低多边形山脊，营造景深
    const rings = [
      { r: 640, h: 34, color: 0x8fa3b5, seed: 3.1, alpha: 1 },
      { r: 900, h: 52, color: 0xa9bccb, seed: 7.7, alpha: 1 },
    ];
    this._mountains = [];
    for (const ring of rings) {
      const N = 140;
      const pos = [], col = [], idx = [];
      const c = rawColor(ring.color);
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const rr = ring.r * (0.94 + 0.1 * Math.sin(a * 3 + ring.seed));
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        const h = ring.h * (0.45 + 0.3 * Math.sin(a * 5 + ring.seed) + 0.25 * Math.sin(a * 11 + ring.seed * 2));
        pos.push(x, 0, z, x, Math.max(4, h), z);
        const t = 0.82 + 0.18 * Math.sin(a * 7 + ring.seed);
        col.push(c.r * 0.75, c.g * 0.8, c.b * 0.85, c.r * t, c.g * t, c.b * t);
        if (i < N) {
          const b = i * 2;
          idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true, toneMapped: false });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.y = 2;
      mesh.renderOrder = -7;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this._mountains.push(mesh);
    }
    // 园外大地：带微弱色斑的草地，避免大片纯色
    const gg = new THREE.PlaneGeometry(3600, 3600, 90, 90);
    const ggPos = gg.attributes.position;
    const ggCol = new Float32Array(ggPos.count * 3);
    const base = rawColor(0x6f8f57);
    for (let i = 0; i < ggPos.count; i++) {
      const x = ggPos.getX(i), y = ggPos.getY(i);
      const n = 0.5 + 0.5 * Math.sin(x * 0.017 + Math.sin(y * 0.011) * 2.0) * Math.cos(y * 0.013 + x * 0.005);
      const v = 0.78 + n * 0.34;
      ggCol[i * 3] = base.r * v;
      ggCol[i * 3 + 1] = base.g * v;
      ggCol[i * 3 + 2] = base.b * v * 0.96;
    }
    gg.setAttribute('color', new THREE.BufferAttribute(ggCol, 3));
    const gm = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, toneMapped: false });
    this._outerGround = new THREE.Mesh(gg, gm);
    this._outerGround.rotation.x = -Math.PI / 2;
    this._outerGround.position.y = 2.9; // 低于水面与园内地表，避免遮挡水系
    this._outerGround.renderOrder = -6;
    this._outerGround.frustumCulled = false;
    this.scene.add(this._outerGround);
  }

  _buildClouds() {
    const nClusters = this.quality === 'low' ? 4 : 7;
    if (nClusters <= 0) return;
    const puffsPer = 6;
    const total = nClusters * puffsPer;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: linColor(0xffffff), transparent: true, opacity: 0.32, fog: false, depthWrite: false });
    this._cloudMat = mat;
    const inst = new THREE.InstancedMesh(geo, mat, total);
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.frustumCulled = false;
    this._cloudData = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const clouds = [];
    for (let i = 0; i < nClusters; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 260 + Math.random() * 460;
      const cloud = {
        x: Math.cos(a) * r, y: 210 + Math.random() * 120, z: Math.sin(a) * r,
        speed: 0.5 + Math.random() * 0.8,
        puffs: [],
      };
      for (let k = 0; k < puffsPer; k++) {
        cloud.puffs.push({
          dx: (Math.random() - 0.5) * 70, dy: (Math.random() - 0.5) * 8, dz: (Math.random() - 0.5) * 34,
          sx: 4 + Math.random() * 9, sy: 2 + Math.random() * 3, sz: 4 + Math.random() * 7,
        });
      }
      clouds.push(cloud);
    }
    this._clouds = clouds;
    this._cloudInst = inst;
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      for (let k = 0; k < puffsPer; k++) {
        const pf = c.puffs[k];
        p.set(c.x + pf.dx, c.y + pf.dy, c.z + pf.dz);
        s.set(pf.sx, pf.sy, pf.sz);
        m.compose(p, q, s);
        inst.setMatrixAt(i * puffsPer + k, m);
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    this.scene.add(inst);
  }

  _buildPetals() {
    const n = this.quality === 'high' ? 260 : this.quality === 'mid' ? 170 : 90;
    this._petalCount = n;
    const geo = new THREE.BoxGeometry(0.42, 0.1, 0.3);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const inst = new THREE.InstancedMesh(geo, mat, n);
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const palette = [0xf6d3dc, 0xf3bccb, 0xefd0d6, 0xfbe6ea, 0xe9a8ba];
    const c = new THREE.Color();
    this._petalData = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 190;
      const d = {
        x: Math.cos(a) * r, y: 8 + Math.random() * 55, z: Math.sin(a) * r,
        vx: 0.5 + Math.random() * 0.8, vy: -0.55 - Math.random() * 0.7, vz: 0.15 + Math.random() * 0.3,
        phase: Math.random() * 10, spin: Math.random() * 3,
      };
      this._petalData.push(d);
      c.setHex(palette[i % palette.length]);
      inst.setColorAt(i, c);
    }
    inst.instanceColor.needsUpdate = true;
    inst.frustumCulled = false;
    this._petals = inst;
    this.scene.add(inst);
    this._petalM = new THREE.Matrix4();
    this._petalQ = new THREE.Quaternion();
    this._petalE = new THREE.Euler();
    this._petalS = new THREE.Vector3(1, 1, 1);
    this._petalP = new THREE.Vector3();
  }

  _buildBirds() {
    this._birds = [];
    const mat = new THREE.MeshBasicMaterial({ color: linColor(0x2c2f33), toneMapped: false });
    const wingGeo = new THREE.BoxGeometry(2.6, 0.18, 0.55);
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const l = new THREE.Mesh(wingGeo, mat); l.position.x = -1.2;
      const r = new THREE.Mesh(wingGeo, mat); r.position.x = 1.2;
      g.add(l, r);
      g.userData = {
        a: Math.random() * Math.PI * 2,
        r: 80 + Math.random() * 130,
        y: 55 + Math.random() * 30,
        speed: 0.06 + Math.random() * 0.06,
        wing: Math.random() * 6,
      };
      this._birds.push(g);
      this.scene.add(g);
    }
  }

  setVoxels(result) {
    if (this._solidMesh) {
      this.group.remove(this._solidMesh);
      this._solidMesh.geometry.dispose();
      this._solidMesh = null;
    }
    if (this._glowMesh) {
      this.group.remove(this._glowMesh);
      this._glowMesh.geometry.dispose();
      this._glowMesh = null;
    }
    if (!this._voxelUniforms) {
      this._voxelUniforms = {
        uFogColor: { value: linColor(TOD.day.fog) },
        uFogNear: { value: TOD.day.fogNear },
        uFogFar: { value: TOD.day.fogFar },
        uTime: { value: 0 },
        uDetail: { value: this.quality === 'high' ? 1 : this.quality === 'mid' ? 0.55 : 0 },
        uTint: { value: linColor(TOD.day.tint) },
        uGlow: { value: TOD.day.glow },
      };
    }
    const U = this._voxelUniforms;
    U.uDetail.value = this.quality === 'high' ? 1 : this.quality === 'mid' ? 0.55 : 0;
    const makeGeo = (g) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(g.color, 3));
      geo.setAttribute('aMat', new THREE.BufferAttribute(g.mat, 1));
      geo.setAttribute('aFace', new THREE.BufferAttribute(g.face, 1));
      geo.setIndex(new THREE.BufferAttribute(g.index, 1));
      geo.computeBoundingSphere();
      return geo;
    };
    this._solidMat = new THREE.ShaderMaterial({
      uniforms: U,
      vertexShader: VOXEL_VERT,
      fragmentShader: VOXEL_FRAG,
      side: THREE.DoubleSide,
    });
    this._solidMesh = new THREE.Mesh(makeGeo(result.solid), this._solidMat);
    this._solidMesh.frustumCulled = true;
    this._solidMesh.renderOrder = 0;
    this.group.add(this._solidMesh);
    if (result.glow) {
      this._glowMat = new THREE.ShaderMaterial({
        uniforms: U,
        vertexShader: VOXEL_VERT,
        fragmentShader: GLOW_FRAG,
        side: THREE.DoubleSide,
      });
      this._glowMesh = new THREE.Mesh(makeGeo(result.glow), this._glowMat);
      this._glowMesh.renderOrder = 1;
      this.group.add(this._glowMesh);
    }
    this._voxelStats = result.stats;
  }

  /** mask: Uint8Array(W*D), 1 = 水面 */
  setWater(mask, level) {
    const pos = [], idx = [];
    const at = (x, z) => (x < -OX || x >= OX || z < -OZ || z >= OZ) ? 0 : mask[(x + OX) + (z + OZ) * W];
    const used = new Uint8Array(W * D);
    for (let z = -OZ; z < OZ; z++) {
      for (let x = -OX; x < OX; x++) {
        const mi = (x + OX) + (z + OZ) * W;
        if (!mask[mi] || used[mi]) continue;
        let ww = 1;
        while (at(x + ww, z) && !used[mi + ww]) ww++;
        let hh = 1;
        outer: while (z + hh < OZ) {
          for (let t = 0; t < ww; t++) {
            const q = (x + t + OX) + (z + hh + OZ) * W;
            if (!mask[q] || used[q]) break outer;
          }
          hh++;
        }
        for (let j = 0; j < hh; j++) for (let i = 0; i < ww; i++) used[(x + i + OX) + (z + j + OZ) * W] = 1;
        const base = pos.length / 3;
        const x0 = x, x1 = x + ww, z0 = z, z1 = z + hh;
        pos.push(x0, level, z0, x1, level, z0, x1, level, z1, x0, level, z1);
        idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    this._waterUniforms = {
      uTime: { value: 0 },
      uDeep: { value: rawColor(TOD.day.waterDeep) },
      uShallow: { value: rawColor(TOD.day.waterShallow) },
      uSky: { value: rawColor(TOD.day.waterSky) },
      uSun: { value: rawColor(TOD.day.sun) },
      uSunDir: { value: new THREE.Vector3(0.6, 0.72, 0.5) },
      uFogColor: { value: rawColor(TOD.day.fog) },
      uFogNear: { value: TOD.day.fogNear },
      uFogFar: { value: TOD.day.fogFar },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this._waterUniforms,
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    if (this._waterMesh) { this.group.remove(this._waterMesh); this._waterMesh.geometry.dispose(); }
    this._waterMesh = new THREE.Mesh(geo, mat);
    this._waterMesh.renderOrder = 2;
    this._waterMesh.frustumCulled = false;
    this.group.add(this._waterMesh);
  }

  setDecalGroup(group) {
    this._decalGroup = group;
    if (!group) return;
    const tint = linColor(this.tod.tint);
    group.traverse((o) => { if (o.isMesh && o.material) o.material.color.copy(tint); });
  }

  setTimeOfDay(name, instant = false) {
    const t = TOD[name] || TOD.day;
    this.todName = name;
    this._todTarget = t;
    if (instant) {
      this._applyTod(t);
    }
  }

  _applyTod(t) {
    this.tod = t;
    this.scene.fog.color.copy(linColor(t.fog));
    this.scene.fog.near = t.fogNear;
    this.scene.fog.far = t.fogFar;
    this._skyUniforms.uTop.value.copy(rawColor(t.skyTop));
    this._skyUniforms.uMid.value.copy(rawColor(t.skyMid));
    this._skyUniforms.uHorizon.value.copy(rawColor(t.horizon));
    this._skyUniforms.uSunColor.value.copy(rawColor(t.sun));
    this._sunSprite.material.color.copy(linColor(t.sun));
    this._outerGround.material.color.copy(linColor(t.tint === 0xffffff ? 0x5d7c4c : 0x4b6340));
    this._cloudMat.color.copy(linColor(t.cloud));
    if (this._voxelUniforms) {
      const U = this._voxelUniforms;
      U.uFogColor.value.copy(linColor(t.fog));
      U.uFogNear.value = t.fogNear;
      U.uFogFar.value = t.fogFar;
      U.uTint.value.copy(linColor(t.tint));
      U.uGlow.value = t.glow;
      U.uDetail.value = this.quality === 'high' ? 1 : this.quality === 'mid' ? 0.55 : 0;
    }
    if (this._waterUniforms) {
      this._waterUniforms.uDeep.value.copy(rawColor(t.waterDeep));
      this._waterUniforms.uShallow.value.copy(rawColor(t.waterShallow));
      this._waterUniforms.uSky.value.copy(rawColor(t.waterSky));
      this._waterUniforms.uSun.value.copy(rawColor(t.sun));
      this._waterUniforms.uFogColor.value.copy(rawColor(t.fog));
      this._waterUniforms.uFogNear.value = t.fogNear;
      this._waterUniforms.uFogFar.value = t.fogFar;
    }
    for (const m of this._mountains || []) m.material.color.copy(linColor(t.mountain));
    if (this._decalGroup) this._decalGroup.traverse((o) => { if (o.isMesh && o.material) o.material.color.copy(linColor(t.tint)); });
    if (this._petals) this._petals.material.color.copy(linColor(t.tint));
    const sunDir = new THREE.Vector3(...t.sunDir).normalize();
    this._skyUniforms.uSunDir.value.copy(sunDir);
    if (this._waterUniforms) this._waterUniforms.uSunDir.value.copy(sunDir);
    this._sunSprite.position.copy(sunDir).multiplyScalar(1150);
    this._stars.material.opacity = name2night(this.todName);
    this._skyUniforms.uNight.value = name2night(this.todName);
  }

  _tweenTod(dt) {
    if (!this._todTarget || this._todTarget === this.tod) return;
    // 颜色缓慢过渡
    const k = Math.min(1, dt * 3.2);
    const t = this._todTarget;
    const mixC = (cur, hex) => { const target = linColor(hex); cur.lerp(target, k); };
    mixC(this.scene.fog.color, t.fog);
    this.scene.fog.near = lerp(this.scene.fog.near, t.fogNear, k);
    this.scene.fog.far = lerp(this.scene.fog.far, t.fogFar, k);
    const mixRaw = (cur, hex) => { cur.lerp(rawColor(hex), k); };
    mixRaw(this._skyUniforms.uTop.value, t.skyTop);
    mixRaw(this._skyUniforms.uMid.value, t.skyMid);
    mixRaw(this._skyUniforms.uHorizon.value, t.horizon);
    mixRaw(this._skyUniforms.uSunColor.value, t.sun);
    this._sunSprite.material.color.lerp(linColor(t.sun), k);
    this._cloudMat.color.lerp(linColor(t.cloud), k);
    if (this._voxelUniforms) {
      const U = this._voxelUniforms;
      U.uFogColor.value.lerp(linColor(t.fog), k);
      U.uFogNear.value = lerp(U.uFogNear.value, t.fogNear, k);
      U.uFogFar.value = lerp(U.uFogFar.value, t.fogFar, k);
      U.uTint.value.lerp(linColor(t.tint), k);
      U.uGlow.value = lerp(U.uGlow.value, t.glow, k);
    }
    if (this._waterUniforms) {
      mixRaw(this._waterUniforms.uDeep.value, t.waterDeep);
      mixRaw(this._waterUniforms.uShallow.value, t.waterShallow);
      mixRaw(this._waterUniforms.uSky.value, t.waterSky);
      mixRaw(this._waterUniforms.uSun.value, t.sun);
      mixRaw(this._waterUniforms.uFogColor.value, t.fog);
      this._waterUniforms.uFogNear.value = lerp(this._waterUniforms.uFogNear.value, t.fogNear, k);
      this._waterUniforms.uFogFar.value = lerp(this._waterUniforms.uFogFar.value, t.fogFar, k);
    }
    for (const m of this._mountains || []) m.material.color.lerp(linColor(t.mountain), k);
    if (this._decalGroup) this._decalGroup.traverse((o) => { if (o.isMesh && o.material) o.material.color.lerp(linColor(t.tint), k); });
    if (this._petals) this._petals.material.color.lerp(linColor(t.tint), k);
    // 太阳方向
    const targetDir = new THREE.Vector3(...t.sunDir).normalize();
    this._skyUniforms.uSunDir.value.lerp(targetDir, k).normalize();
    if (this._waterUniforms) this._waterUniforms.uSunDir.value.lerp(targetDir, k).normalize();
    this._sunSprite.position.copy(this._skyUniforms.uSunDir.value).multiplyScalar(1150);
    const night = name2night(this.todName);
    this._stars.material.opacity = lerp(this._stars.material.opacity, night, k);
    this._skyUniforms.uNight.value = lerp(this._skyUniforms.uNight.value, night, k);
    if (k > 0.97) this._applyTod(t);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPixelRatio));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setQuality(q) {
    this.quality = q;
    this.maxPixelRatio = q === 'high' ? 2 : q === 'mid' ? 1.5 : 1.2;
    if (this._voxelUniforms) this._voxelUniforms.uDetail.value = q === 'high' ? 1 : q === 'mid' ? 0.55 : 0;
    this.resize();
  }

  onFrame(cb) { this._callbacks.push(cb); }

  start(controls) {
    this.controls = controls;
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, this.clock.getDelta());
      this.time += dt;
      this._fpsAcc += dt; this._fpsN++;
      if (this._fpsAcc > 0.5) { this.fps = this._fpsN / this._fpsAcc; this._fpsAcc = 0; this._fpsN = 0; }
      // 动态分辨率：移动端/低端机自动降像素比，保持流畅
      this._adaptAcc = (this._adaptAcc || 0) + dt;
      if (this._adaptAcc > 1.6) {
        this._adaptAcc = 0;
        const pr = this.renderer.getPixelRatio();
        const maxPR = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
        if (this.fps < 38 && pr > 1.0) this.renderer.setPixelRatio(Math.max(1.0, pr - 0.15));
        else if (this.fps > 56 && pr < maxPR - 0.01) this.renderer.setPixelRatio(Math.min(maxPR, pr + 0.1));
        else this.renderer.setPixelRatio(pr);
      }
      if (!this.paused) this._update(dt);
      this.renderer.render(this.scene, this.camera);
      for (const cb of this._callbacks) cb(dt);
    };
    this.clock.start();
    loop();
  }

  _update(dt) {
    this._tweenTod(dt);
    if (this.preUpdate) this.preUpdate(dt);
    this.controls?.update(dt);
    if (this._voxelUniforms) this._voxelUniforms.uTime.value = this.time;
    this.sky.position.copy(this.camera.position);
    this.sky.position.y = 0;
    this._stars.position.copy(this.camera.position).setY(0);
    if (this._waterUniforms) this._waterUniforms.uTime.value = this.time;
    // 落花
    if (this._petals) {
      const m = this._petalM, q = this._petalQ, e = this._petalE, s = this._petalS, p = this._petalP;
      for (let i = 0; i < this._petalCount; i++) {
        const d = this._petalData[i];
        d.x += d.vx * dt * 1.6;
        d.z += d.vz * dt * 1.6 + Math.sin(this.time * 1.3 + d.phase) * dt * 0.7;
        d.y += d.vy * dt * 1.4;
        if (d.y < 4.2) { d.y = 55 + Math.random() * 30; const a = Math.random() * Math.PI * 2, r = Math.random() * 190; d.x = Math.cos(a) * r; d.z = Math.sin(a) * r; }
        if (d.x > 190) d.x = -190; if (d.x < -190) d.x = 190;
        if (d.z > 190) d.z = -190; if (d.z < -190) d.z = 190;
        e.set(this.time * 1.7 + d.phase, this.time * 0.9 + d.phase, Math.sin(this.time + d.phase) * 0.5);
        q.setFromEuler(e);
        p.set(d.x, d.y, d.z);
        m.compose(p, q, s);
        this._petals.setMatrixAt(i, m);
      }
      this._petals.instanceMatrix.needsUpdate = true;
    }
    // 飞鸟
    for (const b of this._birds) {
      const u = b.userData;
      u.a += u.speed * dt;
      b.position.set(Math.cos(u.a) * u.r, u.y + Math.sin(u.a * 2.2) * 4, Math.sin(u.a) * u.r);
      b.rotation.y = -u.a + Math.PI / 2;
      const flap = Math.sin(this.time * 4 + u.wing) * 0.55;
      b.children[0].rotation.z = flap;
      b.children[1].rotation.z = -flap;
    }
    // 云（单次实例化绘制）
    if (this._cloudInst && this._clouds.length) {
      const m = this._cloudM || (this._cloudM = new THREE.Matrix4());
      const q = this._cloudQ || (this._cloudQ = new THREE.Quaternion());
      const s = this._cloudS || (this._cloudS = new THREE.Vector3());
      const p = this._cloudP || (this._cloudP = new THREE.Vector3());
      const puffsPer = 6;
      for (let i = 0; i < this._clouds.length; i++) {
        const c = this._clouds[i];
        c.x += c.speed * dt * 1.6;
        if (c.x > 820) c.x = -820;
        for (let k = 0; k < puffsPer; k++) {
          const pf = c.puffs[k];
          p.set(c.x + pf.dx, c.y + pf.dy, c.z + pf.dz);
          s.set(pf.sx, pf.sy, pf.sz);
          m.compose(p, q, s);
          this._cloudInst.setMatrixAt(i * puffsPer + k, m);
        }
      }
      this._cloudInst.instanceMatrix.needsUpdate = true;
    }
  }

  stats() {
    const r = this.renderer.info;
    const v = this._voxelStats || {};
    return {
      fps: Math.round(this.fps),
      calls: r.render.calls,
      tris: r.render.triangles,
      voxels: v.solidQuads || 0,
      mesh: v,
      quality: this.quality,
      tod: this.todName,
    };
  }
}

function name2night(name) { return name === 'night' ? 1 : name === 'dusk' ? 0.35 : name === 'dawn' ? 0.12 : 0; }
