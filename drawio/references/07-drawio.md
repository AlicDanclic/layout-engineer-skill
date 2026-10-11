# 07 · draw.io 系统架构图（drawio 序列化目标）

本文件把「draw.io 系统架构图设计师」的规范接进 layout-engineer。**核心改动只有一句：**
架构图不是画出来的，是算出来的——`.drawio` 是 Layout Tree 的又一个序列化目标。

```
variables/tokens.ts（中国色 + 文字度量）
      │
variables/layout.ts（版面尺寸）
      │
src/layout/index.ts（纯函数：节点框 + 锚点 + 途经点）
      │
layout-tree/<view>.json（elements[] + edges[] + expr）
      ├─ serializers/drawio.mjs  ──> drawio/<view>.drawio（零几何计算）
      ├─ serializers/drawio_png.py（解析上面那份 XML）──> drawio/<view>.png
      └─ validate/check-drawio.mjs（把第七节清单机器化）
```

---

## 一、角色定位与三条保证

draw.io 规范里的三条要求，在本 Skill 里的落地方式是：

| drawio 规范要求 | 本 Skill 的实现 |
|---|---|
| 可直接导入 draw.io 编辑的标准 `.drawio` | `drawio.mjs` 产出合法 mxfile/mxGraphModel/mxCell |
| 「XML 与 PNG 严格一致」 | **PNG 由 XML 解析渲染**，不是第二条渲染路径 |
| 所有节点给出明确几何坐标、禁止自动路由 | 坐标与途经点全部来自 Layout Tree，序列化器只做字段映射 |
| 配色不得自行换色 | 中国色写进 `tokens.ts`，随 `variableSnapshot` 归档，渲染器只读快照 |

---

## 二、何时使用 / 不适用

- ✅ 从零画一张系统架构图（CLI / GUI / 硬件 / 软硬协同）。
- ✅ 优化已有 `.drawio`：先把它还原成 Layout Tree（见「第五节 · 模式 B」），再走修改回路。
- ✅ 要一张「图上的 88px 与 XML 里的 88px 是同一个数字」且可被脚本验证的架构图。
- ❌ 纯视觉美化（换主题色、加阴影）而不动结构——那只需改 token，不必重画。
- ❌ 一次性截图说明（不需要复现与归档）。

---

## 三、四种视图，以及「视图范围必须先问用户」

| 视图 | `--view` | 内容 |
|---|---|---|
| 软件 CLI 架构 | `cli` | 入口 → 参数解析 → 子命令分发 → 执行 → 输出全链路 |
| 软件 GUI 架构 | `gui` | MVVM 分层：View → Binding → ViewModel → Service → Model → 数据访问 |
| 硬件架构 | `hardware` | 以主控 SoC 为核心：供电树、时钟树、存储、总线接口、采集/执行链路、调试口 |
| 软硬协同架构 | `hwsync` | 应用 → 中间件/OS → 驱动 → HAL/BSP → 硬件的垂直调用栈 + 中断/DMA 回路 |

**视图范围属于确认节点 A 的一部分：AI 不得自行假定要出几张图，必须先问用户。**

> 单画布项目的定位确认以**画布名**为键落盘：`manifest.confirmations.positioning["hwsync"] === true`。
> `desktop` / `mobile` 只是两个特例，聚合视图不再只认这两个名字。

```bash
# 用户确认要哪几个视图后，逐个建项目（一个视图 = 一个项目 = 一个 .drawio + 一张 PNG）
node scripts/new-project.mjs --name arch-cli      --kind drawio --view cli      --out output/arch
node scripts/new-project.mjs --name arch-hwsync   --kind drawio --view hwsync   --out output/arch
```

为什么一个视图 = 一个项目：

- drawio 规范本来就要求「每张图输出一个独立 `.drawio` 文件」；
- 每张图有自己的 `layout-tree/`、自己的 `treeHash`、自己的确认记录——改硬件视图不会作废 GUI 视图的确认；
- 不需要把 `canvas.breakpoint` 撑成多页模型，`mobile|desktop` 之外再出现 `cli|gui|hardware|hwsync` 只是**画布标识**，不是响应式档位。

---

