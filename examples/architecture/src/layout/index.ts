/**
 * 布局计算入口（纯函数）—— 用 layout-engineer 画的 layout-engineer 自身架构图。
 *
 * 契约：buildLayout(breakpoint) -> LayoutTree
 *
 * 设计要点：**双断点共享一套公式**。
 * 断点只决定两件事：画布宽度，以及子项的排列方向（桌面横向 / 移动纵向）。
 * 排列方向被抽成 placeItems() 里的一个分支，所有区块复用同一个函数，
 * 因此不存在「桌面一套公式、移动一套公式」随迭代漂移的问题。
 */
import { canvas, colRects, num, rowRects, tree } from "../../vendor/layout-engine/builder.mjs";
import { COLOR, FONT, GRADIENT, ORIGIN, RADIUS, SHADOW, SPACE, TYPE } from "../../variables/tokens.ts";
import {
  ARCHIVE_COUNT,
  ARCHIVE_ITEM_H_DESKTOP,
  ARCHIVE_ITEM_H_MOBILE,
  CANVAS_W_DESKTOP,
  CANVAS_W_MOBILE,
  CORE_COUNT,
  CORE_ITEM_H_DESKTOP,
  CORE_ITEM_H_MOBILE,
  GAP_DESKTOP,
  GAP_MOBILE,
  MARGIN_DESKTOP,
  MARGIN_MOBILE,
  SEC_GAP_DESKTOP,
  SEC_GAP_MOBILE,
  SEC_HEAD_H_DESKTOP,
  SEC_HEAD_H_MOBILE,
  TITLE_H_DESKTOP,
  TITLE_H_MOBILE,
  VERIFY_COUNT,
  VERIFY_ITEM_H_DESKTOP,
  VERIFY_ITEM_H_MOBILE,
  WORKFLOW_COUNT,
  WORKFLOW_ITEM_H_DESKTOP,
  WORKFLOW_ITEM_H_MOBILE,
} from "../../variables/layout.ts";

type Breakpoint = "mobile" | "desktop";
type Dir = "row" | "col";

interface BoxContent {
  id: string;
  label: string;
  note?: string[];
}

interface Ctx {
  breakpoint: Breakpoint;
  canvasW: number;
  margin: number;
  pad: number;
  gap: number;
  secGap: number;
  secHeadH: number;
  titleH: number;
  dir: Dir;
  workflowItemH: number;
  coreItemH: number;
  verifyItemH: number;
  archiveItemH: number;
}

const ex = (sym: string, numeric: string) => `${sym} = ${numeric}`;

// ── 内容表：文字不是几何，与断点无关 ──────────────────────────────────

const WORKFLOW: BoxContent[] = [
  { id: "wf-1", label: "① 需求解析", note: ["元素清单"] },
  { id: "wf-2", label: "A 结构确认", note: ["文本 box tree"] },
  { id: "wf-3", label: "② 变量定义", note: ["tokens / layout"] },
  { id: "wf-4", label: "③ 布局计算", note: ["纯函数 + expr"] },
  { id: "wf-5", label: "B 定位确认", note: ["双端各一次"] },
  { id: "wf-6", label: "⑤ 验证层", note: ["run-all 阻断"] },
  { id: "wf-7", label: "⑥ 渲染", note: ["序列化器"] },
  { id: "wf-8", label: "⑨ 归档", note: ["manifest.json"] },
];

const CORE: BoxContent[] = [
  {
    id: "core-input",
    label: "输入 · 变量与计算",
    note: [
      "tokens：间隔刻度 / 断点 / 主题色",
      "layout：元素特定尺寸（四行注释）",
      "context(bp)：断点差异只在这里",
      "buildLayout：纯函数，零几何字面量",
    ],
  },
  {
    id: "core-ir",
    label: "核心 · Layout Tree",
    note: [
      "canvas · variableSnapshot",
      "elements[] { id, label, depth }",
      "{ x, y, w, h }  绝对像素",
      "expr：符号算式 = 数值算式",
      "refs：显式变量引用（v1.1）",
    ],
  },
  {
    id: "core-output",
    label: "产物 · 序列化",
    note: [
      "react.mjs → Layout.tsx",
      "remotion.mjs → Composition.tsx",
      "diagram.py → 交付海报",
      "pil.py → 几何核对图",
      "preview.mjs → 双端预览",
    ],
  },
];

