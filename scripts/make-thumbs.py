#!/usr/bin/env python3
"""生成页面缩略图（Pillow）

- 关卡题图：读 data/levels.json 的 diagram 字段，缩略图生成到 data/thumbs/ 下**同相对路径**
  （levels/<包>/<关卡>/xxx.webp），与题图同名、只换扩展名；
- 题图改过名时（levels.json 的 diagram 已指向新文件），同一关卡目录里旧名字的 .webp 会被删掉；
- 关卡包封面：扫描 data/packcovers，输出到 data/thumbs/packcovers/ 下同相对路径的 .webp；
- 按最长边缩放到 360（小图同样会放大），质量 80。
- 生成前先和已存在的缩略图比较：aHash 感知哈希（对「同图、不同 libwebp 版本重编码」鲁棒）一致，
  **且**逐块平均像素差也不大（抓住 aHash 看不见的小面积改动，例如加几个角度文字），才跳过；
  `no-compare` 可强制全部重编码。

用法：
    python scripts/make-thumbs.py
    python scripts/make-thumbs.py --out /tmp/thumbs --quality 80 --max-size 360
    python scripts/make-thumbs.py --compare-tol 0 --no-compare

依赖：Pillow（pip install Pillow）
"""

from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path

from PIL import Image, ImageChops, ImageStat

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
SOURCE_DIRS = ("packcovers",)
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
MAX_SIZE = 360
WEBP_QUALITY = 80
# 分块平均灰度差的跳过阈值：实测同图重编码该值 <3，无改动的现存图 <4，
# 而改过字的图最低也有 19；取 10 留足余量，既不会因为重编码浮动误写、也不会漏掉局部改动
BLOCK_TOL_DEFAULT = 10.0


def load_levels() -> list[dict]:
    """读关卡列表（levels.json）。"""
    path = DATA_DIR / "levels.json"
    if not path.is_file():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


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


def image_hash(img: Image.Image) -> int:
    """感知哈希（aHash）：缩到 8x8 灰度、按均值二值化。

    对「同一张图、不同有损编码（不同 libwebp 版本）」非常鲁棒——
    解码像素会有几个级别的浮动，但哈希几乎不变；只有内容真的变了才会明显不同。
    """
    gray = img.convert("L").resize((8, 8), Image.Resampling.BILINEAR)
    bits = list(gray.getdata())
    mean = sum(bits) / len(bits)
    h = 0
    for i, v in enumerate(bits):
        if v >= mean:
            h |= 1 << i
    return h


