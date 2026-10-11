---
name: layout-engineer
description: 用代码计算几何关系来生成前端页面布局、定位图、图片、Remotion 视频与 draw.io 架构图。Layout Tree 是唯一的几何事实来源，所有产物都是对它的序列化。当用户要做页面/布局/排版/视觉稿、要「把页头改矮一点／挪一下卡片／调间距」、要生成带编号与尺寸标注的定位图、要出双端预览图、要做 Remotion 视频分镜、要画 draw.io 系统架构图、要用框架/编程语言/平台图标标注节点、或抱怨「布局看起来不对／AI 给的尺寸是瞎写的」时使用。含两级确认闸门、八步强制验证、完整归档，以及可直接导入 draw.io 编辑的原生图表与图标素材库。
metadata:
  version: "3.2.0"
  language: "zh-CN"
  runtime: "node >= 22.6；AST 分析需 typescript（可选，缺失时自动回退）；PNG 渲染需 Pillow（可选）；draw.io CLI 导出需 draw.io Desktop（可选）"
---

# layout-engineer

**Layout Tree 是唯一的几何事实来源。** 布局计算函数产出这棵树之后，定位图、React 渲染、图片渲染、几何校验，全都只是对同一棵树的不同「序列化」。

三项结构性保证：

1. **同源保证** —— 定位图上的 88px 和页面里的 88px 是同一个数字，两者都从 `layout-tree/desktop.json` 读出，不存在「图上是一套、代码是另一套」。
2. **可修改保证** —— 改几何只有一条合法路径：改变量 → 重算树 → 重出图。渲染器里没有几何计算，所以「直接改渲染代码」这条路不存在。
3. **可验证保证** —— 几何集中在一棵树里，越界/重叠/间距刻度/expr 完整性才能写成脚本而不是靠人眼。

```
variables/ ──→ layout/ ──→ layout-tree/ ──→ ┬─ positioning-viewer(确认)
 (tokens+layout)  (纯函数)    (双端 JSON)    ├─ serializers(渲染)
                              ↑             └─ indexer(反向索引)
                              └─ validate 八步：不通过即阻断
```

**产物不止静态页面**。同一棵树可以被序列化成 DOM、视频帧、位图，也可以序列化成
**draw.io 架构图**（`edges[]` 让连线本身也成为树里的几何数据）：

```
layout-tree/<view>.json ──┬─ react.mjs       → Layout.tsx
                          ├─ remotion.mjs    → Composition.tsx
                          ├─ preview.mjs     → preview/*.svg|png（定位图 / 线框图 / 交付海报）
                          ├─ drawio.mjs      → drawio/<view>.drawio ──┬─ 可直接导入 draw.io 编辑（含内嵌 SVG 图标）
                          │                                             └─ drawio_png.py（解析 XML）→ PNG
                          └─ drawio_cli.mjs  → draw.io Desktop CLI → PNG / SVG / PDF（内嵌 XML）
```

**draw.io 有两种模式**：架构图模式（Layout Tree → 序列化，见 `07-drawio.md`）与
通用绘图模式（直接产 `.drawio`，见 `08-drawio-freeform.md`），两者共用同一套 `.drawio` 规范、
导出通道与 draw.io Desktop 安装指引（`install-drawio.md`）。

**技术栈图标**：`drawio/assets/icons/`（含 `catalog.json`）内置了框架 / 编程语言 / 平台图标；
节点通过 `icon: string[]` 字段挂图标，由 `builder.iconSlots()` 算出带 expr 的图标盒，
渲染成「左图标 + 右文字」；`.drawio` 内嵌 SVG，自研 PNG 通道用配套位图。

---

## 两层结构（同一技能，物理分层）

