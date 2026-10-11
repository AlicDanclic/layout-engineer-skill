# 04 · 脚本索引

脚本分属两层（物理目录）：`layout/`（计算层：算几何、验证、确认）与 `drawio/`（绘制层：把 Layout Tree 画成 draw.io 与其它产物）；跨层入口 `scripts/new-project.mjs` 留在根。
所有脚本零运行时依赖，使用 Node ≥ 22.6 运行。路径参数统一为 `--project <项目目录>`。

| 层 | 目录 | 职责 |
|---|---|---|
| 计算层 | `layout/scripts/` | Layout Tree 构建、确认查看器、验证层、反向索引、文档站 |
| 绘制层 | `drawio/scripts/` | 所有序列化器（drawio / react / remotion / preview / poster / 核对图）、架构图自检、图标目录、Storyboard |
| 契约 | `layout-tree/<canvas>.json`（含 `elements[]` + `edges[]` + `expr`） | 计算层产出，绘制层只读 |

---

## `new-project.mjs` — 脚手架

```bash
node scripts/new-project.mjs --name landing --out output/ --title "产品落地页" [--theme <主题>] [--force]
node scripts/new-project.mjs --list-themes    # 查看可用主题预设
```

- 复制 `templates/project/`（`.tpl` 后缀自动去掉并做占位符替换）
- 复制 `templates/variables/{tokens,layout}.ts.tpl` 到 `variables/`
- `--theme <名>`：用 `layout/templates/themes/<名>.tokens.ts`（paper / jade / deepspace）成套覆盖 tokens.ts；
  主题由用户在【参数确认】选定，drawio 项目不可用（中国色板自成一套）
- 复制 `layout/scripts/layout-engine/` → `<project>/vendor/layout-engine/`
- 生成锁文件（优先 `npm install --package-lock-only`，失败则写最小 `package-lock.json`）
- package.json scripts 内的脚本路径按实际相对路径注入（`{{SKILL_REL}}`）

---

## `build-tree.mjs` — 计算并归档 Layout Tree

```bash
node layout/scripts/build-tree.mjs --project <dir> [--out <layoutTreeDir>]
```

- 动态 `import` `<dir>/src/layout/index.ts`，要求导出 `buildLayout(breakpoint)`
- 对 `desktop` / `mobile` 各调用一次
- **纯函数性检查**：连续两次计算，序列化结果必须完全一致
- 结构校验（`schema.mjs`）后写入 `layout-tree/<bp>.json`
- 可被当作库使用：`import { buildTrees } from ".../build-tree.mjs"`

---

## `positioning-viewer/serve.mjs` — 交互式定位查看器

```bash
node layout/scripts/positioning-viewer/serve.mjs --project <dir> [--port 5173] [--host 0.0.0.0] [--token <secret>]
```

