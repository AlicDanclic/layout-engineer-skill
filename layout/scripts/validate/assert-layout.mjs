#!/usr/bin/env node
/**
 * assert-layout — 几何断言（验证层 ②，构建期）。
 *
 * 六项检查，每项对应一条规范：
 *   1. 越界          —— 任何节点必须在画布内（拦「页头调高把内容顶出画布」这类连锁反应）
 *   2. 兄弟重叠      —— AABB 检测，**只在同一父级内**；父子包含不算重叠
 *   3. 间距刻度      —— 兄弟间距 ∈ SPACE 刻度，且快照中的间距变量取值 ∈ SPACE 集合
 *   4. expr 完整性   —— 每个节点 x/y/w/h 四项都必须有出处
 *   5. 连线几何      —— 端点落在锚点上 / 途经点在画布内 / 线段不横穿节点 / 标签在线上
 *   6. 连线可分辨    —— 不同连线不得共线重合（否则画出来是一条线，读者无法区分）
 *   7. 纯函数性      —— 同输入复算结果与归档完全一致
 *
 * 用法：
 *   node scripts/validate/assert-layout.mjs --project <dir> [--no-purity]
 */
import fs from "node:fs";
import path from "node:path";
import { listTrees } from "../layout-engine/io.mjs";
import { serializeTree, anchor } from "../layout-engine/builder.mjs";
import { buildTrees } from "../build-tree.mjs";

const EPS = 0.011;
/** 两条连线共线重合多少像素算「无法分辨」。小于这个值多为数值巧合，不报。 */
const OVERLAP_TOL = 8;
const FIELDS = ["x", "y", "w", "h"];

/** 快照里哪些键属于「间距类」，需要满足 SPACE 刻度。 */
const SPACING_KEY = /(GAP|PAD|MARGIN|INSET)/i;
const SIZE_SUFFIX = /(_H|_W|WIDTH|HEIGHT)$/i; // 只排除明确的宽高，GAP_X / PAD_Y 仍算间距

const round2 = (v) => Math.round(v * 100) / 100;

function parseArgs(argv) {
  const a = { project: ".", purity: true };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--project") a.project = argv[++i];
    else if (argv[i] === "--no-purity") a.purity = false;
    else if (argv[i] === "-h" || argv[i] === "--help") a.help = true;
  }
  return a;
}

/** 从 variables/tokens.ts 解析 SPACE 刻度数值集合。 */
export function readSpacingScale(projectDir) {
  const file = path.join(projectDir, "variables", "tokens.ts");
  if (!fs.existsSync(file)) return null;
  const src = fs.readFileSync(file, "utf8");
  const m = src.match(/SPACE\s*=\s*\{([^}]*)\}/);
  if (!m) return null;
  const values = [...m[1].matchAll(/:\s*([0-9.]+)/g)].map((x) => Number(x[1]));
  return new Set([0, ...values]);
}

function overlaps1D(a1, a2, b1, b2) {
  return Math.min(a1 + a2, b1 + b2) - Math.max(a1, b1) > EPS;
}

// ── 连线几何（assert-layout 第 5 组）──────────────────────────────────

/** 展平节点，带上祖先 id 列表。 */
function flattenWithAncestors(nodes, ancestors = [], out = []) {
  for (const n of nodes) {
    out.push({ node: n, ancestors });
    if (n.children?.length) flattenWithAncestors(n.children, [...ancestors, n.id], out);
  }
  return out;
}

const inRect = (p, r) =>
  p.x > r.x - EPS && p.x < r.x + r.w + EPS && p.y > r.y - EPS && p.y < r.y + r.h + EPS;

/** 点是否在画布内（canvas 没有 x/y，只有 w/h）。 */
const inCanvas = (p, c) => p.x >= -EPS && p.y >= -EPS && p.x <= c.w + EPS && p.y <= c.h + EPS;