```
layout-engineer/
├── layout/     ← 计算层：算几何、验证、确认。唯一产出 Layout Tree
│   ├── scripts/      layout-engine / positioning-viewer / validate / build-tree / confirm / print-tree / indexer / docgen
│   ├── templates/    普通项目骨架 + 变量样板
│   └── references/   01 规范 / 02 Layout Tree / 03 工作流 / 05 Storyboard / 06 排错
├── drawio/     ← 绘制层：把 Layout Tree（以及通用绘图）画成 draw.io 与其它产物
│   ├── scripts/      serializers(drawio / react / remotion / preview / pil / diagram) / validate/check-drawio / icons / storyboard / xml.mjs
│   ├── assets/icons/ 技术栈图标素材 + catalog.json
│   ├── templates/drawio/  drawio 项目骨架
│   └── references/   07 架构图 / 08 通用绘图 / install-drawio
├── scripts/    new-project.mjs（跨层脚手架入口）
├── references/04-scripts.md（跨层脚本索引）
├── examples/ · tests/ · SKILL.md
```

**两层的契约只有一个：`layout-tree/<canvas>.json`（含 `elements[]` + `edges[]` + `expr`）。**
计算层产出它，绘制层只读它；绘制层从不反向影响计算层的几何决策。
React / Remotion / preview / poster / pil 与 draw.io **同属绘制层**，只是产物不同——
所以「整个绘图」都由绘制层负责，而几何只由计算层负责。

> 依赖方向单向：`drawio/ → layout/`（绘制层读树、读确认闸门），不反向。
> 如挪动两层的相对位置，只需保证这个契约与各自的入口脚本路径成立。

---

## 何时使用 / 不适用

- ✅ 要一个**页面/布局/视觉稿**，或调整已有布局的某个区域。
- ✅ 要带**编号、尺寸、来源算式**的定位图供人确认。
- ✅ 要**双端（desktop/mobile）** 布局与预览。
- ✅ 要 **Remotion 视频**的分镜与关键帧。
- ✅ 要 **draw.io 系统架构图**（CLI / GUI / 硬件 / 软硬协同四视图）——见 [references/07-drawio.md](drawio/references/07-drawio.md)。
- ✅ 要**通用 draw.io 图**（流程图 / ER 图 / 时序图 / 泳道图）或导出 PNG/SVG/PDF（内嵌 XML）——见 [references/08-drawio-freeform.md](drawio/references/08-drawio-freeform.md)。
- ✅ 要用**框架 / 编程语言 / 平台图标**标注架构图节点——见 `drawio/assets/icons/catalog.json`，用 `node drawio/scripts/icons/build-catalog.mjs --list` 查看可用逻辑名。
- ✅ 用户说「这里不对/换个位置/间距大了」——走修改回路的结构化 diff。
- ❌ 纯视觉美化（配色、阴影、动效曲线）而不改几何结构。
- ❌ 一次性截图式说明，不需要复现与归档。

---

## 快速开始

```bash
# 0) 自检
node tests/run.mjs

# 1) 脚手架（普通页面/布局；视觉起点用 --theme 选主题预设，--list-themes 查看）
node scripts/new-project.mjs --name landing --out output/ --title "产品落地页"

# 1b) 脚手架（draw.io 架构图 · 一个视图 = 一个项目；视图范围必须先问用户）
node scripts/new-project.mjs --name arch-hwsync --kind drawio --view hwsync --out output/arch --title "软硬协同架构"

# 2) 复核结构（确认节点 A 的机器版）
node layout/scripts/print-tree.mjs --project output/landing

# 3) 计算并归档双端 Layout Tree
node layout/scripts/build-tree.mjs --project output/landing

# 4) 交互式定位确认：默认绑 0.0.0.0 并打印所有可达地址
node layout/scripts/positioning-viewer/serve.mjs --project output/landing
#    仅本机：--host 127.0.0.1     公网加锁：--token <secret>

# 5) 结构确认落盘（用户认可后；AI 不得自行伪造）
node layout/scripts/confirm.mjs --project output/landing --node structure --source user-chat --note "用户回复：结构 OK"

# 6) 强制验证（八步；含确认闸门与 drawio 自检；不通过禁止渲染）
node layout/scripts/validate/run-all.mjs --project output/landing

# 7) 最终渲染（渲染前再检查一次确认记录）
node drawio/scripts/serializers/index.mjs --project output/landing --target all
#    draw.io 架构图：--target drawio → drawio/<view>.drawio + drawio/<view>.png
#    可选官方导出：--target drawio-cli → PNG/SVG/PDF（内嵌 XML，需装 draw.io Desktop，缺失时自动跳过）

# 7b) 查看可用技术栈图标逻辑名
node drawio/scripts/icons/build-catalog.mjs --list

# 8) 视频：先出关键帧、用户确认、再渲染
node drawio/scripts/storyboard/index.mjs --project output/landing
node layout/scripts/confirm.mjs --project output/landing --node storyboard --source user-chat
node drawio/scripts/serializers/index.mjs --project output/landing --target remotion
```

