# 大观园 3D 体素项目 · 引擎与协作契约（v1）

> 所有成员必读。**先读 `docs/research.md`**（考据依据）与 `src/garden/layout.js`（唯一坐标依据）。

## 0. 总则

- 项目：纯前端、单文件可离线打开的 3D 体素《红楼梦》大观园。技术栈：three.js r169 + 自研体素贪心网格化 + esbuild 打包内联。
- 目录与**文件所有权（不得越界写）**：
  | 文件/目录 | 所有者 | 说明 |
  |---|---|---|
  | `src/core/*` | lead | 体素世界/网格化/渲染/控制，只读，不要改 |
  | `src/garden/layout.js` | lead | 总平面、坐标、POI，只读 |
  | `src/garden/helpers.js` | lead | 建筑/园林通用生成器，只读 |
  | `src/garden/terrain.js` | lead | 地形/水系/道路/园墙，只读 |
  | `src/garden/flora.js` | **flora** | 植物与山石生成器 |
  | `src/garden/scenes/axis.js` | lead | 中轴：正门、翠嶂、沁芳亭桥、牌坊、正殿、大观楼、配楼 |
  | `src/garden/scenes/west.js` | **arch-west** | 潇湘馆、稻香村、芦雪庵、红香圃、柳叶渚、蜂腰桥、园西小景 |
  | `src/garden/scenes/east.js` | **arch-east** | 怡红院、秋爽斋、暖香坞、滴翠亭 |
  | `src/garden/scenes/north.js` | **arch-north** | 蘅芜苑、栊翠庵、凸碧山庄、凹晶溪馆、花溆、沁芳闸 |
  | `src/garden/scenes/water.js` | **arch-water** | 藕香榭、紫菱洲/缀锦楼、荇叶渚、棠木舫、曲桥/竹桥 |
  | `src/ui/*`、`src/styles.css` | **ui** | 界面、HUD、移动端、信息卡、小地图 |
  | `src/data/*` | lead | POI 文案、原文引文 |
  | `src/main.js`、`scripts/*`、`tools/*` | lead | 入口与工具 |
- **禁止**：`git` 操作、`npm install`、改动他人文件、删除文件、修改 `package.json`。
- 完成后用 `send_message` 报告：改了哪些文件、自测截图路径、遗留问题。

## 1. 坐标系与尺度

- 体素世界尺寸 `320 × 96 × 320`；x 东(+)/西(-)，z 南(+)/北(-)，y 上。园心为原点，园墙 `x,z = ±148`。
- **1 体素 ≈ 1 米**（为体素风格略作夸张）。地面法：普通地面顶层实体 `y = 3`；台地见 `layout.ELEV`/`PADS`。
- 建筑惯例：`y` 参数 = **建筑台基第一层实体的 y**，通常取 `ctx.groundTop(x,z) + 1`（即地面顶层之上）。`H.hall()` 内部从 `y` 向上叠台基、柱、墙、屋顶。
- 水面 `WATER_LEVEL = 2.6`；岸顶一般 `y=3`。**不要在 `isWater` 的格子上放置建筑或树**（桥、水榭、汀步除外）。
- 坐标参考（`layout.ZONES`，详见文件）：
  - 中轴：正门 (0,140) → 翠嶂 (0,122) → 沁芳亭桥 (0,55) → 牌坊 (0,-100) → 正殿 (0,-118) → 大观楼 (0,-136)。
  - 怡红院 (58,32)；潇湘馆 (-100,42)；稻香村 (-110,-80)；蘅芜苑 (40,-104)；栊翠庵 (96,-128)；秋爽斋 (92,-24)；暖香坞 (60,-78)；藕香榭 (-20,-60)；紫菱洲 (8,-28)；芦雪庵 (-70,-92)；凸碧山庄 (118,-96)；凹晶溪馆 (90,-82)；花溆 (18,-92)；沁芳闸 (128,-132)；红香圃 (-104,-36)。
- 全园「沁芳溪」连通：东北沁芳闸 → 东北山坳 → 花溆 → 沁芳池（含洲渚）→ 滴翠亭 → 沁芳亭桥 → 东南墙下出水口。

