"""Text as SVG paths, so a drawing needs no font on the viewer's side.

Shapes text with HarfBuzz (kerning and ligatures) and draws the glyph
outlines with fontTools. Uses Geist from the system font directory.
"""

from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

FONT_DIR = Path("/usr/share/fonts/OTF")
FONTS = {w: FONT_DIR / f"Geist-{w}.otf" for w in ("Regular", "Medium", "SemiBold")}


class Face:
    def __init__(self, path: Path):
        self.tt = TTFont(path)
        self.glyphs = self.tt.getGlyphSet()
        self.order = self.tt.getGlyphOrder()
        self.upem = self.tt["head"].unitsPerEm
        blob = hb.Blob.from_file_path(str(path))
        self.hb_font = hb.Font(hb.Face(blob))

    def shape(self, text: str):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hb_font, buf, {"kern": True, "liga": True})
        return buf.glyph_infos, buf.glyph_positions

    def width(self, text: str, size: float, tracking: float = 0.0) -> float:
        _, pos = self.shape(text)
        scale = size / self.upem
        return sum(p.x_advance * scale + tracking for p in pos) - tracking

    def path(self, text: str, x: float, y: float, size: float, tracking: float = 0.0) -> str:
        """SVG path data for `text` with its baseline at y."""
        infos, pos = self.shape(text)
        scale = size / self.upem
        pen = SVGPathPen(self.glyphs)
        cx = x
        for info, p in zip(infos, pos):
            name = self.order[info.codepoint]
            t = TransformPen(pen, (scale, 0, 0, -scale, cx + p.x_offset * scale, y - p.y_offset * scale))
            self.glyphs[name].draw(t)
            cx += p.x_advance * scale + tracking
        return pen.getCommands()
