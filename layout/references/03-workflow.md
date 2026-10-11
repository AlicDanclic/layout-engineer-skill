# 03 · 完整工作流

```
① 需求解析
   └─ 输出元素清单 + 文本 box tree
        ↓
   【确认节点 A：结构确认】
        ↓
② 变量定义（tokens.ts + layout.ts，四行注释）
③ 布局计算（纯函数 → 双端 Layout Tree + expr）
        ↓
④ positioning-viewer 启动（右侧渲染 + 左侧设置面板）
   【确认节点 B：交互式定位确认，双端各确认一次】
        ↓ 若提出修改：查 variableUsage → 输出结构化 diff 预览 → 用户确认 → 回到 ②
⑤ 验证层运行（lint / assert / verify / check-env）
⑥ 最终渲染（按产物类型调用对应序列化器）
⑦ docgen 生成文档站
⑧ 双端预览图渲染
⑨ 归档（目录结构 + manifest.json）
```

## ① 需求解析 → 结构确认

先把需求翻译成**元素清单 + 文本 box tree**，包含：

- 断点与画布尺寸（desktop / mobile 各多少）
- 每个元素的层级（①②③…编号）、父子关系
- 使用的变量名（而不是数值）
- 排列方式（通栏 / 网格 / 垂直列表 / 贴底）

**输出示例**：

```
canvas 1440×900（桌面端）/ 390×844（移动端）
├─ ① header（通栏，高 HEADER_H）
├─ ② sidebar（左栏，宽 SIDEBAR_W，与 header 底部对齐）
│   └─ ②a nav-item × 5（垂直排列，间距 SPACE.sm）
├─ ③ card-list（右区，与 sidebar 间距 GAP_LG）
│   └─ ③a card × 6（网格 3 列，间距 SPACE.md）
└─ ④ footer（通栏，贴 canvas 底部）
```

**必须在用户确认后才继续。** 此节点成本极低，用来挡掉方向性返工。

> **draw.io 架构图**额外多一步：**必须先问用户要哪几个视图**（CLI / GUI / 硬件 / 软硬协同）。
> 一个视图 = 一个项目 = 一份 `.drawio` + 一张 PNG，所以“要几张图”是方向性决定，
> 比任何几何细节都贵。见 [07-drawio.md](../../drawio/references/07-drawio.md)。

## ② 变量定义

- `variables/tokens.ts`：SPACE / BREAKPOINTS / 颜色 / 字体，四行注释。
- `variables/layout.ts`：元素特定常量（HEADER_H、SIDEBAR_W、COLUMNS、COLUMN_RATIO…），三行注释。

新增间距前先问：能不能用现成刻度？不能才扩 `SPACE`（并注明影响面）。

## ③ 布局计算

- `src/layout/index.ts` 导出 `buildLayout(breakpoint): LayoutTree`。
- 双端共用同一套排布函数（如 `cardBox` / `navNodes`），只有变量取值不同。
- 每个节点写 `expr`；每个容器内子元素的坐标写成对父容器区域的约束。
- 运行：

```bash
node layout/scripts/build-tree.mjs --project <dir>
```

产物：`layout-tree/desktop.json`、`layout-tree/mobile.json`。

## ④ 交互式定位确认

```bash
node layout/scripts/positioning-viewer/serve.mjs --project <dir> --port 5173
```

1. 浏览器打开提示地址；
2. 用左侧面板逐项开关：区域圈选 / 四向距离 / 数值来源表达式；
3. 悬停元素可在图上看到它到四边的距离线；
4. 切到 mobile 再确认一次；
5. 点「确认布局」→ 写入 `positioning/confirmed-*.svg`、`positioning/confirmed.json`、`viewer.html`。

确认记录保存每个断点的 `treeHash`。**确认之后只要动了布局，指纹就变，确认自动失效**，
`run-all` 与渲染入口会直接拦下，必须重新确认。这保证「确认的一定是被渲染的那一版」。

结构确认（节点 A）也要落盘：

```bash
node layout/scripts/confirm.mjs --project <dir> --node structure --source user-chat --note "用户回复：结构 OK"
```

