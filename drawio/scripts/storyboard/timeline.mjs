/**
 * storyboard/timeline — 时间轴计算与轨道图渲染。
 *
 * 输入 storyboard.json（元素时间区间），输出：
 *   - Remotion 可直接消费的 timeline.json
 *   - timeline.svg 轨道图（横轴时间、每行一个元素、竖虚线标注关键帧）
 */
import { flattenTree, numberMark, depthColor } from "../../../layout/scripts/positioning-viewer/render-core.mjs";

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 秒 -> 帧。 */
export const toFrames = (seconds, fps) => Math.round(seconds * fps);

/** storyboard.json -> Remotion timeline.json */
export function toRemotionTimeline(spec) {
  const fps = spec.fps ?? 30;
  const duration = spec.durationInFrames ?? toFrames(spec.duration ?? 3, fps);
  return {
    fps,
    durationInFrames: duration,
    breakpoint: spec.breakpoint ?? "desktop",
    tracks: spec.tracks.map((t) => ({
      id: t.id,
      from: toFrames(t.enter, fps),
      durationInFrames: Math.max(1, toFrames(t.exit, fps) - toFrames(t.enter, fps)),
      animation: t.animation ?? "fade",
      // 入场位移量：作为数据写进时间轴，序列化器里不带几何字面量
      offset: t.offset ?? 0,
    })),
  };
}

/**
 * 绘制时间轴轨道图。
 * @param spec storyboard.json
 * @param keyTimes 关键帧时间点（秒，已排序去重）
 * @param tree 对应断点的 Layout Tree（用于编号与颜色）
 */
export function renderTimelineSvg(spec, keyTimes, tree) {
  const fps = spec.fps ?? 30;
  const durationSec = spec.duration ?? spec.durationInFrames / fps;
  const base = tree ? flattenTree(tree.elements) : [];
  const meta = new Map(base.map((e) => [e.node.id, e]));

  const rowH = 34;
  const padL = 220;
  const padR = 40;
  const padT = 46;
  const padB = 40;
  const width = 1000;
  const plotW = width - padL - padR;
  const height = padT + spec.tracks.length * rowH + padB;
  const x = (sec) => padL + (sec / durationSec) * plotW;

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
      `font-family="ui-sans-serif,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif">`,
  );
  parts.push(`<rect width="${width}" height="${height}" fill="#0b1120"/>`);
  parts.push(
    `<text x="20" y="26" font-size="14" fill="#f8fafc" font-weight="700">时间轴 · ${esc(spec.breakpoint ?? "desktop")} · ${durationSec}s @ ${fps}fps</text>`,
  );
  parts.push(
    `<text x="${width - 20}" y="26" font-size="12" fill="#94a3b8" text-anchor="end">${keyTimes.length} 个关键帧</text>`,
  );

  // 时间刻度
  for (let s = 0; s <= durationSec + 1e-6; s += 0.5) {
    const gx = x(s);
    parts.push(`<line x1="${gx}" y1="${padT - 12}" x2="${gx}" y2="${height - padB + 6}" stroke="#1f2937" stroke-width="1"/>`);
    parts.push(`<text x="${gx}" y="${padT - 18}" font-size="10" fill="#64748b" text-anchor="middle">${s.toFixed(1)}s</text>`);
  }

  // 轨道
  spec.tracks.forEach((t, i) => {
    const y = padT + i * rowH;
    const e = meta.get(t.id);
    const mark = e ? numberMark(e.index) : "·";
    const color = e ? depthColor(e.node.depth) : "#64748b";
    parts.push(`<line x1="${padL}" y1="${y + rowH / 2}" x2="${width - padR}" y2="${y + rowH / 2}" stroke="#111827" stroke-width="1"/>`);
    parts.push(
      `<text x="20" y="${y + rowH / 2 + 4}" font-size="12" fill="#e2e8f0">${esc(mark)} ${esc(t.id)}</text>`,
    );
    const x1 = x(t.enter);
    const x2 = x(t.exit);
    parts.push(
      `<rect x="${x1}" y="${y + 6}" width="${Math.max(x2 - x1, 2)}" height="${rowH - 12}" rx="5" fill="${color}" fill-opacity="0.85"/>`,
    );
    // 入场 / 完全展开 / 离场 三个状态点
    for (const [key, val] of [["enter", t.enter], ["expanded", t.expanded], ["exit", t.exit]]) {
      if (val === undefined || val === null) continue;
      parts.push(`<circle cx="${x(val)}" cy="${y + rowH / 2}" r="3.5" fill="#f8fafc" stroke="${color}" stroke-width="1.5"/>`);
      void key;
    }
  });

  // 关键帧竖虚线
  keyTimes.forEach((k, i) => {
    const gx = x(k);
    parts.push(
      `<line x1="${gx}" y1="${padT - 8}" x2="${gx}" y2="${height - padB + 6}" stroke="#f43f5e" stroke-width="1" stroke-dasharray="5 4"/>`,
    );
    parts.push(`<text x="${gx}" y="${height - padB + 22}" font-size="10" fill="#fda4af" text-anchor="middle">kf-${String(i + 1).padStart(2, "0")}</text>`);
  });

  // 图例
  parts.push(
    `<text x="${padL}" y="${height - 8}" font-size="10" fill="#64748b">● 入场 / 完全展开 / 离场　|　红色虚线 = 关键帧时刻</text>`,
  );
  parts.push("</svg>");
  return parts.join("\n") + "\n";
}
