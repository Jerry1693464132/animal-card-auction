"""Crop black letterbox bars from a 4:3/3:2 auction HUD gen, then scale to 1920x1080.

Pipeline (same as mockup-auction-16x9.png):
1. Generate a 4:3 (tool may still emit 3:2) image with SOLID BLACK bars
   on top/bottom and a 16:9 game scene in the middle.
2. Crop the black bars only.
3. Resize the remaining band to 1920x1080.
Never cover-fill a full-bleed 3:2 scene. Never stretch side walls.
"""
from __future__ import annotations

from pathlib import Path
from shutil import copy2

import numpy as np
from PIL import Image

SRC = Path(r"C:\Users\ABC\.cursor\projects\c-Users-ABC-Desktop-cursor\assets\auction-bg-letterbox-4x3-hud.png")
RAW_DIR = Path(r"c:\Users\ABC\Desktop\cursor\docs\mockups\raw-generated")
DOCS = Path(r"c:\Users\ABC\Desktop\cursor\docs\art\ui")
RES = Path(r"c:\Users\ABC\Desktop\cursor\client\cocos-cli-smoke-test\assets\resources\ui")
TARGET = (1920, 1080)


def bar_len(vals: np.ndarray, start: bool, thresh: float = 8) -> int:
    seq = vals if start else vals[::-1]
    n = 0
    for v in seq:
        if v < thresh:
            n += 1
        else:
            break
    return n


def crop_letterbox(im: Image.Image) -> Image.Image:
    a = np.array(im.convert("RGB"))
    row = a.mean(axis=(1, 2))
    top = bar_len(row, True) + 12
    bot = bar_len(row, False) + 8
    h, w = a.shape[:2]
    top = max(0, min(top, h - 2))
    bot = max(0, min(bot, h - top - 1))
    return im.crop((0, top, w, h - bot))


def main() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    copy2(SRC, RAW_DIR / SRC.name)
    copy2(SRC, DOCS / SRC.name)
    im = Image.open(SRC).convert("RGB")
    content = crop_letterbox(im)
    print("content", content.size, "ratio", round(content.size[0] / content.size[1], 4))
    final = content.resize(TARGET, Image.Resampling.LANCZOS)
    final.save(DOCS / "auction-bg.png")
    final.save(RES / "auction-bg.png")
    print("final", final.size)


if __name__ == "__main__":
    main()
