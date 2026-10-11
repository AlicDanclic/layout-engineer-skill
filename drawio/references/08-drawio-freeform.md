# 08 · draw.io 通用绘图（自由绘图模式）

> 本文件把独立的「Draw.io 专业绘图」技能并入 layout-engineer。相关版权声明见
> [`../LICENSE-DRAWIO.md`](../LICENSE-DRAWIO.md)（Copyright (c) 2026 江一帆）。

本 Skill 的 draw.io 能力有两种模式，**共用同一套 `.drawio` 规范、同一套导出通道、同一套安装指引**：

| 模式 | 入口 | 几何来源 | 适用 |
|---|---|---|---|
| **A · 架构图模式** | [`07-drawio.md`](07-drawio.md) | Layout Tree（可验证、可复现、强制确认） | 系统架构图（CLI / GUI / 硬件 / 软硬协同）、需要归档与几何校验的图 |
| **B · 通用绘图模式**（本文） | 直接生成 `.drawio` | 生成时的坐标（不进入 Layout Tree） | 流程图、ER 图、时序图、泳道图等结构化但不要求几何追溯的图 |

选择原则：**只要这张图需要「改一处变量 → 全图重算 / 双端确认 / 归档复现」，就走模式 A；
其余一次性或轻量的结构化图，走模式 B。** 两种模式产出的都是原生可编辑的 `.drawio`。

---

## 一、产物与命名

- 原生源文件：`<name>.drawio`（mxGraphModel XML，可直接导入 draw.io 编辑）。
- 导出文件用**双扩展名**，表明其中内嵌了图表 XML（可回 draw.io 继续编辑）：
  - `<name>.drawio.png` / `<name>.drawio.svg` / `<name>.drawio.pdf`
- 默认保留 `.drawio` 源文件；只有用户明确要求删除、且导出文件验证通过后才删除。

| 导出格式 | 能否内嵌 XML | 说明 |
|---|---|---|
| `png` | ✅（`-e`） | 通用位图，导出物仍可在 draw.io 中还原编辑 |
| `svg` | ✅（`-e`） | 矢量，适合文档与缩放 |
| `pdf` | ✅（`-e`） | 可打印 |
| `jpg` | ❌ | 有损、不支持内嵌 XML |

---

## 二、.drawio XML 规范

`.drawio` 是原生 mxGraphModel XML。**始终直接生成 XML**——Mermaid / CSV 需要服务端转换，无法保存为原生文件。

### 2.1 基本结构

```xml
<mxGraphModel>
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <!-- 图形元素 parent="1" -->
  </root>
</mxGraphModel>
```

- `id="0"` 是根图层，`id="1"` 是默认父图层（`parent="0"`）。
- 其余元素默认 `parent="1"`，或指向某个 group / layer 的 id。
- 顶点 `vertex="1"` 与边 `edge="1"` 互斥，`id` 必须唯一。
- **始终使用未压缩 XML**（不要 `compressed="true"`）。

### 2.2 常用样式

| 属性 | 取值 | 用途 |
|---|---|---|
| `rounded=1` | 0 / 1 | 圆角 |
| `whiteSpace=wrap` | wrap | 自动换行 |
| `fillColor=#dae8fc` | 十六进制 | 填充 |
| `strokeColor=#6c8ebf` | 十六进制 | 描边 |
| `fontColor=#333333` | 十六进制 | 文字 |
| `shape=cylinder3` | 形状名 | 数据库柱体 |
| `shape=mxgraph.flowchart.document` | 形状名 | 文档形状 |
| `ellipse` / `rhombus` | 样式关键字 | 圆 / 菱形 |
| `edgeStyle=orthogonalEdgeStyle` | 关键字 | 直角连线 |
| `dashed=1` | 0 / 1 | 虚线 |
| `swimlane` | 关键字 | 带标题栏的容器 |
| `group` | 关键字 | 不可见容器 |
| `container=1` | 0 / 1 | 让任意形状成为容器 |
| `pointerEvents=0` | 0 / 1 | 容器不再捕获连接 |

节点/连线示例：

```xml
<mxCell id="2" value="标签" style="rounded=1;whiteSpace=wrap;" vertex="1" parent="1">
  <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
</mxCell>
<mxCell id="3" value="判定？" style="rhombus;whiteSpace=wrap;" vertex="1" parent="1">
  <mxGeometry x="100" y="200" width="120" height="80" as="geometry"/>
</mxCell>
<mxCell id="4" value="是" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="2" target="3" parent="1">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
```

### 2.3 连线与路由

draw.io **没有内建避让**，所以要自己规划：

- 优先 `edgeStyle=orthogonalEdgeStyle`；用 `exitX/exitY`、`entryX/entryY`（0–1）指定从哪条边进出，把连接分散到不同的边。
- 节点间**留足空间**（≥60px，横向推荐 200px、纵向 120px），并给箭头预留 ≥20px 直线段。
- 需要显式拐点时用 `<Array as="points">`：

```xml
<mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="a" target="b">
  <mxGeometry relative="1" as="geometry">
    <Array as="points">
      <mxPoint x="300" y="150"/>
      <mxPoint x="300" y="250"/>
    </Array>
  </mxGeometry>
</mxCell>
```

### 2.4 容器与分组

