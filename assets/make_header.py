# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools>=4.50", "uharfbuzz>=0.39"]
# ///
"""Draw the README header and the GitHub social preview.

A probability axis from no to yes. The answers of a calibrated model pile
up near both ends, with a thin rise through the uncertain band from 0.3 to
0.7, and one confident answer sits on the axis. The curve is a drawing,
not a measurement, so it does not change as the experiments do.

    uv run assets/make_header.py

Writes assets/header-light.svg, assets/header-dark.svg, and
assets/social-preview.png (needs rsvg-convert).
"""

import math
import subprocess
from pathlib import Path

from glyphs import FONTS, Face

W, H = 1280, 320
TAGLINE = "Typed questions in. Calibrated answers out."

THEMES = {
    "light": {"surface": "#ffffff", "ink": "#1f2328", "muted": "#59636e", "accent": "#0969da"},
    "dark": {"surface": "#0d1117", "ink": "#f0f6fc", "muted": "#9198a1", "accent": "#4493f8"},
}

AXIS_Y = 262
AXIS_X0, AXIS_X1 = 200, 1080
PEAK = 66
BAND = (0.3, 0.7)
ANSWER = 0.9


def x_at(p: float) -> float:
    return AXIS_X0 + p * (AXIS_X1 - AXIS_X0)


def density(p: float) -> float:
    """Two confident peaks and a low rise between them."""
    no = 0.86 * math.exp(-(((p - 0.1) / 0.055) ** 2))
    yes = 1.0 * math.exp(-(((p - 0.9) / 0.05) ** 2))
    unsure = 0.16 * math.exp(-(((p - 0.5) / 0.14) ** 2))
    return no + yes + unsure


def curve() -> list[tuple[float, float]]:
    steps = 360
    return [(x_at(i / steps), AXIS_Y - PEAK * density(i / steps)) for i in range(steps + 1)]


def header(t: dict, faces: dict, background: bool = False, dy: float = 0) -> list[str]:
    reg, semi = faces["Regular"], faces["SemiBold"]
    parts = []
    if background:
        parts.append(f'<rect x="0" y="{-dy}" width="1280" height="640" fill="{t["surface"]}"/>')

    def centered(face, s, y, size, fill, tracking):
        x = (W - face.width(s, size, tracking)) / 2
        parts.append(f'<path fill="{fill}" d="{face.path(s, x, y, size, tracking)}"/>')

    centered(semi, "jev-lab", 112, 92, t["ink"], -2.6)
    centered(reg, TAGLINE, 158, 26, t["muted"], -0.1)

    pts = curve()
    line = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    area = f"M{AXIS_X0},{AXIS_Y} L" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + f" L{AXIS_X1},{AXIS_Y} Z"
    bx0, bx1 = x_at(BAND[0]), x_at(BAND[1])
    parts += [
        "<defs>"
        '<pattern id="band" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
        f'<line x1="0" y1="0" x2="0" y2="8" stroke="{t["muted"]}" stroke-width="1.5" stroke-opacity="0.35"/>'
        "</pattern>"
        "</defs>",
        # The uncertain band: code routes these answers instead of acting on them.
        f'<rect x="{bx0:.1f}" y="{AXIS_Y - PEAK:.1f}" width="{bx1 - bx0:.1f}" height="{PEAK}" fill="url(#band)"/>',
        f'<path d="{area}" fill="{t["muted"]}" fill-opacity="0.12"/>',
        f'<polyline points="{line}" fill="none" stroke="{t["muted"]}" stroke-width="2" '
        'stroke-linejoin="round" stroke-linecap="round"/>',
        f'<line x1="{AXIS_X0}" y1="{AXIS_Y}" x2="{AXIS_X1}" y2="{AXIS_Y}" stroke="{t["ink"]}" '
        'stroke-width="3" stroke-linecap="round"/>',
        f'<circle cx="{x_at(ANSWER):.1f}" cy="{AXIS_Y}" r="9" fill="{t["accent"]}"/>',
    ]
    return parts


def document(parts: list[str], width: int, height: int, view: str) -> str:
    return "\n".join(
        [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="{view}" '
            'role="img" aria-labelledby="t d">',
            '<title id="t">jev-lab</title>',
            f'<desc id="d">{TAGLINE} A probability axis from no to yes, with answers piled near both ends, '
            "a hatched uncertain band in the middle, and one confident answer marked on the axis.</desc>",
            *parts,
            "</svg>",
        ]
    ) + "\n"


def main():
    faces = {w: Face(p) for w, p in FONTS.items()}
    out = Path(__file__).parent
    for name, theme in THEMES.items():
        (out / f"header-{name}.svg").write_text(document(header(theme, faces), W, H, f"0 0 {W} {H}"))
    # GitHub's social preview: 1280x640 on a solid surface, drawing centered.
    dy = (640 - H) / 2
    social = out / ".social.svg"
    social.write_text(document(header(THEMES["dark"], faces, background=True, dy=dy), 1280, 640, f"0 {-dy} 1280 640"))
    subprocess.run(["rsvg-convert", "-o", str(out / "social-preview.png"), str(social)], check=True)
    social.unlink()


if __name__ == "__main__":
    main()
