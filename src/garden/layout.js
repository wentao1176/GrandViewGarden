// ─────────────────────────────────────────────────────────────────────────────
// 大观园总平面（唯一空间依据）
// 坐标：x 东(+)/西(-)，z 南(+)/北(-)，园墙内约 296 × 296 体素，1 体素≈1 米。
// 依据：docs/research.md（第 17/18 回游线与红学通行复原），拓扑严格对应其 40×40 图。
// 主要坐标换算：x ≈ (列 − 20.5) × 8，z ≈ (行 − 20.5) × 8；为构图与可行走性做了 ±3 格微调。
// ─────────────────────────────────────────────────────────────────────────────
export const GROUND_TOP = 3;      // 普通地面最后一层实体的 y
export const WATER_LEVEL = 3.35;   // 水面高度（世界坐标 y）

export const WALL = {
  x1: -148, x2: 148, z1: -148, z2: 148,
  h: 6, th: 3,
  gate: { x: 0, w: 34 }, // 南墙正门开口
};

// 地形抬升（台地；均为“地面顶层 y”）
export const ELEV = {
  default: 3, daoxiang: 6, hengwu: 8, longcui: 9, qiushuang: 5, nuangxiangwu: 6,
  gubishan: 14, aojing: 3, hongxiangpu: 4, yihong: 4, xiaoxiang: 4, tujing: 4,
  luxuean: 4, ouxiangxie: 3, zilingzhou: 4, dicuiting: 3, qinfangting: 3,
  maingate: 4, xingqin_plaza: 4, zhengdian: 5, daguanlou: 5, peilou: 5,
  qinfangzha: 6, bajiaowu: 5, mudanting: 4, qiangweiyuan: 4, tumijia: 4, liuyezhu: 3,
};

// ── 山体（椭圆叠加，形成大主山、东北山环、东西余脉）────────────────────────────
export const HILLS = [
  { cx: -100, cz: -126, rx: 56, rz: 34, h: 18 },  // 大主山主峰（西北）
  { cx: -56, cz: -138, rx: 34, rz: 20, h: 12 },
  { cx: -132, cz: -92, rx: 22, rz: 44, h: 9 },    // 西山
  { cx: 58, cz: -136, rx: 26, rz: 18, h: 9 },     // 北山（省亲别墅背后余脉）
  { cx: 104, cz: -134, rx: 46, rz: 22, h: 15 },    // 东北山环（栊翠庵）
  { cx: 126, cz: -104, rx: 24, rz: 18, h: 13 },   // 凸碧山
  { cx: 143, cz: -20, rx: 12, rz: 50, h: 7 },     // 东山余脉
  { cx: -144, cz: -6, rx: 10, rz: 52, h: 7 },     // 西山余脉
  { cx: -40, cz: 140, rx: 44, rz: 14, h: 9 },     // 南岸小丘（翠嶂西）
  { cx: 84, cz: 138, rx: 38, rz: 14, h: 8 },      // 南岸小丘（翠嶂东）
  { cx: -112, cz: 128, rx: 32, rz: 16, h: 9 },
];