const VERIFY: BoxContent[] = [
  { id: "ver-1", label: "lint-geometry", note: ["几何裸字面量（含表达式内部）"] },
  { id: "ver-2", label: "assert-layout", note: ["越界 · 兄弟重叠", "间距刻度 · expr 完整"] },
  { id: "ver-3", label: "verify-positioning", note: ["expr 两段复算", "符号段 = 数值段 = 树值"] },
  { id: "ver-4", label: "check-env", note: [".nvmrc · 锁文件 · .venv", "globalInstall 自报"] },
  { id: "ver-5", label: "check-confirmation", note: ["确认闸门读文件", "指纹不符即失效"] },
  { id: "ver-6", label: "docgen", note: ["注释四要素", "缺项即报错"] },
];

const ARCHIVE: BoxContent[] = [
  {
    id: "arc-1",
    label: "源代码",
    note: ["variables/  tokens.ts + layout.ts", "src/layout/  布局计算纯函数", "src/serializers/  序列化产物"],
  },
  {
    id: "arc-2",
    label: "中间产物",
    note: ["layout-tree/  desktop + mobile .json", "positioning/  confirmed.json + svg", "positioning/storyboard/  关键帧"],
  },
  { id: "arc-3", label: "预览与文档", note: ["preview/  desktop|mobile .svg + .png", "docs/  index.html + data.json"] },
  { id: "arc-4", label: "索引与清单", note: ["manifest.json  反向索引 + 确认状态", "package.json + .nvmrc + lock"] },
];

const SECTIONS = [
  { id: "workflow", label: "工作流 · 九步 + 两个确认节点", items: WORKFLOW },
  { id: "core", label: "核心 · Layout Tree 是唯一几何事实来源", items: CORE },
  { id: "verify", label: "验证层 · run-all（不通过即阻断交付）", items: VERIFY },
  { id: "archive", label: "归档 · output/<project>/", items: ARCHIVE },
];

// ── 上下文与公式 ───────────────────────────────────────────────────────

/**
 * 构建断点上下文
 *
 * @param breakpoint 断点标识
 * @returns 该断点下所有会变化的取值（含排列方向）
 *
 * 功能：把断点差异收敛到一处。
 * 实现原理：全项目只有这里读取断点；dir 决定子项横向排列还是纵向堆叠，
 *           后续所有公式只消费 ctx，不再感知断点。
 */
function context(breakpoint: Breakpoint): Ctx {
  const isDesktop = breakpoint === "desktop";
  return {
    breakpoint,
    canvasW: isDesktop ? CANVAS_W_DESKTOP : CANVAS_W_MOBILE,
    margin: isDesktop ? MARGIN_DESKTOP : MARGIN_MOBILE,
    pad: isDesktop ? MARGIN_DESKTOP : MARGIN_MOBILE,
    gap: isDesktop ? GAP_DESKTOP : GAP_MOBILE,
    secGap: isDesktop ? SEC_GAP_DESKTOP : SEC_GAP_MOBILE,
    secHeadH: isDesktop ? SEC_HEAD_H_DESKTOP : SEC_HEAD_H_MOBILE,
    titleH: isDesktop ? TITLE_H_DESKTOP : TITLE_H_MOBILE,
    dir: isDesktop ? "row" : "col",
    workflowItemH: isDesktop ? WORKFLOW_ITEM_H_DESKTOP : WORKFLOW_ITEM_H_MOBILE,
    coreItemH: isDesktop ? CORE_ITEM_H_DESKTOP : CORE_ITEM_H_MOBILE,
    verifyItemH: isDesktop ? VERIFY_ITEM_H_DESKTOP : VERIFY_ITEM_H_MOBILE,
    archiveItemH: isDesktop ? ARCHIVE_ITEM_H_DESKTOP : ARCHIVE_ITEM_H_MOBILE,
  };
}

/**
 * 计算一个区块的高度
 *
 * @param ctx 断点上下文
 * @param count 子项数量
 * @param itemH 单个子项高度
 * @param note 是否附加说明行高度（此处未使用，保留扩展位）
 * @returns 区块总高
 *
 * 功能：区块高度 = 标题占位 + 子项在排列方向上的总跨度 + 内边距。
 * 实现原理：横向排列时跨度就是单格高度；纵向堆叠时跨度 =
 *           count × itemH + (count − 1) × gap。
 */