/**
 * 「间距刻度」只管结构性排布的节奏，不管注解与图例内部。
 *
 * 连线标签是跟着算式落到线上的、图例行内是垂直居中得到的，它们的间距本来就不是
 * 「留白节奏」而是布局结果的副产品；强行要求它们落在 SPACE 上，只会逼人把
 * 标签硬挪到刻度点上（反而压线）。重叠检测依然对所有兄弟生效。
 */
export function isSpacingExempt(n) {
  return (
    n.kind === "edgeLabel" ||
    n.kind === "legendItem" ||
    n.kind === "edgeData" ||
    n.kind === "edgeControl" ||
    n.kind === "edgePower"
  );
}

/** 线段是否与矩形相交（端点在内 / 穿过四条边）。 */
function segmentHitsRect(p, q, r) {
  if (inRect(p, r) || inRect(q, r)) return true;
  const corners = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const onSeg = (a, b, c) =>
    Math.min(a.x, b.x) - EPS <= c.x && c.x <= Math.max(a.x, b.x) + EPS &&
    Math.min(a.y, b.y) - EPS <= c.y && c.y <= Math.max(a.y, b.y) + EPS;
  const intersects = (a, b, c, d) => {
    const d1 = orient(a, b, c);
    const d2 = orient(a, b, d);
    const d3 = orient(c, d, a);
    const d4 = orient(c, d, b);
    if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
        ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) return true;
    if (Math.abs(d1) <= EPS && onSeg(a, b, c)) return true;
    if (Math.abs(d2) <= EPS && onSeg(a, b, d)) return true;
    if (Math.abs(d3) <= EPS && onSeg(c, d, a)) return true;
    if (Math.abs(d4) <= EPS && onSeg(c, d, b)) return true;
    return false;
  };
  for (let i = 0; i < 4; i += 1) {
    if (intersects(p, q, corners[i], corners[(i + 1) % 4])) return true;
  }
  return false;
}

/**
 * 连线可分辨检查：不同连线不得共线重合。
 *
 * 为什么必须查：两条水平段压在同一条带中线上时，渲染出来就是**一条线**——
 * 读者无法知道那里其实有两条边；drawio 里拖开也看不出原本是两条。
 * 这类问题「不穿节点、不压文字」，前面几项全部检不到，只能单独查。
 *
 * 不报的情况：两段**共享端点**。同一个锚点扇出多条边时，初始段必然重合，
 * 这是标准画法（扇出），不是无法分辨。
 */
export function assertEdgeOverlap(tree, errors) {
  const edges = tree.edges ?? [];
  if (edges.length < 2) return;
  const bp = tree.canvas.breakpoint;
  const segs = [];
  for (const e of edges) {
    const p = [{ x: e.fromPt.x, y: e.fromPt.y }, ...(e.via ?? []), { x: e.toPt.x, y: e.toPt.y }];
    for (let i = 0; i + 1 < p.length; i += 1) segs.push({ edge: e.id, a: p[i], b: p[i + 1] });
  }
  const report = new Set();
  for (let i = 0; i < segs.length; i += 1) {
    for (let j = i + 1; j < segs.length; j += 1) {
      const s = segs[i];
      const r = segs[j];
      if (s.edge === r.edge) continue;
      const sH = Math.abs(s.a.y - s.b.y) < EPS;
      const rH = Math.abs(r.a.y - r.b.y) < EPS;
      let ov = 0;
      let axis = "";
      if (sH && rH && Math.abs(s.a.y - r.a.y) < EPS) {
        ov = Math.min(Math.max(s.a.x, s.b.x), Math.max(r.a.x, r.b.x)) - Math.max(Math.min(s.a.x, s.b.x), Math.min(r.a.x, r.b.x));
        axis = `水平 y=${round2(s.a.y)}`;
      } else if (!sH && !rH && Math.abs(s.a.x - r.a.x) < EPS) {
        ov = Math.min(Math.max(s.a.y, s.b.y), Math.max(r.a.y, r.b.y)) - Math.max(Math.min(s.a.y, s.b.y), Math.min(r.a.y, r.b.y));
        axis = `垂直 x=${round2(s.a.x)}`;
      }
      if (ov <= OVERLAP_TOL) continue;
      // 共享端点（同一锚点扇出 / 首尾相接）不算无法分辨
      const near = (p, q) => Math.abs(p.x - q.x) < EPS && Math.abs(p.y - q.y) < EPS;
      if (near(s.a, r.a) || near(s.a, r.b) || near(s.b, r.a) || near(s.b, r.b)) continue;
      const key = [s.edge, r.edge].sort().join("|");
      if (report.has(key)) continue;
      report.add(key);
      errors.push(
        `[${bp}] 连线 ${s.edge} 与 ${r.edge} 共线重合 ${round2(ov)}px（${axis}），渲染后无法分辨；` +
          `请用 builder 的 bandRouter()/channelRouter() 给每条线分配独立轨道`,
      );
    }
  }
}

