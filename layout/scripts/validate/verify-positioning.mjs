#!/usr/bin/env node
/**
 * verify-positioning — 定位图数值 ↔ Layout Tree expr 一致性校验（验证层 ③）。
 *
 * 在**确认节点 B 之前**运行，防两件事：
 *   1. 查看器自身出 bug（例如断点切换时读错了树）；
 *   2. 有人为了「图上好看」而手动改标注值。
 *
 * expr 规范（两段式）：`<符号算式> = <数值算式>`
 *   例：y: "HEADER_H + SPACE.lg = 64 + 24"
 *
 * 校验规则：把两段**分别**用 variableSnapshot 复算，两者都必须等于节点实际数值。
 * 只校验一侧会留下逃逸通道——符号段对了但结果写错的 expr 照样会漏过去。
 *
 * 用法：node scripts/validate/verify-positioning.mjs --project <dir>
 */
import path from "node:path";
import { listTrees } from "../layout-engine/io.mjs";

const EPS = 0.02;
const FIELDS = ["x", "y", "w", "h"];

/**
 * 极简算术求值器。
 * 支持 + - * / ( ) 一元负号、数字、标识符（含点，允许 `SPACE.md` 这类键）。
 */
export function evaluate(expr, env) {
  const tokens = [];
  let i = 0;
  const src = String(expr).replace(/×/g, "*").replace(/÷/g, "/").replace(/\s+/g, " ").trim();
  if (src === "") throw new Error("空算式");
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9._]/.test(src[j])) j += 1;
      const raw = src.slice(i, j).replace(/_/g, "");
      const v = Number(raw);
      if (!Number.isFinite(v)) throw new Error(`数字字面量非法: ${raw}`);
      tokens.push({ t: "num", v });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j += 1;
      tokens.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/()".includes(c)) {
      tokens.push({ t: "op", v: c });
      i += 1;
      continue;
    }
    throw new Error(`无法解析的字符 "${c}"（算式：${expr}）`);
  }

  let p = 0;
  const peek = () => tokens[p];
  const eat = (v) => {
    const t = tokens[p];
    if (!t || t.v !== v) throw new Error(`语法错误，期望 "${v}"（算式：${expr}）`);
    p += 1;
    return t;
  };

  const parseExpr = () => {
    let v = parseTerm();
    while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = tokens[p++].v;
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const parseTerm = () => {
    let v = parseFactor();
    while (peek() && peek().t === "op" && (peek().v === "*" || peek().v === "/")) {
      const op = tokens[p++].v;
      const r = parseFactor();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const parseFactor = () => {
    const t = peek();
    if (!t) throw new Error(`算式意外结束：${expr}`);
    if (t.t === "op" && t.v === "-") {
      p += 1;
      return -parseFactor();
    }
    if (t.t === "op" && t.v === "+") {
      p += 1;
      return parseFactor();
    }
    if (t.t === "op" && t.v === "(") {
      p += 1;
      const v = parseExpr();
      eat(")");
      return v;
    }
    if (t.t === "num") {
      p += 1;
      return t.v;
    }
    if (t.t === "id") {
      p += 1;
      if (!(t.v in env)) throw new Error(`变量 ${t.v} 不在 variableSnapshot 中（算式：${expr}）`);
      const val = Number(env[t.v]);
      if (!Number.isFinite(val)) throw new Error(`变量 ${t.v} 的值不是数值：${env[t.v]}`);
      return val;
    }
    throw new Error(`语法错误：${expr}`);
  };

  const result = parseExpr();
  if (p !== tokens.length) throw new Error(`算式有未消费内容：${expr}`);
  return result;
}

/** 拆成 [符号算式, 数值算式]；没有 "=" 时返回 [null, expr]。 */
export function splitExpr(expr) {
  const i = String(expr).lastIndexOf("=");
  if (i < 0) return [null, String(expr)];
  return [String(expr).slice(0, i), String(expr).slice(i + 1)];
}

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * 校验一组「坐标 + 两段式出处」，两者都必须复算出同一个值。
 */
function verifyPoint(pt, ex, env, who, errors) {
  for (const axis of ["x", "y"]) {
    const e = ex?.[axis];
    if (!e) {
      errors.push(`${who}.${axis} 缺少 expr 出处`);
      continue;
    }
    const [lhs, rhs] = splitExpr(e);
    if (lhs === null) {
      errors.push(`${who}.${axis} 的 expr 必须是两段式（实际: ${e}）`);
      continue;
    }
    let vl;
    let vr;
    try {
      vl = evaluate(lhs, env);
    } catch (err) {
      errors.push(`${who}.${axis} 的符号段无法复算：${err.message}`);
      continue;
    }
    try {
      vr = evaluate(rhs, env);
    } catch (err) {
      errors.push(`${who}.${axis} 的数值段无法复算：${err.message}`);
      continue;
    }
    if (Math.abs(vl - pt[axis]) > EPS) errors.push(`${who}.${axis}: 符号段复算 ${round2(vl)} ≠ 实际 ${pt[axis]}（${e}）`);
    if (Math.abs(vr - pt[axis]) > EPS) errors.push(`${who}.${axis}: 数值段复算 ${round2(vr)} ≠ 实际 ${pt[axis]}（${e}）`);
    if (Math.abs(vl - vr) > EPS) errors.push(`${who}.${axis}: 符号段 ${round2(vl)} 与数值段 ${round2(vr)} 不等（${e}）`);
  }
}

/** 校验树里的连线：端点与途经点同样要求「两段复算 = 树值」。 */
export function verifyEdges(tree, where) {
  const errors = [];
  const env = tree.variableSnapshot ?? {};
  for (const e of tree.edges ?? []) {
    const who = `${where} 连线 ${e.id}`;
    verifyPoint(e.fromPt, e.fromPtExpr, env, `${who}.fromPt`, errors);
    verifyPoint(e.toPt, e.toPtExpr, env, `${who}.toPt`, errors);
    (e.via ?? []).forEach((p, i) => verifyPoint(p, e.viaExpr?.[i], env, `${who}.via[${i}]`, errors));
  }
  return errors;
}

/**
 * 校验单棵树，返回错误字符串数组。
 */
export function verifyTree(tree, where) {
  const errors = [];
  const env = tree.variableSnapshot ?? {};
  const walk = (nodes) => {
    for (const n of nodes) {
      for (const f of FIELDS) {
        const e = n.expr?.[f];
        if (!e) {
          errors.push(`${where} 节点 ${n.id}.${f} 缺少 expr 出处`);
          continue;
        }
        const [lhs, rhs] = splitExpr(e);
        if (lhs === null) {
          errors.push(
            `${where} 节点 ${n.id}.${f} 的 expr 必须是「符号算式 = 数值算式」两段式（实际: ${e}）`,
          );
          continue;
        }
        let vl;
        let vr;
        try {
          vl = evaluate(lhs, env);
        } catch (err) {
          errors.push(`${where} 节点 ${n.id}.${f} 的符号段无法复算：${err.message}`);
          continue;
        }
        try {
          vr = evaluate(rhs, env);
        } catch (err) {
          errors.push(`${where} 节点 ${n.id}.${f} 的数值段无法复算：${err.message}`);
          continue;
        }
        if (Math.abs(vl - n[f]) > EPS) {
          errors.push(`${where} 节点 ${n.id}.${f}: 符号段复算 ${round2(vl)} ≠ 实际 ${n[f]}（expr: ${e}）`);
        }
        if (Math.abs(vr - n[f]) > EPS) {
          errors.push(`${where} 节点 ${n.id}.${f}: 数值段复算 ${round2(vr)} ≠ 实际 ${n[f]}（expr: ${e}）`);
        }
        if (Math.abs(vl - vr) > EPS) {
          errors.push(`${where} 节点 ${n.id}.${f}: 符号段 ${round2(vl)} 与数值段 ${round2(vr)} 不等（expr: ${e}）`);
        }
      }
      if (n.children?.length) walk(n.children);
    }
  };
  walk(tree.elements);
  errors.push(...verifyEdges(tree, where));
  return errors;
}

async function main() {
  const argv = process.argv.slice(2);
  const pi = argv.indexOf("--project");
  const projectDir = path.resolve(pi >= 0 ? argv[pi + 1] : ".");
  const trees = listTrees(path.join(projectDir, "layout-tree"));
  if (trees.length === 0) {
    console.error("verify-positioning 失败: layout-tree/ 下没有 Layout Tree");
    process.exit(1);
  }
  const errors = [];
  for (const [file, tree] of trees) errors.push(...verifyTree(tree, file));
  if (errors.length) {
    console.error(`verify-positioning 失败：${errors.length} 项\n  - ${errors.join("\n  - ")}`);
    process.exit(1);
  }
  const n = trees.reduce((acc, [, t]) => {
    const count = (list) => list.reduce((s, x) => s + 1 + count(x.children), 0);
    return acc + count(t.elements);
  }, 0);
  const m = trees.reduce((acc, [, t]) => acc + (t.edges?.length ?? 0), 0);
  console.log(
    `✓ verify-positioning 通过：${trees.length} 棵树 / ${n} 个节点` +
      (m ? ` / ${m} 条连线` : "") +
      "，expr 两段复算均与树值一致",
  );
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
