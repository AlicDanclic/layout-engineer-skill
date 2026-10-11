/**
 * render-core — 定位图 / 关键帧图的同构 SVG 渲染器。
 *
 * 同一份代码同时服务于：
 *   - 浏览器里的交互式定位查看器（positioning-viewer）
 *   - Node 端的静态导出（render-preview / storyboard / 确认存档）
 *
 * 原则：渲染坐标直接取自 Layout Tree 的 x/y/w/h，不做任何二次估算。
 */

export const DEPTH_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4"];

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

/** 序号 -> 圈码，超过 20 用 (n)。 */
export function numberMark(n) {
  return n <= 20 ? CIRCLED[n - 1] : `(${n})`;
}

/** 深度 -> 颜色。 */
export function depthColor(depth) {
  return DEPTH_COLORS[depth % DEPTH_COLORS.length];
}

/**
 * 先序遍历，附带 1 起的编号、路径与祖先 id 链。
 * @returns {{node: any, index: number, ancestors: string[]}[]}
 */
export function flattenTree(elements, ancestors = [], out = []) {
  for (const n of elements) {
    out.push({ node: n, index: out.length + 1, ancestors: [...ancestors] });
    if (n.children?.length) flattenTree(n.children, [...ancestors, n.id], out);
  }
  return out;
}

