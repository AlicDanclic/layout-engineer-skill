#!/usr/bin/env python3
"""
serializer: drawio_png — 把生成的 .drawio（mxGraph XML）渲染成 PNG。

**为什么解析 XML 而不是读 Layout Tree：**
    drawio 规范要求「PNG 与 XML 严格一致」。若 PNG 另行读树，就存在两条渲染路径
    （树→XML、树→PNG），两边一旦分叉就没人发现。这里只读 XML，
    XML 是唯一的渲染输入，同源保证由结构给出，而不是靠人去核对。

**铁律：零几何计算。** 每个 mxCell 的 x/y/width/height 原样使用；
`--scale` 是渲染完成后对整图重采样（DPI 级），不参与坐标计算。

连线端点由 `source`/`target` 的几何 + `exitX/exitY/entryX/entryY`（归一化分数）
推出——这两者都写在 XML 里，所以仍是「读 XML」，不是「算布局」。

依赖 Pillow：pip install Pillow
用法：
    python3 scripts/serializers/drawio_png.py --drawio drawio/hwsync.drawio --out drawio/hwsync.png
"""
from __future__ import annotations

import argparse
import base64
import io
import math
import os
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _gate import require_confirmation, layer_root, skill_root, preview_path, stamp_preview  # noqa: E402
from _visual import linear_gradient, rounded_paste, soft_shadow, resolve_fonts, DIRECTION_ANGLE  # noqa: E402

from PIL import Image, ImageDraw, ImageFont

SS = 2  # 光栅化超采样倍数