现成例子：`examples/landing/`（双端页面 + Storyboard）、`examples/architecture/`（用本 Skill 生成它自己的架构图）、`examples/drawio-hwsync/`（draw.io 软硬协同架构图）。

---

## 工作流（两个确认节点不可跳过）

```
① 需求解析 → 元素清单 + 文本 box tree
      ↓ 【确认节点 A：结构确认】用户点头前不写布局代码
        （draw.io 架构图：**还要问用户要哪几个视图**——CLI / GUI / 硬件 / 软硬协同）
      ↓ 【参数确认】主题预设 / 配色 / 字号 / 是否要图例 / 密度目标 —— 先问，再写布局
② 变量定义   variables/tokens.ts + variables/layout.ts（四行注释）
③ 布局计算   context(breakpoint) + 唯一 layout(ctx) → 双端 Layout Tree
             （架构图另加 edges[]：锚点与途经点也在这一步算出来）
      ↓ 【确认节点 B：定位确认】查看器双端各确认一次
④ 修改回路   查 variableUsage → 结构化 diff 预览 → 用户确认 → 回到 ②
⑤ 验证层     lint / assert / verify / check-env / indexer / check-confirmation / check-drawio / docgen（八步）
⑥ 最终渲染   react / remotion / preview / drawio
      ↓ 【成图复审】先跑 `measure.mjs`，把占比 / 空白带 / 可读性数字给用户；不达标先问再动
⑦ 文档站     docgen
⑧ 归档       完整目录 + manifest.json（含 confirmations）
```

**确认节点 A**：只输出缩进式文本 box tree，用户三十秒内判断对/不对，挡掉方向性返工。
**确认节点 B**：`positioning-viewer` 是 Skill 内置常驻组件（代码固定、行为固定），AI 只负责产出 Layout Tree JSON。
**参数确认**：主题预设 / 配色 / 字号 / 图例 / 密度目标预先问一次，不让 AI 自己替用户定视觉。
**成图复审**：渲染后先跑 `measure.mjs` 再交付；数字不达标（内容占比 < 50%、空白带过宽、字小）先问，不静默交付。

两级排序按返工成本从大到小：越便宜的前置确认越早做。

---

## 硬规则速查