def max_block_diff(a: Image.Image, b: Image.Image, grid: int = 32) -> float:
    """两张图切成 grid×grid 块后，单块平均灰度差的最大值。

    aHash 把整图压成 8×8 再二值化，局部小改动（例如加一处角度文字 / 两个小标签）
    只占几个百分点像素，缩放 + 二值化后完全被抹平。
    这里逐块取平均差再看最大值，专门抓这种「整体没变、局部变了」的情形。
    """
    diff = ImageChops.difference(a.convert("RGB"), b.convert("RGB")).convert("L")
    bw, bh = max(1, a.width // grid), max(1, a.height // grid)
    worst = 0.0
    for row in range(grid):
        for col in range(grid):
            box = (col * bw, row * bh, min(a.width, (col + 1) * bw), min(a.height, (row + 1) * bh))
            worst = max(worst, ImageStat.Stat(diff.crop(box)).mean[0])
    return worst


def images_close(
    a: Image.Image, b: Image.Image, tol: int, block_tol: float = BLOCK_TOL_DEFAULT
) -> bool:
    """两张图是否为「同一张图」：aHash 汉明距离 <= tol，且分块最大平均差 <= block_tol。

    两道判据缺一不可：aHash 保证对「同图、不同 libwebp 版本重编码」鲁棒，
    分块差保证局部小改动不会被 aHash 抹平而误判为相同、跳过重编码。
    都转成 RGB 再比较，统一 RGB / RGBA 的差异；调色板或灰度图也兼容。
    """
    if a.size != b.size:
        return False
    ar, br = a.convert("RGB"), b.convert("RGB")
    ha, hb = image_hash(ar), image_hash(br)
    if bin(ha ^ hb).count("1") > tol:
        return False
    return max_block_diff(ar, br) <= block_tol


def write_thumb(
    source: Path,
    target: Path,
    max_size: int,
    quality: int,
    compare_tol: int,
    block_tol: float = BLOCK_TOL_DEFAULT,
    compare: bool = True,
) -> str:
    """把一张图缩成 WebP 写到 target。

    compare=True 时，若新生成的图与已存在的 target 感知哈希一致（容差 compare_tol）
    且分块最大平均差不大（容差 block_tol），就**不覆盖**旧文件——避免不同设备 /
    不同 libwebp 版本重跑脚本时产生无意义的字节变动，同时抓住局部小改动。
    返回 "skip" / "write"。
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as im:
        im.load()
        im = prepare(im)
        im = im.resize(resize_size(*im.size, max_size), Image.Resampling.BICUBIC)

    if compare and target.is_file():
        try:
            buf = io.BytesIO()
            im.save(buf, "WEBP", quality=quality, method=4)
            buf.seek(0)
            with Image.open(buf) as new_dec, Image.open(target) as old:
                old.load()
                new_dec.load()
                if images_close(new_dec, old, compare_tol, block_tol):
                    return "skip"
            target.write_bytes(buf.getvalue())  # 已编码好，直接落盘
            return "write"
        except Exception:
            pass  # 旧文件损坏等异常时 fallback 到普通写入

    im.save(target, "WEBP", quality=quality, method=4)
    return "write"


def stale_level_thumbs(out_dir: Path, levels: list[dict]) -> list[Path]:
    """列出关卡目录里名字与 levels.json 的 diagram 不符的旧 .webp（只读，不删）。

    清晰题图改名后 levels.json 的 diagram 指向新引用，脚本会按新名字生成缩略图，
    但旧名字的 .webp 还留在同一个关卡目录下：页面不会再引用它，却一直跟着仓库走。
    只检查「有 diagram 的关卡目录」里的同层 .webp；包封面、其它目录与子目录都不动。
    同一目录被多关共用时，把所有关卡的期望文件名合起来再比。
    """
    expected: dict[Path, set[str]] = {}
    for level in levels:
        diagram = level.get("diagram")
        if not diagram:
            continue
        relative = Path(diagram).with_suffix(".webp")
        # 只认 data 下的相对路径，别让异常配置把清理带出输出目录
        if relative.is_absolute() or ".." in relative.parts:
            continue
        expected.setdefault(out_dir / relative.parent, set()).add(relative.name)

    stale: list[Path] = []
    for directory, names in sorted(expected.items(), key=lambda item: str(item[0])):
        if not directory.is_dir():
            continue
        for thumb in sorted(directory.iterdir()):
            if thumb.is_file() and thumb.suffix.lower() == ".webp" and thumb.name not in names:
                stale.append(thumb)
    return stale


def main() -> None:
    parser = argparse.ArgumentParser(description="生成关卡题图与关卡包封面的 WebP 缩略图")
    parser.add_argument("--out", default=str(DATA_DIR / "thumbs"), help="关卡包封面缩略图目录（默认 data/thumbs）")
    parser.add_argument("--max-size", type=int, default=MAX_SIZE, help="最长边像素（默认 360）")
    parser.add_argument("--quality", type=int, default=WEBP_QUALITY, help="WebP 质量（默认 80）")
    parser.add_argument("--compare-tol", type=int, default=2, help="感知哈希的汉明距离阈值（默认 2，0=严格一致才跳过；容忍不同 libwebp 版本有损重编码的浮动）")
    parser.add_argument("--block-tol", type=float, default=BLOCK_TOL_DEFAULT, help="32×32 分块最大平均灰度差的跳过阈值（默认 10；抓 aHash 抹平的小面积改动，设很大可近似关掉这道判据）")
    parser.add_argument("--no-compare", action="store_true", help="关闭比较器，强制重编码覆盖所有缩略图")
    args = parser.parse_args()

    compare = not args.no_compare
    out_dir = Path(args.out)
    written = skipped = removed = 0
    levels = load_levels()
    # 题图改名后先删掉旧名字的缩略图：否则新名字生成完，旧文件还留在同一关卡目录里
    for stale in stale_level_thumbs(out_dir, levels):
        print(f"  [prune] 删掉旧题图缩略图：{stale.relative_to(out_dir)}")
        stale.unlink()
        removed += 1
    # 关卡题图：缩略图放在 data/thumbs/ 下与题图同相对路径（扩展名换成 .webp）
    for level in levels:
        diagram = level.get("diagram")
        if not diagram:
            continue
        source = DATA_DIR / diagram
        if not source.is_file():
            print(f"  [skip] 题图不存在：{diagram}")
            continue
        status = write_thumb(
            source, out_dir / Path(diagram).with_suffix(".webp"),
            args.max_size, args.quality, args.compare_tol,
            block_tol=args.block_tol, compare=compare,
        )
        if status == "write":
            written += 1
        else:
            skipped += 1
    # 关卡包封面：仍然放在 data/thumbs/packcovers/ 下
    for source_name in SOURCE_DIRS:
        for source in list_images(DATA_DIR / source_name):
            relative = source.relative_to(DATA_DIR)
            status = write_thumb(
                source, out_dir / relative.with_suffix(".webp"),
                args.max_size, args.quality, args.compare_tol,
                block_tol=args.block_tol, compare=compare,
            )
            if status == "write":
                written += 1
            else:
                skipped += 1

    total = sum(p.stat().st_size for p in out_dir.rglob("*") if p.suffix.lower() == ".webp")
    print(f"缩略图：新写 {written} 张、跳过 {skipped} 张（与现有逐像素一致）、删掉旧名 {removed} 张，共 {total / 1024 / 1024:.1f} MB")
    print(f"输出目录：{out_dir}")


if __name__ == "__main__":
    main()
