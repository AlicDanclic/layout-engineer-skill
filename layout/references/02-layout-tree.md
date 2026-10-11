# 02 · Layout Tree 数据规范

四种产物（前端 DOM / Remotion / 图片像素 / draw.io 架构图）坐标体系不同。如果布局计算直接写进渲染代码，会出现：布局逻辑无法复用；定位图和最终渲染容易「两套数字」；新增产物类型要重写布局。引入 Layout Tree 后，**布局只算一次，渲染只是序列化**。

## 类型定义

见 `layout/scripts/layout-engine/layout-tree.d.ts`：

```ts
interface LayoutNode {
  id: string;                 // 唯一 ID，与代码变量名、定位图编号一一对应
  label: string;              // 展示用标签，定位图上直接显示
  x: number; y: number;       // 左上角坐标（绝对像素）
  w: number; h: number;       // 宽高（绝对像素）
  expr: { x?: string; y?: string; w?: string; h?: string };  // 每个数值的出处
  depth: number;              // 相对层级，顶层 0，子节点父 +1
  children: LayoutNode[];
}

interface LayoutTree {
  canvas: { w: number; h: number; breakpoint: Breakpoint };
  variableSnapshot: Record<string, number | string>;  // 变量快照（用于归档与复算）
  elements: LayoutNode[];     // 顶层元素，树形嵌套
  edges?: LayoutEdge[];       // 连线（架构图 / 流程图为必填，普通页面可省略）
}
```

`breakpoint` 已从 `"mobile" | "desktop"` 放宽为「匹配 `/^[a-z][a-z0-9-]*$/` 的画布标识」：
响应式页面仍是 `desktop` / `mobile`；drawio 架构图是单画布产物，用视图名（如 `hwsync`）。
`build-tree.mjs` 读 `layout.config.json` 的 `breakpoints` 决定构建哪几张。

## 可选字段 note / kind / shape / tone / textRotate / align / silent / refs

这些字段**全部不影响几何**，因此 `lint-geometry` / `assert-layout` / `verify-positioning`
的几何判定忽略它们，`hashLayoutTree` 也不把它们算进指纹——改观感不必逼用户重新确认布局。

- `note: string[]`：盒子内的说明文字（`render-core.mjs` / `pil.py` / `drawio.mjs` 会渲染）。
  配合 `preview.mjs --style diagram` 可产出干净的架构图。参考实现：`examples/architecture/`。
- `kind` / `shape` / `tone` / `textRotate` / `align` / `silent`：drawio 架构图的语义与观感字段，
  详见 [07-drawio.md](../../drawio/references/07-drawio.md) 第四节。
- `refs: string[]`：显式声明该节点引用了哪些变量（`indexer` 优先读它，读不到才做 AST 推断）。

## edges：连线也是布局结果

连线不是渲染器「自己找的路」，而是布局函数算出来并存进树的几何数据：

```ts
interface LayoutEdge {
  id: string;
  from: { node: string; side: "N"|"E"|"S"|"W" };
  to:   { node: string; side: "N"|"E"|"S"|"W" };
  fromPt: { x: number; y: number };  toPt: { x: number; y: number };   // 边框上的锚点
  fromPtExpr: { x: string; y: string };  toPtExpr: { x: string; y: string };
  via: { x: number; y: number }[];   viaExpr?: { x: string; y: string }[];
  role: "data" | "control" | "power";
  arrow?: "forward" | "both" | "none";
  labelNode?: string;   // 动作标签所在的节点（kind: "edgeLabel"）
}
```

- 锚点与途经点的 expr 与节点 expr 同规范（两段式），`verify-positioning` 同样逐项复算。
- `assert-layout` 额外检查：端点落在锚点上、途经点在画布内、线段不横穿任何节点、
  标签盒压在它的线段上、**不同连线不得共线重合**（同一锚点扇出豁免）。
- 入指纹的是几何（from/to/fromPt/toPt/via/labelNode）；`role` 与 `arrow` 是线型，不进指纹。
- 生成它们用 `builder` 的 `anchor()` / `route()` / `waypoint()` / `viaPanel()`，见下。

## expr 约定

格式：`<符号算式> = <数值算式>` —— **两段都必须能复算出同一个结果**。

- `verify-positioning` 把两段分别用 `variableSnapshot` 求值，两者都要等于节点数值（容差 0.02）。
- 符号段的标识符必须来自 `variableSnapshot`；数值段通常是纯数字算式（也可用快照键）。
- `x/y/w/h` **四项都必须有 expr**（缺一即失败）。
- 序号（`i` / `col` / `row`）必须**代入字面量**写进两段，否则符号段无法复算。

```json
{ "id": "card-list", "y": 88, "expr": { "y": "HEADER_H + GAP_LG = 64 + 24" } }
```

```json
{
  "id": "card-2", "x": 661.33,
  "expr": { "x": "CARD_AREA_X + 1*(CARD_W + SPACE.md) = 288 + 1 * (357.33 + 16)" }
}
```

