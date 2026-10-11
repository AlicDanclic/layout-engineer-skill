/**
 * indexer — 反向索引 + 归档清单 + 修改回路。
 *
 * 三项产物（对应 manifest.json 的三重作用）：
 *   1. variableSnapshot —— 归档与复算依据
 *   2. variableUsage    —— 修改回路的查表依据（变量 → 元素 id）
 *   3. confirmations    —— 机器可读的确认状态，渲染闸门读它
 *
 * 变量归属来源（按可信度合并，取并集）：
 *   a. 节点显式声明的 `refs`（v1.1 主路径，读字段，误差为零）
 *   b. Layout Tree 的 `expr` 字符串（人写的出处算式，天然含变量名）
 *   c. TS Compiler API 的 AST 追溯（找不到归属记 `(unknown)`，这是启发式的已知边界）
 *
 * 用法：
 *   node scripts/indexer.mjs --project <dir>
 *   node scripts/indexer.mjs --project <dir> --impact <VAR> [新值]
 */
import fs from "node:fs";
import path from "node:path";
import { listFiles, readJson, writeJson, ensureDir } from "./layout-engine/io.mjs";
import { tokenize } from "./validate/lint-geometry.mjs";
import { hashLayoutTree } from "./layout-engine/hash.mjs";
import { evaluate, splitExpr } from "./validate/verify-positioning.mjs";
import { loadTypeScript, analyzeLayoutAst, GEOM_VAR_RE } from "./layout-engine/ast.mjs";
import { parseArgs, splitList } from "./layout-engine/cli.mjs";

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const mark = (n) => (n <= 20 ? CIRCLED[n - 1] : `(${n})`);

const round2 = (v) => Math.round(v * 100) / 100;