// ── 台地/院落基面（铺平）。elev 为地面顶层 y ─────────────────────────────────
export const PADS = [
  { name: 'main_gate', x1: -18, x2: 18, z1: 132, z2: 148, elev: ELEV.maingate },
  { name: 'entry', x1: -20, x2: 20, z1: 126, z2: 136, elev: 3 },
  { name: 'yihong', x1: 36, x2: 82, z1: 12, z2: 54, elev: ELEV.yihong },
  { name: 'xiaoxiang', x1: -126, x2: -74, z1: 20, z2: 64, elev: ELEV.xiaoxiang },
  { name: 'qiushuang', x1: 72, x2: 112, z1: -48, z2: -4, elev: ELEV.qiushuang },
  { name: 'nuangxiangwu', x1: 42, x2: 80, z1: -96, z2: -62, elev: ELEV.nuangxiangwu },
  { name: 'daoxiang', x1: -136, x2: -88, z1: -102, z2: -58, elev: ELEV.daoxiang },
  { name: 'hengwu', x1: 20, x2: 60, z1: -118, z2: -90, elev: ELEV.hengwu },
  { name: 'longcui', x1: 78, x2: 114, z1: -144, z2: -114, elev: ELEV.longcui },
  { name: 'gubishan', x1: 108, x2: 128, z1: -106, z2: -86, elev: ELEV.gubishan },
  { name: 'aojing', x1: 80, x2: 100, z1: -90, z2: -72, elev: ELEV.aojing },
  { name: 'hongxiangpu', x1: -128, x2: -84, z1: -56, z2: -16, elev: ELEV.hongxiangpu },
  { name: 'luxuean', x1: -90, x2: -56, z1: -100, z2: -86, elev: ELEV.luxuean },
  { name: 'zilingzhou', x1: -8, x2: 26, z1: -42, z2: -14, elev: ELEV.zilingzhou },
  { name: 'ouxiangxie', x1: -32, x2: -8, z1: -72, z2: -50, elev: ELEV.ouxiangxie },
  { name: 'dicuiting', x1: -38, x2: -18, z1: 6, z2: 26, elev: ELEV.dicuiting },
  { name: 'qinfangting', x1: -16, x2: 16, z1: 48, z2: 66, elev: ELEV.qinfangting },
  { name: 'qinzheng_plaza', x1: -30, x2: 30, z1: -110, z2: -94, elev: ELEV.xingqin_plaza },
  { name: 'zhengdian', x1: -26, x2: 26, z1: -130, z2: -108, elev: ELEV.zhengdian },
  { name: 'daguanlou', x1: -22, x2: 22, z1: -148, z2: -128, elev: ELEV.daguanlou },
  { name: 'peilou_e', x1: 26, x2: 48, z1: -140, z2: -120, elev: ELEV.peilou },
  { name: 'peilou_w', x1: -48, x2: -26, z1: -140, z2: -120, elev: ELEV.peilou },
  { name: 'qinfangzha', x1: 118, x2: 140, z1: -140, z2: -122, elev: ELEV.qinfangzha },
  { name: 'bajiaowu', x1: -128, x2: -106, z1: -120, z2: -102, elev: ELEV.bajiaowu },
  { name: 'mudanting', x1: -142, x2: -126, z1: -70, z2: -54, elev: ELEV.mudanting },
  { name: 'qiangweiyuan', x1: -144, x2: -128, z1: -52, z2: -34, elev: ELEV.qiangweiyuan },
  { name: 'tumijia', x1: -144, x2: -130, z1: -80, z2: -58, elev: ELEV.tumijia },
  { name: 'liuyezhu', x1: -72, x2: -46, z1: -58, z2: -34, elev: ELEV.liuyezhu },
  { name: 'xingyezhu', x1: -24, x2: -4, z1: -16, z2: -2, elev: 3 },
  { name: 'huaxu', x1: 2, x2: 32, z1: -102, z2: -82, elev: 3 },
];

