#!/usr/bin/env python3
"""
serializer: pil — Layout Tree -> PNG 位图。

**铁律：零几何计算。** 画图时坐标全部原样取自树的 x/y/w/h，不做任何乘除加减。
`--scale` 不是坐标缩放，而是渲染完成后对整张图做一次重采样（DPI 级别的变换），
所以它不会让「树里 88px」变成「图里 90px」。

DOM 产物用 `data-layout-id` / `data-expr` 做回溯；位图无法挂属性，
因此 PNG 的可回溯性由定位图（SVG / 查看器）承担，`--annotate` 可把 expr 画在图上。

依赖 Pillow（项目级 .venv 内安装）：pip install Pillow

用法：
    python3 scripts/serializers/pil.py --tree layout-tree/desktop.json --out preview/desktop.png
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _gate import require_confirmation, project_from_tree, preview_path, stamp_preview  # noqa: E402

from PIL import Image, ImageDraw, ImageFont

DEPTH_COLORS = [
    (59, 130, 246),
    (16, 185, 129),
    (245, 158, 11),
    (139, 92, 246),
    (236, 72, 153),
    (6, 182, 212),
]

FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "C:/Windows/Fonts/msyh.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]

FONT_LABEL = 13
FONT_DIM = 10
FONT_NOTE = 11
FONT_MONO = 10


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def flatten(nodes, ancestors=None, out=None):
    ancestors = ancestors or []
    out = out if out is not None else []
    for n in nodes:
        out.append((len(out) + 1, n, ancestors))
        flatten(n.get("children", []), ancestors + [n["id"]], out)
    return out


def hidden_by(node, ancestors, hidden):
    return bool(hidden) and (node["id"] in hidden or any(a in hidden for a in ancestors))


def depth_color(depth: int):
    return DEPTH_COLORS[depth % len(DEPTH_COLORS)]


def draw_tree(
    tree: dict,
    show_expr: bool = True,
    show_distances: bool = True,
    show_centers: bool = False,
    show_dims: bool = True,
    show_index: bool = True,
    show_canvas_info: bool = True,
    center_content: bool = False,
    hidden=None,
    time_label: str | None = None,
) -> Image.Image:
    """按 1:1 渲染（坐标原样取自树）。等比缩放由调用方对整图重采样完成。"""
    canvas = tree["canvas"]
    w, h = int(round(canvas["w"])), int(round(canvas["h"]))
    img = Image.new("RGB", (w, h), (255, 255, 255))
    draw = ImageDraw.Draw(img, "RGBA")
    hidden = set(hidden or [])

    font_label = load_font(FONT_LABEL)
    font_dim = load_font(FONT_DIM)
    font_note = load_font(FONT_NOTE)
    font_mono = load_font(FONT_MONO)

    entries = flatten(tree["elements"])

    for _idx, node, _anc in entries:
        if hidden_by(node, _anc, hidden):
            continue
        color = depth_color(node["depth"])
        box = [node["x"], node["y"], node["x"] + node["w"], node["y"] + node["h"]]
        draw.rectangle(box, fill=color + (30,), outline=color + (255,), width=1)

    if show_distances:
        for _idx, node, _anc in entries:
            if hidden_by(node, _anc, hidden) or node["depth"] != 0:
                continue
            cx = node["x"] + node["w"] / 2
            cy = node["y"] + node["h"] / 2
            segs = [
                (cx, node["y"], cx, 0, f"{node['y']:g}"),
                (cx, node["y"] + node["h"], cx, h, f"{canvas['h'] - node['y'] - node['h']:g}"),
                (node["x"], cy, 0, cy, f"{node['x']:g}"),
                (node["x"] + node["w"], cy, w, cy, f"{canvas['w'] - node['x'] - node['w']:g}"),
            ]
            for x1, y1, x2, y2, label in segs:
                if abs(x1 - x2) < 0.5 and abs(y1 - y2) < 0.5:
                    continue
                draw.line([x1, y1, x2, y2], fill=(100, 116, 139, 255), width=1)
                mx, my = (x1 + x2) / 2, (y1 + y2) / 2
                tw = draw.textlength(label, font=font_dim)
                draw.rectangle([mx - tw / 2 - 2, my - 8, mx + tw / 2 + 2, my + 8], fill=(255, 255, 255, 230))
                draw.text((mx - tw / 2, my - 6), label, font=font_dim, fill=(51, 65, 85))

    if show_centers:
        for _idx, node, _anc in entries:
            if hidden_by(node, _anc, hidden):
                continue
            cx = node["x"] + node["w"] / 2
            cy = node["y"] + node["h"] / 2
            r = 7
            draw.line([cx - r, cy, cx + r, cy], fill=(15, 23, 42, 255), width=1)
            draw.line([cx, cy - r, cx, cy + r], fill=(15, 23, 42, 255), width=1)

    def truncate(text, font, maxw):
        if draw.textlength(text, font=font) <= maxw:
            return text
        ell = "…"
        while text and draw.textlength(text + ell, font=font) > maxw:
            text = text[:-1]
        return text + ell

    def fsize(font):
        return getattr(font, "size", 11)

    for idx, node, _anc in entries:
        if hidden_by(node, _anc, hidden):
            continue
        color = depth_color(node["depth"])
        x0, y0 = node["x"], node["y"]
        x1 = node["x"] + node["w"]
        prefix = f"({idx}) " if show_index else ""
        lines = [(f"{prefix}{node.get('label', node['id'])}", font_label, (15, 23, 42))]
        if show_dims:
            lines.append((f"{node['x']:g},{node['y']:g}  {node['w']:g}x{node['h']:g}", font_dim, (71, 85, 105)))
        note = node.get("note")
        if note:
            for ln in note if isinstance(note, (list, tuple)) else [note]:
                lines.append((str(ln), font_note, (100, 116, 139)))
        if show_expr:
            for key in ("x", "y", "w", "h"):
                expr = (node.get("expr") or {}).get(key)
                if expr:
                    # 图中标注显示为 `88px ⟵ 符号算式 = 数值算式`，数字与出处同时呈现
                    lines.append((f"{node[key]:g}px ⟵ {expr}", font_mono, (100, 116, 139)))

        max_text_w = max(draw.textlength(t, font=f) for t, f, _ in lines)
        box_w = max(min(max_text_w + 8, max(x1 - x0 - 8, 60)), 60)
        box_w = min(box_w, w - x0 - 4)
        total_h = sum(fsize(f) + 3 for _, f, _ in lines) + 6
        box_h = node["h"]
        # 容器（有子节点）的标题固定在顶部，只有叶子盒子才垂直居中
        is_leaf = not node.get("children")
        oy = max((box_h - total_h) / 2, 0) if (center_content and is_leaf) else 0
        draw.rectangle([x0 + 1, y0 + 1 + oy, x0 + 1 + box_w, y0 + 1 + oy + total_h],
                       fill=(255, 255, 255, 205), outline=color + (140,), width=1)
        ty = y0 + 4 + oy
        for text, font, fill in lines:
            draw.text((x0 + 5, ty), truncate(text, font, box_w - 8), font=font, fill=fill)
            ty += fsize(font) + 3

    info = f"{canvas['w']} x {canvas['h']} · {canvas['breakpoint']}"
    if show_canvas_info:
        tw = draw.textlength(info, font=font_dim)
        draw.rectangle([w - tw - 18, 8, w - 8, 30], fill=(15, 23, 42, 210))
        draw.text((w - tw - 13, 12), info, font=font_dim, fill=(248, 250, 252))

    if time_label:
        tw = draw.textlength(time_label, font=font_label)
        draw.rectangle([8, 8, 8 + tw + 20, 32], fill=(124, 58, 237, 230))
        draw.text((18, 12), time_label, font=font_label, fill=(255, 255, 255))

    return img


def main() -> int:
    ap = argparse.ArgumentParser(description="Layout Tree -> PNG（坐标零运算）")
    ap.add_argument("--tree", required=True, help="Layout Tree JSON 路径")
    ap.add_argument("--out", required=True, help="输出 PNG 路径")
    ap.add_argument("--scale", type=float, default=1.0,
                    help="渲染完成后对整图重采样（DPI 级），不参与坐标计算")
    ap.add_argument("--no-expr", action="store_true")
    ap.add_argument("--no-dims", action="store_true")
    ap.add_argument("--no-index", action="store_true")
    ap.add_argument("--no-distances", action="store_true")
    ap.add_argument("--no-canvas-info", action="store_true")
    ap.add_argument("--center-content", action="store_true")
    ap.add_argument("--centers", action="store_true")
    ap.add_argument("--hide", default="", help="逗号分隔的隐藏元素 id")
    ap.add_argument("--time-label", default=None)
    ap.add_argument("--allow-unconfirmed", action="store_true",
                    help="跳过确认闸门（仅供 CI / 示例归档）")
    ap.add_argument("--scope", default=None, help="本次交付范围，如 desktop,mobile")
    args = ap.parse_args()

    if not os.path.exists(args.tree):
        print(f"找不到 Layout Tree: {args.tree}", file=sys.stderr)
        return 1
    require_confirmation(
        project_from_tree(args.tree),
        allow=args.allow_unconfirmed,
        scope=[x for x in (args.scope or "").split(",") if x] or None,
    )
    with open(args.tree, encoding="utf-8") as fh:
        tree = json.load(fh)

    img = draw_tree(
        tree,
        show_expr=not args.no_expr,
        show_distances=not args.no_distances,
        show_dims=not args.no_dims,
        show_index=not args.no_index,
        show_canvas_info=not args.no_canvas_info,
        show_centers=args.centers,
        center_content=args.center_content,
        hidden=[s for s in args.hide.split(",") if s],
        time_label=args.time_label,
    )
    if args.scale != 1.0:
        img = img.resize(
            (int(round(img.width * args.scale)), int(round(img.height * args.scale))),
            Image.LANCZOS,
        )
    if args.allow_unconfirmed:
        img = stamp_preview(img)
    out = preview_path(args.out, args.allow_unconfirmed)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    img.save(out)
    print(f"saved {out}  {img.width}x{img.height}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
