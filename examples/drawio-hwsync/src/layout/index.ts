/**
 * 布局计算入口（纯函数）—— 软硬协同架构（中断 / DMA 回路）（drawio 架构图 · 单视图 hwsync）
 *
 * 契约：buildLayout(breakpoint) -> LayoutTree
 *
 * 四条硬约束：
 *   1. 无副作用：不读文件、不打日志、不改全局状态。
 *   2. 零几何字面量：所有数字来自 variables/。
 *   3. **连线端点与途经点都是算出来再存进树的**：渲染器（drawio.mjs / drawio_png.py）
 *      只做字段映射，不自己算锚点、不自己找路由。
 *   4. 单视图：drawio 架构图没有响应式双端，断点只作画布标识（见 layout.config.json）。
 */
import {
  anchor, canvas, centerX, edge, gapMid, half, iconSlots, inset, midNum, midX, num, route, tree, waypoint,
} from "../../vendor/layout-engine/builder.mjs";
import { COLOR, DRAWIO, DRAWIO_METRICS, GRADIENT, ORIGIN, RADIUS, SHADOW, SPACE, TYPE } from "../../variables/tokens.ts";
import {
  CANVAS_W,
  CORRIDOR_X,
  GAP,
  HEAD_H,
  LABEL_H,
  LABEL_W,
  LEGEND_ROW_H,
  LEGEND_ROWS,
  LEGEND_SWATCH_GAP,
  LEGEND_SWATCH_H,
  LEGEND_SWATCH_W,
  MARGIN,
  NODE_H,
  PAD,
  SEC_GAP,
  TITLE_GAP,
  TITLE_H,
} from "../../variables/layout.ts";

// expr 构造：符号算式 = 数值算式（两段都必须能复算出结果）
const ex = (sym: string, numeric: string) => `${sym} = ${numeric}`;

// 图标盒度量：像素值 + 它们在 variableSnapshot 里的键名。
// iconPad / iconGap / iconTextGap 取自 SPACE 刻度，assert-layout 会检查快照里的间距类键。
const ICON_METRICS = {
  size: DRAWIO_METRICS.iconSize,
  pad: DRAWIO_METRICS.iconPad,
  gap: DRAWIO_METRICS.iconGap,
  sizeName: "DRAWIO_ICON_SIZE",
  padName: "DRAWIO_ICON_PAD",
  gapName: "DRAWIO_ICON_GAP",
};

interface BoxContent {
  id: string;
  label: string;
  kind: string;
  shape?: string;
  tone?: "normal" | "focus";
  silent?: boolean;
  note?: string[];
  // 技术栈图标逻辑名（查 assets/icons/catalog.json）；卡片左侧图标 + 右侧文字
  icon?: string[];
}

// 分层表：六层自上而下，其中 HAL / BSP 层是软硬件分界（tone=focus）。
// 文字与层序不是几何，与版面参数无关，因此用行注释而不是 doc 块。
const LAYERS: BoxContent[] = [
  { id: "layer-app", label: "① 应用层（任务 / 服务）", kind: "layer", tone: "normal" },
  { id: "layer-mw", label: "② RTOS 与中间件层", kind: "layer", tone: "normal" },
  { id: "layer-hal", label: "③ HAL / BSP（软硬件分界）", kind: "layer", tone: "focus" },
  { id: "layer-drv", label: "④ 外设驱动层", kind: "layer", tone: "normal" },
  { id: "layer-soc", label: "⑤ SoC 硬件层", kind: "layer", tone: "normal" },
  { id: "layer-board", label: "⑥ 板级与启动层", kind: "layer", tone: "normal" },
];

