#!/usr/bin/env node
/**
 * serializers/index — 渲染分发器（工作流第 ⑥ 步）。
 *
 * 用法：
 *   node scripts/serializers/index.mjs --project <dir> --target react,remotion,preview
 *   node scripts/serializers/index.mjs --project <dir> --target all
 *
 * 渲染前强制检查确认节点 B（positioning/confirmation.json 必须存在且与当前
 * layout-tree 指纹一致）。CI / 示例可用 --allow-unconfirmed 跳过。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TARGETS = {
  react: { script: "react.mjs" },
  remotion: { script: "remotion.mjs" },
  preview: { script: "preview.mjs" },
  drawio: { script: "drawio.mjs" },
  // 官方 CLI 导出（可选）：PNG/SVG/PDF，--embed-diagram。缺 CLI 时自动降级跳过。
  "drawio-cli": { script: "drawio_cli.mjs" },
};

function main() {
  const argv = process.argv.slice(2);
  const pi = argv.indexOf("--project");
  const project = path.resolve(pi >= 0 ? argv[pi + 1] : ".");
  const ti = argv.indexOf("--target");
  const raw = ti >= 0 ? argv[ti + 1] : "all";
  const names = raw === "all" ? Object.keys(TARGETS) : raw.split(",").map((s) => s.trim());
  // 交付范围：缺省表示全部断点
  const si = argv.indexOf("--scope");
  const scope = si >= 0 ? argv[si + 1].split(",").map((s) => s.trim()).filter(Boolean) : null;

  // ── 渲染前置闸门：读文件，不读对话 ──
  const gate = (mode, hint) => {
    if (argv.includes("--allow-unconfirmed")) return;
    const r = spawnSync(
      process.execPath,
      [path.join(HERE, "..", "..", "..", "layout", "scripts", "validate", "check-confirmation.mjs"), "--project", project, "--mode", mode,
       ...(scope ? ["--scope", scope.join(",")] : [])],
      { stdio: "inherit" },
    );
    if (r.status !== 0) {
      console.error(`\n✗ 渲染被阻断：${mode === "static" ? "确认节点 B" : "关键帧 Storyboard 确认"} 未通过。`);
      console.error(hint);
      console.error("  CI / 示例归档可加 --allow-unconfirmed 跳过（会打印警告）。");
      process.exit(1);
    }
  };

  if (names.includes("react") || names.includes("preview") || names.includes("drawio") || names.includes("drawio-cli")) {
    gate(
      "static",
      `  请在定位查看器中由用户点击「确认布局」：\n    node scripts/positioning-viewer/serve.mjs --project ${path.relative(process.cwd(), project)}`,
    );
  }
  if (names.includes("remotion")) {
    gate(
      "storyboard",
      `  请让用户确认关键帧后执行：\n    node scripts/confirm.mjs --project ${path.relative(process.cwd(), project)} --node storyboard --source user-chat`,
    );
  }

  for (const n of names) {
    const t = TARGETS[n];
    if (!t) throw new Error(`未知 target: ${n}（可选 ${Object.keys(TARGETS).join(" / ")} / all）`);
    const childArgs = [path.join(HERE, t.script), "--project", project];
    if (argv.includes("--allow-unconfirmed")) childArgs.push("--allow-unconfirmed");
    if (scope) childArgs.push("--scope", scope.join(","));
    const r = spawnSync(process.execPath, childArgs, { stdio: "inherit" });
    if (r.status !== 0) {
      console.error(`✗ 序列化失败: ${n} (${t.script})`);
      process.exit(1);
    }
  }
  console.log(`✓ serializers: ${names.join(", ")}`);
}

main();