// ── 水体：池塘（椭圆并集）+ 溪流（折线，带宽度）──────────────────────────────
export const PONDS = [
  { name: '沁芳池西', cx: -34, cz: -46, rx: 30, rz: 28 },
  { name: '沁芳池中', cx: -2, cz: -38, rx: 34, rz: 30 },
  { name: '沁芳池东', cx: 22, cz: -54, rx: 24, rz: 24 },
  { name: '沁芳池南', cx: -16, cz: -12, rx: 20, rz: 16 },
  { name: '沁芳池北', cx: -6, cz: -66, rx: 24, rz: 18 },
  { name: '花溆潭', cx: 16, cz: -92, rx: 16, rz: 9 },
  { name: '芦雪汀', cx: -70, cz: -80, rx: 14, rz: 7 },
  { name: '凹晶湾', cx: 88, cz: -82, rx: 16, rz: 9 },
  { name: '沁芳闸潭', cx: 128, cz: -132, rx: 9, rz: 6 },
  { name: '沁芳桥潭', cx: 0, cz: 54, rx: 25, rz: 9 },
  { name: '沁芳亭潭', cx: 0, cz: 55, rx: 14, rz: 8 },
  { name: '藕香池', cx: -20, cz: -60, rx: 10, rz: 7 },
];
export const STREAMS = [
  { name: '花溆—沁芳闸', w: 9, pts: [[16, -92], [34, -90], [54, -92], [72, -90], [84, -86], [90, -96], [98, -106], [108, -114], [118, -124], [128, -132]] },
  { name: '花溆—沁芳池', w: 13, pts: [[16, -92], [15, -86], [10, -80], [4, -74], [-4, -70]] },
  { name: '沁芳池—沁芳亭', w: 9, pts: [[-16, -10], [-22, 2], [-28, 10], [-28, 16], [-22, 26], [-12, 38], [-4, 48], [0, 54], [0, 58]] },
  { name: '沁芳亭—东南出水', w: 8, pts: [[0, 60], [4, 68], [12, 78], [28, 86], [52, 94], [78, 100], [104, 108], [132, 112], [150, 114]] },
  { name: '稻香村支流', w: 4, pts: [[-52, -32], [-66, -40], [-78, -50], [-86, -56]] },
  { name: '芦雪汀支流', w: 5, pts: [[-52, -66], [-60, -76], [-68, -82], [-74, -86]] },
  { name: '柳叶渚支流', w: 5, pts: [[-46, -40], [-54, -46], [-60, -52]] },
  { name: '沁芳闸出水', w: 6, pts: [[128, -132], [134, -138], [140, -144]] },
];
// 桥位（由对应景点负责建造，地形先留水）
// arch-water 实测最终桥位（2026-10）：zhuqiao 藕香榭曲折竹桥两段 L 形——
//   段1 中心 (-34,-58) 长16 宽4 沿x；折角平台 x[-46,-41] z[-60,-56]；段2 中心 (-46,-66) 长18 沿z，北端 z≈-75。
//   ouyuan 中心 (-4,-46) 长16 沿z（南端紫菱洲南岸 z≈-38）；ziling 九曲折桥 (-2,-17)→(-2,0) 一带；
//   xingye 折桥 (-24,-10)→(-36,-8)；fengyao 归 arch-west。
export const BRIDGES = {
  qinfang: { x: 0, z: 54, len: 36, wid: 14, dir: 'x', type: 'stone3' },
  fengyao: { x: -72, z: -45, len: 9, wid: 5, dir: 'x', type: 'stone1', note: 'arch-west 实测迁至实际窄颈 (-72,-45)' },
  zhedai: { x: 20, z: -84, len: 16, wid: 5, dir: 'x', type: 'wood' },
  zhuqiao: { x: -34, z: -58, len: 16, wid: 4, dir: 'x', type: 'bamboo', note: '两段L形，段2 (-46,-66) 沿z 北至 -75' },
  ouyuan: { x: -4, z: -46, len: 16, wid: 4, dir: 'z', type: 'wood' },
  ziling: { x: -2, z: -9, len: 24, wid: 4, dir: 'z', type: 'stone1', note: '九曲，岛南岸→池南岸' },
  xingye: { x: -30, z: -9, len: 12, wid: 4, dir: 'x', type: 'wood' },
  qinfangzha: { x: 128, z: -120, len: 10, wid: 8, dir: 'z', type: 'stone1' },
};