// 各层功能节点：每层一行；note 会渲染在节点内（最多两行）。
const ITEMS: Record<string, BoxContent[]> = {
  "layer-app": [
    { id: "app-task", label: "应用任务", kind: "app", note: ["周期采样 · 状态机"], icon: ["rust"] },
    { id: "app-evt", label: "事件总线", kind: "app", note: ["发布 / 订阅", "跨任务回调"] },
    { id: "app-fs", label: "文件系统", kind: "app", note: ["日志 / 配置落盘"], icon: ["kicad"] },
    { id: "app-net", label: "协议栈", kind: "app", note: ["MQTT · 遥测上报"], icon: ["cloudflare"] },
  ],
  "layer-mw": [
    { id: "mw-rtos", label: "RTOS 调度器", kind: "framework", note: ["优先级抢占", "tick 时基"], icon: ["lvgl"] },
    { id: "mw-isr", label: "中断管理", kind: "framework", note: ["ISR 注册", "顶半 / 底半"] },
    { id: "mw-time", label: "时间服务", kind: "framework", note: ["软定时器 · 看门狗"] },
  ],
  "layer-hal": [
    { id: "hal-if", label: "HAL 接口", kind: "framework", note: ["统一 API", "屏蔽芯片差异"], icon: ["platformio"] },
    { id: "hal-reg", label: "寄存器映射", kind: "hardware", note: ["MMIO 地址表"] },
    { id: "hal-bsp", label: "BSP 启动", kind: "hardware", note: ["时钟 / 引脚 / 内存"], icon: ["espressif"] },
  ],
  "layer-drv": [
    { id: "drv-periph", label: "外设驱动", kind: "framework", note: ["GPIO / UART / SPI"], icon: ["go"] },
    { id: "drv-nvic", label: "中断控制器 NVIC", kind: "hardware", note: ["向量表 · 优先级分组"] },
    { id: "drv-dma", label: "DMA 控制器", kind: "hardware", note: ["通道链表 · 双缓冲"] },
    { id: "drv-pwr", label: "时钟与供电管理", kind: "hardware", note: ["门控 · 低功耗模式"] },
  ],
  "layer-soc": [
    { id: "soc-bus", label: "AXI / APB 总线", kind: "hardware", note: ["互联矩阵 · 地址译码"] },
    { id: "soc-sensor", label: "传感器采集", kind: "hardware", note: ["ADC / I2C 接口"], icon: ["stmicroelectronics"] },
    { id: "soc-act", label: "执行器输出", kind: "hardware", note: ["PWM / 继电器"] },
    { id: "soc-swd", label: "调试口 SWD", kind: "hardware", note: ["SWD / 日志跟踪"], icon: ["kicad"] },
  ],
  "layer-board": [
    { id: "board-boot", label: "Bootloader", kind: "storage", note: ["上电自检 · 固件升级"], icon: ["rust"] },
    { id: "board-power", label: "供电与晶振", kind: "hardware", note: ["DC-DC · 外部晶振"] },
  ],
};

/**
 * 计算整张软硬协同架构图
 *
 * @param breakpoint 画布标识（单视图项目固定为 layout.config.json 里声明的那一个）
 * @returns 该视图的 Layout Tree
 *
 * 功能：产出标题带 + 六个分层容器 + 图例，以及十五条连线（含中断回显回路、DMA 双向通路与两条供电线）。
 * 实现原理：所有纵向位置由「上一个容器的底部 + 层间距」累加得出，画布高度由内容决定；
 *           层内节点按「等分可用宽度」排布，连线端点用 builder.anchor() 算，
 *           相邻层连线用 builder.route()，需要绕开所有节点的中断回显线用 waypoint() 显式给出左侧走廊坐标。
 */