## 2. 场景生成器契约（scenes/*.js）

```js
export function buildEast(ctx) { /* 使用 ctx.w / ctx.H / ctx.F / ctx.L / ctx.R 生成体素 */ }
```
`ctx` 提供：
- `ctx.w` — 体素世界（见 §3）
- `ctx.H` — 建筑 helpers（见 §4）
- `ctx.F` — 植物 helpers（见 §5）
- `ctx.L` — `src/garden/layout.js` 的全部导出（`ZONES/ZONES.yihong/ELEV/...`）
- `ctx.R` — 确定性随机：`ctx.R()` → [0,1)；`ctx.R.int(a,b)`、`ctx.R.pick(arr)`、`ctx.R.chance(p)`
- `ctx.groundTop(x,z)` — 该列地形顶面 y（地形已建好）
- `ctx.isWater(x,z)` — 是否水面网格
- `ctx.isPath(x,z)`
- `ctx.reserve(x1,z1,x2,z2)` — 声明「建筑/铺装保留区」，供植物散布避让；**院落场景必须调用**（院墙外扩 2 格）
- `ctx.pad(name)` — 取 `layout.PADS` 中的 pad（已铺平）
- `ctx.decals` — 非体素贴片（匾额、楹联、酒旗、碑刻）数组；`ctx.H.plaque()` 会自动 push
- `ctx.mark(name, x, y, z)` — 可选，登记景点坐标用于标签
- `ctx.Z(name)` — 取 `layout.ZONES[name]`
- `ctx.log(...)` — 构建日志（仅 dev）

**规则**：
1. 只写自己文件；需要新的通用能力 → message lead，不要复制别人的 helper。
2. 场景生成器必须可在任意调用顺序下工作（只依赖地形与 layout）。
3. 结构必须有合理落脚：台基高出地面 0–2 格，**禁止悬空**；墙脚贴地/贴台基。
4. 屋顶覆盖建筑，出檐 2–3 格，檐口有瓦当色；不要出现大面积平顶（庭廊除外）。
5. 门窗要有可辨识的棂格/板门，开间划分清晰。各院要有院墙与院门。
6. 植物由 `ctx.F` 生成，不要手搓树；种植密度要自然，避开水、路、建筑（用 `ctx.isWater`/`ctx.groundTop`/自身 reserve）。
7. 性能：单场景新增体素宜 < 120k（整园目标 < 1.2M），避免逐格随机噪声导致合并率下降。
8. 视觉审查标准：远景有层次、近景有细节、色不过艳、屋面有瓦垄/脊、檐口有飞檐。

## 3. 世界 API（`ctx.w`，只读用于场景）

```js
w.get(x,y,z) -> 颜色索引(0=空气)   w.solid(x,y,z) -> bool
w.set(x,y,z,colorIndex)             w.setIfEmpty(x,y,z,c)
w.fill(x1,y1,z1,x2,y2,z2,c)         w.fillEmpty(...)
w.boxShell(...)                     w.column(x,z,y0,y1,c)
w.clear(x1,y1,z1,x2,y2,z2)
w.topY(x,z) -> 最高实体 y
```
颜色一律用 `C` 常量（`import { C, GROUPS } from '../core/palette.js'`；场景里拿 `ctx.C` 亦可，main 会挂上）。常用：`C.whitewall, C.roof, C.roofDark, C.ridge, C.redPillar, C.greenPillar, C.gold, C.glaze, C.glazeGreen, C.wood, C.woodDark, C.stone, C.marble, C.path, C.grass, C.leaf*, C.bambooLeaf*, C.waterBed, C.plaqueBoard, C.goldText`。
`GROUPS.leaf/GROUPS.bamboo/GROUPS.roof/...` 是近似色组数组，可用于瓦垄/植被微差。

## 4. 建筑 helpers（`ctx.H`，`src/garden/helpers.js`）

> 全部返回 `{x1,z1,x2,z2,top}`（可忽略）；坐标均为体素整数。**颜色参数用 `C.xxx` 索引**。

