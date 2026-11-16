"""
generate_products.py  (reads yeezys.xlsx + stockx_output.json, uses real paths)
"""

import json
import re
import unicodedata
import pandas as pd
from pathlib import Path

EXCEL_PATH = "yeezys.xlsx"
APIFY_FILE = "stockx_output.json"
IMAGES_DIR = Path("sneaker_images")
OUTPUT_JS = "products.js"   # loaded before app.js; window.localProducts consumed there
START_ID = 1   # dense 1..N — no hand-written listings remain above the block

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")
APPAREL_ORDER = {"XS": 0, "S": 1, "M": 2, "L": 3, "XL": 4, "XXL": 5, "XXXL": 6}
EMPTY_SIZE_TOKENS = {"", "NAN", "NONE", "NULL", "N/A", "NA", "-"}

# Yeezy shorthand prefixes used in the Excel sheet (e.g. "350 Beluga Reflective",
# "Slide Onyx", "Foam MX Cinder"). Other digit-starting silhouettes like New Balance
# "990v3" or "2002R" must NOT be mistaken for Yeezy/adidas.
YEEZY_SHORTHAND_RE = re.compile(
    r"^(?:(?:350|360|450|500|700)(?:\s*v[123])?|slide|foam|desert\s+boot)\b",
    re.IGNORECASE,
)

BRAND_CANONICAL = {
    "adidas": "adidas",
    "nike": "Nike",
    "jordan": "Jordan",
    "air jordan": "Jordan",
    "converse": "Converse",
    "new balance": "New Balance",
    "supreme": "Supreme",
}

# SKUs the StockX scrape gets wrong, verified against the product photos.
# The scrape is not trustworthy as a last word: it calls FZ1267 a "350 V2"
# (the photo is a 360 — full-length wraparound Boost midsole) and FZ5000
# "Carbon" (the photo is byte-identical to Yeezys_350_Asriel_FZ5000.jpg and
# FZ5000 is the Asriel). The spreadsheet plus the photos are the better source.
#
# "image" is overridden too, not just the title: find_image() derives the path
# from the spreadsheet's raw name, so without this the Carbon photo would come
# straight back and quietly undo the correction made in index.html.
OVERRIDES = {
    "FZ1267": {"title": "adidas Yeezy Boost 360 V2 Zyon", "colorway": "Zyon"},
    "FZ5000": {
        "title": "adidas Yeezy Boost 350 V2 Asriel",
        "colorway": "Asriel",
        "image": "sneaker_images/square/Yeezys_350_Asriel_FZ5000.jpg",
    },
}


def _is_missing(v):
    if v is None:
        return True
    if isinstance(v, (list, tuple, set, dict)):
        return False
    try:
        res = pd.isna(v)
        return bool(res) if isinstance(res, (bool,)) or hasattr(res, "__bool__") and not hasattr(res, "__len__") else False
    except (TypeError, ValueError):
        return False


def _word_match(keyword, text):
    return re.search(r"\b" + re.escape(keyword) + r"\b", text) is not None


def clean_name(v):
    if _is_missing(v):
        return ""
    return re.sub(r"^\*+\s*", "", str(v)).strip()


def clean_sku(v):
    if _is_missing(v):
        return ""
    first = re.split(r"<br\s*/?>|\r?\n", str(v), maxsplit=1, flags=re.IGNORECASE)[0].strip()
    if first.lower() in {"nan", "none", "null"}:
        return ""
    return first


def normalize_sku_key(sku):
    if _is_missing(sku):
        return ""
    return re.sub(r"[^A-Za-z0-9]+", "", str(sku)).upper()


def sanitize(s):
    if _is_missing(s):
        return "unknown"
    return re.sub(r"[^A-Za-z0-9]+", "_", str(s)).strip("_") or "unknown"


def _sanitize_ascii(s):
    if _is_missing(s):
        return "unknown"
    folded = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^A-Za-z0-9]+", "_", folded).strip("_") or "unknown"


def _normalize_size_token(token):
    t = re.sub(r"\s+", " ", str(token or "")).strip().upper()
    if not t or t in EMPTY_SIZE_TOKENS:
        return ""
    # Excel numeric cells often arrive as floats like "8.0" or "8.0W".
    t = re.sub(r"^(\d+)\.0+([A-Z]*)$", r"\1\2", t)
    return t


