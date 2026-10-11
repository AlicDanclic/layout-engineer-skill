/**
 * 布局计算入口（纯函数）。
 *
 * 契约：buildLayout(breakpoint) -> LayoutTree
 *
 * 三条硬约束：
 *   1. 无副作用：不读文件、不打日志、不改全局状态（assert-layout 会用同输入复算比对）。
 *   2. 零几何字面量：所有数字来自 variables/ 或 context()，表达式里也不夹带字面量。
 *   3. **双断点共享一套公式**：断点差异只出现在 context() 里，之后所有坐标公式只有一份、
 *      不感知断点。将来加平板档只改 context()，公式零改动。
 */
import { canvas, colRects, num, pct, round, tree } from "../../vendor/layout-engine/builder.mjs";
import { COLOR, FONT, GRADIENT, ORIGIN, RADIUS, SHADOW, SPACE, TYPE } from "../../variables/tokens.ts";
import {
  CANVAS_DESKTOP,
  CANVAS_MOBILE,
  CARD_COUNT,
  CARD_H_DESKTOP,
  CARD_H_MOBILE,
  COLUMNS_DESKTOP,
  COLUMNS_MOBILE,
  COLUMN_RATIO_DESKTOP,
  COLUMN_RATIO_MOBILE,
  FOOTER_H,
  GAP_LG,
  HEADER_H,
  NAV_ITEM_COUNT,
  NAV_ITEM_H,
  PAD,
  SIDEBAR_W_DESKTOP,
  SIDEBAR_W_MOBILE,
} from "../../variables/layout.ts";

type Breakpoint = "mobile" | "desktop";

interface Ctx {
  breakpoint: Breakpoint;
  canvasW: number;
  canvasH: number;
  headerH: number;
  footerH: number;
  gapLg: number;
  pad: number;
  sidebarW: number;
  cols: number;
  columnRatio: number;
  cardH: number;
  cardCount: number;
  navItemH: number;
  navCount: number;
}

/**
 * 构建断点上下文
 *
 * @param breakpoint 断点标识
 * @returns 该断点下所有会变化的取值
 *
 * 功能：把「断点差异」收敛到一个对象里。
 * 实现原理：**这是全项目唯一读取断点的地方**；其余公式只消费 ctx 的取值，
 *           因此不存在「两套公式随迭代漂移」的问题。
 */
function context(breakpoint: Breakpoint): Ctx {
  const isDesktop = breakpoint === "desktop";
  return {
    breakpoint,
    canvasW: isDesktop ? CANVAS_DESKTOP.w : CANVAS_MOBILE.w,
    canvasH: isDesktop ? CANVAS_DESKTOP.h : CANVAS_MOBILE.h,
    headerH: HEADER_H,
    footerH: FOOTER_H,
    gapLg: GAP_LG,
    pad: PAD,
    sidebarW: isDesktop ? SIDEBAR_W_DESKTOP : SIDEBAR_W_MOBILE,
    cols: isDesktop ? COLUMNS_DESKTOP : COLUMNS_MOBILE,
    columnRatio: isDesktop ? COLUMN_RATIO_DESKTOP : COLUMN_RATIO_MOBILE,
    cardH: isDesktop ? CARD_H_DESKTOP : CARD_H_MOBILE,
    cardCount: CARD_COUNT,
    navItemH: NAV_ITEM_H,
    navCount: NAV_ITEM_COUNT,
  };
}

// expr 构造：符号算式 = 数值算式（两段都必须能复算出结果）
const ex = (sym: string, numeric: string) => `${sym} = ${numeric}`;

/**
 * 计算卡片在网格中的坐标
 *
 * @param index 卡片序号，从 0 开始
 * @param ctx 断点上下文（含列数、卡片尺寸）
 * @param area 卡片区域左上角与可用宽度
 * @param cardW 单张卡片宽度
 * @returns 卡片矩形与所在行列
 *
 * 功能：将第 index 张卡片分配到网格的第 row 行第 col 列。
 * 实现原理：col = index % ctx.cols；row = floor(index / ctx.cols)；
 *           x = area.x + col × (cardW + SPACE.md)；
 *           y = area.y + row × (cardH + SPACE.lg)。
 */