```js
H.box(x1,y1,z1,x2,y2,z2,c)
H.plinth({x,z,w,d,y,h=1,c=C.stone,top=C.marble,step:6,stepTo:'south'})  // 台基+踏跺
H.column(x,z,y,h,c=C.redPillar)
H.wall({x1,z1,x2,z2,y,h,th=1,c=C.whitewall,cap})        // 直线墙（轴对齐）
H.wallRect({x1,z1,x2,z2,y,h,th,c, gates:[{side:'south',at:0,w:6}], windows:true})
H.moonGate({x,z,axis:'x'|'z',y,r=3,c})                    // 在已有墙上开月洞门
H.latticeWindow({x,y,z,axis:'x'|'z',w,h,cFrame,cLattice}) // 花窗/窗棂
H.door({x,y,z,axis,w,h,c=C.woodRed,studs:true})          // 板门
H.railing({x1,z1,x2,z2,y,c=C.redRail,h=2,style:'stone'|'wood'|'bamboo'})
H.roof({x1,z1,x2,z2,y,h=6,type:'xieshan'|'hip'|'gable'|'pyramid'|'gableRound',tile:C.roof,ridge:C.ridge,overhang=2,upturn=2}) // 返回正脊 y
H.hall({x,z,bays=5,bayW=6,depth=16,y,roof:'xieshan',tile,columns,wall,door,porch:0,plaque:{text},couplets:[left,right],stepDir:'south'}) // 厅堂复合体
H.pavilion({x,z,size=10,y,shape:'square'|'hex',roof:'pyramid',tile,rail:'美人靠',plaque}) // 亭
H.corridor({pts:[[x,z],...],y,w=3,rail,roofC,columnsC})   // 折线游廊（含柱、座凳、屋顶）
H.bridge({x,z,len,wid,dir:'x'|'z',type:'stone3'|'stone1'|'wood'|'bamboo',y,rail}) // 桥
H.archway({x,z,dir:'x'|'z',bays=1,h=12,c=C.marble,plaque}) // 牌坊/石坊
H.fence({pts,w=2,h=3,c=C.bambooLeaf})                     // 竹篱/木栅
H.plaque({x,y,z,dir:'south'|'north'|'east'|'west',text,w=8,h=3,board=C.plaqueBoard,textC=C.goldText}) // 匾额（贴片）
H.couplet({x,y,z,dir,text,w=2,h=9})                       // 楹联
H.banner({x,y,z,h=10,text='杏帘在望'})                     // 酒旗
H.lantern({x,y,z,h=3,red=false})                          // 灯笼（自发光）
H.tableSet({x,z,y,size=3})                                // 石桌石凳
H.rock({x,z,y,w=6,h=5,seed})                              // 单组山石
H.rockery({x1,z1,x2,z2,h=10,passage:[{x,z},{x,z}]|null,cave:bool,seed}) // 大型假山/石洞
H.bambooFence / H.flowerWindow / H.stoneRail …（实现时补充）
```

**屋面形制要点**（`H.roof` 内部实现）：
- 灰瓦民居：歇山/硬山/卷棚；皇家省亲别墅：金琉璃 `C.glaze`（正殿、大观楼），配楼绿琉璃 `C.glazeGreen`。
- 出檐 2–3、四角起翘 1–2（飞檐），檐口一层瓦当色；正脊 1–2 层，两端可起翘。
- 瓦垄：屋面沿坡向隔行 `roofDark`/`roofLight` 微差。
- 檐下：一圈 `C.teal`/`C.blue`+`C.gold` 彩画带（斗拱意象）。

## 5. 植物/山石 helpers（`ctx.F`，`src/garden/flora.js`，由 flora 实现）

