#!/usr/bin/env node
/**
 * check-drawio — drawio 架构图自检（验证层，第 8 步）。
 *
 * 把 references/07-drawio.md 第七节的人工清单变成机器判定。它**只读取产物**：
 * 从 `drawio/<bp>.drawio` 反解 XML，与 Layout Tree 比对。这样做的意义是：
 * 检查的是「渲染器真正吐出来的东西」，而不是「我以为它吐出来的东西」。
 *
 * 覆盖（其余几何项由 assert-layout 承担，此处不重复实现）：
 *   1. XML 可被严格解析（独立解析器，不是生成器自证）
 *   2. 结构完整：mxfile → diagram → mxGraphModel → root → mxCell(0,1)
 *   3. 节点/连线全覆盖，且 **XML 几何与 Layout Tree 逐字段相等**
 *   4. 文字不截断（按中西文宽度预算）且不竖向溢出
 *   5. 层标题带不与子节点文字重叠；连线标签不与节点文字重叠
 *   6. 图例存在且覆盖节点/连线语义
 *   7. 四周边距 ≥ DRAWIO_MIN_MARGIN
 *   8. 字体声明来自 token，且系统里真的装了该字体（否则出豆腐块）
 *
 * 用法：node scripts/validate/check-drawio.mjs --project <dir>
 */
import fs from "node:fs";
import path from "node:path";
import { listTrees } from "../../../layout/scripts/layout-engine/io.mjs";
import { parseXml, findAll, parseStyle } from "../xml.mjs";
import { parseArgs } from "../../../layout/scripts/layout-engine/cli.mjs";
import { isDrawioProject, renderDrawio, iconTextInset } from "../serializers/drawio.mjs";
import { loadCatalog } from "../icons/build-catalog.mjs";

const EPS = 0.011;

/** side → exitX/exitY（与 drawio.mjs 同表；此处独立写死是为了交叉验证，不是复制实现）。 */
const SIDE_FRACTION = {
  N: [0.5, 0],
  S: [0.5, 1],
  W: [0, 0.5],
  E: [1, 0.5],
};

const FONT_CANDIDATES = [
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
  "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
];

/** 字符宽度预算：CJK/全角按字号，拉丁/数字按 0.55 字号，空格更窄。 */
export function measureLine(line, fontSize) {
  let w = 0;
  for (const ch of String(line)) {
    const code = ch.codePointAt(0);
    if (ch === " ") w += fontSize * 0.3;
    else if (code >= 0x2e80) w += fontSize; // CJK 及全角
    else w += fontSize * 0.55;
  }
  return w;
}

const num = (v) => String(Math.round(v * 100) / 100);

function flatten(nodes, out = []) {
  for (const n of nodes) {
    out.push(n);
    if (n.children?.length) flatten(n.children, out);
  }
  return out;
}

/**
 * 对单个 (tree, xml) 组合做自检。
 * @returns {{errors:string[], warnings:string[], stats:object}}
 */
