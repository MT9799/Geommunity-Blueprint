#!/usr/bin/env python3
"""生成页面缩略图（Pillow）

- 扫描 data/diagrams 与 data/packcovers 下的 png / jpg / jpeg / webp；
- 按最长边缩放到 360（小图同样会放大）；
- 输出到 data/thumbs 下相同相对路径的 .webp，质量 80。

用法：
    python scripts/make-thumbs.py
    python scripts/make-thumbs.py --out /tmp/thumbs --quality 80 --max-size 360

依赖：Pillow（pip install Pillow）
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
SOURCE_DIRS = ("diagrams", "packcovers")
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
MAX_SIZE = 360
WEBP_QUALITY = 80


def list_images(directory: Path) -> list[Path]:
    """递归列出目录里的图片（与 JS 版的扩展名集合一致）。"""
    if not directory.is_dir():
        return []
    found: list[Path] = []
    for root, dirs, files in os.walk(directory):
        dirs.sort()
        for name in sorted(files):
            if Path(name).suffix.lower() in IMAGE_EXTENSIONS:
                found.append(Path(root) / name)
    return found


def prepare(im: Image.Image) -> Image.Image:
    """把调色板 / 灰度 / CMYK 等统一成 WebP 能直接写的 RGB(A)。

    ffmpeg 对调色板 PNG 也是先转成 RGB；带透明通道的图保留 alpha。
    """
    if im.mode in ("RGB", "RGBA"):
        return im
    if im.mode == "P":
        return im.convert("RGBA" if "transparency" in im.info else "RGB")
    return im.convert("RGBA" if "A" in im.getbands() else "RGB")


def resize_size(width: int, height: int, max_size: int) -> tuple[int, int]:
    """按最长边缩放到 max_size，四舍五入（与 ffmpeg 的 decrease 取整一致）。"""
    scale = max_size / max(width, height)
    return max(1, int(width * scale + 0.5)), max(1, int(height * scale + 0.5))


def main() -> None:
    parser = argparse.ArgumentParser(description="生成 data/thumbs 下的 WebP 缩略图")
    parser.add_argument("--out", default=str(DATA_DIR / "thumbs"), help="输出目录（默认 data/thumbs）")
    parser.add_argument("--max-size", type=int, default=MAX_SIZE, help="最长边像素（默认 360）")
    parser.add_argument("--quality", type=int, default=WEBP_QUALITY, help="WebP 质量（默认 80）")
    args = parser.parse_args()

    out_dir = Path(args.out)
    converted = 0
    for source_name in SOURCE_DIRS:
        for source in list_images(DATA_DIR / source_name):
            relative = source.relative_to(DATA_DIR)
            target = out_dir / relative.with_suffix(".webp")
            target.parent.mkdir(parents=True, exist_ok=True)
            with Image.open(source) as im:
                im.load()
                im = prepare(im)
                im = im.resize(resize_size(*im.size, args.max_size), Image.Resampling.BICUBIC)
                im.save(target, "WEBP", quality=args.quality, method=4)
            converted += 1

    total = sum(p.stat().st_size for p in out_dir.rglob("*") if p.suffix.lower() == ".webp")
    print(f"缩略图已生成：{converted} 张，共 {total / 1024 / 1024:.1f} MB")
    print(f"输出目录：{out_dir}")


if __name__ == "__main__":
    main()
