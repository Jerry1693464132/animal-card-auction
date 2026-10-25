"""Crop 2x2 rank sheets and trim specials to 3:4 card faces."""
from __future__ import annotations

import os
from pathlib import Path

from PIL import Image

SRC = Path(r"C:\Users\ABC\.cursor\projects\c-Users-ABC-Desktop-cursor\assets")
OUT = Path(r"c:\Users\ABC\Desktop\cursor\docs\art\ui\cards\faces")
COCOS = Path(r"c:\Users\ABC\Desktop\cursor\client\cocos-cli-smoke-test\assets\resources\ui")
SHEETS = Path(r"c:\Users\ABC\Desktop\cursor\docs\art\ui\cards\sheets")
FACE_W, FACE_H = 450, 600  # 3:4
SUITS = (("S", 0, 0), ("H", 1, 0), ("C", 0, 1), ("D", 1, 1))
RANKS = [
    "A",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
    "14",
    "15",
    "16",
    "17",
    "18",
    "19",
]


def ink_bbox(im: Image.Image) -> tuple[int, int, int, int]:
    gray = im.convert("L")
    w, h = gray.size
    px = gray.load()
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            if px[x, y] < 240:
                if x < minx:
                    minx = x
                if y < miny:
                    miny = y
                if x > maxx:
                    maxx = x
                if y > maxy:
                    maxy = y
    if maxx < 0:
        return (0, 0, w, h)
    return (minx, miny, maxx + 1, maxy + 1)


def inset_box(box: tuple[int, int, int, int], w: int, h: int) -> tuple[int, int, int, int]:
    """Crop a few pixels inward on all sides to drop the ragged black stroke."""
    x0, y0, x1, y1 = box
    inset = 10
    x0 = min(x0 + inset, x1 - 8)
    y0 = min(y0 + inset, y1 - 8)
    x1 = max(x1 - inset, x0 + 8)
    y1 = max(y1 - inset, y0 + 8)
    return (
        max(0, x0),
        max(0, y0),
        min(w, x1),
        min(h, y1),
    )


def fit_ratio(im: Image.Image, target: float) -> Image.Image:
    """Center-crop to target ratio so composition stays 3:4 (no white letterbox)."""
    w, h = im.size
    ratio = w / h
    if abs(ratio - target) < 0.002:
        return im
    if ratio > target:
        nw = max(1, int(round(h * target)))
        x = max(0, (w - nw) // 2)
        return im.crop((x, 0, x + nw, h))
    nh = max(1, int(round(w / target)))
    y = max(0, (h - nh) // 2)
    return im.crop((0, y, w, y + nh))


def to_face(im: Image.Image) -> Image.Image:
    """Keep 3:4 by inward crop, then scale to FACE_W x FACE_H."""
    card = fit_ratio(im.convert("RGB"), FACE_W / FACE_H)
    return card.resize((FACE_W, FACE_H), Image.Resampling.LANCZOS)


def save_face(im: Image.Image, dest: Path) -> tuple[int, int]:
    face = to_face(im)
    dest.parent.mkdir(parents=True, exist_ok=True)
    face.save(dest, "PNG")
    return face.size


def crop_sheet(rank: str) -> None:
    src = SRC / f"card-sheet-{rank}.png"
    SHEETS.mkdir(parents=True, exist_ok=True)
    Image.open(src).save(SHEETS / src.name)
    im = Image.open(src).convert("RGB")
    w, h = im.size
    cw, ch = w // 2, h // 2
    for suit, col, row in SUITS:
        cell = im.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch))
        x0, y0, x1, y1 = inset_box(ink_bbox(cell), cell.size[0], cell.size[1])
        card = cell.crop((x0, y0, x1, y1))
        name = f"card-{suit}-{rank}.png"
        size = save_face(card, OUT / name)
        save_face(card, COCOS / name)
        print(f"{name} crop={card.size} -> {size}")


def crop_special(src_name: str, dest_name: str) -> None:
    src = SRC / src_name
    im = Image.open(src).convert("RGB")
    x0, y0, x1, y1 = inset_box(ink_bbox(im), im.size[0], im.size[1])
    card = im.crop((x0, y0, x1, y1))
    save_face(card, OUT / dest_name)
    save_face(card, COCOS / dest_name)
    print(f"{dest_name} crop={card.size} ratio={card.size[0]/card.size[1]:.3f}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for rank in RANKS:
        crop_sheet(rank)
    crop_special("card-face-joker-small.png", "card-joker-small.png")
    crop_special("card-face-joker-big.png", "card-joker-big.png")
    crop_special("card-face-first.png", "card-first.png")
    crop_special("card-face-star.png", "card-star.png")
    crop_special("card-face-bomb.png", "card-bomb.png")
    print("FACE", FACE_W, FACE_H, "ratio", FACE_W / FACE_H)


if __name__ == "__main__":
    main()
