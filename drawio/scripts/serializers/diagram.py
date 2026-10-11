#!/usr/bin/env python3
"""
serializer: diagram — Layout Tree -> 设计过的架构图（PNG）。

与 pil.py 的分工：
  pil.py     线框级，用于核对几何（尺寸 / expr 出处 / 四向距离）
  diagram.py 视觉级，用于交付：圆角卡片、配色分区、字阶、连接线、柔和阴影

**几何仍然全部来自 Layout Tree**：坐标原样读取，本文件不计算任何布局。
设计参数（配色 / 字号 / 圆角）从 `variableSnapshot` 里的设计 token 读取，
所以「为什么是这个蓝」和「为什么页头是 64px」一样可追溯到 variables/。

关于 SS：光栅化超采样倍数（同一常量作用在全部绘制坐标上），
用于让圆角与阴影平滑。它是渲染细节，不改变布局关系，也不是「二次估算」。

用法：
    python3 scripts/serializers/diagram.py --tree layout-tree/desktop.json --out poster.png
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _gate import require_confirmation, project_from_tree, preview_path, stamp_preview  # noqa: E402
from _visual import hex_rgb, mix, linear_gradient, rounded_paste, soft_shadow, resolve_fonts  # noqa: E402

from PIL import Image, ImageDraw, ImageFont

SS = 2  # 光栅化超采样倍数
FONT_REGULAR = [
    "C:/Windows/Fonts/msyh.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
FONT_BOLD = [
    "C:/Windows/Fonts/msyhbd.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def _font_path(cands):
    for p in cands:
        if os.path.exists(p):
            return p
    return None


_FR = _font_path(FONT_REGULAR)
_FB = _font_path(FONT_BOLD) or _FR
_cache: dict[tuple[int, bool], ImageFont.FreeTypeFont] = {}


def _apply_font_token(chain: str | None) -> None:
    """FONT_FAMILY token 优先：回退链里第一个本机存在的字体族胜出。"""
    global _FR, _FB
    reg, bold = resolve_fonts(chain)
    if reg:
        _FR, _FB = reg, bold or reg


def font(size: float, bold: bool = False) -> ImageFont.FreeTypeFont:
    key = (int(round(size * SS)), bold)
    if key not in _cache:
        path = _FB if bold else _FR
        _cache[key] = ImageFont.truetype(path, key[0]) if path else ImageFont.load_default()
    return _cache[key]


def flatten(nodes, ancestors=None, out=None):
    ancestors = ancestors or []
    out = out if out is not None else []
    for n in nodes:
        out.append((n, ancestors))
        flatten(n.get("children", []), ancestors + [n["id"]], out)
    return out


def section_color(snapshot: dict, top_id: str):
    key = f"COLOR_{str(top_id).upper()}"
    if key in snapshot:
        return hex_rgb(str(snapshot[key]))
    return hex_rgb(str(snapshot.get("COLOR_INK", "#0F172A")))


def draw_diagram(tree: dict, footer: str | None = None) -> Image.Image:
    snap = tree.get("variableSnapshot", {})
    canvas = tree["canvas"]
    W, H = int(round(canvas["w"])) * SS, int(round(canvas["h"])) * SS

    ink = hex_rgb(snap.get("COLOR_INK", "#0F172A"))
    ink_soft = hex_rgb(snap.get("COLOR_INK_SOFT", "#475569"))
    ink_faint = hex_rgb(snap.get("COLOR_INK_FAINT", "#94A3B8"))
    bg = hex_rgb(snap.get("COLOR_CANVAS", "#F7F9FC"))
    surface = hex_rgb(snap.get("COLOR_SURFACE", "#FFFFFF"))
    border = hex_rgb(snap.get("COLOR_BORDER", "#E4E9F2"))

    t_display = float(snap.get("TYPE_DISPLAY", 28))
    t_section = float(snap.get("TYPE_SECTION", 15))
    t_item = float(snap.get("TYPE_ITEM", 13.5))
    t_note = float(snap.get("TYPE_NOTE", 11.5))
    t_caption = float(snap.get("TYPE_CAPTION", 10.5))
    r_section = int(snap.get("RADIUS_SECTION", 14))
    r_item = int(snap.get("RADIUS_ITEM", 10))
    accent_w = int(snap.get("RADIUS_ACCENT", 3))

    # 视觉 token：阴影分级 / 渐变 / 字体链（缺项走默认，向后兼容老归档树）
    _apply_font_token(snap.get("FONT_FAMILY"))
    grad_angle = float(snap.get("GRADIENT_ANGLE", 120))
    card_mix = float(snap.get("GRADIENT_CARD_MIX", 0.06))

    def shadow_token(level):
        return (
            float(snap.get(f"SHADOW_{level}_DY", 0)) * SS,
            float(snap.get(f"SHADOW_{level}_BLUR", 0)) * SS,
            float(snap.get(f"SHADOW_{level}_ALPHA", 0)),
        )

    img = Image.new("RGBA", (W, H), bg + (255,))
    d = ImageDraw.Draw(img, "RGBA")
    P = lambda v: int(round(v * SS))  # noqa: E731  仅做超采样缩放

    def rrect(node, radius, fill, outline=None, width=1):
        d.rounded_rectangle(
            [P(node["x"]), P(node["y"]), P(node["x"] + node["w"]), P(node["y"] + node["h"])],
            radius=int(radius * SS),
            fill=fill,
            outline=outline,
            width=int(width * SS),
        )

    def shadow(node, radius, level):
        dy, blur, alpha = shadow_token(level)
        soft_shadow(
            img,
            [P(node["x"]), P(node["y"]), P(node["x"] + node["w"]), P(node["y"] + node["h"])],
            radius * SS, dy, blur, alpha,
        )

    def card_fill(node, radius, c1, c2, outline=None, width=1):
        """渐变填充卡片：渐变位图按圆角蒙版贴上，再描边（描边仍走 draw，保证发丝线锐利）。"""
        box = [P(node["x"]), P(node["y"]), P(node["x"] + node["w"]), P(node["y"] + node["h"])]
        grad = linear_gradient((box[2] - box[0], box[3] - box[1]), c1, c2, grad_angle)
        rounded_paste(img, grad, box, radius * SS)
        d.rounded_rectangle(box, radius=int(radius * SS), outline=outline, width=int(width * SS))

    def text(x, y, s, f, fill, anchor="la"):
        d.text((P(x), P(y)), str(s), font=f, fill=fill, anchor=anchor)

    def text_len(s, f):
        return d.textlength(str(s), font=f) / SS

    def truncate(s, f, maxw):
        s = str(s)
        if text_len(s, f) <= maxw:
            return s
        while s and text_len(s + "…", f) > maxw:
            s = s[:-1]
        return s + "…"

    # ── 画布底纹：极淡的分区色晕染，避免纯色发闷 ──
    for top in tree["elements"]:
        if top["id"] == "title":
            continue
        c = section_color(snap, top["id"])
        rrect(top, r_section, mix(bg, c, 0.09))

    for top in tree["elements"]:
        # ── 标题带 ──
        if top["id"] == "title":
            pad = (top["h"] - t_display) / 2
            text(top["x"], top["y"] + pad - t_display * 0.22, top["label"], font(t_display, True), ink)
            note = top.get("note") or []
            if note:
                text(top["x"], top["y"] + pad + t_display * 0.95, note[0], font(t_note), ink_soft)
            # 右上角：画布规格徽标
            badge = f"{canvas['w']} × {canvas['h']}  ·  {canvas['breakpoint']}"
            bf = font(t_caption, True)
            bw, bh = text_len(badge, bf) + 22, t_caption + 14
            bx, by = top["x"] + top["w"] - bw, top["y"] + (top["h"] - bh) / 2
            sdy, sblur, salpha = shadow_token("ELEV3")
            soft_shadow(img, [P(bx), P(by), P(bx + bw), P(by + bh)], bh / 2 * SS, sdy, sblur, salpha)
            # 强调面：accent → accentDeep 渐变（accentDeep 的唯一消费点，与 token 文档对应）
            header_c = hex_rgb(str(snap.get("COLOR_HEADER", "#0F172A")))
            deep_c = hex_rgb(str(snap.get("COLOR_ACCENT_DEEP", "#1E293B")))
            badge_box = [P(bx), P(by), P(bx + bw), P(by + bh)]
            badge_grad = linear_gradient((badge_box[2] - badge_box[0], badge_box[3] - badge_box[1]),
                                         header_c, deep_c, grad_angle)
            rounded_paste(img, badge_grad, badge_box, bh / 2 * SS)
            text(bx + bw / 2, by + bh / 2, badge, bf, (248, 250, 252), anchor="mm")
            continue

        sc = section_color(snap, top["id"])
        shadow(top, r_section, "ELEV2")
        card_fill(top, r_section, surface, mix(surface, sc, card_mix), outline=border, width=1)
        # 区块标题：色点 + 标题 + 发丝线
        dot_r = t_section * 0.32
        cy = top["y"] + snapshot_head_center(top, snap, t_section)
        d.ellipse([P(top["x"] + 22 - dot_r), P(cy - dot_r), P(top["x"] + 22 + dot_r), P(cy + dot_r)], fill=sc)
        sf = font(t_section, True)
        text(top["x"] + 22 + dot_r + 10, cy - t_section * 0.62, top["label"], sf, ink)
        label_end = top["x"] + 22 + dot_r + 10 + text_len(top["label"], sf) + 14
        rule_y = cy
        d.line([P(label_end), P(rule_y), P(top["x"] + top["w"] - 22), P(rule_y)],
               fill=mix(border, sc, 0.35), width=max(1, SS))

        # ── 子项卡片 ──
        children = top.get("children") or []
        for i, item in enumerate(children):
            shadow(item, r_item, "ELEV1")
            card_fill(item, r_item, surface, mix(surface, sc, card_mix * 0.7),
                      outline=mix(border, sc, 0.18), width=1)
            # 左侧强调条（圆角对齐卡片）
            ax0, ay0 = item["x"], item["y"]
            d.rounded_rectangle(
                [P(ax0), P(ay0), P(ax0 + accent_w), P(ay0 + item["h"])],
                radius=int(accent_w / 2 * SS), fill=sc,
            )
            pad_x = accent_w + 12
            inner_w = item["w"] - pad_x - 12
            if show_notes := bool(item.get("note")):
                f_item = font(t_item, True)
                f_note = font(t_note)
                # 卡片很宽时说明文字分栏，避免右侧大片空白
                # 阈值与栏距都由字阶推导，渲染器里不出现与设计无关的魔数
                cols = 2 if inner_w > t_note * 34 else 1
                col_gap = t_note * 2
                col_w = (inner_w - col_gap * (cols - 1)) / cols
                per = -(-len(item["note"]) // cols)
                groups = [item["note"][i : i + per] for i in range(0, len(item["note"]), per)]
                rows = max(len(g) for g in groups)
                block_h = t_item + 6 + rows * (t_note + 4)
                ty = item["y"] + max((item["h"] - block_h) / 2, 6)
                text(ax0 + pad_x, ty, truncate(item["label"], f_item, inner_w), f_item, ink)
                for ci, group in enumerate(groups):
                    gx = ax0 + pad_x + ci * (col_w + col_gap)
                    gy = ty + t_item + 6
                    for ln in group:
                        text(gx, gy, truncate(ln, f_note, col_w), f_note, ink_soft)
                        gy += t_note + 4
            else:
                f_item = font(t_item, True)
                text(ax0 + pad_x, item["y"] + item["h"] / 2, truncate(item["label"], f_item, inner_w),
                     f_item, ink, anchor="lm")
            void = show_notes

            # 同行相邻卡片之间画一个居中的雪佛龙（间隙只有 GAP 宽，线+箭头会显得局促）
            nxt = children[i + 1] if i + 1 < len(children) else None
            if nxt and abs(nxt["y"] - item["y"]) < 1 and nxt["x"] > item["x"] + item["w"]:
                gap_x0, gap_x1 = item["x"] + item["w"], nxt["x"]
                my = item["y"] + item["h"] / 2
                cxx = (gap_x0 + gap_x1) / 2
                arm = min((gap_x1 - gap_x0) * 0.28, item["h"] * 0.14)
                col = mix(sc, ink_soft, 0.25)
                d.line([P(cxx - arm), P(my - arm), P(cxx + arm * 0.35), P(my)],
                       fill=col, width=max(1, int(1.6 * SS)), joint="curve")
                d.line([P(cxx - arm), P(my + arm), P(cxx + arm * 0.35), P(my)],
                       fill=col, width=max(1, int(1.6 * SS)), joint="curve")
        void = children

    # ── 脚注 ──
    if footer:
        text(tree["elements"][0]["x"], canvas["h"] - t_caption - 12, footer, font(t_caption), ink_faint)

    return img.resize((int(round(canvas["w"])), int(round(canvas["h"]))), Image.LANCZOS).convert("RGB")


def snapshot_head_center(node: dict, snap: dict, t_section: float) -> float:
    """区块标题的垂直中心 —— 由「子项起始 y」反推，不写死常量。"""
    children = node.get("children") or []
    if children:
        head_span = children[0]["y"] - node["y"]
        return max(head_span / 2, t_section)
    return t_section


def main() -> int:
    ap = argparse.ArgumentParser(description="Layout Tree -> 设计版架构图（PNG）")
    ap.add_argument("--tree", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--footer", default=None)
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

    footer = args.footer
    if footer is None:
        footer = f"rendered from {os.path.basename(args.tree)} · geometry verbatim from Layout Tree"
    img = draw_diagram(tree, footer=footer)
    if args.allow_unconfirmed:
        img = stamp_preview(img)
    out = preview_path(args.out, args.allow_unconfirmed)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    img.save(out)
    print(f"saved {out}  {img.width}x{img.height}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
