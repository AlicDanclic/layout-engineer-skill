"""
serializers/_gate.py — Python 序列化器的确认闸门。

为什么需要：JS 序列化器（react / remotion / preview）各自调 gate.mjs，
但 Python 渲染器（diagram.py / pil.py）此前**完全没有闸门**——
`python3 scripts/serializers/diagram.py --tree ...` 可以绕开一切确认直接出图。
这等于把闸门开在了后门。

做法：复用同一份判定逻辑（check-confirmation.mjs），而不是在 Python 里重写一遍哈希，
避免「两套算法各说各话」。
"""
from __future__ import annotations

import os
import subprocess
import sys


def layer_root() -> str:
    """绘制层根目录 <skill>/drawio。"""
    here = os.path.dirname(os.path.abspath(__file__))      # drawio/scripts/serializers
    return os.path.dirname(os.path.dirname(here))          # <skill>/drawio


def skill_root() -> str:
    """整个技能根目录 <skill>（绘制层与计算层的共同父目录）。"""
    return os.path.dirname(layer_root())                   # <skill>


# 未确认预览产物的文件名前缀；交付只认没有这个前缀的文件。
PREVIEW_MARK = "PREVIEW-"


def preview_path(file: str, allow: bool) -> str:
    """未确认时给产物路径加 `PREVIEW-` 前缀（幂等）。

    这是「先确认、后生成」的结构性保证：闸门被跳过后，正常文件名的交付物
    在物理上不可能产生。
    """
    if not allow:
        return file
    d, b = os.path.split(file)
    if b.startswith(PREVIEW_MARK):
        return file
    return os.path.join(d, PREVIEW_MARK + b)


def stamp_preview(img):
    """在位图上加盖斜向平铺的 `PREVIEW · 未确认` 水印（仅供未确认预览）。"""
    from PIL import Image, ImageDraw, ImageFont

    w, h = img.size
    size = max(22, w // 34)
    f = None
    for p in ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
              "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if os.path.exists(p):
            f = ImageFont.truetype(p, size)
            break
    if f is None:
        f = ImageFont.load_default()

    text = "PREVIEW · 未确认"
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    tw = int(probe.textlength(text, font=f))
    tile = Image.new("RGBA", (tw + 60, size + 40), (0, 0, 0, 0))
    ImageDraw.Draw(tile).text((30, 20), text, font=f, fill=(220, 38, 38, 70))
    tile = tile.rotate(24, expand=True)

    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for y in range(-tile.height, h + tile.height, tile.height + 70):
        for x in range(-tile.width, w + tile.width, tile.width + 90):
            layer.paste(tile, (x, y), tile)
    out = img.convert("RGBA")
    out.alpha_composite(layer)
    return out.convert("RGB")


def project_from_tree(tree_path: str) -> str:
    """从 <project>/layout-tree/<bp>.json 反推项目目录。"""
    return os.path.dirname(os.path.dirname(os.path.abspath(tree_path)))


def require_confirmation(project_dir: str, mode: str = "static",
                         allow: bool = False, scope=None) -> None:
    if allow:
        print("\n╔══════════════════════════════════════════════════════════════╗")
        print("║  ⚠  未确认预览（UNCONFIRMED PREVIEW）                              ║")
        print("║  闸门被 --allow-unconfirmed 跳过：产物带 `PREVIEW-` 前缀 + 水印。║")
        print("║  交付前请在定位查看器里由用户点「确认布局」后重新渲染。        ║")
        print("╚══════════════════════════════════════════════════════════════╝\n", file=sys.stderr)
        return
    script = os.path.join(skill_root(), "layout", "scripts", "validate", "check-confirmation.mjs")
    if not os.path.exists(script):
        print("确认闸门不可用：找不到 check-confirmation.mjs（fail-closed，拒绝渲染）", file=sys.stderr)
        raise SystemExit(1)
    cmd = ["node", script, "--project", project_dir, "--mode", mode]
    if scope:
        cmd += ["--scope", ",".join(scope)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.stdout:
        sys.stderr.write(proc.stdout)
    if proc.stderr:
        sys.stderr.write(proc.stderr)
    if proc.returncode != 0:
        print("\n✗ 渲染被阻断：确认闸门未通过（Python 序列化器同样受管）。", file=sys.stderr)
        print("  查看确认状态：node scripts/confirm.mjs --project <dir> --show", file=sys.stderr)
        print("  CI / 示例归档可加 --allow-unconfirmed 跳过（会打印警告）。", file=sys.stderr)
        raise SystemExit(1)
