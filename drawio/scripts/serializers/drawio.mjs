#!/usr/bin/env node
/**
 * serializer: drawio — Layout Tree → draw.io（diagrams.net）mxGraph XML。
 *
 * **铁律一：零几何计算。** 节点的 x/y/w/h、连线的端点与途经点，全部原样取自树。
 * 本文件里不存在「取节点框算锚点」这类代码——锚点已由布局纯函数经 builder.anchor()/
 * edge()/route() 算好并写进 `edge.fromPt` / `edge.toPt` / `edge.via`。
 *
 * **铁律二：零视觉硬编码。** 中国色、字阶、圆角、填充混合比全部从
 * `variableSnapshot` 的设计 token 读取（`DRAWIO_*` / `TYPE_*` / `RADIUS_*`）。
 * 换主题不需要改这个文件。
 *
 * 产物：
 *   <project>/drawio/<breakpoint>.drawio   —— 可直接导入 draw.io 编辑
 *   <project>/drawio/<breakpoint>.png      —— 由 drawio_png.py 解析上面这份 XML 渲出（同源）
 *
 * 为什么所有 mxCell 都 `parent="1"`（平铺而非嵌套）：
 *   Layout Tree 的坐标是**绝对像素**，而 mxGraph 里子顶点的坐标是相对父顶点的。
 *   若按树嵌套，序列化器就必须做「绝对 → 相对」的减法，那就是几何计算。
 *   因此层容器只作为背景矩形先画，视觉上仍是「虚线框包住内部节点」。
 *
 * 用法：
 *   node scripts/serializers/drawio.mjs --project <dir> [--no-png]
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listTrees, ensureDir } from "../../../layout/scripts/layout-engine/io.mjs";
import { element } from "../xml.mjs";
import { requireConfirmation, allowUnconfirmed, scopeFrom, previewPath } from "./gate.mjs";
import { loadCatalog, resolveIcon } from "../icons/build-catalog.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 绑定到技能自带的图标素材目录（assets/icons/），与项目目录无关。 */
export const ICON_ASSET_DIR = path.resolve(HERE, "..", "..", "assets", "icons");

/** 展平一棵树的全部节点（含子节点，先序）。 */
export function flattenTree(nodes, out = []) {
  for (const n of nodes ?? []) {
    out.push(n);
    if (n.children?.length) flattenTree(n.children, out);
  }
  return out;
}

// ── 常量映射表（不是几何计算）────────────────────────────────────────────
// side → mxGraph 的归一化锚点分数。它只表达「锚点在这条边的百分之几处」，
// 与节点的 x/y/w/h 无关。
const SIDE_ANCHOR = {
  N: { x: 0.5, y: 0 },
  S: { x: 0.5, y: 1 },
  W: { x: 0, y: 0.5 },
  E: { x: 1, y: 0.5 },
};

/** 语义角色 → 中国色 token 名（配色规范见 references/07-drawio.md）。 */
const KIND_COLOR = {
  title: "DRAWIO_HUAQING",
  layer: "DRAWIO_LANHUI",
  app: "DRAWIO_BAOLAN",
  framework: "DRAWIO_DIANQING",
  hardware: "DRAWIO_ZANGQING",
  storage: "DRAWIO_SHIQING",
  bus: "DRAWIO_DIANQING",
  control: "DRAWIO_BAOLAN",
  legend: "DRAWIO_LANHUI",
  legendItem: "DRAWIO_MO",
  edgeLabel: "DRAWIO_MO",
  // 图例连线色样：与 EDGE_ROLE 保持同色
  edgeData: "DRAWIO_DIANLAN",
  edgeControl: "DRAWIO_BAOLAN",
  edgePower: "DRAWIO_HUAQING",
  plain: "DRAWIO_MO",
};

/** 连线语义 → 颜色 token + 是否虚线。 */
const EDGE_ROLE = {
  data: { color: "DRAWIO_DIANLAN", dashed: false },
  control: { color: "DRAWIO_BAOLAN", dashed: true },
  power: { color: "DRAWIO_HUAQING", dashed: false },
};