export function checkDrawioTree(tree, xml, { where = "drawio" } = {}) {
  const errors = [];
  const warnings = [];
  const snap = tree.variableSnapshot ?? {};
  const bp = tree.canvas.breakpoint;
  const fontFamily = snap.DRAWIO_FONT_FAMILY ?? "Noto Sans CJK SC";
  const labelPad = Number(snap.DRAWIO_LABEL_PAD ?? 8);
  const lineHeight = Number(snap.DRAWIO_LINE_HEIGHT ?? 1.35);
  const headH = Number(snap.DRAWIO_LAYER_HEAD_H ?? 32);
  const minMargin = Number(snap.DRAWIO_MIN_MARGIN ?? 64);

  // ── 1. XML 可解析 ──
  let root;
  try {
    root = parseXml(xml);
  } catch (e) {
    return { errors: [`[${bp}] ${e.message}`], warnings, stats: {} };
  }

  // ── 2. 结构完整 ──
  if (root.name !== "mxfile") errors.push(`[${bp}] 根元素应为 mxfile，实际 ${root.name}`);
  const model = findAll(root, "mxGraphModel")[0];
  if (!model) {
    errors.push(`[${bp}] 缺少 mxGraphModel`);
    return { errors, warnings, stats: {} };
  }
  const modelRoot = model.children.find((c) => c.name === "root");
  if (!modelRoot) errors.push(`[${bp}] mxGraphModel 下缺少 root`);
  const cells = modelRoot ? modelRoot.children.filter((c) => c.name === "mxCell") : [];
  const ids = new Set(cells.map((c) => c.attrs.id));
  for (const need of ["0", "1"]) if (!ids.has(need)) errors.push(`[${bp}] 缺少 mxCell id="${need}"`);

  const vertices = new Map();
  const edges = new Map();
  for (const c of cells) {
    if (c.attrs.vertex === "1") vertices.set(c.attrs.id, c);
    else if (c.attrs.edge === "1") edges.set(c.attrs.id, c);
  }

  // ── 3. 全覆盖 + 几何逐字段相等 ──
  const nodes = flatten(tree.elements);
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    const cell = vertices.get(n.id);
    if (!cell) {
      errors.push(`[${bp}] 树里的节点 ${n.id} 在 XML 中不存在（序列化漏项）`);
      continue;
    }
    const geo = cell.children.find((c) => c.name === "mxGeometry");
    if (!geo) {
      errors.push(`[${bp}] 节点 ${n.id} 缺 mxGeometry`);
      continue;
    }
    const pairs = [["x", "x"], ["y", "y"], ["w", "width"], ["h", "height"]];
    for (const [field, attr] of pairs) {
      const v = Number(geo.attrs[attr]);
      if (!Number.isFinite(v) || Math.abs(v - n[field]) > EPS) {
        errors.push(`[${bp}] 节点 ${n.id}.${field} 与 XML ${attr} 不一致：树 ${num(n[field])} ≠ XML ${geo.attrs[attr]}`);
      }
    }
  }
  for (const id of vertices.keys()) {
    if (!nodeIds.has(id)) errors.push(`[${bp}] XML 里的 vertex ${id} 不在 Layout Tree 中（凭空多出来的元素）`);
  }

  // ── 3b. 技术栈图标：逻辑名存在 / XML 标记一致 / 图标盒在卡内且不侵入文字区 ──
  let catalog = null;
  try {
    catalog = loadCatalog();
  } catch {
    catalog = null;
  }
  for (const n of nodes) {
    if (!n.icon?.length) continue;
    for (const key of n.icon) {
      if (catalog && !catalog.icons?.[key]) {
        errors.push(`[${bp}] 节点 ${n.id} 引用了未知图标逻辑名 "${key}"（见 assets/icons/catalog.json）`);
      }
    }
    const cell = vertices.get(n.id);
    if (n.kind === "icon") {
      if (cell && (cell.attrs.value ?? "") !== "") {
        errors.push(`[${bp}] 图标节点 ${n.id} 不应有文字（value 必须为空）`);
      }
      if (cell && cell.attrs.leIcon !== n.icon[0]) {
        errors.push(`[${bp}] 图标节点 ${n.id} 的 XML leIcon=${cell.attrs.leIcon} 与树 icon=${n.icon[0]} 不一致`);
      }
      const parent = nodes.find((p) => (p.children ?? []).some((c) => c.id === n.id));
      if (parent) {
        const inside =
          n.x >= parent.x - EPS && n.y >= parent.y - EPS &&
          n.x + n.w <= parent.x + parent.w + EPS && n.y + n.h <= parent.y + parent.h + EPS;
        if (!inside) errors.push(`[${bp}] 图标 ${n.id} 越出卡片 ${parent.id} 的边界`);
        const inset = iconTextInset(parent, snap);
        if (n.x + n.w > parent.x + inset + EPS) {
          errors.push(
            `[${bp}] 图标 ${n.id} 侵入卡片 ${parent.id} 的文字区（文字从 x=${num(parent.x + inset)} 开始）；` +
              `请调小 DRAWIO_ICON_SIZE / DRAWIO_ICON_GAP，或加宽卡片`,
          );
        }
      }
    } else {
      // 卡片声明了 icon，就必须有对应的 kind=icon 子节点（由 builder.iconSlots() 生成）
      const childKeys = (n.children ?? []).filter((c) => c.kind === "icon").map((c) => c.icon?.[0]);
      if (childKeys.length !== n.icon.length || n.icon.some((k) => !childKeys.includes(k))) {
        errors.push(
          `[${bp}] 卡片 ${n.id} 声明了 icon=${JSON.stringify(n.icon)}，但子图标节点为 ${JSON.stringify(childKeys)}；` +
            `请用 builder.iconSlots() 生成图标子节点`,
        );
      }
    }
  }

  const treeEdges = tree.edges ?? [];
  for (const e of treeEdges) {
    const cell = edges.get(e.id);
    if (!cell) {
      errors.push(`[${bp}] 树里的连线 ${e.id} 在 XML 中不存在`);
      continue;
    }
    if (cell.attrs.source !== e.from.node) errors.push(`[${bp}] 连线 ${e.id} source 应为 ${e.from.node}，实际 ${cell.attrs.source}`);
    if (cell.attrs.target !== e.to.node) errors.push(`[${bp}] 连线 ${e.id} target 应为 ${e.to.node}，实际 ${cell.attrs.target}`);
    const st = parseStyle(cell.attrs.style);
    for (const [end, key] of [["from", "exit"], ["to", "entry"]]) {
      const [fx, fy] = SIDE_FRACTION[e[end].side];
      if (Math.abs(Number(st[`${key}X`]) - fx) > EPS || Math.abs(Number(st[`${key}Y`]) - fy) > EPS) {
        errors.push(
          `[${bp}] 连线 ${e.id} 的 ${key} 锚点与 side=${e[end].side} 不符：` +
            `XML (${st[`${key}X`]},${st[`${key}Y`]}) ≠ 期望 (${fx},${fy})`,
        );
      }
    }
    const geo = cell.children.find((c) => c.name === "mxGeometry");
    const arr = geo?.children.find((c) => c.name === "Array");
    const xmlVia = (arr?.children ?? []).filter((c) => c.name === "mxPoint");
    if (xmlVia.length !== (e.via ?? []).length) {
      errors.push(`[${bp}] 连线 ${e.id} 途经点数量不一致：树 ${(e.via ?? []).length} ≠ XML ${xmlVia.length}`);
    } else {
      e.via.forEach((p, i) => {
        const q = xmlVia[i].attrs;
        if (Math.abs(Number(q.x) - p.x) > EPS || Math.abs(Number(q.y) - p.y) > EPS) {
          errors.push(`[${bp}] 连线 ${e.id} via[${i}] 不一致：树 (${num(p.x)},${num(p.y)}) ≠ XML (${q.x},${q.y})`);
        }
      });
    }
    const role = e.role ?? "data";
    const wantDashed = role === "control";
    if ((st.dashed === "1") !== wantDashed) {
      errors.push(`[${bp}] 连线 ${e.id} role=${role} 的线型不符：dashed=${st.dashed ?? "0"}（期望 ${wantDashed ? "1" : "0"}）`);
    }
    const arrow = e.arrow ?? "forward";
    if (arrow === "none" && st.endArrow !== "none") errors.push(`[${bp}] 连线 ${e.id} arrow=none 但 XML 仍有箭头`);
    if (arrow !== "none" && st.endArrow !== "block") errors.push(`[${bp}] 连线 ${e.id} 缺终点箭头`);
    if ((arrow === "both") !== (st.startArrow === "block")) {
      errors.push(`[${bp}] 连线 ${e.id} arrow=${arrow} 的起点箭头不符`);
    }
  }
  for (const id of edges.keys()) {
    if (!treeEdges.some((e) => e.id === id)) errors.push(`[${bp}] XML 里的 edge ${id} 不在 Layout Tree 中`);
  }

  // ── 4/5. 文字：预算、溢出、重叠 ──
  const textBoxes = [];
  for (const n of nodes) {
    const cell = vertices.get(n.id);
    if (!cell) continue;
    const st = parseStyle(cell.attrs.style);
    if (st.fontFamily && st.fontFamily !== fontFamily) {
      errors.push(`[${bp}] 节点 ${n.id} 的 fontFamily=${st.fontFamily} 不是 token 里的 ${fontFamily}`);
    }
    const raw = cell.attrs.value ?? "";
    if (!raw) continue;
    const lines = raw.split("\n");
    const fontSize = Number(st.fontSize ?? 12);
    const lineH = fontSize * lineHeight;
    const rotated = st.horizontal === "0";
    const boxW = rotated ? n.h : n.w;
    const boxH = rotated ? n.w : n.h;
    const kind = n.kind ?? "plain";

    // 宽度预算：最长一行必须装得下；挂图标的卡片，文字可用宽度要把图标区扣除
    const iconInset = iconTextInset(n, snap);
    const usableW = boxW - (iconInset > 0 ? iconInset : labelPad) - labelPad;
    for (const line of lines) {
      const need = measureLine(line, fontSize);
      if (need > usableW) {
        errors.push(
          `[${bp}] 节点 ${n.id} 文字截断风险：行「${line}」需 ${num(need)}px，` +
            `可用 ${num(usableW)}px（字号 ${fontSize}${iconInset > 0 ? `，已扣除图标区 ${num(iconInset)}px` : ""}）。请加宽节点或缩短文案`,
        );
      }
    }
    // 竖向溢出：层容器标题占固定标题带，其余按行高累加
    const blockH = lines.length * lineH;
    if (kind === "layer" || kind === "legend") {
      if (blockH > headH) {
        errors.push(`[${bp}] 层容器 ${n.id} 的标题占 ${num(blockH)}px > 标题带 ${num(headH)}px（DRAWIO_LAYER_HEAD_H）`);
      }
    } else if (blockH > boxH - labelPad) {
      errors.push(
        `[${bp}] 节点 ${n.id} 文字竖向溢出：${lines.length} 行 × ${num(lineH)}px = ${num(blockH)}px > 可用 ${num(boxH - labelPad)}px`,
      );
    }
    textBoxes.push({ id: n.id, kind, x: n.x, y: n.y, w: n.w, h: n.h, fontSize });

    // 标题/连线标签是「贴在线或层上的文字」，必须靠 token 表达，不能是裸数字
    if (kind === "layer" && headH <= 0) warnings.push(`[${bp}] 层 ${n.id} 的标题带高度为 0`);

    // 5a. 层标题带不得压住任何子节点
    if (kind === "layer") {
      const band = { x: n.x, y: n.y, w: n.w, h: headH };
      for (const c of n.children ?? []) {
        const hit = Math.min(band.x + band.w, c.x + c.w) - Math.max(band.x, c.x) > EPS &&
                    Math.min(band.y + band.h, c.y + c.h) - Math.max(band.y, c.y) > EPS;
        if (hit) {
          errors.push(`[${bp}] 层 ${n.id} 的标题带（高 ${num(headH)}px）与子节点 ${c.id} 重叠，请下移子节点或加高标题带`);
        }
      }
    }
  }

  // 5b. 文字盒两两重叠：排除父子包含关系，其余一律报
  const isAncestor = (a, b) => (a.children ?? []).some((c) => c.id === b.id || isAncestor(c, b));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (let i = 0; i < textBoxes.length; i += 1) {
    for (let j = i + 1; j < textBoxes.length; j += 1) {
      const a = textBoxes[i];
      const b = textBoxes[j];
      const na = byId.get(a.id);
      const nb = byId.get(b.id);
      if (!na || !nb) continue;
      const ov = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > EPS &&
                 Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > EPS;
      if (!ov) continue;
      const parentChild =
        a.kind === "layer" || a.kind === "legend" || b.kind === "layer" || b.kind === "legend" ||
        isAncestor(na, nb) || isAncestor(nb, na);
      if (parentChild) continue; // 层容器与其中的元素天然包含
      errors.push(`[${bp}] 文字盒重叠：${a.id} × ${b.id}（同层元素文字不得互相遮挡）`);
    }
  }

  // 6. 图例
  const legend = nodes.find((n) => n.kind === "legend");
  if (!legend) {
    warnings.push(`[${bp}] 缺少图例（kind=legend）：规范要求每张图放置颜色语义图例`);
  } else if (!(legend.children ?? []).some((c) => c.kind === "legendItem")) {
    errors.push(`[${bp}] 图例 ${legend.id} 下没有任何 legendItem（图例为空等于没有图例）`);
  }

  // 7. 四周边距
  for (const n of nodes) {
    // 注解标签（连线标签）可以贴近画布边；边距只约束结构/内容节点
    if (n.kind === "title" || n.kind === "edgeLabel" || n.x < 0) continue;
    const margins = [n.x, n.y, tree.canvas.w - (n.x + n.w), tree.canvas.h - (n.y + n.h)];
    const worst = Math.min(...margins);
    if (worst < minMargin - EPS) {
      errors.push(
        `[${bp}] 节点 ${n.id} 距画布边距 ${num(worst)}px < ${minMargin}px（DRAWIO_MIN_MARGIN）`,
      );
    }
  }

  // 8. 字体真的存在（否则 PNG 会出豆腐块）
  if (!FONT_CANDIDATES.some((f) => fs.existsSync(f))) {
    warnings.push(`[${bp}] 系统里找不到 CJK 字体，PNG 渲染可能出豆腐块（□）`);
  }

  return { errors, warnings, stats: { nodes: nodes.length, edges: treeEdges.length, where } };
}