function sectionHeight(ctx: Ctx, count: number, itemH: number, note = 0) {
  void note;
  const span = ctx.dir === "row" ? itemH : count * itemH + (count - 1) * ctx.gap;
  return ctx.secHeadH + span + ctx.pad;
}

/**
 * 摆放区块内的子项
 *
 * @param ctx 断点上下文
 * @param sectionY 区块上边界
 * @param innerX 子项起始 x
 * @param innerW 子项可用宽度
 * @param itemH 子项高度
 * @param count 子项数量
 * @returns 子项矩形数组
 *
 * 功能：按 ctx.dir 把子项等分排成一行或堆成一列。
 * 实现原理：横向走 rowRects（等分宽度），纵向走 colRects（固定宽度、递增 y）；
 *           两种方向共用同一批尺寸参数，只有排列轴不同。
 */
function placeItems(ctx: Ctx, sectionY: number, innerX: number, innerW: number, itemH: number, count: number) {
  const y = sectionY + ctx.secHeadH;
  if (ctx.dir === "row") {
    return rowRects({ x: innerX, y, innerW, h: itemH, count, gap: ctx.gap });
  }
  return colRects({ x: innerX, y, w: innerW, itemH, count, gap: ctx.gap });
}

/**
 * 计算整张架构图
 *
 * @param ctx 断点上下文
 * @returns 该断点的 Layout Tree
 *
 * 功能：产出标题带 + 四个区块（工作流 / 核心 / 验证 / 归档）及其子盒子。
 * 实现原理：区块纵向依次排布，y = 上一区块底部 + secGap；画布高度由内容累加得出；
 *           子项排布统一交给 placeItems，因此两个断点共享同一套公式。
 */
