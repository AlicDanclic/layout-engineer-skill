#!/usr/bin/env python3
"""
_visual — Python 渲染通道的共享视觉 primitives。

为什么独立成模块：
    diagram.py（交付海报）与 drawio_png.py（.drawio 同源 PNG）是两条渲染通道，
    渐变 / 柔影 / 字体解析若各写一份就会分叉——「同一个 token 两种画法」。
    这里只做**视觉**计算（颜色插值 / 高斯模糊 / 字体回退），不碰任何布局几何：
    所有坐标都是调用方从 Layout Tree / XML 原样取来的。

公开接口：
    hex_rgb / mix                     颜色工具
    linear_gradient(size, c1, c2, angle)  线性渐变位图（angle：0=自上而下，顺时针）
    rounded_paste(img, fill, box, radius) 把填充位图按圆角蒙版贴上画布
    soft_shadow(img, box, radius, dy, blur, alpha)  真高斯模糊投影（离屏图层合成）
    resolve_fonts(chain)              FONT token 的字体族回退链 → (regular, bold) 文件路径
"""
from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFilter

# ── 颜色 ─────────────────────────────────────────────────────────────────


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = str(h).lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def mix(c1, c2, t: float):
    return tuple(int(round(a + (b - a) * t)) for a, b in zip(c1, c2))


# ── 渐变 ─────────────────────────────────────────────────────────────────

# mxGraph gradientDirection → 本模块 angle（0=自上而下，顺时针）
DIRECTION_ANGLE = {"south": 0, "east": 90, "north": 180, "west": 270}


def linear_gradient(size, c1, c2, angle: float = 0) -> Image.Image:
    """生成 size 的线性渐变位图：angle=0 时 c1 在上、c2 在下，顺时针旋转。

    实现：先做一张对角线长度的竖向渐变，旋转后中心裁剪，
    这样任意角度下四角都被覆盖，不留白边。
    """
    w, h = max(1, int(round(size[0]))), max(1, int(round(size[1])))
    side = int((w * w + h * h) ** 0.5) + 2
    mask = Image.linear_gradient("L").resize((side, side))
    # PIL rotate 逆时针为正；angle 定义为顺时针，故取负
    mask = mask.rotate(-float(angle), resample=Image.BICUBIC)
    left, top = (side - w) // 2, (side - h) // 2
    mask = mask.crop((left, top, left + w, top + h))
    return Image.composite(Image.new("RGB", (w, h), c2), Image.new("RGB", (w, h), c1), mask)


def rounded_paste(img: Image.Image, fill: Image.Image, box, radius: float) -> None:
    """把 fill 位图按圆角矩形蒙版贴到 img 的 box 区域（box 为 [x0,y0,x1,y1]）。"""
    x0, y0, x1, y1 = (int(round(v)) for v in box)
    w, h = max(1, x1 - x0), max(1, y1 - y0)
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=int(round(radius)), fill=255)
    img.paste(fill.resize((w, h)) if fill.size != (w, h) else fill, (x0, y0), mask)


# ── 柔影 ─────────────────────────────────────────────────────────────────


def soft_shadow(img: Image.Image, box, radius: float, dy: float, blur: float, alpha: float,
                color=(15, 23, 42)) -> None:
    """真高斯模糊投影：形状画在离屏 RGBA 层上，模糊后合成回 img（img 须为 RGBA）。

    与「偏移半透明矩形」的本质区别：模糊让投影边缘有衰减，
    这是卡片看起来「浮起来」而不是「描了圈灰边」的关键。
    """
    if alpha <= 0:
        return
    x0, y0, x1, y1 = (float(v) for v in box)
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(
        [x0, y0 + float(dy), x1, y1 + float(dy)],
        radius=int(round(radius)),
        fill=tuple(color) + (int(round(alpha)),),
    )
    if blur > 0:
        layer = layer.filter(ImageFilter.GaussianBlur(float(blur)))
    img.alpha_composite(layer)


# ── 字体族回退链 ──────────────────────────────────────────────────────────

# 已知字体族 → 各平台候选文件（regular, bold）。bold 为 None 时回退 regular。
FONT_REGISTRY: dict[str, list[tuple[str, str | None]]] = {
    "MiSans": [
        ("C:/Windows/Fonts/MiSans-Regular.ttf", "C:/Windows/Fonts/MiSans-Bold.ttf"),
        ("/usr/share/fonts/misans/MiSans-Regular.ttf", "/usr/share/fonts/misans/MiSans-Bold.ttf"),
    ],
    "PingFang SC": [
        ("/System/Library/Fonts/PingFang.ttc", None),
    ],
    "Microsoft YaHei": [
        ("C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/msyhbd.ttc"),
    ],
    "Noto Sans CJK SC": [
        ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
         "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"),
        ("/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
         "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Bold.otf"),
    ],
    "WenQuanYi Micro Hei": [
        ("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc", None),
    ],
    "DejaVu Sans": [
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ],
}


def resolve_fonts(chain: str | None) -> tuple[str | None, str | None]:
    """把「MiSans,PingFang SC,...,sans-serif」这样的回退链解析成 (regular, bold) 文件路径。

    按链中顺序找第一个在本机存在的字体族；通用族名（sans-serif 等）跳过，
    找不到任何候选时返回 (None, None)，由调用方走自己的兜底列表。
    """
    for name in str(chain or "").split(","):
        name = name.strip()
        if not name or name.endswith("-serif") or name in ("monospace", "system-ui"):
            continue
        for reg, bold in FONT_REGISTRY.get(name, []):
            if os.path.exists(reg):
                return reg, (bold if bold and os.path.exists(bold) else reg)
    return None, None
