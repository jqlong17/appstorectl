#!/usr/bin/env python3
"""Prepare App Store screenshots for known display types."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps


DISPLAY_SIZES = {
    "APP_IPHONE_67": (1290, 2796),
    "APP_IPAD_PRO_3GEN_129": (2048, 2732),
    "APP_IPAD_PRO_129": (2048, 2732),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Resize/canvas screenshots for App Store Connect.")
    parser.add_argument("--source", required=True, help="Directory containing source PNG/JPG screenshots.")
    parser.add_argument("--dest", required=True, help="Destination display-type directory.")
    parser.add_argument("--display-type", required=True, choices=sorted(DISPLAY_SIZES))
    parser.add_argument("--prefix", default="", help="Optional filename prefix, e.g. ipad.")
    parser.add_argument("--limit", type=int, default=10, help="Maximum screenshots to process.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source = Path(args.source).expanduser()
    dest = Path(args.dest).expanduser()
    if not source.exists():
        raise SystemExit(f"Source directory not found: {source}")

    files = sorted(
        path for path in source.iterdir()
        if path.is_file() and path.suffix.lower() in {".png", ".jpg", ".jpeg"}
    )[: args.limit]
    if not files:
        raise SystemExit(f"No PNG/JPG files found in {source}")

    dest.mkdir(parents=True, exist_ok=True)
    canvas_size = DISPLAY_SIZES[args.display_type]
    for index, file_path in enumerate(files, 1):
        image = Image.open(file_path).convert("RGB")
        output = compose(image, canvas_size)
        stem = args.prefix or args.display_type.lower().replace("app_", "")
        out_path = dest / f"{index:02d}-{stem}.png"
        output.save(out_path, optimize=True)
        print(f"{out_path}: {output.width}x{output.height}")


def compose(image: Image.Image, canvas_size: tuple[int, int]) -> Image.Image:
    """Keep full source visible while filling the exact App Store canvas."""
    fitted = ImageOps.contain(image, canvas_size, method=Image.Resampling.LANCZOS)
    background = image.resize(canvas_size, Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(12))
    background = Image.blend(background, Image.new("RGB", canvas_size, (18, 96, 139)), 0.10)
    x = (canvas_size[0] - fitted.width) // 2
    y = (canvas_size[1] - fitted.height) // 2
    background.paste(fitted, (x, y))
    return background


if __name__ == "__main__":
    main()
