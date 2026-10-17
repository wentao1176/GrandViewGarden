# Phase 2 · 高精细升级契约（HD Upgrade API）

> 目标：在保持"体素园林"整体风格与既有布局/考据不变的前提下，把 **方正的大方块感** 降到最低、让水面与植物动态细腻、让建筑更高大且可步行入内。
> 本阶段不重写 1m 体素基底（性能/工作量原因），而是叠加四层"精细度"：
> 1) **程序化材质着色器**（瓦垄/粉墙/石材/木纹/倒角高光，细到 5–20cm 的视觉纹理）；
> 2) **精细构造网格**（屋面檐口/脊兽/瓦当/圆柱/门窗棂/栏杆/家具陈设，0.05–0.3m 尺度）；
> 3) **实例化细密植被**（叶片卡、竹叶、柳条、荷、苇、草花，全部随风摆动）；
> 4) **精细动态水面**（流向、波纹、岸边泡沫、跌水水花、天光反射、锦鲤）。
> 另有 **步行模式**（第一人称、碰撞、开门、室内游览、移动摇杆）。

## 0. 全局约定

- 工作目录 `D:\大观园`；坐标与既有 `docs/engine-api.md` 完全一致：x 东、z 南、y 上；1 体素≈1m；地面顶层 y=3；水面 y=3.35；建筑台基者见 `layout.ELEV`。
- **禁止**：`git` 操作、`npm install`、修改他人文件、修改 `package.json`、用 PowerShell 写含中文源码（只用 write/edit 工具）。
- 色彩一律从 `src/core/palette.js` 的 `PALETTE/C/PALETTE[i].hex` 取，保持与体素世界同一套色板。
- 所有新建网格必须 **flat-shaded、顶点着色**，不用受光材质（场景无灯光），面法线决定明暗（`MeshBasicMaterial({vertexColors:true, toneMapped:false, fog:true})` 或等价自定义 shader）。
- 面数/绘制调用预算见 §8。所有动画只更新 uniform / 矩阵，**不得每帧新建几何或材质**。
- 集成由 Lead 负责：你们交付模块 + 自测脚本/截图；Lead 负责在 `renderer/main/helpers` 中接线。

## 1. ctx 扩展（Lead 提供，供 flora/ornaments 使用）

`buildGarden()` 的 `ctx` 新增（会在本阶段加入；代码按此写）：
```js
ctx.postBuild = [];   // push(fn) —— 全部场景/植被生成完成后调用，fn(ctx) 返回 THREE.Object3D 或数组
ctx.animators = [];   // push(fn) —— 每帧调用 fn(elapsedSeconds, dt)
ctx.details = {       // 精细构造规格收集器（ornaments 消费）
  roofs: [], columns: [], lattices: [], railings: [], doors: [],
  furniture: [], lanterns: [], banners: [], misc: [],
};
ctx.isMobile = false; // 运行环境
ctx.quality = 'high'; // 'high' | 'mid' | 'low'
```
World 新增隐藏体素（用于"网格替代体素"）：
```js
world.hide(x, y, z)     // 该体素不再进入体素网格（视为空气用于面剔除/AO），但保留碰撞语义
world.isHidden(x, y, z)
```
> 需要"用精细网格替换某块体素"时：先 `world.hide(...)`，再把网格加入 `ctx.postBuild`。**不要**自己改 mesher/renderer。
> 若需要额外碰撞/门通行：把门格坐标 push 到 `ctx.details.doors[i].cells`（Lead 的步行控制器使用）。

## 2. `src/garden/ornaments.js`（ornament 成员独立文件）

