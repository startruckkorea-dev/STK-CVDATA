"""Generate web logo/favicon assets from the vendor logo PDF.

Source: "MB Logo/MB Trucks_combined-logo-S_p_1C.pdf" (1-colour vector artwork,
114.803 x 31.181 pt). The Mercedes star occupies x 1.47-29.81, y 1.42-29.76.

Outputs (docs/assets/):
  mb-logo.svg        full combined logo — sidebar brand mark
  mb-star.svg        star only, dark-mode aware — SVG favicon
  favicon-32.png     star only, raster fallback
  favicon-180.png    star only, apple-touch-icon

Usage:
  python tools/make_logo_assets.py
"""
from __future__ import annotations

import re
from pathlib import Path

import fitz

SRC = Path("MB Logo/MB Trucks_combined-logo-S_p_1C.pdf")
OUT = Path("docs/assets")

# Star bounding box in PDF points, plus a little breathing room so the mark
# is not flush against the favicon edge.
STAR = (1.47, 1.42, 29.81, 29.76)
PAD = 1.6


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    page = fitz.open(SRC)[0]
    svg = page.get_svg_image(text_as_path=True)

    (OUT / "mb-logo.svg").write_text(svg, encoding="utf-8")
    print(f"  + {OUT / 'mb-logo.svg'}")

    # Star-only SVG: same paths, retargeted viewBox. Anything outside the
    # viewport (the wordmark) is clipped away by the SVG viewport itself.
    x0, y0, x1, y1 = STAR
    vx, vy = x0 - PAD, y0 - PAD
    vw, vh = (x1 - x0) + 2 * PAD, (y1 - y0) + 2 * PAD
    star = re.sub(
        r'width="[^"]*" height="[^"]*" viewBox="[^"]*"',
        f'width="{vw:.4g}" height="{vh:.4g}" viewBox="{vx:.4g} {vy:.4g} {vw:.4g} {vh:.4g}"',
        svg,
        count=1,
    )
    # A browser tab strip may be light or dark. The artwork is near-black, so
    # invert it under a dark UI. CSS beats the paths' presentation attributes.
    star = star.replace(
        "<defs>",
        "<style>@media (prefers-color-scheme: dark){path{fill:#ffffff}}</style>\n<defs>",
        1,
    )
    (OUT / "mb-star.svg").write_text(star, encoding="utf-8")
    print(f"  + {OUT / 'mb-star.svg'}")

    # Raster fallbacks — transparent background, star cropped from the page.
    clip = fitz.Rect(vx, vy, vx + vw, vy + vh)
    for size in (32, 180):
        zoom = size / vw
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip, alpha=True)
        dst = OUT / f"favicon-{size}.png"
        pix.save(dst)
        print(f"  + {dst} ({pix.width}x{pix.height})")


if __name__ == "__main__":
    main()