/** 判定一个节点是不是「容器」：连线穿进容器内部是正常的。 */
function isContainer(n) {
  return n.kind === "layer" || n.kind === "legend";
}

/**
 * 连线断言：端点落在节点边框上 / 途经点在画布内 / 线段不横穿任何节点内部。
 *
 * 「容器豁免」：层容器与图例包着节点，任何跨层连线都落在它们内部，\n * 所以只把容器与起止节点（含其祖先）从障碍物集合里排除。
 */
export function assertEdges(tree, errors) {
  const bp = tree.canvas.breakpoint;
  const edges = tree.edges ?? [];
  if (!edges.length) return;
  const canvas = tree.canvas;
  const entries = flattenWithAncestors(tree.elements);
  const byId = new Map(entries.map((e) => [e.node.id, e]));

  for (const e of edges) {
    const a = byId.get(e.from?.node);
    const b = byId.get(e.to?.node);
    const who = `[${bp}] 连线 ${e.id}`;
    if (!a || !b) {
      errors.push(`${who}: from/to 指向不存在的节点（${e.from?.node} → ${e.to?.node}）`);
      continue;
    }
    // ── 端点必须正好落在锚点上 ──
    for (const [label, node, side, pt] of [["fromPt", a.node, e.from.side, e.fromPt], ["toPt", b.node, e.to.side, e.toPt]]) {
      const want = anchor(node, side);
      if (Math.abs(want.x - pt.x) > EPS || Math.abs(want.y - pt.y) > EPS) {
        errors.push(
          `${who}.${label} 不在 ${node.id} 的 ${side} 边锚点上：` +
            `实际 (${round2(pt.x)},${round2(pt.y)}) ≠ 锚点 (${round2(want.x)},${round2(want.y)})`,
        );
      }
      if (!inCanvas(pt, canvas)) errors.push(`${who}.${label} 越出画布：(${round2(pt.x)},${round2(pt.y)})`);
    }

    // ── 途经点在画布内 ──
    (e.via ?? []).forEach((p, i) => {
      if (!inCanvas(p, canvas)) errors.push(`${who}.via[${i}] 越出画布：(${round2(p.x)},${round2(p.y)})`);
    });

    // ── 线段不得横穿其他节点 ──
    const pts = [{ x: e.fromPt.x, y: e.fromPt.y }, ...(e.via ?? []), { x: e.toPt.x, y: e.toPt.y }];
    const exempt = new Set([a.node.id, b.node.id, ...a.ancestors, ...b.ancestors]);
    for (const { node: n, ancestors } of entries) {
      if (exempt.has(n.id) || isContainer(n) || n.kind === "edgeLabel") continue;
      if (ancestors.some((x) => exempt.has(x))) continue;
      for (let i = 0; i + 1 < pts.length; i += 1) {
        if (segmentHitsRect(pts[i], pts[i + 1], n)) {
          errors.push(
            `${who} 的线段 ${i} 横穿节点 ${n.id}` +
              `（${round2(pts[i].x)},${round2(pts[i].y)} → ${round2(pts[i + 1].x)},${round2(pts[i + 1].y)}）；请用 route()/viaPanel() 绕行`,
          );
        }
      }
    }

    // ── 动作标签必须落在连线上（不是悬空文字）──
    if (e.labelNode) {
      const lbl = byId.get(e.labelNode)?.node;
      if (!lbl) {
        errors.push(`${who}.labelNode 指向不存在的节点：${e.labelNode}`);
      } else {
        if (lbl.kind !== "edgeLabel") errors.push(`${who}.labelNode=${lbl.id} 的 kind 应为 edgeLabel，实际 ${lbl.kind}`);
        const onLine = pts.some((p, i) => i + 1 < pts.length && segmentHitsRect(pts[i], pts[i + 1], lbl));
        if (!onLine) {
          errors.push(`${who} 的动作标签 ${lbl.id} 不在连线上（请把标签盒放到线段上）`);
        }
      }
    }
  }
}

