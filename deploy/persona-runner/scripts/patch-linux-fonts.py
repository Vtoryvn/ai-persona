#!/usr/bin/env python3
"""Give the Linux desktop font set a real Noto Color Emoji face with Latin metrics.

scanbrowser's span test asks for family "Noto Color Emoji" using a Latin sample.
The upstream color font has no Latin glyphs, so the sample falls back to the
generic family and is flagged as a font lie. A second face with that family name
carries Latin outlines. The color font is renamed to "Noto Emoji", which is
already on fontconfig's emoji fallback list, so color emoji still render.
"""
import os
from pathlib import Path

from fontTools.ttLib import TTFont

LATIN_SRC = Path("/usr/share/fonts/truetype/ubuntu/Ubuntu-C.ttf")
COLOR_SRC = Path("/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf")
OUT_DIR = Path("/usr/local/share/fonts/persona")


def set_family(font: TTFont, family: str) -> None:
    ps = family.replace(" ", "")
    for rec in font["name"].names:
        if rec.nameID in (1, 4, 16):
            rec.string = family
        elif rec.nameID == 6:
            rec.string = ps


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    latin = TTFont(str(LATIN_SRC))
    set_family(latin, "Noto Color Emoji")
    latin_path = OUT_DIR / "NotoColorEmojiLatin.ttf"
    latin.save(str(latin_path))

    if COLOR_SRC.exists():
        color = TTFont(str(COLOR_SRC))
        set_family(color, "Noto Emoji")
        color_path = OUT_DIR / "NotoEmojiColor.ttf"
        color.save(str(color_path))
        COLOR_SRC.unlink()

    # Keep a direct "Noto Color Emoji" request on the Latin face. The generic
    # emoji family must point at the color font or sites render monochrome emoji.
    for conf in (
        Path("/usr/share/fontconfig/conf.avail/45-generic.conf"),
        Path("/usr/share/fontconfig/conf.avail/60-generic.conf"),
    ):
        if conf.exists():
            text = conf.read_text()
            conf.write_text(text.replace("Noto Color Emoji", "Noto Emoji"))

    os.system("fc-cache -f >/dev/null 2>&1 || true")
    print(f"persona fonts: {latin_path}")


if __name__ == "__main__":
    main()