/** 形状覆盖 → mxGraph shape（缺省 rounded）。 */
const SHAPE_STYLE = {
  rect: "rounded=0;",
  rounded: "rounded=1;",
  cylinder: "shape=cylinder3;boundedLbl=1;",
  process: "shape=process;",
  hexagon: "shape=hexagon;",
  parallelogram: "shape=parallelogram;",
  ellipse: "shape=ellipse;rounded=0;",
  bar: "rounded=0;",
  // solid / dashed 是图例 swatch 语义，不作为节点形状
};

const hex = (h) => String(h).replace("#", "").toUpperCase();
const rgb = (h) => {
  const s = hex(h).padEnd(6, "0");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};
const toHex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));

/** 设计 token 读取器：任何缺项都给出可读报错，而不是静默用默认值。 */
export function tokenReader(snapshot) {
  return (name, fallback) => {
    const v = snapshot?.[name];
    if (v !== undefined) return v;
    if (fallback !== undefined) return fallback;
    throw new Error(`缺少设计 token ${name}（必须写进 variables/tokens.ts 并随 variableSnapshot 归档）`);
  };
}

/** 节点 value：标签 + 说明行（note 是非几何字段，只影响观感）。 */
function nodeValue(node) {
  if (node.kind === "icon") return ""; // 图标节点只画图，不写文字
  if (node.silent) return "";
  const lines = [String(node.label ?? node.id)];
  for (const n of node.note ?? []) lines.push(String(n));
  return lines.join("\n");
}

// ── 图标素材 → style 里的 image 值 ──────────────────────────────────────
// 为什么 SVG 用「百分号编码的 data URI」而不是 base64：
//   mxGraph 的 style 是分号分隔的 key=value 串，而 base64 data URI 里的 `;base64`
//   会被解析器当成分隔符截断。百分号编码（encodeURIComponent）不含分号，
//   且是合法的 data URI，Chromium（drawio desktop）与浏览器都能直接渲染。
// 无 SVG 可用的图标（如 TI 只有 jpg）退化为相对路径 `icons/<file>`，
//   渲染时把该文件拷进 <project>/drawio/icons/。
const _iconRefCache = new Map();

export function iconImageRef(key, catalog = loadCatalog()) {
  if (_iconRefCache.has(key)) return _iconRefCache.get(key);
  const icon = resolveIcon(key, catalog);
  let styleValue;
  let embedded = false;
  if (icon.svg) {
    const svg = fs.readFileSync(path.join(ICON_ASSET_DIR, icon.svg), "utf8");
    styleValue = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    embedded = true;
  } else if (icon.raster) {
    styleValue = `icons/${icon.raster}`;
  } else {
    throw new Error(`图标 "${key}" 既没有 SVG 也没有位图素材，无法渲染`);
  }
  const out = { styleValue, embedded, icon };
  _iconRefCache.set(key, out);
  return out;
}

/** 卡片挂图标后，文字左移的量（px）。取值全部来自快照 token，不做几何推导。 */
export function iconTextInset(node, snap) {
  const icons = node.icon ?? [];
  if (!icons.length) return 0;
  const size = Number(snap.DRAWIO_ICON_SIZE ?? 28);
  const pad = Number(snap.DRAWIO_ICON_PAD ?? 16);
  const gap = Number(snap.DRAWIO_ICON_GAP ?? 8);
  const textGap = Number(snap.DRAWIO_ICON_TEXT_GAP ?? 8);
  return Math.round((pad + icons.length * size + (icons.length - 1) * gap + textGap) * 100) / 100;
}

/** 语义 accent（分层色相）→ 设计 token 名，如 "compute" → DRAWIO_ACCENT_COMPUTE。 */
export function accentToken(accent) {
  return `DRAWIO_ACCENT_${String(accent).toUpperCase().replace(/-/g, "_")}`;
}