def parse_sizes(raw):
    if _is_missing(raw):
        return []

    if isinstance(raw, (list, tuple, set)):
        tokens = []
        for item in raw:
            if not _is_missing(item):
                tokens.extend(parse_sizes(str(item)))
        seen = []
        for t in tokens:
            if t not in seen:
                seen.append(t)
        return sorted(seen, key=size_key)

    text = re.sub(r"\s+", " ", str(raw)).strip()
    if not text:
        return []
    if text.lower() == "one size":
        return ["One Size"]

    # Keep fitted-hat fractions ("7 1/4", "7 1/2") intact while splitting on
    # commas, semicolons, pipes, or whitespace between separate sizes.
    parts = re.findall(r"\d+\s+\d+/\d+|[^\s,;|]+", text)
    seen = []
    for part in parts:
        p = _normalize_size_token(part)
        if not p:
            continue
        if p not in seen:
            seen.append(p)
    return sorted(seen, key=size_key)


def size_key(s):
    if _is_missing(s):
        return (999.0, "")
    text = re.sub(r"\s+", " ", str(s)).strip()
    if not text:
        return (999.0, "")
    upper = text.upper()
    if upper in APPAREL_ORDER:
        return (500.0 + APPAREL_ORDER[upper], upper)
    m = re.match(r"^(\d+(?:\.\d+)?)(?:\s+(\d+)/(\d+))?", text)
    if m:
        val = float(m.group(1))
        if m.group(2) and m.group(3):
            den = int(m.group(3))
            if den != 0:
                val += int(m.group(2)) / den
        return (val, text)
    return (999.0, text)


def _safe_under_dir(candidate, root):
    try:
        resolved_root = root.resolve()
        resolved_cand = candidate.resolve()
        return resolved_cand.is_file() and (
            resolved_cand == resolved_root or resolved_root in resolved_cand.parents
        )
    except OSError:
        return False


def find_image(sheet, name, sku):
    if _is_missing(sheet) or _is_missing(name) or _is_missing(sku):
        return None
    sheet_s = str(sheet).strip()
    name_s = str(name).strip()
    sku_s = str(sku).strip()
    if not sheet_s or not name_s or not sku_s:
        return None

    san_sheet = sanitize(sheet_s)
    san_name = sanitize(name_s)
    san_sku = sanitize(sku_s)

    # Prefer the padded 1:1 versions in square/ — the card grid and the detail
    # gallery are square boxes with object-fit:cover, and the originals are
    # landscape (cover would clip the toe/heel of the shoe).
    search_dirs = [IMAGES_DIR / "square", IMAGES_DIR]
    exact_bases = [f"{san_sheet}_{san_name}_{san_sku}"]
    ascii_base = f"{_sanitize_ascii(sheet_s)}_{_sanitize_ascii(name_s)}_{_sanitize_ascii(sku_s)}"
    if ascii_base not in exact_bases:
        exact_bases.append(ascii_base)

    # 1. Exact filename match first (preserves distinct files sharing a SKU like FZ5000).
    for base in exact_bases:
        for directory in search_dirs:
            for ext in IMAGE_EXTS:
                candidate = directory / f"{base}{ext}"
                if _safe_under_dir(candidate, IMAGES_DIR):
                    return str(candidate).replace("\\", "/")

    # 2. Case-insensitive / extension-tolerant match against actual files on disk.
    lowered_targets = {f"{base}{ext}".lower() for base in exact_bases for ext in IMAGE_EXTS}
    for directory in search_dirs:
        if not directory.is_dir():
            continue
        for entry in sorted(directory.iterdir()):
            if entry.is_file() and entry.name.lower() in lowered_targets and _safe_under_dir(entry, IMAGES_DIR):
                return str(entry).replace("\\", "/")

    # 3. Unique SKU fallback within the same sheet prefix, then across the directory.
    sku_suffix = f"_{san_sku}".lower()
    sheet_prefix = f"{san_sheet}_".lower()
    for directory in search_dirs:
        if not directory.is_dir():
            continue
        image_files = [
            e for e in sorted(directory.iterdir())
            if e.is_file() and e.suffix.lower() in IMAGE_EXTS and _safe_under_dir(e, IMAGES_DIR)
        ]
        sheet_matches = [
            e for e in image_files
            if e.stem.lower().startswith(sheet_prefix) and e.stem.lower().endswith(sku_suffix)
        ]
        if len(sheet_matches) == 1:
            return str(sheet_matches[0]).replace("\\", "/")
        sku_matches = [e for e in image_files if e.stem.lower().endswith(sku_suffix)]
        if len(sku_matches) == 1:
            return str(sku_matches[0]).replace("\\", "/")

    return None


