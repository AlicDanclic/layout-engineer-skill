#!/usr/bin/env node
/**
 * measure — 成图前的「先量」：把信息密度与可读性量成数字，而不是靠感觉。
 *
 * 为什么需要它：几何正确、断言全绿，不等于「图不空、字可读」。
 * 这一类问题只能量出来：容器内容占比、画布空白带、标签盒是否贴合文字、字号缩放后可读性。
 * 本脚本是「成图复审」询问点的机器依据：先跑它，再把数字给用户，问要不要动手。
 *
 * 指标与默认阈值（都可用参数覆盖）：
 *   1. 容器内容占比 = 直接子元素（不含 icon）面积和 / 容器面积；< --min-occupancy(默认 0.5) 视为浪费
 *   2. 标签盒多余 = 盒宽 − textWidth(文字)；> 2*labelPad + 1px 视为「白区过宽」
 *   3. 画布空白带 = 内容包围盒之外的左/右/上/下带宽；右/左带宽 > --max-band(默认 96) 提示收画布
 *   4. 画布宽度 > --max-width(默认关) 时提示收画布，保证 100% 显示可读
 *
 * 用法：
 *   node layout/scripts/measure.mjs --project <dir> [--min-occupancy 0.5] [--max-band 96]
 *                                        [--max-width 1600] [--label-pad 8] [--strict]
 *   --strict：有不达标项时退出码非 0（供 CI / 成图复审闸门）。
 */
import path from "node:path";
import { listTrees } from "./layout-engine/io.mjs";
import { textWidth } from "./layout-engine/builder.mjs";
import { parseArgs } from "./layout-engine/cli.mjs";

const round1 = (v) => Math.round(v * 10) / 10;
const pct = (v) => `${(v * 100).toFixed(1)}%`;

function flatten(nodes, out = []) {
  for (const n of nodes ?? []) {
    out.push(n);
    if (n.children?.length) flatten(n.children, out);
  }
  return out;
}

/** 点到线段距离。 */
function segDist(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * 对一棵树算密度指标。
 * @returns {{findings: {level:"fail"|"warn", msg:string}[], stats: object}}
 */
export function measureTree(tree, opts = {}) {
  const minOccupancy = opts.minOccupancy ?? 0.5;
  const maxBand = opts.maxBand ?? 96;
  const maxWidth = opts.maxWidth ?? null;
  const labelPad = opts.labelPad ?? Number(tree.variableSnapshot?.DRAWIO_LABEL_PAD ?? 8);
  const noteSize = Number(tree.variableSnapshot?.TYPE_NOTE ?? 11.5);
  const itemSize = Number(tree.variableSnapshot?.TYPE_ITEM ?? 13.5);
  const findings = [];
  const nodes = flatten(tree.elements);
  const bp = tree.canvas.breakpoint;

  // 1) 容器内容占比
  //   口径 = 「内容带（子元素包围盒，含节点之间的必要间隙）面积 / 容器面积」。
  //   为什么不把间隙算作浪费：卡片之间的间距是排布必需；真正的浪费是 padding、标题带、
  //   走廊这类“不承载内容”的空带。按面积和计会把「加大局部间隙塞标签」直接判死。
  const containers = [];
  for (const n of nodes) {
    if (n.kind !== "layer" && n.kind !== "legend") continue;
    const kids = (n.children ?? []).filter((c) => c.kind !== "icon");
    const area = n.w * n.h;
    let ratio = 0;
    if (kids.length && area > 0) {
      const x0 = Math.min(...kids.map((c) => c.x));
      const y0 = Math.min(...kids.map((c) => c.y));
      const x1 = Math.max(...kids.map((c) => c.x + c.w));
      const y1 = Math.max(...kids.map((c) => c.y + c.h));
      ratio = ((x1 - x0) * (y1 - y0)) / area;
    }
    containers.push({ id: n.id, ratio });
    if (ratio < minOccupancy) {
      findings.push({ level: "fail", msg: `[${bp}] 容器 ${n.id} 内容带占比 ${pct(ratio)} < ${pct(minOccupancy)}（内容带含必要间隙）→ 收窄 padding / 标题带或减小空白带` });
    }
  }

  // 2) 标签盒是否贴合文字
  for (const n of nodes) {
    if (n.kind !== "edgeLabel") continue;
    const excess = round1(n.w - textWidth(n.label, noteSize));
    const allow = 2 * labelPad + 1;
    if (excess > allow) {
      findings.push({ level: "warn", msg: `[${bp}] 标签 ${n.id}「${n.label}」白区过宽：盒宽 ${n.w}，文字约 ${round1(textWidth(n.label, noteSize))}，多余 ${excess}px > ${allow}px` });
    }
  }

  // 2b) 标签必须落在连线中段：中心在线段上，且不压在拐点上
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of tree.edges ?? []) {
    if (!e.labelNode) continue;
    const n = byId.get(e.labelNode);
    if (!n) continue;
    const c = { x: n.x + n.w / 2, y: n.y + n.h / 2 };
    const pts = [{ x: e.fromPt.x, y: e.fromPt.y }, ...(e.via ?? []), { x: e.toPt.x, y: e.toPt.y }];
    let d = Infinity;
    let db = Infinity;
    for (let i = 0; i + 1 < pts.length; i += 1) d = Math.min(d, segDist(c, pts[i], pts[i + 1]));
    for (const v of pts) db = Math.min(db, Math.hypot(c.x - v.x, c.y - v.y));
    if (d > 3) {
      findings.push({ level: "fail", msg: `[${bp}] 标签 ${n.id}「${n.label}」中心离线 ${round1(d)}px（应落在连线上）` });
    } else if (db < Math.max(n.w, n.h) / 2) {
      findings.push({ level: "warn", msg: `[${bp}] 标签 ${n.id}「${n.label}」压在连线拐点上（中心距最近拐点 ${round1(db)}px）→ 挪到直线段中段` });
    }
  }

  // 3) 画布空白带（内容包围盒之外）
  const structural = nodes.filter((n) => n.kind === "layer" || n.kind === "legend" || n.kind === "title");
  let bands = null;
  if (structural.length) {
    const x0 = Math.min(...structural.map((n) => n.x));
    const y0 = Math.min(...structural.map((n) => n.y));
    const x1 = Math.max(...structural.map((n) => n.x + n.w));
    const y1 = Math.max(...structural.map((n) => n.y + n.h));
    bands = { left: round1(x0), right: round1(tree.canvas.w - x1), top: round1(y0), bottom: round1(tree.canvas.h - y1) };
    for (const side of ["left", "right"]) {
      if (bands[side] > maxBand) {
        findings.push({ level: "warn", msg: `[${bp}] 画布${side === "left" ? "左" : "右"}侧空白带 ${bands[side]}px > ${maxBand}px → 若只为绕行/走廊，请改走线或收画布` });
      }
    }
  }

  // 4) 画布宽度与可读性
  if (maxWidth && tree.canvas.w > maxWidth) {
    findings.push({ level: "warn", msg: `[${bp}] 画布宽 ${tree.canvas.w} > ${maxWidth} → 按 100% 显示可读的目标，应进一步收窄` });
  }
  const readableAt = round1((10 / itemSize) * 100); // 正文显示到 ≥10px 所需的最小缩放百分比（粗略）
  findings.push({ level: "warn", msg: `[${bp}] 正文 ${itemSize}px：缩放到 < ${readableAt}% 时不可读（100% 显示可读）`, _info: true });

  return {
    findings,
    stats: { breakpoint: bp, canvas: `${tree.canvas.w}×${tree.canvas.h}`, containers, bands, itemSize, noteSize },
  };
}