/** 节点/容器描边色：优先 accent（按分层着色），否则按 kind。 */
function strokeOf(node, t) {
  const kind = node.kind ?? "plain";
  const key = node.accent ? accentToken(node.accent) : (KIND_COLOR[kind] ?? "DRAWIO_MO");
  return t(key);
}

/** 层 / 图例容器的填充色（节点与「标签断线底色」共用同一公式，保证接缝不可见）。 */
export function layerFill(node, snap) {
  const t = tokenReader(snap);
  if (node.tone === "focus") return t("DRAWIO_YUEBAI");
  return mix(strokeOf(node, t), t("DRAWIO_BASE"), 1 - Number(t("DRAWIO_FILL_MIX", 0.16)));
}

/**
 * 连线标签的底色 —— 取标签所处容器的填充色（无容器则取画布白）。
 *
 * 为什么不是 `none`：`fillColor=none` 时线段会从文字中间穿过，可读性差；
 * 而 draw.io 只靠“不透明标签背景”才能在线段上留出缺口。
 * 因此底色取**背后那层容器的填充色**：视觉上等于透明，同时留出断线缺口。
 */
function labelBackground(node, ctx, snap) {
  const t = tokenReader(snap);
  const entries = ctx?.entries ? flattenTree(ctx.entries) : [];
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  let best = null;
  for (const c of entries) {
    if (c.kind !== "layer" && c.kind !== "legend") continue;
    if (cx >= c.x && cx <= c.x + c.w && cy >= c.y && cy <= c.y + c.h) {
      if (!best || c.w * c.h < best.w * best.h) best = c;
    }
  }
  return best ? layerFill(best, snap) : t("DRAWIO_BASE");
}

