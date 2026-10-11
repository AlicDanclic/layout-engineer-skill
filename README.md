# layout-engineer

> 让 AI 像工程师一样生成前端页面、图片与 Remotion 视频——几何关系全部通过代码计算，布局在用户确认后才渲染，验证由脚本强制执行，过程产物全部归档。

这是一个 [Agent Skill](https://agentskills.io/specification)，主指令见 [SKILL.md](SKILL.md)。
它内部物理分两层：[`layout/`](layout/README.md)（计算层：算几何）与 [`drawio/`](drawio/README.md)（绘制层：画图）。

下面这张是**由 layout-engineer 自己生成**的架构图 —— 盒子位置全部来自约束表达式，
经 `lint-geometry / assert-layout / verify-positioning` 全量校验后渲染，
源工程在 [`examples/architecture/`](examples/architecture)：

![由 skill 自身生成的架构图（交付海报风格）](assets/architecture-poster.png)

复现（一键）：

```bash
cd examples/architecture
node ../../layout/scripts/build-tree.mjs --project .          # 约束表达式 -> Layout Tree
node ../../layout/scripts/validate/run-all.mjs --project .   # 全量校验（不通过禁止渲染）
node ../../drawio/scripts/serializers/preview.mjs --project . --style poster    # 交付海报
```

## 还能生成 draw.io 系统架构图

同一棵树也能序列化成 draw.io：节点框、**连线的锚点与途经点**都是布局纯函数算出来并存进树里的
（`edges[]` 带 `expr` 出处），`drawio.mjs` 只做字段映射，`drawio_png.py` 再**解析这份 XML** 渲染 PNG——
所以「图与 XML 严格一致」是结构保证，不是人工比对。配色走中国色十档 token，随快照归档。

**框架 / 编程语言 / 平台图标**：`drawio/assets/icons/` 内置图标素材库（含 `catalog.json`），节点用
`icon: string[]` 挂图标，`builder.iconSlots()` 把图标盒算进树里，渲成「左图标 + 右文字」；
`.drawio` 内嵌 SVG，PNG 通道用配套位图。

```bash
node scripts/new-project.mjs --name arch-hwsync --kind drawio --view hwsync --out output/arch
node layout/scripts/build-tree.mjs --project output/arch/arch-hwsync
node layout/scripts/validate/run-all.mjs --project output/arch/arch-hwsync
node drawio/scripts/serializers/index.mjs --project output/arch/arch-hwsync --target drawio
```

一个视图 = 一个项目 = 一个 `.drawio` + 一张 PNG；四类视图（CLI / GUI / 硬件 / 软硬协同）
与完整规则见 [references/07-drawio.md](drawio/references/07-drawio.md)，示例见 [`examples/drawio-hwsync/`](examples/drawio-hwsync)。

需要**通用 draw.io 图**（流程图 / ER / 时序图）或导出 PNG/SVG/PDF（内嵌 XML）时，
走自由绘图模式：[references/08-drawio-freeform.md](drawio/references/08-drawio-freeform.md)；
官方 CLI 导出见 `drawio/scripts/serializers/drawio_cli.mjs`（无 CLI 时自动降级跳过），
安装与验证见 [references/install-drawio.md](drawio/references/install-drawio.md)。

## 它解决什么

| 痛点 | 机制 |
|---|---|
| AI 凭感觉给尺寸位置，结果不可复现 | 几何即代码：约束表达式 + 变量区分层 |
| 用户看到成品才发现布局不对，返工成本高 | 两级确认（结构确认 → 交互式定位确认） |
| 代码注释/文档与实现脱节 | 四要素注释 + `docgen` 自动生成文档站 |
| 「看起来对」但无人校验 | `validate/run-all` 强制验证，不通过即阻断交付 |

核心是 **Layout Tree**：布局只计算一次（纯函数，每个数值都带两段式 `expr` 出处），React / Remotion / 位图 / **draw.io 架构图** 四种产物只是对它的序列化。

**三项结构性保证**：同源（图上 88px 与页面 88px 是同一个数字）· 可修改（改几何只有「改变量→重算树→重出图」一条路）· 可验证（几何集中在一棵树里，越界/重叠/间距刻度才能写成脚本）。

**两道硬闸门**：确认状态落盘在 `positioning/confirmed.json` 并绑定当次布局指纹，渲染序列化器第一步就读它——未确认或确认已失效直接抛错退出。

## 快速上手

```bash
# 环境：Node >= 22.6（需要 TS type stripping），零运行时依赖
node --version

# 依赖：AST 反向索引用 typescript（可选，缺失自动回退）
npm install

# 自检
node tests/run.mjs

# 跑一遍现成示例
node layout/scripts/build-tree.mjs --project examples/landing
node layout/scripts/validate/run-all.mjs --project examples/landing
node drawio/scripts/serializers/index.mjs --project examples/landing --target all
node drawio/scripts/storyboard/index.mjs --project examples/landing
node layout/scripts/positioning-viewer/serve.mjs --project examples/landing   # 默认对外暴露端口，打印可达地址

# 新建项目
node scripts/new-project.mjs --name landing --out output/ --title "产品落地页"
```

## 目录（同一技能，物理分两层）

```
SKILL.md               主指令：两层结构 + 规范 + 工作流 + 禁止事项
references/04-scripts.md  跨层脚本索引
scripts/new-project.mjs   跨层脚手架入口（--kind layout|drawio）

drawio/                ← 绘制层：把 Layout Tree（以及通用绘图）画成 draw.io 与其它产物
  scripts/serializers/   drawio.mjs + drawio_png.py + drawio_cli.mjs / react / remotion
                         / preview / diagram.py(交付海报) / pil.py(核对图) / index / gate
  scripts/validate/      check-drawio.mjs（架构图自检）
  scripts/icons/         build-catalog.mjs：扫描 drawio/assets/icons/ 生成 catalog.json
  scripts/storyboard/    关键帧 + 时间轴轨道
  scripts/xml.mjs        XML 序列化/解析（drawio 专用）
  assets/icons/          技术栈图标素材库（svg + 配套位图）+ catalog.json
  templates/drawio/      drawio 项目骨架
  references/            07 架构图 / 08 通用绘图 / install-drawio

layout/                ← 计算层：算几何、验证、确认。唯一产出 Layout Tree
  scripts/layout-engine/   Layout Tree 类型 + builder（anchor/route/edge/iconSlots）+ schema + IO + AST + 指纹 + 确认存储
  scripts/positioning-viewer/ 交互式定位查看器（render-core 同构 SVG 渲染器）
  scripts/validate/        lint-geometry / assert-layout / verify-positioning / check-env
                           / check-confirmation（闸门）/ run-all（八步总入口）
  scripts/                 build-tree / indexer / confirm / print-tree / docgen
  templates/              tokens/layout 样板 + 普通项目骨架
  references/             01 规范 / 02 Layout Tree / 03 工作流 / 05 Storyboard / 06 排错

examples/landing/      可跑通的双端示例（含 storyboard）
examples/architecture/ 用本 Skill 生成的自身架构图（海报）
examples/drawio-hwsync/ draw.io 软硬协同架构图（6 层 / 20 节点 / 15 连线）
tests/run.mjs          单元 + 集成测试
```

**两层契约**：`layout-tree/<canvas>.json`（含 `elements[]` + `edges[]` + `expr`）。
计算层产出，绘制层只读；依赖单向 `drawio/ → layout/`。

## 产物长什么样

`examples/landing/` 运行后：

```
layout-tree/{desktop,mobile}.json      双端布局中间表示（含 variableSnapshot）
positioning/confirmed-{desktop,mobile}.svg   用户确认时的定位图
positioning/viewer.html                查看器快照
positioning/storyboard/kf-*.svg        视频关键帧定位图
positioning/storyboard/timeline.svg    时间轴轨道图
preview/{desktop,mobile}.{svg,png}     双端预览图
docs/index.html                        自动生成的文档站
manifest.json                          变量反向索引
src/serializers/{Layout,Composition}.tsx
```

## 验证层（八步，失败即阻断）

```bash
node layout/scripts/validate/run-all.mjs --project <dir>
```

`lint-geometry`（几何裸字面量 + ESLint 插件）→ `assert-layout`（越界 / 兄弟重叠 / 间距刻度 / expr 完整 / 连线不横穿节点 / 连线不共线重合 / 纯函数复算）→ `verify-positioning`（expr 两段复算）→ `check-env`（环境隔离 + `globalInstall` 自报）→ `indexer`（manifest 三重结构）→ `check-confirmation`（**确认闸门**）→ `check-drawio`（架构图：XML 可解析 / 几何与树一致 / 文字不截断不溢出 / 图例与边距）→ `docgen`（注释四要素）。

渲染入口还有第二道闸门：`serializers/*.mjs` 各自调用 `gate.mjs`，Python 侧走 `_gate.py`，直接单跑某个序列化器也绕不过去。

机器无法代替用户判断的部分剩四项：确认节点 A（结构 box tree；架构图还需确认要哪几个视图）、
确认节点 B（双端定位图 / 关键帧）、drawio 的 PNG 亲眼核对（文字 / 连线 / 层 / 图例 / 边距）、
参数确认（配色 / 字号 / 图例 / 密度目标）与成图复审的 `measure.mjs` 数字。

## 视觉层

几何正确 ≠ 好看。视觉由**设计 token**（`COLOR` / `TYPE` / `RADIUS` / `SHADOW` / `GRADIENT` / `FONT`，与 `SPACE` 同级写在 `tokens.ts`
并随 `variableSnapshot` 归档）+ **渲染器**（`diagram.py` 交付海报 / `pil.py` 几何核对 /
`drawio.mjs` + `drawio_png.py` 架构图）两层决定。阴影是分级的真高斯柔影，卡片表面有方向性渐变，
两条 Python 渲染通道共用 `_visual.py`  primitives，保证同一个 token 只有一种画法。

不想从零调参：`layout/templates/themes/` 内置成套主题预设（paper 宣纸墨 / jade 青瓷 / deepspace 深空），
脚手架时 `--theme <名>` 选定视觉起点（`--list-themes` 查看），之后仍只动 token 微调。

架构图另有一层要求：**连线可分辨**——同一空隙里的多条平行连线由 `bandRouter()` / `channelRouter()`
分配独立轨道与标签槽位，`assert-layout` 会把共线重合判为失败，否则多条边会画成一条线。

```bash
node drawio/scripts/serializers/preview.mjs --project <dir> --style poster       # 交付海报
node drawio/scripts/serializers/preview.mjs --project <dir> --style positioning  # 几何核对
```

迭代成本是重点：改配色/字号/圆角只动 token，几何断言不受影响；渲染器不写死任何颜色字号。

## 已知边界

- `indexer` 的 AST 归属是**启发式**：辅助函数里借用的变量会落进 `(unknown)` 桶。schema 已预留
  `refs` 字段，节点显式声明后即为「读字段」，误差归零。
- 全局安装检测 v1 依赖 `manifest.globalInstall` **自报**（软约束），v1.1 计划改为包装 `npm/pip` 做审计。
- 位图（PNG）无法挂 `data-*` 属性，可追溯性由定位图承担；DOM/JSX 产物逐节点挂 `data-layout-id` / `data-expr`。

## 许可

MIT
