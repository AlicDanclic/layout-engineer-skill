#!/usr/bin/env node
/**
 * new-project — 从模板脚手架一个 layout-engineer 项目（工作流第 ①② 步之后的落地）。
 *
 * 用法：
 *   node scripts/new-project.mjs --name landing --out output/ --title "产品落地页"
 *
 * 产物（<out>/<name>/）：
 *   variables/ tokens.ts + layout.ts（含四行注释样板）
 *   src/layout/index.ts（可运行骨架）
 *   vendor/layout-engine/（Layout Tree 构建工具副本）
 *   layout-tree/ positioning/ preview/ assets/ docs/
 *   package.json + package-lock.json + .nvmrc + storyboard.json
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(HERE, "..");

function parseArgs(argv) {
  const a = { out: "output", title: null, force: false, kind: "layout", view: null, theme: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--name") a.name = argv[++i];
    else if (argv[i] === "--out") a.out = argv[++i];
    else if (argv[i] === "--title") a.title = argv[++i];
    else if (argv[i] === "--kind") a.kind = argv[++i];
    else if (argv[i] === "--view") a.view = argv[++i];
    else if (argv[i] === "--theme") a.theme = argv[++i];
    else if (argv[i] === "--list-themes") a.listThemes = true;
    else if (argv[i] === "--force") a.force = true;
    else if (argv[i] === "-h" || argv[i] === "--help") a.help = true;
    else throw new Error(`未知参数: ${argv[i]}`);
  }
  return a;
}

/** 可用的主题预设（layout/templates/themes/<name>.tokens.ts）。 */
export function listThemes() {
  const dir = path.join(SKILL_ROOT, "layout", "templates", "themes");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".tokens.ts"))
    .map((f) => f.slice(0, -".tokens.ts".length));
}