function layout(breakpoint: string) {
  const contentW = CANVAS_W - MARGIN - MARGIN;
  const innerX = MARGIN + PAD;
  const innerW = contentW - PAD - PAD;
  const layerH = HEAD_H + NODE_H + PAD;

  const titleY = MARGIN;
  const layerYs = LAYERS.map((_, i) => titleY + TITLE_H + TITLE_GAP + i * (layerH + SEC_GAP));
  const legendY = titleY + TITLE_H + TITLE_GAP + LAYERS.length * (layerH + SEC_GAP);
  const legendH = HEAD_H + LEGEND_ROWS * LEGEND_ROW_H + PAD;
  const canvasH = legendY + legendH + MARGIN;
  const nodeY = (yi: number) => layerYs[yi] + HEAD_H;

  // 标题带与首层之间的横向空隙中点：中断回显线由此横穿到应用任务的正上方。
  const topGapY = midNum(titleY + TITLE_H, layerYs[0]);

  // ── 标题带 ──
  const titleNode = {
    id: "title",
    label: "软硬协同架构（中断 / DMA 回路）",
    kind: "title",
    x: MARGIN,
    y: titleY,
    w: contentW,
    h: TITLE_H,
    refs: ["MARGIN", "CANVAS_W", "TITLE_H"],
    expr: {
      x: ex("MARGIN", num(MARGIN)),
      y: ex("TITLE_Y", num(titleY)),
      w: ex("CANVAS_W - MARGIN - MARGIN", `${num(CANVAS_W)} - ${num(MARGIN)} - ${num(MARGIN)}`),
      h: ex("TITLE_H", num(TITLE_H)),
    },
    children: [],
  };

  // ── 分层容器与其中的节点 ──
  // 每层节点等分可用宽度：itemW = (INNER_W - (count - 1) * GAP) / count。
  const layerNodes = LAYERS.map((layer, yi) => {
    const items = ITEMS[layer.id] ?? [];
    const count = items.length;
    const itemW = (innerW - (count - 1) * GAP) / count;
    const prev = yi === 0 ? null : `L${yi}_Y`;
    const children = items.map((it, i) => {
      const card: Record<string, unknown> = {
        id: it.id,
        label: it.label,
        kind: it.kind,
        ...(it.tone ? { tone: it.tone } : {}),
        ...(it.shape ? { shape: it.shape } : {}),
        note: it.note,
        x: innerX + i * (itemW + GAP),
        y: nodeY(yi),
        w: itemW,
        h: NODE_H,
        refs: [`L${yi + 1}_ITEM_X`, `L${yi + 1}_NODE_Y`, `W_L${yi + 1}`, "NODE_H", "GAP"],
        expr: {
          x: ex(
            `L${yi + 1}_ITEM_X + ${i}*(W_L${yi + 1} + GAP)`,
            `${num(innerX)} + ${i} * (${num(itemW)} + ${num(GAP)})`,
          ),
          y: ex(`L${yi + 1}_NODE_Y`, num(nodeY(yi))),
          w: ex(`W_L${yi + 1}`, num(itemW)),
          h: ex("NODE_H", num(NODE_H)),
        },
        children: [],
      };
      // 技术栈图标：图标盒由布局纯函数算出（带两段式 expr），渲染器只做字段映射
      if (it.icon?.length) {
        card.icon = it.icon;
        card.children = iconSlots(card as never, it.icon, ICON_METRICS) as never[];
      }
      return card;
    });
    return {
      id: layer.id,
      label: layer.label,
      kind: "layer",
      tone: layer.tone,
      x: MARGIN,
      y: layerYs[yi],
      w: contentW,
      h: layerH,
      refs: [`L${yi + 1}_Y`, "MARGIN", "CANVAS_W", "HEAD_H", "NODE_H", "PAD"],
      expr: {
        x: ex("MARGIN", num(MARGIN)),
        y:
          prev === null
            ? ex("TITLE_Y + TITLE_H + TITLE_GAP", `${num(titleY)} + ${num(TITLE_H)} + ${num(TITLE_GAP)}`)
            : ex(`${prev} + LAYER_H + SEC_GAP`, `${num(layerYs[yi - 1])} + ${num(layerH)} + ${num(SEC_GAP)}`),
        w: ex("CANVAS_W - MARGIN - MARGIN", `${num(CANVAS_W)} - ${num(MARGIN)} - ${num(MARGIN)}`),
        h: ex("HEAD_H + NODE_H + PAD", `${num(HEAD_H)} + ${num(NODE_H)} + ${num(PAD)}`),
      },
      children,
    };
  });

  const findNode = (id: string) => {
    for (const layer of layerNodes) {
      for (const c of layer.children) if (c.id === id) return c;
    }
    throw new Error(`图里没有节点 ${id}`);
  };

  // ── 连线标签：白色底衬，落在层间空隙或顶部空隙里 ──
  const labelNode = (id: string, text: string, cx: number, cy: number, symX: string, symY: string) => ({
    id,
    label: text,
    kind: "edgeLabel",
    x: cx - half(LABEL_W),
    y: cy - half(LABEL_H),
    w: LABEL_W,
    h: LABEL_H,
    refs: [symX, symY, "LABEL_W", "LABEL_H"],
    expr: {
      x: ex(`${symX} - LABEL_W / 2`, `${num(cx)} - ${num(LABEL_W)} / 2`),
      y: ex(`${symY} - LABEL_H / 2`, `${num(cy)} - ${num(LABEL_H)} / 2`),
      w: ex("LABEL_W", num(LABEL_W)),
      h: ex("LABEL_H", num(LABEL_H)),
    },
    children: [],
  });

  const appTask = findNode("app-task");
  const appEvt = findNode("app-evt");
  const mwRtos = findNode("mw-rtos");
  const mwIsr = findNode("mw-isr");
  const mwTime = findNode("mw-time");
  const halIf = findNode("hal-if");
  const halReg = findNode("hal-reg");
  const halBsp = findNode("hal-bsp");
  const drvPeriph = findNode("drv-periph");
  const drvNvic = findNode("drv-nvic");
  const drvDma = findNode("drv-dma");
  const drvPwr = findNode("drv-pwr");
  const socBus = findNode("soc-bus");
  const socSensor = findNode("soc-sensor");
  const socAct = findNode("soc-act");
  const boardBoot = findNode("board-boot");
  const boardPower = findNode("board-power");

  // 中间量：各层间空隙的中位线 y，以及各连线标签的中心 (x, y)。
  const mid12 = gapMid(appTask, mwRtos);
  const mid23 = gapMid(mwRtos, halIf);
  const mid34 = gapMid(halIf, drvPeriph);
  const mid45 = gapMid(drvPeriph, socBus);
  const mid56 = gapMid(socBus, boardBoot);

  const lx1 = midX(appTask, mwRtos);
  const lx2 = midX(appEvt, mwIsr);
  const lx3 = centerX(mwRtos);
  const lx4 = centerX(mwIsr);
  const lx5 = centerX(mwTime);
  const lx6 = midX(halIf, drvPeriph);
  const lx7 = midX(halReg, drvNvic);
  const lx8 = midX(halBsp, drvPwr);
  const lx9 = centerX(drvPeriph);
  const lx10 = midX(drvDma, socSensor);
  const lx11 = midX(drvPwr, socAct);
  const lx12 = centerX(socSensor);
  const lx13 = midX(socBus, boardBoot);
  const lx14 = midX(socAct, boardPower);
  const lx15 = midNum(CORRIDOR_X, centerX(appTask));

  const labels = [
    labelNode("lbl-task", "创建任务", lx1, mid12, "E1_MID_X", "E1_MID_Y"),
    labelNode("lbl-evt", "订阅事件", lx2, mid12, "E2_MID_X", "E2_MID_Y"),
    labelNode("lbl-hal", "调用 HAL", lx3, mid23, "E3_MID_X", "E3_MID_Y"),
    labelNode("lbl-vec", "登记向量", lx4, mid23, "E4_MID_X", "E4_MID_Y"),
    labelNode("lbl-boot", "引导初始化", lx5, mid23, "E5_MID_X", "E5_MID_Y"),
    labelNode("lbl-dispatch", "驱动分派", lx6, mid34, "E6_MID_X", "E6_MID_Y"),
    labelNode("lbl-mio", "寄存器读写", lx7, mid34, "E7_MID_X", "E7_MID_Y"),
    labelNode("lbl-domain", "电源域配置", lx8, mid34, "E8_MID_X", "E8_MID_Y"),
    labelNode("lbl-bus", "总线访问", lx9, mid45, "E9_MID_X", "E9_MID_Y"),
    labelNode("lbl-dma", "DMA 搬运", lx10, mid45, "E10_MID_X", "E10_MID_Y"),
    labelNode("lbl-rail", "供电轨", lx11, mid45, "E11_MID_X", "E11_MID_Y"),
    labelNode("lbl-irq", "中断请求", lx12, mid45, "E12_MID_X", "E12_MID_Y"),
    labelNode("lbl-selftest", "上电自检", lx13, mid56, "E13_MID_X", "E13_MID_Y"),
    labelNode("lbl-drive", "驱动供电", lx14, mid56, "E14_MID_X", "E14_MID_Y"),
    labelNode("lbl-echo", "中断回显", lx15, topGapY, "E15_MID_X", "E15_MID_Y"),
  ];

  // ── 图例：四类节点色样 + 三种连线语义色样 ──
  const legendRows = [
    { swatch: "lg-app", kind: "app", text: "实心方块 = 应用 / 业务节点（宝蓝）" },
    { swatch: "lg-fw", kind: "framework", text: "实心方块 = 框架 / 中间件节点（靛青）" },
    { swatch: "lg-hw", kind: "hardware", text: "实心方块 = 硬件 / 物理节点（藏青）" },
    { swatch: "lg-store", kind: "storage", text: "实心方块 = 数据 / 存储节点（石青）" },
    { swatch: "lg-data", kind: "edgeData", text: "线段 = 数据 / 调用线（靛蓝，实线）" },
    { swatch: "lg-ctrl", kind: "edgeControl", text: "色块 = 控制 / 中断线（宝蓝，虚线）" },
    { swatch: "lg-power", kind: "edgePower", text: "线段 = 供电 / 电源线（花青，实线）" },
  ];
  // 行内垂直居中量：由「行高 − 内容高」的一半得出，行高的出处是 token
  const swatchInset = inset(LEGEND_ROW_H, LEGEND_SWATCH_H);
  const textInset = inset(LEGEND_ROW_H, TYPE.note * DRAWIO_METRICS.lineHeight);
  const lgrY = legendY + HEAD_H;
  const legendChildren = legendRows
    .map((row, i) => {
      const rowY = lgrY + i * LEGEND_ROW_H;
      return [
        {
          id: row.swatch,
          label: row.swatch,
          kind: row.kind,
          shape: "rect",
          silent: true,
          x: innerX,
          y: rowY + swatchInset,
          w: LEGEND_SWATCH_W,
          h: LEGEND_SWATCH_H,
          refs: ["LGR_X", "LGR_Y", "LEGEND_SWATCH_W", "LEGEND_SWATCH_H", "LEGEND_ROW_H"],
          expr: {
            x: ex("LGR_X", num(innerX)),
            y: ex(
              `LGR_Y + ${i}*LEGEND_ROW_H + (LEGEND_ROW_H - LEGEND_SWATCH_H) / 2`,
              `${num(lgrY)} + ${i} * ${num(LEGEND_ROW_H)} + (${num(LEGEND_ROW_H)} - ${num(LEGEND_SWATCH_H)}) / 2`,
            ),
            w: ex("LEGEND_SWATCH_W", num(LEGEND_SWATCH_W)),
            h: ex("LEGEND_SWATCH_H", num(LEGEND_SWATCH_H)),
          },
          children: [],
        },
        {
          id: `${row.swatch}-text`,
          label: row.text,
          kind: "legendItem",
          x: innerX + LEGEND_SWATCH_W + LEGEND_SWATCH_GAP,
          y: rowY + textInset,
          w: innerW - LEGEND_SWATCH_W - LEGEND_SWATCH_GAP,
          h: LEGEND_ROW_H,
          refs: ["LGR_X", "LGR_Y", "INNER_W", "LEGEND_ROW_H", "DRAWIO_LINE_HEIGHT"],
          expr: {
            x: ex(
              "LGR_X + LEGEND_SWATCH_W + LEGEND_SWATCH_GAP",
              `${num(innerX)} + ${num(LEGEND_SWATCH_W)} + ${num(LEGEND_SWATCH_GAP)}`,
            ),
            y: ex(
              `LGR_Y + ${i}*LEGEND_ROW_H + (LEGEND_ROW_H - TYPE_NOTE*DRAWIO_LINE_HEIGHT) / 2`,
              `${num(lgrY)} + ${i} * ${num(LEGEND_ROW_H)} + (${num(LEGEND_ROW_H)} - ${num(TYPE.note)} * ${num(DRAWIO_METRICS.lineHeight)}) / 2`,
            ),
            w: ex(
              "INNER_W - LEGEND_SWATCH_W - LEGEND_SWATCH_GAP",
              `${num(innerW)} - ${num(LEGEND_SWATCH_W)} - ${num(LEGEND_SWATCH_GAP)}`,
            ),
            h: ex("LEGEND_ROW_H", num(LEGEND_ROW_H)),
          },
          children: [],
        },
      ];
    })
    .flat();

  const legendNode = {
    id: "legend",
    label: "图例 · 颜色与线型语义",
    kind: "legend",
    x: MARGIN,
    y: legendY,
    w: contentW,
    h: legendH,
    refs: ["LEGEND_Y", "MARGIN", "CANVAS_W", "HEAD_H", "LEGEND_ROWS", "LEGEND_ROW_H", "PAD"],
    expr: {
      x: ex("MARGIN", num(MARGIN)),
      y: ex(
        `L${LAYERS.length}_Y + LAYER_H + SEC_GAP`,
        `${num(layerYs[LAYERS.length - 1])} + ${num(layerH)} + ${num(SEC_GAP)}`,
      ),
      w: ex("CANVAS_W - MARGIN - MARGIN", `${num(CANVAS_W)} - ${num(MARGIN)} - ${num(MARGIN)}`),
      h: ex(
        "HEAD_H + LEGEND_ROWS*LEGEND_ROW_H + PAD",
        `${num(HEAD_H)} + ${num(LEGEND_ROWS)} * ${num(LEGEND_ROW_H)} + ${num(PAD)}`,
      ),
    },
    children: legendChildren,
  };

  // ── 连线 ──
  // 数据 / 调用链路（相邻层，route() 自动把拐点压进层间空隙）
  const e1 = edge({ id: "e-task-rtos", from: appTask, fromSide: "S", to: mwRtos, toSide: "N",
                    via: route(appTask, "S", mwRtos, "N"), role: "data", labelNode: "lbl-task" });
  const e2 = edge({ id: "e-evt-isr", from: appEvt, fromSide: "S", to: mwIsr, toSide: "N",
                    via: route(appEvt, "S", mwIsr, "N"), role: "data", labelNode: "lbl-evt" });
  const e3 = edge({ id: "e-rtos-hal", from: mwRtos, fromSide: "S", to: halIf, toSide: "N",
                    via: route(mwRtos, "S", halIf, "N"), role: "data", labelNode: "lbl-hal" });
  const e4 = edge({ id: "e-isr-reg", from: mwIsr, fromSide: "S", to: halReg, toSide: "N",
                    via: route(mwIsr, "S", halReg, "N"), role: "data", labelNode: "lbl-vec" });
  const e5 = edge({ id: "e-time-bsp", from: mwTime, fromSide: "S", to: halBsp, toSide: "N",
                    via: route(mwTime, "S", halBsp, "N"), role: "data", labelNode: "lbl-boot" });
  const e6 = edge({ id: "e-hal-drv", from: halIf, fromSide: "S", to: drvPeriph, toSide: "N",
                    via: route(halIf, "S", drvPeriph, "N"), role: "data", labelNode: "lbl-dispatch" });
  const e7 = edge({ id: "e-reg-nvic", from: halReg, fromSide: "S", to: drvNvic, toSide: "N",
                    via: route(halReg, "S", drvNvic, "N"), role: "data", labelNode: "lbl-mio" });
  const e8 = edge({ id: "e-bsp-pwr", from: halBsp, fromSide: "S", to: drvPwr, toSide: "N",
                    via: route(halBsp, "S", drvPwr, "N"), role: "data", labelNode: "lbl-domain" });
  const e9 = edge({ id: "e-drv-bus", from: drvPeriph, fromSide: "S", to: socBus, toSide: "N",
                    via: route(drvPeriph, "S", socBus, "N"), role: "data", labelNode: "lbl-bus" });
  // DMA 双向数据通路：内存与传感器之间的搬运由硬件自动完成
  const e10 = edge({ id: "e-dma-sensor", from: drvDma, fromSide: "S", to: socSensor, toSide: "N",
                     via: route(drvDma, "S", socSensor, "N"), role: "control", arrow: "both", labelNode: "lbl-dma" });
  // 供电线（花青）：电源管理域给执行器供电
  const e11 = edge({ id: "e-pwr-act", from: drvPwr, fromSide: "S", to: socAct, toSide: "N",
                     via: route(drvPwr, "S", socAct, "N"), role: "power", labelNode: "lbl-rail" });
  // 硬件中断请求：传感器 → NVIC（自下而上，同轴直连）
  const e12 = edge({ id: "e-sensor-irq", from: socSensor, fromSide: "N", to: drvNvic, toSide: "S",
                     via: route(socSensor, "N", drvNvic, "S"), role: "control", labelNode: "lbl-irq" });
  const e13 = edge({ id: "e-bus-boot", from: socBus, fromSide: "S", to: boardBoot, toSide: "N",
                     via: route(socBus, "S", boardBoot, "N"), role: "data", labelNode: "lbl-selftest" });
  const e14 = edge({ id: "e-act-power", from: socAct, fromSide: "S", to: boardPower, toSide: "N",
                     via: route(socAct, "S", boardPower, "N"), role: "power", labelNode: "lbl-drive" });
  // 中断回显回路：硬件层 → 左侧走廊 → 顶部空隙 → 应用任务。
  // 四段途经点都显式给出，因此「不横穿任何节点」是算出来的，不是碰运气。
  const sw = anchor(socSensor, "W");
  const an = anchor(appTask, "N");
  const e15 = edge({
    id: "e-irq-echo",
    from: socSensor,
    fromSide: "W",
    to: appTask,
    toSide: "N",
    via: [
      waypoint(CORRIDOR_X, sw.y, ex("CORRIDOR_X", num(CORRIDOR_X)), sw.expr.y),
      waypoint(CORRIDOR_X, topGapY, ex("CORRIDOR_X", num(CORRIDOR_X)), ex("ECHO_TOP_Y", num(topGapY))),
      waypoint(an.x, topGapY, an.expr.x, ex("ECHO_TOP_Y", num(topGapY))),
    ],
    role: "control",
    labelNode: "lbl-echo",
  });

  // ── 变量快照：公式里用到的键 + 派生量 + 设计 token ──
  const snapshot: Record<string, number | string> = {
    ORIGIN,
    // 几何
    CANVAS_W,
    CANVAS_H: canvasH,
    MARGIN,
    PAD,
    GAP,
    SEC_GAP,
    HEAD_H,
    NODE_H,
    TITLE_Y: titleY,
    TITLE_H,
    TITLE_GAP,
    LABEL_W,
    LABEL_H,
    INNER_W: innerW,
    LAYER_H: layerH,
    LEGEND_ROWS,
    LEGEND_ROW_H,
    LEGEND_SWATCH_W,
    LEGEND_SWATCH_H,
    LEGEND_SWATCH_GAP,
    LEGEND_Y: legendY,
    LEGEND_H: legendH,
    ECHO_TOP_Y: topGapY,
    CORRIDOR_X,
    "SPACE.md": SPACE.md,
    "SPACE.lg": SPACE.lg,
    "SPACE.xl": SPACE.xl,
    "SPACE.xxl": SPACE.xxl,
    // 连线标签定位用的中间量
    E1_MID_X: lx1,
    E1_MID_Y: mid12,
    E2_MID_X: lx2,
    E2_MID_Y: mid12,
    E3_MID_X: lx3,
    E3_MID_Y: mid23,
    E4_MID_X: lx4,
    E4_MID_Y: mid23,
    E5_MID_X: lx5,
    E5_MID_Y: mid23,
    E6_MID_X: lx6,
    E6_MID_Y: mid34,
    E7_MID_X: lx7,
    E7_MID_Y: mid34,
    E8_MID_X: lx8,
    E8_MID_Y: mid34,
    E9_MID_X: lx9,
    E9_MID_Y: mid45,
    E10_MID_X: lx10,
    E10_MID_Y: mid45,
    E11_MID_X: lx11,
    E11_MID_Y: mid45,
    E12_MID_X: lx12,
    E12_MID_Y: mid45,
    E13_MID_X: lx13,
    E13_MID_Y: mid56,
    E14_MID_X: lx14,
    E14_MID_Y: mid56,
    E15_MID_X: lx15,
    E15_MID_Y: topGapY,
    // 设计 token 与几何一起归档：渲染器读它，因此配色/字号也是「可追溯的变量」
    COLOR_INK: COLOR.ink,
    COLOR_INK_SOFT: COLOR.inkSoft,
    COLOR_INK_FAINT: COLOR.inkFaint,
    COLOR_CANVAS: COLOR.canvas,
    COLOR_SURFACE: COLOR.surface,
    COLOR_BORDER: COLOR.border,
    DRAWIO_HUAQING: DRAWIO.huaQing,
    DRAWIO_DIANLAN: DRAWIO.dianLan,
    DRAWIO_BAOLAN: DRAWIO.baoLan,
    DRAWIO_DIANQING: DRAWIO.dianQing,
    DRAWIO_ZANGQING: DRAWIO.zangQing,
    DRAWIO_SHIQING: DRAWIO.shiQing,
    DRAWIO_LANHUI: DRAWIO.lanHui,
    DRAWIO_YUEBAI: DRAWIO.yueBai,
    DRAWIO_XUEBAI: DRAWIO.xueBai,
    DRAWIO_MO: DRAWIO.mo,
    DRAWIO_BASE: DRAWIO.base,
    DRAWIO_FILL_MIX: DRAWIO_METRICS.fillMix,
    DRAWIO_ARC_SIZE_ITEM: DRAWIO_METRICS.arcSizeItem,
    DRAWIO_ARC_SIZE_SECTION: DRAWIO_METRICS.arcSizeSection,
    DRAWIO_STROKE_W: DRAWIO_METRICS.strokeW,
    DRAWIO_LAYER_HEAD_H: DRAWIO_METRICS.layerHeadH,
    DRAWIO_LABEL_PAD: DRAWIO_METRICS.labelPad,
    DRAWIO_LINE_HEIGHT: DRAWIO_METRICS.lineHeight,
    DRAWIO_MIN_MARGIN: DRAWIO_METRICS.minMargin,
    DRAWIO_MIN_LAYER_GAP: DRAWIO_METRICS.minLayerGap,
    DRAWIO_MIN_NODE_GAP: DRAWIO_METRICS.minNodeGap,
    DRAWIO_FONT_FAMILY: DRAWIO_METRICS.fontFamily,
    DRAWIO_ICON_SIZE: DRAWIO_METRICS.iconSize,
    DRAWIO_ICON_PAD: DRAWIO_METRICS.iconPad,
    DRAWIO_ICON_GAP: DRAWIO_METRICS.iconGap,
    DRAWIO_ICON_TEXT_GAP: DRAWIO_METRICS.iconTextGap,
    TYPE_DISPLAY: TYPE.display,
    TYPE_SECTION: TYPE.section,
    TYPE_ITEM: TYPE.item,
    TYPE_NOTE: TYPE.note,
    RADIUS_SECTION: RADIUS.section,
    RADIUS_ITEM: RADIUS.item,
    RADIUS_STROKE: RADIUS.stroke,
    DRAWIO_SHADOW_DY: SHADOW.node.dy,
    DRAWIO_SHADOW_BLUR: SHADOW.node.blur,
    DRAWIO_SHADOW_ALPHA: SHADOW.node.alpha,
    DRAWIO_GRADIENT_ANGLE: GRADIENT.angle,
    DRAWIO_GRADIENT_END_MIX: GRADIENT.endMix,
  };
  // 每个层的定位键（供 expr 的符号段引用）
  LAYERS.forEach((layer, i) => {
    snapshot[`L${i + 1}_Y`] = layerYs[i];
    snapshot[`L${i + 1}_NODE_Y`] = nodeY(i);
    snapshot[`L${i + 1}_ITEM_X`] = innerX;
    const count = (ITEMS[layer.id] ?? []).length;
    snapshot[`W_L${i + 1}`] = (innerW - (count - 1) * GAP) / count;
  });
  snapshot.LGR_X = innerX;
  snapshot.LGR_Y = lgrY;

  return tree({
    canvas: canvas({ w: CANVAS_W, h: canvasH, breakpoint }),
    variableSnapshot: snapshot,
    elements: [titleNode, ...layerNodes, legendNode, ...labels],
    edges: [e1, e2, e3, e4, e5, e6, e7, e8, e9, e10, e11, e12, e13, e14, e15],
  });
}

/**
 * 按画布标识计算架构图
 *
 * @param breakpoint 画布标识，取自 layout.config.json 的 breakpoints[0]
 * @returns 该视图的 Layout Tree
 *
 * 功能：单画布项目没有双端差异，直接产出唯一的 Layout Tree；其余断点一律拒绝。
 * 实现原理：用 layout.config.json 声明本项目只构建一个档位，
 *           若传入了别的档位则说明调用方与配置不一致，立即报错而不是静默出图。
 */
export function buildLayout(breakpoint: string) {
  const view = "hwsync";
  if (breakpoint !== view) {
    throw new Error(`本视图只声明了画布 ${view}，收到 ${breakpoint}（见 layout.config.json）`);
  }
  return layout(breakpoint);
}
