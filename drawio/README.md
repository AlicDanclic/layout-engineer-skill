# drawio/ — 绘制层

> layout-engineer 的**绘制层**：把计算层产出的 **Layout Tree** 画成 draw.io 与其它产物，
> 同时保留原独立技能「Draw.io 专业绘图」的**通用绘图模式**（直接画任意 `.drawio`）。
> 与它平级的 `layout/` 是**计算层**。两层契约见根目录
> [SKILL.md](../SKILL.md#两层结构同一技能物理分层)。

## 职责边界

| 做 | 不做 |
|---|---|
| 消费 `layout-tree/*.json` → `.drawio` / PNG / SVG / PDF | 计算任何节点坐标与连线锚点/路由（属计算层） |
| 通用绘图：直接生成任意 `.drawio`（流程图 / ER / 时序图） | 修改 `variables/` 或 `src/layout/` 的几何决策 |
| React / Remotion / 预览图 / 交付海报 / 几何核对图序列化 | 保存确认状态（只需**读取**确认闸门） |
| 技术栈图标库与图标渲染（SVG 内嵌 + 配套位图） | — |
| 架构图自检 `check-drawio`、draw.io Desktop 安装与 CLI 导出 | — |

**输入契约**：`<project>/layout-tree/<canvas>.json`。绘制层只读，不反向影响计算层几何。
因 `drawio_png.py` 是唯一「输入不是 Layout Tree」的序列化器——它解析 `drawio.mjs` 的产物，
所以「PNG 与 XML 一致」是结构保证。

## 目录

```
drawio/
├── scripts/
│   ├── serializers/     drawio.mjs + drawio_png.py + drawio_cli.mjs（架构图 / 官方导出）
│   │                    react.mjs / remotion.mjs / preview.mjs / pil.py / diagram.py（其它产物）
│   │                    index.mjs（分发）/ gate.mjs + _gate.py（确认闸门）
│   ├── validate/        check-drawio.mjs（架构图自检）
│   ├── icons/           build-catalog.mjs → assets/icons/catalog.json
│   ├── storyboard/      index / keyframes / timeline（视频分镜关键帧）
│   └── xml.mjs          XML 转义 / 构建 / 独立严格解析器（drawio 专用）
├── assets/icons/        技术栈图标素材（svg + 配套位图）+ catalog.json
├── templates/drawio/    drawio 项目骨架
├── references/          07 架构图 / 08 通用绘图 / install-drawio
└── LICENSE-DRAWIO.md    通用绘图部分版权声明（Copyright (c) 2026 江一帆）
```

## 常用入口

```bash
# 把 Layout Tree 画成 draw.io（架构图模式）
node drawio/scripts/serializers/index.mjs --project <dir> --target drawio
# → drawio/<view>.drawio（可导入 draw.io 编辑，含内嵌 SVG 图标）+ drawio/<view>.png

# 可选：官方 CLI 导出 PNG/SVG/PDF（内嵌 XML；无 draw.io Desktop 时自动跳过）
node drawio/scripts/serializers/drawio_cli.mjs --project <dir> --format png,svg,pdf

# 其它产物
node drawio/scripts/serializers/index.mjs --project <dir> --target react,remotion,preview

# 图标目录
node drawio/scripts/icons/build-catalog.mjs --list      # 列可用逻辑名
node drawio/scripts/icons/build-catalog.mjs --check     # 校验 catalog.json 与素材一致

# 架构图自检
node drawio/scripts/validate/check-drawio.mjs --project <dir>
```

## draw.io 的两种模式

- **架构图模式**：Layout Tree → 序列化，几何可验证、可复现、强制确认（见 [references/07-drawio.md](references/07-drawio.md)）。
- **通用绘图模式**：直接生成任意 `.drawio`，不进入 Layout Tree（见 [references/08-drawio-freeform.md](references/08-drawio-freeform.md)）。

两种模式共用同一套 `.drawio` 规范、导出通道与 draw.io Desktop 安装指引
（[references/install-drawio.md](references/install-drawio.md)）。

## 技术栈图标

节点用 `icon: string[]` 挂图标（逻辑名来自 [assets/icons/catalog.json](assets/icons/catalog.json)），
由计算层 `builder.iconSlots()` 算出带 `expr` 的图标盒，本层渲染成「左图标 + 右文字」：
`.drawio` 内嵌 SVG（百分号编码 data URI），PNG 通道用配套位图。

## 依赖方向

`drawio/ → layout/`（单向）：本层读计算层的 Layout Tree、复用其确认闸门与 `cli/io` 工具；
计算层不在任何地方依赖本层，除了 `layout/scripts/validate/run-all.mjs` 会**调用**本层的 `check-drawio.mjs`。