| # | 规则 | 执行者 |
|---|---|---|
| 1 | 布局计算里零几何字面量（含表达式内部）；`variables/` 白名单 | `lint-geometry`（ESLint 规则） |
| 2 | 几何变量全大写下划线命名（给静态分析留信号） | `indexer` AST 扫描 |
| 3 | **双断点共享一套公式**，断点只出现在 `context()` 里 | 代码评审 + `assert-layout` 复算 |
| 4 | `expr` 是数据字段（不是注释），且必须是「符号算式 = 数值算式」两段式 | `schema` + `verify-positioning` |
| 5 | 间距走 `SPACE` 刻度；快照中的间距变量也必须落在集合内 | `assert-layout` |
| 6 | 重叠只检测**同一父级下的兄弟**，父子包含不算重叠 | `assert-layout` |
| 7 | 不同连线不得**共线重合**（重合后渲染成一条线，无法分辨）；同一锚点扇出豁免 | `assert-layout` + `bandRouter` |
| 8 | 渲染序列化器**零几何计算**，只做字段映射 | 评审 + `data-expr` 回溯 |
| 9 | 确认状态**落盘**（`confirmed.json`），渲染闸门**读文件不读对话** | `check-confirmation` |
| 10 | 视频与静态产物**闸门分开** | `check-confirmation --mode` |
| 11 | 视觉参数（配色 / 字阶 / 圆角 / 阴影 / 渐变 / 字体）也是 token，必须进 `tokens.ts` 并写入 `variableSnapshot` | 渲染器只读快照，不写死视觉参数 |
| 12 | 每次生成**完整落盘**，不允许「重要的才保留」 | 归档结构 + 测试 |
| 13 | **连线是几何数据**：锚点/途经点由布局纯函数算出并带 expr，渲染器不自算锚点、不自找路由 | 评审 + `assert-layout` |
| 14 | **drawio 产物同源**：PNG 由 `.drawio` 解析渲染，不存在第二条渲染路径 | `check-drawio` + 结构保证 |
| 15 | 架构图的**视图范围必须先问用户**，AI 不得自行假定要出几张图 | 确认节点 A |
| 16 | **图标也是几何**：`icon` 只是逻辑名，图标盒由 `builder.iconSlots()` 算出并带 expr；渲染器不自算图标位置 | 评审 + `assert-layout` + `check-drawio` |
| 17 | 图标逻辑名必须存在于 `drawio/assets/icons/catalog.json`；卡片声明了 `icon` 就必须有对应 `kind:"icon"` 子节点 | `check-drawio` + `schema` |
| 18 | 通用绘图模式（直接写 `.drawio`）不进入 Layout Tree 与几何校验；需追溯时迁移到架构图模式 | 评审 + [references/08-drawio-freeform.md](drawio/references/08-drawio-freeform.md) |
| 19 | **成图前先量**：`measure.mjs` 报出容器内容带占比（< 50% 视为浪费）、画布空白带、标签盒多余、字号可读性；不达标先问用户，不静默交付 | `measure.mjs` + 【成图复审】 |
| 20 | 连线标签盒**贴合文字**（`textWidth + 2×labelPad`），不得用固定宽度；标签底色取背后容器色（视觉透明 + 断线缺口） | 评审 + `measure.mjs` + `drawio.mjs` |
| 21 | **图例可选**：默认在成图前问用户要不要；要则只列图里真的出现的类别，线型用线段样例而不是色块 | 【参数确认】+ `check-drawio` |
| 22 | **先确认后生成**：未经确认 B 的渲染产物一律加 `PREVIEW-` 文件名前缀（位图再加水印）；交付只认**无前缀**的文件。`--allow-unconfirmed` 只能得到预览，物理上无法冒充交付稿 | `gate.mjs` / `_gate.py` + 测试 |

---

## 脚本索引（按层）

计算层在 `layout/scripts/`，绘制层在 `drawio/scripts/`；跨层入口 `scripts/new-project.mjs` 在根。