function copyTree(src, dest, ctx) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const isTpl = e.name.endsWith(".tpl");
    const name = isTpl ? e.name.slice(0, -4) : e.name;
    const d = path.join(dest, name);
    if (e.isDirectory()) {
      copyTree(s, d, ctx);
    } else if (isTpl) {
      let text = fs.readFileSync(s, "utf8");
      for (const [k, v] of Object.entries(ctx)) text = text.split(`{{${k}}}`).join(v);
      fs.writeFileSync(d, text);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

export function newProject({ name, out = "output", title = null, force = false, kind = "layout", view = null, theme = null }) {
  if (!name) throw new Error("必须提供 --name");
  const isDrawio = kind === "drawio";
  if (theme) {
    if (isDrawio) throw new Error("--theme 只适用于普通项目（drawio 架构图用 DRAWIO 中国色板，自成一套）");
    if (!listThemes().includes(theme)) {
      throw new Error(`未知主题: ${theme}（可用：${["default", ...listThemes()].join(" / ")}）`);
    }
  }
  const viewName = view ?? (isDrawio ? "canvas" : "landing");
  if (isDrawio && !/^[a-z][a-z0-9-]*$/.test(viewName)) {
    throw new Error(`--view 非法: ${viewName}（须匹配 /^[a-z][a-z0-9-]*$/，如 cli / gui / hardware / hwsync）`);
  }
  const outDir = path.resolve(out);
  const projectDir = path.join(outDir, name);
  if (fs.existsSync(projectDir)) {
    if (!force) throw new Error(`目录已存在: ${projectDir}（加 --force 覆盖）`);
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
  const skillRel = path.relative(projectDir, SKILL_ROOT) || ".";
  const ctx = {
    PROJECT_NAME: name,
    PROJECT_TITLE: title ?? name,
    SKILL_REL: skillRel,
    VIEW: viewName,
    VIEW_JSON: JSON.stringify(viewName),
  };

  // drawio 项目用绘制层模板；普通项目用计算层模板
  const tplDir = isDrawio
    ? path.join(SKILL_ROOT, "drawio", "templates", "drawio")
    : path.join(SKILL_ROOT, "layout", "templates", "project");
  copyTree(tplDir, projectDir, ctx);
  const varSrc = isDrawio
    ? path.join(SKILL_ROOT, "drawio", "templates", "drawio", "variables")
    : path.join(SKILL_ROOT, "layout", "templates", "variables");
  fs.mkdirSync(path.join(projectDir, "variables"), { recursive: true });
  for (const f of ["tokens.ts", "layout.ts"]) {
    let text = fs.readFileSync(path.join(varSrc, `${f}.tpl`), "utf8");
    for (const [k, v] of Object.entries(ctx)) text = text.split(`{{${k}}}`).join(v);
    fs.writeFileSync(path.join(projectDir, "variables", f), text);
  }
  // 主题预设：成套覆盖 tokens.ts（用户在【参数确认】选定的视觉起点，之后仍只动 token 微调）
  if (theme) {
    const themeFile = path.join(SKILL_ROOT, "layout", "templates", "themes", `${theme}.tokens.ts`);
    let text = fs.readFileSync(themeFile, "utf8");
    for (const [k, v] of Object.entries(ctx)) text = text.split(`{{${k}}}`).join(v);
    fs.writeFileSync(path.join(projectDir, "variables", "tokens.ts"), text);
  }

  // vendor：把布局构建工具复制进项目，保证项目自包含（来自计算层）
  copyTree(path.join(SKILL_ROOT, "layout", "scripts", "layout-engine"), path.join(projectDir, "vendor", "layout-engine"), ctx);

  const dirs = isDrawio
    ? ["layout-tree", "positioning/storyboard", "drawio", "assets", "docs"]
    : ["layout-tree", "positioning/storyboard", "preview", "assets", "docs"];
  for (const d of dirs) fs.mkdirSync(path.join(projectDir, d), { recursive: true });

  // 锁文件（零依赖项目也能通过 check-env）
  const lock = path.join(projectDir, "package-lock.json");
  if (!fs.existsSync(lock)) {
    const r = spawnSync("npm", ["install", "--package-lock-only", "--silent", "--no-audit", "--no-fund"], {
      cwd: projectDir,
      stdio: "ignore",
    });
    if (r.status !== 0 || !fs.existsSync(lock)) {
      fs.writeFileSync(
        lock,
        JSON.stringify(
          { name, version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name, version: "1.0.0" } } },
          null,
          2,
        ) + "\n",
      );
    }
  }

  return projectDir;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.listThemes) {
    console.log(`可用主题预设：${["default（克莱因蓝）", ...listThemes()].join(" / ")}`);
    console.log("用法：node scripts/new-project.mjs --name <name> --theme <主题名>");
    return;
  }
  if (args.help || !args.name) {
    console.log('用法: node scripts/new-project.mjs --name <name> [--out output] [--title "标题"] [--theme <主题>]');
    console.log('      node scripts/new-project.mjs --name <name> --kind drawio --view <view> [--title "标题"]');
    console.log("      视图（--view）由用户确认，没有默认值可依赖：cli / gui / hardware / hwsync 等");
    console.log("      主题（--theme）见 --list-themes；视觉起点由用户在【参数确认】选定");
    return;
  }
  const dir = newProject(args);
  console.log(`✓ 已创建项目: ${path.relative(process.cwd(), dir)}`);
  console.log("下一步：");
  console.log(`  1. 编辑 ${path.join(path.relative(process.cwd(), dir), "src/layout/index.ts")} 与 variables/`);
  console.log(`  2. node layout/scripts/build-tree.mjs --project ${path.relative(process.cwd(), dir)}`);
  console.log(`  3. node layout/scripts/positioning-viewer/serve.mjs --project ${path.relative(process.cwd(), dir)}`);
  console.log(`  4. node layout/scripts/validate/run-all.mjs --project ${path.relative(process.cwd(), dir)}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