// ── 道路（石板路 / 卵石径 / 土径）────────────────────────────────────────────
export const PATHS = [
  { k: 'stone', w: 7, pts: [[0, 162], [0, 148], [0, 140]] },                    // 门前御道
  { k: 'stone', w: 6, pts: [[0, 140], [0, 134], [0, 130], [1, 124], [-2, 118], [0, 112], [0, 104], [0, 96], [0, 88], [0, 80], [0, 72], [0, 66]] }, // 翠嶂石径—沁芳桥
  { k: 'stone', w: 6, pts: [[0, 62], [0, 50], [0, 42], [0, 34], [0, 26], [0, 18]] }, // 桥北短径
  { k: 'stone', w: 6, pts: [[0, 58], [-14, 56], [-30, 52], [-46, 54], [-62, 54], [-76, 50], [-86, 46]] }, // 西行至潇湘馆
  { k: 'stone', w: 6, pts: [[0, 58], [16, 56], [30, 54], [42, 50], [52, 48], [60, 46]] }, // 东行至怡红院
  { k: 'stone', w: 5, pts: [[0, 18], [14, 20], [24, 28], [30, 40], [34, 52], [32, 58]] }, // 池东岸环
  { k: 'stone', w: 5, pts: [[-30, 16], [-34, 26], [-40, 38], [-48, 48]] },      // 滴翠亭径
  { k: 'stone', w: 5, pts: [[-86, 46], [-94, 34], [-96, 20], [-94, 8], [-90, -6], [-86, -20], [-84, -34], [-86, -48], [-90, -60], [-92, -72], [-90, -82]] }, // 西环路
  { k: 'pebble', w: 4, pts: [[-90, -82], [-96, -90], [-100, -98], [-98, -106]] }, // 稻香村径
  { k: 'stone', w: 5, pts: [[-84, -34], [-94, -32], [-104, -34], [-112, -36]] }, // 红香圃径
  { k: 'pebble', w: 4, pts: [[-60, -50], [-58, -62], [-56, -72], [-58, -82], [-64, -90], [-72, -96]] }, // 芦雪庵径（柳叶渚—芦雪庵）
  { k: 'stone', w: 5, pts: [[-56, -50], [-48, -56], [-40, -58]] },              // 藕香榭竹桥径
  { k: 'stone', w: 5, pts: [[-58, -78], [-52, -86], [-44, -90]] },              // 芦雪汀南径
  { k: 'stone', w: 6, pts: [[0, 34], [12, 30], [24, 22], [32, 12], [34, 0], [32, -12], [28, -26], [24, -40], [22, -54], [24, -66], [28, -76], [24, -84], [18, -90]] }, // 池东岸主径
  { k: 'stone', w: 5, pts: [[18, -90], [12, -94], [4, -98], [0, -100]] },       // 花溆—省亲牌坊
  { k: 'stone', w: 8, pts: [[0, -100], [0, -108]] },                             // 省亲广场
  { k: 'stone', w: 6, pts: [[0, -110], [16, -112], [34, -114], [52, -116], [68, -118], [80, -122], [90, -126]] }, // 北径至栊翠庵
  { k: 'stone', w: 5, pts: [[92, -128], [104, -132], [114, -134], [124, -134]] }, // 栊翠庵—沁芳闸
  { k: 'stone', w: 4, pts: [[104, -130], [110, -122], [114, -112], [116, -104]] }, // 登山至凸碧
  { k: 'pebble', w: 4, pts: [[116, -104], [108, -96], [100, -90], [94, -86]] },   // 凸碧—凹晶
  { k: 'stone', w: 4, pts: [[126, -134], [120, -126], [112, -116], [104, -106], [98, -98], [92, -90]] }, // 沁芳闸—凹晶
  { k: 'stone', w: 5, pts: [[92, 8], [106, 20], [120, 36], [128, 56], [130, 76], [124, 94], [114, 104]] }, // 东环路
  { k: 'stone', w: 5, pts: [[-86, -48], [-102, -44], [-116, -42], [-128, -40]] }, // 红香圃西径
  { k: 'pebble', w: 4, pts: [[-96, -20], [-108, -14], [-118, -10], [-126, -8]] }, // 蔷薇院径
  { k: 'stone', w: 5, pts: [[60, 46], [74, 36], [84, 24], [92, 12], [96, 2]] },   // 怡红院—秋爽斋
  { k: 'stone', w: 5, pts: [[96, 2], [98, -14], [94, -30], [88, -44], [80, -58], [72, -70], [64, -78]] }, // 秋爽斋—暖香坞
  { k: 'stone', w: 4, pts: [[64, -78], [54, -84], [44, -90], [34, -96], [28, -102]] }, // 暖香坞—蘅芜苑石梯
  { k: 'stone', w: 5, pts: [[-30, 16], [-22, 8], [-16, 0]] },                   // 滴翠亭—荇叶渚
  { k: 'stone', w: 4, pts: [[-20, 24], [-10, 30], [0, 26]] },                   // 池南小路
  { k: 'stone', w: 6, pts: [[-34, 128], [-52, 130], [-70, 132], [-86, 128], [-100, 120]] }, // 南墙西段
  { k: 'stone', w: 6, pts: [[34, 128], [50, 132], [70, 128], [88, 118], [102, 108]] },       // 南墙东段
  { k: 'stone', w: 4, pts: [[-126, 40], [-134, 58], [-138, 78], [-136, 96]] },   // 潇湘馆西径
];

