#!/usr/bin/env node
/**
 * confirm — 把两级确认落盘，而不是只留在对话里。
 *
 * 确认状态必须是文件，因为**渲染闸门读文件，不读对话**。
 *
 * 用法：
 *   # 确认节点 A（结构）：AI 展示完文本 box tree、用户认可后执行
 *   node scripts/confirm.mjs --project <dir> --node structure --source user-chat --note "用户回复：结构 OK"
 *
 *   # 确认节点 B（定位）：正常走查看器按钮；用户只在对话里确认时用 CLI 补录
 *   node scripts/confirm.mjs --project <dir> --node positioning --bp desktop --source user-chat
 *
 *   # 视频关键帧确认（与静态产物分开）
 *   node scripts/confirm.mjs --project <dir> --node storyboard --source user-chat
 *
 *   node scripts/confirm.mjs --project <dir> --show     # 打印当前确认状态
 *   node scripts/confirm.mjs --project <dir> --reset    # 清空（改了布局要重新确认时）
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { listTrees } from "./layout-engine/io.mjs";
import { hashLayoutTree, HASH_VERSION } from "./layout-engine/hash.mjs";
import { renderSvg } from "./positioning-viewer/render-core.mjs";
import { ensureDir } from "./layout-engine/io.mjs";
import { upsertRecord, listRecords, writeConfirmations } from "./layout-engine/confirm-store.mjs";

const SOURCES = ["viewer-ui", "user-chat", "fixture"];

function parseArgs(argv) {
  const a = { project: ".", source: "user-chat" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--project") a.project = argv[++i];
    else if (argv[i] === "--node") a.node = argv[++i];
    else if (argv[i] === "--bp") a.bp = argv[++i];
    else if (argv[i] === "--note") a.note = argv[++i];
    else if (argv[i] === "--source") a.source = argv[++i];
    else if (argv[i] === "--show") a.show = true;
    else if (argv[i] === "--reset") a.reset = true;
    else if (argv[i] === "-h" || argv[i] === "--help") a.help = true;
    else throw new Error(`未知参数: ${argv[i]}`);
  }
  return a;
}

/** storyboard 时间轴指纹（关键帧集合的哈希）。 */
export function hashTimeline(projectDir) {
  const file = path.join(path.resolve(projectDir), "positioning", "storyboard", "timeline.json");
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file);
  return "sha256:" + crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

/** 判断一条记录当前是否仍然有效（几何指纹是否还匹配）。 */
function recordValidity(projectDir, record, trees) {
  if (record.node === "structure") return { valid: true, why: "" };
  if (record.node === "storyboard") {
    const h = hashTimeline(projectDir);
    if (!h) return { valid: false, why: "缺 timeline.json" };
    return h === record.timelineHash ? { valid: true, why: "" } : { valid: false, why: "时间轴已变化" };
  }
  const tree = trees.find(([, t]) => t.canvas.breakpoint === record.bp);
  if (!tree) return { valid: false, why: `找不到 ${record.bp} 的 Layout Tree` };
  if (record.hashVersion !== undefined && record.hashVersion !== HASH_VERSION) {
    return { valid: false, why: `哈希定义已升级（记录 v${record.hashVersion} → 当前 v${HASH_VERSION}）` };
  }
  const now = hashLayoutTree(tree[1]);
  if (record.treeHash && record.treeHash !== now) return { valid: false, why: "确认后布局已变化" };
  return { valid: true, why: "" };
}

function statusText(projectDir, { withValidity = true } = {}) {
  const records = listRecords(projectDir);
  if (records.length === 0) return "（无任何确认记录）";
  const trees = withValidity ? listTrees(path.join(path.resolve(projectDir), "layout-tree")) : [];
  return records
    .map((r) => {
      const head = `  ${r.node}${r.bp ? `:${r.bp}` : ""}  source=${r.source ?? "?"}  at=${r.confirmedAt}`;
      const hash = r.treeHash ? `  ${r.treeHash}` : "";
      const note = r.note ? `\n      note: ${r.note}` : "";
      if (!withValidity) return head + hash + note;
      const v = recordValidity(projectDir, r, trees);
      return `${v.valid ? "  ✓" : "  ✗"}${head.slice(2)}${hash}${v.valid ? "" : `\n      ⚠ ${v.why}`}${note}`;
    })
    .join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const project = path.resolve(args.project);

  if (args.help) {
    console.log("用法: node scripts/confirm.mjs --project <dir> (--node structure|positioning|storyboard [--bp desktop] | --show | --reset) [--source user-chat] [--note ...]");
    return;
  }

  if (args.show) {
    console.log(`确认状态（${path.basename(project)}）：`);
    console.log(statusText(project));
    return;
  }

  if (args.reset) {
    writeConfirmations(project, { project: path.basename(project), records: [] });
    console.log("✓ 已清空确认记录（布局改动后必须重新确认）");
    return;
  }

  if (!args.node) {
    console.error("必须指定 --node structure|positioning|storyboard，或用 --show / --reset");
    process.exit(1);
  }
  if (!SOURCES.includes(args.source)) {
    console.error(`--source 必须是 ${SOURCES.join(" | ")}`);
    process.exit(1);
  }

  const trees = listTrees(path.join(project, "layout-tree"));

  if (args.node === "structure") {
    upsertRecord(project, { node: "structure", source: args.source, note: args.note ?? "" });
    console.log("✓ 确认节点 A（结构）已落盘 → positioning/confirmed.json");
    return;
  }

  if (args.node === "positioning") {
    if (trees.length === 0) {
      console.error("layout-tree/ 下没有 Layout Tree，无法确认定位图");
      process.exit(1);
    }
    const targets = args.bp ? trees.filter(([, t]) => t.canvas.breakpoint === args.bp) : trees;
    if (targets.length === 0) {
      console.error(`没有断点 ${args.bp} 的 Layout Tree`);
      process.exit(1);
    }
    const positioningDir = path.join(project, "positioning");
    ensureDir(positioningDir);
    for (const [, tree] of targets) {
      const bp = tree.canvas.breakpoint;
      const svg = renderSvg(tree, { title: `${path.basename(project)} · ${bp} · confirmed` });
      fs.writeFileSync(path.join(positioningDir, `confirmed-${bp}.svg`), svg);
      upsertRecord(project, {
        node: "positioning",
        bp,
        hidden: [],
        source: args.source,
        note: args.note ?? "",
        treeHash: hashLayoutTree(tree),
        hashVersion: HASH_VERSION,
        svg: `positioning/confirmed-${bp}.svg`,
      });
    }
    console.log(`✓ 确认节点 B（定位）已落盘：${targets.map(([, t]) => t.canvas.breakpoint).join(" / ")}`);
    return;
  }

  if (args.node === "storyboard") {
    const hash = hashTimeline(project);
    if (!hash) {
      console.error("找不到 positioning/storyboard/timeline.json，请先运行 storyboard");
      process.exit(1);
    }
    upsertRecord(project, { node: "storyboard", source: args.source, note: args.note ?? "", timelineHash: hash });
    console.log("✓ 关键帧 Storyboard 已确认（与静态产物分开记录）");
    return;
  }

  console.error(`未知 --node: ${args.node}`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
