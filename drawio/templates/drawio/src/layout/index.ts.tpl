/**
 * 布局计算入口（纯函数）—— {{PROJECT_TITLE}}（drawio 架构图 · 单视图 {{VIEW}}）
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
  anchor, canvas, centerX, edge, gapMid, half, iconSlots, inset, midNum, midX, num, route, textWidth, tree, waypoint,
} from "../../vendor/layout-engine/builder.mjs";
import { COLOR, DRAWIO, DRAWIO_ACCENT, DRAWIO_METRICS, GRADIENT, ORIGIN, RADIUS, SHADOW, SPACE, TYPE } from "../../variables/tokens.ts";
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
  // 分层色相（非几何）：引用 DRAWIO_ACCENT 的键，如 "compute"
  accent?: string;
}

// 各层的内容表：文字不是几何，与版面参数无关（因此用行注释，避免被 docgen 当作布局变量校验）
const LAYERS: BoxContent[] = [
  {
    id: "layer-app",
    label: "① 应用与中间件层",
    kind: "layer",
    tone: "normal",
    accent: "compute",
  },
  {
    id: "layer-hal",
    label: "② HAL / BSP（软硬件分界）",
    kind: "layer",
    tone: "focus",
  },
  {
    id: "layer-hw",
    label: "③ 硬件层（SoC）",
    kind: "layer",
    tone: "normal",
    accent: "artifact",
  },
];

const ITEMS: Record<string, BoxContent[]> = {
  "layer-app": [
    { id: "app-a", label: "业务逻辑", kind: "app", note: ["状态机 / 采样周期"], icon: ["react", "tauri"] },
    { id: "app-b", label: "服务调用", kind: "framework", note: ["事件总线 / 回调注册"], icon: ["docker"] },
  ],
  "layer-hal": [
    { id: "hal-bsp", label: "外设驱动与寄存器映射", kind: "hardware", note: ["统一接口 · 屏蔽厂商差异"], icon: ["espressif"] },
  ],
  "layer-hw": [
    { id: "hw-cpu", label: "主控 MCU", kind: "hardware", note: ["中断控制器 NVIC"], icon: ["stmicroelectronics"] },
    { id: "hw-dma", label: "DMA 控制器", kind: "storage", shape: "cylinder", icon: ["rust"] },
  ],
};

/**
 * 计算整张架构图
 *
 * @param breakpoint 画布标识（单视图项目固定为 layout.config.json 里声明的那一个）
 * @returns 该视图的 Layout Tree
 *
 * 功能：产出标题带 + 三个分层容器 + 图例，以及四条连线（含一条绕行走廊的回环线）。
 * 实现原理：所有纵向位置由「上一个容器的底部 + 层间距」累加得出，画布高度由内容决定；
 *           连线端点用 builder.anchor() 算，正交路由用 builder.route()，
 *           需要绕开所有节点的长连线用 waypoint() 显式给出走廊坐标。
 */