// ── 景点分区（场景生成器使用）────────────────────────────────────────────────
export const ZONES = {
  yihong: { x1: 36, x2: 82, z1: 12, z2: 54, elev: ELEV.yihong, name: '怡红院' },
  xiaoxiang: { x1: -126, x2: -74, z1: 20, z2: 64, elev: ELEV.xiaoxiang, name: '潇湘馆' },
  qiushuang: { x1: 72, x2: 112, z1: -48, z2: -4, elev: ELEV.qiushuang, name: '秋爽斋' },
  nuangxiangwu: { x1: 42, x2: 80, z1: -96, z2: -62, elev: ELEV.nuangxiangwu, name: '暖香坞' },
  daoxiang: { x1: -136, x2: -88, z1: -102, z2: -58, elev: ELEV.daoxiang, name: '稻香村' },
  hengwu: { x1: 20, x2: 60, z1: -118, z2: -90, elev: ELEV.hengwu, name: '蘅芜苑' },
  longcui: { x1: 78, x2: 114, z1: -144, z2: -114, elev: ELEV.longcui, name: '栊翠庵' },
  gubishan: { x1: 108, x2: 128, z1: -106, z2: -86, elev: ELEV.gubishan, name: '凸碧山庄' },
  aojing: { x1: 80, x2: 100, z1: -90, z2: -72, elev: ELEV.aojing, name: '凹晶溪馆' },
  hongxiangpu: { x1: -128, x2: -84, z1: -56, z2: -16, elev: ELEV.hongxiangpu, name: '红香圃' },
  luxuean: { x1: -90, x2: -56, z1: -100, z2: -86, elev: ELEV.luxuean, name: '芦雪庵' },
  zilingzhou: { x1: -8, x2: 26, z1: -42, z2: -14, elev: ELEV.zilingzhou, name: '紫菱洲' },
  ouxiangxie: { x1: -32, x2: -8, z1: -72, z2: -50, elev: ELEV.ouxiangxie, name: '藕香榭' },
  dicuiting: { x1: -38, x2: -18, z1: 6, z2: 26, elev: ELEV.dicuiting, name: '滴翠亭' },
  xingyezhu: { x1: -24, x2: -4, z1: -16, z2: -2, elev: 3, name: '荇叶渚' },
  qinfangting: { x1: -16, x2: 16, z1: 48, z2: 66, elev: ELEV.qinfangting, name: '沁芳亭' },
  qinfangzha: { x1: 118, x2: 140, z1: -140, z2: -122, elev: ELEV.qinfangzha, name: '沁芳闸' },
  huaxu: { x1: 2, x2: 32, z1: -102, z2: -82, elev: 3, name: '花溆' },
  bajiaowu: { x1: -128, x2: -106, z1: -120, z2: -102, elev: ELEV.bajiaowu, name: '芭蕉坞' },
  mudanting: { x1: -142, x2: -126, z1: -70, z2: -54, elev: ELEV.mudanting, name: '牡丹亭' },
  qiangweiyuan: { x1: -144, x2: -128, z1: -52, z2: -34, elev: ELEV.qiangweiyuan, name: '蔷薇院' },
  tumijia: { x1: -144, x2: -130, z1: -80, z2: -58, elev: ELEV.tumijia, name: '荼蘼架·木香棚' },
  liuyezhu: { x1: -72, x2: -46, z1: -58, z2: -34, elev: ELEV.liuyezhu, name: '柳叶渚' },
  shengqin: { x1: -50, x2: 50, z1: -148, z2: -94, elev: 5, name: '省亲别墅' },
  cuzhang: { x1: -50, x2: 34, z1: 108, z2: 134, elev: 3, name: '翠嶂' },
};

