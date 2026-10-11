/**
 * 布局计算入口（纯函数）—— {{PROJECT_TITLE}}
 *
 * 契约：buildLayout(breakpoint) -> LayoutTree
 *
 * 三条硬约束：
 *   1. 无副作用：不读文件、不打日志、不改全局状态。
 *   2. 零几何字面量：所有数字来自 variables/ 或 context()。
 *   3. **双断点共享一套公式**：断点差异只出现在 context() 里，
 *      之后所有坐标公式只有一份、不感知断点。
 */
import { canvas, num, tree } from "../../vendor/layout-engine/builder.mjs";
import { COLOR, FONT, GRADIENT, ORIGIN, RADIUS, SHADOW, SPACE, TYPE } from "../../variables/tokens.ts";
import {
  CANVAS_DESKTOP,
  CANVAS_MOBILE,
  FOOTER_H,
  GAP_LG,
  HEADER_H,
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
}

// expr 构造：符号算式 = 数值算式（两段都必须能复算出结果）
const ex = (sym: string, numeric: string) => `${sym} = ${numeric}`;

/**
 * 构建断点上下文
 *
 * @param breakpoint 断点标识
 * @returns 该断点下所有会变化的取值
 *
 * 功能：把断点差异收敛到一个对象里。
 * 实现原理：这是全项目唯一读取断点的地方；其余公式只消费 ctx 的取值。
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
  };
}

/**
 * 计算页面布局树
 *
 * @param ctx 断点上下文
 * @returns 该断点的 Layout Tree
 *
 * 功能：产出页头 / 内容区（可选侧栏）/ 页脚三段结构。
 * 实现原理：内容区 y = headerH + gapLg，高 = 画布高 − 页头 − 页脚 − 两段 gapLg；
 *           内容区 x = sidebarW + gapLg（移动端 sidebarW 取 0，公式自然退化但仍只有一份）；
 *           页脚贴底 y = 画布高 − footerH。
 */
function layout(ctx: Ctx) {
  const contentY = ctx.headerH + ctx.gapLg;
  const contentH = ctx.canvasH - ctx.headerH - ctx.gapLg - ctx.footerH - ctx.gapLg;
  const contentX = ctx.sidebarW + ctx.gapLg;
  const contentW = ctx.canvasW - contentX - ctx.gapLg;
  const footerY = ctx.canvasH - ctx.footerH;
  const sideH = contentH;

  const snapshot = {
    ORIGIN,
    // 设计 token 与几何一起归档：渲染器读它，配色/字号也可追溯到 variables/
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
    "SPACE.lg": SPACE.lg,
    CANVAS_W: ctx.canvasW,
    CANVAS_H: ctx.canvasH,
    HEADER_H: ctx.headerH,
    FOOTER_H: ctx.footerH,
    GAP_LG: ctx.gapLg,
    PAD: ctx.pad,
    SIDEBAR_W: ctx.sidebarW,
    CONTENT_X: contentX,
    CONTENT_Y: contentY,
    CONTENT_W: contentW,
    CONTENT_H: contentH,
    FOOTER_Y: footerY,
  };

  const header = {
    id: "header",
    label: "header",
    x: ORIGIN,
    y: ORIGIN,
    w: ctx.canvasW,
    h: ctx.headerH,
    refs: ["ORIGIN", "CANVAS_W", "HEADER_H"],
    expr: {
      x: ex("ORIGIN", num(ORIGIN)),
      y: ex("ORIGIN", num(ORIGIN)),
      w: ex("CANVAS_W", num(ctx.canvasW)),
      h: ex("HEADER_H", num(ctx.headerH)),
    },
    children: [],
  };

  const content = {
    id: "content",
    label: "content",
    x: contentX,
    y: contentY,
    w: contentW,
    h: contentH,
    refs: ["SIDEBAR_W", "GAP_LG", "CANVAS_W", "CANVAS_H", "HEADER_H", "FOOTER_H"],
    expr: {
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
    },
    children: [],
  };

  const sidebar =
    ctx.sidebarW > 0
      ? [
          {
            id: "sidebar",
            label: "sidebar",
            x: ORIGIN,
            y: contentY,
            w: ctx.sidebarW,
            h: sideH,
            refs: ["ORIGIN", "SIDEBAR_W", "HEADER_H", "GAP_LG", "CANVAS_H", "FOOTER_H"],
            expr: {
              x: ex("ORIGIN", num(ORIGIN)),
              y: ex("HEADER_H + GAP_LG", `${num(ctx.headerH)} + ${num(ctx.gapLg)}`),
              w: ex("SIDEBAR_W", num(ctx.sidebarW)),
              h: ex(
                "CANVAS_H - HEADER_H - GAP_LG - FOOTER_H - GAP_LG",
                `${num(ctx.canvasH)} - ${num(ctx.headerH)} - ${num(ctx.gapLg)} - ${num(ctx.footerH)} - ${num(ctx.gapLg)}`,
              ),
            },
            children: [],
          },
        ]
      : [];

  const footer = {
    id: "footer",
    label: "footer",
    x: ORIGIN,
    y: footerY,
    w: ctx.canvasW,
    h: ctx.footerH,
    refs: ["ORIGIN", "CANVAS_W", "CANVAS_H", "FOOTER_H"],
    expr: {
      x: ex("ORIGIN", num(ORIGIN)),
      y: ex("CANVAS_H - FOOTER_H", `${num(ctx.canvasH)} - ${num(ctx.footerH)}`),
      w: ex("CANVAS_W", num(ctx.canvasW)),
      h: ex("FOOTER_H", num(ctx.footerH)),
    },
    children: [],
  };

  return tree({
    canvas: canvas({ w: ctx.canvasW, h: ctx.canvasH, breakpoint: ctx.breakpoint }),
    variableSnapshot: snapshot,
    elements: [header, ...sidebar, content, footer],
  });
}

/**
 * 按断点计算 Layout Tree
 *
 * @param breakpoint 断点标识，"mobile" 或 "desktop"
 * @returns 该断点的 Layout Tree
 *
 * 功能：构建上下文并调用唯一的 layout()。
 * 实现原理：断点只在 context() 里被读取一次，公式层完全无感知。
 */
export function buildLayout(breakpoint: Breakpoint) {
  return layout(context(breakpoint));
}