导出：
```js
export function buildDetails(ctx) -> THREE.Group   // 读 ctx.details.*，合并成尽量少的静态 Mesh + 少量动态门/灯笼
export function addBox(buf, x, y, z, w, h, d, color, opts) // 可选公共工具（面着色/顶点色）
```
此外提供以下**纯函数资产**（供 Lead 在 helpers 中按需直接调用，也供 buildDetails 内部使用）：
```js
makeRoofOrnaments(spec) -> Object3D[]   // 檐口封檐板/瓦当/飞檐角梁/正脊/鸱吻/垂脊
makeColumn(spec)        -> Object3D     // 圆柱/柱础/柱头/斗拱简化
makeLattice(spec)       -> Object3D     // 门窗棂（步步锦/冰裂纹/回纹/直棂）
makeRailing(spec)       -> Object3D     // 望柱+扶手+栏板（木/竹/石）
makeDoor(spec)          -> { group, leaf }  // group 含铰链 pivot：leaf 绕 Y 轴旋转实现开合
makeFurniture(spec)     -> Object3D[]   // 家具/陈设（见 §3）
makeLantern(spec)       -> Object3D
makeBanner(spec)        -> Object3D
```
要求：
- 静态几何按材质色合并为 **1~4 个 Mesh**（顶点色 + 深/浅面着色即可），不要把每件家具做成独立 Mesh（draw call 爆炸）。动态物体（门、灯笼摆锤）才单独节点。
- 家具/栏杆/门窗的构件尺度：0.05–0.3m；圆柱用 8–12 边；檐口/脊用细长条几何；总面数预算见 §8。
- 风格与体素一致：硬边、扁平色块、不要写实 PBR 贴图。可加 1–2 个 CanvasTexture 字画/砖雕，但必须内联生成、无外部资源。
- 每个 spec 的尺寸单位都是米，坐标是园内世界坐标；朝向：`rotY` 弧度，0=面向南(+z)。
- 自测：可写 `ref/orn-lab/` 独立 HTML（esbuild 构建 + puppeteer 截图，**不要**改 src 其它文件），截几张近景确认造型、面数、比例。

## 3. 精细构造规格（Lead 的 helpers 会 push，ornaments 消费）

```js
// 屋面（H.roof 内部 push）
ctx.details.roofs.push({ x1,x2,z1,z2, eaveY, ridgeY, type:'xieshan'|'hip'|'gable'|'pyramid'|'gableRound',
  tile: colorIdx, edge: colorIdx, ridge: colorIdx, upturn:1, style:'residential'|'imperial' });

// 柱（H.hall/H.pavilion/H.corridor 的每根柱）
ctx.details.columns.push({ x, z, y, h, r:0.22, color: colorIdx, base: colorIdx, cap: colorIdx, style:'wood' });

// 门窗棂（H.latticeWindow / hall 窗）
ctx.details.lattices.push({ x,y,z, axis:'x'|'z', w,h, frame: colorIdx, lattice: colorIdx, style:'step'|'ice'|'hui'|'straight' });

// 栏杆（H.railing 每次调用）
ctx.details.railings.push({ pts:[[x,z],...], y, style:'wood'|'stone'|'bamboo', color: colorIdx });

// 门（H.door 内部；同时 world.hide 门扇体素）
ctx.details.doors.push({ x,y,z, axis:'x'|'z', w,h, leafColor, hinge:'left'|'right', openTowards:1|-1,
  cells: [[x,y,z], ...]   // 供步行碰撞判断
});

// 室内家具（H.hall 自动生成 + 场景显式调用 H.furnish 产生）
ctx.details.furniture.push({ kind:'screen'|'altar'|'chair'|'table'|'squareTable'|'desk'|'bed'|'bookshelf'|
  'painting'|'scroll'|'vase'|'incense'|'rug'|'curtain'|'pottedPlant'|'qin'|'teaset'|'lamp',
  x,y,z, rotY, ...params });

// 灯笼/匾额/帷幔
ctx.details.lanterns.push({ x,y,z, style:'red'|'warm'|'paper', hang:0.6, r:0.35 });
ctx.details.banners.push({ x,y,z, w,h, text, dir });
```
Lead 会在 `H.roof/H.hall/H.pavilion/H.corridor/H.bridge/H.wallRect/H.railing/H.door/H.latticeWindow` 中按上述规格 push；ornaments 只需按规格生成。

## 4. `src/core/water.js`（water 成员独立文件）

