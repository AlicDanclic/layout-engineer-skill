# layout/ — 计算层

> layout-engineer 的**计算层**：只负责「算出几何、验证几何、取得确认」，不负责画图。
> 与它平级的 `drawio/` 是**绘制层**（消费本层产出的 Layout Tree）。两层契约见根目录
> [SKILL.md](../SKILL.md#两层结构同一技能物理分层)。

## 职责边界

| 做 | 不做 |
|---|---|
| 定义变量（token / 版面尺寸） | 渲染任何产物（draw.io / PNG / DOM / 视频） |
| 纯函数计算 Layout Tree（含 `expr` 出处、`edges[]`） | 决定配色、字号、线型的最终呈现 |
| 确认查看器 + 两级确认闸门（落盘 `confirmed.json`） | 从节点框反推锚点或路由（那是几何，属本层） |
| 八步验证层（lint / assert / verify / check-env / check-confirmation / run-all） | — |
| 反向索引与文档站（manifest / docs） | — |

**唯一产出**：`<project>/layout-tree/<canvas>.json`（`elements[]` + `edges[]` + `variableSnapshot` + `expr`）。
绘制层只读它。

## 目录

```
layout/
├── scripts/
│   ├── layout-engine/        Layout Tree 类型 + builder（anchor/route/edge/iconSlots/bandRouter）+ schema + hash + io + ast + cli + confirm-store
│   ├── positioning-viewer/   交互式定位查看器（render-core 同构 SVG 渲染器）
│   ├── validate/             lint-geometry / assert-layout / verify-positioning / check-env
│   │                         / check-confirmation（确认闸门）/ run-all（八步总入口）
│   ├── build-tree.mjs        调 buildLayout(bp) → 归档双端/单画布树（含纯函数性检查）
│   ├── confirm.mjs           确认落盘（structure / positioning / storyboard）
│   ├── print-tree.mjs        Layout Tree → 文本 box tree（确认节点 A 的机器版）
│   ├── indexer.mjs           AST 反向索引 → manifest；--impact 结构化 diff
│   └── docgen.mjs            四要素注释 → 文档站
├── templates/
│   ├── project/              普通项目骨架
│   └── variables/            tokens.ts / layout.ts 样板
└── references/               01 规范 / 02 Layout Tree / 03 工作流 / 05 Storyboard / 06 排错
```

## 常用入口

```bash
node layout/scripts/build-tree.mjs --project <dir>
node layout/scripts/positioning-viewer/serve.mjs --project <dir>
node layout/scripts/validate/run-all.mjs --project <dir>       # 八步（含调用绘制层的 check-drawio）
node layout/scripts/confirm.mjs --project <dir> --node structure --source user-chat
node layout/scripts/print-tree.mjs --project <dir>
node layout/scripts/indexer.mjs --project <dir> --impact <变量名> <新值>
node layout/scripts/docgen.mjs --project <dir>
```

> `run-all.mjs` 是**跨层**的验证总入口：它跑完计算层的七步后，会调用
> `drawio/scripts/validate/check-drawio.mjs`（若项目是 drawio 架构图）。