/** 节点样式字符串（颜色全部来自 token）。 */
export function nodeStyle(node, snap, ctx = {}) {
  const t = tokenReader(snap);
  const kind = node.kind ?? "plain";
  // 图标节点：纯图片，无描边无填充，保持纵横比。
  if (kind === "icon") {
    const { styleValue } = iconImageRef(node.icon?.[0]);
    return `shape=image;html=0;imageAspect=1;imageBackground=none;verticalLabelPosition=bottom;verticalAlign=top;image=${styleValue};`;
  }
  const stroke = strokeOf(node, t);
  // 图例里的线型样例：画一条线段（实线 / 虚线），而不是色块。
  if (kind === "edgeData" || kind === "edgeControl" || kind === "edgePower") {
    const role = kind === "edgeControl" ? EDGE_ROLE.control : kind === "edgePower" ? EDGE_ROLE.power : EDGE_ROLE.data;
    const lw = Number(t("DRAWIO_STROKE_W", 1)) + 1;
    return [
      "shape=line;html=0;",
      `strokeColor=#${hex(t(role.color))};strokeWidth=${lw};`,
      role.dashed ? "dashed=1;" : "",
      "fillColor=none;",
    ].join("");
  }
  const fontFamily = t("DRAWIO_FONT_FAMILY", "Noto Sans CJK SC");
  const fontColor = t("DRAWIO_MO");
  const fillMix = Number(t("DRAWIO_FILL_MIX", 0.16));
  const isLayer = kind === "layer" || kind === "legend";

  // 公共部分：字体与形状
  const parts = [SHAPE_STYLE[node.shape] ?? (kind === "title" ? "rounded=0;" : "rounded=1;")];
  parts.push("whiteSpace=wrap;html=0;");
  if (node.textRotate === 90) parts.push("horizontal=0;");
  parts.push(`fontFamily=${fontFamily};fontColor=#${hex(fontColor)};`);

  if (kind === "title") {
    parts.push("fillColor=none;strokeColor=none;align=left;verticalAlign=middle;");
    parts.push(`fontSize=${Number(t("TYPE_DISPLAY", 28))};fontStyle=1;`);
  } else if (kind === "edgeLabel") {
    // 底色 = 背后容器的填充色（视觉透明 + 断线缺口），见 labelBackground()
    parts.push(`fillColor=#${hex(labelBackground(node, ctx, snap))};strokeColor=none;`);
    parts.push(`fontSize=${Number(t("TYPE_NOTE", 11.5))};fontColor=#${hex(t("DRAWIO_MO"))};`);
  } else if (kind === "legendItem") {
    parts.push("fillColor=none;strokeColor=none;align=left;verticalAlign=middle;");
    parts.push(`fontSize=${Number(t("TYPE_NOTE", 11.5))};`);
  } else if (isLayer) {
    const focus = node.tone === "focus";
    const border = focus ? t("DRAWIO_DIANLAN") : stroke;
    const fill = layerFill(node, snap);
    parts.push(`strokeColor=#${hex(border)};fillColor=#${hex(fill)};dashed=1;`);
    parts.push("verticalAlign=top;align=left;spacingLeft=16;spacingTop=8;");
    parts.push(`fontSize=${Number(t("TYPE_SECTION", 15))};fontStyle=1;`);
    parts.push(`arcSize=${Number(t("DRAWIO_ARC_SIZE_SECTION", 12))};`);
  } else {
    // 渐变填充：fillColor → gradientColor 沿 GRADIENT_ANGLE 方向；
    // 末端混合比由 DRAWIO_GRADIENT_END_MIX 决定（> fillMix 时才有可见渐变）。
    const endMix = Number(t("DRAWIO_GRADIENT_END_MIX", fillMix));
    const fill = mix(stroke, t("DRAWIO_BASE"), 1 - fillMix);
    parts.push(`strokeColor=#${hex(stroke)};fillColor=#${hex(fill)};`);
    if (endMix > fillMix) {
      const gradEnd = mix(stroke, t("DRAWIO_BASE"), 1 - endMix);
      const angle = ((Number(t("DRAWIO_GRADIENT_ANGLE", 120)) % 360) + 360) % 360;
      const dir = ["south", "east", "north", "west"][Math.round(angle / 90) % 4];
      parts.push(`gradientColor=#${hex(gradEnd)};gradientDirection=${dir};`);
    }
    // 原生阴影 + 自定义参数（leShadow* 供 drawio_png.py 同源渲染；draw.io 忽略未知 style 键）
    const shadowAlpha = Number(t("DRAWIO_SHADOW_ALPHA", 0));
    if (shadowAlpha > 0) {
      parts.push(
        `shadow=1;leShadowDy=${Number(t("DRAWIO_SHADOW_DY", 2))};` +
        `leShadowBlur=${Number(t("DRAWIO_SHADOW_BLUR", 8))};leShadowAlpha=${shadowAlpha};`,
      );
    }
    parts.push(`fontSize=${Number(t("TYPE_ITEM", 13.5))};`);
    parts.push(`arcSize=${Number(t("DRAWIO_ARC_SIZE_ITEM", 30))};`);
    if (kind === "control") parts.push("dashed=1;");
    // 「左图标 + 右文字」：挂了 icon 的卡片，文字从图标区右侧开始
    const inset = iconTextInset(node, snap);
    if (inset > 0) parts.push(`align=left;spacingLeft=${inset};`);
    else parts.push(node.align === "left" ? "align=left;spacingLeft=10;" : "align=center;");
    parts.push("verticalAlign=middle;");
  }
  return parts.join("");
}

/** 连线样式字符串。 */
export function edgeStyle(edge, snap) {
  const t = tokenReader(snap);
  const role = EDGE_ROLE[edge.role] ?? EDGE_ROLE.data;
  const from = SIDE_ANCHOR[edge.from.side];
  const to = SIDE_ANCHOR[edge.to.side];
  const parts = [
    "edgeStyle=orthogonalEdgeStyle;",
    "rounded=0;html=0;jumpStyle=none;",
    `strokeColor=#${hex(t(role.color))};`,
    `strokeWidth=${Number(t("DRAWIO_STROKE_W", 1))};`,
    `fontFamily=${t("DRAWIO_FONT_FAMILY", "Noto Sans CJK SC")};`,
    `fontColor=#${hex(t("DRAWIO_MO"))};`,
  ];
  if (role.dashed) parts.push("dashed=1;");
  parts.push(`exitX=${from.x};exitY=${from.y};exitDx=0;exitDy=0;`);
  parts.push(`entryX=${to.x};entryY=${to.y};entryDx=0;entryDy=0;`);
  const arrow = edge.arrow ?? "forward";
  parts.push(arrow === "none" ? "endArrow=none;" : "endArrow=block;endFill=1;");
  if (arrow === "both") parts.push("startArrow=block;startFill=1;");
  return parts.join("");
}