网络参数（默认**对外暴露端口**，所以在服务器上跑 skill、用本地浏览器打开也能用）：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--host` | `0.0.0.0` | 监听地址。`127.0.0.1` 只允许本机访问 |
| `--port` | `5173` | 端口被占用时会给出换端口提示 |
| `--token` | 无 | 设置后 `/api/*` 需带 `?token=...`；启动时会打印带 token 的完整地址，页面会自动透传 |

启动输出会列出 localhost 与各网卡 IPv4 的完整地址，例如：

```
定位查看器已启动（项目：/srv/app/output/landing）
  http://localhost:5173/
  http://10.0.0.8:5173/
  注意：已对外暴露端口且未设 token，同网络内任何人都可读写该项目（服务端可加 --token 限制）。
  只允许本机访问：--host 127.0.0.1
```

> 该服务可写文件（`/api/confirm` 会写 `positioning/`），暴露到公网时务必加 `--token`。

HTTP 接口：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 查看器页面（静态资源不受 token 限制） |
| GET | `/api/trees` | `{ project, projectName, trees: {desktop, mobile} }` |
| GET | `/api/refresh` | 重新读取 `layout-tree/*.json` |
| POST | `/api/export` | body `{breakpoint, options}` → `{svg}` |
| POST | `/api/confirm` | body `{options:{desktop:{...},mobile:{...}}, source}` → 写 `positioning/confirmed-*.svg`、`positioning/confirmed.json`（含 `treeHash`）、`viewer.html` |

所有 `/api/*` 在设置了 `--token` 时都需要 `?token=<secret>`（或请求头 `x-viewer-token`），否则返回 401。

`options` 字段：`showAreas` / `showCenters` / `showDistances` / `showExpr` / `showCanvasInfo` / `hiddenIds` / `hoveredId`。

`render-core.mjs` 为同构渲染器，导出：`renderSvg(tree, options)`、`flattenTree(elements)`、`numberMark(n)`、`depthColor(depth)`、`DEPTH_COLORS`。

---

## `print-tree.mjs` — 文本 box tree

```bash
node layout/scripts/print-tree.mjs --project <dir> [--breakpoint desktop] [--expr]
```

把 Layout Tree 反打成缩进式文本树（① ② ③ 编号、label、x/y/w/h）。这是**确认节点 A 的机器版**：
人写的是「提议的结构」，本脚本打印「实际的结构」，两者一对照就知道有没有走样。

## `confirm.mjs` — 确认落盘

```bash
node layout/scripts/confirm.mjs --project <dir> --node structure  --source user-chat --note "..."
node layout/scripts/confirm.mjs --project <dir> --node positioning --bp desktop --source user-chat
node layout/scripts/confirm.mjs --project <dir> --node storyboard  --source user-chat
node layout/scripts/confirm.mjs --project <dir> --show
node layout/scripts/confirm.mjs --project <dir> --reset
```

`--source` 取值：`viewer-ui`（查看器按钮）/ `user-chat`（用户在对话里确认）/ `fixture`（CI 与示例归档）。
前两者才算人工确认。记录写入 `positioning/confirmed.json`。

## `validate/check-confirmation.mjs` — 确认闸门

```bash
node layout/scripts/validate/check-confirmation.mjs --project <dir> [--mode static|storyboard]
node layout/scripts/validate/check-confirmation.mjs --project <dir> --write-fixture   # CI / 示例归档
```

- `--mode static`：结构确认 + 每个断点的定位确认（`treeHash` 与当前 `layout-tree` 一致、`confirmed-*.svg` 存在）
- `--mode storyboard`：关键帧确认（时间轴指纹与当前 `timeline.json` 一致）
- 渲染入口（`serializers/index.mjs`）在第一步调用它，未通过直接抛错退出
- `manifest.confirmations` 是聚合视图，脚本会校验两者一致并给出刷新提示

## `validate/lint-geometry.mjs` — 几何裸字面量

```bash
node layout/scripts/validate/lint-geometry.mjs --project <dir>
node layout/scripts/validate/lint-geometry.mjs <file1.ts> <file2.ts>
```

- 扫描 `src/layout/**` 与 `src/serializers/**`；`variables/**` 整目录白名单豁免（定义处允许写字面量）
- 命中：几何属性值（x/y/w/h/width/height/gap/padding/...）、几何变量初始化、与几何标识符同表达式的数字
- 豁免：`0`、`1`、注释、字符串与模板字符串内容
- 报错信息**自带改法**（「把 N 提到 variables/ 定义成命名常量」），错误信息本身承担规范传导职责
- 导出 `rules`（ESLint 插件规则 `no-geometry-literals`）与 `lintSource` / `tokenize`
- 项目侧配置见脚手架生成的 `eslint.config.mjs`

---

## `validate/assert-layout.mjs` — 几何断言

```bash
node layout/scripts/validate/assert-layout.mjs --project <dir> [--no-purity]
```

1. 元素不越界（画布内）
2. 子元素不越出父容器
3. **同一父级下的兄弟**元素不重叠（父子包含不算重叠）
4. 间距刻度两处判定：相邻兄弟间距 ∈ `SPACE`；快照中名字像间距的变量取值也 ∈ `SPACE`
5. expr 完整性：每个节点 x/y/w/h 四项都必须有出处
6. expr 完整性之后是**连线几何**：端点落在锚点上 / 途经点在画布内 / 线段不横穿节点 / 标签压在自己的线上
7. **连线可分辨**：不同连线不得共线重合 >8px（重合后渲染成一条线；同一锚点扇出豁免）
8. 纯函数性 + 与归档 JSON 一致（`--no-purity` 可跳过）

导出 `assertTree` / `assertEdges` / `assertEdgeOverlap` / `readSpacingScale`。

> 第 7 项是为真实项目补上的：有人在架构图里把所有水平段都放在层间空隙的中线上，
> 结果 63 对连线两两重合，而「不穿节点、不压文字」全部通过。这类缺陷只能单独查。

---

## `validate/verify-positioning.mjs` — expr 一致性

```bash
node layout/scripts/validate/verify-positioning.mjs --project <dir>
```

- 每个节点 `x/y/w/h` 必须有 `expr`（缺一即失败），且必须是两段式
- **两段分别复算**：符号段 = 节点数值，数值段 = 节点数值，符号段 = 数值段（容差 0.02）
- 求值环境为 `variableSnapshot`，支持 `+ - * / ( )` 与一元负号，`×`/`÷` 亦可
- 在确认节点 B **之前**运行，防查看器读错树、防有人手改标注值

导出 `evaluate(expr, env)`、`splitExpr(expr)`、`verifyTree(tree, where)`。

---

## `validate/check-env.mjs` — 环境隔离

```bash
node layout/scripts/validate/check-env.mjs --project <dir>
```

- Node：`.nvmrc` 存在且主版本匹配（不匹配仅警告）；锁文件存在；有依赖时 `node_modules` 存在
- Python：存在 `.py` / `requirements.txt` / `pyproject.toml` 时要求 `.venv`
- 全局安装（v1 软约束）：读 `manifest.json` 的 `globalInstall` 自报字段，并用 `*.log` 与 `package.json` scripts 中的 `-g` / `--global` 作为佐证（v1.1 计划改为包装命令审计）

导出 `checkEnv(projectDir) -> {errors, warnings, isNode, hasPy}`、`findGlobalInstalls(text, label)`。

---

## `validate/run-all.mjs` — 总入口

```bash
node layout/scripts/validate/run-all.mjs --project <dir>
```

串行执行并继承输出：`lint-geometry → assert-layout → verify-positioning → check-env → indexer → check-confirmation → check-drawio → docgen`。
任一步非零退出即中止，退出码非 0（共八步）。
`check-drawio` 对非 drawio 项目会自动跳过（不算失败）。

---

## `indexer.mjs` — 变量反向索引

```bash
node layout/scripts/indexer.mjs --project <dir>                  # 写 manifest.json
node layout/scripts/indexer.mjs --project <dir> --impact <VAR> [新值]
```

- 变量定义与注释来自 `variables/*.ts`
- 变量归属**三路合并取并集**：
  a. 节点显式 `refs`（v1.1 主路径，读字段，误差为零）
  b. Layout Tree 的 `expr` 字符串（人写的出处算式，天然含变量名）
  c. **TS Compiler API** 的 AST 追溯：匹配全大写标识符并向上找含 `id: "xxx"` 的对象字面量；
     追溯不到记 `(unknown)`（启发式的已知边界）；`typescript` 缺失时自动回退到 a+b
- 写出 `manifest.json` 三重结构：`variableSnapshot` / `variableUsage` / `confirmations`（外加 `globalInstall`、`refs` 预留标记）
- `--impact VAR [新值]` 输出结构化 diff 预览

导出 `buildIndex(projectDir)`、`impactPreview(projectDir, varName, newValue)`、`extractVariableDoc(src, declIndex)`。

---

## `docgen.mjs` — 文档站 + 注释校验

```bash
node layout/scripts/docgen.mjs --project <dir> [--check-only]
```

产物 `docs/index.html`（左侧文件树 + 右侧函数卡片；变量索引标签页）与 `docs/data.json`。
校验：函数四要素（功能 / 实现原理 / 每个 `@param` / 非 void 的 `@returns`）；变量 作用 / 影响范围 / 可调范围；tokens 额外要 可选值 或 临界参数。
缺项 → 退出码 1，不生成文档。

导出 `parseDocComment(raw)`、`extractDeclarations(src, file)`、`validateDeclarations(decls, file, warnings)`、`renderDocsHtml(data)`。

---

## `serializers/`

```bash
node drawio/scripts/serializers/index.mjs --project <dir> --target react,remotion,preview,drawio
node drawio/scripts/serializers/react.mjs    --project <dir>
node drawio/scripts/serializers/remotion.mjs --project <dir> [--breakpoint desktop]
node drawio/scripts/serializers/preview.mjs  --project <dir> [--scale 1] [--style positioning|diagram|poster]
node drawio/scripts/serializers/drawio.mjs   --project <dir> [--no-png]
python3 drawio/scripts/serializers/pil.py    --tree <json> --out <png> [--scale] [--centers] [--hide a,b] [--time-label "..."]
python3 drawio/scripts/serializers/drawio_png.py --drawio <file>.drawio --out <png> [--scale]
```

| 目标 | 产物 |
|---|---|
| `react` | `src/serializers/Layout.tsx`（`data-layout-id` 便于测试定位） |
| `remotion` | `src/serializers/Composition.tsx` + `<Name>Meta` |
| `preview` | `preview/<bp>.svg` 与 `.png`（PNG 需 Pillow；可用 `LAYOUT_ENGINE_PYTHON` 指定解释器） |
| `drawio` | `drawio/<bp>.drawio` + `drawio/<bp>.png`（非 drawio 项目自动跳过，退出码 0） |
| `drawio-cli` | `drawio/export/<bp>.drawio.{png,svg,pdf}`（内嵌 XML；本机无 draw.io Desktop 时自动跳过，退出码 0，`--require` 可强制失败） |

**先确认后生成**：每个序列化器走 `gate.mjs` / `_gate.py`；若用 `--allow-unconfirmed` 跳过确认，
产物一律加 `PREVIEW-` 文件名前缀（位图再加水印），因此正常文件名的交付稿只能来自「确认 B 之后」。

`--style` 三种渲染风格：

| 风格 | 内容 | 用途 |
|---|---|---|
| `positioning`（默认） | 区域圈选 + 编号 + 尺寸 | 核对几何 |
| `diagram` | 关闭尺寸/编号/画布信息，渲染节点的 `note` 文本并垂直居中（线框级） | 结构说明 |
| `poster` | 走 `diagram.py`：圆角卡片、按区块配色、字阶、连接符、柔和阴影 | **交付海报** |

`note` 是 Layout Tree 的可选展示字段（`string[]`），**不参与几何计算与校验**，只影响渲染：SVG 与 PNG 都会在其盒子内绘制这些说明行。示例见 `examples/architecture/`。

---

## `measure.mjs` — 成图前先量（密度 / 可读性）

```bash
node layout/scripts/measure.mjs --project <dir> [--min-occupancy 0.5] [--max-band 96] [--max-width 1600] [--strict]
```

把「图空不空、字读不读得清」量成数字：容器内容带占比、画布空白带、标签盒多余、字号缩放可读性。
是【成图复审】询问点的机器依据：先跑它，把数字给用户，不达标先问再动。`--strict` 可当闸门（有 fail 项退出非 0）。
阈值按项目可调（用户指定的阈值优先）。

---

## 共享工具

| 模块 | 作用 |
|---|---|
| `layout/scripts/layout-engine/cli.mjs` | `parseArgs` / `splitList`：统一命令行解析。未知选项连同取值一起忽略（曾被当成文件路径读） |
| `layout/scripts/layout-engine/hash.mjs` | `hashLayoutTree`（**只对几何载荷**取哈希，含可选 `edges`）+ `HASH_VERSION` |
| `layout/scripts/layout-engine/confirm-store.mjs` | `positioning/confirmed.json` 的读写与去重 |
| `layout/scripts/layout-engine/ast.mjs` | TS Compiler API 的变量归属分析（`refs` 优先，其次 AST，最后 `(unknown)`） |
| `drawio/scripts/xml.mjs` | XML 转义 / 构建 / **独立严格解析器**（drawio 自检用；属性里的换行会写成 `&#10;`，避免被解析器归一化成空格） |
| `drawio/scripts/icons/build-catalog.mjs` | 扫描 `drawio/assets/icons/` → `catalog.json`（逻辑名 → svg/配套位图）；`--list` 列可用名，`--check` 校验一致性 |
| `drawio/scripts/serializers/_gate.py` | Python 序列化器的闸门（复用同一份 JS 判定，不在 Python 里重写哈希） |
| `drawio/scripts/serializers/_visual.py` | Python 渲染通道的共享视觉 primitives：线性渐变 / 高斯柔影 / 圆角蒙版 / 字体族回退链解析（`FONT_REGISTRY`）；只做视觉计算，不碰布局几何 |

### `HASH_VERSION`：区分「布局变了」与「算法变了」

指纹只覆盖几何载荷（`canvas` + 每节点 `{id, depth, x, y, w, h, expr, children}`）：

- 移动 1px / 改公式 / 挪一个连线端点或途经点 → 确认失效，必须重新确认；
- 改 `note` / 加 `refs` / 改 `kind`（配色形状） / 改 `role`、`arrow`（线型） → 不必重新确认。

记录里会写 `hashVersion`。**修改哈希定义本身会让既有确认全部失效**（fail-closed），
但报错会明确写成「哈希定义已升级（记录 v1 → 当前 v2）」，而不是误报「layout-tree 发生变化」——
后者会把排查方向带偏。

### 交付范围可以持久化

```bash
node layout/scripts/indexer.mjs --project <dir> --scope desktop   # → manifest.deliveryScope = ["desktop"]
```

之后 `check-confirmation` 不带 `--scope` 时会**默认读 manifest.deliveryScope**，
「只交付桌面端」因此是一个可持久化、可机器校验的决定，而不是每次手敲参数。

## `serializers/drawio.mjs` — draw.io 架构图

```bash
node drawio/scripts/serializers/drawio.mjs --project <dir> [--no-png]
```

- **几何零计算**：节点 x/y/w/h 与连线端点/途经点全部原样取自树（`edges[]`）；
- **视觉零硬编码**：中国色 / 字阶 / 圆角百分比 / 填充混合比 / 边距下限 / 渐变末端比 / 阴影参数全部读快照 token
  （`DRAWIO_*` / `TYPE_*` / `SHADOW_*` / `GRADIENT_*`）；
- **渐变与阴影**：`endMix > fillMix` 时输出 `gradientColor` + `gradientDirection`（角度映射四向）；
  `SHADOW_ALPHA > 0` 时输出原生 `shadow=1` 并把参数写进 `leShadow*` 自定义 style 键，
  供 `drawio_png.py` 同源渲染（draw.io 忽略未知键）；
- 所有 mxCell 都 `parent="1"`（平铺）：Layout Tree 坐标是绝对的，嵌套会逼序列化器做减法，就是几何计算；
- 产物：`drawio/<bp>.drawio`（可导入 draw.io 编辑）与 `drawio/<bp>.png`。
- **技术栈图标**：`kind:"icon"` 节点渲染为 `shape=image`；SVG 用百分号编码 data URI 内嵌（避
  免 mxGraph 按 `;` 分隔 style 时的截断），无 SVG 的图标用相对路径并拷进 `drawio/icons/`；
  同时写入自定义属性 `leIcon` / `leIconRaster` 供 `drawio_png.py` 与 `check-drawio` 使用。

## `serializers/drawio_cli.mjs` — draw.io Desktop CLI 导出

```bash
node drawio/scripts/serializers/drawio_cli.mjs --project <dir> [--format png,svg,pdf] [--require] [--check]
```

- 调用官方 CLI：`drawio -x -f <fmt> -e -b 10 -o <out> <in>`，`-e` 内嵌图表 XML；
- **无 CLI 时优雅降级**（打印安装指引并跳过）；`--check` 只报告可用性，`--require` 强制失败；
- 同样受确认闸门管辖（与 `drawio.mjs` 一致，未确认不放行）。
- 安装与验证见 [references/install-drawio.md](../drawio/references/install-drawio.md)（先检测、先确认、只用可信源）。

## `serializers/drawio_png.py` — .drawio → PNG（同源渲染）

```bash
python3 drawio/scripts/serializers/drawio_png.py --drawio drawio/hwsync.drawio --out drawio/hwsync.png
```

- **只读 XML**：PNG 不读 Layout Tree，因此「图与 XML 一致」是结构保证而不是人工核对；
- 端点由 `source`/`target` 几何 + `exitX/exitY`（源）与 `entryX/entryY`（目标）推出，两者都写在 XML 里；
- 系统没有 CJK 字体时**拒绝渲染**（不交一张全是豆腐块的图）；
- 同样受 `_gate.py` 确认闸门管辖，不能从后门出图；
- 图标节点（`shape=image`）优先用 `leIconRaster` 指向的配套 PNG（与 `.drawio` 内嵌的 SVG 同一套素材），
  无则回退解码 style 里内嵌的位图 data URI；按纵横比缩放居中。

## `validate/check-drawio.mjs` — 架构图自检

```bash
node drawio/scripts/validate/check-drawio.mjs --project <dir>
```

它把 drawio 规范第七节的人工清单变成机器判定，且**只读产物**：

1. XML 可被解析——调用 `layout-engine/xml.mjs` 的**独立严格解析器**（不是生成器自证）；
2. mxfile → diagram → mxGraphModel → root → mxCell(0,1) 结构完整；
3. 节点/连线全覆盖，且 **XML 几何逐字段等于 Layout Tree**（x/y/width/height、via、source/target、exit/entry、线型、箭头）；
4. 文字按中西文宽度预算不截断、按行高不竖向溢出；
5. 层标题带不压子节点；文字盒两两不重叠（含连线标签）；
6. 图例存在且非空；
7. 四周边距 ≥ `DRAWIO_MIN_MARGIN`；
8. 系统里有 CJK 字体（否则警告）；
9. 技术栈图标：逻辑名存在于 `catalog.json`、`leIcon` 与树一致、图标盒在卡片内且不侵入文字区、
   卡片声明的 `icon` 与 `kind:"icon"` 子节点一一对应。

它在**渲染之前**运行（验证层），对内存里的序列化结果检查；若 `drawio/` 下已有产物，还会比对一次以抓「产物过期」。

## `layout.config.json`

```json
{ "kind": "drawio", "breakpoints": ["hwsync"] }
```

`build-tree.mjs` 读它决定构建哪几张画布。缺省（无此文件）仍为 `desktop + mobile`；
drawio 项目是**单画布**产物，刻意不产出空的 mobile 树。

```bash
python3 drawio/scripts/serializers/diagram.py --tree layout-tree/desktop.json --out preview/desktop.png [--footer "..."]
```

- **几何零计算**：坐标原样取自 Layout Tree；
- **视觉零硬编码**：配色/字阶/圆角/阴影/渐变全部从 `variableSnapshot` 的设计 token 读取
  （`COLOR_*` / `TYPE_*` / `RADIUS_*` / `SHADOW_*` / `GRADIENT_*` / `FONT_FAMILY`），因此换主题不需要改这个文件；
- **视觉 primitives 共享**：渐变、高斯柔影、字体族回退链来自 `_visual.py`（与 `drawio_png.py` 同一套）；
  阴影是离屏图层 + GaussianBlur 的真柔影，卡片表面是 `GRADIENT_ANGLE` 方向的线性渐变；
- 画法：区块圆角卡片 + 标题色点 + 发丝线；子项白卡 + 左侧强调条；
  同行相邻卡片之间画居中雪佛龙；`SS=2` 超采样让圆角与阴影平滑（渲染细节，不改布局）。

与 `pil.py` 的分工：`pil.py` 是**几何核对图**（尺寸 / expr 出处 / 四向距离），
`diagram.py` 是**交付海报**。两者都只读同一棵树，不互相替代。

## `storyboard/`

```bash
node drawio/scripts/storyboard/index.mjs --project <dir>
```

输入 `<project>/storyboard.json`（见 [05-storyboard-remotion.md](../layout/references/05-storyboard-remotion.md)）。
产物：`positioning/storyboard/timeline.svg`、`timeline.json`、`kf-NN-tX.Xs.svg`。

导出：`computeKeyframeTimes(spec)`、`hiddenAt(spec, t)`、`intervalAt(times, t)`、`renderKeyframes(...)`、`toRemotionTimeline(spec)`、`renderTimelineSvg(spec, times, tree)`。