export function measureProject(projectDir, opts = {}) {
  const trees = listTrees(path.join(path.resolve(projectDir), "layout-tree")).map(([, t]) => t);
  const all = [];
  const stats = [];
  for (const t of trees) {
    const r = measureTree(t, opts);
    all.push(...r.findings);
    stats.push(r.stats);
  }
  return { findings: all, stats };
}

function main() {
  const a = parseArgs(process.argv.slice(2), {
    project: ".", "min-occupancy": 0.5, "max-band": 96, "max-width": null, "label-pad": null, strict: false, quiet: false, help: false,
  });
  if (a.help) {
    console.log("用法: node layout/scripts/measure.mjs --project <dir> [--min-occupancy 0.5] [--max-band 96] [--max-width 1600] [--strict]");
    return;
  }
  const opts = {
    minOccupancy: Number(a["min-occupancy"]),
    maxBand: Number(a["max-band"]),
    maxWidth: a["max-width"] == null ? null : Number(a["max-width"]),
    labelPad: a["label-pad"] == null ? undefined : Number(a["label-pad"]),
  };
  const { findings, stats } = measureProject(a.project, opts);
  const fails = findings.filter((f) => f.level === "fail");
  const warns = findings.filter((f) => f.level === "warn" && !f._info);

  for (const s of stats) {
    console.log(`\n[${s.breakpoint}] canvas ${s.canvas}`);
    for (const c of s.containers) console.log(`  容器 ${c.id.padEnd(16)} 内容占比 ${pct(c.ratio)}`);
    if (s.bands) console.log(`  空白带  左 ${s.bands.left}  右 ${s.bands.right}  上 ${s.bands.top}  下 ${s.bands.bottom}`);
  }
  for (const f of findings) {
    if (f._info) console.log(`  · ${f.msg}`);
    else console.log(`  ${f.level === "fail" ? "✗" : "!"} ${f.msg}`);
  }
  console.log(`\n${fails.length ? "✗" : "✓"} measure：${fails.length} 项不达标 / ${warns.length} 项提示`);
  if (a.strict && fails.length) process.exit(1);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
