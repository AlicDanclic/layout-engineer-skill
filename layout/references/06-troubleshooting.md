# 06 · 排错

## 常见失败与处理

### `build-tree` 报「不是纯函数」

同一个断点连续两次计算结果不一致。原因通常是计算函数里用了 `Math.random()`、`Date.now()`，或引用了会被修改的共享对象。

→ 把不确定来源移入 `variableSnapshot` 或在函数内重新构造对象。

### `build-tree` 报「必须导出 buildLayout(breakpoint)」

`src/layout/index.ts` 缺少具名导出。注意 Node 的 type stripping 要求导入带扩展名（`./tokens.ts`）。

### `lint-geometry` 命中但我认为合法

常见两类：

1. 表达式里塞了字面量 → 提到 `variables/`。
2. 数字出现在 `round(x, 2)` 的位数参数里 → 若它与其他几何标识符同表达式会被误报；把 `round(x, 2)` 拆成独立语句，或把位数收进常量。

CLI 输出已标注「理由」与源码片段，按提示改即可。

### `assert-layout` 报「间距不在 SPACE 刻度内」

- 间距确实写错了 → 改用刻度值；
- 是父容器内边距（不是兄弟间距）→ 不会进入本检查；
- 两个兄弟因排序相邻但实际中间还夹着别的元素 → 检查是否遗漏了某个元素的坐标导致错位。

### `assert-layout` 报「归档与重算结果不一致」

`layout-tree/*.json` 是旧的。重新：

```bash
node layout/scripts/build-tree.mjs --project <dir>
```

### `verify-positioning` 报「expr 复算 ≠ 实际」

expr 求值段里的变量不在 `variableSnapshot`，或数值写错。

- 把派生量补进 `variableSnapshot`（如 `CARD_AREA_X`、`CARD_W`）；
- 或修正 expr 末尾的数值段，使其能算出节点真实值；
- 注意容差为 0.02，四舍五入到两位小数即可。

### `check-env` 报缺 `.nvmrc` / 锁文件

```bash
printf '22\n' > .nvmrc
npm install --package-lock-only
```

### `docgen` 报「缺少功能：/实现原理：」

注释必须与代码同时写。补全四要素；若该 `/** */` 并非规范注释，删掉注释块或改成普通 `//`。

### PNG 预览被跳过

环境没有 Pillow。项目内安装：

```bash
python3 -m venv .venv && . .venv/bin/activate && pip install Pillow
```

或指定解释器：`LAYOUT_ENGINE_PYTHON=/path/to/python node drawio/scripts/serializers/preview.mjs ...`

### 关键帧数量过多

把多个轨道的 `enter / expanded / exit` 端点对齐，合并去重后自然落在 3~6 张。

### 服务器上跑 skill，本地浏览器打不开查看器

查看器默认监听 `0.0.0.0` 并会打印所有可达地址（localhost + 各网卡 IPv4），直接用打印出来的
`http://<服务器IP>:5173/` 打开即可。若仍打不开，按顺序排查：

1. 云厂商安全组 / 防火墙是否放行该端口；
2. 是否被 `--host 127.0.0.1` 限制成了仅本机；
3. 端口被占用 —— 启动日志会提示换 `--port`；
4. 需要公网加固时用 `--token <secret>`，然后用启动日志里带 `?token=` 的地址打开。

### 渲染提示「确认节点 B 未通过」/「确认闸门未通过」

- **缺少 `positioning/confirmation.json`** → 还没确认。启动查看器让用户点「确认布局」。
- **「确认已失效：确认后 layout-tree 发生变化」** → 确认之后动过布局（改了变量、重跑了 build-tree）。
  这是预期行为：必须重新走一次确认节点 B。
- **「缺少已确认的定位图」** → `confirmed-*.svg` 被删了，重新确认即可。
- **视频提示 `mode=storyboard`** → 关键帧还没确认，或确认后改了 `storyboard.json`
  （时间轴指纹变了）。`confirm.mjs --node storyboard` 重新确认。
