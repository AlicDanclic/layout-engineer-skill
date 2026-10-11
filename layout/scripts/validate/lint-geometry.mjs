/**
 * lint-geometry — 几何裸字面量检查（规范一）。
 *
 * 双层用法：
 *   1) CLI:   node scripts/validate/lint-geometry.mjs --project <dir>
 *   2) ESLint 自定义规则: import { rules } from "./lint-geometry.mjs"
 *      plugin 用法见 scripts/validate/lint-geometry/eslint-plugin.mjs
 *
 * 规则：
 *   - 变量定义文件（variables/**）是几何字面量唯一合法归宿。
 *   - 布局计算文件（src/layout/**、src/serializers/**）中：
 *       禁止 0 与 1 以外的数字字面量出现在几何上下文里
 *       （几何属性值 / 几何变量初始化 / 与几何标识符同表达式的算术）。
 *   - 0 表示贴边对齐，1 表示序号与比例步长，两者豁免。
 *   - 字符串内容（含模板字符串）不参与扫描，expr 注释表达式不受影响。
 */
import fs from "node:fs";
import path from "node:path";
import { listFiles } from "../layout-engine/io.mjs";
import { parseArgs } from "../layout-engine/cli.mjs";

const GEOM_KEYS = new Set([
  "x", "y", "w", "h",
  "width", "height", "top", "left", "right", "bottom",
  "gap", "padding", "margin", "inset", "size", "radius",
]);

const GEOM_VAR_RE = /(^|_)(X|Y|W|H|WIDTH|HEIGHT|GAP|PAD|MARGIN|INSET|SIZE|RADIUS|TOP|LEFT|RIGHT|BOTTOM)$/;

/** 极简词法分析：注释/字符串/数字/标识符/符号。 */
export function tokenize(src) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = src.length;
  const push = (type, value, startLine, startCol) =>
    tokens.push({ type, value, line: startLine, col: startCol, start: i - value.length, end: i });

  const advance = (k) => {
    for (let j = 0; j < k; j += 1) {
      if (src[i] === "\n") {
        line += 1;
        col = 1;
      } else {
        col += 1;
      }
      i += 1;
    }
  };

  while (i < n) {
    const c = src[i];
    const sl = line;
    const sc = col;
    // 空白
    if (/\s/.test(c)) {
      advance(1);
      continue;
    }
    // 行注释
    if (c === "/" && src[i + 1] === "/") {
      const start = i;
      advance(2);
      while (i < n && src[i] !== "\n") advance(1);
      tokens.push({ type: "comment", value: src.slice(start, i), line: sl, col: sc, start, end: i });
      continue;
    }
    // 块注释
    if (c === "/" && src[i + 1] === "*") {
      const start = i;
      advance(2);
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) advance(1);
      advance(2);
      tokens.push({ type: "comment", value: src.slice(start, i), line: sl, col: sc, start, end: i });
      continue;
    }
    // 字符串 / 模板字符串
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const start = i;
      advance(1);
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") advance(2);
        else advance(1);
      }
      advance(1);
      tokens.push({ type: "string", value: src.slice(start, i), line: sl, col: sc, start, end: i });
      continue;
    }
    // 数字
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const start = i;
      while (i < n && /[0-9._a-fA-FxXoObBeE]/.test(src[i])) {
        // 处理指数符号
        if ((src[i] === "e" || src[i] === "E") && (src[i + 1] === "+" || src[i + 1] === "-")) {
          advance(1);
        }
        advance(1);
      }
      const value = src.slice(start, i);
      tokens.push({ type: "num", value, line: sl, col: sc, start, end: i });
      continue;
    }
    // 标识符
    if (/[A-Za-z_$]/.test(c)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_$]/.test(src[i])) advance(1);
      tokens.push({ type: "ident", value: src.slice(start, i), line: sl, col: sc, start, end: i });
      continue;
    }
    // 符号
    advance(1);
    tokens.push({ type: "punct", value: c, line: sl, col: sc, start: i - 1, end: i });
  }
  return tokens;
}

/**
 * 判断某个数字 token 是否处于几何上下文。
 * 做法：向前收集当前表达式窗口（遇到 , ; { } 等深度 0 边界停止），
 *       再判断窗口形态：`key: N` / `X = ... N` / 与几何标识符同表达式。
 */