/** 被隐藏的节点：自身或任一祖先在 hidden 集合中即为隐藏。 */
export function isHidden(entry, hidden) {
  if (!hidden || hidden.size === 0) return false;
  return hidden.has(entry.node.id) || entry.ancestors.some((a) => hidden.has(a));
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function num(v) {
  // 去掉浮点噪声，保留至多两位小数
  return String(Math.round(v * 100) / 100);
}

/**
 * 渲染一张定位图。
 *
 * @param tree LayoutTree
 * @param options {
 *   showAreas?: boolean, showCenters?: boolean, showDistances?: boolean,
 *   showExpr?: boolean, showCanvasInfo?: boolean, hiddenIds?: string[],
 *   hoveredId?: string|null, timeLabel?: string, title?: string
 * }
 * @returns SVG 字符串
 */
export function renderSvg(tree, options = {}) {
  const {
    showAreas = true,
    showCenters = false,
    showDistances = true,
    showExpr = true,
    showCanvasInfo = true,
    showDims = true,
    showIndex = true,
    showNotes = true,
    hiddenIds = [],
    hoveredId = null,
    timeLabel = null,
    title = null,
  } = options;

  const hidden = new Set(hiddenIds);
  const { w: cw, h: ch } = tree.canvas;
  const entries = flattenTree(tree.elements);

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cw} ${ch}" ` +
      `width="${cw}" height="${ch}" font-family="ui-sans-serif, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif">`,
  );
  parts.push(
    `<defs>` +
      `<marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
      `<path d="M0,0 L10,5 L0,10 z" fill="#64748b"/></marker>` +
      `<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">` +
      `<feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#0f172a" flood-opacity="0.25"/></filter>` +
      `</defs>`,
  );
  parts.push(`<rect x="0" y="0" width="${cw}" height="${ch}" fill="#ffffff"/>`);

  // ---- 区域圈选 ----
  if (showAreas) {
    for (const e of entries) {
      if (isHidden(e, hidden)) continue;
      const n = e.node;
      const color = depthColor(n.depth);
      parts.push(
        `<rect x="${num(n.x)}" y="${num(n.y)}" width="${num(n.w)}" height="${num(n.h)}" ` +
          `fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="1.5" rx="2"/>`,
      );
    }
  }

  // ---- 四向距离（顶层元素 + 悬停元素）----
  if (showDistances) {
    for (const e of entries) {
      if (isHidden(e, hidden)) continue;
      if (e.node.depth !== 0 && e.node.id !== hoveredId) continue;
      const n = e.node;
      const cx = n.x + n.w / 2;
      const cy = n.y + n.h / 2;
      const segs = [
        [cx, n.y, cx, 0, num(n.y)],
        [cx, n.y + n.h, cx, ch, num(ch - (n.y + n.h))],
        [n.x, cy, 0, cy, num(n.x)],
        [n.x + n.w, cy, cw, cy, num(cw - (n.x + n.w))],
      ];
      for (const [x1, y1, x2, y2, label] of segs) {
        if (Math.abs(x1 - x2) < 0.01 && Math.abs(y1 - y2) < 0.01) continue;
        parts.push(
          `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" ` +
            `stroke="#64748b" stroke-width="1" stroke-dasharray="4 4" marker-start="url(#arrow)" marker-end="url(#arrow)"/>`,
        );
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        parts.push(
          `<rect x="${num(mx - 16)}" y="${num(my - 9)}" width="32" height="18" rx="3" fill="#ffffff" fill-opacity="0.9"/>` +
            `<text x="${num(mx)}" y="${num(my + 4)}" font-size="11" fill="#334155" text-anchor="middle">${esc(label)}</text>`,
        );
      }
    }
  }

  // ---- 中心十字线 ----
  if (showCenters) {
    for (const e of entries) {
      if (isHidden(e, hidden)) continue;
      const n = e.node;
      const cx = n.x + n.w / 2;
      const cy = n.y + n.h / 2;
      const r = 7;
      parts.push(
        `<line x1="${num(cx - r)}" y1="${num(cy)}" x2="${num(cx + r)}" y2="${num(cy)}" stroke="#0f172a" stroke-width="1"/>` +
          `<line x1="${num(cx)}" y1="${num(cy - r)}" x2="${num(cx)}" y2="${num(cy + r)}" stroke="#0f172a" stroke-width="1"/>`,
      );
    }
  }

  // ---- 标签 + 编号 + 表达式 ----
  for (const e of entries) {
    if (isHidden(e, hidden)) continue;
    const n = e.node;
    const color = depthColor(n.depth);
    const mark = numberMark(e.index);
    const lines = [];
    lines.push({
      text: showIndex ? `${mark} ${n.label}` : n.label,
      size: 13,
      weight: 600,
      fill: "#0f172a",
    });
    if (showDims) {
      lines.push({
        text: `${num(n.x)},${num(n.y)}  ${num(n.w)}×${num(n.h)}`,
        size: 10.5,
        weight: 400,
        fill: "#475569",
      });
    }
    if (showNotes && n.note) {
      for (const ln of Array.isArray(n.note) ? n.note : [n.note]) {
        lines.push({ text: String(ln), size: 10.5, weight: 400, fill: "#64748b" });
      }
    }
    if (showExpr) {
      for (const k of ["x", "y", "w", "h"]) {
        if (n.expr?.[k]) {
          lines.push({ text: `${k} = ${n.expr[k]}`, size: 10, weight: 400, fill: "#64748b", mono: true });
        }
      }
    }
    const padY = 4;
    let ty = n.y + 14;
    for (const ln of lines) {
      const est = ln.text.length * (ln.mono ? ln.size * 0.62 : ln.size * 0.6) + 10;
      const boxW = Math.min(Math.max(est, 90), Math.max(cw - 8, 90));
      const boxX = Math.min(Math.max(n.x + 4, 2), Math.max(cw - boxW - 2, 2));
      parts.push(
        `<rect x="${num(boxX)}" y="${num(ty - ln.size)}" width="${num(boxW)}" height="${num(ln.size + padY)}" ` +
          `rx="3" fill="#ffffff" fill-opacity="0.85" stroke="${color}" stroke-opacity="0.35" stroke-width="0.5"/>`,
      );
      parts.push(
        `<text x="${num(boxX + 4)}" y="${num(ty + 1)}" font-size="${ln.size}" font-weight="${ln.weight}" ` +
          `fill="${ln.fill}"${ln.mono ? ' font-family="ui-monospace, SFMono-Regular, Menlo, monospace"' : ""}>${esc(ln.text)}</text>`,
      );
      ty += ln.size + padY + 2;
    }
  }

  // ---- 画布信息 ----
  if (showCanvasInfo) {
    const info = `${cw} × ${ch} · ${tree.canvas.breakpoint} · 1:1`;
    const w = Math.max(info.length * 7 + 16, 150);
    parts.push(
      `<rect x="${num(cw - w - 8)}" y="8" width="${num(w)}" height="24" rx="4" fill="#0f172a" fill-opacity="0.82"/>` +
        `<text x="${num(cw - w / 2 - 8)}" y="24" font-size="12" fill="#f8fafc" text-anchor="middle">${esc(info)}</text>`,
    );
  }

  // ---- 关键帧时间标注 ----
  if (timeLabel) {
    const w = Math.max(timeLabel.length * 8 + 16, 120);
    parts.push(
      `<rect x="8" y="8" width="${num(w)}" height="24" rx="4" fill="#7c3aed" fill-opacity="0.9"/>` +
        `<text x="${num(8 + w / 2)}" y="24" font-size="12" fill="#ffffff" text-anchor="middle">${esc(timeLabel)}</text>`,
    );
  }

  // ---- 导出标题 ----
  if (title) {
    parts.push(
      `<text x="${num(cw / 2)}" y="${num(ch - 8)}" font-size="12" fill="#94a3b8" text-anchor="middle">${esc(title)}</text>`,
    );
  }

  parts.push("</svg>");
  return parts.join("\n") + "\n";
}
