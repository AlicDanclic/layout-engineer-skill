# {{PROJECT_TITLE}}（视图：{{VIEW}}）

由 **layout-engineer** 生成。几何是算出来的，不是画出来的。

## 目录

```
variables/           tokens.ts（间隔刻度 / 中国色 / 文字度量）+ layout.ts（版面尺寸）
src/layout/          布局计算纯函数 buildLayout(view)：节点框与连线路由都在这里算
vendor/layout-engine 布局构建工具（anchor / route / edge / waypoint，勿改）
layout-tree/         单张画布的 Layout Tree JSON（含 expr 出处与 edges）
drawio/              <view>.drawio（可导入 draw.io 编辑，含内嵌 SVG 图标）+ <view>.png（同源渲染）
positioning/         confirmed.json（确认记录）+ confirmed-*.svg
docs/                docgen 生成的文档站
manifest.json        variableSnapshot + variableUsage + confirmations
layout.config.json   kind=drawio、breakpoints=[view]（单画布声明）
```

## 流程（确认节点不可跳过）

```bash
npm run print-tree                  # 复核结构（确认节点 A 的机器版）
npm run build                       # ③ 计算并归档 Layout Tree
npm run view                        # ④ 交互式定位确认，用户点「确认布局」
npm run confirm -- --node structure --source user-chat --note "用户回复：结构 OK"
npm run validate                    # ⑤ 验证层（含确认闸门与 drawio 自检）
npm run render                      # ⑥ 产出 .drawio + .png
npm run icons                       # 查看可用的技术栈图标逻辑名
npm run drawio-cli                  # （可选）官方 CLI 导出 PNG/SVG/PDF（需装 draw.io Desktop）
```

## 技术栈图标（框架 / 编程语言 / 平台）

节点通过 `icon: string[]` 挂图标，图标盒由 `builder.iconSlots()` 算出（带 expr），
卡片内渲成「左图标 + 右文字」。逻辑名来自 `{{SKILL_REL}}/assets/icons/catalog.json`：

```ts
card.icon = ["react", "tauri"];
card.children = iconSlots(card, card.icon, {
  size: DRAWIO_METRICS.iconSize, pad: DRAWIO_METRICS.iconPad, gap: DRAWIO_METRICS.iconGap,
  sizeName: "DRAWIO_ICON_SIZE", padName: "DRAWIO_ICON_PAD", gapName: "DRAWIO_ICON_GAP",
});
```

`.drawio` 内嵌 SVG（百分号编码 data URI，避免 base64 的 `;` 被 mxGraph style 分隔符截断）；
PNG 通道用配套位图，所以两种产物视觉一致。

## drawio 产物怎么来的

```
variables/ ──> src/layout/index.ts（纯函数：节点框 + 锚点 + 途经点）
                        │
                        └──> layout-tree/<view>.json
                                  ├─ drawio.mjs ──> drawio/<view>.drawio（零几何计算）
                                  └─ drawio_png.py（解析上面那份 XML）──> drawio/<view>.png
```

- 渲染器不自己算锚点、不自己找路由：端点与途经点已写进 `edges[]`；
- 配色 / 字号 / 圆角 / 边距全部来自 `variableSnapshot` 里的设计 token；
- `.png` 由 `.drawio` 解析渲染，所以「图与 XML 一致」是结构保证，不靠人核对；
- `check-drawio` 会把 XML 反解回对象，逐字段与 Layout Tree 比对。

## 修改图面的正确姿势

1. 改 `variables/` 里的变量（不要直接改坐标）；
2. `node {{SKILL_REL}}/layout/scripts/indexer.mjs --project . --impact <变量名>` 看结构化 diff；
3. `npm run build && npm run validate && npm run view` 重新确认。
