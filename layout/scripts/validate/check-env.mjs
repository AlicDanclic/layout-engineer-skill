/**
 * check-env — 环境隔离校验（规范四）。
 *
 * 校验：
 *   - Node 项目：.nvmrc 存在且主版本与当前运行时一致；存在锁文件；
 *     若 package.json 声明了依赖，则必须存在项目级 node_modules。
 *   - Python 辅助脚本：存在 .venv。
 *   - 全局安装检测（v1，软约束）：读 manifest.json 的 `globalInstall` 自报字段；
 *     同时扫描安装日志与 package.json 脚本中的 -g / --global 作为佐证。
 *     v1.1 计划：提供包装过的 npm/pnpm/pip 命令做审计，把它变成硬约束。
 *
 * 用法：node scripts/validate/check-env.mjs --project <dir>
 */
import fs from "node:fs";
import path from "node:path";
import { listFiles } from "../layout-engine/io.mjs";

const LOCKS = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock"];

function parseArgs(argv) {
  const a = { project: "." };
  for (let i = 0; i < argv.length; i += 1) if (argv[i] === "--project") a.project = argv[++i];
  return a;
}

function readIf(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** 扫描文本中是否存在全局安装行为。 */
export function findGlobalInstalls(text, label) {
  const hits = [];
  const lines = text.split("\n");
  const re = /(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|add\s+-g|install\s+-g)\b[^\n]*?(?:\s-g\b|\s--global\b)/;
  lines.forEach((line, i) => {
    if (re.test(line)) hits.push(`${label}:${i + 1}  ${line.trim()}`);
  });
  return hits;
}

export function checkEnv(projectDir) {
  const errors = [];
  const warnings = [];
  const project = path.resolve(projectDir);

  const pkgPath = path.join(project, "package.json");
  const isNode = fs.existsSync(pkgPath);

  if (isNode) {
    // .nvmrc
    const nvmrcPath = path.join(project, ".nvmrc");
    if (!fs.existsSync(nvmrcPath)) {
      errors.push("Node 项目缺少 .nvmrc（必须写明主版本，如 20）");
    } else {
      const want = readIf(nvmrcPath).trim().replace(/^v/, "").split(".")[0];
      const have = process.versions.node.split(".")[0];
      if (want && want !== have && !/^(lts|node)$/i.test(want)) {
        warnings.push(`.nvmrc 要求 Node ${want}，当前运行 Node ${have}`);
      }
    }

    // 锁文件
    if (!LOCKS.some((l) => fs.existsSync(path.join(project, l)))) {
      errors.push(`缺少锁文件（需其一：${LOCKS.join(" / ")}）`);
    }

    // node_modules（仅当声明了依赖）
    const pkg = JSON.parse(readIf(pkgPath) ?? "{}");
    const depCount = Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length;
    if (depCount > 0 && !fs.existsSync(path.join(project, "node_modules"))) {
      errors.push(`package.json 声明了 ${depCount} 个依赖，但项目级 node_modules 不存在`);
    }

    // package.json 脚本中的全局安装
    for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
      for (const hit of findGlobalInstalls(String(cmd), `package.json scripts.${name}`)) errors.push(hit);
    }
  }

  // Python
  const hasPy =
    fs.existsSync(path.join(project, "requirements.txt")) ||
    fs.existsSync(path.join(project, "pyproject.toml")) ||
    listFiles(project).some((f) => f.endsWith(".py"));
  if (hasPy && !fs.existsSync(path.join(project, ".venv"))) {
    errors.push("检测到 Python 代码，但缺少项目级 .venv");
  }

  // 全局安装（v1：manifest 自报 + 日志佐证）
  const manifestPath = path.join(project, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(readIf(manifestPath) ?? "{}");
    if (manifest.globalInstall === true) {
      errors.push("manifest.globalInstall = true：项目自报发生过全局安装，禁止交付");
    } else if (manifest.globalInstall === undefined) {
      warnings.push("manifest.json 缺少 globalInstall 自报字段（v1 依赖它判定全局安装，请运行 indexer 生成）");
    }
  } else {
    warnings.push("缺少 manifest.json，无法读取 globalInstall 自报字段（请先运行 indexer）");
  }

  // 安装日志
  const logs = listFiles(project).filter((f) => /(install|npm|pip|setup)[^/]*\.log$/i.test(f));
  for (const log of logs) {
    for (const hit of findGlobalInstalls(readIf(log) ?? "", path.relative(project, log))) errors.push(hit);
  }

  return { errors, warnings, isNode, hasPy };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { errors, warnings } = checkEnv(args.project);
  if (warnings.length) console.warn(`check-env 警告：\n  - ${warnings.join("\n  - ")}`);
  if (errors.length) {
    console.error(`check-env 失败：${errors.length} 项\n  - ${errors.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("✓ check-env 通过：环境隔离合规，未发现全局安装行为");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
