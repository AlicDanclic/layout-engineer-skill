/**
 * indexer/ast — 用 TypeScript Compiler API 做布局源码的变量归属分析。
 *
 * 思路（对应方案第七节）：
 *   1. 遍历 AST，找出所有匹配「几何变量命名约定」的标识符（全大写下划线）；
 *   2. **向上追溯**到最近的、包含 `id: "xxx"` 属性的对象字面量，把标识符与该 id 关联；
 *   3. 追溯不到归属的记为 `(unknown)`——这是启发式的已知边界，不影响主流程。
 *
 * 优先级：节点若显式写了 `refs: ["HEADER_H", ...]`，直接采信 `refs`，
 * 从「猜归属」退化为「读字段」，误差为零（v1.1 迁移路径，schema 已预留）。
 */
import fs from "node:fs";
import path from "node:path";
import { listFiles } from "./io.mjs";

/** 几何变量命名约定：全大写下划线 —— 这就是命名约定存在的意义。 */
export const GEOM_VAR_RE = /^[A-Z][A-Z0-9_]{1,}$/;

/** 尝试加载 typescript；不可用时返回 null，由调用方回退。 */
export async function loadTypeScript() {
  try {
    return await import("typescript");
  } catch {
    return null;
  }
}

function objectPropName(prop, ts) {
  if (!ts.isPropertyAssignment(prop)) return null;
  const n = prop.name;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n)) return n.text;
  return null;
}

function stringLiteralValue(expr, ts) {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  return null;
}

function stringArrayValue(expr, ts) {
  if (!ts.isArrayLiteralExpression(expr)) return null;
  const out = [];
  for (const el of expr.elements) {
    const v = stringLiteralValue(el, ts);
    if (v === null) return null;
    out.push(v);
  }
  return out;
}

/**
 * 分析单个文件，返回 { name -> Set(elementId|"(unknown)") } 与反向映射。
 * @param {string} source
 * @param {string} fileName
 * @param {*} ts
 */
export function analyzeSourceAst(source, fileName, ts) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  /** @type {Map<string, Set<string>>} var -> elementIds */
  const usage = new Map();
  const touched = new Set();

  const add = (name, owner) => {
    if (!usage.has(name)) usage.set(name, new Set());
    usage.get(name).add(owner);
    touched.add(name);
  };

  const visit = (node, owner) => {
    // 进入一个对象字面量时，先看它有没有 id / refs
    let nextOwner = owner;
    if (ts.isObjectLiteralExpression(node)) {
      let id = null;
      let refs = null;
      for (const prop of node.properties) {
        const name = objectPropName(prop, ts);
        if (name === "id") id = stringLiteralValue(prop.initializer, ts);
        else if (name === "refs") refs = stringArrayValue(prop.initializer, ts);
      }
      // 显式 refs 优先：直接采信，不做追溯
      if (refs && refs.length) {
        const ownerId = id ?? "(unknown)";
        for (const r of refs) add(r, ownerId);
      }
      if (id) nextOwner = id;
    }

    if (ts.isIdentifier(node) && GEOM_VAR_RE.test(node.text)) {
      add(node.text, nextOwner ?? "(unknown)");
    }

    ts.forEachChild(node, (child) => visit(child, nextOwner));
  };

  visit(sf, null);
  return { usage, touched };
}

/** 扫描整个 src/layout 目录。 */
export function analyzeLayoutAst(projectDir, ts) {
  const files = listFiles(path.join(projectDir, "src", "layout")).filter((f) => /\.(ts|tsx)$/.test(f));
  /** @type {Map<string, Set<string>>} */
  const usage = new Map();
  const filesByVar = new Map();
  for (const f of files) {
    const rel = path.relative(projectDir, f);
    const { usage: u } = analyzeSourceAst(fs.readFileSync(f, "utf8"), f, ts);
    for (const [name, owners] of u) {
      if (!usage.has(name)) usage.set(name, new Set());
      for (const o of owners) usage.get(name).add(o);
      if (!filesByVar.has(name)) filesByVar.set(name, new Set());
      filesByVar.get(name).add(rel);
    }
  }
  return { usage, filesByVar, files: files.map((f) => path.relative(projectDir, f)) };
}