贴边对齐用 `ORIGIN` 表达：`"ORIGIN = 0"`（`ORIGIN` 在 `tokens.ts` 中定义为 0）。

### 符号段要写来源变量名（影响反向索引）

`indexer` 把变量映射回元素，靠的是**扫描 expr 字符串里的标识符**。所以符号段里请写上来源变量名：

```ts
// ✅ 反向索引可用：ARCH_DESKTOP 会被识别，--impact ARCH_DESKTOP 能列出全部元素
x: `ARCH_DESKTOP.${prefix} 行内第 ${i} 个 = WF_CX0 + ${i} * (WF_ITEM_W + GAP)`

// ❌ 只剩快照键，`--impact ARCH_DESKTOP` 会答「影响元素：无」
x: `${prefix} 行内第 ${i} 个 = WF_CX0 + ${i} * (WF_ITEM_W + GAP)`
```

数值段（最后一个 `=` 之后）只需能被 `variableSnapshot` 复算，与符号段互不影响。

## 变量快照（variableSnapshot）

除 `variables/` 里的设计变量外，还应包含**本次计算用到的派生量**，供 expr 求值：

```
SPACE.sm / SPACE.md / SPACE.lg, HEADER_H, FOOTER_H, GAP_LG, PAD,
CANVAS_W, CANVAS_H, CONTENT_Y, CONTENT_H, LIST_X/LIST_Y/LIST_W/LIST_H,
CARD_AREA_X, CARD_AREA_Y, CARD_AREA_W, CARD_W, CARD_H, COLUMNS, COLUMN_RATIO, ...
```

`build-tree.mjs` 会把快照原样归档进 `layout-tree/*.json`。

## 计算函数的强制性约束

- **纯函数**：输入（变量值 + 断点）→ 输出 Layout Tree，无副作用、无随机数、无时间依赖。
  `build-tree.mjs` 会连续调用两次并逐字节比较；`assert-layout` 会把归档结果与重算结果比对。
- **禁止在计算函数体内出现几何字面量**，所有数字来自 `tokens.ts` / `layout.ts` 或对其他节点的引用。
- 移动端与桌面端各调用一次 `buildLayout(breakpoint)`，产出两棵树，分别归档到 `layout-tree/desktop.json` 和 `layout-tree/mobile.json`。

## 运行时要求

项目里的布局模块是 `.ts`，由 Node ≥ 22.6 的 **type stripping** 直接执行，无需构建步骤：

```bash
node layout/scripts/build-tree.mjs --project output/landing
```

因此请避免 `enum`、`namespace`、构造函数参数属性等需要转译的语法；`import type` 正常使用。

## 构建工具 API（`vendor/layout-engine/builder.mjs`）

| 函数 | 说明 |
|---|---|
| `canvas({w,h,breakpoint})` | 画布描述（`breakpoint` 为任意画布标识） |
| `node(spec)` | 创建节点；`expr` 只允许 x/y/w/h 键；`kind/shape/tone/textRotate/align/silent` 为非几何展示字段 |
| `tree({canvas, variableSnapshot, elements, edges})` | 组装，自动计算 `depth`；`edges` 接受 `edge()` 的返回值或 raw spec |
| `round(n, digits=2)` | 消除浮点噪声 |
| `pct(parentSize, ratio)` | 百分比参数换算为像素 |
| `sum(...parts)` | 约束项求和 |
| `half(v)` / `inset(outer,inner)` / `midNum(a,b)` | 通用的「/2」与居中内缩（布局代码里禁止写 0/1 以外的字面量，所以这些运算收进引擎） |
| `centerX(n)` / `centerY(n)` / `midX(a,b)` / `midY(a,b)` / `gapMid(upper,lower)` | 节点中心与中点（标签定位常用） |
| `anchor(node, side)` | 节点某条边上的锚点，**自带两段式出处** |
| `route(from, fromSide, to, toSide)` | 正交路由，产出 0~2 个拐点（层间空隙里） |
| `waypoint(x, y, exprX, exprY)` | 手工绕行走廊的途经点 |
| `bandRouter({name,center,tracks,pitch,labelSize})` | 层间空隙的水平轨道分配：区间不相交的连线可共轨；标签槽位全局不重叠；用尽即报错 |
| `channelRouter({name,center,tracks,pitch})` | 竖向走廊的垂直轨道分配（同语义，换轴） |
| `viaPanel(axis, value, from, fromSide, to, toSide, expr)` | 整条走廊上的两个拐点 |
| `edge({id, from, fromSide, to, toSide, via, role, arrow, labelNode})` | 创建连线；锚点在这里算 |
| `flatten(nodes)` / `byId(root, id)` | 遍历 / 查找 |
| `serializeTree(t)` | 稳定 JSON 序列化 |

另有 `schema.mjs`：`validateLayoutTree(t)` / `assertLayoutTree(t)`；`io.mjs`：`readTree` / `writeTree` / `listTrees` / `listFiles`。