function layout(ctx: Ctx) {
  const contentW = ctx.canvasW - ctx.margin - ctx.margin;
  const innerX = ctx.margin + ctx.pad;
  const innerW = contentW - ctx.pad - ctx.pad;

  const itemHs = [ctx.workflowItemH, ctx.coreItemH, ctx.verifyItemH, ctx.archiveItemH];
  const counts = [WORKFLOW_COUNT, CORE_COUNT, VERIFY_COUNT, ARCHIVE_COUNT];

  // 区块高度与纵向定位（内容决定画布高度）
  const heights = SECTIONS.map((_, i) => sectionHeight(ctx, counts[i], itemHs[i]));
  const titleY = ctx.margin;
  const sectionYs = [];
  let cursor = titleY + ctx.titleH + ctx.secGap;
  for (const h of heights) {
    sectionYs.push(cursor);
    cursor += h + ctx.secGap;
  }
  const canvasH = cursor - ctx.secGap + ctx.margin;

  // 先摆放，拿到实际格子宽（横向是等分宽，纵向是可用宽），快照据此写准
  const placedAll = SECTIONS.map((_, i) => placeItems(ctx, sectionYs[i], innerX, innerW, itemHs[i], counts[i]));

  // 变量快照：公式里用到的键 + 每个区块的定位键
  const snapshot: Record<string, number | string> = {
    ORIGIN,
    // 设计 token 与几何一起归档：渲染器读它，因此配色/字号也是「可追溯的变量」
    COLOR_INK: COLOR.ink,
    COLOR_INK_SOFT: COLOR.inkSoft,
    COLOR_INK_FAINT: COLOR.inkFaint,
    COLOR_CANVAS: COLOR.canvas,
    COLOR_SURFACE: COLOR.surface,
    COLOR_BORDER: COLOR.border,
    COLOR_WORKFLOW: COLOR.workflow,
    COLOR_CORE: COLOR.core,
    COLOR_VERIFY: COLOR.verify,
    COLOR_ARCHIVE: COLOR.archive,
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
    CANVAS_H: canvasH,
    MARGIN: ctx.margin,
    PAD: ctx.pad,
    GAP: ctx.gap,
    SEC_GAP: ctx.secGap,
    SEC_HEAD_H: ctx.secHeadH,
    TITLE_X: ctx.margin,
    TITLE_Y: titleY,
    TITLE_W: contentW,
    TITLE_H: ctx.titleH,
  };
  const prefixes = ["WF", "CORE", "VER", "ARC"];
  SECTIONS.forEach((_, i) => {
    const P = prefixes[i];
    void 0;
    snapshot[`${P}_X`] = ctx.margin;
    snapshot[`${P}_Y`] = sectionYs[i];
    snapshot[`${P}_W`] = contentW;
    snapshot[`${P}_H`] = heights[i];
    snapshot[`${P}_CX0`] = innerX;
    snapshot[`${P}_CY`] = sectionYs[i] + ctx.secHeadH;
    snapshot[`${P}_CX`] = innerX;
    snapshot[`${P}_CY0`] = sectionYs[i] + ctx.secHeadH;
    snapshot[`${P}_INNER_W`] = innerW;
    snapshot[`${P}_ITEM_W`] = placedAll[i][0].w;
    snapshot[`${P}_ITEM_H`] = itemHs[i];
  });

  const titleNode = {
    id: "title",
    label: "layout-engineer · 架构总览",
    x: ctx.margin,
    y: titleY,
    w: contentW,
    h: ctx.titleH,
    refs: ["MARGIN", "CANVAS_W", "TITLE_H"],
    note: ["几何即代码 · 两级确认 · 脚本强制验证 · 产物全归档"],
    expr: {
      x: ex("MARGIN", num(ctx.margin)),
      y: ex("MARGIN", num(ctx.margin)),
      w: ex("CANVAS_W - MARGIN - MARGIN", `${num(ctx.canvasW)} - ${num(ctx.margin)} - ${num(ctx.margin)}`),
      h: ex("TITLE_H", num(ctx.titleH)),
    },
    children: [],
  };

  const sections = SECTIONS.map((sec, si) => {
    const P = prefixes[si];
    const secY = sectionYs[si];
    const prevP = si === 0 ? null : prefixes[si - 1];
    const placed = placedAll[si];
    const isRow = ctx.dir === "row";

    const children = sec.items.map((it, i) => {
      const r = placed[i];
      const expr = isRow
        ? {
            x: ex(
              `${P}_CX0 + ${i}*(${P}_ITEM_W + GAP)`,
              `${num(innerX)} + ${i} * (${num(r.w)} + ${num(ctx.gap)})`,
            ),
            y: ex(`${P}_CY`, num(r.y)),
            w: ex(`${P}_ITEM_W`, num(r.w)),
            h: ex(`${P}_ITEM_H`, num(r.h)),
          }
        : {
            x: ex(`${P}_CX`, num(r.x)),
            y: ex(
              `${P}_CY0 + ${i}*(${P}_ITEM_H + GAP)`,
              `${num(placed[0].y)} + ${i} * (${num(r.h)} + ${num(ctx.gap)})`,
            ),
            w: ex(`${P}_ITEM_W`, num(r.w)),
            h: ex(`${P}_ITEM_H`, num(r.h)),
          };
      return {
        id: it.id,
        label: it.label,
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        note: it.note,
        refs: [`${P}_CX0`, `${P}_CX`, `${P}_CY`, `${P}_CY0`, `${P}_ITEM_W`, `${P}_ITEM_H`, "GAP", "RADIUS_ITEM"],
        expr,
        children: [],
      };
    });

    return {
      id: sec.id,
      label: sec.label,
      x: ctx.margin,
      y: secY,
      w: contentW,
      h: heights[si],
      refs: [`${P}_X`, `${P}_Y`, `${P}_W`, `${P}_H`, "RADIUS_SECTION"],
      expr: {
        x: ex("MARGIN", num(ctx.margin)),
        y:
          prevP === null
            ? ex("TITLE_Y + TITLE_H + SEC_GAP", `${num(titleY)} + ${num(ctx.titleH)} + ${num(ctx.secGap)}`)
            : ex(
                `${prevP}_Y + ${prevP}_H + SEC_GAP`,
                `${num(sectionYs[si - 1])} + ${num(heights[si - 1])} + ${num(ctx.secGap)}`,
              ),
        w: ex("CANVAS_W - MARGIN - MARGIN", `${num(ctx.canvasW)} - ${num(ctx.margin)} - ${num(ctx.margin)}`),
        h: ex(`${P}_H`, num(heights[si])),
      },
      children,
    };
  });

  return tree({
    canvas: canvas({ w: ctx.canvasW, h: canvasH, breakpoint: ctx.breakpoint }),
    variableSnapshot: snapshot,
    elements: [titleNode, ...sections],
  });
}

/**
 * 按断点计算架构图 Layout Tree
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