- CI / 示例归档：`--allow-unconfirmed` 跳过（会警告），或 `check-confirmation --write-fixture`
  写一份明确标记为非人工的确认。

### 渲染提示「哈希定义已升级」

不是布局变了，是本 Skill 改了 `geometryPayload` 的形状（`hash.mjs` 里的 `HASH_VERSION` 变了）。
按 fail-closed 原则既有确认一律作废，重新确认一次即可。若确认后仍报，检查是否被加了
`--scope`（交付范围变化会让范围外的断点报未确认）。

### 「只交付一端」应该怎么做

```bash
node layout/scripts/indexer.mjs --project <dir> --scope desktop      # 把交付范围写进 manifest
node drawio/scripts/serializers/index.mjs --project <dir> --target all --scope desktop
```

注意这**违反《响应式规范》**（要求双端确认 + 双端预览）。它是一条显式的、有记录的降级路径，
不是默认行为；范围外的断点会在输出里被明确标注为「不参与判定」。

### `verify-positioning` 报「符号段无法复算：变量 X 不在 variableSnapshot 中」

`X` 通常是循环序号（`i` / `col` / `row`）。expr 的两段式要求**序号代入字面量**写进两段：

```
❌ "CARD_AREA_X + col*(CARD_W + SPACE.md) = 288 + 0 * (357.33 + 16)"
✅ "CARD_AREA_X + 0*(CARD_W + SPACE.md) = 288 + 0 * (357.33 + 16)"
```

### `assert-layout` 报「快照变量 X 属于间距类，但不在 SPACE 刻度内」

名字里含 `GAP / PAD / MARGIN / INSET` 的变量会被判定为间距类，取值必须落在 `SPACE` 集合里。
如果它其实不是间距（例如是尺寸），改名去掉这些词；如果确实是间距，改用刻度值。

### `docgen` 报「变量 ex 缺少「影响范围：」」

`/** */` 注释块紧邻的 `const` 会被当成「变量文档」检查四行。
若只是想写普通说明，改用 `//` 行注释。

### `--impact` 显示「影响元素：无」

反向索引靠扫描 `expr` 字符串里的标识符。若 expr 只写了快照键（`WF_CX0` / `GAP`）而没写来源变量名
（`ARCH_DESKTOP` / `HEADER_H`），就映射不回去。

→ 在 expr 的**符号段**补上来源变量名（数值段不用动，见
[02-layout-tree.md](02-layout-tree.md#符号段要写来源变量名影响反向索引)）。

### `new-project` 后 `npm run build` 找不到脚本

`package.json` scripts 里的路径由 `{{SKILL_REL}}` 在脚手架时注入为**绝对相对路径**。若移动了项目目录，重新生成或用绝对路径执行。

## 自检命令

```bash
node tests/run.mjs                                   # Skill 自身全量自检
node layout/scripts/validate/run-all.mjs --project <dir>    # 项目八步验证（含确认闸门）；非 drawio 项目自动跳过 check-drawio
node drawio/scripts/validate/check-drawio.mjs --project <dir>   # 架构图专查：XML / 几何一致性 / 文字 / 图例 / 边距
node layout/scripts/print-tree.mjs --project <dir> --expr   # 文本 box tree + 连线清单
node layout/scripts/positioning-viewer/serve.mjs --project examples/landing   # 人工看示例
```

> drawio 相关的症状（文字截断、压线、穿节点、边距…）集中在
> [07-drawio.md](../../drawio/references/07-drawio.md) 第十二节的排错表。

## 环境要求速查

| 项 | 要求 |
|---|---|
| Node | ≥ 22.6（需要 TS type stripping） |
| 运行时依赖 | 无 |
| PNG 预览 | 可选：Pillow（项目 `.venv` 或系统） |
| draw.io 产物 | 需要 Pillow 才能出 PNG（`.drawio` 本身无依赖）；无 CJK 字体时**拒绝**渲染而不是出豆腐块 |
| 浏览器 | 查看器需要（现代浏览器即可） |
| 字体 | 定位图 / 架构图 PNG 需要 CJK 字体（Noto Sans CJK SC 或文泉驿） |
