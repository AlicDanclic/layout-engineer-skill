#!/usr/bin/env node
/**
 * print-tree — 把 Layout Tree 反打成文本 box tree（确认节点 A 的机器版）。
 *
 * 用途：确认节点 A 时人写的是「提议的结构」；本脚本从已算出的 Layout Tree 打印
 *       「实际的结构」，用于复核两者是否一致，也是写进归档 / issue 的纯文本快照。
 *
 * 用法：node scripts/print-tree.mjs --project <dir> [--breakpoint desktop] [--expr]
 */
import path from "node:path";
import { listTrees } from "./layout-engine/io.mjs";

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const mark = (n) => (n <= 20 ? CIRCLED[n - 1] : `(${n})`);

/** 取 expr 的符号段（最后一个 "=" 之前），即「这个数值的出处」。 */
function symbolic(expr) {
  if (!expr) return "";
  const i = expr.lastIndexOf("=");
  return (i >= 0 ? expr.slice(0, i) : expr).trim();
}

function num(v) {
  return String(Math.round(v * 100) / 100);
}

function render(tree, { showExpr = false } = {}) {
  const lines = [];
  const c = tree.canvas;
  lines.push(`canvas ${c.w}×${c.h}（${c.breakpoint}）`);
  let n = 0;

  const walk = (nodes, prefix, isLast) => {
    nodes.forEach((node, i) => {
      const last = i === nodes.length - 1;
      const branch = prefix === "" ? "" : isLast ? "    " : "│   ";
      n += 1;
      const kids = node.children?.length ?? 0;
      const head = `${branch}${node.children.length || i < nodes.length - 1 ? "├─" : "└─"} ${mark(n)} ${node.id}`;
      const label = node.label && node.label !== node.id ? `  「${node.label}」` : "";
      const geom = `  [x=${num(node.x)} y=${num(node.y)} ${num(node.w)}×${num(node.h)}]`;
      lines.push(`${head}${label}${geom}`);
      if (showExpr) {
        const e = node.expr ?? {};
        const xs = ["x", "y", "w", "h"].filter((k) => e[k]).map((k) => `${k} ⟵ ${symbolic(e[k])}`);
        if (xs.length) lines.push(`${branch}│     ${xs.join("   ")}`);
      }
      if (kids) walk(node.children, `${prefix}${isLast ? "    " : "│   "}`, false);
      void last;
    });
  };
  walk(tree.elements, "", true);

  // 连线：与节点一样是布局结果，也必须能在纯文本里复核（drawio / 架构图的确认节点 A 靠它）
  const edges = tree.edges ?? [];
  if (edges.length) {
    const ids = new Map();
    let k = 0;
    const walk2 = (list) => {
      for (const n of list) {
        k += 1;
        ids.set(n.id, k);
        if (n.children?.length) walk2(n.children);
      }
    };
    walk2(tree.elements);
    lines.push("", `连线 ${edges.length} 条（端点为算出的锚点，via 为显式途经点）：`);
    for (const e of edges) {
      const a = ids.get(e.from.node) ?? "?";
      const b = ids.get(e.to.node) ?? "?";
      const tag = e.labelNode ? `  标签 ${e.labelNode}` : "  ⚠ 无动作标签";
      lines.push(
        `  ${mark(a)} ${e.from.node}(${e.from.side}) → ${mark(b)} ${e.to.node}(${e.to.side})` +
          `  [${e.role}${e.arrow && e.arrow !== "forward" ? ` · ${e.arrow}` : ""}]` +
          `  via ${e.via?.length ?? 0} 点${tag}`,
      );
    }
  }
  return lines.join("\n");
}

function main() {
  const argv = process.argv.slice(2);
  const pi = argv.indexOf("--project");
  const project = path.resolve(pi >= 0 ? argv[pi + 1] : ".");
  const bi = argv.indexOf("--breakpoint");
  const trees = listTrees(path.join(project, "layout-tree"));
  if (trees.length === 0) {
    console.error("print-tree 失败: layout-tree/ 下没有 Layout Tree，请先运行 build-tree.mjs");
    process.exit(1);
  }
  const showExpr = argv.includes("--expr");
  const wanted = bi >= 0 ? argv[bi + 1] : null;
  for (const [, tree] of trees) {
    if (wanted && tree.canvas.breakpoint !== wanted) continue;
    console.log(render(tree, { showExpr }));
    console.log("");
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
