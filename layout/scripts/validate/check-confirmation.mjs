#!/usr/bin/env node
/**
 * check-confirmation — 确认闸门（验证层，静态度）。
 *
 * 把 SKILL.md 里「未经确认禁止渲染」从软约束变成硬闸门：
 * 序列化器运行前第一步就检查这里，不通过直接抛错退出，AI 绕不过去。
 *
 * 两种模式（视频与静态产物分开闸门）：
 *   --mode static（默认）：结构确认 + 每个断点的定位确认（指纹与当前 layout-tree 一致）
 *   --mode storyboard    ：关键帧确认（时间轴指纹与当前 timeline.json 一致）
 *   --scope desktop,mobile：本次交付范围。默认全部断点；显式收窄后，范围外的断点不参与判定
 *
 * 用法：
 *   node scripts/validate/check-confirmation.mjs --project <dir> [--mode static|storyboard]
 *   node scripts/validate/check-confirmation.mjs --project <dir> --write-fixture   # CI / 示例归档
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { listTrees, readJson, ensureDir } from "../layout-engine/io.mjs";
import { hashLayoutTree, HASH_VERSION } from "../layout-engine/hash.mjs";
import { renderSvg } from "../positioning-viewer/render-core.mjs";
import { upsertRecord, listRecords, writeConfirmations } from "../layout-engine/confirm-store.mjs";
import { parseArgs, splitList } from "../layout-engine/cli.mjs";

const HUMAN_SOURCES = new Set(["viewer-ui", "user-chat"]);

/** 关键帧时间轴的指纹（与静态产物的布局指纹分开）。 */
function hashTimeline(projectDir) {
  const file = path.join(path.resolve(projectDir), "positioning", "storyboard", "timeline.json");
  if (!fs.existsSync(file)) return null;
  return "sha256:" + crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 32);
}

/** 写一份「夹具确认」：CI 与示例归档用，来源明确标记为 fixture。 */
export function writeFixtureConfirmation(projectDir, { options = {} } = {}) {
  const project = path.resolve(projectDir);
  const trees = listTrees(path.join(project, "layout-tree"));
  if (trees.length === 0) throw new Error("layout-tree/ 下没有 Layout Tree");
  const positioningDir = path.join(project, "positioning");
  ensureDir(positioningDir);

  writeConfirmations(project, { project: path.basename(project), records: [] });
  upsertRecord(project, {
    node: "structure",
    source: "fixture",
    note: "示例归档夹具，非人工确认",
  });
  for (const [, tree] of trees) {
    const bp = tree.canvas.breakpoint;
    const svgFile = path.join(positioningDir, `confirmed-${bp}.svg`);
    fs.writeFileSync(svgFile, renderSvg(tree, { ...(options[bp] ?? {}), title: `${path.basename(project)} · ${bp} · fixture` }));
    upsertRecord(project, {
      node: "positioning",
      bp,
      hidden: [],
      source: "fixture",
      note: "示例归档夹具，非人工确认",
      treeHash: hashLayoutTree(tree),
      hashVersion: HASH_VERSION,
      svg: `positioning/confirmed-${bp}.svg`,
    });
  }
  const tl = hashTimeline(project);
  if (tl) upsertRecord(project, { node: "storyboard", source: "fixture", note: "示例归档夹具", timelineHash: tl });

  return { project: path.basename(project), records: listRecords(project) };
}