| 脚本 | 层 | 作用 |
|---|---|---|
| `scripts/new-project.mjs` | 跨层 | 脚手架（含 vendor / eslint 配置 / 变量样板） |
| `layout/scripts/print-tree.mjs` | 算 | Layout Tree → 文本 box tree（确认节点 A 的机器版） |
| `layout/scripts/measure.mjs` | 算 | **成图前先量**：容器内容带占比 / 空白带 / 标签盒多余 / 字号可读性（`--strict` 可作闸门） |
| `layout/scripts/build-tree.mjs` | 算 | 调 `buildLayout(breakpoint)`，归档双端树并做**纯函数性检查** |
| `layout/scripts/positioning-viewer/serve.mjs` | 算 | 交互式定位确认查看器（默认暴露端口，`--host` / `--token`） |
| `layout/scripts/confirm.mjs` | 算 | 把确认落盘（structure / positioning / storyboard） |
| `layout/scripts/indexer.mjs` | 算 | AST 反向索引 + manifest 三重结构；`--impact` 出结构化 diff |
| `layout/scripts/docgen.mjs` | 算 | 四要素注释提取 → 文档站；缺项即报错 |
| `layout/scripts/validate/lint-geometry.mjs` | 算 | 几何裸字面量规则（CLI + ESLint 插件） |
| `layout/scripts/validate/assert-layout.mjs` | 算 | 越界 / 兄弟重叠 / 间距刻度 / expr 完整 / 连线不穿节点 / **连线不共线重合** / 纯函数复算 |
| `layout/scripts/validate/verify-positioning.mjs` | 算 | expr **两段**复算：符号段 = 数值段 = 树值 |
| `layout/scripts/layout-engine/cli.mjs` | 算 | 统一参数解析（`--k v` / `--k=v` / 未知选项忽略） |
| `layout/scripts/validate/check-env.mjs` | 算 | `.nvmrc` / 锁文件 / `node_modules` / `.venv` / `globalInstall` 自报 |
| `layout/scripts/validate/check-confirmation.mjs` | 算 | **确认闸门**（static / storyboard 两种模式） |
| `layout/scripts/validate/run-all.mjs` | 算 | 八步串行，失败即中止（含调用绘制层 check-drawio） |
| `drawio/scripts/validate/check-drawio.mjs` | 绘 | **架构图自检**：XML 可解析 / 几何与树一致 / 文字不截断不溢出 / 图例与边距 / 产物未过期 |
| `drawio/scripts/serializers/react.mjs` | 绘 | → `Layout.tsx`（px 原样映射 + `data-layout-id` / `data-expr`） |
| `drawio/scripts/serializers/remotion.mjs` | 绘 | → `Composition.tsx`（位移量取自 `timeline.json`） |
| `drawio/scripts/serializers/drawio.mjs` | 绘 | → `drawio/<view>.drawio`（mxGraph XML，零几何计算；中国色只读快照 token；图标内嵌 SVG data URI） |
| `drawio/scripts/serializers/drawio_png.py` | 绘 | `.drawio` → PNG（**解析 XML 再画**，所以「图与 XML 一致」是结构保证；图标用配套位图） |
| `drawio/scripts/serializers/drawio_cli.mjs` | 绘 | 调 draw.io Desktop CLI 导出 PNG/SVG/PDF（`--embed-diagram`）；无 CLI 时优雅降级，`--require` 强制失败 |
| `drawio/scripts/icons/build-catalog.mjs` | 绘 | 扫描 `drawio/assets/icons/` → `catalog.json`（`--list` 列可用逻辑名，`--check` 校验一致性） |
| `drawio/scripts/serializers/diagram.py` | 绘 | → **交付海报**（圆角卡片 / 配色分区 / 字阶 / 连接符 / 阴影） |
| `drawio/scripts/serializers/pil.py` | 绘 | → 几何核对图 PNG（坐标零运算；`--scale` 是整图重采样） |
| `drawio/scripts/serializers/preview.mjs` | 绘 | 双端预览图（`--style positioning` / `diagram` / `poster`） |
| `drawio/scripts/storyboard/index.mjs` | 绘 | 关键帧 Storyboard（`timeline.svg` / `timeline.json` / `kf-*.svg`） |

细节见 [references/04-scripts.md](references/04-scripts.md)。

---

## 确认闭环（本 Skill 的核心机制）

```
用户在查看器点「确认布局」
        ↓
positioning/confirmed.json   ← 原始记录：{node, bp, hidden, 时间戳, treeHash}
        ↓ indexer 聚合
manifest.confirmations       ← 聚合视图：{structure, positioning: {"<画布名>": bool}, storyboard}
（positioningDesktop / positioningMobile 是 desktop/mobile 的便捷键，向后兼容）
        ↓ 渲染序列化器第一步读取
不通过 → 抛错退出（AI 绕不过去）
```

