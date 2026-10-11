/**
 * storyboard/keyframes — 关键帧选取、定位图导出。
 *
 * 规则：每个有动画的元素取 3 个关键状态（入场 / 完全展开 / 离场），
 *       关键帧时间点 = 所有轨道的三个端点合并去重后排序。
 *       无动画元素不单独出帧，但会随其所在时间区间决定是否出现在画面里。
 */
import fs from "node:fs";
import path from "node:path";
import { renderSvg } from "../../../layout/scripts/positioning-viewer/render-core.mjs";
import { ensureDir } from "../../../layout/scripts/layout-engine/io.mjs";

/** 合并去重排序所有关键帧时刻（秒）。 */
export function computeKeyframeTimes(spec) {
  const set = new Set();
  for (const t of spec.tracks) {
    for (const k of ["enter", "expanded", "exit"]) {
      if (typeof t[k] === "number") set.add(Math.round(t[k] * 1000) / 1000);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/** 时刻 t 时不在画面中的元素 id（区间外）。 */
export function hiddenAt(spec, t) {
  const hidden = [];
  for (const tr of spec.tracks) {
    if (t < tr.enter - 1e-9 || t > tr.exit + 1e-9) hidden.push(tr.id);
  }
  return hidden;
}

/** 时刻 t 属于哪个时间区间（用于图上标注）。 */
export function intervalAt(times, t) {
  const i = times.indexOf(t);
  const next = times[i + 1];
  return next === undefined ? `t = ${t.toFixed(1)}s ~` : `t = ${t.toFixed(1)}s ~ ${next.toFixed(1)}s`;
}

/**
 * 导出关键帧定位图。
 * @returns 写出的文件路径列表
 */
export function renderKeyframes(projectDir, spec, tree, times) {
  const outDir = path.join(projectDir, "positioning", "storyboard");
  ensureDir(outDir);
  const written = [];
  times.forEach((t, i) => {
    const label = intervalAt(times, t);
    const svg = renderSvg(tree, {
      showAreas: true,
      showCenters: false,
      showDistances: true,
      showExpr: true,
      showCanvasInfo: true,
      hiddenIds: hiddenAt(spec, t),
      timeLabel: label,
      title: `关键帧 kf-${String(i + 1).padStart(2, "0")} · ${tree.canvas.breakpoint}`,
    });
    const file = path.join(outDir, `kf-${String(i + 1).padStart(2, "0")}-t${t.toFixed(1)}s.svg`);
    fs.writeFileSync(file, svg);
    written.push(file);
  });
  return written;
}