def detect_brand(name, stockx):
    if isinstance(stockx, dict):
        raw_brand = stockx.get("brandName")
        if isinstance(raw_brand, str) and raw_brand.strip():
            b = raw_brand.strip()
            return BRAND_CANONICAL.get(b.lower(), b)

    clean = "" if _is_missing(name) else re.sub(r"\s+", " ", str(name)).strip()
    if not clean:
        return "Other"
    n = clean.lower()

    # Check explicit brand names first using word boundaries so e.g.
    # "Nike Air Foamposite" never matches adidas via "foam".
    if _word_match("jordan", n):
        return "Jordan"
    if _word_match("adidas", n):
        return "adidas"
    if _word_match("nike", n):
        return "Nike"
    if _word_match("converse", n):
        return "Converse"
    if _word_match("new balance", n):
        return "New Balance"
    if _word_match("supreme", n):
        return "Supreme"

    # Silhouette / shorthand fallbacks (word-bounded, and digit-starting only for Yeezy models).
    if any(_word_match(k, n) for k in ("yeezy", "foam", "slide", "desert boot")):
        return "adidas"
    if YEEZY_SHORTHAND_RE.match(clean):
        return "adidas"
    if _word_match("chuck", n):
        return "Converse"
    if _word_match("forum", n):
        return "adidas"
    if any(_word_match(k, n) for k in ("dunk", "air max", "air force", "blazer", "lebron", "air trainer", "kobe", "foamposite")):
        return "Nike"
    return "Other"


def build_yeezy_title(name):
    clean = "" if _is_missing(name) else re.sub(r"\s+", " ", str(name)).strip()
    if not clean:
        return "Yeezy"
    m = re.match(
        r"^(360|350|450|500|700|Slide|Foam(?:\s+Kids)?(?:\s+MTX)?(?:\s+MX)?|Desert\s+Boot)\s+(.+)$",
        clean,
        re.IGNORECASE,
    )
    if not m:
        return "Yeezy " + clean
    prefix, rest = m.group(1), m.group(2)
    low = prefix.lower()
    if low.startswith("slide"):
        return f"Yeezy Slide {rest}"
    if low.startswith("foam"):
        normalized_foam = re.sub(r"\s+", " ", prefix).strip()
        return f"Yeezy {normalized_foam} {rest}"
    if low.replace(" ", "") == "desertboot":
        return f"Yeezy Desert Boot {rest}"
    if prefix in ("350", "360"):
        prefix = f"{prefix} V2"
    return f"Yeezy Boost {prefix} {rest}"


def build_title(name, brand):
    clean = "" if _is_missing(name) else re.sub(r"\s+", " ", str(name)).strip()
    if brand == "adidas" and clean and YEEZY_SHORTHAND_RE.match(clean):
        return build_yeezy_title(clean)
    return clean


def esc(s):
    if _is_missing(s):
        return ""
    text = re.sub(r"[\r\n\t]+", " ", str(s))
    out = []
    for ch in text:
        code = ord(ch)
        if ch == "\\":
            out.append("\\\\")
        elif ch == '"':
            out.append('\\"')
        elif ch == "<":
            # Prevent </script> or HTML tag breakout if products.js is ever inlined.
            out.append("\\u003c")
        elif code < 0x20 or code == 0x7F or code in (0x2028, 0x2029):
            out.append(f"\\u{code:04x}")
        else:
            out.append(ch)
    return "".join(out)


def _extract_stockx_sku(item):
    for key in ("styleId", "sku", "SKU", "style_id", "styleID"):
        val = item.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
        if isinstance(val, (int, float)) and not _is_missing(val):
            return str(val).strip()
    return ""