/** 收集文件中导出的 `export const NAME` / `export function NAME`。 */
function collectExports(src) {
  const out = [];
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);/g)) {
    out.push({ name: m[1], kind: "const", valueExpr: m[2].trim(), index: m.index });
  }
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) {
    out.push({ name: m[1], kind: "function", index: m.index });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** 提取紧邻声明前的变量注释字段。 */
export function extractVariableDoc(src, declIndex) {
  const before = src.slice(0, declIndex);
  const end = before.lastIndexOf("*/");
  if (end < 0) return null;
  const start = before.lastIndexOf("/**", end);
  if (start < 0) return null;
  const body = before.slice(start + 3, end);
  const fields = {};
  for (const line of body.split("\n")) {
    const m = line.replace(/^\s*\*?\s?/, "").match(/^(作用|可选值|临界参数|影响范围|可调范围)\s*[:：]\s*(.+)$/);
    if (m) fields[m[1]] = m[2].trim();
  }
  return Object.keys(fields).length ? fields : null;
}

const flatten = (nodes, ancestors = [], out = []) => {
  for (const n of nodes) {
    out.push({ node: n, ancestors });
    if (n.children?.length) flatten(n.children, [...ancestors, n.id], out);
  }
  return out;
};

/** 宽值的算术求值（仅用于从源码里读数值常量）。 */
function literalValue(expr, env = {}) {
  try {
    return evaluate(expr, env);
  } catch {
    return undefined;
  }
}

/**
 * 读取确认记录并汇总成 manifest.confirmations。
 * 只把「记录存在 且 指纹与当前 layout-tree 一致」的项算作 true。
 */
export function aggregateConfirmations(projectDir, trees) {
  const project = path.resolve(projectDir);
  const file = path.join(project, "positioning", "confirmed.json");
  // positioning 是按断点名的通用映射（单画布项目如 drawio 的 hwsync / gitviz-gui 也在内）；
  // positioningDesktop / positioningMobile 是历史遗留的便捷键，保留向后兼容。
  const out = {
    structure: false,
    positioningDesktop: false,
    positioningMobile: false,
    positioning: {},
    storyboard: false,
  };
  if (!fs.existsSync(file)) return out;
  let data;
  try {
    data = readJson(file);
  } catch {
    return out;
  }
  const byBp = new Map(trees.map((t) => [t.canvas.breakpoint, t]));
  for (const rec of data.records ?? []) {
    if (rec.node === "structure") {
      out.structure = true;
      continue;
    }
    if (rec.node === "storyboard") {
      out.storyboard = true;
      continue;
    }
    if (rec.node === "positioning") {
      const tree = byBp.get(rec.bp);
      if (!tree) continue;
      // 指纹不符 → 确认已失效，不算数
      if (rec.treeHash && rec.treeHash !== hashLayoutTree(tree)) continue;
      out.positioning[rec.bp] = true;
      if (rec.bp === "desktop") out.positioningDesktop = true;
      if (rec.bp === "mobile") out.positioningMobile = true;
    }
  }
  return out;
}

/**
 * 构建反向索引与清单数据。
 */
export async function buildIndex(projectDir, { deliveryScope = null } = {}) {
  const project = path.resolve(projectDir);

  // ── 1. 变量清单（来自 variables/） ──
  const varFiles = listFiles(path.join(project, "variables"));
  const vars = new Map();
  for (const f of varFiles) {
    const src = fs.readFileSync(f, "utf8");
    for (const exp of collectExports(src)) {
      vars.set(exp.name, {
        name: exp.name,
        kind: exp.kind,
        file: path.relative(project, f),
        valueExpr: exp.valueExpr ?? null,
        doc: extractVariableDoc(src, exp.index),
      });
    }
  }

  // ── 2. Layout Tree：快照 + 节点 refs + expr 扫描 ──
  const treeFiles = listFiles(path.join(project, "layout-tree"));
  const trees = treeFiles.map((f) => readJson(f));
  const elements = new Set();
  const snapshot = {};
  /** var -> Set(elementId) */
  const use = new Map();
  const usedIn = new Map();
  const addUse = (name, id) => {
    if (!use.has(name)) use.set(name, new Set());
    use.get(name).add(id);
  };

  for (const tree of trees) {
    Object.assign(snapshot, tree.variableSnapshot ?? {});
    for (const { node } of flatten(tree.elements ?? [])) {
      elements.add(node.id);
      if (Array.isArray(node.refs)) for (const r of node.refs) addUse(r, node.id);
      for (const e of Object.values(node.expr ?? {})) {
        for (const t of tokenize(String(e))) if (t.type === "ident") addUse(t.value, node.id);
      }
    }
  }

  // ── 3. AST 追溯（TS Compiler API），不可用时跳过并记录 ──
  const ts = await loadTypeScript();
 	let astNote = null;
  if (ts) {
    const { usage, filesByVar } = analyzeLayoutAst(project, ts);
    for (const [name, owners] of usage) {
      for (const o of owners) addUse(name, o); // 含 "(unknown)"
      if (filesByVar.has(name)) usedIn.set(name, [...filesByVar.get(name)]);
    }
  } else {
    astNote = "typescript 未安装，AST 追溯已跳过（回退到 refs + expr 扫描）";
  }

  // ── 4. 组装 ──
  const variables = {};
  const variableUsage = {};
  for (const [name, v] of vars) {
    const ids = [...(use.get(name) ?? [])];
    const known = ids.filter((i) => i !== "(unknown)").sort();
    const hasUnknown = ids.includes("(unknown)");
    variableUsage[name] = known;
    variables[name] = {
      name,
      kind: v.kind,
      file: v.file,
      doc: v.doc,
      value: v.valueExpr !== null ? literalValue(v.valueExpr, snapshot) : undefined,
      elements: known,
      usedIn: usedIn.get(name) ?? [],
      unknownOwner: hasUnknown,
    };
  }

  const confirmations = aggregateConfirmations(project, trees);
  const manifestPath = path.join(project, "manifest.json");
  const prev = fs.existsSync(manifestPath) ? readJson(manifestPath) : {};

  return {
    manifest: {
      ...prev,
      project: path.basename(project),
      generatedBy: "layout-engineer/indexer",
      generatedAt: new Date().toISOString(),
      variableSnapshot: snapshot,
      variableUsage,
      confirmations,
      // 本次交付范围（缺省 = 全部断点）。闸门默认读它，
      // 让「只交付桌面端」成为一个可持久化、可机器校验的决定，而不是每次敲 CLI 参数
      deliveryScope: deliveryScope ?? prev.deliveryScope ?? null,
      // v1：全局安装行为靠项目自报（软约束）；v1.1 改为包装 npm/pip 做审计
      globalInstall: prev.globalInstall ?? false,
      // schema 已预留 refs；v1.1 起布局函数应显式填写，indexer 从「猜归属」退化为「读字段」
      refs: { reserved: true, usedByNodes: trees.some((t) => flatten(t.elements ?? []).some(({ node }) => node.refs)) },
      astNote,
      variables,
      elements: [...elements],
    },
    variables,
    variableUsage,
    snapshot,
    confirmations,
  };
}

// ── 修改回路：结构化 diff 预览 ─────────────────────────────────────────

function describeField(field, before, after) {
  const d = round2(after - before);
  if (Math.abs(d) < 0.005) return `${field} 不变`;
  const size = Math.abs(d);
  if (field === "y") return `y 坐标${d < 0 ? "上移" : "下移"} ${size}px`;
  if (field === "x") return `x 坐标${d < 0 ? "左移" : "右移"} ${size}px`;
  if (field === "h") return `高度${d > 0 ? "增加" : "减少"} ${size}px`;
  if (field === "w") return `宽度${d > 0 ? "增加" : "减少"} ${size}px`;
  return `${field} 变化 ${d}px`;
}

/**
 * 生成结构化 diff 预览：不是直接改，而是先给用户看后果。
 */
export function impactPreview(projectDir, varName, newValue) {
  const project = path.resolve(projectDir);
  const trees = listFiles(path.join(project, "layout-tree")).map((f) => readJson(f));
  if (trees.length === 0) return { ok: false, message: "layout-tree/ 下没有 Layout Tree，请先运行 build-tree.mjs" };

  const v = (() => {
    const varFiles = listFiles(path.join(project, "variables"));
    for (const f of varFiles) {
      const src = fs.readFileSync(f, "utf8");
      for (const exp of collectExports(src)) {
        if (exp.name === varName) {
          return { name: exp.name, file: path.relative(project, f), doc: extractVariableDoc(src, exp.index) };
        }
      }
    }
    return null;
  })();
  if (!v) return { ok: false, message: `未知变量: ${varName}（不在 variables/ 中）` };

  const tree = trees.find((t) => t.canvas.breakpoint === "desktop") ?? trees[0];
  const env = { ...(tree.variableSnapshot ?? {}) };
  const before = env[varName];
  const after = newValue === undefined ? undefined : Number(newValue);
  if (after !== undefined) env[varName] = after;

  const hits = [];
  for (const { node } of flatten(tree.elements ?? [])) {
    const parts = [];
    for (const field of ["x", "y", "w", "h"]) {
      const expr = node.expr?.[field];
      if (!expr) continue;
      const [lhs] = splitExpr(expr);
      if (!lhs) continue;
      const ids = tokenize(lhs).filter((t) => t.type === "ident").map((t) => t.value);
      if (!ids.includes(varName)) continue;
      if (after === undefined) {
        parts.push(`${field}（依赖 ${varName}）`);
        continue;
      }
      let next;
      try {
        next = evaluate(lhs, env);
      } catch {
        continue;
      }
      parts.push(describeField(field, node[field], next));
    }
    if (parts.length) hits.push({ id: node.id, label: node.label, parts });
  }

  const numbers = new Map();
  flatten(tree.elements ?? []).forEach(({ node }, i) => numbers.set(node.id, i + 1));

  const lines = [];
  const doc = v.doc?.作用 ? `  （${v.doc.作用}）` : "";
  lines.push(
    after === undefined
      ? `建议修改：${varName}${doc}`
      : `建议修改：${varName}  ${before ?? "?"} → ${after}${doc}`,
  );
  lines.push(`定义位置：${v.file}${v.doc?.可调范围 ? `   可调范围：${v.doc.可调范围}` : ""}`);
  if (hits.length === 0) {
    lines.push("影响元素：无（没有任何节点的 expr 依赖该变量）");
  } else {
    lines.push(
      `影响元素：${hits.map((h) => `${mark(numbers.get(h.id) ?? 0)} ${h.id}（${h.parts.join("；")}）`).join("；")}`,
    );
  }
  if (after !== undefined && v.doc?.可调范围) {
    const m = v.doc.可调范围.match(/(\d+(?:\.\d+)?)\s*~\s*(\d+(?:\.\d+)?)/);
    if (m && (after < Number(m[1]) || after > Number(m[2]))) {
      lines.push(`⚠ 超出可调范围（${v.doc.可调范围}）—— 该区间就是修改请求的校验规则`);
    }
  }
  lines.push("确认执行？[y/n]");

  return {
    ok: true,
    text: lines.join("\n"),
    data: { varName, before, after, file: v.file, doc: v.doc ?? null, affected: hits },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { project: ".", impact: null, scope: null, _: [] });
  const project = path.resolve(args.project);
  const deliveryScope = splitList(args.scope);
  const impactTail = args._;

  if (args.impact) {
    const r = impactPreview(project, args.impact, impactTail[0]);
    if (!r.ok) {
      console.error(r.message);
      process.exit(1);
    }
    console.log(r.text);
    return;
  }

  const { manifest } = await buildIndex(project, { deliveryScope });
  ensureDir(project);
  writeJson(path.join(project, "manifest.json"), manifest);
  if (manifest.astNote) console.warn(`indexer 提示：${manifest.astNote}`);
  const cf = manifest.confirmations;
  const pos = Object.entries(cf.positioning ?? {})
    .filter(([, v]) => v)
    .map(([k]) => k);
  console.log(
    `✓ indexer：${Object.keys(manifest.variables).length} 个变量 / ${manifest.elements.length} 个元素 → manifest.json` +
      `（确认状态 结构=${cf.structure} 定位图=${pos.length ? pos.join("/") : "无"} 分镜=${cf.storyboard}` +
      `${manifest.deliveryScope ? `｜交付范围 ${manifest.deliveryScope.join("/")}` : ""}）`,
  );
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => {
    console.error(`indexer 异常: ${e.message}`);
    process.exit(1);
  });
}