```js
export class WaterSystem {
  constructor(opts)  // { scene, layout, mask:Uint8Array(320*320), level, quality }
  build()            // 建水几何并 add 到 scene；内部管理粒子/材质
  update(time, dt)   // 波纹/流向/泡沫/锦鲤/水花
  setTimeOfDay(todName, sunDir)  // 与现有 TOD 同步（晨/昼/暮/夜水色）
  dispose()
  stats() -> { quads, instances, calls }
}
```
`mask[(x+160)+(z+160)*320]=1` 表示水面格；世界外圈坐标 x,z∈[-160,160)。流向从 `layout.STREAMS` 折线与 `layout.PONDS` 推导（可自写距离场）。
必须实现效果：
1) 细密流动波纹（流向明显、速度沿程变化、汇流处撕裂纹理）；
2) 岸边泡沫（浅水/岸边细白沫，周期性涌动）、**沁芳闸跌水**（坐标约 128,-132）与 **花溆石洞/石港**（约 16,-92）处水花/白色水帘/水雾粒子；
3) 天光/天空反射（相机视角菲涅耳 + 太阳高光 + 远处水色渐变）；
4) 半透明与水深感（浅水偏青、深水偏靛，水下河床透出）；
5) 荷叶/落花漂移可留给 flora，但水面需有细小漂浮物/光斑细节；
6) 锦鲤 8–15 条在沁芳池与藕香池水面下游动（半透明小鱼影即可）。
性能：水面尽量 1–3 个 draw call，粒子用 Points/InstancedMesh；移动端减半粒子。
自测：`ref/water-lab/` 独立页面（只用 WaterSystem + 简单相机）截图验证 shader；接线后 Lead 会跑全园视角，你再调。
> 现有 renderer 里的旧水面（`WATER_FRAG`）由 Lead 删除并替换为你的模块；不要直接改 renderer.js。

## 5. `src/garden/flora.js`（flora 成员重写）

保持 `createFlora(ctx)` 的既有函数签名（tree/pine/willow/apricot/peach/plum/pear/bamboo/crabapple/banana/wutong/elm/locust/mulberry/ginkgo/shrub/grassTuft/flowerPatch/reedBed/lotus/peonyBed/vine/rockCluster/moss/scatterGarden）。新要求：
- **不再写大方块树冠**：树干/主枝可用精细网格；叶子用实例化叶片卡/小几何（单叶 5–20cm 视觉尺寸），带 **风摆顶点着色器**（共享 uniform time；按高度与相位摆动，叶片轻颤、柳条大摆、竹叶簌簌）。
- 花树（海棠/杏/桃/梨/梅）要有细碎花团与花瓣；松树针叶层片；竹竿细长有节、竹叶簇；芭蕉大叶；垂柳长垂条。
- 荷花/荷叶/芦苇/芍药/草花/蒲草：实例化小网格，轻轻摆动；水面只放荷/浮萍/荇。
- 地面微细节：`grassTuft`/`flowerPatch` 改为细草叶/小花实例（近景可见），不要体素方块。
- 用 `ctx.postBuild` 添加 THREE 对象、`ctx.animators` 驱动；树尽量少体素（trunk 可用体素但不是必须）。
- 风摆大组：可用同一 ShaderMaterial + 每实例相位属性；叶片卡用程序化 CanvasTexture（内联，无外部图）。
- 性能：桌面 ≤12 万叶片实例 / ≤16 draw call；移动端（ctx.isMobile 或 quality!=='high'）减半；不使用 shadows；不可见远处可用距离剔除或低密度。
- 保留确定性、避让水面/道路/reserve、幂等 scatterGarden（原有要求不变）。
- 自测：用 `ref/flora2-lab/` 独立页面或等 Lead 接线后 `tools/preview.mjs --name=flora2 --clean --views="overview;poi:xiaoxiang;poi:daoxiang"` 截图迭代。

## 6. 步行模式（Lead 实现，UI 成员对接）

