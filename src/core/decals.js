// ─────────────────────────────────────────────────────────────────────────────
// 匾额 / 楹联 / 酒旗：CanvasTexture 贴片，不参与体素网格化，但必须在体素之上。
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const FONT = '"KaiTi", "STKaiti", "Noto Serif SC", "Songti SC", "SimSun", "Source Han Serif SC", serif';
const hex = (idx) => '#' + (PALETTE[idx]?.hex ?? 0x000000).toString(16).padStart(6, '0');

function makePlaqueTexture(d) {
  const W = 512, H = 160;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = hex(d.board); c.fillRect(0, 0, W, H);
  // 木纹/漆面细纹
  c.globalAlpha = 0.12;
  for (let i = 0; i < 26; i++) {
    c.strokeStyle = i % 2 ? '#000' : '#fff';
    c.beginPath(); c.moveTo(0, 8 + i * 6 + Math.random() * 3); c.lineTo(W, 8 + i * 6 + Math.random() * 3); c.stroke();
  }
  c.globalAlpha = 1;
  // 金框
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, hex(d.frame)); g.addColorStop(0.5, '#f0d98a'); g.addColorStop(1, hex(d.frame));
  c.strokeStyle = g; c.lineWidth = 10;
  c.strokeRect(5, 5, W - 10, H - 10);
  c.lineWidth = 2; c.strokeStyle = 'rgba(60,40,10,0.6)'; c.strokeRect(14, 14, W - 28, H - 28);
  // 文字
  const text = String(d.text || '');
  const n = Math.max(1, [...text].length);
  let fs = Math.min(96, Math.floor((W - 70) / n * 1.35));
  c.font = `${fs}px ${FONT}`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = 6; c.shadowOffsetY = 3;
  const grad = c.createLinearGradient(0, 30, 0, H - 30);
  grad.addColorStop(0, '#f6e2a2'); grad.addColorStop(0.5, hex(d.ink)); grad.addColorStop(1, '#d9b25a');
  c.fillStyle = grad;
  c.fillText(text, W / 2, H / 2 + 2);
  c.shadowColor = 'transparent';
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeCoupletTexture(d) {
  const W = 96, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = hex(d.board); c.fillRect(0, 0, W, H);
  c.strokeStyle = hex(d.frame); c.lineWidth = 4; c.strokeRect(4, 4, W - 8, H - 8);
  const text = [...String(d.text || '')];
  const fs = Math.min(64, Math.floor((H - 60) / Math.max(1, text.length) * 0.92));
  c.font = `${fs}px ${FONT}`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = hex(d.ink);
  c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 4;
  const step = (H - 60) / Math.max(1, text.length);
  text.forEach((ch, i) => c.fillText(ch, W / 2, 30 + step * (i + 0.5)));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeBannerTexture(d) {
  const W = 128, H = 384;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = hex(d.board); c.fillRect(0, 0, W, H);
  c.strokeStyle = hex(d.frame); c.lineWidth = 5; c.strokeRect(5, 5, W - 10, H - 10);
  const text = [...String(d.text || '')];
  const fs = Math.min(72, Math.floor((H - 60) / Math.max(1, text.length) * 0.92));
  c.font = `${fs}px ${FONT}`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = hex(d.ink);
  const step = (H - 60) / Math.max(1, text.length);
  text.forEach((ch, i) => c.fillText(ch, W / 2, 30 + step * (i + 0.5)));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 用 decals 数组生成贴片 Group */
export function buildDecalGroup(decals) {
  const group = new THREE.Group();
  group.renderOrder = 3;
  for (const d of decals) {
    let tex, ratio;
    if (d.kind === 'couplet') { tex = makeCoupletTexture(d); ratio = 96 / 512; }
    else if (d.kind === 'banner') { tex = makeBannerTexture(d); ratio = 128 / 384; }
    else { tex = makePlaqueTexture(d); ratio = 512 / 160; }
    const h = d.h || (d.kind === 'couplet' ? 6 : 3);
    const w = d.kind === 'plaque' ? (d.w || 8) : Math.max(1, h * ratio);
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, toneMapped: false, fog: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(d.x, d.y + h / 2, d.z);
    mesh.rotation.y = d.dir === 'north' ? Math.PI : d.dir === 'east' ? Math.PI / 2 : d.dir === 'west' ? -Math.PI / 2 : 0;
    // 朝南时法线 +z；贴片略微外移避免与体素 z-fighting
    const off = 0.52;
    if (d.dir === 'north') mesh.position.z -= off;
    else if (d.dir === 'east') mesh.position.x += off;
    else if (d.dir === 'west') mesh.position.x -= off;
    else mesh.position.z += off;
    mesh.renderOrder = 4;
    group.add(mesh);
  }
  return group;
}