function cardBox(
  index: number,
  ctx: Ctx,
  area: { x: number; y: number; w: number },
  cardW: number,
) {
  const col = index % ctx.cols;
  const row = Math.floor(index / ctx.cols);
  return {
    x: round(area.x + col * (cardW + SPACE.md)),
    y: round(area.y + row * (ctx.cardH + SPACE.lg)),
    w: cardW,
    h: ctx.cardH,
    col,
    row,
  };
}

/**
 * 计算页面布局树
 *
 * @param ctx 断点上下文
 * @returns 该断点的 Layout Tree
 *
 * 功能：产出 header / sidebar / card-list / footer 四段结构及其子节点。
 * 实现原理：内容区 y = headerH + gapLg，高 = 画布高 − 页头 − 页脚 − 两段 gapLg；
 *           列表 x = sidebarW + gapLg（移动端 sidebarW 取 0，于是公式退化但仍只有一份）；
 *           卡片宽度由区域宽度按 columnRatio 百分比得出。
 */
function layout(ctx: Ctx) {
  const contentY = ctx.headerH + ctx.gapLg;
  const contentH = ctx.canvasH - ctx.headerH - ctx.gapLg - ctx.footerH - ctx.gapLg;
  const listX = ctx.sidebarW + ctx.gapLg;
  const listW = ctx.canvasW - listX - ctx.gapLg;
  const footerY = ctx.canvasH - ctx.footerH;

  const areaX = listX + ctx.pad;
  const areaY = contentY + ctx.pad;
  const areaW = listW - ctx.pad - ctx.pad;
  const cardW = pct(areaW - (ctx.cols - 1) * SPACE.md, ctx.columnRatio);

  const navX = ORIGIN + ctx.pad;
  const navW = ctx.sidebarW - ctx.pad - ctx.pad;

  const snapshot = {
    ORIGIN,
    // 设计 token 与几何一起归档：渲染器读它，配色/字号/阴影/渐变/字体都可追溯
    COLOR_INK: COLOR.ink,
    COLOR_INK_SOFT: COLOR.inkSoft,
    COLOR_INK_FAINT: COLOR.inkFaint,
    COLOR_CANVAS: COLOR.canvas,
    COLOR_SURFACE: COLOR.surface,
    COLOR_BORDER: COLOR.border,
    COLOR_HEADER: COLOR.accent,
    COLOR_CONTENT: COLOR.accent,
    COLOR_FOOTER: COLOR.accent,
    COLOR_ACCENT_DEEP: COLOR.accentDeep,
    TYPE_DISPLAY: TYPE.display,
    TYPE_SECTION: TYPE.section,
    TYPE_ITEM: TYPE.item,
    TYPE_NOTE: TYPE.note,
    TYPE_CAPTION: TYPE.caption,
    RADIUS_SECTION: RADIUS.section,
    RADIUS_ITEM: RADIUS.item,
    RADIUS_ACCENT: RADIUS.accent,
    SHADOW_ELEV1_DY: SHADOW.elev1.dy,
    SHADOW_ELEV1_BLUR: SHADOW.elev1.blur,
    SHADOW_ELEV1_ALPHA: SHADOW.elev1.alpha,
    SHADOW_ELEV2_DY: SHADOW.elev2.dy,
    SHADOW_ELEV2_BLUR: SHADOW.elev2.blur,
    SHADOW_ELEV2_ALPHA: SHADOW.elev2.alpha,
    SHADOW_ELEV3_DY: SHADOW.elev3.dy,
    SHADOW_ELEV3_BLUR: SHADOW.elev3.blur,
    SHADOW_ELEV3_ALPHA: SHADOW.elev3.alpha,
    GRADIENT_ANGLE: GRADIENT.angle,
    GRADIENT_CARD_MIX: GRADIENT.cardMix,
    FONT_FAMILY: FONT.family,
    "SPACE.sm": SPACE.sm,
    "SPACE.md": SPACE.md,
    "SPACE.lg": SPACE.lg,
    CANVAS_W: ctx.canvasW,
    CANVAS_H: ctx.canvasH,
    HEADER_H: ctx.headerH,
    FOOTER_H: ctx.footerH,
    GAP_LG: ctx.gapLg,
    PAD: ctx.pad,
    SIDEBAR_W: ctx.sidebarW,
    COLUMNS: ctx.cols,
    COLUMN_RATIO: round(ctx.columnRatio, 4),
    CARD_H: ctx.cardH,
    CARD_COUNT: ctx.cardCount,
    NAV_ITEM_H: ctx.navItemH,
    NAV_ITEM_COUNT: ctx.navCount,
    CONTENT_Y: contentY,
    CONTENT_H: contentH,
    LIST_X: listX,
    LIST_Y: contentY,
    LIST_W: listW,
    LIST_H: contentH,
    FOOTER_Y: footerY,
    NAV_X: navX,
    NAV_W: navW,
    CARD_AREA_X: areaX,
    CARD_AREA_Y: areaY,
    CARD_AREA_W: areaW,
    CARD_W: cardW,
  };

  const edges = {
    x: ex("ORIGIN", num(ORIGIN)),
    y: ex("ORIGIN", num(ORIGIN)),
    w: ex("CANVAS_W", num(ctx.canvasW)),
  };

  const header = {
    id: "header",
    label: "header",
    x: ORIGIN,
    y: ORIGIN,
    w: ctx.canvasW,
    h: ctx.headerH,
    refs: ["ORIGIN", "CANVAS_W", "HEADER_H"],
    expr: { ...edges, h: ex("HEADER_H", num(ctx.headerH)) },
    children: [],
  };

  const footer = {
    id: "footer",
    label: "footer",
    x: ORIGIN,
    y: footerY,
    w: ctx.canvasW,
    h: ctx.footerH,
    refs: ["ORIGIN", "CANVAS_W", "CANVAS_H", "FOOTER_H"],
    expr: {
      ...edges,
      y: ex("CANVAS_H - FOOTER_H", `${num(ctx.canvasH)} - ${num(ctx.footerH)}`),
      h: ex("FOOTER_H", num(ctx.footerH)),
    },
    children: [],
  };

  const listExpr = {
    x: ex("SIDEBAR_W + GAP_LG", `${num(ctx.sidebarW)} + ${num(ctx.gapLg)}`),
    y: ex("HEADER_H + GAP_LG", `${num(ctx.headerH)} + ${num(ctx.gapLg)}`),
    w: ex(
      "CANVAS_W - SIDEBAR_W - GAP_LG - GAP_LG",
      `${num(ctx.canvasW)} - ${num(ctx.sidebarW)} - ${num(ctx.gapLg)} - ${num(ctx.gapLg)}`,
    ),
    h: ex(
      "CANVAS_H - HEADER_H - GAP_LG - FOOTER_H - GAP_LG",
      `${num(ctx.canvasH)} - ${num(ctx.headerH)} - ${num(ctx.gapLg)} - ${num(ctx.footerH)} - ${num(ctx.gapLg)}`,
    ),
  };

  const cards = Array.from({ length: ctx.cardCount }, (_, i) => {
    const b = cardBox(i, ctx, { x: areaX, y: areaY, w: areaW }, cardW);
    return {
      id: `card-${i + 1}`,
      label: `card ${i + 1}`,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      refs: ["CARD_AREA_X", "CARD_AREA_Y", "CARD_W", "CARD_H", "SPACE.md", "SPACE.lg"],
      // 数值段统一成「起点 + 序号 × 步长」的纯数字算式，与符号段结构一致
      expr: {
        x: ex(
          `CARD_AREA_X + ${b.col}*(CARD_W + SPACE.md)`,
          `${num(areaX)} + ${b.col} * (${num(cardW)} + ${num(SPACE.md)})`,
        ),
        y: ex(
          `CARD_AREA_Y + ${b.row}*(CARD_H + SPACE.lg)`,
          `${num(areaY)} + ${b.row} * (${num(ctx.cardH)} + ${num(SPACE.lg)})`,
        ),
        w: ex("CARD_W", num(cardW)),
        h: ex("CARD_H", num(ctx.cardH)),
      },
    };
  });

  const cardList = {
    id: "card-list",
    label: "card-list",
    x: listX,
    y: contentY,
    w: listW,
    h: contentH,
    refs: ["SIDEBAR_W", "GAP_LG", "CANVAS_W", "CANVAS_H", "HEADER_H", "FOOTER_H", "PAD"],
    expr: listExpr,
    children: cards,
  };

  const sidebars = ctx.sidebarW > 0
    ? [
        {
          id: "sidebar",
          label: "sidebar",
          x: ORIGIN,
          y: contentY,
          w: ctx.sidebarW,
          h: contentH,
          refs: ["ORIGIN", "SIDEBAR_W", "HEADER_H", "GAP_LG", "CANVAS_H", "FOOTER_H", "PAD"],
          expr: {
            x: ex("ORIGIN", num(ORIGIN)),
            y: ex("HEADER_H + GAP_LG", `${num(ctx.headerH)} + ${num(ctx.gapLg)}`),
            w: ex("SIDEBAR_W", num(ctx.sidebarW)),
            h: ex(
              "CANVAS_H - HEADER_H - GAP_LG - FOOTER_H - GAP_LG",
              `${num(ctx.canvasH)} - ${num(ctx.headerH)} - ${num(ctx.gapLg)} - ${num(ctx.footerH)} - ${num(ctx.gapLg)}`,
            ),
          },
          children: colRects({
            x: navX,
            y: contentY + ctx.pad,
            w: navW,
            itemH: ctx.navItemH,
            count: ctx.navCount,
            gap: SPACE.sm,
          }).map((r, i) => ({
            id: `nav-item-${i + 1}`,
            label: `nav ${i + 1}`,
            x: r.x,
            y: r.y,
            w: r.w,
            h: r.h,
            refs: ["CONTENT_Y", "PAD", "NAV_ITEM_H", "SPACE.sm", "SIDEBAR_W"],
            expr: {
              x: ex("ORIGIN + PAD", `${num(ORIGIN)} + ${num(ctx.pad)}`),
              y: ex(
                `CONTENT_Y + PAD + ${i}*(NAV_ITEM_H + SPACE.sm)`,
                `${num(contentY)} + ${num(ctx.pad)} + ${i} * (${num(ctx.navItemH)} + ${num(SPACE.sm)})`,
              ),
              w: ex("SIDEBAR_W - PAD - PAD", `${num(ctx.sidebarW)} - ${num(ctx.pad)} - ${num(ctx.pad)}`),
              h: ex("NAV_ITEM_H", num(ctx.navItemH)),
            },
            children: [],
          })),
        },
      ]
    : [];

  // 语义顺序固定：header → sidebar（可选）→ card-list → footer
  return tree({
    canvas: canvas({ w: ctx.canvasW, h: ctx.canvasH, breakpoint: ctx.breakpoint }),
    variableSnapshot: snapshot,
    elements: [header, ...sidebars, cardList, footer],
  });
}

/**
 * 按断点计算 Layout Tree
 *
 * @param breakpoint 断点标识，"mobile" 或 "desktop"
 * @returns 该断点下的 Layout Tree
 *
 * 功能：构建上下文并调用唯一的 layout()。
 * 实现原理：全流程只在这里出现一次断点判断（转交给 context），
 *           布局公式对断点完全无感知。
 */
export function buildLayout(breakpoint: Breakpoint) {
  return layout(context(breakpoint));
}