def load_stockx_catalog(apify_path=APIFY_FILE):
    stockx = {}
    try:
        with open(apify_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"Note: {apify_path} not found - Excel-only mode")
        return stockx
    except (json.JSONDecodeError, UnicodeDecodeError, OSError) as err:
        print(f"Warning: could not read {apify_path} ({err}) - Excel-only mode")
        return stockx

    if not isinstance(data, list):
        print(f"Warning: {apify_path} must contain a JSON list, got {type(data).__name__} - Excel-only mode")
        return stockx

    for item in data:
        if not isinstance(item, dict):
            continue
        sid = _extract_stockx_sku(item)
        if not sid:
            continue
        upper_key = sid.upper()
        stockx[upper_key] = item
        norm_key = normalize_sku_key(sid)
        if norm_key and norm_key not in stockx:
            stockx[norm_key] = item
    return stockx


def main():
    xl = pd.ExcelFile(EXCEL_PATH)
    rows = []
    for sheet in xl.sheet_names:
        df = pd.read_excel(xl, sheet_name=sheet, header=None)
        for _, r in df.iterrows():
            name = clean_name(r.get(0, ""))
            sizes = parse_sizes(r.get(1, ""))
            sku = clean_sku(r.get(2, ""))
            if sku:
                rows.append({"Sheet": sheet, "RawName": name, "Sizes": sizes, "SKU": sku})

    stockx = load_stockx_catalog(APIFY_FILE)

    entries = []
    missing = []
    by_sku = {}

    for row in rows:
        raw_name = row.get("RawName") or ""
        sku = row.get("SKU") or ""
        if not sku:
            continue

        img = find_image(row.get("Sheet"), raw_name, sku)
        if not img:
            missing.append((raw_name, sku))
            continue

        sku_upper = sku.upper()
        sku_norm = normalize_sku_key(sku)
        sx = stockx.get(sku_upper) or stockx.get(sku_norm) or {}
        if not isinstance(sx, dict):
            sx = {}

        brand = detect_brand(raw_name, sx)
        title = build_title(raw_name, brand)

        sx_title = sx.get("title")
        if isinstance(sx_title, str) and sx_title.strip() and (
            len(raw_name) < 6 or YEEZY_SHORTHAND_RE.match(raw_name)
        ):
            title = sx_title.strip()

        raw_color = sx.get("colorway")
        colorway = raw_color.strip() if isinstance(raw_color, str) else ""

        raw_release = sx.get("releaseDate")
        release = str(raw_release).strip() if isinstance(raw_release, (str, int)) and not isinstance(raw_release, bool) else ""
        year_match = re.match(r"^(\d{4})\b", release)
        year = int(year_match.group(1)) if year_match else 0

        sizes = row["Sizes"] if row.get("Sizes") else ["One Size"]

        # Known-bad scrape records are corrected last, so nothing upstream can
        # put the wrong silhouette or colorway back.
        override = OVERRIDES.get(sku_upper) or OVERRIDES.get(sku_norm)
        if isinstance(override, dict):
            title = override.get("title") or title
            colorway = override.get("colorway") or colorway
            img = override.get("image") or img

        key = sku_norm or sku_upper
        if key in by_sku:
            # Same SKU twice (e.g. 350 Asriel shares the byte-identical 350
            # Carbon photo and SKU FZ5000): merge the sizes into the first
            # listing instead of showing the same product/photo twice.
            known = by_sku[key]
            merged = set(known.get("sizes") or []) | set(sizes)
            if len(merged) > 1 and "One Size" in merged:
                merged.discard("One Size")
            known["sizes"] = sorted(merged, key=size_key)
            continue

        entry = {
            "brand": brand or "Other",
            "name": title or sku,
            "color": colorway or "Original Colorway",
            "year": year,
            "sizes": sizes,
            "img": img,
            "sku": sku,
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
    year: {int(e['year'])},
    img: "{esc(e['img'])}",
    gallery: ["{esc(e['img'])}"],
    sku: "{esc(e['sku'])}"
  }}''')

    Path(OUTPUT_JS).write_text(
        "/* == local-products:begin == */\n"
        + "const localProducts = [\n" + ",\n".join(products) + "\n];\n"
        + "/* == local-products:end == */\n"
        + "window.localProducts = localProducts;\n",
        encoding="utf-8"
    )

    print(f"Wrote {OUTPUT_JS}")
    print(f"  {len(products)} products with real data")
    print(f"  {len(missing)} rows skipped (no image found)")
    if missing:
        print("\nSkipped:")
        for name, m_sku in missing[:15]:
            print(f"    {name} ({m_sku})")


if __name__ == "__main__":
    main()