```js
F.pine(x,z,{h=16,r=5})        F.willow(x,z,{h=14})       F.apricot(x,z,{h=10,bloom=true})
F.peach(x,z)                  F.plum(x,z,{red=true})     F.pear(x,z)
F.bamboo(x,z,{count=9,h=10})  F.crabapple(x,z)           F.banana(x,z)
F.wutong(x,z)                 F.elm(x,z)  F.locust(x,z)  F.mulberry(x,z) F.ginkgo(x,z)
F.shrub(x,z,{r=3,c})          F.grassTuft(x,z)           F.flowerPatch(x1,z1,x2,z2,{colors,count})
F.reedBed(x1,z1,x2,z2,{count})// 芦苇（可贴水边）
F.lotus(cx,cz,rx,rz,{count})  // 荷叶荷花（置于水面 y=3）
F.peonyBed(x1,z1,x2,z2,{count,colors}) // 芍药/牡丹圃
F.vine({x1,z1,x2,z2,y,topC,leafC})     // 藤萝架/蔷薇架
F.rockCluster(x,z,{w,h,seed})          // 太湖石/山石小景
F.moss(x1,z1,x2,z2)                    // 苔藓地面点缀
```
所有函数内部用 `ctx.isWater` / `ctx.groundTop` / `ctx.R`，先判断可放置；允许自行做 2–3 格微偏移。返回值无要求。
> 植物是「清晰精致」的关键：树冠要有层次（3–4 层、球形渐变），枝干可见；竹要成丛；柳要垂枝；花树要满冠繁花。

## 6. 贴片（匾额/楹联）与 decals

- `H.plaque/couplet/banner` 会把贴片数据 push 到 `ctx.decals`；主程序统一生成 CanvasTexture 平面（正反可读）。
- 贴片尺寸要求：匾额宽 6–10 格、高 2–3 格；楹联竖排高 8–10 格。位置须贴在建筑檐下/牌坊明间，**不要悬空**。
- `dir` 表示文字面向：`'south'` = 面向 +z 方向（观众从南面看）。

## 7. 构建、预览、截图

```bash
node scripts/build.mjs --dev                  # 生成 index.html + dist/index.html（唯一共享产物，勿并发）
node tools/preview.mjs --name=east --views=yihong-overview --width=1280 --height=720
#   ↑ 推荐成员使用：输出到 ref/preview/<name>.html 与 ref/shots/<name>-<view>.png，不覆盖共享产物
```
- 视角参数：`?view=x,y,z,tx,ty,tz` 直接指定相机；`view=poi:yihong` 用 `layout.POIS` 推荐视角；`view=top` 全园俯视；`view=overview` 全园东南向。
- 截图工具使用本机 Chrome + SwiftShader（软件渲染，帧率无参考意义；三角面数/quad 数有意义）。
- **每次改完都要自测截图并检查**：`window.GVG.stats()` 输出 `{tris, calls, voxels}`；控制台不能有报错。

## 8. UI 契约（ui 成员）

- 入口：`src/ui/ui.js` 导出 `initUI(app)`；`app` 即 `window.GVG.app`（main 挂载）。
- 可用数据：`window.GVG.pois`（景点数组，字段：`id,name,group,x,z,y,look,theta,phi,radius,desc,quote,source,plaque,couplets,poem,tags`）、`window.GVG.layout`、`window.GVG.minimapImage`（320×320 平面底图 dataURL）、`window.GVG.stats()`。
- `app` API：`goTo(id, opts)`、`setTod('dawn'|'day'|'dusk'|'night')`、`toggleTour()`、`toggleLabels()`、`setCamera`、`hideUI(bool)`、`isMobile`、`ready` 事件回调 `app.on('ready',fn)`、`app.on('poi',fn)`、`app.on('progress',fn)`。
- 样式统一写 `src/styles.css`（已有初稿，可重构）；`src/ui/ui.html` 可留空，一切由 JS 生成；`#boot` 启动页由 ui 负责隐藏（`app.on('ready')`）。
- 移动端断点 820px，安全区 `env(safe-area-inset-*)`，触控目标 ≥ 36px；PC 键盘快捷键 1–4 时段、T 漫游、L 标签、Esc 关闭信息卡、H 隐藏界面。

## 9. 自测清单（提交前）

- [ ] `node tools/preview.mjs --name=<你> --views=...` 无 console error
- [ ] 截图里建筑不悬空、不穿地、不互相穿插；屋顶出檐合理
- [ ] 场景与 `layout.ZONES` 坐标一致，不越界到别人区域（允许路径/植物延伸但建筑须在 zone 内）
- [ ] 水面清晰可见，桥/水榭与水面衔接
- [ ] 视角：低空人视、半空俯瞰各一张
- [ ] 报告：截图路径 + 体素/quad 数 + 问题
