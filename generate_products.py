"""
generate_products.py  (reads yeezys.xlsx + stockx_output.json, uses real paths)
"""

import json
import re
import pandas as pd
from pathlib import Path

EXCEL_PATH = "yeezys.xlsx"
APIFY_FILE = "stockx_output.json"
IMAGES_DIR = Path("sneaker_images")
OUTPUT_JS = "products_block.js"
START_ID = 1   # dense 1..N — no hand-written listings remain above the block

def clean_name(v):
    if pd.isna(v): return ""
    return re.sub(r"^\*+\s*", "", str(v)).strip()

def clean_sku(v):
    if pd.isna(v): return ""
    return str(v).split("<br>")[0].split("\n")[0].strip()

def sanitize(s):
    return re.sub(r"[^A-Za-z0-9]+", "_", str(s)).strip("_") or "unknown"

def parse_sizes(raw):
    if pd.isna(raw): return []
    parts = re.split(r"[,\s]+", str(raw))
    seen = []
    for p in parts:
        p = p.strip().upper()
        if not p or p == "NAN":
            continue
        if p not in seen:
            seen.append(p)
    return seen

def size_key(s):
    m = re.match(r"^([\d.]+)", str(s))
    return (float(m.group(1)) if m else 999.0, str(s))


def find_image(sheet, name, sku):
    fname = f"{sanitize(sheet)}_{sanitize(name)}_{sanitize(sku)}.jpg"
    # Prefer the padded 1:1 versions in square/ — the card grid and the detail
    # gallery are square boxes with object-fit:cover, and the originals are
    # landscape (cover would clip the toe/heel of the shoe).
    for candidate in [IMAGES_DIR / "square" / fname, IMAGES_DIR / fname]:
        if candidate.exists():
            return str(candidate).replace("\\", "/")
    return None

def detect_brand(name, stockx):
    if stockx and stockx.get("brandName"):
        b = stockx["brandName"].strip()
        if b.lower() == "adidas": return "adidas"
        if b.lower() == "nike": return "Nike"
        if b.lower() == "jordan": return "Jordan"
        if b.lower() == "converse": return "Converse"
        return b
    n = name.lower()
    if "jordan" in n: return "Jordan"
    if any(k in n for k in ("yeezy", "foam", "slide", "desert boot")): return "adidas"
    if name[:1].isdigit(): return "adidas"
    if "converse" in n or "chuck" in n: return "Converse"
    if "adidas" in n or "forum" in n: return "adidas"
    if any(k in n for k in ("dunk", "air max", "air force", "blazer", "lebron", "air trainer", "kobe")):
        return "Nike"
    return "Other"

def build_yeezy_title(name):
    m = re.match(r"^(360|350|450|500|700|Slide|Foam(?: Kids)?(?: MTX)?(?: MX)?|Desert Boot)\s+(.+)$", name)
    if not m:
        return "Yeezy " + name
    prefix, rest = m.group(1), m.group(2)
    if prefix.startswith("Slide"):
        return f"Yeezy Slide {rest}"
    if prefix.startswith("Foam"):
        return f"Yeezy {prefix} {rest}"
    if prefix == "Desert Boot":
        return f"Yeezy Desert Boot {rest}"
    if prefix == "360":
        prefix = "350 V2"
    elif prefix == "350":
        prefix = "350 V2"
    return f"Yeezy Boost {prefix} {rest}"

def build_title(name, brand):
    if brand == "adidas" and (name[:1].isdigit() or name.lower().startswith(("slide", "foam", "desert"))):
        return build_yeezy_title(name)
    return re.sub(r"\s+", " ", name).strip()

def esc(s):
    return str(s).replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ")

def main():
    xl = pd.ExcelFile(EXCEL_PATH)
    rows = []
    for sheet in xl.sheet_names:
        df = pd.read_excel(xl, sheet_name=sheet, header=None)
        for _, r in df.iterrows():
            name = clean_name(r.get(0, ""))
            sizes = parse_sizes(r.get(1, ""))
            sku = clean_sku(r.get(2, ""))
            if sku and sku.lower() != "nan":
                rows.append({"Sheet": sheet, "RawName": name, "Sizes": sizes, "SKU": sku})

    stockx = {}
    try:
        with open(APIFY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        for item in data:
            sid = (item.get("styleId") or "").strip().upper()
            if sid:
                stockx[sid] = item
    except FileNotFoundError:
        print(f"Note: {APIFY_FILE} not found - Excel-only mode")

    entries = []
    missing = []
    by_sku = {}

    for row in rows:
        img = find_image(row["Sheet"], row["RawName"], row["SKU"])
        if not img:
            missing.append((row["RawName"], row["SKU"]))
            continue

        sx = stockx.get(row["SKU"].upper(), {})
        brand = detect_brand(row["RawName"], sx)
        title = build_title(row["RawName"], brand)

        if sx.get("title") and (len(row["RawName"]) < 6 or row["RawName"][:1].isdigit()):
            title = sx["title"].strip()

        colorway = sx.get("colorway") or ""
        release = sx.get("releaseDate") or ""
        year = int(release[:4]) if release[:4].isdigit() else 0
        sizes = row["Sizes"] or ["One Size"]

        key = row["SKU"].upper()
        if key in by_sku:
            # Same SKU twice (e.g. 350 Asriel shares the byte-identical 350
            # Carbon photo and SKU FZ5000): merge the sizes into the first
            # listing instead of showing the same product/photo twice.
            known = by_sku[key]
            known["sizes"] = sorted(set(known["sizes"]) | set(sizes), key=size_key)
            continue

        entry = {
            "brand": brand,
            "name": title,
            "color": colorway or "Original Colorway",
            "year": year,
            "sizes": sizes,
            "img": img,
            "sku": row["SKU"],
        }
        by_sku[key] = entry
        entries.append(entry)

    products = []
    for pid, e in enumerate(entries, START_ID):
        products.append(f'''  {{
    id: {pid},
    brand: "{esc(e['brand'])}",
    name: "{esc(e['name'])}",
    color: "{esc(e['color'])}",
    condition: "New",
    box: "Original Box",
    sizes: {json.dumps(e['sizes'])},
    year: {e['year']},
    img: "{e['img']}",
    gallery: ["{e['img']}"],
    sku: "{esc(e['sku'])}"
  }}''')

    Path(OUTPUT_JS).write_text(
        "const localProducts = [\n" + ",\n".join(products) + "\n];\n",
        encoding="utf-8"
    )

    print(f"Wrote {OUTPUT_JS}")
    print(f"  {len(products)} products with real data")
    print(f"  {len(missing)} rows skipped (no image found)")
    if missing:
        print("\nSkipped:")
        for name, sku in missing[:15]:
            print(f"    {name} ({sku})")

if __name__ == "__main__":
    main()