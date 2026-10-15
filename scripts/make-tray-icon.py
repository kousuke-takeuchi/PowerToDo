"""Builds src-tauri/icons/tray.png (macOS template / tray glyph) from design/icons/icon-1024.png.

The red check box becomes black with alpha; the white background and the grey grid are dropped.
Usage: python3 scripts/make-tray-icon.py   (needs Pillow)
"""
from PIL import Image

SRC = "design/icons/icon-1024.png"
OUT = "src-tauri/icons/tray.png"
SIZE = 32

img = Image.open(SRC).convert("RGB")
w, h = img.size
px = img.load()
alpha = Image.new("L", (w, h))
ap = alpha.load()
for y in range(h):
    for x in range(w):
        r, g, _ = px[x, y]
        # red is (225, 72, 59): R - G = 153; white and grey have R - G of about 0
        ap[x, y] = max(0, min(255, round((r - g) / 153 * 255)))

left, top, right, bottom = alpha.point(lambda v: 255 if v > 40 else 0).getbbox()
side = max(right - left, bottom - top)
pad = round(side * 0.04)
side += 2 * pad
cx, cy = (left + right) // 2, (top + bottom) // 2
box = (cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)
alpha = alpha.crop(box).resize((SIZE, SIZE), Image.LANCZOS)

out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
out.putalpha(alpha)
out.save(OUT)
print(OUT, out.size)