> AI 不得自己调 `/api/confirm`。用户只在对话里说「可以」时，把 `confirmationSource` 记为
> `user-chat` 并保留原话；机器可查的部分交给 `check-confirmation`。

### 修改回路（用户说「这里不对」）

```bash
node layout/scripts/indexer.mjs --project <dir> --impact HEADER_H 56
```

把输出贴给用户确认 → 用户点头 → 改变量 → 回到 ③。**不要直接改坐标。**

## ⑤ 验证层

```bash
node layout/scripts/validate/run-all.mjs --project <dir>
```

| 脚本 | 校验内容 | 失败处理 |
|---|---|---|
| `lint-geometry` | 几何相关裸字面量（含表达式内部） | 编译期报错 |
| `assert-layout` | 不越界、同层兄弟不重叠、间距 ∈ 刻度、纯函数复算一致 | 阻断交付 |
| `verify-positioning` | 每个 `x/y/w/h` ↔ `expr` 一致 | 阻断确认节点 B |
| `check-env` | `.nvmrc` / `.venv` / 锁文件 / `globalInstall` 自报 | 阻断交付 |
| `check-confirmation` | 确认记录存在且与当前 layout-tree / timeline 指纹一致 | 阻断渲染 |
| `check-confirmation` | 确认记录存在、指纹与当前 layout-tree 一致、`confirmed-*.svg` 存在 | 阻断渲染 |
| `docgen` | 注释四要素、变量注释完整性 | 缺项即报错 |
| `indexer` | 生成 `manifest.json` 反向索引 | — |

原则：**凡是机器能查的，不允许出现在人工 checklist 里。**

## ⑥ 最终渲染（闸门读文件，不读对话）

渲染序列化器运行的**第一步**就是检查 `manifest.confirmations` 与 `positioning/confirmed.json`，
不通过直接抛错退出——AI 即使想跳过确认直接渲染，也会在第一步被拦下。

- 静态产物：`check-confirmation --mode static`（结构 + 双端定位，指纹匹配）
- 视频产物：`check-confirmation --mode storyboard`（时间轴指纹），与静态分开
- CI / 示例归档：`--allow-unconfirmed` 跳过，但会打印警告且来源不会记成人工

```bash
node drawio/scripts/serializers/index.mjs --project <dir> --target all
```



```bash
node drawio/scripts/serializers/index.mjs --project <dir> --target react,remotion,preview
# 或 --target all
```

- `react` → `src/serializers/Layout.tsx`（百分比坐标，自适应容器）
- `remotion` → `src/serializers/Composition.tsx`（消费 `positioning/storyboard/timeline.json`）
- `preview` → `preview/{desktop,mobile}.svg`（+ `png`，需 Pillow）

图片产物也可直接用 `drawio/scripts/serializers/pil.py`。视频顺序：先 `storyboard` 再 `remotion`。

## ⑦ 文档站

```bash
node layout/scripts/docgen.mjs --project <dir>
```

产物 `docs/index.html`：左侧文件结构树，右侧函数文档卡片（签名与参数表 / 返回值 / 功能 / 实现原理），另有变量索引页（四行注释 + 引用元素）。

## ⑧ 双端预览图

由 `preview` 序列化器产生，**必须**由真实代码在对应断点渲染，禁止手工拼图。

## ⑨ 归档

确认目录结构与 `manifest.json`（见 [01-standards.md](01-standards.md) 规范六）。

## 响应式规范

- **双断点共享一套公式**：断点只出现在 `context(breakpoint)`；公式层完全不感知断点。
- 移动端不需要的元素用「宽度取 0」自然退化（如 `SIDEBAR_W_MOBILE = 0`），而不是复制一套公式。
- 可变宽度使用**比例参数**（如 `COLUMN_RATIO = 1 / 3`），相对父容器宽度换算为像素。
- 断点走 `BREAKPOINTS` 常量，临界参数必须在注释中写明。
- 每次交付双端预览图；双端 Layout Tree 都需经确认节点 B（查看器中切到 mobile 确认一次）。