/** 对整项目执行检查（只对 drawio 项目生效）。 */
export function checkDrawioProject(projectDir) {
  const project = path.resolve(projectDir);
  const errors = [];
  const warnings = [];
  const trees = listTrees(path.join(project, "layout-tree")).map(([, t]) => t);
  // 先判「该不该做架构图检查」：不是 drawio 项目就跳过，而不是因为它还没构建过 layout-tree 而报错
  if (!isDrawioProject(project, trees)) {
    return { ok: true, errors, warnings, skipped: true, trees: 0, edges: 0 };
  }
  if (!trees.length) return { ok: false, errors: ["layout-tree/ 下没有 Layout Tree"], warnings, skipped: false };
  let edgeCount = 0;
  for (const tree of trees) {
    const bp = tree.canvas.breakpoint;
    // 自检跑在**渲染之前**（验证层），所以先对内存里的序列化结果做检查；
    // 若 drawio/ 下已有产物，再比对一次，顺带抓「产物过期」这个坑。
    const xml = renderDrawio(tree, { projectName: path.basename(project) });
    const file = path.join(project, "drawio", `${bp}.drawio`);
    if (fs.existsSync(file)) {
      const onDisk = fs.readFileSync(file, "utf8");
      if (onDisk !== xml) {
        errors.push(
          `[${bp}] drawio/${bp}.drawio 与当前 Layout Tree 不一致（产物已过期，请重新渲染）`,
        );
      }
    }
    const r = checkDrawioTree(tree, xml, { where: bp });
    errors.push(...r.errors);
    warnings.push(...r.warnings);
    edgeCount += tree.edges?.length ?? 0;
  }
  return { ok: errors.length === 0, errors, warnings, skipped: false, trees: trees.length, edges: edgeCount };
}

function main() {
  const args = parseArgs(process.argv.slice(2), { project: ".", quiet: false });
  if (args.help) {
    console.log("用法: node scripts/validate/check-drawio.mjs --project <dir>");
    return;
  }
  const project = path.resolve(args.project);
  const r = checkDrawioProject(project);
  for (const w of r.warnings) console.warn(`check-drawio 警告：${w}`);
  if (!r.ok) {
    console.error(`check-drawio 失败：${r.errors.length} 项\n  - ${r.errors.join("\n  - ")}`);
    process.exit(1);
  }
  if (r.skipped) {
    if (!args.quiet) console.log("✓ check-drawio 通过：本项目不是 drawio 架构图项目，跳过");
    return;
  }
  if (!args.quiet) {
    console.log(`✓ check-drawio 通过：${r.trees} 张图 / ${r.edges} 条连线 —— XML 可解析、几何与树一致、文字不截断不溢出、图例与边距合规`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
