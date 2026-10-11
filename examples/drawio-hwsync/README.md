# 软硬协同架构（中断 / DMA 回路）

**layout-engineer** 的 drawio 单视图示例（`kind=drawio`，视图 `hwsync`）。几何是算出来的，不是画出来的。
本目录只保留源码；`layout-tree/`、`drawio/`、`positioning/`、`docs/`、`manifest.json` 都由脚本重算。

## 这张图在讲什么

一张 **软硬协同架构** 图，自上而下六层、每层一行节点：

| 层 | kind | 内容 |
|---|---|---|
| ① 应用层 | `layer` | 应用任务 / 事件总线 / 文件系统 / 协议栈 |
| ② RTOS 与中间件层 | `layer` | RTOS 调度器 / 中断管理 / 时间服务 |
| ③ HAL / BSP | `layer` `tone:focus` | HAL 接口 / 寄存器映射 / BSP 启动（软硬件分界） |
| ④ 外设驱动层 | `layer` | 外设驱动 / 中断控制器 NVIC / DMA 控制器 / 时钟与供电管理 |
| ⑤ SoC 硬件层 | `layer` | AXI/APB 总线 / 传感器采集 / 执行器输出 / 调试口 SWD |
| ⑥ 板级与启动层 | `layer` | Bootloader / 供电与晶振 |

共 **20 个功能节点**，其中 4 个带两行 `note` 工程细节。连线 **15 条**：

- `data` × 10：调用 / 读写链路（创建任务、调用 HAL、寄存器读写、总线访问…）；
- `control` × 3：`DMA 搬运`（`arrow:both`）、`中断请求`、以及自硬件层经**左侧走廊**绕回应用层的**中断回显**回路；
- `power` × 2：`供电轨`、`驱动供电`（花青实线）。

图例覆盖应用 / 框架 / 硬件 / 存储四类节点色，以及数据 / 控制 / 供电三种连线语义。

## 目录

```
variables/            设计变量（tokens.ts 中国色与文字度量 + layout.ts 版面尺寸，四行注释约束）
src/layout/index.ts   布局计算纯函数 buildLayout(view)：节点框、锚点与途经点都在这里算
vendor/layout-engine  布局构建工具软链（anchor / route / edge / waypoint，勿改）
layout.config.json    kind=drawio、breakpoints=[hwsync]（单画布声明）
```

## 流程（确认节点不可跳过）

```bash
npm run print-tree   # 复核结构（确认节点 A 的机器版）
npm run build        # ③ 计算并归档 layout-tree/hwsync.json
npm run view         # ④ 交互式定位确认
npm run confirm -- --node structure --source user-chat --note "用户回复：结构 OK"
npm run validate     # ⑤ 验证层（lint / assert / verify / 闸门 / drawio 自检 / docgen）
npm run render       # ⑥ 产出 drawio/hwsync.drawio + hwsync.png
```

只想复算产物（CI / 示例归档）时，验证与渲染都加 `--allow-unconfirmed`。

## drawio 产物怎么来的

```
variables/ ──> src/layout/index.ts（纯函数：节点框 + 锚点 + 途经点）
                        │
                        └──> layout-tree/hwsync.json
                                  ├─ drawio.mjs ─────> drawio/hwsync.drawio（零几何计算）
                                  └─ drawio_png.py ──> drawio/hwsync.png（解析上面那份 XML）
```

- 渲染器不自己算锚点、不自己找路由：端点与途经点已写进 `edges[]`；
- 配色 / 字号 / 圆角 / 边距全部来自 `variableSnapshot` 里的设计 token；
- `.png` 由 `.drawio` 解析渲染，所以「图与 XML 一致」是结构保证，不靠人核对；
- `check-drawio` 会把 XML 反解回对象，逐字段与 Layout Tree 比对。

## 修改图面的正确姿势

1. 改 `variables/` 里的变量（不要直接改坐标）；
2. `node ../../layout/scripts/indexer.mjs --project . --impact <变量名>` 看结构化 diff；
3. `npm run build && npm run validate && npm run render` 重算并重新核对。
