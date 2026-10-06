"""
Draws the extension's own icon.

The mark is the board in miniature: an accent field carrying three plates, one
of them a circle, at the same corner radius the plates use. It is drawn rather
than committed as a binary so the accent stays in step with the token file.

Run from the project root:  python tools/make-icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ACCENT = (217, 73, 31, 255)
CARD = (255, 255, 255, 255)
OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
SIZES = (48, 96, 128)


def draw(size: int) -> Image.Image:
    # Supersample, then reduce: a rounded corner drawn at 48px by hand is a
    # staircase, and a staircase is exactly what an icon must not be.
    scale = 8
    side = size * scale
    img = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    pad = round(side * 0.06)
    d.rounded_rectangle(
        (pad, pad, side - pad, side - pad),
        radius=round(side * 0.235),
        fill=ACCENT,
    )

    # Three plates: two square-ish tiles and one circle, on the same beat.
    plate = round(side * 0.185)
    gap = round(side * 0.062)
    radius = round(plate * 0.28)
    total = plate * 3 + gap * 2
    x = (side - total) // 2
    y = (side - plate) // 2 + round(side * 0.012)

    d.rounded_rectangle((x, y, x + plate, y + plate), radius=radius, fill=CARD)
    x += plate + gap
    d.ellipse((x, y, x + plate, y + plate), fill=CARD)
    x += plate + gap
    d.rounded_rectangle((x, y, x + plate, y + plate), radius=radius, fill=CARD)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = OUT / f"icon-{size}.png"
        draw(size).save(path)
        print(f"wrote {path} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