- `treeHash` 把确认**绑定到当次布局**：确认后再改树，确认自动失效。
- `--allow-unconfirmed` 仅供 CI / 示例归档，会打印警告且来源不会是人工。
- **先确认后生成（结构性保证）**：走了 `--allow-unconfirmed` 的产物一律带 `PREVIEW-` 文件名前缀（位图再加水印），
  因此「正常文件名的交付稿」**只能**在确认 B 之后产生。
- 视频走独立闸门 `check-confirmation --mode storyboard`（时间轴指纹）。

---

## 视觉层（不只是几何正确）

几何正确 ≠ 好看。本 Skill 的边界是**保证几何可追溯**，视觉由两层决定：

1. **设计 token**：`COLOR / TYPE / RADIUS / SHADOW / GRADIENT / FONT` 与 `SPACE` 同级写在 `variables/tokens.ts`，
   并随 `variableSnapshot` 一起归档 —— 「为什么是这个蓝」「为什么投影是 5/18/28」和「为什么页头是 64px」一样可追溯。
   阴影分 elev1–3 级（真高斯模糊），渐变有方向与强度，`accentDeep` 是强调面的渐变端。
   **主题预设**：`layout/templates/themes/`（paper 宣纸墨 / jade 青瓷 / deepspace 深空）是成套 token 起点，
   在【参数确认】由用户选定（脚手架 `--theme`），之后仍只动 token 微调——AI 不替用户设计视觉。
   架构图另有一套 `DRAWIO`（中国色十档）+ `DRAWIO_METRICS`（标题带 / 填充混合比 / 边距下限 / 图标盒尺寸）
   + `SHADOW / GRADIENT`（节点投影与填充渐变），同样入快照。
   技术栈图标另有一套 `drawio/assets/icons/` 素材与 `catalog.json`，节点 `icon` 只存逻辑名。
2. **渲染器**：`diagram.py`（交付海报）、`pil.py`（几何核对图）、`drawio.mjs` + `drawio_png.py`（架构图）分工明确，互不替代。
   两条 Python 通道共用 `_visual.py`（渐变 / 高斯柔影 / 字体族回退链解析），
   保证「同一个 token 只有一种画法」；drawio XML 通道用 `gradientColor` + 原生 `shadow`，
   阴影参数以 `leShadow*` 自定义 style 键随 XML 走，PNG 通道同源读出。
   `drawio_png.py` 是唯一「输入不是 Layout Tree」的序列化器：它解析 `drawio.mjs` 的产物，
   所以「PNG 与 XML 一致」由结构保证，不靠人工比对。

```bash
node drawio/scripts/serializers/preview.mjs --project <dir> --style poster   # 交付海报
node drawio/scripts/serializers/preview.mjs --project <dir> --style positioning  # 几何核对
node drawio/scripts/serializers/index.mjs  --project <dir> --target drawio   # draw.io 架构图
node drawio/scripts/serializers/index.mjs  --project <dir> --target drawio-cli  # 官方 CLI 导出 SVG/PDF
```

**迭代成本才是重点**：改配色/字号/圆角只动 token，重算后几何断言不受影响；
渲染器不写死任何颜色字号，所以换主题不需要改渲染代码。

## 禁止事项