| 类型 | 样式 | 用途 |
|---|---|---|
| 分组（不可见） | `group;` | 无边框、不参与连接 |
| 泳道（带标题） | `swimlane;startSize=30;` | 需要标题栏的容器 |
| 自定义容器 | 任意形状 + `container=1;pointerEvents=0;` | 让任意形状充当容器 |

子元素坐标是**相对父容器**的：`parent=<containerId>`，`mxGeometry` 用相对坐标。

### 2.5 XML 合法性（硬性）

- **注释里绝不能出现 `--`**（XML 注释不允许双连字符），用单个连字符或改写。
- 属性值转义：`&amp;` `&lt;` `&gt;` `&quot;`；属性里的换行必须写成字符引用 `&#10;`。
- 每个 `mxCell` 的 `id` 唯一。
- 产物生成后必须能用 [`drawio/scripts/xml.mjs`](../scripts/xml.mjs) 的严格解析器反解（不靠生成器自证）。

---

## 三、导出

### 3.1 官方 draw.io Desktop CLI（PNG / SVG / PDF）

```bash
drawio -x -f <format> -e -b 10 -o <output> <input.drawio>
```

- `-x` 导出模式；`-f` 格式（png/svg/pdf/jpg）；`-e` 内嵌图表 XML（png/svg/pdf）；`-o` 输出；`-b 10` 边距。
- 本 Skill 已封装成 `drawio/scripts/serializers/drawio_cli.mjs`：

```bash
node drawio/scripts/serializers/drawio_cli.mjs --project <dir> --format png,svg,pdf
node drawio/scripts/serializers/drawio_cli.mjs --check        # 只报告本机 CLI 是否可用
```

无 CLI 时**优雅降级**：打印安装指引并跳过（PNG 通道仍可用 `drawio_png.py`）；加 `--require` 则强制失败。

### 3.2 CLI 定位（先 PATH，后绝对路径）

- macOS：`/Applications/draw.io.app/Contents/MacOS/draw.io`
- Linux：`drawio`（通常经 snap / apt / flatpak 在 PATH 上）
- Windows：`C:\Program Files\draw.io\draw.io.exe`

安装与验证严格遵循 [`install-drawio.md`](install-drawio.md)：**先检测再安装、仅在必要时触发、执行前必须取得用户明确确认、只使用可信来源、禁止静默/提权/第三方下载站。**

### 3.3 自研 PNG 通道（无需 draw.io）

模式 A 的架构图默认用 [`drawio_png.py`](../scripts/serializers/drawio_png.py) 渲染 PNG：
它**解析 `.drawio` 再画**，所以「PNG 与 XML 严格一致」是结构保证。这条通道不依赖本机安装 draw.io。

---

## 四、与 Layout Tree 模式的关系

- 模式 B 不强制进 Layout Tree，因此**不享受** `assert-layout` / `verify-positioning` / 确认闸门的保护。
- 若一张一度被当作「一次性」的图开始需要频繁修改、双端确认或几何追溯，**应当迁移到模式 A**：
  把坐标抽进 `variables/` 与 `src/layout/index.ts`，再走 [`03-workflow.md`](../../layout/references/03-workflow.md)。
- 迁移时可直接解析原 `.drawio` 的 `<mxCell vertex>` / `<mxCell edge>` 抽出节点框、边、标签
  （见 [`07-drawio.md`](07-drawio.md) 第五节「模式 B · 优化现有 .drawio」）。

---

## 五、技术栈图标（模式 B 也可用）

图标目录 [`assets/icons/catalog.json`](../assets/icons/catalog.json) 与素材是**两种模式共用**的。
模式 A 通过节点 `icon` 字段 + `builder.iconSlots()` 使用（见 `07-drawio.md`）；
模式 B 可把图标内嵌为 `shape=image` 的 `image=` 值（SVG 建议用百分号编码的 data URI，
避免 mxGraph 以 `;` 分隔 style 时的截断问题）。可用逻辑名：`python` `rust` `go` `react` `tauri`
`docker` `espressif` `stmicroelectronics` 等，见 `resources` 目录与
`node drawio/scripts/icons/build-catalog.mjs --list`。

---

## 六、禁止事项（通用绘图专章）

- ❌ 用 Mermaid / CSV 当交付物（无法原生编辑）；应生成 `.drawio`。
- ❌ XML 注释里出现 `--`。
- ❌ 只交导出文件不交 `.drawio`，或宣称可编辑却没有内嵌 XML。
- ❌ 不写途经点却指望 draw.io 自动绕开节点。
- ❌ 未经用户确认就安装 draw.io Desktop，或从第三方下载站获取安装包。
- ❌ 在需要几何追溯/双端确认的场景硬用模式 B（应迁移到模式 A）。

---

## 七、快速上手

```bash
# 1) 生成 .drawio（模式 B 直接写 mxGraph XML；模式 A 见 07）
# 2) 纯 Python 出 PNG（无需 draw.io）
python3 drawio/scripts/serializers/drawio_png.py --drawio <file>.drawio --out <file>.drawio.png
# 3) 需要 SVG / PDF 或官方渲染时，先确认已装 draw.io Desktop，再：
node drawio/scripts/serializers/drawio_cli.mjs --project <dir> --format png,svg,pdf
```