## 四、数据模型（本 Skill 为架构图新增的部分）

### 4.1 `layout.config.json`

```json
{ "kind": "drawio", "breakpoints": ["hwsync"] }
```

- `build-tree.mjs` 读它决定构建哪几张画布。普通页面项目没有这个文件，缺省仍是 `desktop + mobile`。
- `kind: "drawio"` 让 `check-drawio` 与 `--target drawio` 知道「本项目该不该做架构图检查」。

### 4.2 节点上的语义字段（全部非几何，不进哈希）

| 字段 | 取值 | 作用 |
|---|---|---|
| `kind` | `title` / `layer` / `app` / `framework` / `hardware` / `storage` / `bus` / `control` / `legend` / `legendItem` / `edgeLabel` / `edgeData` / `edgeControl` / `edgePower` / `icon` / `plain` | 决定配色与形状 |
| `shape` | `rounded` / `rect` / `cylinder` / `process` / `hexagon` / `parallelogram` / `ellipse` / `bar` | 形状覆盖 |
| `tone` | `normal` / `focus` | `focus` 用于**重点层**（HAL/BSP 软硬件分界）：靛蓝边框 + 月白底色 |
| `accent` | 语义名（如 `entry` / `compute` / `contract` / `draw` / `artifact`） | **分层色相**：层容器与其卡片的描边/填充改读 `DRAWIO_ACCENT_<大写>` token，用于区分层级；配合低饱和色板可做主「学术淡彩」风 |
| `textRotate` | `0` / `90` | 竖向长条节点（事件总线 / 事件循环）文字旋转 90° |
| `silent` | `true` | 不写文字（图例色样用） |
| `icon` | `string[]` | 技术栈图标逻辑名数组（查 `assets/icons/catalog.json`）；卡片挂图标后文字自动右移 |
| `align` | `center` / `left` | 文字对齐 |

改这些字段只换观感、不动坐标，所以**不会**让用户重新确认几何。

### 4.3 `edges[]`：连线也是布局结果

```ts
interface LayoutEdge {
  id: string;
  from: { node: string; side: "N"|"E"|"S"|"W" };
  to:   { node: string; side: "N"|"E"|"S"|"W" };
  fromPt: { x, y };  toPt: { x, y };          // 落在节点边框上的锚点
  fromPtExpr: { x, y };  toPtExpr: { x, y };  // 锚点的两段式出处
  via: { x, y }[];  viaExpr?: { x, y }[];     // 显式途经点 + 出处
  role: "data" | "control" | "power";         // 数据流 / 控制调试 / 供电
  arrow?: "forward" | "both" | "none";
  labelNode?: string;                          // 动作标签所在的节点（kind=edgeLabel）
}
```

三条硬性约定：

1. **锚点与途经点由布局纯函数算，渲染器不算。** 布局函数用
   `builder.anchor(node, side)` / `builder.route(a, aSide, b, bSide)` /
   `builder.waypoint(x, y, exprX, exprY)` 产出它们；
   渲染器只做 `edge.fromPt → exitX/exitY` 这样的字段映射。
2. **锚点必须有出处。** `anchor()` 会把上游节点的 `expr` 符号段拼成锚点的两段式，
   所以「连线端点为什么在 640」能一路回溯到 `variables/`。
3. **连线标签是节点，不是字符串。** 每条连线给一个 `kind:"edgeLabel"` 的节点，
   由 `edge.labelNode` 指过去。这样标签有几何、有 expr、参与重叠检测，
   标签底色取**背后容器的填充色**（无容器则取画布白）：视觉上等于透明，
   同时在线段上留出缺口（draw.io 只能靠不透明底色断线；纯 `none` 会让线从字中穿过）。

### 4.4 为什么所有 mxCell 都 `parent="1"`（平铺）

Layout Tree 的坐标是**绝对像素**，而 mxGraph 里子顶点的坐标是相对父顶点的。
若按树嵌套，序列化器就必须做「绝对 → 相对」的减法——那正是被禁止的几何计算。
因此层容器只作为背景矩形先输出，靠 z 序（文档顺序）实现「虚线框包住内部节点」。

---

