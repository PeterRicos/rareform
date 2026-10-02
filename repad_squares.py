"""
repad_squares.py — rebuild sneaker_images/square/ from sneaker_images/.

Each source photo is kept at full/native resolution and placed on a square
canvas with a uniform margin around it, so every product card / detail tile
shows the WHOLE shoe with breathing room. Nothing is cropped or resampled,
so a shoe can never be clipped. The shop's square image boxes use
object-fit:cover, which never crops a square source image.

Usage:  python repad_squares.py
Output: sneaker_images/square/<same filename>.jpg  + a margin report
"""

import math
import os
from PIL import Image, ImageChops

SRC = "sneaker_images"
DST = os.path.join(SRC, "square")
MARGIN = 0.06        # empty space on each end of the photo's long side
EDGE_TOL = 12        # per-channel distance from background counted as "content"
JPEG_QUALITY = 92


def content_bbox(im):
    """Bounding box of the shoe pixels (background sampled from the corners)."""
    w, h = im.size
    corners = [im.getpixel((0, 0)), im.getpixel((w - 1, 0)),
               im.getpixel((0, h - 1)), im.getpixel((w - 1, h - 1))]
    bg = tuple(max(c[i] for c in corners) for i in range(3))
    diff = ImageChops.difference(im, Image.new("RGB", im.size, bg))
    r, g, b = diff.split()
    m = ImageChops.lighter(ImageChops.lighter(r, g), b)
    return m.point(lambda v: 255 if v > EDGE_TOL else 0).getbbox()


def main():
    os.makedirs(DST, exist_ok=True)
    cut, tight, ok = [], [], 0

    for fname in sorted(os.listdir(SRC)):
        if not fname.lower().endswith((".jpg", ".jpeg")):
            continue
        im = Image.open(os.path.join(SRC, fname)).convert("RGB")
        w, h = im.size
        bbox = content_bbox(im)
        if bbox:
            l, t, r, b = bbox
            if l == 0 or t == 0 or r == w or b == h:
                cut.append(fname)

        # Safe padding: paste the untouched photo onto a square canvas that is
        # bigger by MARGIN on each end of the long side (no crop, no resample).
        corners = [im.getpixel((0, 0)), im.getpixel((w - 1, 0)),
                   im.getpixel((0, h - 1)), im.getpixel((w - 1, h - 1))]
        pad = tuple(round(sum(c[i] for c in corners) / 4) for i in range(3))
        side = math.ceil(max(w, h) / (1 - 2 * MARGIN))
        canvas = Image.new("RGB", (side, side), pad)
        canvas.paste(im, ((side - w) // 2, (side - h) // 2))
        canvas.save(os.path.join(DST, fname), "JPEG", quality=JPEG_QUALITY, optimize=True)

        cb = content_bbox(canvas)
        if cb:
            ml, mt, mr, mb = cb[0], cb[1], side - cb[2], side - cb[3]
            if min(ml, mt, mr, mb) / side < 0.04:
                tight.append(f"{fname}  margins L{ml} T{mt} R{mr} B{mb} ({side}px)")
            else:
                ok += 1

    print(f"squares rebuilt: {ok + len(tight)}   comfortable margins: {ok}")
    if tight:
        print("still tight (<4% margin):")
        for line in tight:
            print("  " + line)
    if cut:
        print("shoe already cut off in the SOURCE photo (padding cannot restore it):")
        for f in cut:
            print("  " + f)


if __name__ == "__main__":
    main()