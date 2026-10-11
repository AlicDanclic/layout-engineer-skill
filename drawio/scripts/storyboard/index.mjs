#!/usr/bin/env node
/**
 * storyboard/index — 关键帧 Storyboard 编排。
 *
 * 输入：<project>/storyboard.json
 *   {
 *     "fps": 30,
 *     "duration": 3.0,
 *     "breakpoint": "desktop",
 *     "tracks": [
 *       { "id": "header",  "enter": 0.0, "expanded": 0.6, "exit": 3.0, "animation": "fade" },
 *       { "id": "card-1",  "enter": 0.8, "expanded": 1.4, "exit": 2.8, "animation": "slide-up" }
 *     ]
 *   }
 *
 * 输出：
 *   positioning/storyboard/timeline.svg
 *   positioning/storyboard/timeline.json   （供 remotion serializer 消费）
 *   positioning/storyboard/kf-NN-tX.Xs.svg
 *
 * 用法：node scripts/storyboard/index.mjs --project <dir>
 */
import fs from "node:fs";
import path from "node:path";
import { readJson, ensureDir, listTrees } from "../../../layout/scripts/layout-engine/io.mjs";
import { computeKeyframeTimes, renderKeyframes } from "./keyframes.mjs";
import { toRemotionTimeline, renderTimelineSvg } from "./timeline.mjs";

function main() {
  const argv = process.argv.slice(2);
  const pi = argv.indexOf("--project");
  const project = path.resolve(pi >= 0 ? argv[pi + 1] : ".");
  const specFile = path.join(project, "storyboard.json");
  if (!fs.existsSync(specFile)) {
    console.error(`storyboard 失败: 缺少 ${path.relative(process.cwd(), specFile)}`);
    process.exit(1);
  }
  const spec = readJson(specFile);
  if (!Array.isArray(spec.tracks) || !spec.tracks.length) {
    console.error("storyboard 失败: tracks 不能为空");
    process.exit(1);
  }
  for (const t of spec.tracks) {
    for (const k of ["enter", "expanded", "exit"]) {
      if (typeof t[k] !== "number") {
        console.error(`storyboard 失败: 轨道 ${t.id} 缺少数值 ${k}`);
        process.exit(1);
      }
    }
  }

  const trees = Object.fromEntries(
    listTrees(path.join(project, "layout-tree")).map(([, t]) => [t.canvas.breakpoint, t]),
  );
  const bp = spec.breakpoint ?? "desktop";
  const tree = trees[bp];
  if (!tree) {
    console.error(`storyboard 失败: 没有 ${bp} 的 Layout Tree`);
    process.exit(1);
  }

  const outDir = path.join(project, "positioning", "storyboard");
  ensureDir(outDir);

  const times = computeKeyframeTimes(spec);
  const keyframeFiles = renderKeyframes(project, spec, tree, times);
  fs.writeFileSync(path.join(outDir, "timeline.svg"), renderTimelineSvg(spec, times, tree));
  fs.writeFileSync(
    path.join(outDir, "timeline.json"),
    JSON.stringify(toRemotionTimeline(spec), null, 2) + "\n",
  );

  console.log(`✓ storyboard：${times.length} 个关键帧 @ ${times.map((t) => t.toFixed(1) + "s").join(" / ")}`);
  for (const f of [...keyframeFiles, path.join(outDir, "timeline.svg")]) {
    console.log(`  · ${path.relative(project, f)}`);
  }
}

main();