## 四·五、技术栈图标（框架 / 编程语言 / 平台）

架构图里的框架、编程语言、平台可以挂对应图标，形式为**卡片内「左图标 + 右文字」**。
图标与几何、配色一样是**算出来的**，不是画上去的：

```
assets/icons/（素材 + catalog.json）
      │  icon: ["python","rust"]          ← 节点只存逻辑名
      ▼
builder.iconSlots(card, keys, ICON_METRICS)
      │  产出 kind:"icon" 子节点（x/y/w/h + 两段式 expr）
      ▼
drawio.mjs  → shape=image;image=data:image/svg+xml,…（内嵌 SVG）
drawio_png.py → 用 catalog 里配套 PNG（与 SVG 同一套素材）
```

四条硬性约定：

1. **`icon` 只存逻辑名**，必须存在于 [`assets/icons/catalog.json`](../assets/icons/catalog.json)；
   可用逻辑名用 `node drawio/scripts/icons/build-catalog.mjs --list` 查看（`python` `rust` `go` `react` `tauri`
   `docker` `espressif` `stmicroelectronics` `platformio` …）。
2. **图标盒由布局纯函数算**：`iconSlots(card, keys, metrics)` 产出 `kind:"icon"` 子节点，
   几何带 `expr`，因此可被 `assert-layout` / `verify-positioning` / `check-drawio` 复核；
   渲染器**不自算图标位置**。
3. **卡片声明了 `icon`，就必须有对应的 `kind:"icon"` 子节点**（由 `iconSlots()` 生成）。
   `check-drawio` 会把「有 icon 无子节点」「子节点与 icon 不匹配」判为失败。
4. **图标度量进 token**：`DRAWIO_METRICS.iconSize / iconPad / iconGap / iconTextGap`，
   其中 `iconPad / iconGap / iconTextGap` 必须落在 `SPACE` 刻度内（`assert-layout` 检查）。
   卡片文字左移量 = `iconPad + n×iconSize + (n−1)×iconGap + iconTextGap`。

示例（布局函数里）：

```ts
if (it.icon?.length) {
  card.icon = it.icon;
  card.children = iconSlots(card, it.icon, {
    size: DRAWIO_METRICS.iconSize, pad: DRAWIO_METRICS.iconPad, gap: DRAWIO_METRICS.iconGap,
    sizeName: "DRAWIO_ICON_SIZE", padName: "DRAWIO_ICON_PAD", gapName: "DRAWIO_ICON_GAP",
  });
}
```

> `.drawio` 里 SVG 图标用**百分号编码的 data URI**内嵌（而不是 base64）：
> mxGraph 的 style 以 `;` 分隔，base64 的 `;base64` 会被截断；百分号编码不含分号，
> 且是合法 data URI。无 SVG 的图标（如 TI 仅有 jpg）退化为相对路径 `icons/<file>`，
> 渲染时拷进 `<project>/drawio/icons/`。自研 PNG 通道始终用配套位图（`leIconRaster` 标注）。

---

## 五、两种任务模式

### 模式 A · 从零生成

```bash
node scripts/new-project.mjs --name arch-hwsync --kind drawio --view hwsync --out output/arch --title "..."
node layout/scripts/build-tree.mjs --project output/arch/arch-hwsync
node layout/scripts/positioning-viewer/serve.mjs --project output/arch/arch-hwsync   # 确认节点 B
node layout/scripts/validate/run-all.mjs --project output/arch/arch-hwsync
node drawio/scripts/serializers/index.mjs --project output/arch/arch-hwsync --target drawio
```

### 模式 B · 优化现有 `.drawio`

1. 解析原文件的 `<mxCell vertex>` / `<mxCell edge>`，抽出节点框、边、标签；
2. 把几何**抄进 `variables/` 与 `src/layout/index.ts`**（不是把数字写死在布局里）；
3. 走第五节流程，此时 `run-all` 会替你把原文件里的截断、压线、穿节点全部点出来；
4. 交付优化后的 `.drawio` + PNG + **修改说明**（改了什么、为什么），
   修改说明的「影响了哪些元素」直接取 `indexer --impact <变量名>` 的输出。

---

## 六、布局规则（与 `SPACE` 刻度的对应）