/** 兄弟节点检查：重叠 + 相邻间距。 */
function checkSiblings(siblings, where, allowed, errors) {
  for (let i = 0; i < siblings.length; i += 1) {
    for (let j = i + 1; j < siblings.length; j += 1) {
      const a = siblings[i];
      const b = siblings[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > EPS && oy > EPS) {
        errors.push(`${where}: 兄弟元素重叠 ${a.id} × ${b.id}（重叠 ${round2(ox)}×${round2(oy)}）`);
      }
    }
  }

  const checkAxis = (axis, other) => {
    const size = axis === "y" ? "h" : "w";
    const sorted = [...siblings].sort((a, b) => a[axis] - b[axis] || a[other] - b[other]);
    for (let i = 0; i < sorted.length; i += 1) {
      const a = sorted[i];
      if (isSpacingExempt(a)) continue;
      let nearest = null;
      for (let j = 0; j < sorted.length; j += 1) {
        if (i === j) continue;
        const b = sorted[j];
        if (isSpacingExempt(b)) continue;
        if (!overlaps1D(a[other], a[other === "x" ? "w" : "h"], b[other], b[other === "x" ? "w" : "h"])) continue;
        const gap = b[axis] - (a[axis] + a[size]);
        if (gap > EPS && (nearest === null || gap < nearest.gap - EPS)) nearest = { gap, b };
      }
      if (!nearest) continue;
      if (allowed && !allowed.has(round2(nearest.gap))) {
        errors.push(
          `${where}: ${a.id} 与 ${nearest.b.id} 的${axis === "y" ? "垂直" : "水平"}间距 ` +
            `${round2(nearest.gap)} 不在 SPACE 刻度内（允许 ${[...allowed].join(" / ")}）`,
        );
      }
    }
  };
  checkAxis("y", "x");
  checkAxis("x", "y");
}