function layout(breakpoint: string) {
  const contentW = CANVAS_W - MARGIN - MARGIN;
  const innerX = MARGIN + PAD;
  const innerW = contentW - PAD - PAD;
  const itemW2 = half(innerW - GAP);
  const layerH = HEAD_H + NODE_H + PAD;

  const titleY = MARGIN;
  const layerYs = LAYERS.map((_, i) => titleY + TITLE_H + TITLE_GAP + i * (layerH + SEC_GAP));
  const legendY = titleY + TITLE_H + TITLE_GAP + LAYERS.length * (layerH + SEC_GAP);
  const legendH = HEAD_H + LEGEND_ROWS * LEGEND_ROW_H + PAD;
  const canvasH = legendY + legendH + MARGIN;
  // 回环连线走「最后一层下方、图例上方」的横向空隙 + 层容器之外的左侧竖向走廊
  const detourY = layerYs[LAYERS.length - 1] + layerH + half(SEC_GAP);

  const nodeY = (yi: number) => layerYs[yi] + HEAD_H;

  const itemExpr = (yi: number, i: number) => ({
    x: ex(`L${yi + 1}_ITEM_X + ${i}*(ITEM_W2 + GAP)`, `${num(innerX)} + ${i} * (${num(itemW2)} + ${num(GAP)})`),
    y: ex(`L${yi + 1}_NODE_Y`, num(nodeY(yi))),
    w: ex("ITEM_W2", num(itemW2)),
    h: ex("NODE_H", num(NODE_H)),
  });
  const soloExpr = (yi: number) => ({
    x: ex(`L${yi + 1}_ITEM_X`, num(innerX)),
    y: ex(`L${yi + 1}_NODE_Y`, num(nodeY(yi))),
    w: ex("INNER_W", num(innerW)),
    h: ex("NODE_H", num(NODE_H)),
  });

  // ── 标题带 ──
  const titleNode = {
    id: "title",
    label: "{{PROJECT_TITLE}}",
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
  const layerNodes = LAYERS.map((layer, yi) => {
    const prev = yi === 0 ? null : `L${yi}_Y`;
    const children = (ITEMS[layer.id] ?? []).map((it, i) => {
      const solo = (ITEMS[layer.id] ?? []).length === 1;
      const expr = solo ? soloExpr(yi) : itemExpr(yi, i);
      const w = solo ? innerW : itemW2;
      const card: BoxContent & { x: number; y: number; w: number; h: number; expr: unknown; refs: string[]; children: unknown[] } = {
        id: it.id,
        label: it.label,
        kind: it.kind,
        ...(it.tone ? { tone: it.tone } : {}),
        ...(it.shape ? { shape: it.shape } : {}),
        note: it.note,
        x: innerX + i * (w + GAP),
        y: nodeY(yi),
        w,
        h: NODE_H,
        refs: [`L${yi + 1}_ITEM_X`, `L${yi + 1}_NODE_Y`, "ITEM_W2", "INNER_W", "NODE_H", "GAP"],
        expr,
        children: [],
      } as never;
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

  // ── 连线标签：白色底衬，落在层间空隙里；盒宽贴合文字、高度仍用 LABEL_H ──
  const labelWidths: Record<string, number> = {};
  const labelNode = (id: string, text: string, cx: number, cy: number, symX: string, symY: string) => {
    const wKey = `${id.toUpperCase().replace(/-/g, "_")}_W`;
    // textWidth 保留两位小数，可能比 check-drawio 的原始估算小一个浮点尾差；
    // 向上取整到整像素，保证「文字估算宽 + 左右 labelPad」严格装得下最长一行。
    const labelW = Math.ceil(textWidth(text, TYPE.note)) + 2 * DRAWIO_METRICS.labelPad;
    labelWidths[wKey] = labelW;
    return {
      id,
      label: text,
      kind: "edgeLabel",
      x: cx - half(labelW),
      y: cy - half(LABEL_H),
      w: labelW,
      h: LABEL_H,
      refs: [symX, symY, wKey, "LABEL_H"],
      expr: {
        x: ex(`${symX} - ${wKey} / 2`, `${num(cx)} - ${num(labelW)} / 2`),
        y: ex(`${symY} - LABEL_H / 2`, `${num(cy)} - ${num(LABEL_H)} / 2`),
        w: ex(wKey, num(labelW)),
        h: ex("LABEL_H", num(LABEL_H)),
      },
      children: [],
    };
  };

  const appA = findNode("app-a");
  const appB = findNode("app-b");
  const hal = findNode("hal-bsp");
  const cpu = findNode("hw-cpu");
  const dma = findNode("hw-dma");

  // 中间量：连线路由的中位线 y（层间空隙的中点）与标签中心 x
  const mid12 = gapMid(appB, hal);
  const mid23 = gapMid(hal, cpu);
  const lx1 = midX(appB, hal);
  const lx2 = midX(hal, cpu);
  const lx3 = midX(hal, dma);
  const lx4 = midNum(CORRIDOR_X, centerX(cpu));

  const labels = [
    labelNode("lbl-call", "调用", lx1, mid12, "E1_MID_X", "E1_MID_Y"),
    labelNode("lbl-cfg", "配置", lx2, mid23, "E2_MID_X", "E2_MID_Y"),
    labelNode("lbl-irq", "中断", lx3, mid23, "E3_MID_X", "E3_MID_Y"),
    labelNode("lbl-echo", "回显", lx4, detourY, "E4_MID_X", "E4_MID_Y"),
  ];

  // ── 图例：色样 + 说明文字成对出现 ──
  const legendRows = [
    { swatch: "lg-app", kind: "app", text: "实心方块 = 应用 / 业务节点（宝蓝）" },
    { swatch: "lg-hw", kind: "hardware", text: "实心方块 = 硬件 / 物理节点（藏青）" },
    { swatch: "lg-line", kind: "edgeControl", text: "线段 = 控制 / 中断 / 回显线色（宝蓝，线上为虚线）" },
  ];
  // 行内垂直居中量：由「行高 − 内容高」的一半得出，行高的出处是 token
  const swatchInset = inset(LEGEND_ROW_H, LEGEND_SWATCH_H);
  const textInset = inset(LEGEND_ROW_H, TYPE.note * DRAWIO_METRICS.lineHeight);
  const lgrY = legendY + HEAD_H;
  const legendChildren = legendRows.map((row, i) => {
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
          y: ex(`LGR_Y + ${i}*LEGEND_ROW_H + (LEGEND_ROW_H - LEGEND_SWATCH_H) / 2`,
                 `${num(lgrY)} + ${i} * ${num(LEGEND_ROW_H)} + (${num(LEGEND_ROW_H)} - ${num(LEGEND_SWATCH_H)}) / 2`),
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
          x: ex("LGR_X + LEGEND_SWATCH_W + LEGEND_SWATCH_GAP",
                 `${num(innerX)} + ${num(LEGEND_SWATCH_W)} + ${num(LEGEND_SWATCH_GAP)}`),
          y: ex(`LGR_Y + ${i}*LEGEND_ROW_H + (LEGEND_ROW_H - TYPE_NOTE*DRAWIO_LINE_HEIGHT) / 2`,
                 `${num(lgrY)} + ${i} * ${num(LEGEND_ROW_H)} + (${num(LEGEND_ROW_H)} - ${num(TYPE.note)} * ${DRAWIO_METRICS.lineHeight}) / 2`),
          w: ex("INNER_W - LEGEND_SWATCH_W - LEGEND_SWATCH_GAP",
                 `${num(innerW)} - ${num(LEGEND_SWATCH_W)} - ${num(LEGEND_SWATCH_GAP)}`),
          h: ex("LEGEND_ROW_H", num(LEGEND_ROW_H)),
        },
        children: [],
      },
    ];
  }).flat();

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
      y: ex(`L${LAYERS.length}_Y + LAYER_H + SEC_GAP`,
             `${num(layerYs[LAYERS.length - 1])} + ${num(layerH)} + ${num(SEC_GAP)}`),
      w: ex("CANVAS_W - MARGIN - MARGIN", `${num(CANVAS_W)} - ${num(MARGIN)} - ${num(MARGIN)}`),
      h: ex("HEAD_H + LEGEND_ROWS*LEGEND_ROW_H + PAD",
             `${num(HEAD_H)} + ${num(LEGEND_ROWS)} * ${num(LEGEND_ROW_H)} + ${num(PAD)}`),
    },
    children: legendChildren,
  };

  // ── 连线 ──
  const e1 = edge({ id: "e-call-cfg", from: appB, fromSide: "S", to: hal, toSide: "N",
                    via: route(appB, "S", hal, "N"), role: "data", labelNode: "lbl-call" });
  const e2 = edge({ id: "e-hal-cpu", from: hal, fromSide: "S", to: cpu, toSide: "N",
                    via: route(hal, "S", cpu, "N"), role: "data", labelNode: "lbl-cfg" });
  const e3 = edge({ id: "e-hal-dma", from: hal, fromSide: "S", to: dma, toSide: "N",
                    via: route(hal, "S", dma, "N"), role: "control", arrow: "both", labelNode: "lbl-irq" });
  // 回环线：从 CPU 向下 → 沿左侧走廊上行 → 从「业务逻辑」左侧进入。
  // 三段途经点都显式给出，因此「不横穿任何节点」是算出来的，不是碰运气。
  const cs = anchor(cpu, "S");
  const aw = anchor(appA, "W");
  const e4 = edge({
    id: "e-echo",
    from: cpu, fromSide: "S", to: appA, toSide: "W",
    via: [
      waypoint(cs.x, detourY, cs.expr.x, ex("DETOUR_Y", num(detourY))),
      waypoint(CORRIDOR_X, detourY, ex("CORRIDOR_X", num(CORRIDOR_X)), ex("DETOUR_Y", num(detourY))),
      waypoint(CORRIDOR_X, aw.y, ex("CORRIDOR_X", num(CORRIDOR_X)), aw.expr.y),
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
    ...labelWidths,
    INNER_W: innerW,
    ITEM_W2: itemW2,
    LAYER_H: layerH,
    LEGEND_ROWS,
    LEGEND_ROW_H,
    LEGEND_SWATCH_W,
    LEGEND_SWATCH_H,
    LEGEND_SWATCH_GAP,
    LEGEND_Y: legendY,
    LEGEND_H: legendH,
    DETOUR_Y: detourY,
    CORRIDOR_X,
    "SPACE.md": SPACE.md,
    "SPACE.lg": SPACE.lg,
    "SPACE.xl": SPACE.xl,
    "SPACE.xxl": SPACE.xxl,
    // 连线标签定位用的中间量
    E1_MID_X: lx1,
    E1_MID_Y: mid12,
    E2_MID_X: lx2,
    E2_MID_Y: mid23,
    E3_MID_X: lx3,
    E3_MID_Y: mid23,
    E4_MID_X: lx4,
    E4_MID_Y: detourY,
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
    DRAWIO_ACCENT_ENTRY: DRAWIO_ACCENT.entry,
    DRAWIO_ACCENT_COMPUTE: DRAWIO_ACCENT.compute,
    DRAWIO_ACCENT_CONTRACT: DRAWIO_ACCENT.contract,
    DRAWIO_ACCENT_DRAW: DRAWIO_ACCENT.draw,
    DRAWIO_ACCENT_ARTIFACT: DRAWIO_ACCENT.artifact,
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
  LAYERS.forEach((_, i) => {
    snapshot[`L${i + 1}_Y`] = layerYs[i];
    snapshot[`L${i + 1}_NODE_Y`] = nodeY(i);
    snapshot[`L${i + 1}_ITEM_X`] = innerX;
  });
  snapshot.LGR_X = innerX;
  snapshot.LGR_Y = lgrY;

  return tree({
    canvas: canvas({ w: CANVAS_W, h: canvasH, breakpoint }),
    variableSnapshot: snapshot,
    elements: [titleNode, ...layerNodes, legendNode, ...labels],
    edges: [e1, e2, e3, e4],
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
  const view = {{VIEW_JSON}};
  if (breakpoint !== view) {
    throw new Error(`本视图只声明了画布 ${view}，收到 ${breakpoint}（见 layout.config.json）`);
  }
  return layout(breakpoint);
}
