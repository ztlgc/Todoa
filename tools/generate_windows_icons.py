"""Regenerate the Windows taskbar and tray icons from the two vector sources."""

from io import BytesIO
from pathlib import Path
import struct

import cairosvg
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "src-tauri" / "icons"
SMALL = ICONS / "todoa-small.svg"
LARGE = ICONS / "icon.png"
SIZES = (16, 24, 32, 48, 64, 256)


def png_at(size: int) -> bytes:
    if size <= 32:
        return cairosvg.svg2png(url=str(SMALL), output_width=size, output_height=size)
    with Image.open(LARGE) as source:
        image = source.convert("RGBA").resize((size, size), Image.LANCZOS)
        output = BytesIO()
        image.save(output, format="PNG")
        return output.getvalue()


def main() -> None:
    frames = {size: png_at(size) for size in SIZES}
    (ICONS / "32x32.png").write_bytes(frames[32])
    offset = 6 + len(frames) * 16
    entries = []
    for size, content in frames.items():
        entries.append(struct.pack("<BBBBHHII", size if size < 256 else 0,
                                   size if size < 256 else 0, 0, 0, 1, 32,
                                   len(content), offset))
        offset += len(content)
    (ICONS / "icon.ico").write_bytes(
        struct.pack("<HHH", 0, 1, len(frames)) + b"".join(entries) + b"".join(frames.values())
    )


if __name__ == "__main__":
    main()