drawio 规范给的间距下限，在本 Skill 里全部落到 `SPACE` 刻度上：

| 规范要求 | 落地变量 | 取值 |
|---|---|---|
| 层间距 ≥ 60px | `SEC_GAP` | `SPACE.xxl = 64`；同一空隙要排多条平行连线时取 `SPACE.xxxl = 128` |
| 同层节点间距 ≥ 40px | `GAP` | `SPACE.xl = 48` |
| 节点距容器边缘 ≥ 20px | `PAD` | `SPACE.lg = 24` |
| 画布四边 ≥ 60px | `MARGIN` | `SPACE.xxl = 64`（同时是 `DRAWIO_MIN_MARGIN`） |

其余规则：

1. **自顶向下分层**，每层一个圆角虚线容器（`kind:"layer"`），层名在容器左上角（标题带高度 = `DRAWIO_LAYER_HEAD_H`）。
2. **同层节点按依赖方向排布**；长距离连线必须绕经确认无节点的空隙（层间空隙或层容器之外的走廊），
   **宁可绕行也不许横穿任何节点内部**。
3. **复杂度**：每张图 15~25 个功能节点、5~7 个分层，体现真实工程细节
   （全局上下文、事件总线、事件循环、中断控制器 NVIC、DMA、寄存器映射、供电树、时钟树…）。
   拒绝「三层三框」。
4. **连线必须可分辨**：同一空隙里的多条水平段（或走廊里的多条竖直段）各占一条独立轨道，
   不得共线重合——重合后渲染出来是**一条线**，读者无法知道那里有几条边。
   用 `builder.bandRouter()` / `channelRouter()` 分配轨道与标签槽位（见下），
   `assert-layout` 会把「不共享端点的共线重合」判为失败。
5. 画布尺寸由内容累加得出，不写死——改一处变量，画布自动跟着长。
5. `layout.config.json` 声明单画布；多余的断点一律拒绝（`buildLayout` 会报错），避免静默出一张没人要的图。

---

## 七、配色规范（中国色 · 蓝色系）

写进 `variables/tokens.ts` 的 `DRAWIO`，随快照归档为 `DRAWIO_*`：

| 用途 | 色名 | 色值 | token |
|---|---|---|---|
| 标题 / 供电线 | 花青 | `#003472` | `huaQing` |
| 数据流实线 / 重点层边框 | 靛蓝 | `#065279` | `dianLan` |
| 应用·业务节点 / 控制·调试虚线 | 宝蓝 | `#4B5CC4` | `baoLan` |
| 框架·中间件节点 / 总线 | 靛青 | `#177CB0` | `dianQing` |
| 硬件·物理节点 | 藏青 | `#2E4E7E` | `zangQing` |
| 数据·存储节点 | 石青 | `#1685A9` | `shiQing` |
| 普通层容器虚线框 | 蓝灰 | `#A1AFC9` | `lanHui` |
| 重点层底色 | 月白 | `#D6ECF0` | `yueBai` |
| 普通层底色 | 雪白 | `#F0FCFF` | `xueBai` |
| 节点文字 | 墨 | `#1F2A3D` | `mo` |
| 填充混合底 | 白 | `#FFFFFF` | `base` |

**分层色相 `DRAWIO_ACCENT`（可选，推荐）**：给每个分层一个低饱和色相，节点用 `accent: "<名>"` 引用，
渲染器按 `DRAWIO_ACCENT_<大写>` 读 token。默认一套学术淡彩：

| 语义 | 色 | 值 | token |
|---|---|---|---|
| 入口 / 编排 | 靛蓝 | `#3B5BDB` | `DRAWIO_ACCENT_ENTRY` |
| 计算 | 青绿 | `#0B7285` | `DRAWIO_ACCENT_COMPUTE` |
| 契约 / 数据 | 琥珀 | `#E8590C` | `DRAWIO_ACCENT_CONTRACT` |
| 绘制 / 渲染 | 品紫 | `#9C36B5` | `DRAWIO_ACCENT_DRAW` |
| 产物 / 归档 | 墨绿 | `#2B8A3E` | `DRAWIO_ACCENT_ARTIFACT` |