/** 对单棵树执行几何断言。 */
export function assertTree(tree, allowed, errors) {
  const canvas = tree.canvas;
  const bp = tree.canvas.breakpoint;

  // ── 4. expr 完整性 ──
  const walkExpr = (nodes) => {
    for (const n of nodes) {
      for (const f of FIELDS) {
        if (!n.expr?.[f]) errors.push(`[${bp}] 节点 ${n.id}.${f} 缺少 expr 出处`);
      }
      if (n.children?.length) walkExpr(n.children);
    }
  };
  walkExpr(tree.elements);

  // ── 3b. 快照中的间距变量必须落在刻度集合内 ──
  if (allowed) {
    for (const [key, value] of Object.entries(tree.variableSnapshot ?? {})) {
      if (typeof value !== "number") continue;
      if (!SPACING_KEY.test(key) || SIZE_SUFFIX.test(key)) continue;
      if (!allowed.has(round2(value))) {
        errors.push(`[${bp}] 快照变量 ${key} = ${value} 属于间距类，但不在 SPACE 刻度内`);
      }
    }
  }

  // ── 1 & 2 & 3a ──
  const walk = (nodes, parent, where) => {
    for (const n of nodes) {
      if (n.x < -EPS || n.y < -EPS || n.x + n.w > canvas.w + EPS || n.y + n.h > canvas.h + EPS) {
        errors.push(`[${bp}] 越界: ${n.id} (${n.x},${n.y},${n.w}×${n.h}) 超出画布 ${canvas.w}×${canvas.h}`);
      }
      if (parent) {
        if (
          n.x < parent.x - EPS ||
          n.y < parent.y - EPS ||
          n.x + n.w > parent.x + parent.w + EPS ||
          n.y + n.h > parent.y + parent.h + EPS
        ) {
          errors.push(`[${bp}] 子元素越出父容器: ${n.id} 不在 ${parent.id} 内部`);
        }
      }
      if (n.children.length) {
        // 图例内部是「行内垂直居中」得到的间距，不适用留白刻度
        const groupAllowed = n.kind === "legend" ? null : allowed;
        checkSiblings(n.children, `[${bp}] ${n.id}/children`, groupAllowed, errors);
        walk(n.children, n, `${where}/${n.id}`);
      }
    }
  };

  checkSiblings(tree.elements, `[${bp}] 顶层`, allowed, errors);
  walk(tree.elements, null, `[${bp}]`);
  // ── 5. 连线几何 ──
  assertEdges(tree, errors);
  // ── 6. 连线可分辨（不共线重合）──
  assertEdgeOverlap(tree, errors);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("用法: node scripts/validate/assert-layout.mjs --project <dir> [--no-purity]");
    return;
  }
  const projectDir = path.resolve(args.project);
  const trees = listTrees(path.join(projectDir, "layout-tree"));
  const errors = [];

  if (trees.length === 0) {
    console.error(`assert-layout 失败: ${path.join(projectDir, "layout-tree")} 下没有 Layout Tree，请先运行 build-tree.mjs`);
    process.exit(1);
  }

  const allowed = readSpacingScale(projectDir);
  if (!allowed) errors.push("无法从 variables/tokens.ts 解析 SPACE 间距刻度");

  for (const [, tree] of trees) assertTree(tree, allowed, errors);

  if (args.purity) {
    try {
      const fresh = await buildTrees(projectDir);
      for (const [file, tree] of trees) {
        const bp = tree.canvas.breakpoint;
        if (!fresh[bp]) errors.push(`重算结果缺少断点 ${bp}（归档文件 ${file}）`);
        else if (serializeTree(fresh[bp]) !== serializeTree(tree)) {
          errors.push(`归档 ${file} 与重算结果不一致：布局计算可能不是纯函数或产物未更新`);
        }
      }
    } catch (e) {
      errors.push(`纯函数性检查失败: ${e.message}`);
    }
  }

  if (errors.length) {
    console.error(`assert-layout 失败：${errors.length} 项\n  - ${errors.join("\n  - ")}`);
    process.exit(1);
  }
  const n = trees.reduce((acc, [, t]) => {
    const count = (list) => list.reduce((s, x) => s + 1 + count(x.children), 0);
    return acc + count(t.elements);
  }, 0);
  const withEdges = trees.filter(([, t]) => t.edges?.length).length;
  const edgeCount = trees.reduce((acc, [, t]) => acc + (t.edges?.length ?? 0), 0);
  console.log(
    `✓ assert-layout 通过：${trees.length} 棵树 / ${n} 个节点` +
      (edgeCount ? ` / ${edgeCount} 条连线（${withEdges} 棵树）` : "") +
      " —— 无越界、兄弟不重叠、间距合规、expr 完整、连线合规且可分辨、复算一致",
  );
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => {
    console.error(`assert-layout 异常: ${e.message}`);
    process.exit(1);
  });
}
