#!/usr/bin/env node
/**
 * serializer: preview — 双端预览图（SVG + PNG）。
 *
 * 由真实代码在对应断点下渲染：SVG 用 render-core（与查看器同一套），
 * PNG 调用 pil.py（需要 Pillow）。禁止手工拼图。
 *
 * 产物：<project>/preview/{desktop,mobile}.svg 与 .png
 *
 * 用法：
 *   node scripts/serializers/preview.mjs --project <dir> [--scale 1]
 *   node scripts/serializers/preview.mjs --project <dir> --style diagram
 *
 * --style positioning（默认）：区域圈选 + 编号 + 尺寸，用于核对几何
 * --style diagram          ：线框级，去掉尺寸/编号，渲染 note 文本并居中
 * --style poster           ：视觉级（diagram.py），圆角卡片 / 配色分区 / 字阶 / 连接线 / 阴影
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listTrees, ensureDir } from "../../../layout/scripts/layout-engine/io.mjs";
import { renderSvg } from "../../../layout/scripts/positioning-viewer/render-core.mjs";
import { requireConfirmation, allowUnconfirmed, scopeFrom, previewPath } from "./gate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 两种风格的渲染开关。 */
export const STYLES = {
  poster: {
    svg: {
      showAreas: false,
      showDistances: false,
      showExpr: false,
      showDims: false,
      showIndex: false,
      showCanvasInfo: false,
      showNotes: true,
    },
    renderer: "diagram.py",
    pil: [],
  },
  positioning: {
    svg: { showAreas: true, showDistances: false, showExpr: false, showCanvasInfo: false },
    pil: ["--no-expr", "--no-distances"],
  },
  diagram: {
    svg: {
      showAreas: true,
      showDistances: false,
      showExpr: false,
      showDims: false,
      showIndex: false,
      showCanvasInfo: false,
      showNotes: true,
    },
    pil: ["--no-expr", "--no-distances", "--no-dims", "--no-index", "--no-canvas-info", "--center-content"],
  },
};

export function renderPreviews(projectDir, { scale = 1, style = "positioning", scope = null, allow = false } = {}) {
  const spec = STYLES[style] ?? STYLES.positioning;
  const project = path.resolve(projectDir);
  const outDir = path.join(project, "preview");
  ensureDir(outDir);
  const trees = listTrees(path.join(project, "layout-tree"))
    .map(([, t]) => t)
    .filter((t) => !scope || scope.includes(t.canvas.breakpoint));
  if (!trees.length) throw new Error("layout-tree/ 下没有 Layout Tree");

  const results = [];
  for (const tree of trees) {
    const bp = tree.canvas.breakpoint;
    const svg = renderSvg(tree, {
      ...spec.svg,
      title: `${path.basename(project)} · ${bp} · rendered from layout-tree/${bp}.json`,
    });
    const svgFile = previewPath(path.join(outDir, `${bp}.svg`), allow);
    fs.writeFileSync(svgFile, svg);
    results.push(svgFile);

    // PNG：poster 走 diagram.py（视觉级），其余走 pil.py（线框级）
    const py = process.env.LAYOUT_ENGINE_PYTHON ?? "python3";
    const treeFile = path.join(project, "layout-tree", `${bp}.json`);
    const pngFile = previewPath(path.join(outDir, `${bp}.png`), allow);
    const renderer = spec.renderer ?? "pil.py";
    // preview.mjs 已在上游闸门放过；Python 侧不再重复拦（直接调用 python 时仍会拦）
    const rendererArgs = [
      "--tree", treeFile, "--out", pngFile,
      ...(allow ? ["--allow-unconfirmed"] : []),
      ...(scope ? ["--scope", scope.join(",")] : []),
      ...(renderer === "diagram.py"
        ? ["--footer", `${path.basename(project)} · ${bp} · geometry verbatim from layout-tree/${bp}.json`]
        : ["--scale", String(scale), ...spec.pil]),
    ];
    const r = spawnSync(py, [path.join(HERE, renderer), ...rendererArgs], { stdio: "pipe", encoding: "utf8" });
    if (r.status === 0) results.push(pngFile);
    else process.stderr.write(`  · ${bp} PNG 跳过（Pillow 不可用）\n`);
  }
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const pi = argv.indexOf("--project");
  const project = path.resolve(pi >= 0 ? argv[pi + 1] : ".");
  const si = argv.indexOf("--scale");
  const scale = si >= 0 ? Number(argv[si + 1]) : 1;
  const yi = argv.indexOf("--style");
  const style = yi >= 0 ? argv[yi + 1] : "positioning";
  const scope = scopeFrom(argv);
  const allow = allowUnconfirmed(argv);
  requireConfirmation(project, "static", { allow, scope });
  const files = renderPreviews(project, { scale, style, scope, allow });
  console.log(
    `✓ preview（${style}${scope ? ` · scope=${scope.join(",")}` : ""}）：${files.map((f) => path.relative(project, f)).join(", ")}`,
  );
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  Promise.resolve()
    .then(main)
    .catch((e) => {
      // 闸门类错误只打印一行提示，不抛堆栈
      console.error(e?.isGateError ? `\n✗ ${e.message}` : (e?.stack ?? String(e)));
      process.exit(1);
    });
}
