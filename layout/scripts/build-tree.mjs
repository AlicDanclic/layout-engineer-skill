#!/usr/bin/env node
/**
 * build-tree — 调用项目的纯函数布局计算模块，产出并归档双端 Layout Tree。
 *
 * 用法：
 *   node scripts/build-tree.mjs --project <projectDir> [--out <layoutTreeDir>]
 *
 * 约定：<projectDir>/src/layout/index.ts 必须导出 buildLayout(breakpoint)。
 * 本脚本同时执行纯函数性检查：同一输入连续计算两次，序列化结果必须完全一致。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { serializeTree } from "./layout-engine/builder.mjs";
import { assertLayoutTree } from "./layout-engine/schema.mjs";
import { ensureDir } from "./layout-engine/io.mjs";

const DEFAULT_BREAKPOINTS = ["desktop", "mobile"];

/**
 * 读取项目配置 `layout.config.json`（可选）。
 *
 *   { "kind": "layout" | "drawio", "breakpoints": ["desktop","mobile"] }
 *
 * 为什么需要它：drawio 架构图是**单画布**产物（一个视图 = 一个项目），
 * 强行产出 desktop + mobile 两棵没有意义的树。缺省仍为双断点，不影响旧项目。
 */
export function readLayoutConfig(projectDir) {
  const file = path.join(projectDir, "layout.config.json");
  if (!fs.existsSync(file)) return { kind: "layout", breakpoints: [...DEFAULT_BREAKPOINTS] };
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`layout.config.json 不是合法 JSON: ${e.message}`);
  }
  const kind = cfg.kind === "drawio" ? "drawio" : "layout";
  const bps = Array.isArray(cfg.breakpoints) && cfg.breakpoints.length ? cfg.breakpoints.map(String) : null;
  for (const bp of bps ?? []) {
    if (!/^[a-z][a-z0-9-]*$/.test(bp)) throw new Error(`layout.config.json 的断点名非法: ${bp}`);
  }
  return { kind, breakpoints: bps ?? [...DEFAULT_BREAKPOINTS] };
}

function parseArgs(argv) {
  const args = { project: ".", out: null, breakpoints: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--project") args.project = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--breakpoints") args.breakpoints = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === "-h" || argv[i] === "--help") args.help = true;
    else throw new Error(`未知参数: ${argv[i]}`);
  }
  return args;
}

export async function buildTrees(projectDir, { breakpoints = null } = {}) {
  const entry = path.join(projectDir, "src", "layout", "index.ts");
  if (!fs.existsSync(entry)) {
    throw new Error(`找不到布局计算入口: ${entry}`);
  }
  const mod = await import(pathToFileURL(entry).href);
  const buildLayout = mod.buildLayout ?? mod.default;
  if (typeof buildLayout !== "function") {
    throw new Error(`${entry} 必须导出 buildLayout(breakpoint)`);
  }

  const list = breakpoints ?? readLayoutConfig(projectDir).breakpoints;
  const trees = {};
  for (const bp of list) {
    const first = buildLayout(bp);
    assertLayoutTree(first, `buildLayout("${bp}")`);
    const second = buildLayout(bp);
    if (serializeTree(first) !== serializeTree(second)) {
      throw new Error(
        `buildLayout("${bp}") 不是纯函数：连续两次计算结果不一致（存在随机数、时间依赖或可变状态）`,
      );
    }
    trees[bp] = first;
  }
  return trees;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("用法: node scripts/build-tree.mjs --project <projectDir> [--out <dir>] [--breakpoints desktop,mobile]");
    return;
  }
  const projectDir = path.resolve(args.project);
  const outDir = path.resolve(args.out ?? path.join(projectDir, "layout-tree"));
  ensureDir(outDir);
  const trees = await buildTrees(projectDir, { breakpoints: args.breakpoints });
  for (const [bp, t] of Object.entries(trees)) {
    const file = path.join(outDir, `${bp}.json`);
    fs.writeFileSync(file, serializeTree(t));
    const edges = t.edges?.length ? `  ${t.edges.length} 条连线` : "";
    console.log(`✓ ${bp.padEnd(7)} ${t.canvas.w}×${t.canvas.h}${edges}  ${path.relative(process.cwd(), file)}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(`build-tree 失败: ${e.message}`);
    process.exit(1);
  });
}