- `accent` 优先于 `kind` 配色；不设 `accent` 时回到 `kind` 色槽（向后兼容旧项目）。
- 连线标签底色会**自动匹配**其所处层/画布的填充色，换 accent 不会出现「白底补丁」。

- **节点填充色 = 对应边框色与 `base` 按 16:84 混合**（`DRAWIO_FILL_MIX = 0.16`，
  由 `drawio.mjs` 用 token 算出，不写死十六进制）。
- 重点层（如 HAL/BSP 软硬件分界层）= 靛蓝边框 + 月白底色，靠 `tone:"focus"` 表达。
- **图例可选（默认询问）**：`kind:"legend"` 容器 + 若干 `legendItem`。成图前问用户要不要；要则：
  - 只列图里**真的出现**的类别（不出现就删）；
  - 节点类色样用 `kind` +（可选）`accent` + `silent:true`；
  - **线型用线段样例**（`kind: "edgeData"|"edgeControl"|"edgePower"`，渲染器画成实线/虚线），不得用色块冒充线型。
- 色板十一档结构与 `kind` 槽位一一对应，可整体换主题但不要打乱槽位。

---

## 八、连线与文字规则

1. **实线 = 数据流 / 调用**（`role:"data"`，靛蓝）；**虚线 = 控制、回调、调试、回显**
   （`role:"control"`，宝蓝；`dashed=1`）；**供电线**（`role:"power"`，花青）。
2. 双向读写用 `arrow:"both"`；无箭头用 `arrow:"none"`。
3. 每条连线必须有**简短动作文字**（解析 / 调用 / 读写 / 中断 / 配置 / 回显 / 变更通知…），
   放在 `edgeLabel` 节点里；**盒宽必须贴合文字**：`w = textWidth(label, TYPE.note) + 2*labelPad`
   （`builder.textWidth`），不得用固定 `LABEL_W`；底色取背后容器色（视觉透明 + 断线缺口），
   不得用纯 `fillColor=none`（线会从字中穿过），也不要用与背景不同的底色（会出现白底补丁）。
4. 端点必须落在节点边框上（`anchor()` 保证，`assert-layout` 复核），方向与数据流向一致。
5. 中文字体声明 `fontFamily=Noto Sans CJK SC`；**中文按每字≈字号像素数预算宽度**
   （字号 13.5 ≈ 每字 13.5px），节点宽度必须容纳最长一行并留 ≥ `DRAWIO_LABEL_PAD`×2 余量。
6. 竖向长条节点（事件总线、事件循环）用 `textRotate: 90` 单行排布，禁止多行竖排。

### 空隙轨道分配（避免连线挤成一条线）

层间空隙与竖向走廊是架构图里最容易失控的地方。把「选轨道」和「选标签槽位」交给引擎：

```ts
import { bandRouter, channelRouter } from "../../vendor/layout-engine/builder.mjs";

// 每个层间空隙一个：tracks 条轨道沿着空隙中线对称铺开
const band2 = bandRouter({ name: "BAND2", center: BAND2_Y, tracks: 5, pitch: 16, labelSize: LABEL_W });
const r = band2.route("e-sidebar-svcsidebar", x1, x2);
// r.pos / r.expr            → 这段水平线的 y 与出处
// r.labelPos / r.labelPosExpr → 该边标签中心 x（已保证不与同空隙其它标签重叠）

// 竖向走廊用同一套语义，只是换了轴
const ch = channelRouter({ name: "CH", center: CHANNEL_X, tracks: 7, pitch: 10 });

Object.assign(snapshot, band1.snapshot(), band2.snapshot(), ch.snapshot());
```

- **区间不相交的连线可以共用一条轨道**（贪心装箱），所以轨道数按「同时重叠的连线数」算，不是按总数；
- 轨距要 ≥ `LABEL_H`，否则标签会压到相邻轨道；`labelSize` 必须放得进 `pitch × tracks`；
- 轨道或标签槽位用尽时**构造/分配会直接报错并说明该怎么做**（提高 `SEC_GAP`、加轨道、或把标签挪到竖向线段上），
  不会默默重叠。

---

## 九、自检清单与「谁在检查」