引擎侧 `window.GVG.app` 新增 API（Lead 负责实现；UI 按此开发）：
```js
app.setMode('orbit'|'walk') -> mode
app.getMode() -> 'orbit'|'walk'
app.on('mode', ({mode}) => {})
app.setWalkMove(x, z, sprint)      // x/z ∈ [-1,1]，UI 摇杆/键盘调用（每帧或变化时）
app.setWalkLook(dx, dy)            // 视角增量（像素），UI 触摸拖拽调用
app.walkJump()
app.walkInteract()                  // 交互（开门/登楼/离开）
app.on('walk', ({pos:[x,y,z], yaw, pitch, footstep, hint, nearPoi}) => {}) // ~10Hz
app.on('interact', ({type,label,key}) => {}) // 进入提示
```
步行规格：
- 眼高 1.65m；移动 2.6 m/s、跑 5.2 m/s；重力 + 台阶自动抬升 ≤1.1m；不可进入水面（桥/汀步除外）；碰撞 AABB 0.35m。
- 门可自动/交互打开（动画 ~0.6s），打开后可通过；建筑室内可自由行走；提供"回到游览"。
- 点击 POI（UI）时，步行模式下直接传送到该景点的步行落点（Lead 在 layout.POIS 增加 `walk:[x,z,yaw]`）。
- UI 要求：
  - Dock 增加「步行/游览」切换；步行时显示准星、左下虚拟摇杆（移动端）、疾跑/跳跃/退出按钮（移动端）、操作提示（PC 显示 WASD/Shift/Space/E/Esc 等）；
  - 右上显示当前景点/室内提示；移动端小地图可点击传送（步行状态下）。
  - 帮助弹层更新操作说明；快捷键 `V` 切换步行、`Esc` 退出步行、`E` 交互、`Shift` 疾跑、`Space` 跳跃（PC）。
  - 所有新控件 ≥36px、无障碍名称、无外部资源；与现有 UI 风格一致（墨绿+金+宋体）。
  - 自测：可先用 mock app 写 UI；集成后跑 `tools/preview.mjs` 与 Lead 的步行 E2E 脚本。

## 7. 建筑增高与可入内（场景成员后续任务）

Lead 完成 H.* 升级后通知；届时各场景负责人：
- 主体建筑（正房/殿/楼/庵/亭）檐高/脊高整体约 **×1.25–1.4**，保证比例与原有院墙/游廊衔接；
- 确认门可达（台阶到门前）、门为 H.door（自动生成可开门+精细门扇）；
- 主要厅堂用 H.hall（自动室内陈设）或显式调用 H.furnish；室内铺地/顶棚/屏风/桌椅/书画/灯烛齐备；
- 检查加高后匾额/楹联/窗的位置不穿模；
- 重新 reserve/POI 视线；不要改他人文件。
（详细清单由 Lead 在阶段通知里给出。）

## 8. 性能预算（硬指标）

| 指标 | 桌面 high | 移动 mid |
|---|---|---|
| draw calls | ≤ 180 | ≤ 120 |
| triangles | ≤ 2.2M | ≤ 1.1M |
| 叶片实例 | ≤ 120k | ≤ 60k |
| 草/花实例 | ≤ 60k | ≤ 30k |
| 水面粒子 | ≤ 2000 | ≤ 800 |
| 单帧 JS 动画开销 | ≤ 4ms | ≤ 6ms |
| 首屏构建 | ≤ 5s | ≤ 8s |

- 大量静态细节必须 **merge/instancing**；动态物体（门、灯笼）数量少。
- 不得引入外部字体/图片/网络请求。
- `tools/preview.mjs`/`tools/qa.mjs` 截图与 stats 必须无 console error。

## 9. 文件所有权（本阶段）

| 文件/目录 | 所有者 |
|---|---|
| `src/garden/flora.js`、`src/garden/foliage.js` | **flora2** |
| `src/core/water.js`、`src/core/water-shader.js` | **water** |
| `src/garden/ornaments.js` | **ornament** |
| `src/ui/*`、`src/styles.css` | **ui** |
| `src/core/{world,mesher,renderer,controls,palette,decals}.js`、`src/main.js`、`src/garden/{helpers,terrain,index,layout}.js`、`src/garden/scenes/axis.js` | **lead** |
| `src/garden/scenes/{east,west,north,water}.js` | 各 arch 成员（阶段通知后动） |
| `docs/*`、`tools/*`、`README.md` | lead |

## 10. 交付与自测

- 模块自查：语法/构建通过；独立 lab 截图；性能数据；
- 完成后 `send_message` 给 lead：文件、关键实现、截图路径、性能估算、遗留问题。
- Lead 接线后统一跑全量 QA（桌面/移动/晨昏夜/步行入内），并做最终视觉审查后推送。