// ── 主要景点（相机与 UI 用）──────────────────────────────────────────────────
// look: 相机注视点；theta/phi/radius: 推荐视角（theta=0 自南向北看）
export const POIS = [
  { id: 'main_gate', name: '大观园正门', group: '中轴', x: 0, z: 140, y: 6, look: [0, 13, 144], theta: 0.05, phi: 1.27, radius: 62 , cam: [0, 30, 206], walk: [0, 158, 0] },
  { id: 'cuzhang', name: '翠嶂·曲径通幽', group: '中轴', x: 0, z: 122, y: 8, look: [0, 10, 120], theta: 0.3, phi: 1.26, radius: 26 , cam: [0, 55, 170], walk: [0, 136, 0] },
  { id: 'qinfangting', name: '沁芳亭·沁芳桥', group: '中轴', x: 0, z: 55, y: 8, look: [0, 8, 52], theta: 0.35, phi: 1.18, radius: 40 , cam: [0, 24, 98], walk: [0, 66, 0] },
  { id: 'shengqin', name: '省亲别墅·大观楼', group: '中轴', x: 0, z: -126, y: 18, look: [0, 20, -124], theta: 0.05, phi: 1.24, radius: 78 , cam: [36, 46, -44], walk: [0, -94, 0] },
  { id: 'yihong', name: '怡红院', group: '东部', x: 60, z: 34, y: 8, look: [60, 8, 32], theta: -0.5, phi: 1.2, radius: 46 , cam: [30, 36, 92], walk: [59, 58, 0] },
  { id: 'xiaoxiang', name: '潇湘馆', group: '西部', x: -100, z: 42, y: 8, look: [-100, 8, 40], theta: 0.5, phi: 1.2, radius: 46 , cam: [-70, 34, 88], walk: [-100, 56, 0] },
  { id: 'daoxiang', name: '稻香村', group: '西部', x: -110, z: -80, y: 10, look: [-110, 8, -78], theta: 0.55, phi: 1.2, radius: 52 , cam: [-62, 36, -30], walk: [-110, -64, 0] },
  { id: 'hengwu', name: '蘅芜苑', group: '北部', x: 40, z: -104, y: 12, look: [40, 10, -102], theta: -0.4, phi: 1.2, radius: 52 , cam: [64, 48, -50], walk: [40, -90, 0] },
  { id: 'longcui', name: '栊翠庵', group: '北部', x: 96, z: -128, y: 14, look: [96, 12, -126], theta: -0.4, phi: 1.2, radius: 50 , cam: [64, 40, -84], walk: [96, -110, 0] },
  { id: 'gubishan', name: '凸碧山庄', group: '北部', x: 118, z: -96, y: 22, look: [118, 18, -94], theta: -0.7, phi: 1.15, radius: 56 , cam: [104, 40, -60], walk: [118, -80, 0] },
  { id: 'aojing', name: '凹晶溪馆', group: '北部', x: 90, z: -82, y: 7, look: [90, 7, -80], theta: 0.6, phi: 1.26, radius: 42 , cam: [96, 30, -110], walk: [90, -64, 0] },
  { id: 'huaxu', name: '花溆·萝港', group: '水系', x: 18, z: -92, y: 8, look: [18, 7, -90], theta: 0.4, phi: 1.22, radius: 40 , cam: [18, 45, -55], walk: [18, -80, 0] },
  { id: 'qinfangzha', name: '沁芳闸', group: '水系', x: 128, z: -132, y: 8, look: [128, 8, -130], theta: -0.8, phi: 1.2, radius: 46 , cam: [96, 26, -94], walk: [128, -118, 0] },
  { id: 'ouxiangxie', name: '藕香榭', group: '水系', x: -20, z: -60, y: 8, look: [-20, 7, -58], theta: 0.7, phi: 1.2, radius: 44 , cam: [-8, 30, -24], walk: [-46, -74, 0] },
  { id: 'zilingzhou', name: '紫菱洲·缀锦楼', group: '水系', x: 8, z: -28, y: 12, look: [8, 10, -26], theta: 0.15, phi: 1.18, radius: 50 , cam: [-34, 34, -2], walk: [8, -17, 0] },
  { id: 'xingyezhu', name: '荇叶渚', group: '水系', x: -14, z: -8, y: 5, look: [-14, 4, -6], theta: 0.5, phi: 1.3, radius: 38 , cam: [-10, 22, 26], walk: [-14, 4, 0] },
  { id: 'dicuiting', name: '滴翠亭', group: '水系', x: -28, z: 16, y: 7, look: [-28, 6, 18], theta: 0.3, phi: 1.24, radius: 38 , cam: [-26, 22, 40], walk: [-28, 30, 0] },
  { id: 'qiushuang', name: '秋爽斋·晓翠堂', group: '东部', x: 92, z: -24, y: 9, look: [92, 8, -22], theta: -0.7, phi: 1.2, radius: 48 , cam: [86, 34, 40], walk: [92, -8, 0] },
  { id: 'nuangxiangwu', name: '蓼风轩·暖香坞', group: '东部', x: 60, z: -78, y: 10, look: [60, 9, -76], theta: -0.5, phi: 1.22, radius: 46 , cam: [52, 34, -30], walk: [60, -62, 0] },
  { id: 'luxuean', name: '芦雪庵', group: '西部', x: -70, z: -92, y: 8, look: [-70, 7, -90], theta: 0.6, phi: 1.24, radius: 44 , cam: [-62, 30, -50], walk: [-70, -78, 0] },
  { id: 'hongxiangpu', name: '红香圃·芍药栏', group: '西部', x: -104, z: -36, y: 8, look: [-104, 7, -34], theta: 0.5, phi: 1.24, radius: 46 , cam: [-96, 30, 10], walk: [-104, -20, 0] },
  { id: 'liuyezhu', name: '柳叶渚', group: '西部', x: -58, z: -44, y: 7, look: [-58, 6, -42], theta: 0.8, phi: 1.24, radius: 36 , cam: [-50, 22, -8], walk: [-58, -30, 0] },
  { id: 'mudanting', name: '牡丹亭·蔷薇院', group: '西部', x: -134, z: -58, y: 8, look: [-134, 7, -56], theta: 0.9, phi: 1.22, radius: 40 , cam: [-128, 28, -20], walk: [-134, -44, 0] },
  { id: 'bajiaowu', name: '芭蕉坞', group: '西部', x: -116, z: -110, y: 9, look: [-116, 8, -108], theta: 0.7, phi: 1.22, radius: 40 , cam: [-96, 34, -70], walk: [-116, -96, 0] },
];