/**
 * 校验确认状态。
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function checkConfirmation(projectDir, { mode = "static", scope: providedScope = null } = {}) {
  const project = path.resolve(projectDir);
  const errors = [];
  const warnings = [];
  const records = listRecords(project);

  if (records.length === 0) {
    return {
      ok: false,
      errors: [
        "确认节点尚未完成：缺少 positioning/confirmed.json（或没有任何记录）",
        "请启动查看器由用户点击「确认布局」；结构确认用 scripts/confirm.mjs --node structure",
      ],
      warnings,
    };
  }

  for (const r of records) {
    if (!HUMAN_SOURCES.has(r.source ?? "unknown")) {
      warnings.push(`记录 ${r.node}${r.bp ? `:${r.bp}` : ""} 来源为 "${r.source}"，不是人工确认（viewer-ui / user-chat）`);
    }
  }

  if (mode === "storyboard") {
    const tl = hashTimeline(project);
    if (!tl) errors.push("缺少 positioning/storyboard/timeline.json，请先运行 storyboard");
    const rec = records.find((r) => r.node === "storyboard");
    if (!rec) errors.push("关键帧 Storyboard 尚未确认（视频闸门读它，与静态产物分开）");
    else if (rec.timelineHash !== tl) errors.push("Storyboard 确认已失效：确认后时间轴发生变化");
    return { ok: errors.length === 0, errors, warnings };
  }

  // ── static ──
  let scope = providedScope;
  if (!scope) {
    const mf = path.join(project, "manifest.json");
    if (fs.existsSync(mf)) {
      try {
        scope = readJson(mf).deliveryScope ?? null;
      } catch {
        scope = null;
      }
    }
  }
  const allTrees = listTrees(path.join(project, "layout-tree"));
  if (allTrees.length === 0) errors.push("layout-tree/ 下没有 Layout Tree，请先运行 build-tree.mjs");
  // 本次交付范围：优先级 = CLI --scope > manifest.deliveryScope > 全部断点
  const inScope = (bp) => !scope || scope.includes(bp);
  const trees = allTrees.filter(([, t]) => inScope(t.canvas.breakpoint));
  const outOfScope = allTrees.filter(([, t]) => !inScope(t.canvas.breakpoint));
  if (outOfScope.length) {
    warnings.push(
      `本次交付范围限定为 ${(scope ?? []).join(" / ")}；` +
        `${outOfScope.map(([, t]) => t.canvas.breakpoint).join(" / ")} 不在范围内，不会被渲染，其确认状态不参与判定`,
    );
  }

  if (!records.some((r) => r.node === "structure")) {
    errors.push("确认节点 A（结构）尚未确认：请用 scripts/confirm.mjs --node structure 落盘");
  }

  for (const [, tree] of trees) {
    const bp = tree.canvas.breakpoint;
    const rec = records.find((r) => r.node === "positioning" && r.bp === bp);
    if (!rec) {
      errors.push(`确认节点 B（${bp}）尚未确认`);
      continue;
    }
    const now = hashLayoutTree(tree);
    if (rec.treeHash && rec.treeHash !== now) {
      if (rec.hashVersion !== undefined && rec.hashVersion !== HASH_VERSION) {
        // 算法升级与「布局变了」是两回事，分开报，避免误导排查方向
        errors.push(
          `断点 ${bp} 的确认已失效：哈希定义已升级（记录 v${rec.hashVersion} → 当前 v${HASH_VERSION}），` +
            `几何未必变化，但按 fail-closed 原则需重新确认`,
        );
      } else {
        errors.push(`断点 ${bp} 的确认已失效：确认后 layout-tree 发生变化（记录 ${rec.treeHash} ≠ 当前 ${now}）`);
      }
    }
    const svg = path.join(project, rec.svg ?? `positioning/confirmed-${bp}.svg`);
    if (!fs.existsSync(svg)) errors.push(`断点 ${bp} 缺少已确认的定位图：${path.relative(project, svg)}`);
  }

  // manifest.confirmations 是聚合视图，闸门读它；这里保证两者一致
  // （单画布项目如 drawio 的 gitviz-gui 也走 positioning[bp] 这一个映射）
  const manifestPath = path.join(project, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    const cf = readJson(manifestPath).confirmations ?? {};
    if (cf.structure !== true) {
      warnings.push(`manifest.confirmations.structure 为 ${cf.structure}，请在确认后用 indexer 刷新 manifest`);
    }
    for (const [, t] of trees) {
      const bp = t.canvas.breakpoint;
      // 新旧两种键都看看：旧 manifest 里没有 positioning 映射
      const legacy = bp === "desktop" ? cf.positioningDesktop : bp === "mobile" ? cf.positioningMobile : undefined;
      const generic = cf.positioning?.[bp];
      if (generic !== true && legacy !== true) {
        warnings.push(`manifest.confirmations.positioning["${bp}"] 为 ${generic ?? legacy}，请在确认后用 indexer 刷新 manifest`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function main() {
  const args = parseArgs(process.argv.slice(2), { project: ".", mode: "static", scope: null, "write-fixture": false, quiet: false });
  args.scope = splitList(args.scope);
  args.fixture = args["write-fixture"];
  if (args.help) {
    console.log(
      "用法: node scripts/validate/check-confirmation.mjs --project <dir> [--mode static|storyboard] [--scope desktop,mobile] [--write-fixture]",
    );
    return;
  }
  const project = path.resolve(args.project);

  if (args.fixture) {
    writeFixtureConfirmation(project);
    console.warn("check-confirmation 警告：已写入夹具确认（source=fixture）。这不是人工确认，交付前必须由用户重新确认。");
    return;
  }

  const { ok, errors, warnings } = checkConfirmation(project, { mode: args.mode, scope: args.scope });
  for (const w of warnings) console.warn(`check-confirmation 警告：${w}`);
  if (!ok) {
    console.error(`check-confirmation 失败（mode=${args.mode}）\n  - ${errors.join("\n  - ")}`);
    process.exit(1);
  }
  if (!args.quiet) {
    const scopeLabel = args.scope ? args.scope.join(" / ") : "全部断点";
    const label = args.mode === "storyboard" ? "关键帧 Storyboard" : `结构 + ${scopeLabel} 定位图`;
    console.log(`✓ check-confirmation 通过（mode=${args.mode}）：${label} 已确认且未失效`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