- ❌ 在布局计算里写几何字面量（含 `A.y + 10` 这种表达式内部逃逸）。
- ❌ 按断点写两套坐标公式（断点只允许出现在 `context()`）。
- ❌ 把 `expr` 写成注释而不是数据字段（注释进不了 JSON、不能被脚本校验）。
- ❌ 在序列化器里做几何运算（渲染器只做字段映射）。
- ❌ 跳过确认节点 A 或 B 直接渲染。
- ❌ **AI 自行调 `/api/confirm` 伪造确认**；用户只在对话里认可时须记 `source=user-chat` 并留原话。
- ❌ 把确认状态只留在对话里（必须落盘）。
- ❌ 用 `-g/--global` 装依赖。
- ❌ 在渲染器里写死颜色 / 字号 / 圆角 / 阴影与渐变参数（必须读 `variableSnapshot` 的设计 token）。
- ❌ **drawio：** 在 `drawio.mjs` / `drawio_png.py` 里用节点框算锚点或自动找路由。
- ❌ **drawio：** 只交 `.drawio` 不交 PNG，或 PNG 另走一条渲染路径（会架空「XML 与 PNG 严格一致」）。
- ❌ **drawio：** 连线横穿节点内部（含「就调一点点」），或省略图例。
- ❌ **drawio：** AI 自行决定要生成哪几个视图（必须先问用户）。
- ❌ **图标：** 用 `icon` 之外的字段（如 label 关键词）自动匹配图标（不可校验、容易误配）。
- ❌ **图标：** 在渲染器里根据节点框推算图标位置（必须由 `builder.iconSlots()` 算进树）。
- ❌ **图标：** 引用 `catalog.json` 里不存在的逻辑名，或声明了 `icon` 却忘记生成 `kind:"icon"` 子节点。
- ❌ **通用绘图：** 用 Mermaid / CSV 当交付物；XML 注释里出现 `--`；未经用户确认就安装 draw.io Desktop。
- ❌ **先确认后生成：** 把 `--allow-unconfirmed` 渲染出的 `PREVIEW-*` 产物当成交付物（交付只认无前缀文件）；截图/改文件名去掉 `PREVIEW-` 冒充交付。

---

## 验收 Checklist

**机器判定**（任一非 0 即整体失败）：

- [ ] `lint-geometry` 退出码 0
- [ ] `assert-layout` 退出码 0
- [ ] `verify-positioning` 退出码 0
- [ ] `check-env` 退出码 0
- [ ] `indexer` 退出码 0（manifest 三重结构）
- [ ] `check-confirmation` 退出码 0（含 `--mode storyboard` 若交付视频）
- [ ] `check-drawio` 退出码 0（若交付 draw.io 架构图）
- [ ] `build-catalog.mjs --check` 退出码 0（若使用技术栈图标；保证 `catalog.json` 与素材一致）
- [ ] `measure.mjs` 无 fail 项（成图复审；阈值按项目可调；独立于 run-all 之外运行）
- [ ] `docgen` 退出码 0
- [ ] `manifest.confirmations` 与本次交付范围对应的项全为 true

**人工判定**（机器无法代替用户判断的部分）：

- [ ] 结构 box tree 已获用户确认（drawio 还需确认**要哪几个视图**）
- [ ] 双端定位图（或关键帧 storyboard）已获用户确认
- [ ] drawio 的 PNG 已亲眼核对（文字 / 连线 / 层 / 图例 / 边距），图标与文字不重叠、图标在卡片内
- [ ] 参数确认（配色/字号/图例/密度目标）与成图复审（`measure.mjs` 数字）已与用户确认

## 导航

- **计算层总览**：[layout/README.md](layout/README.md)
- **绘制层总览**：[drawio/README.md](drawio/README.md)
- 规范细则与反例：[references/01-standards.md](layout/references/01-standards.md)
- Layout Tree 数据规范：[references/02-layout-tree.md](layout/references/02-layout-tree.md)
- 完整工作流与确认节点：[references/03-workflow.md](layout/references/03-workflow.md)
- 脚本参数与产物：[references/04-scripts.md](references/04-scripts.md)
- Storyboard 与 Remotion：[references/05-storyboard-remotion.md](layout/references/05-storyboard-remotion.md)
- 排错：[references/06-troubleshooting.md](layout/references/06-troubleshooting.md)
- **draw.io 系统架构图**：[references/07-drawio.md](drawio/references/07-drawio.md)
- **draw.io 通用绘图**（流程图 / ER / 导出 PNG·SVG·PDF）：[references/08-drawio-freeform.md](drawio/references/08-drawio-freeform.md)
- **draw.io Desktop 安装与 CLI 验证**：[references/install-drawio.md](drawio/references/install-drawio.md)
