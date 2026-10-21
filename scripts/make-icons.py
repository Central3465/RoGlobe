"""Regenerate RoGlobe's toolbar icons (original artwork). Dev-only; needs Pillow.

    python3 scripts/make-icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
TEAL, INDIGO = (20, 184, 166), (99, 102, 241)
SCALE = 8  # draw large, then downsample for smooth edges


def icon(size: int) -> Image.Image:
    s = size * SCALE
    # diagonal teal -> indigo gradient
    grad = Image.new("RGB", (s, s))
    px = grad.load()
    for y in range(s):
        for x in range(s):
            t = (x + y) / (2 * (s - 1))
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(TEAL, INDIGO))
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s - 1, s - 1), radius=round(s * 0.24), fill=255)
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    w = max(SCALE, round(s * (0.085 if size <= 16 else 0.06)))
    pad = s * 0.2
    box = (pad, pad, s - pad, s - pad)
    white = (255, 255, 255, 255)
    d.ellipse(box, outline=white, width=w)  # globe
    d.line((pad, s / 2, s - pad, s / 2), fill=white, width=w)  # equator
    mw = (s - 2 * pad) * 0.42
    d.ellipse((s / 2 - mw / 2, pad, s / 2 + mw / 2, s - pad), outline=white, width=w)  # meridian
    if size > 16:
        for frac in (0.3, 0.7):  # latitude lines
            y = pad + (s - 2 * pad) * frac
            half = ((s - 2 * pad) / 2) ** 2 - (y - s / 2) ** 2
            dx = half ** 0.5 * 0.97
            d.line((s / 2 - dx, y, s / 2 + dx, y), fill=white, width=max(SCALE, w // 2))
    return img.resize((size, size), Image.LANCZOS)


for n in (16, 48, 128):
    icon(n).save(OUT / f"icon-{n}.png")
    print("wrote", OUT / f"icon-{n}.png")
