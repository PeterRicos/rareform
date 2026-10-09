"""
swap_block.py
Replaces the local-products block in products.js (the catalog file the site
loads first) with a freshly generated one.
"""

import re
from pathlib import Path

CATALOG_FILE = Path("products.js")
NEW_BLOCK = Path("products_block.js")
BACKUP = Path("products.js.before-swap")

def main():
    js = CATALOG_FILE.read_text(encoding="utf-8")
    new_block = NEW_BLOCK.read_text(encoding="utf-8").strip()

    begin_marker = "/* == local-products:begin"
    end_marker = "/* == local-products:end == */"

    start_idx = js.find(begin_marker)
    end_idx = js.find(end_marker)

    if start_idx == -1 or end_idx == -1:
        print("ERROR: Could not find local-products markers in products.js")
        print("Look for these lines:")
        print("  /* == local-products:begin ... == */")
        print("  /* == local-products:end == */")
        return

    end_of_line = js.find("\n", end_idx)
    if end_of_line == -1:
        end_of_line = len(js)

    replacement = (
        "/* == local-products:begin == */\n"
        + new_block + "\n"
        + "/* == local-products:end == */"
    )

    BACKUP.write_text(js, encoding="utf-8")
    new_js = js[:start_idx] + replacement + js[end_of_line:]
    CATALOG_FILE.write_text(new_js, encoding="utf-8")

    product_count = new_js.count("sku:")
    print(f"Backed up original to {BACKUP}")
    print(f"Wrote new {CATALOG_FILE}")
    print(f"Contains ~{product_count} product entries")

if __name__ == "__main__":
    main()