FONT_REGULAR = [
    "C:/Windows/Fonts/msyh.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
FONT_BOLD = [
    "C:/Windows/Fonts/msyhbd.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Bold.otf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def _pick(cands):
    for p in cands:
        if os.path.exists(p):
            return p
    return None


_FR = _pick(FONT_REGULAR)
_FB = _pick(FONT_BOLD) or _FR
_font_cache: dict[tuple[int, bool], ImageFont.FreeTypeFont] = {}

# 图标位图缓存：路径 → PIL.Image
_icon_cache: dict[str, Image.Image] = {}

# 渲染上下文（由 render() 注入）：划线器与目标位图，供内部辅助函数共享
draw_ctx: ImageDraw.ImageDraw | None = None
_image: Image.Image | None = None


def font(size: float, bold: bool = False) -> ImageFont.FreeTypeFont:
    key = (max(1, int(round(size * SS))), bold)
    if key not in _font_cache:
        path = _FB if bold else _FR
        _font_cache[key] = ImageFont.truetype(path, key[0]) if path else ImageFont.load_default()
    return _font_cache[key]


# ── 样式解析 ─────────────────────────────────────────────────────────────


def parse_style(style: str | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in (style or "").split(";"):
        if not part:
            continue
        if "=" in part:
            k, v = part.split("=", 1)
            out[k] = v
        else:
            out[part] = "1"
    return out


def color_of(value: str | None, default=None):
    if not value or value in ("none", "default"):
        return None if value == "none" else default
    v = value.lstrip("#")
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    try:
        return tuple(int(v[i : i + 2], 16) for i in (0, 2, 4))
    except (ValueError, IndexError):
        return default


# ── 几何读取（原样取 XML，不做布局计算）──────────────────────────────────


def cell_rect(cell: ET.Element):
    geo = cell.find("mxGeometry")
    if geo is None:
        return None
    return (
        float(geo.get("x", "0")),
        float(geo.get("y", "0")),
        float(geo.get("width", "0")),
        float(geo.get("height", "0")),
    )


def edge_points(cell: ET.Element):
    geo = cell.find("mxGeometry")
    if geo is None:
        return []
    arr = geo.find("Array")
    if arr is None:
        return []
    return [(float(p.get("x", "0")), float(p.get("y", "0"))) for p in arr.findall("mxPoint")]


def anchor_on(rect, style, kind):
    """kind="exit" 取源端分数（exitX/exitY），kind="entry" 取目标端（entryX/entryY）。

    两者必须分开取：exit/entry 的分数可以不同（例如从 S 边出发、从 N 边进入），
    都按源端取会把箭头画到目标节点的错误边上。
    """
    dx = float(style.get("exitX", "0.5")) if kind == "exit" else float(style.get("entryX", "0.5"))
    dy = float(style.get("exitY", "1")) if kind == "exit" else float(style.get("entryY", "0"))
    return (rect[0] + rect[2] * dx, rect[1] + rect[3] * dy)


# ── 绘制 ─────────────────────────────────────────────────────────────────


def draw_polyline(draw, pts, color, width, dashed):
    if dashed:
        for i in range(len(pts) - 1):
            dash_segment(draw, pts[i], pts[i + 1], color, width)
    else:
        draw.line(pts, fill=color, width=width, joint="curve")


def dash_segment(draw, p, q, color, width, dash=None, gap=None):
    dash = 6.0 * SS if dash is None else dash
    gap = 5.0 * SS if gap is None else gap
    dx, dy = q[0] - p[0], q[1] - p[1]
    length = math.hypot(dx, dy)
    if length == 0:
        return
    ux, uy = dx / length, dy / length
    t = 0.0
    while t < length:
        t2 = min(t + dash, length)
        draw.line(
            [(p[0] + ux * t, p[1] + uy * t), (p[0] + ux * t2, p[1] + uy * t2)],
            fill=color, width=width,
        )
        t = t2 + gap


def arrow_head(draw, tip, toward, color, size=9.0):
    """在 tip 处画实心三角，方向从 tip 指向 toward 的反方向。"""
    ang = math.atan2(tip[1] - toward[1], tip[0] - toward[0])
    spread = math.radians(24)
    a = (tip[0] - size * math.cos(ang - spread), tip[1] - size * math.sin(ang - spread))
    b = (tip[0] - size * math.cos(ang + spread), tip[1] - size * math.sin(ang + spread))
    draw.polygon([tip, a, b], fill=color)


def rounded(box, radius, dashed, fill, outline, width):
    if dashed:
        # PIL 没有虚线圆角矩形：先画填充，再用虚线沿轮廓描边
        if fill:
            draw_ctx.rounded_rectangle(box, radius=radius, fill=fill)
        if outline:
            dash_round_outline(box, radius, outline, width)
    else:
        draw_ctx.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def dash_round_outline(box, radius, color, width):
    x0, y0, x1, y1 = box
    pts = [(x0 + radius, y0), (x1 - radius, y0), (x1, y0 + radius), (x1, y1 - radius),
           (x1 - radius, y1), (x0 + radius, y1), (x0, y1 - radius), (x0, y0 + radius),
           (x0 + radius, y0)]
    for i in range(len(pts) - 1):
        dash_segment(draw_ctx, pts[i], pts[i + 1], color, width)


def cylinder(box, dashed, fill, outline, width):
    """数据库/存储柱体：底椭圆 + 柱身 + 顶椭圆（顶盖留一道弧线）。"""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    ry = min(w * 0.05, h * 0.2)
    d = draw_ctx
    d.ellipse([x0, y1 - 2 * ry, x1, y1], fill=fill, outline=outline, width=width)
    d.rectangle([x0, y0 + ry, x1, y1 - ry], fill=fill)
    d.line([(x0, y0 + ry), (x0, y1 - ry)], fill=outline, width=width)
    d.line([(x1, y0 + ry), (x1, y1 - ry)], fill=outline, width=width)
    d.ellipse([x0, y0, x1, y0 + 2 * ry], fill=fill, outline=outline, width=width)
    d.arc([x0, y0 + ry, x1, y0 + 3 * ry], start=0, end=180, fill=outline, width=width)


def polygon_shape(box, kind, fill, outline, width):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d = draw_ctx
    if kind == "hexagon":
        notch = w * 0.14
        pts = [(x0 + notch, y0), (x1 - notch, y0), (x1, y0 + h / 2),
               (x1 - notch, y1), (x0 + notch, y1), (x0, y0 + h / 2)]
    elif kind == "parallelogram":
        skew = w * 0.12
        pts = [(x0 + skew, y0), (x1, y0), (x1 - skew, y1), (x0, y1)]
    else:  # process
        inset = w * 0.06
        pts = [(x0 + inset, y0), (x1 - inset, y0), (x1, y0 + h / 2),
               (x1 - inset, y1), (x0 + inset, y1), (x0, y0 + h / 2)]
    d.polygon(pts, fill=fill)
    if outline:
        d.line(pts + [pts[0]], fill=outline, width=width, joint="curve")
    if kind == "process":
        inset = w * 0.06
        d.line([(x0 + inset, y0), (x0 + inset, y1)], fill=outline, width=width)
        d.line([(x1 - inset, y0), (x1 - inset, y1)], fill=outline, width=width)


def wrap_lines(d, text, f, max_w):
    out = []
    for raw in str(text).split("\n"):
        if not raw:
            out.append("")
            continue
        line = ""
        for ch in raw:
            if d.textlength(line + ch, font=f) > max_w and line:
                out.append(line)
                line = ch
            else:
                line += ch
        out.append(line)
    return out


def load_icon(cell: ET.Element, style: dict) -> "Image.Image | None":
    """读取图标位图。

    优先用 mxCell 上的 leIconRaster（配套 PNG）：它与 .drawio 里内嵌的 SVG 来自
    同一套素材的两个格式，因此「PNG 与 XML 一致」是素材级保证，而不是人去比对。
    没有 leIconRaster 时，回退解析 style 里内嵌的位图 data URI。
    """
    raster = cell.get("leIconRaster")
    if raster:
        p = os.path.join(layer_root(), "assets", "icons", raster)
        if p not in _icon_cache:
            _icon_cache[p] = Image.open(p).convert("RGBA") if os.path.exists(p) else None
        if _icon_cache[p] is not None:
            return _icon_cache[p]
    uri = style.get("image") or ""
    if uri.startswith("data:") and ";base64," in uri:
        try:
            _, b64 = uri.split(",", 1)
            return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGBA")
        except Exception:
            return None
    return None


def paste_icon(img: Image.Image, box):
    """把图标按纵横比缩放后居中贴进 box（box 已是 SS 超采样坐标）。"""
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    iw, ih = img.size
    if iw <= 0 or ih <= 0:
        return
    scale = min(bw / iw, bh / ih)
    nw, nh = max(1, int(round(iw * scale))), max(1, int(round(ih * scale)))
    resized = img.resize((nw, nh), Image.LANCZOS)
    _image.paste(resized, (int(round(x0 + (bw - nw) / 2)), int(round(y0 + (bh - nh) / 2))), resized)


def draw_vertex(cell: ET.Element):
    rect = cell_rect(cell)
    if rect is None:
        return
    style = parse_style(cell.get("style"))
    value = cell.get("value") or ""
    x, y, w, h = rect
    fill = color_of(style.get("fillColor"))
    outline = color_of(style.get("strokeColor"))
    dashed = style.get("dashed") == "1"
    width = int(round(float(style.get("strokeWidth", "1")) * SS)) or SS
    size = float(style.get("fontSize", "12"))
    bold = style.get("fontStyle") == "1"
    fg = color_of(style.get("fontColor"), (31, 42, 61))
    box = [x * SS, y * SS, (x + w) * SS, (y + h) * SS]

    shape = style.get("shape")
    if shape == "image":
        # 技术栈图标：只画图片，不写字。
        # 素材来自技能自带 assets/icons/ 里的配套位图（leIconRaster）；
        # 若 XML 里直接内嵌了位图 data URI，也能解码作为回退。
        img = load_icon(cell, style)
        if img is not None:
            paste_icon(img, box)
        return
    if shape == "line":
        # 图例里的线型样例：盒内一条水平线段（实线 / 虚线）
        ymid = (box[1] + box[3]) / 2
        col = outline or (31, 42, 61)
        if dashed:
            dash_segment(draw_ctx, (box[0], ymid), (box[2], ymid), col, width)
        else:
            draw_ctx.line([(box[0], ymid), (box[2], ymid)], fill=col, width=width)
        return
    if shape == "ellipse":
        draw_ctx.ellipse(box, fill=fill, outline=outline, width=width)
    elif shape == "cylinder3":
        cylinder(box, dashed, fill, outline, width)
    elif shape in ("hexagon", "parallelogram", "process"):
        polygon_shape(box, shape, fill, outline, width)
    else:
        arc_pct = float(style.get("arcSize", "0")) if style.get("rounded") == "1" else 0.0
        arc = arc_pct / 100.0 * min(w, h) * SS
        # 阴影：shadow=1 时按 leShadow* 自定义参数绘制真高斯柔影（画在形状之下）。
        # 参数由 drawio.mjs 从快照 token 写进 XML，因此 PNG 仍然是「只读 XML」。
        if style.get("shadow") == "1":
            soft_shadow(
                _image, box, arc,
                float(style.get("leShadowDy", "2")) * SS,
                float(style.get("leShadowBlur", "8")) * SS,
                float(style.get("leShadowAlpha", "26")),
            )
        grad = color_of(style.get("gradientColor"))
        if grad and fill and not dashed:
            # 渐变填充：fillColor → gradientColor，方向映射与 mxGraph 一致
            angle = DIRECTION_ANGLE.get(style.get("gradientDirection", "south"), 0)
            g = linear_gradient((box[2] - box[0], box[3] - box[1]), fill, grad, angle)
            rounded_paste(_image, g, box, arc)
            if outline:
                draw_ctx.rounded_rectangle(box, radius=arc, outline=outline, width=width)
        else:
            rounded(box, arc, dashed, fill, outline, width)

    if value:
        f = font(size, bold)
        pad = 6.0
        align = style.get("align", "center")
        # 左对齐时尊重 spacingLeft（drawio 用它把「有图标的卡片」文字右移；
        # 默认 8px 与 drawio.mjs 的 align=left;spacingLeft=10 保持一致）
        left_inset = float(style.get("spacingLeft", "10")) if align == "left" else pad
        lines = wrap_lines(draw_ctx, value, f, max((w - left_inset - pad) * SS, 10))
        line_h = size * 1.35 * SS
        block_h = line_h * len(lines)
        valign = style.get("verticalAlign", "middle")
        if valign == "top":
            ty = y * SS + 6 * SS
        elif valign == "bottom":
            ty = (y + h) * SS - block_h - 4 * SS
        else:
            ty = y * SS + (h * SS - block_h) / 2
        for line in lines:
            tw = draw_ctx.textlength(line, font=f)
            if align == "left":
                tx = x * SS + left_inset * SS
            elif align == "right":
                tx = (x + w) * SS - tw - 8 * SS
            else:
                tx = x * SS + (w * SS - tw) / 2
            if style.get("horizontal") == "0":
                draw_rotated_text(line, f, tx, ty, fg)
            else:
                draw_ctx.text((tx, ty), line, font=f, fill=fg)
            ty += line_h


def draw_rotated_text(text, f, x, y, fill):
    """文字旋转 90°（竖向长条节点）：先画到透明层再转，避免多行竖排。"""
    w = int(draw_ctx.textlength(text, font=f)) + 4
    h = int(f.size) + 6
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((2, 2), text, font=f, fill=fill)
    layer = layer.rotate(90, expand=True)
    global _image
    _image.paste(layer, (int(x), int(y)), layer)


def draw_edge(cell: ET.Element, cells: dict):
    style = parse_style(cell.get("style"))
    src = cells.get(cell.get("source"))
    dst = cells.get(cell.get("target"))
    pts = []
    if src is not None:
        r = cell_rect(src)
        if r:
            pts.append(anchor_on(r, style, "exit"))
    pts.extend(edge_points(cell))
    if dst is not None:
        r = cell_rect(dst)
        if r:
            pts.append(anchor_on(r, style, "entry"))
    if len(pts) < 2:
        return
    color = color_of(style.get("strokeColor"), (6, 82, 121))
    w = int(round(float(style.get("strokeWidth", "1")) * SS)) or SS
    dashed = style.get("dashed") == "1"
    scaled = [(p[0] * SS, p[1] * SS) for p in pts]
    draw_polyline(draw_ctx, scaled, color, w, dashed)
    if style.get("endArrow", "block") != "none":
        arrow_head(draw_ctx, scaled[-1], scaled[-2], color, 9.0 * SS)
    if style.get("startArrow") == "block":
        arrow_head(draw_ctx, scaled[0], scaled[1], color, 9.0 * SS)


def _apply_xml_fonts(root: ET.Element) -> None:
    """XML 里 fontFamily 优先：按 token 声明的字体族回退链解析本机字体文件。"""
    global _FR, _FB
    families: list[str] = []
    for c in root.findall("mxCell"):
        fam = parse_style(c.get("style")).get("fontFamily")
        if fam and fam not in families:
            families.append(fam)
    reg, bold = resolve_fonts(",".join(families))
    if reg:
        _FR, _FB = reg, bold or reg


def render(drawio_path: str) -> Image.Image:
    global draw_ctx, _image
    tree = ET.parse(drawio_path)
    model = tree.getroot().find(".//mxGraphModel")
    if model is None:
        raise SystemExit("XML 里找不到 mxGraphModel")
    w = int(round(float(model.get("pageWidth", "1000"))))
    h = int(round(float(model.get("pageHeight", "1000"))))

    root = model.find("root")
    _apply_xml_fonts(root)
    cells = {c.get("id"): c for c in root.findall("mxCell")}
    ordered = [c for c in root.findall("mxCell") if c.get("id") not in (None, "0", "1")]

    _image = Image.new("RGBA", (w * SS, h * SS), (255, 255, 255, 255))
    draw_ctx = ImageDraw.Draw(_image, "RGBA")

    # 文档顺序即 z 序：drawio.mjs 先输出容器，再节点，再连线，最后连线标签。
    for cell in ordered:
        if cell.get("vertex") == "1":
            draw_vertex(cell)
        elif cell.get("edge") == "1":
            draw_edge(cell, cells)

    return _image.resize((w, h), Image.LANCZOS).convert("RGB")


def project_from_drawio(path: str) -> str:
    """<project>/drawio/<bp>.drawio → <project>。"""
    return os.path.dirname(os.path.dirname(os.path.abspath(path)))


def main() -> int:
    ap = argparse.ArgumentParser(description=".drawio (mxGraph XML) -> PNG（坐标零运算）")
    ap.add_argument("--drawio", required=True, help="输入 .drawio 路径")
    ap.add_argument("--out", required=True, help="输出 PNG 路径")
    ap.add_argument("--scale", type=float, default=1.0,
                    help="渲染完成后对整图重采样（DPI 级），不参与坐标计算")
    ap.add_argument("--allow-unconfirmed", action="store_true", help="跳过确认闸门（仅供 CI / 示例归档）")
    ap.add_argument("--scope", default=None, help="本次交付范围")
    args = ap.parse_args()

    if not os.path.exists(args.drawio):
        print(f"找不到 .drawio: {args.drawio}", file=sys.stderr)
        return 1
    if not _FR:
        print("drawio_png：系统里找不到可用字体（Noto Sans CJK / 文泉驿 / DejaVu），拒绝渲染以免出豆腐块",
              file=sys.stderr)
        return 1

    # Python 序列化器同样受确认闸门管辖，不能从后门出图
    require_confirmation(
        project_from_drawio(args.drawio),
        allow=args.allow_unconfirmed,
        scope=[x for x in (args.scope or "").split(",") if x] or None,
    )

    img = render(args.drawio)
    if args.scale != 1.0:
        img = img.resize((int(round(img.width * args.scale)), int(round(img.height * args.scale))), Image.LANCZOS)
    if args.allow_unconfirmed:
        img = stamp_preview(img)
    out = preview_path(args.out, args.allow_unconfirmed)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    img.save(out)
    print(f"saved {out}  {img.width}x{img.height}  ({os.path.relpath(args.drawio, skill_root())})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
