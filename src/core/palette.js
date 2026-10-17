// ─────────────────────────────────────────────────────────────────────────────
// 大观园 · 体素调色板
// 取色参考：清式官式建筑彩画、苏州园林粉墙黛瓦、87 版《红楼梦》剧集与北京大观园实景。
// 每个颜色带稳定索引，世界体素以 16bit 索引存储；glow=自发光，s=可被地形阴影覆盖。
// ─────────────────────────────────────────────────────────────────────────────

const DEFS = [
  // —— 土、石、地面 ——
  ['grass', 0x7aa35d], ['grass2', 0x6c9551], ['grass3', 0x86ae66], ['grassDry', 0x94a86a],
  ['dirt', 0x8f6f4e], ['dirt2', 0x7d6143], ['dirt3', 0x9c7b57],
  ['path', 0xc3bbaa], ['path2', 0xb3ab99], ['path3', 0xa49c8b], ['pebble', 0xd2cbbd], ['pebbleDark', 0xa9a292],
  ['stone', 0x9aa0a2], ['stoneLight', 0xb7bdbe], ['stoneDark', 0x7f878a], ['stoneWarm', 0xb9b2a2], ['stoneBlue', 0x8d99a0],
  ['rock', 0xa7aeb0], ['rockDark', 0x8a9294], ['rockLight', 0xc0c6c6], ['taihu', 0xcfd3ce], ['mossRock', 0x8fa07f],
  ['marble', 0xe3e1d8], ['marbleShade', 0xcfccc1],
  // —— 墙体、屋顶 ——
  ['whitewall', 0xe9e4d8], ['whitewallShade', 0xd8d2c5], ['wallBase', 0xb5aea0], ['plaster', 0xf0ece2],
  ['roof', 0x6a7482], ['roofDark', 0x59616e], ['roofLight', 0x7d8795], ['roofEdge', 0x4b5360], ['ridge', 0x444c58], ['ridgeLight', 0x5c6572],
  ['glaze', 0xc8a23b], ['glazeLight', 0xe0bc57], ['glazeDark', 0xa9842c], ['glazeGreen', 0x3f7f66], ['glazeGreenLight', 0x5a9c7c],
  // —— 木作、彩画 ——
  ['red', 0xa63c31], ['redDark', 0x862f27], ['redLight', 0xbf5142], ['redPillar', 0x9e332a], ['redRail', 0xb0453a],
  ['greenPillar', 0x316b58], ['greenPaint', 0x3f7f6a], ['teal', 0x2d6f71], ['blue', 0x2c4f79], ['blueLight', 0x3e6b9c],
  ['gold', 0xd8b64b], ['goldDark', 0xa8872e],
  ['wood', 0x7c5b3d], ['woodDark', 0x5e4530], ['woodLight', 0x9c7852], ['woodRed', 0x8c4a3a],
  ['latticeDark', 0x4b3b2c], ['windowGreen', 0x3f6f5c], ['curtain', 0xe7c2c4], ['cushion', 0x9e3b41],
  ['plaqueBoard', 0x2a221a], ['goldText', 0xe2c46c], ['ink', 0x2b2b2b],
  // —— 草木 ——
  ['bambooStalk', 0x9fb268], ['bambooNode', 0x8a9d57], ['bambooLeaf', 0x6f9448], ['bambooLeaf2', 0x7fa353], ['bambooLeaf3', 0x5d8039],
  ['leaf', 0x3f7c3c], ['leafDark', 0x2f6334], ['leafLight', 0x55974a], ['leafYellow', 0x7fa05a],
  ['willow', 0x93ad5f], ['willow2', 0xa9bd77], ['pine', 0x2f5c3c], ['pineLight', 0x3d7148], ['pineDark', 0x24492f],
  ['apricot', 0xf2c9d4], ['apricot2', 0xe9b6c5], ['peach', 0xf4bcc7], ['crabapple', 0xe390a1], ['plumRed', 0xc14a5d], ['plumWhite', 0xeee8ea],
  ['peony', 0xd3708f], ['peony2', 0xe7a2b8], ['lotusFlower', 0xeab4c6], ['chrys', 0xe0c05c],
  ['thatch', 0xc4ab67], ['thatchDark', 0xa98f4f], ['straw', 0xd2ba72], ['reed', 0xb8ae80], ['reed2', 0xa29a70],
  ['soil', 0x8b6b4a], ['soilDark', 0x73573b], ['farm', 0x7f6a45], ['rice', 0xb9b05e], ['vegetable', 0x5f8f47],
  ['lotusPad', 0x4e8047], ['lotusPad2', 0x5f9352], ['lotusPad3', 0x437238], ['bankStone', 0xa5aaa6],
  // —— 水（水下） ——
  ['waterBed', 0x62786f], ['waterBed2', 0x57706a], ['waterBed3', 0x6d8279],
  // —— 陈设 ——
  ['bronze', 0x7c6a45], ['bronzeDark', 0x5f5136], ['paper', 0xefe9da], ['silkPink', 0xe8c9cc],
  ['rockGarden', 0x9aa79c], ['rockGarden2', 0x8a978d],
  // —— 自发光 ——
  ['lamp', 0xffd98f, { glow: true }], ['lampWarm', 0xffc56e, { glow: true }], ['lampRed', 0xff9a70, { glow: true }],
  ['windowGlow', 0xf3d49a],
  ['candle', 0xfff0c0, { glow: true }],
];

export const PALETTE = [null];
export const C = Object.create(null);

for (const [name, hex, opt] of DEFS) {
  const idx = PALETTE.length;
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  PALETTE.push({
    name,
    hex,
    r, g, b,
    glow: !!(opt && opt.glow),
    shadowable: !(opt && opt.glow),
    // 线性空间近似（用于雾/水颜色混合时不需要精确，保留 sRGB 值即可）
  });
  C[name] = idx;
}

// 常用色组，供生成器随机撒点
export const GROUPS = {
  grass: [C.grass, C.grass2, C.grass3, C.grassDry],
  dirt: [C.dirt, C.dirt2, C.dirt3],
  path: [C.path, C.path2, C.path3, C.pebble],
  stone: [C.stone, C.stoneLight, C.stoneDark, C.stoneWarm],
  rock: [C.rock, C.rockDark, C.rockLight, C.rockGarden],
  roof: [C.roof, C.roofDark, C.roofLight],
  leaf: [C.leaf, C.leafDark, C.leafLight, C.leafYellow],
  bamboo: [C.bambooLeaf, C.bambooLeaf2, C.bambooLeaf3],
  pine: [C.pine, C.pineLight, C.pineDark],
  willow: [C.willow, C.willow2, C.leafLight],
  apricot: [C.apricot, C.apricot2, C.plumWhite],
  peach: [C.peach, C.apricot2, C.plumWhite],
  crabapple: [C.crabapple, C.apricot2, C.peony2],
  reed: [C.reed, C.reed2, C.straw],
  waterBed: [C.waterBed, C.waterBed2, C.waterBed3],
};

export function hexOf(idx) { const p = PALETTE[idx]; return p ? p.hex : 0; }
export function rgbOf(idx) { const p = PALETTE[idx]; return p ? [p.r / 255, p.g / 255, p.b / 255] : [1, 0, 1]; }
export function isGlow(idx) { const p = PALETTE[idx]; return !!(p && p.glow); }
export function nameOf(idx) { const p = PALETTE[idx]; return p ? p.name : 'air'; }