drawio 规范的人工清单，在本 Skill 里被拆成「机器判定」与「人工判定」两部分：

| 清单项 | 机器判定者 | 判据 |
|---|---|---|
| XML 可被解析 | `check-drawio` | 用**独立**的严格解析器反解，不是生成器自证 |
| 节点/连线全覆盖、XML 几何 = 树 | `check-drawio` | 逐字段比对 x/y/w/h、via、source/target、exit/entry、线型、箭头 |
| 文字截断 / 竖向溢出 | `check-drawio` | 中西文宽度预算 + 行高 × 行数 |
| 文字与节点、文字与文字不重叠 | `check-drawio` + `assert-layout` | 文字盒两两相交；层标题带不压子节点 |
| 连线不穿过节点、不压文字 | `assert-layout` | 线段 × 节点 AABB（容器、起止节点、连线标签豁免） |
| 连线可分辨（不共线重合） | `assert-layout` | 不同连线不得共线重合 >8px（同一锚点扇出豁免） |
| 端点落在边框、箭头方向 | `assert-layout` + `check-drawio` | 锚点复算 + side↔exit/entry 对照 |
| 层容器完整包裹内部节点 | `assert-layout` | 子元素越出父容器即报错 |
| 层与层不重叠 | `assert-layout` | 兄弟重叠检测 |
| 四周边距均匀 | `check-drawio` | 每个节点四边 ≥ `DRAWIO_MIN_MARGIN` |
| 颜色语义与图例一致 | `check-drawio` | 有图例时：类别必须都出现在图中、线型用线段样例（图例可选，默认询问用户） |
| 信息密度 / 可读性 | `measure.mjs`（【成图复审】） | 容器内容带占比 ≥ 50%（内容带 = 子元素包围盒，含节点之间必要间隙）、画布空白带 ≤ 96px、标签盒贴合文字、正文字号在目标缩放下可读 |
| 中文无乱码 / 豆腐块 | `check-drawio`（警告）+ `drawio_png.py`（硬阻断） | 系统没有 CJK 字体时 PNG 直接拒绝渲染 |
| 图标逻辑名存在、XML 标记一致 | `check-drawio` | 查 `catalog.json`；`leIcon` 与树 `icon` 对齐 |
| 图标在卡片内、不侵入文字区 | `check-drawio` | 图标盒 ⊆ 卡片；右边界 ≤ 卡片 x + 文字左移量 |
| 卡片声明的 icon 与子图标节点一致 | `check-drawio` | 数量与逻辑名逐一对上（否则提示用 `iconSlots()`） |
| 结构符合用户意图 | **用户**（确认节点 A / B） | 脚本判不了，只能由人点头 |

> 机器判定不了的只有最后一项：**结构对不对、这张图是不是用户要的**。

---

## 十、工作流程

```
① 需求解析 + 问用户要哪几个视图（确认节点 A 的一部分）
      ↓
② new-project --kind drawio --view <view>   → variables/ 里定版面与中国色 token
      ↓
③ src/layout/index.ts：算节点框 + 算锚点 + 算途经点（零几何字面量）
      ↓ build-tree
④ positioning-viewer 确认布局（确认节点 B，落盘 treeHash）
      ↓
⑤ run-all 八步：lint → assert → verify → check-env → indexer → check-confirmation → check-drawio → docgen
      ↓
⑥ serializers --target drawio  →  drawio/<view>.drawio + drawio/<view>.png
      ↓
⑦ 亲眼核对渲染结果（PNG）：文字/连线/层/图例/边距
      ↓
⑧ 归档：文件清单 + 分层结构表 + 关键链路表
```

交付时列出全部文件路径，并用表格概述每张图的**层级结构**与**关键链路**。

---

## 十一、禁止事项（drawio 专章）