/**
 * 把一棵 Layout Tree 序列化成 mxGraph XML。
 *
 * @param {object} tree
 * @param {{diagramName?: string}} [opts]
 * @returns {string}
 */
export function renderDrawio(tree, opts = {}) {
  const snap = tree.variableSnapshot ?? {};
  const canvas = tree.canvas;
  const entries = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      entries.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(tree.elements);

  const geometry = (n) =>
    element("mxGeometry", { x: n.x, y: n.y, width: n.w, height: n.h, as: "geometry" }, null);

  const cells = [];
  cells.push(`<mxCell id="0"/>`);
  cells.push(`<mxCell id="1" parent="0"/>`);

  const vertexCell = (n) =>
    element(
      "mxCell",
      {
        id: n.id,
        value: nodeValue(n),
        style: nodeStyle(n, snap, { entries }),
        vertex: "1",
        parent: "1",
        // 自定义属性：把逻辑名与配套位图名带进 XML，供 drawio_png.py / check-drawio 读取。
        // draw.io 会忽略不认识的属性，不影响编辑。
        ...(n.kind === "icon"
          ? {
              leIcon: n.icon[0],
              leIconRaster: iconImageRef(n.icon[0]).icon.raster ?? "",
            }
          : {}),
      },
      [geometry(n)],
      { selfClose: false },
    );

  // z 序：容器 → 普通节点 → 图标 → 连线 → 连线标签 → 图例（最后画，避免被连线压住）
  const isContainer = (n) => n.kind === "layer" || n.kind === "legend";
  const order = [
    entries.filter(isContainer),
    entries.filter((n) => !isContainer(n) && n.kind !== "edgeLabel" && n.kind !== "legendItem" && n.kind !== "icon"),
    entries.filter((n) => n.kind === "icon"),
    entries.filter((n) => n.kind === "legendItem"),
  ];
  for (const group of order) for (const n of group) cells.push(vertexCell(n));

  for (const e of tree.edges ?? []) {
    const pts = (e.via ?? []).map((p) => element("mxPoint", { x: p.x, y: p.y }, null));
    const geo = element(
      "mxGeometry",
      { relative: "1", as: "geometry" },
      [pts.length ? element("Array", { as: "points" }, pts, { selfClose: false }) : ""],
      { selfClose: false },
    );
    cells.push(
      element(
        "mxCell",
        {
          id: e.id,
          edge: "1",
          parent: "1",
          source: e.from.node,
          target: e.to.node,
          style: edgeStyle(e, snap),
        },
        [geo],
        { selfClose: false },
      ),
    );
  }

  for (const n of entries.filter((x) => x.kind === "edgeLabel")) cells.push(vertexCell(n));

  const model = element(
    "mxGraphModel",
    {
      dx: 0,
      dy: 0,
      grid: 0,
      gridSize: 10,
      page: 1,
      pageWidth: canvas.w,
      pageHeight: canvas.h,
      pageScale: 1,
      math: 0,
      shadow: 0,
    },
    [element("root", {}, cells, { selfClose: false })],
    { selfClose: false },
  );

  const diagram = element(
    "diagram",
    { id: canvas.breakpoint, name: opts.diagramName ?? `${path.basename(opts.projectName ?? "diagram")} · ${canvas.breakpoint}` },
    [model],
    { selfClose: false },
  );

  // 不用 CDATA：让 xml.mjs 的严格解析器能直接反解产物（「XML 可被解析」才算真的被验过）。
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    element(
      "mxfile",
      { host: "layout-engineer", agent: "layout-engineer", type: "device", version: "24.0.0" },
      [diagram],
      { selfClose: false },
    ) +
    "\n"
  );
}

