#!/usr/bin/env node
/**
 * serializer: drawio_cli — 调用 draw.io Desktop 官方 CLI 导出 PNG / SVG / PDF。
 *
 * 与 drawio_png.py 的分工（两者都保留，互不替代）：
 *   - drawio_png.py：纯 Python（Pillow）解析我们产出的 XML 直接栅格化，
 *     **不依赖本机装 draw.io**，是默认的 PNG 交付通道；
 *   - drawio_cli.mjs（本文件）：调用官方渲染器，可额外导出 SVG / PDF，
 *     并用 `--embed-diagram` 把图表 XML 内嵌进导出文件（导出物仍可回 draw.io 编辑）。
 *
 * 铁律：几何与配色仍来自 Layout Tree，本文件**不生成任何几何**——它只把已经
 * 由 drawio.mjs 写好的 `.drawio` 交给官方 CLI，属于「导出」而不是「第二条渲染路径」。
 *
 * 无 CLI 时优雅降级：默认打印指引并跳过（exit 0），因为 PNG 通道依然可用；
 * 需要强制失败时加 `--require`。安装指引见 references/install-drawio.md。
 *
 * 用法：
 *   node scripts/serializers/drawio_cli.mjs --project <dir> [--format png,svg,pdf]
 *   node scripts/serializers/drawio_cli.mjs --check          # 只报告 CLI 是否可用
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { previewPath } from "./gate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(HERE, "..", "..");

/** 各平台常见的 draw.io Desktop CLI 位置（先 PATH，后绝对路径）。 */
export const CLI_CANDIDATES = [
  { cmd: "drawio", args: [] },
  { cmd: "/Applications/draw.io.app/Contents/MacOS/draw.io", args: [] },
  { cmd: "C:\\Program Files\\draw.io\\draw.io.exe", args: [] },
  { cmd: "/snap/bin/drawio", args: [] },
  { cmd: "draw.io", args: [] },
];

/** 支持导出并内嵌 XML 的格式；jpg 有损且不支持 --embed-diagram。 */
const EMBED_FORMATS = new Set(["png", "svg", "pdf"]);

/**
 * 找到可用的 draw.io CLI。
 * @returns {{cmd:string}|null}
 */
export function findDrawioCli(candidates = CLI_CANDIDATES) {
  for (const c of candidates) {
    // 绝对路径：直接检查可执行文件
    if (c.cmd.includes("/") || c.cmd.includes("\\")) {
      if (fs.existsSync(c.cmd)) return c;
      continue;
    }
    const which = spawnSync(process.platform === "win32" ? "where" : "which", [c.cmd], { encoding: "utf8" });
    if (which.status === 0 && which.stdout.trim()) return c;
  }
  return null;
}

function parse(argv) {
  const a = { project: ".", out: null, format: "png,svg", allow: false, require: false, check: false, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--project") a.project = argv[++i];
    else if (argv[i] === "--out") a.out = argv[++i];
    else if (argv[i] === "--format") a.format = argv[++i];
    else if (argv[i] === "--scope") a.scope = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === "--allow-unconfirmed") a.allow = true;
    else if (argv[i] === "--require") a.require = true;
    else if (argv[i] === "--check") a.check = true;
    else if (argv[i] === "--quiet") a.quiet = true;
    else if (argv[i] === "-h" || argv[i] === "--help") a.help = true;
    else throw new Error(`未知参数: ${argv[i]}`);
  }
  return a;
}

function usage() {
  console.log("用法: node scripts/serializers/drawio_cli.mjs --project <dir> [--format png,svg,pdf]");
  console.log("      node scripts/serializers/drawio_cli.mjs --check");
  console.log("说明: 需要本机安装 draw.io Desktop；缺失时默认跳过（PNG 仍可用 drawio_png.py）。");
  console.log("      安装指引见 references/install-drawio.md。");
}

export function main(argv = process.argv.slice(2)) {
  const a = parse(argv);
  if (a.help) {
    usage();
    return 0;
  }
  const cli = findDrawioCli();
  if (a.check) {
    if (cli) console.log(`✓ 找到 draw.io CLI: ${cli.cmd}`);
    else {
      console.log("· 未找到 draw.io Desktop CLI（详见 references/install-drawio.md）");
      process.exitCode = a.require ? 1 : 0;
    }
    return 0;
  }

  if (!cli) {
    console.log(
      "· drawio_cli 跳过：未找到 draw.io Desktop CLI。\n" +
        "  PNG 通道不受影响（drawio_png.py 不依赖 draw.io）；如需 SVG/PDF 或官方渲染，请按\n" +
        "  references/install-drawio.md 安装后重试。",
    );
    if (a.require) {
      console.error("✗ --require 已指定，但 CLI 不可用。");
      process.exitCode = 1;
    }
    return 0;
  }

  const project = path.resolve(a.project);
  const drawioDir = path.join(project, "drawio");
  if (!fs.existsSync(drawioDir)) {
    console.log(`· drawio_cli 跳过：${path.relative(process.cwd(), drawioDir)} 下没有 .drawio（先渲染 --target drawio）`);
    return 0;
  }
  const files = fs
    .readdirSync(drawioDir)
    .filter((f) => f.endsWith(".drawio"))
    .filter((f) => !a.scope || a.scope.includes(f.replace(/\.drawio$/, "")))
    .map((f) => path.join(drawioDir, f));
  if (!files.length) {
    console.log("· drawio_cli 跳过：没有匹配交付范围的 .drawio");
    return 0;
  }

  // 导出同样受确认闸门管辖：未确认不放行（除非 --allow-unconfirmed）
  if (!a.allow) {
    const gate = spawnSync(
      process.execPath,
      [path.join(HERE, "..", "..", "..", "layout", "scripts", "validate", "check-confirmation.mjs"), "--project", project, "--mode", "static",
       ...(a.scope ? ["--scope", a.scope.join(",")] : [])],
      { stdio: "inherit" },
    );
    if (gate.status !== 0) {
      console.error("✗ drawio_cli 被阻断：确认节点 B 未通过。");
      process.exitCode = 1;
      return 0;
    }
  } else {
    console.warn("渲染警告：--allow-unconfirmed 已跳过确认闸门（mode=static）。交付前必须人工确认。");
  }

  const outDir = path.resolve(a.out ?? path.join(project, "drawio", "export"));
  fs.mkdirSync(outDir, { recursive: true });
  const formats = a.format.split(",").map((s) => s.trim()).filter(Boolean);
  let failed = 0;
  for (const file of files) {
    const bp = path.basename(file, ".drawio");
    for (const fmt of formats) {
      const embed = EMBED_FORMATS.has(fmt);
      const out = previewPath(path.join(outDir, `${bp}.drawio.${fmt}`), a.allow);
      const args = ["-x", "-f", fmt, ...(embed ? ["-e"] : []), "-b", "10", "-o", out, file];
      const r = spawnSync(cli.cmd, args, { stdio: "pipe", encoding: "utf8" });
      const ok = r.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 0;
      if (!ok) {
        failed += 1;
        console.error(`✗ ${bp}.${fmt} 导出失败：${(r.stderr || r.stdout || "").trim().split("\n").pop()}`);
      } else if (!a.quiet) {
        console.log(`✓ drawio-cli ${bp.padEnd(10)} ${path.relative(project, out)}${embed ? " (内嵌 XML)" : ""}`);
      }
    }
  }
  if (failed) process.exitCode = 1;
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main();
  } catch (e) {
    console.error(e?.message ?? String(e));
    process.exit(1);
  }
}
