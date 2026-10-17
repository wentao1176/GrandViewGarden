// ─────────────────────────────────────────────────────────────────────────────
// 精细动态水面 · 着色器与调色板（water 成员维护）
//
// 本文件只放 GLSL 与昼夜水色表，不含场景逻辑；WaterSystem 在 water.js 中消费。
// 约定（与 docs/phase2-api.md 一致）：
//   · 世界坐标 x 东 / z 南 / y 上，水面水平面 y = layout.WATER_LEVEL；
//   · 自定义 ShaderMaterial 输出 sRGB，不做 tone mapping；雾由 shader 自行计算；
//   · 顶点属性：aFlow(vec2)=流向，aMeta(vec4)=速度/水深/离岸距离/类型(0=水面,1=白浪贴片,2=水帘)；
//   · 所有颜色均为 sRGB 空间 0..1，与 renderer.js 的 TOD 水色同源。
// ─────────────────────────────────────────────────────────────────────────────

/** #rrggbb → [r,g,b]（0..1，sRGB，不做线性化，与旧 WATER_FRAG 的 rawColor 一致） */
export function hexToVec3(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

// 与 src/core/renderer.js 的 TOD（water*/sun/fog）对齐，另加 foam/petal/sunI/水帘参数。
export const WATER_TOD = {
  dawn: {
    deep: 0x3d6b78, shallow: 0x8fb0ac, sky: 0xe6c9b8, sun: 0xffe6c0, foam: 0xf3efe6, petal: 0xf2d3c6,
    fog: 0xe8d6c9, fogNear: 150, fogFar: 900, sunI: 0.85, night: 0.12, sunDir: [-0.55, 0.16, 0.82],
  },
  day: {
    deep: 0x2f7083, shallow: 0x7aaeb8, sky: 0xd2e9ee, sun: 0xfff7da, foam: 0xf6f8f4, petal: 0xf6d3dc,
    fog: 0xd4e4ec, fogNear: 170, fogFar: 980, sunI: 1.5, night: 0.0, sunDir: [0.6, 0.72, 0.5],
  },
  dusk: {
    deep: 0x334a5e, shallow: 0x8a8a80, sky: 0xeab890, sun: 0xffca8a, foam: 0xf0e2d0, petal: 0xe9b4a8,
    fog: 0xdcae8e, fogNear: 130, fogFar: 820, sunI: 1.25, night: 0.22, sunDir: [-0.66, 0.28, 0.34],
  },
  night: {
    deep: 0x122a3a, shallow: 0x2f4a5c, sky: 0x3a5578, sun: 0xe8f0ff, foam: 0x9fb7c9, petal: 0x8f9fb8,
    fog: 0x233149, fogNear: 140, fogFar: 860, sunI: 0.45, night: 1.0, sunDir: [-0.32, 0.55, -0.55],
  },
};

/** 生成一套独立的 uniform（每个 WaterSystem 一份，逐帧只改 value，不重建） */
export function createWaterUniforms() {
  const day = WATER_TOD.day;
  const v3 = (hex) => ({ value: { x: hexToVec3(hex)[0], y: hexToVec3(hex)[1], z: hexToVec3(hex)[2] } });
  // 用普通数组而非 THREE.Color，避免本文件依赖 three；water.js 会将其写入 THREE.Vector3/Color 兼容对象
  return {
    uTime: { value: 0 },
    uDeep: { value: hexToVec3(day.deep) },
    uShallow: { value: hexToVec3(day.shallow) },
    uSky: { value: hexToVec3(day.sky) },
    uSun: { value: hexToVec3(day.sun) },
    uFoam: { value: hexToVec3(day.foam) },
    uPetal: { value: hexToVec3(day.petal) },
    uFogColor: { value: hexToVec3(day.fog) },
    uFogNear: { value: day.fogNear },
    uFogFar: { value: day.fogFar },
    uSunI: { value: day.sunI },
    uNight: { value: day.night },
    uSunDir: { value: [0.6, 0.72, 0.5] },
    uLevel: { value: 3.35 },
    uFall0: { value: [128, -132] },   // 沁芳闸跌水
    uFall1: { value: [16, -98] },     // 花溆石洞
    uPiers: { value: new Array(24).fill(0).map(() => [0, 0]) },
    uPierCount: { value: 0 },
    uDetail: { value: 1.0 },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 水面：顶点着色器（属性直传；水位起伏在片元里做，几何为 1 格一格的水平面）
// ─────────────────────────────────────────────────────────────────────────────
export const WATER_VERT = /* glsl */`
attribute vec2 aFlow;
attribute vec4 aMeta;
varying vec3 vWorld;
varying vec2 vFlow;
varying vec4 vMeta;
void main() {
  vWorld = position;
  vFlow = aFlow;
  vMeta = aMeta;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// ─────────────────────────────────────────────────────────────────────────────
// 水面：片元着色器
//   · 沿流向的多层行进波 + 交叉撕裂波（汇流处）；
//   · 岸边/桥墩/跌水泡沫（shore、uPiers、uFall*）；
//   · 菲涅耳天光反射 + 太阳高光 + 星点闪烁 + 远处雾色渐变；
//   · 浅水偏青半透、深水偏靛更实；水帘（aMeta.w≈2）走竖直流线分支。
// ─────────────────────────────────────────────────────────────────────────────
export const WATER_FRAG = /* glsl */`
uniform float uTime;
uniform vec3 uDeep, uShallow, uSky, uSun, uFoam, uPetal, uFogColor;
uniform vec3 uSunDir;
uniform float uFogNear, uFogFar, uSunI, uNight, uLevel, uDetail;
uniform vec2 uFall0, uFall1;
uniform vec2 uPiers[24];
uniform float uPierCount;
varying vec3 vWorld;
varying vec2 vFlow;
varying vec4 vMeta;

// 沿流向 1 层 + 交叉层 1 层 + 长波 1 层 + 汇流撕裂 1 层，直接累加「坡度」得到法线
// （坡度总量控制在 ~0.35 以内，避免法线过度倾斜导致整片水面反射发白）
vec3 waveNormal(vec2 p, vec2 flow, float speed, float deep, out float height) {
  vec2 d = flow;
  float dl = length(d);
  d = dl > 0.0001 ? d / dl : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  float t = uTime;
  float sp = speed;
  float detail = uDetail;
  vec2 slope = vec2(0.0);
  float h = 0.0;

  float ph1 = dot(p, d) * 2.1 - t * (1.05 + sp * 1.25);
  float s1 = 0.115 * mix(0.85, 1.15, deep) * detail;
  h += s1 / 2.1 * sin(ph1);
  slope += s1 * cos(ph1) * d;

  float ph2 = dot(p, d * 4.6 + n * 1.9) - t * (2.3 + sp * 1.9);
  float s2 = 0.065 * detail;
  h += s2 / 5.0 * sin(ph2);
  slope += s2 * cos(ph2) * normalize(d * 4.6 + n * 1.9);

  float wob = sin(dot(p, d) * 0.63 - t * 0.55);
  float ph3 = dot(p, n) * 3.2 + wob * 1.1 - t * 0.85;
  float s3 = 0.05 * detail;
  h += s3 / 3.2 * sin(ph3);
  slope += s3 * cos(ph3) * normalize(n * 3.2 + d * 0.63 * 1.1 * cos(dot(p, d) * 0.63 - t * 0.55) + vec2(0.0001));

  // 汇流/急流撕裂纹理：只在 speed 较大处出现，与水流交叉
  float turb = smoothstep(0.55, 1.35, sp);
  vec2 dd = normalize(d + n * 0.85 + vec2(0.0001));
  float ph4 = dot(p, dd) * 7.1 + t * (2.6 + sp * 1.6) + h * 1.6;
  float s4 = 0.055 * turb * detail;
  h += s4 / 7.1 * sin(ph4);
  slope += s4 * cos(ph4) * dd;

  // 细碎涟漪（高频）
  float ph5 = dot(p, d * 9.5 - n * 3.7) - t * (5.0 + sp * 2.5);
  float s5 = 0.038 * detail;
  h += s5 / 10.0 * sin(ph5);
  slope += s5 * cos(ph5) * normalize(d * 9.5 - n * 3.7 + vec2(0.0001));

  height = h;
  return normalize(vec3(-slope.x, 1.0, -slope.y));
}

float pierFoam(vec2 p) {
  float f = 0.0;
  for (int i = 0; i < 24; i++) {
    if (float(i) >= uPierCount) break;
    float dd = length(p - uPiers[i]);
    f += smoothstep(2.8, 0.35, dd);
  }
  return clamp(f, 0.0, 1.0);
}

void main() {
  vec2 p = vWorld.xz;
  float speed = vMeta.x;
  float depth = vMeta.y;      // 0 浅 → 1 深
  float shore = vMeta.z;      // 0 岸 → 1 深水
  float kind = vMeta.w;       // 0 水面 / 1 白浪贴片 / 2 水帘

  // ── 水帘（跌水/石洞）：竖直流线 + 白色水花 ──
  if (kind > 1.5) {
    float fallY = clamp((vWorld.y - uLevel) / 3.2, 0.0, 1.0);
    float streak = sin(p.x * 9.0 + p.y * 7.0 + vWorld.y * 5.0 + uTime * (6.0 + 2.0 * fallY)
                       + sin(p.x * 2.3 + p.y * 1.7) * 2.2);
    float line = smoothstep(0.10, 0.95, 0.5 + 0.5 * streak);
    vec3 col = mix(uFoam, uSky, 0.12 + 0.20 * fallY);
    col = mix(col, uFoam, line * 0.72);
    col += uFoam * 0.16 * (1.0 - fallY);      // 下落段底部的水花更白
    float alpha = (0.50 + 0.45 * line) * smoothstep(0.0, 0.18, fallY) * (1.0 - 0.25 * fallY);
    float dist = length(cameraPosition - vWorld);
    float fogF = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
    col = mix(col, uFogColor, fogF);
    gl_FragColor = vec4(col, clamp(alpha + fogF * 0.3, 0.0, 1.0));
    return;
  }

  vec2 flow = vFlow;
  float height;
  vec3 N = waveNormal(p, flow, speed, depth, height);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.0);

  // ── 底色：浅青 → 深靛（按离岸/水深），加流动明暗 ──
  vec3 base = mix(uShallow * 0.94, uDeep, smoothstep(0.02, 1.0, depth * 0.72 + shore * 0.28));
  base *= 0.9 + 0.18 * height;
  base *= 1.0 - 0.10 * depth;

  // ── 天光反射（简单天空模型：地平线亮、天顶偏蓝）──
  vec3 refl = mix(uSky * 0.94, uSky * 0.74 + uSun * 0.04, clamp(0.5 - 0.5 * ndv, 0.0, 1.0));
  vec3 col = mix(base, refl, clamp(0.10 + fres * 0.52, 0.0, 1.0));

  // ── 太阳高光 + 星点闪烁（克制，避免整片泛白）──
  vec3 R = reflect(-uSunDir, N);
  float rdv = max(dot(R, V), 0.0);
  float spec = pow(rdv, 420.0) * 0.5 + pow(rdv, 90.0) * 0.03;
  col += uSun * spec * uSunI;
  float glint = pow(max(0.0,
      sin(p.x * 6.1 + uTime * 1.35) * sin(p.y * 5.3 - uTime * 1.05) * sin((p.x + p.y) * 3.7 + uTime * 1.75)),
    20.0);
  col += uSun * glint * 0.16 * uSunI;

  // ── 泡沫：岸边周期涌动 + 桥墩环沫 + 跌水白浪 ──
  float foam = 0.0;
  float shoreFoam = smoothstep(0.30, 0.02, shore);
  float pulse = 0.55 + 0.45 * sin(uTime * 1.35 + shore * 13.0 + sin(p.x * 0.85 + p.y * 1.25) * 3.0);
  foam += shoreFoam * pulse * 0.6;
  foam += pierFoam(p) * (0.5 + 0.22 * sin(uTime * 2.1 + p.x * 1.3)) * 0.8;
  float f0 = smoothstep(12.0, 1.6, length(p - uFall0));
  float f1 = smoothstep(13.0, 1.6, length(p - uFall1));
  float fallFoam = clamp(f0 + f1, 0.0, 1.0);
  foam += fallFoam * (0.8 + 0.2 * sin(uTime * 3.3 + length(p - uFall0) * 1.7));
  if (kind > 0.5) foam += 0.4;
  foam = clamp(foam, 0.0, 1.0);
  col = mix(col, mix(uFoam, uSky, 0.12), foam * 0.72);

  // ── 浅水波光/水底光斑：只在近岸浅水处出现的细碎高光 ──
  float shallow = 1.0 - smoothstep(0.08, 0.5, shore);
  float caust = pow(max(0.0,
      sin(p.x * 2.6 + uTime * 0.8 + sin(p.y * 2.1) * 1.3)
    * sin(p.y * 2.3 - uTime * 0.7 + cos(p.x * 1.7) * 1.1)), 6.0);
  col += uSun * caust * 0.10 * uSunI * shallow;

  // ── 漂浮物/落花光点（细碎，漂移）──
  float drift = uTime * (0.22 + speed * 0.35);
  float fl = sin(p.x * 3.1 + drift + sin(p.y * 2.3) * 0.8) * sin(p.y * 2.7 - drift * 0.7 + cos(p.x * 1.7) * 0.6);
  float petals = smoothstep(0.88, 0.995, fl) * (0.55 + 0.45 * sin(p.x * 5.0 + p.y * 3.0 + uTime * 0.6));
  col = mix(col, uPetal, petals * 0.35);

  // ── 雾与远景（与体素场景 fog 同步）──
  float dist = length(cameraPosition - vWorld);
  float fogF = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  col = mix(col, uFogColor, fogF);

  // ── 透明度：浅水更透（见河床），深水更实；菲涅耳让掠射更不透明 ──
  float alpha = mix(0.58, 0.9, clamp(fres * 0.75 + depth * 0.35, 0.0, 1.0));
  alpha = mix(alpha, 0.50, shallow * 0.35);
  alpha = mix(alpha, min(0.97, alpha + 0.12), shoreFoam * 0.5);
  alpha = mix(alpha, 0.96, fogF * 0.5);
  alpha += uNight * 0.04;
  gl_FragColor = vec4(col, clamp(alpha, 0.42, 0.97));
}`;

// ─────────────────────────────────────────────────────────────────────────────
// 水花/水雾/漂浮光点：GPU 粒子（只更新 uTime，不逐帧改位置）
// ─────────────────────────────────────────────────────────────────────────────
export const PARTICLE_VERT = /* glsl */`
attribute vec3 aOrigin;
attribute vec3 aVel;
attribute float aPhase;
attribute float aLife;
attribute float aSize;
attribute float aKind;   // 0 水花(重力) / 1 水雾(上浮) / 2 水面漂浮光点
uniform float uTime;
uniform float uPixelScale;
varying float vFade;
varying float vKind;
void main() {
  float t = fract((uTime + aPhase) / aLife);
  float lt = t * aLife;
  vec3 pos = aOrigin + aVel * lt;
  if (aKind < 0.5) {
    pos.y -= 1.6 * lt * lt;                       // 水花受重力回落
  } else if (aKind < 1.5) {
    pos.y += 0.16 * lt;                           // 水雾缓缓上浮
    pos.x += sin(uTime * 1.1 + aPhase * 6.28) * 0.22 * t;
    pos.z += cos(uTime * 0.9 + aPhase * 5.11) * 0.22 * t;
  } else {
    pos.x += sin(uTime * 0.5 + aPhase * 6.28) * 0.35 * t;
    pos.z += cos(uTime * 0.43 + aPhase * 4.71) * 0.35 * t;
  }
  vFade = smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.55, 1.0, t));
  vKind = aKind;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelScale / max(1.0, -mv.z);
}`;

export const PARTICLE_FRAG = /* glsl */`
uniform vec3 uFoam, uSky, uSun;
varying float vFade;
varying float vKind;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float a = smoothstep(0.5, 0.06, r) * vFade;
  // 漂浮光点（kind=2）更淡，避免连成一条光带
  a *= mix(1.0, 0.35, smoothstep(1.5, 2.0, vKind));
  vec3 col = mix(uFoam, uSky, 0.28 * min(vKind, 1.0));
  col = mix(col, uSun * 0.9 + uFoam * 0.35, max(0.0, vKind - 1.5) * 0.5);
  gl_FragColor = vec4(col, a * 0.45);
}`;

/** 水面片元/顶点 shader 版本号（供 Lead 日志与热重载判断） */
export const WATER_SHADER_VERSION = 'hd-water-1.0';
