#!/usr/bin/env node
/**
 * run-all — 验证层总入口（规范六 / 第 6 节）。
 *
 * 依次执行：lint-geometry → assert-layout → verify-positioning → check-env
 *          → indexer → check-confirmation → check-drawio → docgen
 *
 * --allow-unconfirmed 会跳过确认门（仅供 CI / 自动化；交付前必须人工确认）
 * --scope desktop,mobile 收窄本次交付范围（默认全部断点）
 * 任一步失败即中止，退出码非 0，AI 无权跳过。
 *
 * 用法：node scripts/validate/run-all.mjs --project <dir>
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(HERE, ".."); // layout/scripts

const STEPS = [
  { name: "lint-geometry", cmd: "validate/lint-geometry.mjs" },
  { name: "assert-layout", cmd: "validate/assert-layout.mjs" },
  { name: "verify-positioning", cmd: "validate/verify-positioning.mjs" },
  { name: "check-env", cmd: "validate/check-env.mjs" },
  // 先刷新 manifest（含 confirmations 聚合视图），再走确认闸门读它
  { name: "indexer", cmd: "indexer.mjs" },
  { name: "check-confirmation", cmd: "validate/check-confirmation.mjs" },
  { name: "check-drawio", cmd: "../../drawio/scripts/validate/check-drawio.mjs" },
  { name: "docgen", cmd: "docgen.mjs" },
];

function main() {
  const argv = process.argv.slice(2);
  const pi = argv.indexOf("--project");
  const project = path.resolve(pi >= 0 ? argv[pi + 1] : ".");
  const allowUnconfirmed = argv.includes("--allow-unconfirmed");
  const si = argv.indexOf("--scope");
  const scope = si >= 0 ? argv[si + 1] : null;
  const failed = [];

  if (allowUnconfirmed) {
    console.warn("run-all 警告：--allow-unconfirmed 已跳过确认节点 B（仅供 CI / 自动化，交付前必须人工确认）\n");
  }

  for (const step of STEPS) {
    if (step.name === "check-confirmation" && allowUnconfirmed) continue;
    const args = [path.join(SCRIPTS, step.cmd), "--project", project];
    if (scope && (step.name === "check-confirmation" || step.name === "indexer")) args.push("--scope", scope);
    const r = spawnSync(process.execPath, args, { stdio: "inherit" });
    if (r.status !== 0) {
      failed.push(step.name);
      console.error(`\n✗ 验证中止于 ${step.name}。后续步骤未执行，禁止进入最终渲染。`);
      process.exit(1);
    }
  }

  console.log(`\n✓ 验证层全部通过（${STEPS.length} 项）：${STEPS.map((s) => s.name).join(" / ")}`);
}

main();