- ❌ AI 自行决定要生成哪几个视图（必须先问用户）。
- ❌ 在 `drawio.mjs` / `drawio_png.py` 里用节点框算锚点、或用 from/to 自动找路由。
- ❌ 在渲染器里写死中国色十六进制值（必须从 `DRAWIO_*` 快照 token 读）。
- ❌ 只交 `.drawio` 不交 PNG，或 PNG 另行用别的路径渲染（会破坏「XML 与 PNG 严格一致」）。
- ❌ 用 auto layout / 不写途经点就指望 drawio 自动绕开节点。
- ❌ 连线横穿节点内部；「就调一点点」也不行，一律走空隙或走廊。
- ❌ 用多行竖排冒充竖向文字（应 `textRotate: 90`）。
- ❌ 省略图例，或图例只有标题没有色样。- ❌ 把 `layout.config.json` 的 `breakpoints` 当响应式档位用（架构图是单画布）。
- ❌ 在渲染器里根据节点框推算图标位置，或按 label 关键词自动匹配图标。
- ❌ 引用 `catalog.json` 里不存在的图标逻辑名，或声明 `icon` 却不生成 `kind:"icon"` 子节点。

---

## 十二、排错

| 症状 | 原因 | 处理 |
|---|---|---|
| `check-drawio: 文字截断风险` | 节点宽装不下最长一行 | 加宽节点或缩短文案；确认字号来自 `TYPE_*` |
| `check-drawio: 文字竖向溢出` | `行数 × 字号 × lineHeight > 高 − pad` | 加高节点或减少 `note` 行数 |
| `check-drawio: 文字盒重叠` | 两个同级节点的框相交（含连线标签） | 挪位置；连线标签之间留 ≥ 一个 `GAP` |
| `check-drawio: 距画布边距 < 64` | 内容贴边 | 调 `MARGIN` 或整体下移 |
| `assert-layout: 线段 N 横穿节点 X` | 路由穿过了中间节点 | 用 `route()` 走层间空隙，或 `waypoint()` 指定走廊 |
| `assert-layout: 连线 A 与 B 共线重合` | 两条线压在同一条带中线上 | 改用 `bandRouter()`/`channelRouter()` 分配独立轨道 |
| `bandRouter: 轨道已占满 / 标签槽位不足` | 该空隙内并行连线太多 | 提高 `tracks` 与 `SEC_GAP`（`SPACE.xxxl=128`）、或把标签挪到竖向线段上 |
| `assert-layout: fromPt 不在锚点上` | 手写了端点却没同步 side | 端点一律由 `edge()` + `anchor()` 生成 |
| `verify-positioning: 符号段无法复算` | 锚点/途经点的符号段引用了不在快照里的键 | 把该派生量写进 `variableSnapshot` |
| `verify-positioning: 符号段 ≠ 数值段` | 两段优先级不一致（`A + B / 2` vs `(A+B)/2`） | 括号补全；中点用 `midPoint()`/`midX()`/`midY()` |
| `check-drawio: 产物已过期` | 改了树没重渲染 | 重新 `--target drawio` |
| PNG 跳过 / 出豆腐块 | 缺 Pillow 或缺 CJK 字体 | 项目级 `.venv` 装 Pillow；装 `Noto Sans CJK SC` |
| 「本项目不是 drawio 项目」被跳过 | 没有 `layout.config.json` 且快照无 `DRAWIO_*` | 用 `--kind drawio` 建项目，或补 token |
| `check-drawio: 未知图标逻辑名` | `icon` 写了不存在的名字 | `node drawio/scripts/icons/build-catalog.mjs --list` 查可用名；或把素材放进 `assets/icons/` 后重跑 `build-catalog.mjs` |
| `check-drawio: 卡片声明了 icon 但子图标节点为空` | 只在数据里写了 `icon`，没调 `iconSlots()` | 用 `builder.iconSlots()` 生成 `kind:"icon"` 子节点 |
| `check-drawio: 图标侵入文字区` | 卡片太窄或图标太大/太多 | 调小 `DRAWIO_ICON_SIZE`/`DRAWIO_ICON_GAP`，或加宽卡片 |
| PNG 里图标位置与文字重叠 | `drawio_png.py` 未读到 `spacingLeft` | 确认卡片 style 带 `align=left;spacingLeft=…`（由 `drawio.mjs` 写入） |
| `.drawio` 图标不显示 | data URI 被 `;` 截断 | 确认 SVG 用百分号编码（`data:image/svg+xml,`，不含 base64 分号） |