/** 判定项目是否是 drawio 架构图项目（决定 --target drawio 是否干活）。 */
export function isDrawioProject(project, trees = null) {
  const cfg = path.join(project, "layout.config.json");
  if (fs.existsSync(cfg)) {
    try {
      if (JSON.parse(fs.readFileSync(cfg, "utf8")).kind === "drawio") return true;
    } catch {
      /* 交给 build-tree 报错 */
    }
  }
  const list = trees ?? listTrees(path.join(project, "layout-tree")).map(([, t]) => t);
  return list.some((t) => t.edges?.length || Object.keys(t.variableSnapshot ?? {}).some((k) => k.startsWith("DRAWIO_")));
}

export function renderDrawioProject(projectDir, { scope = null, png = true, allow = false } = {}) {
  const project = path.resolve(projectDir);
  const outDir = path.join(project, "drawio");
  ensureDir(outDir);
  const trees = listTrees(path.join(project, "layout-tree"))
    .map(([, t]) => t)
    .filter((t) => !scope || scope.includes(t.canvas.breakpoint));
  if (!trees.length) throw new Error("layout-tree/ 下没有 Layout Tree");

  const results = [];
  const usedRaster = new Map(); // 相对路径引用的位图：key → 文件名
  for (const tree of trees) {
    for (const n of flattenTree(tree.elements)) {
      if (n.kind === "icon" && n.icon?.[0]) {
        const ref = iconImageRef(n.icon[0]);
        if (!ref.embedded && ref.icon.raster) usedRaster.set(n.icon[0], ref.icon.raster);
      }
    }
  }
  if (usedRaster.size) {
    const iconDir = path.join(outDir, "icons");
    ensureDir(iconDir);
    for (const file of usedRaster.values()) {
      fs.copyFileSync(path.join(ICON_ASSET_DIR, file), path.join(iconDir, file));
    }
  }

  for (const tree of trees) {
    const bp = tree.canvas.breakpoint;
    const xml = renderDrawio(tree, { projectName: path.basename(project) });
    const file = previewPath(path.join(outDir, `${bp}.drawio`), allow);
    fs.writeFileSync(file, xml);
    results.push({ bp, file, png: null });

    if (png) {
      const py = process.env.LAYOUT_ENGINE_PYTHON ?? "python3";
      const pngFile = previewPath(path.join(outDir, `${bp}.png`), allow);
      const r = spawnSync(
        py,
        [path.join(HERE, "drawio_png.py"), "--drawio", file, "--out", pngFile,
         ...(allow ? ["--allow-unconfirmed"] : []),
         ...(scope ? ["--scope", scope.join(",")] : [])],
        { stdio: "pipe", encoding: "utf8" },
      );
      if (r.status === 0) results[results.length - 1].png = pngFile;
      else process.stderr.write(`  · ${bp} PNG 跳过（drawio_png.py 未成功：${(r.stderr || "").trim().split("\n").pop()}）\n`);
    }
  }
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const pi = argv.indexOf("--project");
  const project = path.resolve(pi >= 0 ? argv[pi + 1] : ".");
  const scope = scopeFrom(argv);
  if (!isDrawioProject(project)) {
    console.log("· drawio 序列化器跳过：本项目不是 drawio 架构图项目（无 edges 且快照无 DRAWIO_* token）");
    return;
  }
  const allow = allowUnconfirmed(argv);
  requireConfirmation(project, "static", { allow, scope });
  const results = renderDrawioProject(project, { scope, png: !argv.includes("--no-png"), allow });
  for (const r of results) {
    const rel = (f) => path.relative(project, f);
    console.log(`✓ drawio ${r.bp.padEnd(7)} ${rel(r.file)}${r.png ? `  +  ${rel(r.png)}` : ""}`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  Promise.resolve()
    .then(main)
    .catch((e) => {
      console.error(e?.isGateError ? `\n✗ ${e.message}` : (e?.stack ?? String(e)));
      process.exit(1);
    });
}
