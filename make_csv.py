import re
import pandas as pd

xl = pd.ExcelFile("yeezys.xlsx")
rows = []

for sheet in xl.sheet_names:
    df = pd.read_excel(xl, sheet_name=sheet, header=None)
    for _, r in df.iterrows():
        name = re.sub(r"^\*+\s*", "", str(r.get(0, ""))).strip()
        sizes = str(r.get(1, "")).strip()
        sku = str(r.get(2, "")).split("<br>")[0].split("\n")[0].strip()
        if not sku or sku.lower() == "nan":
            continue
        rows.append({
            "Sheet": sheet,
            "Name": name,
            "Sizes": sizes,
            "SKU": sku,
            "Price": ""   # bot fills this in
        })

df = pd.DataFrame(rows)
df.to_csv("sneaker_prices.csv", index=False)
print(f"Wrote sneaker_prices.csv with {len(rows)} rows")