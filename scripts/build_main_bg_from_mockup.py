"""Compose main-bg: clean hall + mockup title plaque (no floating UI cutout)."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

MOCK = Path(r"c:\Users\ABC\Desktop\cursor\docs\mockups\mockup-main-menu.png")
BASE = Path(
    r"C:\Users\ABC\.cursor\projects\c-Users-ABC-Desktop-cursor\assets\main-bg-clean.png"
)
OUTS = [
    Path(
        r"c:\Users\ABC\Desktop\cursor\client\cocos-cli-smoke-test\assets\resources\ui\main-bg.png"
    ),
    Path(r"c:\Users\ABC\Desktop\cursor\docs\art\ui\main-bg.png"),
]


def main() -> None:
    mock = Image.open(MOCK).convert("RGBA")
    base = Image.open(BASE).convert("RGBA").resize(mock.size, Image.Resampling.LANCZOS)
    w, h = mock.size

    x0, y0, x1, y1 = int(0.255 * w), int(0.025 * h), int(0.745 * w), int(0.27 * h)
    title = mock.crop((x0, y0, x1, y1)).convert("RGBA")
    tw, th = title.size
    alpha = Image.new("L", (tw, th), 0)
    draw = ImageDraw.Draw(alpha)
    draw.rounded_rectangle(
        (int(tw * 0.03), int(th * 0.14), int(tw * 0.97), int(th * 0.94)),
        radius=30,
        fill=255,
    )
    draw.ellipse((int(tw * 0.43), int(th * 0.00), int(tw * 0.57), int(th * 0.26)), fill=255)
    alpha = alpha.filter(ImageFilter.GaussianBlur(5))
    title.putalpha(alpha)

    out = base.copy()
    out.paste(title, (x0, y0), title)

    # Scrub any leaked top chrome using clean hall corners
    for box in [
        (0, 0, int(0.22 * w), int(0.18 * h)),
        (int(0.78 * w), 0, w, int(0.20 * h)),
    ]:
        out.paste(base.crop(box), box[:2])

    rgb = out.convert("RGB")
    for p in OUTS:
        p.parent.mkdir(parents=True, exist_ok=True)
        rgb.save(p, format="PNG", optimize=True)
        print("wrote", p)


if __name__ == "__main__":
    main()