function classify(tokens, idx) {
  const value = Number(tokens[idx].value);
  if (!Number.isFinite(value)) return null;

  const win = []; // 逆序收集，win[0] 紧邻数字左侧
  let depth = 0;
  for (let j = idx - 1; j >= 0; j -= 1) {
    const t = tokens[j];
    if (t.type === "comment") continue;
    if (t.type === "punct") {
      if (t.value === ")" || t.value === "]" || t.value === "}") {
        depth += 1;
        continue;
      }
      if (t.value === "(" || t.value === "[" || t.value === "{") {
        if (depth === 0) break;
        depth -= 1;
        continue;
      }
      if (depth === 0 && (t.value === "," || t.value === ";")) break;
    }
    if (depth > 0) continue;
    win.push(t);
  }
  if (win[0]?.type === "punct" && win[0].value === ":" && win[1]?.type === "ident") {
    const key = win[1].value;
    return GEOM_KEYS.has(key)
      ? {
          key,
          reason: `几何属性 ${key} 直接写了字面量`,
          advice: `把 ${value} 提到 variables/（tokens.ts 或 layout.ts）定义成命名常量，这里改为引用该常量`,
        }
      : null;
  }
  const eq = win.findIndex((t) => t.type === "punct" && t.value === "=");
  if (eq > 0 && win[eq + 1]?.type === "ident" && GEOM_VAR_RE.test(win[eq + 1].value)) {
    return {
      key: win[eq + 1].value,
      reason: `几何变量 ${win[eq + 1].value} 的初始化里含字面量`,
      advice: `把 ${value} 提到 variables/ 定义成命名常量，再参与计算`,
    };
  }
  const geom = win.find((t) => t.type === "ident" && GEOM_VAR_RE.test(t.value));
  if (geom) {
    return {
      key: geom.value,
      reason: `与几何标识符 ${geom.value} 书写在同一表达式里`,
      advice: `把 ${value} 提到 variables/ 定义成命名常量；即使是「就调一点点」的小值也不例外`,
    };
  }
  return null;
}

/**
 * 扫描一段源码，返回违规列表。
 * @param {string} src
 * @param {string} file
 * @returns {{file:string,line:number,col:number,value:number,reason:string,snippet:string}[]}
 */
export function lintSource(src, file = "<inline>") {
  // 变量定义处本来就允许写字面量：variables/ 整文件白名单豁免
  if (/(^|[\\/])variables[\\/]/.test(file)) return [];
  const tokens = tokenize(src);
  const lines = src.split("\n");
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type !== "num") continue;
    const v = Number(t.value);
    if (v === 0 || v === 1) continue;
    if (!Number.isFinite(v)) continue;
    const hit = classify(tokens, i);
    if (!hit) continue;
    out.push({
      file,
      line: t.line,
      col: t.col,
      value: v,
      reason: hit.reason,
      snippet: (lines[t.line - 1] ?? "").trim(),
      // 错误信息本身承担规范传导职责：看到报错就知道怎么修，不用回头翻 SKILL.md
      advice: hit.advice,
    });
  }
  return out;
}

/** 对项目执行 lint，返回违规列表。 */
export function lintProject(projectDir, { extraDirs = [] } = {}) {
  const roots = [
    path.join(projectDir, "src", "layout"),
    path.join(projectDir, "src", "serializers"),
    ...extraDirs,
  ];
  const files = roots.flatMap((d) => listFiles(d)).filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f));
  return files.flatMap((f) => lintSource(fs.readFileSync(f, "utf8"), path.relative(process.cwd(), f)));
}

export function formatViolations(list) {
  return list
    .map(
      (v) =>
        `  ${v.file}:${v.line}:${v.col}  几何裸字面量 ${v.value}\n` +
        `      位置：${v.snippet}\n` +
        `      原因：${v.reason}\n` +
        `      改法：${v.advice}`,
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// ESLint 自定义规则（可插拔）。零依赖：只读取源码文本。
// ---------------------------------------------------------------------------
export const rules = {
  "no-geometry-literals": {
    meta: {
      type: "problem",
      docs: { description: "禁止在布局计算中出现几何裸字面量（0/1 豁免）" },
      schema: [],
      messages: {
        bare:
          "几何裸字面量 {{value}}：{{reason}}。\n改法：{{advice}}\n" +
          "（layout/ 与 serializers/ 里不写字面量；variables/ 定义处已白名单豁免）",
      },
    },
    create(context) {
      const text = context.sourceCode?.text ?? context.getSourceCode().text;
      const filename = context.filename ?? context.getFilename();
      return {
        Program() {
          for (const v of lintSource(text, filename)) {
            context.report({
              loc: { line: v.line, column: v.col - 1 },
              messageId: "bare",
              data: { value: String(v.value), reason: v.reason, advice: v.advice ?? "" },
            });
          }
        },
      };
    },
  },
};

async function main() {
  const args = parseArgs(process.argv.slice(2), { project: ".", scope: null, _: [] });
  const files = args._;
  const missing = files.filter((f) => !fs.existsSync(f));
  if (missing.length) {
    console.error(`lint-geometry 失败：找不到文件 ${missing.join(", ")}`);
    process.exit(1);
  }
  const violations = files.length
    ? files.flatMap((f) => lintSource(fs.readFileSync(f, "utf8"), f))
    : lintProject(path.resolve(args.project));
  if (violations.length) {
    console.error(
      `lint-geometry 失败：发现 ${violations.length} 处几何裸字面量\n${formatViolations(violations)}\n\n` +
        "规则：所有几何数字必须来自 variables/，没有例外（0 与 1 作为贴边基准与序号步长豁免）。",
    );
    process.exit(1);
  }
  console.log("✓ lint-geometry 通过：布局计算中无几何裸字面量");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
