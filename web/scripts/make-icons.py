#!/usr/bin/env python3
"""
Regenerate every budgetr app mark from the one canonical icon.

Source of truth: web/public/icons/icon-512.png — the serif "b." on the dark
rounded field. desktop/scripts/make-icns.sh already derives the macOS .icns from
it; this does the same for the browser favicon and the whole Expo icon set,
which had drifted to a mix of a line-chart mark and untouched Expo scaffold art.

    python3 scripts/make-icons.py            # write the files
    python3 scripts/make-icons.py --check     # report drift, write nothing

Requires Pillow (`pip install Pillow`). Run it whenever the canonical changes.

Two things that are easy to get wrong and are handled here:

  * iOS app icons must be fully opaque — the App Store rejects an alpha channel.
    The canonical has transparent corners (it's a rounded square), so the mobile
    icon is flattened onto the field colour and iOS applies its own mask.
  * Android adaptive icons composite a foreground over a background and then mask
    the result, so the foreground must be the bare glyph on transparent, inset
    into the safe zone. Handing it the full icon would nest one rounded square
    inside another.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

# Pillow 10 moved the resampling enum; keep working on both.
LANCZOS = getattr(Image, "Resampling", Image).LANCZOS

ROOT = Path(__file__).resolve().parent.parent
CANONICAL = ROOT / "public" / "icons" / "icon-512.png"
MOBILE = ROOT.parent / "mobile" / "assets" / "images"

FIELD = (10, 15, 13)  # the icon's dark field, sampled from the canonical
ADAPTIVE_SAFE = 0.60  # fraction of the canvas the glyph may occupy
# Above this luminance a pixel is glyph rather than field. The icon has a faint
# border stroke on the rounded square (luma ~44); anything at or below ~60 pulls
# that stroke into the crop and every derived mark grows a ghost outline.
GLYPH_LUMA = 110


def load_canonical() -> Image.Image:
    if not CANONICAL.exists():
        sys.exit(f"canonical icon not found at {CANONICAL}")
    return Image.open(CANONICAL).convert("RGBA")


def glyph(src: Image.Image) -> Image.Image:
    """The 'b.' alone, cropped tight, on transparent."""
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    sp, op = src.load(), out.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = sp[x, y]
            if a > 0 and (0.299 * r + 0.587 * g + 0.114 * b) > GLYPH_LUMA:
                op[x, y] = (r, g, b, a)
    box = out.getbbox()
    return out.crop(box) if box else out


def centered(art: Image.Image, size: int, scale: float) -> Image.Image:
    """Fit `art` into `scale` of a square canvas, centered, on transparent."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    limit = int(size * scale)
    w, h = art.size
    ratio = min(limit / w, limit / h)
    art = art.resize((max(1, int(w * ratio)), max(1, int(h * ratio))), LANCZOS)
    canvas.paste(art, ((size - art.width) // 2, (size - art.height) // 2), art)
    return canvas


def opaque(img: Image.Image) -> Image.Image:
    """Flatten onto the field colour — iOS rejects icons with an alpha channel."""
    bg = Image.new("RGBA", img.size, (*FIELD, 255))
    return Image.alpha_composite(bg, img).convert("RGB")


def build(src: Image.Image) -> dict[Path, Image.Image]:
    g = glyph(src)
    square = lambda n: src.resize((n, n), LANCZOS)  # noqa: E731
    return {
        # Browser favicon — keep the field, it renders on arbitrary chrome.
        ROOT / "app" / "favicon.ico": src,
        # Expo: full icon, opaque for the App Store.
        MOBILE / "icon.png": opaque(square(1024)),
        MOBILE / "favicon.png": square(48),
        # Splash sits on its own dark background, so the bare glyph reads better
        # than a second dark square.
        MOBILE / "splash-icon.png": centered(g, 512, 0.72),
        # Android adaptive: bare glyph inset, flat field behind it.
        MOBILE / "android-icon-foreground.png": centered(g, 512, ADAPTIVE_SAFE),
        MOBILE / "android-icon-background.png": Image.new("RGBA", (512, 512), (*FIELD, 255)),
        MOBILE / "android-icon-monochrome.png": silhouette(centered(g, 512, ADAPTIVE_SAFE)),
    }


def silhouette(img: Image.Image) -> Image.Image:
    """Flat white on transparent — Android tints the monochrome layer itself."""
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ip, op = img.load(), out.load()
    for y in range(img.height):
        for x in range(img.width):
            a = ip[x, y][3]
            if a > 0:
                op[x, y] = (255, 255, 255, a)
    return out


def main() -> None:
    check = "--check" in sys.argv
    src = load_canonical()
    written = 0
    for path, img in build(src).items():
        if check:
            print(f"{'ok  ' if path.exists() else 'MISS'} {path.relative_to(ROOT.parent)}")
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.suffix == ".ico":
            img.save(path, sizes=[(n, n) for n in (16, 32, 48, 64, 128, 256)])
        else:
            img.save(path)
        print(f"wrote {path.relative_to(ROOT.parent)}")
        written += 1
    if not check:
        print(f"\n{written} marks regenerated from {CANONICAL.relative_to(ROOT.parent)}")


if __name__ == "__main__":
    main()
